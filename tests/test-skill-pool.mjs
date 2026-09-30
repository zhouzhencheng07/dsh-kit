// 技能池端点端到端测试（针对运行中的 dsh web，默认 http://127.0.0.1:3081）
// 覆盖：三逻辑组结构、枚举（工作区聚合两根）、同名 shadowed 标注（rank 小者胜）、
//       移动、409 冲突+覆盖、禁用/启用（frontmatter 双键）、删除=真删、
//       白名单外路径拒绝、同根操作拒绝；
//       挂载机制：挂载点只由用户选定（没选过就等用户选，不看哪根"在用"、不默认哪一根；
//       选定后一切挂载都去那儿）、
//       git 体检（写忽略 / 已进仓库内容 409 → 搬到本地根或仅从仓库移除 / 非仓库也写）、
//       建链接与断链（池里的本体绝不被删被改）、失效链接可见、删除链接条目被拒；
//       版本记录（只给池技能）：建仓与一条基线首版、改内容不自动提交、有意提交直接可用、
//       池根自己不建仓（不做池级单一仓库）；
//       池的边界：技能只有移动（copy 不是操作）、入池原地留链接（平铺 .md 包成同名目录）、
//       出池断掉所有工作区的链接且不带版本记录、目标与源同一处被拒、删除本体先断链。
// 用法：node tests\test-skill-pool.mjs [baseUrl]（需 dev 环境在跑，默认 http://127.0.0.1:3081）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:3081";
const POOL = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "dsh-kit", "skill-pool");
let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS  " : "FAIL  "}${label}${!ok && detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed++;
};

// ── fixture：临时项目目录（带 .git 标记）；同名 dup-kit 放两根验证 shadowed ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshkit-skill-"));
fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });

// 幂等清理：上次运行残留在池里的同名技能，必须先清场
for (const name of ["hello-kit", "flat-kit", "flat-in", "carri-kit", "ver-kit", "in-kit", "del-kit", "idle-kit", "flat-ver.md"]) {
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
  // 数据目录对齐：POOL 由本进程的 DSH_HOME 推，dsh web 那侧可能是另一个 home——不一致时
  // 后面写进 POOL 的 fixture 服务器根本看不见，还会把真实池当测试池用（先于任何写操作拦下）
  const serverPool = groupOf(body, "pool")?.roots?.[0]?.dir;
  if (typeof serverPool !== "string" || path.resolve(serverPool) !== path.resolve(POOL)) {
    console.error(
      `\n数据目录不一致：测试 POOL=${POOL}\n            服务器池=${serverPool ?? "(未上报)"}\n` +
        "请带着与 dsh web 相同的 DSH_HOME 跑本测试（dev 环境：$env:DSH_HOME='D:\\agent\\.dsh-dev'）",
    );
    process.exit(2);
  }

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

  // 3) 池里的 fixture 直接放（复制进池已被拒——见下），它是后面挂载/禁用/删除要用的本体。
  // 先按枚举删掉池里的残留同名技能：残留会让后面的操作撞名；走 API 删（服务端真相，
  // 平铺 .md / 目录都覆盖，不依赖本地 DSH_HOME 对不对）
  for (const s of groupOf(await listSkills(), "pool")?.skills ?? []) {
    if (s.name === "hello-kit" || s.name === "flat-kit") await op({ op: "delete", src: s.path });
  }
  mkSkillIn(POOL, "", "hello-kit", "池里的测试技能");
  body = await listSkills();
  check(
    "池 fixture：池里的技能自成一档（root=pool、无 rank、不被覆盖）",
    (() => {
      const p = find(body, "pool", "hello-kit");
      return !!p && p.root === "pool" && p.rank === null && p.shadowed === false;
    })(),
  );
  check("池 fixture：与工作区同名技能并存（池不参与跨根覆盖判定）", !!find(body, "workspace", "hello-kit"));

  // 4) 复制不再是操作：技能只有移动（副本与本体分叉，版本记录也就失去意义）
  let res = await op({ op: "copy", src: hello.path, dest: "pool" });
  check("复制已取消：copy → 400 未知操作", res.status === 400 && (await res.json()).error === "未知操作");
  check(
    "复制被拒后：源完好、池里没多一份",
    fs.existsSync(path.join(hello.path, "SKILL.md")) && !!find(await listSkills(), "workspace", "hello-kit"),
  );

  // 5) 池里已有同名 → 拒绝（不去覆盖共用本体，先移出或删掉再说）
  res = await op({ op: "move", src: hello.path, dest: "pool" });
  check("移动到池：池里已有同名 → 400 exists-in-pool", res.status === 400 && (await res.json()).error === "exists-in-pool");
  check("被拒后：工作区的源完好", fs.existsSync(path.join(hello.path, "SKILL.md")));

  // 6) 池外的普通搬运照旧：同名 409 + 用户确认后覆盖
  const dupSrc = mkSkillIn(tmp, ".agents/skills", "dup2-kit", "来源副本");
  const dupDst = mkSkillIn(tmp, ".dsh/skills", "dup2-kit", "本地副本");
  res = await op({ op: "move", src: dupSrc, dest: "project-dsh" });
  check("同名撞车：409 conflict", res.status === 409);
  res = await op({ op: "move", src: dupSrc, dest: "project-dsh", overwrite: true });
  check("确认覆盖：200 且内容换成来源的", res.status === 200 && fs.readFileSync(path.join(dupDst, "SKILL.md"), "utf8").includes("来源副本"));

  // 7) 池里的平铺 .md 照常枚举（外部直接丢进来的那种）；平铺"搬进池"在 14.4 走真实项目
  fs.writeFileSync(path.join(POOL, "flat-kit.md"), "---\nname: flat-kit\ndescription: 平铺测试技能\n---\nbody\n");
  body = await listSkills();
  check("平铺技能在池里照常枚举（外部放进来的那份）", !!find(body, "pool", "flat-kit"));

  // 7.1 池只收技能：平铺的非 .md 文件不是技能条目，不给"包成目录"溜进池
  const stray = path.join(tmp, ".dsh", "skills", "notes.txt");
  fs.writeFileSync(stray, "not a skill\n");
  res = await op({ op: "move", src: stray, dest: "pool" });
  check("进池只收技能：平铺非 .md 文件 → 400 not-a-skill", res.status === 400 && (await res.json()).error === "not-a-skill");
  check("被拒后：文件还在原处、池里没多出目录", fs.existsSync(stray) && !fs.existsSync(path.join(POOL, "notes.txt")));
  fs.rmSync(stray, { force: true });

  // 8) 禁用 / 启用（frontmatter 双键热生效）
  const poolHello = find(await listSkills(), "pool", "hello-kit");
  res = await op({ op: "disable", src: poolHello.path, disabled: true });
  const disJson = await res.json();
  check("禁用：200 且返回 disabled=true", res.status === 200 && disJson.disabled === true);
  let text = fs.readFileSync(poolHello.file, "utf8");
  check(
    "禁用：frontmatter 写入双键",
    /^disable-model-invocation:[ \t]*true$/m.test(text) && /^user-invocable:[ \t]*false$/m.test(text),
  );
  check("禁用：用户其余内容保留", text.includes("description: 池里的测试技能") && text.includes("# hello-kit"));
  body = await listSkills();
  check("禁用：再次枚举标记 disabled", find(body, "pool", "hello-kit")?.disabled === true);
  res = await op({ op: "disable", src: poolHello.path, disabled: false });
  check("启用：200 且返回 disabled=false", res.status === 200 && (await res.json()).disabled === false);
  text = fs.readFileSync(poolHello.file, "utf8");
  check("启用：双键已移除", !/^disable-model-invocation:/m.test(text) && !/^user-invocable:/m.test(text));

  // 9) 删除 = 真删（文件系统直接消失，无 .trash 中转）
  const flatInPool = find(await listSkills(), "pool", "flat-kit");
  res = await op({ op: "delete", src: flatInPool.path });
  check("删除：200", res.status === 200);
  check("删除：磁盘上已不存在", !fs.existsSync(flatInPool.path));
  check("删除：列表不再出现", !find(await listSkills(), "pool", "flat-kit"));

  // 10) 安全：白名单外的路径拒绝
  res = await op({ op: "move", src: fileURLToPath(new URL("../package.json", import.meta.url)), dest: "pool" });
  check("白名单外源：400", res.status === 400);

  // 11) 同根移动拒绝
  res = await op({ op: "move", src: path.join(tmp, ".agents", "skills", "hello-kit"), dest: "project-agents" });
  check("同根操作：400", res.status === 400);

  // ── 12) 挂载机制 ──
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

  // 12.1 挂载点只由用户选：没选过就问，插件不看哪根"在用"、也不默认哪一根
  const proj = mkProject("dshkit-mount-");
  mkSkillIn(proj, ".dsh/skills", "proj-kit", "项目自己的技能");
  let m = (await listIn(proj)).mount;
  check(
    "载体根：没选过 → 等用户选（不问哪根在用、不默认）",
    m.carrierRoot === null && m.needsChoice === true && m.pinned === false,
    JSON.stringify(m),
  );
  res = await opIn(proj, { op: "mount", src: poolSkill.path });
  check("挂载：没选载体根 → 400 not-prepared", res.status === 400 && (await bodyOf(res)).error === "not-prepared");
  res = await opIn(proj, { op: "prepare" });
  check("体检：没选载体根 → 400（先选再动盘）", res.status === 400);
  res = await opIn(proj, { op: "setcarrier", carrier: "project-agents" });
  check("选载体根：200 且即刻生效", res.status === 200 && (await bodyOf(res)).mount.carrierRoot === "project-agents");
  m = (await listIn(proj)).mount;
  check("选载体根：持久化（不再问）", m.pinned === true && m.needsChoice === false && m.carrierRoot === "project-agents");
  check("选载体根：另一根就是没选的那个（载体根里有自己的技能时可搬过去）", m.otherRoot === "project-dsh", JSON.stringify(m));
  check("载体根：新仓库尚未忽略载体根", m.ignored === false && m.tracked.length === 0);

  // 12.2 体检：写忽略（幂等），有仓库时自检生效
  res = await opIn(proj, { op: "prepare" });
  let prep = await bodyOf(res);
  check("体检：200 且写入忽略", res.status === 200 && prep.ok === true && prep.wroteIgnore === true, JSON.stringify(prep));
  check("体检：.gitignore 写入锚定的载体根", fs.readFileSync(path.join(proj, ".gitignore"), "utf8").includes("/.agents/skills/"));
  m = (await listIn(proj)).mount;
  check("体检后：载体根已忽略、无待处理内容", m.ignored === true && m.tracked.length === 0);
  res = await opIn(proj, { op: "prepare" });
  check("体检：重复执行不重复写", res.status === 200 && (await bodyOf(res)).wroteIgnore === false);

  // 12.3 挂载 = 目录链接，宿主照常发现
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

  // 12.4 误删保护：删链接只断链，池里的本体绝不被删
  res = await opIn(proj, { op: "delete", src: linkPath });
  check("删除链接条目：400 拒绝（不会删到池里的本体）", res.status === 400);
  check("删除被拒后：池里的本体完好", fs.readFileSync(poolBodyFile, "utf8") === poolBody);
  res = await opIn(proj, { op: "unmount", src: linkPath });
  check("断链：200", res.status === 200);
  check("断链：链接消失、池里的本体仍在", !fs.existsSync(linkPath) && fs.readFileSync(poolBodyFile, "utf8") === poolBody);
  check("断链后：枚举里不再有它", !find(await listIn(proj), "workspace", "hello-kit"));

  // 12.5 失效链接：池里的本体改名后，工作区的链接要能看见、能一键清理
  res = await opIn(proj, { op: "mount", src: poolSkill.path });
  const parked = path.join(POOL, "hello-kit-parked");
  fs.renameSync(poolSkill.path, parked);
  const brokenList = await listIn(proj);
  check("失效链接：单列出来（宿主侧会静默跳过）", brokenList.brokenLinks.some((b) => b.path === linkPath));
  res = await opIn(proj, { op: "unmount", src: linkPath });
  check("失效链接：可清理", res.status === 200 && !fs.existsSync(linkPath));
  fs.renameSync(parked, poolHello.path);

  // 12.6 没选过 → 等用户选；已进仓库的内容要用户决定怎么处理
  const proj2 = mkProject("dshkit-mount2-");
  mkSkillIn(proj2, ".dsh/skills", "local-kit", "本地根");
  mkSkillIn(proj2, ".agents/skills", "legacy-kit", "载体根里已进仓库的技能");
  git(proj2, ["add", "-A"]);
  git(proj2, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  m = (await listIn(proj2)).mount;
  check("载体根：没选过 → 等用户选（根里放没放技能都一样）", m.needsChoice === true && m.carrierRoot === null);
  check("载体根：报告已进仓库的内容", m.tracked.some((p) => p.includes("legacy-kit")), JSON.stringify(m.tracked));
  res = await opIn(proj2, { op: "prepare" });
  check("体检：未选载体根 → 400", res.status === 400);
  res = await opIn(proj2, { op: "setcarrier", carrier: "project-agents" });
  check("选载体根：200 且即刻生效", res.status === 200 && (await bodyOf(res)).mount.carrierRoot === "project-agents");
  m = (await listIn(proj2)).mount;
  check("选载体根：持久化（不再问）", m.pinned === true && m.needsChoice === false && m.otherRoot === "project-dsh");
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

  // 12.7 体检·搬到项目技能根
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

  // 12.8 非仓库也先写忽略（防以后建仓才乱），写完即可挂载
  const proj4 = mkProject("dshkit-mount4-", false);
  mkSkillIn(proj4, ".dsh/skills", "plain-kit", "非仓库项目");
  await opIn(proj4, { op: "setcarrier", carrier: "project-agents" });
  m = (await listIn(proj4)).mount;
  check("非仓库：没有仓库可体检（repoRoot/ignored 为 null）", m.repoRoot === null && m.ignored === null);
  res = await opIn(proj4, { op: "prepare" });
  check("非仓库：体检也写 .gitignore", res.status === 200 && fs.readFileSync(path.join(proj4, ".gitignore"), "utf8").includes("/.agents/skills/"));
  res = await opIn(proj4, { op: "mount", src: poolSkill.path });
  check("非仓库：写完忽略即可挂载", res.status === 200 && fs.lstatSync(path.join(proj4, ".agents", "skills", "hello-kit")).isSymbolicLink());

  // 12.9 选定之后一切都去那儿（含入池自动回挂）：另一根里放什么、哪根更"像在用"都不再影响
  const proj5 = mkProject("dshkit-mount5-");
  mkSkillIn(proj5, ".dsh/skills", "own-kit", "项目自己的技能");
  await opIn(proj5, { op: "setcarrier", carrier: "project-agents" });
  await opIn(proj5, { op: "prepare" });
  res = await opIn(proj5, { op: "mount", src: poolSkill.path });
  const carrierLink = path.join(proj5, ".agents", "skills", "hello-kit");
  check("选定后：链接落在选定的根", res.status === 200 && fs.lstatSync(carrierLink).isSymbolicLink());
  mkSkillIn(proj5, ".agents/skills", "later-kit", "后来放进选定根的项目技能");
  m = (await listIn(proj5)).mount;
  check(
    "选定后：另一根的内容不影响挂载点（不再重算、不再问）",
    m.carrierRoot === "project-agents" && m.needsChoice === false && m.pinned === true,
    JSON.stringify(m),
  );
  const carriSrc = mkSkillIn(proj5, ".dsh/skills", "carri-kit", "挂回来的位置要跟选定的根一致");
  res = await opIn(proj5, { op: "move", src: carriSrc, dest: "pool" });
  const carriIn = await bodyOf(res);
  check(
    "入池：回挂到选定的根",
    res.status === 200 && carriIn.mounted === path.join(proj5, ".agents", "skills", "carri-kit") && fs.lstatSync(carriIn.mounted).isSymbolicLink(),
    JSON.stringify(carriIn),
  );

  // 12.10 没选过载体根时入池整个不做（源不能丢——挂不回来就不许搬走）
  const proj6 = mkProject("dshkit-mount6-");
  const noChoice = mkSkillIn(proj6, ".dsh/skills", "nochoice-kit", "还没选载体根就想入池");
  res = await opIn(proj6, { op: "move", src: noChoice, dest: "pool" });
  check("入池：没选载体根 → 400 not-prepared", res.status === 400 && (await bodyOf(res)).error === "not-prepared");
  check(
    "入池被拒后：源还在、池里没多一份",
    fs.existsSync(path.join(noChoice, "SKILL.md")) && !fs.existsSync(path.join(POOL, "nochoice-kit")),
  );

  // ── 13) 池技能的版本记录（每技能一仓 + 一条基线首版；不做自动提交）──
  // 基线由「搬进池」这条操作立刻补上（插件启动时也会给已有的池技能补一遍）
  const verProj = mkProject("dshkit-ver-");
  const verSrc = mkSkillIn(verProj, ".dsh/skills", "ver-kit", "版本记录测试技能");
  await opIn(verProj, { op: "setcarrier", carrier: "project-agents" });
  await opIn(verProj, { op: "prepare" });
  res = await opIn(verProj, { op: "move", src: verSrc, dest: "pool" });
  const verDir = path.join(POOL, "ver-kit");
  const verFile = path.join(verDir, "SKILL.md");
  const countCommits = (dir) => Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim() || 0);
  const lastSubject = (dir) => git(dir, ["log", "-1", "--pretty=%s"]).stdout.trim();

  // 13.1 进池即备好仓库 + 一条「初始记录」基线
  check("版本：技能进池就备好了自己的仓库", res.status === 200 && fs.existsSync(path.join(verDir, ".git")), await bodyOf(res));
  check("版本：基线首版已记（主题标明初始记录）", countCommits(verDir) === 1 && lastSubject(verDir) === "auto: 初始记录", lastSubject(verDir));
  check(
    "版本：仓库是技能目录自己的（不会替外层仓库提交）",
    fs.realpathSync(git(verDir, ["rev-parse", "--show-toplevel"]).stdout.trim()) === fs.realpathSync(verDir),
  );
  check(
    "版本：身份只写本仓，不动用户全局 git 配置",
    git(verDir, ["config", "--local", "user.name"]).stdout.trim() === "dsh-kit" &&
      git(verDir, ["config", "--local", "user.email"]).stdout.trim() === "dsh-kit@localhost",
  );
  check("版本：一仓一技能目录，池根自己不建仓（不做池级单一仓库）", !fs.existsSync(path.join(POOL, ".git")));

  // 13.2 改内容**不会**自动提交：历史不能被同题目的提交淹掉，提交是有意识动作
  fs.appendFileSync(verFile, "\n<!-- 等一个有意提交 -->\n");
  await listIn(verProj);
  await new Promise((r) => setTimeout(r, 2600));
  check("版本：改内容不会自动提交（拉过列表、等两秒半仍只有基线那一条）", countCommits(verDir) === 1, countCommits(verDir));
  check("版本：改动就躺在工作区里（未提交可见）", git(verDir, ["status", "--porcelain"]).stdout.includes("SKILL.md"));

  // 13.3 面板记一版：提交信息由人/agent 给（空信息拒绝），作者是本仓身份，无改动不空提交
  const hist0 = await bodyOf(await opIn(proj, { op: "history", src: verDir }));
  check(
    "版本：history 回状态（一条基线、未提交 1 个文件、带改动文件名）",
    hist0.ok === true &&
      hist0.git.commits.length === 1 &&
      hist0.git.dirty === 1 &&
      hist0.git.commits[0].subject === "auto: 初始记录" &&
      hist0.git.commits[0].names.includes("SKILL.md"),
    JSON.stringify(hist0.git).slice(0, 200),
  );
  res = await opIn(proj, { op: "commit", src: verDir, message: "   " });
  check("版本：提交信息为空 → 400（历史的信息量就靠它）", res.status === 400 && (await bodyOf(res)).error === "commit-failed");
  res = await opIn(proj, { op: "commit", src: verDir, message: "改进：补一条说明" });
  const committed = await bodyOf(res);
  check(
    "版本：按给定的提交信息记一版",
    res.status === 200 &&
      committed.committed === true &&
      committed.git.commits.length === 2 &&
      committed.git.commits[0].subject === "改进：补一条说明",
    JSON.stringify(committed.git?.commits?.map((c) => c.subject)),
  );
  check(
    "版本：提交作者是仓库里的 dsh-kit（没动全局配置）",
    git(verDir, ["log", "-1", "--pretty=%an <%ae>"]).stdout.trim() === "dsh-kit <dsh-kit@localhost>",
  );
  check("版本：正文自动带上这次改动的文件", git(verDir, ["log", "-1", "--pretty=%b"]).stdout.includes("SKILL.md"));
  res = await opIn(proj, { op: "commit", src: verDir, message: "再记一次" });
  check("版本：没有改动 → 不产生空提交", res.status === 200 && (await bodyOf(res)).committed === false);
  check("版本：这时历史两条", countCommits(verDir) === 2, countCommits(verDir));

  // 13.4 回滚：恢复内容 + 记一条新提交（历史不重写）；未提交的改动必须明确"一起丢掉"
  const baselineSha = hist0.git.commits[0].sha;
  fs.appendFileSync(verFile, "\n<!-- 不要了的改动 -->\n");
  res = await opIn(proj, { op: "rollback", src: verDir, sha: baselineSha });
  check("版本：有未提交改动时先拒（400 dirty）", res.status === 400 && (await bodyOf(res)).error === "dirty");
  res = await opIn(proj, { op: "rollback", src: verDir, sha: baselineSha, discard: true });
  const rolled = await bodyOf(res);
  const verText = fs.readFileSync(verFile, "utf8");
  check(
    "版本：确认丢掉后回滚 200 且内容恢复成那次提交的样子",
    res.status === 200 && rolled.ok === true && rolled.changed === true && !verText.includes("不要了的改动") && !verText.includes("等一个有意提交"),
    JSON.stringify(rolled).slice(0, 160),
  );
  check(
    "版本：回滚记一条新提交、主题标明退回到哪一版",
    rolled.git.commits.length === 3 &&
      rolled.git.commits[0].subject.startsWith(`回滚到 ${baselineSha.slice(0, 7)}`) &&
      rolled.git.commits[0].subject.includes("初始记录"),
    rolled.git.commits.map((c) => c.subject),
  );
  res = await opIn(proj, { op: "rollback", src: verDir, sha: rolled.git.commits[0].sha });
  check("版本：回滚到当前版本 → 无变化", res.status === 200 && (await bodyOf(res)).changed === false);
  res = await opIn(proj, { op: "rollback", src: verDir, sha: "not-a-sha" });
  check("版本：提交号非法 → 400 rollback-failed", res.status === 400 && (await bodyOf(res)).error === "rollback-failed");

  // 13.5 只管池里的技能：工作区技能不给版本记录
  res = await opIn(proj, { op: "history", src: path.join(proj, ".dsh", "skills", "proj-kit") });
  check("版本：工作区里的技能 → 400 not-in-pool", res.status === 400 && (await bodyOf(res)).error === "not-in-pool");

  // 13.6 池内的写入类操作也不再顺手提交（禁用/启用改的是池里的本体，提交留给人决定）
  const beforeDisable = countCommits(verDir);
  res = await opIn(proj, { op: "disable", src: verDir, disabled: true });
  check("版本：池技能禁用 200", res.status === 200);
  check("版本：禁用这类写入也不自动提交（历史条数不变）", countCommits(verDir) === beforeDisable, countCommits(verDir));
  await opIn(proj, { op: "disable", src: verDir, disabled: false });

  // 13.7 平铺 .md 只当文件（单文件放不了 .git），也不会被当成技能目录
  fs.writeFileSync(path.join(POOL, "flat-ver.md"), "---\nname: flat-ver\ndescription: 平铺版本测试\n---\nbody\n");
  await new Promise((r) => setTimeout(r, 2000));
  check(
    "版本：平铺 .md 只当文件（不给它建仓/建目录）",
    fs.statSync(path.join(POOL, "flat-ver.md")).isFile() && !fs.existsSync(path.join(POOL, "flat-ver")),
  );

  // ── 14) 池的边界：只有移动（复制会让同一个技能出现两份，版本记录也就分叉）──
  const poolKitOf = async (name) => find(await listSkills(), "pool", name);
  const mkLink = (target, linkPath) => {
    fs.symlinkSync(fs.realpathSync(target), linkPath, process.platform === "win32" ? "junction" : "dir");
  };

  // 14.1 没被挂载的池技能挂载数为 0（池里"慢慢没人用"的那一类据此可见）；
  // idle-kit 是直接放进池的——顺带验证这种技能照常枚举
  mkSkillIn(POOL, "", "idle-kit", "没人挂载的池技能");
  check("边界：没人挂载的池技能 mounts=0", (await poolKitOf("idle-kit"))?.mounts === 0, JSON.stringify(await poolKitOf("idle-kit")));

  // 14.2 入池 = 本体进池 + 原地留链接（共用化），进池即有历史
  const inProj = mkProject("dshkit-pool-in-");
  const inKitSrc = mkSkillIn(inProj, ".dsh/skills", "in-kit", "要共用的技能");
  await opIn(inProj, { op: "setcarrier", carrier: "project-agents" });
  await opIn(inProj, { op: "prepare" });
  res = await opIn(inProj, { op: "move", src: inKitSrc, dest: "pool" });
  const movedIn = await bodyOf(res);
  const poolInKit = path.join(POOL, "in-kit");
  check(
    "入池：200 且本体落到池里",
    res.status === 200 && movedIn.ok === true && path.basename(movedIn.dest ?? "") === "in-kit" && fs.existsSync(path.join(poolInKit, "SKILL.md")),
    JSON.stringify(movedIn),
  );
  check("入池：原地那份实体没了（搬走不是复制）", !fs.existsSync(inKitSrc));
  check(
    "入池：原地留下链接指回池本体（工作区继续看得见）",
    typeof movedIn.mounted === "string" && fs.lstatSync(movedIn.mounted).isSymbolicLink() && fs.realpathSync(movedIn.mounted) === fs.realpathSync(poolInKit),
    movedIn.mounted,
  );
  check(
    "入池：进池即有历史（基线已记）",
    fs.existsSync(path.join(poolInKit, ".git")) && countCommits(poolInKit) === 1 && lastSubject(poolInKit) === "auto: 初始记录",
    lastSubject(poolInKit),
  );
  const inRow = find(await listIn(inProj), "workspace", "in-kit");
  check("入池：面板按链接枚举（技能没丢）", inRow?.link === true && inRow?.linkInPool === true, JSON.stringify(inRow));
  check("入池：池组显示被 1 个工作区挂载", (await poolKitOf("in-kit"))?.mounts === 1, JSON.stringify(await poolKitOf("in-kit")));

  // 14.3 复制不再是操作：技能只有移动
  const copyInSrc = mkSkillIn(inProj, ".dsh/skills", "copy-in", "本想复制进池的技能");
  res = await opIn(inProj, { op: "copy", src: copyInSrc, dest: "pool" });
  check("复制已取消：copy → 400 未知操作", res.status === 400 && (await bodyOf(res)).error === "未知操作");
  check("被拒后：源还在、池里没多一份", fs.existsSync(path.join(copyInSrc, "SKILL.md")) && !fs.existsSync(path.join(POOL, "copy-in")));

  // 14.4 平铺 .md 进池：包成同名目录（入口改名 SKILL.md）+ 原地留链接。
  // 池挂不住单个文件，但"入池"这件事得照做——包装是搬运的一部分，不是拒绝的理由
  const flatProj = mkProject("dshkit-pool-flat-");
  const flatSrc = path.join(flatProj, ".dsh", "skills", "flat-in.md");
  fs.mkdirSync(path.dirname(flatSrc), { recursive: true });
  fs.writeFileSync(flatSrc, "---\nname: flat-in\ndescription: 平铺进池\n---\nbody\n");
  await opIn(flatProj, { op: "setcarrier", carrier: "project-agents" });
  await opIn(flatProj, { op: "prepare" });
  res = await opIn(flatProj, { op: "move", src: flatSrc, dest: "pool" });
  const flatIn = await bodyOf(res);
  const flatPoolDir = path.join(POOL, "flat-in");
  check(
    "入池：平铺 .md 包成同名目录（内容原样进 SKILL.md）",
    res.status === 200 && fs.existsSync(path.join(flatPoolDir, "SKILL.md")) && fs.readFileSync(path.join(flatPoolDir, "SKILL.md"), "utf8").includes("平铺进池"),
    JSON.stringify(flatIn),
  );
  check(
    "入池：平铺源文件没了、原地留链接指回池本体",
    !fs.existsSync(flatSrc) && typeof flatIn.mounted === "string" && fs.realpathSync(flatIn.mounted) === fs.realpathSync(flatPoolDir),
    String(flatIn.mounted),
  );
  check("入池：包成的目录照常拿到版本记录（基线已记）", countCommits(flatPoolDir) === 1, lastSubject(flatPoolDir));
  const flatRow = find(await listIn(flatProj), "workspace", "flat-in");
  check("入池：工作区按目录型链接继续看得见", flatRow?.link === true && flatRow?.linkInPool === true, JSON.stringify(flatRow));

  // 14.5 自指拒绝：目标就是源（链接指着另一根里的同名实体）——先删后搬会毁掉本体
  const selfProj = mkProject("dshkit-pool-self-");
  const selfReal = mkSkillIn(selfProj, ".agents/skills", "self-kit", "另一根里的实体");
  const selfLink = path.join(selfProj, ".dsh", "skills", "self-kit");
  fs.mkdirSync(path.dirname(selfLink), { recursive: true });
  mkLink(selfReal, selfLink);
  res = await opIn(selfProj, { op: "move", src: selfLink, dest: "project-agents" });
  check("自指被拒：源与目标同一处 → 400 same-target", res.status === 400 && (await bodyOf(res)).error === "same-target");
  check("自指被拒后：本体完好、链接还在", fs.existsSync(path.join(selfReal, "SKILL.md")) && fs.lstatSync(selfLink).isSymbolicLink());

  // 14.6 出池 = 先断掉所有工作区的挂载链接，再搬本体，且不带版本记录
  const outProj = mkProject("dshkit-pool-out-");
  mkSkillIn(outProj, ".dsh/skills", "out-local", "本地根占位");
  await opIn(outProj, { op: "setcarrier", carrier: "project-agents" });
  await opIn(outProj, { op: "prepare" });
  res = await opIn(outProj, { op: "mount", src: poolInKit });
  const otherLink = (await bodyOf(res)).path;
  check("出池前：第二个工作区也挂上（登记表 2 处）", res.status === 200 && (await poolKitOf("in-kit"))?.mounts === 2, JSON.stringify(await poolKitOf("in-kit")));
  const homeLink = movedIn.mounted;
  res = await opIn(outProj, { op: "move", src: poolInKit, dest: "project-dsh" });
  const movedOut = await bodyOf(res);
  const landed = path.join(outProj, ".dsh", "skills", "in-kit");
  check("出池：200 且本体落到目标根", res.status === 200 && movedOut.ok === true && fs.existsSync(path.join(landed, "SKILL.md")), JSON.stringify(movedOut));
  check("出池：池里那份没了", !fs.existsSync(poolInKit));
  check("出池：别的工作区的链接被断掉（登记表里那处）", movedOut.unmounted?.includes(homeLink) === true && !fs.existsSync(homeLink), JSON.stringify(movedOut.unmounted));
  check("出池：本项目的链接也一并断掉", movedOut.unmounted?.includes(otherLink) === true && !fs.existsSync(otherLink), JSON.stringify(movedOut.unmounted));
  check("出池：副本不带版本记录（项目仓库里不会冒出嵌套仓库）", !fs.existsSync(path.join(landed, ".git")));
  check("出池后：原工作区的枚举里不再有这个技能", !find(await listIn(inProj), "workspace", "in-kit"));

  // 14.7 删除池本体也先断链（不然别的工作区会留下悬空链接）
  const delKit = mkSkillIn(POOL, "", "del-kit", "删除断链测试技能");
  const delProj = mkProject("dshkit-pool-del-");
  await opIn(delProj, { op: "setcarrier", carrier: "project-agents" });
  await opIn(delProj, { op: "prepare" });
  res = await opIn(delProj, { op: "mount", src: delKit });
  const delLink = (await bodyOf(res)).path;
  check("删除前：挂载成功", res.status === 200 && fs.lstatSync(delLink).isSymbolicLink());
  res = await opIn(delProj, { op: "delete", src: delKit });
  const delBody = await bodyOf(res);
  check("删除池本体：200 且报告断掉的链接", res.status === 200 && delBody.unmounted?.includes(delLink) === true, JSON.stringify(delBody));
  check("删除池本体：链接消失、本体消失", !fs.existsSync(delLink) && !fs.existsSync(delKit));
} finally {
  for (const dir of extra) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  // 版本记录 / 边界测试用到的池技能（含各自的 .git）与平铺文件都清掉，别留在 dev 环境的池里
  for (const name of ["ver-kit", "in-kit", "flat-in", "carri-kit", "del-kit", "idle-kit", "flat-ver.md"]) {
    fs.rmSync(path.join(POOL, name), { recursive: true, force: true });
  }
}

console.log(failed === 0 ? "\nALL SKILL-POOL TESTS PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);


