// 渲染级验证：桩掉 react hooks，直接函数调用 dsh-kit 的组件
// （TreeNode/FileTreePanel/DiffPane/TerminalEntry/FileTreeEntry/KitSurfaces/
// GitChangesPanel/SkillsManager/TerminalDock/TerminalPane），跑完整渲染体。
// TerminalDock/TerminalPane 通过 setKitUi 预置会话后渲染（防"有状态后才走到的分支"逃逸）。
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
  Fragment: function Fragment() {},
};
const jsxRuntimeStub = {
  Fragment: function Fragment() {},
  jsx: (type, props) => { callLog.push(["jsx", type, props]); return { type, props, $$dshk: "jsx" }; },
  jsxs: (type, props) => { callLog.push(["jsxs", type, props]); return { type, props, $$dshk: "jsxs" }; },
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
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ className: "", textContent: "", setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {} }),
    head: { appendChild: () => {} },
    body: { classList: { add() {}, remove() {} }, appendChild: () => {} },
  };
}
if (!global.window) {
  global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {} };
}
if (!global.location) {
  global.location = { protocol: "http:", host: "127.0.0.1:3081" };
}

// 2.5) 共享底座（kitBase）已内联进根包 factory：随本检查一并执行（CSS 注入等
//      副作用照跑），导出面直接落在根包 exports 上——断言见 comps 加载之后

// 3) 组装可执行的 factory 闭包，并导出组件（替换防 early-return）；
//    setKitUi/makeTerm 用于预置终端坞等依赖状态的渲染分支
const wrapper = body.replace(
  "return module.exports;",
  "return Object.assign({ vaultSideSlot, vaultPaneSlot, TerminalEntry, VaultEntry, PhoneSection, KitSurfaces, SkillsManager, TerminalDock, TerminalPane, TreeRowMenu, BrowserPanel, RteEditor, VaultPagePane, openFileTab, activateFileTab, closeFileTab, openFeatureTab, closeFeatureTab, openVaultPageTab, closeVaultPageTab, activateVaultPage, toggleVaultEntry, openVaultEntry, sidebarViewPatch, maybeAutoOpenBrowser, closeBrowserDockForGone, CFG_DEFAULTS, kitGetJson, kitPostJson, kitJson, fetchSkillsPage, getKitUi, setKitUi, makeTerm, ScheduleView, timerMinsOfDT, schedAssignLanes, VaultView, VaultRootView, vaultSplitFrontmatter, resolveVaultLink, vaultBacklinks, vaultOutline, vaultHeadingSlug, vaultSearchHits, relUnder, pathUnder, absParent, vaultTabsRetarget, vaultTabsClose, vaultDirChoices, VaultDialog, KitConfigPage, KIT_CFG_FIELDS, readPosStore, recordReadPos, FilePaneBody, VaultPaneBody, SchedulePaneBody, BrowserPaneBody, ScheduleTasksCard, openFeatureDock, openFileAndDock, openVaultPageAndDock, closeRightbarTab, isPathInsideVaultRoot, vaultCiteText, resolveMdLink, isDocHref, registerShortcuts, shortcutRun }, kitBase);",
);
const harness = new Function("require", wrapper);
const reactDomStub = {
  createPortal: (children, container, key) => { callLog.push(["portal", children, container, key]); return { type: "portal", props: { children, container, key }, $$dshk: "portal" }; },
};
const comps = harness((name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return reactDomStub;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected require: " + name);
});

// 共享底座（kitBase）导出面：已内联进根包 factory，直接落在 comps 上
const baseOk = [comps.kitGetJson, comps.kitPostJson, comps.kitJson, comps.flashToast, comps.writeClipboard, comps.mainRowOf, comps.createConfigPage, comps.setKitUi, comps.getKitUi, comps.subscribeLocale].every(
  (fn) => typeof fn === "function",
);
console.log((baseOk ? "PASS  " : "FAIL  ") + "底座共享面齐全（kit 三件套/轻提示/剪贴板/mainRowOf/createConfigPage/kitUi/locale store）");
if (!baseOk) process.exitCode = 1;

if (!comps || typeof comps !== "object") { console.log("FATAL: no components returned"); process.exit(2); }
const names = ["TerminalEntry", "VaultEntry", "PhoneSection", "KitSurfaces", "SkillsManager", "TerminalDock", "TerminalPane", "TreeRowMenu", "BrowserPanel", "RteEditor", "VaultPagePane", "openFeatureTab", "activateFileTab", "closeFileTab", "openVaultPageTab", "closeVaultPageTab", "activateVaultPage", "sidebarViewPatch", "toggleVaultEntry", "ScheduleView", "timerMinsOfDT", "schedAssignLanes", "VaultView", "VaultRootView", "vaultSplitFrontmatter", "resolveVaultLink", "vaultBacklinks", "vaultOutline", "vaultHeadingSlug", "vaultSearchHits", "relUnder", "pathUnder", "absParent", "vaultTabsRetarget", "vaultTabsClose", "vaultDirChoices", "VaultDialog", "KitConfigPage", "recordReadPos", "FilePaneBody", "VaultPaneBody", "SchedulePaneBody", "BrowserPaneBody", "ScheduleTasksCard", "openFeatureDock", "openFileAndDock", "openVaultPageAndDock", "closeRightbarTab", "isPathInsideVaultRoot", "vaultCiteText", "resolveMdLink", "isDocHref"];
for (const n of names) {
  if (typeof comps[n] !== "function") { console.log("FAIL: missing/not function:", n); process.exitCode = 1; return; }
}

let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
let out;
let copiedRel = null;

// 4c) TreeRowMenu：文件行菜单项含复制相对路径/重命名/删除；目录行另有新建两项
//（文件树迁 dsh-kit-files 后 TreeRowMenu 留底座被两边共用，直测留在这里）
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

// 5)/6) FileTreePanel 与 DiffPane 直测随组件迁 dsh-kit-files（tests\render-check-files.cjs）

// 7) 入口按钮 / 浮层宿主顶部渲染（conversation.input.left + shell.overlay 槽位）
callLog = [];
out = comps.TerminalEntry({});
check("TerminalEntry 渲染无异常", !!out && typeof out === "object");
// 7.0) 侧栏索引单槽互斥（sidebarViewPatch 纯补丁语义；入口按钮交互随组件迁 files）
const svp = comps.sidebarViewPatch("vault");
check("sidebarViewPatch 单槽互斥：只亮指定位", svp.vaultIdxOpen === true && svp.treeOpen === false && svp.gitOpen === false);
// 7.1) 功能签入口补丁（openFeatureTab）：置存在 + 置激活位，纯补丁不触碰别的签。
// 后台任务不做签（0.1.7 官方会话头部自带任务清单 + 实时输出 + 停止），无 jobs 分支
const ots = comps.openFeatureTab({ files: [], browserOpen: false, schedOpen: false, activeFeature: null }, "schedule");
check("openFeatureTab 日程：置存在+激活", ots.schedOpen === true && ots.activeFeature === "schedule" && ots.browserOpen === undefined);
const otb = comps.openFeatureTab({ files: [], browserOpen: false, schedOpen: true, activeFeature: "schedule" }, "browser");
check("openFeatureTab 浏览器：纯补丁不触碰日程签（合并保留）", otb.browserOpen === true && otb.activeFeature === "browser" && otb.schedOpen === undefined);
// 7.1b) 知识库入口（输入行钮 + 快捷键同语义）：只切左侧目录，点具体页才开右栏知识库
// 签；再点 = 收回会话列表。补丁只含侧栏三键，功能签与页签状态一律不动（setKitUi
// 合并语义）
const tvOpen = comps.toggleVaultEntry({ treeOpen: true, vaultIdxOpen: false, vaultOpen: false, vaultPages: [], activeFeature: null });
check("知识库入口开：只切侧栏索引且让出文件树", tvOpen.vaultIdxOpen === true && tvOpen.treeOpen === false && tvOpen.vaultOpen === undefined && tvOpen.activeFeature === undefined);
const tvClose = comps.toggleVaultEntry({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", activeFeature: "vault" });
check("知识库入口再点：索引回会话、知识库签与页签不动（补丁不含这些键）", tvClose.vaultIdxOpen === false && tvClose.vaultOpen === undefined && tvClose.vaultPages === undefined && tvClose.activeVaultPage === undefined && tvClose.activeFeature === undefined);
// 7.1c) 知识库页标签纯逻辑：多开、激活、单关、关光收摊（访问序随 ← → 一起退役）
const vp1 = comps.openVaultPageTab({ vaultPages: [], activeVaultPage: null }, "D:/v/a.md");
const vp2 = comps.openVaultPageTab(vp1, "D:/v/b.md");
check("openVaultPageTab 多开：一页一签 + 激活", vp2.vaultPages.length === 2 && vp2.activeVaultPage === "D:/v/b.md" && vp2.vaultOpen === true && vp2.activeFeature === "vault" && vp2.vaultHist === undefined);
const vp3 = comps.openVaultPageTab(vp2, "D:/v/a.md");
check("openVaultPageTab 重开已开页：不重复开签、只激活", vp3.vaultPages.length === 2 && vp3.activeVaultPage === "D:/v/a.md");
const vpAct = comps.activateVaultPage(vp3, "D:/v/b.md");
check("activateVaultPage 只激活", vpAct.activeVaultPage === "D:/v/b.md" && vpAct.vaultPages.length === 2);
check("activateVaultPage 未开的页不认", Object.keys(comps.activateVaultPage(vp3, "D:/v/zz.md")).length === 0);
const vpClose = comps.closeVaultPageTab(vp3, "D:/v/b.md");
check("closeVaultPageTab 单关非激活页：激活位不动", vpClose.vaultPages.length === 1 && vpClose.activeVaultPage === undefined && vpClose.vaultOpen === undefined);
const vpCloseActive = comps.closeVaultPageTab(vp3, "D:/v/a.md");
check("closeVaultPageTab 关激活页：激活位顺延邻居", vpCloseActive.vaultPages.length === 1 && vpCloseActive.activeVaultPage === "D:/v/b.md");
const vpLast = comps.closeVaultPageTab({ vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", vaultOpen: true, activeFeature: "vault" }, "D:/v/a.md");
check("closeVaultPageTab 关最后一个：整片知识库舞台收摊", vpLast.vaultPages.length === 0 && vpLast.vaultOpen === false && vpLast.activeVaultPage === null && vpLast.activeFeature === null);

// 7.1c) 配置页（plugins.row.config）：字段清单与内置默认同源；summary 视图 null、
// form 缺降级、页签分组渲染（官方原语桩回显 props，按 dsw- 标签过滤）、草稿 ops
// 组装（bool set / number 解析与清空 unset / 文本 set）、非法数字挡保存、只读禁用。
// KitConfigPage 的 useState 序：0=draft 1=saving 2=failed 3=tab（桩按调用序存取）
check("KIT_CFG_FIELDS 与 CFG_DEFAULTS 键同源", (() => {
  const a = comps.KIT_CFG_FIELDS.map((f) => f.key).sort();
  const b = Object.keys(comps.CFG_DEFAULTS).sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
})());
check("KitConfigPage summary 视图返回 null", comps.KitConfigPage({ view: "summary", form: null }) === null);
callLog = [];
out = comps.KitConfigPage({ view: "page", form: null });
check("KitConfigPage 无 form 渲染降级文案", !!out && callLog.some((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-note"));
const fakeForm = {
  state: {
    status: "ready",
    value: { ...comps.CFG_DEFAULTS, searchMaxResults: 3, phoneRemoteDomain: "dsh.example.com" },
    revision: 7,
    writable: true,
  },
  mutate: async () => true,
};
// 渲染一个页签：预置 tab state（hook #3）后直调；sw()/vf() 取本页签的官方控件桩
const renderCfgTab = (group, form) => {
  stateSeq = 0;
  stateStore.clear();
  if (group != null) stateStore.set(3, group);
  callLog = [];
  return comps.KitConfigPage({ view: "page", form });
};
const cfgSw = () => callLog.filter((c) => c[1] === primStub.Switch);
const cfgVf = () => callLog.filter((c) => c[1] === primStub.SettingsValueField);
out = renderCfgTab(null, fakeForm); // 默认首组
const cfgTabs = callLog.find((c) => c[1] === primStub.SegmentedTabs);
check("KitConfigPage SegmentedTabs：3 组页签、默认首组、带可访问名", !!cfgTabs && cfgTabs[2].items.length === 3 && cfgTabs[2].value === "kcfgGroupFeatures" && typeof cfgTabs[2].label === "string" && cfgTabs[2].items.every((it) => typeof it.label === "string" && it.label.length > 0 && it.id === "dshk-cfgp-tab-" + it.value && it.panelId === "dshk-cfgp-panel-" + it.value));
cfgTabs[2].onChange("kcfgGroupVault");
check("KitConfigPage 页签切换落 state", stateStore.get(3) === "kcfgGroupVault");
const cfgFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
check("KitConfigPage SettingsForm 框架：labels/state/保存动作齐全", !!cfgFrm && typeof cfgFrm[2].onSave === "function" && typeof cfgFrm[2].onDiscard === "function" && cfgFrm[2].state.available === true && cfgFrm[2].state.writable === true && cfgFrm[2].state.dirty === false && !!cfgFrm[2].labels.save && !!cfgFrm[2].labels.readOnly && !!cfgFrm[2].labels.saveFailed);
const cfgPanel = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-cfgp-fields");
check("功能开关页签：7 Switch + 1 数值字段 + 面板 aria 挂到当前组", cfgSw().length === 7 && cfgVf().length === 1 && !!cfgPanel && cfgPanel[2].id === "dshk-cfgp-panel-kcfgGroupFeatures" && cfgPanel[2].role === "tabpanel");
const cfgSmField = cfgVf().find((c) => c[2].id === "dshk-cfgp-searchMaxResults");
check("数值字段回显受理值（searchMaxResults=3）", !!cfgSmField && cfgSmField[2].text === "3" && cfgSmField[2].numeric === true && cfgSmField[2].overridden === false);
check("Switch 行回显布尔值且带说明文案", cfgSw()[0][2].checked === true && ["终端面板", "Terminal panel"].includes(cfgSw()[0][2].label));
out = renderCfgTab("kcfgGroupPhone", fakeForm);
check("手机访问页签：2 Switch + 1 数值 + 1 文本（文本回显受理域名）", cfgSw().length === 2 && cfgVf().length === 2 && cfgVf().some((c) => c[2].id === "dshk-cfgp-phoneRemoteDomain" && c[2].text === "dsh.example.com"));
out = renderCfgTab("kcfgGroupVault", fakeForm);
check("知识库页签：1 Switch + 1 文本", cfgSw().length === 1 && cfgVf().length === 1);
// 10) 键位改由宿主 shortcuts 服务持有（0.1.7-rc.2+ 官方「快捷键」页）：注册面在
//     client 半边——命令进官方页即自动获得录制/冲突检测/跨设备默认值/持久化。
//     这里直调注册函数（不经 apply，避开 apply 的联网/定时器副作用）。
{
  const registered = [];
  comps.registerShortcuts({
    shortcuts: { register: (cmd) => { registered.push(cmd); return () => {}; } },
    effect: (fn) => { fn(); },
  });
  const byId = (id) => registered.find((c) => c.id === id);
  const term = byId("dsh-kit.terminal.toggle");
  const vault = byId("dsh-kit.vault.toggle");
  const def = (cmd) => (cmd && cmd.defaults["web:windows"]) || {};
  check("终端/知识库两条命令注册进官方 shortcuts（id/label/别名）", !!term && !!vault && typeof term.label === "function" && typeof term.label() === "string" && Array.isArray(term.aliases) && !!vault.label());
  check("默认键：终端 Ctrl+Alt+`、知识库 Ctrl+Alt+/（primary+alt 口径，web 放行表内）", def(term).code === "Backquote" && String(def(term).modifiers) === "primary,alt" && def(vault).code === "Slash" && String(def(vault).modifiers) === "primary,alt" && !!term.defaults["desktop:windows"] && !!term.defaults["web:macos"]);
  check("region 覆盖 page/editable/terminal（聊天输入行与终端里都生效）", ["page", "editable", "terminal"].every((r) => term.regions.includes(r)) && term.modals.length === 0);
  // resolve 门控：功能开关关 → blocked 带说明；开 → handled 且 run 落到浮层挂上的动作
  const ran = [];
  comps.shortcutRun.terminal = () => ran.push("terminal");
  const termOn = term.resolve({ region: "page", modal: null });
  const vaultOff = vault.resolve({ region: "page", modal: null }); // 内置默认 vaultEnabled=false
  if (termOn.status === "handled") termOn.run();
  check("功能开：resolve handled 且 run 触发注册的动作", termOn.status === "handled" && ran.join(",") === "terminal");
  check("功能关：resolve blocked 并带说明（不吞键也不动作）", vaultOff.status === "blocked" && typeof vaultOff.reason === "string" && vaultOff.reason.length > 0);
  comps.shortcutRun.terminal = null;
}
// 草稿 ops 组装：bool→set、number "4"→set 4、空文本→unset（回 schema 默认）；
// 保存不受当前页签限制（草稿跨页签），同步前缀即完成 ops 与 revision 围栏
let capturedOps = null;
let capturedRev = null;
const savingForm = {
  state: fakeForm.state,
  mutate: async (ops, rev) => { capturedOps = ops; capturedRev = rev; return true; },
};
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { searchMaxResults: { text: "4" }, phoneRemoteDomain: { text: "" }, vaultEnabled: { set: false }, vaultRoot: { text: "D:/notes" } });
stateStore.set(3, "kcfgGroupVault");
callLog = [];
out = comps.KitConfigPage({ view: "page", form: savingForm });
const saveFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
check("KitConfigPage 有草稿时 dirty 置位", !!saveFrm && saveFrm[2].state.dirty === true);
saveFrm[2].onSave();
check("保存 ops：number set / 清空 unset / bool set / 文本 set（按字段表序）", JSON.stringify(capturedOps) === JSON.stringify([
  { op: "set", path: ["searchMaxResults"], value: 4 },
  { op: "unset", path: ["phoneRemoteDomain"] },
  { op: "set", path: ["vaultEnabled"], value: false },
  { op: "set", path: ["vaultRoot"], value: "D:/notes" },
]));
check("保存带读取时 revision 围栏", capturedRev === 7);
// 非法数字草稿：字段 invalid + 框架 invalid 置位（SettingsForm blocked 挡保存）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { searchMaxResults: { text: "abc" } });
callLog = [];
out = comps.KitConfigPage({ view: "page", form: fakeForm });
const badField = callLog.find((c) => c[1] === primStub.SettingsValueField && c[2].id === "dshk-cfgp-searchMaxResults");
const badFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
check("非法数字：字段 invalid + 框架 invalid 置位", !!badField && badField[2].invalid === true && !!badFrm && badFrm[2].state.invalid === true);
// 只读：框架 writable=false、Switch 与数值字段禁用
stateSeq = 0;
stateStore.clear();
callLog = [];
out = comps.KitConfigPage({ view: "page", form: { state: { ...fakeForm.state, writable: false }, mutate: fakeForm.mutate } });
const roSwitch = callLog.find((c) => c[1] === primStub.Switch);
const roField = callLog.find((c) => c[1] === primStub.SettingsValueField);
const roFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
check("KitConfigPage 只读态：框架 writable=false、控件禁用", !!out && roFrm[2].state.writable === false && roSwitch[2].disabled === true && roField[2].disabled === true);
stateSeq = 0;
stateStore.clear();
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 渲染无异常（任务签已退役）", !!out && typeof out === "object");

// 6.4) 日程模块（只读面板）：ScheduleView 初始态 / 计时段定位纯函数 / 并行分列
callLog = [];
out = comps.ScheduleView({});
check("ScheduleView 初始态渲染无异常（周网格+待办+统计）", !!out && typeof out === "object");
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

// 6.5) PhoneSection：数据未达（fetch/effect 被桩跳过 → 纯 loading 分支）
callLog = [];
out = comps.PhoneSection({});
check("PhoneSection loading 渲染无异常", !!out && typeof out === "object");

// 7.2) 内置浏览器：面板（未运行态：canvas + 输入处理器就位）；入口已迁右坞，
// 「+」菜单项/空态卡片在 RightDock 用例覆盖
callLog = [];
out = comps.BrowserPanel({});
const canvasHost = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-brw-canvas"));
const hasInputHandlers = canvasHost && canvasHost[2].onPointerDown && canvasHost[2].onKeyDown && canvasHost[2].onWheel;
check("BrowserPanel 未运行态渲染无异常", !!out && typeof out === "object");
check("BrowserPanel 渲染出带共驾输入处理器的 canvas", !!canvasHost && !!hasInputHandlers);
comps.setKitUi({ browserOpen: false });

// 7.2.5) 关页签直关（宿主 active 识别常不准）——✕ 点击不弹确认
stateStore.clear();
stateSeq = 0;
stateStore.set(0, { running: true, launching: false, pages: [
  { tabId: 1, url: "http://a.example/", title: "A", active: false, viewed: false },
  { tabId: 2, url: "http://b.example/", title: "B", active: true, viewed: true },
], activeId: 2, viewId: 2 });
callLog = [];
out = comps.BrowserPanel({ active: true });
const tabXs = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-x");
check("BrowserPanel 运行态渲染出页签 ✕（2 个）", tabXs.length === 2);
const noDot = callLog.every((c) => !(c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-tab-dot")));
check("页签条不再渲染 agent 活动圆点", noDot);
const fakeEvent = { stopPropagation() {} };
global.window.confirm = (msg) => { throw new Error(`confirm should never be called`) };
let threw = null;
try { tabXs[0][2].onClick(fakeEvent); tabXs[1][2].onClick(fakeEvent); } catch (e) { threw = e; }
global.window.confirm = undefined;
check("页签 ✕ 直关不弹确认", threw === null);

// 7.2.55) 工具栏对齐官方浏览器签：5 枚 28px 图标钮（后退/前进/刷新 + 地址框内
// 「前往」+ 在系统浏览器中打开）；外部打开拿观察页 URL，有页才可用
const toolBtns = callLog.filter((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.split(" ").includes("dshk-brw-tool"));
check("BrowserPanel 工具栏为官方同款图标钮（5 枚）", toolBtns.length === 5);
const externalBtn = toolBtns.find((c) => ["在系统浏览器中打开", "Open in system browser"].includes(c[2].title));
check("在系统浏览器中打开：观察页 URL 就位时可用", !!externalBtn && externalBtn[2].disabled === false && typeof externalBtn[2].onClick === "function");
check("「前往」是地址框内提交钮（官方同款）", toolBtns.some((c) => c[2].type === "submit" && c[2].className.includes("dshk-brw-go")));

// 7.2.6) 全部页签关闭后的空态：运行中 0 页显示「没有打开的页面」提示（官方同款
// 居中占位），且画布隐去——不留无提示的僵尸画面；预置 running + 空 pages
stateStore.clear();
stateSeq = 0;
stateStore.set(0, { running: true, launching: false, pages: [], activeId: null, viewId: null });
callLog = [];
out = comps.BrowserPanel({ active: true });
const noPagesNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-brw-start" && typeof c[2].children === "string" && ["没有打开的页面", "No open pages"].some((s) => c[2].children.includes(s)));
check("BrowserPanel 运行中 0 页渲染空态提示", !!noPagesNote);
const canvasHidden = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-brw-canvas-off"));
check("空态时画布隐去（不留定格帧）", !!canvasHidden);

// 7.2.7) 壳层事件源语义（模块函数直调，getKitUi 读回）：navigated → 弹回浏览器
// 标签；浏览器没了 → 收掉面板标签且不置抑制（agent 下次导航照常弹回——抑制的
// 置/清只发生在人为路径，事件源不碰）
comps.setKitUi({ browserOpen: false, activeFeature: null });
comps.maybeAutoOpenBrowser();
check("maybeAutoOpenBrowser 切到浏览器标签（无抑制，agent 干活必回眼前）", comps.getKitUi().browserOpen === true && comps.getKitUi().activeFeature === "browser");
comps.closeBrowserDockForGone();
check("closeBrowserDockForGone 收掉面板标签（0 页无面板壳）", comps.getKitUi().browserOpen === false && comps.getKitUi().activeFeature === null);



// 7.2.2a) 文件标签纯逻辑：点击只激活（刷新 usedAt）／✕ 单关顺延邻居／关光了整片收摊
const tabBase = {
  files: [
    { path: "C:/x/a.js", from: "tree", usedAt: 1 },
    { path: "C:/x/b.js", from: "tree", deleted: true, usedAt: 2 },
    { path: "C:/x/c.js", from: "tree", usedAt: 3 },
  ],
  activeFile: "C:/x/c.js",
  activeFeature: "file",
};
const actA = comps.activateFileTab(tabBase, "C:/x/a.js");
check("activateFileTab 只激活：不动顺序、只刷新 usedAt 与激活位", actA.activeFile === "C:/x/a.js" && actA.activeFeature === "file" && actA.files.length === 3 && actA.files[0].usedAt > 1 && actA.files[1].deleted === true);
check("activateFileTab 未开的文件不认", Object.keys(comps.activateFileTab(tabBase, "C:/x/zz.js")).length === 0);
const closeB = comps.closeFileTab(tabBase, "C:/x/b.js");
check("closeFileTab 单关非激活签：激活位不动", closeB.files.length === 2 && closeB.activeFile === undefined && !closeB.files.some((x) => x.path === "C:/x/b.js"));
const closeActive = comps.closeFileTab(tabBase, "C:/x/c.js");
check("closeFileTab 关激活签：激活位顺延邻居", closeActive.files.length === 2 && closeActive.activeFile === "C:/x/b.js");
const closeLast = comps.closeFileTab({ files: [{ path: "C:/x/a.js", from: "tree", usedAt: 1 }], activeFile: "C:/x/a.js", browserOpen: true, activeFeature: "file" }, "C:/x/a.js");
check("closeFileTab 关最后一个：整片文件舞台收摊且激活位顺延到余下标签", closeLast.files.length === 0 && closeLast.activeFile === null && closeLast.activeFeature === "browser");



// 7.2.4e) 右栏 pane 正文组件：各 pane 正文的唯一外壳，
// 这里直接渲染各 pane 正文验证渲染体；存在性同步走 effect（桩不执行）
comps.setKitUi({
  files: [
    { path: "C:/x/a.js", from: "scm", untracked: false, usedAt: 1 },
    { path: "C:/x/b.md", from: "scm", untracked: true, usedAt: 2 },
  ],
  activeFile: "C:/x/b.md",
});
callLog = [];
// DiffPane 已迁 dsh-kit-files：root 只从 kitBase 的 diffPane 座取（组件包物化期挂上）。
// 桩环境手动挂一枚假组件，钉住「正文类型确实来自座」——座没接线时类型是 undefined
// （真机 React #130 白屏，桩渲染器不抛，只能这样钉）
const fakeDiff = function FakeDiff() {};
comps.diffPane.Component = fakeDiff;
out = comps.FilePaneBody({});
const fpChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("C:/x/"));
const fpWraps = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-pane-view" && c[2].style && typeof c[2].style.display === "string");
const fpDiffs = callLog.filter((c) => (c[0] === "jsx") && c[1] === fakeDiff && c[2] && typeof c[2].path === "string");
const fpLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label" && ["a.js", "b.md"].includes(c[2].children));
check("FilePaneBody 渲染无异常（文档签条 + 两个 diff 正文实例）", !!out && fpChips.length === 2 && fpWraps.length === 2 && fpLabels.length === 2);
check("FilePaneBody diff 正文类型取自 diffPane 座（每文件一枚，未跟踪标志透传）", fpDiffs.length === 2 && fpDiffs.some((c) => c[2].path === "C:/x/b.md" && c[2].untracked === true) && fpDiffs.some((c) => c[2].path === "C:/x/a.js" && c[2].untracked === false));
comps.diffPane.Component = null;
check("FilePaneBody 每文件一签、只激活当前签、每签各带 ✕ 单关", fpChips.filter((c) => c[2].className.includes("dshk-tab-on")).length === 1 && fpChips.every((c) => Array.isArray(c[2].children) && c[2].children.some((ch) => ch && ch.props && ch.props.className === "dshk-tab-x")));
check("FilePaneBody 非激活文件仍挂载（激活 flex / 非激活 none）", fpWraps.filter((c) => c[2].style.display === "flex").length === 1 && fpWraps.some((c) => c[2].style.display === "none"));
comps.setKitUi({ files: [], activeFile: null });
comps.setKitUi({ files: [], activeFile: null });
callLog = [];
out = comps.FilePaneBody({});
const fpEmpty = callLog.find((c) => (c[0] === "jsx") && c[2] && (c[2].className === "dshk-rbpane-hint" || c[2].className === "dshk-rbguide"));
check("FilePaneBody 0 文件无空态（最后一页关掉连官方签一起收）", !!out && !fpEmpty);
callLog = [];
comps.setKitUi({ vaultOpen: true, vaultPages: ["D:/v/a.md", "D:/v/b.md"], activeVaultPage: "D:/v/b.md" });
callLog = [];
out = comps.VaultPaneBody({});
const vpHost = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-vault-panehost");
const vpChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("D:/v/"));
const vpOnChips = vpChips.filter((c) => c[2].className.includes("dshk-tab-on"));
const vpLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label" && ["a", "b"].includes(c[2].children));
check("VaultPaneBody 渲染 portal 宿主（VaultRootView 投页编辑器）", !!out && !!vpHost);
check("VaultPaneBody 知识库多开：一页一签、只激活当前页、页名去 .md", vpChips.length === 2 && vpOnChips.length === 1 && vpOnChips[0][2].title === "D:/v/b.md" && vpLabels.length === 2);
check("VaultPaneBody 每页签各带独立 ✕", vpChips.every((c) => Array.isArray(c[2].children) && c[2].children.some((ch) => ch && ch.props && ch.props.className === "dshk-tab-x")));
comps.setKitUi({ vaultOpen: false, vaultPages: [], activeVaultPage: null });
callLog = [];
out = comps.SchedulePaneBody({});
check("SchedulePaneBody 挂 ScheduleView（pane 内左待办+右网格）", !!out && callLog.some((c) => c[1] === comps.ScheduleView));
callLog = [];
out = comps.BrowserPaneBody({});
const bpElemRb = callLog.find((c) => c[1] === comps.BrowserPanel && c[2] && c[2].active === true);
check("BrowserPaneBody 挂 BrowserPanel（active 恒真：pane 显示即在看）", !!out && !!bpElemRb);
callLog = [];
let rbCloseOk = true;
try { comps.closeRightbarTab("file"); } catch { rbCloseOk = false; }
check("closeRightbarTab 服务未就绪时静默不抛", rbCloseOk);
callLog = [];
out = comps.ScheduleTasksCard({ data: { events: [{ id: "t1", title: "交报告", due: "2026-09-10" }] } });
const taskChecks = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].type === "checkbox");
const timerBtns = callLog.filter((c) => c[2] && c[2].className === "dshk-sched-tasktimer");
check("ScheduleTasksCard 待办行渲染卡壳", !!out && typeof out === "object");
check("ScheduleTasksCard 只读行：无勾选框、无计时钮", taskChecks.length === 0 && timerBtns.length === 0);
// openFileAndDock / openVaultPageAndDock：kitUi 侧补丁在这里断言；右栏
// openTab 走 sidebarRight 服务（桩环境服务未注入，静默不触）
comps.openFileAndDock("C:/x/new.js", "tree", false);
check("openFileAndDock 落 kitUi 差异签", comps.getKitUi().activeFile === "C:/x/new.js" && comps.getKitUi().activeFeature === "file");
comps.openVaultPageAndDock("D:/v/p.md");
check("openVaultPageAndDock 落 kitUi 知识库页签", comps.getKitUi().activeVaultPage === "D:/v/p.md" && comps.getKitUi().vaultOpen === true);
comps.setKitUi({ files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null, activeFeature: null });

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
  // 拆两半后 VaultRootView 单实例挂 KitSurfaces、内容经 portal 投两侧宿主；
  // 宿主全空（知识库侧栏/右栏签都没开）时返回 null 是合法语义。这里登记右栏
  // 宿主再渲（未配置 vault 的整页提示走 portal 投出），防渲染体异常逃逸
  comps.vaultPaneSlot.set({ tagName: "DIV" });
  comps.setKitUi({ vaultOpen: true, activeFeature: "vault" });
  try {
    vaultOut = comps.VaultRootView({ root: "D:/v" });
  } catch (e) {
    vaultErr = e;
  }
  check("VaultRootView 单态渲染无异常（portal 投出整页提示）", vaultErr === null && !!vaultOut && typeof vaultOut === "object");
  if (vaultErr) console.log("  VaultRootView error:", vaultErr.message);
  comps.vaultPaneSlot.set(null);
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
  comps.setKitUi({ vaultIdxOpen: true, vaultOpen: true, vaultPages: [], activeVaultPage: null, activeFeature: "vault" });
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
  const refreshBtn = barRow.find((ch) => ch && ch.props && ["刷新索引与目录树", "Refresh index and tree"].includes(ch.props.title));
  const searchBox = barRow.find((ch) => ch && ch.props && ch.props.className === "dshk-vault-search");
  check("一行 = 搜索框 + 刷新钮（前进/后退与文件夹筛选框都退役）", barRow.length === 2 && !!searchBox && !!refreshBtn);
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
    "资料库文件点击改投官方文件右栏（源码哨兵）",
    src.includes("if (lib) openOfficialFile(e.path);") && src.includes("else if (hit.kind === \"libfile\") openOfficialFile(hit.path);"),
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
        return ["@ 到对话", "Insert @ mention"].includes(b[0].props.title) && b[1].props.children === "⋯";
      }),
  );
  // 新建入口：目录行与树头都有悬停「+」（资料库那一支也有——库里建文件夹）
  const plusButtons = callLog.filter((c) => c[2] && c[2].className === "dshk-vault-treeplus");
  check(
    "目录行与树头都挂了「新建」+ 钮（树头两枚：新建 + 更多操作）",
    plusButtons.length >= 4 &&
      plusButtons.filter((b) => ["新建", "New"].includes(b[2].title)).length >= 3 &&
      plusButtons.some((b) => b[2].children === "+") &&
      plusButtons.some((b) => b[2].children === "⋯"),
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
  const dirMenuBtn = actsOfRow(findRow("D:/v/wiki"))[1];
  const pageMenuBtn = actsOfRow(findRow("D:/v/wiki/a.md"))[1];
  const libMenuBtn = actsOfRow(findRow("D:/v/library"))[1];
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
  const backBtn = callLog.find((c) => c[2] && ["返回知识库", "Back to knowledge base"].includes(c[2].title));
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
  // 预置 state：14 renamingPath / 15 createAt / 16 createName / 17 dialog
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
    const createErr = renderVault({ ...base, 14: null, 15: "D:/v/wiki", 16: "新页" });
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
    check("目录行尾 + 的落点 = 那一行目录（树头 + 落到当前树根）", stateStore.get(15) === "D:/v/wiki");
    renderVault({ ...base, 14: "D:/v/wiki/a.md" });
    const renameInput = callLog.find((c) => c[2] && c[2].className === "dshk-rename");
    check(
      "行内改名：页行换成输入框，初值取显示名（去 .md）",
      !!renameInput && renameInput[2].defaultValue === "a" && renameInput[2].autoFocus === true,
    );
    check(
      "改名走宿主端点（源码哨兵：rename 提交后搬树键与已开页签）",
      src.includes('vaultOp("/dsh-kit/vault/rename", { path: entry.path, name })') &&
        src.includes("const patch = vaultTabsRetarget(getKitUi(), entry.path, res.path, entry.dir === true);") &&
        src.includes("retargetTree(entry.path, res.path, entry.dir === true);"),
    );
    // 移动到…：候选目录列同侧全部分支（根 + wiki + wiki/Python）
    const moveErr = renderVault({
      ...base,
      17: { kind: "move", entry: { dir: false, name: "a", path: "D:/v/wiki/a.md" }, lib: false, dest: "D:/v/wiki", conflict: "skip" },
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
      17: { kind: "import", dest: "D:/v/library", lib: true, files: [], src: "", name: "", conflict: "skip" },
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
      17: { kind: "import", dest: "D:/v/wiki", lib: false, files: [], src: "", name: "", conflict: "skip" },
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
      17: { kind: "delete", entry: { dir: true, name: "wiki", path: "D:/v/wiki" } },
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
  if (refreshBtn) refreshBtn.props.onClick();
  // fetch 桩同步记账：loadIndex 的请求在 onClick 返回前就已发出；目录树重拉排在
  // 微任务里，桩要留到收尾结算后（提前还原会让它打真网络，落进 fetchDir 的静默失败）
  check("↻ 点击立即重拉索引（/dsh-kit/vault/index）", fetched.some((u) => u.includes("/dsh-kit/vault/index")));
  comps.vaultSideSlot.set(null);
  comps.vaultPaneSlot.set(null);
  comps.setKitUi({ vaultIdxOpen: false, vaultOpen: false, vaultPages: [], activeVaultPage: null, activeFeature: null });
  stateSeq = 0;
  stateStore.clear();
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
// 6.9b) VaultPagePane 直渲（只读阅读视图）：预置 state#0（page 已加载）走完整
// 阅读面——sticky 阅读条（目录/反链按钮）+ RTE；写入类按钮（@/删除/撤销重做）
// 与冲突条全部不得再出现
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
  // 写入半边退役：撤销/重做按钮不得回到阅读条
  const undoBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["撤销", "Undo", "重做", "Redo"].includes(c[2].title));
  const rte = callLog.find((c) => c[1] === comps.RteEditor);
  // 阅读条两枚页面级入口：目录 / 反链（计数印在按钮上）
  const tocBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["目录", "Outline"].includes(c[2].children));
  const blBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("反链") || c[2].children.startsWith("Backlinks")));
  check("VaultPagePane 渲染无异常（阅读条 + RTE 就位，页条不再带 @）", paneErr === null && !!editbar && !citeBtn && !!rte);
  check("页条不再带删除按钮（删除在左侧树的行 ⋯ 菜单）", !delBtn);
  check("阅读条带 目录/反链 入口（只读导航），无撤销/重做（写入退役）", !!tocBtn && !!blBtn && !undoBtn);
  if (paneErr) console.log("  VaultPagePane error:", paneErr.message);
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { loading: false, body: "x", binary: false, gone: false });
  callLog = [];
  comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: false, root: "D:/v", indexPages: [], onOpenPage: () => {}, onIndexRefresh: () => {}, toast: () => {} });
  const paneRoot = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-reader" && c[2].style);
  check("VaultPagePane 非激活标签保挂载但 display:none", !!paneRoot && paneRoot[2].style.display === "none");
  check("冲突条已随写入半边退役（CSS 不存在）", !/\.dshk-vault-conflict\{/.test(src));
  stateSeq = 0;
  stateStore.clear();
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
const lruBase = [];
for (let i = 1; i <= 3; i++) lruBase.push({ path: `C:/x/f${i}.js`, from: "scm", untracked: false, usedAt: i });
const opened = comps.openFileTab({ files: lruBase, activeFile: "C:/x/f3.js" }, "C:/x/f4.js", "scm", false);
check("openFileTab 超限 LRU 逐出最久未用", opened.files.length === 3 && !opened.files.some((p) => p.path === "C:/x/f1.js") && opened.files.some((p) => p.path === "C:/x/f4.js") && opened.activeFile === "C:/x/f4.js" && opened.activeFeature === "file");
const reopened = comps.openFileTab({ files: opened.files, activeFile: "C:/x/f4.js" }, "C:/x/f2.js", "scm", false);
const reopenedItem = reopened.files.find((p) => p.path === "C:/x/f2.js");
check("openFileTab 重开已存在文件置顶激活不逐出自身", reopened.files.length === 3 && reopened.activeFile === "C:/x/f2.js" && !!reopenedItem && reopenedItem.untracked === false && reopenedItem.from === "scm");
const delOpen = comps.openFileTab({ files: [], activeFile: null }, "C:/x/gone.js", "scm", false, true);
check("openFileTab 携带 deleted 标记", delOpen.files.length === 1 && delOpen.files[0].deleted === true && delOpen.activeFile === "C:/x/gone.js");
// 7.2.3b) commit 钉定（图谱提交详情进入）：条目携带 commit；从 SCM 重开同路径清除钉定
const commitOpen = comps.openFileTab({ files: [], activeFile: null }, "C:/x/hist.js", "scm", false, false, "abc1234def");
check("openFileTab 携带 commit 钉定", commitOpen.files.length === 1 && commitOpen.files[0].commit === "abc1234def" && commitOpen.activeFile === "C:/x/hist.js");
const commitReopen = comps.openFileTab(commitOpen, "C:/x/hist.js", "scm", false);
check("openFileTab 从 SCM 重开同路径清除钉定", commitReopen.files[0].commit === undefined);

// 7.5) 终端坞（多标签）：预置两个会话（含同 cwd 多开）后渲染——标签 map 曾因
// 变量遮蔽翻译函数 t 而崩溃，此用例专防"有状态后才走到的渲染分支"
comps.setKitUi({ terminals: [comps.makeTerm("s1", "C:/x"), comps.makeTerm("s1", "C:/x")], activeTermId: null, termDockOpen: true });
callLog = [];
out = comps.TerminalDock({ open: true, cwd: "C:/x", onSpawn: () => {}, onHide: () => {}, onActivate: () => {}, onKill: () => {} });
check("TerminalDock 带标签渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.TerminalPane({ term: { id: "t1", sessionId: "s1", cwd: "C:/x" }, visible: true });
check("TerminalPane 渲染无异常", !!out && typeof out === "object");
comps.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 无hooks渲染无异常", !!out && typeof out === "object");
// 更改视图/提交图谱/分支浮层直测随组件迁 dsh-kit-files（tests\render-check-files.cjs）
// 8) SkillsManager（技能管理页）：无 hooks（cwd=null）与有 cwd 两种
callLog = [];
const fakeHooks = {
  useSessions: (sel) => sel({ byId: { s1: { id: "s1", cwd: "C:/x", retainedBy: { mainView: 1 } } } }),
};
out = comps.KitSurfaces(fakeHooks);
check("KitSurfaces 带cwd渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.SkillsManager({});
check("SkillsManager 无hooks渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.SkillsManager(fakeHooks);
check("SkillsManager 带cwd渲染无异常", !!out && typeof out === "object");


// 10c-10f）429 续跑器（G）/ 会话通知（N）/ 收尾判定 / 压缩完成（C）判定核心
//       已随监视组件迁入 dsh-kit-monitor——检查随之移至 tests/render-check-monitor.cjs



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


// 9) 插件配置（0.1.7 声明式模型）：设置卡已退役，编辑走插件页本行「配置」页
//    （plugins.row.config；字段必须 .volatile() 才进表单）；client 只保留门控用的内置默认表
// 内置默认与宿主 Config schema（src/index.ts）逐项同值：client 拉 /dsh-kit/config
// 前后的门控取值不能漂移——两处不同步就会出现「默认关的功能被当开处理」
{
  const hostSrc = fs.readFileSync(__dirname + "/../src/index.ts", "utf8");
  const drift = [];
  const missing = [];
  let compared = 0;
  for (const m of hostSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)[^,\n]*\.default\(([^)]*)\)\.volatile\(\),?$/gm)) {
    const key = m[1];
    if (!Object.prototype.hasOwnProperty.call(comps.CFG_DEFAULTS, key)) { missing.push(key); continue; }
    const raw = m[2].trim();
    const expected =
      raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : /^'[^']*'$/.test(raw) ? raw.slice(1, -1) : undefined;
    if (expected === undefined) continue; // 表达式默认（defaultVaultRoot() 之类）不比对
    compared++;
    if (comps.CFG_DEFAULTS[key] !== expected) drift.push(key + "(bundle=" + comps.CFG_DEFAULTS[key] + ",host=" + expected + ")");
  }
  check("内置默认与宿主 schema 逐项同值（比对 " + compared + " 项；漂移 " + (drift.join("/") || "无") + "；schema 独有 " + (missing.join("/") || "无") + "）", drift.length === 0 && missing.length === 0 && compared >= 13);
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

// 日程只有右栏 dock 签（入口归右栏开始页与待办卡）：侧栏待办索引与日程专属快捷键
// 都不得出现
check(
  "日程侧栏索引与专属快捷键不存在（schedIdxOpen/schedShortcut 全链移除）",
  !src.includes("schedIdxOpen") && !src.includes("schedShortcut") && !src.includes("cfgSchedShortcut") && !src.includes("ScheduleIndexView"),
);
// 键位整体改由宿主 shortcuts 服务持有（0.1.7-rc.2+ 官方「快捷键」页）：自带快捷键
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

// React 桩记录到的组件类型必须包含本插件自定义组件名（防 ReferenceError 被忽略后整段缺失）
const types = new Set(callLog.flatMap(([, t]) => (typeof t === "string" ? [t] : [])));
// 至少渲染出来 JSX 元素（说明走到 render 而非静默 null）
check("渲染体实际产出元素", callLog.length > 0);

// 收尾结算放进 setTimeout：6.9c 里 ↻ 刷新的目录树重拉排在 await loadIndex()
// 之后的微任务里，同步段看不到；微任务先于定时器清空，此刻断言才成立
setTimeout(async () => {
  const treeHits = vaultRefreshFetched.filter((u) => u.includes("/dsh-kit/tree"));
  check("↻ 刷新连带重拉每个已展开目录（6.9c 预置了 3 个）", treeHits.length === 3);
  // kit 端点包装（kitGetJson/kitPostJson/kitJson）：回包约定收在一处后的行为契约。
  // 2xx 且形状断言通过才算成功，失败带宿主 error 原文与 status——写文件的 409
  // 冲突分流就靠 status/body，这里把契约钉死
  // kit 端点包装契约直调（原借 fetchTree/fetchGitStatus 等业务函数当载体，
  // 它们已迁 dsh-kit-files——契约本身收在 kitBase 的三件套里，直调覆盖同一行为）
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
  global.fetch = vaultFetchPrev;
  console.log(failed === 0 ? "ALL RENDER OK" : `${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}, 0);
