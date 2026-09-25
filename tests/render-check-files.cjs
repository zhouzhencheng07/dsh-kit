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
    body: { classList: { add() {}, remove() {} }, appendChild: () => {} },
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
  dockExports.sidebarView && typeof dockExports.sidebarView === "object" && dockExports.sidebarView.renderer === null && dockExports.inlineEdit && dockExports.inlineEdit.active === false && dockExports.diffPane && typeof dockExports.diffPane === "object" && dockExports.diffPane.Component === null,
);

const comps = loadBundle(__dirname + "/../packages/dsh-kit-files/client/bundle.js", (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "dsh-kit") return dockExports;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected require: " + name);
});

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
callLog = [];
out = comps.ScmEntry({});
check("ScmEntry 渲染无异常", !!out && typeof out === "object");
{
  // 侧栏单槽互斥：源代码管理开着时点入口，知识库索引位让出（kitBase 补丁语义）
  const sidebarResetPatch = { treeOpen: false, gitOpen: false, vaultIdxOpen: false, files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null };
  const svp = dockExports.sidebarViewPatch("vault");
  check("sidebarViewPatch 单槽互斥：只亮指定位", svp.vaultIdxOpen === true && svp.treeOpen === false && svp.gitOpen === false);
  dockExports.setKitUi({ vaultIdxOpen: true, vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", gitOpen: false, treeOpen: false });
  callLog = [];
  comps.ScmEntry({});
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
  const filesSrc = fs.readFileSync(__dirname + "/../packages/dsh-kit-files/client/bundle.js", "utf8");
  check("分支按钮不被 .dshk-btn 定宽压扁（width:auto 修正恒在）", filesSrc.includes(".dshk-branchbtn{display:inline-flex;flex:none;width:auto"));
  // 键位整体改由宿主 shortcuts 服务持有（0.1.7-rc.2+ 官方「快捷键」页）：本组件
  // 不再有键位配置项（宿主 schema 同删），注册面见下方 apply 钉子
  const hostSrc = fs.readFileSync(__dirname + "/../packages/dsh-kit-files/src/index.ts", "utf8");
  check(
    "键位配置项全退役（client 与宿主 schema 都不再有键位字段与录制控件）",
    !filesSrc.includes("fileTreeShortcut") && !filesSrc.includes("scShortcut") && !filesSrc.includes("kcfgGroupShortcuts") &&
      !filesSrc.includes('type: "combo"') && !hostSrc.includes("fileTreeShortcut") && !hostSrc.includes("scShortcut"),
  );
}

// —— apply 激活契约 + 官方快捷键注册 + sidebarView 渲染器座桥 ——
async function checkApply() {
  const registered = [];
  const shortcutCmds = [];
  const seatInjects = [];
  const ctxStub = {
    inject: (deps, cb) => {
      if (deps.includes("shortcuts")) {
        cb({
          shortcuts: { register: (cmd) => { shortcutCmds.push(cmd); return () => {}; } },
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
  check("files apply 三个槽位与配置页都经 slots.inject 等声明", seatInjects.filter((k) => k === "conversation.input.left").length === 2 && seatInjects.filter((k) => k === "plugins.row.config").length === 2);
  const seat = (id) => registered.find((s) => s.id === id);
  check("files 槽位座席：文件树入口 order 10", seat("dsh-kit-filetree") && seat("dsh-kit-filetree").order === 10);
  check("files 槽位座席：源代码管理入口 order 11", seat("dsh-kit-scm") && seat("dsh-kit-scm").order === 11);
  const cfgKeys = registered.filter((s) => s.name === "plugins.row.config").map((s) => s.key);
  check("files 配置页挂本组件行（两种包名口径的 key 都在）", cfgKeys.includes("dsh-kit#files") && cfgKeys.includes("dsh-kit-files#files"));
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
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (files)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
