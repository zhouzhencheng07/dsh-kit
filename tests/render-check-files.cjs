// dsh-kit-files 浏览器半边渲染级检查：加载真实 dock bundle（root client）+ files
// bundle，直测文件树面板群（TreeNode/FileTreePanel/TreeRowMenu/FileTreeEntry）
// 与 apply 激活契约（形态条登记/配置页/侧栏分支渲染器座）。
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
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
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

// react hooks 桩（useState 带可预置的 stateStore，供面板渲染分支测试）
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
  "dock 跨组件服务座（sidebarView 渲染器座）形状",
  dockExports.sidebarView && typeof dockExports.sidebarView === "object" && dockExports.sidebarView.renderer === null,
);

// 组件模块随根 bundle 一次加载组装
const comps = dockExports.files;

check("files 导出 apply（client 插件形状）", typeof comps.apply === "function");
check("files inject 声明 slots", Array.isArray(comps.inject) && comps.inject[0] === "slots");

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

// —— 直测：形态切换条上的文件树那枚（门控默认开 = 配置快照未就绪按内置默认）——
callLog = [];
out = comps.FileTreeEntry({});
check("FileTreeEntry 渲染无异常", !!out && typeof out === "object");
check(
  "FileTreeEntry 是形态条那枚图标钮（.dshk-sfbtn；名字与键帽走官方气泡，命令 id 对上快捷键注册）",
  out.type === dockExports.KitTip && out.props.command === "dsh-kit-files.tree.toggle" && typeof out.props.label === "string" &&
    out.props.children.props.className === "dshk-sfbtn",
);
{
  // 侧栏单槽互斥：文件树开着时点入口，知识库·日程那一格让出（kitBase 补丁语义）
  const sidebarResetPatch = { treeOpen: false, vaultSideOpen: false, vaultSideTab: "vault", files: [], activeFile: null, vaultOpen: false, vaultPages: [], activeVaultPage: null };
  const svp = dockExports.sidebarViewPatch("vault");
  check("sidebarViewPatch 单槽互斥：只亮指定位", svp.vaultSideOpen === true && svp.vaultSideTab === "vault" && svp.treeOpen === false);
  dockExports.setKitUi({ vaultSideOpen: true, vaultSideTab: "vault", vaultOpen: true, vaultPages: ["D:/v/a.md"], activeVaultPage: "D:/v/a.md", treeOpen: false });
  callLog = [];
  comps.FileTreeEntry({ useSessions: () => ({ id: "s1", cwd: "C:/x" }) });
  const treeBtnEl = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-sfbtn"));
  treeBtnEl[2].onClick();
  check("FileTreeEntry 点击后侧栏单槽互斥（知识库·日程那一格让出，两个钮不会同时亮）", dockExports.getKitUi().treeOpen === true && dockExports.getKitUi().vaultSideOpen === false && dockExports.getKitUi().vaultOpen === true);
  dockExports.setKitUi(sidebarResetPatch);
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
  check(
    "composer 不再挂文件树入口（已改左栏形态条），配置页仍走 slots.inject 等声明",
    seatInjects.filter((k) => k === "conversation.input.left").length === 0 && seatInjects.filter((k) => k === "plugins.row.config").length === 1,
  );
  const form = (id) => dockExports.sideForms.find((e) => e && e.id === id);
  check(
    "形态条座席：文件树 order 20（组件指到本组件的入口）",
    !!form("dsh-kit-filetree") && form("dsh-kit-filetree").order === 20 && form("dsh-kit-filetree").Component === comps.FileTreeEntry,
  );
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
      // 根包的字段表/默认表已整体交出去（不是「切一段出来断言里面没有某字段」——
      // 锚点没了的话那样切出空串，断言恒真）
      return (
        bundleSrc.indexOf("const KIT_CFG_FIELDS = [") < 0 && bundleSrc.indexOf("const CFG_DEFAULTS = {") < 0 &&
        comps.F_CFG_DEFAULTS.hideOfficialFilesEntry === false && typeof comps.FilesConfigPage === "function"
      );
    })(),
  );
  // 官方快捷键注册（不经自挂 keydown）：文件树那条命令进官方「快捷键」页
  const sc = (id) => shortcutCmds.find((c) => c.id === id);
  const treeCmd = sc("dsh-kit-files.tree.toggle");
  check("files apply 向官方 shortcuts 注册文件树命令", !!treeCmd && typeof treeCmd.label === "function");
  check(
    // 文件树 web 档是 Mod+Shift+,：宿主「打开设置」在 web 占 Mod+Alt+,，register 跨档查重会直接抛
    "默认键：文件树 desktop Mod+Alt+, / web Mod+Shift+,",
    treeCmd.defaults["desktop:windows"].code === "Comma" && String(treeCmd.defaults["desktop:windows"].modifiers) === "primary,alt" &&
    treeCmd.defaults["web:windows"].code === "Comma" && String(treeCmd.defaults["web:windows"].modifiers) === "primary,shift" &&
    treeCmd.defaults["web:macos"].modifiers[0] === "primary" && treeCmd.defaults["web:macos"].modifiers[1] === "shift" &&
    !!treeCmd.defaults["desktop:linux"] && ["page", "editable", "terminal"].every((r) => treeCmd.regions.includes(r)),
  );
  check("源代码管理那条命令整体退场", shortcutCmds.every((c) => c.id !== "dsh-kit-files.scm.toggle"));
  // resolve 门控：组件配置在测试里未就绪 → 走内置默认（功能开）→ handled
  const before = JSON.stringify({ tree: dockExports.getKitUi().treeOpen });
  const resolved = treeCmd.resolve({ region: "page", modal: null });
  if (resolved.status === "handled") resolved.run();
  check("resolve 在功能开时 handled 且 run 切侧栏单槽", resolved.status === "handled" && dockExports.getKitUi().treeOpen === true && before !== JSON.stringify({ tree: dockExports.getKitUi().treeOpen }));
  dockExports.setKitUi({ treeOpen: false });
  // 官方右栏不在场（全局面板在前台 / 没选会话）：索引视图与右栏同生灭，命令 blocked
  dockExports.rightbarSeat.set(false);
  const gatedTree = treeCmd.resolve({ region: "page", modal: null });
  check(
    "右栏不在场：文件树命令 blocked 带说明且不切侧栏",
    gatedTree.status === "blocked" && ["当前不在对话中", "Not in a conversation"].includes(gatedTree.reason) && dockExports.getKitUi().treeOpen === false,
  );
  dockExports.rightbarSeat.set(true);
  // 渲染器座：apply 后 root 单槽分发到 files 的文件树分支
  const renderer = dockExports.sidebarView.renderer;
  check("files apply 接管 sidebarView 渲染器座", typeof renderer === "function");
  callLog = [];
  const treeOut = renderer({ ui: { treeOpen: true }, cwd: "C:/y", owner: { wide: true } });
  const treeCall = callLog.find((c) => (c[0] === "jsx" || c[0] === "jsxs") && c[1] === comps.FileTreePanel);
  check("渲染器座 treeOpen 分支出 FileTreePanel", !!treeOut && !!treeCall && treeCall[2].cwd === "C:/y");
  check("渲染器座全关返回 null（让位知识库索引分支）", renderer({ ui: { treeOpen: false }, cwd: null, owner: {} }) === null);
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
