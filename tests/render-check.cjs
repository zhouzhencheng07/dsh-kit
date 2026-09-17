// 渲染级验证：桩掉 react hooks，直接函数调用 dsh-kit 的组件
// （TreeNode/FileTreePanel/DiffPane/TerminalEntry/FileTreeEntry/KitSurfaces/
// KitConfigCard/GitChangesPanel/SkillsManager/TerminalDock/TerminalPane），跑完整渲染体。
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
    createElement: () => ({ className: "", textContent: "", setAttribute: () => {}, removeAttribute: () => {}, remove: () => {} }),
    body: { classList: { add() {}, remove() {} }, appendChild: () => {} },
  };
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
  "return { vaultSideSlot, vaultPaneSlot, TreeNode, FileTreePanel, DiffPane, TerminalEntry, FileTreeEntry, ScmEntry, VaultEntry, JobsPanel, PhoneSection, KitSurfaces, KitConfigCard, GitChangesPanel, GitGraphPanel, GitBranchMenu, SkillsManager, TerminalDock, TerminalPane, TreeRowMenu, CommitGraphSvg, computeCommitGraph, BrowserPanel, RteEditor, VaultPagePane, VaultFolderPicker, openFileTab, activateFileTab, closeFileTab, openFeatureTab, closeFeatureTab, openVaultPageTab, closeVaultPageTab, activateVaultPage, renameVaultPageTab, toggleVaultEntry, openVaultEntry, sidebarViewPatch, maybeAutoOpenBrowser, closeBrowserDockForGone, cfgFormat, CFG_DEFAULTS, kitGetJson, kitPostJson, kitJson, fetchTree, fetchGitStatus, fetchGitLog, fetchGitInit, postFsOp, fetchSkillsPage, getKitUi, setKitUi, makeTerm, ScheduleView, ScheduleModal, FloatingTimerPill, timerElapsedStr, timerMinsOfDT, schedAssignLanes, VaultView, VaultRootView, vaultSplitFrontmatter, resolveVaultLink, vaultBacklinks, vaultCascadeDelete, vaultCascadeDeleteMany, vaultHeadingSlug, MonitorLine, monitorTailRepeatCount, monitorTickCore, monitorCancelPlan, monitorSessions, monitorStore, notifyDiffCore, notifyCompactionCore, notifyCompleteSettled, notifyState, readPosStore, recordReadPos, jobsOutputMerge, jobsAtBottom, FilePaneBody, VaultPaneBody, SchedulePaneBody, JobsPaneBody, BrowserPaneBody, HeaderTimer, ScheduleTasksCard, openFeatureDock, openFileAndDock, openVaultPageAndDock, closeRightbarTab, isPathInsideVaultRoot, vaultCiteText, resolveMdLink, isDocHref };",
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
const names = ["TreeNode", "FileTreePanel", "DiffPane", "TerminalEntry", "FileTreeEntry", "ScmEntry", "VaultEntry", "JobsPanel", "PhoneSection", "KitSurfaces", "KitConfigCard", "GitChangesPanel", "GitGraphPanel", "GitBranchMenu", "SkillsManager", "TerminalDock", "TerminalPane", "CommitGraphSvg", "BrowserPanel", "RteEditor", "VaultPagePane", "VaultFolderPicker", "openFeatureTab", "activateFileTab", "closeFileTab", "openVaultPageTab", "closeVaultPageTab", "activateVaultPage", "renameVaultPageTab", "sidebarViewPatch", "toggleVaultEntry", "ScheduleView", "ScheduleModal", "FloatingTimerPill", "timerElapsedStr", "timerMinsOfDT", "schedAssignLanes", "VaultView", "VaultRootView", "vaultSplitFrontmatter", "resolveVaultLink", "vaultBacklinks", "vaultCascadeDelete", "vaultCascadeDeleteMany", "vaultHeadingSlug", "MonitorLine", "monitorTailRepeatCount", "monitorTickCore", "monitorCancelPlan", "notifyDiffCore", "notifyCompactionCore", "recordReadPos", "jobsOutputMerge", "jobsAtBottom", "FilePaneBody", "VaultPaneBody", "SchedulePaneBody", "JobsPaneBody", "BrowserPaneBody", "HeaderTimer", "ScheduleTasksCard", "openFeatureDock", "openFileAndDock", "openVaultPageAndDock", "closeRightbarTab", "isPathInsideVaultRoot", "vaultCiteText", "resolveMdLink", "isDocHref"];
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

// 6) DiffPane（SCM 专用 diff 签）：加载中（fetch 被桩跳过 -> diff 保持 loading）。
//    状态索引 #0=read 态、#1=diff；桩环境 effect 不执行，预置 stateStore 验渲染体
callLog = [];
out = comps.DiffPane({ path: "C:/x/b.js", cwd: "C:/x" });
check("DiffPane 渲染无异常", !!out && typeof out === "object");

// 6.1) 已删除文件：删除说明 + 纯红删除行（无 git 元数据噪音、无 ⇄ 切换）
stateSeq = 0;
stateStore.set(0, { phase: "deleted" });
stateStore.set(1, {
  phase: "ready",
  clean: false,
  text: "diff --git a/f.md b/f.md\ndeleted file mode 100644\nindex 5d7d2f8..0000000\n--- a/f.md\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-name: hello-kit\n-\n-# hello\n",
});
callLog = [];
out = comps.DiffPane({ path: "C:/x/gone.md", cwd: "C:/x", deleted: true });
const deletedNote = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.includes("文件已删除") || c[2].children.includes("File deleted")));
const deletedToggle = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].children === "⇄");
const metaNoise = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("diff --git") || c[2].children.startsWith("deleted file mode") || c[2].children.startsWith("@@")));
const delRedLines = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-del").map((c) => c[2].children);
check("DiffPane deleted 渲染无异常", !!out && typeof out === "object");
check("deleted 渲染删除说明且无 ⇄ 切换", !!deletedNote && !deletedToggle);
check("删除内容无 git 元数据且为剥前缀红行", !metaNoise && delRedLines.length === 3 && delRedLines[0] === "name: hello-kit" && delRedLines.includes("# hello"));
stateStore.clear();
stateSeq = 0;

// 6.2) 提交钉定：顶部基线说明（父短哈希/根提交空树）；全文件着色的新像 = diff
//      响应带回的提交时刻内容；blobMissing 走纯红；无新像回落原始 patch
const commitDiffText = "diff --git a/f.js b/f.js\nindex 111..222 100644\n--- a/f.js\n+++ b/f.js\n@@ -1 +1 @@\n-old\n+new\n";
const readyBody = { phase: "ready", body: { path: "C:/x/f.js", size: 2, mtimeMs: 1, truncated: false, binary: false, content: "new\n" } };
stateStore.set(0, readyBody);
stateStore.set(1, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText, content: "new\n" });
callLog = [];
out = comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "full40hash" });
const baseNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diffnote" && typeof c[2].children === "string" && c[2].children.includes("abcd123"));
const overlayRows = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-inline");
const rawOnly = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diff");
check("提交钉定 diff 渲染基线说明（父提交 abcd123）", !!baseNote);
check("提交钉定 diff 复用全文件着色（新像=提交时刻内容）", !!overlayRows && !rawOnly);
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(1, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText, blobMissing: true });
callLog = [];
out = comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "full40hash" });
const delRed = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-del").map((c) => c[2].children);
const delMeta = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("diff --git") || c[2].children.startsWith("@@")));
check("提交钉定删除文件走纯红块（无元数据噪音）", delRed.includes("old") && !delRed.includes("new") && !delMeta);
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(1, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText });
callLog = [];
out = comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "full40hash" });
const rawFallback = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diff");
check("钉定无新像回落原始 patch", !!rawFallback);
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(1, { phase: "ready", clean: false, base: "", text: commitDiffText });
callLog = [];
out = comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "root40hash" });
const rootNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diffnote" && typeof c[2].children === "string" && (c[2].children.includes("empty tree") || c[2].children.includes("空树")));
check("根提交钉定显示空树基线说明", !!rootNote);
// 常规 diff：hunk 套回盘上内容（全文件着色）
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(1, { phase: "ready", clean: false, text: commitDiffText });
callLog = [];
out = comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x" });
const normalOverlay = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-inline");
check("常规 diff 视图仍套盘上内容（无 commit 钉定）", !!normalOverlay);
// 未跟踪：整文件按新增着色（内容来自 read）
stateStore.clear();
stateSeq = 0;
stateStore.set(0, { phase: "ready", body: { path: "C:/x/n.js", size: 3, mtimeMs: 1, truncated: false, binary: false, content: "a\nb" } });
stateStore.set(1, { phase: "ready", untracked: true, clean: false, text: null });
callLog = [];
out = comps.DiffPane({ path: "C:/x/n.js", cwd: "C:/x", untracked: true });
const addRows = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-add").map((c) => c[2].children);
check("未跟踪整文件按新增着色", addRows.join("|") === "a|b");
stateStore.clear();
stateSeq = 0;
// 头部标题：绝对路径直显、不挂 title 悬停（文件名由页签 chip 承担）
callLog = [];
out = comps.DiffPane({ path: "C:/x/dir/f.js", cwd: "C:/x" });
const titleAbs = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-title" && c[2].children === "C:/x/dir/f.js");
check("diff 头部标题显示绝对路径", !!titleAbs);
check("diff 头部不挂 title 悬停（全路径已直显，悬停只留页签 chip）", !!(titleAbs && titleAbs[2] && titleAbs[2].title === undefined));

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
// 7.0) 侧栏索引单槽互斥（工具行三钮的选中态 = 侧栏正在显示谁）：点源代码管理必须
// 让出知识库目录那一格，否则两个钮同时亮而侧栏只按优先级显示一个
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
// 7.1b) 知识库入口（输入行钮 + 快捷键同语义）：只切左侧目录，点具体页才开右栏知识库
// 签；再点 = 收回会话列表。补丁只含侧栏三键，功能签与页签状态一律不动（setKitUi
// 合并语义）
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
      byId: { s1: { id: "s1", cwd: "C:/x", retainedBy: { mainView: 1 } } },
      jobsBySession: {
        s1: [
          { id: "pwsh-1", kind: "pwsh", label: "npm run dev", status: "running", startedAt: Date.now() - 30000 },
          { id: "pwsh-2", kind: "pwsh", label: "frpc 隧道", status: "stopping", startedAt: Date.now() - 120000 },
        ],
      },
    }),
};
callLog = [];
out = comps.JobsPanel(jobsHooks);
check("JobsPanel 带运行中任务渲染无异常", !!out && typeof out === "object");
// 输出常显：每个任务行自带输出块，不再有「输出」按钮
const jobRows = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-jobs-row");
const jobOutBlocks = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-jobs-output");
check("JobsPanel 输出块每任务常显（2 行 2 输出块）", jobRows.length === 2 && jobOutBlocks.length === 2);
check("JobsPanel 不再渲染「输出」按钮", !callLog.some((c) => (c[0] === "jsx") && c[2] && (c[2].children === "Output" || c[2].children === "输出")));
// 终态保留在列：终态行仍在（data-done 淡化），动作变「关闭」，
// 运行中行保持「结束」；输出块每行都在
const doneHooks = {
  useSessions: (sel) =>
    sel({
      byId: { s1: { id: "s1", cwd: "C:/x", retainedBy: { mainView: 1 } } },
      jobsBySession: {
        s1: [
          { id: "pwsh-9", kind: "pwsh", label: "npm run build", status: "running", startedAt: Date.now() - 5000 },
          { id: "pwsh-8", kind: "pwsh", label: "npm test", status: "completed", startedAt: Date.now() - 60000, finishedAt: Date.now() - 30000 },
        ],
      },
    }),
};
callLog = [];
out = comps.JobsPanel(doneHooks);
const doneRows = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-jobs-row" && c[2]["data-done"] === true).length;
const closeBtn = callLog.some((c) => (c[0] === "jsx") && c[2] && (c[2].children === "Close" || c[2].children === "关闭"));
const killBtns = callLog.filter((c) => (c[0] === "jsx") && c[2] && (c[2].children === "Stop" || c[2].children === "结束")).length;
const doneOutBlocks = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-jobs-output").length;
check("JobsPanel 终态行保留在列且标 data-done（1 行）", doneRows === 1);
check("JobsPanel 终态动作是关闭、运行中仍是结束", closeBtn && killBtns === 1);
// 「关闭」回调要能真的跑（清本页正文/偏移/吸底状态 + 记进已关闭集合），不该在渲染桩下炸
{
  const closeNode = callLog.find((c) => c[0] === "jsx" && c[2] && (c[2].children === "Close" || c[2].children === "关闭"));
  let threw = null;
  try { closeNode[2].onClick(); } catch (error) { threw = String(error); }
  check("JobsPanel 关闭回调可执行（清本页残留不抛）", threw === null);
}
check("JobsPanel 终态行输出块仍在（2 行 2 输出块）", doneOutBlocks === 2);
// 输出合并规则（页面自持偏移：正文增量追加、截断标记一旦出现就留存、读失败不清空已见进度）
let outMerge = comps.jobsOutputMerge(undefined, { text: "a", next: 4, truncated: false }, null);
check("jobsOutputMerge 首帧：正文入库、无错", outMerge.text === "a" && outMerge.error === null && outMerge.truncated === false);
outMerge = comps.jobsOutputMerge(outMerge, { text: "b", next: 5, truncated: false }, null);
check("jobsOutputMerge 增量追加", outMerge.text === "ab");
outMerge = comps.jobsOutputMerge(outMerge, { text: "c", next: 9, truncated: true }, null);
check("jobsOutputMerge 截断标记入库", outMerge.text === "abc" && outMerge.truncated === true);
outMerge = comps.jobsOutputMerge(outMerge, { text: "d", next: 10, truncated: false }, null);
check("jobsOutputMerge 后续响应不抹掉截断标记", outMerge.truncated === true && outMerge.text === "abcd");
outMerge = comps.jobsOutputMerge(outMerge, null, "HTTP");
check("jobsOutputMerge 读失败保留已见正文与截断标记", outMerge.text === "abcd" && outMerge.error === "HTTP" && outMerge.truncated === true);
outMerge = comps.jobsOutputMerge(undefined, { text: "", next: 7, truncated: false, released: true }, null);
check("jobsOutputMerge 记下宿主已释放（面板据此显示「输出已释放」）", outMerge.released === true && outMerge.text === "");
// 吸底判据：贴底（含 24px 容差）为真 → 后续渲染把新内容顶到最底；用户上翻后为假 → 不打扰
check("jobsAtBottom 贴底为真", comps.jobsAtBottom({ scrollHeight: 1000, scrollTop: 820, clientHeight: 180 }) === true);
check("jobsAtBottom 容差内仍算贴底", comps.jobsAtBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 180 }) === true);
check("jobsAtBottom 上翻后为假", comps.jobsAtBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 180 }) === false);
// 输出框接线：吸底要能拿到 DOM 节点（ref）并读到用户的滚动（onScroll）
const outWired = callLog.find((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-jobs-output");
check("JobsPanel 输出框挂吸底接线（ref + onScroll）", !!(outWired && typeof outWired[2].ref === "function" && typeof outWired[2].onScroll === "function"));
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
out = comps.FilePaneBody({});
const fpChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("C:/x/"));
const fpEditors = callLog.filter((c) => c[1] === comps.DiffPane);
const fpWraps = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-pane-view" && c[2].style && typeof c[2].style.display === "string");
const fpLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label" && ["a.js", "b.md"].includes(c[2].children));
check("FilePaneBody 渲染无异常（文档签条 + 两个 DiffPane 实例）", !!out && fpChips.length === 2 && fpEditors.length === 2 && fpLabels.length === 2);
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
    { path: "D:/v/index.md", rel: "index", title: "索引", links: ["入门"] },
    { path: "D:/v/入门.md", rel: "入门", title: "入门", links: ["速记"] },
    { path: "D:/v/速记.md", rel: "速记", title: "速记", links: [] },
  ];
  const doomed = comps.vaultCascadeDelete(pages, "D:/v/index.md");
  // 删索引 → 入门失去唯一反链连坐 → 速记又失去入门连坐
  check("孤儿级联：递归闭包", doomed.length === 3 && doomed.some((p) => p.rel === "入门") && doomed.some((p) => p.rel === "速记"));
  const doomed2 = comps.vaultCascadeDelete(pages, "D:/v/速记.md");
  check("孤儿级联：删叶子不连坐他人", doomed2.length === 1 && doomed2[0].rel === "速记");
  // 目录删除走多种子版：种子 = 目录下全部页，外部页里因此变孤儿的一样连坐
  const seeds = ["D:/v/index.md", "D:/v/入门.md"];
  const many = comps.vaultCascadeDeleteMany(pages, seeds);
  check(
    "孤儿级联（多种子）：目录整棵 + 外部孤儿连坐、不动无关页",
    many.length === 3 && ["index", "入门", "速记"].every((r) => many.some((p) => p.rel === r)),
  );
  check("孤儿级联（多种子）：空种子返回空", comps.vaultCascadeDeleteMany(pages, []).length === 0);
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
// 6.9c) VaultRootView 索引就绪态的工具条：搜索框独占第二行（挤成一行时搜索框只剩半
// 截宽）+ ↻ 刷新必须连带重拉目录树——树是懒加载缓存，
// 只刷索引 ⇒ 外部增删的文件在侧栏看不见，「刷新功能不可用」就是这个
let vaultRefreshFetched = [];
let vaultFetchPrev = null;
{
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { root: "D:/v", folders: ["wiki", "wiki/Python"], pages: [{ path: "D:/v/wiki/a.md", rel: "wiki/a", space: "wiki", title: "A", links: [] }] }); // index
  stateStore.set(1, ""); // indexErr
  stateStore.set(2, ""); // space = 全部库
  stateStore.set(3, { "D:/v": [{ name: "wiki", path: "D:/v/wiki", dir: true }], "D:/v/wiki": [{ name: "a.md", path: "D:/v/wiki/a.md", dir: false }] }); // treeDirs
  stateStore.set(4, { "D:/v": true, "D:/v/wiki": true }); // expanded
  // 行 ⋯ 菜单（state#8，见 VaultRootView 的 useState 次序）：预置成「某页的行菜单已打开」，
  // 校验树上那套 actions 接线（重命名 + 删除）
  stateStore.set(8, { entry: { dir: false, name: "a", path: "D:/v/wiki/a.md" }, rect: { left: 10, top: 100, bottom: 120, right: 30, width: 20, height: 20 } });
  const fetched = vaultRefreshFetched;
  const prevFetch = global.fetch;
  vaultFetchPrev = prevFetch;
  global.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => ({ root: "D:/v", folders: ["wiki"], pages: [], entries: [] }) };
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
  check("上行保留导航/文件夹选择器/刷新，刷新钮提示走自己的 i18n 键", barRow1.length === 4 && !!refreshBtn);
  // 文件夹选择器换成自绘搜索式（可选任意层级）：那一格现在是组件，不再是原生 select
  const pickerEl = barRow1[2];
  check("上行第三格是搜索式文件夹选择器", barRow1.length === 4 && !!(pickerEl && pickerEl.props && Array.isArray(pickerEl.props.folders)));
  // 树上行操作：页行与目录行同形状 = `@` + `⋯`（目录行的 + 收进菜单，
  // 行上不挂常驻钮——那枚 + 只留给左轨头部/根级；也顺带没了 hover 挤位）
  const actSpans = callLog.filter((c) => (c[0] === "jsx" || c[0] === "jsxs") && c[2] && c[2].className === "dshk-rowact");
  const actsOf = (sp) => (Array.isArray(sp[2].children) ? sp[2].children : [sp[2].children]);
  const twoBtnSpans = actSpans.filter((sp) => actsOf(sp).length === 2);
  check(
    "知识库树页行与目录行 hover 都是 @ + ⋯（两行同形状）",
    twoBtnSpans.length === 2 &&
      twoBtnSpans.every((sp) => {
        const b = actsOf(sp);
        return ["@ 到对话", "Insert @ mention"].includes(b[0].props.title) && b[1].props.children === "⋯";
      }),
  );
  check(
    "树行不再挂常驻 +（只剩左轨头部一枚，且没被 hover 挤位）",
    actSpans.every((sp) => actsOf(sp).every((b) => b.props.className !== "dshk-vault-treeplus")) &&
      (src.match(/className: "dshk-vault-treeplus"/g) ?? []).length === 1 &&
      !src.includes(".dshk-vault-treerow:hover .dshk-vault-treeplus"),
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
    "vault 工具条/选择器/新建钮复用官方图标（OfficialIcon/FilePlusIcon/ChevronIcon）",
    (src.match(/jsxRuntime\.jsx\(OfficialIcon, \{/g) ?? []).length >= 4 &&
      src.includes('names: ["IconRefreshOutline16", "IconRefreshOutline14"]') &&
      src.includes('jsxRuntime.jsx(ChevronIcon, { open: expanded[e.path] === true })'),
  );
  // 行 ⋯ 的 actions：新建（目录行才出项）+ 重命名 + 删除（菜单项由 TreeRowMenu 按 actions 出）
  const rowMenuEl = callLog.find((c) => c[1] === comps.TreeRowMenu);
  const rowMenuActs = rowMenuEl ? rowMenuEl[2].actions : null;
  check(
    "知识库行 ⋯ 接线：新建 + 重命名 + 删除都挂上（删除不再只在页条）",
    !!rowMenuActs && typeof rowMenuActs.onCreate === "function" && typeof rowMenuActs.onRename === "function" && typeof rowMenuActs.onDelete === "function",
  );
  // 删除分流：目录行走目录版（整棵子树，确认文案带「目录」），页面行仍走单页级联
  const confirmLog = [];
  const prevConfirm = global.window.confirm;
  global.window.confirm = (msg) => {
    confirmLog.push(String(msg));
    return false;
  };
  rowMenuActs.onDelete({ dir: true, name: "wiki", path: "D:/v/wiki" });
  rowMenuActs.onDelete({ dir: false, name: "a", path: "D:/v/wiki/a.md" });
  global.window.confirm = prevConfirm;
  check(
    "行 ⋯ 删除分流：目录 = 整棵子树确认、页面 = 单页级联确认",
    confirmLog.length === 2 && /folder|目录/i.test(confirmLog[0]) && !/folder|目录/i.test(confirmLog[1]),
  );
  // ⋯ 触发钮是开关：再点一次关掉自己。落在触发钮上的那次点击由按钮自己判（菜单的
  // 点外关闭会忽略它，否则先被关掉、再被 onClick 判成重新打开＝点了没反应）。
  // 第一枚 = 目录行（先渲目录、后渲页），第二枚 = 页行：两枚都要认对各自的条目
  const anchorEl = { getBoundingClientRect: () => ({ left: 10, top: 100, bottom: 120, right: 30, width: 20, height: 20 }) };
  const clickEv = { stopPropagation: () => {}, currentTarget: anchorEl };
  const dirMenuBtn = actsOf(twoBtnSpans[0])[1];
  const pageMenuBtn = actsOf(twoBtnSpans[1])[1];
  dirMenuBtn.props.onClick(clickEv);
  const dirOpened = stateStore.get(8);
  dirMenuBtn.props.onClick(clickEv);
  pageMenuBtn.props.onClick(clickEv);
  const menuOpened = stateStore.get(8);
  pageMenuBtn.props.onClick(clickEv);
  check(
    "行 ⋯ 再点一次关掉 + 目录行认自己的条目（锚点认的是同一颗按钮）",
    !!dirOpened &&
      dirOpened.entry.dir === true &&
      dirOpened.entry.path === "D:/v/wiki" &&
      !!menuOpened &&
      menuOpened.anchor === anchorEl &&
      menuOpened.entry.path === "D:/v/wiki/a.md" &&
      stateStore.get(8) === null,
  );
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
// 6.9a2) VaultFolderPicker 直渲（搜索式文件夹选择器）：关着只有按钮；预置 state#0 =
// true 走弹层（搜索框 + 全部 + 各层级文件夹）
{
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  let fpickErr = null;
  try {
    comps.VaultFolderPicker({ value: "", folders: ["wiki", "wiki/Python"], allLabel: "全部", searchLabel: "搜索文件夹…", emptyLabel: "无匹配", onPick: () => {} });
  } catch (e) { fpickErr = e; }
  const fpickBtn = callLog.find((c) => c[2] && c[2].className === "dshk-vault-fpickbtn");
  check("文件夹选择器渲染无异常（按钮态）", fpickErr === null && !!fpickBtn);
  if (fpickErr) console.log("  VaultFolderPicker error:", fpickErr.message);
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, true); // open
  stateStore.set(2, 1); // idx 高亮第二个
  stateStore.set(3, { left: 10, bottom: 40, width: 200 }); // rect
  callLog = [];
  fpickErr = null;
  try {
    comps.VaultFolderPicker({ value: "wiki", folders: ["wiki", "wiki/Python"], allLabel: "全部", searchLabel: "搜索文件夹…", emptyLabel: "无匹配", onPick: () => {} });
  } catch (e) { fpickErr = e; }
  const fpickPop = callLog.find((c) => c[2] && c[2].className === "dshk-vault-fpick");
  const fpickRows = callLog.filter((c) => c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-vault-fpickrow"));
  check("文件夹选择器弹层：全部 + 两级文件夹共三行", fpickErr === null && !!fpickPop && fpickRows.length === 3);
  stateSeq = 0;
  stateStore.clear();
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
// 6.9a3) 页文件改名后页签路径搬家（否则 pane 还指着旧路径）
{
  const patched = comps.renameVaultPageTab({ vaultPages: ["D:/v/a.md", "D:/v/b.md"], activeVaultPage: "D:/v/a.md", vaultHist: { stack: ["D:/v/a.md"], idx: 0 } }, "D:/v/a.md", "D:/v/c.md");
  check("页签路径搬家：标签表/激活位/访问序同步", patched.vaultPages[0] === "D:/v/c.md" && patched.activeVaultPage === "D:/v/c.md" && patched.vaultHist.stack[0] === "D:/v/c.md");
  const none = comps.renameVaultPageTab({ vaultPages: [], activeVaultPage: null }, "D:/v/x.md", "D:/v/y.md");
  check("不在标签表里的页改名返回空补丁", Object.keys(none).length === 0);
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
    comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: true, root: "D:/v", indexPages: [], onOpenPage: () => {}, onMissingLink: () => {}, onSaved: () => {}, toast: () => {} });
  } catch (e) {
    paneErr = e;
  }
  const editbar = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-editbar");
  // @ 挂在左侧树的文件行上，页条里不该再有它（「页条不得有 @」的回归哨兵）
  const citeBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["引用到对话", "Cite to chat"].includes(c[2].title));
  // 删除同理在树上行的 ⋯ 菜单：页条里不得再有「删除」按钮/文案
  const delBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["删除", "Delete"].includes(c[2].children));
  const rte = callLog.find((c) => c[1] === comps.RteEditor);
  check("VaultPagePane 渲染无异常（页条 + RTE 就位，页条不再带 @）", paneErr === null && !!editbar && !citeBtn && !!rte);
  check("页条不再带删除按钮（删除在左侧树的行 ⋯ 菜单）", !delBtn);
  if (paneErr) console.log("  VaultPagePane error:", paneErr.message);
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { loading: false, body: "x", binary: false, gone: false });
  stateStore.set(2, { diskMtime: 123 });
  callLog = [];
  comps.VaultPagePane({ path: "D:/v/wiki/a.md", active: false, root: "D:/v", indexPages: [], onOpenPage: () => {}, onMissingLink: () => {}, onSaved: () => {}, toast: () => {} });
  const conflictBar = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-conflict");
  const paneRoot = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-vault-reader" && c[2].style);
  check("VaultPagePane 冲突态渲染冲突条（覆盖/读取）", !!conflictBar);
  check("VaultPagePane 非激活标签保挂载但 display:none", !!paneRoot && paneRoot[2].style.display === "none");
  stateSeq = 0;
  stateStore.clear();
}
// 6.9b2) 反链小节：来源页 chip 横排（一行一个太占高度）——
// 渲染出容器 + 每个来源页一个可点 chip，chip 带全名 tooltip（超长省略后仍看得到全称）
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
      { path: "D:/v/wiki/a.md", rel: "wiki/a", space: "wiki", title: "A", links: [] },
      { path: "D:/v/wiki/b.md", rel: "wiki/b", space: "wiki", title: "B", links: ["a"] },
    ],
    onOpenPage: () => {},
    onMissingLink: () => {},
    onSaved: () => {},
    toast: () => {},
  });
  const blBox = callLog.find((c) => c[2] && c[2].className === "dshk-vault-backlinks");
  const chips = callLog.filter((c) => c[2] && c[2].className === "dshk-vault-blrow");
  const chipProps = chips.length > 0 ? chips[0][2] : null;
  check(
    "反链小节：标题 + 来源页 chip（带全名 tooltip、点击可跳）",
    !!blBox && !!chipProps && chipProps.children === "B" && chipProps.title === "B" && typeof chipProps.onClick === "function",
  );
  check("反链小节 chip 横排换行（CSS 不再是 column）", /\.dshk-vault-backlinks\{[^}]*flex-wrap:wrap/.test(src) && !/\.dshk-vault-backlinks\{[^}]*flex-direction:column/.test(src));
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

// 10a) MonitorLine 渲染全局续跑器状态：watcherStore 有本会话 waiting 条目 →
//      输出监视条（限流文案 + 取消按钮）；capped 条目 → capped 文案
{
  comps.monitorStore.snapshot = {
    items: [{ id: "s1", title: "t", phase: "waiting", fireAt: Date.now() + 30000, continues: 0, max: 10 }],
  };
  callLog = [];
  out = comps.MonitorLine({
    useChat: (sel) => sel(fakeSnap),
    useSession: (sel) => sel({ running: false }),
    useInput: (sel) => sel({ draft: "" }),
    inputActions: { setDraft() {}, submit() {} },
    sessionId: "s1",
  });
  const rendered = JSON.stringify(out);
  // harness 无 documentElement → resolveZh() false → 英文文案
  check("MonitorLine 渲染全局续跑等待条", typeof out === "object" && rendered.includes("auto-continue in") && rendered.includes("rate limit (429)") && rendered.includes("Cancel"));
  comps.monitorStore.snapshot = {
    items: [{ id: "s1", title: "t", phase: "capped", fireAt: 0, continues: 10, max: 10 }],
  };
  out = comps.MonitorLine({
    useChat: (sel) => sel(fakeSnap),
    useSession: (sel) => sel({ running: false }),
    useInput: (sel) => sel({ draft: "" }),
    inputActions: { setDraft() {}, submit() {} },
    sessionId: "s1",
  });
  check("MonitorLine 渲染 capped 条", typeof out === "object" && JSON.stringify(out).includes("pausing auto-continue"));
  comps.monitorStore.snapshot = { items: [] };
}

// 10b) monitorTailRepeatCount：死循环判定的纯函数（尾部自重叠扫描）
const rep = (unit, n) => unit.repeat(n);
check("尾部重复块 ≥3 次被检出", comps.monitorTailRepeatCount(rep("我不能继续回答这个问题。", 5)) >= 3);
check("尾部重复短块按对齐穷举检出", comps.monitorTailRepeatCount("前文正常叙述。" + rep("ABCDEFGH", 4)) >= 4);
check("普通非重复文本不误报", comps.monitorTailRepeatCount("这是一段完全正常的回复内容，包含各种各样的字符与句子结构，不会触发循环判定。") < 3);
check("短于两倍最短块长的文本不误报", comps.monitorTailRepeatCount("abcabc") < 2);
check("短分隔符块（<8字符）不误报", comps.monitorTailRepeatCount("---\n---\n---\n---\n") < 3);
check("重复不在尾部不算（历史重复已翻篇）", comps.monitorTailRepeatCount(rep("重复片段测样", 5) + "之后是完全不同的收尾内容，正常结束。") < 3);
check("空串安全", comps.monitorTailRepeatCount("") === 1);

// 10c) 全局 429 续跑器核心（monitorTickCore 依赖注入直测）：沿检测（running
//      true→false）+ lastAgentError 措辞判定 + 到点发射 + 恢复清零 + capped。
//      lastAgentError 是活镜像（prompt 即清、页面刷新即无），不是持久历史——
//      历史错误没有可触发的沿。
{
  const mkSessions = (rows) => ({
    list: {
      getSnapshot: () => ({
        ids: rows.map((r) => r.id),
        byId: Object.fromEntries(rows.map((r) => [r.id, { running: r.running, displayTitle: "标题" + r.id.slice(-4) }])),
      }),
    },
    binding: (id) => {
      const row = rows.find((r) => r.id === id);
      return {
        session: {
          getSnapshot: () => ({ running: row.running, lastAgentError: row.err }),
          // 真客户端的 prompt() 第一件事就是清镜像 lastAgentError（宿主 client.js）——
          // 桩必须同语义，否则「续跑后同文本再失败」在桩里永远看不到错误沿
          prompt: () => {
            row.prompts = (row.prompts ?? 0) + 1;
            row.err = null;
            return Promise.resolve({ accepted: true });
          },
        },
      };
    },
  });
  const baseCfg = { monitorEnabled: true, monitorWaitMs: 60000, monitorMaxAuto: 10 };
  const T0 = 1_000_000;
  const itemOf = (id) => comps.monitorStore.snapshot.items.find((x) => x.id === id);

  // —— 429 失败沿 → 排等待计划 → 到点发射（sensenova 误标 quota 形态）——
  const r1 = { id: "session-g1", running: true, err: null };
  const s1 = mkSessions([r1]);
  comps.monitorTickCore(s1, baseCfg, T0);
  check("G 运行中不排计划", comps.monitorStore.snapshot.items.length === 0);
  r1.running = false;
  r1.err = '429: {"message":"inference exceeds tpm/rpm limit","type":"rate_limit_error","code":"insufficient_quota"}';
  comps.monitorTickCore(s1, baseCfg, T0 + 2000);
  check("G 429(误标quota)失败沿排等待计划", itemOf("session-g1")?.phase === "waiting");
  comps.monitorTickCore(s1, baseCfg, T0 + 2000 + 60001);
  check("G 到点发 prompt 续跑", r1.prompts === 1);
  check("G 发射后计划清除", itemOf("session-g1") === undefined);
  // —— 第二次失败：continues 累加；同文本新失败在发射后可再次触发（发射即清
  //    handledErr 记账）——
  r1.running = true;
  comps.monitorTickCore(s1, baseCfg, T0 + 70000);
  r1.running = false;
  r1.err = '429: {"message":"inference exceeds tpm/rpm limit","type":"rate_limit_error","code":"insufficient_quota"}';
  comps.monitorTickCore(s1, baseCfg, T0 + 72000);
  check("G 同文本新失败再次排计划", itemOf("session-g1")?.phase === "waiting");
  check("G 计划条目带连续计数", itemOf("session-g1")?.continues === 1);
  comps.monitorTickCore(s1, baseCfg, T0 + 72000 + 60001);
  check("G 第二次续跑发出", r1.prompts === 2);
  // —— 继续成功（正常收尾）→ 连续计数清零 ——
  r1.running = true;
  comps.monitorTickCore(s1, baseCfg, T0 + 80000);
  r1.running = false;
  r1.err = null;
  comps.monitorTickCore(s1, baseCfg, T0 + 82000);
  check("G 正常收尾清零计数", comps.monitorSessions.get("session-g1")?.continues === 0);
  comps.monitorSessions.delete("session-g1");

  // —— 达上限转 capped：停而不续，正常收尾后解除 ——
  const r2 = { id: "session-g2", running: true, err: null };
  const cfg2 = { ...baseCfg, monitorMaxAuto: 2 };
  const s2 = mkSessions([r2]);
  comps.monitorTickCore(s2, cfg2, T0 - 1000); // 基线：运行中（沿检测需要先见过 true）
  for (let round = 0; round < 2; round++) {
    r2.running = false;
    r2.err = "429: rate limited";
    comps.monitorTickCore(s2, cfg2, T0 + round * 100000);
    comps.monitorTickCore(s2, cfg2, T0 + round * 100000 + 60001);
    r2.running = true; // 续跑使回合运行
    comps.monitorTickCore(s2, cfg2, T0 + round * 100000 + 61000);
  }
  r2.running = false;
  r2.err = "429: rate limited";
  comps.monitorTickCore(s2, cfg2, T0 + 300000);
  check("G 连续达上限转 capped 不再排计划", itemOf("session-g2")?.phase === "capped" && r2.prompts === 2);
  r2.running = true; // 用户手动重试（prompt 清错误标记）
  comps.monitorTickCore(s2, cfg2, T0 + 305000);
  r2.running = false;
  r2.err = null;
  comps.monitorTickCore(s2, cfg2, T0 + 310000);
  check("G 正常收尾解除 capped", itemOf("session-g2") === undefined);
  comps.monitorSessions.delete("session-g2");

  // —— 非限流失败（AUTH/终态）不自动续 ——
  const r3 = { id: "session-g3", running: true, err: null };
  const s3 = mkSessions([r3]);
  comps.monitorTickCore(s3, baseCfg, T0 - 1000); // 基线：运行中
  r3.running = false;
  r3.err = "401: {\"message\":\"invalid api key\"}";
  comps.monitorTickCore(s3, baseCfg, T0);
  check("G 非限流失败不排计划", itemOf("session-g3") === undefined);
  comps.monitorSessions.delete("session-g3");

  // —— 取消按钮：计划丢弃且不重排（失败沿已消费）——
  const r4 = { id: "session-g4", running: true, err: null };
  const s4 = mkSessions([r4]);
  comps.monitorTickCore(s4, baseCfg, T0 - 1000); // 基线：运行中
  r4.running = false;
  r4.err = "429: too many requests";
  comps.monitorTickCore(s4, baseCfg, T0);
  check("G 取消前有计划", itemOf("session-g4")?.phase === "waiting");
  comps.monitorCancelPlan("session-g4");
  check("G 取消后计划清除", itemOf("session-g4") === undefined);
  comps.monitorTickCore(s4, baseCfg, T0 + 70000);
  check("G 取消后同一条失败不重排", itemOf("session-g4") === undefined && r4.prompts === undefined);
  // 用户手动重跑一轮后又失败（同文本）→ 运行即清记账，新失败重新触发（用户 prompt
  // 同样会清镜像，桩里显式模拟）
  r4.err = null;
  r4.running = true;
  comps.monitorTickCore(s4, baseCfg, T0 + 80000);
  r4.running = false;
  r4.err = "429: too many requests";
  comps.monitorTickCore(s4, baseCfg, T0 + 82000);
  check("G 取消后手动重跑再失败：重新触发", itemOf("session-g4")?.phase === "waiting");
  comps.monitorSessions.delete("session-g4");

  // —— 到点时回合已被用户手动跑起来：放弃本次（不重复发）——
  const r5 = { id: "session-g5", running: true, err: null };
  const s5 = mkSessions([r5]);
  comps.monitorTickCore(s5, baseCfg, T0 - 1000); // 基线：运行中
  r5.running = false;
  r5.err = "429: limited";
  comps.monitorTickCore(s5, baseCfg, T0);
  check("G 失败先排上计划（后续放弃的前提）", itemOf("session-g5")?.phase === "waiting");
  r5.running = true; // 用户介入
  comps.monitorTickCore(s5, baseCfg, T0 + 70000);
  check("G 到点时回合已在跑：放弃且不发", r5.prompts === undefined && itemOf("session-g5") === undefined);
  comps.monitorSessions.delete("session-g5");

  // —— 归档会话排除（workspaces.archivedSessionIds，侧栏同款归档集）：归档不
  //    从 sessions.list 移除会话，监视器须自行跳过；已排计划在归档 tick 作废 ——
  const r6 = { id: "session-g6", running: true, err: null };
  const s6 = mkSessions([r6]);
  comps.monitorTickCore(s6, baseCfg, T0); // 基线：运行中（未归档）
  r6.running = false;
  r6.err = "429: limited";
  comps.monitorTickCore(s6, baseCfg, T0 + 2000);
  check("G 归档前照常排计划", itemOf("session-g6")?.phase === "waiting");
  comps.monitorTickCore(s6, baseCfg, T0 + 4000, new Set(["session-g6"]));
  check("G 归档后排队计划作废、状态回收", itemOf("session-g6") === undefined && !comps.monitorSessions.has("session-g6"));
  comps.monitorTickCore(s6, baseCfg, T0 + 6000, new Set(["session-g6"]));
  check("G 归档会话不排新计划不发射", itemOf("session-g6") === undefined && r6.prompts === undefined);
  comps.monitorTickCore(s6, baseCfg, T0 + 8000);
  check(
    "G 取消归档恢复监视，但归档期躺着的旧错误不算新鲜失败",
    itemOf("session-g6") === undefined,
  );
  r6.running = true; // 回来后重新跑一轮再失败：新失败照常续
  r6.err = null;
  comps.monitorTickCore(s6, baseCfg, T0 + 10000);
  r6.running = false;
  r6.err = "429: limited";
  comps.monitorTickCore(s6, baseCfg, T0 + 12000);
  check("G 取消归档后新失败照常排计划", itemOf("session-g6")?.phase === "waiting");
  comps.monitorSessions.delete("session-g6");
}

// 10c2) 429 续跑的两个误报回归（实测踩过：回合已经做完 / 被手动停止，仍发"继续"）：
//       镜像 lastAgentError 只在 prompt() 里清，正常收尾与手动停止都不清，所以
//       "空闲 + 有 429 文本"并不等于"这次收尾就是 429 造成的"——判据必须带上
//       错误出现的时序（首见时刻 vs 本段空闲起点）
{
  const mkSessions = (rows) => {
    const sessions = rows.map((row) => ({
      getSnapshot: () => ({ running: row.running, lastAgentError: row.err }),
      cancel: () => {
        row.stopped = (row.stopped ?? 0) + 1;
        return Promise.resolve({ ok: true });
      },
      prompt: () => {
        row.prompts = (row.prompts ?? 0) + 1;
        row.err = null; // 真客户端 prompt() 同款：同步清镜像
        return Promise.resolve({ accepted: true });
      },
    }));
    return {
      list: {
        getSnapshot: () => ({
          ids: rows.map((r) => r.id),
          byId: Object.fromEntries(rows.map((r) => [r.id, { running: r.running, displayTitle: "标题" + r.id.slice(-4) }])),
        }),
      },
      // 真客户端里同一会话恒为同一实例（cancel 包装靠这一点生效）：按 id 返回稳定对象
      binding: (id) => {
        const i = rows.findIndex((r) => r.id === id);
        return i < 0 ? null : { session: sessions[i] };
      },
    };
  };
  const baseCfg = { monitorEnabled: true, monitorWaitMs: 60000, monitorMaxAuto: 10 };
  const T0 = 5_000_000;
  const itemOf = (id) => comps.monitorStore.snapshot.items.find((x) => x.id === id);

  // —— 回合中途 429（宿主内部重试 / agent 自己接着干完），最终正常收尾 ——
  const r7 = { id: "session-g7", running: true, err: null };
  const s7 = mkSessions([r7]);
  comps.monitorTickCore(s7, baseCfg, T0); // 基线：运行中
  r7.err = "429: rate limited"; // 中途失败：会话仍在跑
  comps.monitorTickCore(s7, baseCfg, T0 + 2000);
  check("G 运行中出现的 429 不排计划", itemOf("session-g7") === undefined);
  r7.running = false; // 三分钟后正常收尾，镜像里那行 429 原样躺着
  comps.monitorTickCore(s7, baseCfg, T0 + 182000);
  check("G 中途 429 后正常收尾：不续跑（旧逻辑在这里误发）", itemOf("session-g7") === undefined && r7.prompts === undefined);
  comps.monitorTickCore(s7, baseCfg, T0 + 242000); // 再过一个续跑窗口也不补发
  check("G 旧错误一直躺在镜像里也不补发", r7.prompts === undefined && itemOf("session-g7") === undefined);
  comps.monitorSessions.delete("session-g7");

  // —— 用户手动停止（abort 不走 throwError，不发 agent/error；镜像里是更早的 429）——
  const r8 = { id: "session-g8", running: true, err: null };
  const s8 = mkSessions([r8]);
  comps.monitorTickCore(s8, baseCfg, T0); // 基线：运行中
  r8.err = "429: rate limited";
  comps.monitorTickCore(s8, baseCfg, T0 + 2000); // 运行中记下这次失败
  r8.running = false; // 用户点停止
  comps.monitorTickCore(s8, baseCfg, T0 + 60000);
  check("G 手动停止后不续跑", itemOf("session-g8") === undefined && r8.prompts === undefined);
  comps.monitorSessions.delete("session-g8");

  // —— 页面刷新：镜像里带着上一轮的 429，按陈旧播种，不补续 ——
  const r9 = { id: "session-g9", running: false, err: "429: rate limited" };
  const s9 = mkSessions([r9]);
  comps.monitorTickCore(s9, baseCfg, T0); // 首见即"空闲 + 429"（页面刚打开）
  check("G 刷新页面后旧 429 不补续", itemOf("session-g9") === undefined && r9.prompts === undefined);
  r9.err = null; // 之后的新失败照常触发
  r9.running = true;
  comps.monitorTickCore(s9, baseCfg, T0 + 2000);
  r9.running = false;
  r9.err = "429: rate limited";
  comps.monitorTickCore(s9, baseCfg, T0 + 4000);
  check("G 刷新后新失败照常续跑", itemOf("session-g9")?.phase === "waiting");
  comps.monitorSessions.delete("session-g9");

  // —— 到达顺序反转（running 先落地、错误广播后到，同一段空闲内）：仍要续 ——
  const r10 = { id: "session-g10", running: true, err: null };
  const s10 = mkSessions([r10]);
  comps.monitorTickCore(s10, baseCfg, T0); // 基线：运行中
  r10.running = false; // 落地先到
  comps.monitorTickCore(s10, baseCfg, T0 + 2000);
  r10.err = "429: rate limited"; // 错误后到
  comps.monitorTickCore(s10, baseCfg, T0 + 4000);
  check("G 错误晚一拍到达仍算这次收尾的失败", itemOf("session-g10")?.phase === "waiting");
  comps.monitorSessions.delete("session-g10");

  // —— 用户点「停止」：429 与 abort 抢同一个回合时会留下一条很新鲜的失败沿，
  //    停止记账必须把它挡掉（新鲜度判据挡不住这种）——
  const r11 = { id: "session-g11", running: true, err: null };
  const s11 = mkSessions([r11]);
  comps.monitorTickCore(s11, baseCfg, T0); // 基线：运行中（这一步给 cancel 打包装）
  r11.err = "429: rate limited"; // 停止瞬间落地的失败
  void s11.binding("session-g11").session.cancel(); // 用户点停止
  r11.running = false;
  comps.monitorTickCore(s11, baseCfg, T0 + 2000);
  check("G 手动停止后的失败沿不续跑", itemOf("session-g11") === undefined && r11.prompts === undefined);
  r11.err = null; // 用户随后自己重跑一轮又失败：照常续
  r11.running = true;
  comps.monitorTickCore(s11, baseCfg, T0 + 4000);
  r11.running = false;
  r11.err = "429: rate limited";
  comps.monitorTickCore(s11, baseCfg, T0 + 6000);
  check("G 停止后新回合再失败：照常排计划", itemOf("session-g11")?.phase === "waiting");
  comps.monitorSessions.delete("session-g11");
}

// 10d) 会话通知判定核心（notifyDiffCore 依赖注入直测）：running true→false 的沿
//      → 完成通知；待回应 key 变化 → 提问/批准通知。抑制：总开关与分类开关、
//      页面在前台且事件就是当前会话、子会话、首帧播种；消失会话的状态回收。
{
  const freshState = () => ({ running: new Map(), pendingKey: new Map(), primed: false });
  const listOf = (rows, current) => ({
    ids: rows.map((r) => r.id),
    byId: Object.fromEntries(
      rows.map((r) => [r.id, { running: r.running === true, displayTitle: r.title ?? r.id, origin: r.origin }]),
    ),
    current,
  });
  const cfgAll = { notifyEnabled: true };
  const pendingOf = (id, item) => new Map([[id, item]]);

  // —— 沿检测：首帧播种，收尾才发；同一快照重复读不重发 ——
  const st1 = freshState();
  const rows1 = [{ id: "n1", running: true }];
  check("N 首帧播种不发通知（页面刚打开不算完成）", comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll).length === 0);
  rows1[0].running = false;
  const ev1 = comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll);
  check("N 回合收尾发完成通知（带会话标题）", ev1.length === 1 && ev1[0].kind === "complete" && ev1[0].sessionId === "n1" && ev1[0].title === "n1");
  check("N 快照重读不重发（沿只认一次）", comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll).length === 0);
  rows1[0].running = true;
  comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll);
  rows1[0].running = false;
  check("N 第二轮收尾再发一次", comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll).length === 1);

  // —— 抑制：页面可见且聚焦、事件又正是当前看的会话（人就在跟前）——
  const st2 = freshState();
  const rows2 = [{ id: "n2", running: true }];
  comps.notifyDiffCore(st2, { ...listOf(rows2, "n2"), foreground: true }, cfgAll);
  rows2[0].running = false;
  check("N 前台且是当前会话：不打扰", comps.notifyDiffCore(st2, { ...listOf(rows2, "n2"), foreground: true }, cfgAll).length === 0);
  const st3 = freshState();
  const rows3 = [{ id: "n3", running: true }, { id: "n4", running: true }];
  comps.notifyDiffCore(st3, { ...listOf(rows3, "n3"), foreground: true }, cfgAll);
  rows3[1].running = false;
  const ev3 = comps.notifyDiffCore(st3, { ...listOf(rows3, "n3"), foreground: true }, cfgAll);
  check("N 前台但收尾的是另一个会话：照发", ev3.length === 1 && ev3[0].sessionId === "n4");

  // —— 开关（就一个总开关；关闭期间照常记沿，打开后不补发）与子会话 ——
  const st4 = freshState();
  const rows4 = [{ id: "n5", running: true }];
  comps.notifyDiffCore(st4, listOf(rows4, null), { notifyEnabled: false });
  rows4[0].running = false;
  check("N 总开关关闭：不发", comps.notifyDiffCore(st4, listOf(rows4, null), { notifyEnabled: false }).length === 0);
  check("N 关掉期间记下的沿不补发（重开也静默）", comps.notifyDiffCore(st4, listOf(rows4, null), cfgAll).length === 0);
  const st5 = freshState();
  const rows5 = [{ id: "n6", running: true, origin: "subagent" }];
  comps.notifyDiffCore(st5, listOf(rows5, null), cfgAll);
  rows5[0].running = false;
  check("N 子会话收尾不发（导航细节属噪音）", comps.notifyDiffCore(st5, listOf(rows5, null), cfgAll).length === 0);

  // —— 待回应：key 变化即新请求，正文取首问；同一请求只提醒一次 ——
  const st7 = freshState();
  const rows7 = [{ id: "n8", running: true, title: "项目 A" }];
  check(
    "N 首帧播种不发待回应通知（打开页面时已存在的提问不算新的）",
    comps.notifyDiffCore(st7, { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:1", kind: "question", questions: [{ question: "旧问题" }] }) }, cfgAll).length === 0,
  );
  const ev7 = comps.notifyDiffCore(
    st7,
    { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:2", kind: "question", questions: [{ question: "选哪个方案？" }] }) },
    cfgAll,
  );
  check("N 新提问发通知（标题=会话名，正文=问题原文）", ev7.length === 1 && ev7[0].kind === "question" && ev7[0].title === "项目 A" && ev7[0].body === "选哪个方案？");
  check(
    "N 同一请求不重复提醒",
    comps.notifyDiffCore(st7, { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:2", kind: "question", questions: [{ question: "选哪个方案？" }] }) }, cfgAll).length === 0,
  );
  check("N 提问提醒同受总开关门控", comps.notifyDiffCore(st7, { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:3", kind: "question", questions: [{ question: "又问？" }] }) }, { notifyEnabled: false }).length === 0);
  const ev8 = comps.notifyDiffCore(
    st7,
    { ...listOf(rows7, null), pending: pendingOf("n8", { key: "approval:1", kind: "approval", toolName: "pwsh", reason: "" }) },
    cfgAll,
  );
  check("N 批准请求发通知（无理由时用工具名兜底）", ev8.length === 1 && ev8[0].kind === "approval" && /pwsh/.test(ev8[0].body));
  const ev9 = comps.notifyDiffCore(
    st7,
    { ...listOf(rows7, null), foreground: true, pending: pendingOf("n8", { key: "question:9", kind: "question", questions: [{ question: "已在跑的另一问" }] }) },
    cfgAll,
  );
  check("N 前台但提问的是当前没打开的会话：照发", ev9.length === 1 && ev9[0].kind === "question");
  // 前台 + 当前会话的待回应 → 不打扰（composer 里已经摆着）
  check(
    "N 前台且待回应就在当前会话：不打扰",
    comps.notifyDiffCore(freshState(), { ...listOf([{ id: "n10", running: true }], "n10"), foreground: true, pending: pendingOf("n10", { key: "question:8", kind: "question", questions: [{ question: "x" }] }) }, cfgAll).length === 0,
  );
  // 会话消失 → 状态回收（同 id 再来按新会话处理）
  const st8 = freshState();
  const rows8 = [{ id: "n11", running: true }];
  comps.notifyDiffCore(st8, listOf(rows8, null), cfgAll);
  comps.notifyDiffCore(st8, { ids: [], byId: {}, current: undefined }, cfgAll);
  check("N 会话消失后状态回收", !st8.running.has("n11") && !st8.pendingKey.has("n11"));

  // —— 两个观察口去重：remote 瀑布事件路径（seen 里记的是 questions 数组，官方
  //    待回应投影存的是同一个引用）先处置过的请求，投影那一路不能再提醒一遍 ——
  const st9 = freshState();
  const rows9 = [{ id: "n12", running: true }];
  const seenSet = new WeakSet();
  const qArr = [{ question: "去不去？" }];
  seenSet.add(qArr);
  comps.notifyDiffCore(st9, listOf(rows9, null), cfgAll); // 首帧播种
  check(
    "N 事件路径已处置的提问，投影路径不重复提醒",
    comps.notifyDiffCore(st9, { ...listOf(rows9, null), pending: pendingOf("n12", { key: "question:20", kind: "question", questions: qArr }), seen: seenSet }, cfgAll).length === 0,
  );
  check(
    "N seen 只挡同一次请求（另一次提问照发）",
    comps.notifyDiffCore(st9, { ...listOf(rows9, null), pending: pendingOf("n12", { key: "question:21", kind: "question", questions: [{ question: "另一问" }] }), seen: seenSet }, cfgAll).length === 1,
  );

  // —— 计划评审（exit_plan_mode 的 intent=plan-review，走同一条 user-questions 请求）
  //    单独成类：标题走「等你批准计划」，正文取计划 markdown 的首个标题 ——
  const st10 = freshState();
  const rows10 = [{ id: "n13", running: true, title: "项目 B" }];
  comps.notifyDiffCore(st10, listOf(rows10, null), cfgAll); // 首帧播种
  const evPlan = comps.notifyDiffCore(
    st10,
    {
      ...listOf(rows10, null),
      pending: pendingOf("n13", {
        key: "question:30",
        kind: "plan-review",
        questions: [{ question: "Approve this plan and leave plan mode?", detail: "# 重构终端坞\n\n1. 拆模块" }],
      }),
    },
    cfgAll,
  );
  check("N 计划评审单独成类，正文取计划首标题", evPlan.length === 1 && evPlan[0].kind === "plan" && evPlan[0].body === "重构终端坞" && evPlan[0].title === "项目 B");
  check(
    "N 计划评审无标题时退回提问原文",
    comps.notifyDiffCore(st10, { ...listOf(rows10, null), pending: pendingOf("n13", { key: "question:31", kind: "plan-review", questions: [{ question: "批准吗？", detail: "没有标题的计划" }] }) }, cfgAll)[0]?.body === "批准吗？",
  );
  check(
    "N 计划提醒同受总开关门控",
    comps.notifyDiffCore(st10, { ...listOf(rows10, null), pending: pendingOf("n13", { key: "question:32", kind: "plan-review", questions: [{ question: "x", detail: "# Y" }] }) }, { notifyEnabled: false }).length === 0,
  );
}

// 10e) 收尾判定（notifyCompleteSettled 依赖注入直测）：限流失败也会让 running 落地，
//      续跑器 2s 后才排「继续」——延迟判定必须把待续跑的失败挡掉不发通知
{
  const sessionsOf = (running) => ({
    list: { getSnapshot: () => ({ ids: ["n14"], byId: { n14: { running, displayTitle: "会话 P" } }, current: null }) },
    open: () => {},
  });
  const ev = { kind: "complete", sessionId: "n14", title: "会话 P" };
  const posted = [];
  const prevNotification = global.Notification;
  class TestNote {
    constructor(title, opts) {
      posted.push({ title, body: opts && opts.body });
    }
    close() {}
  }
  TestNote.permission = "granted";
  global.Notification = TestNote;
  const prevSnapshot = comps.monitorStore.snapshot;
  try {
    posted.length = 0;
    comps.monitorStore.snapshot = { items: [{ id: "n14", phase: "waiting" }] };
    comps.notifyCompleteSettled(sessionsOf(false), ev);
    check("N 待续跑的失败沿不发收尾通知", posted.length === 0);
    posted.length = 0;
    comps.monitorStore.snapshot = { items: [] };
    comps.notifyCompleteSettled(sessionsOf(true), ev);
    check("N 回合又跑起来（沿抖动）不发收尾通知", posted.length === 0);
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), ev);
    check("N 真收尾发完成通知", posted.length === 1 && /回合完成|turn finished/.test(posted[0].title));
    posted.length = 0;
    comps.monitorStore.snapshot = { items: [{ id: "n14", phase: "capped" }] };
    comps.notifyCompleteSettled(sessionsOf(false), ev);
    check(
      "N 自动续跑放弃（capped）换文案提醒",
      posted.length === 1 && /自动续跑已暂停|auto-continue paused/.test(posted[0].title) && /自动重试|auto-retry/.test(posted[0].body),
    );
    posted.length = 0;
    comps.notifyCompleteSettled({ list: { getSnapshot: () => ({ ids: [], byId: {}, current: null }) } }, ev);
    check("N 会话已不在列表：不发", posted.length === 0);
  } finally {
    comps.monitorStore.snapshot = prevSnapshot;
    global.Notification = prevNotification;
  }
}

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

// 10f) 压缩完成（notifyCompactionCore 依赖注入直测）：事件窗口增量里的
//      compaction/end（无 error）才算一次压缩收尾——首帧与 replace/prepend 只播种
//      （刷新/重连/翻旧页不补报），失败与 prune 不算，按持久 seq 去重；
//      正文取配对 compaction/summary 的被压规模
{
  const cfgAll = { notifyEnabled: true };
  const fresh = () => ({ compactions: new Map() });
  const evt = (seq, type, data) => ({ type: "event", event: { type, seq, time: seq, data } });
  const end = (seq, extra) => evt(seq, "compaction/end", { compactionId: `k${seq}`, turn: null, ...extra });
  const summary = (seq, id, tokens) => evt(seq, "compaction/summary", { compactionId: id, shadowedTokenCount: tokens });
  const appended = (entries) => ({ kind: "append", entries });
  const input = (over) => ({
    sessionId: "c1",
    title: "会话 C",
    entries: [],
    change: null,
    origin: undefined,
    current: null,
    foreground: false,
    ...over,
  });

  // 首帧（页面刚打开/刚上台）：窗口里已经躺着的旧压缩只播种不报
  const st1 = fresh();
  const history = [summary(10, "k10", 12345), evt(11, "compaction/end", { compactionId: "k10", turn: null })];
  check("C 首帧窗口里已有的压缩只播种不报（刷新不重报历史）", comps.notifyCompactionCore(st1, input({ entries: history, change: { kind: "replace", entries: history } }), cfgAll).length === 0);
  const fresh1 = [...history, summary(12, "k12", 12345), evt(13, "compaction/end", { compactionId: "k12", turn: 3 })];
  const out1 = comps.notifyCompactionCore(st1, input({ entries: fresh1, change: appended([summary(12, "k12", 12345), evt(13, "compaction/end", { compactionId: "k12", turn: 3 })]) }), cfgAll);
  check("C 增量里的压缩收尾发通知（标题带会话名）", out1.length === 1 && out1[0].kind === "compact" && out1[0].title === "会话 C");
  check("C 正文取被压掉历史的规模（k 量级）", /12\.3k/.test(out1[0]?.body ?? "") && /压缩|compacted/i.test(out1[0]?.body ?? ""));
  check("C 同一条重复投递不报两次", comps.notifyCompactionCore(st1, input({ entries: fresh1, change: appended([evt(13, "compaction/end", { compactionId: "k12", turn: 3 })]) }), cfgAll).length === 0);

  // 失败收尾与模型无关的 prune 都不是"压缩完成"
  const st2 = fresh();
  comps.notifyCompactionCore(st2, input({ change: appended([]) }), cfgAll);
  check("C 带 error 的压缩收尾不报（那个回合的失败另有报法）", comps.notifyCompactionCore(st2, input({ entries: [end(21, { error: "summarize failed" })], change: appended([end(21, { error: "summarize failed" })]) }), cfgAll).length === 0);
  check("C 模型无关的 prune 不报", comps.notifyCompactionCore(st2, input({ entries: [evt(22, "compaction/prune", { shadowedTokenCount: 900 })], change: appended([evt(22, "compaction/prune", { shadowedTokenCount: 900 })]) }), cfgAll).length === 0);

  // 抑制：前台且正看这个会话、开关、子会话——与回合收尾同一套判据
  const st3 = fresh();
  comps.notifyCompactionCore(st3, input({ change: appended([]) }), cfgAll);
  check("C 前台且是当前会话：不打扰", comps.notifyCompactionCore(st3, input({ entries: [end(31)], change: appended([end(31)]), current: "c1", foreground: true }), cfgAll).length === 0);
  check("C 前台但压缩的是另一个会话：照发", comps.notifyCompactionCore(st3, input({ sessionId: "c2", entries: [end(32)], change: appended([end(32)]), current: "c1", foreground: true }), cfgAll).length === 1);
  check("C 压缩提醒同受总开关门控", comps.notifyCompactionCore(st3, input({ entries: [end(33)], change: appended([end(33)]) }), { notifyEnabled: false }).length === 0);
  check("C 子会话压缩不发（导航细节属噪音）", comps.notifyCompactionCore(st3, input({ entries: [end(35)], change: appended([end(35)]), origin: "subagent" }), cfgAll).length === 0);

  // 重连重放（replace）与翻旧页（prepend）不报；之后落地的新压缩照报
  const st4 = fresh();
  comps.notifyCompactionCore(st4, input({ entries: [end(40)], change: { kind: "replace", entries: [end(40)] } }), cfgAll);
  check("C 重连重放（replace）不补发", comps.notifyCompactionCore(st4, input({ entries: [end(40)], change: { kind: "replace", entries: [end(40)] } }), cfgAll).length === 0);
  check("C 翻旧页（prepend）带出的旧压缩不报", comps.notifyCompactionCore(st4, input({ entries: [end(39), end(40)], change: { kind: "prepend", entries: [end(39)] } }), cfgAll).length === 0);
  check("C 重放之后的新压缩照报", comps.notifyCompactionCore(st4, input({ entries: [end(40), end(41)], change: appended([end(41)]) }), cfgAll).length === 1);

  // 摘要事件不在窗口（配对失败）→ 退回纯完成文案
  const st5 = fresh();
  comps.notifyCompactionCore(st5, input({ change: appended([]) }), cfgAll);
  const out5 = comps.notifyCompactionCore(st5, input({ entries: [end(51)], change: appended([end(51)]) }), cfgAll);
  check("C 规模未知时只报完成", out5.length === 1 && /压缩完成|compaction finished/i.test(out5[0].body));
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
// 展开态（预置第 5 个 useState = open）跑一遍组渲染体：通知组的权限行在这里。
// 权限只读浏览器侧事实，Node 无 Notification → 走「不支持」分支且按钮禁用
stateSeq = 0;
stateStore.clear();
stateStore.set(4, true);
callLog = [];
out = comps.KitConfigCard({ scope: fakeScope });
const permHit = callLog.find(([, , p]) => p && typeof p === "object" && p.className === "dshk-cfg-combo" && p.disabled === true);
const permBtn = permHit ? permHit[2] : null;
check(
  "设置卡展开：通知组渲染出权限行（无 Notification 时按钮禁用）",
  !!out && !!permBtn && permBtn.children === "Unsupported" && callLog.some(([, , p]) => p && p.className === "dshk-cfg-field dshk-cfg-sub" && p.children),
);
stateSeq = 0;
stateStore.clear();
// 设置卡布局：左右两键 + 官方「工作区文件」入口开关在「侧边栏」组（组头，无启用
// 开关——Ctrl+B 恒生效），字段行走官方通用设置模型（标题+说明左列、控件右置）
check(
  "侧边栏组含左右两键与官方工作区文件入口开关、带组头、无启用位",
  src.includes('{ title: "cfgGroupSidebar", switchKey: null, fields: ["sidebarShortcut", "rightbarShortcut", "hideOfficialFilesEntry"] }') && src.includes('cfgGroupSidebar: "侧边栏"') && !src.includes("sidebarShortcutEnabled") && !src.includes("chatOpenFilePreview"),
);
// 默认值与宿主 Config schema（src/index.ts）逐项同值：恢复默认拿的是宿主组合基座
// （base 只带 vaultRoot 一项），其余键由 cfgFormat 回落
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
// phoneKeepGatewayOn 不能被 cfgFormat 的 undefined → "true" 兜底成勾选态——
// 界面显示已恢复默认、实际保存后是关，两边对不上
check(
  "恢复默认：bool 字段缺基座项回落内置默认（phoneKeepGatewayOn 默认 false）",
  comps.cfgFormat("phoneKeepGatewayOn", undefined) === "false" &&
    comps.cfgFormat("terminalEnabled", undefined) === "true" &&
    comps.cfgFormat("phoneKeepGatewayOn", true) === "true" &&
    comps.cfgFormat("phoneKeepGatewayOn", false) === "false",
);
// 过时文案清理：现行说明不得出现「侧栏底部『任务』钮」、日程索引标题键、搜索默认 5
check(
  "设置卡过时文案已更新（无侧栏底部钮现行说法/默认 5/schedIdxTitle）",
  !src.includes("侧栏底部「") && !src.includes("默认 5") && !src.includes("schedIdxTitle"),
);
// OpenCode Go 会话头是内置行为、不是配置项：i18n 键与写入端点都必须不存在；
// 注入机制本身由 test-opencode-session.mjs 覆盖
check(
  "OpenCode Go 会话头不在设置卡里（i18n 键与端点均移除）",
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

// 日程只有右栏 dock 签（入口归右栏开始页与待办卡）：侧栏待办索引、日程快捷键及其
// 设置项都不得出现；开合走右栏快捷键（Ctrl+Alt+B，可配置）
check(
  "日程侧栏索引与专属快捷键不存在（schedIdxOpen/schedShortcut 全链移除）",
  !src.includes("schedIdxOpen") && !src.includes("schedShortcut") && !src.includes("cfgSchedShortcut") && !src.includes("ScheduleIndexView"),
);
check("右栏收起/展开快捷键已接入（默认 Ctrl+Alt+B，走 sidebarRight.toggleExpanded）", src.includes('rightbarShortcut: "Ctrl+Alt+B"') && src.includes("sr.toggleExpanded()"));
// 文件树没有「上传文件到当前目录」：按钮/隐藏 input/上传逻辑/i18n 键都不得存在；
// vault 附件上传仍走 /dsh-kit/upload（端点保留）
check(
  "文件树上没有上传按钮与逻辑（vault 附件上传不受影响）",
  !src.includes("UploadIcon") && !src.includes("treeUpload") && !src.includes("uploadDone") && !src.includes("uploadFail"),
);
// SCM 面板分支按钮会被 .dshk-btn 的 26px 方钮定宽压扁（svg/分支名 0 宽只剩 ▾）——
// 分支按钮必须显式 width:auto 反制
check("分支按钮不被 .dshk-btn 定宽压扁（width:auto 修正恒在）", src.includes(".dshk-branchbtn{display:inline-flex;flex:none;width:auto"));

// React 桩记录到的组件类型必须包含本插件自定义组件名（防 ReferenceError 被忽略后整段缺失）
const types = new Set(callLog.flatMap(([, t]) => (typeof t === "string" ? [t] : [])));
// 至少渲染出来 JSX 元素（说明走到 render 而非静默 null）
check("渲染体实际产出元素", callLog.length > 0);

// 收尾结算放进 setTimeout：6.9c 里 ↻ 刷新的目录树重拉排在 await loadIndex()
// 之后的微任务里，同步段看不到；微任务先于定时器清空，此刻断言才成立
setTimeout(async () => {
  const treeHits = vaultRefreshFetched.filter((u) => u.includes("/dsh-kit/tree"));
  check("↻ 刷新连带重拉每个已展开目录（/dsh-kit/tree ×2）", treeHits.length === 2);
  // kit 端点包装（kitGetJson/kitPostJson/kitJson）：回包约定收在一处后的行为契约。
  // 2xx 且形状断言通过才算成功，失败带宿主 error 原文与 status——写文件的 409
  // 冲突分流就靠 status/body，这里把契约钉死
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
    scripted = { status: 200, body: { entries: [{ name: "a" }] } };
    const tree = await comps.fetchTree("/w");
    check("kitGetJson：2xx + 形状通过 → 回包直通", tree.entries.length === 1 && calls[0].url === "/dsh-kit/tree?path=%2Fw");
    scripted = { status: 200, body: { nope: 1 } };
    const shapeErr = await rejection(comps.fetchTree("/w"));
    check("kitGetJson：形状不符 → 抛错（半个回包不当成功）", !!shapeErr && shapeErr.message === "HTTP 200");
    scripted = { status: 500, body: { error: "boom" } };
    const netErr = await rejection(comps.fetchGitStatus("C:/w"));
    check("kitGetJson：非 2xx → 抛错带宿主 error 与 status", !!netErr && netErr.message === "boom" && netErr.status === 500);
    scripted = { status: 200, body: { ok: false, error: "nope" } };
    const okErr = await rejection(comps.postFsOp({ cwd: "C:/w", op: "create" }));
    check("kitPostJson：回包显式 ok:false → 也算失败", !!okErr && okErr.message === "nope");
    scripted = { status: 200, body: { ok: true, created: true } };
    const init = await comps.fetchGitInit("C:/w");
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
