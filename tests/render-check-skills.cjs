// dsh-kit/skills 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、技能管理页渲染、配置探针门控与宿主半边源哨兵。
// 组件 = 单包内模块（root client 的 exports.skills），无独立 bundle。
// 用法（dsh-kit 根）：node tests\render-check-skills.cjs
const fs = require("node:fs");

let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };

// 浏览器全局最小桩（与根 render-check 同口径）
if (!global.localStorage) {
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(String(k), String(v)), removeItem: (k) => store.delete(k) };
}
if (!global.document) {
  global.document = {
    visibilityState: "visible",
    documentElement: { lang: "" },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ className: "", textContent: "", dataset: {}, setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {}, firstElementChild: null, replaceWith: () => {} }),
    head: { appendChild: () => {} },
    body: { classList: { add() {}, remove() {} }, appendChild: () => {}, hasAttribute: () => false },
  };
}
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false };
if (!global.location) global.location = { protocol: "http:", host: "127.0.0.1:3081" };
if (!global.MutationObserver) global.MutationObserver = class { observe() {} };
if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} disconnect() {} };

const loadBundle = (path, requireMap) => {
  const src = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("factory: (require) => {");
  if (start < 0) throw new Error("no factory: " + path);
  const tail = src.lastIndexOf("  },\n});");
  const body = src.slice(start + "factory: (require) => {".length, tail);
  return new Function("require", body)(requireMap);
};

// react hooks 桩
let callLog = [];
const stateStore = new Map();
let stateSeq = 0;
const reactStub = {
  useState: (init) => {
    const id = stateSeq++;
    if (!stateStore.has(id)) stateStore.set(id, typeof init === "function" ? init() : init);
    const set = (v) => stateStore.set(id, typeof v === "function" ? v(stateStore.get(id)) : v);
    return [stateStore.get(id), set];
  },
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  useMemo: (fn) => fn(),
  useSyncExternalStore: (subscribe, getSnapshot) => { subscribe(() => {}); return getSnapshot(); },
  cloneElement: (el, props) => ({ ...el, props: { ...el.props, ...props } }),
  Fragment: function Fragment() {},
};
const jsxRuntimeStub = {
  Fragment: function Fragment() {},
  jsx: (type, props) => { callLog.push(["jsx", type, props]); return { type, props, $$dshk: "jsx" }; },
  jsxs: (type, props) => { callLog.push(["jsxs", type, props]); return { type, props, $$dshk: "jsxs" }; },
};
const jsxPrim = (tag) => (props) => jsxRuntimeStub.jsxs(tag, props);
const primStub = {
  SettingsForm: jsxPrim("dsw-settings-form"),
  SettingsValueField: jsxPrim("dsw-settings-field"),
  Switch: jsxPrim("dsw-switch"),
  SegmentedTabs: jsxPrim("dsw-segmented-tabs"),
  Tag: jsxPrim("dsw-tag"),
  Tooltip: jsxPrim("dsw-tooltip"),
};
const requireMap = (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return { createPortal: (children) => ({ type: "portal", props: { children }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
};

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.skills
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.skills;

check("skills 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "skills 导出面齐全（管理页/技能行/版本面板/端点调用/探针取值）",
  [comps.SkillsManager, comps.SkillRow, comps.SkillGitPanel, comps.fetchSkillsPage, comps.cfgFromSnapshot].every((fn) => typeof fn === "function"),
);

// —— 版本面板（池技能）：状态行 + 写提交信息记一版 + 提交列表 + 看改动 + 回滚 ——
{
  // diff 正文座是文件组件物化期挂的；这里手工摆上，验证"文件片点开看改动"这条接线
  dockExports.diffPane.Component = function FakeDiff() {};
  const nowSec = Math.floor(Date.now() / 1000);
  const shaA = "abcdef1234567890abcdef1234567890abcdef12";
  const shaB = "1234567890abcdef1234567890abcdef12345678";
  const fakeGit = {
    available: true,
    init: true,
    dirty: 1,
    dirtyNames: ["SKILL.md"],
    last: { sha: shaA, short: "abcdef1", time: nowSec - 120, subject: "改进：把触发条件写清楚" },
    commits: [
      { sha: shaA, short: "abcdef1", time: nowSec - 120, subject: "改进：把触发条件写清楚", files: 1, insertions: 2, deletions: 1, names: ["SKILL.md"] },
      { sha: shaB, short: "1234567", time: nowSec - 86400 * 2, subject: "auto: 初始记录", files: 2, insertions: 5, deletions: 0, names: ["SKILL.md", "references/a.md"] },
    ],
  };
  const renderPanel = (seed) => {
    stateSeq = 0;
    stateStore.clear();
    callLog = [];
    stateStore.set(0, fakeGit); // SkillGitPanel 的第一个 useState 就是版本状态
    for (const [id, value] of Object.entries(seed ?? {})) stateStore.set(Number(id), value);
    return comps.SkillGitPanel({ skill: { path: "C:/pool/hello-kit" }, cwd: "C:/x" });
  };
  const btn = (labels) => callLog.find((c) => c[0] === "jsx" && c[1] === "button" && labels.includes(c[2].children));
  const textOf = (re) => callLog.some((c) => typeof c[2]?.children === "string" && re.test(c[2].children));

  const panel = renderPanel();
  check("版本面板渲染无异常", !!panel && typeof panel === "object");
  check(
    "版本面板：状态行含已记录 / 上次提交 / 未提交改动",
    textOf(/已记录 2|commits 2/) && textOf(/未提交|uncommitted/),
    JSON.stringify(callLog.filter((c) => c[2] && c[2].className === "dshk-sk-desc").map((c) => c[2].children)),
  );
  const shas = callLog.filter((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-sk-sha").map((c) => c[2].children);
  check("版本面板：逐条列出提交（提交号）", shas.length === 2 && shas[0] === "abcdef1" && shas[1] === "1234567", shas);
  check("版本面板：提交主题直显（人写的，不再是机器空话）", textOf(/改进：把触发条件写清楚/) && textOf(/auto: 初始记录/));
  check("版本面板：给出「记一版」入口（提交信息由人写）", !!btn(["记一版", "Record"]));
  check("版本面板：回滚钮在（二次确认在点击后）", !!btn(["回滚", "Roll back"]));
  const files = callLog.filter((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-sk-file").map((c) => c[2].children);
  check("版本面板：每次提交列出改动文件（可点开看改动）", files.includes("SKILL.md") && files.includes("references/a.md"), files);

  // composing（第 5 个 useState）＝ 输入态：给提交信息框 + 提交钮
  renderPanel({ 4: true, 5: "改进：xxx" });
  const input = callLog.find((c) => c[0] === "jsx" && c[1] === "input" && c[2].className === "dshk-sk-input");
  check("版本面板：输入态给提交信息框（初值回显）", !!input && input[2].value === "改进：xxx");
  check("版本面板：输入态给提交钮", !!btn(["提交", "Commit"]));

  // confirmSha（第 7 个 useState）＝ 二次确认态
  renderPanel({ 6: shaA });
  check("版本面板：回滚二次确认（确认回滚？）", !!btn(["确认回滚？", "Confirm rollback?"]));

  // pick（第 8 个 useState）＝ 展开某次提交里某个文件的 diff
  renderPanel({ 7: { sha: shaA, name: "SKILL.md" } });
  const box = callLog.find((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-sk-diffbox");
  check("版本面板：点文件展开该次提交的 diff（走 diff 座）", !!box && box[2].children.type === dockExports.diffPane.Component);
}

// —— 技能管理页渲染：无 cwd 与有 cwd；头部刷新走官方气泡 ——
{
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  let out = comps.SkillsManager({});
  check("SkillsManager 无hooks渲染无异常（无会话工作区提示）", !!out && typeof out === "object");
  const refreshTip = callLog.find((c) => c[0] === "jsx" && c[1] === dockExports.KitTip);
  check("头部刷新钮走官方气泡（刷新/Refresh）", !!refreshTip && ["刷新", "Refresh"].includes(refreshTip[2].label));
  const title = callLog.find((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-sk-title");
  check("页标题用本组件词条（技能/Skills）", !!title && ["技能", "Skills"].includes(title[2].children));

  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const fakeHooks = { useSessions: (sel) => sel({ byId: { s1: { id: "s1", cwd: "C:/x", retainedBy: { mainView: 1 } } } }) };
  out = comps.SkillsManager(fakeHooks);
  check("SkillsManager 带cwd渲染无异常", !!out && typeof out === "object");
}

// —— 探针取值：未探明乐观可用；404 不可用；200 可用 ——
check(
  "cfgFromSnapshot：未探明乐观可用、404 不可用、就绪可用",
  comps.cfgFromSnapshot(null).available === true && comps.cfgFromSnapshot({ status: "unavailable" }).available === false && comps.cfgFromSnapshot({ status: "ready" }).available === true,
);

// —— 技能行的动作面：一律只有移动（复制会让副本与本体分叉）+ 挂载数 + 移动前确认 ——
{
  const ROOTS = [
    { id: "project-dsh", dir: "C:/x/.dsh/skills" },
    { id: "project-agents", dir: "C:/x/.agents/skills" },
    { id: "user-dsh", dir: "C:/home/.dsh/skills" },
  ];
  const renderRow = (skill, groupId) => {
    stateSeq = 0;
    stateStore.clear();
    callLog = [];
    return comps.SkillRow({ skill, groupId, allRoots: ROOTS, cwd: "C:/x", busy: false, runOp: () => {}, picker: null, setPicker: () => {} });
  };
  const btn = (labels) => callLog.find((c) => c[0] === "jsx" && c[1] === "button" && labels.includes(c[2].children));
  const textOf = (re) => callLog.some((c) => typeof c[2]?.children === "string" && re.test(c[2].children));

  const poolSkill = { name: "hello-kit", root: "pool", path: "C:/home/.dsh/skill-pool/hello-kit", mounts: 2, description: "共享技能" };
  const row = renderRow(poolSkill, "pool");
  check("池技能行渲染无异常", !!row && typeof row === "object");
  check("池技能行：只有移动、没有复制", !btn(["复制", "Copy"]) && !!btn(["移动", "Move"]));
  check("池技能行：挂载数可见（被几个工作区挂着）", textOf(/^(挂载|Mounted in) 2$/));
  check("池技能行：给「版本」入口（历史 + 写提交信息）", !!btn(["版本", "Versions"]));

  // moveAsk 是 SkillRow 的第三个 useState（id 2）：直接喂出确认态
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  stateStore.set(2, { dest: "project-dsh" });
  comps.SkillRow({ skill: poolSkill, groupId: "pool", allRoots: ROOTS, cwd: "C:/x", busy: false, runOp: () => {}, picker: null, setPicker: () => {} });
  check(
    "池技能行：移出池前要确认（说清会断掉别的工作区的链接）",
    textOf(/移出技能池|Move out of the skill pool/) && textOf(/别的工作区不再有它|other workspaces lose it/) && !!btn(["确认移动", "Confirm move"]),
  );

  const linkSkill = { name: "hi", root: "project-agents", path: "C:/x/.agents/skills/hi", link: true, linkInPool: true };
  renderRow(linkSkill, "workspace");
  check("池挂载链接行：只有移动（不给复制、不给禁用），另给卸载", !btn(["复制", "Copy"]) && !btn(["禁用", "Disable"]) && !!btn(["卸载", "Unmount"]));

  renderRow({ name: "local", root: "project-dsh", path: "C:/x/.dsh/skills/local" }, "workspace");
  check("非池实体行：也没有复制（技能一律只移动）", !btn(["复制", "Copy"]));
  check("非池实体行：不给版本入口（版本记录只给池里的技能）", !btn(["版本", "Versions"]));

  // 进池方向同样先确认（本体交出去共用 / 用户级来源不再全局可见）
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  stateStore.set(2, { dest: "pool" });
  comps.SkillRow({ skill: { name: "local", root: "project-dsh", path: "C:/x/.dsh/skills/local" }, groupId: "workspace", allRoots: ROOTS, cwd: "C:/x", busy: false, runOp: () => {}, picker: null, setPicker: () => {} });
  check("进池前要确认（本体进池共用、本工作区留链接）", textOf(/移入技能池|Move into the skill pool/) && textOf(/自动挂回来|link back/));

  // 平铺 .md 进池：宿主会包成同名目录，确认条上要先把这件事说出来
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  stateStore.set(2, { dest: "pool" });
  comps.SkillRow({ skill: { name: "flat", root: "project-dsh", path: "C:/x/.dsh/skills/flat.md", kind: "file" }, groupId: "workspace", allRoots: ROOTS, cwd: "C:/x", busy: false, runOp: () => {}, picker: null, setPicker: () => {} });
  check("平铺入池前提示包成目录", textOf(/包成同名目录|wrapped into a same-name directory/));
}

// —— 端点调用：cwd 查询串 ——
async function checkEndpoint() {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ groups: [] }) };
  };
  await comps.fetchSkillsPage("C:/x", undefined);
  await comps.fetchSkillsPage("", undefined);
  check("fetchSkillsPage 命中组件宿主端点并带 cwd", urls[0] === "/dsh-kit/skills?cwd=C%3A%2Fx" && urls[1] === "/dsh-kit/skills");
}

// —— apply：行可达性探针 + settings.section 注册（无 plugins.row.config）——
async function checkApply() {
  const makeCtx = () => {
    const seats = [];
    const seatInjects = [];
    return {
      seats,
      seatInjects,
      ctx: {
        slots: {
          register: (seat) => {
            seats.push(seat);
            return () => { const i = seats.indexOf(seat); if (i >= 0) seats.splice(i, 1); };
          },
          inject: (key, cb) => { seatInjects.push(key); cb(); },
        },
        inject: () => {},
        effect: () => {},
      },
    };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  let scripted = {};
  let failFetch = false;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (failFetch) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => scripted };
  };

  // 行启用：探针 200 → 设置页注册；座席经 slots.inject 等声明
  const a = makeCtx();
  let applyErr = null;
  try { await comps.apply(a.ctx); await tick(); } catch (e) { applyErr = e; }
  check("skills apply 激活不抛错", applyErr === null);
  check("apply 拉自家探针端点喂门控", calls.includes("/dsh-kit-skills/config"));
  const seat = a.seats.find((s) => s.name === "settings.section" && s.id === "kit-skills");
  check(
    "行启用：settings.section 注册（order 40、标签技能/Skills），无插件配置页",
    !!seat && seat.order === 40 && typeof seat.label === "function" && ["技能", "Skills"].includes(seat.label()) && a.seats.every((s) => s.name !== "plugins.row.config"),
  );
  check("槽位经 slots.inject 等声明落地（不直接 register）", a.seatInjects.filter((k) => k === "settings.section").length === 1);

  // 行禁用：探针 404 → 乐观注册后被注销，导航里不留死页
  const fresh = loadBundle(__dirname + "/../client/bundle.js", requireMap).skills;
  const b = makeCtx();
  failFetch = true;
  await fresh.apply(b.ctx);
  await tick();
  check("行禁用（探针 404）：设置页最终不注册（乐观注册被撤回）", b.seats.every((s) => s.name !== "settings.section"));
}

// —— 宿主半边源哨兵：行开关 = 唯一开关（无独立配置字段），探针在组件入口 ——
{
  const bundleSrc = fs.readFileSync(__dirname + "/../client/bundle.js", "utf8");
  const hostSrc = fs.readFileSync(__dirname + "/../src/index.ts", "utf8");
  const compSrc = fs.readFileSync(__dirname + "/../src/skills/index.ts", "utf8");
  const poolSrc = fs.readFileSync(__dirname + "/../src/skills/skill-pool.ts", "utf8");
  check("技能无独立配置字段（主包 schema/配置页/client 默认表都不再出现 skillsPageEnabled）", !hostSrc.includes("skillsPageEnabled") && !bundleSrc.includes("skillsPageEnabled"));
  check("组件入口挂技能池端点与行可达性探针", compSrc.includes("applySkillPool") && compSrc.includes("/dsh-kit-skills/config"));
  check("技能页样式随组件自带（.dshk-sk 只在组件 CSS 块出现一次）", bundleSrc.includes("SKS_CSS") && bundleSrc.split(".dshk-sk{").length - 1 === 1);
  check(
    "版本面板走宿主版本端点（history/commit/rollback，提交带 message、回滚带 discard）",
    ["history", "commit", "rollback"].every((op) => bundleSrc.includes(`op: "${op}"`)) &&
      bundleSrc.includes("message }") &&
      bundleSrc.includes("discard: discard === true"),
  );
  check("版本入口只挂在池技能行（工作区/用户级行不给）", bundleSrc.includes("isPool && gitOpen"));
  check("技能只有移动（源里没有复制按钮/词条，宿主不再认 copy 操作）", !bundleSrc.includes("skCopy") && poolSrc.includes("body.op === 'move'") && !poolSrc.includes("body.op === 'copy'"));
  check("平铺 .md 进池：包成同名目录再挂回来（池挂不住单个文件）", poolSrc.includes("const wrap = destRoot.id === 'pool' && flatMd") && !poolSrc.includes("'flat-skill'"));
  check("池行显示挂载数（宿主列表带 mounts）", bundleSrc.includes("skill.mounts") && poolSrc.includes("mountCounts[path.basename(skill.path)]"));
  const poolGitSrc = fs.readFileSync(__dirname + "/../src/skills/pool-git.ts", "utf8");
  check("池版本记录：只给池里的技能做（组件入口按池目录补基线）", compSrc.includes("ensurePoolBaselines(defaultPoolDir())"));
  check("池版本记录：身份只写技能自己的仓库、基线主题写明初始记录", poolGitSrc.includes("'config', '--local'") && poolGitSrc.includes("'auto: 初始记录'"));
  check("池版本记录：不做自动提交、不挂 fs.watch（提交是有意识动作）", !poolGitSrc.includes("fs.watch") && !poolGitSrc.includes("'auto: 同步技能内容'"));
  check("出池不带版本记录（.git 不进工作区根）与断链登记表都在宿主", poolSrc.includes("detachPoolLinks") && poolSrc.includes("skipRepo"));
  const mountSrc = fs.readFileSync(__dirname + "/../src/skills/mount.ts", "utf8");
  check(
    "挂载点只由用户选（没选就问，不带哪根在用的启发式、不默认）",
    mountSrc.includes("const carrier = readPolicy().projects[dirs.projectRoot]?.carrier ?? null") &&
      mountSrc.includes("needsChoice: carrier === null") &&
      !mountSrc.includes("linkedCarrier") &&
      !mountSrc.includes("poolLinks"),
  );
  check("选定后一切挂载都去那儿（另一根只当搬出载体根时的落点）", mountSrc.includes("state.otherDir") && mountSrc.includes("export function setCarrier"));
}

checkEndpoint().then(checkApply).then(() => {
  console.log(failed === 0 ? "\nALL PASS (render-check skills)" : "FAILED: " + failed);
  process.exit(failed === 0 ? 0 : 1);
});
