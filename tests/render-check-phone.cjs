// dsh-kit/phone 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、本组件行配置页、设置页「手机访问」渲染、apply 装配门控
// （行关闭 = 探针 404 = 一个槽都不注册）与宿主半边源哨兵（含远程视图置灰判据）。
// 组件 = 单包内模块（root client 的 exports.phone），无独立 bundle。
// 用法（dsh-kit 根）：node tests\render-check-phone.cjs
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
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} };
if (!global.location) global.location = { protocol: "http:", host: "127.0.0.1:3081" };

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
  if (name === "react-dom") return { createPortal: (children, container, key) => ({ type: "portal", props: { children, container, key }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
};

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.phone
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.phone;

check("phone 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "phone 导出面齐全（设置页 / 配置页 / 探针 / 二维码 / 导航图标）",
  typeof comps.PhoneSection === "function" && typeof comps.PhoneConfigPage === "function" &&
    Array.isArray(comps.PHONE_CFG_FIELDS) && typeof comps.loadCfg === "function" &&
    typeof comps.drawPhoneQr === "function" && typeof comps.fetchPhoneInfo === "function" &&
    typeof comps.fetchPhoneLinks === "function" && !!comps.PHONE_NAV_ICON,
);
check(
  "设置导航图标条目：手机访问 + data-dshk-phone 属性锚点",
  typeof comps.PHONE_NAV_ICON.label === "function" && comps.PHONE_NAV_ICON.attr === "data-dshk-phone" &&
    comps.PHONE_NAV_ICON.html.indexOf("<svg") === 0 && comps.PHONE_NAV_ICON.html.indexOf("</svg>") > 0,
);

// 2) 配置页：单组（不出页签）、三字段（端口数值 / 远程域名文本 / 网关常驻开关）
{
  const fakeForm = { state: { status: "ready", value: { phonePort: 3091, phoneRemoteDomain: "dsh.example.com", phoneKeepGatewayOn: true }, revision: 7, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const out = comps.PhoneConfigPage({ view: "page", form: fakeForm });
  check("PhoneConfigPage 渲染无异常且单组不出页签", !!out && typeof out === "object" && !callLog.some((c) => c[1] === primStub.SegmentedTabs));
  const sw = callLog.filter((c) => c[1] === primStub.Switch);
  const vf = callLog.filter((c) => c[1] === primStub.SettingsValueField);
  check("三字段 = 1 开关 + 2 值字段（没有与行开关同粒度的「页入口」开关）", sw.length === 1 && vf.length === 2 && comps.PHONE_CFG_FIELDS.length === 3);
  const port = vf.find((c) => c[2].id === "dshk-cfgp-phonePort");
  const domain = vf.find((c) => c[2].id === "dshk-cfgp-phoneRemoteDomain");
  check(
    "字段回显受理值：端口数值 + 远程域名文本",
    !!port && port[2].numeric === true && port[2].text === "3091" && port[2].invalid === false &&
      !!domain && domain[2].numeric !== true && domain[2].text === "dsh.example.com",
  );
  check("summary 视图返回 null（行详情收起态）", comps.PhoneConfigPage({ view: "summary", form: fakeForm }) === null);
  // 草稿 ops：number set / 清空文本 unset（按字段表序）；非法数字挡保存
  let capturedOps = null;
  let capturedRev = null;
  const savingForm = { state: fakeForm.state, mutate: async (ops, rev) => { capturedOps = ops; capturedRev = rev; return true; } };
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { phonePort: { text: "4" }, phoneRemoteDomain: { text: "" } });
  callLog = [];
  comps.PhoneConfigPage({ view: "page", form: savingForm });
  const saveFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
  check("有草稿时 dirty 置位", !!saveFrm && saveFrm[2].state.dirty === true);
  saveFrm[2].onSave();
  check(
    "保存 ops：number set / 清空 unset（按字段表序）",
    JSON.stringify(capturedOps) === JSON.stringify([{ op: "set", path: ["phonePort"], value: 4 }, { op: "unset", path: ["phoneRemoteDomain"] }]),
  );
  check("保存带读取时 revision 围栏", capturedRev === 7);
  stateSeq = 0;
  stateStore.clear();
  stateStore.set(0, { phonePort: { text: "abc" } });
  callLog = [];
  comps.PhoneConfigPage({ view: "page", form: fakeForm });
  const badField = callLog.find((c) => c[1] === primStub.SettingsValueField && c[2].id === "dshk-cfgp-phonePort");
  const badFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
  check("非法数字：字段 invalid + 框架 invalid 置位", !!badField && badField[2].invalid === true && !!badFrm && badFrm[2].state.invalid === true);
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  comps.PhoneConfigPage({ view: "page", form: { state: { ...fakeForm.state, writable: false }, mutate: fakeForm.mutate } });
  const roSwitch = callLog.find((c) => c[1] === primStub.Switch);
  const roField = callLog.find((c) => c[1] === primStub.SettingsValueField);
  const roFrm = callLog.find((c) => c[1] === primStub.SettingsForm);
  check("只读态：框架 writable=false、控件禁用", !!roFrm && roFrm[2].state.writable === false && roSwitch[2].disabled === true && roField[2].disabled === true);
}

// 3) 设置页「手机访问」渲染（fetch/effect 被桩跳过 = 纯 loading 分支）
{
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const out = comps.PhoneSection({});
  check("PhoneSection loading 渲染无异常", !!out && typeof out === "object");
  check("页头用本组件词条（手机访问 / Phone access）", callLog.some((c) => c[2] && typeof c[2].children === "string" && ["手机访问", "Phone access"].includes(c[2].children)));
}

// 4) apply 装配门控：行关闭（探针 404）= 一个槽都不注册；可用 = 设置页 + 两个配置页 key
async function checkApply() {
  const run = async (available) => {
    const registered = [];
    const slotInjects = [];
    const origFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).indexOf("/dsh-kit-phone/config") >= 0) {
        if (!available) return { ok: false, status: 404, json: async () => ({ error: "HTTP 404" }) };
        return { ok: true, status: 200, json: async () => ({ phonePort: 3090, phoneRemoteDomain: "", phoneKeepGatewayOn: false }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const ctx = {
      slots: { register: (seat) => registered.push(seat), inject: (k, cb) => { slotInjects.push(k); cb(); } },
    };
    let error = null;
    try { await comps.apply(ctx); } catch (e) { error = e; }
    global.fetch = origFetch;
    return { registered, slotInjects, error };
  };
  const off = await run(false);
  check("行关闭（/dsh-kit-phone/config 404）：一个槽、一个槽位注入都不发生", off.error === null && off.registered.length === 0 && off.slotInjects.length === 0);
  const on = await run(true);
  check("apply 激活不抛错且只注入 settings.section / plugins.row.config", on.error === null && on.slotInjects.every((k) => k === "settings.section" || k === "plugins.row.config"));
  const seat = on.registered.find((s) => s && s.name === "settings.section");
  check("设置页整块注册：id=kit-phone、order=45、label 取本组件词条", !!seat && seat.id === "kit-phone" && seat.order === 45 && typeof seat.label === "function" && ["手机访问", "Phone access"].includes(seat.label()));
  const keys = on.registered.filter((s) => s && s.name === "plugins.row.config").map((s) => s.key);
  check("配置页挂本组件行（单包单口径 key）", keys.includes("dsh-kit#phone") && keys.length === 1);
}

// 5) 源哨兵：宿主半边搬进组件目录、主包与 client 摘干净、端点与配置齐备、
//    远程视图置灰判据对齐当前官方 DOM（open-in-app 的 data-open-target）
{
  const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");
  const bundleSrc = read("client/bundle.js");
  const hostSrc = read("src/index.ts");
  const compSrc = read("src/phone/index.ts");
  const gwSrc = read("src/phone/gateway.ts");
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  const sliceBetween = (from, to) => {
    const i = bundleSrc.indexOf(from);
    const j = bundleSrc.indexOf(to, i);
    return i < 0 || j < 0 ? "" : bundleSrc.slice(i, j);
  };
  const hostCode = hostSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check(
    "主包不再装配手机访问（无网关/端点/端口/配置）",
    !hostCode.includes("phone-gateway") && !hostCode.includes("startPhoneGateway") && !hostCode.includes("/dsh-kit/phone/") &&
      !hostCode.includes("phonePort") && !hostCode.includes("phoneEnabled") && !hostCode.includes("PHONE_PORT") &&
      !hostCode.includes("dsh-kit/config"),
  );
  check(
    "主行不再有 Config / 配置页 / 配置快照门控（行开关即唯一开关）",
    !/export const Config/.test(hostCode) && sliceBetween("const CFG_DEFAULTS = {", "/** 从官方 scope 快照提取生效配置") === "" &&
      sliceBetween("const KIT_CFG_FIELDS = [", "/** KIT_CFG_FIELDS 的分组顺序") === "" &&
      !bundleSrc.includes("kcfgPhoneEnabled") && !bundleSrc.includes("phoneEnabled"),
  );
  check(
    "组件入口自持端点与配置，且带探针（404 = 行关闭）",
    compSrc.includes("name = 'dsh-kit/phone'") && compSrc.includes("/dsh-kit-phone/config") &&
      compSrc.includes("/dsh-kit/phone/info") && compSrc.includes("/dsh-kit/phone/link") &&
      compSrc.includes("/dsh-kit/phone/rotate") && compSrc.includes("/dsh-kit/phone/gateway") &&
      compSrc.includes("phoneRemoteDomain") && compSrc.includes("phonePort") && compSrc.includes("phoneKeepGatewayOn") &&
      compSrc.includes("lockPickerEntries") && compSrc.includes("from './gateway.ts'"),
  );
  check(
    "手机访问 client 半边整体收进 phoneModule，根 UI_CSS 不再持有手机访问样式",
    bundleSrc.includes("const phoneModule = (kit, require) => {") &&
      bundleSrc.includes("exports.phone = phoneModule(exports, require);") &&
      !sliceBetween("const UI_CSS = ", "const PHONE_CSS = ").includes("dshk-phone") &&
      bundleSrc.includes('style[data-plugin-css="dsh-kit-phone/ui"]'),
  );
  check(
    "远程视图置灰判据用语义属性 data-open-target（覆盖会话头部/预览/交付卡的打开入口）",
    gwSrc.includes("const HOST_ONLY_LOCKED = ['[data-open-target]']") &&
      !gwSrc.includes("选择打开方式") && !gwSrc.includes("中打开工作目录") && !gwSrc.includes("PRESENTED_HOST_ACTION_RE"),
  );
  check(
    "文本判据只剩「添加工作区…」与「打开配置文件」（官方 0.1.7 词典核对过）",
    gwSrc.includes("const ADD_MENU_ITEM_RE = '^(?:添加工作区|Add workspace)'") &&
      gwSrc.includes("const OPEN_DOCUMENT_RE = '^(?:打开配置文件|Open configuration file)$'") &&
      gwSrc.includes("const PICKER_LOCKED = ["),
  );
  check("组件行声明 + exports 子路径 + locale 齐备", patchSrc.includes("name: dsh-kit/phone") && !!pkg.exports["./phone"] && !!pkg.exports["./phone/locale/*.json"] && fs.existsSync(__dirname + "/../locale/phone/zh.json") && fs.existsSync(__dirname + "/../locale/phone/en.json"));
  check(
    "组件行中文名与描述在 locale/phone（宿主按行 name 全串解析）",
    read("locale/phone/zh.json").includes("手机访问") && read("locale/phone/en.json").includes("Phone access"),
  );
  const schemaKeys = [...compSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)/gm)].map((m) => m[1]);
  const fieldKeys = comps.PHONE_CFG_FIELDS.map((f) => f.key);
  check(
    "配置页字段表与宿主 schema 同源（" + schemaKeys.length + " 项）",
    schemaKeys.length === fieldKeys.length && schemaKeys.every((k) => fieldKeys.includes(k)),
  );
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (phone)" : "FAILED: " + failed);
  process.exit(failed === 0 ? 0 : 1);
})();
