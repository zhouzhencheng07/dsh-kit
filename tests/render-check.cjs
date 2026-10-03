// 渲染级验证：桩掉 react hooks，直接函数调用 dsh-kit 的组件
// （KitSurfaces/FilePaneBody/TreeRowMenu 等根侧渲染体），跑完整渲染体。
// 组件各自的分册在 tests\render-check-<组件>.cjs（comps = dockExports.<组件>）。
// 知识库/日程的行为级检查留在本文件：harness 末尾把 exports.vault 并进 comps，
// 直测的就是组件里那一份代码（VaultRootView/VaultPagePane/ScheduleView/纯函数）；
// 组件契约与装配门控另见 tests\render-check-vault.cjs。
// ⚠️ 盲区：桩不会重渲染（effect 不执行、state 不更新），依赖 effect 产出后才走到的
// 渲染分支（如 FileTreePanel 的 entries.map 行）覆盖不到——残留变量藏在那种行里会
// 逃过本检查。可疑残留请配合全文扫描排查。
// 用法：从 dsh-kit 根运行：node tests\render-check.cjs client\bundle.js
const fs = require("node:fs");
// 归一化行尾：git autocrlf 检出后文件可能是 CRLF，切片标记按 LF 匹配才稳定
const src = fs.readFileSync(process.argv[2], "utf8").replace(/\r\n/g, "\n");

// 1) 抽出 factory 体
const factoryStart = src.indexOf("factory: (require) => {");
if (factoryStart < 0) { console.log("FATAL: no factory"); process.exit(2); }
const factorySrc = src.slice(factoryStart + "factory: (require) => {".length);
// factory 结尾是 "    },\n  },\n});" 前的 "}"。找最后一个 "  },\n});" 模式。
const tail = factorySrc.lastIndexOf("  },\n});");
const body = factorySrc.slice(0, tail);

// 2) 桩出 react / jsx-runtime 与 window
let callLog = [];
const stateStore = new Map();
let stateSeq = 0;
const reactStub = {
  useState: (init) => {
    const id = stateSeq++;
    // 惰性初始化器与 React 同语义（函数参 = 惰性求值；存函数状态需包一层）
    if (!stateStore.has(id)) stateStore.set(id, typeof init === "function" ? init() : init);
    const set = (v) => stateStore.set(id, typeof v === "function" ? v(stateStore.get(id)) : v);
    return [stateStore.get(id), set];
  },
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  useMemo: (fn) => fn(),
  // subscribe 真调用（上下文无关调用——方法解引用传参导致的 this 丢失在此暴露）
  useSyncExternalStore: (subscribe, getSnapshot) => { subscribe(() => {}); return getSnapshot(); },
  // KitTip 用 cloneElement 往锚点补 aria-label/aria-keyshortcuts（官方 Tooltip 的锚点形状）
  cloneElement: (el, props) => ({ ...el, props: { ...el.props, ...props } }),
  // memo 只影响重渲染取舍，桩直接透传组件本体（渲染级检查只关心「渲染体能不能跑完」）
  memo: (component) => component,
  Fragment: function Fragment() {},
};
// 与宿主同签名：jsx(type, props, key)——第三参是 **key 不是 children**。桩若把第三参
// 当 children，children 放错位置的错误就查不出来（页盒全丢而 render-check 全绿）
const jsxRuntimeStub = {
  Fragment: function Fragment() {},
  jsx: (type, props, key) => { callLog.push(["jsx", type, props, key]); return { type, props: key === undefined ? props : { ...props, key }, $$dshk: "jsx" }; },
  jsxs: (type, props, key) => { callLog.push(["jsxs", type, props, key]); return { type, props: key === undefined ? props : { ...props, key }, $$dshk: "jsxs" }; },
};
// 官方表单原语桩：配置页渲染走宿主 primitives（SettingsForm/SettingsValueField/
// Switch/SegmentedTabs/Tag）。桩环境不执行组件函数体，jsx 记下的 type 就是函数
// 本身——断言按 primStub.<名> 的函数引用匹配 callLog，props 层打点（组件内部
// 行为归宿主自己的测试管）。
const jsxPrim = (tag) => (props) => jsxRuntimeStub.jsxs(tag, props);
const primStub = {
  SettingsForm: jsxPrim("dsw-settings-form"),
  SettingsValueField: jsxPrim("dsw-settings-field"),
  Switch: jsxPrim("dsw-switch"),
  SegmentedTabs: jsxPrim("dsw-segmented-tabs"),
  Tag: jsxPrim("dsw-tag"),
  // 悬停气泡：官方 primitives 的 Tooltip（KitTip 有它就走官方气泡，没有才回原生 title）
  Tooltip: jsxPrim("dsw-tooltip"),
};
const windowStub = {
  __ModuleLoader__: { load: () => { /* noop */ } },
};
// 宽度模型持久化走 localStorage；Node 无此全局，补最小桩（内存版）
if (!global.localStorage) {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(k),
  };
}
// Node 无浏览器全局，浏览器面板组件的渲染体直接读 document/location/window——
// 渲染检查补最小桩（真实运行在浏览器里天然存在）
if (!global.document) {
  // createElement/appendChild：flashToast 会建一个提示元素（关闭/结束失败时走这里）
  global.document = {
    visibilityState: "visible",
    // 记下挂过的监听器：hookGlobal 的幂等性要靠它数（apply 重入不得叠加监听器）
    __listeners: [],
    addEventListener: (type, fn, opts) => { global.document.__listeners.push({ type, fn, capture: !!(opts && opts.capture) }); },
    removeEventListener: () => {},
    createElement: () => ({ className: "", textContent: "", setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {} }),
    head: { appendChild: () => {} },
    body: { classList: { add() {}, remove() {} }, appendChild: () => {} },
  };
}
if (!global.window) {
  // addEventListener：client 半边在 factory 里注册全局 error / unhandledrejection
  // 兜底（把浏览器侧的异常回传宿主日志），桩缺它会直接抛。
  global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
}
if (!global.location) {
  global.location = { protocol: "http:", host: "127.0.0.1:3081" };
}

// 2.5) 共享底座（kitBase）已内联进根包 factory：随本检查一并执行（CSS 注入等
//      副作用照跑），导出面直接落在根包 exports 上——断言见 comps 加载之后

// 3) 组装可执行的 factory 闭包，并导出组件（替换防 early-return）；
//    setKitUi 用于预置面板状态等依赖状态的渲染分支。
//    根 return 必须取最后一处：files/terminal 组件模块体内各有
//    一个自己的 return module.exports，replace 首处会把 factory 提前截断在组件段。
const RETURN = "return module.exports;";
const rootReturn = body.lastIndexOf(RETURN);
if (rootReturn < 0) { console.log("FATAL: no root return"); process.exit(2); }
const wrapper = body.slice(0, rootReturn) +
  "return Object.assign({ KitSurfaces, TreeRowMenu, closeFeatureTab, sidebarViewPatch, kitGetJson, kitPostJson, kitJson, getKitUi, setKitUi, FilePaneBody, openFileAndDock, closeRightbarTab, openOfficialFile, openTreeFile }, kitBase, exports.vault, exports.phone);" +
  body.slice(rootReturn + RETURN.length);
const harness = new Function("require", wrapper);
const reactDomStub = {
  createPortal: (children, container, key) => { callLog.push(["portal", children, container, key]); return { type: "portal", props: { children, container, key }, $$dshk: "portal" }; },
};
// 计时悬浮球挂的是全局根（不进槽位），走 react-dom/client 的 createRoot
const reactDomClientStub = { createRoot: () => ({ render: () => {} }) };
const comps = harness((name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return reactDomStub;
  if (name === "react-dom/client") return reactDomClientStub;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected require: " + name);
});

// 共享底座（kitBase）导出面：已内联进根包 factory，直接落在 comps 上
const baseOk = [comps.kitGetJson, comps.kitPostJson, comps.kitJson, comps.flashToast, comps.writeClipboard, comps.mainRowOf, comps.createConfigPage, comps.setKitUi, comps.getKitUi, comps.subscribeLocale, comps.KitTip, comps.attachShortcutCatalog].every(
  (fn) => typeof fn === "function",
);
console.log((baseOk ? "PASS  " : "FAIL  ") + "底座共享面齐全（kit 三件套/轻提示/剪贴板/mainRowOf/createConfigPage/kitUi/locale store/官方气泡与键位镜像）");
if (!baseOk) process.exitCode = 1;

// 全局监听幂等：apply 会因配置热提交 / 插件热更新重入，裸 addEventListener 会一次次
// 叠加（点一次链接开 N 张标签页就是这么来的）。hookGlobal 重入只换实现、不再挂。
{
  const doc = global.document;
  const before = doc.__listeners.length;
  let first = 0;
  let second = 0;
  comps.hookGlobal(doc, "probe", "click", () => { first += 1; }, true);
  const afterFirst = doc.__listeners.length - before;
  comps.hookGlobal(doc, "probe", "click", () => { second += 1; }, true);
  comps.hookGlobal(doc, "probe", "click", () => { second += 1; }, true);
  const afterRepeat = doc.__listeners.length - before;
  const installed = doc.__listeners[doc.__listeners.length - 1];
  installed.fn({ type: "click" });
  // 调一次只应命中**当前**实现：旧实现被换掉，不会各跑一遍
  const ok = afterFirst === 1 && afterRepeat === 1 && first === 0 && second === 1;
  console.log((ok ? "PASS  " : "FAIL  ") + `hookGlobal 重入不叠加监听器（挂 ${afterFirst} 个 / 重入 3 次后共 ${afterRepeat} 个，旧实现已被替换）`);
  if (!ok) process.exitCode = 1;
}

if (!comps || typeof comps !== "object") { console.log("FATAL: no components returned"); process.exit(2); }
const names = ["VaultEntry", "KitSurfaces", "TreeRowMenu", "RteEditor", "VaultPagePane", "rightbarAddress", "rightbarItem", "rightbarQuery", "sidebarViewPatch", "toggleVaultEntry", "ScheduleView", "timerMinsOfDT", "schedAssignLanes", "VaultView", "VaultRootView", "vaultSplitFrontmatter", "resolveVaultLink", "vaultBacklinks", "vaultOutline", "vaultHeadingSlug", "vaultSearchHits", "relUnder", "pathUnder", "absParent", "vaultTabsRetarget", "vaultTabsClose", "vaultDirChoices", "VaultDialog", "recordReadPos", "FilePaneBody", "VaultPaneBody", "SchedulePaneBody", "ScheduleTasksPanel", "SidebarVaultIndex", "openFileAndDock", "openVaultPageAndDock", "closeRightbarTab", "isPathInsideVaultRoot", "vaultCiteText", "resolveMdLink", "isDocHref"];
for (const n of names) {
  if (typeof comps[n] !== "function") { console.log("FAIL: missing/not function:", n); process.exitCode = 1; return; }
}

let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
let out;
let copiedRel = null;

// 4c) TreeRowMenu：文件行菜单项含复制相对路径/重命名/删除；目录行另有新建两项
//（TreeRowMenu 在底座被文件树与知识库两边共用，直测留在这里）
callLog = [];
out = comps.TreeRowMenu({ entry: { name: "b.js", path: "D:/w/b.js", dir: false }, rect: { top: 0, bottom: 20, left: 0, right: 100 }, actions: { onCopyPath: (_e, rel) => { copiedRel = rel; }, onRename: () => {}, onDelete: () => {} }, onClose: () => {} });
const menuLabels = callLog.filter(([, , p]) => p && typeof p === "object" && typeof p.children === "string").map(([, , p]) => p.children);
const hasAny = (cands) => cands.some((c) => menuLabels.includes(c));
check("TreeRowMenu 文件行菜单(复制相对/重命名/删除)", hasAny(["复制相对路径", "Copy relative path"]) && hasAny(["重命名", "Rename"]) && hasAny(["删除", "Delete"]));
callLog = [];
out = comps.TreeRowMenu({ entry: { name: "src", path: "D:/w/src", dir: true }, rect: { top: 0, bottom: 20, left: 0, right: 100 }, actions: { onCreate: () => {}, onCopyPath: () => {}, onRename: () => {}, onDelete: () => {} }, onClose: () => {} });
const dirLabels = callLog.filter(([, , p]) => p && typeof p === "object" && typeof p.children === "string").map(([, , p]) => p.children);
const dirHasAny = (cands) => cands.some((c) => dirLabels.includes(c));
check("TreeRowMenu 目录行菜单(新建文件/目录单入口+复制相对/重命名/删除)", dirHasAny(["新建文件/目录", "New file/folder"]) && dirHasAny(["复制相对路径", "Copy relative path"]) && dirHasAny(["删除", "Delete"]));

// 5)/6) FileTreePanel 与 DiffPane 直测在 tests\render-check-files.cjs

// 7) 入口按钮 / 浮层宿主顶部渲染（conversation.input.left + shell.overlay 槽位）：
//    终端入口与坞直测在 tests\render-check-terminal.cjs
callLog = [];
out = comps.VaultEntry({});
const entryBtn = callLog.find((c) => c[2] && c[2].className === "dshk-btn dshk-enbtn");
check("VaultEntry 渲染无异常且悬停走官方气泡（KitTip + 命令 id 对上快捷键注册）", !!out && out.type === comps.KitTip && out.props.command === "dsh-kit.vault.toggle" && typeof out.props.label === "string" && !!entryBtn);
check("知识库 · 日程 只占输入行一枚钮（没有第二枚日程钮）", !src.includes("ScheduleEntry") && !src.includes("dsh-kit-schedule\", order: 13"));
// 7.0) 侧栏那格单槽互斥（sidebarViewPatch 纯补丁语义；入口按钮交互在 files 组件直测）
const svp = comps.sidebarViewPatch("vault");
check("sidebarViewPatch 单槽互斥：只亮指定位", svp.vaultSideOpen === true && svp.vaultSideTab === "vault" && svp.treeOpen === false && svp.gitOpen === false);
const svpSched = comps.sidebarViewPatch("schedule");
check("日程与知识库同占侧栏那一格（vaultSideOpen 亮、槽内切 tab）", svpSched.vaultSideOpen === true && svpSched.vaultSideTab === "schedule" && svpSched.treeOpen === false && svpSched.gitOpen === false);
// 「哪张签激活」归官方签表，kitUi 不再存激活位。后台任务无插件分支：官方会话
// 头部自带任务清单 + 实时输出 + 停止
check("kitUi 不再存激活位（官方签表才是唯一事实）", comps.getKitUi().activeFeature === undefined);
// 7.1b) 入口钮（输入行钮 + 快捷键同语义）：开 = 侧栏占住那一格并落在知识库 tab；
// 再点 = 收回会话列表（不论当前在哪个 tab——整格只有这一个开关）。补丁只含侧栏
// 四键，功能签与页签状态一律不动（setKitUi 合并语义）
const tvOpen = comps.toggleVaultEntry({ treeOpen: true, vaultSideOpen: false, vaultSideTab: "vault", vaultOpen: false, vaultPages: [], activeFeature: null });
check("入口开：只切侧栏索引且让出文件树", tvOpen.vaultSideOpen === true && tvOpen.vaultSideTab === "vault" && tvOpen.treeOpen === false && tvOpen.vaultOpen === undefined && tvOpen.activeFeature === undefined);
const tvClose = comps.toggleVaultEntry({ vaultSideOpen: true, vaultSideTab: "vault", vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", activeFeature: "vault" });
check("入口再点：索引回会话、知识库签与页签不动（补丁不含这些键）", tvClose.vaultSideOpen === false && tvClose.vaultOpen === undefined && tvClose.vaultPages === undefined && tvClose.activeVaultPage === undefined && tvClose.activeFeature === undefined);
const tvFromSched = comps.toggleVaultEntry({ vaultSideOpen: true, vaultSideTab: "schedule" });
check("在日程 tab 上点入口钮：收整格（tab 切换只走 tab 条）", tvFromSched.vaultSideOpen === false);
// 7.1c) 右栏资源地址（一内容一签的载体）：条目 ↔ 地址往返，query 归 diff 源用
const vAddr = comps.rightbarAddress("vault", "D:/v/a b.md");
check("知识库页地址：dsh-resource 前缀 + 编码条目", vAddr === "dsh-resource://dshk-vault/D%3A%2Fv%2Fa%20b.md" && comps.rightbarItem("vault", vAddr) === "D:/v/a b.md");
const dAddr = comps.rightbarAddress("file", "C:/x/a.js", "d=1");
check("diff 地址：query 跟着地址走（同一文件不同 diff 源是两张签）", dAddr.startsWith("dsh-resource://dshk-diff/C%3A%2Fx%2Fa.js?") && comps.rightbarItem("file", dAddr) === "C:/x/a.js" && comps.rightbarQuery("file", dAddr) === "d=1");
check("非本 feature 的地址回 null（不串类）", comps.rightbarItem("vault", dAddr) === null && comps.rightbarItem("file", "dsh-resource://file/x") === null);
check("空条目不给地址", comps.rightbarAddress("vault", "") === "");

stateSeq = 0;
stateStore.clear();
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 渲染无异常（根壳只做座位门控，面板本体归组件壳）", out === null);

// 6.4) 日程模块（只读面板）：ScheduleView 初始态 / 计时段定位纯函数 / 并行分列
callLog = [];
out = comps.ScheduleView({});
check("ScheduleView 初始态渲染无异常（周网格 + 表头统计）", !!out && typeof out === "object");
check("timerMinsOfDT：取 HH:mm 折当日分钟", comps.timerMinsOfDT("2026-09-07T09:30:15") === 570);
{
  const lanes = comps.schedAssignLanes([
    { baseId: "a", startMins: 540, endMins: 600 },
    { baseId: "b", startMins: 560, endMins: 620 },
    { baseId: "c", startMins: 700, endMins: 760 },
  ]);
  const a = lanes.find((x) => x.baseId === "a");
  const b = lanes.find((x) => x.baseId === "b");
  const c = lanes.find((x) => x.baseId === "c");
  check("并行事件分列：重叠异泳道、不重叠复用泳道", a.lanes === 2 && b.lanes === 2 && a.lane !== b.lane && c.lanes === 2 && c.lane === a.lane);
}


// 7.2.2a) 文件签的文档签条已退役：一个文件一张官方签（地址往返见 7.1c）

// 7.2.4e) 右栏 pane 正文组件：一个内容一张签，正文只渲染自己那张签
// （地址由官方签条给出：tabAddress 读 tab.contentId）
const tabProps = (address) => ({ useTabInfo: () => ({ tab: { id: "t1", contentId: address, visible: true } }) });
callLog = [];
// DiffPane 在 dsh-kit/files 组件：root 只从 kitBase 的 diffPane 座取（物化期挂上）。
// 桩环境手动挂一枚假组件，钉住「正文类型确实来自座」——座没接线时类型是 undefined
// （真机 React #130 白屏，桩渲染器不抛，只能这样钉）
const fakeDiff = function FakeDiff() {};
comps.diffPane.Component = fakeDiff;
const diffAddr = comps.rightbarAddress("file", "C:/x/b.md", "u=1");
out = comps.FilePaneBody(tabProps(diffAddr));
const fpDiffs = callLog.filter((c) => (c[0] === "jsx") && c[1] === fakeDiff && c[2] && typeof c[2].path === "string");
check("FilePaneBody 一文件一签：只渲染自己那张签的 diff（未跟踪标志从地址 query 取）", !!out && fpDiffs.length === 1 && fpDiffs[0][2].path === "C:/x/b.md" && fpDiffs[0][2].untracked === true);
check("FilePaneBody 不再自绘第二层签条", callLog.every((c) => !(c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab"))));
comps.diffPane.Component = null;
callLog = [];
out = comps.FilePaneBody(tabProps(comps.rightbarAddress("file", "C:/x/b.md")));
const fpPlain = callLog.filter((c) => (c[0] === "jsx") && c[1] === null && c[2] && typeof c[2].path === "string");
check("无 query 标志即普通工作区 diff（untracked/deleted 为假）", fpPlain.length === 1 && fpPlain[0][2].untracked === false && fpPlain[0][2].deleted === false);
out = comps.FilePaneBody(tabProps(""));
check("地址认不出（别的页类型/没落地址）→ 不渲染正文", out === null);
callLog = [];
out = comps.SchedulePaneBody({});
check("SchedulePaneBody 挂 ScheduleView（右栏只出网格，清单在侧栏）", !!out && callLog.some((c) => c[1] === comps.ScheduleView));
callLog = [];
let rbCloseOk = true;
try { comps.closeRightbarTab("file"); } catch { rbCloseOk = false; }
check("closeRightbarTab 服务未就绪时静默不抛", rbCloseOk);
callLog = [];
out = comps.ScheduleTasksPanel({});
const scopeChips = callLog.filter((c) => c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-sched-wdchip"));
const barBtns = callLog.filter((c) => c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-sched-actionbtn"));
check("ScheduleTasksPanel 渲染清单壳（标题带行数 + 近三日/近一周/全部三档）", !!out && scopeChips.length === 3);
check("计时入口在侧栏日程 tab 顶部（新建 + 开始计时两枚）", barBtns.length === 2);
// 预置 useScheduleData 的数据槽（0）让清单真出行：标题 + 截止徽章 + 行尾动作
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { events: [{ id: "t1", title: "交报告", due: "2026-09-10" }], occurrences: [], orphans: [], runningTimer: null });
callLog = [];
out = comps.ScheduleTasksPanel({});
const taskRows = callLog.filter((c) => c[2] && c[2].className === "dshk-sched-task");
const rowBadges = callLog.filter((c) => c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-sched-taskduebadge"));
const taskChecks = callLog.filter((c) => c[2] && c[2].type === "checkbox");
const timerBtns = callLog.filter((c) => c[2] && c[2].className === "dshk-sched-tasktimer");
const rowActs = callLog.filter((c) => c[2] && c[2].className === "dshk-sched-taskact");
check("ScheduleTasksPanel 出行：待办一行 + 右端截止徽章", taskRows.length === 1 && rowBadges.length === 1);
check("清单行可写：行首完成勾选 + 行尾计时 / 编辑 / 删除", taskChecks.length === 1 && timerBtns.length === 1 && rowActs.length === 2);
// 计时中：顶部退成状态（走秒与停表在悬浮球），行上那枚钮变成停表
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { events: [{ id: "t1", title: "交报告", due: "2026-09-10" }], occurrences: [], orphans: [], runningTimer: { id: "t1", start: "2026-09-10T09:00:00" } });
callLog = [];
out = comps.ScheduleTasksPanel({});
const runningBadges = callLog.filter((c) => c[2] && c[2].className === "dshk-sched-running");
const timingRows = callLog.filter((c) => c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-sched-task is-timing"));
check("计时中：顶部挂走秒状态、挂表那一行亮起", runningBadges.length === 1 && /\d\d:\d\d/.test(String(runningBadges[0][2].children)) && timingRows.length === 1);
stateSeq = 0;
stateStore.clear();
// openFileAndDock / openVaultPageAndDock：签归官方签表，这里断言「开出来的地址对不对」
// （桩环境无右栏服务 → 只看地址映射，见 7.1c 的往返断言）
comps.openFileAndDock("C:/x/new.js", false, true);
check("openFileAndDock 不再往 kitUi 写激活位", comps.getKitUi().activeFeature === undefined);
comps.openVaultPageAndDock("D:/v/p.md");
check("openVaultPageAndDock 同样不写激活位", comps.getKitUi().activeFeature === undefined);
// 6.5b) 官方右栏可用时机（rightbarSeat）：树/源代码管理/知识库三个工作区面与全部
// 开签动作跟官方右栏同生灭——全局面板（插件页/设置页）占住中栏或没选会话时收手。
// 两路信号：layout.panelInfo 回落源先测（mounted 一旦挂上就首选，无退订 API），
// 再挂 mounted 验首选关系。断言后恢复在场，后面用例按默认态跑。
{
  const seat = comps.rightbarSeat;
  check("在场信号未挂上时按可用（极简组合不误伤）", seat.available === true);
  let panelVal = { activePanelId: null };
  comps.attachSeatSignal("panel", { getSnapshot: () => panelVal });
  check("回落源 layout.panelInfo：对话在前台（activePanelId=null）＝在场", seat.available === true);
  panelVal = { activePanelId: "plugins" };
  comps.attachSeatSignal("panel", { getSnapshot: () => panelVal });
  check("回落源 layout.panelInfo：全局面板占住中栏＝不在场", seat.available === false);
  // mounted 源（首选）：有值＝在场；它的变化经订阅回调驱动重算
  let mountedVal = "session-1";
  const seatListeners = new Set();
  comps.attachSeatSignal("mounted", {
    getSnapshot: () => mountedVal,
    subscribe: (cb) => { seatListeners.add(cb); return () => seatListeners.delete(cb); },
  });
  check("mounted 首选于 panelInfo：有值＝在场（panelInfo 仍是非空）", seat.available === true);
  mountedVal = undefined;
  for (const cb of seatListeners) cb();
  check("mounted 变 undefined（没选会话 / 全局面板在前台）＝不在场", seat.available === false);
  check("useRightbarSeat 读的就是这份在场状态（KitSurfaces 据此重绘）", comps.useRightbarSeat() === false);
  comps.setKitUi({ activeFeature: null });
  comps.openFileAndDock("C:/x/gated.js", true, false);
  check("不在场：openFileAndDock 不激活差异", comps.getKitUi().activeFeature !== "file");
  comps.openVaultPageAndDock("D:/v/gated.md");
  check("不在场：openVaultPageAndDock 不激活知识库", comps.getKitUi().activeFeature !== "vault");
  mountedVal = "session-1";
  for (const cb of seatListeners) cb();
  check("回到对话（mounted 有值）＝恢复在场", seat.available === true);
}
// 侧栏浏览区占用的在位门控与 openOfficialFile 的先门控后开签（都是 effect 内路径，
// 桩环境 effect 不执行，按源码顺序钉）
{
  const occupant = src.indexOf('slotsCtx.slots.register({ name: "sidebar.workspaces", priority: -1000 }');
  check(
    "侧栏工作区面板在位门控（不在场不占 sidebar.workspaces，让回官方会话列表）",
    occupant > 0 && /if \(!slotsCtx \|\| !rightbarUp \|\| \(!ui\.treeOpen && !ui\.gitOpen && !ui\.vaultSideOpen\)\) return undefined;/.test(src) && src.includes("[ui.treeOpen, ui.gitOpen, ui.vaultSideOpen, cwd, rightbarUp]"),
  );
  const fnAt = src.indexOf("function openOfficialFile(path, line) {");
  const gateAt = src.indexOf("if (!rightbarSeat.available) return false;", fnAt);
  const svcAt = src.indexOf("const sr = getRightbarSr();", fnAt);
  check("openOfficialFile 先在位门控、再取右栏服务（不在场不开签、不弹内部错误）", fnAt > 0 && gateAt > fnAt && svcAt > gateAt);
  check(
    "在场信号两路接在 apply：sidebarRight.mounted 首选、layout.panelInfo 回落",
    /attachSeatSignal\("mounted", c\.sidebarRight && c\.sidebarRight\.mounted\)/.test(src) && /attachSeatSignal\("panel", c\.layout && c\.layout\.panelInfo\)/.test(src),
  );
  check("知识库命令的非在场分支 blocked 带说明（同构行为由 files 侧命令覆盖）", /if \(!rightbarSeat\.available\) return \{ status: "blocked", reason: t\("scNoSeat"\) \};/.test(src));
}

// 6.6) 知识库纯函数：frontmatter 拆分 / 解析优先级 / 反链
//（wikilink/数学变换的往返断言在 tests/test-vault-rte.mjs）
{
  const raw = "---\ncreated: 2026-09-06\n---\n\n# 标题\n\n正文";
  const { fmText, rest } = comps.vaultSplitFrontmatter(raw);
  check("fm 拆分：字节级原文 + 正文", fmText === "---\ncreated: 2026-09-06\n---\n" && rest === "\n# 标题\n\n正文");
  const noFm = comps.vaultSplitFrontmatter("无头部页");
  check("fm 拆分：无 frontmatter 原样", noFm.fmText === "" && noFm.rest === "无头部页");
}
const vaultPages = [
  { path: "D:/v/wiki/Python/基础.md", rel: "wiki/Python/基础", title: "Python 基础", links: [] },
  { path: "D:/v/wiki/git.md", rel: "wiki/git", title: "版本控制", links: [] },
];
check("resolveVaultLink：标题档已退役（页面名 = 文件名，按标题找不到）", comps.resolveVaultLink(vaultPages, "Python 基础") === null);
check("resolveVaultLink：rel 全等优先", comps.resolveVaultLink(vaultPages, "wiki/git")?.path === "D:/v/wiki/git.md");
check("resolveVaultLink：.md 后缀容忍", comps.resolveVaultLink(vaultPages, "git.md")?.path === "D:/v/wiki/git.md");
check("resolveVaultLink：未命中回 null", comps.resolveVaultLink(vaultPages, "不存在") === null);
const backlinksHit = comps.vaultBacklinks([
  { path: "D:/v/a.md", rel: "a", title: "A", links: ["B"] },
  { path: "D:/v/b.md", rel: "b", title: "B", links: [] },
  { path: "D:/v/c.md", rel: "c", title: "C", links: ["别的"] },
], "D:/v/b.md");
check("vaultBacklinks：links 解析命中当前页（1 条）", backlinksHit.length === 1 && backlinksHit[0].path === "D:/v/a.md");

// 6.7) 知识库纯函数：标题 slug / 大纲
check("vaultHeadingSlug：空白压成 -", comps.vaultHeadingSlug("  Some 标题 two  ") === "Some-标题-two");
{
  // vaultOutline：顶层标题一趟扫完（空标题不进、pos = 节点起点），无编辑器回空
  const fakeDoc = { forEach(fn) { fn({ type: { name: "heading" }, attrs: { level: 1 }, textContent: " 一 " }, 0); fn({ type: { name: "paragraph" }, attrs: {}, textContent: "正文" }, 6); fn({ type: { name: "heading" }, attrs: { level: 2 }, textContent: "  " }, 12); } };
  const items = comps.vaultOutline({ editor: { state: { doc: fakeDoc } } });
  check("vaultOutline：顶层标题收集（空标题跳过）", items.length === 1 && items[0].text === "一" && items[0].pos === 0 && items[0].level === 1);
  check("vaultOutline：无编辑器回空数组", comps.vaultOutline(null).length === 0);
}

// 6.8) M4 互通纯函数：vault 路径归属 + 引用到对话文本构造
check("isPathInsideVaultRoot：win 反斜杠内", comps.isPathInsideVaultRoot("D:\\v", "D:\\v\\wiki\\a.md") === true);
check("isPathInsideVaultRoot：混合分隔符 + 盘符大小写", comps.isPathInsideVaultRoot("D:/V", "D:\\v\\a.md") === true);
check("isPathInsideVaultRoot：外部目录", comps.isPathInsideVaultRoot("D:\\v", "D:\\other\\a.md") === false);
check("isPathInsideVaultRoot：同名前缀目录不误判", comps.isPathInsideVaultRoot("D:\\v", "D:\\vault\\a.md") === false);
check("isPathInsideVaultRoot：POSIX 大小写敏感", comps.isPathInsideVaultRoot("/home/u/v", "/home/u/V/a.md") === false);
check("isPathInsideVaultRoot：根本身不算内", comps.isPathInsideVaultRoot("D:\\v", "D:\\v") === false);
check("isPathInsideVaultRoot：非字符串入参", comps.isPathInsideVaultRoot(null, "D:\\v\\a.md") === false);
check("vaultCiteText：无选区原样返回", comps.vaultCiteText("", "") === "");
check("vaultCiteText：续草稿补换行", comps.vaultCiteText("在吗", "") === "在吗\n");
check(
  "vaultCiteText：选区转引用块 + 首尾空行剥除",
  comps.vaultCiteText("在吗", "\n第一行\n第二行\n\n") === "在吗\n> 第一行\n> 第二行\n\n",
);

// 6.8b) md 相对链接解析（文件签/知识库页里点链接打开目标文件的那条链）：
// RTE 的 Link 扩展 openOnClick:false，链接点击由编辑面容器捕获后交给本函数解析
check("isDocHref：相对/上级/站内/裸路径都算候选", ["docs/a.md", "../a.md", "/wiki/a.md", "a.md"].every((h) => comps.isDocHref(h) === true));
check("isDocHref：外链/协议/锚点/空串不接管", ["https://x/y", "mailto:a@b", "tel:1", "//cdn/x.md", "#h2", ""].every((h) => comps.isDocHref(h) === false));
check("resolveMdLink：相对本文件解析", comps.resolveMdLink("C:\\x\\docs\\a.md", "C:\\x", "b.md") === "C:\\x\\docs\\b.md");
check("resolveMdLink：.. 归一化", comps.resolveMdLink("C:\\x\\docs\\a.md", "C:\\x", "../y/c.md") === "C:\\x\\y\\c.md");
check("resolveMdLink：/ 开头按根（工作区或知识库根）合成", comps.resolveMdLink("C:\\x\\docs\\a.md", "C:\\x", "/z/d.md") === "C:\\x\\z\\d.md");
check("resolveMdLink：%20 解码 + query/hash 剥除", comps.resolveMdLink("C:/x/a.md", "C:/x", "my%20file.md?a=1#frag") === "C:\\x\\my file.md");
check("resolveMdLink：混用分隔符与正斜杠 fromPath", comps.resolveMdLink("C:/x/docs/a.md", "C:/x", "b.md") === "C:\\x\\docs\\b.md");
check("resolveMdLink：空 href / 无根时站内链接返回 null", comps.resolveMdLink("C:/x/a.md", "C:/x", "") === null && comps.resolveMdLink("C:/x/a.md", "", "/z.md") === null);
// 6.9) 单态 VaultRootView 直渲（无 hooks 执行的完整渲染体）：槽位渲染器会静默
// 吞掉渲染期异常（readerRef 残留引用教训），必须在这里显式跑过才肯放行
{
  let vaultOut = null;
  let vaultErr = null;
  // 索引视图单实例挂 KitSurfaces、只投侧栏（页签正文自己渲染，不再投右栏）；
  // 侧栏宿主全空时返回 null 是合法语义。渲一遍防渲染体异常逃逸
  comps.vaultSideSlot.set({ tagName: "DIV" });
  comps.setKitUi({ vaultOpen: true, vaultSideOpen: true, vaultSideTab: "vault", activeFeature: "vault" });
  try {
    vaultOut = comps.VaultRootView({ root: "D:/v" });
  } catch (e) {
    vaultErr = e;
  }
  check("VaultRootView 单态渲染无异常（索引就绪后投侧栏）", vaultErr === null && !!vaultOut && typeof vaultOut === "object");
  if (vaultErr) console.log("  VaultRootView error:", vaultErr.message);
  comps.vaultSideSlot.set(null);
  comps.setKitUi({ vaultOpen: false, activeFeature: null });
}
// 6.9c) VaultRootView 索引就绪态：工具条一行（搜索框占满 + ↻ 收尾）、资料库那一行、
// 树行 ⋯（复制绝对路径 + 在此打开）与 Ctrl+点击换根；↻ 还要连带重拉目录树——树是
// 懒加载缓存，只刷索引 ⇒ 外部增删的文件在侧栏看不见
let vaultRefreshFetched = [];
let vaultFetchPrev = null;
{
  const VAULT_INDEX = {
    root: "D:/v",
    folders: ["wiki", "wiki/Python"],
    pages: [{ path: "D:/v/wiki/a.md", rel: "wiki/a", space: "wiki", title: "A", links: [] }],
    library: {
      root: "D:/v/library",
      items: [
        { path: "D:/v/library/大学", rel: "大学", dir: true },
        { path: "D:/v/library/大学/讲义.pdf", rel: "大学/讲义.pdf", dir: false },
        { path: "D:/v/library/统计.pdf", rel: "统计.pdf", dir: false },
      ],
    },
  };
  // 预置 state：0 index / 1 indexErr / 2 rootHere / 3 treeDirs / 4 expanded / 5 rowMenu
  const renderVault = (preset) => {
    stateSeq = 0;
    stateStore.clear();
    for (const key of Object.keys(preset)) stateStore.set(Number(key), preset[key]);
    callLog = [];
    try {
      comps.VaultRootView({});
      return null;
    } catch (e) {
      return e;
    }
  };
  const TREE = {
    "D:/v": [{ name: "wiki", path: "D:/v/wiki", dir: true }, { name: "a.md", path: "D:/v/a.md", dir: false }],
    "D:/v/wiki": [{ name: "a.md", path: "D:/v/wiki/a.md", dir: false }],
    "D:/v/library": [
      { name: "大学", path: "D:/v/library/大学", dir: true },
      { name: "统计.pdf", path: "D:/v/library/统计.pdf", dir: false },
    ],
  };
  const fetched = vaultRefreshFetched;
  const prevFetch = global.fetch;
  vaultFetchPrev = prevFetch;
  global.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => ({ root: "D:/v", folders: ["wiki"], pages: [], library: null, entries: [] }) };
  };
  comps.vaultSideSlot.set({ tagName: "DIV" });
  comps.setKitUi({ vaultSideOpen: true, vaultSideTab: "vault", vaultOpen: true, vaultPages: [], activeVaultPage: null, activeFeature: "vault" });
  const barErr = renderVault({
    0: VAULT_INDEX,
    1: "",
    2: null,
    3: TREE,
    4: { "D:/v": true, "D:/v/wiki": true, "D:/v/library": true },
    5: { entry: { dir: true, name: "wiki", path: "D:/v/wiki", here: true }, rect: { left: 10, top: 100, bottom: 120, right: 30, width: 20, height: 20 } },
  });
  check("知识库面板渲染无异常", barErr === null);
  if (barErr) console.log("  VaultRootView error:", barErr.message);
  const rows = callLog.filter((c) => c[0] === "jsxs" && c[2] && c[2].className === "dshk-vault-tbarrow");
  check("工具条只剩一行", rows.length === 1);
  const barRow = rows[0] ? rows[0][2].children : [];
  const refreshWrap = barRow.find((ch) => ch && ch.props && ["刷新索引与目录树", "Refresh index and tree"].includes(ch.props.label));
  const searchBox = barRow.find((ch) => ch && ch.props && ch.props.className === "dshk-vault-search");
  check("一行 = 搜索框 + 刷新钮（前进/后退与文件夹筛选框都退役；刷新钮走官方气泡）", barRow.length === 2 && !!searchBox && !!refreshWrap && refreshWrap.props.children.props.className === "dshk-sched-navbtn");
  check(
    "搜索占位「搜索笔记 / 资料库」",
    ["搜索笔记 / 资料库", "Search notes / library"].includes(searchBox && searchBox.props.placeholder),
  );
  const rowEls = callLog.filter((c) => c[2] && c[2].className === "dshk-vault-treerow");
  const findRow = (title) => rowEls.find((c) => c[2].title === title);
  const actsOfRow = (row) => row[2].children[row[2].children.length - 1].props.children;
  const titles = callLog.filter((c) => c[2] && typeof c[2].title === "string").map((c) => c[2].title);
  const nameOf = (row) => {
    const span = row[2].children.find((ch) => ch && ch.props && ch.props.className === "dshk-vault-treename");
    return span ? span.props.children : null;
  };
  check(
    "面板里没有 前进/后退 钮（访问序随按钮一起退役）",
    !titles.includes("后退") && !titles.includes("前进") && !src.includes("vaultHist") && !src.includes("dshk-vault-fpick"),
  );
  // 资料库那一行：库根下的第一项，名字带文件数（目录不算），展开后列库内文件
  check("资料库那一行在库根下（名字带文件数）", !!findRow("D:/v/library") && ["资料库 (2)", "Library (2)"].includes(nameOf(findRow("D:/v/library"))));
  const libFileRow = findRow("D:/v/library/统计.pdf");
  check("资料库文件行保留扩展名（点开走官方文件右栏）", !!libFileRow && nameOf(libFileRow) === "统计.pdf");
  check(
    "资料库文件点击走 openVaultAsset（PDF 且自带阅读器开 → 知识库签，其余官方文件右栏）",
    src.includes("if (lib) openVaultAsset(e.path);") && src.includes("else if (hit.kind === \"libfile\") openVaultAsset(hit.path);"),
  );
  // 树上行操作：页行与目录行同形状 = `@` + `⋯`（只读库没有别的写操作）
  const actSpans = callLog.filter((c) => (c[0] === "jsx" || c[0] === "jsxs") && c[2] && c[2].className === "dshk-rowact");
  const actsOf = (sp) => (Array.isArray(sp[2].children) ? sp[2].children : [sp[2].children]);
  const twoBtnSpans = actSpans.filter((sp) => actsOf(sp).length === 2);
  check(
    "知识库树每行 hover 都是 @ + ⋯（页行/目录行/资料库行同形状；新建另挂 + 钮）",
    twoBtnSpans.length === actSpans.length &&
      twoBtnSpans.length >= 4 &&
      twoBtnSpans.every((sp) => {
        const b = actsOf(sp);
        // 两枚都包在 KitTip 里（官方气泡）：断言包层 label 与内层按钮
        return ["@ 到对话", "Insert @ mention"].includes(b[0].props.label) && b[1].props.children.props.children === "⋯";
      }),
  );
  // 新建入口：目录行与树头都有悬停「+」（资料库那一支也有——库里建文件夹）
  const plusWraps = callLog.filter((c) => c[0] === "jsx" && c[2] && c[2].children && c[2].children.props && c[2].children.props.className === "dshk-vault-treeplus");
  check(
    "目录行与树头都挂了「新建」+ 钮（树头两枚：新建 + 更多操作）",
    plusWraps.length >= 4 &&
      plusWraps.filter((w) => ["新建", "New"].includes(w[2].label)).length >= 3 &&
      plusWraps.some((w) => w[2].children.props.children === "+") &&
      plusWraps.some((w) => w[2].children.props.children === "⋯"),
  );
  // 图标走文件树那套：自绘的页面/目录图标都不存在，行图标来自共用组件
  check(
    "知识库树图标不再自绘（无 VaultPageIcon/VaultFolderIcon，走 FileTypeIcon16/TreeFolderIcon）",
    !src.includes("VaultPageIcon") &&
      !src.includes("VaultFolderIcon") &&
      src.includes("jsxRuntime.jsx(FileTypeIcon16, { name: e.name })") &&
      src.includes("jsxRuntime.jsx(TreeFolderIcon, {})"),
  );
  check(
    "vault 工具条/树头复用官方图标（OfficialIcon/ChevronIcon）",
    src.includes('names: ["IconRefreshOutline16", "IconRefreshOutline14"]') &&
      src.includes('jsxRuntime.jsx(ChevronIcon, { open: expanded[e.path] === true })'),
  );
  // 行 ⋯ 的 actions：复制绝对路径（copyMode=abs）+ 重命名 / 移动到… / 导入… / 删除；
  // 「在此打开」已退役（换根只走 Ctrl+点击目录行，与树头 ← 配对）
  const rowMenuEl = callLog.find((c) => c[1] === comps.TreeRowMenu);
  const rowMenuActs = rowMenuEl ? rowMenuEl[2].actions : null;
  const rowExtraLabels = rowMenuActs && Array.isArray(rowMenuActs.extraItems) ? rowMenuActs.extraItems.map((it) => it.label) : [];
  check(
    "知识库行 ⋯ 接线：复制绝对路径 + 重命名 + 移动到… + 导入 md（笔记目录）",
    !!rowMenuActs &&
      rowMenuActs.copyMode === "abs" &&
      typeof rowMenuActs.onCopyPath === "function" &&
      typeof rowMenuActs.onRename === "function" &&
      typeof rowMenuActs.onDelete === "function" &&
      rowMenuActs.onOpenHere === undefined &&
      rowExtraLabels.length === 2 &&
      ["移动到…", "Move to…"].includes(rowExtraLabels[0]) &&
      ["导入 md 文件…", "Import markdown…"].includes(rowExtraLabels[1]),
  );
  // 复制绝对路径直接发 entry.path（clipboard 在 Node 桩里没有可信通道，见 writeClipboard 降级链）
  check("行 ⋯ 复制绝对路径取 entry.path（源码哨兵）", src.includes("void writeClipboard(entry.path).then"));
  // ⋯ 触发钮是开关：再点一次关掉自己；目录行与页行各认自己的条目，且「在此打开」
  // 只挂在笔记目录上（资料库那一行与库内目录都没有）
  const anchorEl = { getBoundingClientRect: () => ({ left: 10, top: 100, bottom: 120, right: 30, width: 20, height: 20 }) };
  const clickEv = { stopPropagation: () => {}, currentTarget: anchorEl };
  // 行内两枚钮现在包在 KitTip 里（官方气泡）：取内层按钮
  const menuBtnOf = (row) => actsOfRow(row)[1].props.children;
  const dirMenuBtn = menuBtnOf(findRow("D:/v/wiki"));
  const pageMenuBtn = menuBtnOf(findRow("D:/v/wiki/a.md"));
  const libMenuBtn = menuBtnOf(findRow("D:/v/library"));
  dirMenuBtn.props.onClick(clickEv);
  const dirOpened = stateStore.get(5);
  dirMenuBtn.props.onClick(clickEv);
  pageMenuBtn.props.onClick(clickEv);
  const menuOpened = stateStore.get(5);
  pageMenuBtn.props.onClick(clickEv);
  libMenuBtn.props.onClick(clickEv);
  const libOpened = stateStore.get(5);
  libMenuBtn.props.onClick(clickEv);
  check(
    "行 ⋯ 再点一次关掉 + 目录行/页行各认自己的条目（锚点认的是同一颗按钮）",
    !!dirOpened &&
      dirOpened.entry.dir === true &&
      dirOpened.entry.path === "D:/v/wiki" &&
      !!menuOpened &&
      menuOpened.anchor === anchorEl &&
      menuOpened.entry.path === "D:/v/wiki/a.md" &&
      stateStore.get(5) === null,
  );
  // 资料库根那一行：⋯ 菜单不给重命名/删除（根目录名是写死的约定），只给导入
  check("资料库根那一行的 ⋯ 认的是库根条目（改名/删除由菜单接线挡掉）", !!libOpened && libOpened.entry.path === "D:/v/library" && libOpened.entry.here === undefined);
  check(
    "资料库根行 ⋯ 只给导入（源码哨兵：atLibRoot 时 onRename/onDelete 为 undefined）",
    src.includes("onRename: atLibRoot ? undefined :") && src.includes("onDelete: atLibRoot ? undefined :"),
  );
  // Ctrl+点击笔记目录行 = 进入该目录：换树根（只影响面板显示，不动设置卡）
  findRow("D:/v/wiki")[2].onClick({ ctrlKey: true });
  check("Ctrl+点击笔记目录行 = 进入该目录（树根换成它）", stateStore.get(2) === "D:/v/wiki");
  findRow("D:/v/wiki")[2].onClick({ ctrlKey: false });
  check("普通点击目录行仍是折叠/展开（不换根）", stateStore.get(2) === "D:/v/wiki" && stateStore.get(4)["D:/v/wiki"] === false);
  // 资料库那支按 Ctrl 点也不换根：只当普通点击（展开/收起）
  findRow("D:/v/library")[2].onClick({ ctrlKey: true });
  check("Ctrl+点击资料库那一行不换根（当普通点击）", stateStore.get(2) === "D:/v/wiki" && stateStore.get(4)["D:/v/library"] === false);
  // 换根后的树头：库内相对路径 + ← 回知识库；资料库那一行照旧在（它挂在树体上，与根无关）
  const rootErr = renderVault({
    0: VAULT_INDEX,
    1: "",
    2: "D:/v/wiki",
    3: { "D:/v/wiki": [{ name: "a.md", path: "D:/v/wiki/a.md", dir: false }] },
    4: { "D:/v/wiki": true },
  });
  const backBtn = callLog.find((c) => c[2] && ["返回知识库", "Back to knowledge base"].includes(c[2].label) && c[2].children && c[2].children.props && c[2].children.props.className === "dshk-sched-navbtn");
  const railTitle = callLog.find((c) => c[2] && c[2].className === "dshk-vault-railtitle");
  check("换根后树头给库内相对路径 + ← 回知识库", rootErr === null && !!backBtn && railTitle[2].children === "wiki");
  check(
    "换根后资料库那一行照旧在（它挂在树体上，跟当前目录无关）",
    callLog.some((c) => c[2] && c[2].className === "dshk-vault-treerow" && c[2].title === "D:/v/library"),
  );
  check(
    "搜索点到资料库目录 = 树上定位（源码哨兵；展开祖先 + 滚到那一行，不换根）",
    src.includes("else if (hit.kind === \"libdir\") revealLibDir(hit.path);") &&
      src.includes("const revealLibDir = (dirPath) => {") &&
      src.includes("row.scrollIntoView({ block: \"nearest\" });"),
  );
  // ── 文件管理（建 / 改名 / 移动 / 导入 / 删除）：行内输入 + 三个对话框 ──
  // 预置 state（按 VaultRootView 的 useState 顺序，槽位随钩子增删整体位移）：
  // 13 renamingPath / 14 createAt / 15 createName / 16 dialog
  {
    const base = {
      0: VAULT_INDEX,
      1: "",
      2: null,
      3: TREE,
      4: { "D:/v": true, "D:/v/wiki": true, "D:/v/library": true },
    };
    /** 组件元素不会被桩执行（jsx 只记账），断言对话框内容得自己走一遍 props 树 */
    const walk = (node, pred, out = []) => {
      if (!node || typeof node !== "object") return out;
      if (pred(node)) out.push(node);
      const kids = node.props ? node.props.children : undefined;
      for (const ch of Array.isArray(kids) ? kids : kids === undefined || kids === null ? [] : [kids]) walk(ch, pred, out);
      return out;
    };
    const byClass = (node, cls) => walk(node, (n) => typeof (n.props && n.props.className) === "string" && n.props.className.split(" ").includes(cls));
    const createErr = renderVault({ ...base, 13: null, 14: "D:/v/wiki", 15: "新页" });
    const createRow = callLog.find((c) => c[2] && c[2].className === "dshk-createrow");
    const createInput = createRow && createRow[2].children ? createRow[2].children[0] : null;
    check(
      "行内新建：目标目录下挂输入行（占位写清 \\ 前缀与 / 多级）",
      createErr === null &&
        !!createInput &&
        ["名称；\\ 开头建目录，可含 / 多级", "Name; \\ prefix makes a folder, / for nested"].includes(createInput.props.placeholder) &&
        createInput.props.value === "新页",
    );
    check(
      "新建走宿主端点（源码哨兵：create + kind 由 \\ 前缀决定，资料库那一支只建目录）",
      src.includes('vaultOp("/dsh-kit/vault/create", { dir, name, kind: wantDir ? "dir" : "page" })') &&
        src.includes("const wantDir = raw.startsWith(\"\\\\\") || isLibPath(createAt);"),
    );
    const createPlus = callLog.find((c) => c[2] && c[2].className === "dshk-vault-treerow" && c[2].title === "D:/v/wiki");
    const plusBtn = createPlus ? createPlus[2].children.find((ch) => ch && ch.props && ch.props.className === "dshk-vault-treeplus") : null;
    if (plusBtn) plusBtn.props.onClick({ stopPropagation: () => {} });
    check("目录行尾 + 的落点 = 那一行目录（树头 + 落到当前树根）", stateStore.get(14) === "D:/v/wiki");
    renderVault({ ...base, 13: "D:/v/wiki/a.md" });
    const renameInput = callLog.find((c) => c[2] && c[2].className === "dshk-rename");
    check(
      "行内改名：页行换成输入框，初值取显示名（去 .md）",
      !!renameInput && renameInput[2].defaultValue === "a" && renameInput[2].autoFocus === true,
    );
    check(
      "树内改名/新建占用 inlineEdit 让路座（源码哨兵：Esc 取消编辑不连带关页签/侧栏）",
      src.includes("dock.inlineEdit.active = renamingPath !== null || createAt !== null;"),
    );
    check(
      "跨页 wikilink 的锚点透传（源码哨兵：onOpenPage 收 anchor + newPane，一路传到 pendingAnchor / preferNewPane）",
      src.includes("onOpenPage: (p, anchor, newPane) => {") && src.includes("reader.openPath(p, anchor, newPane)") && src.includes("else openVaultPageAndDock(p, anchor, newPane);") &&
        src.includes("onOpenPage(resolved.path, anchor, true);") &&
        src.includes('newPane === true ? { preferNewPane: true } : undefined'),
    );
    check(
      "改名走宿主端点（源码哨兵：rename 提交后搬树键 + 把开着的那张页签换到新地址）",
      src.includes('vaultOp("/dsh-kit/vault/rename", { path: entry.path, name })') &&
        src.includes("vaultTabsRetarget(entry.path, res.path, entry.dir === true);") &&
        src.includes("retargetTree(entry.path, res.path, entry.dir === true);"),
    );
    // 移动到…：候选目录列同侧全部分支（根 + wiki + wiki/Python）
    const moveErr = renderVault({
      ...base,
      16: { kind: "move", entry: { dir: false, name: "a", path: "D:/v/wiki/a.md" }, lib: false, dest: "D:/v/wiki", conflict: "skip" },
    });
    const moveDialog = callLog.find((c) => c[1] === comps.VaultDialog);
    const dirItems = moveDialog ? byClass({ props: moveDialog[2] }, "dshk-vault-diritem") : [];
    check(
      "移动到…对话框：列笔记侧候选目录 + 两个按钮（撞名才摆策略）",
      moveErr === null &&
        !!moveDialog &&
        String(moveDialog[2].title).includes("a") &&
        dirItems.length === 3 &&
        dirItems[1].props.children === "wiki" &&
        dirItems[1].props.className.includes("is-cur") &&
        byClass({ props: moveDialog[2] }, "dshk-vault-radio").length === 0 &&
        byClass({ props: moveDialog[2] }, "dshk-vault-modalfoot").length === 1,
    );
    check(
      "移动与删除走宿主端点（源码哨兵）",
      src.includes('vaultOp("/dsh-kit/vault/move", { path: d.entry.path, dest: d.dest, conflict: d.conflict })') &&
        src.includes('vaultOp("/dsh-kit/vault/delete", { paths: [d.entry.path] })'),
    );
    // 导入：资料库那一支给「导入文件…」（多选、不限格式），笔记侧给「导入 md 文件…」
    const importErr = renderVault({
      ...base,
      16: { kind: "import", dest: "D:/v/library", lib: true, files: [], src: "", name: "", conflict: "skip" },
    });
    const importDialog = callLog.find((c) => c[1] === comps.VaultDialog);
    const fileInput = importDialog ? walk({ props: importDialog[2] }, (n) => n.props && n.props.type === "file")[0] : null;
    const pathInput = importDialog ? byClass({ props: importDialog[2] }, "dshk-vault-modalinput")[0] : null;
    check(
      "导入对话框：选择文件（多选）+ 绝对路径输入 + 三档撞名策略",
      importErr === null &&
        !!importDialog &&
        !!fileInput &&
        fileInput.props.multiple === true &&
        !!pathInput &&
        ["或粘贴本机绝对路径", "or paste an absolute path on this machine"].includes(pathInput.props.placeholder),
    );
    check(
      "导入对话框：资料库那一支不给 md 过滤，撞名自动加序号（不摆策略）",
      !!importDialog &&
        (fileInput.props.accept === undefined || fileInput.props.accept === null) &&
        byClass({ props: importDialog[2] }, "dshk-vault-radio").length === 0,
    );
    const notesImportErr = renderVault({
      ...base,
      16: { kind: "import", dest: "D:/v/wiki", lib: false, files: [], src: "", name: "", conflict: "skip" },
    });
    const notesDialog = callLog.find((c) => c[1] === comps.VaultDialog);
    const notesFile = notesDialog ? walk({ props: notesDialog[2] }, (n) => n.props && n.props.type === "file")[0] : null;
    check(
      "导入对话框：笔记侧只收 md（picker 带扩展名过滤）+ 三档撞名策略",
      notesImportErr === null &&
        !!notesFile &&
        notesFile.props.accept === ".md,.markdown" &&
        byClass({ props: notesDialog[2] }, "dshk-vault-radio").length === 3,
    );
    check(
      "导入走宿主端点（源码哨兵：两条来源同一端点，上传带 dataBase64）",
      src.includes('vaultOp("/dsh-kit/vault/import", payload)') &&
        src.includes("dataBase64: await fileToBase64(job.file)") &&
        src.includes('accept: dialog.lib ? undefined : ".md,.markdown"'),
    );
    const delErr = renderVault({
      ...base,
      16: { kind: "delete", entry: { dir: true, name: "wiki", path: "D:/v/wiki" } },
    });
    const delDialog = callLog.find((c) => c[1] === comps.VaultDialog);
    check(
      "删除确认：目录行带级联数量（wiki 下 1 页）",
      delErr === null && !!delDialog && String(delDialog[2].title).includes("1") && byClass({ props: delDialog[2] }, "dshk-vault-modalfoot").length === 1,
    );
    // 对话框壳：遮罩 + 卡片 + 标题（Esc 与点遮罩关闭长在壳里，宿主只给内容）
    callLog = [];
    comps.VaultDialog({ title: "T", onClose: () => {}, children: "body" });
    check(
      "对话框壳：遮罩 + 卡片 + 标题 + 内容（一处实现关闭手势）",
      callLog.some((c) => c[2] && c[2].className === "dshk-vault-modalwrap") &&
        callLog.some((c) => c[2] && c[2].className === "dshk-vault-modal") &&
        callLog.some((c) => c[2] && c[2].className === "dshk-vault-modaltitle"),
    );
    renderVault(base);
  }
  const refreshBtn = refreshWrap ? refreshWrap.props.children : null;
  if (refreshBtn) refreshBtn.props.onClick();
  // fetch 桩同步记账：loadIndex 的请求在 onClick 返回前就已发出；目录树重拉排在
  // 微任务里，桩要留到收尾结算后（提前还原会让它打真网络，落进 fetchDir 的静默失败）
  check("↻ 点击立即重拉索引（/dsh-kit/vault/index）", fetched.some((u) => u.includes("/dsh-kit/vault/index")));
  comps.vaultSideSlot.set(null);
  comps.setKitUi({ vaultSideOpen: false, vaultSideTab: "vault", vaultOpen: false, activeFeature: null });
  stateSeq = 0;
  stateStore.clear();
}
// 目录行有没有展开箭头靠 dirHasChildren 的前缀比较（relUnder 的结果 vs 索引里的
// 页 rel）：Windows 的大小写不敏感只能用于**比较**，返回段折了大小写就跟
// Project / R / 本机（DESKTOP-…）这类带大写的目录永远对不上——行上没箭头，
// 点了也不展开，整棵子树都看不见
{
  const V = "D:\\agent\\.dsh\\dsh-kit\\vault";
  check(
    "relUnder：Windows 折叠大小写只用于比较，返回段保留原样",
    comps.relUnder(V, "D:/AGENT/.dsh/DSH-KIT/VAULT/Project") === "Project" &&
      comps.relUnder(V, V + "\\本机（DESKTOP-6EMI7H3）") === "本机（DESKTOP-6EMI7H3）" &&
      comps.relUnder(V, V + "\\Project\\dsh-kit") === "Project/dsh-kit" &&
      comps.relUnder(V, V) === "" &&
      comps.relUnder(V, "D:\\agent\\.dsh\\dsh-kit\\other") === null,
  );
  check(
    "relUnder：POSIX 根仍大小写敏感（Linux 上同名不同大小写是两个目录）",
    comps.relUnder("/a/Vault", "/a/vault/x") === null && comps.relUnder("/a/Vault", "/a/Vault/x") === "x",
  );
}
// 6.9a2c) 侧栏搜索命中合成（vaultSearchHits）：笔记命中（宿主全文搜索，已打分）+
// 笔记目录 + 资料库文件/目录（只按名字匹配）合成一张表，一把尺子排序
{
  const hits = comps.vaultSearchHits(
    "统计",
    "D:/v",
    [{ path: "D:/v/统计/正文.md", rel: "统计/正文", snippet: "…统计…", score: 10 }],
    ["wiki", "统计"],
    [
      { path: "D:/v/library/统计.pdf", rel: "统计.pdf", dir: false },
      { path: "D:/v/library/大学", rel: "大学", dir: true },
    ],
  );
  const kinds = hits.map((h) => h.kind).join(",");
  check("搜索命中合成：笔记目录 + 资料库文件 + 笔记页（名字不像的不掺进来）", hits.length === 3 && kinds === "libfile,dir,page");
  check("命中排序：分高的在前、同分按类型（能直接打开的在前）", hits[0].kind === "libfile" && hits[1].kind === "dir" && hits[2].kind === "page");
  check(
    "命中行带来源说明与可打开路径（文件 = 盘上路径、目录 = root 拼接）",
    ["资料库 · 根目录", "Library · root"].includes(hits[0].sub) &&
      hits[0].path === "D:/v/library/统计.pdf" &&
      hits[0].label === "统计.pdf" &&
      hits[1].path === "D:/v/统计" &&
      ["笔记 · 根目录", "Note · root"].includes(hits[1].sub) &&
      hits[2].sub === "…统计…",
  );
  const libDirHits = comps.vaultSearchHits("大学", "D:/v", [], [], [{ path: "D:/v/library/大学", rel: "大学", dir: true }]);
  check("资料库目录也搜得到（点它在树上定位，与笔记目录分道）", libDirHits.length === 1 && libDirHits[0].kind === "libdir" && libDirHits[0].path === "D:/v/library/大学");
  check("空词/纯空白回空表", comps.vaultSearchHits("   ", "D:/v", [], [], []).length === 0);
  check("多词是 AND（一个词没中就不进表）", comps.vaultSearchHits("统计 不存在", "D:/v", [], [], []).length === 0);
  check("relUnder：base 内的相对路径（分隔符归一、大小写按盘符规则）", comps.relUnder("D:\\v", "D:/v/wiki/a.md") === "wiki/a.md" && comps.relUnder("D:\\v", "D:/other/a.md") === null);
}
// 6.9a2b) TreeRowMenu 直渲（文件树与知识库共用）：菜单项按 actions 有无决定——
// 两个宿主都传的只有 onRename/onDelete，知识库行 ⋯ 因此是「重命名 + 删除」。
// 同时守一条结构事实：「点菜单外关闭」只能有 TreeRowMenu 里那一份实现（宿主各写
// 一份必漏——知识库就是这么漏成「菜单点不开也点不掉」的）
{
  const rect = { left: 10, top: 100, bottom: 120, right: 30, width: 20, height: 20 };
  const entry = { dir: false, name: "a.md", path: "D:/v/wiki/a.md" };
  callLog = [];
  comps.TreeRowMenu({ entry, rect, actions: { onRename: () => {}, onDelete: () => {} }, onClose: () => {} });
  const menu = callLog.find((c) => c[2] && c[2].className === "dshk-menu");
  const labels = menu ? menu[2].children.map((b) => b.props.children) : [];
  check(
    "行 ⋯ 菜单：重命名 + 删除（两枚都在，顺序稳定）",
    labels.length === 2 && ["重命名", "Rename"].includes(labels[0]) && ["删除", "Delete"].includes(labels[1]),
  );
  callLog = [];
  comps.TreeRowMenu({ entry, rect, actions: { onRename: () => {} }, onClose: () => {} });
  const onlyRename = callLog.find((c) => c[2] && c[2].className === "dshk-menu");
  check("行 ⋯ 菜单：没传的 actions 不出项（不会点出空菜单项）", !!onlyRename && onlyRename[2].children.length === 1);
  // 目录行：多出「新建」一项，标签由宿主覆盖（文件树=新建文件/目录、知识库=新建页面/目录）
  callLog = [];
  comps.TreeRowMenu({
    entry: { dir: true, name: "wiki", path: "D:/v/wiki" },
    rect,
    actions: { onCreate: () => {}, newLabel: "新建页面/目录", onRename: () => {}, onDelete: () => {} },
    onClose: () => {},
  });
  const dirMenu = callLog.find((c) => c[2] && c[2].className === "dshk-menu");
  const dirLabels = dirMenu ? dirMenu[2].children.map((b) => b.props.children) : [];
  check(
    "目录行 ⋯ 三项：新建（标签可覆盖）+ 重命名 + 删除",
    dirLabels.length === 3 && dirLabels[0] === "新建页面/目录" && ["重命名", "Rename"].includes(dirLabels[1]) && ["删除", "Delete"].includes(dirLabels[2]),
  );
  check(
    "「点菜单外关闭」只有 TreeRowMenu 一份实现",
    (src.match(/closest\("\.dshk-menu"\)/g) ?? []).length === 1,
  );
}
// 6.9b) VaultPagePane 直渲（所见即所得编辑视图）：预置 state#0（page 已加载）走完整
// 编辑面——页条（撤销/重做 + 阅读条目录/反链）+ RTE；@ 与删除仍只在左树侧，
// 冲突条只在盘上被抢写后出现（预置态不出）
{
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { loading: false, body: "# 标题\n\n正文", binary: false, gone: false });
  callLog = [];
  let paneErr = null;
  try {
    comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: true, root: "D:/v", indexPages: [], onOpenPage: () => {}, onIndexRefresh: () => {}, toast: () => {} });
  } catch (e) {
    paneErr = e;
  }
  const editbar = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-editbar");
  // @ 挂在左侧树的文件行上，页条里不该再有它（「页条不得有 @」的回归哨兵）
  const citeBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["引用到对话", "Cite to chat"].includes(c[2].title));
  // 删除同理在树上行的 ⋯ 菜单：页条里不得再有「删除」按钮/文案
  const delBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["删除", "Delete"].includes(c[2].children));
  // 文档级命令：撤销 / 重做（行内格式在泡泡菜单、块插入在斜杠菜单，都不进页条）
  const undoBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].children === "↶");
  const redoBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].children === "↷");
  const rte = callLog.find((c) => c[1] === comps.RteEditor);
  // 阅读条两枚页面级入口：目录 / 反链（计数印在按钮上）
  const tocBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["目录", "Outline"].includes(c[2].children));
  const blBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("反链") || c[2].children.startsWith("Backlinks")));
  const conflictBar = callLog.find((c) => c[2] && c[2].className === "dshk-vault-conflict");
  check("VaultPagePane 渲染无异常（页条 + RTE 就位，页条不带 @）", paneErr === null && !!editbar && !citeBtn && !!rte);
  check("页条不再带删除按钮（删除在左侧树的行 ⋯ 菜单）", !delBtn);
  check("页条带撤销/重做 + 阅读条目录/反链，无冲突条（预置态盘上没被抢写）", !!undoBtn && !!redoBtn && !!tocBtn && !!blBtn && !conflictBar);
  if (paneErr) console.log("  VaultPagePane error:", paneErr.message);
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: true, root: "D:/v", indexPages: [], onOpenPage: () => {}, onIndexRefresh: () => {}, toast: () => {} });
  const paneRoot = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-reader");
  check("VaultPagePane 一页一签：正文常显（显隐归官方签条，不再自管 display）", !!paneRoot && paneRoot[2].style === undefined);
  stateSeq = 0;
  stateStore.clear();
}
// 6.9b') PDF 阅读器：版面尺寸走 CSS（宽度百分比 + aspect-ratio），锚点与落位一律
// 现量 DOM。假 DOM 把「页盒矩形是视口坐标、随 scrollTop 位移」实现出来——锚点 ↔
// 滚动量必须往返一致，否则「记住上次读到哪」与拖分栏后的重钉都会飘
{
  const { pdfAnchorAt, pdfScrollFor, pdfTopRatio, pdfBaseWidth } = comps;
  // ── 适宽基准：多数页的宽度（宽窄混排不抖），撞个数取宽的
  const mk = (w, n) => Array.from({ length: n }, () => ({ w, h: 792 }));
  check(
    "适宽基准取多数页的页宽（宽窄混排不抖，撞个数取宽的）",
    pdfBaseWidth([...mk(612, 5), ...mk(306, 3)]) === 612 && pdfBaseWidth([...mk(612, 2), ...mk(306, 2)]) === 612,
  );
  check("适宽基准：空页表给 0", pdfBaseWidth([]) === 0);

  // ── 假 DOM
  const fakePdfDom = (opts) => {
    const o = { frameTop: 0, clientHeight: 300, scrollTop: 0, gap: 12, height: 100, count: 3, ...opts };
    const topOf = (i) => i * (o.height + o.gap);
    const pages = Array.from({ length: o.count }, (_, i) => ({
      num: i + 1,
      getAttribute: (k) => (k === "data-pdf-page" ? String(i + 1) : null),
      getBoundingClientRect: () => {
        const top = o.frameTop + topOf(i) - o.scrollTop;
        return { top, bottom: top + o.height, height: o.height };
      },
    }));
    const root = {
      clientHeight: o.clientHeight,
      scrollTop: o.scrollTop,
      scrollHeight: topOf(o.count - 1) + o.height + o.clientHeight,
      getBoundingClientRect: () => ({ top: o.frameTop }),
      querySelector: (sel) => {
        const m = /data-pdf-page="(\d+)"/.exec(sel);
        return m === null ? null : pages[Number(m[1]) - 1] ?? null;
      },
    };
    return { root, host: { children: pages }, page: (n) => pages[n - 1] };
  };

  // 锚点 = 视口中线落在哪一页的哪个比例（不是页顶）
  {
    const d = fakePdfDom({ count: 6, scrollTop: 100 });
    const a = pdfAnchorAt(d.root, d.host);
    check("锚点取视口中线那一页（中线口径，不是页顶）", a.page === 3 && Math.abs(a.ratio - 0.26) < 1e-9, a);
  }
  // 锚点 ↔ 滚动量往返：页内比例不能漂（这就是拖分栏重钉的正确性）
  {
    const rt = [0, 60, 140, 260].map((scrollTop) => {
      const d = fakePdfDom({ count: 6, scrollTop });
      return { scrollTop, want: pdfScrollFor(d.root, pdfAnchorAt(d.root, d.host)) };
    });
    check("锚点 ↔ 滚动量往返一致（页内比例不回漂）", rt.every((r) => Math.abs(r.want - r.scrollTop) < 1e-9), rt);
  }
  // 容器没高度（这张签隐着）/ 目标页还没排出来时给 null —— 别把位置抹成 0
  {
    const d = fakePdfDom({ clientHeight: 0 });
    check(
      "签不可见时锚点与落位都给 null（不把位置抹成 0）",
      pdfAnchorAt(d.root, d.host) === null && pdfScrollFor(d.root, { page: 2, ratio: 0 }) === null,
    );
  }
  {
    const d = fakePdfDom({});
    check("目标页还没排出来时落位给 null", pdfScrollFor(d.root, { page: 99, ratio: 0 }) === null);
    check("页表空时锚点给 null", pdfAnchorAt(d.root, { children: [] }) === null);
  }
  // 「页顶对着视口顶」换算成中线口径（页码跳转 / 进场落位走它）
  {
    const d = fakePdfDom({ height: 400 });
    const want = pdfScrollFor(d.root, { page: 2, ratio: pdfTopRatio(d.root, d.page(2)) });
    const at = fakePdfDom({ height: 400, scrollTop: want });
    check(
      "页码跳转 = 该页页顶对齐视口顶",
      Math.abs(at.page(2).getBoundingClientRect().top - at.root.getBoundingClientRect().top) < 1e-9,
    );
  }

  // ── 渲染体
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  let pdfErr = null;
  try {
    comps.VaultPdfPane({ path: "D:/v/library/a.pdf", active: true });
  } catch (e) {
    pdfErr = e;
  }
  const opening = callLog.find((c) => c[2] && typeof c[2].children === "string" && c[2].children.includes("PDF"));
  check("VaultPdfPane 渲染无异常且未就位时给加载态", pdfErr === null && !!opening);
  if (pdfErr) console.log("  VaultPdfPane error:", pdfErr.message);
  // 文档已就位那条路（工具条 + 全篇页盒）：预置 useState 顺序
  //  doc/lib/boxes/ident/error/notice/containerW/rasterW/curPage/visible/attempt
  stateSeq = 0;
  stateStore.clear();
  const fakeDoc = { numPages: 3, getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }) };
  stateStore.set(0, fakeDoc);
  stateStore.set(1, { TextLayer: function TextLayer() {} });
  stateStore.set(2, [{ w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 }]);
  stateStore.set(3, "ident");
  stateStore.set(4, null);
  stateStore.set(5, null);
  stateStore.set(6, 575);
  stateStore.set(7, 575);
  stateStore.set(8, 2);
  stateStore.set(9, new Set([0, 1, 2]));
  stateStore.set(10, 0);
  callLog = [];
  let readyErr = null;
  try {
    comps.VaultPdfPane({ path: "D:/v/library/a.pdf", active: true });
  } catch (e) {
    readyErr = e;
  }
  const bar = callLog.find((c) => c[2] && c[2].className === "dshk-pdf-bar");
  const scroll = callLog.find((c) => c[2] && c[2].className === "dshk-pdf-scroll");
  // 页盒是子组件，桩不展开它的 DOM：直接查 children 里有没有 3 个
  const docBox = scroll && scroll[2] && Array.isArray(scroll[2].children) ? scroll[2].children[0] : null;
  const pageBoxes = docBox && docBox.props && Array.isArray(docBox.props.children) ? docBox.props.children : [];
  check(
    "滚动容器与文档盒的 children 真挂在 props 上（jsx 第三参是 key，放错位置会全丢）",
    !!scroll && Array.isArray(scroll[2].children) && docBox !== null && docBox.props.className === "dshk-pdf-doc" && pageBoxes.length === 3,
  );
  check("VaultPdfPane 文档就位后渲染工具条 + 全篇页盒", readyErr === null && !!bar && !!scroll && pageBoxes.length === 3);
  // 页盒的尺寸交给 CSS：宽度百分比 + aspect-ratio，React 不写内联宽高
  check(
    "页盒尺寸交给 CSS（宽度百分比 + aspect-ratio，不写内联宽高）",
    readyErr === null &&
      pageBoxes.every(
        (b) =>
          b.props &&
          b.props.box &&
          b.props.box.w === 612 &&
          b.props.base === 612 &&
          b.props.rasterW === 575 &&
          b.props.visible === true,
      ),
  );
  check(
    "文档盒占满内容宽（页宽的百分比得有个确定的分母）",
    /\.dshk-pdf-doc\{[^}]*width:100%/.test(src) && !/\.dshk-pdf-doc\{[^}]*margin:0 auto/.test(src),
  );
  check(
    "页盒走 CSS 尺寸（calc 百分比宽 + aspect-ratio）",
    /style: \{ width: "calc\(100% \* " \+ ratio \+ "\)", aspectRatio: box\.w \+ " \/ " \+ box\.h \}/.test(src),
  );
  check("页盒 memo 住（拖栏宽时 props 不变，重排交给浏览器）", /const PdfPageBox = react\.memo\(/.test(src));
  // 钉位不写依赖表：页高可能在任意一次 commit 里变，挂依赖表必然漏帧
  check(
    "钉位每次 commit 都做 + 下一帧复核（不写依赖表）",
    /钉位[\s\S]*?react\.useLayoutEffect\(\(\) => \{[\s\S]*?\n      \}\);/.test(src),
  );
  // 锚点只由用户滚动改写：改栏宽那一刻回读 scrollTop 量到的是中间态
  check("锚点只由用户滚动与页码跳转改写（改宽不回读 scrollTop）", /if \(fromScroll\) anchorRef\.current = a;/.test(src));
  check("容器宽量到 0 不改版面（收起 / 签不可见不是窄栏）", /if \(w <= 0 \|\| w === last\) return;/.test(src));
  check("光栅化去抖（拖着不逐帧重画画布）", /PDF_RASTER_SETTLE_MS/.test(src) && /setRasterW\(containerW\)/.test(src));
  check("阅读位置只落页码（页内比例不出阅读器）", /pdfPosWrite\(ident, \{ page: a\.page \}\)/.test(src));
  check("工具条只有页码与总页数（不做缩放档，栏宽是唯一版面旋钮）", !!bar && !callLog.some((c) => c[2] && c[2].className === "dshk-pdf-zooms"));
  const pdfPageRule = (src.match(/\.dshk-pdf-page\{[^}]*\}/) || [""])[0];
  check("PDF 页盒不留投影边框（页面边缘干净）", pdfPageRule.includes("background:#fff") && !pdfPageRule.includes("box-shadow"));
  check("滚动容器不进条件分支（否则栏宽永远量不到）", /className: "dshk-pdf-scroll", ref: scrollRef/.test(src));
  if (readyErr) console.log("  VaultPdfPane(ready) error:", readyErr.stack ?? readyErr.message);
  stateSeq = 0;
  stateStore.clear();
}
// 6.9c) 编辑面保存链路：落盘走 vault/write（mtime CAS 带 baseMtime，mtime 不符回
// conflict），粘贴图片走 vault/attach；RTE 可编辑 + 2s 防抖自动保存 + Ctrl+S +
// 切走即存；冲突条只在出冲突后出现，两钮给「覆盖盘上 / 读盘上的」
{
  check("RTE 恒为可编辑态（editable:true，无只读二分）", /editable: true/.test(src) && !/editable: false/.test(src));
  check("保存走 POST /dsh-kit/vault/write 且带 baseMtime CAS", src.includes('kitJson("/dsh-kit/vault/write"') && src.includes("baseMtime: base"));
  check("CAS 三态都接住了：ok 清脏 / conflict 出条 / missing 丢弃（不写活旧页）", src.includes('body.missing === true') && src.includes('body.modified === true') && src.includes('setConflict({ diskMtime:'));
  check("粘贴图片走 /dsh-kit/vault/attach（内容寻址入库后插图片节点）", src.includes('"/dsh-kit/vault/attach"') && src.includes("rteRef.current?.insertImage(body.rel"));
  check("自动保存 2s 防抖 + Ctrl+S 立即存 + 卸载/切走保底", /saveTimer = setTimeout\(flushSave, 2000\)/.test(src) && /e\.key === "s" \|\| e\.key === "S"/.test(src) && /卸载前尽力落盘/.test(src) && /rteCtlRef\.current\.flush\(\)/.test(src));
  check("冲突条两钮：覆盖盘上 / 读盘上的", src.includes('saveEditRef.current.overwrite()') && src.includes('saveEditRef.current.reload()'));
  check("编辑面不静默覆盖也不碰 git（写端点只回 modified，由人裁决）", !/stash|commitVault/.test(src));
}
// 6.9d) 编辑能力面：斜杠菜单含双链/流程图/图片、表格自定义行列、
// 流程图真出图（自带 mermaid）、双链只列已有页、表格命令搬上选区浮条
{
  check("斜杠菜单分组：图表（表格/流程图）+ 附件（图片），特殊块末尾双链", src.includes('labelKey: "vmenuGChart"') && src.includes('labelKey: "vmenuGAttach"') && src.includes('key: "wiki"') && src.includes('key: "mermaid"') && src.includes('key: "image"'));
  check("表格不再列 1×2~5×5 固定档（点开自己填行列，默认 3×3 带表头）", !src.includes("vmenuTable1") && !src.includes("vmenuTable5") && src.includes("setTDlg({ rows: 3, cols: 3 })") && src.includes("insertTable(rows, cols)"));
  check("H5/H6 不进菜单（正文里已有的照常渲染）", !src.includes('key: "h5"') && !src.includes('key: "h6"') && src.includes("/^h[1-6]$/.test(key)"));
  check("流程图真出图：编辑器懒加载钩子 + 宿主白名单放行 mermaid", src.includes("/dsh-kit/vendor/mermaid.min.js") && src.includes("window.__dshkMermaidLoad") && src.includes("window.DshRTE.mermaidReady()") && fs.readFileSync(__dirname + "/../src/index.ts", "utf8").includes("['/dsh-kit/vendor/mermaid.min.js', 'mermaid.min.js']") && fs.existsSync(__dirname + "/../client/vendor/mermaid.min.js"));
  check("双链选择框：只列库里已有的页、键盘选、重名时插 rel（不静默指向别的页）", src.includes("const pickRowsOf") && src.includes("pickInsert") && src.includes("const dup = (pagesRef.current ?? []).some") && src.includes('h.insertWikiLink({ target: dup ? p.rel.replace(/\\.md$/i, "") : base })') && /insertContent\(" "\)/.test(src));
  check("双链不监听 [[ 输入（字面文本要打得出来），建链只走菜单", !/__dshkWikiTrigger|wiki-link-trigger/.test(src));
  check("图片入口走系统文件选择器，与粘贴同一条入库管线", src.includes("input.accept = \"image/*\"") && src.includes("void attachAndInsert(files)") && src.includes("void attachAndInsert(files);"));
  check("表格命令在选区浮条：行/列增删 + 左中右对齐 + 表头列 + 删表", src.includes('children: "行↑"') && src.includes('children: "−列"') && src.includes('setCellAttribute("align", "center")') && src.includes("toggleHeaderColumn()") && src.includes('children: "✕表"'));
  check("页条不再挂表格按钮（浮条出条规则：选区落在表内）", !src.includes("vaultTableAddRow") && !src.includes("vaultTableDel"));
  check("Tab 手感：列表升降级、其余吃掉（不把焦点带出编辑器），Ctrl+Enter 跳出引用", src.includes('sinkListItem("listItem")') && src.includes('liftListItem("taskItem")') && src.includes('insertContentAt($from.after(d), { type: "paragraph" })'));
}
// 6.9e) 读端点限根 + 编辑器两处丢数据/失灵（就绪回调缺失、保存在途清脏）
{
  const hostFiles = fs.readFileSync(__dirname + "/../src/files/index.ts", "utf8");
  const hostCore = fs.readFileSync(__dirname + "/../src/core/readable-roots.ts", "utf8");
  const hostVault = fs.readFileSync(__dirname + "/../src/vault/index.ts", "utf8");
  const hostSkills = fs.readFileSync(__dirname + "/../src/skills/index.ts", "utf8");
  check("编辑器就绪真的回调 onReady（跨页锚点落位的唯一时机）", src.includes("onReadyRef.current?.()") && src.includes("onReady: onRteReady"));
  check("保存按编辑代数清脏（在途时的改动另有一次保存，不被无条件清零）", src.includes("editGenRef.current += 1") && src.includes("if (gen === editGenRef.current) dirtyRef.current = false;"));
  check("Ctrl+S 先撤防抖定时器（同内容不必再存一遍）", /clearTimeout\(saveTimer\);\s*saveTimer = null;/.test(src));
  check("图片引用先解 .. 再判界，越界不接管", src.includes("const abs = absJoinUnder(base, raw);") && src.includes("if (!isPathInsideVaultRoot(root, abs)) return \"\";"));
  check("读端点带工作区根（tree / diff 读 / 预览下载钮三处都带 cwd）", /function fetchTree\(path, signal, cwd\)/.test(src) && src.includes("fetchTree(dirPath, controller.signal, cwd)") && (src.match(/&cwd=\$\{encodeURIComponent/g) ?? []).length >= 2);
  check("服务端：tree/read/raw 三处都过根闸（readGate）", (hostFiles.match(/readGate\(url, /g) ?? []).length === 3 && hostFiles.includes("不在可读根内"));
  check("根集合来自注册表 + 请求 cwd，根自身不算内", hostCore.includes("export function registerReadableRoot") && hostCore.includes("export function withinReadable") && hostCore.includes("realpathSync") && hostCore.includes("trimmed === ''"));
  check("知识库与技能各自注册自己的可读根（根归属方才知道自己的根是谁）", hostVault.includes("registerReadableRoot('vault'") && hostSkills.includes("registerReadableRoot('skills'") && hostSkills.includes("resolveRoots(cwd)"));
}
// 6.9f) 共享目录一致性 + 保存串行化 + 浮层让路计数（评审批次二）
{
  const hostSchedule = fs.readFileSync(__dirname + "/../src/vault/schedule.ts", "utf8");
  const hostFs = fs.readFileSync(__dirname + "/../src/vault/fs.ts", "utf8");
  const hostVault2 = fs.readFileSync(__dirname + "/../src/vault/index.ts", "utf8");
  check("日程 store 每次调用与盘面对齐（别处写入可见、agent 更新不覆盖）", hostSchedule.includes("private sync(): void") && hostSchedule.includes("this.diskStamp()") && (hostSchedule.match(/this\.sync\(\)/g) ?? []).length >= 7);
  check("非法 recurrence 抛错而不是静默清空（patch 里 null 才是清空）", hostSchedule.includes("throw new Error('recurrence 不合法") && /if \(input\.recurrence === null\)/.test(hostSchedule));
  check("每月 29/30/31 号在短月落到当月最后一天（系列不静默断掉）", hostSchedule.includes("startDom > lastDom && dom === lastDom"));
  check("正文写回：tmp 名唯一 + rename 前再核一次 mtime（CAS 窗口收到最小）", hostFs.includes("crypto.randomBytes(6).toString('hex')") && hostFs.includes("const again = fs.statSync(target).mtimeMs") && hostFs.includes("if (again !== base)"));
  check("超限请求体回 413 而不是挂着（destroy 前先把 promise 落地）", hostVault2.includes("json(res, 413, { error: 'body too large' })") && hostVault2.includes("res.on('finish', () => req.destroy())") && hostVault2.includes("done(null)"));
  check("索引兜底形状与 VaultIndex 一致（folders，不是 spaces）", hostVault2.includes("{ root: null, folders: [], pages: [] }"));
  check("保存串行：控制面与自动保存共用一条队列（并发写必撞 CAS）", src.includes("let saving = false;") && src.includes("let queuedMode = null;") && src.includes("saveQueueRef.current = enqueueSave;") && src.includes("flush: enqueued(\"auto\")"));
  check("卸载保底用挂载那一刻的保存函数（ref 镜像此时已指向新页）", src.includes("const mountedSave = onSaveRef.current;") && src.includes("void mountedSave(rteRef.current.getMd(), \"auto\");"));
  check("Esc 让路按计数持有（两个浮层同开，先关的不撤销让路）", src.includes("const holdEsc = () =>") && src.includes("const releaseEsc = () =>") && (src.match(/holdEsc\(\);/g) ?? []).length === 3 && (src.match(/releaseEsc\(\);/g) ?? []).length === 4 && (src.match(/dock\.vaultSearch\.open = true;/g) ?? []).length === 1 && (src.match(/dock\.vaultSearch\.open = false;/g) ?? []).length === 0);
  check("读页上下文提交后发布（渲染期通知订阅者）+ 空页表用常量", src.includes("react.useEffect(() => {\n        const refreshIndex = () => void loadIndex();") && src.includes("?? VAULT_EMPTY_PAGES"));
  check("反链 memo 依赖稳定（每次渲染现造 [] 会让 useMemo 恒不命中）", src.includes("const backlinks = react.useMemo(() => vaultBacklinks(indexPages ?? [], path), [indexPages, path]);"));
  check("树路径按 root 的分隔符拼（缓存键/展开态/树上定位同一口径）", src.includes("return rel === \"\" ? base : absJoinUnder(base, rel);") && src.includes("samePath(el.getAttribute(\"title\"), revealPath)") && src.includes("const cur = joinRelPath(lib, segs.slice(0, i + 1).join(\"/\"));"));
  check("行内改名只有资料库文件按扩展名切选区（笔记页名含点不被截半）", src.includes("const renameInput = (entry, label, keepExt) =>") && src.includes("ev.currentTarget.setSelectionRange(0, keepExt && i > 0 ? i : v.length);") && src.includes("renameInput(e, e.name, false)"));
  check("批量导入失败报前三条 + 余量（不是只报首条）", src.includes("fails.slice(0, 3).join(\"；\")"));
  check("斜杠菜单查询变化即重置高亮（下标越界会插入没高亮那条）", src.includes("if (q !== menuRef.current?.query) {"));
  check("阅读位置重试可取消且宿主卸载即停", src.includes("const cancelRestore = restoreReadPos(") && src.includes("cancelRestore();") && src.includes("if (!el.isConnected) return;"));
  check("粘贴图透明探测走缩略探针（PNG 源直接保 PNG）", src.includes("const PASTE_PROBE_EDGE = 256;") && src.includes("await decodeImage(file, file.type === \"image/png\")") && !src.includes("getImageData(0, 0, el.naturalWidth, el.naturalHeight)"));
  check("库内非 md 相对链接交给 openVaultAsset（不是死点击；PDF 在自带阅读器开时走知识库签）", src.includes("onRelLink: (href) => {") && src.includes("else openVaultAsset(target);"));
  // tabVisible 内部调宿主钩子 useTabInfo：写在返回表达式里会被 early return 跳过，
  // 两次渲染钩子数对不上 → React #300，槽位静默整片空白
  check(
    "tabVisible 提到组件顶部无条件调用（返回表达式里调会触发 React #300）",
    src.includes("const active = tabVisible(props);") &&
      (src.match(/active: tabVisible\(props\)/g) ?? []).length === 0 &&
      src.indexOf("const active = tabVisible(props);") < src.indexOf("const root = reader.root"),
  );
  // children 必须挂在 props 上：宿主 jsx(type, props, key) 第三参是 key，放第三个位置
  // 会被 React 当 key 丢掉（子树整个不渲染，而 render-check 若把第三参当 children 就查不出）
  check(
    // 第三参是 key，不是 children：子列表一律用 props.children（行为哨兵见上）
    "jsx 无「第三参传 .map(...)」的写法",
    (src.match(/jsxRuntime\.jsx?s?\([^;]*?, [a-zA-Z_$][\w.$]*\.map\(/g) ?? []).length === 0,
  );
  check("周网格表头在滚动区之外（留在里面会被 sticky + y 轴吸附盖住全天带）", src.includes("className: \"dshk-sched-topgrid\"") && src.includes("scroll-padding-top:4px") && !/dshk-sched-dayhead\{position:sticky/.test(src));
  check("周统计跟着周导航取（口径钉 weekStart），拉取失败挂提示", src.includes("useScheduleData(true, weekStart)") && src.includes('date=${encodeURIComponent(statsDate ?? schedToday())}') && src.includes('className: "dshk-sched-headfail"') && src.includes('className: "dshk-sched-taskfail"'));
  check("全天带按列成栈 + 溢出折成 +N（平铺会全叠进同一网格单元）", src.includes("const SCHED_ALLDAY_MAX = 3;") && src.includes("const dateTodoByCol = react.useMemo") && src.includes('className: "dshk-sched-allday is-more"'));
  check("文档内链接走解析、带协议的外链走 openExternalUrl（openOnClick:false 下不接管就是死点击）", src.includes("onRelLink: (href) => {") && src.includes('if (!isDocHref(href)) {') && src.includes("openExternalUrl(href);") && src.includes('if (href === "" || href.startsWith("#")) return;') && src.includes('e.target.closest(".dshk-rte-langsel") !== null) return;'));
  check("外链打开只有一份实现：对话改投与编辑器点击共用 openExternalUrl", src.includes("function openExternalUrl(href) {") && (src.match(/openExternalUrl\(href\);/g) ?? []).length === 2 && (src.match(/kitJson\("\/dsh-kit\/browser\/open"/g) ?? []).length === 1);
  check("拖选后松手不触发外链跳转（click 时选区非折叠是在选字）", src.includes("if (sel && !sel.isCollapsed) return;"));
  check("代码块语言下拉有盒子样式（挂 body 的 fixed 浮层，缺样式就掉出视口）", /\.dshk-langdrop\{position:fixed/.test(src) && /\.dshk-langopt\{flex:none/.test(src) && /\.dshk-langempty\{/.test(src) && /\.dshk-langdrop\[hidden\]\{display:none\}/.test(src));
  check("mermaid 图块编辑态与公式块同副面孔（藏图 + 一个等宽源码框，不是提示行摞默认 textarea）", /\.dshk-mermaid\.is-editing \.dshk-mermaid-body\{display:none\}/.test(src) && /\.dshk-mermaid-input\{display:block/.test(src) && /\.dshk-mermaid\.is-editing\{background/.test(src) && /\.dshk-mermaid\.as-code \.dshk-mermaid-body\{/.test(src));
  check("斜杠菜单插空图块后编辑态还留在原地（焦点被编辑器抢回会当场收起）", src.includes("h.insertMermaidBlock();") && src.includes('requestAnimationFrame(() => rteHostRef.current?.querySelector(".dshk-mermaid")?.click());'));
  check("空图块退格删块（stopEvent 恒真，框与块都不动，得自己收；位置按 DOM 反查）", src.includes('ta.classList.contains("dshk-mermaid-input") && ta.value === ""') && src.includes("if (ed.view.nodeDOM(p) === wrap) { pos = p; return false; }") && src.includes("const view = ed.view;") && src.includes("view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos).nodeSize));") && !src.includes("const { state, view } = ed.view;"));
  check("gap cursor 画成竖光标（vendor 那条是 20px 横线，像横着的光标；只改 ::after，容器的 display 照旧）", /\.dshk-vault-rtehost \.ProseMirror-gapcursor:after\{[^}]*width:2px[^}]*height:1\.25em[^}]*border-top:none[^}]*background:currentColor/.test(src));
  check("正文区不画外框（这一面是页面不是输入框，边框会把整页框成一块编辑区）", /\.dshk-vault-rtehost\{[^}]*\}/.test(src) && !/\.dshk-vault-rtehost\{[^}]*border/.test(src));
}
// 6.9b2) 阅读条「反链 N」：计数印在按钮上（来源页列表在浮层里，不再吊页尾）
{
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { loading: false, body: "x", binary: false, gone: false });
  callLog = [];
  comps.VaultPagePane({
    path: "D:/v/wiki/a.md",
    active: true,
    root: "D:/v",
    indexPages: [
      { path: "D:/v/wiki/a.md", rel: "wiki/a", space: "wiki", links: [] },
      { path: "D:/v/wiki/b.md", rel: "wiki/b", space: "wiki", links: ["a"] },
    ],
    onOpenPage: () => {},
    onIndexRefresh: () => {},
    toast: () => {},
  });
  const blBtn2 = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("反链") || c[2].children.startsWith("Backlinks")));
  check("反链入口按钮带计数（反链 1）", !!blBtn2 && (blBtn2[2].children === "反链 1" || blBtn2[2].children === "Backlinks 1"));
  check("页尾反链小节已退役（CSS 不存在）", !/\.dshk-vault-backlinks\{/.test(src));
  stateSeq = 0;
  stateStore.clear();
}
// 文件标签（多开）在 7.2.2 覆盖，舞台不可收起在 7.2.4 覆盖

// 7.2.3) 文件标签 LRU 纯逻辑：默认上限 3，超限开新文件逐出 usedAt 最小者（=关掉
// 最久没看的那张标签）；重开已存在文件置顶激活不逐出自身
// 7.2.3) diff 签的 LRU 与来源标记随「地址 query」走：上限 3 张、超限逐出最久没看、
// 未跟踪/已删各是不同地址（=不同签）。签表归官方，这里只钉地址映射
const diffAddrOf = (p, q) => comps.rightbarAddress("file", p, q);
check("未跟踪 diff：地址带 u=1", comps.rightbarQuery("file", diffAddrOf("C:/x/gone.js", "u=1")) === "u=1");
check("已删 diff：地址带 d=1", comps.rightbarQuery("file", diffAddrOf("C:/x/gone.js", "d=1")) === "d=1");
check("同文件不同 diff 源是两张签（地址不同）", diffAddrOf("C:/x/gone.js", "u=1") !== diffAddrOf("C:/x/gone.js") && diffAddrOf("C:/x/hist.js") !== diffAddrOf("C:/x/other.js"));
comps.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 无hooks渲染无异常（根壳不渲染面板本体）", out === null);
// 更改视图/提交图谱/分支浮层直测在 tests\render-check-files.cjs；
// 技能管理页直测在 tests\render-check-skills.cjs
callLog = [];
const fakeHooks = {
  useSessions: (sel) => sel({ byId: { s1: { id: "s1", cwd: "C:/x", retainedBy: { mainView: 1 } } } }),
};
out = comps.KitSurfaces(fakeHooks);
check("KitSurfaces 带cwd渲染无异常（根壳不渲染面板本体）", out === null);


// 10c-10f）429 续跑器（G）/ 会话通知（N）/ 收尾判定 / 压缩完成（C）判定核心
//       在 dsh-kit/monitor 组件——检查在 tests/render-check-monitor.cjs



// 10e) 阅读位置记忆（F2）：按路径存取 + 隐藏容器不记（display:none 时 scrollTop
//      恒 0，记了会把真位置冲掉——非激活标签仍挂载，切走后的兜底路径会摸到这里）
{
  const visibleEl = { scrollTop: 1234, getClientRects: () => [{}] };
  const hiddenEl = { scrollTop: 0, getClientRects: () => [] };
  comps.recordReadPos("D:/w/long.md", visibleEl, 340);
  check("阅读位置记录：可见容器按路径存 scrollTop+锚点", comps.readPosStore.get("D:/w/long.md")?.scrollTop === 1234 && comps.readPosStore.get("D:/w/long.md")?.anchor === 340);
  comps.recordReadPos("D:/w/long.md", hiddenEl, 999);
  check("阅读位置记录：隐藏容器跳过（不冲掉真位置）", comps.readPosStore.get("D:/w/long.md").anchor === 340);
  comps.recordReadPos("D:/w/other.js", visibleEl, 12);
  check("阅读位置互不串扰（按路径分键）", comps.readPosStore.get("D:/w/other.js").scrollTop === 1234 && comps.readPosStore.get("D:/w/long.md").anchor === 340);
  comps.recordReadPos("D:/w/long.md", { scrollTop: 2222, getClientRects: () => [{}] }, 77);
  check("同路径重记录覆盖旧值", comps.readPosStore.get("D:/w/long.md").scrollTop === 2222 && comps.readPosStore.get("D:/w/long.md").anchor === 77);
}


// 9) 插件配置（声明式模型）：主行没有可调参数，因此不导出 Config、也没有配置页
//    （手机访问在 dsh-kit/phone 组件，字段与探针都在 src/phone/index.ts）。
//    这里钉住「主行不再持有任何配置字段 / 默认表 / 配置页骨架」，避免退役字段借道回来。
{
  const hostSrc = fs.readFileSync(__dirname + "/../src/index.ts", "utf8");
  const hostCode = hostSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check(
    "主行无 Config / 无配置字段 / 无配置快照端点（行开关即唯一开关）",
    !/export const Config/.test(hostCode) && !hostCode.includes("volatile") && !hostCode.includes("/dsh-kit/config"),
  );
  check(
    "root client 不再持有配置默认表 / 字段表 / 配置页（随手机访问迁走）",
    !src.includes("const CFG_DEFAULTS = {") && !src.includes("const KIT_CFG_FIELDS = [") &&
      !src.includes("KitConfigPage") && !src.includes("applyConfigSnapshot"),
  );
}
// 10) 插件页组件列表形状：基础设施行无 id（宿主只把带 id 的行当组件，故不进列表），
//     八个组件行的行序 = 卡片描述的枚举顺序（宿主按 patch insert 原样渲染、不排序）
{
  const patchSrc = fs.readFileSync(__dirname + "/../cordis.patch.yml", "utf8");
  const rows = [];
  let current = null;
  for (const line of patchSrc.split("\n")) {
    const withId = /^ {4}- id: (.+)$/.exec(line);
    const bare = /^ {4}- name: (.+)$/.exec(line);
    const nameOf = /^ {6}name: (.+)$/.exec(line);
    if (withId) rows.push(current = { id: withId[1].trim() });
    else if (bare) rows.push(current = { id: undefined, name: bare[1].trim() });
    else if (nameOf && current !== null && current.name === undefined) current.name = nameOf[1].trim();
  }
  const comps = rows.filter((row) => typeof row.id === "string");
  const infra = rows.filter((row) => row.id === undefined);
  const expected = ["files", "chat", "vault", "terminal", "browser", "skills", "phone", "monitor", "search"];
  check(
    "patch 形状：基础设施行无 id（不进组件列表）、九个组件行 id/name 齐备且顺序 = 描述顺序",
    infra.length === 1 && infra[0].name === "dsh-kit" &&
      JSON.stringify(comps.map((row) => row.id)) === JSON.stringify(expected) &&
      comps.every((row) => row.name === "dsh-kit/" + row.id),
  );
  const inOrder = (text, words) => {
    const at = words.map((word) => text.indexOf(word));
    return at.every((p) => p >= 0) && at.every((p, i) => i === 0 || p > at[i - 1]);
  };
  const zhDesc = JSON.parse(fs.readFileSync(__dirname + "/../locale/zh.json", "utf8")).meta.description;
  const enDesc = JSON.parse(fs.readFileSync(__dirname + "/../locale/en.json", "utf8")).meta.description;
  check(
    "卡片描述按同一顺序枚举九个组件（zh/en 同序）",
    inOrder(zhDesc, ["文件树·源代码管理", "对话小窗", "知识库·日程", "终端", "浏览器", "技能", "手机访问", "用量与监视", "网页搜索"]) &&
      inOrder(enDesc, ["File tree & SCM", "chat window", "vault & schedule", "terminal", "browser", "skills", "phone access", "usage & monitor", "web search"]),
  );
}

// 过时文案清理：现行说明不得出现「侧栏底部『任务』钮」、日程索引标题键、搜索默认 5
check(
  "过时文案已更新（无侧栏底部钮现行说法/默认 5/schedIdxTitle）",
  !src.includes("侧栏底部「") && !src.includes("默认 5") && !src.includes("schedIdxTitle"),
);
// OpenCode Go 会话头是内置行为、不是配置项：i18n 键与写入端点都必须不存在；
// 注入机制本身由 test-opencode-session.mjs 覆盖
check(
  "OpenCode Go 会话头不在配置里（i18n 键与端点均移除）",
  !src.includes("cfgOpenCodeSession") && !src.includes('"/dsh-kit/opencode-session"'),
);

// 工作区文件编辑/预览面已退役（树与对话区点击改投官方右栏文件签，diff 签归 SCM
// 专用）：CM/编辑区/保存链路/pdf·xlsx·docx 沙箱与其 vendor 都不得再出现
check(
  "工作区文件编辑预览面已退役（CM/编辑区/write 端点/沙箱库全链移除）",
  !src.includes("dshk-cm-host") && !src.includes("dshk-editarea") && !src.includes("setCmHost") &&
    !src.includes("window.CM6") && !src.includes('"/dsh-kit/write"') && !src.includes("/dsh-kit/vendor/pdf.min.js") &&
    !src.includes("mountPdfViewer") && !src.includes("dshk-sheetwrap") && !src.includes("dshk-docwrap"),
);

// 日程的待办清单在侧栏「日程」tab（与知识库同一格，tab 条切换），网格在右栏签：
// 但它仍**不做专属快捷键**——旧实现那套 schedIdxOpen / schedShortcut /
// ScheduleIndexView 的独立侧栏索引与按键不得复活
check(
  "日程不做专属快捷键（schedIdxOpen/schedShortcut/ScheduleIndexView 全链不存在）",
  !src.includes("schedIdxOpen") && !src.includes("schedShortcut") && !src.includes("cfgSchedShortcut") && !src.includes("ScheduleIndexView"),
);
// 右栏开始页不再给日程条目：入口 = 左栏 tab 条 + 输入行两枚钮，guide 与那条词条都退场
check(
  "右栏日程签不再给开始页条目（知识库·日程两张都不给 guide，词条一并退场）",
  !src.includes("rbGuideSchedDesc") && !src.includes("const guideOf =") && src.includes("rbGuideBrowserDesc"),
);
// 键位整体改由宿主 shortcuts 服务持有（官方「快捷键」页）：自带快捷键
// 配置项/全局 keydown 匹配/左栏键都不该再出现，注册面在 client 半边（见下方 apply 钉子）
check(
  "自带快捷键配置项全退役（terminal/vault/rightbar/sidebar Shortcut 字段与自绘匹配都不在）",
  !src.includes("Shortcut\"") && !src.includes("parseCombo") && !src.includes("comboMatches") &&
    !src.includes("dshk-cfgp-kbd") && !src.includes("function toggleSidebar"),
);
// 文件树没有「上传文件到当前目录」：按钮/隐藏 input/上传逻辑/i18n 键都不得存在；
// vault 附件上传仍走 /dsh-kit/upload（端点保留）
check(
  "文件树上没有上传按钮与逻辑（vault 附件上传不受影响）",
  !src.includes("UploadIcon") && !src.includes("treeUpload") && !src.includes("uploadDone") && !src.includes("uploadFail"),
);
// 悬停提示不再自带原生 title（知识库入口钮改由 KitTip 出官方气泡）
check("入口钮的悬停不再自带原生 title（全走官方气泡）", !/dshk-enbtn"[\s\S]{0,120}?\n\s*title:/.test(src));
// 终端半边已收回根包（单包组件化）：坞/图标/xterm 胶水/命令注册/样式都在本 bundle，
// 正向钉住见 tests\render-check-terminal.cjs（comps = dockExports.terminal）

// 至少渲染出来 JSX 元素（说明走到 render 而非静默 null）。根壳（KitSurfaces）只做座位
// 门控、恒返回 null，这里用右栏 diff 正文（座组件）确认 JSX 真走到 render。
callLog = [];
comps.diffPane.Component = fakeDiff;
comps.FilePaneBody(tabProps(comps.rightbarAddress("file", "D:/w/a.md")));
check("渲染体实际产出元素", callLog.length > 0);
// 收尾结算放进 setTimeout：6.9c 里 ↻ 刷新的目录树重拉排在 await loadIndex()
// 之后的微任务里，同步段看不到；微任务先于定时器清空，此刻断言才成立
setTimeout(async () => {
  const treeHits = vaultRefreshFetched.filter((u) => u.includes("/dsh-kit/tree"));
  check("↻ 刷新连带重拉每个已展开目录（6.9c 预置了 3 个）", treeHits.length === 3);
  // kit 端点包装（kitGetJson/kitPostJson/kitJson）：回包约定收在一处后的行为契约。
  // 2xx 且形状断言通过才算成功，失败带宿主 error 原文与 status——写文件的 409
  // 冲突分流就靠 status/body，这里把契约钉死
  // kit 端点包装契约直调（业务函数在 dsh-kit/files 组件，契约本身收在 kitBase
  // 的三件套里，直调覆盖同一行为）
  {
    const calls = [];
    let scripted = { status: 200, body: {} };
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return { ok: scripted.status >= 200 && scripted.status < 300, status: scripted.status, json: async () => scripted.body };
    };
    const rejection = async (p) => {
      try { await p; return null; } catch (e) { return e; }
    };
    const shape = (b) => Array.isArray(b.entries);
    scripted = { status: 200, body: { entries: [{ name: "a" }] } };
    const okBody = await comps.kitGetJson("/dsh-kit/tree?path=%2Fw", undefined, shape);
    check("kitGetJson：2xx + 形状通过 → 回包直通", okBody.entries.length === 1 && calls[0].url === "/dsh-kit/tree?path=%2Fw");
    scripted = { status: 200, body: { nope: 1 } };
    const shapeErr = await rejection(comps.kitGetJson("/dsh-kit/tree?path=%2Fw", undefined, shape));
    check("kitGetJson：形状不符 → 抛错（半个回包不当成功）", !!shapeErr && shapeErr.message === "HTTP 200");
    scripted = { status: 500, body: { error: "boom" } };
    const netErr = await rejection(comps.kitGetJson("/dsh-kit/any", undefined, shape));
    check("kitGetJson：非 2xx → 抛错带宿主 error 与 status", !!netErr && netErr.message === "boom" && netErr.status === 500);
    scripted = { status: 200, body: { ok: false, error: "nope" } };
    const okErr = await rejection(comps.kitPostJson("/dsh-kit/any", { cwd: "C:/w" }, (b) => b.ok === true));
    check("kitPostJson：回包显式 ok:false → 也算失败", !!okErr && okErr.message === "nope");
    scripted = { status: 200, body: { ok: true, created: true } };
    const init = await comps.kitPostJson("/dsh-kit/any", { cwd: "C:/w" }, (b) => b.created === true);
    const last = calls[calls.length - 1];
    check(
      "kitPostJson：POST + JSON 头 + body 原样发出",
      init.created === true && last.opts.method === "POST" && last.opts.headers["content-type"] === "application/json" && JSON.parse(last.opts.body).cwd === "C:/w",
    );
    scripted = { status: 409, body: { error: "conflict", mtimeMs: 7 } };
    const conflict = await rejection(comps.kitPostJson("/dsh-kit/write", {}));
    check("kitPostJson：失败带 status/body（写文件按 409 进冲突条）", !!conflict && conflict.status === 409 && conflict.body.mtimeMs === 7);
  }
  // 日程写路径（面板浮层 + 悬浮球）：渲染体出表单，写请求的 op 载荷逐个钉住。
  // 桩不重渲染，所以每次改完表单字段要再渲染一次拿新 state（与 React 同序）
  {
    const calls = [];
    const prevFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(String((opts || {}).body || "{}")) });
      return { ok: true, status: 200, json: async () => ({ event: { id: "x" }, entry: {}, deleted: true, stopped: true }) };
    };
    // 重渲染：stateSeq 归零让下一次渲染读回同一批 state 槽（桩按递增 id 存 state，
    // 不归零就等于换了一批空槽——与 React「改完再渲一次」同序）
    const rerender = (fn) => {
      stateSeq = 0;
      callLog = [];
      fn();
      return callLog.filter((c) => c[2] || c[1]);
    };
    const inputsOf = () => callLog.filter((c) => c[2] && c[2].className === "dshk-vault-modalinput").map((c) => c[2]);
    const fieldRows = () => callLog.filter((c) => c[2] && c[2].className === "dshk-sched-field");
    const pressPrimary = async () => {
      const btn = callLog.filter((c) => c[2] && c[2].className === "dshk-btn-primary").pop();
      await btn[2].onClick();
      return calls[calls.length - 1];
    };
    // 新建待办：只发 title / due，kind 派生的 start / end / recurrence 显式清空
    stateSeq = 0;
    stateStore.clear();
    let rows = rerender(() => comps.SchedEventDialog({ ev: null, onClose: () => {} }));
    let fields = inputsOf();
    check("新建浮层：标题 + 截止日 + 时刻（待办默认无期限）", fields.length >= 3 && fields[0].type === "text" && fields[1].type === "date" && fields[2].type === "time");
    check("条目浮层一行一项（待办 5 行：标题/类型/截止/地点/备注）", fieldRows().length === 5);
    check("类型行不套 label（点标签不该等于点第一枚按钮）", fieldRows()[1][1] === "div");
    fields[0].onChange({ target: { value: "写周报" } });
    inputsOf()[1].onChange({ target: { value: "2026-10-05" } });
    rows = rerender(() => comps.SchedEventDialog({ ev: null, onClose: () => {} }));
    const created = await pressPrimary();
    check(
      "待办保存：op=create，落 title/due，start/end/recurrence 清成 null（成对由宿主校验）",
      created.url === "/dsh-kit/schedule/op" && created.body.op === "create" && created.body.input.title === "写周报" &&
        created.body.input.due === "2026-10-05" && created.body.input.start === null &&
        created.body.input.end === null && created.body.input.recurrence === null,
    );
    // 改已有日程：起止与重复规则原样带回，完成勾选走 completedAt（不是独立 op）
    stateSeq = 0;
    stateStore.clear();
    const ev = { id: "e1", title: "例会", start: "2026-10-06T09:00", end: "2026-10-06T10:00", recurrence: { type: "weekly", days: [2] }, completedAt: "2026-10-06T10:05" };
    rerender(() => comps.SchedEventDialog({ ev, onClose: () => {} }));
    // 最长的组合（日程 + 每周重复）：标题/类型/开始/结束/重复/每/每周/重复到/地点/备注 10 行 + 完成勾选 1 行，一次排完
    check("日程 + 周重复 10 行 + 完成勾选一次排完（不靠滚动）",
      fieldRows().length === 10 && callLog.filter((c) => c[2] && c[2].className === "dshk-sched-checkline").length === 1);
    const updated = await pressPrimary();
    check(
      "日程保存：op=update + id，起止与重复规则原样带回",
      updated.body.op === "update" && updated.body.id === "e1" && updated.body.patch.start === "2026-10-06T09:00" &&
        updated.body.patch.end === "2026-10-06T10:00" && updated.body.patch.recurrence.type === "weekly" &&
        updated.body.patch.due === null,
    );
    // 取消完成：completedAt 显式 null（面板不另开一个 done 分支）
    stateSeq = 0;
    stateStore.clear();
    rerender(() => comps.SchedEventDialog({ ev: { id: "e2", title: "写周报" }, onClose: () => {} }));
    const undone = await pressPrimary();
    check("取消完成：completedAt=null（待办无 start 时不补 due）", undone.body.patch.completedAt === null && undone.body.patch.due === null);
    // 独立计时：标题必填（有标题才发请求）
    stateSeq = 0;
    stateStore.clear();
    rerender(() => comps.SchedTimerStartDialog({ events: [{ id: "t1", title: "交报告", due: "2026-10-05" }], onClose: () => {} }));
    check("开始计时浮层列出未完成待办", callLog.filter((c) => c[2] && c[2].type === "radio").length === 1);
    inputsOf()[0].onChange({ target: { value: "读文献" } });
    rerender(() => comps.SchedTimerStartDialog({ events: [], onClose: () => {} }));
    const started = await pressPrimary();
    check("独立计时：op=timer-start 带标题", started.body.op === "timer-start" && started.body.title === "读文献");
    // 计时段编辑：起止 + 备注走 entry-update，owner 空 = 独立段
    stateSeq = 0;
    stateStore.clear();
    rerender(() => comps.SchedEntryDialog({ owner: null, index: 2, entry: { id: "s1", start: "2026-10-02T09:00", end: "2026-10-02T10:00" }, onClose: () => {} }));
    const entrySave = await pressPrimary();
    check(
      "计时段保存：op=entry-update 带 owner/index 与起止",
      entrySave.body.op === "entry-update" && entrySave.body.owner === null && entrySave.body.index === 2 &&
        entrySave.body.patch.start === "2026-10-02T09:00" && entrySave.body.patch.end === "2026-10-02T10:00",
    );
    // 悬浮球：空闲不渲染；有表在跑就出走秒 + 停表
    stateSeq = 0;
    stateStore.clear();
    let ball = comps.SchedTimerBall({});
    check("悬浮球空闲时不占位", ball === null || ball === undefined);
    stateSeq = 0;
    stateStore.clear();
    const ago = new Date(Date.now() - 90 * 1000);
    const p2 = (n) => String(n).padStart(2, "0");
    stateStore.set(0, { id: "", start: `${ago.getFullYear()}-${p2(ago.getMonth() + 1)}-${p2(ago.getDate())}T${p2(ago.getHours())}:${p2(ago.getMinutes())}:${p2(ago.getSeconds())}`, title: "读文献" });
    callLog = [];
    comps.SchedTimerBall({});
    const face = callLog.filter((c) => c[2] && c[2].className === "dshk-sched-balltime");
    check("悬浮球走秒（不足一小时 MM:SS，超过一小时 H:MM:SS）", face.length === 1 && /^\d\d:\d\d$/.test(String(face[0][2].children)) && /^\d+:\d\d:\d\d$/.test(comps.schedElapsed("2026-10-02T09:00:00", new Date(2026, 9, 2, 12, 30, 0).getTime())));
    global.fetch = prevFetch;
  }
  global.fetch = vaultFetchPrev;
  console.log(failed === 0 ? "ALL RENDER OK" : `${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}, 0);
