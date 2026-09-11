// 渲染级验证：桩掉 react hooks，直接函数调用 dsh-kit 的组件
// （TreeNode/FileTreePanel/FileEditorPane/TerminalEntry/FileTreeEntry/KitSurfaces/
// KitConfigCard/GitChangesPanel/SkillsManager/TerminalDock/TerminalPane），跑完整渲染体。
// TerminalDock/TerminalPane 通过 setKitUi 预置会话后渲染（防"有状态后才走到的分支"逃逸）。
// ⚠️ 盲区：桩不会重渲染（effect 不执行、state 不更新），依赖 effect 产出后才走到的
// 渲染分支（如 FileTreePanel 的 entries.map 行）覆盖不到——2026-08-23 曾有残留变量
// gitMap 藏在该行逃过本检查，靠用户实测暴露。可疑残留请配合全文扫描排查。
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
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  Fragment: function Fragment() {},
};
const jsxRuntimeStub = {
  Fragment: function Fragment() {},
  jsx: (type, props) => { callLog.push(["jsx", type, props]); return { type, props, $$dshk: "jsx" }; },
  jsxs: (type, props) => { callLog.push(["jsxs", type, props]); return { type, props, $$dshk: "jsxs" }; },
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
  global.document = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add() {}, remove() {} } } };
}
if (!global.window) {
  global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {} };
}
if (!global.location) {
  global.location = { protocol: "http:", host: "127.0.0.1:3081" };
}

// 3) 组装可执行的 factory 闭包，并导出组件（替换防 early-return）；
//    setKitUi/makeTerm 用于预置终端坞等依赖状态的渲染分支
const wrapper = body.replace(
  "return module.exports;",
  "return { vaultSideSlot, vaultPaneSlot, TreeNode, FileTreePanel, FileEditorPane, TerminalEntry, FileTreeEntry, ScmEntry, VaultEntry, JobsPanel, PhoneSection, KitSurfaces, KitConfigCard, GitChangesPanel, GitGraphPanel, GitBranchMenu, SkillsManager, TerminalDock, TerminalPane, TreeRowMenu, CommitGraphSvg, computeCommitGraph, BrowserPanel, RteEditor, VaultPagePane, openFileTab, activateFileTab, closeFileTab, openFeatureTab, closeFeatureTab, openVaultPageTab, closeVaultPageTab, activateVaultPage, toggleVaultEntry, openVaultEntry, sidebarViewPatch, maybeAutoOpenBrowser, closeBrowserDockForGone, cfgFormat, CFG_DEFAULTS, getKitUi, setKitUi, makeTerm, ScheduleView, ScheduleModal, FloatingTimerPill, timerElapsedStr, timerMinsOfDT, schedAssignLanes, VaultView, VaultRootView, vaultSplitFrontmatter, resolveVaultLink, vaultBacklinks, vaultCascadeDelete, vaultHeadingSlug, MonitorLine, monitorTailRepeatCount, monitorTakeoverError, monitorRecoveredTail, readPosStore, recordReadPos, FilePaneBody, VaultPaneBody, SchedulePaneBody, JobsPaneBody, BrowserPaneBody, HeaderTimer, ScheduleTasksCard, openFeatureDock, openFileAndDock, openVaultPageAndDock, closeRightbarTab, isPathInsideVaultRoot, vaultCiteText, resolveMdLink, isDocHref };",
);
const harness = new Function("require", wrapper);
const reactDomStub = {
  createPortal: (children, container, key) => { callLog.push(["portal", children, container, key]); return { type: "portal", props: { children, container, key }, $$dshk: "portal" }; },
};
const comps = harness((name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return reactDomStub;
  throw new Error("unexpected require: " + name);
});

if (!comps || typeof comps !== "object") { console.log("FATAL: no components returned"); process.exit(2); }
const names = ["TreeNode", "FileTreePanel", "FileEditorPane", "TerminalEntry", "FileTreeEntry", "ScmEntry", "VaultEntry", "JobsPanel", "PhoneSection", "KitSurfaces", "KitConfigCard", "GitChangesPanel", "GitGraphPanel", "GitBranchMenu", "SkillsManager", "TerminalDock", "TerminalPane", "CommitGraphSvg", "BrowserPanel", "RteEditor", "VaultPagePane", "openFeatureTab", "activateFileTab", "closeFileTab", "openVaultPageTab", "closeVaultPageTab", "activateVaultPage", "sidebarViewPatch", "toggleVaultEntry", "ScheduleView", "ScheduleModal", "FloatingTimerPill", "timerElapsedStr", "timerMinsOfDT", "schedAssignLanes", "VaultView", "VaultRootView", "vaultSplitFrontmatter", "resolveVaultLink", "vaultBacklinks", "vaultCascadeDelete", "vaultHeadingSlug", "MonitorLine", "monitorTailRepeatCount", "monitorTakeoverError", "monitorRecoveredTail", "recordReadPos", "FilePaneBody", "VaultPaneBody", "SchedulePaneBody", "JobsPaneBody", "BrowserPaneBody", "HeaderTimer", "ScheduleTasksCard", "openFeatureDock", "openFileAndDock", "openVaultPageAndDock", "closeRightbarTab", "isPathInsideVaultRoot", "vaultCiteText", "resolveMdLink", "isDocHref"];
for (const n of names) {
  if (typeof comps[n] !== "function") { console.log("FAIL: missing/not function:", n); process.exitCode = 1; return; }
}

// 4) 直接渲染 TreeNode（文件 + 目录两种）
let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };

let out;
callLog = [];
out = comps.TreeNode({ entry: { name: "b.js", path: "C:/x/b.js", dir: false }, depth: 0, expanded: {}, onToggle: () => {}, onOpenFile: (p) => {} });
check("TreeNode 文件渲染无异常", !!out && typeof out === "object");

callLog = [];
out = comps.TreeNode({ entry: { name: "src", path: "C:/x/src", dir: true }, depth: 0, expanded: {}, onToggle: () => {}, onOpenFile: () => {} });
check("TreeNode 目录渲染无异常", !!out && typeof out === "object");

// 4b) TreeNode 带 actions：行悬停常驻 @、复制绝对路径与 ⋯（常用+菜单组合）；
//     复制相对路径收敛进 ⋯ 菜单（TreeRowMenu 渲染），回调携带 relative 标志
let copiedRel = null;
let mentioned = null;
callLog = [];
out = comps.TreeNode({
  entry: { name: "b.js", path: "D:/w/b.js", dir: false },
  depth: 0,
  expanded: {},
  onToggle: () => {},
  onOpenFile: () => {},
  actions: { onCopyPath: (_entry, rel) => { copiedRel = rel; }, onMention: (entry) => { mentioned = entry; } },
});
const findBtnByTitle = (...titles) => {
  const hit = callLog.find(([, , p]) => p && typeof p === "object" && titles.includes(p.title));
  return hit ? hit[2] : null;
};
const absBtn = findBtnByTitle("复制绝对路径", "Copy absolute path");
const atBtn = findBtnByTitle("@ 到对话", "Insert @ mention");
check("TreeNode 常驻按钮渲染(@+复制绝对)", !!absBtn && !!atBtn);
const fakeEvent = { stopPropagation() {} };
absBtn.onClick(fakeEvent);
check("复制绝对路径回调 relative=false", copiedRel === false);
atBtn.onClick(fakeEvent);
check("@ 到对话回调携带条目", mentioned && mentioned.path === "D:/w/b.js");
// 4c) TreeRowMenu：文件行菜单项含复制相对路径/重命名/删除；目录行另有新建两项
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

// 5) FileTreePanel：cwd 有/无
callLog = [];
out = comps.FileTreePanel({ cwd: null, onOpenFile: () => {} });
check("FileTreePanel noCwd 渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.FileTreePanel({ cwd: "C:/x", onOpenFile: () => {} });
check("FileTreePanel noCwd(根未加载) 渲染无异常(loading→error兜底)", !!out && typeof out === "object");

// 6) FileEditorPane：加载中（fetch 被桩跳过 -> 保持 loading）
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/b.js", cwd: "C:/x", onClose: () => {} });
check("FileEditorPane 渲染无异常", !!out && typeof out === "object");

// 6.1) FileEditorPane PDF ready 分支：pdf.js 宿主容器 + ↗ 兜底（canvas 由
//      effect 挂载，桩覆盖不到——重置序号预置 useState#0 让渲染体走到新分支）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, {
  phase: "ready",
  body: { path: "C:/x/doc.pdf", size: 10, mtimeMs: 1, truncated: false, binary: true, content: null },
});
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/doc.pdf", cwd: "C:/x", onClose: () => {} });
const pdfHost = callLog.find((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-pdf-scroll");
check("FileEditorPane PDF ready 渲染无异常", !!out && typeof out === "object");
check("PDF 渲染出 pdf.js 宿主容器", !!pdfHost);

// 6.2) xlsx ready 分支：表格宿主容器产出（SheetJS 解析在沙箱 effect 里，桩不覆盖）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, {
  phase: "ready",
  body: { path: "C:/x/t.xlsx", size: 10, mtimeMs: 1, truncated: false, binary: true, content: null },
});
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/t.xlsx", cwd: "C:/x", onClose: () => {} });
const sheetHost = callLog.find(
  (c) =>
    (c[0] === "jsx" || c[0] === "jsxs") &&
    c[2] &&
    typeof c[2].className === "string" &&
    c[2].className.includes("dshk-sheetwrap"),
);
check("FileEditorPane xlsx ready 渲染无异常", !!out && typeof out === "object");
check("xlsx 渲染出表格宿主容器", !!sheetHost);

// 6.3) docx ready 分支：文档宿主容器产出（mammoth 转换在沙箱 effect 里，桩不覆盖）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, {
  phase: "ready",
  body: { path: "C:/x/t.docx", size: 10, mtimeMs: 1, truncated: false, binary: true, content: null },
});
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/t.docx", cwd: "C:/x", onClose: () => {} });
const docHost = callLog.find(
  (c) =>
    (c[0] === "jsx" || c[0] === "jsxs") &&
    c[2] &&
    typeof c[2].className === "string" &&
    c[2].className.includes("dshk-docwrap"),
);
check("FileEditorPane docx ready 渲染无异常", !!out && typeof out === "object");
check("docx 渲染出文档宿主容器", !!docHost);

// 6.4) 已删除文件（deleted）：仅 diff 预览——⇄ 不出现，渲染删除说明 + diff 体
// （read 请求被 deleted 守卫跳过，桩环境 effect 不执行、直接验渲染体）
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/gone.js", cwd: "C:/x", deleted: true });
const deletedNote = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.includes("文件已删除") || c[2].children.includes("File deleted")));
const deletedToggle = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].children === "⇄");
check("FileEditorPane deleted 渲染无异常", !!out && typeof out === "object");
check("deleted 预览渲染删除说明且无 ⇄ 切换", !!deletedNote && !deletedToggle);

// 6.4.1) 真实时序（effect 已跑）：state 进入 phase:"deleted" 后的渲染体——
// body 计算块必须兜住该态（曾崩 b.binary，effect 产出的态是桩盲区，须预置验证）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { phase: "deleted" });
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/gone.js", cwd: "C:/x", deleted: true });
const deletedNote2 = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.includes("文件已删除") || c[2].children.includes("File deleted")));
check("FileEditorPane deleted态(body计算块)渲染无异常", !!out && typeof out === "object" && !!deletedNote2);
stateSeq = 0;
stateStore.clear();

// 6.4.2) 删除内容纯红展示：pre-seed phase deleted + 删除 diff → 不见 git 元数据
// （diff --git/index/@@ 等），只余剥掉 `-` 前缀的删除行（dshk-il-del）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { phase: "deleted" });
stateStore.set(2, {
  phase: "ready",
  xy: " D",
  text: "diff --git a/f.md b/f.md\ndeleted file mode 100644\nindex 5d7d2f8..0000000\n--- a/f.md\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-name: hello-kit\n-\n-# hello\n",
});
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/gone.md", cwd: "C:/x", deleted: true });
const metaNoise = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("diff --git") || c[2].children.startsWith("deleted file mode") || c[2].children.startsWith("@@")));
const delRedLines = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-del").map((c) => c[2].children);
check("删除预览纯内容渲染无异常", !!out && typeof out === "object");
check("删除预览无 git 元数据且为剥前缀红行", !metaNoise && delRedLines.length === 3 && delRedLines[0] === "name: hello-kit" && delRedLines.includes("# hello"));
stateSeq = 0;
stateStore.clear();

// 7) 入口按钮 / 浮层宿主顶部渲染（conversation.input.left + shell.overlay 槽位）
callLog = [];
out = comps.TerminalEntry({});
check("TerminalEntry 渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.FileTreeEntry({});
check("FileTreeEntry 渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.ScmEntry({});
check("ScmEntry 渲染无异常", !!out && typeof out === "object");
// 7.0) 侧栏索引单槽互斥（工具行三钮的选中态 = 侧栏正在显示谁，用户定稿
// 2026-09-10；日程待办索引 2026-09-11 退役）：点源代码管理必须让出知识库目录
// 那一格，否则两个钮同时亮而侧栏只按优先级显示一个
const sidebarResetPatch = { treeOpen: false, gitOpen: false, vaultIdxOpen: false, files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null };
const svp = comps.sidebarViewPatch("vault");
check("sidebarViewPatch 单槽互斥：只亮指定位", svp.vaultIdxOpen === true && svp.treeOpen === false && svp.gitOpen === false);
comps.setKitUi({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", gitOpen: false, treeOpen: false });
callLog = [];
comps.ScmEntry({});
const scmBtnEl = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-enbtn"));
scmBtnEl[2].onClick();
check("ScmEntry 点击后侧栏单槽互斥（知识库索引位让出，两个钮不会同时亮）", comps.getKitUi().gitOpen === true && comps.getKitUi().vaultIdxOpen === false && comps.getKitUi().vaultOpen === true);
comps.setKitUi(sidebarResetPatch);
// 7.1) 后台任务面板：无 hooks（jobsBySession 未达 → 空列表）与有任务两种；
// 入口补丁（openFeatureTab）在这里覆盖：置存在 + 置激活位，纯补丁不触碰别的签
const otj = comps.openFeatureTab({ files: [], jobsOpen: false, browserOpen: false, schedOpen: false, activeFeature: null }, "jobs");
check("openFeatureTab 后台任务：置存在+激活", otj.jobsOpen === true && otj.activeFeature === "jobs");
const ots = comps.openFeatureTab({ files: [], jobsOpen: false, browserOpen: false, schedOpen: false, activeFeature: null }, "schedule");
check("openFeatureTab 日程：置存在+激活（纯补丁不触碰任务签）", ots.schedOpen === true && ots.activeFeature === "schedule" && ots.jobsOpen === undefined);
const otb = comps.openFeatureTab({ files: [], jobsOpen: true, browserOpen: false, activeFeature: "jobs" }, "browser");
check("openFeatureTab 浏览器：纯补丁不触碰任务签（合并保留）", otb.browserOpen === true && otb.activeFeature === "browser" && otb.jobsOpen === undefined);
// 7.1b) 知识库入口（输入行钮 + 快捷键同语义）：只切左侧目录（2026-09-11 用户定稿，
// 点具体页才开右栏知识库签）；再点 = 收回会话列表。补丁只含侧栏三键，功能签与
// 页签状态一律不动（setKitUi 合并语义）
const tvOpen = comps.toggleVaultEntry({ treeOpen: true, vaultIdxOpen: false, vaultOpen: false, vaultPages: [], activeFeature: null });
check("知识库入口开：只切侧栏索引且让出文件树", tvOpen.vaultIdxOpen === true && tvOpen.treeOpen === false && tvOpen.vaultOpen === undefined && tvOpen.activeFeature === undefined);
const tvClose = comps.toggleVaultEntry({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", vaultHist: { stack: ["D:/v/a.md"], idx: 0 }, activeFeature: "vault" });
check("知识库入口再点：索引回会话、知识库签与页签不动（补丁不含这些键）", tvClose.vaultIdxOpen === false && tvClose.vaultOpen === undefined && tvClose.vaultPages === undefined && tvClose.activeVaultPage === undefined && tvClose.activeFeature === undefined);
// 7.1c) 知识库页标签纯逻辑：多开、激活、单关、关光收摊、← → 访问序剪枝
const vp1 = comps.openVaultPageTab({ vaultPages: [], activeVaultPage: null, vaultHist: { stack: [], idx: -1 } }, "D:/v/a.md");
const vp2 = comps.openVaultPageTab(vp1, "D:/v/b.md");
check("openVaultPageTab 多开：一页一签 + 激活 + 访问序", vp2.vaultPages.length === 2 && vp2.activeVaultPage === "D:/v/b.md" && vp2.vaultOpen === true && vp2.activeFeature === "vault" && vp2.vaultHist.stack.length === 2 && vp2.vaultHist.idx === 1);
const vp3 = comps.openVaultPageTab(vp2, "D:/v/a.md");
check("openVaultPageTab 重开已开页：不重复开签、激活并记历史", vp3.vaultPages.length === 2 && vp3.activeVaultPage === "D:/v/a.md" && vp3.vaultHist.idx === 2);
const vpAct = comps.activateVaultPage(vp3, "D:/v/b.md");
check("activateVaultPage 只激活不动访问序", vpAct.activeVaultPage === "D:/v/b.md" && vpAct.vaultHist === undefined && vpAct.vaultPages.length === 2);
check("activateVaultPage 未开的页不认", Object.keys(comps.activateVaultPage(vp3, "D:/v/zz.md")).length === 0);
const vpClose = comps.closeVaultPageTab(vp3, "D:/v/b.md");
check("closeVaultPageTab 单关非激活页：激活位不动 + 历史剪掉该页", vpClose.vaultPages.length === 1 && vpClose.activeVaultPage === undefined && vpClose.vaultOpen === undefined && !vpClose.vaultHist.stack.includes("D:/v/b.md"));
const vpCloseActive = comps.closeVaultPageTab(vp3, "D:/v/a.md");
check("closeVaultPageTab 关激活页：激活位顺延邻居", vpCloseActive.vaultPages.length === 1 && vpCloseActive.activeVaultPage === "D:/v/b.md");
const vpLast = comps.closeVaultPageTab({ vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", vaultOpen: true, vaultHist: { stack: ["D:/v/a.md"], idx: 0 }, activeFeature: "vault" }, "D:/v/a.md");
check("closeVaultPageTab 关最后一个：整片知识库舞台收摊", vpLast.vaultPages.length === 0 && vpLast.vaultOpen === false && vpLast.activeVaultPage === null && vpLast.activeFeature === null);
callLog = [];
out = comps.JobsPanel({});
check("JobsPanel 无hooks渲染无异常(空列表)", !!out && typeof out === "object");
const jobsHooks = {
  useSessions: (sel) =>
    sel({
      current: "s1",
      byId: { s1: { cwd: "C:/x" } },
      jobsBySession: {
        s1: [
          { id: "pwsh-1", kind: "pwsh", label: "npm run dev", status: "running", startedAt: Date.now() - 30000 },
          { id: "pwsh-2", kind: "pwsh", label: "frpc 隧道", status: "stopping", startedAt: Date.now() - 120000 },
        ],
      },
    }),
  useWorkspaces: () => undefined,
};
callLog = [];
out = comps.JobsPanel(jobsHooks);
check("JobsPanel 带运行中任务渲染无异常", !!out && typeof out === "object");
// 输出常显（用户定稿 2026-09-05）：每个任务行自带输出块，不再有「输出」按钮
const jobRows = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-jobs-row");
const jobOutBlocks = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-jobs-output");
check("JobsPanel 输出块每任务常显（2 行 2 输出块）", jobRows.length === 2 && jobOutBlocks.length === 2);
check("JobsPanel 不再渲染「输出」按钮", !callLog.some((c) => (c[0] === "jsx") && c[2] && (c[2].children === "Output" || c[2].children === "输出")));
// 终态保留在列（用户定稿 2026-09-05）：终态行仍在（data-done 淡化），动作变「关闭」，
// 运行中行保持「结束」；输出块每行都在
const doneHooks = {
  useSessions: (sel) =>
    sel({
      current: "s1",
      byId: { s1: { cwd: "C:/x" } },
      jobsBySession: {
        s1: [
          { id: "pwsh-9", kind: "pwsh", label: "npm run build", status: "running", startedAt: Date.now() - 5000 },
          { id: "pwsh-8", kind: "pwsh", label: "npm test", status: "completed", startedAt: Date.now() - 60000, finishedAt: Date.now() - 30000 },
        ],
      },
    }),
  useWorkspaces: () => undefined,
};
callLog = [];
out = comps.JobsPanel(doneHooks);
const doneRows = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-jobs-row" && c[2]["data-done"] === true).length;
const closeBtn = callLog.some((c) => (c[0] === "jsx") && c[2] && (c[2].children === "Close" || c[2].children === "关闭"));
const killBtns = callLog.filter((c) => (c[0] === "jsx") && c[2] && (c[2].children === "Stop" || c[2].children === "结束")).length;
const doneOutBlocks = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-jobs-output").length;
check("JobsPanel 终态行保留在列且标 data-done（1 行）", doneRows === 1);
check("JobsPanel 终态动作是关闭、运行中仍是结束", closeBtn && killBtns === 1);
check("JobsPanel 终态行输出块仍在（2 行 2 输出块）", doneOutBlocks === 2);
comps.setKitUi({ jobsOpen: true });
out = comps.KitSurfaces({ ...jobsHooks });
check("KitSurfaces 带jobsOpen渲染无异常", !!out && typeof out === "object");
comps.setKitUi({ jobsOpen: false });

// 6.4) 日程模块：ScheduleView 初始态 / 弹窗两态 / 计时芯片空闲态 / 并行分列纯函数
callLog = [];
out = comps.ScheduleView({});
check("ScheduleView 初始态渲染无异常（周网格+待办+统计）", !!out && typeof out === "object");
out = comps.ScheduleModal({ modal: { id: null, kind: "event", values: { title: "", description: "", location: "", start: "2026-09-08T09:00", end: "2026-09-08T10:00", allDay: false, recurrence: null, color: "#228be6" } }, onClose: () => {}, onSave: () => {}, onDelete: () => {} });
check("ScheduleModal 事件新建态渲染无异常", !!out && typeof out === "object");
out = comps.ScheduleModal({ modal: { id: "t1", kind: "task", values: { title: "交报告", due: "2026-09-10", completedAt: null } }, onClose: () => {}, onSave: () => {}, onDelete: () => {} });
check("ScheduleModal 待办编辑态渲染无异常", !!out && typeof out === "object");
check("FloatingTimerPill 空闲不渲染（运行中才现身）", comps.FloatingTimerPill() === null);
check("timerElapsedStr：整秒差折 hh:mm:ss", comps.timerElapsedStr(new Date(2026, 8, 7, 10, 0, 40).getTime(), "2026-09-07T10:00:00") === "00:00:40");
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

// 7.2.5) 关页签直关（用户定稿 2026-09-10：宿主 active 识别常不准，「agent 在用」
// 确认与 ● 标识整体退役）——✕ 点击不弹确认
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
global.window.confirm = (msg) => { throw new Error("confirm should never be called") };
let threw = null;
try { tabXs[0][2].onClick(fakeEvent); tabXs[1][2].onClick(fakeEvent); } catch (e) { threw = e; }
global.window.confirm = undefined;
check("页签 ✕ 直关不弹确认", threw === null);

// 7.2.6) 全部页签关闭后的空态：运行中 0 页显示「没有打开的页面」提示，
// 不再留无提示的僵尸画面；预置 running + 空 pages
stateStore.clear();
stateSeq = 0;
stateStore.set(0, { running: true, launching: false, pages: [], activeId: null, viewId: null });
callLog = [];
out = comps.BrowserPanel({ active: true });
const noPagesNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-brw-note" && typeof c[2].children === "string" && ["没有打开的页面", "No open pages"].some((s) => c[2].children.includes(s)));
check("BrowserPanel 运行中 0 页渲染空态提示", !!noPagesNote);

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
const closeLast = comps.closeFileTab({ files: [{ path: "C:/x/a.js", from: "tree", usedAt: 1 }], activeFile: "C:/x/a.js", jobsOpen: true, activeFeature: "file" }, "C:/x/a.js");
check("closeFileTab 关最后一个：整片文件舞台收摊且激活位顺延到余下标签", closeLast.files.length === 0 && closeLast.activeFile === null && closeLast.activeFeature === "jobs");



// 7.2.4c) 侧栏底部按钮区 2026-09-11 撤（用户定稿：后台任务/浏览器入口归右栏
// 开始页清单与自动跟随）——原 footer 断言整节删除

// 7.2.4e) 右栏 pane 正文组件（迁移 2026-09-11）：自建舞台退役后这是唯一外壳，
// 这里直接渲染各 pane 正文验证渲染体；存在性同步走 effect（桩不执行）
comps.setKitUi({
  files: [
    { path: "C:/x/a.js", from: "tree", untracked: false, usedAt: 1 },
    { path: "C:/x/b.md", from: "scm", untracked: true, usedAt: 2 },
  ],
  activeFile: "C:/x/b.md",
});
callLog = [];
out = comps.FilePaneBody({});
const fpChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("C:/x/"));
const fpEditors = callLog.filter((c) => c[1] === comps.FileEditorPane);
const fpWraps = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-pane-view" && c[2].style && typeof c[2].style.display === "string");
const fpLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label" && ["a.js", "b.md"].includes(c[2].children));
check("FilePaneBody 渲染无异常（文档签条 + 两个 FileEditorPane 实例）", !!out && fpChips.length === 2 && fpEditors.length === 2 && fpLabels.length === 2);
check("FilePaneBody 每文件一签、只激活当前签、每签各带 ✕ 单关", fpChips.filter((c) => c[2].className.includes("dshk-tab-on")).length === 1 && fpChips.every((c) => Array.isArray(c[2].children) && c[2].children.some((ch) => ch && ch.props && ch.props.className === "dshk-tab-x")));
check("FilePaneBody 非激活文件仍挂载（激活 flex / 非激活 none）", fpWraps.filter((c) => c[2].style.display === "flex").length === 1 && fpWraps.some((c) => c[2].style.display === "none"));
comps.setKitUi({ files: [], activeFile: null });
comps.setKitUi({ files: [], activeFile: null });
callLog = [];
out = comps.FilePaneBody({});
const fpEmpty = callLog.find((c) => (c[0] === "jsx") && c[2] && (c[2].className === "dshk-rbpane-hint" || c[2].className === "dshk-rbguide"));
check("FilePaneBody 0 文件无空态（最后一页关掉连官方签一起收，用户定稿 2026-09-11）", !!out && !fpEmpty);
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
out = comps.JobsPaneBody(jobsHooks);
check("JobsPaneBody 挂 JobsPanel（透传 hooks 供运行中角标）", !!out && callLog.some((c) => c[1] === comps.JobsPanel));
callLog = [];
out = comps.BrowserPaneBody({});
const bpElemRb = callLog.find((c) => c[1] === comps.BrowserPanel && c[2] && c[2].active === true);
check("BrowserPaneBody 挂 BrowserPanel（active 恒真：pane 显示即在看）", !!out && !!bpElemRb);
callLog = [];
let rbCloseOk = true;
try { comps.closeRightbarTab("file"); } catch { rbCloseOk = false; }
check("closeRightbarTab 服务未就绪时静默不抛", rbCloseOk);
callLog = [];
out = comps.HeaderTimer({});
const timerChip = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-htimer-chip");
check("HeaderTimer 空闲渲染 ▶ 起表芯片", !!out && !!timerChip);
callLog = [];
out = comps.ScheduleTasksCard({ data: { events: [] }, mutate: () => {} });
check("ScheduleTasksCard 空待办渲染卡壳", !!out && typeof out === "object");
// openFileAndDock / openVaultPageAndDock：kitUi 侧补丁在这里断言；右栏
// openTab 走 sidebarRight 服务（桩环境服务未注入，静默不触）
comps.openFileAndDock("C:/x/new.js", "tree", false);
check("openFileAndDock 落 kitUi 文件签", comps.getKitUi().activeFile === "C:/x/new.js" && comps.getKitUi().activeFeature === "file");
comps.openVaultPageAndDock("D:/v/p.md");
check("openVaultPageAndDock 落 kitUi 知识库页签", comps.getKitUi().activeVaultPage === "D:/v/p.md" && comps.getKitUi().vaultOpen === true);
comps.setKitUi({ files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null, vaultHist: { stack: [], idx: -1 }, activeFeature: null });

// 侧栏待办索引 2026-09-11 退役（日程只剩右栏 dock 签）：ScheduleIndexView 与
// toggleSchedEntry 已随之删除，这里不再有渲染用例

// 6.6) 知识库纯函数：frontmatter 拆分 / 解析优先级 / 反链
//（wikilink/数学变换已并入 RTE vendor，往返断言在 tests/test-vault-rte.mjs）
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
check("resolveVaultLink：标题命中", comps.resolveVaultLink(vaultPages, "Python 基础")?.path === "D:/v/wiki/Python/基础.md");
check("resolveVaultLink：rel 全等优先", comps.resolveVaultLink(vaultPages, "wiki/git")?.path === "D:/v/wiki/git.md");
check("resolveVaultLink：.md 后缀容忍", comps.resolveVaultLink(vaultPages, "git.md")?.path === "D:/v/wiki/git.md");
check("resolveVaultLink：未命中回 null", comps.resolveVaultLink(vaultPages, "不存在") === null);
const backlinksHit = comps.vaultBacklinks([
  { path: "D:/v/a.md", rel: "a", title: "A", links: ["B"] },
  { path: "D:/v/b.md", rel: "b", title: "B", links: [] },
  { path: "D:/v/c.md", rel: "c", title: "C", links: ["别的"] },
], "D:/v/b.md");
check("vaultBacklinks：links 解析命中当前页（1 条）", backlinksHit.length === 1 && backlinksHit[0].path === "D:/v/a.md");

// 6.7) 知识库纯函数：标题 slug / 孤儿级联
check("vaultHeadingSlug：空白压成 -", comps.vaultHeadingSlug("  Some 标题 two  ") === "Some-标题-two");
{
  const pages = [
    { path: "D:/v/AGENTS.md", rel: "AGENTS", title: "vault 约定", links: [] },
    { path: "D:/v/index.md", rel: "index", title: "索引", links: ["入门"] },
    { path: "D:/v/入门.md", rel: "入门", title: "入门", links: ["速记"] },
    { path: "D:/v/速记.md", rel: "速记", title: "速记", links: [] },
  ];
  const doomed = comps.vaultCascadeDelete(pages, "D:/v/index.md");
  // 删索引 → 入门失去唯一反链连坐 → 速记又失去入门连坐；AGENTS 受保护且本就无反链不动
  check("孤儿级联：递归闭包 + AGENTS 保护", doomed.length === 3 && doomed.some((p) => p.rel === "入门") && doomed.some((p) => p.rel === "速记") && !doomed.some((p) => p.rel === "AGENTS"));
  const doomed2 = comps.vaultCascadeDelete(pages, "D:/v/速记.md");
  check("孤儿级联：删叶子不连坐他人", doomed2.length === 1 && doomed2[0].rel === "速记");
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
// 6.9c) VaultRootView 索引就绪态的工具条：搜索框独占第二行（2026-09-11 用户定稿：
// 挤成一行时搜索框只剩半截宽）+ ↻ 刷新必须连带重拉目录树——树是懒加载缓存，
// 只刷索引 ⇒ 外部增删的文件在侧栏看不见，用户报的「刷新功能不可用」就是这个
let vaultRefreshFetched = [];
let vaultFetchPrev = null;
{
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { root: "D:/v", spaces: ["library", "wiki"], pages: [{ path: "D:/v/wiki/a.md", rel: "wiki/a", space: "wiki", title: "A", links: [] }] }); // index
  stateStore.set(1, ""); // indexErr
  stateStore.set(2, ""); // space = 全部库
  stateStore.set(3, { "D:/v": [{ name: "wiki", path: "D:/v/wiki", dir: true }], "D:/v/wiki": [{ name: "a.md", path: "D:/v/wiki/a.md", dir: false }] }); // treeDirs
  stateStore.set(4, { "D:/v": true, "D:/v/wiki": true }); // expanded
  const fetched = vaultRefreshFetched;
  const prevFetch = global.fetch;
  vaultFetchPrev = prevFetch;
  global.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => ({ root: "D:/v", spaces: ["wiki"], pages: [], entries: [] }) };
  };
  comps.vaultSideSlot.set({ tagName: "DIV" });
  comps.setKitUi({ vaultIdxOpen: true, vaultOpen: true, vaultPages: [], activeVaultPage: null, activeFeature: "vault" });
  callLog = [];
  let barErr = null;
  try {
    comps.VaultRootView({});
  } catch (e) {
    barErr = e;
  }
  const rows = callLog.filter((c) => c[0] === "jsxs" && c[2] && c[2].className === "dshk-vault-tbarrow");
  check("知识库工具条渲染无异常且分两行", barErr === null && rows.length === 2);
  if (barErr) console.log("  VaultRootView error:", barErr.message);
  const barRow1 = rows[0] ? rows[0][2].children : [];
  const barRow2 = rows[1] ? rows[1][2].children : [];
  const refreshBtn = barRow1.find((ch) => ch && ch.props && ["刷新索引与目录树", "Refresh index and tree"].includes(ch.props.title));
  check("搜索框独立一行（第二行只有搜索框）", barRow2.length === 1 && barRow2[0].props.className === "dshk-vault-search");
  check("上行保留导航/空间/刷新，刷新钮提示走自己的 i18n 键", barRow1.length === 4 && !!refreshBtn);
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
// 6.9b) VaultPagePane 直渲（一页一个实例的新组件）：预置 state#0（page 已加载）
// 走完整编辑面，预置 state#2（冲突）走冲突条分支
{
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { loading: false, body: "# 标题\n\n正文", binary: false, gone: false });
  callLog = [];
  let paneErr = null;
  try {
    comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: true, root: "D:/v", indexPages: [], onOpenPage: () => {}, onMissingLink: () => {}, onSaved: () => {}, onDeleted: () => {}, toast: () => {} });
  } catch (e) {
    paneErr = e;
  }
  const editbar = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-editbar");
  const citeBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["引用到对话", "Cite to chat"].includes(c[2].title));
  const rte = callLog.find((c) => c[1] === comps.RteEditor);
  check("VaultPagePane 渲染无异常（页条 + RTE 就位）", paneErr === null && !!editbar && !!citeBtn && !!rte);
  if (paneErr) console.log("  VaultPagePane error:", paneErr.message);
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { loading: false, body: "x", binary: false, gone: false });
  stateStore.set(2, { diskMtime: 123 });
  callLog = [];
  comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: false, root: "D:/v", indexPages: [], onOpenPage: () => {}, onMissingLink: () => {}, onSaved: () => {}, onDeleted: () => {}, toast: () => {} });
  const conflictBar = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-conflict");
  const paneRoot = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-reader" && c[2].style);
  check("VaultPagePane 冲突态渲染冲突条（覆盖/读取）", !!conflictBar);
  check("VaultPagePane 非激活标签保挂载但 display:none", !!paneRoot && paneRoot[2].style.display === "none");
  stateSeq = 0;
  stateStore.clear();
}
// 文件标签（多开）在 7.2.2 覆盖，舞台不可收起在 7.2.4 覆盖

// 7.2.3) 文件标签 LRU 纯逻辑：默认上限 3，超限开新文件逐出 usedAt 最小者（=关掉
// 最久没看的那张标签）；重开已存在文件置顶激活不逐出自身
const lruBase = [];
for (let i = 1; i <= 3; i++) lruBase.push({ path: `C:/x/f${i}.js`, from: "tree", untracked: false, usedAt: i });
const opened = comps.openFileTab({ files: lruBase, activeFile: "C:/x/f3.js" }, "C:/x/f4.js", "tree", false);
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

// 7.2.3c) 提交钉定 diff 视图：顶部基线说明（父短哈希/根提交空树）；复用全文件
// 着色（新像 = 该提交时刻的内容，由 diff 响应带回）而非叠当前盘上内容；
// 新像缺失分支——该提交已删除的文件走纯红删除块，过大/二进制回落原始 patch。
// 桩 effect 不执行，diff 态用 stateStore 预置（#0 state、#1 mode、#2 diff）
const commitDiffText = "diff --git a/f.js b/f.js\nindex 111..222 100644\n--- a/f.js\n+++ b/f.js\n@@ -1 +1 @@\n-old\n+new\n";
const readyBody = { phase: "ready", body: { path: "C:/x/f.js", size: 2, mtimeMs: 1, truncated: false, binary: false, content: "x\n" } };
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText, content: "new\n" });
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "full40hash" });
const baseNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diffnote" && typeof c[2].children === "string" && c[2].children.includes("abcd123"));
const overlayRows = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-inline");
const rawOnly = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diff");
check("提交钉定 diff 渲染基线说明（父提交 abcd123）", !!baseNote);
check("提交钉定 diff 复用全文件着色（新像=提交时刻内容）", !!overlayRows && !rawOnly);
// 该提交已删除的文件（blobMissing）：纯红删除块，不出元数据噪音
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText, blobMissing: true });
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "full40hash" });
const delRed = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-del").map((c) => c[2].children);
const delMeta = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("diff --git") || c[2].children.startsWith("@@")));
check("提交钉定删除文件走纯红块（无元数据噪音）", delRed.includes("old") && !delRed.includes("new") && !delMeta);
// 新像缺失（过大/二进制，无 content 无 blobMissing）：回落原始 patch
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText });
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "full40hash" });
const rawFallback = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diff");
check("钉定无新像回落原始 patch", !!rawFallback);
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, base: "", text: commitDiffText });
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "root40hash" });
const rootNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diffnote" && typeof c[2].children === "string" && (c[2].children.includes("empty tree") || c[2].children.includes("空树")));
check("根提交钉定显示空树基线说明", !!rootNote);
// 非 commit 的常规 diff 视图不受影响：hunk 仍套回盘上内容（全文件着色）
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, text: commitDiffText });
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm" });
const normalOverlay = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-inline");
check("常规 diff 视图仍套盘上内容（无 commit 钉定）", !!normalOverlay);
// 预览头部标题：绝对路径（文件名由页签 chip 承担）
callLog = [];
out = comps.FileEditorPane({ path: "C:/x/dir/f.js", cwd: "C:/x", source: "scm" });
const titleAbs = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-title" && c[2].children === "C:/x/dir/f.js");
check("预览头部标题显示绝对路径", !!titleAbs);
check("预览头部不挂 title 悬停（全路径已直显，悬停只留页签 chip）", !!(titleAbs && titleAbs[2] && titleAbs[2].title === undefined));
stateStore.clear();

// 7.5) 终端坞（多标签）：预置两个会话（含同 cwd 多开）后渲染——标签 map 曾因
// 变量遮蔽翻译函数 t 而崩溃，此用例专防"有状态后才走到的渲染分支"
comps.setKitUi({ terminals: [comps.makeTerm("C:/x"), comps.makeTerm("C:/x")], activeTermId: null, termDockOpen: true });
callLog = [];
out = comps.TerminalDock({ open: true, cwd: "C:/x", onSpawn: () => {}, onHide: () => {}, onActivate: () => {}, onKill: () => {} });
check("TerminalDock 带标签渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.TerminalPane({ term: { id: "t1", cwd: "C:/x" }, visible: true });
check("TerminalPane 渲染无异常", !!out && typeof out === "object");
comps.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 无hooks渲染无异常", !!out && typeof out === "object");
// 更改视图：无 cwd 与加载态
callLog = [];
out = comps.GitChangesPanel({ cwd: null, onOpenFile: () => {}, onClose: () => {} });
check("GitChangesPanel noCwd 渲染无异常", !!out && typeof out === "object");
// 图谱视图：无 cwd（不触发拉取/轮询）
callLog = [];
out = comps.GitGraphPanel({ cwd: null, onOpenFile: () => {} });
check("GitGraphPanel noCwd 渲染无异常", !!out && typeof out === "object");
// 图谱 lane 几何纯函数：线性链 / 分叉（兄弟提交并拢进父）/ 合并（多线收进主槽位）/ 窗口悬挂
const geoLinear = comps.computeCommitGraph([
  { H: "c3", h: "c3", p: ["c2"], an: "a", at: 1, s: "s3", d: "" },
  { H: "c2", h: "c2", p: ["c1"], an: "a", at: 2, s: "s2", d: "" },
  { H: "c1", h: "c1", p: [], an: "a", at: 3, s: "s1", d: "main" },
]);
check("lane 几何：线性链单 lane 且逐行消费", geoLinear.rows.length === 3 && geoLinear.laneCount === 1 && geoLinear.rows[0].outs.length === 1 && geoLinear.rows[0].ins.length === 0 && geoLinear.rows[1].ins.length === 1 && geoLinear.rows[2].ins.length === 1 && geoLinear.rows[2].outs.length === 0);
const geoFork = comps.computeCommitGraph([
  { H: "a1", h: "a1", p: ["p0"], an: "a", at: 1, s: "feat", d: "HEAD -> main" },
  { H: "b1", h: "b1", p: ["p0"], an: "b", at: 2, s: "fix", d: "" },
  { H: "p0", h: "p0", p: [], an: "a", at: 3, s: "base", d: "main" },
]);
check("lane 几何：兄弟分叉各占 lane 并拢进父（颜色恒定）", geoFork.rows.length === 3 && geoFork.rows[0].lane === 0 && geoFork.rows[1].lane === 1 && geoFork.rows[1].color === 1 && geoFork.rows[2].ins.length === 2 && geoFork.laneCount === 2 && geoFork.rows[0].color === 0);
const geoMerge = comps.computeCommitGraph([
  { H: "m1", h: "m1", p: ["ma", "mb"], an: "a", at: 1, s: "merge", d: "" },
  { H: "ma", h: "ma", p: ["base"], an: "a", at: 2, s: "a", d: "" },
  { H: "mb", h: "mb", p: ["base"], an: "b", at: 3, s: "b", d: "" },
  { H: "base", h: "base", p: [], an: "a", at: 4, s: "base", d: "main" },
]);
check("lane 几何：合并提交双父两 lane 汇入", geoMerge.rows.length === 4 && geoMerge.rows[0].outs.length === 2 && geoMerge.rows[0].outs[0].x === 0 && geoMerge.rows[0].outs[1].x === 1 && geoMerge.rows[3].ins.length === 2);
const geoHang = comps.computeCommitGraph([{ H: "x1", h: "x1", p: ["gone"], an: "a", at: 1, s: "s", d: "" }]);
check("lane 几何：窗口截断的父槽位悬挂延续", geoHang.rows.length === 1 && geoHang.rows[0].outs.length === 1 && geoHang.rows[0].outs[0].x === 0);
const geoEmpty = comps.computeCommitGraph([]);
check("lane 几何：空输入安全默认", geoEmpty.rows.length === 0 && geoEmpty.laneCount === 1);

// 图谱面板：预置结构化 records（stub effect 不跑、fetch 不会覆盖预置态）→
// 行渲染出 SVG/作者/相对时间列 + load more 按钮
stateStore.clear();
stateSeq = 0;
const nowSec = Math.floor(Date.now() / 1000);
stateStore.set(0, {
  available: true,
  hasMore: true,
  records: [
    { H: "a1", h: "a1aa", p: ["p0"], an: "张三", at: nowSec - 3600, s: "feat: 图谱", d: "HEAD -> main" },
    { H: "b1", h: "b1bb", p: ["p0"], an: "李四", at: nowSec - 7200, s: "fix: 分支", d: "" },
    { H: "p0", h: "p000", p: [], an: "张三", at: nowSec - 86400, s: "初始提交", d: "main" },
  ],
});
callLog = [];
out = comps.GitGraphPanel({ cwd: "C:/x", root: "C:/x", onOpenFile: () => {} });
const graphRows = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-grow dshk-grow-click");
const graphAuthors = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-gauthor");
const graphDates = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-gdate");
const moreBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-gmore");
// 注意：CommitGraphSvg 是嵌套组件，桩只记录元素不执行组件体（已知盲区）——
// SVG 的 path/circle 产出用下面直调用例覆盖，面板级断言只数行与列
check("GitGraphPanel 结构化行渲染（3 行+作者+时间列）", graphRows.length === 3 && graphAuthors.length === 3 && graphDates.length === 3);
check("GitGraphPanel hasMore 渲染 load more 按钮", !!moreBtn && typeof moreBtn[2].onClick === "function");
callLog = [];
const svgRow = comps.CommitGraphSvg({ row: geoFork.rows[0], laneCount: 2 });
const svgParts = callLog.filter((c) => (c[0] === "jsx") && (c[1] === "path" || c[1] === "circle"));
const svgNode = callLog.find((c) => (c[0] === "jsx") && c[1] === "circle");
check("CommitGraphSvg 直调渲染出边/点（父边+circle）", !!svgRow && svgParts.length >= 2 && !!svgNode && svgNode[2].cy === 11);
// 分支浮层：空态 + 列表态（无 hooks 依赖，直接渲染）
callLog = [];
out = comps.GitBranchMenu({ rect: { left: 20, top: 40 }, branches: null, busy: false, name: "", onName: () => {}, onCreate: () => {}, onSwitch: () => {}, onDelete: () => {}, onClose: () => {} });
check("GitBranchMenu 空态渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.GitBranchMenu({ rect: { left: 20, top: 40 }, branches: { branches: [
  { name: "main", isHead: true, upstream: null, track: "", trackParsed: null },
  { name: "dev", isHead: false, upstream: "origin/dev", track: "[ahead 1]", trackParsed: { ahead: 1, behind: 0, gone: false } },
] }, busy: false, name: "x", created: "dev", onName: () => {}, onCreate: () => {}, onSwitch: () => {}, onDelete: () => {}, onClose: () => {} });
check("GitBranchMenu 列表渲染无异常", !!out && typeof out === "object");
// GitActionsMenu 2026-09-11 随 ⋯ 菜单撤除（拉取推送收敛进 ↑↓ 同步钮）——原渲染断言删除

// 8) SkillsManager（技能管理页）：无 hooks（cwd=null）与有 cwd 两种
callLog = [];
const fakeHooks = {
  useSessions: (sel) => sel({ current: "s1", byId: { s1: { cwd: "C:/x" } } }),
  useWorkspaces: () => undefined,
};
out = comps.KitSurfaces(fakeHooks);
check("KitSurfaces 带cwd渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.SkillsManager({});
check("SkillsManager 无hooks渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.SkillsManager(fakeHooks);
check("SkillsManager 带cwd渲染无异常", !!out && typeof out === "object");

// 10) MonitorLine（会话监视条）：空闲无 turn-error 时渲染 null（占位不占视觉）；
//     桩 useEffect 不执行 → 检测逻辑不跑，只验证渲染体不抛异常。
//     置于 KitConfigCard 之前：末位断言「实际产出元素」要求最后一个渲染非 null
callLog = [];
const fakeSnap = {
  legacy: {
    nodes: [{ kind: "assistant", seq: 1 }, { kind: "turn-error", seq: 2, code: "RATE_LIMIT", message: "x" }],
    partial: null,
  },
};
out = comps.MonitorLine({
  useChat: (sel) => sel(fakeSnap),
  useSession: (sel) => sel({ running: false }),
  useInput: (sel) => sel({ draft: "" }),
  inputActions: { setDraft() {}, submit() {} },
  sessionId: "s1",
});
check("MonitorLine 空闲渲染无异常（null/条）", out === null || (typeof out === "object" && !!out));

// 10b) monitorTailRepeatCount：死循环判定的纯函数（尾部自重叠扫描）
const rep = (unit, n) => unit.repeat(n);
check("尾部重复块 ≥3 次被检出", comps.monitorTailRepeatCount(rep("我不能继续回答这个问题。", 5)) >= 3);
check("尾部重复短块按对齐穷举检出", comps.monitorTailRepeatCount("前文正常叙述。" + rep("ABCDEFGH", 4)) >= 4);
check("普通非重复文本不误报", comps.monitorTailRepeatCount("这是一段完全正常的回复内容，包含各种各样的字符与句子结构，不会触发循环判定。") < 3);
check("短于两倍最短块长的文本不误报", comps.monitorTailRepeatCount("abcabc") < 2);
check("短分隔符块（<8字符）不误报", comps.monitorTailRepeatCount("---\n---\n---\n---\n") < 3);
check("重复不在尾部不算（历史重复已翻篇）", comps.monitorTailRepeatCount(rep("重复片段测样", 5) + "之后是完全不同的收尾内容，正常结束。") < 3);
check("空串安全", comps.monitorTailRepeatCount("") === 1);

// 10c) 监视条接管/恢复判据（F1/F3 修复的纯函数）：
//      F1——429 历史错误 + 后续成功收尾的会话，错误不再是最后一条事件，不得接管
//      （旧实现只按 seq 记账，切会话/刷新后会把这条历史错误当当前失败再发「继续」）
{
  const hist = [
    { kind: "user", seq: 1 },
    { kind: "assistant", seq: 2 },
    { kind: "turn-error", seq: 3, code: "RATE_LIMIT" },
    { kind: "user", seq: 4 }, // 续跑「继续」
    { kind: "assistant", seq: 5 }, // 正常收尾
  ];
  check("F1 历史错误+后续成功：不接管", comps.monitorTakeoverError(hist) === null);
  check("F1 错误仍在末尾：照常接管", comps.monitorTakeoverError(hist.slice(0, 3))?.code === "RATE_LIMIT");
  check("F1 无错误：null", comps.monitorTakeoverError([{ kind: "assistant", seq: 9 }]) === null);
  check("F1 空对话：null", comps.monitorTakeoverError([]) === null);
  // 宿主若在尾部追加记账类节点，「末条节点恰好是 turn-error」会漏判——max-seq 判据下
  // 错误仍并列最大 → 接管；错误 seq 落后于记账节点 → 不接管
  check("F1 尾部记账节点与错误同 seq：仍接管", comps.monitorTakeoverError([{ kind: "turn-error", seq: 7, code: "RATE_LIMIT" }, { kind: "usage", seq: 7 }])?.code === "RATE_LIMIT");
  check("F1 错误 seq 落后尾部节点：不接管", comps.monitorTakeoverError([{ kind: "turn-error", seq: 7, code: "RATE_LIMIT" }, { kind: "usage", seq: 8 }]) === null);
  // F3——恢复判定：收尾不是 turn-error、也不是监视器停止的 interrupted assistant
  check("F3 assistant 正常收尾：算恢复", comps.monitorRecoveredTail([{ kind: "user", seq: 1 }, { kind: "assistant", seq: 2 }]) === true);
  check("F3 工具/记账节点收尾：也算恢复（旧实现漏判的形状）", comps.monitorRecoveredTail([{ kind: "assistant", seq: 2 }, { kind: "tool", seq: 3 }]) === true);
  check("F3 turn-error 收尾：不算恢复", comps.monitorRecoveredTail([{ kind: "assistant", seq: 2 }, { kind: "turn-error", seq: 3, code: "RATE_LIMIT" }]) === false);
  check("F3 监视器停止（interrupted）：不算恢复", comps.monitorRecoveredTail([{ kind: "assistant", seq: 2, interrupted: true }]) === false);
  check("F3 空对话：不算恢复", comps.monitorRecoveredTail([]) === false);
}

// 10d) 阅读位置记忆（F2）：按路径存取 + 隐藏容器不记（display:none 时 scrollTop
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

// 9) KitConfigCard（插件设置卡）：ready 快照 + 覆盖态
callLog = [];
const fakeScope = {
  getSnapshot: () => ({
    status: "ready",
    writable: true,
    value: { terminalEnabled: true, fileTreeEnabled: false, skillsPageEnabled: true, terminalShortcut: "Ctrl+Alt+T", fileTreeShortcut: "Ctrl+E" },
    user: { fileTreeEnabled: false, terminalShortcut: "Ctrl+Alt+T" },
    base: {},
  }),
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
};
out = comps.KitConfigCard({ scope: fakeScope });
check("KitConfigCard 渲染无异常", !!out && typeof out === "object");
// 设置卡布局整理（2026-09-11 用户定稿）：两个侧边栏快捷键并入「侧边栏」组（组头
// + 左/右两键，启用开关 2026-09-11 撤——Ctrl+B 恒生效），字段行走官方通用设置
// 模型（标题+说明左列、控件右置）
check(
  "侧边栏组只含左右两键且带组头、无启用位",
  src.includes('{ title: "cfgGroupSidebar", switchKey: null, fields: ["sidebarShortcut", "rightbarShortcut"] }') && src.includes('cfgGroupSidebar: "侧边栏"') && !src.includes("sidebarShortcutEnabled"),
);
// 默认值与宿主 Config schema（src/index.ts）逐项同值：恢复默认拿的是宿主组合基座
// （base 只带 vaultRoot 一项，2026-09-11 dev 环境实测），其余键由 cfgFormat 回落
// 客户端内置默认——两处漂移就会出现「恢复默认后跳到别的值」
{
  const hostSrc = fs.readFileSync(__dirname + "/../src/index.ts", "utf8");
  const drift = [];
  const missing = [];
  let compared = 0;
  for (const m of hostSrc.matchAll(/^ {4}(\w+): z\.(?:boolean|number|string)\(\)[^,\n]*\.default\(([^)]*)\),?$/gm)) {
    const key = m[1];
    if (!Object.prototype.hasOwnProperty.call(comps.CFG_DEFAULTS, key)) { missing.push(key); continue; }
    const raw = m[2].trim();
    const expected =
      raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : /^'[^']*'$/.test(raw) ? raw.slice(1, -1) : undefined;
    if (expected === undefined) continue; // 表达式默认（defaultVaultRoot() 之类）不比对
    compared++;
    if (comps.CFG_DEFAULTS[key] !== expected) drift.push(key + "(bundle=" + comps.CFG_DEFAULTS[key] + ",host=" + expected + ")");
  }
  check("设置卡内置默认与宿主 schema 逐项同值（比对 " + compared + " 项；漂移 " + (drift.join("/") || "无") + "；schema 独有 " + (missing.join("/") || "无") + "）", drift.length === 0 && missing.length === 0 && compared >= 20);
}
// 开关类字段的「恢复默认」显示：基座缺该项时按内置默认渲染。默认关的
// phoneKeepGatewayOn 曾被 cfgFormat 的 undefined → "true" 兜底成勾选态——
// 界面显示已恢复默认、实际保存后是关，两边对不上（2026-09-11 用户实测）
check(
  "恢复默认：bool 字段缺基座项回落内置默认（phoneKeepGatewayOn 默认 false）",
  comps.cfgFormat("phoneKeepGatewayOn", undefined) === "false" &&
    comps.cfgFormat("terminalEnabled", undefined) === "true" &&
    comps.cfgFormat("phoneKeepGatewayOn", true) === "true" &&
    comps.cfgFormat("phoneKeepGatewayOn", false) === "false",
);
// 过时文案清理：现行说明不得再提「侧栏底部『任务』钮」（该入口 2026-09-11 撤）、
// 搜索默认改 2、日程索引标题键已废（历史迁移记录型注释不算）
check(
  "设置卡过时文案已更新（无侧栏底部钮现行说法/默认 5/schedIdxTitle）",
  !src.includes("侧栏底部「") && !src.includes("默认 5") && !src.includes("schedIdxTitle"),
);
// OpenCode Go 会话头已非配置项（内置行为，2026-09-08 用户定）：i18n 键与旧
// 写入端点都必须不存在；注入机制本身由 test-opencode-session.mjs 覆盖
check(
  "OpenCode Go 会话头已不出现在设置卡（i18n 键与旧端点均移除）",
  !src.includes("cfgOpenCodeSession") && !src.includes('"/dsh-kit/opencode-session"'),
);

// 文件编辑面（2026-09-10 用户实测两条）：① 自动保存提示条去掉（提示条容器与两枚
// i18n 键都不得再出现）；② CM 宿主走状态化回调 ref——宿主会被 React 换新节点，
// 元素不进依赖就等于「切 diff 再切回原文一片空白」，另外那个从没挂到 DOM 上的
// 只读 ref 也一并删掉了；③ 空文件不再落「文件为空」分支（新建的空文件要能写）
check(
  "文件编辑面不再有自动保存提示条（.dshk-editbar 与两枚 i18n 键均移除）",
  !src.includes("dshk-editbar") && !src.includes("editRteHint") && !src.includes("editAutosaveHint"),
);
check(
  "CM 编辑面宿主走状态化回调 ref（切视图能重建，不留悬空实例/死 ref）",
  src.includes("ref: setCmHost") && !src.includes("readHostRef") && !src.includes("cmHostRef"),
);
check("空文本文件不落「文件为空」分支（可编辑）", !src.includes('b.content === null || b.content === ""'));
// 语法配色令牌（--dshk-tok-*）挂在 .dshk-cm-scope 上，而 vendor 的 CM6.create 是把
// 这个类加到 view.dom（.cm-editor）上的——CM6 首次更新会重写自己的 className，那些类
// 会被抹掉，于是「打开有高亮、一点击/一输入就没色」。所以宿主 div 必须自己带这个类
// （React 拥有的稳定祖先，配色变量经继承生效）
check(
  "CM 宿主自带 dshk-cm-scope（配色变量靠 React 祖先承载，不靠 vendor 加在 view.dom 上的类）",
  src.includes('"dshk-editarea dshk-cm-host dshk-cm-scope"'),
);
// CM6 baseTheme 自带 .cm-focused 的 1px dotted #212121 轮廓（点击进编辑器就冒虚线框）：
// 明写清掉，防日后「顺手」把它删了又冒出来
check("CM 焦点虚线框已清掉（.cm-focused outline:none）", src.includes(".dshk-cm-host .cm-editor.cm-focused{outline:none}"));

// 日程左侧半边退役（2026-09-11 用户定稿：日程只剩右栏 dock 签，入口归右栏开始页
// 与待办卡）——侧栏待办索引、日程快捷键及其设置项都不得再出现；右栏开合快捷键
// （Ctrl+Alt+B，可配置）取而代之
check(
  "日程侧栏索引与专属快捷键已退役（schedIdxOpen/schedShortcut 全链移除）",
  !src.includes("schedIdxOpen") && !src.includes("schedShortcut") && !src.includes("cfgSchedShortcut") && !src.includes("ScheduleIndexView"),
);
check("右栏收起/展开快捷键已接入（默认 Ctrl+Alt+B，走 sidebarRight.toggleExpanded）", src.includes('rightbarShortcut: "Ctrl+Alt+B"') && src.includes("sr.toggleExpanded()"));
// 文件树「上传文件到当前目录」退役（2026-09-11 用户定稿）：按钮/隐藏 input/上传
// 逻辑/i18n 键整链移除；vault 附件上传仍走 /dsh-kit/upload（端点保留）
check(
  "文件树上传按钮与逻辑已整链移除（vault 附件上传不受影响）",
  !src.includes("UploadIcon") && !src.includes("treeUpload") && !src.includes("uploadDone") && !src.includes("uploadFail"),
);
// SCM 面板分支按钮曾被 .dshk-btn 的 26px 方钮定宽压扁（svg/分支名 0 宽只剩 ▾，
// 用户截图「源代码管理图标没了」）——分支按钮必须显式 width:auto 反制
check("分支按钮不被 .dshk-btn 定宽压扁（width:auto 修正恒在）", src.includes(".dshk-branchbtn{display:inline-flex;flex:none;width:auto"));

// React 桩记录到的组件类型必须包含本插件自定义组件名（防 ReferenceError 被忽略后整段缺失）
const types = new Set(callLog.flatMap(([, t]) => (typeof t === "string" ? [t] : [])));
// 至少渲染出来 JSX 元素（说明走到 render 而非静默 null）
check("渲染体实际产出元素", callLog.length > 0);

// 收尾结算放进 setTimeout：6.9c 里 ↻ 刷新的目录树重拉排在 await loadIndex()
// 之后的微任务里，同步段看不到；微任务先于定时器清空，此刻断言才成立
setTimeout(() => {
  const treeHits = vaultRefreshFetched.filter((u) => u.includes("/dsh-kit/tree"));
  check("↻ 刷新连带重拉每个已展开目录（/dsh-kit/tree ×2）", treeHits.length === 2);
  global.fetch = vaultFetchPrev;
  console.log(failed === 0 ? "ALL RENDER OK" : `${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}, 0);
