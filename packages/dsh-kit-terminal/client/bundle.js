// dsh-kit-terminal 浏览器半边 —— 终端组件的 client 面。
// 收纳：对话输入行的终端入口（多会话角标）+ 底部停靠多标签终端坞 + xterm 胶水
// （引擎 = 官方 webTerminals 服务，PTY 归宿主：会话工作区绑定、刷新保活、后台清理）。
// 入口与坞分属两个槽位（conversation.input.left / shell.overlay），共享 kitBase 的
// kitUi 跨槽状态（terminals/activeTermId/termDockOpen）；开关读本组件 Config
// （/dsh-kit-terminal/config），键位注册进官方 shortcuts 服务。xterm 静态资源走主包
// /dsh-kit/vendor 白名单（静态口套件共用）。
window.__ModuleLoader__.load({
  id: "dsh-kit-terminal",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = require("dsh-kit");
    const {
      setKitUi, getKitUi, useKitUi, useCurrentRow,
      KitTip, attachShortcutCatalog,
      flashToast, resolveZh, subscribeLocale, getLocaleVersion, kitJson,
    } = dock;

    // 组件私有文案（终端词条随坞迁入本包；contentFail 与 root 的技能页同文，
    // 但本包 t() 只看本包词典，用到就得在这里备一份）
    const zh = {
      label: "终端",
      noCwd: "没有可用的会话工作区：先打开或创建一个会话",
      connecting: "连接中…",
      exited: "已退出",
      code: "代码",
      restart: "重新启动终端",
      termNew: "新建终端",
      termHide: "隐藏终端坞（进程继续运行）",
      termTabClose: "结束此终端",
      termCloseAll: "结束全部终端",
      vendorFail: "终端组件加载失败",
      officialTermUnavailable: "官方终端服务不可用：此功能需要 DSH 0.1.6+",
      termLimit: "宿主终端数量已达上限：先结束一些再新建",
      contentFail: "读取失败",
      kcfgGroupFeatures: "功能开关",
      kcfgTerminalEnabled: "终端面板",
      kcfgTerminalEnabledHint: "对话输入行出终端入口，面板停靠底部（引擎为官方 webTerminals）。",
      scTerminal: "终端面板",
      scTerminalOff: "终端面板已在配置页关闭",
    };
    const en = {
      label: "Terminal",
      noCwd: "No session workspace available: open or create a session first",
      connecting: "Connecting…",
      exited: "Exited",
      code: "code",
      restart: "Restart terminal",
      termNew: "New terminal",
      termHide: "Hide dock (processes keep running)",
      termTabClose: "Kill this terminal",
      termCloseAll: "Kill all terminals",
      vendorFail: "Failed to load terminal components",
      officialTermUnavailable: "Official terminal service unavailable: requires DSH 0.1.6+",
      termLimit: "Host terminal limit reached: kill some terminals first",
      contentFail: "Failed to read",
      kcfgGroupFeatures: "Features",
      kcfgTerminalEnabled: "Terminal panel",
      kcfgTerminalEnabledHint: "Adds the terminal entry to the composer; the panel docks at the bottom (official webTerminals engine).",
      scTerminal: "Terminal dock",
      scTerminalOff: "Terminal dock is switched off in the config page",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // ─────────── 组件配置（/dsh-kit-terminal/config，Config schema 唯一真源）───────
    // 键位不在这里：终端命令注册进官方 shortcuts 服务（见 registerShortcuts），
    // 录制与持久化归官方「快捷键」页。
    const T_CFG_DEFAULTS = {
      terminalEnabled: true,
    };
    let cfgSnap = null;
    const cfgSubs = new Set();
    const emitCfg = () => {
      for (const fn of cfgSubs) {
        try {
          fn();
        } catch {
          /* 订阅者已卸载 */
        }
      }
    };
    async function loadCfg() {
      let value = null;
      try {
        const v = await kitJson("/dsh-kit-terminal/config", undefined, (b) => b !== null && typeof b === "object");
        value = v;
      } catch {
        value = null; // 端点不可达：null → cfgFromSnapshot 走内置默认
      }
      cfgSnap = value && typeof value === "object" ? { status: "ready", value } : null;
      emitCfg();
      sweepDisabledTerm();
    }
    const subscribeCfg = (fn) => {
      cfgSubs.add(fn);
      return () => cfgSubs.delete(fn);
    };
    const getCfgSnapshot = () => cfgSnap;
    /** 从快照提取生效配置（字段缺失/非法逐项回退默认） */
    function cfgFromSnapshot(snap) {
      const out = { ...T_CFG_DEFAULTS };
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return out;
      out.terminalEnabled = snap.value.terminalEnabled !== false;
      return out;
    }
    /** 配置关但会话还开着（配置页保存 / entry 重启瞬间）：立即清场——结束全部终端，
     *  与「关 = 入口消失」的语义一致。每条配置通道都经 loadCfg，故清场挂在那里 */
    function sweepDisabledTerm() {
      if (cfgFromSnapshot(getCfgSnapshot()).terminalEnabled) return;
      const ui = getKitUi();
      if (ui.terminals.length > 0 || ui.termDockOpen) {
        setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
      }
    }

    // ─────────── 组件样式 ───────────
    /** 终端面板高度（坞高度与让位 padding 共用一个变量） */
    const DOCK_H = "min(34vh, 330px)";
    const TERMINAL_CSS = `
.dshk-dock{position:fixed;left:0;width:100%;bottom:0;height:var(--dshk-dock-h,${DOCK_H});display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-top:1px solid var(--dsw-alias-border-l1);box-shadow:0 -6px 20px rgba(0,0,0,.14);z-index:800;pointer-events:auto}
/* 终端坞标签是固定短文字，不参与弹性：head 里 title 与 spring 双 flex:1 会把空闲
   空间对半分，宽窗口下标签簇（页签/路径）飘到中间，只有窄窗口看着正常 */
.dshk-dock-label{flex:0 0 auto}
.dshk-sub{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.dshk-term{height:100%}
/* padding 加在 .xterm 元素上：fit addon 从该元素读 padding 并从可用面积扣除，cols/rows 不会算错 */
.dshk-term .xterm{height:100%;box-sizing:border-box;padding:6px 10px}
.dshk-term .xterm-viewport::-webkit-scrollbar{width:8px}
.dshk-term .xterm-viewport::-webkit-scrollbar-thumb{background:rgba(127,127,127,.3);border-radius:4px}
.dshk-term .xterm-viewport::-webkit-scrollbar-track{background:transparent}
.dshk-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:13px}
/* 多终端：入口图标数量角标 + 标签条 + 堆叠 pane（隐藏 pane 离屏缓冲输出） */
/* 品牌主色是单色令牌（浅色主题近黑、深色主题近白），主色底上的文字一律用 bg-base 取反——
   写死 #fff 在深色主题就是白底白字 */
.dshk-term-badge{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:9px;line-height:14px;text-align:center;font-weight:600}
.dshk-tstack{position:relative;flex:1 1 auto;min-height:0}
.dshk-tpane{position:absolute;inset:0;padding:2px 8px 8px;box-sizing:border-box;display:none}
.dshk-tpane[data-on]{display:block}
.dshk-tbody{height:100%;position:relative}
.dshk-term-note{position:absolute;top:8px;left:50%;transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;max-width:92%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);pointer-events:none;z-index:5}
.dshk-term-note button{pointer-events:auto}
/* 让位布局：终端打开时把对话列顶起，内容不被遮挡（终端宽度即对话列宽） */
body.dshk-open [class*="_centerCol"]{padding-bottom:var(--dshk-dock-h,${DOCK_H})}
/* 面板开合只保留 dock 的 padding-bottom 过渡：margin-right 如果也带过渡动画，
   每帧都会触发官方对话宽度 ResizeObserver 重发布 + 长消息流重排（卡顿），
   让位改为瞬时完成一次，视觉缓冲交给面板自身的 width 过渡 */
[class*="_centerCol"]{transition:padding-bottom .18s ease}
@media (prefers-reduced-motion:reduce){[class*="_centerCol"]{transition:none}}
    `;
    /** 注入本组件样式与 xterm.css（link），幂等 */
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit-terminal/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit-terminal";
        tag.dataset.pluginCss = "dsh-kit-terminal/ui";
        tag.textContent = TERMINAL_CSS;
        document.head.appendChild(tag);
      }
      if (document.querySelector('link[data-plugin-css="dsh-kit-terminal/xterm"]') === null) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.dataset.plugin = "dsh-kit-terminal";
        link.dataset.pluginCss = "dsh-kit-terminal/xterm";
        link.href = "/dsh-kit/vendor/xterm.css";
        document.head.appendChild(link);
      }
    }

    // ─────────── vendor 按需加载 ───────────
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("load failed: " + src));
        document.head.appendChild(s);
      });
    }
    let vendorPromise = null;
    /** 官方预编译 UMD：xterm.js → window.Terminal；addon-fit.js → window.FitAddon.FitAddon */
    function ensureVendor() {
      if (vendorPromise === null) {
        vendorPromise =
          typeof window.Terminal === "function" && window.FitAddon && typeof window.FitAddon.FitAddon === "function"
            ? Promise.resolve()
            : loadScript("/dsh-kit/vendor/xterm.js").then(() => loadScript("/dsh-kit/vendor/addon-fit.js"));
      }
      return vendorPromise;
    }

    // ─────────── 外观跟随 ───────────
    /** DSH 主题 presenter 以 body[data-ds-dark-theme] 有无表达明暗 */
    function isDark() {
      return typeof document !== "undefined" && document.body.hasAttribute("data-ds-dark-theme");
    }
    /** 读令牌 computed 值（xterm 需要具体色值），取不到时退回兜底色 */
    function tokenColor(name, fallback) {
      try {
        const v = getComputedStyle(document.body).getPropertyValue(name).trim();
        return v !== "" ? v : fallback;
      } catch {
        return fallback;
      }
    }
    const ANSI_DARK = {
      black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
      blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
      brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543",
      brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#ffffff",
    };
    const ANSI_LIGHT = {
      black: "#000000", red: "#cd3131", green: "#00bc00", yellow: "#949800",
      blue: "#0451a5", magenta: "#bc05bc", cyan: "#0598bc", white: "#555555",
      brightBlack: "#666666", brightRed: "#cd3131", brightGreen: "#14ce14", brightYellow: "#b2ba00",
      brightBlue: "#0451a5", brightMagenta: "#bc05bc", brightCyan: "#0598bc", brightWhite: "#a5a5a5",
    };
    /** 组装 xterm 调色板：背景/前景跟随应用令牌，ANSI 按明暗取标准套 */
    function xtermTheme() {
      const dark = isDark();
      const fg = tokenColor("--dsw-alias-label-primary", dark ? "#cccccc" : "#333333");
      return {
        background: tokenColor("--dsw-alias-bg-base", dark ? "#181818" : "#ffffff"),
        foreground: fg,
        cursor: fg,
        cursorAccent: tokenColor("--dsw-alias-bg-base", dark ? "#181818" : "#ffffff"),
        selectionBackground: dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)",
        ...(dark ? ANSI_DARK : ANSI_LIGHT),
      };
    }

    // ── 多终端会话模型 ──
    // terminals:[{id, sessionId, cwd}] 创建顺序即标签顺序；每个终端在创建那一刻
    // 绑定当时的会话（官方引擎按会话起 PTY，cwd 定在会话工作区，cwd 只剩标签
    // 文案用途）。termDockOpen 只管坞的可见性——隐藏不杀进程，后台标签的 shell
    // 继续跑、xterm 继续缓冲输出；标签 ✕ 才真正结束对应宿主终端。
    let termSeq = 0;
    const makeTerm = (sessionId, cwd) => ({ id: `term-${++termSeq}`, sessionId, cwd });
    /** 入口按钮与快捷键共用：开=恢复视图（无会话则新建绑定当前会话）；关=仅隐藏 */
    function toggleTermDock(ui, sessionId, cwd) {
      if (ui.termDockOpen) return { termDockOpen: false };
      if (ui.terminals.length === 0) {
        const nt = sessionId ? makeTerm(sessionId, cwd) : null;
        return nt ? { termDockOpen: true, terminals: [nt], activeTermId: nt.id } : { termDockOpen: true };
      }
      return { termDockOpen: true, activeTermId: ui.activeTermId ?? ui.terminals[ui.terminals.length - 1].id };
    }
    /** ＋ 新建终端：绑定调用那一刻的当前会话 */
    function spawnTerm(ui, sessionId, cwd) {
      const nt = makeTerm(sessionId ?? "", cwd ?? "");
      return { terminals: [...ui.terminals, nt], activeTermId: nt.id, termDockOpen: true };
    }
    /** 标签 ✕：从列表移除（组件卸载即结束宿主终端），激活位顺延邻居 */
    function killTerm(ui, id) {
      const idx = ui.terminals.findIndex((x) => x.id === id);
      if (idx < 0) return {};
      const rest = ui.terminals.filter((x) => x.id !== id);
      const patch = { terminals: rest };
      if (ui.activeTermId === id) {
        patch.activeTermId = rest.length > 0 ? rest[Math.min(idx, rest.length - 1)].id : null;
      }
      if (rest.length === 0) patch.termDockOpen = false;
      return patch;
    }
    // 快捷键的 resolve 在渲染之外调用，闭包拿不到当前会话——由入口/坞渲染期回填
    let lastSession = { id: null, cwd: null };
    /** 官方终端模型服务（0.1.6+）：apply 期 inject 捕获，缺服务 = 坞报版本提示 */
    let webTerminalsSvc = null;

    // ─────────── 终端坞（多标签）───────────
    // TerminalPane = 一个终端会话，挂载即接管宿主 TerminalView、卸载即结束进程；
    // TerminalDock = 底部停靠容器：头部标签条（＋ 新建 / ⟳ 重启 / — 隐藏），body
    // 纵向堆叠各 pane，仅激活 pane 可见。隐藏的 pane 保持挂载：xterm 离屏继续缓冲
    // 输出，切回不丢内容（display:none 期间跳过 fit，切回由 ResizeObserver 自动补）。
    /** execCommand 兜底复制：手机经局域网 http 访问属非安全上下文，navigator.clipboard 不存在 */
    function execCopyText(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // 尽力而为
      }
      ta.remove();
    }
    function TerminalPane({ term, visible, restartKey, onRestart, onShell }) {
      const bodyRef = react.useRef(null);
      const [state, setState] = react.useState({ phase: "connecting", detail: "" });
      const visibleRef = react.useRef(visible);
      visibleRef.current = visible;

      react.useEffect(() => {
        // 引擎 = 官方 webTerminals（宿主 PTY：系统用户权限、刷新不丢、后台清理）；
        // 本组件只做 xterm 胶水。
        const svc = webTerminalsSvc;
        if (!svc || typeof svc.view !== "function") {
          setState({ phase: "error", detail: t("officialTermUnavailable") });
          return undefined;
        }
        if (!term.sessionId) {
          setState({ phase: "error", detail: t("noCwd") });
          return undefined;
        }
        let disposed = false;
        setState({ phase: "connecting", detail: "" });

        let termInst = null;
        let host = null;
        let fitAddon = null;
        let resizeTimer = 0;
        let themeObserver = null;
        let view = null;
        let cleanupState = null;
        const detachRef = { current: null };

        const sendResize = () => {
          if (disposed || !visibleRef.current || !termInst || !fitAddon) return; // 隐藏时不 fit
          try {
            fitAddon.fit();
          } catch {
            return;
          }
          try {
            view.resize(termInst.cols, termInst.rows);
          } catch {
            // 进程可能刚退出
          }
        };
        const scheduleResize = () => {
          if (resizeTimer || disposed) return;
          resizeTimer = window.setTimeout(() => {
            resizeTimer = 0;
            sendResize();
          }, 60);
        };
        const ro = new ResizeObserver(scheduleResize);

        ensureVendor()
          .then(() => {
            if (disposed) return;
            termInst = new window.Terminal({
              fontSize: 13,
              lineHeight: 1.15,
              fontFamily: 'ui-monospace, Consolas, "Cascadia Mono", "Courier New", monospace',
              cursorBlink: true,
              scrollback: 5000,
              theme: xtermTheme(),
            });
            // 有选区时 Ctrl+C = 复制并清选区（随后无选区的 Ctrl+C 恢复中断语义，
            // VS Code 同款）——否则想复制选中文字，^C 直达 shell 把正在运行的
            // 前台进程停掉。Ctrl+Shift+C 恒为复制
            termInst.attachCustomKeyEventHandler((ev) => {
              if (ev.type !== "keydown" || !ev.ctrlKey || ev.altKey) return true;
              if (ev.key !== "c" && ev.key !== "C") return true;
              if (!ev.shiftKey && !termInst.hasSelection()) return true;
              const text = termInst.getSelection();
              if (text) {
                if (navigator.clipboard && window.isSecureContext) {
                  navigator.clipboard.writeText(text).catch(() => execCopyText(text));
                } else {
                  execCopyText(text);
                }
              }
              termInst.clearSelection();
              return false;
            });
            // DSH 明暗切换时热更新调色板（presenter 改 body 属性）
            themeObserver = new MutationObserver(() => {
              if (!disposed && termInst) {
                try {
                  termInst.options.theme = xtermTheme();
                } catch {
                  // 忽略
                }
              }
            });
            themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
            fitAddon = new window.FitAddon.FitAddon();
            termInst.loadAddon(fitAddon);
            host = document.createElement("div");
            host.className = "dshk-term";
            bodyRef.current.appendChild(host);
            termInst.open(host);
            try {
              if (visibleRef.current) fitAddon.fit();
            } catch {
              // ResizeObserver 会再触发
            }
            termInst.onData((d) => {
              try {
                if (view.writable !== false) view.write(d);
              } catch {
                // 尚未连接
              }
            });
            ro.observe(bodyRef.current);

            // gen（= restartKey）进 key/contentId：⟳ 换代后旧 view 已 close、
            // 新 contentId 才会分配全新宿主终端（closed 身份不可复用）
            const viewKey = `dsh-kit-dock-${term.id}-g${restartKey}`;
            const contentId = `dsh-kit-dock-${term.id}-g${restartKey}`;
            view = svc.view(term.sessionId, viewKey, contentId);
            const detach = view.mount();
            detachRef.current = typeof detach === "function" ? detach : null;
            let lastAck = -1;
            let shellLabel = "";
            let focused = false;
            const onState = () => {
              if (disposed) return;
              const s = view.state.getSnapshot();
              const render = s.render;
              if (render && render.revision !== lastAck && termInst) {
                lastAck = render.revision;
                const f = render.frame;
                try {
                  if (f.type === "snapshot") {
                    termInst.reset();
                    termInst.write(f.screen);
                  } else {
                    termInst.write(f.data);
                  }
                } catch {
                  // xterm 已释放
                }
                try {
                  view.acknowledge(render.revision);
                } catch {
                  // 视图已关闭
                }
                if (f.type === "snapshot" && f.info) {
                  const name = f.info.shell?.name ?? "";
                  if (name && name !== shellLabel) {
                    shellLabel = name;
                    if (onShell) onShell(term.id, name);
                  }
                }
              }
              if (s.phase === "connected") {
                setState((prev) => (prev.phase === "ready" ? prev : { phase: "ready", detail: "" }));
                if (!focused && visibleRef.current && termInst) {
                  focused = true;
                  termInst.focus(); // 后台启动的终端不抢焦点
                }
              } else if (s.phase === "failed") {
                const detail = s.issue === "terminalLimit" ? t("termLimit") : String(s.error ?? s.issue ?? "");
                setState((prev) => (prev.phase === "error" && prev.detail === detail ? prev : { phase: "error", detail }));
              } else if (s.phase === "closed" || s.phase === "disconnected") {
                const code = s.info && s.info.exitCode !== null && s.info.exitCode !== undefined ? String(s.info.exitCode) : "";
                setState((prev) => (prev.phase === "exited" && prev.detail === code ? prev : { phase: "exited", detail: code }));
              }
            };
            const offState = view.state.subscribe(onState);
            onState();
            cleanupState = () => {
              offState();
              try {
                svc.close(term.sessionId, viewKey, contentId);
              } catch {
                // 服务已释放
              }
            };
          })
          .catch((error) => {
            if (!disposed) setState({ phase: "error", detail: `${t("vendorFail")}: ${error?.message ?? error}` });
          });

        return () => {
          disposed = true;
          if (resizeTimer) window.clearTimeout(resizeTimer);
          ro.disconnect();
          if (themeObserver) themeObserver.disconnect();
          if (cleanupState) cleanupState(); // 结束宿主终端（卸载即杀）
          if (detachRef.current) {
            try {
              detachRef.current();
            } catch {
              // 已分离
            }
          }
          if (termInst) {
            try {
              termInst.dispose();
            } catch {
              // 已释放
            }
          }
          if (host) host.remove();
        };
      }, [term.id, restartKey, term.sessionId]);

      const statusText =
        state.phase === "connecting"
          ? t("connecting")
          : state.phase === "exited"
            ? `${t("exited")}${state.detail !== "" ? ` · ${t("code")} ${state.detail}` : ""}`
            : "";

      return jsxRuntime.jsxs("div", {
        className: "dshk-tpane",
        "data-on": visible || undefined,
        children: [
          jsxRuntime.jsx("div", { className: "dshk-tbody", ref: bodyRef }),
          statusText !== "" || state.phase === "error"
            ? jsxRuntime.jsxs("div", { className: "dshk-term-note", children: [
                jsxRuntime.jsx("span", {
                  title: state.detail ?? "",
                  children: state.phase === "error" ? `${t("contentFail")}：${state.detail}` : statusText,
                }),
                state.phase === "exited"
                  ? jsxRuntime.jsx("button", {
                      type: "button",
                      className: "dshk-btn-cancel",
                      onClick: onRestart,
                      children: t("restart"),
                    })
                  : null,
              ] })
            : null,
        ],
      });
    }

    /** 标签文案：工作区目录名；同 cwd 多开时追加序号区分 */
    function termTabLabel(term, items) {
      const base = String(term.cwd ?? "").split(/[\\/]/).filter(Boolean).pop() || term.cwd || "?";
      const same = items.filter((x) => x.cwd === term.cwd);
      return same.length > 1 ? `${base} ${same.indexOf(term) + 1}` : base;
    }

    function TerminalDock({ open, cwd, onSpawn, onHide, onActivate, onKill, onKillAll }) {
      const ui = useKitUi();
      const items = ui.terminals;
      const activeId = ui.activeTermId ?? (items.length > 0 ? items[items.length - 1].id : null);
      const activeItem = items.find((x) => x.id === activeId) ?? null;
      // 每标签的重启计数（⟳ 触发该 pane 重连）与 shell 名（started 时回填头部展示）
      const [restartMap, setRestartMap] = react.useState({});
      const [shells, setShells] = react.useState({});
      const onShell = (id, label) => setShells((s) => (s[id] === label ? s : { ...s, [id]: label }));
      // 宽度跟随对话列：测量 _centerCol 的视口位置（侧栏开合/拖宽/窗口缩放都会触发）
      const [pos, setPos] = react.useState(null);

      react.useLayoutEffect(() => {
        const el = document.querySelector('[class*="_centerCol"]');
        if (!el) return undefined;
        const update = () => {
          const r = el.getBoundingClientRect();
          if (r.width > 0) setPos({ left: Math.max(0, r.left), width: r.width });
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
      }, []);

      return jsxRuntime.jsxs("div", {
        className: "dshk-dock",
        style: {
          ...(pos ? { left: pos.left, width: pos.width } : {}),
          ...(open ? {} : { display: "none" }), // 隐藏≠卸载：后台会话保持运行
        },
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-head",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-title dshk-dock-label", children: t("label") }),
              jsxRuntime.jsxs("span", { className: "dshk-tabs", children: [
                items.map((tab) =>
                  jsxRuntime.jsxs("div", {
                    className: `dshk-tab${tab.id === activeId ? " dshk-tab-on" : ""}`,
                    title: tab.cwd ?? "",
                    onClick: () => onActivate(tab.id),
                    children: [
                      jsxRuntime.jsx("span", { className: "dshk-tab-label", children: termTabLabel(tab, items) }),
                      jsxRuntime.jsx(KitTip, {
                        label: t("termTabClose"),
                        side: "top",
                        children: jsxRuntime.jsx("button", {
                          type: "button",
                          className: "dshk-tab-x",
                          onClick: (e) => {
                            e.stopPropagation();
                            onKill(tab.id);
                          },
                          children: "✕",
                        }),
                      }),
                    ],
                  }, tab.id),
                ),
              ] }),
              jsxRuntime.jsx(KitTip, {
                label: t("termNew"),
                side: "top",
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn",
                  onClick: onSpawn,
                  children: "＋",
                }),
              }),
              activeItem
                ? jsxRuntime.jsx("span", {
                    className: "dshk-sub",
                    title: activeItem.cwd ?? "",
                    children: `${shells[activeItem.id] ? `${shells[activeItem.id]} · ` : ""}${activeItem.cwd ?? ""}`,
                  })
                : null,
              jsxRuntime.jsx("span", { className: "dshk-spring" }),
              jsxRuntime.jsx(KitTip, {
                label: t("restart"),
                side: "top",
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn",
                  onClick: () => {
                    if (!activeId) return;
                    setRestartMap((m) => ({ ...m, [activeId]: (m[activeId] ?? 0) + 1 }));
                  },
                  children: "⟳",
                }),
              }),
              jsxRuntime.jsx(KitTip, {
                label: t("termHide"),
                side: "top",
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn",
                  onClick: onHide,
                  children: "—",
                }),
              }),
              jsxRuntime.jsx(KitTip, {
                label: t("termCloseAll"),
                side: "top",
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn",
                  onClick: onKillAll,
                  children: "✕",
                }),
              }),
            ],
          }),
          // pane 必须挂在 tstack（position:relative）里：绝对定位 inset:0 以它为
          // 包含块，只盖住头部以下的内容区——直接挂 dock 下会连头部一起盖掉
          jsxRuntime.jsx("div", {
            className: "dshk-tstack",
            children: [
              items.length === 0 ? jsxRuntime.jsx("div", { className: "dshk-msg", children: t("noCwd") }) : null,
              ...items.map((tt) =>
                jsxRuntime.jsx(
                  TerminalPane,
                  {
                    term: tt,
                    visible: tt.id === activeId,
                    restartKey: restartMap[tt.id] ?? 0,
                    onRestart: () => setRestartMap((m) => ({ ...m, [tt.id]: (m[tt.id] ?? 0) + 1 })),
                    onShell,
                  },
                  `pane-${tt.id}`,
                ),
              ),
            ],
          }),
        ],
      });
    }

    // ─────────── 入口按钮（conversation.input.left）───────────
    // 只负责开合与按压态；坞本体在本组件注册的 shell.overlay 里渲染
    // （fixed 定位不受 composer 祖先 stacking context 影响）。
    /** 终端图标：描边同族（15px / viewBox 16 / 1.2 描边 / currentColor）——与文件树、
     *  源代码管理、知识库三枚入口钮同一套画法。官方引导条目的实心深色卡（#17191d 底
     *  + 白提示符）在输入行里比其余三枚重一大截，看着像另一套按钮 */
    function TerminalIcon() {
      return jsxRuntime.jsxs(
        "svg",
        {
          width: 15,
          height: 15,
          viewBox: "0 0 16 16",
          "aria-hidden": true,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsxRuntime.jsx("rect", { x: 1.7, y: 2.9, width: 12.6, height: 10.2, rx: 1.8 }),
            jsxRuntime.jsx("path", { d: "M4.7 6.4l1.9 1.9-1.9 1.9" }),
            jsxRuntime.jsx("path", { d: "M8.9 10.2h2.6" }),
          ],
        },
      );
    }

    /** 终端入口：非终端态 → 打开终端坞（无会话则新建并绑定当前会话）；已是 → 隐藏
     *  （隐藏不杀进程，标签 ✕ 才结束进程） */
    function TerminalEntry(props) {
      const ui = useKitUi();
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      const row = useCurrentRow(props);
      const sessionId = row?.id ?? null;
      const cwd = typeof row?.cwd === "string" ? row.cwd : null;
      lastSession = { id: sessionId, cwd };
      if (cfg.terminalEnabled === false) return null;
      const count = ui.terminals.length;
      const dockOn = ui.termDockOpen && count > 0;
      return jsxRuntime.jsx(KitTip, {
        label: count > 0 ? `${t("label")} · ${count}` : t("label"),
        command: "dsh-kit.terminal.toggle",
        side: "top",
        children: jsxRuntime.jsxs("button", {
          type: "button",
          className: "dshk-btn dshk-enbtn",
          "aria-pressed": dockOn,
          onClick: () => {
            // 只开/关终端坞：隐藏不杀进程，后台会话继续跑；无会话时新建并绑定
            // 当时的当前会话（之后切换会话不影响已开终端）
            setKitUi(toggleTermDock(getKitUi(), sessionId, cwd));
          },
          children: [
            jsxRuntime.jsx(TerminalIcon, {}),
            count > 0
              ? jsxRuntime.jsx("span", { className: "dshk-term-badge", "aria-hidden": true, children: String(count) })
              : null,
          ],
        }),
      });
    }

    // ─────────── 浮层宿主（shell.overlay）───────────
    /** 坞本体 + 让位布局：坞可见时挂 body 类 + 设高度变量，样式把对话列顶起来
     *  （隐藏/无会话时不顶——后台会话继续跑但不占布局） */
    function TerminalSurfaces(props) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion);
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      const ui = useKitUi();
      const row = useCurrentRow(props);
      const sessionId = row?.id ?? null;
      const cwd = typeof row?.cwd === "string" && row.cwd.trim() !== "" ? row.cwd : null;
      lastSession = { id: sessionId, cwd };

      react.useEffect(() => {
        if (ui.terminals.length === 0 || !ui.termDockOpen || !cfg.terminalEnabled) return undefined;
        document.documentElement.style.setProperty("--dshk-dock-h", DOCK_H);
        document.body.classList.add("dshk-open");
        return () => {
          document.body.classList.remove("dshk-open");
          document.documentElement.style.removeProperty("--dshk-dock-h");
        };
      }, [ui.termDockOpen, ui.terminals.length, cfg.terminalEnabled]);

      if (!cfg.terminalEnabled || ui.terminals.length === 0) return null;
      return jsxRuntime.jsx(TerminalDock, {
        open: ui.termDockOpen,
        cwd,
        onSpawn: () => {
          if (!sessionId) {
            flashToast(t("noCwd"));
            return;
          }
          setKitUi(spawnTerm(getKitUi(), sessionId, cwd));
        },
        onHide: () => setKitUi({ termDockOpen: false }),
        onActivate: (id) => setKitUi({ activeTermId: id, termDockOpen: true }),
        onKill: (id) => setKitUi(killTerm(getKitUi(), id)),
        onKillAll: () => setKitUi({ terminals: [], activeTermId: null, termDockOpen: false }),
      });
    }

    // ─────────── 配置页（挂组件行，骨架在 dock）───────
    const TERMINAL_CFG_FIELDS = [
      { key: "terminalEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgTerminalEnabled", hintKey: "kcfgTerminalEnabledHint" },
    ];
    const TERMINAL_CFG_GROUPS = ["kcfgGroupFeatures"];
    const TerminalConfigPage = dock.createConfigPage({
      fields: TERMINAL_CFG_FIELDS,
      groups: TERMINAL_CFG_GROUPS,
      t,
      onSaved: async () => {
        // 重拉自家快照喂门控（volatile 热提交即时生效）；端点不可达时快照不动
        await loadCfg();
      },
    });

    // ─────────── 官方快捷键服务（0.1.7-rc.2+）───────
    // 终端命令注册进宿主 shortcuts 服务 = 进官方「快捷键」页（Ctrl+/）：录制、冲突
    // 检测、跨设备默认值、持久化都归官方；运行期 inject——老宿主没有该服务时只是
    // 没键位。默认键只给 web:macos/web:windows（web 端放行表只认三键组合或
    // primary+alt/shift）与 desktop 三档。
    function registerShortcuts(scCtx) {
      const shortcuts = scCtx.shortcuts;
      if (!shortcuts || typeof shortcuts.register !== "function") return;
      attachShortcutCatalog(shortcuts.catalog);
      scCtx.effect(() => shortcuts.register({
        id: "dsh-kit.terminal.toggle",
        label: () => t("scTerminal"),
        aliases: ["terminal", "terminal dock", "dsh-kit"],
        defaults: {
          "web:macos": { code: "Backquote", modifiers: ["primary", "alt"] },
          "web:windows": { code: "Backquote", modifiers: ["primary", "alt"] },
          "desktop:macos": { code: "Backquote", modifiers: ["primary", "alt"] },
          "desktop:windows": { code: "Backquote", modifiers: ["primary", "alt"] },
          "desktop:linux": { code: "Backquote", modifiers: ["primary", "alt"] },
        },
        // editable/terminal 都要：聊天输入行里、终端里按都该生效（官方左右栏键同款）
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => {
          if (!cfgFromSnapshot(getCfgSnapshot()).terminalEnabled) return { status: "blocked", reason: t("scTerminalOff") };
          // 会话在 run 期读：resolve 与 run 之间隔着宿主调度，按钮可能已重渲染换过会话
          return { status: "handled", run: () => setKitUi(toggleTermDock(getKitUi(), lastSession.id, lastSession.cwd)) };
        },
      }), "dsh-kit-terminal: shortcut dsh-kit.terminal.toggle");
    }

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      // 组件配置页：挂本组件行（行由 dsh-kit bundle 的 patch 声明，槽位 key =
      // <包名>#<行id>，两种包名口径各挂一枚防宿主改口径）
      for (const key of ["dsh-kit#terminal", "dsh-kit-terminal#terminal"]) {
        ctx.slots.inject("plugins.row.config", () =>
          ctx.slots.register({ name: "plugins.row.config", key }, TerminalConfigPage),
        );
      }
      // 输入框入口与坞：官方 conversation / shell 挂载期声明槽位，inject 等声明
      // 落地再注册——直接 register 抛 not declared 且炸掉整个 web boot
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register({ name: "conversation.input.left", id: "dsh-kit-terminal", order: 14 }, TerminalEntry),
      );
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register({ name: "shell.overlay", id: "dsh-kit-terminal", order: 910 }, TerminalSurfaces),
      );
      // 官方终端模型服务（0.1.6+）：缺服务时坞报版本提示，其余功能照常
      ctx.inject(["webTerminals"], (tctx) => { webTerminalsSvc = tctx.webTerminals; });
      // 官方快捷键服务：运行期 inject，老宿主只是没键位
      ctx.inject(["shortcuts"], registerShortcuts);
      void loadCfg(); // 拉配置喂门控（失败保持内置默认）
      injectStyles();
    }

    exports.inject = ["slots"];
    exports.apply = apply;
    // 渲染级检查与面板引用供测试断言
    exports.TerminalEntry = TerminalEntry;
    exports.TerminalDock = TerminalDock;
    exports.TerminalPane = TerminalPane;
    exports.TerminalSurfaces = TerminalSurfaces;
    exports.TerminalIcon = TerminalIcon;
    exports.TerminalConfigPage = TerminalConfigPage;
    exports.termTabLabel = termTabLabel;
    exports.makeTerm = makeTerm;
    exports.toggleTermDock = toggleTermDock;
    exports.spawnTerm = spawnTerm;
    exports.killTerm = killTerm;
    exports.cfgFromSnapshot = cfgFromSnapshot;
    exports.registerShortcuts = registerShortcuts;
    exports.xtermTheme = xtermTheme;
    exports.T_CFG_DEFAULTS = T_CFG_DEFAULTS;
    exports.TERMINAL_CFG_FIELDS = TERMINAL_CFG_FIELDS;
    exports.TERMINAL_CFG_GROUPS = TERMINAL_CFG_GROUPS;
    return module.exports;
  },
});
