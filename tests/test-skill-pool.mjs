// 技能池端点端到端测试（针对运行中的 dsh web，默认 http://127.0.0.1:3081）
// 覆盖：三逻辑组结构、枚举（工作区聚合两根）、同名 shadowed 标注（rank 小者胜）、
//       复制、409 冲突+覆盖、移动、禁用/启用（frontmatter 双键）、删除=真删、
//       白名单外路径拒绝、同根操作拒绝；
//       挂载机制：载体根判定（在用的一根留给项目、空着的当载体、两个都在用则等选）、
//       git 体检（写忽略 / 已进仓库内容 409 → 搬到本地根或仅从仓库移除 / 非仓库也写）、
//       建链接与断链（池里的本体绝不被删被改）、失效链接可见、删除链接条目被拒。
// 用法：node tests\test-skill-pool.mjs [baseUrl]（需 dev 环境在跑，默认 http://127.0.0.1:3081）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:3081";
const POOL = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "skill-pool");
let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS  " : "FAIL  "}${label}${!ok && detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed++;
};

// ── fixture：临时项目目录（带 .git 标记）；同名 dup-kit 放两根验证 shadowed ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshkit-skill-"));
fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });

// 幂等清理：上次运行残留在池里的同名技能，必须先清场
for (const name of ["hello-kit", "flat-kit"]) {
  fs.rmSync(path.join(POOL, name), { recursive: true, force: true });
}
const mkSkillIn = (root, relDir, name, description) => {
  const dir = path.join(root, relDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  return dir;
};
const mkSkill = (relDir, name, description) => mkSkillIn(tmp, relDir, name, description);
/** 挂载机制用到的临时项目（仓库/非仓库都建，finally 里统一清） */
const extra = [];
const mkProject = (prefix, isRepo = true) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  extra.push(dir);
  if (isRepo) spawnSync("git", ["init", "-q", "."], { cwd: dir });
  return dir;
};
const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" });
mkSkill(".agents/skills", "hello-kit", "目录型测试技能"); // rank 200
mkSkill(".dsh/skills", "dup-kit", "高优先级副本"); // rank 100
mkSkill(".agents/skills", "dup-kit", "低优先级副本"); // rank 200 → 应被标 shadowed

try {
  const listSkills = async () =>
    fetch(`${base}/dsh-kit/skills?cwd=${encodeURIComponent(tmp)}`).then((r) => r.json());
  const groupOf = (body, id) => body.groups.find((g) => g.id === id);
  const find = (body, groupId, name) => groupOf(body, groupId)?.skills.find((s) => s.name === name);
  const op = (payload) =>
    fetch(`${base}/dsh-kit/skills/op`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: tmp, ...payload }),
    });

  // 1) 结构：三逻辑组 + 组内 roots 子结构 + 字段齐全
  let body = await listSkills();
  check("结构：三逻辑组 workspace/user/pool", JSON.stringify(body.groups.map((g) => g.id)) === '["workspace","user","pool"]');
  check("结构：workspace 组含两个物理根", groupOf(body, "workspace").roots.length === 2);
  check(
    "结构：物理根带 rank（.dsh=100、.agents=200、pool=null）",
    (() => {
      const w = groupOf(body, "workspace").roots;
      const p = groupOf(body, "pool").roots[0];
      return w.find((r) => r.id === "project-dsh")?.rank === 100 &&
        w.find((r) => r.id === "project-agents")?.rank === 200 &&
        p?.rank === null;
    })(),
  );
  check("结构：user 组含两个物理根", groupOf(body, "user").roots.length === 2);
  check("结构：pool 组含一个物理根", groupOf(body, "pool").roots.length === 1);

  // 2) 枚举与归属字段
  const hello = find(body, "workspace", "hello-kit");
  check("枚举：hello-kit 在 workspace 组", !!hello);
  check("枚举：root/rank 字段正确", hello?.root === "project-agents" && hello?.rank === 200);
  const dupHigh = find(body, "workspace", "dup-kit") && body.groups.flatMap((g) => g.skills).find((s) => s.name === "dup-kit" && s.root === "project-dsh");
  check(
    "shadowed：rank 小者胜、大者被覆盖",
    (() => {
      const all = body.groups.flatMap((g) => g.skills).filter((s) => s.name === "dup-kit");
      const high = all.find((s) => s.root === "project-dsh");
      const low = all.find((s) => s.root === "project-agents");
      return high?.shadowed === false && low?.shadowed === true && high?.rank === 100 && low?.rank === 200;
    })(),
    JSON.stringify(body.groups.flatMap((g) => g.skills).filter((s) => s.name === "dup-kit")),
  );
  void dupHigh;
  check("枚举：providers 为数组", Array.isArray(body.providers));

  // 3) 复制到池（dest=物理根 id）。先按枚举删掉池里的残留同名技能——残留在会让
  // 复制变 409；走 API 删（服务端真相，平铺 .md / 目录都覆盖，不依赖本地 DSH_HOME 对不对）
  for (const s of groupOf(await listSkills(), "pool")?.skills ?? []) {
    if (s.name === "hello-kit" || s.name === "flat-kit") await op({ op: "delete", src: s.path });
  }
  let res = await op({ op: "copy", src: hello.path, dest: "pool" });
  check("复制到池：200", res.status === 200);
  body = await listSkills();
  check("复制到池：池里出现同名技能且 root=pool", (() => {
    const p = find(body, "pool", "hello-kit");
    return !!p && p.root === "pool" && p.rank === null && p.shadowed === false;
  })());
  check("复制到池：源仍在工作区", !!find(body, "workspace", "hello-kit"));

  // 4) 冲突与覆盖
  res = await op({ op: "copy", src: hello.path, dest: "pool" });
  check("重复复制：409 conflict", res.status === 409);
  res = await op({ op: "copy", src: hello.path, dest: "pool", overwrite: true });
  check("覆盖复制：200", res.status === 200);

  // 5) 移动平铺技能到池（源消失）——补一个平铺 fixture
  const flatFile = path.join(tmp, ".dsh", "skills", "flat-kit.md");
  fs.writeFileSync(flatFile, "---\nname: flat-kit\ndescription: 平铺测试技能\n---\nbody\n");
  res = await op({ op: "move", src: flatFile, dest: "pool" });
  check("移动到池：200", res.status === 200);
  body = await listSkills();
  check("移动后：工作区不再有 flat-kit", !find(body, "workspace", "flat-kit"));
  check("移动后：池里有 flat-kit 且内容完好", (() => {
    const s = find(body, "pool", "flat-kit");
    return !!s && fs.readFileSync(s.file, "utf8").includes("description: 平铺测试技能");
  })());

  // 6) 禁用 / 启用（frontmatter 双键热生效）
  const poolHello = find(await listSkills(), "pool", "hello-kit");
  res = await op({ op: "disable", src: poolHello.path, disabled: true });
  const disJson = await res.json();
  check("禁用：200 且返回 disabled=true", res.status === 200 && disJson.disabled === true);
  let text = fs.readFileSync(poolHello.file, "utf8");
  check(
    "禁用：frontmatter 写入双键",
    /^disable-model-invocation:[ \t]*true$/m.test(text) && /^user-invocable:[ \t]*false$/m.test(text),
  );
  check("禁用：用户其余内容保留", text.includes("description: 目录型测试技能") && text.includes("# hello-kit"));
  body = await listSkills();
  check("禁用：再次枚举标记 disabled", find(body, "pool", "hello-kit")?.disabled === true);
  res = await op({ op: "disable", src: poolHello.path, disabled: false });
  check("启用：200 且返回 disabled=false", res.status === 200 && (await res.json()).disabled === false);
  text = fs.readFileSync(poolHello.file, "utf8");
  check("启用：双键已移除", !/^disable-model-invocation:/m.test(text) && !/^user-invocable:/m.test(text));

  // 7) 删除 = 真删（文件系统直接消失，无 .trash 中转）
  const flatInPool = find(await listSkills(), "pool", "flat-kit");
  res = await op({ op: "delete", src: flatInPool.path });
  check("删除：200", res.status === 200);
  check("删除：磁盘上已不存在", !fs.existsSync(flatInPool.path));
  check("删除：列表不再出现", !find(await listSkills(), "pool", "flat-kit"));

  // 8) 安全：白名单外的路径拒绝
  res = await op({ op: "copy", src: fileURLToPath(new URL("../package.json", import.meta.url)), dest: "pool" });
  check("白名单外源：400", res.status === 400);

  // 9) 同根移动/复制拒绝
  res = await op({ op: "move", src: path.join(tmp, ".agents", "skills", "hello-kit"), dest: "project-agents" });
  check("同根操作：400", res.status === 400);

  // ── 10) 挂载机制 ──
  const listIn = async (dir) => fetch(`${base}/dsh-kit/skills?cwd=${encodeURIComponent(dir)}`).then((r) => r.json());
  const opIn = (dir, payload) =>
    fetch(`${base}/dsh-kit/skills/op`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: dir, ...payload }),
    });
  const bodyOf = async (r) => {
    try {
      return await r.json();
    } catch {
      return {};
    }
  };
  const poolSkill = find(await listSkills(), "pool", "hello-kit");
  const poolBodyFile = path.join(poolSkill.path, "SKILL.md");
  const poolBody = fs.readFileSync(poolBodyFile, "utf8");

  // 10.1 载体根 = 空着的那个；未体检不给挂（否则池内容会被仓库收进去）
  const proj = mkProject("dshkit-mount-");
  mkSkillIn(proj, ".dsh/skills", "proj-kit", "项目自己的技能");
  let m = (await listIn(proj)).mount;
  check(
    "载体根：在用的一根留给项目、空着的当载体",
    m.carrierRoot === "project-agents" && m.localRoot === "project-dsh" && m.needsChoice === false,
    JSON.stringify(m),
  );
  check("载体根：新仓库尚未忽略载体根", m.ignored === false && m.tracked.length === 0);
  res = await opIn(proj, { op: "mount", src: poolSkill.path });
  check("挂载：未体检 → 400 not-prepared", res.status === 400 && (await bodyOf(res)).error === "not-prepared");

  // 10.2 体检：写忽略（幂等），有仓库时自检生效
  res = await opIn(proj, { op: "prepare" });
  let prep = await bodyOf(res);
  check("体检：200 且写入忽略", res.status === 200 && prep.ok === true && prep.wroteIgnore === true, JSON.stringify(prep));
  check("体检：.gitignore 写入锚定的载体根", fs.readFileSync(path.join(proj, ".gitignore"), "utf8").includes("/.agents/skills/"));
  m = (await listIn(proj)).mount;
  check("体检后：载体根已忽略、无待处理内容", m.ignored === true && m.tracked.length === 0);
  res = await opIn(proj, { op: "prepare" });
  check("体检：重复执行不重复写", res.status === 200 && (await bodyOf(res)).wroteIgnore === false);

  // 10.3 挂载 = 目录链接，宿主照常发现
  res = await opIn(proj, { op: "mount", src: poolSkill.path });
  check("挂载：200", res.status === 200);
  const linkPath = path.join(proj, ".agents", "skills", "hello-kit");
  check("挂载：载体根里出现链接（junction/symlink）", fs.lstatSync(linkPath).isSymbolicLink());
  check("挂载：链接目标就是池里的本体", fs.realpathSync(linkPath) === fs.realpathSync(poolSkill.path));
  check("挂载：经链接读到本体内容", fs.readFileSync(path.join(linkPath, "SKILL.md"), "utf8") === poolBody);
  const listedProj = await listIn(proj);
  const linkedRow = find(listedProj, "workspace", "hello-kit");
  check(
    "挂载：面板按链接枚举（不会整条漏掉）",
    linkedRow?.root === "project-agents" && linkedRow?.link === true && linkedRow?.linkInPool === true,
    JSON.stringify(linkedRow),
  );
  check("挂载：与本地根的项目技能并存", !!find(listedProj, "workspace", "proj-kit"));
  res = await opIn(proj, { op: "mount", src: poolSkill.path });
  check("挂载：重复挂载 → 400", res.status === 400);

  // 10.4 误删保护：删链接只断链，池里的本体绝不被删
  res = await opIn(proj, { op: "delete", src: linkPath });
  check("删除链接条目：400 拒绝（不会删到池里的本体）", res.status === 400);
  check("删除被拒后：池里的本体完好", fs.readFileSync(poolBodyFile, "utf8") === poolBody);
  res = await opIn(proj, { op: "unmount", src: linkPath });
  check("断链：200", res.status === 200);
  check("断链：链接消失、池里的本体仍在", !fs.existsSync(linkPath) && fs.readFileSync(poolBodyFile, "utf8") === poolBody);
  check("断链后：枚举里不再有它", !find(await listIn(proj), "workspace", "hello-kit"));

  // 10.5 失效链接：池里的本体改名后，工作区的链接要能看见、能一键清理
  res = await opIn(proj, { op: "mount", src: poolSkill.path });
  const parked = path.join(POOL, "hello-kit-parked");
  fs.renameSync(poolSkill.path, parked);
  const brokenList = await listIn(proj);
  check("失效链接：单列出来（宿主侧会静默跳过）", brokenList.brokenLinks.some((b) => b.path === linkPath));
  res = await opIn(proj, { op: "unmount", src: linkPath });
  check("失效链接：可清理", res.status === 200 && !fs.existsSync(linkPath));
  fs.renameSync(parked, poolHello.path);

  // 10.6 两个根都在用 → 等用户选；已进仓库的内容要用户决定怎么处理
  const proj2 = mkProject("dshkit-mount2-");
  mkSkillIn(proj2, ".dsh/skills", "local-kit", "本地根");
  mkSkillIn(proj2, ".agents/skills", "legacy-kit", "载体根里已进仓库的技能");
  git(proj2, ["add", "-A"]);
  git(proj2, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  m = (await listIn(proj2)).mount;
  check("载体根：两个根都在用 → 等用户选", m.needsChoice === true && m.carrierRoot === null);
  check("载体根：报告已进仓库的内容", m.tracked.some((p) => p.includes("legacy-kit")), JSON.stringify(m.tracked));
  res = await opIn(proj2, { op: "prepare" });
  check("体检：未选载体根 → 400", res.status === 400);
  res = await opIn(proj2, { op: "setcarrier", carrier: "project-agents" });
  check("选载体根：200 且即刻生效", res.status === 200 && (await bodyOf(res)).mount.carrierRoot === "project-agents");
  m = (await listIn(proj2)).mount;
  check("选载体根：持久化（不再问）", m.pinned === true && m.needsChoice === false && m.localRoot === "project-dsh");
  res = await opIn(proj2, { op: "prepare" });
  check("体检：有已进仓库的内容 → 409 tracked（等用户选）", res.status === 409 && (await bodyOf(res)).error === "tracked");
  res = await opIn(proj2, { op: "prepare", resolve: "untrack" });
  check("体检·仅从仓库移除：200", res.status === 200);
  check(
    "体检·仅从仓库移除：文件保留、仓库不再跟踪",
    fs.existsSync(path.join(proj2, ".agents", "skills", "legacy-kit", "SKILL.md")) &&
      git(proj2, ["ls-files", "--", ".agents/skills"]).stdout.trim() === "",
  );
  m = (await listIn(proj2)).mount;
  check("体检后：已忽略、无待处理内容", m.ignored === true && m.tracked.length === 0);

  // 10.7 体检·搬到项目技能根
  const proj3 = mkProject("dshkit-mount3-");
  mkSkillIn(proj3, ".dsh/skills", "keep-kit", "本地根");
  mkSkillIn(proj3, ".agents/skills", "movable-kit", "载体根里的实体");
  git(proj3, ["add", "-A"]);
  git(proj3, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  await opIn(proj3, { op: "setcarrier", carrier: "project-agents" });
  res = await opIn(proj3, { op: "prepare", resolve: "move" });
  prep = await bodyOf(res);
  check("体检·搬到项目技能根：200 且报告搬了 1 项", res.status === 200 && prep.moved?.includes("movable-kit"), JSON.stringify(prep));
  check(
    "体检·搬到项目技能根：实体落到本地根、载体根清空",
    fs.existsSync(path.join(proj3, ".dsh", "skills", "movable-kit", "SKILL.md")) &&
      !fs.existsSync(path.join(proj3, ".agents", "skills", "movable-kit")),
  );
  check("体检·搬到项目技能根：忽略同时写好", fs.readFileSync(path.join(proj3, ".gitignore"), "utf8").includes("/.agents/skills/"));

  // 10.8 非仓库也先写忽略（防以后建仓才乱），写完即可挂载
  const proj4 = mkProject("dshkit-mount4-", false);
  mkSkillIn(proj4, ".dsh/skills", "plain-kit", "非仓库项目");
  m = (await listIn(proj4)).mount;
  check("非仓库：没有仓库可体检（repoRoot/ignored 为 null）", m.repoRoot === null && m.ignored === null);
  res = await opIn(proj4, { op: "prepare" });
  check("非仓库：体检也写 .gitignore", res.status === 200 && fs.readFileSync(path.join(proj4, ".gitignore"), "utf8").includes("/.agents/skills/"));
  res = await opIn(proj4, { op: "mount", src: poolSkill.path });
  check("非仓库：写完忽略即可挂载", res.status === 200 && fs.lstatSync(path.join(proj4, ".agents", "skills", "hello-kit")).isSymbolicLink());
} finally {
  for (const dir of extra) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nALL SKILL-POOL TESTS PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
