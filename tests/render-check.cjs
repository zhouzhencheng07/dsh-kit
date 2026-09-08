// 渲染级验证：桩掉 react hooks，直接函数调用 dsh-kit 的组件
// （TreeNode/FileTreePanel/FileContentPane/TerminalEntry/FileTreeEntry/KitSurfaces/
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
  "return { TreeNode, FileTreePanel, FileContentPane, TerminalEntry, FileTreeEntry, ScmEntry, JobsPanel, PhoneSection, KitSurfaces, KitConfigCard, GitChangesPanel, GitGraphPanel, GitBranchMenu, GitActionsMenu, SkillsManager, TerminalDock, TerminalPane, TreeRowMenu, CommitGraphSvg, computeCommitGraph, BrowserPanel, RightDock, DockStub, openPreviewTab, closePreviewTab, openDockTab, tabCloseConfirm, maybeAutoOpenBrowser, closeBrowserDockForGone, getKitUi, dockBounds, setKitUi, makeTerm, ScheduleView, ScheduleModal, FloatingTimerPill, timerElapsedStr, timerMinsOfDT, schedAssignLanes, VaultView, VaultRootView, vaultSplitFrontmatter, vaultParseFmInfo, resolveVaultLink, vaultBacklinks, vaultCascadeDelete, vaultHeadingSlug };",
);
const harness = new Function("require", wrapper);
const comps = harness((name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  throw new Error("unexpected require: " + name);
});

if (!comps || typeof comps !== "object") { console.log("FATAL: no components returned"); process.exit(2); }
const names = ["TreeNode", "FileTreePanel", "FileContentPane", "TerminalEntry", "FileTreeEntry", "ScmEntry", "JobsPanel", "PhoneSection", "KitSurfaces", "KitConfigCard", "GitChangesPanel", "GitGraphPanel", "GitBranchMenu", "GitActionsMenu", "SkillsManager", "TerminalDock", "TerminalPane", "CommitGraphSvg", "BrowserPanel", "RightDock", "DockStub", "openDockTab", "dockBounds", "ScheduleView", "ScheduleModal", "FloatingTimerPill", "timerElapsedStr", "timerMinsOfDT", "schedAssignLanes", "VaultView", "VaultRootView", "vaultSplitFrontmatter", "vaultParseFmInfo", "resolveVaultLink", "vaultBacklinks", "vaultCascadeDelete", "vaultHeadingSlug"];
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

// 6) FileContentPane：加载中（fetch 被桩跳过 -> 保持 loading）
callLog = [];
out = comps.FileContentPane({ path: "C:/x/b.js", cwd: "C:/x", onClose: () => {} });
check("FileContentPane 渲染无异常", !!out && typeof out === "object");

// 6.1) FileContentPane PDF ready 分支：pdf.js 宿主容器 + ↗ 兜底（canvas 由
//      effect 挂载，桩覆盖不到——重置序号预置 useState#0 让渲染体走到新分支）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, {
  phase: "ready",
  body: { path: "C:/x/doc.pdf", size: 10, mtimeMs: 1, truncated: false, binary: true, content: null },
});
callLog = [];
out = comps.FileContentPane({ path: "C:/x/doc.pdf", cwd: "C:/x", onClose: () => {} });
const pdfHost = callLog.find((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-pdf-scroll");
check("FileContentPane PDF ready 渲染无异常", !!out && typeof out === "object");
check("PDF 渲染出 pdf.js 宿主容器", !!pdfHost);

// 6.2) xlsx ready 分支：表格宿主容器产出（SheetJS 解析在沙箱 effect 里，桩不覆盖）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, {
  phase: "ready",
  body: { path: "C:/x/t.xlsx", size: 10, mtimeMs: 1, truncated: false, binary: true, content: null },
});
callLog = [];
out = comps.FileContentPane({ path: "C:/x/t.xlsx", cwd: "C:/x", onClose: () => {} });
const sheetHost = callLog.find(
  (c) =>
    (c[0] === "jsx" || c[0] === "jsxs") &&
    c[2] &&
    typeof c[2].className === "string" &&
    c[2].className.includes("dshk-sheetwrap"),
);
check("FileContentPane xlsx ready 渲染无异常", !!out && typeof out === "object");
check("xlsx 渲染出表格宿主容器", !!sheetHost);

// 6.3) docx ready 分支：文档宿主容器产出（mammoth 转换在沙箱 effect 里，桩不覆盖）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, {
  phase: "ready",
  body: { path: "C:/x/t.docx", size: 10, mtimeMs: 1, truncated: false, binary: true, content: null },
});
callLog = [];
out = comps.FileContentPane({ path: "C:/x/t.docx", cwd: "C:/x", onClose: () => {} });
const docHost = callLog.find(
  (c) =>
    (c[0] === "jsx" || c[0] === "jsxs") &&
    c[2] &&
    typeof c[2].className === "string" &&
    c[2].className.includes("dshk-docwrap"),
);
check("FileContentPane docx ready 渲染无异常", !!out && typeof out === "object");
check("docx 渲染出文档宿主容器", !!docHost);

// 6.4) 已删除文件（deleted）：仅 diff 预览——⇄ 不出现，渲染删除说明 + diff 体
// （read 请求被 deleted 守卫跳过，桩环境 effect 不执行、直接验渲染体）
callLog = [];
out = comps.FileContentPane({ path: "C:/x/gone.js", cwd: "C:/x", deleted: true });
const deletedNote = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.includes("文件已删除") || c[2].children.includes("File deleted")));
const deletedToggle = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].children === "⇄");
check("FileContentPane deleted 渲染无异常", !!out && typeof out === "object");
check("deleted 预览渲染删除说明且无 ⇄ 切换", !!deletedNote && !deletedToggle);

// 6.4.1) 真实时序（effect 已跑）：state 进入 phase:"deleted" 后的渲染体——
// body 计算块必须兜住该态（曾崩 b.binary，effect 产出的态是桩盲区，须预置验证）
stateSeq = 0;
stateStore.clear();
stateStore.set(0, { phase: "deleted" });
callLog = [];
out = comps.FileContentPane({ path: "C:/x/gone.js", cwd: "C:/x", deleted: true });
const deletedNote2 = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.includes("文件已删除") || c[2].children.includes("File deleted")));
check("FileContentPane deleted态(body计算块)渲染无异常", !!out && typeof out === "object" && !!deletedNote2);
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
out = comps.FileContentPane({ path: "C:/x/gone.md", cwd: "C:/x", deleted: true });
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
// 7.1) 后台任务面板：无 hooks（jobsBySession 未达 → 空列表）与有任务两种；
// 入口已迁右坞（JobsEntry 已删），openDockTab 纯补丁与坞内徽标在这里覆盖
const otj = comps.openDockTab({ previews: [], jobsOpen: false, browserOpen: false, schedOpen: false, dockTab: null, dockCollapsed: true }, "jobs");
check("openDockTab 任务：置存在+激活+展开收起态", otj.jobsOpen === true && otj.dockTab === "jobs" && otj.dockCollapsed === false);
const ots = comps.openDockTab({ previews: [], jobsOpen: false, browserOpen: false, schedOpen: false, dockTab: null, dockCollapsed: false }, "schedule");
check("openDockTab 日程：置存在+激活（右坞第四标签）", ots.schedOpen === true && ots.dockTab === "schedule" && ots.jobsOpen === undefined);
const otb = comps.openDockTab({ previews: [], jobsOpen: true, browserOpen: false, dockTab: "jobs", dockCollapsed: false }, "browser");
check("openDockTab 浏览器：纯补丁不触碰任务标签（合并保留）", otb.browserOpen === true && otb.dockTab === "browser" && otb.jobsOpen === undefined);
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
comps.setKitUi({ jobsOpen: true, dockTab: "jobs", dockCollapsed: false });
callLog = [];
out = comps.RightDock({ props: jobsHooks, cwd: "C:/x" });
check("RightDock 带运行中任务渲染无异常", !!out && typeof out === "object");
const jobsTabBadge = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-term-badge" && c[2].children === "2");
check("RightDock 任务标签带运行中计数徽标(2)", !!jobsTabBadge);
const dockAddBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["打开标签", "Open a tab"].includes(c[2]["aria-label"]));
check("RightDock 坞头渲染 + 号打开标签按钮", !!dockAddBtn);
comps.setKitUi({ jobsOpen: false, dockTab: null });
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

// 7.2.5) 关页签守卫：agent 活动页（●）的 ✕ 走确认（confirm=false 拦下、=true 放行），
// 非活动页签不确认直接关。预置 stateStore 走运行态渲染（页签条才出现）；
// 纯函数分支用 seam 导出的 tabCloseConfirm 直调覆盖
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
let confirmCalls = 0;
let confirmArg = null;
global.window.confirm = (msg) => { confirmCalls++; confirmArg = msg; return false; };
tabXs[0][2].onClick(fakeEvent);
check("非活动页签 ✕ 不确认直接关", confirmCalls === 0);
tabXs[1][2].onClick(fakeEvent);
check("agent 活动页 ✕ 触发确认弹窗（带文案）", confirmCalls === 1 && typeof confirmArg === "string" && confirmArg.length > 0);
check("tabCloseConfirm 确认放行", comps.tabCloseConfirm({ active: true }, () => true, (k) => k) === true);
check("tabCloseConfirm 拒绝拦下", comps.tabCloseConfirm({ active: true }, () => false, (k) => k) === false);
check("tabCloseConfirm 非活动页不确认", comps.tabCloseConfirm({ active: false }, () => { throw new Error("should not confirm"); }, (k) => k) === true);
global.window.confirm = undefined;

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
comps.setKitUi({ browserOpen: false, dockTab: null, dockCollapsed: false });
comps.maybeAutoOpenBrowser();
check("maybeAutoOpenBrowser 弹回浏览器标签", comps.getKitUi().browserOpen === true && comps.getKitUi().dockTab === "browser");
comps.closeBrowserDockForGone();
check("closeBrowserDockForGone 收掉面板标签（0 页无面板壳）", comps.getKitUi().browserOpen === false && comps.getKitUi().dockTab === null);
comps.setKitUi({ browserOpen: false, dockTab: null, dockCollapsed: false });

// 7.2.1) 右侧标签页容器：浏览器标签激活态。注意桩环境嵌套组件体不执行
// （jsx(BrowserPanel) 只建元素），面板内部由上面直接调用 BrowserPanel 的用例覆盖；
// 这里验证 dock 页签条高亮与面板挂载元素
comps.setKitUi({ browserOpen: true, dockTab: "browser" });
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
const dockOnTab = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-tab dshk-tab-on");
const bpElem = callLog.find((c) => c[1] === comps.BrowserPanel && c[2] && c[2].active === true);
check("RightDock 浏览器标签渲染无异常", !!out && typeof out === "object");
check("RightDock 渲染出激活浏览器标签与面板挂载元素", !!dockOnTab && !!bpElem);
comps.setKitUi({ browserOpen: false, dockTab: null });
// 右坞宽度：三标签界限必须同一（宽度共享单值，界限分档会让切标签改宽——
// 曾 jobs 上限 560 窄于预览 720，用户实测切后台任务面板变窄）
const dbP = comps.dockBounds("preview");
const dbJ = comps.dockBounds("jobs");
const dbB = comps.dockBounds("browser");
check("右坞三标签宽度界限同一（切标签不改宽）", dbP.min === dbJ.min && dbP.max === dbJ.max && dbP.min === dbB.min && dbP.max === dbB.max);

// 7.2.2) 多文件预览：二级文件小标签条（>1 个文件才显示）+ 坞头三件（用户定稿
// 2026-09-06：» 最左，标签条/+ 仅在有标签时显示，全部关闭 ✕ 同样仅有标签时显示）
comps.setKitUi({
  previews: [
    { path: "C:/x/a.js", from: "tree", untracked: false, usedAt: 1 },
    { path: "C:/x/b.md", from: "scm", untracked: true, usedAt: 2 },
  ],
  activePreview: "C:/x/b.md",
  dockTab: "preview",
});
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
const pvTabrow = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-pv-tabrow");
const pvChips = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && typeof c[2].title === "string" && c[2].title.startsWith("C:/x/"));
// 桩环境 <html lang> 缺失 → t() 走英文兜底（语言跟随设计的正确行为），断言双语匹配
// 全部关闭按钮 2026-09-08 用户定稿移除（逐个关标签即可）——断言其不再渲染
const closeAllBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["全部关闭", "Close all"].includes(c[2]["aria-label"]));
const minimizeBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["最小化面板", "Minimize panel"].includes(c[2]["aria-label"]));
const addBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-dock-add");
check("RightDock 多文件预览渲染无异常", !!out && typeof out === "object");
check("RightDock 渲染出二级文件标签条（2 个文件 chip）", !!pvTabrow && pvChips.length === 2);
check("RightDock 有标签：最小化 + 新建都在且全部关闭已移除", !!minimizeBtn && !!addBtn && !closeAllBtn);
comps.setKitUi({ previews: [], activePreview: null, dockTab: null });

// 7.2.2b) 单文件预览：文件标签条恒显示（与浏览器页签统一——单文件也有标签级 ✕，
// 不再只能靠坞头全部关闭/Esc）；0 文件时不渲染空标签条
comps.setKitUi({
  previews: [{ path: "C:/x/only.js", from: "tree", untracked: false, usedAt: 1 }],
  activePreview: "C:/x/only.js",
  dockTab: "preview",
});
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
const singleChip = callLog.filter((c) => (c[0] === "jsxs") && c[2] && typeof c[2].className === "string" && c[2].className.startsWith("dshk-tab") && c[2].title === "C:/x/only.js");
const singleX = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-x");
check("RightDock 单文件预览渲染文件标签与 ✕（与浏览器统一）", singleChip.length === 1 && !!singleX);
comps.setKitUi({ previews: [], activePreview: null, browserOpen: true, dockTab: "browser" });
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
check("无预览文件时不渲染空标签条", !callLog.some((c) => c[2] && c[2].className === "dshk-pv-tabrow"));
comps.setKitUi({ browserOpen: false, dockTab: null });

// 7.2.4) 最小化：KitSurfaces 收起态渲染 DockStub 收起栏（RightDock 不再出现）；
// DockStub 直调产出可点击的展开按钮
comps.setKitUi({ browserOpen: true, dockTab: "browser", dockCollapsed: true });
callLog = [];
out = comps.KitSurfaces({});
const stubElem = callLog.find((c) => c[1] === comps.DockStub);
const dockElem = callLog.find((c) => c[1] === comps.RightDock);
check("KitSurfaces 最小化态渲染无异常", !!out && typeof out === "object");
check("最小化态挂 DockStub 收起栏且不挂 RightDock", !!stubElem && !dockElem);
callLog = [];
out = comps.DockStub({});
const stubBtn = callLog.find((c) => (c[0] === "jsx") && c[2] && ["展开面板", "Expand panel"].includes(c[2]["aria-label"]));
check("DockStub 直调渲染展开按钮", !!out && typeof out === "object" && !!stubBtn);
comps.setKitUi({ browserOpen: false, dockTab: null, dockCollapsed: false });

// 7.2.4b) 常置（2026-09-06）：0 标签、未收起时 KitSurfaces 仍挂 RightDock——
// 空态渲染「打开标签页」选择器（标题/提示 + 任务/浏览器卡片，cfg 走默认全开），
// 不再随「最后一个标签关闭」消失；DockStub 0 标签显示通用「侧边面板」文案
comps.setKitUi({ previews: [], activePreview: null, jobsOpen: false, browserOpen: false, schedOpen: false, dockTab: null, dockCollapsed: false });
callLog = [];
out = comps.KitSurfaces({});
const dockMounted = callLog.find((c) => c[1] === comps.RightDock);
check("KitSurfaces 常置：0 标签仍挂 RightDock", !!dockMounted);
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
const emptyTitle = callLog.find((c) => (c[0] === "jsx") && c[2] && (c[2].children === "打开标签页" || c[2].children === "Open tabs"));
const emptyHint = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("选择要在侧边面板") || c[2].children.startsWith("Choose a tab")));
const emptyCards = callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-dock-empty-card");
check("RightDock 常置空态渲染选择器标题与提示", !!emptyTitle && !!emptyHint);
check("RightDock 空态渲染后台任务/日程/知识库/浏览器四张卡片（计时 tab 已取消）", emptyCards.length === 4);
const emptyAdd = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-dock-add");
const emptyCloseAll = callLog.find((c) => (c[0] === "jsx") && c[2] && ["全部关闭", "Close all"].includes(c[2]["aria-label"]));
const emptyMin = callLog.find((c) => (c[0] === "jsx") && c[2] && ["最小化面板", "Minimize panel"].includes(c[2]["aria-label"]));
check("RightDock 0 标签：只有最小化图标钮（+ 与全部关闭都不出现）", !emptyAdd && !emptyCloseAll && !!emptyMin);
comps.setKitUi({ schedOpen: true, dockTab: "schedule" });
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
const schedOn = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-tab dshk-tab-on");
const schedElem = callLog.find((c) => c[1] === comps.ScheduleView);
check("RightDock 日程标签激活并挂 ScheduleView", !!schedOn && !!schedElem);
check("RightDock 页条不再挂计时芯片（计时独立成页）", !callLog.some((c) => typeof c[1] === "function" && c[1].name === "ScheduleTimerChip"));
comps.setKitUi({ schedOpen: false, dockTab: null });
comps.setKitUi({ vaultOpen: true, dockTab: "vault" });
callLog = [];
out = comps.RightDock({ props: {}, cwd: "C:/x" });
const vaultElem = callLog.find((c) => c[1] === comps.VaultView);
check("RightDock 知识库标签挂 VaultView", !!vaultElem);
comps.setKitUi({ vaultOpen: false, dockTab: null });

// 6.6) 知识库纯函数：frontmatter 拆分 / 解析优先级 / 反链
//（wikilink/数学变换已并入 RTE vendor，往返断言在 tests/test-vault-rte.mjs）
{
  const raw = "---\ncreated: 2026-09-06\n---\n\n# 标题\n\n正文";
  const { fmText, rest } = comps.vaultSplitFrontmatter(raw);
  check("fm 拆分：字节级原文 + 正文", fmText === "---\ncreated: 2026-09-06\n---\n" && rest === "\n# 标题\n\n正文");
  const info = comps.vaultParseFmInfo(fmText);
  check("fm 解析：created", info.created === "2026-09-06");
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

// 6.9) 单态 VaultRootView 直渲（无 hooks 执行的完整渲染体）：槽位渲染器会静默
// 吞掉渲染期异常（readerRef 残留引用教训），必须在这里显式跑过才肯放行
{
  let vaultOut = null;
  let vaultErr = null;
  try {
    vaultOut = comps.VaultRootView({ root: "D:/v" });
  } catch (e) {
    vaultErr = e;
  }
  check("VaultRootView 单态渲染无异常", vaultErr === null && !!vaultOut && typeof vaultOut === "object");
  if (vaultErr) console.log("  VaultRootView error:", vaultErr.message);
}
comps.setKitUi({ dockCollapsed: true });
callLog = [];
out = comps.DockStub({});
const railRoot = callLog.find((c) => c[0] === "jsxs" && c[2] && c[2].className === "dshk-dock-rail");
const railBtns = callLog.filter((c) => (c[0] === "jsx" || c[0] === "jsxs") && c[2] && c[2].className === "dshk-dock-rail-btn");
const railExpand = railBtns.find((c) => ["展开面板", "Expand panel"].includes(c[2]["aria-label"]));
const railGeneric = railBtns.find((c) => typeof c[2].title === "string" && (c[2].title.startsWith("侧边面板") || c[2].title.startsWith("Side panel")));
check("DockStub 0 标签渲染收起栏（展开钮 + 5 枚快捷开标签图标）", !!railRoot && railBtns.length === 6 && !!railExpand);
check("DockStub 0 标签展开钮标题以通用侧边面板开头", !!railGeneric);
comps.setKitUi({ dockCollapsed: false });

// 7.2.3) 预览标签 LRU 纯逻辑：默认上限 8，超限开新文件逐出 usedAt 最小者；
// 重开已存在文件置顶激活不逐出自身；关闭激活文件激活位顺延邻居
const lruBase = [];
for (let i = 1; i <= 8; i++) lruBase.push({ path: `C:/x/f${i}.js`, from: "tree", untracked: false, usedAt: i });
const opened = comps.openPreviewTab({ previews: lruBase, activePreview: "C:/x/f8.js" }, "C:/x/f9.js", "tree", false);
check("openPreviewTab 超限 LRU 逐出最久未用", opened.previews.length === 8 && !opened.previews.some((p) => p.path === "C:/x/f1.js") && opened.previews.some((p) => p.path === "C:/x/f9.js") && opened.activePreview === "C:/x/f9.js");
const reopened = comps.openPreviewTab({ previews: opened.previews, activePreview: "C:/x/f9.js" }, "C:/x/f2.js", "scm", false);
const reopenedItem = reopened.previews.find((p) => p.path === "C:/x/f2.js");
check("openPreviewTab 重开已存在文件置顶激活不逐出自身", reopened.previews.length === 8 && reopened.activePreview === "C:/x/f2.js" && !!reopenedItem && reopenedItem.untracked === false && reopenedItem.from === "scm");
const closed = comps.closePreviewTab({ previews: opened.previews, activePreview: "C:/x/f9.js" }, "C:/x/f9.js");
check("closePreviewTab 关激活文件激活位顺延邻居", closed.previews.length === 7 && closed.activePreview === "C:/x/f8.js");
const closedLast = comps.closePreviewTab({ previews: [{ path: "C:/x/only.js", from: "tree", untracked: false, usedAt: 1 }], activePreview: "C:/x/only.js" }, "C:/x/only.js");
check("closePreviewTab 关最后一个文件预览大标签随之消失", closedLast.previews.length === 0 && closedLast.activePreview === null);
const delOpen = comps.openPreviewTab({ previews: [], activePreview: null }, "C:/x/gone.js", "scm", false, true);
check("openPreviewTab 携带 deleted 标记", delOpen.previews.length === 1 && delOpen.previews[0].deleted === true && delOpen.activePreview === "C:/x/gone.js");
// 7.2.3b) commit 钉定（图谱提交详情进入）：条目携带 commit；从 SCM 重开同路径清除钉定
const commitOpen = comps.openPreviewTab({ previews: [], activePreview: null }, "C:/x/hist.js", "scm", false, false, "abc1234def");
check("openPreviewTab 携带 commit 钉定", commitOpen.previews.length === 1 && commitOpen.previews[0].commit === "abc1234def" && commitOpen.activePreview === "C:/x/hist.js");
const commitReopen = comps.openPreviewTab(commitOpen, "C:/x/hist.js", "scm", false);
check("openPreviewTab 从 SCM 重开同路径清除钉定", commitReopen.previews[0].commit === undefined);

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
out = comps.FileContentPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "full40hash" });
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
out = comps.FileContentPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "full40hash" });
const delRed = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-del").map((c) => c[2].children);
const delMeta = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("diff --git") || c[2].children.startsWith("@@")));
check("提交钉定删除文件走纯红块（无元数据噪音）", delRed.includes("old") && !delRed.includes("new") && !delMeta);
// 新像缺失（过大/二进制，无 content 无 blobMissing）：回落原始 patch
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText });
callLog = [];
out = comps.FileContentPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "full40hash" });
const rawFallback = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diff");
check("钉定无新像回落原始 patch", !!rawFallback);
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, base: "", text: commitDiffText });
callLog = [];
out = comps.FileContentPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm", commit: "root40hash" });
const rootNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diffnote" && typeof c[2].children === "string" && (c[2].children.includes("empty tree") || c[2].children.includes("空树")));
check("根提交钉定显示空树基线说明", !!rootNote);
// 非 commit 的常规 diff 视图不受影响：hunk 仍套回盘上内容（全文件着色）
stateStore.clear();
stateSeq = 0;
stateStore.set(0, readyBody);
stateStore.set(2, { phase: "ready", clean: false, text: commitDiffText });
callLog = [];
out = comps.FileContentPane({ path: "C:/x/f.js", cwd: "C:/x", source: "scm" });
const normalOverlay = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-inline");
check("常规 diff 视图仍套盘上内容（无 commit 钉定）", !!normalOverlay);
// 预览头部标题：绝对路径（文件名由页签 chip 承担）
callLog = [];
out = comps.FileContentPane({ path: "C:/x/dir/f.js", cwd: "C:/x", source: "scm" });
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

// React 桩记录到的组件类型必须包含本插件自定义组件名（防 ReferenceError 被忽略后整段缺失）
const types = new Set(callLog.flatMap(([, t]) => (typeof t === "string" ? [t] : [])));
// 至少渲染出来 JSX 元素（说明走到 render 而非静默 null）
check("渲染体实际产出元素", callLog.length > 0);

console.log(failed === 0 ? "ALL RENDER OK" : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
