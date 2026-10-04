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
global.__bodyNodes = [];
if (!global.document) {
  global.document = {
    visibilityState: "visible",
    documentElement: { lang: "" },
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({
      className: "",
      textContent: "",
      style: {},
      children: [],
      listeners: {},
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(kind, fn) {
        (this.listeners[kind] = this.listeners[kind] || []).push(fn);
      },
      remove() {
        const at = global.__bodyNodes.indexOf(this);
        if (at >= 0) global.__bodyNodes.splice(at, 1);
      },
      setAttribute() {},
      removeAttribute() {},
    }),
    head: { appendChild: () => {} },
    body: {
      classList: { add() {}, remove() {} },
      appendChild: (node) => {
        global.__bodyNodes.push(node);
        return node;
      },
    },
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

// 桩（dock 现在依赖 react/jsx-runtime/primitives，monitor 也用同一套）
let stateSeq = 0;
const stateStore = new Map();
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
  // memo 只影响重渲染取舍，桩直接透传组件本体
  memo: (component) => component,
};
const jsxRuntimeStub = {
  Fragment: function Fragment() {},
  jsx: (type, props) => { callLog.push(["jsx", type, props]); return { type, props, $$dshk: "jsx" }; },
  jsxs: (type, props) => { callLog.push(["jsxs", type, props]); return { type, props, $$dshk: "jsxs" }; },
};
const reactDomStub = { createPortal: (children) => ({ type: "portal", props: { children }, $$dshk: "portal" }) };
const jsxPrim = (tag) => (props) => jsxRuntimeStub.jsxs(tag, props);
const primStub = {
  Tooltip: jsxPrim("dsw-tooltip"),
  useAnchoredPosition: () => null,
  useDismissOnOutsidePointer: () => {},
  SettingsForm: jsxPrim("dsw-settings-form"),
  SettingsValueField: jsxPrim("dsw-settings-field"),
  Switch: jsxPrim("dsw-switch"),
  SegmentedTabs: jsxPrim("dsw-segmented-tabs"),
  Tag: jsxPrim("dsw-tag"),
};
let callLog = [];

// 1) 共享底座（kitBase 内联在根包 client bundle）→ monitor 的共享面来源
const dockExports = loadBundle(__dirname + "/../client/bundle.js", (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return jsxRuntimeStub;
  if (name === "react-dom") return reactDomStub;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
});
check(
  "底座共享面齐全（kit 三件套/轻提示/剪贴板/locale store/mainRowOf/createConfigPage）",
  [dockExports.kitGetJson, dockExports.kitJson, dockExports.flashToast, dockExports.writeClipboard, dockExports.resolveZh, dockExports.subscribeLocale, dockExports.getLocaleVersion, dockExports.mainRowOf, dockExports.createConfigPage].every(
    (fn) => typeof fn === "function",
  ),
);

// 组件模块随根 bundle 一次加载组装
const comps = dockExports.monitor;

check("monitor 导出 apply（client 插件形状）与 usageIsPeak", typeof comps.apply === "function" && typeof comps.usageIsPeak === "function");

// 2.5) apply 激活契约：apply 期只经 slots.inject 等声明（composer.dock 由官方
//      conversation 挂载期声明，直接 register 会抛 not declared）；服务捕获、
//      续跑器节拍与通知接线都在 apply 里装配
async function checkApply() {
  const injects = [];
  const registered = [];
  const seatInjects = [];
  const ctxStub = {
    inject: (deps, cb) => injects.push(deps),
    slots: {
      register: (seat, comp) => registered.push(seat),
      inject: (key, cb) => { seatInjects.push(key); cb(); },
    },
    effect: (fn) => {},
  };
  const prevInterval = global.setInterval;
  global.setInterval = () => 0; // 续跑器节拍不真起（Node 的 interval 会吊住进程）
  const listeners = [];
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = { ...prevDoc, addEventListener: (k, fn) => listeners.push(["doc", k]) };
  global.window = { ...prevWin, addEventListener: (k, fn) => listeners.push(["win", k]) };
  let applyErr = null;
  try { await comps.apply(ctxStub); } catch (e) { applyErr = e; }
  global.setInterval = prevInterval;
  global.document = prevDoc;
  global.window = prevWin;
  check("U apply 激活不抛错", applyErr === null);
  check("U apply 声明 modelDirectories/sessions/remote 依赖", JSON.stringify(injects[0]) === JSON.stringify(["modelDirectories"]) && injects.some((d) => d[0] === "sessions") && injects.some((d) => d[0] === "remote" && d[1] === "sessions"));
  check("U apply 槽位与配置页都经 slots.inject 等声明", seatInjects.filter((k) => k === "conversation.composer.dock").length === 2 && seatInjects.includes("plugins.row.config") && !seatInjects.includes("conversation.session.header.actions"));
  const seat = (id) => registered.find((s) => s.id === id);
  check("U 槽位座席：用量芯片 composer.dock order 6", seat("dsh-kit-usage") && seat("dsh-kit-usage").order === 6);
  check("U 槽位座席：复读提示条 composer.dock order 5", seat("dsh-kit-monitor") && seat("dsh-kit-monitor").order === 5);
  check("U 头部状态条座位已随 429 机制退役", seat("dsh-kit-monitor-bg") === undefined);
  const cfgKeys = registered.filter((s) => s.name === "plugins.row.config").map((s) => s.key);
  check("U 配置页挂本组件行（单包单口径 key）", cfgKeys.includes("dsh-kit#monitor") && cfgKeys.length === 1);
}

// 10d) 会话通知判定核心（notifyDiffCore 依赖注入直测）：running true→false 的沿
//      → 完成通知；待回应 key 变化 → 提问/批准通知。抑制：总开关与分类开关、
//      页面在前台且事件就是当前会话、子会话、首帧播种；消失会话的状态回收。
{
  const freshState = () => ({ running: new Map(), pendingKey: new Map(), primed: false });
  const listOf = (rows, current) => ({
    ids: rows.map((r) => r.id),
    byId: Object.fromEntries(
      rows.map((r) => [r.id, { running: r.running === true, displayTitle: r.title ?? r.id, origin: r.origin }]),
    ),
    current,
  });
  const cfgAll = { notifyEnabled: true };

  // —— 沿检测：首帧播种，收尾才发；同一快照重复读不重发 ——
  const st1 = freshState();
  const rows1 = [{ id: "n1", running: true }];
  check("N 首帧播种不发通知（页面刚打开不算完成）", comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll).length === 0);
  rows1[0].running = false;
  const ev1 = comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll);
  check("N 回合收尾发完成通知（带会话标题）", ev1.length === 1 && ev1[0].kind === "complete" && ev1[0].sessionId === "n1" && ev1[0].title === "n1");
  check("N 快照重读不重发（沿只认一次）", comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll).length === 0);
  rows1[0].running = true;
  comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll);
  rows1[0].running = false;
  check("N 第二轮收尾再发一次", comps.notifyDiffCore(st1, listOf(rows1, "n1"), cfgAll).length === 1);

  // —— 抑制：页面可见且聚焦、事件又正是当前看的会话（人就在跟前）——
  const st2 = freshState();
  const rows2 = [{ id: "n2", running: true }];
  comps.notifyDiffCore(st2, { ...listOf(rows2, "n2"), foreground: true }, cfgAll);
  rows2[0].running = false;
  check("N 前台且是当前会话：不打扰", comps.notifyDiffCore(st2, { ...listOf(rows2, "n2"), foreground: true }, cfgAll).length === 0);
  const st3 = freshState();
  const rows3 = [{ id: "n3", running: true }, { id: "n4", running: true }];
  comps.notifyDiffCore(st3, { ...listOf(rows3, "n3"), foreground: true }, cfgAll);
  rows3[1].running = false;
  const ev3 = comps.notifyDiffCore(st3, { ...listOf(rows3, "n3"), foreground: true }, cfgAll);
  check("N 前台但收尾的是另一个会话：照发", ev3.length === 1 && ev3[0].sessionId === "n4");
  // 对话小窗正显示的那条同样算「人在跟前」：小窗开着时那条收尾不再弹系统通知
  const stW = freshState();
  const rowsW = [{ id: "w1", running: true }];
  comps.notifyDiffCore(stW, { ...listOf(rowsW, "main1"), watched: "w1", foreground: true }, cfgAll);
  rowsW[0].running = false;
  check("N 前台且小窗正显示这条：不打扰（主面选中的却是另一条）", comps.notifyDiffCore(stW, { ...listOf(rowsW, "main1"), watched: "w1", foreground: true }, cfgAll).length === 0);
  const stW2 = freshState();
  const rowsW2 = [{ id: "w2", running: true }];
  comps.notifyDiffCore(stW2, { ...listOf(rowsW2, "main1"), watched: "other", foreground: true }, cfgAll);
  rowsW2[0].running = false;
  check("N 前台但小窗显示的是另一条：照发", comps.notifyDiffCore(stW2, { ...listOf(rowsW2, "main1"), watched: "other", foreground: true }, cfgAll).length === 1);

  // —— 开关（就一个总开关；关闭期间照常记沿，打开后不补发）与子会话 ——
  const st4 = freshState();
  const rows4 = [{ id: "n5", running: true }];
  comps.notifyDiffCore(st4, listOf(rows4, null), { notifyEnabled: false });
  rows4[0].running = false;
  check("N 总开关关闭：不发", comps.notifyDiffCore(st4, listOf(rows4, null), { notifyEnabled: false }).length === 0);
  check("N 关掉期间记下的沿不补发（重开也静默）", comps.notifyDiffCore(st4, listOf(rows4, null), cfgAll).length === 0);
  const st5 = freshState();
  const rows5 = [{ id: "n6", running: true, origin: "subagent" }];
  comps.notifyDiffCore(st5, listOf(rows5, null), cfgAll);
  rows5[0].running = false;
  check("N 子会话收尾不发（导航细节属噪音）", comps.notifyDiffCore(st5, listOf(rows5, null), cfgAll).length === 0);

  // —— 归档：归档动作（stopActivity）自己停掉会话的活，那条 running 沿是用户动作
  //    的回声，不是「回合收尾」；归档的会话仍在列表里，落定判定挡不住，在沿这层挡 ——
  const st6 = freshState();
  const rows6 = [{ id: "n7", running: true }, { id: "n8", running: true }];
  comps.notifyDiffCore(st6, listOf(rows6, null), cfgAll);
  rows6[0].running = false;
  rows6[1].running = false;
  const ev6 = comps.notifyDiffCore(st6, { ...listOf(rows6, null), archived: ["n7"] }, cfgAll);
  check("N 归档的会话收尾不发（归档动作自己停的），同批其余会话照发", ev6.length === 1 && ev6[0].sessionId === "n8");
  rows6[0].running = true;
  rows6[1].running = true;
  comps.notifyDiffCore(st6, { ...listOf(rows6, null), archived: ["n7"] }, cfgAll);
  rows6[0].running = false;
  rows6[1].running = false;
  check("N 归档集给 Set 形也认", comps.notifyDiffCore(st6, { ...listOf(rows6, null), archived: new Set(["n7", "n8"]) }, cfgAll).length === 0);

  // —— 提问/批准/计划评审：走事件瀑布那条口直接投递，判定核心只管回合收尾。
  //    这里直测它俩共用的分类与正文取法（宿主没有 uiSession.pendingInteractions
  //    这个 store，官方待回应投影那条口在生产上永远拿不到东西，已删）——
  const askQ = (question, detail) => ({ questions: [{ question, detail }] });
  check("N 提问原样成类", comps.notifyKindOf("question", askQ("去不去？")) === "question");
  check(
    "N 计划评审（intent=plan-review）单独成类",
    comps.notifyKindOf("question", { questions: [{ question: "批准？", intent: { kind: "plan-review" } }] }) === "plan",
  );
  check("N 批准原样成类", comps.notifyKindOf("approval", {}) === "approval");
  check("N 提问正文取首问原文", comps.notifyBodyOf(askQ("选哪个方案？"), "question") === "选哪个方案？");
  check("N 批准有理由时取理由", comps.notifyBodyOf({ reason: "要写盘上了", toolName: "write" }, "approval") === "要写盘上了");
  check("N 批准无理由时用工具名兜底", /pwsh/.test(comps.notifyBodyOf({ reason: "", toolName: "pwsh" }, "approval")));
  check(
    "N 计划评审正文取计划首个标题",
    comps.notifyBodyOf({ questions: [{ question: "批准？", detail: "# 重构终端坞\n\n1. 拆模块" }] }, "plan") === "重构终端坞",
  );
  check(
    "N 计划无标题时退回提问原文",
    comps.notifyBodyOf({ questions: [{ question: "批准吗？", detail: "没有标题的计划" }] }, "plan") === "批准吗？",
  );
  check("N 正文折叠空白并按上限截断", comps.notifyBodyOf({ questions: [{ question: "  换行\n与   连续空白  " }] }, "question") === "换行 与 连续空白");

  // 会话消失 → 沿回收（列表里没有的会话不再参与判定）
  const st8 = freshState();
  const rows8 = [{ id: "n11", running: true }];
  comps.notifyDiffCore(st8, listOf(rows8, null), cfgAll);
  comps.notifyDiffCore(st8, { ids: [], byId: {}, current: undefined }, cfgAll);
  check("N 会话消失后状态回收", !st8.running.has("n11"));
}
// 10e) 收尾判定（notifyCompleteSettled 依赖注入直测）：限流失败也会让 running 落地，
//      续跑器 2s 后才排「继续」——延迟判定必须把待续跑的失败挡掉不发通知
{
  const sessionsOf = (running) => ({
    list: { getSnapshot: () => ({ ids: ["n14"], byId: { n14: { running, displayTitle: "会话 P" } }, current: null }) },
    open: () => {},
  });
  const ev = { kind: "complete", sessionId: "n14", title: "会话 P" };
  const posted = [];
  const prevNotification = global.Notification;
  class TestNote {
    constructor(title, opts) {
      posted.push({ title, body: opts && opts.body, tag: opts && opts.tag });
    }
    close() {}
  }
  TestNote.permission = "granted";
  global.Notification = TestNote;
  try {
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(true), ev);
    check("N 回合又跑起来（沿抖动）不发收尾通知", posted.length === 0);
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), { ...ev, kind: "complete" });
    check("N 真收尾发完成通知", posted.length === 1 && /回合完成|turn finished/.test(posted[0].title));
    check("N 通知不带 tag（带 tag 时 Windows 只替换不展示）", posted[0]?.tag === undefined);
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), { ...ev, kind: "error" });
    check(
      "N 出错的回合换文案（不报完成）",
      posted.length === 1 && /回合出错|turn errored/.test(posted[0].title) && !/回合完成|turn finished/.test(posted[0].title),
    );
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), { ...ev, kind: "aborted" });
    check("N 中止的回合换文案", posted.length === 1 && /已中止|turn stopped/.test(posted[0].title));
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), { ...ev, kind: "loopBreak" });
    check("N 熔断中止的回合有专用文案", posted.length === 1 && /死循环已停止|dead loop stopped/.test(posted[0].title));
    posted.length = 0;
    comps.notifyCompleteSettled({ list: { getSnapshot: () => ({ ids: [], byId: {}, current: null }) } }, ev);
    check("N 会话已不在列表：不发", posted.length === 0);
  } finally {
    global.Notification = prevNotification;
  }
}
// 10e-1) 事件 scope 的 id 形式：scopeOf 给 `session-<uuid>`，会话列表与 openSession
//        认裸 id——不归一会取不到会话名、点提醒也跳不过去
{
  const list = { byId: { "uuid-1": { displayTitle: "会话 S" } } };
  const sessions = { list: { getSnapshot: () => ({ byId: list.byId }) } };
  check("N 裸 id 原样返回", comps.notifySessionId(sessions, "uuid-1") === "uuid-1");
  check("N session- 前缀归一到裸 id", comps.notifySessionId(sessions, "session-uuid-1") === "uuid-1");
  check("N 列表里没有就原样留着", comps.notifySessionId(sessions, "session-uuid-2") === "session-uuid-2");
  check("N 空值不炸", comps.notifySessionId(sessions, undefined) === "");
}

// 10e-2) 投递只有一条路：系统通知。发不出去（无 API / 被拒）就是不发，
//        不再有页内提醒或标题闪烁这类第二层
{
  const sessionsOf = (running, id = "n15") => ({
    list: {
      getSnapshot: () => ({
        ids: [id],
        byId: { [id]: { running, displayTitle: "会话 Q" } },
        current: null,
      }),
    },
    open: () => {},
  });
  const prevNotification = global.Notification;
  const posted = [];
  class TestNote2 {
    constructor(title) {
      posted.push(title);
    }
    close() {}
  }
  TestNote2.requestPermission = () => {};
  global.Notification = TestNote2;
  const ev = (id) => ({ kind: "complete", sessionId: id, title: "会话 Q" });
  const nodes = () => global.__bodyNodes.map((n) => n.className);
  try {
    global.__bodyNodes.length = 0;
    TestNote2.permission = "granted";
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), ev("n15"));
    check("N 授权后发系统通知", posted.length === 1 && /会话 Q/.test(posted[0]));
    // 权限未定也照发（不少壳不弹授权框，卡在等 granted 等于永远不发）
    TestNote2.permission = "default";
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false, "n16"), ev("n16"));
    check("N 权限未定也发", posted.length === 1);
    // 被拒 / 没有这个 API：一条都不发，页面上也不留第二层
    TestNote2.permission = "denied";
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false, "n16"), ev("n16"));
    check("N 权限被拒不硬发", posted.length === 0);
    global.Notification = undefined;
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false, "n16"), ev("n16"));
    check("N 没有 Notification API 也不炸", posted.length === 0);
    check("N 页面上不留任何替代层", nodes().length === 0);
  } finally {
    global.Notification = prevNotification;
    global.__bodyNodes.length = 0;
  }
}

// 10e) 熔断分类识别（notifyTurnKind）：宿主侧 loop-breaker 走
//      cancel({kind:'hook', reason:'dsh-kit:dead-loop'})，turn/end 落地为
//      {kind:'aborted', reason:{kind:'hook', reason:'dsh-kit:dead-loop'}}——
//      必须与「人点了停止」区分开。
{
  const LOOP_CAUSE = { kind: "hook", reason: "dsh-kit:dead-loop" };
  const abortedOfLoop = { kind: "aborted", reason: LOOP_CAUSE };
  const abortedByUser = { kind: "aborted", reason: { kind: "user" } };
  check("T 熔断 cause → loopBreak", comps.notifyTurnKind(abortedOfLoop) === "loopBreak");
  check("T 人为停止 → aborted（不误报熔断）", comps.notifyTurnKind(abortedByUser) === "aborted");
  check("T completed → complete", comps.notifyTurnKind({ kind: "completed" }) === "complete");
  check("T error → error", comps.notifyTurnKind({ kind: "error" }) === "error");
  check("T blocked → blocked", comps.notifyTurnKind({ kind: "blocked" }) === "blocked");
  check("T max-tokens → maxTokens", comps.notifyTurnKind({ kind: "max-tokens" }) === "maxTokens");
  check("T 无 reason（未打开过的会话）→ complete", comps.notifyTurnKind(undefined) === "complete");
  check("T 兼容纯 kind 入参", comps.notifyTurnKind("error") === "error");
}
// 10f) 压缩完成（notifyCompactionCore 依赖注入直测）：事件窗口增量里的
//      compaction/end（无 error）才算一次压缩收尾——首帧与 replace/prepend 只播种
//      （刷新/重连/翻旧页不补报），失败与 prune 不算，按持久 seq 去重；
//      正文取配对 compaction/summary 的被压规模
{
  const cfgAll = { notifyEnabled: true };
  const fresh = () => ({ compactions: new Map() });
  const evt = (seq, type, data) => ({ type: "event", event: { type, seq, time: seq, data } });
  const end = (seq, extra) => evt(seq, "compaction/end", { compactionId: `k${seq}`, turn: null, ...extra });
  const summary = (seq, id, tokens) => evt(seq, "compaction/summary", { compactionId: id, shadowedTokenCount: tokens });
  const appended = (entries) => ({ kind: "append", entries });
  const input = (over) => ({
    sessionId: "c1",
    title: "会话 C",
    entries: [],
    change: null,
    origin: undefined,
    current: null,
    foreground: false,
    ...over,
  });

  // 首帧（页面刚打开/刚上台）：窗口里已经躺着的旧压缩只播种不报
  const st1 = fresh();
  const history = [summary(10, "k10", 12345), evt(11, "compaction/end", { compactionId: "k10", turn: null })];
  check("C 首帧窗口里已有的压缩只播种不报（刷新不重报历史）", comps.notifyCompactionCore(st1, input({ entries: history, change: { kind: "replace", entries: history } }), cfgAll).length === 0);
  const fresh1 = [...history, summary(12, "k12", 12345), evt(13, "compaction/end", { compactionId: "k12", turn: 3 })];
  const out1 = comps.notifyCompactionCore(st1, input({ entries: fresh1, change: appended([summary(12, "k12", 12345), evt(13, "compaction/end", { compactionId: "k12", turn: 3 })]) }), cfgAll);
  check("C 增量里的压缩收尾发通知（标题带会话名）", out1.length === 1 && out1[0].kind === "compact" && out1[0].title === "会话 C");
  check("C 正文取被压掉历史的规模（k 量级）", /12\.3k/.test(out1[0]?.body ?? "") && /压缩|compacted/i.test(out1[0]?.body ?? ""));
  check("C 同一条重复投递不报两次", comps.notifyCompactionCore(st1, input({ entries: fresh1, change: appended([evt(13, "compaction/end", { compactionId: "k12", turn: 3 })]) }), cfgAll).length === 0);

  // 失败收尾与模型无关的 prune 都不是"压缩完成"
  const st2 = fresh();
  comps.notifyCompactionCore(st2, input({ change: appended([]) }), cfgAll);
  check("C 带 error 的压缩收尾不报（那个回合的失败另有报法）", comps.notifyCompactionCore(st2, input({ entries: [end(21, { error: "summarize failed" })], change: appended([end(21, { error: "summarize failed" })]) }), cfgAll).length === 0);
  check("C 模型无关的 prune 不报", comps.notifyCompactionCore(st2, input({ entries: [evt(22, "compaction/prune", { shadowedTokenCount: 900 })], change: appended([evt(22, "compaction/prune", { shadowedTokenCount: 900 })]) }), cfgAll).length === 0);

  // 抑制：前台且正看这个会话、开关、子会话——与回合收尾同一套判据
  const st3 = fresh();
  comps.notifyCompactionCore(st3, input({ change: appended([]) }), cfgAll);
  check("C 前台且是当前会话：不打扰", comps.notifyCompactionCore(st3, input({ entries: [end(31)], change: appended([end(31)]), current: "c1", foreground: true }), cfgAll).length === 0);
  check("C 前台但压缩的是另一个会话：照发", comps.notifyCompactionCore(st3, input({ sessionId: "c2", entries: [end(32)], change: appended([end(32)]), current: "c1", foreground: true }), cfgAll).length === 1);
  check("C 压缩提醒同受总开关门控", comps.notifyCompactionCore(st3, input({ entries: [end(33)], change: appended([end(33)]) }), { notifyEnabled: false }).length === 0);
  check("C 子会话压缩不发（导航细节属噪音）", comps.notifyCompactionCore(st3, input({ entries: [end(35)], change: appended([end(35)]), origin: "subagent" }), cfgAll).length === 0);

  // 重连重放（replace）与翻旧页（prepend）不报；之后落地的新压缩照报
  const st4 = fresh();
  comps.notifyCompactionCore(st4, input({ entries: [end(40)], change: { kind: "replace", entries: [end(40)] } }), cfgAll);
  check("C 重连重放（replace）不补发", comps.notifyCompactionCore(st4, input({ entries: [end(40)], change: { kind: "replace", entries: [end(40)] } }), cfgAll).length === 0);
  check("C 翻旧页（prepend）带出的旧压缩不报", comps.notifyCompactionCore(st4, input({ entries: [end(39), end(40)], change: { kind: "prepend", entries: [end(39)] } }), cfgAll).length === 0);
  check("C 重放之后的新压缩照报", comps.notifyCompactionCore(st4, input({ entries: [end(40), end(41)], change: appended([end(41)]) }), cfgAll).length === 1);

  // 摘要事件不在窗口（配对失败）→ 退回纯完成文案
  const st5 = fresh();
  comps.notifyCompactionCore(st5, input({ change: appended([]) }), cfgAll);
  const out5 = comps.notifyCompactionCore(st5, input({ entries: [end(51)], change: appended([end(51)]) }), cfgAll);
  check("C 规模未知时只报完成", out5.length === 1 && /压缩完成|compaction finished/i.test(out5[0].body));
}


// 10) MonitorLine（复读提示条）：空闲/未命中时渲染 null（占位不占视觉）；
//     桩 useEffect 不执行 → 扫描不跑，只验证渲染体不抛异常；实机动作由宿主守卫执行。
callLog = [];
const fakeSnap = {
  legacy: {
    nodes: [{ kind: "assistant", seq: 1 }, { kind: "turn-error", seq: 2, code: "RATE_LIMIT", message: "x" }],
    partial: null,
  },
};
out = comps.MonitorLine({
  useChat: (sel) => sel(fakeSnap),
  useSession: (sel) => sel({ running: false }),
  useInput: (sel) => sel({ draft: "" }),
  inputActions: { setDraft() {}, submit() {} },
  sessionId: "s1",
});
check("MonitorLine 空闲渲染无异常（null/条）", out === null || (typeof out === "object" && !!out));


// 10b) 句子级复读判据（客户端手抄副本）：正常长文/结构重复不误报，同句或连续几句
//      重复命中；下面的 10b3 用同一语料与宿主 dist 逐条比对，防两份漂移
const rep = (unit, n) => unit.repeat(n);
const longText = (() => {
  let t = "";
  for (let i = 0; t.length < 65000; i++) t += `第 ${i} 步：检查模块 m${i} 的边界条件与错误分支，然后记录结论。\n`;
  return t;
})();
const numbered = Array.from({ length: 40 }, (_, i) => `${i + 1}. 检查第 ${i + 1} 项配置`).join("\n");
const table = "| 项目 | 状态 |\n|---|---|\n" + Array.from({ length: 30 }, (_, i) => `| 模块${i} | 通过 |`).join("\n");
const code = "\u0060\u0060\u0060js\n" + Array.from({ length: 40 }, (_, i) => `  const v${i} = compute(${i});`).join("\n") + "\n\u0060\u0060\u0060";
check("正常长文（6.5 万字符、不重复）不误报", comps.monitorDetectLoop(longText) === null);
check("编号列表（结构相同、内容不同）不误报", comps.monitorDetectLoop(numbered) === null);
check("markdown 表格不误报", comps.monitorDetectLoop(table) === null);
check("代码块（缩进/分号重复）不误报", comps.monitorDetectLoop(code) === null);
check("短噪声「好。」连说 5 遍不误报", comps.monitorDetectLoop(rep("好。", 5)) === null);
check("重复之后说了别的（已自愈）不误报", comps.monitorDetectLoop(rep("这段在复读。", 3) + "后面是完全不同的一句收尾。") === null);
{
  const h = comps.monitorDetectLoop(rep("这个方案需要再确认一下。", 3));
  check("同一句话连说 3 遍命中（1 句块 × 3 遍）", h !== null && h.units === 1 && h.copies === 3);
}
{
  const h = comps.monitorDetectLoop(rep("先定位问题。再修复它。", 3));
  check("两句话绕圈 3 遍命中（2 句块）", h !== null && h.units === 2 && h.copies === 3);
}
{
  const h = comps.monitorDetectLoop(rep("第一步定位文件。第二步读取内容。第三步修改配置。", 3));
  check("三句话绕圈 3 遍命中（3 句块）", h !== null && h.units === 3 && h.copies === 3);
}
check("尾部未完成的第 4 句不参与判定", comps.monitorDetectLoop(rep("这个方案需要再确认一下。", 3) + "这个方案")?.copies === 3);
check("只有 2 个完整重复句 + 半句：不命中", comps.monitorDetectLoop(rep("这个方案需要再确认一下。", 2) + "这个方案") === null);
{
  const seg = comps.monitorSegment("Version 1.2.3 is ready. Next sentence. 中文一句。");
  check("切句：英文句点断句、版本号里的点不断、尾句已收束", seg.length === 3 && seg[0].text === "Version 1.2.3 is ready." && seg[2].complete === true);
}
check("空文本安全", comps.monitorDetectLoop("") === null && comps.monitorSegment("").length === 0);

// 10b3) 宿主与客户端判据同源（客户端是手抄副本，用同一语料逐条比对防漂移）
async function checkGuardParity() {
  let host = null;
  try {
    host = await import(`file://${__dirname.replace(/\\/g, "/")}/../dist/monitor/loop-guard.js`);
  } catch {
    console.log("NOTE  宿主判据 dist 缺失，跳过同源比对");
    return;
  }
  const corpus = [
    longText,
    numbered,
    table,
    code,
    rep("好。", 5),
    rep("这个方案需要再确认一下。", 3),
    rep("先定位问题。再修复它。", 3),
    rep("第一步定位文件。第二步读取内容。第三步修改配置。", 3),
    rep("这个方案需要再确认一下。", 3) + "这个方案",
    rep("这段在复读。", 3) + "后面是完全不同的一句收尾。",
    "Version 1.2.3 is ready. Next sentence. 中文一句。",
    "",
  ];
  const sig = (h) => (h === null ? "null" : `${h.units}/${h.copies}/${h.chars}`);
  const drift = [];
  for (const text of corpus) {
    const a = sig(comps.monitorDetectLoop(text));
    const b = sig(host.detectLoop(text));
    if (a !== b) drift.push(`${a}≠${b}`);
  }
  check(`宿主与客户端判据同源（${corpus.length} 条语料${drift.length ? "，漂移：" + drift.join(",") : "，无漂移"}）`, drift.length === 0);
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
  check("U 表外年份工作日照常标峰", comps.usageIsPeak("deepseek", at(2027, 1, 5, 10, 0)) === true);
  check("U opencode 无时段不标", comps.usageIsPeak("opencode", at(2026, 9, 23, 10, 0)) === false);
}

// 4) 用量芯片开关回落本组件配置页（组件 Config 是唯一真源）：快照不可达按默认开；
//    开关字段在第一组「用量与余额」页签渲染，值取内置默认；内置默认与宿主 schema
//    （src/monitor/index.ts）逐项同值——改必须两处同改，漂移即红。
function checkConfigSurface() {
  const bundleSrc = fs.readFileSync(__dirname + "/../client/bundle.js", "utf8");
  const hostSrc = fs.readFileSync(__dirname + "/../src/monitor/index.ts", "utf8");
  const usageSrc = fs.readFileSync(__dirname + "/../src/monitor/usage.ts", "utf8");
  check("U 快照不可达时芯片开关回落默认开", comps.cfgFromSnapshot(null).usageEnabled === true);
  const fakeForm = { state: { status: "ready", value: { ...comps.M_CFG_DEFAULTS }, revision: 3, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  comps.MonitorConfigPage({ view: "page", form: fakeForm });
  const tabs = callLog.find((c) => c[1] === primStub.SegmentedTabs);
  check(
    "U 配置页三组页签（用量与余额在前）",
    !!tabs && tabs[2].items.length === 3 && tabs[2].items[0].value === "kcfgGroupUsage" && tabs[2].value === "kcfgGroupUsage",
  );
  const sw = callLog.filter((c) => c[1] === primStub.Switch);
  check(
    "U 用量开关是本页签首个开关且带说明文案",
    sw.length === 1 && sw[0][2].checked === true && ["余额与用量芯片", "Balance & usage chip"].includes(sw[0][2].label),
  );
  const drift = [];
  let compared = 0;
  for (const m of hostSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)[^,\n]*\.default\(([^)]*)\)\.volatile\(\),?$/gm)) {
    const key = m[1];
    const raw = m[2].trim();
    const expected = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : undefined;
    if (expected === undefined) continue;
    compared++;
    if (comps.M_CFG_DEFAULTS[key] !== expected) drift.push(key);
  }
  check(
    "组件内置默认与宿主 schema 逐项同值（比对 " + compared + " 项；漂移 " + (drift.join("/") || "无") + "）",
    drift.length === 0 && compared === Object.keys(comps.M_CFG_DEFAULTS).length,
  );
  check(
    "用量只认 DeepSeek / OpenCode Go（无 z.ai 卡位）",
    !/zai|glm|bigmodel/i.test(usageSrc) && !bundleSrc.includes("usageZai") && !bundleSrc.includes("monitor/usage/quota/limit"),
  );
}

(async () => {
  await checkApply();
  await checkGuardParity();
  checkPeaks();
  checkConfigSurface();
  console.log(failed === 0 ? "ALL RENDER OK (monitor)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
