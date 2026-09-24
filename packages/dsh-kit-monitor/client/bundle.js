// dsh-kit-monitor 浏览器半边 —— 用量与监视组件的 client 面。
// 现收纳：余额与用量芯片（UsageLine，composer.dock 槽位）。429 续跑/死循环/
// 通知暂在主包，后续轮迁入。
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
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // 组件配置快照：拉本组件自己的 /dsh-kit-monitor/config（usageEnabled）
    let cfgSnap = { ready: false, usageEnabled: false };
    const cfgSubs = new Set();
    async function loadCfg() {
      let next;
      try {
        const v = await kitJson("/dsh-kit-monitor/config", undefined, (b) => b !== null && typeof b === "object");
        next = { ready: true, usageEnabled: v.usageEnabled === true };
      } catch {
        next = { ready: true, usageEnabled: false }; // 端点不可达按关处理（与门控同源语义）
      }
      cfgSnap = next;
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
    void loadCfg();

    // 组件私有样式：芯片 + 浮层（面板样式复刻官方 ContextMeter，哈希类名复用不了）
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent = [
        ".dshk-usage{order:1;margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:2px}",
        ".dshk-usage-win{display:inline-flex;align-items:center;gap:2px}",
        ".dshk-usage-win.is-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-sep{color:var(--dsw-alias-label-tertiary);opacity:.7}",
        ".dshk-usage-peak{color:var(--dsw-alias-danger);font-weight:600;margin-right:2px}",
        ".dshk-usage-trigger{color:var(--dsw-alias-label-tertiary);font-family:inherit}",
        ".dshk-usage-trigger:hover,.dshk-usage-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshk-usage-trigger.dshk-usage-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-trigger.dshk-usage-hot:hover,.dshk-usage-trigger.dshk-usage-hot[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshk-usage-pop{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:min(264px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:fixed}",
        ".dshk-usage-header{align-items:center;gap:6px;display:flex}",
        ".dshk-usage-headline{color:var(--dsw-alias-label-tertiary);min-width:0}",
        ".dshk-usage-percent{color:var(--dsw-alias-label-primary);font-weight:500}",
        ".dshk-usage-figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}",
        ".dshk-usage-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-rows{margin:6px 0 0}",
        ".dshk-usage-row{justify-content:space-between;align-items:center;gap:12px;display:flex}",
        ".dshk-usage-row dt{color:var(--dsw-alias-label-secondary)}",
        ".dshk-usage-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}",
        ".dshk-usage-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
        ".dshk-usage-bar{corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;height:4px;overflow:hidden;margin-top:4px}",
        ".dshk-usage-segment{background:var(--meter-tint,var(--dsw-alias-label-primary));display:block;height:100%;border-radius:inherit}",
        ".dshk-usage-segment.is-hot{--meter-tint:var(--dsw-alias-danger)}",
        ".dshk-usage-foot{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:7px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}",
        ".dshk-usage-link{margin-left:auto;color:var(--dsw-alias-label-secondary);text-decoration:none;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px}",
        ".dshk-usage-link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshk-usage-refresh{appearance:none;border:.5px solid var(--dsw-alias-border-l1);background:0 0;border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
        ".dshk-usage-refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
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
      const cfg = react.useSyncExternalStore(subscribeCfg, getCfgSnapshot);
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
      // modelDirectories 懒就绪：就绪时通知订阅者重读（芯片据此显隐）
      ctx.inject(["modelDirectories"], (mctx) => {
        usageModelDirs = mctx.modelDirectories || null;
        usageDirsNotify();
      });
      // composer.dock 槽位由官方 conversation 的 composer factory 挂载时声明，
      // apply 期尚不存在——slots.inject 等声明落地后再注册（fiber 卸载随级联注销）
      ctx.slots.inject(
        "conversation.composer.dock",
        () => ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-kit-usage", order: 6 },
          UsageLine,
        ),
      );
    };

    exports.usageIsPeak = usageIsPeak; // 渲染级检查与单测取用
    return exports;
  },
});