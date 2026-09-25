// dsh-kit-files 浏览器半边渲染级检查：加载真实 dock bundle（root client）+ files
// bundle，直测文件树/源代码管理面板群（TreeNode/FileTreePanel/TreeRowMenu/DiffPane/
// GitChangesPanel/GitGraphPanel/CommitGraphSvg/GitBranchMenu/FileTreeEntry/ScmEntry）
// 与 apply 激活契约（入口自注册/配置页/侧栏分支渲染器座）。
// 用法（dsh-kit 根）：node tests\render-check-files.cjs
const fs = require("node:fs");

let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };

// 浏览器全局最小桩（与根 render-check 同口径）
if (!global.localStorage) {
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(String(k), String(v)), removeItem: (k) => store.delete(k) };
}
// body 标记类的 toggle 记录（官方「工作区文件」入口掩码随组件配置切换）
const bodyClassLog = [];
if (!global.document) {
  global.document = {
    visibilityState: "visible",
    documentElement: { lang: "" },
    addEventListener: () => {},
    removeEventListener: () => {},
    // querySelector/dataset：injectStyles 的幂等判定与样式标签登记用
    querySelector: () => null,
    createElement: () => ({ className: "", textContent: "", dataset: {}, setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {} }),
    head: { appendChild: () => {} },
    body: { classList: { add() {}, remove() {}, toggle: (cls, on) => bodyClassLog.push([cls, on === true]) }, appendChild: () => {} },
  };
}
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {} };
if (!global.location) global.location = { protocol: "http:", host: "127.0.0.1:3081" };
if (!global.MutationObserver) global.MutationObserver = class { observe() {} };

const loadBundle = (path, requireMap) => {
  const src = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("factory: (require) => {");
  if (start < 0) throw new Error("no factory: " + path);
  const tail = src.lastIndexOf("  },\n});");
  const body = src.slice(start + "factory: (require) => {".length, tail);
  return new Function("require", body)(requireMap);
};

// react hooks 桩（useState 带可预置的 stateStore，供 DiffPane 渲染分支测试）
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
  // 悬停气泡：官方 primitives 的 Tooltip（KitTip 有它就走官方气泡）
  Tooltip: jsxPrim("dsw-tooltip"),
};

// 1) 共享底座：root bundle 真实加载（kitBase 随 factory 执行），组件从这里取共享面
const dockExports = loadBundle(__dirname + "/../client/bundle.js", (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return { createPortal: (children) => ({ type: "portal", props: { children }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
});
check(
  "dock 共享面（kit 三件套/轻提示/剪贴板/kitUi/侧栏展开/树行菜单与图标/树行打开路由）",
  [dockExports.kitGetJson, dockExports.kitJson, dockExports.flashToast, dockExports.writeClipboard, dockExports.setKitUi, dockExports.getKitUi, dockExports.useKitUi, dockExports.sidebarViewPatch, dockExports.expandSidebarNow, dockExports.TreeRowMenu, dockExports.TreeFolderIcon, dockExports.FileTypeIcon16, dockExports.ChevronIcon, dockExports.openTreeFile, dockExports.currentComposerShell, dockExports.chatMentionText, dockExports.useCurrentRow, dockExports.useCurrentCwd].every(
    (fn) => typeof fn === "function",
  ),
);
check(
  "dock 跨组件服务座（sidebarView 渲染器座 / inlineEdit 让路座 / diffPane 正文座）形状",
  dockExports.sidebarView && typeof dockExports.sidebarView === "object" && dockExports.sidebarView.renderer === null && dockExports.inlineEdit && dockExports.inlineEdit.active === false && dockExports.diffPane && typeof dockExports.diffPane === "object" && typeof dockExports.diffPane.Component === "function",
);

// 组件模块随根 bundle 一次加载组装
const comps = dockExports.files;

check("files 导出 apply（client 插件形状）与 DiffPane（root 右栏「差异」签正文）", typeof comps.apply === "function" && typeof comps.DiffPane === "function");
check("files inject 声明 slots", Array.isArray(comps.inject) && comps.inject[0] === "slots");
// 跨包单向引用只能走座对象：kitBase → module.exports 是工厂尾部的一次性浅拷贝，
// 组件后加的键 root 读不到（正是 diffPane 白屏的成因）
check("files 物化期把 DiffPane 挂上 root 的 diffPane 座", dockExports.diffPane.Component === comps.DiffPane);

// —— 直测：TreeNode（文件 + 目录 + 常驻操作钮）——
let out;
callLog = [];
out = comps.TreeNode({ entry: { name: "b.js", path: "C:/x/b.js", dir: false }, depth: 0, expanded: {}, onToggle: () => {}, onOpenFile: (p) => {} });
check("TreeNode 文件渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.TreeNode({ entry: { name: "src", path: "C:/x/src", dir: true }, depth: 0, expanded: {}, onToggle: () => {}, onOpenFile: () => {} });
check("TreeNode 目录渲染无异常", !!out && typeof out === "object");
{
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
}

// TreeRowMenu 直测在根检查（留底座被文件树/知识库两边共用）

// —— 直测：FileTreePanel（cwd 有/无）——
callLog = [];
out = comps.FileTreePanel({ cwd: null, onOpenFile: () => {} });
check("FileTreePanel noCwd 渲染无异常", !!out && typeof out === "object");
callLog = [];
out = comps.FileTreePanel({ cwd: "C:/x", onOpenFile: () => {} });
check("FileTreePanel noCwd(根未加载) 渲染无异常(loading→error兜底)", !!out && typeof out === "object");

// —— 直测：DiffPane（加载中/删除/提交钉定三态/常规/未跟踪/标题）——
const commitDiffText = "diff --git a/f.js b/f.js\nindex 111..222 100644\n--- a/f.js\n+++ b/f.js\n@@ -1 +1 @@\n-old\n+new\n";
const readyBody = { phase: "ready", body: { path: "C:/x/f.js", size: 2, mtimeMs: 1, truncated: false, binary: false, content: "new\n" } };
callLog = [];
out = comps.DiffPane({ path: "C:/x/b.js", cwd: "C:/x" });
check("DiffPane 渲染无异常", !!out && typeof out === "object");
{
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
}
{
  stateStore.set(0, readyBody);
  stateStore.set(1, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText, content: "new\n" });
  callLog = [];
  comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "full40hash" });
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
  comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "full40hash" });
  const delRed = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-del").map((c) => c[2].children);
  const delMeta = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].children === "string" && (c[2].children.startsWith("diff --git") || c[2].children.startsWith("@@")));
  check("提交钉定删除文件走纯红块（无元数据噪音）", delRed.includes("old") && !delRed.includes("new") && !delMeta);
  stateStore.clear();
  stateSeq = 0;
  stateStore.set(0, readyBody);
  stateStore.set(1, { phase: "ready", clean: false, base: "abcd123", text: commitDiffText });
  callLog = [];
  comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "full40hash" });
  const rawFallback = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diff");
  check("钉定无新像回落原始 patch", !!rawFallback);
  stateStore.clear();
  stateSeq = 0;
  stateStore.set(0, readyBody);
  stateStore.set(1, { phase: "ready", clean: false, base: "", text: commitDiffText });
  callLog = [];
  comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x", commit: "root40hash" });
  const rootNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-diffnote" && typeof c[2].children === "string" && (c[2].children.includes("empty tree") || c[2].children.includes("空树")));
  check("根提交钉定显示空树基线说明", !!rootNote);
  // 常规 diff：hunk 套回盘上内容（全文件着色）
  stateStore.clear();
  stateSeq = 0;
  stateStore.set(0, readyBody);
  stateStore.set(1, { phase: "ready", clean: false, text: commitDiffText });
  callLog = [];
  comps.DiffPane({ path: "C:/x/f.js", cwd: "C:/x" });
  const normalOverlay = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-inline");
  check("常规 diff 视图仍套盘上内容（无 commit 钉定）", !!normalOverlay);
  // 未跟踪：整文件按新增着色（内容来自 read）
  stateStore.clear();
  stateSeq = 0;
  stateStore.set(0, { phase: "ready", body: { path: "C:/x/n.js", size: 3, mtimeMs: 1, truncated: false, binary: false, content: "a\nb" } });
  stateStore.set(1, { phase: "ready", untracked: true, clean: false, text: null });
  callLog = [];
  comps.DiffPane({ path: "C:/x/n.js", cwd: "C:/x", untracked: true });
  const addRows = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-il-add").map((c) => c[2].children);
  check("未跟踪整文件按新增着色", addRows.join("|") === "a|b");
  stateStore.clear();
  stateSeq = 0;
  // 头部标题：绝对路径直显、不挂 title 悬停（文件名由页签 chip 承担）
  callLog = [];
  comps.DiffPane({ path: "C:/x/dir/f.js", cwd: "C:/x" });
  const titleAbs = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-title" && c[2].children === "C:/x/dir/f.js");
  check("diff 头部标题显示绝对路径", !!titleAbs);
  check("diff 头部不挂 title 悬停（全路径已直显，悬停只留页签 chip）", !!(titleAbs && titleAbs[2] && titleAbs[2].title === undefined));
}

// —— 直测：入口按钮（门控默认开 = 配置快照未就绪按内置默认）——
callLog = [];
out = comps.FileTreeEntry({});
check("FileTreeEntry 渲染无异常", !!out && typeof out === "object");
check("FileTreeEntry 悬停走官方气泡（KitTip 包住锚点，命令 id 对上快捷键注册）", out.type === dockExports.KitTip && out.props.command === "dsh-kit-files.tree.toggle" && typeof out.props.label === "string");
callLog = [];
out = comps.ScmEntry({});
check("ScmEntry 渲染无异常", !!out && typeof out === "object");
check("ScmEntry 悬停走官方气泡（同一条 KitTip 链路）", out.type === dockExports.KitTip && out.props.command === "dsh-kit-files.scm.toggle" && typeof out.props.label === "string");
{
  // 侧栏单槽互斥：源代码管理开着时点入口，知识库索引位让出（kitBase 补丁语义）
  const sidebarResetPatch = { treeOpen: false, gitOpen: false, vaultIdxOpen: false, files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null };
  const svp = dockExports.sidebarViewPatch("vault");
  check("sidebarViewPatch 单槽互斥：只亮指定位", svp.vaultIdxOpen === true && svp.treeOpen === false && svp.gitOpen === false);
  dockExports.setKitUi({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", gitOpen: false, treeOpen: false });
  callLog = [];
  comps.ScmEntry({ useSessions: () => ({ id: "s1", cwd: "C:/x" }) });
  const scmBtnEl = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-enbtn"));
  scmBtnEl[2].onClick();
  check("ScmEntry 点击后侧栏单槽互斥（知识库索引位让出，两个钮不会同时亮）", dockExports.getKitUi().gitOpen === true && dockExports.getKitUi().vaultIdxOpen === false && dockExports.getKitUi().vaultOpen === true);
  dockExports.setKitUi(sidebarResetPatch);
}

// —— 直测：更改视图 / 提交图谱 / 分支浮层 ——
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

// —— 源码哨兵：SCM 面板分支按钮会被 .dshk-btn 的 26px 方钮定宽压扁（svg/分支名
// 0 宽只剩 ▾）——分支按钮必须显式 width:auto 反制（样式随组件在本包 FILES_CSS）
{
  const filesSrc = fs.readFileSync(__dirname + "/../client/bundle.js", "utf8");
  check("分支按钮不被 .dshk-btn 定宽压扁（width:auto 修正恒在）", filesSrc.includes(".dshk-branchbtn{display:inline-flex;flex:none;width:auto"));
  // 键位整体改由宿主 shortcuts 服务持有（官方「快捷键」页）：本组件
  // 不再有键位配置项（宿主 schema 同删），注册面见下方 apply 钉子
  const hostSrc = fs.readFileSync(__dirname + "/../src/files/index.ts", "utf8");
  check(
    "键位配置项全退役（client 与宿主 schema 都不再有键位字段与录制控件）",
    !filesSrc.includes("fileTreeShortcut") && !filesSrc.includes("scShortcut") && !filesSrc.includes("kcfgGroupShortcuts") &&
      !filesSrc.includes('type: "combo"') && !hostSrc.includes("fileTreeShortcut") && !hostSrc.includes("scShortcut"),
  );
  // 两处入口钮的悬停改由 KitTip 出官方气泡，不再自带原生 title
  check("入口钮的悬停不再自带原生 title（全走官方气泡）", !/dshk-enbtn"[\s\S]{0,120}?\n\s*title:/.test(filesSrc));
  // 行内动作小钮同理：RowActionBtn / SCM 行钮都包 KitTip，行尾一排用 align:end 免得盖住相邻行
  check(
    "行内动作钮提示走官方气泡（源码哨兵：RowActionBtn 包 KitTip + align:end）",
    /function RowActionBtn\(\{ title, onClick, children \}\) \{\s*return jsxRuntime\.jsx\(KitTip, \{\s*label: title,\s*align: "end",/.test(filesSrc) &&
      !/jsxRuntime\.jsx\("button", \{ type: "button", title: t\("sc(Stage|Unstage|Discard)"\)/.test(filesSrc),
  );
}

// —— 官方「工作区文件」入口掩码：规则与字段都住本组件（root 只留浏览器入口的同类规则）——
{
  const bundleSrc = fs.readFileSync(__dirname + "/../client/bundle.js", "utf8");
  const uiCssStart = bundleSrc.indexOf("const UI_CSS = `");
  const uiCss = bundleSrc.slice(uiCssStart, bundleSrc.indexOf("`;", uiCssStart));
  const hostSrc = fs.readFileSync(__dirname + "/../src/files/index.ts", "utf8");
  check(
    "掩码 CSS 随字段搬进各组件（根 UI_CSS 两类掩码都不再持有）",
    !uiCss.includes("dshk-hide-official-") &&
      bundleSrc.includes('body.dshk-hide-official-files [data-sidebar-right-guide-entry="files"]{display:none}') &&
      bundleSrc.includes('body.dshk-hide-official-browser [data-sidebar-right-guide-entry="browser"]{display:none}'),
  );
  check(
    "掩码跟着配置快照活切（apply 订阅 + 标记类按快照 toggle）",
    bundleSrc.includes("subscribeCfg(syncOfficialFilesMask)") &&
      bundleSrc.includes('document.body.classList.toggle("dshk-hide-official-files"'),
  );
  // 组件内置默认与宿主 schema（src/files/index.ts）逐项同值：改必须两处同改，
  // 漂移即红（root 侧同款比对在 render-check.cjs）
  const drift = [];
  let compared = 0;
  for (const m of hostSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)[^,\n]*\.default\(([^)]*)\)\.volatile\(\),?$/gm)) {
    const key = m[1];
    const raw = m[2].trim();
    const expected =
      raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : /^'[^']*'$/.test(raw) ? raw.slice(1, -1) : undefined;
    if (expected === undefined) continue;
    compared++;
    if (!Object.prototype.hasOwnProperty.call(comps.F_CFG_DEFAULTS, key) || comps.F_CFG_DEFAULTS[key] !== expected) drift.push(key);
  }
  check(
    "组件内置默认与宿主 schema 逐项同值（比对 " + compared + " 项；漂移 " + (drift.join("/") || "无") + "）",
    drift.length === 0 && compared === Object.keys(comps.F_CFG_DEFAULTS).length,
  );
}

// —— apply 激活契约 + 官方快捷键注册 + sidebarView 渲染器座桥 ——
async function checkApply() {
  const registered = [];
  const shortcutCmds = [];
  const seatInjects = [];
  // 宿主 shortcuts 目录（键帽来源）：随服务一起给注册回调
  const scRows = [{ id: "dsh-kit-files.tree.toggle", keys: ["Ctrl", "+", "Alt", "+", ","], aria: "Control+Alt+," }];
  const scCatalogStore = { getSnapshot: () => scRows, subscribe: () => () => {} };
  const ctxStub = {
    inject: (deps, cb) => {
      if (deps.includes("shortcuts")) {
        cb({
          shortcuts: { register: (cmd) => { shortcutCmds.push(cmd); return () => {}; }, catalog: scCatalogStore },
          effect: (fn) => { fn(); },
        });
      }
    },
    slots: {
      register: (seat, comp) => registered.push(seat),
      inject: (key, cb) => { seatInjects.push(key); cb(); },
    },
    effect: (fn) => {},
  };
  const prevDoc = global.document;
  global.document = { ...prevDoc, addEventListener: () => {} };
  let applyErr = null;
  try { await comps.apply(ctxStub); } catch (e) { applyErr = e; }
  global.document = prevDoc;
  check("files apply 激活不抛错", applyErr === null);
  check("files apply 三个槽位与配置页都经 slots.inject 等声明", seatInjects.filter((k) => k === "conversation.input.left").length === 2 && seatInjects.filter((k) => k === "plugins.row.config").length === 1);
  const seat = (id) => registered.find((s) => s.id === id);
  check("files 槽位座席：文件树入口 order 10", seat("dsh-kit-filetree") && seat("dsh-kit-filetree").order === 10);
  check("files 槽位座席：源代码管理入口 order 11", seat("dsh-kit-scm") && seat("dsh-kit-scm").order === 11);
  const cfgKeys = registered.filter((s) => s.name === "plugins.row.config").map((s) => s.key);
  check("files 配置页挂本组件行（单包单口径 key）", cfgKeys.includes("dsh-kit#files") && cfgKeys.length === 1);
  // 官方「工作区文件」入口掩码随本组件配置走（字段从根包 Config 迁来）：apply 期按
  // 快照切 body 标记类，内置默认 false → 不挂
  check(
    "apply 期同步官方入口掩码（内置默认 false = 不挂标记类）",
    bodyClassLog.some(([cls, on]) => cls === "dshk-hide-official-files" && on === false),
  );
  check(
    "掩码字段归本组件配置页（根配置页与默认表已交出）",
    (() => {
      const bundleSrc = fs.readFileSync(__dirname + "/../client/bundle.js", "utf8");
      const fieldsStart = bundleSrc.indexOf("const KIT_CFG_FIELDS = [");
      const rootFields = bundleSrc.slice(fieldsStart, bundleSrc.indexOf("const KIT_CFG_GROUPS", fieldsStart));
      const defaultsStart = bundleSrc.indexOf("const CFG_DEFAULTS = {");
      const rootDefaults = bundleSrc.slice(defaultsStart, bundleSrc.indexOf("};", defaultsStart));
      return (
        !rootFields.includes("hideOfficialFilesEntry") && !rootDefaults.includes("hideOfficialFilesEntry") &&
        comps.F_CFG_DEFAULTS.hideOfficialFilesEntry === false && typeof comps.FilesConfigPage === "function"
      );
    })(),
  );
  // 官方快捷键注册（不经自挂 keydown）：两条命令进官方「快捷键」页
  const sc = (id) => shortcutCmds.find((c) => c.id === id);
  const treeCmd = sc("dsh-kit-files.tree.toggle");
  const scmCmd = sc("dsh-kit-files.scm.toggle");
  check("files apply 向官方 shortcuts 注册文件树/源代码管理两条命令", !!treeCmd && !!scmCmd && typeof treeCmd.label === "function" && typeof scmCmd.label() === "string");
  check(
    "默认键：文件树 Ctrl+Alt+,、源代码管理 Ctrl+Alt+.（primary+alt 口径）",
    treeCmd.defaults["web:windows"].code === "Comma" && String(treeCmd.defaults["web:windows"].modifiers) === "primary,alt" && scmCmd.defaults["web:windows"].code === "Period" && !!scmCmd.defaults["desktop:linux"] && ["page", "editable", "terminal"].every((r) => treeCmd.regions.includes(r)),
  );
  // resolve 门控：组件配置在测试里未就绪 → 走内置默认（两个功能都开）→ handled
  const before = JSON.stringify({ tree: dockExports.getKitUi().treeOpen, git: dockExports.getKitUi().gitOpen });
  const resolved = treeCmd.resolve({ region: "page", modal: null });
  if (resolved.status === "handled") resolved.run();
  check("resolve 在功能开时 handled 且 run 切侧栏单槽", resolved.status === "handled" && dockExports.getKitUi().treeOpen === true && before !== JSON.stringify({ tree: dockExports.getKitUi().treeOpen, git: dockExports.getKitUi().gitOpen }));
  dockExports.setKitUi({ treeOpen: false });
  // 官方右栏不在场（全局面板在前台 / 没选会话）：索引视图与右栏同生灭，命令 blocked
  dockExports.rightbarSeat.set(false);
  const gatedTree = treeCmd.resolve({ region: "page", modal: null });
  const gatedScm = scmCmd.resolve({ region: "page", modal: null });
  check(
    "右栏不在场：文件树/源代码管理命令 blocked 带说明且不切侧栏",
    gatedTree.status === "blocked" && ["当前不在对话中", "Not in a conversation"].includes(gatedTree.reason) && gatedScm.status === "blocked" && dockExports.getKitUi().treeOpen === false && dockExports.getKitUi().gitOpen === false,
  );
  dockExports.rightbarSeat.set(true);
  // 渲染器座：apply 后 root 单槽分发到 files 的 tree/git 分支
  const renderer = dockExports.sidebarView.renderer;
  check("files apply 接管 sidebarView 渲染器座", typeof renderer === "function");
  callLog = [];
  const gitOut = renderer({ ui: { gitOpen: true, treeOpen: false }, cwd: "C:/x", owner: { wide: true } });
  const gitCall = callLog.find((c) => (c[0] === "jsx" || c[0] === "jsxs") && c[1] === comps.GitChangesPanel);
  check("渲染器座 gitOpen 分支出 GitChangesPanel（cwd 透传）", !!gitOut && !!gitCall && gitCall[2].cwd === "C:/x");
  callLog = [];
  const treeOut = renderer({ ui: { gitOpen: false, treeOpen: true }, cwd: "C:/y", owner: { wide: true } });
  const treeCall = callLog.find((c) => (c[0] === "jsx" || c[0] === "jsxs") && c[1] === comps.FileTreePanel);
  check("渲染器座 treeOpen 分支出 FileTreePanel", !!treeOut && !!treeCall && treeCall[2].cwd === "C:/y");
  check("渲染器座全关返回 null（让位知识库索引分支）", renderer({ ui: { gitOpen: false, treeOpen: false }, cwd: null, owner: {} }) === null);
  check("渲染器座收起态（wide=false）返回 null", renderer({ ui: { treeOpen: true }, cwd: null, owner: { wide: false } }) === null);
  // 键帽座跨包共享：files 注册期把宿主 shortcuts 目录挂上 kitBase 的共享座，
  // root 的 KitTip 因此读得到本组件命令当前生效的键（不是把默认键写死在按钮上）
  const tipEl = dockExports.KitTip({ label: "文件树", command: "dsh-kit-files.tree.toggle", children: jsxRuntimeStub.jsx("button", { type: "button" }) });
  check("键帽座跨包共享：root 的 KitTip 读得到 files 命令的键位", tipEl.type === primStub.Tooltip && tipEl.props.shortcutKeys.join("") === "Ctrl+Alt+," && tipEl.props.children.props["aria-keyshortcuts"] === "Control+Alt+,");
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (files)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
