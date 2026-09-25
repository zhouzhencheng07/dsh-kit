// dsh-kit/browser 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、配置页、面板渲染、apply 装配门控（行关闭 = 探针 404 = 不注册）
// 与宿主半边源哨兵。组件 = 单包内模块（root client 的 exports.browser），无独立 bundle。
// 用法（dsh-kit 根）：node tests\render-check-browser.cjs
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
    body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild: () => {}, hasAttribute: () => false },
  };
}
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false };
if (!global.location) global.location = { protocol: "http:", host: "127.0.0.1:3081" };
if (!global.MutationObserver) global.MutationObserver = class { observe() {} };
if (!global.Element) global.Element = class Element {};
if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} disconnect() {} };

const loadBundle = (path, requireMap) => {
  const src = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("factory: (require) => {");
  if (start < 0) throw new Error("no factory: " + path);
  const tail = src.lastIndexOf("  },\n});");
  const body = src.slice(start + "factory: (require) => {".length, tail);
  return new Function("require", body)(requireMap);
};

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
  Tooltip: jsxPrim("dsw-tooltip"),
};
const requireMap = (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return { createPortal: (children) => ({ type: "portal", props: { children }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
};

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.browser
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.browser;

check("browser 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "browser 导出面齐全（面板/壳层/配置页/字段表/入口掩码）",
  typeof comps.BrowserPanel === "function" && typeof comps.BrowserPaneBody === "function" &&
    typeof comps.BrowserShell === "function" && typeof comps.BrowserIcon === "function" &&
    typeof comps.BrowserConfigPage === "function" && Array.isArray(comps.BROWSER_CFG_FIELDS) &&
    typeof comps.maybeAutoOpenBrowser === "function" && typeof comps.closeBrowserDockForGone === "function" &&
    typeof comps.onChatLinkClick === "function" && typeof comps.bCfgFromSnapshot === "function",
);

// 2) 配置页：单组（不出页签）、两个 bool 字段（链接改投 + 官方入口掩码）
{
  const fakeForm = { state: { status: "ready", value: { chatOpenLinkInBrowser: false, hideOfficialBrowserEntry: true }, revision: 5, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const out = comps.BrowserConfigPage({ view: "page", form: fakeForm });
  check("BrowserConfigPage 渲染无异常且单组不出页签", !!out && typeof out === "object" && !callLog.some((c) => c[1] === primStub.SegmentedTabs));
  const switches = callLog.filter((c) => c[1] === primStub.Switch);
  check(
    "两枚开关：对话链接改投（回显 false）+ 隐藏官方入口（回显 true），文案齐备",
    switches.length === 2 &&
      switches[0][2].checked === false && switches[0][2].label === "Open chat links in the built-in browser" &&
      switches[1][2].checked === true && switches[1][2].label === "Hide the official Browser entry" &&
      switches.every((c) => c[2].disabled === false),
  );
  check("summary 视图返回 null（行详情收起态）", comps.BrowserConfigPage({ view: "summary", form: fakeForm }) === null);
  check(
    "快照未就绪回退内置默认（功能全开 + 不掩码）；就绪后按快照取值",
    comps.bCfgFromSnapshot(null).chatOpenLinkInBrowser === true && comps.bCfgFromSnapshot(null).hideOfficialBrowserEntry === false &&
      comps.bCfgFromSnapshot({ status: "ready", value: { chatOpenLinkInBrowser: false, hideOfficialBrowserEntry: true } }).chatOpenLinkInBrowser === false,
  );
}

// 3) 面板：未运行态 canvas + 共驾输入处理器；运行态页签 ✕ 直关 + 工具栏 5 枚
{
  callLog = [];
  const out = comps.BrowserPanel({});
  const canvasHost = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-brw-canvas"));
  check("BrowserPanel 未运行态渲染无异常", !!out && typeof out === "object");
  check("BrowserPanel 渲染出带共驾输入处理器的 canvas", !!canvasHost && !!canvasHost[2].onPointerDown && !!canvasHost[2].onKeyDown && !!canvasHost[2].onWheel);
  dockExports.setKitUi({ browserOpen: false });
  stateStore.clear();
  stateSeq = 0;
  stateStore.set(0, { running: true, launching: false, pages: [
    { tabId: 1, url: "http://a.example/", title: "A", active: false, viewed: false },
    { tabId: 2, url: "http://b.example/", title: "B", active: true, viewed: true },
  ], activeId: 2, viewId: 2 });
  callLog = [];
  comps.BrowserPanel({ active: true });
  const tabXs = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-x");
  check("BrowserPanel 运行态渲染出页签 ✕（2 个）", tabXs.length === 2);
  const fakeEvent = { stopPropagation() {} };
  let threw = null;
  try { tabXs[0][2].onClick(fakeEvent); tabXs[1][2].onClick(fakeEvent); } catch (e) { threw = e; }
  check("页签 ✕ 直关不弹确认", threw === null);
  const toolBtns = callLog.filter((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.split(" ").includes("dshk-brw-tool"));
  check("工具栏为官方同款图标钮（5 枚，含提交钮「前往」）", toolBtns.length === 5 && toolBtns.some((c) => c[2].type === "submit"));
  stateStore.clear();
  stateSeq = 0;
  stateStore.set(0, { running: true, launching: false, pages: [], activeId: null, viewId: null });
  callLog = [];
  comps.BrowserPanel({ active: true });
  const noPagesNote = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-brw-start");
  const canvasHidden = callLog.find((c) => (c[0] === "jsx") && c[2] && typeof c[2].className === "string" && c[2].className.includes("dshk-brw-canvas-off"));
  check("运行中 0 页：空态提示 + 画布隐去（不留定格帧）", !!noPagesNote && !!canvasHidden);
}

// 4) pane 正文 + 壳层事件源语义（模块函数直调，getKitUi 读回）
{
  stateStore.clear();
  stateSeq = 0;
  callLog = [];
  const out = comps.BrowserPaneBody({});
  const panelElem = callLog.find((c) => c[1] === comps.BrowserPanel && c[2] && c[2].active === true);
  check("BrowserPaneBody 挂 BrowserPanel（active 恒真：pane 显示即在看）", !!out && !!panelElem);
  check("BrowserShell 渲染无异常（空壳：事件源 + 入口掩码）", comps.BrowserShell({}) === null || typeof comps.BrowserShell({}) === "object");
  dockExports.setKitUi({ browserOpen: false, activeFeature: null });
  comps.maybeAutoOpenBrowser();
  check("maybeAutoOpenBrowser 切到浏览器标签（无抑制，agent 干活必回眼前）", dockExports.getKitUi().browserOpen === true && dockExports.getKitUi().activeFeature === "browser");
  comps.closeBrowserDockForGone();
  check("closeBrowserDockForGone 收掉面板标签（0 页无面板壳）", dockExports.getKitUi().browserOpen === false && dockExports.getKitUi().activeFeature === null);
  // 链接改投：判定链不命中一律放行官方；命中（对话滚动区内的 http(s) 链接）则吞掉
  // 官方新标签行为、切到浏览器签并 POST /dsh-kit/browser/open
  let prevented = 0;
  const missEv = { isTrusted: true, target: {}, preventDefault: () => { prevented++; }, stopPropagation: () => {} };
  comps.onChatLinkClick(missEv);
  check("onChatLinkClick 判定链不命中时放行官方（不 preventDefault）", prevented === 0);
  const linkTarget = new global.Element();
  linkTarget.closest = (sel) => (sel === "a[href]" ? linkTarget : null);
  linkTarget.getAttribute = () => "https://example.test/page";
  linkTarget.hasAttribute = () => false;
  const inScroll = {};
  linkTarget.closest = (sel) => (sel === '[class*="_scroll"]' ? inScroll : sel === "a[href]" ? linkTarget : null);
  const hits = [];
  global.fetch = async (url, opts) => { hits.push([String(url), opts && opts.method]); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  dockExports.setKitUi({ browserOpen: false, activeFeature: null });
  const hitEv = { isTrusted: true, target: linkTarget, preventDefault: () => { prevented++; }, stopPropagation: () => {} };
  comps.onChatLinkClick(hitEv);
  check("命中链接：吞掉官方新标签 + 切到浏览器签", prevented === 1 && dockExports.getKitUi().browserOpen === true && dockExports.getKitUi().activeFeature === "browser");
  check("命中链接：POST /dsh-kit/browser/open 带 URL 与会话", hits.some((h) => h[0] === "/dsh-kit/browser/open" && h[1] === "POST"));
}

// 5) apply 装配门控：行关闭（探针 404）= 一个槽都不注册；可用 = 壳层 + 右栏签 + 两个配置页 key
async function checkApply() {
  const run = async (available) => {
    global.fetch = async () => {
      if (!available) return { ok: false, status: 404, json: async () => ({ error: "HTTP 404" }) };
      return { ok: true, status: 200, json: async () => ({ chatOpenLinkInBrowser: true, hideOfficialBrowserEntry: false }) };
    };
    const registered = [];
    const slotInjects = [];
    const svcInjects = [];
    const ctx = {
      slots: { register: (seat) => registered.push(seat), inject: (k, cb) => { slotInjects.push(k); cb(); } },
      inject: (deps, cb) => {
        svcInjects.push(deps.join(","));
        if (deps.includes("sidebarRightTabs")) {
          cb({
            sidebarRightTabs: { register: (t) => registered.push(t) },
            effect: (fn) => { fn(); },
            slots: { inject: (k, inner) => { slotInjects.push(k); inner(); }, register: (seat) => registered.push(seat) },
          });
        }
      },
    };
    await comps.apply(ctx);
    return { registered, slotInjects, svcInjects };
  };
  const off = await run(false);
  check("行关闭（/dsh-kit-browser/config 404）：一个槽、一个服务注入都不发生", off.registered.length === 0 && off.slotInjects.length === 0 && off.svcInjects.length === 0);
  const on = await run(true);
  check("apply 激活不抛错且等 sidebarRightTabs 声明（inject 而非直读）", on.svcInjects.includes("sidebarRightTabs"));
  const keys = on.registered.filter((s) => s && s.name === "plugins.row.config").map((s) => s.key);
  check("配置页挂本组件行（两种包名口径的 key 都在）", keys.includes("dsh-kit#browser") && keys.includes("dsh-kit-browser#browser"));
  check("壳层常驻事件源挂 shell.overlay（id 稳定）", on.registered.some((s) => s && s.name === "shell.overlay" && s.id === "dsh-kit-browser"));
  check("右栏签注册：页类型 kind=dshk-browser + pane 正文槽位", on.registered.some((s) => s && s.kind === "dshk-browser" && s.id === "dsh-kit-browser") && on.slotInjects.includes("sidebar.right.pane.tab"));
  check("槽位经 slots.inject 等声明落地（不直接 register）", on.slotInjects.every((k) => typeof k === "string" && k.length > 0));
  check("dock 签 kind 补登（openFeatureDock/closeRightbarTab 按 feature 查 tabKinds）", dockExports.tabKinds.browser.kind === "dshk-browser");
}

// 6) 源哨兵：宿主半边搬进组件目录、主包与 client 摘干净、端点与配置齐备
{
  const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");
  const bundleSrc = read("client/bundle.js");
  const hostSrc = read("src/index.ts");
  const compSrc = read("src/browser/index.ts");
  const coreSrc = read("src/core/tools.ts");
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  const sliceBetween = (from, to) => {
    const i = bundleSrc.indexOf(from);
    const j = bundleSrc.indexOf(to, i);
    return i < 0 || j < 0 ? "" : bundleSrc.slice(i, j);
  };
  // 注释里提到字段名不算装配（迁移说明会写这些词），只看代码
  const hostCode = hostSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const rootCfg = sliceBetween("const CFG_DEFAULTS = {", "/** 从官方 scope 快照提取生效配置");
  const rootFields = sliceBetween("const KIT_CFG_FIELDS = [", "/** KIT_CFG_FIELDS 的分组顺序");
  const rootZh = bundleSrc.slice(bundleSrc.indexOf("const zh = {"), bundleSrc.indexOf("\n    };", bundleSrc.indexOf("const zh = {")));
  check(
    "主包 schema / client 默认表 / 字段表都不再有浏览器配置项",
    !hostCode.includes("browserEnabled") && !hostCode.includes("hideOfficialBrowserEntry") &&
      !/browser[A-Za-z]*:/.test(rootCfg) && !/browser[A-Za-z]*:/.test(rootFields) &&
      !/^ {6}kcfgBrowser[A-Za-z]*:/m.test(rootZh),
  );
  check(
    "主包不再装配浏览器（无 BrowserService/browser-tools/浏览器端点/ws）",
    !hostCode.includes("BrowserService") && !hostCode.includes("buildBrowserTools") &&
      !hostCode.includes("/dsh-kit/browser") && !hostCode.includes("WebSocketServer"),
  );
  check("dsh-tools 的 defineTool 契约与加载归 core/tools.ts（浏览器与知识库·日程组件共用）", coreSrc.includes("export async function loadToolsModule") && read("src/vault/schedule.ts").includes("from '../core/tools.ts'"));
  check(
    "组件入口自持服务/工具/端点/配置，且带 dsh-tools 不可达降级",
    compSrc.includes("name = 'dsh-kit/browser'") && compSrc.includes("new BrowserService(") &&
      compSrc.includes("buildBrowserTools(") && compSrc.includes("/dsh-kit-browser/config") &&
      compSrc.includes("/dsh-kit/browser/open") && compSrc.includes("chatOpenLinkInBrowser") &&
      compSrc.includes("hideOfficialBrowserEntry") && compSrc.includes("同源校验"),
  );
  check(
    "组件行声明 + exports 子路径 + locale 齐备",
    patchSrc.includes("name: dsh-kit/browser") && !!pkg.exports["./browser"] && !!pkg.exports["./browser/locale/*.json"] &&
      fs.existsSync(__dirname + "/../locale/browser/zh.json") && fs.existsSync(__dirname + "/../locale/browser/en.json"),
  );
  check(
    "浏览器 CSS 与官方入口掩码随组件搬走（根 UI_CSS 不再持有）",
    !sliceBetween("const UI_CSS = `", "`;").includes("dshk-brw-") && bundleSrc.includes("const BROWSER_CSS = `") &&
      bundleSrc.includes('style[data-plugin-css="dsh-kit-browser/ui"]') &&
      bundleSrc.includes('body.dshk-hide-official-browser [data-sidebar-right-guide-entry="browser"]{display:none}'),
  );
  check(
    "根半边仍保留 kitUi 的 browserOpen 座（跨槽功能签机制，非浏览器 UI）",
    bundleSrc.includes("else if (tab === \"schedule\") patch.schedOpen = false;") && bundleSrc.includes('return { browserOpen: true, activeFeature: "browser" };'),
  );
  check("根词典不再持浏览器词条（kcfgBrowser/浏览器面板文案随组件）", !/^ {6}(browser[A-Za-z]*|dockBrowser|rbGuideBrowserDesc|kcfgBrowser[A-Za-z]*):/m.test(rootZh));
  // 字段表与宿主 Config schema 同源（改必须两处同改，漂移即红）
  const schemaKeys = [...compSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)[^,\n]*\.default\(([^)]*)\)\.volatile\(\),?$/gm)].map((m) => m[1]);
  const fieldKeys = comps.BROWSER_CFG_FIELDS.map((f) => f.key);
  check(
    "配置页字段表与宿主 schema 同源（" + schemaKeys.length + " 项）",
    schemaKeys.length === 2 && schemaKeys.every((k) => fieldKeys.includes(k)),
  );
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (browser)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
