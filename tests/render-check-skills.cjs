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
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false, addEventListener: () => {}, removeEventListener: () => {} };
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
  // memo 只影响重渲染取舍，桩直接透传组件本体
  memo: (component) => component,
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
  Menu: jsxPrim("dsw-menu"),
  IconChevronDownOutlineRegular: jsxPrim("dsw-icon-chevron-down"),
  IconRightUpOutlineRegular: jsxPrim("dsw-icon-right-up"),
  IconFolderOpenOutlineRegular: jsxPrim("dsw-icon-folder-open"),
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
  "skills 导出面齐全（管理页/技能行/池目录按钮/端点调用/探针取值）",
  [comps.SkillsManager, comps.SkillRow, comps.OpenPoolButton, comps.openInAppName, comps.fetchSkillsPage, comps.fetchManagedApps, comps.cfgFromSnapshot].every(
    (fn) => typeof fn === "function",
  ),
);

// —— 池目录的「在应用里打开」：走宿主 open-in-app 路由，且与官方共用同一份记忆 ——
async function checkOpenInApp() {
  // 应用名：官方 open-in-app 词典优先；词典里没有该条目时退回 id（按钮不至于空白）
  const dict = { translate: (ns, key) => (ns === "open-in-app" && key === "app.editor" ? "编辑器" : key) };
  check("应用名取官方 open-in-app 词典", comps.openInAppName("editor", dict) === "编辑器");
  check(
    "词典里没有该条目时退回 id",
    comps.openInAppName("other", dict) === "other" && comps.openInAppName("other", null) === "other",
  );

  // 宿主三路由：可用应用 / 图标 / 启动
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/open-in-app/apps")) {
      return { ok: true, status: 200, json: async () => ({ apps: ["editor", "explorer"] }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const apps = await comps.fetchOpenApps(undefined);
  check("可用应用取宿主 /open-in-app/apps", calls[0].url === "/open-in-app/apps" && apps.length === 2, apps);
  await comps.openDirInApp("editor", "C:/pool");
  const launched = calls[calls.length - 1];
  const sent = JSON.parse(launched.init.body);
  check(
    "启动走宿主 /open-in-app/open（带 app 与目录绝对路径）",
    launched.url === "/open-in-app/open" && sent.app === "editor" && sent.path === "C:/pool",
    sent,
  );

  // Electron 系应用由本组件启动（官方启动器会把宿主进程的 ELECTRON_RUN_AS_NODE 传给子进程，
  // 那种应用会以 node 身份跑）；其余应用仍交回官方路由
  const managedCalls = [];
  global.fetch = async (url, init) => {
    managedCalls.push({ url: String(url), init });
    if (String(url).endsWith("/dsh-kit/skills/open-app")) {
      return { ok: true, status: 200, json: async () => (init && init.method === "POST" ? { ok: true } : { apps: ["editor"] }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const managed = await comps.fetchManagedApps(undefined);
  check(
    "接管的启动器取自宿主 /dsh-kit/skills/open-app",
    managedCalls[0].url === "/dsh-kit/skills/open-app" && managed[0] === "editor",
    JSON.stringify(managed),
  );
  await comps.openDirInApp("editor", "C:/pool");
  const ownLaunch = managedCalls[managedCalls.length - 1];
  check(
    "接管的应用走本组件端点启动（带目录绝对路径）",
    ownLaunch.url === "/dsh-kit/skills/open-app" && JSON.parse(ownLaunch.init.body).path === "C:/pool",
    ownLaunch.url,
  );
  await comps.openDirInApp("explorer", "C:/pool");
  check("未接管的应用仍走宿主官方路由", managedCalls[managedCalls.length - 1].url === "/open-in-app/open");

  // 上次选的应用落在官方同一个 localStorage 键上（会话头部那枚也读它）
  comps.writeOpenAppChoice("editor");
  check("应用选择写在官方同一个键上", String(global.localStorage.getItem("dsh.open-in-app.choice")) === '"editor"');
  check("读回上次选择", comps.readOpenAppChoice() === "editor");
  global.localStorage.setItem("dsh.open-in-app.choice", "{oops");
  check("记录坏掉时按没选过处理（于是回退第一个可用应用）", comps.readOpenAppChoice() === "");

  // 应用图标：走宿主路由，加载失败回落官方图标
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  comps.OpenAppIcon({ id: "editor" });
  check("应用图标走宿主 /open-in-app/icon/<id>", callLog.some((c) => c[1] === "img" && String(c[2].src) === "/open-in-app/icon/editor"));

  // 组件：官方分体按钮 + primitives.Menu 浮层（主键用上次选的应用，当前应用标「默认」）
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  comps.writeOpenAppChoice("explorer");
  const box = comps.OpenPoolButton({ dir: "C:/pool" });
  check("池目录按钮渲染无异常", !!box && typeof box === "object");
  const menu = callLog.find((c) => c[0] === "jsx" && c[1] === primStub.Menu);
  check(
    "走官方 primitives.Menu（浮层、贴右端、紧凑），锚点是官方同款分体按钮",
    !!menu && menu[2].portal === true && menu[2].align === "end" && menu[2].dense === true &&
      !!menu[2].anchor && menu[2].anchor.props.className === "dshk-sk-split",
  );
  const items = menu ? menu[2].items : [];
  check(
    "菜单项：图标 + 应用名（当前应用标「默认」）",
    items.length === 2 &&
      items.every((it) => it.icon && it.icon.props && typeof it.icon.props.id === "string") &&
      items.some((it) => it.icon.props.id === "explorer" && /(默认|default)/i.test(String(it.label))) &&
      items.some((it) => it.icon.props.id === "editor" && !/(默认|default)/i.test(String(it.label))),
  );
  check("chevron 用官方图标（不是文字 ▾）", callLog.some((c) => c[1] === primStub.IconChevronDownOutlineRegular));
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
  check("池技能行：没有复制（技能一律只移动）", !btn(["复制", "Copy"]));
  check("池技能行：被工作区挂着时不给移动（要移出先让各挂载方卸载）", !btn(["移动", "Move"]));
  check("池技能行：挂载数可见（被几个工作区挂着）", textOf(/^(挂载|Mounted in) 2$/));
  check("池技能行：不再有版本入口（历史改在本机应用里看）", !btn(["版本", "Versions"]));

  // 没人挂的池技能仍可移动；moveAsk 是 SkillRow 的第二个 useState（id 1）：直接喂出确认态
  // （序号跟行内状态数走——详情展开退场后前移了一位，再加行内状态先改这里）
  const poolFree = { ...poolSkill, mounts: 0 };
  renderRow(poolFree, "pool");
  check("没人挂的池技能：给移动", !!btn(["移动", "Move"]));
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  stateStore.set(1, { dest: "project-dsh" });
  comps.SkillRow({ skill: poolFree, groupId: "pool", allRoots: ROOTS, cwd: "C:/x", busy: false, runOp: () => {}, picker: null, setPicker: () => {} });
  check(
    "池技能行：移出池前要确认（说清池里不再有它、版本记录不跟走）",
    textOf(/移出技能池|Move out of the skill pool/) && textOf(/池里不再有它|leaves the pool/) && textOf(/版本记录也不会跟着走|version history kept there/) && !!btn(["确认移动", "Confirm move"]),
  );

  const linkSkill = { name: "hi", root: "project-agents", path: "C:/x/.agents/skills/hi", link: true, linkInPool: true };
  renderRow(linkSkill, "workspace");
  check(
    "池挂载链接行：不给移动（要动先卸载）、不给复制、不给禁用，另给卸载",
    !btn(["移动", "Move"]) && !btn(["复制", "Copy"]) && !btn(["禁用", "Disable"]) && !!btn(["卸载", "Unmount"]),
  );

  renderRow({ name: "local", root: "project-dsh", path: "C:/x/.dsh/skills/local" }, "workspace");
  check("非池实体行：给移动、没有复制（技能一律只移动）", !!btn(["移动", "Move"]) && !btn(["复制", "Copy"]));
  check("非池实体行：也没有版本入口（只有池里的技能各自带仓库）", !btn(["版本", "Versions"]));

  // 进池方向同样先确认（本体交出去共用 / 用户级来源不再全局可见）
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  stateStore.set(1, { dest: "pool" });
  comps.SkillRow({ skill: { name: "local", root: "project-dsh", path: "C:/x/.dsh/skills/local" }, groupId: "workspace", allRoots: ROOTS, cwd: "C:/x", busy: false, runOp: () => {}, picker: null, setPicker: () => {} });
  check("进池前要确认（本体进池共用、本工作区留链接）", textOf(/移入技能池|Move into the skill pool/) && textOf(/自动挂回来|link back/));

  // 平铺 .md 进池：宿主会包成同名目录，确认条上要先把这件事说出来
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  stateStore.set(1, { dest: "pool" });
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
  // 套件没有根入口模块：查的是「技能的字段没渗进别的组件行」
  const hostSrc = ["browser", "chat", "files", "logs", "monitor", "phone", "search", "terminal"]
    .map((d) => fs.readFileSync(__dirname + "/../src/" + d + "/index.ts", "utf8")).join("\n");
  const compSrc = fs.readFileSync(__dirname + "/../src/skills/index.ts", "utf8");
  const poolSrc = fs.readFileSync(__dirname + "/../src/skills/skill-pool.ts", "utf8");
  check("技能无独立配置字段（别的组件行与 client 默认表都不再出现 skillsPageEnabled）", !hostSrc.includes("skillsPageEnabled") && !bundleSrc.includes("skillsPageEnabled"));
  check("组件入口挂技能池端点与行可达性探针", compSrc.includes("applySkillPool") && compSrc.includes("/dsh-kit-skills/config"));
  check("技能页样式随组件自带（.dshk-sk 只在组件 CSS 块出现一次）", bundleSrc.includes("SKS_CSS") && bundleSrc.split(".dshk-sk{").length - 1 === 1);
  check(
    "池目录按钮走宿主 open-in-app 三路由，选择写官方同一个键",
    bundleSrc.includes('"/open-in-app/apps"') &&
      bundleSrc.includes("/open-in-app/icon/") &&
      bundleSrc.includes('"/open-in-app/open"') &&
      bundleSrc.includes('"dsh.open-in-app.choice"'),
  );
  check("一个应用都没探到时不摆按钮", bundleSrc.includes('if (app === "") return null;'));
  const appLaunchSrc = fs.readFileSync(__dirname + "/../src/skills/app-launch.ts", "utf8");
  const envSrc = fs.readFileSync(__dirname + "/../src/core/subprocess-env.ts", "utf8");
  check(
    "接管的应用自己找启动器、子进程环境走公共清洗（摘掉 Electron 标记，不碰宿主环境）",
    appLaunchSrc.includes("scrubbedChildEnv") &&
      appLaunchSrc.includes("App Paths") &&
      appLaunchSrc.includes("managedAppIds") &&
      envSrc.includes("ELECTRON_RUN_AS_NODE") &&
      poolSrc.includes("/dsh-kit/skills/open-app") &&
      !envSrc.includes("process.env.ELECTRON_RUN_AS_NODE = "),
  );
  check(
    "版本面板整体退场（客户端组件与宿主 history/commit/rollback 都不在）",
    !bundleSrc.includes("SkillGitPanel") &&
      !poolSrc.includes("poolGitState") &&
      !poolSrc.includes("body.op === 'history'") &&
      !poolSrc.includes("poolGitCommit"),
  );
  check("技能只有移动（源里没有复制按钮/词条，宿主不再认 copy 操作）", !bundleSrc.includes("skCopy") && poolSrc.includes("body.op === 'move'") && !poolSrc.includes("body.op === 'copy'"));
  check(
    "技能行详情展开已退役（要看 SKILL.md 全文直接开文件）",
    !bundleSrc.includes("SkillContent") && !bundleSrc.includes("dshk-sk-detail") && !bundleSrc.includes("dshk-sk-pre") && !bundleSrc.includes("skView"),
  );
  check("平铺 .md 进池：包成同名目录再挂回来（池挂不住单个文件）", poolSrc.includes("const wrap = destRoot.id === 'pool' && flatMd") && !poolSrc.includes("'flat-skill'"));
  check("池行显示挂载数（宿主列表带 mounts）", bundleSrc.includes("skill.mounts") && poolSrc.includes("mountCounts[path.basename(skill.path)]"));
  check(
    "池里的 git 归技能自己：插件不建仓、不记基线、不写身份",
    !fs.existsSync(__dirname + "/../src/skills/pool-git.ts") &&
      !compSrc.includes("ensurePoolBaseline") &&
      !poolSrc.includes("ensurePoolBaseline") &&
      !poolSrc.includes("auto: 初始记录"),
  );
  check("出池不带版本记录（.git 不进工作区根）与断链登记表都在宿主", poolSrc.includes("detachPoolLinks") && poolSrc.includes("skipRepo"));
  const mountSrc = fs.readFileSync(__dirname + "/../src/skills/mount.ts", "utf8");
  check(
    "挂载点只由用户选（没选就问，不带哪根在用的启发式、不默认）",
    mountSrc.includes("const carrier = readPolicy().projects[dirs.projectRoot]?.carrier ?? null") &&
      mountSrc.includes("needsChoice: carrier === null") &&
      !mountSrc.includes("linkedCarrier") &&
      !mountSrc.includes("poolLinks"),
  );
  check(
    "选定后一切挂载都去那儿（选定即处理到可挂载，没有独立体检与半处理状态）",
    mountSrc.includes("export function setCarrier") &&
      mountSrc.includes("export async function prepareCarrier") &&
      !mountSrc.includes("mountPrecondition") &&
      !mountSrc.includes("resolve === 'move'"),
  );
}

checkOpenInApp().then(checkEndpoint).then(checkApply).then(() => {
  console.log(failed === 0 ? "\nALL PASS (render-check skills)" : "FAILED: " + failed);
  process.exit(failed === 0 ? 0 : 1);
});
