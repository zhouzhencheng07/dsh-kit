// dsh-kit-terminal 浏览器半边渲染级检查：加载真实 dock bundle（root client）+ terminal
// bundle，直测输入行入口（角标/按压态/官方气泡）、底部坞（标签条/头部动作/pane 状态
// 文案）、图标描边风格、配置门控与官方「快捷键」服务注册。
// 用法（dsh-kit 根）：node tests\render-check-terminal.cjs
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
    createElement: () => ({ className: "", textContent: "", dataset: {}, setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {} }),
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

// react hooks 桩（useState 带可预置的 stateStore，供坞的重启计数/shell 名分支测试）
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

// 1) 共享底座：root bundle 真实加载（kitBase 随 factory 执行），组件从这里取共享面
const dockExports = loadBundle(__dirname + "/../client/bundle.js", (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return { createPortal: (children) => ({ type: "portal", props: { children }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
});
check(
  "dock 共享面（kitJson/kitUi 三件套/官方气泡与键帽座/会话行 hook）",
  [dockExports.kitJson, dockExports.setKitUi, dockExports.getKitUi, dockExports.useKitUi, dockExports.KitTip, dockExports.attachShortcutCatalog, dockExports.resolveZh, dockExports.subscribeLocale, dockExports.getLocaleVersion, dockExports.useCurrentRow, dockExports.flashToast].every(
    (fn) => typeof fn === "function",
  ),
);

const comps = loadBundle(__dirname + "/../packages/dsh-kit-terminal/client/bundle.js", (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "dsh-kit") return dockExports;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected require: " + name);
});

check("terminal 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "terminal 导出面齐全（入口/坞/pane/浮层宿主/图标/配置页/会话模型/快捷键）",
  [comps.TerminalEntry, comps.TerminalDock, comps.TerminalPane, comps.TerminalSurfaces, comps.TerminalIcon, comps.TerminalConfigPage, comps.termTabLabel, comps.makeTerm, comps.toggleTermDock, comps.spawnTerm, comps.killTerm, comps.cfgFromSnapshot, comps.registerShortcuts, comps.xtermTheme].every((fn) => typeof fn === "function"),
);

// —— 图标：与文件树/源代码管理/知识库三枚入口钮同一套描边画法 ——
{
  const icon = comps.TerminalIcon();
  const rect = icon.props.children[0];
  check(
    "终端图标是描边同族（15px / viewBox 16 / currentColor / 1.2 描边，不是实心深色卡）",
    icon.props.width === 15 && icon.props.height === 15 && icon.props.viewBox === "0 0 16 16" && icon.props.stroke === "currentColor" && icon.props.strokeWidth === 1.2 && icon.props.fill === "none",
  );
  check("终端图标中间留空（描边圆角卡 + 提示符两笔，无填充色）", rect.type === "rect" && rect.props.fill === undefined && icon.props.children.length === 3);
  const termSrc = fs.readFileSync(__dirname + "/../packages/dsh-kit-terminal/client/bundle.js", "utf8");
  check("源码里没有实心深色卡残留（填充色/白色描边都不在）", !termSrc.includes('fill: "#17191d"') && !termSrc.includes('stroke: "#fff"'));
}

// —— 入口按钮：0 会话 = 无角标；有会话 = 数量角标 + 按压态；点击开合坞 ——
{
  dockExports.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
  let out = comps.TerminalEntry({});
  check("TerminalEntry 渲染无异常且悬停走官方气泡（命令 id 对上快捷键注册）", !!out && out.type === dockExports.KitTip && out.props.command === "dsh-kit.terminal.toggle" && out.props.side === "top" && typeof out.props.label === "string");
  const btn = out.props.children;
  check("无会话：无数量角标、未按压", btn.props.className === "dshk-btn dshk-enbtn" && btn.props["aria-pressed"] === false && btn.props.children[1] === null);
  dockExports.setKitUi({ terminals: [comps.makeTerm("s1", "C:/x"), comps.makeTerm("s1", "C:/x")], activeTermId: null, termDockOpen: true });
  out = comps.TerminalEntry({});
  const badge = out.props.children.props.children[1];
  check("多会话：label 带数量、角标出数字、坞开着 = 按压态", out.props.label.includes("· 2") && !!badge && badge.props.className === "dshk-term-badge" && badge.props.children === "2" && out.props.children.props["aria-pressed"] === true);
  comps.TerminalEntry({}).props.children.props.onClick();
  check("点击入口 = 收起坞（只隐藏，不杀会话）", dockExports.getKitUi().termDockOpen === false && dockExports.getKitUi().terminals.length === 2);
  dockExports.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
}

// —— 会话模型纯函数（状态在 kitBase 的 kitUi 里，本包只出补丁）——
{
  const base = { terminals: [], activeTermId: null, termDockOpen: false };
  const opened = comps.toggleTermDock(base, "s1", "C:/x");
  check("toggleTermDock 空列表：新建并绑定当前会话 + 开坞", opened.termDockOpen === true && opened.terminals.length === 1 && opened.terminals[0].sessionId === "s1" && opened.activeTermId === opened.terminals[0].id);
  const noSession = comps.toggleTermDock(base, null, null);
  check("toggleTermDock 无会话：只开坞不造终端（调用点提示先开会话）", noSession.termDockOpen === true && noSession.terminals === undefined);
  const spawned = comps.spawnTerm(opened, "s2", "C:/y");
  check("spawnTerm ＋：追加并激活新终端", spawned.terminals.length === 2 && spawned.activeTermId === spawned.terminals[1].id && spawned.terminals[1].sessionId === "s2");
  const killed = comps.killTerm(spawned, spawned.terminals[1].id);
  check("killTerm 标签 ✕：移除该终端、激活位顺延邻居", killed.terminals.length === 1 && killed.activeTermId === spawned.terminals[0].id);
  const killedAll = comps.killTerm(killed, killed.terminals[0].id);
  check("killTerm 关光：坞一并收起", killedAll.terminals.length === 0 && killedAll.termDockOpen === false);
  check("toggleTermDock 坞开着时再点 = 只收坞", JSON.stringify(comps.toggleTermDock({ terminals: spawned.terminals, activeTermId: null, termDockOpen: true }, "s1", "C:/x")) === JSON.stringify({ termDockOpen: false }));
  const sameCwd = [comps.makeTerm("s1", "C:/y"), comps.makeTerm("s1", "C:/y")];
  check("termTabLabel 同 cwd 多开追加序号、单个用目录名", comps.termTabLabel(comps.makeTerm("s1", "C:/x"), [spawned.terminals[0]]) === "x" && comps.termTabLabel(sameCwd[1], sameCwd) === "y 2");
}

// —— 坞：标签条（悬停气泡 + 结束钮）、头部动作、pane 堆叠 ——
{
  dockExports.setKitUi({ terminals: [comps.makeTerm("s1", "C:/x"), comps.makeTerm("s1", "C:/x")], activeTermId: null, termDockOpen: true });
  callLog = [];
  const out = comps.TerminalDock({ open: true, cwd: "C:/x", onSpawn: () => {}, onHide: () => {}, onActivate: () => {}, onKill: () => {}, onKillAll: () => {} });
  check("TerminalDock 带标签渲染无异常（同 cwd 多开走序号分支）", !!out && typeof out === "object");
  const dockEl = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-dock");
  const tabLabels = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-label").map((c) => c[2].children);
  const tabCloseTips = callLog.filter((c) => (c[0] === "jsx") && c[1] === dockExports.KitTip && ["结束此终端", "Kill this terminal"].includes(c[2].label));
  const tabCloseBtns = callLog.filter((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tab-x");
  check("坞渲染出标签条（两条标签 + 头部左对齐标题）", !!dockEl && tabLabels.length === 2 && tabLabels[0] === "x 1" && tabLabels[1] === "x 2");
  check("标签 ✕ 走官方气泡且朝上（底部坞口径）", tabCloseTips.length === 2 && tabCloseTips.every((c) => c[2].side === "top") && tabCloseBtns.length === 2);
  const headTips = callLog.filter((c) => (c[0] === "jsx") && c[1] === dockExports.KitTip).map((c) => c[2].label);
  check(
    "头部动作钮提示齐全且都朝上（新建/重启/隐藏/结束全部）",
    ["新建终端", "New terminal"].some((s) => headTips.includes(s)) && ["重新启动终端", "Restart terminal"].some((s) => headTips.includes(s)) && ["隐藏终端坞（进程继续运行）", "Hide dock (processes keep running)"].some((s) => headTips.includes(s)) && ["结束全部终端", "Kill all terminals"].some((s) => headTips.includes(s)) && callLog.filter((c) => (c[0] === "jsx") && c[1] === dockExports.KitTip).every((c) => c[2].side === "top"),
  );
  const stack = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tstack");
  check("pane 挂在 tstack 里（绝对定位包含块只盖内容区，不盖头部）", !!stack && Array.isArray(stack[2].children) && stack[2].children.length === 3);
  const hidden = comps.TerminalDock({ open: false, cwd: null, onSpawn: () => {}, onHide: () => {}, onActivate: () => {}, onKill: () => {}, onKillAll: () => {} });
  check("坞收起 = display:none（不卸载，后台会话继续跑）", hidden.props.style.display === "none");
  callLog = [];
  const pane = comps.TerminalPane({ term: { id: "t1", sessionId: "s1", cwd: "C:/x" }, visible: true });
  const note = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-term-note");
  check("TerminalPane 渲染无异常（连接中状态条 + 空 body 挂载点）", !!pane && !!note && callLog.some((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-tbody"));
  dockExports.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
}

// —— 源码哨兵：xterm 静态资源仍走主包 /dsh-kit/vendor 白名单，样式随组件自带 ——
{
  const termSrc = fs.readFileSync(__dirname + "/../packages/dsh-kit-terminal/client/bundle.js", "utf8");
  check("xterm 走主包 vendor 白名单（xterm.js/addon-fit.js/xterm.css 三个 URL 都在本包加载）", termSrc.includes("/dsh-kit/vendor/xterm.js") && termSrc.includes("/dsh-kit/vendor/addon-fit.js") && termSrc.includes("/dsh-kit/vendor/xterm.css"));
  check("坞样式随组件自带（.dshk-dock 与让位规则在本包 CSS，不在根包）", termSrc.includes(".dshk-dock{position:fixed") && termSrc.includes("body.dshk-open [class*=\"_centerCol\"]"));
  check("入口钮的悬停不再自带原生 title（全走官方气泡）", !/dshk-enbtn"[\s\S]{0,120}?\n\s*title:/.test(termSrc));
  const hostSrc = fs.readFileSync(__dirname + "/../packages/dsh-kit-terminal/src/index.ts", "utf8");
  check("宿主 schema 只有 terminalEnabled 且标了 volatile（漏标进不了配置表单）", /terminalEnabled: z\.boolean\(\)\.default\(true\)\.volatile\(\)/.test(hostSrc) && !hostSrc.includes("fileTreeEnabled"));
}

// —— 配置门控 + 官方快捷键注册 + apply 激活契约（配置端点走 fetch 桩）——
async function checkApply() {
  const seats = [];
  const seatInjects = [];
  const shortcutCmds = [];
  const injected = [];
  const scRows = [{ id: "dsh-kit.terminal.toggle", keys: ["Ctrl", "+", "Alt", "+", "`"], aria: "Control+Alt+`" }];
  const ctxStub = {
    inject: (deps, cb) => {
      injected.push(...deps);
      if (deps.includes("shortcuts")) {
        cb({
          shortcuts: { register: (cmd) => { shortcutCmds.push(cmd); return () => {}; }, catalog: { getSnapshot: () => scRows, subscribe: () => () => {} } },
          effect: (fn) => { fn(); },
        });
      }
      if (deps.includes("webTerminals")) cb({ webTerminals: { view: () => ({}), close: () => {} } });
    },
    slots: {
      register: (seat) => { seats.push(seat); return () => {}; },
      inject: (key, cb) => { seatInjects.push(key); cb(); },
    },
    effect: () => {},
  };
  let scripted = { terminalEnabled: true };
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    return { ok: true, status: 200, json: async () => scripted };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let applyErr = null;
  try { await comps.apply(ctxStub); await tick(); } catch (e) { applyErr = e; }
  check("terminal apply 激活不抛错", applyErr === null);
  check("apply 拉自家配置端点喂门控", calls.some((c) => c.url === "/dsh-kit-terminal/config"));
  check("apply 捕获官方终端模型服务与快捷键服务（运行期 inject）", injected.includes("webTerminals") && injected.includes("shortcuts"));
  check(
    "apply 座席：入口 order 14、坞挂 shell.overlay（order 910）、配置页两种包名口径",
    (() => {
      const entry = seats.find((s) => s.name === "conversation.input.left" && s.id === "dsh-kit-terminal");
      const overlay = seats.find((s) => s.name === "shell.overlay" && s.id === "dsh-kit-terminal");
      const cfgKeys = seats.filter((s) => s.name === "plugins.row.config").map((s) => s.key);
      return !!entry && entry.order === 14 && !!overlay && overlay.order === 910 && cfgKeys.includes("dsh-kit#terminal") && cfgKeys.includes("dsh-kit-terminal#terminal");
    })(),
  );
  check("槽位都经 slots.inject 等声明落地（不直接 register）", seatInjects.filter((k) => k === "conversation.input.left").length === 1 && seatInjects.filter((k) => k === "shell.overlay").length === 1 && seatInjects.filter((k) => k === "plugins.row.config").length === 2);

  // 配置开：客户端快照生效 → cfgFromSnapshot 真值；入口与坞正常渲染
  check("cfgFromSnapshot 默认开、端点回包读真值", comps.cfgFromSnapshot(null).terminalEnabled === true && comps.cfgFromSnapshot({ status: "ready", value: { terminalEnabled: true } }).terminalEnabled === true && comps.cfgFromSnapshot({ status: "ready", value: { terminalEnabled: false } }).terminalEnabled === false);
  check("配置开：TerminalEntry 正常渲染、浮层宿主空列表返回 null", !!comps.TerminalEntry({}) && comps.TerminalSurfaces({}) === null);

  // 快捷键：命令进官方「快捷键」页 + 键帽从宿主目录活读
  const cmd = shortcutCmds.find((c) => c.id === "dsh-kit.terminal.toggle");
  check("注册进官方 shortcuts（id/label/别名/page·editable·terminal 三区）", !!cmd && typeof cmd.label === "function" && typeof cmd.label() === "string" && cmd.aliases.includes("terminal") && ["page", "editable", "terminal"].every((r) => cmd.regions.includes(r)) && cmd.modals.length === 0);
  check("默认键 Ctrl+Alt+`（primary+alt 口径，web 与 desktop 各档都在）", cmd.defaults["web:windows"].code === "Backquote" && String(cmd.defaults["web:windows"].modifiers) === "primary,alt" && !!cmd.defaults["web:macos"] && !!cmd.defaults["desktop:linux"]);
  const resolved = cmd.resolve({ region: "page", modal: null });
  // 会话绑定靠按钮渲染期回填（shortcuts 的 resolve 在渲染之外调用，拿不到会话）
  comps.TerminalEntry({ useSessions: () => ({ id: "s1", cwd: "C:/x" }) });
  check("配置开：resolve handled，run 开坞并绑当前会话（按钮渲染期回填）", resolved.status === "handled" && (resolved.run(), dockExports.getKitUi().termDockOpen === true && dockExports.getKitUi().terminals.length === 1 && dockExports.getKitUi().terminals[0].sessionId === "s1"));
  dockExports.setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
  const tipEl = dockExports.KitTip({ label: "终端", command: "dsh-kit.terminal.toggle", side: "top", children: jsxRuntimeStub.jsx("button", { type: "button" }) });
  check("键帽座跨包共享：root 的 KitTip 读得到本组件命令的键位", tipEl.type === primStub.Tooltip && tipEl.props.shortcutKeys.join("") === "Ctrl+Alt+`" && tipEl.props.children.props["aria-keyshortcuts"] === "Control+Alt+`");

  // 配置页（plugins.row.config）：字段清单与宿主 schema 同源，summary 视图 null
  check("配置页字段清单与内置默认同源（唯一字段 terminalEnabled）", comps.TERMINAL_CFG_FIELDS.length === 1 && comps.TERMINAL_CFG_FIELDS[0].key === "terminalEnabled" && Object.keys(comps.T_CFG_DEFAULTS).join(",") === "terminalEnabled");
  check("TerminalConfigPage summary 视图返回 null", comps.TerminalConfigPage({ view: "summary", form: null }) === null);
  callLog = [];
  const cfgPage = comps.TerminalConfigPage({ view: "page", form: { state: { status: "ready", value: { terminalEnabled: true }, revision: 1, writable: true }, mutate: async () => true } });
  const sw = callLog.find((c) => c[1] === primStub.Switch);
  check("配置页渲染出终端开关（官方表单原语 + 中文/英文文案）", !!cfgPage && !!sw && sw[2].checked === true && ["终端面板", "Terminal panel"].includes(sw[2].label));

  // 配置关：入口与坞都不渲染，命令 blocked 带说明，已有会话被清场
  dockExports.setKitUi(comps.spawnTerm({ terminals: [], activeTermId: null, termDockOpen: false }, "s1", "C:/x"));
  scripted = { terminalEnabled: false };
  await comps.apply(ctxStub);
  await tick();
  check("配置关：TerminalEntry 渲染 null（入口消失）", comps.TerminalEntry({}) === null);
  const offResolve = shortcutCmds[shortcutCmds.length - 1].resolve({ region: "page", modal: null });
  check("配置关：命令 resolve blocked 并带说明（不吞键也不动作）", offResolve.status === "blocked" && typeof offResolve.reason === "string" && offResolve.reason.length > 0);
  check("配置关：浮层宿主清场（结束全部终端会话）", dockExports.getKitUi().terminals.length === 0 && dockExports.getKitUi().termDockOpen === false && comps.TerminalSurfaces({}) === null);
}

checkApply().then(() => {
  console.log(failed === 0 ? "\nALL PASS (render-check terminal)" : `\nFAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
});
