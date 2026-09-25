// dsh-kit/vault 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、本组件行配置页、右栏两张签 + 快捷键注册、apply 装配门控
//（行关闭 = 探针 404 = 一个槽都不注册）与宿主半边源哨兵。
// 组件 = 单包内模块（root client 的 exports.vault），无独立 bundle；
// 知识库/日程的行为级渲染检查（VaultRootView/VaultPagePane/ScheduleView/纯函数）
// 仍在根 render-check.cjs（harness 合并 exports.vault 后直测同一份代码）。
// 用法（dsh-kit 根）：node tests\render-check-vault.cjs
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
if (!global.MutationObserver) global.MutationObserver = class { observe() {} };
if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} disconnect() {} };
if (!global.CustomEvent) global.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };

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

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.vault
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.vault;

check("vault 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "vault 导出面齐全（索引/页/日程/壳/配置页/路由）",
  typeof comps.VaultView === "function" && typeof comps.VaultRootView === "function" &&
    typeof comps.VaultPaneBody === "function" && typeof comps.SchedulePaneBody === "function" &&
    typeof comps.ScheduleView === "function" && typeof comps.VaultShell === "function" &&
    typeof comps.VaultEntry === "function" && typeof comps.VaultConfigPage === "function" &&
    typeof comps.onChatOpenFileClick === "function" && Array.isArray(comps.VAULT_CFG_FIELDS),
);

// 2) 配置页：单组（不出页签）、唯一字段是知识库根目录（文本，值取宿主表单）
{
  const fakeForm = { state: { status: "ready", value: { vaultRoot: "D:/notes" }, revision: 5, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const out = comps.VaultConfigPage({ view: "page", form: fakeForm });
  check("VaultConfigPage 渲染无异常且单组不出页签", !!out && typeof out === "object" && !callLog.some((c) => c[1] === primStub.SegmentedTabs));
  const field = callLog.find((c) => c[1] === primStub.SettingsValueField);
  check(
    "唯一字段：知识库根目录（文本、回显受理值、带说明）",
    !!field &&
      field[2].id === "dshk-cfgp-vaultRoot" &&
      field[2].numeric !== true &&
      field[2].text === "D:/notes" &&
      ["知识库根目录（绝对路径）", "Vault root directory (absolute path)"].includes(field[2].label) &&
      typeof field[2].hint === "string" &&
      field[2].hint.length > 0,
  );
  check("summary 视图返回 null（行详情收起态）", comps.VaultConfigPage({ view: "summary", form: fakeForm }) === null);
  check("vCfgFromSnapshot：无快照回默认空串、ready 快照取受理值", comps.vCfgFromSnapshot(null).vaultRoot === "" && comps.vCfgFromSnapshot({ status: "ready", value: { vaultRoot: "D:/v" } }).vaultRoot === "D:/v");
}

// 3) apply 装配门控：行关闭（探针 404）= 一个槽都不注册；可用 = 壳 + 右栏两签 +
//    输入行入口 + 两个配置页 key + 两个座 + 快捷键
async function checkApply() {
  const run = async (available) => {
    const registered = [];
    const slotInjects = [];
    const svcInjects = [];
    const shortcutCmds = [];
    const clickListeners = [];
    const origAdd = global.document.addEventListener;
    global.document.addEventListener = (type, fn, capture) => { clickListeners.push([type, capture === true]); };
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/dsh-kit-vault/config")) {
        if (!available) return { ok: false, status: 404, json: async () => ({ error: "HTTP 404" }) };
        return { ok: true, status: 200, json: async () => ({ vaultRoot: "" }) };
      }
      return { ok: true, status: 200, json: async () => ({ root: "D:/v", folders: [], pages: [], library: null }) };
    };
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
        if (deps.includes("shortcuts")) {
          cb({ shortcuts: { register: (cmd) => { shortcutCmds.push(cmd); return () => {}; }, catalog: null }, effect: (fn) => { fn(); } });
        }
      },
    };
    await comps.apply(ctx);
    global.document.addEventListener = origAdd;
    return { registered, slotInjects, svcInjects, shortcutCmds, clickListeners };
  };
  const off = await run(false);
  check("行关闭（/dsh-kit-vault/config 404）：一个槽、一个服务注入都不发生", off.registered.length === 0 && off.slotInjects.length === 0 && off.svcInjects.length === 0);
  const on = await run(true);
  check("apply 激活不抛错且等 sidebarRightTabs/shortcuts 声明（inject 而非直读）", on.svcInjects.includes("sidebarRightTabs") && on.svcInjects.includes("shortcuts"));
  const keys = on.registered.filter((s) => s && s.name === "plugins.row.config").map((s) => s.key);
  check("配置页挂本组件行（单包单口径 key）", keys.includes("dsh-kit#vault") && keys.length === 1);
  check(
    "右栏两签注册：kind=dshk-vault/dshk-schedule + pane 正文槽位",
    on.registered.some((s) => s && s.kind === "dshk-vault" && s.id === "dsh-kit-vault") &&
      on.registered.some((s) => s && s.kind === "dshk-schedule" && s.id === "dsh-kit-schedule") &&
      on.slotInjects.includes("sidebar.right.pane.tab"),
  );
  check(
    "开始页条目只给日程（知识库是被动签，入口在左侧边栏）",
    on.registered.some((s) => s && s.kind === "dshk-schedule" && Array.isArray(s.guide) && s.guide.length === 1 && s.guide[0].order === 100) &&
      !on.registered.some((s) => s && s.kind === "dshk-vault" && s.guide),
  );
  check("输入行入口 + 常驻壳挂 shell.overlay（id 稳定）", on.registered.some((s) => s && s.name === "conversation.input.left" && s.id === "dsh-kit-vault" && s.order === 12) && on.registered.some((s) => s && s.name === "shell.overlay" && s.id === "dsh-kit-vault"));
  check("对话文件点击路由挂 document capture 监听", on.clickListeners.some((c) => c[0] === "click" && c[1] === true));
  const vaultCmd = on.shortcutCmds.find((c) => c.id === "dsh-kit.vault.toggle");
  check(
    "知识库命令注册进官方 shortcuts（label/别名/Ctrl+Alt+/，region 覆盖 page/editable/terminal）",
    !!vaultCmd && typeof vaultCmd.label() === "string" && Array.isArray(vaultCmd.aliases) &&
      vaultCmd.defaults["web:windows"].code === "Slash" && String(vaultCmd.defaults["web:windows"].modifiers) === "primary,alt" &&
      ["page", "editable", "terminal"].every((r) => vaultCmd.regions.includes(r)) && vaultCmd.modals.length === 0,
  );
  check(
    "dock 签 kind 补登（openRightbarTab/closeRightbarTab 按 feature 查 tabKinds）",
    dockExports.tabKinds.vault.kind === "dshk-vault" && dockExports.tabKinds.schedule.kind === "dshk-schedule",
  );
  check(
    "座对象填好：侧栏索引视图渲染器 + 文件树行点击改道（命中返回 true）",
    typeof dockExports.vaultView.renderer === "function" && typeof dockExports.vaultRoute.open === "function" &&
      dockExports.vaultRoute.open("D:/not-vault/x.md") === false,
  );
}

// 4) 源哨兵：宿主半边搬进组件目录、主包与 client 摘干净、端点与配置齐备
{
  const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");
  const bundleSrc = read("client/bundle.js");
  const hostSrc = read("src/index.ts");
  const compSrc = read("src/vault/index.ts");
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  const sliceBetween = (from, to) => {
    const i = bundleSrc.indexOf(from);
    const j = bundleSrc.indexOf(to, i);
    return i < 0 || j < 0 ? "" : bundleSrc.slice(i, j);
  };
  const rootCfg = sliceBetween("const CFG_DEFAULTS = {", "/** 从官方 scope 快照提取生效配置");
  const rootFields = sliceBetween("const KIT_CFG_FIELDS = [", "/** KIT_CFG_FIELDS 的分组顺序");
  // 迁移说明注释会提到旧键名，判据只看代码段
  const hostCode = hostSrc.replace(/\/\/[^\n]*/g, "");
  check(
    "主包 schema / client 默认表 / 字段表都不再有知识库与日程字段",
    !/vault(Enabled|Root)/.test(hostCode) && !/vault(Enabled|Root)/.test(rootCfg) && !/vault(Enabled|Root)/.test(rootFields) &&
      !bundleSrc.includes("kcfgVaultEnabled"),
  );
  check(
    "主包不再装配知识库与日程（无 scanner / vault-fs / schedule / 端点）",
    !hostCode.includes("VaultScanner") && !hostCode.includes("createEntry") && !hostCode.includes("buildScheduleTools") &&
      !hostCode.includes("/dsh-kit/vault/") && !hostCode.includes("/dsh-kit/schedule/"),
  );
  check(
    "组件入口自持工具/端点/配置，且带 dsh-tools 不可达降级",
    compSrc.includes("name = 'dsh-kit/vault'") && compSrc.includes("buildScheduleTools(") &&
      compSrc.includes("/dsh-kit-vault/config") && compSrc.includes("/dsh-kit/vault/index") &&
      compSrc.includes("/dsh-kit/schedule/data") && compSrc.includes("vaultRoot") &&
      compSrc.includes("dsh-tools 不可达，日程 agent 工具未注册"),
  );
  check(
    "root 的 open/closeRightbarTab 按 tabKinds 座查 kind（组件行不靠静态 RB_FEATURES）",
    bundleSrc.includes("const f = tabKinds[feature];") && bundleSrc.includes('const tabKinds = { file: { id: "dsh-kit-file", kind: "dshk-file" } };') && bundleSrc.includes("exports.tabKinds = tabKinds;"),
  );
  check(
    "知识库/日程 client 半边整体收进 vaultModule（root 侧只剩座与跨槽状态）",
    bundleSrc.includes("const vaultModule = (kit, require) => {") &&
      bundleSrc.includes("exports.vault = vaultModule(exports, require);") &&
      bundleSrc.includes("exports.vaultView = { renderer: null }") &&
      bundleSrc.includes("exports.vaultRoute = { open: null }"),
  );
  check("组件行声明 + exports 子路径 + locale 齐备", patchSrc.includes("name: dsh-kit/vault") && !!pkg.exports["./vault"] && !!pkg.exports["./vault/locale/*.json"]);
  check(
    "组件行中文名与描述在 locale/vault（宿主按行 name 全串解析）",
    read("locale/vault/zh.json").includes("知识库 · 日程") && read("locale/vault/en.json").includes("Knowledge base · Schedule"),
  );
  // 字段表与宿主 Config schema 同源（改必须两处同改，漂移即红）
  // 只取键名：vaultRoot 的默认值是表达式（defaultVaultRoot()），值比对由根 render-check 管
  const schemaKeys = [...compSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)/gm)].map((m) => m[1]);
  const fieldKeys = comps.VAULT_CFG_FIELDS.map((f) => f.key);
  check(
    "配置页字段表与宿主 schema 同源（" + schemaKeys.length + " 项）",
    schemaKeys.length === fieldKeys.length && schemaKeys.every((k) => fieldKeys.includes(k)),
  );
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (vault)" : "FAILED: " + failed);
  process.exit(failed === 0 ? 0 : 1);
})();
