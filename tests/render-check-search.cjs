// dsh-kit/search 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、本组件行配置页渲染、apply 装配与宿主半边源哨兵。
// 组件 = 单包内模块（root client 的 exports.search），无独立 bundle。
// 用法（dsh-kit 根）：node tests\render-check-search.cjs
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
    body: { classList: { add() {}, remove() {} }, appendChild: () => {}, hasAttribute: () => false },
  };
}
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false };
if (!global.location) global.location = { protocol: "http:", host: "127.0.0.1:3081" };
if (!global.MutationObserver) global.MutationObserver = class { observe() {} };
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

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.search
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.search;

check("search 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check("search 导出面齐全（配置页 + 字段表）", typeof comps.SearchConfigPage === "function" && Array.isArray(comps.SEARCH_CFG_FIELDS));

// 2) 配置页：单组（不出页签）、唯一字段是搜索结果条数（数值，值取宿主表单）
{
  const fakeForm = { state: { status: "ready", value: { searchMaxResults: 4 }, revision: 5, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const out = comps.SearchConfigPage({ view: "page", form: fakeForm });
  check("SearchConfigPage 渲染无异常且单组不出页签", !!out && typeof out === "object" && !callLog.some((c) => c[1] === primStub.SegmentedTabs));
  const field = callLog.find((c) => c[1] === primStub.SettingsValueField);
  check(
    "唯一字段：搜索结果条数（数值、回显受理值 4、带说明）",
    !!field &&
      field[2].id === "dshk-cfgp-searchMaxResults" &&
      field[2].numeric === true &&
      field[2].text === "4" &&
      field[2].overridden === false &&
      ["搜索结果条数（1–8）", "Search results (1–8)"].includes(field[2].label) &&
      typeof field[2].hint === "string" &&
      field[2].hint.length > 0,
  );
  check("summary 视图返回 null（行详情收起态）", comps.SearchConfigPage({ view: "summary", form: fakeForm }) === null);
}

// 3) apply：配置页挂本组件行（两种包名口径），不注册别的槽
async function checkApply() {
  const registered = [];
  const seatInjects = [];
  const ctx = { slots: { register: (seat) => registered.push(seat), inject: (k, cb) => { seatInjects.push(k); cb(); } } };
  let err = null;
  try { await comps.apply(ctx); } catch (e) { err = e; }
  check("search apply 激活不抛错", err === null);
  const keys = registered.filter((s) => s.name === "plugins.row.config").map((s) => s.key);
  check("配置页挂本组件行（两种包名口径的 key 都在）", keys.includes("dsh-kit#search") && keys.includes("dsh-kit-search#search"));
  check("槽位经 slots.inject 等声明落地（不直接 register），只挂配置页", seatInjects.length === 2 && seatInjects.every((k) => k === "plugins.row.config") && registered.length === 2);
}

// 4) 源哨兵：宿主半边搬进组件目录、主包与 client 摘干净、patch 不再静态钉 provider
{
  const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");
  const bundleSrc = read("client/bundle.js");
  const hostSrc = read("src/index.ts");
  const compSrc = read("src/search/index.ts");
  const seamSrc = read("src/search/web-search.ts");
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  // 根包那两份表没导出（根 render-check 靠 harness 补漏），按源码段核对
  const sliceBetween = (from, to) => {
    const i = bundleSrc.indexOf(from);
    const j = bundleSrc.indexOf(to, i);
    return i < 0 || j < 0 ? "" : bundleSrc.slice(i, j);
  };
  const rootCfg = sliceBetween("const CFG_DEFAULTS = {", "/** 从官方 scope 快照提取生效配置");
  const rootFields = sliceBetween("const KIT_CFG_FIELDS = [", "/** KIT_CFG_FIELDS 的分组顺序");
  check(
    "主包 schema / client 默认表 / 字段表 / 词条都不再有搜索字段",
    !hostSrc.includes("searchEnabled") && !hostSrc.includes("searchMaxResults") &&
      !/search(Enabled|MaxResults)/.test(rootCfg) && !/search(Enabled|MaxResults)/.test(rootFields) &&
      !bundleSrc.includes("kcfgSearchEnabled"),
  );
  check("patch 不再静态钉 web 行的 searchProvider（关行 = 不接管 seam）", !/^\s*searchProvider:/m.test(patchSrc) && !/^\s*- id: web\s*$/m.test(patchSrc));
  check("组件行声明 + exports 子路径 + locale 齐备", patchSrc.includes("name: dsh-kit/search") && !!pkg.exports["./search"] && !!pkg.exports["./search/locale/*.json"]);
  check(
    "seam 接管在组件入口装配，且带「字段不可写/别家钉住就不注册」的降级",
    compSrc.includes("applyWebSearch") && compSrc.includes("searchMaxResults") && compSrc.includes("name = 'dsh-kit/search'") &&
      seamSrc.includes("searchProviderId") && seamSrc.includes("WEB_PROVIDER_CONFIGURED_MISSING") && seamSrc.includes("function pinProvider"),
  );
  // 字段表与宿主 Config schema 同源（改必须两处同改，漂移即红）
  const schemaKeys = [...compSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)[^,\n]*\.default\(([^)]*)\)\.volatile\(\),?$/gm)].map((m) => m[1]);
  const fieldKeys = comps.SEARCH_CFG_FIELDS.map((f) => f.key);
  check(
    "配置页字段表与宿主 schema 同源（" + schemaKeys.length + " 项）",
    schemaKeys.length === fieldKeys.length && schemaKeys.every((k) => fieldKeys.includes(k)),
  );
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (search)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
