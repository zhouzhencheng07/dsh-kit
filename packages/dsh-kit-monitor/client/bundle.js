// dsh-kit-monitor 浏览器半边 —— 用量与监视组件的 client 面。
// 现收纳：余额与用量芯片（UsageLine）+ 会话监视（429 续跑器 / 死循环打断的
// MonitorLine 与头部 429 状态条 MonitorBgAction）+ 会话通知（桌面通知/标题闪烁），
// 组件化自主包迁入。
//
// 数据走宿主 /dsh-kit/usage（key 在宿主侧复用模型配置，浏览器拿不到）。状态带
// 右缘只出**一张**芯片：当前会话选中的模型 provider（modelDirectories 服务按
// sessionId 给的共享目录 store，composer 模型座同源）归类出 deepseek/opencode/
// zai 卡位，端点没配对应 provider 或识别不出（如 sensenova）= 不出。芯片只放
// 数值（¥余额 / 5h 窗口百分比），全名在悬停提示；点芯片浮层贴正上方只出该家
// 明细——定位与关闭复用官方 primitives 的 useAnchoredPosition /
// useDismissOnOutsidePointer / Tooltip，面板样式复刻官方 ContextMeter 浮层
// （哈希类名复用不了，CSS 原样抄）；primitives 缺位（老宿主）降级为右下角
// 固定浮层、无 Tooltip。modelDirectories 是懒就绪服务：就绪时 version++ 通知
// 订阅者重跑 effect，否则「服务后到」的挂载永远拿不到数据源。
//
// 开关 = 本组件自己的 Config（usageEnabled），经 /dsh-kit-monitor/config 拉取：
// 关 = 端点 403 + 芯片不注册数据源，两者一致由同一份配置驱动。
window.__ModuleLoader__.load({
  id: "dsh-kit-monitor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const reactDom = require("react-dom");
    const dock = require("dsh-kit-dock");
    const { kitJson, resolveZh, subscribeLocale, getLocaleVersion } = dock;
    let dswPrimIcons = null;
    try { dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives"); } catch { /* 回退自绘 */ }
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons ? dswPrimIcons[n] : null;
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    // 组件私有文案（usage* 词条随芯片迁入本包）；语言判定/切换响应来自 dock
    const zh = {
      usageRefresh: "刷新",
      usageUpdatedAt: "更新于",
      usageDeepseek: "DeepSeek 余额",
      usageOpencode: "OpenCode Go",
      usageZai: "GLM Coding Plan",
      usageAvailable: "可用",
      usagePaused: "余额不足或已停机",
      usageBalanceTotal: "总余额",
      usageBalanceGranted: "赠送",
      usageBalanceToppedUp: "充值",
      usageW5h: "5 小时窗口",
      usageWeek: "本周窗口",
      usageMonth: "本月窗口",
      usageResets: "重置",
      usageLevel: "套餐",
      usageNoCard: "模型配置未提供此服务的用量数据",
      usageOfficialPage: "官方用量页",
      // 会话监视（429 续跑 / 死循环打断）
      monitorContinueText: "继续",
      monitorLoopBreakText: "检测到你的输出在重复相同内容，可能陷入了死循环。请立即停止重复，简要说明当前状态，换一种方式继续完成任务。",
      monitorCancel: "取消",
      monitorDismiss: "忽略",
      monitorRepeatErr: "重复输出（死循环征兆）",
      monitorErr429: "请求被限流（429）",
      monitorStopping: "监视：检测到重复输出（死循环征兆），正在停止当前回合…",
      monitorCapped: "监视：已连续自动继续 {max} 次，暂停自动续跑（重复输出仍会中止）",
      monitorAutoIn: "监视：检测到{err}，{sec} 秒后自动继续（第 {n}/{max} 次）",
      monitorBgTitle: "429 自动续跑",
      monitorBgItem: "{title}：{sec} 秒后自动继续（第 {n}/{max} 次）",
      monitorBgCapped: "{title}：已连续自动继续 {max} 次，暂停（正常完成一轮后恢复）",
      // 会话通知
      notifyCompleteTitle: "{title} · 回合完成",
      notifyCompleteBody: "点击回到该会话",
      notifyCompactTitle: "{title} · 上下文压缩完成",
      notifyCompactBody: "上下文已压缩完成",
      notifyCompactBodyTokens: "已压缩约 {tokens} tokens 的历史",
      notifyCappedTitle: "{title} · 自动续跑已暂停",
      notifyCappedBody: "连续限流失败，已停止自动重试，点开看看",
      notifyQuestionTitle: "{title} · 等你回答",
      notifyQuestionBody: "agent 提了一个问题",
      notifyApprovalTitle: "{title} · 等你批准",
      notifyApprovalBody: "{tool} 等待批准",
      notifyPlanTitle: "{title} · 等你批准计划",
      notifyPlanBody: "agent 提交了计划等你批准",
      notifyToolFallback: "工具调用",
      // 本组件配置页字段（骨架通用文案在 dock）
      kcfgGroupMonitor: "会话监视与通知",
      kcfgNotifyEnabled: "会话桌面通知",
      kcfgNotifyEnabledHint: "页面不在前台时，回合收尾/压缩完成/agent 提问弹桌面通知。",
      kcfgMonitorEnabled: "会话监视（429 续跑 / 死循环打断）",
      kcfgMonitorEnabledHint: "监视列表内所有会话：429 限流自动续跑 + 当前会话死循环打断。",
      kcfgMonitorWaitMs: "429 等待毫秒（5000–600000）",
      kcfgMonitorWaitMsHint: "429 限流后等待多少毫秒再自动续跑。",
      kcfgMonitorMaxAuto: "429 连续续跑上限（1–10）",
      kcfgMonitorMaxAutoHint: "一轮正常收尾即清零。",
      kcfgMonitorRepeatThreshold: "死循环判定重复次数（2–10）",
      kcfgMonitorRepeatThresholdHint: "流式输出尾部自重叠达到该次数即停止并发打断话术。",
    };
    const en = {
      usageRefresh: "Refresh",
      usageUpdatedAt: "Updated",
      usageDeepseek: "DeepSeek balance",
      usageOpencode: "OpenCode Go",
      usageZai: "GLM Coding Plan",
      usageAvailable: "available",
      usagePaused: "low balance or suspended",
      usageBalanceTotal: "Total",
      usageBalanceGranted: "Granted",
      usageBalanceToppedUp: "Topped up",
      usageW5h: "5-hour window",
      usageWeek: "Weekly window",
      usageMonth: "Monthly window",
      usageResets: "resets",
      usageLevel: "Plan",
      usageNoCard: "No usage data for this service in the model config",
      usageOfficialPage: "Usage dashboard",
      monitorContinueText: "Continue",
      monitorLoopBreakText: "Your output appears to be repeating itself, which suggests an infinite loop. Stop repeating immediately, briefly state the current status, and continue the task in a different way.",
      monitorCancel: "Cancel",
      monitorDismiss: "Dismiss",
      monitorRepeatErr: "repeated output (dead-loop sign)",
      monitorErr429: "rate limit (429)",
      monitorStopping: "Monitor: repeated output detected (dead-loop sign), stopping the current turn…",
      monitorCapped: "Monitor: auto-continued {max} times in a row, pausing auto-continue (repeats are still stopped)",
      monitorAutoIn: "Monitor: {err}; auto-continue in {sec}s (attempt {n}/{max})",
      monitorBgTitle: "429 auto-continue",
      monitorBgItem: "{title}: auto-continue in {sec}s (attempt {n}/{max})",
      monitorBgCapped: "{title}: paused after {max} consecutive continues (resumes after one clean round)",
      notifyCompleteTitle: "{title} · turn finished",
      notifyCompleteBody: "Click to return to this session",
      notifyCompactTitle: "{title} · context compacted",
      notifyCompactBody: "Context compaction finished",
      notifyCompactBodyTokens: "Compacted ~{tokens} tokens of history",
      notifyCappedTitle: "{title} · auto-continue paused",
      notifyCappedBody: "Repeated rate-limit failures stopped the auto-retry — open it to take a look",
      notifyQuestionTitle: "{title} · waiting for your answer",
      notifyQuestionBody: "The agent asked a question",
      notifyApprovalTitle: "{title} · waiting for approval",
      notifyApprovalBody: "{tool} awaits approval",
      notifyPlanTitle: "{title} · plan awaiting approval",
      notifyPlanBody: "The agent submitted a plan for your approval",
      notifyToolFallback: "A tool call",
      kcfgGroupMonitor: "Session monitor & notifications",
      kcfgNotifyEnabled: "Session desktop notifications",
      kcfgNotifyEnabledHint: "Desktop-notify on turn completion / compaction / agent questions while the page is in the background.",
      kcfgMonitorEnabled: "Session monitor (429 resume / loop interrupt)",
      kcfgMonitorEnabledHint: "Watch every listed session: auto-resume on 429 rate limits + loop interruption for the current session.",
      kcfgMonitorWaitMs: "429 wait in ms (5000–600000)",
      kcfgMonitorWaitMsHint: "How long to wait after a 429 before auto-resuming.",
      kcfgMonitorMaxAuto: "429 consecutive resume cap (1–10)",
      kcfgMonitorMaxAutoHint: "One clean round resets the counter.",
      kcfgMonitorRepeatThreshold: "Loop detection repeat count (2–10)",
      kcfgMonitorRepeatThresholdHint: "Stop the turn and send the nudge once streamed output self-overlaps this many times.",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // 组件配置快照：拉本组件自己的 /dsh-kit-monitor/config（用量开关 + 监视/通知
    // 全部字段——组件的 Config schema 是唯一真源）。快照形状与主包同款
    // { status:'ready', value }；端点不可达按全默认处理（与门控同源语义）。
    const M_CFG_DEFAULTS = {
      usageEnabled: false,
      monitorEnabled: true,
      monitorWaitMs: 15000,
      monitorMaxAuto: 5,
      monitorRepeatThreshold: 3,
      notifyEnabled: true,
    };
    let cfgSnap = null;
    const cfgSubs = new Set();
    async function loadCfg() {
      let value = null;
      try {
        const v = await kitJson("/dsh-kit-monitor/config", undefined, (b) => b !== null && typeof b === "object");
        value = v;
      } catch {
        value = null; // 端点不可达：null → cfgFromSnapshot 走内置默认
      }
      cfgSnap = value && typeof value === "object" ? { status: "ready", value } : null;
      for (const fn of cfgSubs) {
        try {
          fn();
        } catch {
          /* 订阅者已卸载 */
        }
      }
    }
    const subscribeCfg = (fn) => {
      cfgSubs.add(fn);
      return () => cfgSubs.delete(fn);
    };
    const getCfgSnapshot = () => cfgSnap;
    /** 从快照提取生效配置（字段缺失/非法逐项回退默认） */
    function cfgFromSnapshot(snap) {
      const out = { ...M_CFG_DEFAULTS };
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return out;
      const v = snap.value;
      out.usageEnabled = v.usageEnabled === true;
      out.monitorEnabled = v.monitorEnabled !== false;
      out.monitorWaitMs =
        Number.isInteger(v.monitorWaitMs) && v.monitorWaitMs >= 5000 && v.monitorWaitMs <= 600000
          ? v.monitorWaitMs
          : M_CFG_DEFAULTS.monitorWaitMs;
      out.monitorMaxAuto =
        Number.isInteger(v.monitorMaxAuto) && v.monitorMaxAuto >= 1 && v.monitorMaxAuto <= 10
          ? v.monitorMaxAuto
          : M_CFG_DEFAULTS.monitorMaxAuto;
      out.monitorRepeatThreshold =
        Number.isInteger(v.monitorRepeatThreshold) && v.monitorRepeatThreshold >= 2 && v.monitorRepeatThreshold <= 10
          ? v.monitorRepeatThreshold
          : M_CFG_DEFAULTS.monitorRepeatThreshold;
      out.notifyEnabled = v.notifyEnabled !== false;
      return out;
    }
    void loadCfg();
    /** 带占位符的文案变体：tf("monitorAutoIn", { sec: 8 }) */
    const tf = (key, vars) => {
      let s = lang()[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) s = s.split(`{${name}}`).join(String(value));
      return s;
    };
    // 主视图会话行判定（0.1.6 会话面多实例化）随会话行共享收进 dock
    const mainRowOf = dock.mainRowOf;

    // ─────────── 会话监视：429 续跑器（所有会话）+ 死循环停止（仅当前会话）───────────
    // 服务捕获座（apply 时赋值）：tick / 死循环停止 / 通知都要经它取 sessions 等
    let slotsCtx = null;

    // ─────────── 全局 429 续跑器（所有会话）+ 死循环停止（仅当前会话）───────────
    // 续跑是单一全局机制（monitorTick 轮询）：监视会话列表里【所有】会话——人
    // 发起任务后离开，任何会话被 429 打断都自动续到任务完成，不要求该会话页开着。
    // 数据源全是官方面（宿主 0.1.5-rc.2 运行时实证）：
    //   枚举+running ← sessions.list 快照（宿主经 api-session/status 推送，与
    //                  会话页是否打开无关）；
    //   失败判定    ← binding(id).session 快照 lastAgentError——agent-loop 对每次
    //                 回合失败发 agent/error → 网关 api-session/error 广播 → 客户端
    //                 镜像置位，文本含原始错误（如 `429: {"message":"inference
    //                 exceeds tpm/rpm limit",...}`）；binding() 对列表内会话惰性
    //                 物化镜像，事件窗口（open）完全不参与——错误走控制流广播。
    //   归档过滤  ← workspaces.list 快照 archivedSessionIds（侧栏同款归档集）。
    //                 归档不从 sessions.list 移除会话（宿主只在 UI 展示层过滤），
    //                 监视器须自行排除：不监视不续跑、待发射计划作废、状态回收，
    //                 否则归档会话残留的 429 标记会被静默续跑。
    //   续跑动作    ← binding.session.prompt([{"继续"}],"queue")（composer 同款
    //                 发送通道）；prompt 第一行同步清空 lastAgentError，同一条
    //                 失败天然不会重复触发。
    // 判定：空闲（list running=false）+ 镜像 lastAgentError 匹配限流特征 + 这次收尾
    // 就是它造成的（新鲜）+ 未处置过（handledErr 记账去重）。只认措辞不认
    // body code——sensenova 的 429 形态不定（insufficient_quota/429001/
    // quota_exceeded_error 都见过，前者会被宿主误分类成 QUOTA 而不内部重试），
    // 稳定的只有 "429: " 前缀（宿主 formatProviderError 拼的 HTTP 状态）和限流
    // 措辞本身。不匹配的失败（AUTH/上下文超限等终态类）不自动续。
    // 「新鲜」是这套判定的命门：镜像只在 prompt() 里清（宿主 client.js），回合正常
    // 收尾、被用户手动停止都不清——镜像里躺着的 429 完全可能是上一轮的旧账。只看
    // "空闲 + 有 429 文本"就续跑，会把已经做完的任务、被手动停下的任务再续一遍
    // （实测踩过）。判据落在观察时序上：错误文本的首次出现时刻必须在本段空闲起点前
    // MONITOR_ERR_WINDOW_MS 内（= 回合刚因它落地）；在镜像里躺过这个窗口的旧错误
    // 一律不触发。页面打开时镜像里已有的错误按陈旧播种（errAt=0），刷新页面不会把
    // 早已结束的任务补续一遍——代价是刷新后不再自动接续旧失败。
    // 另有一道显式闸门：会话被「停止」过（官方停按钮与本插件的死循环打断都调
    // session.cancel，见 monitorWrapCancel）之后落地的失败沿不续跑——429 与 abort
    // 抢同一个回合时会留下一条看着很新鲜的失败沿，新鲜度判据挡不住它。
    // 计数：每会话独立，继续后一轮正常收尾（lastAgentError 为 null）
    // 即清零；连续续跑达 monitorMaxAuto 暂停（capped）。等待期到点时回合又跑起来
    // （用户手动介入）即放弃本次。
    // 约束：浏览器页必须开着（浏览器端方案的天性）；页面关着的兜底是宿主
    // provider 级 retryPolicy（retryableCodes），与本监视器无关。
    // 死循环停止（MonitorLine，composer.dock）：仅当前打开的会话，回合运行中每
    // 1s 扫描流文本尾部自重叠 ≥monitorRepeatThreshold 次 → sessions.cancel() 停
    // 止当前回合，停止完成后发循环打断话术——检测→停→话术一条链，独立于续跑器。
    const MONITOR_TICK_MS = 2000; // 轮询周期：429 是分钟级窗口，2s 跟踪绰绰有余
    const MONITOR_RATE_LIMIT_RE = /\b429\b|rate.?limit|tpm\/rpm/i;
    const MONITOR_ERR_WINDOW_MS = 6000; // 「失败即收尾」窗口（3 个 tick）：错误首见时刻早于
    // 本段空闲起点这么多，说明回合不是因它结束的（旧账），不续跑
    const MONITOR_ABORT_WINDOW_MS = 6000; // 「刚被停止」窗口：停止后落地的失败沿不续跑
    const MONITOR_CANCEL_MARK = "__dshkMonitorCancel"; // cancel 包装标记（防重复包装）
    const MONITOR_SCAN_MS = 1000; // 扫描周期：检测延迟 1-2s；真实死循环以分钟计，绰绰有余
    const MONITOR_MIN_BLOCK = 8; // 重复块最短长度：放过短分隔符/标点（--- 、换行噪声）
    const MONITOR_MAX_BLOCK = 128; // 重复块最长扫描长度：兜住长句循环，扫描成本封顶

    /** 续跑器活动状态快照（仅待续跑 / capped 会话上屏）：snapshot.items ×
     *  {id,title,phase,fireAt,continues,max}。MonitorLine（当前会话条）与工作台
     *  状态块共同订阅。快照整体换身（不可变），uSES 靠身份对比触发重渲染。 */
    const monitorStore = {
      snapshot: { items: [] },
      __sig: "[]",
      subs: new Set(),
      emit() {
        for (const s of this.subs) s();
      },
      subscribe(s) {
        this.subs.add(s);
        return () => this.subs.delete(s);
      },
    };
    /** 每会话运行态（只在 tick 内读写）：running 上次已知位、continues 连续续跑
     *  计数、capped 暂停标记、plan 待发射续跑、handledErr 已处置的错误文本（去重
     *  记账）、materialized 镜像是否已物化、title/max 失败时缓存的展示字段；
     *  errText/errAt = 镜像错误的观察记账（当前文本 + 首次出现时刻，0 表示陈旧或
     *  首见播种），idleSince = 本段空闲的观察起点（0 = 正在跑），primed = 是否已过
     *  首见播种 */
    const monitorSessions = new Map();
    /** 各会话最近一次「被停止」的时刻（sessionId -> 毫秒）。停止是用户明确的
     *  "别继续"：停止瞬间若正好有一条失败沿落地（429 与 abort 抢同一个回合是
     *  有的），按新鲜度判定会把它当成真失败又续一轮——这张表把那条沿挡掉 */
    const monitorAborts = new Map();

    /** 给会话实例的 cancel 包一层记账：官方 UI 的「停止」按钮与本插件的死循环
     *  打断走的都是它，是浏览器端唯一能观察到"用户刚说了停"的地方。包不上
     *  （方法缺失/对象冻结）就退化为只靠新鲜度判定，不影响续跑本身。
     *  每个 tick 调一次：标记在实例上，重复调用是空操作；实例被宿主换掉时能重包。 */
    function monitorWrapCancel(sessions, id) {
      let sess = null;
      try {
        const b = sessions.binding(id);
        sess = b ? b.session : null;
      } catch {
        return; // 会话刚移除 / 服务异常
      }
      if (!sess || typeof sess.cancel !== "function" || sess[MONITOR_CANCEL_MARK]) return;
      const orig = sess.cancel;
      try {
        sess[MONITOR_CANCEL_MARK] = true;
        sess.cancel = function (...args) {
          monitorAborts.set(id, Date.now());
          return orig.apply(this, args);
        };
      } catch {
        /* 只读/冻结的实例：放弃记账 */
      }
    }

    /** 取会话镜像快照；顺带完成惰性物化（binding 对列表内会话恒成功）。异常按
     *  无镜像处理——调用方各自兜底。 */
    function monitorSnapOf(sessions, id, st) {
      try {
        const b = sessions.binding(id);
        if (b) {
          st.materialized = true;
          return b.session.getSnapshot();
        }
      } catch {
        /* 会话刚移除 / 服务异常：按无镜像处理 */
      }
      return null;
    }

    /** 续跑器主循环入口：读真实依赖（slots/settings）后进核心 */
    function monitorTick() {
      if (!slotsCtx) return;
      let cfg;
      try {
        cfg = cfgFromSnapshot(getCfgSnapshot());
      } catch {
        return;
      }
      if (!cfg.monitorEnabled) return;
      let sessions;
      try {
        sessions = slotsCtx.get("sessions");
      } catch {
        return;
      }
      // 归档集合与 sessions 同源于 slots 的 workspaces 服务；读失败按空集退回
      // 全员监视（服务缺位只可能出现在基线之外的宿主，静默全员比误伤全员安全）
      let archived = new Set();
      try {
        const ids = slotsCtx.get("workspaces").list.getSnapshot().archivedSessionIds;
        if (Array.isArray(ids)) archived = new Set(ids);
      } catch {
        /* workspaces 服务缺位 / 形状不符：按无归档处理 */
      }
      monitorTickCore(sessions, cfg, Date.now(), archived);
    }

    /** 续跑器核心（依赖注入，render-check 直测）：单次遍历 O(会话数)，读的全是
     *  内存快照，无网络调用（prompt 仅在发射瞬间一次）。
     *  触发采用「错误标记驱动」而非 running 沿：list 的 running 推送（api-session/
     *  status）与错误广播（api-session/error）到达顺序无保证，沿时刻读镜像可能
     *  还没置位（实测踩过）。改以镜像 lastAgentError 的「新文本」为触发——以
     *  handledErr 记账去重，免疫到达顺序；文本级去重也天然放行续跑后的再次失败
     *  （发射即清 handledErr）。
     *  但「新」必须叠上「这次收尾就是它造成的」：镜像不会被回合收尾清掉，新文本
     *  也可能是回合中途的旧账（回合后来成功收尾 / 被用户停下）。判据是同一次观察里
     *  的时序——errAt 必须落在本段空闲起点前 MONITOR_ERR_WINDOW_MS 内，见模块头。 */
    function monitorTickCore(sessions, cfg, now, archived = new Set()) {
      if (!sessions || !sessions.list || typeof sessions.binding !== "function") return;
      let list;
      try {
        list = sessions.list.getSnapshot();
      } catch {
        return;
      }
      for (const id of list.ids ?? []) {
        const summary = list.byId[id];
        if (!summary) continue;
        if (archived.has(id)) continue; // 归档会话：不监视不续跑，状态在尾部回收
        let st = monitorSessions.get(id);
        if (!st) {
          st = {
            running: false,
            continues: 0,
            capped: false,
            plan: null,
            materialized: false,
            handledErr: null,
            title: null,
            max: 0,
            errText: null,
            errAt: 0,
            idleSince: 0,
            primed: false,
          };
          monitorSessions.set(id, st);
        }
        const snap = monitorSnapOf(sessions, id, st);
        const lastErr = snap?.lastAgentError ?? null;
        monitorWrapCancel(sessions, id); // 停止入口记账（用户点「停止」= 别继续）
        // 错误文本的观察记账：首见只播种（页面打开时镜像里已躺着的错误算陈旧），之后
        // 只在文本变化时刷新出现时刻——停在镜像里不改写，判据才不会把旧错误当新失败
        if (!st.primed) {
          st.primed = true;
          st.errText = lastErr;
        } else if (lastErr !== st.errText) {
          st.errText = lastErr;
          st.errAt = lastErr === null ? 0 : now;
        }
        if (summary.running) {
          // 运行中：物化镜像（之后失败才有人接 lastAgentError）；等待期回合跑起来
          // = 用户介入，放弃本次 plan；上一条失败的记账一并清除——新回合的失败是
          // 新失败，即使文本相同也要重新触发。停止记账也到此用掉（回合又跑起来了）
          if (st.plan) st.plan = null;
          st.handledErr = null;
          st.running = true;
          st.idleSince = 0; // 本段空闲到此为止
          monitorAborts.delete(id);
          continue;
        }
        st.running = false;
        if (st.idleSince === 0) st.idleSince = now; // 本段空闲的观察起点
        const aborted = (monitorAborts.get(id) ?? 0) >= st.idleSince - MONITOR_ABORT_WINDOW_MS;
        const fresh = !aborted && st.errAt > 0 && st.errAt >= st.idleSince - MONITOR_ERR_WINDOW_MS;
        if (lastErr && MONITOR_RATE_LIMIT_RE.test(lastErr)) {
          if (!fresh) {
            // 错误早于本段空闲、或这一段空闲是被「停止」打开的：回合是别的原因收的
            // 尾（正常做完 / 被手动停止），镜像里是旧账——不续跑，也不进 capped
            //（capped 是要人处理的真终态，不该被旧账点亮）
          } else if (st.handledErr === lastErr) {
            // 已处置过的同一条失败：不重排（取消后静默，直到正常收尾）
          } else if (!st.capped && st.continues < cfg.monitorMaxAuto) {
            st.handledErr = lastErr;
            st.title = summary.displayTitle;
            st.max = cfg.monitorMaxAuto;
            st.plan = { fireAt: now + cfg.monitorWaitMs };
          } else if (!st.capped) {
            st.handledErr = lastErr;
            st.title = summary.displayTitle;
            st.max = cfg.monitorMaxAuto;
            st.capped = true;
          }
        } else if (!lastErr) {
          // 空闲且无错误标记：一次正常收尾 → 连续计数清零、capped 解除（继续成功
          // 即清零）。幂等，重复 tick 无害。
          if (st.continues !== 0 || st.capped || st.handledErr !== null) {
            st.continues = 0;
            st.capped = false;
            st.handledErr = null;
          }
        }
        // plan 到点发射：镜像仍在失败态且没人在跑才发；prompt 同步清 lastAgentError
        // 与 handledErr——续跑后再失败（同文本新失败）可再次触发
        if (st.plan && now >= st.plan.fireAt) {
          st.plan = null;
          const snapAtFire = monitorSnapOf(sessions, id, st);
          if (snapAtFire && !snapAtFire.running && snapAtFire.lastAgentError && MONITOR_RATE_LIMIT_RE.test(snapAtFire.lastAgentError)) {
            st.continues += 1;
            st.handledErr = null;
            try {
              const b = sessions.binding(id);
              void b.session.prompt([{ type: "text", text: tf("monitorContinueText") }], "queue").catch(() => {});
              // prompt 同步清镜像 lastAgentError：本插件据此把观察记账一并作废，
              // 续跑后的失败哪怕文本一模一样，也会被认成"新出现"的一次失败。
              // 放在 prompt 之后：同步抛错就保留旧记账，不反复重排
              st.errText = null;
              st.errAt = 0;
              st.idleSince = 0;
            } catch {
              /* 发送通道异常：放弃本次（错误标记仍在但已不算新鲜，不会反复重排） */
            }
          }
        }
      }
      // 已移除/已归档会话的状态回收（归档时若有待发射 plan 一并作废）
      for (const id of [...monitorSessions.keys()]) {
        if (!list.byId[id] || archived.has(id)) {
          monitorSessions.delete(id);
          monitorAborts.delete(id);
        }
      }
      monitorRebuildItems();
    }

    /** 快照重建（tick 与取消按钮共用）：内容不变不 emit（轮询 2s 一次，序列化
     *  对比成本可忽略）。条目字段取自会话态缓存（title/max 在失败沿时记录），
     *  不依赖 list/slots——取消路径随时可调。 */
    function monitorRebuildItems() {
      const items = [];
      for (const [id, st] of monitorSessions) {
        if (!st.plan && !st.capped) continue;
        items.push({
          id,
          title: st.title ?? id,
          phase: st.plan ? "waiting" : "capped",
          fireAt: st.plan ? st.plan.fireAt : 0,
          continues: st.continues,
          max: st.max ?? 10,
        });
      }
      items.sort((a, b) => a.id.localeCompare(b.id));
      const next = JSON.stringify(items);
      if (next !== monitorStore.__sig) {
        monitorStore.__sig = next;
        monitorStore.snapshot = { items };
        monitorStore.emit();
      }
    }

    /** UI 取消/忽略按钮：待续跑 = 丢弃待发射 plan（失败沿已消费，不会重排）；
     *  capped = 清标记 + 连续计数归零（handledErr 保留——同一条失败保持静默，
     *  手动重跑或新失败后才重新给自动续跑额度） */
    function monitorCancelPlan(id) {
      const st = monitorSessions.get(id);
      if (!st) return;
      if (st.plan) st.plan = null;
      else if (st.capped) {
        st.capped = false;
        st.continues = 0;
      } else return;
      monitorRebuildItems(); // 立即重建快照并 emit
    }

    /** 尾部自重叠扫描：返回累计文本末尾连续重复块的最大次数（块长在
     *  MONITOR_MIN_BLOCK..MAX_BLOCK 内穷举对齐，与流式分块方式无关；文本不足
     *  两个最短块时返回 1）。死循环判定 = 返回值 ≥ monitorRepeatThreshold。 */
    function monitorTailRepeatCount(text) {
      const len = text.length;
      let best = 1;
      for (let p = MONITOR_MIN_BLOCK; p <= MONITOR_MAX_BLOCK && p * 2 <= len; p++) {
        const block = text.slice(len - p);
        let m = 1;
        while (len - (m + 1) * p >= 0 && text.slice(len - (m + 1) * p, len - m * p) === block) m++;
        if (m > best) best = m;
      }
      return best;
    }

    function MonitorLine(props) {
      const { useChat, useSession, useInput, inputActions, sessionId } = props;
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion);
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      const nodes = typeof useChat === "function" ? useChat((s) => s.legacy.nodes) : [];
      // 流式文本（text+reasoning）：assistant-step 运行中宿主才产 partial（turn/
      // step/blocks），落定即清空、nodes 才出现 finalized assistant——所以 partial
      // 天然只含"正在流出"的文本，天然排除历史回合误判
      const partial = typeof useChat === "function" ? useChat((s) => s.legacy.partial) : null;
      const running = typeof useSession === "function" ? useSession((s) => s.running) : false;
      const draft = typeof useInput === "function" ? useInput((s) => s.draft) : "";
      // 全局续跑器对本会话的活动状态（waiting/capped）；null = 无。subscribe 箭头
      // 包装保 this（方法解引用传入 uSES 会丢 this 导致订阅崩溃、条永不渲染）
      const watcherSnap = react.useSyncExternalStore(
        (s) => monitorStore.subscribe(s),
        () => monitorStore.snapshot,
      );
      const watcherItem = watcherSnap.items.find((x) => x.id === sessionId) ?? null;
      // plan（本地态，仅死循环链路）：null | {phase:"stopping"} | {phase:"waiting",fireAt,reason:"repeat"}；
      // 失败续跑的 waiting/capped 一律来自 watcherItem，本地不再管
      const [plan, setPlan] = react.useState(null);
      const [now, setNow] = react.useState(() => Date.now());
      const loopBreaksRef = react.useRef(0); // 死循环话术已发次数（达上限只停不发，防循环烧 token）
      const partialTextRef = react.useRef(null); // 最新流式文本（partial.blocks 拼接）
      const partialKeyRef = react.useRef(null); // 镜像侧记录的当前流 turn/step
      const lastStreamKeyRef = react.useRef(null); // 上次扫描的数据源标识（换源 = 新回合）
      const lastLenRef = react.useRef(0); // 本源扫描基线
      const nodesSeqRef = react.useRef(null); // 最新「未中断」assistant 节点 seq
      const nodesTextRef = react.useRef(null); // 该节点的文本（回合内步骤落地即扫一次）
      const stoppingRef = react.useRef(false); // cancel 已发出（防重复触发；话术后复位）
      // 会话切换：死循环链路状态归零（续跑计数在全局续跑器，随会话独立）
      react.useEffect(() => {
        loopBreaksRef.current = 0;
        partialTextRef.current = null;
        partialKeyRef.current = null;
        lastStreamKeyRef.current = null;
        lastLenRef.current = 0;
        nodesSeqRef.current = null;
        nodesTextRef.current = null;
        stoppingRef.current = false;
        setPlan(null);
      }, [sessionId]);
      // 流式文本镜像：partial 随 chunk 变化，只写 ref 不 setState（渲染开销趋零）。
      // 部分宿主版本 legacy.partial 恒 null（运行中步骤不进投影或不广播），此路
      // 不通时由 nodes 镜像兜底。
      react.useEffect(() => {
        if (!partial || !Array.isArray(partial.blocks)) {
          partialTextRef.current = null;
          return;
        }
        partialKeyRef.current = partial.turn + "/" + partial.step;
        let text = "";
        for (const b of partial.blocks) {
          if ((b.kind === "text" || b.kind === "reasoning") && typeof b.text === "string") text += b.text;
        }
        partialTextRef.current = text;
      }, [partial]);
      // 最新「未中断」assistant 节点镜像：步骤落地即全长出现（0→full 一拍），
      // interrupted（监视器停止的回合残余）不作扫描源——那是上一轮已处置的文本
      react.useEffect(() => {
        let seq = null;
        let text = null;
        for (let i = nodes.length - 1; i >= 0; i--) {
          const n = nodes[i];
          if (n && n.kind === "assistant") {
            if (n.interrupted !== true && Array.isArray(n.blocks)) {
              seq = n.seq;
              text = "";
              for (const b of n.blocks) {
                if ((b.kind === "text" || b.kind === "reasoning") && typeof b.text === "string") text += b.text;
              }
            }
            break;
          }
        }
        nodesSeqRef.current = seq;
        nodesTextRef.current = text;
      }, [nodes]);
      // ② 死循环扫描：仅回合运行中轮询（空闲不扫——历史文本不在观察面）。双数据
      //    源取其一：partial（流式中，若宿主广播）优先；否则最新未中断 assistant
      //    节点（步骤落地即全长出现，落地后立扫一次——快速流整段不可分时也有
      //    检测机会）。对文本做尾部自重叠扫描：长度 ≥MONITOR_MIN_BLOCK 的块 B 在
      //    末尾连续出现 ≥monitorRepeatThreshold 次（对齐长度穷举，与分块无关）。
      //    换源（新流/新节点）→ 复位停止标记与基线。interval 依赖刻意不含
      //    partial/nodes——流式高频换引用会让节拍永远跑不满，读取全走 ref。
      react.useEffect(() => {
        if (!cfg.monitorEnabled || !running) return undefined;
        const timer = setInterval(() => {
          let key = null;
          let text = null;
          if (partialTextRef.current !== null && partialKeyRef.current !== null) {
            key = "p:" + partialKeyRef.current;
            text = partialTextRef.current;
          } else if (nodesSeqRef.current !== null && nodesTextRef.current !== null) {
            key = "n:" + nodesSeqRef.current;
            text = nodesTextRef.current;
          }
          if (key === null || text === null) return;
          if (key !== lastStreamKeyRef.current) {
            lastStreamKeyRef.current = key;
            stoppingRef.current = false;
            lastLenRef.current = 0;
          }
          if (stoppingRef.current) return;
          const len = text.length;
          if (len <= lastLenRef.current) return;
          lastLenRef.current = len;
          if (monitorTailRepeatCount(text) < cfg.monitorRepeatThreshold) return;
          stoppingRef.current = true;
          setPlan({ phase: "stopping" });
          try {
            const sessions = slotsCtx ? slotsCtx.get("sessions") : null;
            const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : null;
            const sess = binding && binding.session;
            if (sess && typeof sess.cancel === "function") void sess.cancel().catch(() => {});
          } catch {
            // 服务未就绪：放弃本次停止（等待自然结束），stopping 超时兜底会清态
          }
        }, MONITOR_SCAN_MS);
        return () => clearInterval(timer);
      }, [running, cfg.monitorEnabled, cfg.monitorRepeatThreshold, sessionId]);
      // stopping → 停止完成转等待发循环话术（连续次数达上限只停不发，防循环烧
      // token）；停止超时（cancel 失败/被拒）放弃并复位
      react.useEffect(() => {
        if (plan?.phase !== "stopping") return undefined;
        if (!running) {
          if (loopBreaksRef.current >= cfg.monitorMaxAuto) return undefined;
          setPlan({ phase: "waiting", fireAt: Date.now() + 2500, reason: "repeat" });
          return undefined;
        }
        const giveUp = setTimeout(() => {
          stoppingRef.current = false;
          setPlan(null);
        }, 15000);
        return () => clearTimeout(giveUp);
      }, [plan, running, cfg.monitorMaxAuto]);
      // 等待期间用户介入（手动发消息使回合运行）→ 放弃本次（仅死循环链路；失败
      // 续跑的介入放弃在全局续跑器 tick 里）
      react.useEffect(() => {
        if (plan?.phase === "waiting" && running) setPlan(null);
      }, [running, plan]);
      // 倒计时跳动（死循环链路 waiting 与全局续跑器 waiting 都要跳）。进入等待
      // 先立即对表一次——now 可能是组件挂载时的陈旧值，首帧会把剩余秒数显示得偏大
      react.useEffect(() => {
        if (plan?.phase !== "waiting" && watcherItem?.phase !== "waiting") return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
      }, [plan, watcherItem]);
      // 到点执行（仅死循环链路）：草稿非空（用户在打字）或回合又跑起来都视为
      // 介入，放弃话术
      react.useEffect(() => {
        if (plan?.phase !== "waiting") return;
        if (Date.now() < plan.fireAt) return;
        if (running || String(draft ?? "").trim() !== "") {
          setPlan(null);
          return;
        }
        // 死循环话术：让 agent 知道自己卡在循环里，停止重复并换方式推进
        inputActions.setDraft(tf("monitorLoopBreakText"));
        inputActions.submit();
        stoppingRef.current = false; // 话术已发：本会话下一回合的死循环仍要接管
        loopBreaksRef.current += 1;
        setPlan(null);
      }, [plan, now, running, draft, inputActions]);
      if (!cfg.monitorEnabled) return null;
      // 展示优先级：死循环链路本地态在前（正在发生），全局续跑器状态兜底
      let line = "";
      let cancelLabel = ""; // 空 = 不出钮；否则为钮文案（waiting=取消、capped=忽略）
      if (plan?.phase === "waiting") {
        const sec = Math.max(0, Math.ceil((plan.fireAt - now) / 1000));
        line = tf("monitorAutoIn", { err: tf("monitorRepeatErr"), sec: String(sec), n: String(loopBreaksRef.current + 1), max: String(cfg.monitorMaxAuto) });
        cancelLabel = t("monitorCancel");
      } else if (plan?.phase === "stopping") {
        line = tf("monitorStopping");
      } else if (watcherItem?.phase === "waiting") {
        const sec = Math.max(0, Math.ceil((watcherItem.fireAt - now) / 1000));
        line = tf("monitorAutoIn", { err: tf("monitorErr429"), sec: String(sec), n: String(watcherItem.continues + 1), max: String(watcherItem.max) });
        cancelLabel = t("monitorCancel");
      } else if (watcherItem?.phase === "capped") {
        line = tf("monitorCapped", { max: String(watcherItem.max) });
        cancelLabel = t("monitorDismiss");
      }
      if (!line) return null;
      return jsxRuntime.jsxs("div", {
        className: "dshk-monitor-line",
        children: [
          jsxRuntime.jsx("span", { className: "dshk-monitor-text", children: line }),
          cancelLabel
            ? jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-monitor-cancel",
                onClick: () => (plan ? setPlan(null) : monitorCancelPlan(sessionId)),
                children: cancelLabel,
              })
            : null,
        ],
      });
    }

    // ─────────── 会话通知（回合收尾 / 上下文压缩 / agent 提问）───────────
    // 页面不在前台、或事件不属于当前打开的会话时弹一条桌面通知（浏览器
    // Notification API）；未授权 / 非安全上下文（手机走局域网 http）退标题闪烁。
    // 纯浏览器端，宿主只提供 settings 字段。三类事件的观察口不同：
    //   回合收尾 ← sessions.list 快照的 running（订阅式而非轮询：后台标签的定时器
    //     被浏览器节流到分钟级，而宿主的推送不受影响）；
    //   压缩完成 ← 会话事件窗口的增量（会话绑定的 eventSource 里的 compaction/end）——
    //     官方只为「上台」过的会话开这个窗，所以只覆盖打开过的会话（切走仍在收流，
    //     刷新后只剩当前会话）；首帧与重放增量只播种不通知，见 notifyCompactionCore；
    //   提问/批准 ← 旁听官方 remote 瀑布（user-questions|approval/request）——
    //     官方 UI 只在会话「上台」时才注册待回应，后台会话的请求在它那里是空档，
    //     本插件挂在根 ctx 上能收到全部会话的请求（会话身份从事件 ctx 的 scope 取）；
    //     计划评审（exit_plan_mode 的 intent=plan-review）走的是同一条 user-questions
    //     请求，只是另成一类文案与正文取法（见 notifyKindOf）。官方待回应投影
    //     （uiSession.pendingInteractions）只作补充口存在——两者是同一次请求的两个
    //     观察口，谁先看到都能提醒，去重见 notifySeenRequests。
    // 抑制规则见 notifyWanted（一个总开关管全部提醒，不分类配置）；页面完全关掉时
    // 浏览器端无从运行，无通知可言。
    const notifyState = {
      /** sessionId -> 上次已知 running（沿检测基线；首帧只播种不发通知） */
      running: new Map(),
      /** sessionId -> 已提醒过的待回应 key（同一请求只提醒一次） */
      pendingKey: new Map(),
      /** sessionId -> {seq}：事件窗口已读到的持久 seq（压缩沿的基线，首帧只播种） */
      compactions: new Map(),
      /** 首帧标志：页面刚打开时列表里已在跑的会话不补发通知 */
      primed: false,
      /** 标题闪烁：未读计数（0 = 未闪烁）与 <title> 观察器 */
      flashCount: 0,
      flashWatch: null,
      /** 在途的收尾判定定时器（页面销毁无需清理，留着只为可观测） */
      settles: new Set(),
    };
    /** 事件路径已处置过的提问请求（key 用 questions 数组——待回应投影里存的是
     *  同一个引用，据此让两条观察口只提醒一次）。批准请求没有共用引用可用，靠
     *  通知 tag 由浏览器归并 */
    const notifySeenRequests = new WeakSet();
    const NOTIFY_BODY_MAX = 140; // 提问正文截断长度：桌面通知两行即满，长了被裁
    const NOTIFY_FLASH_RE = /^\(\d+\) /; // 闪烁前缀：复原时按它剥掉，不存旧标题
    const NOTIFY_SETTLE_MS = 2500; // 收尾判定延迟：盖过续跑器 2s 的 tick

    /** 折叠空白并按上限截断（通知正文只取一行；超长补省略号） */
    function notifyClip(text, max) {
      const flat = String(text ?? "").replace(/\s+/g, " ").trim();
      return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
    }

    /** 提问批次的类别：官方计划评审（`intent.kind = "plan-review"`）单独成一类，
     *  提醒文案与正文取法都不同（正文取计划 markdown 的首个标题） */
    function notifyKindOf(baseKind, request) {
      if (baseKind !== "question") return baseKind;
      const first = Array.isArray(request?.questions) ? request.questions[0] : null;
      return first && first.intent && first.intent.kind === "plan-review" ? "plan" : "question";
    }

    /** 计划评审正文：取计划首个 markdown 标题（比"批准这份计划吗"有用），
     *  没有标题（理论上 exit_plan_mode 会拦）就退回提问原文 */
    function notifyPlanBody(detail, fallback) {
      const heading = /(?:^|\n)#{1,6}\s+([^\n]+)/.exec(typeof detail === "string" ? detail : "");
      const text = heading ? heading[1].trim() : "";
      return notifyClip(text !== "" ? text : fallback, NOTIFY_BODY_MAX);
    }

    /** 待回应的正文：提问取首问全文，计划取计划标题，批准取理由（无理由用工具名兜底） */
    function notifyBodyOf(interaction, kind) {
      if (kind === "approval") {
        const reason = typeof interaction.reason === "string" ? interaction.reason.trim() : "";
        if (reason !== "") return notifyClip(reason, NOTIFY_BODY_MAX);
        const tool = typeof interaction.toolName === "string" ? interaction.toolName.trim() : "";
        return tf("notifyApprovalBody", { tool: tool === "" ? t("notifyToolFallback") : tool });
      }
      const first = Array.isArray(interaction.questions) ? interaction.questions[0] : null;
      const text = first && typeof first.question === "string" ? first.question.trim() : "";
      if (kind === "plan") return notifyPlanBody(first ? first.detail : "", text !== "" ? text : t("notifyPlanBody"));
      return notifyClip(text !== "" ? text : t("notifyQuestionBody"), NOTIFY_BODY_MAX);
    }

    /** 值不值得打扰：总开关 + 不是「人正看着这个会话」（页面可见且聚焦、事件又正是
     *  当前会话时，官方界面自己会说）。五类提醒共用这一条判据（不分类配置） */
    function notifyWanted(cfg, sessionId, current, foreground) {
      if (!cfg.notifyEnabled) return false;
      return !(foreground === true && sessionId === current);
    }

    /**
     * 通知判定核心（依赖注入，render-check 直测）：把列表快照与待回应表投影成
     * 应发通知，顺带把沿写回 state。抑制：见 notifyWanted；子会话（导航细节，
     * 属噪音）与首帧播种也不发。
     * @param input {ids,byId,current,foreground,pending:Map<sessionId,interaction>,seen:WeakSet}
     * @returns [{kind:"complete"|"question"|"approval", sessionId, title, body?}]
     */
    function notifyDiffCore(state, input, cfg) {
      const events = [];
      const byId = input.byId ?? {};
      const foreground = input.foreground === true;
      const wanted = (sessionId) => notifyWanted(cfg, sessionId, input.current, foreground);
      const titleOf = (id) => byId[id]?.displayTitle ?? id;
      const seen = new Set();
      for (const id of input.ids ?? []) {
        const row = byId[id];
        if (!row) continue;
        seen.add(id);
        const was = state.running.get(id);
        state.running.set(id, row.running === true);
        // 只认 true→false 的沿：首帧播种、仍在跑、子会话都不发
        if (!state.primed || was !== true || row.running === true || row.origin === "subagent") continue;
        if (wanted(id)) events.push({ kind: "complete", sessionId: id, title: titleOf(id) });
      }
      for (const id of [...state.running.keys()]) if (!seen.has(id)) state.running.delete(id);
      // 待回应：key 变化即新请求（一个会话同时只投影一个待回应）。事件路径已经
      // 处置过的那次请求直接跳过——同一次提问被两条观察口各报一次只算一次
      const pending = input.pending instanceof Map ? input.pending : new Map();
      const seenRequests = input.seen instanceof WeakSet ? input.seen : null;
      const pendingSeen = new Set();
      for (const [id, interaction] of pending) {
        if (!interaction || typeof interaction.key !== "string") continue;
        pendingSeen.add(id);
        if (seenRequests && seenRequests.has(interaction.questions ?? interaction)) continue;
        if (state.pendingKey.get(id) === interaction.key) continue;
        state.pendingKey.set(id, interaction.key);
        if (!state.primed) continue;
        const kind = interaction.kind === "approval" ? "approval" : interaction.kind === "plan-review" ? "plan" : "question";
        if (!wanted(id)) continue;
        events.push({ kind, sessionId: id, title: titleOf(id), body: notifyBodyOf(interaction, kind) });
      }
      for (const id of [...state.pendingKey.keys()]) if (!pendingSeen.has(id)) state.pendingKey.delete(id);
      state.primed = true;
      return events;
    }

    /** 事件条目上的持久 seq（transient 条目的 seq 只是排序号，不在持久序列上） */
    function notifyDurableSeq(entry) {
      const event = entry && entry.type === "event" ? entry.event : null;
      return event && typeof event.seq === "number" ? event.seq : -1;
    }

    /** 窗口里最大的持久 seq：播种基线用（窗口含翻旧页 prepend 的整段历史） */
    function notifyMaxSeq(entries, fallback) {
      let max = fallback;
      for (const entry of entries) {
        const seq = notifyDurableSeq(entry);
        if (seq > max) max = seq;
      }
      return max;
    }

    /** 压缩规模：同一次压缩的 `compaction/summary` 带被压掉历史的 token 估值 */
    function notifyCompactTokens(entries, compactionId) {
      for (const entry of entries) {
        const event = entry && entry.type === "event" ? entry.event : null;
        if (!event || event.type !== "compaction/summary" || !event.data) continue;
        if (event.data.compactionId !== compactionId) continue;
        const tokens = event.data.shadowedTokenCount;
        if (typeof tokens === "number" && tokens > 0) return tokens;
      }
      return 0;
    }

    /** 压缩正文：说得出规模就说规模，说不出就只报完成 */
    function notifyCompactBody(entries, compactionId) {
      const tokens = notifyCompactTokens(entries, compactionId);
      if (tokens <= 0) return t("notifyCompactBody");
      return tf("notifyCompactBodyTokens", { tokens: tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens) });
    }

    /**
     * 压缩完成判定核心（依赖注入，render-check 直测）：事件窗口的增量里出现
     * `compaction/end`（不带 error）即一次压缩收尾——手动 /compact 与回合中途的
     * 自动压缩都落这条事件，模型无关的 tool-result prune 不在其中。
     * 只认 append 增量：窗口首帧（页面刚打开）与 replace/prepend（重连重放、翻旧页）
     * 一律只播种——刷新页面不重报历史压缩。
     * 覆盖边界：官方只为「上台」过的会话开事件窗，从未打开过的会话看不到它的压缩。
     * @param input {sessionId,title,entries,change,origin,current,foreground}
     * @returns [{kind:"compact", sessionId, title, body}]
     */
    function notifyCompactionCore(state, input, cfg) {
      const events = [];
      const id = input.sessionId;
      const st = state.compactions.get(id) ?? { seq: -1 };
      state.compactions.set(id, st);
      const entries = Array.isArray(input.entries) ? input.entries : [];
      const change = input.change;
      if (!change || change.kind !== "append") {
        st.seq = notifyMaxSeq(entries, st.seq); // 首帧 / 重放 / 翻旧页：只播种不通知
        return events;
      }
      for (const entry of Array.isArray(change.entries) ? change.entries : []) {
        const seq = notifyDurableSeq(entry);
        if (seq <= st.seq) continue; // 重复投递 / 重放：同一条不报两次
        st.seq = seq;
        const event = entry.event;
        if (event.type !== "compaction/end") continue;
        const data = event.data;
        if (!data || data.error) continue; // 失败的压缩不算完成（那个回合的失败另有报法）
        if (input.origin === "subagent") continue; // 子会话属导航噪音
        if (!notifyWanted(cfg, id, input.current, input.foreground === true)) continue;
        events.push({ kind: "compact", sessionId: id, title: input.title, body: notifyCompactBody(entries, data.compactionId) });
      }
      return events;
    }

    /** 前台判据：页面可见 **且** 窗口聚焦。切到别的程序时 visibilityState 仍是
     *  visible（只有切标签/最小化才变 hidden），只看它会漏判成"人在跟前" */
    function notifyForeground() {
      try {
        return document.visibilityState === "visible" && document.hasFocus() === true;
      } catch {
        return false;
      }
    }

    /** 当前通知权限：granted | denied | default | unsupported（浏览器侧事实，不在
     *  settings 里）。老浏览器返回的可能是 undefined——按未授权处理 */
    function notifyPermState() {
      if (typeof Notification !== "function") return "unsupported";
      const perm = Notification.permission;
      return perm === "granted" || perm === "denied" ? perm : "default";
    }

    /** 桌面通知可用：浏览器有 API 且已授权（未授权不能在此处请求——requestPermission
     *  必须在用户手势里发；配置页无请求手势入口，首次需在浏览器站点设置里允许） */
    function notifyCanPost() {
      return notifyPermState() === "granted";
    }

    /** 标题闪烁兜底：未授权/非安全上下文时至少留痕（标签条上看得见未读计数）。
     *  DSH 自己会改写标题（换会话、生成标题），所以挂着 <title> 观察器把前缀贴
     *  回去；回窗口（可见且聚焦）即复原 */
    function notifyApplyFlash() {
      if (typeof document === "undefined" || notifyState.flashCount === 0) return;
      const base = document.title.replace(NOTIFY_FLASH_RE, "");
      const next = `(${notifyState.flashCount}) ${base}`;
      if (document.title !== next) document.title = next;
    }
    function notifyFlash() {
      if (typeof document === "undefined") return;
      notifyState.flashCount += 1;
      notifyApplyFlash();
      if (!notifyState.flashWatch && typeof MutationObserver === "function") {
        const titleEl = document.querySelector("title");
        if (titleEl) {
          notifyState.flashWatch = new MutationObserver(() => notifyApplyFlash());
          notifyState.flashWatch.observe(titleEl, { childList: true, characterData: true, subtree: true });
        }
      }
    }
    function notifyUnflash() {
      if (typeof document === "undefined" || notifyState.flashCount === 0) return;
      notifyState.flashCount = 0;
      const base = document.title.replace(NOTIFY_FLASH_RE, "");
      if (document.title !== base) document.title = base;
    }
    /** 回窗口才复原标题：可见但仍未聚焦（切程序回来一半）时留着闪烁 */
    function notifyMaybeUnflash() {
      if (notifyForeground()) notifyUnflash();
    }

    /** 点通知 → 聚焦窗口并切到该会话（会话已被删除时只聚焦） */
    function notifyOpenSession(sessions, sessionId) {
      try {
        window.focus();
      } catch {
        /* 非浏览器环境 */
      }
      try {
        sessions.open(sessionId);
      } catch {
        /* 会话已不在列表：只聚焦 */
      }
    }

    /** 投递一条：系统通知优先，退标题闪烁。tag 按会话归并——同一会话的新通知
     *  替换旧的，人不在时也不会堆一屏 */
    function notifyDeliver(sessions, ev) {
      const key =
        ev.kind === "complete"
          ? "notifyCompleteTitle"
          : ev.kind === "compact"
            ? "notifyCompactTitle"
            : ev.kind === "capped"
              ? "notifyCappedTitle"
              : ev.kind === "approval"
                ? "notifyApprovalTitle"
                : ev.kind === "plan"
                  ? "notifyPlanTitle"
                  : "notifyQuestionTitle";
      const title = tf(key, { title: ev.title });
      const body =
        ev.kind === "complete" ? t("notifyCompleteBody") : ev.kind === "capped" ? t("notifyCappedBody") : ev.body ?? "";
      if (notifyCanPost()) {
        try {
          const note = new Notification(title, { body, tag: `dsh-kit:${ev.sessionId}`, silent: true });
          note.onclick = () => {
            notifyOpenSession(sessions, ev.sessionId);
            try {
              note.close();
            } catch {
              /* 已自动关闭 */
            }
          };
          return;
        } catch {
          /* 构造被拒（部分环境只认 ServiceWorker 通知）：退标题闪烁 */
        }
      }
      notifyFlash();
    }

    /** 事件入口（订阅回调与首帧共用）：读快照 → 核心判定 → 逐条投递 */
    function notifyEvaluate(sessions, pendingStore) {
      let cfg;
      let list;
      let pending = null;
      try {
        cfg = cfgFromSnapshot(getCfgSnapshot());
        list = sessions.list.getSnapshot();
      } catch {
        return; // 服务异常：本轮跳过，下条推送再来
      }
      try {
        if (pendingStore && typeof pendingStore.getSnapshot === "function") pending = pendingStore.getSnapshot();
      } catch {
        /* 待回应源异常：只报完成 */
      }
      const events = notifyDiffCore(
        notifyState,
        { ids: list.ids, byId: list.byId, current: mainRowOf(list)?.id, foreground: notifyForeground(), pending, seen: notifySeenRequests },
        cfg,
      );
      for (const ev of events) {
        // 收尾不是立刻就能断定的：限流失败也会让 running 落地，而续跑器 2s 后才会
        // 排上「继续」——不等这一下就会把"待续跑的失败"报成"任务完成"
        if (ev.kind !== "complete") {
          notifyDeliver(sessions, ev);
          continue;
        }
        const timer = setTimeout(() => {
          notifyState.settles.delete(timer);
          notifyCompleteSettled(sessions, ev);
        }, NOTIFY_SETTLE_MS);
        notifyState.settles.add(timer);
      }
    }

    /** 压缩完成入口（事件窗口订阅回调）：读窗口快照 → 核心判定 → 逐条投递。
     *  不走收尾那套延迟判定：压缩是已经落地的事实，没有"待续跑"的歧义 */
    function notifyCompactionEvaluate(sessions, sessionId) {
      let cfg;
      let list;
      let win;
      try {
        cfg = cfgFromSnapshot(getCfgSnapshot());
        list = sessions.list.getSnapshot();
        win = sessions.binding(sessionId).eventSource.getSnapshot();
      } catch {
        return; // 服务/窗口异常：本轮跳过，下条推送再来
      }
      const row = list.byId?.[sessionId];
      const events = notifyCompactionCore(
        notifyState,
        {
          sessionId,
          title: row?.displayTitle ?? sessionId,
          entries: win.entries,
          change: win.change,
          origin: row?.origin,
          current: mainRowOf(list)?.id,
          foreground: notifyForeground(),
        },
        cfg,
      );
      for (const ev of events) notifyDeliver(sessions, ev);
    }

    /** 收尾通知的延迟判定：到点仍空闲、且续跑器没排「等待继续」的计划，才算真收尾。
     *  已 capped（自动续跑放弃）确实停了，但文案要说清不是任务做完——那是要人回去
     *  处理的终态。判定读的都是内存快照，无网络调用。 */
    function notifyCompleteSettled(sessions, ev) {
      let row = null;
      try {
        row = sessions.list.getSnapshot().byId?.[ev.sessionId] ?? null;
      } catch {
        return; // 服务异常：放弃本次
      }
      if (!row || row.running === true) return; // 已不在列表 / 又跑起来了：不算收尾
      const plan = monitorStore.snapshot.items.find((x) => x.id === ev.sessionId);
      if (plan && plan.phase === "waiting") return; // 等会儿就自动继续，别打扰
      notifyDeliver(sessions, plan ? { ...ev, kind: "capped" } : ev);
    }

    /** 事件路径投递（提问 / 批准）：会话名从列表快照取，抑制与完成沿同一套判据 */
    function notifyEventDeliver(sessions, kind, sessionId, request) {
      let cfg;
      let list;
      try {
        cfg = cfgFromSnapshot(getCfgSnapshot());
        list = sessions.list.getSnapshot();
      } catch {
        return; // 服务异常：放弃本次（作答链路不受影响）
      }
      if (!notifyWanted(cfg, sessionId, mainRowOf(list)?.id, notifyForeground())) return;
      notifyDeliver(sessions, {
        kind,
        sessionId,
        title: list.byId?.[sessionId]?.displayTitle ?? sessionId,
        body: notifyBodyOf(request, kind),
      });
    }

    /** 官方 remote 瀑布的旁听者（提问 / 批准各一条）：**恒 return next()**——作答仍
     *  归官方 UI，插件只借这条事件补上官方接不到的那一半：官方 UI 只在会话「上台」
     *  时才注册待回应，后台会话的请求在它那里是空档，而根 ctx 上的监听器能收到
     *  全部会话的请求（会话身份沿用官方取法：事件 ctx 的 scope）。 */
    function notifyRequestListener(sessions, kind) {
      return function (request, next) {
        try {
          const sessionId = sessions.scopeOf(this);
          if (sessionId !== undefined) {
            // 先记账再投递：官方待回应投影稍后也会看到这次请求，别提醒两遍
            notifySeenRequests.add(kind === "question" ? request.questions : request);
            notifyEventDeliver(sessions, notifyKindOf(kind, request), sessionId, request);
          }
        } catch {
          /* 旁听失败不影响作答链路 */
        }
        return next();
      };
    }


    /** 会话头部的 429 后台会话状态条：全局续跑器有待续跑/封顶会话才渲染（零常驻）。
     *  原挂在右栏任务签顶部，0.1.7 任务签退役（官方会话头部自带任务清单 + 实时输出
     *  + 停止）后移到这里，与官方后台任务入口同域。点开小浮层逐条列出，待续跑可取消。 */
    function MonitorBgAction() {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      const watcherSnap = react.useSyncExternalStore(
        (s) => monitorStore.subscribe(s),
        () => monitorStore.snapshot,
      );
      const [open, setOpen] = react.useState(false);
      const [now, setNow] = react.useState(() => Date.now());
      const rootRef = react.useRef(null);
      const hasWaiting = watcherSnap.items.some((x) => x.phase === "waiting");
      // 倒计时跳动（有待续跑才走秒）
      react.useEffect(() => {
        if (!hasWaiting) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
      }, [hasWaiting]);
      // 浮层点外/Esc 收起
      react.useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
          if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
          if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onDown, true);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("pointerdown", onDown, true);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);
      if (cfg.monitorEnabled === false || watcherSnap.items.length === 0) return null;
      return jsxRuntime.jsxs("div", { className: "dshk-mbg", ref: rootRef, children: [
        jsxRuntime.jsxs("button", {
          type: "button",
          className: "dshk-mbg-trigger",
          "aria-expanded": open,
          onClick: () => {
            setNow(Date.now()); // 展开瞬间先对表，首帧倒计时才不偏大
            setOpen((v) => !v);
          },
          children: [
            jsxRuntime.jsx("span", { className: "dshk-mbg-dot", "aria-hidden": true }),
            `${t("monitorBgTitle")} · ${String(watcherSnap.items.length)}`,
          ],
        }),
        open
          ? jsxRuntime.jsx("div", { className: "dshk-mbg-menu", children:
              watcherSnap.items.map((x) => {
                const line = x.phase === "waiting"
                  ? tf("monitorBgItem", {
                      title: x.title,
                      sec: String(Math.max(0, Math.ceil((x.fireAt - now) / 1000))),
                      n: String(x.continues + 1),
                      max: String(x.max),
                    })
                  : tf("monitorBgCapped", { title: x.title, max: String(x.max) });
                return jsxRuntime.jsxs("div", { className: "dshk-monitor-line", children: [
                  jsxRuntime.jsx("span", { className: "dshk-monitor-text", children: line }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-monitor-cancel",
                    onClick: () => monitorCancelPlan(x.id),
                    children: x.phase === "waiting" ? t("monitorCancel") : t("monitorDismiss"),
                  }),
                ] }, x.id);
              }),
            })
          : null,
      ] });
    }

    // 本组件配置页（插件页 dsh-kit-monitor 行「配置」）：骨架在 dock，这里只喂字段表
    const MONITOR_CFG_FIELDS = [
      { key: "monitorEnabled", type: "bool", group: "kcfgGroupMonitor", labelKey: "kcfgMonitorEnabled", hintKey: "kcfgMonitorEnabledHint" },
      { key: "monitorWaitMs", type: "number", min: 5000, max: 600000, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorWaitMs", hintKey: "kcfgMonitorWaitMsHint" },
      { key: "monitorMaxAuto", type: "number", min: 1, max: 10, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorMaxAuto", hintKey: "kcfgMonitorMaxAutoHint" },
      { key: "monitorRepeatThreshold", type: "number", min: 2, max: 10, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorRepeatThreshold", hintKey: "kcfgMonitorRepeatThresholdHint" },
      { key: "notifyEnabled", type: "bool", group: "kcfgGroupMonitor", labelKey: "kcfgNotifyEnabled", hintKey: "kcfgNotifyEnabledHint" },
    ];
    const MONITOR_CFG_GROUPS = ["kcfgGroupMonitor"];
    const MonitorConfigPage = dock.createConfigPage({
      fields: MONITOR_CFG_FIELDS,
      groups: MONITOR_CFG_GROUPS,
      t,
      onSaved: async () => {
        await loadCfg();
      },
    });

    // 组件私有样式：芯片 + 浮层（面板样式复刻官方 ContextMeter，哈希类名复用不了）
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent = [
        // order:1 —— 槽位容器 display:contents，本元素与官方 ContextMeter 环同为 dock 行的
        // flex item；order 提到环后面才是真正最右（DOM 里槽位贡献永远在环左边）。
        // 不加 padding-top：dock 行自带 4px，加了会垂直错位 2px+
        ".dshk-usage{order:1;margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:2px}",
        ".dshk-usage-win{display:inline-flex;align-items:center;gap:2px}",
        ".dshk-usage-win.is-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-sep{color:var(--dsw-alias-label-tertiary);opacity:.7}",
        ".dshk-usage-peak{color:var(--dsw-alias-danger);font-weight:600;margin-right:4px}",
        // 芯片 = 官方 ContextMeter trigger 同款（pill、hover/展开态同色）
        ".dshk-usage-trigger{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:24px;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
        ".dshk-usage-trigger:hover,.dshk-usage-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
        ".dshk-usage-trigger.dshk-usage-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-trigger.dshk-usage-hot:hover,.dshk-usage-trigger.dshk-usage-hot[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}",
        // 面板 = 官方 ContextMeter panel 同款（定位经 primitives useAnchoredPosition，portal 到 body）；背景是半透明色，磨砂 backdrop-filter 缺了背后的界面会整个透出来
        ".dshk-usage-pop{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:min(264px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:fixed}",
        ".dshk-usage-header{align-items:center;gap:6px;display:flex}",
        ".dshk-usage-headline{color:var(--dsw-alias-label-tertiary);min-width:0}",
        ".dshk-usage-percent{color:var(--dsw-alias-label-primary);font-weight:500}",
        ".dshk-usage-figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}",
        ".dshk-usage-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-rows{margin:6px 0 0}",
        ".dshk-usage-row{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex;margin:0}",
        ".dshk-usage-row dt{color:var(--dsw-alias-label-secondary)}",
        ".dshk-usage-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}",
        ".dshk-usage-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:1px 0 0}",
        ".dshk-usage-bar{corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:5px 0 8px;display:flex;overflow:hidden}",
        ".dshk-usage-segment{background:var(--meter-tint,var(--dsw-alias-label-tertiary));border-radius:1px;flex:none;min-width:2px;height:100%}",
        ".dshk-usage-segment.is-hot{--meter-tint:var(--dsw-alias-danger)}",
        ".dshk-usage-foot{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:7px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}",
        ".dshk-usage-link{margin-left:auto;color:var(--dsw-alias-label-secondary);text-decoration:none;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px}",
        ".dshk-usage-link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshk-usage-refresh{appearance:none;border:.5px solid var(--dsw-alias-border-l1);background:0 0;border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
        ".dshk-usage-refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        // 会话监视条（composer.dock 槽）与头部 429 状态条（session.header.actions 槽）
        ".dshk-monitor-line{display:flex;align-items:center;gap:10px;padding:5px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 8%,transparent);font-size:12px;color:var(--dsw-alias-label-secondary)}",
        ".dshk-monitor-text{flex:1;min-width:0}",
        ".dshk-monitor-cancel{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:none;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
        ".dshk-monitor-cancel:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}",
        // 会话头部 429 状态条：仅当后台会话有待续跑/已封顶时渲染，零常驻
        ".dshk-mbg{position:relative}",
        ".dshk-mbg-trigger{display:inline-flex;align-items:center;gap:5px;min-height:26px;padding:2px 7px;border:0;background:none;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:12px;line-height:18px}",
        ".dshk-mbg-trigger:hover,.dshk-mbg-trigger[aria-expanded=\"true\"]{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l1,transparent)}",
        ".dshk-mbg-dot{flex:none;width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-warning,#e2c08d)}",
        ".dshk-mbg-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:80;display:flex;flex-direction:column;gap:2px;min-width:300px;max-width:min(460px,92vw);padding:7px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.2))}",
        ".dshk-mbg-menu .dshk-monitor-cancel{margin-left:auto}",
      ].join("\n");
      document.head.appendChild(style);
    }

    // ── modelDirectories 懒就绪接线（apply 时注入，数据源到位后通知芯片重读）──
    let usageModelDirs = null;
    const usageDirs = { version: 0 };
    const usageDirsSubs = new Set();
    function usageDirsNotify() {
      usageDirs.version += 1;
      for (const fn of usageDirsSubs) {
        try {
          fn();
        } catch {
          /* 订阅者已卸载 */
        }
      }
    }

    function usageProviderKind(providerId) {
      const s = String(providerId ?? "");
      if (/deepseek/i.test(s)) return "deepseek";
      if (/opencode/i.test(s)) return "opencode";
      if (/zai|glm|bigmodel/i.test(s)) return "zai";
      return null;
    }

    /** 芯片数据模块级缓存：换会话/重挂载 60s 内不重复打端点（宿主还有 60s 缓存） */
    const usageData = { body: null, at: 0 };

    const USAGE_CURRENCY_SYMBOL = { CNY: "¥", USD: "$", TWD: "NT$", HKD: "HK$", EUR: "€" };
    /** 各家官方用量页（浮层底部链接） */
    const USAGE_LINKS = {
      deepseek: "https://platform.deepseek.com/usage",
      opencode: "https://opencode.ai/zh/go",
      zai: "https://bigmodel.cn/coding-plan/personal/usage",
    };
    const usageUseAnchoredPosition =
      dswPrimIcons && typeof dswPrimIcons.useAnchoredPosition === "function" ? dswPrimIcons.useAnchoredPosition : null;
    const usageUseDismiss =
      dswPrimIcons && typeof dswPrimIcons.useDismissOnOutsidePointer === "function" ? dswPrimIcons.useDismissOnOutsidePointer : null;
    const usageTooltip = dswIcon("Tooltip");

    function usageFmtCountdown(target, now) {
      const ms = target - now;
      if (!Number.isFinite(ms)) return "";
      const suffix = ms <= 0 ? "" : resolveZh() ? "后" : "";
      const abs = Math.abs(ms);
      const d = Math.floor(abs / 86400000);
      const h = Math.floor((abs % 86400000) / 3600000);
      const m = Math.floor((abs % 3600000) / 60000);
      if (ms <= 0) return resolveZh() ? "已重置" : "reset";
      if (d > 0) return `${resolveZh() ? `${d}天${h}时` : `${d}d ${h}h`}${suffix}`;
      if (h > 0) return `${resolveZh() ? `${h}时${m}分` : `${h}h ${m}m`}${suffix}`;
      return `${resolveZh() ? `${Math.max(m, 1)}分` : `${Math.max(m, 1)}m`}${suffix}`;
    }

    /**
     * 高峰时段（本地时区，仅工作日，[起,止) 分钟数）：只标 DeepSeek 工作日
     *   9:00–12:00、14:00–18:00（z.ai / opencode 无公开口径不标）。
     *   高峰时芯片前加红色「峰」字提示限流风险。
     * DeepSeek 峰谷补充（官方 2026-09-19 说明）：周六日全天、调休上班的周末、
     *   中国法定节假日全天均按空闲时段计费——前两者被周末判定覆盖，落在工作日的
     *   假期靠 USAGE_HOLIDAYS 免标。
     */
    const USAGE_PEAK_WINDOWS = {
      deepseek: [
        [540, 720],
        [840, 1080],
      ],
    };
    /**
     * 中国法定节假日（国务院办公厅年度安排，[起月,起日,止月,止日] 按年展开成日期集）。
     * 只维护已公布的年份：过期年份退回「工作日即可能标峰」，仅提示失真，不影响
     * 计费数字。2026 = 国办发明电〔2025〕7号；2027 安排公布后照式补一年。
     */
    const USAGE_HOLIDAYS = (() => {
      const YEAR_RANGES = {
        2026: [
          [1, 1, 1, 3], // 元旦
          [2, 15, 2, 23], // 春节
          [4, 4, 4, 6], // 清明
          [5, 1, 5, 5], // 劳动节
          [6, 19, 6, 21], // 端午
          [9, 25, 9, 27], // 中秋
          [10, 1, 10, 7], // 国庆
        ],
      };
      const set = new Set();
      for (const [year, ranges] of Object.entries(YEAR_RANGES)) {
        for (let [m1, d1, m2, d2] of YEAR_RANGES[year]) {
          for (let d = new Date(+year, m1 - 1, d1); d <= new Date(+year, m2 - 1, d2); d.setDate(d.getDate() + 1)) {
            set.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
          }
        }
      }
      return set;
    })();
    const usageDayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    function usageIsPeak(kind, now) {
      const wins = USAGE_PEAK_WINDOWS[kind];
      if (!wins) return false;
      const day = now.getDay();
      if (day === 0 || day === 6) return false; // 周末（含调休上班的周末）DeepSeek 全天按空闲计费
      if (kind === "deepseek" && USAGE_HOLIDAYS.has(usageDayKey(now))) return false; // 法定节假日全天
      const mins = now.getHours() * 60 + now.getMinutes();
      return wins.some(([a, b]) => mins >= a && mins < b);
    }

    /**
     * 芯片内容（官方 trigger 同款字体高度，纯数值）：
     *   deepseek → 单文本 ¥余额；opencode/zai → 全部窗口百分比数组（5h、周、月顺序，zai 无月窗）。
     * 返回 { text, hot? } 或 { wins:[percent] , }；null = 该家没数、不出芯片。
     */
    function usageChipParts(kind, card) {
      if (!card) return null;
      if (!card.ok) return { text: "—", hot: true };
      if (kind === "deepseek") {
        const info = (card.infos && card.infos[0]) || null;
        if (!info) return null;
        return { text: `${USAGE_CURRENCY_SYMBOL[info.currency] || (info.currency ? info.currency + " " : "")}${info.total}`, hot: card.available === false };
      }
      const wins =
        kind === "opencode"
          ? [card.windows && card.windows.rolling, card.windows && card.windows.weekly, card.windows && card.windows.monthly]
          : [card.limits && card.limits.find((l) => l.kind === "hours"), card.limits && card.limits.find((l) => l.kind === "week")];
      const parts = wins
        .map((win) => {
          const percent = win ? (Number.isFinite(win.percent) ? win.percent : Number.isFinite(win.percentage) ? win.percentage : null) : null;
          return percent;
        })
        .filter((p) => p !== null);
      return parts.length > 0 ? { wins: parts } : null;
    }

    function UsageLine(props) {
      const { sessionId, useSession } = props;
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion);
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      const [, forceTick] = react.useState(0); // 重置倒计时每分钟重算
      // 官方回合运行位（与 MonitorLine 同源）：回合收尾时补一拍刷新
      const running = typeof useSession === "function" ? useSession((s) => s.running) : false;
      const dirsVersion = react.useSyncExternalStore(
        (cb) => {
          usageDirsSubs.add(cb);
          return () => usageDirsSubs.delete(cb);
        },
        () => usageDirs.version,
      );
      // 当前会话选中的模型 provider → 卡位；目录 store 换身（load 后）也要重读
      const [kind, setKind] = react.useState(null);
      react.useEffect(() => {
        if (!usageModelDirs || !sessionId) {
          setKind(null);
          return undefined;
        }
        let alive = true;
        let off = null;
        let dir = null;
        try {
          dir = usageModelDirs.directoryFor(sessionId);
        } catch {
          return undefined; // 未知会话（服务端明说 fail loud）：芯片静默退场
        }
        const store = dir && dir.store;
        if (!store || typeof store.subscribe !== "function") return undefined;
        const read = () => {
          if (!alive) return;
          const cur = store.getSnapshot() && store.getSnapshot().current;
          setKind(usageProviderKind(cur && cur.provider));
        };
        try {
          off = store.subscribe(read);
        } catch {
          return undefined;
        }
        read();
        // 目录懒构造，catalog 首次 load 才落 current：主动补一拍（错误落 store 不外抛）
        try {
          void Promise.resolve(dir.load()).catch(() => {});
        } catch {
          /* 老宿主形态差异：读不到就靠投影 */
        }
        return () => {
          alive = false;
          try {
            if (off) off();
          } catch {
            /* 已注销 */
          }
        };
      }, [sessionId, dirsVersion]);
      const [data, setData] = react.useState(() => usageData.body);
      const [open, setOpen] = react.useState(false);
      const anchorRef = react.useRef(null); // 芯片按钮（浮层锚点）
      const panelRef = react.useRef(null);
      const load = react.useCallback(async (fresh) => {
        // 开关刚关（403）或网络失败：保留旧数据，下一轮轮询再试
        try {
          const body = await kitJson(`/dsh-kit/usage${fresh ? "?fresh=1" : ""}`, undefined, (b) => b !== null && typeof b.providers === "object");
          usageData.body = body;
          usageData.at = Date.now();
          setData(body);
        } catch {}
      }, []);
      // 回合收尾（running true→false）立即补一拍：配额刚被这轮消耗，等 60s 轮询太慢；
      // 10s 防抖兜连续短回合
      const prevRunningRef = react.useRef(running);
      react.useEffect(() => {
        if (prevRunningRef.current === true && running === false && Date.now() - usageData.at >= 10000) {
          void load(false);
        }
        prevRunningRef.current = running;
      }, [running, load]);
      react.useEffect(() => {
        void load(false);
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          forceTick((n) => n + 1);
          // 5 分钟节拍：>=60s 才真拉（宿主还有 60s 缓存，多组件挂载借模块缓存去重）
          if (Date.now() - usageData.at >= 60000) void load(false);
        }, 60000);
        return () => clearInterval(timer);
      }, [load]);
      react.useEffect(() => {
        if (kind === null) setOpen(false);
      }, [kind]);
      // Esc 关浮层（官方 ContextMeter 同款）
      react.useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
          if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
      }, [open]);
      // 官方 primitives 钩子：模块级判定可用性（运行期恒定），条件调用不违反 hooks 规则
      const position = usageUseAnchoredPosition
        ? usageUseAnchoredPosition({ open, anchorRef, panelRef, side: "top", gap: 8, margin: 12 })
        : null;
      if (usageUseDismiss) usageUseDismiss(anchorRef, open, setOpen, panelRef);
      // 官方定位会把 top 钳进视口（Math.max(top, margin)）——composer 偏上时上方空间
      // 不足，面板就被压到锚点下方（「向下展开」）。把面板 max-height 限到锚点上方
      // 空间，钳制条件永不触发，面板恒贴芯片正上方，放不下就内部滚动
      react.useLayoutEffect(() => {
        if (!open) return undefined;
        const cap = () => {
          const rect = anchorRef.current ? anchorRef.current.getBoundingClientRect() : null;
          const panel = panelRef.current;
          if (!rect || !panel) return;
          panel.style.maxHeight = `${Math.max(rect.top - 20, 160)}px`;
        };
        cap();
        window.addEventListener("scroll", cap, true);
        window.addEventListener("resize", cap);
        return () => {
          window.removeEventListener("scroll", cap, true);
          window.removeEventListener("resize", cap);
        };
      }, [open]);

      // usageEnabled = 本组件自己的 Config；关 = 不出芯片（端点同源 403 兜底）
      if (!kind || cfg.usageEnabled !== true) return null;
      const providers = (data && data.providers) || {};
      const card = providers[kind] || null;
      const parts = usageChipParts(kind, card);
      if (parts === null) return null;
      const now = Date.now();
      const peak = usageIsPeak(kind, new Date()); // forceTick 每分钟重渲染，跨过时段边界一分钟内变色
      const kindTitle = () => (kind === "deepseek" ? t("usageDeepseek") : kind === "opencode" ? t("usageOpencode") : t("usageZai"));

      /** 浮层里的窗口行：dt/dd 官方行 + 进度条（官方 bar/segment 样式），sub 行放 credits 与重置 */
      const windowBlock = (label, win) => {
        if (!win) return null;
        const percent = Number.isFinite(win.percent) ? win.percent : Number.isFinite(win.percentage) ? win.percentage : null;
        const resetAt = win.resetsAt ? Date.parse(win.resetsAt) : win.nextResetTime;
        const credits =
          win.currentValue !== undefined && Number.isFinite(win.currentValue)
            ? `${win.currentValue}/${win.usage || "—"} credits`
            : null;
        const sub = [credits, resetAt ? `${t("usageResets")} ${usageFmtCountdown(resetAt, now)}` : null].filter(Boolean).join(" · ");
        return jsxRuntime.jsxs("div", { children: [
          jsxRuntime.jsxs("dl", { className: "dshk-usage-row", children: [
            jsxRuntime.jsx("dt", { children: label }),
            jsxRuntime.jsx("dd", { className: percent !== null && percent >= 80 ? "dshk-usage-hot" : undefined, children: percent === null ? "—" : `${percent}%` }),
          ] }),
          sub !== "" ? jsxRuntime.jsx("div", { className: "dshk-usage-sub", children: sub }) : null,
          jsxRuntime.jsx("div", { className: "dshk-usage-bar", children: percent === null ? null : jsxRuntime.jsx("span", { className: `dshk-usage-segment${percent >= 80 ? " is-hot" : ""}`, style: { width: `${Math.min(percent, 100)}%` } }) }),
        ] }, label);
      };

      const panel = (() => {
        if (!open || !card) return null;
        const ok = card.ok === true;
        let figure = null;
        let badge = null;
        let body = null;
        if (!ok) {
          badge = { text: card.error || t("usageNoCard"), hot: true };
        } else if (kind === "deepseek") {
          const info = (card.infos && card.infos[0]) || null;
          if (info) figure = `${USAGE_CURRENCY_SYMBOL[info.currency] || ""}${info.total}`;
          badge =
            card.available === false
              ? { text: t("usagePaused"), hot: true }
              : card.available === true
                ? { text: t("usageAvailable") }
                : null;
          body = (card.infos || []).map((info) =>
            jsxRuntime.jsxs("div", { className: "dshk-usage-rows", children: [
              jsxRuntime.jsxs("dl", { className: "dshk-usage-row", children: [
                jsxRuntime.jsx("dt", { children: t("usageBalanceTotal") }),
                jsxRuntime.jsx("dd", { children: `${USAGE_CURRENCY_SYMBOL[info.currency] || ""}${info.total}` }),
              ] }),
              info.granted && info.granted !== "0"
                ? jsxRuntime.jsxs("dl", { className: "dshk-usage-row", children: [
                    jsxRuntime.jsx("dt", { children: t("usageBalanceGranted") }),
                    jsxRuntime.jsx("dd", { children: info.granted }),
                  ] })
                : null,
              info.toppedUp && info.toppedUp !== "0"
                ? jsxRuntime.jsxs("dl", { className: "dshk-usage-row", children: [
                    jsxRuntime.jsx("dt", { children: t("usageBalanceToppedUp") }),
                    jsxRuntime.jsx("dd", { children: info.toppedUp }),
                  ] })
                : null,
            ] }, info.currency));
        } else if (kind === "opencode") {
          const win = card.windows && card.windows.rolling;
          const percent = win ? (Number.isFinite(win.percent) ? win.percent : null) : null;
          if (percent !== null) figure = `${percent}%`;
          body = [
            windowBlock(t("usageW5h"), card.windows && card.windows.rolling),
            windowBlock(t("usageWeek"), card.windows && card.windows.weekly),
            windowBlock(t("usageMonth"), card.windows && card.windows.monthly),
          ];
        } else {
          const hours = card.limits && card.limits.find((l) => l.kind === "hours");
          const percent = hours ? (Number.isFinite(hours.percentage) ? hours.percentage : null) : null;
          if (percent !== null) figure = `${percent}%`;
          badge = card.level ? { text: `${t("usageLevel")} ${card.level}` } : badge;
          body = (card.limits || []).map((l) =>
            windowBlock(l.kind === "hours" ? (l.number && l.number !== 5 ? `${l.number} ${t("usageW5h")}` : t("usageW5h")) : t("usageWeek"), l),
          );
        }
        return reactDom.createPortal(
          jsxRuntime.jsxs("div", {
            ref: panelRef,
            className: "dshk-usage-pop",
            style: position ?? { visibility: "hidden", left: 0, top: 0 },
            role: "dialog",
            "aria-label": kindTitle(),
            children: [
              jsxRuntime.jsxs("div", { className: "dshk-usage-header", children: [
                jsxRuntime.jsx("span", { className: "dshk-usage-headline", children: kindTitle() }),
                badge ? jsxRuntime.jsx("span", { className: `dshk-usage-percent${badge.hot ? " dshk-usage-hot" : ""}`, children: badge.text }) : null,
                figure !== null ? jsxRuntime.jsx("span", { className: "dshk-usage-figures", children: figure }) : null,
              ] }),
              body,
              jsxRuntime.jsxs("div", { className: "dshk-usage-foot", children: [
                jsxRuntime.jsx("span", { children: `${t("usageUpdatedAt")} ${usageData.at ? new Date(usageData.at).toLocaleTimeString() : "—"}` }),
                USAGE_LINKS[kind]
                  ? jsxRuntime.jsx("a", { className: "dshk-usage-link", href: USAGE_LINKS[kind], target: "_blank", rel: "noreferrer", children: t("usageOfficialPage") })
                  : null,
                jsxRuntime.jsx("button", { type: "button", className: "dshk-usage-refresh", onClick: () => void load(true), children: t("usageRefresh") }),
              ] }),
            ],
          }),
          document.body,
          "dshk-usage-pop",
        );
      })();

      const tooltipLabel =
        (kind === "deepseek"
          ? t("usageDeepseek")
          : `${kindTitle()} · ${resolveZh() ? (kind === "opencode" ? "5小时/周/月窗口" : "5小时/周窗口") : kind === "opencode" ? "5h/week/month" : "5h/week"}`) +
        (peak ? ` · ${resolveZh() ? "高峰时段" : "peak hours"}` : "");
      const trigger = jsxRuntime.jsx("button", {
        type: "button",
        className: `dshk-usage-trigger${parts.hot || peak ? " dshk-usage-hot" : ""}`,
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        onClick: (e) => {
          anchorRef.current = e.currentTarget;
          setOpen(!open);
        },
        children: (() => {
          const items = [];
          if (peak) items.push(jsxRuntime.jsx("span", { className: "dshk-usage-peak", children: resolveZh() ? "峰" : "P" }, "peak"));
          if (parts.text !== undefined) items.push(parts.text);
          else
            parts.wins.forEach((p, i) => {
              if (i > 0) items.push(jsxRuntime.jsx("span", { className: "dshk-usage-sep", children: "·" }, "sep" + i));
              items.push(jsxRuntime.jsxs("span", { className: `dshk-usage-win${p >= 80 ? " is-hot" : ""}`, children: [p, "%"] }, "w" + i));
            });
          return items;
        })(),
      });
      return jsxRuntime.jsxs("div", { className: "dshk-usage", children: [
        usageTooltip
          ? jsxRuntime.jsx(usageTooltip, { label: tooltipLabel, side: "top", delayMs: 200, disabled: open, children: trigger })
          : jsxRuntime.jsx("span", { title: tooltipLabel, children: trigger }),
        panel,
      ] });
    }

    exports.inject = ["slots"];
    exports.apply = async (ctx) => {
      slotsCtx = ctx;
      // 组件配置页：挂在插件页本组件行上的「配置」。行由 dsh-kit bundle 的 patch
      // 声明，槽位 key = <包名>#<行id>——两种包名口径各挂一枚（页面按精确 key 匹配，
      // 未命中的那枚永远不渲染），宿主改口径也不用动组件
      for (const key of ["dsh-kit#monitor", "dsh-kit-monitor#monitor"]) {
        ctx.slots.inject("plugins.row.config", () =>
          ctx.slots.register({ name: "plugins.row.config", key }, MonitorConfigPage),
        );
      }
      // modelDirectories 懒就绪：就绪时通知订阅者重读（用量芯片据此显隐）
      ctx.inject(["modelDirectories"], (mctx) => {
        usageModelDirs = mctx.modelDirectories || null;
        usageDirsNotify();
      });
      // 用量芯片（usageEnabled 门控在组件内）。槽位由官方 conversation 挂载期声明，
      // 一律经 slots.inject 等声明落地再注册（直接 register 会炸整树 boot）
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-kit-usage", order: 6 },
          UsageLine,
        ),
      );
      // 会话监视条（同槽 order 5，排官方 StatsLine 之后）与头部 429 状态条
      // （monitorEnabled 门控在组件内，状态条零常驻）
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-kit-monitor", order: 5 },
          MonitorLine,
        ),
      );
      ctx.slots.inject("conversation.session.header.actions", () =>
        ctx.slots.register(
          { name: "conversation.session.header.actions", id: "dsh-kit-monitor-bg", order: 21 },
          MonitorBgAction,
        ),
      );
      // 全局 429 续跑器主循环：轮询自守卫（服务未就绪直接跳过），monitorEnabled 关时空转
      setInterval(monitorTick, MONITOR_TICK_MS);
      // 会话通知：订阅官方两个数据源（就绪时机不保证，用 inject 等）。uiSession
      // 缺位（精简组合/老宿主）时只订阅列表——完成通知照发，提问通知降级为不发
      ctx.inject(["sessions"], (sctx) => {
        const offs = [];
        let pendingStore = null;
        const evaluate = () => notifyEvaluate(sctx.sessions, pendingStore);
        // 压缩完成：给列表里的会话各挂一个事件窗口订阅。窗口是会话「上台」才开的
        // （历史按需拉），没上过台的窗口恒空、自然静默；上过台的即便切走也仍在收流。
        // 列表变化时对账增删——会话被移除/归档即退订
        const compactionSubs = new Map(); // sessionId -> off
        const syncCompactionSubs = () => {
          let ids;
          try {
            ids = sctx.sessions.list.getSnapshot().ids ?? [];
          } catch {
            return; // 服务异常：下条推送再来
          }
          for (const id of ids) {
            if (compactionSubs.has(id)) continue;
            try {
              const source = sctx.sessions.binding(id)?.eventSource;
              if (source && typeof source.subscribe === "function") {
                compactionSubs.set(id, source.subscribe(() => notifyCompactionEvaluate(sctx.sessions, id)));
              }
            } catch {
              /* 该会话暂不可绑定：下一轮列表变化再试 */
            }
          }
          const live = new Set(ids);
          for (const [id, off] of [...compactionSubs]) {
            if (live.has(id)) continue;
            compactionSubs.delete(id);
            try {
              off();
            } catch {
              /* 已注销 */
            }
          }
          for (const id of [...notifyState.compactions.keys()]) if (!live.has(id)) notifyState.compactions.delete(id);
        };
        const sync = () => {
          evaluate();
          syncCompactionSubs();
        };
        if (typeof sctx.inject === "function") {
          sctx.inject(["uiSession"], (uctx) => {
            pendingStore = uctx.uiSession ? uctx.uiSession.pendingInteractions : null;
            if (pendingStore && typeof pendingStore.subscribe === "function") offs.push(pendingStore.subscribe(evaluate));
            evaluate();
          });
        }
        const listStore = sctx.sessions ? sctx.sessions.list : null;
        if (listStore && typeof listStore.subscribe === "function") offs.push(listStore.subscribe(sync));
        sync(); // 首帧播种：列表里已在跑的会话不补发通知，窗口里已有的压缩同理
        sctx.effect(() => () => {
          for (const off of offs) {
            try {
              off();
            } catch {
              /* 已注销 */
            }
          }
          for (const off of compactionSubs.values()) {
            try {
              off();
            } catch {
              /* 已注销 */
            }
          }
          compactionSubs.clear();
        });
      });
      // 标题闪烁复原（未授权时的兜底标记）：回窗口即清
      document.addEventListener("visibilitychange", notifyMaybeUnflash);
      window.addEventListener("focus", notifyMaybeUnflash);
      // 提问 / 批准事件：旁听官方 remote 瀑布（根 ctx 上收全部会话的请求，含后台
      // 会话——官方 UI 只在会话上台时接管，那半边它接不到）。remote 服务缺位
      // （老宿主）时静默降级：只剩完成通知与官方待回应投影那一半
      ctx.inject(["remote", "sessions"], (rctx) => {
        try {
          rctx.remote.$on("user-questions/request", notifyRequestListener(rctx.sessions, "question"));
          rctx.remote.$on("approval/request", notifyRequestListener(rctx.sessions, "approval"));
        } catch {
          /* 缺 $on（宿主形态不同）：静默降级为只剩完成通知那一半 */
        }
      });
    };

    // 渲染级检查与单测取用（依赖注入的纯核心，直测不经过 apply）
    exports.MonitorLine = MonitorLine;
    exports.MonitorBgAction = MonitorBgAction;
    exports.monitorTickCore = monitorTickCore;
    exports.monitorTailRepeatCount = monitorTailRepeatCount;
    exports.monitorCancelPlan = monitorCancelPlan;
    exports.notifyDiffCore = notifyDiffCore;
    exports.notifyCompactionCore = notifyCompactionCore;
    exports.notifyCompleteSettled = notifyCompleteSettled;
    exports.monitorStore = monitorStore; // 测试注入活动快照用
    exports.monitorSessions = monitorSessions;
    exports.usageIsPeak = usageIsPeak;
    return exports;
  },
});