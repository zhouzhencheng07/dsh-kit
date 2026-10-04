// dsh-kit/chat 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、配置页渲染、apply 装配、浮层各分支渲染与目标解析纯函数。
// 组件 = 单包内模块（root client 的 exports.chat），无独立 bundle。
// 用法（dsh-kit 根）：node tests\render-check-chat.cjs
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
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ className: "", textContent: "", dataset: {}, setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {}, firstElementChild: null, replaceWith: () => {} }),
    head: { appendChild: () => {} },
    body: { classList: { add() {}, remove() {} }, appendChild: () => {}, hasAttribute: () => false },
  };
}
if (!global.window) global.window = { innerWidth: 1600, innerHeight: 900, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false, addEventListener: () => {}, removeEventListener: () => {} };
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
  Tooltip: jsxPrim("dsw-tooltip"),
};
const requireMap = (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return { createPortal: (children, container) => ({ type: "portal", props: { children, container }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
};

const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.chat;

// 1) 导出面
check("chat 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check("chat 导出面齐全（浮层组件 + 解析纯函数 + 配置页字段表）", typeof comps.ChatSurface === "function" && typeof comps.ChatPanel === "function" && typeof comps.ChatBall === "function" && typeof comps.ChatSessionBody === "function" && typeof comps.resolveSessionId === "function" && Array.isArray(comps.CHAT_CFG_FIELDS));

// 2) 配置页：两个布尔开关、单组、summary 返回 null
{
  const fakeForm = { state: { status: "ready", value: { rememberWindow: true, rememberTarget: true, followMain: false }, revision: 3, writable: true }, mutate: async () => true };
  stateSeq = 0; stateStore.clear(); callLog = [];
  const out = comps.ChatConfigPage({ view: "page", form: fakeForm });
  const switches = callLog.filter((c) => c[1] === primStub.Switch);
  check("配置页渲染无异常且两个开关都出", !!out && switches.length === 2);
  check(
    "配置字段 = 记住窗口 / 记住工作区与会话（贴哪侧由拖动决定，不给配置项）",
    comps.CHAT_CFG_FIELDS.every((f) => f.type === "bool") &&
      comps.CHAT_CFG_FIELDS.map((f) => f.key).join(",") === "rememberWindow,rememberTarget",
  );
  check("贴边侧不再有配置项（字段表里没有、源码里也不留 edgeLeft）", !comps.CHAT_CFG_FIELDS.some((f) => f.key === "edgeLeft"));
  check("summary 视图返回 null（行详情收起态）", comps.ChatConfigPage({ view: "summary", form: fakeForm }) === null);
}

// 3) apply 装配：贴边常驻面（带 session 子槽）+ 子槽正文 + 配置页 + sessions 捕获
async function checkApply() {
  const registered = [];
  const seatInjects = [];
  const injected = [];
  let sessionsCallback = null;
  const ctx = {
    slots: {
      register: (seat) => { registered.push(seat); return () => {}; },
      inject: (k, cb) => { seatInjects.push(k); if (typeof cb === "function") cb(); },
    },
    inject: (deps, cb) => { injected.push(deps); sessionsCallback = cb; },
  };
  await comps.apply(ctx);
  check("apply 挂三个槽位等待（shell.overlay / 子槽 / 配置页）", seatInjects.join(",") === "shell.overlay,dsh-kit.chat.session,plugins.row.config");
  const overlay = registered.find((r) => r.name === "shell.overlay" && r.id === "dsh-kit-chat");
  check(
    "贴边面注册进 shell.overlay 且带 session 子槽声明（换 SessionProvider 与 renderFactorySlot）",
    !!overlay && overlay.children?.["dsh-kit.chat.session"]?.scope === "session",
  );
  check("小窗正文注册进自声明的子槽", registered.some((r) => r.name === "dsh-kit.chat.session"));
  check("配置页挂本组件行（key = dsh-kit#chat）", registered.some((r) => r.name === "plugins.row.config" && r.key === "dsh-kit#chat"));
  check("apply 期 inject 官方 sessions 服务", injected.some((d) => Array.isArray(d) && d.includes("sessions")));

  // 3b) 快捷键：开合小窗一条命令注册进官方 shortcuts（默认键避开宿主与自家其余命令）
  const shortcutCmds = [];
  const effects = [];
  comps.registerShortcuts({
    shortcuts: { catalog: { subscribe: () => () => {} }, register: (cmd) => { shortcutCmds.push(cmd); return () => {}; } },
    effect: (fn) => { effects.push(fn); return () => {}; },
  });
  effects.forEach((fn) => fn());
  const cmd = shortcutCmds.find((c) => c.id === "dsh-kit.chat.toggle");
  const keys = cmd ? Object.values(cmd.defaults).map((d) => d.code + "+" + d.modifiers.join("+")).join(" ") : "";
  check(
    "快捷键注册进官方服务：开合小窗一条（默认键 primary+alt+分号，避开系统保留的字母键）",
    !!cmd && typeof cmd.label === "function" && keys.split(" ").every((k) => k === "Semicolon+primary+alt") &&
      !("web:linux" in cmd.defaults) &&
      cmd.regions.includes("page") && cmd.regions.includes("editable") && cmd.regions.includes("terminal"),
  );
  check(
    "快捷键动作 = 开关小窗；行关闭（探针 404）时 blocked",
    !!cmd && typeof comps.toggleChat === "function" && cmd.resolve().status === "blocked" && typeof cmd.resolve().reason === "string",
  );

  // 4) 渲染分支：把手 / 面板 / 浮层宿主 / 内嵌对话
  stateSeq = 0; stateStore.clear();
  const cfg = { ...comps.CHAT_CFG_DEFAULTS };
  const ui = { open: false, workspaceId: "w1", sessionId: "s1", rect: { x: 100, y: 80, w: 420, h: 600 }, followMain: false };
  const ws = { workspaceId: "w1", path: "D:\\work\\demo", title: "demo", sessionIds: ["s1", "s2"] };
  const rows = [{ id: "s1", displayTitle: "第一条", updatedAt: 2, running: true }, { id: "s2", displayTitle: "第二条", updatedAt: 1 }];
  callLog = [];
  const ball = comps.ChatBall({ cfg, ui, title: "第一条", running: true });
  const ballBtn = callLog.find((c) => c[1] === "button");
  check("把手渲染（常显，含图形与标题，可拖 = onPointerDown）", !!ball && !!ballBtn && typeof ballBtn[2].onPointerDown === "function");
  callLog = [];
  comps.ChatBall({ cfg, ui: { ball: { dock: null, x: 120, y: 240 } }, title: "x", running: false });
  const freeBtn = callLog.find((c) => c[1] === "button");
  check(
    "自由位置：内联 left/top（拖到哪儿停哪儿）；停靠时不写坐标（交给 CSS 贴边）",
    freeBtn[2].style.left === 120 && freeBtn[2].style.top === 240 && ballBtn[2].style.left === undefined,
  );
  callLog = [];
  comps.ChatPanel({ ui, cfg, workspaces: [ws], rows, ws, body: null, onCreate: () => {}, onSessionId: () => {}, onWorkspaceId: () => {} });
  const panelTypes = callLog.map((c) => c[1]);
  const classes = callLog.map((c) => c[2]?.className).filter(Boolean);
  check(
    "面板渲染：外壳 + 头部 + 正文槽 + 缩放角",
    panelTypes.includes("div") && panelTypes.includes("button") &&
      classes.includes("dshk-chat-panel") && classes.includes("dshk-chat-head") &&
      classes.includes("dshk-chat-body") && classes.includes("dshk-chat-grip"),
  );
  check("收起按钮与展开按钮都在头部", callLog.filter((c) => c[1] === "button").length >= 5);

  callLog = [];
  const listState = { ids: ["s1", "s2"], byId: { s1: rows[0], s2: rows[1] } };
  const wsState = { items: [ws], archivedSessionIds: [] };
  const props = {
    useWorkspaces: (sel) => sel(wsState),
    useSessions: (sel) => sel(listState),
    SessionProvider: (p) => ({ type: "session-provider", props: p, $$dshk: "provider" }),
    renderSlot: (key) => ({ type: "child-slot", props: { key }, $$dshk: "slot" }),
  };
  const surface = comps.ChatSurface(props);
  check(
    "浮层宿主渲染：portal 到 body（盖得住右栏全屏），收起态只有把手",
    surface !== null && surface.$$dshk === "portal" && surface.props.container === global.document.body &&
      surface.props.children.$$dshk === "jsxs" &&
      callLog.some((c) => typeof c[2]?.className === "string" && c[2].className.startsWith("dshk-chat-root")),
  );

  let factoryArgs = null;
  const bodyOut = comps.ChatSessionBody({
    useSession: (sel) => sel({ blank: true, running: false }),
    renderFactorySlot: (name, propsIn, opts) => { factoryArgs = { name, propsIn, opts }; return { type: "factory", $$dshk: "factory" }; },
  });
  check(
    "正文走官方 conversation.content 工厂的 embedded 变体（空会话 → hero 相位，带 views 局部槽与回落）",
    !!bodyOut && factoryArgs !== null && factoryArgs.name === "conversation.content" &&
      factoryArgs.propsIn.variant === "embedded" && factoryArgs.propsIn.hero === true && factoryArgs.propsIn.phase === "hero" &&
      typeof factoryArgs.opts.slots.views === "function" && factoryArgs.opts.fallback !== undefined,
  );
  callLog = [];
  let factoryArgs2 = null;
  comps.ChatSessionBody({
    useSession: (sel) => sel({ blank: false, running: true }),
    renderFactorySlot: (name, propsIn) => { factoryArgs2 = propsIn; return null; },
  });
  check("有内容的会话 → active 相位", factoryArgs2 !== null && factoryArgs2.phase === "active" && factoryArgs2.hero === false);
  const noFactory = comps.ChatSessionBody({ useSession: (sel) => sel(null), renderFactorySlot: undefined });
  check("宿主没有工厂能力时给出说明而不是空白", noFactory !== null && noFactory.$$dshk === "jsx");

  // 5) 目标解析纯函数
  check("路径归一：反斜杠 / 尾分隔符 / 盘符大小写", comps.normPath("D:\\Work\\Demo\\") === "d:/work/demo" && comps.normPath("/a/b/") === "/a/b");
  check("按 cwd 找主面会话的工作区（大小写与分隔符不敏感）", comps.workspaceOfCwd([ws], "d:/work/DEMO")?.workspaceId === "w1" && comps.workspaceOfCwd([ws], "") === null);
  const filtered = comps.sessionsOfWorkspace(ws, { byId: { s1: rows[0], s2: rows[1], s3: { id: "s3", displayTitle: "归档的", updatedAt: 9 }, s4: { id: "s4", displayTitle: "子智能体", updatedAt: 9, origin: "subagent" } } }, ["s3"]);
  check(
    "会话列表：滤掉归档与子智能体，按更新时间倒序",
    filtered.map((r) => r.id).join(",") === "s1,s2",
  );
  check(
    "目标会话：记忆优先，其次最近一条有内容的，没有则空",
    comps.resolveSessionId(filtered, "s2") === "s2" && comps.resolveSessionId(filtered, "gone") === "s1" && comps.resolveSessionId([], "s2") === null,
  );
  check(
    "空白会话不进下拉、且标题显示「新建对话」（空白会话的 displayTitle 是工作区名，与新建重复）",
    comps.sessionLabel({ id: "sx", blank: true, displayTitle: "test" }, "空") === "新建对话" &&
      comps.sessionLabel({ id: "sy", displayTitle: "你好" }, "空") === "你好" &&
      comps.sessionLabel(null, "空") === "空" &&
      comps.resolveSessionId([{ id: "blank", blank: true, updatedAt: 9 }, { id: "real", displayTitle: "x", updatedAt: 1 }], null) === "real" &&
      comps.resolveSessionId([{ id: "blank", blank: true, updatedAt: 9 }], "blank") === "blank",
  );
  check(
    "目标工作区：记忆 > 主面 cwd > 第一个",
    comps.resolveWorkspace([ws, { workspaceId: "w2", path: "D:\\other" }], "w2", "D:/work/demo").workspaceId === "w2" &&
      comps.resolveWorkspace([ws], null, "D:/work/demo").workspaceId === "w1" &&
      comps.resolveWorkspace([], null, "x") === null,
  );
  check(
    "窗口矩形：贴右默认位置、记忆越界收回视口内、窄屏整屏",
    comps.rectOf({ rect: null }, cfg) !== null &&
      comps.rectOf({ rect: { x: 99999, y: 99999, w: 420, h: 620 } }, cfg).x < 1600 &&
      (global.window.innerWidth = 480, comps.rectOf({ rect: null }, cfg)) === null &&
      (global.window.innerWidth = 1600, true),
  );
  check(
    "配置快照回落内置默认（端点 404 / 字段缺失都不炸）",
    JSON.stringify(comps.cCfgFromSnapshot(null)) === JSON.stringify(comps.CHAT_CFG_DEFAULTS) &&
      comps.cCfgFromSnapshot({ status: "ready", value: { rememberWindow: false } }).rememberWindow === false &&
      comps.cCfgFromSnapshot({ status: "ready", value: { rememberWindow: "yes" } }).rememberWindow === true,
  );

  // 5b) 引用落点按光标（底座的 composerFocus）：光标在哪个输入框就归那面
  {
    const el = (seatSel, panelSel) => ({
      closest: (sel) => (sel === '[class*="composerSeat"]' ? (seatSel ? {} : null) : sel === ".dshk-chat-panel" && panelSel ? {} : null),
    });
    global.document.activeElement = null;
    check("光标不在任何输入框（页面空白 / 编辑器里）", dockExports.composerFocus() === null);
    global.document.activeElement = el(true, false);
    check("光标在官方输入框但不在小窗 → 主面", dockExports.composerFocus() === "main");
    global.document.activeElement = el(true, true);
    check("光标在小窗的输入框 → 小窗", dockExports.composerFocus() === "chat");
    global.document.activeElement = el(false, false);
    check("光标在普通页面元素（侧栏 / 工具条）→ 都不算", dockExports.composerFocus() === null);
    global.document.activeElement = null;
  }

  // 6) 源哨兵：组件行 / exports / locale / 宿主 Config 同源
  const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");
  const bundleSrc = read("client/bundle.js");
  const compSrc = read("src/chat/index.ts");
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  check("组件行声明 + exports 子路径 + locale 齐备", patchSrc.includes("name: dsh-kit/chat") && !!pkg.exports["./chat"] && !!pkg.exports["./chat/locale/*.json"]);
  check("组件行中文名与描述在 locale/chat", read("locale/chat/zh.json").includes("对话小窗") && read("locale/chat/en.json").includes("Chat window"));
  check("chatModule 装进 bundle 且进组件激活循环", bundleSrc.includes("const chatModule = (kit, require) => {") && bundleSrc.includes("exports.chat = chatModule(exports, require);") && bundleSrc.includes("exports.files, exports.chat,"));
  const schemaKeys = [...compSrc.matchAll(/^ {8}(\w+): z\.boolean\(\)/gm)].map((m) => m[1]);
  check(
    "宿主 Config 字段与 client 默认表、配置字段表三处同源",
    schemaKeys.join(",") === comps.CHAT_CFG_FIELDS.map((f) => f.key).join(",") &&
      schemaKeys.join(",") === Object.keys(comps.CHAT_CFG_DEFAULTS).join(","),
  );
  check("宿主半边只有配置快照端点（会话与工作区全走官方服务）", compSrc.includes("/dsh-kit-chat/config") && !compSrc.includes("ctx.inject(['tools']"));
}
checkApply().then(() => {
  console.log(failed === 0 ? "\nALL PASS" : "\nFAILED " + failed);
  process.exit(failed === 0 ? 0 : 1);
});
