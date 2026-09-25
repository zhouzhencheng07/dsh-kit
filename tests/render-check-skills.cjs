// dsh-kit/skills 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、技能管理页渲染、配置探针门控与宿主半边源哨兵。
// 组件 = 单包内模块（root client 的 exports.skills），无独立 bundle。
// 用法（dsh-kit 根）：node tests\render-check-skills.cjs
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

// react hooks 桩
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

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.skills
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.skills;

check("skills 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "skills 导出面齐全（管理页/端点调用/探针取值）",
  [comps.SkillsManager, comps.fetchSkillsPage, comps.cfgFromSnapshot].every((fn) => typeof fn === "function"),
);

// —— 技能管理页渲染：无 cwd 与有 cwd；头部刷新走官方气泡 ——
{
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  let out = comps.SkillsManager({});
  check("SkillsManager 无hooks渲染无异常（无会话工作区提示）", !!out && typeof out === "object");
  const refreshTip = callLog.find((c) => c[0] === "jsx" && c[1] === dockExports.KitTip);
  check("头部刷新钮走官方气泡（刷新/Refresh）", !!refreshTip && ["刷新", "Refresh"].includes(refreshTip[2].label));
  const title = callLog.find((c) => c[0] === "jsx" && c[2] && c[2].className === "dshk-sk-title");
  check("页标题用本组件词条（技能/Skills）", !!title && ["技能", "Skills"].includes(title[2].children));

  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const fakeHooks = { useSessions: (sel) => sel({ byId: { s1: { id: "s1", cwd: "C:/x", retainedBy: { mainView: 1 } } } }) };
  out = comps.SkillsManager(fakeHooks);
  check("SkillsManager 带cwd渲染无异常", !!out && typeof out === "object");
}

// —— 探针取值：未探明乐观可用；404 不可用；200 可用 ——
check(
  "cfgFromSnapshot：未探明乐观可用、404 不可用、就绪可用",
  comps.cfgFromSnapshot(null).available === true && comps.cfgFromSnapshot({ status: "unavailable" }).available === false && comps.cfgFromSnapshot({ status: "ready" }).available === true,
);

// —— 端点调用：cwd 查询串 ——
async function checkEndpoint() {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ groups: [] }) };
  };
  await comps.fetchSkillsPage("C:/x", undefined);
  await comps.fetchSkillsPage("", undefined);
  check("fetchSkillsPage 命中组件宿主端点并带 cwd", urls[0] === "/dsh-kit/skills?cwd=C%3A%2Fx" && urls[1] === "/dsh-kit/skills");
}

// —— apply：行可达性探针 + settings.section 注册（无 plugins.row.config）——
async function checkApply() {
  const makeCtx = () => {
    const seats = [];
    const seatInjects = [];
    return {
      seats,
      seatInjects,
      ctx: {
        slots: {
          register: (seat) => {
            seats.push(seat);
            return () => { const i = seats.indexOf(seat); if (i >= 0) seats.splice(i, 1); };
          },
          inject: (key, cb) => { seatInjects.push(key); cb(); },
        },
        inject: () => {},
        effect: () => {},
      },
    };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  let scripted = {};
  let failFetch = false;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (failFetch) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => scripted };
  };

  // 行启用：探针 200 → 设置页注册；座席经 slots.inject 等声明
  const a = makeCtx();
  let applyErr = null;
  try { await comps.apply(a.ctx); await tick(); } catch (e) { applyErr = e; }
  check("skills apply 激活不抛错", applyErr === null);
  check("apply 拉自家探针端点喂门控", calls.includes("/dsh-kit-skills/config"));
  const seat = a.seats.find((s) => s.name === "settings.section" && s.id === "kit-skills");
  check(
    "行启用：settings.section 注册（order 40、标签技能/Skills），无插件配置页",
    !!seat && seat.order === 40 && typeof seat.label === "function" && ["技能", "Skills"].includes(seat.label()) && a.seats.every((s) => s.name !== "plugins.row.config"),
  );
  check("槽位经 slots.inject 等声明落地（不直接 register）", a.seatInjects.filter((k) => k === "settings.section").length === 1);

  // 行禁用：探针 404 → 乐观注册后被注销，导航里不留死页
  const fresh = loadBundle(__dirname + "/../client/bundle.js", requireMap).skills;
  const b = makeCtx();
  failFetch = true;
  await fresh.apply(b.ctx);
  await tick();
  check("行禁用（探针 404）：设置页最终不注册（乐观注册被撤回）", b.seats.every((s) => s.name !== "settings.section"));
}

// —— 宿主半边源哨兵：行开关 = 唯一开关（无独立配置字段），探针在组件入口 ——
{
  const bundleSrc = fs.readFileSync(__dirname + "/../client/bundle.js", "utf8");
  const hostSrc = fs.readFileSync(__dirname + "/../src/index.ts", "utf8");
  const compSrc = fs.readFileSync(__dirname + "/../src/skills/index.ts", "utf8");
  check("技能无独立配置字段（主包 schema/配置页/client 默认表都不再出现 skillsPageEnabled）", !hostSrc.includes("skillsPageEnabled") && !bundleSrc.includes("skillsPageEnabled"));
  check("组件入口挂技能池端点与行可达性探针", compSrc.includes("applySkillPool") && compSrc.includes("/dsh-kit-skills/config"));
  check("技能页样式随组件自带（.dshk-sk 只在组件 CSS 块出现一次）", bundleSrc.includes("SKS_CSS") && bundleSrc.split(".dshk-sk{").length - 1 === 1);
}

checkEndpoint().then(checkApply).then(() => {
  console.log(failed === 0 ? "\nALL PASS (render-check skills)" : "FAILED: " + failed);
  process.exit(failed === 0 ? 0 : 1);
});
