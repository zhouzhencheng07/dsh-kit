// dsh-kit-monitor 浏览器半边渲染级检查：加载真实 dock bundle + monitor bundle，
// 断言导出面与峰谷判定（U 系列，随 UsageLine 从根 render-check 迁入）。
// 用法（dsh-kit 根）：node tests\render-check-monitor.cjs
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
    documentElement: { lang: "zh" },
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ className: "", textContent: "", setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {} }),
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

// 1) dock（真实包）→ monitor 的共享面来源
const dockExports = loadBundle(__dirname + "/../packages/dsh-kit-dock/client/bundle.js", () => {
  throw new Error("dock bundle requires nothing");
});
check(
  "dock 底座导出面齐全（含 locale store）",
  [dockExports.kitGetJson, dockExports.kitJson, dockExports.flashToast, dockExports.resolveZh, dockExports.subscribeLocale, dockExports.getLocaleVersion, dockExports.apply].every(
    (fn) => typeof fn === "function",
  ),
);

// 2) monitor（真实包）：react 桩 + primitives 桩 + 真实 dock
const reactStub = {
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  useMemo: (fn) => fn(),
  useSyncExternalStore: (subscribe, getSnapshot) => { subscribe(() => {}); return getSnapshot(); },
};
const jsxRuntimeStub = {
  Fragment: function Fragment() {},
  jsx: (type, props) => ({ type, props, $$dshk: "jsx" }),
  jsxs: (type, props) => ({ type, props, $$dshk: "jsxs" }),
};
const reactDomStub = { createPortal: (children) => ({ type: "portal", props: { children }, $$dshk: "portal" }) };
const jsxPrim = (tag) => (props) => jsxRuntimeStub.jsxs(tag, props);
const primStub = { Tooltip: jsxPrim("dsw-tooltip"), useAnchoredPosition: () => null, useDismissOnOutsidePointer: () => {} };

const comps = loadBundle(__dirname + "/../packages/dsh-kit-monitor/client/bundle.js", (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return reactDomStub;
  if (name === "dsh-kit-dock") return dockExports;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected require: " + name);
});

check("monitor 导出 apply（client 插件形状）与 usageIsPeak", typeof comps.apply === "function" && typeof comps.usageIsPeak === "function");

// 2.5) apply 激活契约：槽位须经 slots.inject 等声明（composer.dock 由官方
//      conversation 挂载期声明，apply 时直接 register 会抛 not declared）
async function checkApply() {
  const injects = [];
  const registered = [];
  const ctxStub = {
    inject: (deps, cb) => injects.push(deps),
    slots: {
      register: (seat, comp) => registered.push(seat),
      inject: (key, cb) => { injects.push(["<slot:" + key + ">"]); cb(); },
    },
  };
  let applyErr = null;
  try { await comps.apply(ctxStub); } catch (e) { applyErr = e; }
  check("U apply 激活不抛错", applyErr === null);
  check("U apply 声明 modelDirectories 依赖", JSON.stringify(injects[0]) === JSON.stringify(["modelDirectories"]));
  check("U apply 经 slots.inject 等 composer.dock 声明", injects.some((d) => d[0] === "<slot:conversation.composer.dock>"));
  check("U 槽位座席 conversation.composer.dock/dsh-kit-usage/order 6", registered.length === 1 && registered[0].name === "conversation.composer.dock" && registered[0].id === "dsh-kit-usage" && registered[0].order === 6);
}

// 3) U 系列：用量芯片峰谷判定（usageIsPeak 直测）——工作日双峰、周末与调休
//    上班的周末全天免标、法定节假日（落在工作日的）全天免标；只有 deepseek 标峰；
//    表过期年份退化回工作日双峰。
function checkPeaks() {
  const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm);
  check("U 工作日上午峰", comps.usageIsPeak("deepseek", at(2026, 9, 23, 10, 0)) === true);
  check("U 工作日午休非峰", comps.usageIsPeak("deepseek", at(2026, 9, 23, 13, 0)) === false);
  check("U 工作日下午峰", comps.usageIsPeak("deepseek", at(2026, 9, 23, 15, 0)) === true);
  check("U 晚间非峰", comps.usageIsPeak("deepseek", at(2026, 9, 23, 20, 0)) === false);
  check("U 普通周末全天非峰", comps.usageIsPeak("deepseek", at(2026, 11, 21, 10, 0)) === false);
  check("U 调休上班的周末（10-10 周六）全天非峰", comps.usageIsPeak("deepseek", at(2026, 10, 10, 10, 0)) === false);
  check("U 法定节假日工作日（中秋 9-25 周五）全天非峰", comps.usageIsPeak("deepseek", at(2026, 9, 25, 10, 0)) === false);
  check("U 法定节假日工作日（国庆 10-6 周二）全天非峰", comps.usageIsPeak("deepseek", at(2026, 10, 6, 15, 0)) === false);
  check("U z.ai 不标峰（无公开口径，工作日峰点也不标）", comps.usageIsPeak("zai", at(2026, 9, 23, 15, 0)) === false);
  check("U 表外年份工作日照常标峰", comps.usageIsPeak("deepseek", at(2027, 1, 5, 10, 0)) === true);
  check("U opencode 无时段不标", comps.usageIsPeak("opencode", at(2026, 9, 23, 10, 0)) === false);
}

(async () => {
  await checkApply();
  checkPeaks();
  console.log(failed === 0 ? "ALL RENDER OK (monitor)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
