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
  "return { vaultSideSlot, vaultStageSlot, TreeNode, FileTreePanel, FileEditorPane, TerminalEntry, FileTreeEntry, ScmEntry, VaultEntry, SchedEntry, JobsPanel, PhoneSection, KitSurfaces, KitConfigCard, GitChangesPanel, GitGraphPanel, GitBranchMenu, GitActionsMenu, SkillsManager, TerminalDock, TerminalPane, TreeRowMenu, CommitGraphSvg, computeCommitGraph, BrowserPanel, StagePane, SidebarFooterActions, ScheduleIndexView, RteEditor, VaultPagePane, openFileTab, activateFileTab, closeFileTab, openStageTab, closeStageTab, openVaultPageTab, closeVaultPageTab, activateVaultPage, toggleVaultEntry, openVaultEntry, toggleSchedEntry, sidebarViewPatch, maybeAutoOpenBrowser, closeBrowserDockForGone, getKitUi, stageAlive, stageBounds, stageWidthFor, stageIsPinned, stageWidthCommit, stagePinToggle, setKitUi, makeTerm, ScheduleView, ScheduleModal, FloatingTimerPill, timerElapsedStr, timerMinsOfDT, schedAssignLanes, VaultView, VaultRootView, vaultSplitFrontmatter, resolveVaultLink, vaultBacklinks, vaultCascadeDelete, vaultHeadingSlug, MonitorLine, monitorTailRepeatCount, isPathInsideVaultRoot, vaultCiteText };",
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
const names = ["TreeNode", "FileTreePanel", "FileEditorPane", "TerminalEntry", "FileTreeEntry", "ScmEntry", "VaultEntry", "SchedEntry", "JobsPanel", "PhoneSection", "KitSurfaces", "KitConfigCard", "GitChangesPanel", "GitGraphPanel", "GitBranchMenu", "GitActionsMenu", "SkillsManager", "TerminalDock", "TerminalPane", "CommitGraphSvg", "BrowserPanel", "StagePane", "SidebarFooterActions", "ScheduleIndexView", "RteEditor", "VaultPagePane", "openStageTab", "activateFileTab", "closeFileTab", "openVaultPageTab", "closeVaultPageTab", "activateVaultPage", "sidebarViewPatch", "toggleVaultEntry", "toggleSchedEntry", "stageBounds", "ScheduleView", "ScheduleModal", "FloatingTimerPill", "timerElapsedStr", "timerMinsOfDT", "schedAssignLanes", "VaultView", "VaultRootView", "vaultSplitFrontmatter", "resolveVaultLink", "vaultBacklinks", "vaultCascadeDelete", "vaultHeadingSlug", "MonitorLine", "monitorTailRepeatCount", "isPathInsideVaultRoot", "vaultCiteText"];
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
// 7.0) 侧栏索引单槽互斥（工具行四钮的选中态 = 侧栏正在显示谁，用户定稿
// 2026-09-10）：点源代码管理必须让出知识库目录那一格，否则两个钮同时亮而侧栏
// 只按优先级显示一个
const sidebarResetPatch = { treeOpen: false, gitOpen: false, vaultIdxOpen: false, schedIdxOpen: false, files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null };
const svp = comps.sidebarViewPatch("sched");
check("sidebarViewPatch 单槽互斥：只亮指定位", svp.schedIdxOpen === true && svp.treeOpen === false && svp.gitOpen === false && svp.vaultIdxOpen === false);
comps.setKitUi({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", gitOpen: false, treeOpen: false, schedIdxOpen: false });
callLog = [];
comps.ScmEntry({});
const scmBtnEl = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-enbtn"));
scmBtnEl[2].onClick();
check("ScmEntry 点击后侧栏单槽互斥（知识库索引位让出，两个钮不会同时亮）", comps.getKitUi().gitOpen === true && comps.getKitUi().vaultIdxOpen === false && comps.getKitUi().vaultOpen === true);
comps.setKitUi(sidebarResetPatch);
// 7.1) 后台任务面板：无 hooks（jobsBySession 未达 → 空列表）与有任务两种；
// 入口在舞台「+」菜单与侧栏底部钮，openStageTab 纯补丁在这里覆盖
const otj = comps.openStageTab({ files: [], jobsOpen: false, browserOpen: false, schedOpen: false, stageTab: null }, "jobs");
check("openStageTab 后台任务：置存在+激活", otj.jobsOpen === true && otj.stageTab === "jobs");
const ots = comps.openStageTab({ files: [], jobsOpen: false, browserOpen: false, schedOpen: false, stageTab: null }, "schedule");
check("openStageTab 日程：置存在+激活（纯补丁不触碰任务标签）", ots.schedOpen === true && ots.stageTab === "schedule" && ots.jobsOpen === undefined);
const otb = comps.openStageTab({ files: [], jobsOpen: true, browserOpen: false, stageTab: "jobs" }, "browser");
check("openStageTab 浏览器：纯补丁不触碰任务标签（合并保留）", otb.browserOpen === true && otb.stageTab === "browser" && otb.jobsOpen === undefined);
// 7.1b) 知识库/日程入口（输入行两钮 + 快捷键同语义）：开=侧栏索引+舞台标签
// 一起开，再点=两边一起关（用户定稿 2026-09-10）
const tvOpen = comps.toggleVaultEntry({ treeOpen: true, vaultIdxOpen: false, vaultOpen: false, vaultPages: [], stageTab: null });
check("知识库入口开：索引 + 舞台标签一起开且关掉文件树", tvOpen.vaultIdxOpen === true && tvOpen.vaultOpen === true && tvOpen.stageTab === "vault" && tvOpen.treeOpen === false);
const tvClose = comps.toggleVaultEntry({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", vaultHist: { stack: ["D:/v/a.md"], idx: 0 }, stageTab: "vault" });
check("知识库入口再点：索引回会话 + 中间页标签一并关掉", tvClose.vaultIdxOpen === false && tvClose.vaultOpen === false && tvClose.vaultPages.length === 0 && tvClose.activeVaultPage === null && tvClose.stageTab === null);
const tsOpen = comps.toggleSchedEntry({ vaultIdxOpen: true, schedIdxOpen: false, schedOpen: false, stageTab: "vault" });
check("日程入口开：索引 + 舞台日程标签一起开且关掉知识库索引", tsOpen.schedIdxOpen === true && tsOpen.schedOpen === true && tsOpen.stageTab === "schedule" && tsOpen.vaultIdxOpen === false);
const tsClose = comps.toggleSchedEntry({ schedIdxOpen: true, schedOpen: true, stageTab: "schedule", files: [{ path: "C:/x/a.js" }] });
check("日程入口再点：索引回会话 + 日程标签关掉（激活位顺延到文件）", tsClose.schedIdxOpen === false && tsClose.schedOpen === false && tsClose.stageTab === "file");
// 7.1c) 知识库页标签纯逻辑：多开、激活、单关、关光收摊、← → 访问序剪枝
const vp1 = comps.openVaultPageTab({ vaultPages: [], activeVaultPage: null, vaultHist: { stack: [], idx: -1 } }, "D:/v/a.md");
const vp2 = comps.openVaultPageTab(vp1, "D:/v/b.md");
check("openVaultPageTab 多开：一页一签 + 激活 + 访问序", vp2.vaultPages.length === 2 && vp2.activeVaultPage === "D:/v/b.md" && vp2.vaultOpen === true && vp2.stageTab === "vault" && vp2.vaultHist.stack.length === 2 && vp2.vaultHist.idx === 1);
const vp3 = comps.openVaultPageTab(vp2, "D:/v/a.md");
check("openVaultPageTab 重开已开页：不重复开签、激活并记历史", vp3.vaultPages.length === 2 && vp3.activeVaultPage === "D:/v/a.md" && vp3.vaultHist.idx === 2);
const vpAct = comps.activateVaultPage(vp3, "D:/v/b.md");
check("activateVaultPage 只激活不动访问序", vpAct.activeVaultPage === "D:/v/b.md" && vpAct.vaultHist === undefined && vpAct.vaultPages.length === 2);
check("activateVaultPage 未开的页不认", Object.keys(comps.activateVaultPage(vp3, "D:/v/zz.md")).length === 0);
const vpClose = comps.closeVaultPageTab(vp3, "D:/v/b.md");
check("closeVaultPageTab 单关非激活页：激活位不动 + 历史剪掉该页", vpClose.vaultPages.length === 1 && vpClose.activeVaultPage === undefined && vpClose.vaultOpen === undefined && !vpClose.vaultHist.stack.includes("D:/v/b.md"));
const vpCloseActive = comps.closeVaultPageTab(vp3, "D:/v/a.md");
check("closeVaultPageTab 关激活页：激活位顺延邻居", vpCloseActive.vaultPages.length === 1 && vpCloseActive.activeVaultPage === "D:/v/b.md");
const vpLast = comps.closeVaultPageTab({ vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", vaultOpen: true, vaultHist: { stack: ["D:/v/a.md"], idx: 0 }, stageTab: "vault" }, "D:/v/a.md");
check("closeVaultPageTab 关最后一个：整片知识库舞台收摊", vpLast.vaultPages.length === 0 && vpLast.vaultOpen === false && vpLast.activeVaultPage === null && vpLast.stageTab === null);
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
comps.setKitUi({ jobsOpen: true, stageTab: "jobs" });
callLog = [];
out = comps.StagePane({ props: jobsHooks, cwd: "C:/x" });
check("StagePane 带运行中任务渲染无异常", !!out && typeof out === "object");
const jobsTabBadge = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-term-badge" && c[2].children === "2");
check("StagePane 任务标签带运行中计数徽标(2)", !!jobsTabBadge);
const dockAddBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["打开标签", "Open a tab"].includes(c[2]["aria-label"]));
check("StagePane 标签栏渲染 + 号打开标签按钮", !!dockAddBtn);
const pinBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-stage-pin");
check("StagePane 标签栏渲染宽度图钉钮", !!pinBtn);
comps.setKitUi({ jobsOpen: false, stageTab: null });
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
comps.setKitUi({ browserOpen: false, stageTab: null });
comps.maybeAutoOpenBrowser();
check("maybeAutoOpenBrowser 切到浏览器标签（无抑制，agent 干活必回眼前）", comps.getKitUi().browserOpen === true && comps.getKitUi().stageTab === "browser");
comps.closeBrowserDockForGone();
check("closeBrowserDockForGone 收掉面板标签（0 页无面板壳）", comps.getKitUi().browserOpen === false && comps.getKitUi().stageTab === null);

// 7.2.1) 右侧标签页容器：浏览器标签激活态。注意桩环境嵌套组件体不执行
// （jsx(BrowserPanel) 只建元素），面板内部由上面直接调用 BrowserPanel 的用例覆盖；
// 这里验证 dock 页签条高亮与面板挂载元素
comps.setKitUi({ browserOpen: true, stageTab: "browser" });
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
const dockOnTab = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-tab dshk-tab-on");
const bpElem = callLog.find((c) => c[1] === comps.BrowserPanel && c[2] && c[2].active === true);
check("StagePane 浏览器标签渲染无异常", !!out && typeof out === "object");
check("StagePane 渲染出激活浏览器标签与面板挂载元素", !!dockOnTab && !!bpElem);
comps.setKitUi({ browserOpen: false, stageTab: null });
// 宽度模型（工作台定稿）：界限=视口−侧栏−对话保底 400；生效宽=图钉>共享默认>出厂
const dbB = comps.stageBounds("browser", 0);
const dbJ = comps.stageBounds("jobs", 0);
check("stageBounds 封顶保对话 400px（视口 1600 侧栏 0）", dbB.max === 1200 && dbJ.max === 1200);
check("stageBounds 浏览器下限不小于画布需求", dbB.min === 480);
const wFactory = comps.stageWidthFor("file", 0);
check("出厂默认：文件标签 560", wFactory === 560);
const wJobsFactory = comps.stageWidthFor("jobs", 0);
check("出厂默认：任务 400", wJobsFactory === 400);
const wBrowserFactory = comps.stageWidthFor("browser", 0);
check("出厂默认：浏览器=上限", wBrowserFactory === dbB.max);
const wAfterCommit = comps.stageWidthCommit("file", 700, 0);
const wDefaultFollow = comps.stageWidthFor("schedule", 0);
check("拖未钉标签=写共享默认（其它未钉类型联动）", wAfterCommit === 700 && wDefaultFollow === 700);
const pinsAfter = comps.stagePinToggle("file", 700);
check("图钉钉住当前宽度", comps.stageIsPinned("file") === true && pinsAfter.file === 700);
comps.stageWidthCommit("schedule", 900, 0);
const wPinnedFile = comps.stageWidthFor("file", 0);
check("已钉类型拖别的标签不受影响（只影响自己）", wPinnedFile === 700);
comps.stagePinToggle("file", 700);
check("取消图钉回默认跟随", comps.stageIsPinned("file") === false);
const wBackToFactory = comps.stageWidthFor("file", 0);
check("取消图钉后文件标签跟随共享默认（900）", wBackToFactory === 900);

// 7.2.2) 多文件：一文件一标签（2026-09-10 用户定稿：浏览器式顶部标签条——
// 文件树/源代码管理点开的页各自成签，点击切换、✕ 单关）；非激活文件仍挂载
comps.setKitUi({
  files: [
    { path: "C:/x/a.js", from: "tree", untracked: false, usedAt: 1 },
    { path: "C:/x/b.md", from: "scm", untracked: true, usedAt: 2 },
  ],
  activeFile: "C:/x/b.md",
  stageTab: "file",
});
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
const pvChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("C:/x/"));
const feElems = callLog.filter((c) => c[1] === comps.FileEditorPane);
const feWraps = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-pane-view" && c[2].style && typeof c[2].style.display === "string");
const fileChipLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label" && ["a.js", "b.md"].includes(c[2].children));
const subtabRows = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-subtabs");
const topFileChip = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && ["文件", "Files"].includes(c[2].title));
check("StagePane 多文件渲染无异常", !!out && typeof out === "object");
check("StagePane 顶层只有一张「文件」功能签（文档签在内容区子标签条）", topFileChip.length === 1);
check("StagePane 子标签条里有内容（文件那份在顶层文件区里）", subtabRows.length >= 1 && subtabRows.some((r) => Array.isArray(r[2].children) && r[2].children.length === 2));
check("StagePane 两个文件各占一个文档签（标签名=文件名，激活签高亮）", pvChips.length === 2 && fileChipLabels.length === 2 && pvChips.filter((c) => c[2].className.includes("dshk-tab-on")).length === 1);
check("StagePane 每个文档签各带 ✕ 单关", pvChips.filter((c) => Array.isArray(c[2].children) && c[2].children.some((ch) => ch && ch.props && ch.props.className === "dshk-tab-x")).length === 2);
check("StagePane 多实例挂载 FileEditorPane（激活 flex 非激活 none 保挂载）", feElems.length === 2 && feWraps.filter((c) => c[2].style.display === "flex").length === 1 && feWraps.some((c) => c[2].style.display === "none"));
comps.setKitUi({ files: [], activeFile: null, stageTab: null });

// 7.2.2a) 文件标签纯逻辑：点击只激活（刷新 usedAt）／✕ 单关顺延邻居／关光了整片收摊
const tabBase = {
  files: [
    { path: "C:/x/a.js", from: "tree", usedAt: 1 },
    { path: "C:/x/b.js", from: "tree", deleted: true, usedAt: 2 },
    { path: "C:/x/c.js", from: "tree", usedAt: 3 },
  ],
  activeFile: "C:/x/c.js",
  stageTab: "file",
};
const actA = comps.activateFileTab(tabBase, "C:/x/a.js");
check("activateFileTab 只激活：不动顺序、只刷新 usedAt 与激活位", actA.activeFile === "C:/x/a.js" && actA.stageTab === "file" && actA.files.length === 3 && actA.files[0].usedAt > 1 && actA.files[1].deleted === true);
check("activateFileTab 未开的文件不认", Object.keys(comps.activateFileTab(tabBase, "C:/x/zz.js")).length === 0);
const closeB = comps.closeFileTab(tabBase, "C:/x/b.js");
check("closeFileTab 单关非激活签：激活位不动", closeB.files.length === 2 && closeB.activeFile === undefined && !closeB.files.some((x) => x.path === "C:/x/b.js"));
const closeActive = comps.closeFileTab(tabBase, "C:/x/c.js");
check("closeFileTab 关激活签：激活位顺延邻居", closeActive.files.length === 2 && closeActive.activeFile === "C:/x/b.js");
const closeLast = comps.closeFileTab({ files: [{ path: "C:/x/a.js", from: "tree", usedAt: 1 }], activeFile: "C:/x/a.js", jobsOpen: true, stageTab: "file" }, "C:/x/a.js");
check("closeFileTab 关最后一个：整片文件舞台收摊且激活位顺延到余下标签", closeLast.files.length === 0 && closeLast.activeFile === null && closeLast.stageTab === "jobs");

// 7.2.2b) 单文件：同样有标签级 ✕
comps.setKitUi({
  files: [{ path: "C:/x/only.js", from: "tree", untracked: false, usedAt: 1 }],
  activeFile: "C:/x/only.js",
  stageTab: "file",
});
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
const singleChip = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && c[2].title === "C:/x/only.js");
const singleX = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-x");
check("StagePane 单文件渲染文件标签与 ✕", singleChip.length === 1 && !!singleX);
comps.setKitUi({ files: [], activeFile: null, browserOpen: true, stageTab: "browser" });
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
check("无文件时不渲染文件标签", !callLog.some((c) => (c[0] === "jsxs") && c[2] && typeof c[2].title === "string" && c[2].title.startsWith("C:/x/")));
comps.setKitUi({ browserOpen: false, stageTab: null });

// 7.2.4) 舞台不可收起（2026-09-10 用户定稿：取消隐藏态与快捷键）——有标签即渲染，
// 没有「开着但看不见」的第三态
comps.setKitUi({ browserOpen: true, stageTab: "browser" });
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 有标签即挂 StagePane（无隐藏态）", callLog.some((c) => c[1] === comps.StagePane));
comps.setKitUi({ browserOpen: false, stageTab: null });

// 7.2.4b) 0 标签：舞台不存在（对话回 DSH 原生全宽居中）
comps.setKitUi({ files: [], activeFile: null, jobsOpen: false, browserOpen: false, schedOpen: false, vaultOpen: false, stageTab: null });
callLog = [];
out = comps.KitSurfaces({});
check("KitSurfaces 0 标签不挂 StagePane", !callLog.some((c) => c[1] === comps.StagePane));
comps.setKitUi({ schedOpen: true, stageTab: "schedule" });
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
const schedOn = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-tab dshk-tab-on");
const schedElem = callLog.find((c) => c[1] === comps.ScheduleView);
check("StagePane 日程标签激活并挂 ScheduleView", !!schedOn && !!schedElem);
comps.setKitUi({ schedOpen: false, stageTab: null });
// 知识库：顶层一张「知识库」功能签（✕ 关整片），页签在它内容区的子标签条里
// （一页一签、✕ 单关、激活签标 dshk-tab-on）；一页都没开时顶层签照样在、子标签
// 条不出现（那会儿宿主里是「去索引挑一页」的空态）
comps.setKitUi({ vaultOpen: true, vaultPages: ["D:/v/a.md", "D:/v/b.md"], activeVaultPage: "D:/v/b.md", stageTab: "vault" });
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
const vaultHost = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-vault-stagehost");
const vaultChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("D:/v/"));
const vaultTopChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && ["知识库", "Knowledge base"].includes(c[2].title));
const vaultOnChip = vaultChips.filter((c) => c[2].className.includes("dshk-tab-on"));
const vaultPageLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label" && ["a", "b"].includes(c[2].children)).map((c) => c[2].children);
check("StagePane 顶层只有一张「知识库」功能签", vaultTopChips.length === 1);
check("StagePane 知识库多开：每页一个文档签且只激活当前页", vaultChips.length === 2 && vaultOnChip.length === 1 && vaultChips.find((c) => c[2].className.includes("dshk-tab-on"))[2].title === "D:/v/b.md");
check("StagePane 知识库页签用页名（去 .md）", vaultPageLabels.length === 2);
check("StagePane 知识库标签渲染 portal 宿主（VaultView 经 KitSurfaces 单实例挂载）", !!vaultHost);
const vaultX = vaultChips[0][2].children.find((ch) => ch && ch.props && ch.props.className === "dshk-tab-x");
check("StagePane 知识库文档签各带独立 ✕", !!vaultX);
comps.setKitUi({ vaultPages: [], activeVaultPage: null, stageTab: "vault" });
callLog = [];
out = comps.StagePane({ props: {}, cwd: "C:/x" });
const emptyVaultTop = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && ["知识库", "Knowledge base"].includes(c[2].title));
const vaultSubRow = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-subtabs");
const vaultSubRowWithPages = vaultSubRow.some((r) => Array.isArray(r[2].children) && r[2].children.some((ch) => ch && ch.props && typeof ch.props.title === "string" && ch.props.title.startsWith("D:/v/")));
check("StagePane 无页标签时顶层「知识库」签仍在且不出现页签条", emptyVaultTop.length === 1 && !vaultSubRowWithPages);
comps.setKitUi({ vaultOpen: false, vaultPages: [], activeVaultPage: null, stageTab: null });

// 7.2.4c) 侧栏底部按钮区：后台任务/浏览器/计时三钮常驻（知识库/日程 2026-09-10
// 已挪到输入行、文件钮同日取消——文件的位子在中间舞台标签条）；宽态出文字，
// 收起态纯图标；后台任务钮带运行中计数角标
comps.setKitUi({ vaultIdxOpen: false, schedIdxOpen: false, files: [], jobsOpen: false, browserOpen: false });
callLog = [];
out = comps.SidebarFooterActions({ wide: true });
const fabBtns = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-fab");
const fabLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-fab-label");
check("SidebarFooterActions 宽态渲染后台任务/浏览器/计时三钮（知识库/日程已移输入行）", fabBtns.length === 3);
check("SidebarFooterActions 宽态出文字标签", fabLabels.length >= 3);
check("SidebarFooterActions 后台任务钮用改名后的标签（与面板标题一致，不再与日程待办撞名）", fabBtns.some((c) => ["后台任务", "Background tasks"].includes(c[2]["aria-label"])));
check("SidebarFooterActions 不再有知识库/日程钮", !fabBtns.some((c) => ["知识库", "日程", "Knowledge base", "Schedule"].includes(c[2]["aria-label"])));
callLog = [];
out = comps.SidebarFooterActions({ wide: false });
const fabNoLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-fab-label");
check("SidebarFooterActions 收起态纯图标（无文字）", fabNoLabels.length === 0);
comps.setKitUi({ files: [{ path: "C:/x/a.js", from: "tree", untracked: false, usedAt: 1 }], activeFile: "C:/x/a.js" });
callLog = [];
out = comps.SidebarFooterActions({ wide: true });
const fabFile = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-fab" && ["文件", "Files"].includes(c[2]["aria-label"]));
check("SidebarFooterActions 有文件标签也不出文件钮（文件的位子在中间舞台）", !fabFile);
comps.setKitUi({ files: [], activeFile: null });

// 7.2.4d) 侧栏待办索引：勾选/标题点击开舞台日程标签
comps.setKitUi({ schedIdxOpen: true });
callLog = [];
out = comps.ScheduleIndexView({ wide: true });
const schedIdxRoot = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-sidehost");
check("ScheduleIndexView 宽态渲染侧栏待办宿主", !!out && typeof out === "object" && !!schedIdxRoot);
callLog = [];
out = comps.ScheduleIndexView({ wide: false });
check("ScheduleIndexView 收起态不渲染", out === null);
comps.setKitUi({ schedIdxOpen: false });

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
check("vaultCiteText：无选区追加路径", comps.vaultCiteText("", "", "D:\\v\\a.md") === "D:\\v\\a.md\n");
check("vaultCiteText：续草稿补换行", comps.vaultCiteText("在吗", "", "D:\\v\\a.md") === "在吗\nD:\\v\\a.md\n");
check(
  "vaultCiteText：选区转引用块 + 首尾空行剥除",
  comps.vaultCiteText("在吗", "\n第一行\n第二行\n\n", "D:\\v\\a.md") === "在吗\n> 第一行\n> 第二行\n\nD:\\v\\a.md\n",
);

// 6.9) 单态 VaultRootView 直渲（无 hooks 执行的完整渲染体）：槽位渲染器会静默
// 吞掉渲染期异常（readerRef 残留引用教训），必须在这里显式跑过才肯放行
{
  let vaultOut = null;
  let vaultErr = null;
  // 拆两半后 VaultRootView 单实例挂 KitSurfaces、内容经 portal 投两侧宿主；
  // 宿主全空（知识库侧栏/舞台都没开）时返回 null 是合法语义。这里登记舞台
  // 宿主再渲（未配置 vault 的整页提示走 portal 投出），防渲染体异常逃逸
  comps.vaultStageSlot.set({ tagName: "DIV" });
  comps.setKitUi({ vaultOpen: true, stageTab: "vault" });
  try {
    vaultOut = comps.VaultRootView({ root: "D:/v" });
  } catch (e) {
    vaultErr = e;
  }
  check("VaultRootView 单态渲染无异常（portal 投出整页提示）", vaultErr === null && !!vaultOut && typeof vaultOut === "object");
  if (vaultErr) console.log("  VaultRootView error:", vaultErr.message);
  comps.vaultStageSlot.set(null);
  comps.setKitUi({ vaultOpen: false, stageTab: null });
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

// 7.2.3) 文件标签 LRU 纯逻辑：默认上限 8，超限开新文件逐出 usedAt 最小者（=关掉
// 最久没看的那张标签）；重开已存在文件置顶激活不逐出自身
const lruBase = [];
for (let i = 1; i <= 8; i++) lruBase.push({ path: `C:/x/f${i}.js`, from: "tree", untracked: false, usedAt: i });
const opened = comps.openFileTab({ files: lruBase, activeFile: "C:/x/f8.js" }, "C:/x/f9.js", "tree", false);
check("openFileTab 超限 LRU 逐出最久未用", opened.files.length === 8 && !opened.files.some((p) => p.path === "C:/x/f1.js") && opened.files.some((p) => p.path === "C:/x/f9.js") && opened.activeFile === "C:/x/f9.js" && opened.stageTab === "file");
const reopened = comps.openFileTab({ files: opened.files, activeFile: "C:/x/f9.js" }, "C:/x/f2.js", "scm", false);
const reopenedItem = reopened.files.find((p) => p.path === "C:/x/f2.js");
check("openFileTab 重开已存在文件置顶激活不逐出自身", reopened.files.length === 8 && reopened.activeFile === "C:/x/f2.js" && !!reopenedItem && reopenedItem.untracked === false && reopenedItem.from === "scm");
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
callLog = [];
out = comps.GitActionsMenu({ rect: { left: 20, top: 40 }, items: [{ key: "push", label: "推送", disabled: false, run: () => {} }], onClose: () => {} });
check("GitActionsMenu 渲染无异常", !!out && typeof out === "object");

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

// React 桩记录到的组件类型必须包含本插件自定义组件名（防 ReferenceError 被忽略后整段缺失）
const types = new Set(callLog.flatMap(([, t]) => (typeof t === "string" ? [t] : [])));
// 至少渲染出来 JSX 元素（说明走到 render 而非静默 null）
check("渲染体实际产出元素", callLog.length > 0);

console.log(failed === 0 ? "ALL RENDER OK" : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
