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
    documentElement: { lang: "" },
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

// 单包收回：组件模块随根 bundle 一次加载组装（external 桩不再需要）
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
  check("U apply 三个槽位与配置页都经 slots.inject 等声明", seatInjects.filter((k) => k === "conversation.composer.dock").length === 2 && seatInjects.includes("conversation.session.header.actions") && seatInjects.includes("plugins.row.config"));
  const seat = (id) => registered.find((s) => s.id === id);
  check("U 槽位座席：用量芯片 composer.dock order 6", seat("dsh-kit-usage") && seat("dsh-kit-usage").order === 6);
  check("U 槽位座席：监视条 composer.dock order 5", seat("dsh-kit-monitor") && seat("dsh-kit-monitor").order === 5);
  check("U 槽位座席：头部状态条 header.actions order 21", seat("dsh-kit-monitor-bg") && seat("dsh-kit-monitor-bg").order === 21);
  const cfgKeys = registered.filter((s) => s.name === "plugins.row.config").map((s) => s.key);
  check("U 配置页挂本组件行（两种包名口径的 key 都在）", cfgKeys.includes("dsh-kit#monitor") && cfgKeys.includes("dsh-kit-monitor#monitor"));
}

// 10c) 全局 429 续跑器核心（monitorTickCore 依赖注入直测）：沿检测（running
//      true→false）+ lastAgentError 措辞判定 + 到点发射 + 恢复清零 + capped。
//      lastAgentError 是活镜像（prompt 即清、页面刷新即无），不是持久历史——
//      历史错误没有可触发的沿。
{
  const mkSessions = (rows) => ({
    list: {
      getSnapshot: () => ({
        ids: rows.map((r) => r.id),
        byId: Object.fromEntries(rows.map((r) => [r.id, { running: r.running, displayTitle: "标题" + r.id.slice(-4) }])),
      }),
    },
    binding: (id) => {
      const row = rows.find((r) => r.id === id);
      return {
        session: {
          getSnapshot: () => ({ running: row.running, lastAgentError: row.err }),
          // 真客户端的 prompt() 第一件事就是清镜像 lastAgentError（宿主 client.js）——
          // 桩必须同语义，否则「续跑后同文本再失败」在桩里永远看不到错误沿
          prompt: () => {
            row.prompts = (row.prompts ?? 0) + 1;
            row.err = null;
            return Promise.resolve({ accepted: true });
          },
        },
      };
    },
  });
  const baseCfg = { monitorEnabled: true, monitorWaitMs: 60000, monitorMaxAuto: 10 };
  const T0 = 1_000_000;
  const itemOf = (id) => comps.monitorStore.snapshot.items.find((x) => x.id === id);

  // —— 429 失败沿 → 排等待计划 → 到点发射（sensenova 误标 quota 形态）——
  const r1 = { id: "session-g1", running: true, err: null };
  const s1 = mkSessions([r1]);
  comps.monitorTickCore(s1, baseCfg, T0);
  check("G 运行中不排计划", comps.monitorStore.snapshot.items.length === 0);
  r1.running = false;
  r1.err = '429: {"message":"inference exceeds tpm/rpm limit","type":"rate_limit_error","code":"insufficient_quota"}';
  comps.monitorTickCore(s1, baseCfg, T0 + 2000);
  check("G 429(误标quota)失败沿排等待计划", itemOf("session-g1")?.phase === "waiting");
  comps.monitorTickCore(s1, baseCfg, T0 + 2000 + 60001);
  check("G 到点发 prompt 续跑", r1.prompts === 1);
  check("G 发射后计划清除", itemOf("session-g1") === undefined);
  // —— 第二次失败：continues 累加；同文本新失败在发射后可再次触发（发射即清
  //    handledErr 记账）——
  r1.running = true;
  comps.monitorTickCore(s1, baseCfg, T0 + 70000);
  r1.running = false;
  r1.err = '429: {"message":"inference exceeds tpm/rpm limit","type":"rate_limit_error","code":"insufficient_quota"}';
  comps.monitorTickCore(s1, baseCfg, T0 + 72000);
  check("G 同文本新失败再次排计划", itemOf("session-g1")?.phase === "waiting");
  check("G 计划条目带连续计数", itemOf("session-g1")?.continues === 1);
  comps.monitorTickCore(s1, baseCfg, T0 + 72000 + 60001);
  check("G 第二次续跑发出", r1.prompts === 2);
  // —— 继续成功（正常收尾）→ 连续计数清零 ——
  r1.running = true;
  comps.monitorTickCore(s1, baseCfg, T0 + 80000);
  r1.running = false;
  r1.err = null;
  comps.monitorTickCore(s1, baseCfg, T0 + 82000);
  check("G 正常收尾清零计数", comps.monitorSessions.get("session-g1")?.continues === 0);
  comps.monitorSessions.delete("session-g1");

  // —— 达上限转 capped：停而不续，正常收尾后解除 ——
  const r2 = { id: "session-g2", running: true, err: null };
  const cfg2 = { ...baseCfg, monitorMaxAuto: 2 };
  const s2 = mkSessions([r2]);
  comps.monitorTickCore(s2, cfg2, T0 - 1000); // 基线：运行中（沿检测需要先见过 true）
  for (let round = 0; round < 2; round++) {
    r2.running = false;
    r2.err = "429: rate limited";
    comps.monitorTickCore(s2, cfg2, T0 + round * 100000);
    comps.monitorTickCore(s2, cfg2, T0 + round * 100000 + 60001);
    r2.running = true; // 续跑使回合运行
    comps.monitorTickCore(s2, cfg2, T0 + round * 100000 + 61000);
  }
  r2.running = false;
  r2.err = "429: rate limited";
  comps.monitorTickCore(s2, cfg2, T0 + 300000);
  check("G 连续达上限转 capped 不再排计划", itemOf("session-g2")?.phase === "capped" && r2.prompts === 2);
  r2.running = true; // 用户手动重试（prompt 清错误标记）
  comps.monitorTickCore(s2, cfg2, T0 + 305000);
  r2.running = false;
  r2.err = null;
  comps.monitorTickCore(s2, cfg2, T0 + 310000);
  check("G 正常收尾解除 capped", itemOf("session-g2") === undefined);
  comps.monitorSessions.delete("session-g2");

  // —— 非限流失败（AUTH/终态）不自动续 ——
  const r3 = { id: "session-g3", running: true, err: null };
  const s3 = mkSessions([r3]);
  comps.monitorTickCore(s3, baseCfg, T0 - 1000); // 基线：运行中
  r3.running = false;
  r3.err = "401: {\"message\":\"invalid api key\"}";
  comps.monitorTickCore(s3, baseCfg, T0);
  check("G 非限流失败不排计划", itemOf("session-g3") === undefined);
  comps.monitorSessions.delete("session-g3");

  // —— 取消按钮：计划丢弃且不重排（失败沿已消费）——
  const r4 = { id: "session-g4", running: true, err: null };
  const s4 = mkSessions([r4]);
  comps.monitorTickCore(s4, baseCfg, T0 - 1000); // 基线：运行中
  r4.running = false;
  r4.err = "429: too many requests";
  comps.monitorTickCore(s4, baseCfg, T0);
  check("G 取消前有计划", itemOf("session-g4")?.phase === "waiting");
  comps.monitorCancelPlan("session-g4");
  check("G 取消后计划清除", itemOf("session-g4") === undefined);
  comps.monitorTickCore(s4, baseCfg, T0 + 70000);
  check("G 取消后同一条失败不重排", itemOf("session-g4") === undefined && r4.prompts === undefined);
  // 用户手动重跑一轮后又失败（同文本）→ 运行即清记账，新失败重新触发（用户 prompt
  // 同样会清镜像，桩里显式模拟）
  r4.err = null;
  r4.running = true;
  comps.monitorTickCore(s4, baseCfg, T0 + 80000);
  r4.running = false;
  r4.err = "429: too many requests";
  comps.monitorTickCore(s4, baseCfg, T0 + 82000);
  check("G 取消后手动重跑再失败：重新触发", itemOf("session-g4")?.phase === "waiting");
  comps.monitorSessions.delete("session-g4");

  // —— 忽略按钮（capped）：清标记 + 计数归零；同一条失败保持静默（handledErr
  //    保留），手动重跑后的新失败从零重新给自动续跑额度 ——
  const r4b = { id: "session-g4b", running: true, err: null };
  const cfg4b = { ...baseCfg, monitorMaxAuto: 2 };
  const s4b = mkSessions([r4b]);
  comps.monitorTickCore(s4b, cfg4b, T0 - 1000); // 基线：运行中
  for (let round = 0; round < 2; round++) {
    r4b.running = false;
    r4b.err = "429: rate limited";
    comps.monitorTickCore(s4b, cfg4b, T0 + round * 100000);
    comps.monitorTickCore(s4b, cfg4b, T0 + round * 100000 + 60001);
    r4b.running = true;
    comps.monitorTickCore(s4b, cfg4b, T0 + round * 100000 + 61000);
  }
  r4b.running = false;
  r4b.err = "429: rate limited";
  comps.monitorTickCore(s4b, cfg4b, T0 + 300000);
  check("G 忽略前 capped 在场", itemOf("session-g4b")?.phase === "capped");
  comps.monitorCancelPlan("session-g4b");
  check("G 忽略后条目清除且标记清、计数归零", itemOf("session-g4b") === undefined && comps.monitorSessions.get("session-g4b")?.capped === false && comps.monitorSessions.get("session-g4b")?.continues === 0);
  comps.monitorTickCore(s4b, cfg4b, T0 + 360000);
  check("G 忽略后同一条失败保持静默（不重排不发续跑）", itemOf("session-g4b") === undefined && r4b.prompts === 2);
  r4b.err = null;
  r4b.running = true; // 用户手动重跑（运行即清记账）
  comps.monitorTickCore(s4b, cfg4b, T0 + 400000);
  r4b.running = false;
  r4b.err = "429: rate limited";
  comps.monitorTickCore(s4b, cfg4b, T0 + 420000);
  check("G 忽略后手动重跑再失败：重新排计划且计数从零起", itemOf("session-g4b")?.phase === "waiting" && itemOf("session-g4b")?.continues === 0);
  comps.monitorSessions.delete("session-g4b");

  // —— 到点时回合已被用户手动跑起来：放弃本次（不重复发）——
  const r5 = { id: "session-g5", running: true, err: null };
  const s5 = mkSessions([r5]);
  comps.monitorTickCore(s5, baseCfg, T0 - 1000); // 基线：运行中
  r5.running = false;
  r5.err = "429: limited";
  comps.monitorTickCore(s5, baseCfg, T0);
  check("G 失败先排上计划（后续放弃的前提）", itemOf("session-g5")?.phase === "waiting");
  r5.running = true; // 用户介入
  comps.monitorTickCore(s5, baseCfg, T0 + 70000);
  check("G 到点时回合已在跑：放弃且不发", r5.prompts === undefined && itemOf("session-g5") === undefined);
  comps.monitorSessions.delete("session-g5");

  // —— 归档会话排除（workspaces.archivedSessionIds，侧栏同款归档集）：归档不
  //    从 sessions.list 移除会话，监视器须自行跳过；已排计划在归档 tick 作废 ——
  const r6 = { id: "session-g6", running: true, err: null };
  const s6 = mkSessions([r6]);
  comps.monitorTickCore(s6, baseCfg, T0); // 基线：运行中（未归档）
  r6.running = false;
  r6.err = "429: limited";
  comps.monitorTickCore(s6, baseCfg, T0 + 2000);
  check("G 归档前照常排计划", itemOf("session-g6")?.phase === "waiting");
  comps.monitorTickCore(s6, baseCfg, T0 + 4000, new Set(["session-g6"]));
  check("G 归档后排队计划作废、状态回收", itemOf("session-g6") === undefined && !comps.monitorSessions.has("session-g6"));
  comps.monitorTickCore(s6, baseCfg, T0 + 6000, new Set(["session-g6"]));
  check("G 归档会话不排新计划不发射", itemOf("session-g6") === undefined && r6.prompts === undefined);
  comps.monitorTickCore(s6, baseCfg, T0 + 8000);
  check(
    "G 取消归档恢复监视，但归档期躺着的旧错误不算新鲜失败",
    itemOf("session-g6") === undefined,
  );
  r6.running = true; // 回来后重新跑一轮再失败：新失败照常续
  r6.err = null;
  comps.monitorTickCore(s6, baseCfg, T0 + 10000);
  r6.running = false;
  r6.err = "429: limited";
  comps.monitorTickCore(s6, baseCfg, T0 + 12000);
  check("G 取消归档后新失败照常排计划", itemOf("session-g6")?.phase === "waiting");
  comps.monitorSessions.delete("session-g6");
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
  const pendingOf = (id, item) => new Map([[id, item]]);

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

  // —— 待回应：key 变化即新请求，正文取首问；同一请求只提醒一次 ——
  const st7 = freshState();
  const rows7 = [{ id: "n8", running: true, title: "项目 A" }];
  check(
    "N 首帧播种不发待回应通知（打开页面时已存在的提问不算新的）",
    comps.notifyDiffCore(st7, { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:1", kind: "question", questions: [{ question: "旧问题" }] }) }, cfgAll).length === 0,
  );
  const ev7 = comps.notifyDiffCore(
    st7,
    { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:2", kind: "question", questions: [{ question: "选哪个方案？" }] }) },
    cfgAll,
  );
  check("N 新提问发通知（标题=会话名，正文=问题原文）", ev7.length === 1 && ev7[0].kind === "question" && ev7[0].title === "项目 A" && ev7[0].body === "选哪个方案？");
  check(
    "N 同一请求不重复提醒",
    comps.notifyDiffCore(st7, { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:2", kind: "question", questions: [{ question: "选哪个方案？" }] }) }, cfgAll).length === 0,
  );
  check("N 提问提醒同受总开关门控", comps.notifyDiffCore(st7, { ...listOf(rows7, null), pending: pendingOf("n8", { key: "question:3", kind: "question", questions: [{ question: "又问？" }] }) }, { notifyEnabled: false }).length === 0);
  const ev8 = comps.notifyDiffCore(
    st7,
    { ...listOf(rows7, null), pending: pendingOf("n8", { key: "approval:1", kind: "approval", toolName: "pwsh", reason: "" }) },
    cfgAll,
  );
  check("N 批准请求发通知（无理由时用工具名兜底）", ev8.length === 1 && ev8[0].kind === "approval" && /pwsh/.test(ev8[0].body));
  const ev9 = comps.notifyDiffCore(
    st7,
    { ...listOf(rows7, null), foreground: true, pending: pendingOf("n8", { key: "question:9", kind: "question", questions: [{ question: "已在跑的另一问" }] }) },
    cfgAll,
  );
  check("N 前台但提问的是当前没打开的会话：照发", ev9.length === 1 && ev9[0].kind === "question");
  // 前台 + 当前会话的待回应 → 不打扰（composer 里已经摆着）
  check(
    "N 前台且待回应就在当前会话：不打扰",
    comps.notifyDiffCore(freshState(), { ...listOf([{ id: "n10", running: true }], "n10"), foreground: true, pending: pendingOf("n10", { key: "question:8", kind: "question", questions: [{ question: "x" }] }) }, cfgAll).length === 0,
  );
  // 会话消失 → 状态回收（同 id 再来按新会话处理）
  const st8 = freshState();
  const rows8 = [{ id: "n11", running: true }];
  comps.notifyDiffCore(st8, listOf(rows8, null), cfgAll);
  comps.notifyDiffCore(st8, { ids: [], byId: {}, current: undefined }, cfgAll);
  check("N 会话消失后状态回收", !st8.running.has("n11") && !st8.pendingKey.has("n11"));

  // —— 两个观察口去重：remote 瀑布事件路径（seen 里记的是 questions 数组，官方
  //    待回应投影存的是同一个引用）先处置过的请求，投影那一路不能再提醒一遍 ——
  const st9 = freshState();
  const rows9 = [{ id: "n12", running: true }];
  const seenSet = new WeakSet();
  const qArr = [{ question: "去不去？" }];
  seenSet.add(qArr);
  comps.notifyDiffCore(st9, listOf(rows9, null), cfgAll); // 首帧播种
  check(
    "N 事件路径已处置的提问，投影路径不重复提醒",
    comps.notifyDiffCore(st9, { ...listOf(rows9, null), pending: pendingOf("n12", { key: "question:20", kind: "question", questions: qArr }), seen: seenSet }, cfgAll).length === 0,
  );
  check(
    "N seen 只挡同一次请求（另一次提问照发）",
    comps.notifyDiffCore(st9, { ...listOf(rows9, null), pending: pendingOf("n12", { key: "question:21", kind: "question", questions: [{ question: "另一问" }] }), seen: seenSet }, cfgAll).length === 1,
  );

  // —— 计划评审（exit_plan_mode 的 intent=plan-review，走同一条 user-questions 请求）
  //    单独成类：标题走「等你批准计划」，正文取计划 markdown 的首个标题 ——
  const st10 = freshState();
  const rows10 = [{ id: "n13", running: true, title: "项目 B" }];
  comps.notifyDiffCore(st10, listOf(rows10, null), cfgAll); // 首帧播种
  const evPlan = comps.notifyDiffCore(
    st10,
    {
      ...listOf(rows10, null),
      pending: pendingOf("n13", {
        key: "question:30",
        kind: "plan-review",
        questions: [{ question: "Approve this plan and leave plan mode?", detail: "# 重构终端坞\n\n1. 拆模块" }],
      }),
    },
    cfgAll,
  );
  check("N 计划评审单独成类，正文取计划首标题", evPlan.length === 1 && evPlan[0].kind === "plan" && evPlan[0].body === "重构终端坞" && evPlan[0].title === "项目 B");
  check(
    "N 计划评审无标题时退回提问原文",
    comps.notifyDiffCore(st10, { ...listOf(rows10, null), pending: pendingOf("n13", { key: "question:31", kind: "plan-review", questions: [{ question: "批准吗？", detail: "没有标题的计划" }] }) }, cfgAll)[0]?.body === "批准吗？",
  );
  check(
    "N 计划提醒同受总开关门控",
    comps.notifyDiffCore(st10, { ...listOf(rows10, null), pending: pendingOf("n13", { key: "question:32", kind: "plan-review", questions: [{ question: "x", detail: "# Y" }] }) }, { notifyEnabled: false }).length === 0,
  );
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
      posted.push({ title, body: opts && opts.body });
    }
    close() {}
  }
  TestNote.permission = "granted";
  global.Notification = TestNote;
  const prevSnapshot = comps.monitorStore.snapshot;
  try {
    posted.length = 0;
    comps.monitorStore.snapshot = { items: [{ id: "n14", phase: "waiting" }] };
    comps.notifyCompleteSettled(sessionsOf(false), ev);
    check("N 待续跑的失败沿不发收尾通知", posted.length === 0);
    posted.length = 0;
    comps.monitorStore.snapshot = { items: [] };
    comps.notifyCompleteSettled(sessionsOf(true), ev);
    check("N 回合又跑起来（沿抖动）不发收尾通知", posted.length === 0);
    posted.length = 0;
    comps.notifyCompleteSettled(sessionsOf(false), ev);
    check("N 真收尾发完成通知", posted.length === 1 && /回合完成|turn finished/.test(posted[0].title));
    posted.length = 0;
    comps.monitorStore.snapshot = { items: [{ id: "n14", phase: "capped" }] };
    comps.notifyCompleteSettled(sessionsOf(false), ev);
    check(
      "N 自动续跑放弃（capped）换文案提醒",
      posted.length === 1 && /自动续跑已暂停|auto-continue paused/.test(posted[0].title) && /自动重试|auto-retry/.test(posted[0].body),
    );
    posted.length = 0;
    comps.notifyCompleteSettled({ list: { getSnapshot: () => ({ ids: [], byId: {}, current: null }) } }, ev);
    check("N 会话已不在列表：不发", posted.length === 0);
  } finally {
    comps.monitorStore.snapshot = prevSnapshot;
    global.Notification = prevNotification;
  }
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

// 7.1b) 会话头部 429 状态条（原任务签顶部状态块迁此）：
// 无待续跑/封顶会话 → null（零常驻）；有 → 触发钮（计数），浮层默认收起
comps.monitorStore.snapshot = { items: [] };
out = comps.MonitorBgAction();
check("MonitorBgAction 无后台会话渲染 null（零常驻）", out === null);
comps.monitorStore.snapshot = {
  items: [
    { id: "s1", title: "跑测试", phase: "waiting", fireAt: Date.now() + 8000, continues: 1, max: 5 },
    { id: "s2", title: "爬数据", phase: "capped", fireAt: 0, continues: 5, max: 5 },
  ],
};
callLog = [];
out = comps.MonitorBgAction();
const mbgTrigger = callLog.find((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-mbg-trigger");
const mbgLabel = mbgTrigger && Array.isArray(mbgTrigger[2].children) ? mbgTrigger[2].children.find((ch) => typeof ch === "string") : null;
check("MonitorBgAction 有后台会话出触发钮（429 + 计数=2）", !!out && typeof mbgLabel === "string" && mbgLabel.includes("429") && /2$/.test(mbgLabel));
check("MonitorBgAction 浮层默认收起", !callLog.some((c) => c[2] && c[2].className === "dshk-mbg-menu"));
// 浮层展开（useState #0=open）：waiting 条目出「取消」、capped 条目出「忽略」
stateSeq = 0;
stateStore.clear();
stateStore.set(0, true);
callLog = [];
out = comps.MonitorBgAction();
const mbgMenu = callLog.find((c) => (c[0] === "jsx") && c[2] && c[2].className === "dshk-mbg-menu");
const mbgLines = mbgMenu ? callLog.filter((c) => (c[0] === "jsxs") && c[2] && c[2].className === "dshk-monitor-line") : [];
const mbgBtns = mbgLines.map((c) => c[2].children.find((ch) => ch && ch.props && ch.props.className === "dshk-monitor-cancel")).filter(Boolean);
check("MonitorBgAction 浮层展开：两条目各带钮（waiting=取消、capped=忽略）", !!mbgMenu && mbgLines.length === 2 && mbgBtns.length === 2 && mbgBtns.some((b) => b.props.children === "Cancel") && mbgBtns.some((b) => b.props.children === "Dismiss"));
stateSeq = 0;
stateStore.clear();
comps.monitorStore.snapshot = { items: [] };

// 10) MonitorLine（会话监视条）：空闲无 turn-error 时渲染 null（占位不占视觉）；
//     桩 useEffect 不执行 → 检测逻辑不跑，只验证渲染体不抛异常。
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

// 10a) MonitorLine 渲染全局续跑器状态：watcherStore 有本会话 waiting 条目 →
//      输出监视条（限流文案 + 取消按钮）；capped 条目 → capped 文案
{
  comps.monitorStore.snapshot = {
    items: [{ id: "s1", title: "t", phase: "waiting", fireAt: Date.now() + 30000, continues: 0, max: 10 }],
  };
  callLog = [];
  out = comps.MonitorLine({
    useChat: (sel) => sel(fakeSnap),
    useSession: (sel) => sel({ running: false }),
    useInput: (sel) => sel({ draft: "" }),
    inputActions: { setDraft() {}, submit() {} },
    sessionId: "s1",
  });
  const rendered = JSON.stringify(out);
  // harness 无 documentElement → resolveZh() false → 英文文案
  check("MonitorLine 渲染全局续跑等待条", typeof out === "object" && rendered.includes("auto-continue in") && rendered.includes("rate limit (429)") && rendered.includes("Cancel"));
  comps.monitorStore.snapshot = {
    items: [{ id: "s1", title: "t", phase: "capped", fireAt: 0, continues: 10, max: 10 }],
  };
  out = comps.MonitorLine({
    useChat: (sel) => sel(fakeSnap),
    useSession: (sel) => sel({ running: false }),
    useInput: (sel) => sel({ draft: "" }),
    inputActions: { setDraft() {}, submit() {} },
    sessionId: "s1",
  });
  check("MonitorLine 渲染 capped 条 + 忽略钮", typeof out === "object" && JSON.stringify(out).includes("pausing auto-continue") && JSON.stringify(out).includes("Dismiss"));
  comps.monitorStore.snapshot = { items: [] };
}

// 10b) monitorTailRepeatCount：死循环判定的纯函数（尾部自重叠扫描）
const rep = (unit, n) => unit.repeat(n);
check("尾部重复块 ≥3 次被检出", comps.monitorTailRepeatCount(rep("我不能继续回答这个问题。", 5)) >= 3);
check("尾部重复短块按对齐穷举检出", comps.monitorTailRepeatCount("前文正常叙述。" + rep("ABCDEFGH", 4)) >= 4);
check("普通非重复文本不误报", comps.monitorTailRepeatCount("这是一段完全正常的回复内容，包含各种各样的字符与句子结构，不会触发循环判定。") < 3);
check("短于两倍最短块长的文本不误报", comps.monitorTailRepeatCount("abcabc") < 2);
check("短分隔符块（<8字符）不误报", comps.monitorTailRepeatCount("---\n---\n---\n---\n") < 3);
check("重复不在尾部不算（历史重复已翻篇）", comps.monitorTailRepeatCount(rep("重复片段测样", 5) + "之后是完全不同的收尾内容，正常结束。") < 3);
check("空串安全", comps.monitorTailRepeatCount("") === 1);


// 10c2) 429 续跑的两个误报回归（实测踩过：回合已经做完 / 被手动停止，仍发"继续"）：
//       镜像 lastAgentError 只在 prompt() 里清，正常收尾与手动停止都不清，所以
//       "空闲 + 有 429 文本"并不等于"这次收尾就是 429 造成的"——判据必须带上
//       错误出现的时序（首见时刻 vs 本段空闲起点）
{
  const mkSessions = (rows) => {
    const sessions = rows.map((row) => ({
      getSnapshot: () => ({ running: row.running, lastAgentError: row.err }),
      cancel: () => {
        row.stopped = (row.stopped ?? 0) + 1;
        return Promise.resolve({ ok: true });
      },
      prompt: () => {
        row.prompts = (row.prompts ?? 0) + 1;
        row.err = null; // 真客户端 prompt() 同款：同步清镜像
        return Promise.resolve({ accepted: true });
      },
    }));
    return {
      list: {
        getSnapshot: () => ({
          ids: rows.map((r) => r.id),
          byId: Object.fromEntries(rows.map((r) => [r.id, { running: r.running, displayTitle: "标题" + r.id.slice(-4) }])),
        }),
      },
      // 真客户端里同一会话恒为同一实例（cancel 包装靠这一点生效）：按 id 返回稳定对象
      binding: (id) => {
        const i = rows.findIndex((r) => r.id === id);
        return i < 0 ? null : { session: sessions[i] };
      },
    };
  };
  const baseCfg = { monitorEnabled: true, monitorWaitMs: 60000, monitorMaxAuto: 10 };
  const T0 = 5_000_000;
  const itemOf = (id) => comps.monitorStore.snapshot.items.find((x) => x.id === id);

  // —— 回合中途 429（宿主内部重试 / agent 自己接着干完），最终正常收尾 ——
  const r7 = { id: "session-g7", running: true, err: null };
  const s7 = mkSessions([r7]);
  comps.monitorTickCore(s7, baseCfg, T0); // 基线：运行中
  r7.err = "429: rate limited"; // 中途失败：会话仍在跑
  comps.monitorTickCore(s7, baseCfg, T0 + 2000);
  check("G 运行中出现的 429 不排计划", itemOf("session-g7") === undefined);
  r7.running = false; // 三分钟后正常收尾，镜像里那行 429 原样躺着
  comps.monitorTickCore(s7, baseCfg, T0 + 182000);
  check("G 中途 429 后正常收尾：不续跑（旧逻辑在这里误发）", itemOf("session-g7") === undefined && r7.prompts === undefined);
  comps.monitorTickCore(s7, baseCfg, T0 + 242000); // 再过一个续跑窗口也不补发
  check("G 旧错误一直躺在镜像里也不补发", r7.prompts === undefined && itemOf("session-g7") === undefined);
  comps.monitorSessions.delete("session-g7");

  // —— 用户手动停止（abort 不走 throwError，不发 agent/error；镜像里是更早的 429）——
  const r8 = { id: "session-g8", running: true, err: null };
  const s8 = mkSessions([r8]);
  comps.monitorTickCore(s8, baseCfg, T0); // 基线：运行中
  r8.err = "429: rate limited";
  comps.monitorTickCore(s8, baseCfg, T0 + 2000); // 运行中记下这次失败
  r8.running = false; // 用户点停止
  comps.monitorTickCore(s8, baseCfg, T0 + 60000);
  check("G 手动停止后不续跑", itemOf("session-g8") === undefined && r8.prompts === undefined);
  comps.monitorSessions.delete("session-g8");

  // —— 页面刷新：镜像里带着上一轮的 429，按陈旧播种，不补续 ——
  const r9 = { id: "session-g9", running: false, err: "429: rate limited" };
  const s9 = mkSessions([r9]);
  comps.monitorTickCore(s9, baseCfg, T0); // 首见即"空闲 + 429"（页面刚打开）
  check("G 刷新页面后旧 429 不补续", itemOf("session-g9") === undefined && r9.prompts === undefined);
  r9.err = null; // 之后的新失败照常触发
  r9.running = true;
  comps.monitorTickCore(s9, baseCfg, T0 + 2000);
  r9.running = false;
  r9.err = "429: rate limited";
  comps.monitorTickCore(s9, baseCfg, T0 + 4000);
  check("G 刷新后新失败照常续跑", itemOf("session-g9")?.phase === "waiting");
  comps.monitorSessions.delete("session-g9");

  // —— 到达顺序反转（running 先落地、错误广播后到，同一段空闲内）：仍要续 ——
  const r10 = { id: "session-g10", running: true, err: null };
  const s10 = mkSessions([r10]);
  comps.monitorTickCore(s10, baseCfg, T0); // 基线：运行中
  r10.running = false; // 落地先到
  comps.monitorTickCore(s10, baseCfg, T0 + 2000);
  r10.err = "429: rate limited"; // 错误后到
  comps.monitorTickCore(s10, baseCfg, T0 + 4000);
  check("G 错误晚一拍到达仍算这次收尾的失败", itemOf("session-g10")?.phase === "waiting");
  comps.monitorSessions.delete("session-g10");

  // —— 用户点「停止」：429 与 abort 抢同一个回合时会留下一条很新鲜的失败沿，
  //    停止记账必须把它挡掉（新鲜度判据挡不住这种）——
  const r11 = { id: "session-g11", running: true, err: null };
  const s11 = mkSessions([r11]);
  comps.monitorTickCore(s11, baseCfg, T0); // 基线：运行中（这一步给 cancel 打包装）
  r11.err = "429: rate limited"; // 停止瞬间落地的失败
  void s11.binding("session-g11").session.cancel(); // 用户点停止
  r11.running = false;
  comps.monitorTickCore(s11, baseCfg, T0 + 2000);
  check("G 手动停止后的失败沿不续跑", itemOf("session-g11") === undefined && r11.prompts === undefined);
  r11.err = null; // 用户随后自己重跑一轮又失败：照常续
  r11.running = true;
  comps.monitorTickCore(s11, baseCfg, T0 + 4000);
  r11.running = false;
  r11.err = "429: rate limited";
  comps.monitorTickCore(s11, baseCfg, T0 + 6000);
  check("G 停止后新回合再失败：照常排计划", itemOf("session-g11")?.phase === "waiting");
  comps.monitorSessions.delete("session-g11");
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
  const fakeForm = { state: { status: "ready", value: { ...comps.M_CFG_DEFAULTS, monitorMaxAuto: 2 }, revision: 3, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  comps.MonitorConfigPage({ view: "page", form: fakeForm });
  const tabs = callLog.find((c) => c[1] === primStub.SegmentedTabs);
  check(
    "U 配置页两组页签（用量与余额在前）",
    !!tabs && tabs[2].items.length === 2 && tabs[2].items[0].value === "kcfgGroupUsage" && tabs[2].value === "kcfgGroupUsage",
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
    "用量只认 DeepSeek / OpenCode Go（z.ai 卡位全退役）",
    !/zai|glm|bigmodel/i.test(usageSrc) && !bundleSrc.includes("usageZai") && !bundleSrc.includes("monitor/usage/quota/limit"),
  );
}

(async () => {
  await checkApply();
  checkPeaks();
  checkConfigSurface();
  console.log(failed === 0 ? "ALL RENDER OK (monitor)" : `FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
