// dsh-kit 浏览器半边 —— 手写 client bundle，与官方 lib/client.js 产物同形，
// 无构建步骤：改完本文件刷新浏览器即生效（本地目录 junction 直装）。
//
// 结构：
//   入口：conversation.input.left（composer 工具行，文件树/源代码管理/终端三个
//     小图标钮，工作区级工具跟 session 走）——文件树/源代码管理两枚由
//     dsh-kit/files 组件半边自注册，终端入口与坞归 dsh-kit/terminal，本包
//     只给它们共享面。知识库 · 日程不占 composer 钮：入口是左栏底部那一枚
//     （sidebar.footer.action，与快捷键同一个动作：开/关侧栏那一格），日程的家
//     是右栏 dock 签。
//   右栏（唯一工作台形态）：sidebarRightTabs 注册四类 dock 签，
//     pane 正文经 slots.inject（sidebar.right.pane.tab）按 id 提供，pane 内自管
//     pane 正文。dock 签本身没有按钮：diff/知识库/日程都是被动签（SCM/树/对话
//     点开即开，日程随侧栏那格切到「日程」tab 开），浏览器走右栏开始页清单与
//     自动跟随。开始页保留官方 ShippedGuide（罗盘 + 胶囊条目），我们只贡献
//     guide 条目：浏览器一枚（其余签都是被动签，不给条目），官方「工作区文件」
//     条目垫底（配置可隐藏）。
//     缺 sidebarRight 服务时只剩 getKitUi() 侧的存在性补丁——入口按钮
//     不报错，签由官方侧自己决定要不要出现。
//   功能存在性（getKitUi()）：vaultOpen/browserOpen 是功能签在场
//     （入口按钮选中态与角标读它）。「开着哪些内容」与「哪张签激活」都不在这儿存
//     ——那是官方签表，经 rightbarItems/useRightbarItems/activeRightbarFeature 读。
//     索引类视图（知识库目录树）住侧栏 sidebar.workspaces 单槽，点条目开对应右栏签。
//   文件树/源代码管理：面板群与宿主端点归 dsh-kit/files 组件半边（端点路径
//     /dsh-kit/*），侧栏浏览区的 tree/git 分支经 kitBase.sidebarView 座回到本包
//     的 sidebar.workspaces 渲染器单槽分发；本包保留右栏「差异」pane 正文
//     （FilePaneBody，diff 组件经 kitBase.diffPane 座取）与 kitUi 差异签状态。
//     文件点击改投官方右栏文件签（sidebarRight.openResource，kit 不自建
//     预览/编辑）；vault 内 md 页直达知识库编辑器。
//   组件半边：files / monitor / terminal / skills / search / browser / vault / phone / logs
//     各自一个 xModule 隔离壳（本 factory 尾部组装完成后执行），激活由根 apply 尾部
//     循环触发——行禁用只摘宿主半边端点，探针 404 的组件整体不注册。
// 第三方大库（xterm / pdf.js / TipTap / mermaid / KaTeX / 二维码）都不打进 bundle，
// 由用它们的组件行伺服 /dsh-kit/vendor/* 静态资源（行关 = 连资源一起没有），各自
// 首次用到时按需加载。
//
// 外观跟随：面板 chrome 全部用 --dsw-alias-* 令牌（随 DSH 明暗主题自动切换）。
window.__ModuleLoader__.load({
  id: "dsh-kit",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let jsxRuntime = require("react/jsx-runtime");
    let reactDom = require("react-dom");

    // ─────────── 组件间共享底座（kitBase，内联模块）───────────
    // 端点调用/kitUi 跨槽状态/配置页骨架/右栏接线等共享面住在本模块：组件半边同住
    // 本 factory，执行期拿到的 kit 形参就是这个 exports 对象（同一引用），座对象
    // 机制保证组件后写的键 root 也读得到。底座随基础设施行启停，没有自己的行开关。
    const kitBase = (function kitBaseFactory(require) {
      var exports = {};
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dswPrim = require("@deepseek-ai/dsh-client-ui-primitives");

    // ── 官方气泡（名称 + 键帽）与宿主键位镜像 ──
    // 悬停提示一律走官方 primitives 的 Tooltip：同一套主题底色、同一套键帽样式。
    // 取不到该成员时回落各按钮原来的原生 title（不挡启动）。
    const dswTooltip = dswPrim && typeof dswPrim.Tooltip === "function" ? dswPrim.Tooltip : null;
    // 宿主 shortcuts 目录镜像：apply 期 inject 到位后接管（服务可能晚于首次渲染），
    // 之后活读——官方「快捷键」页里改了键，悬停气泡当场跟着变。
    let scCatalog = null;
    let scCatalogOff = null;
    let scRows = [];
    const scListeners = new Set();
    const subscribeShortcutRows = (listener) => {
      scListeners.add(listener);
      return () => { scListeners.delete(listener); };
    };
    const getShortcutRows = () => scRows;
    function refreshShortcutRows() {
      const next = scCatalog && typeof scCatalog.getSnapshot === "function" ? scCatalog.getSnapshot() : null;
      scRows = Array.isArray(next) ? next : [];
      for (const listener of [...scListeners]) listener();
    }
    /** 接管宿主 shortcuts 目录；重复或后到的同源调用无副作用 */
    function attachShortcutCatalog(store) {
      if (!store || store === scCatalog) return;
      if (typeof scCatalogOff === "function") { try { scCatalogOff(); } catch { /* 旧订阅卸载失败不影响新订阅 */ } }
      scCatalog = store;
      scCatalogOff = typeof store.subscribe === "function" ? store.subscribe(refreshShortcutRows) : null;
      refreshShortcutRows();
    }
    /** 官方气泡：label + command 当前生效的键帽（未注册或无绑定时只出 label）。
     *  side/align 照官方口径：composer 工具行与靠在窗口底边的 dock 用 "top"，面板头部
     *  与工具条用 "bottom"，行尾动作钮补 align:"end"（免得盖住相邻行）。 */
    function KitTip({ label, command, side = "bottom", align, portal, children }) {
      const rows = react.useSyncExternalStore(subscribeShortcutRows, getShortcutRows);
      const row = command ? rows.find((r) => r.id === command) ?? null : null;
      if (!dswTooltip) return react.cloneElement(children, { title: label });
      // 锚点自带 aria-label 时以它为准（可访问名与气泡文案可以不同）
      const anchorProps = { "aria-keyshortcuts": row ? row.aria : undefined };
      if (children.props["aria-label"] === undefined) anchorProps["aria-label"] = label;
      return jsxRuntime.jsx(dswTooltip, {
        label,
        shortcutKeys: row ? row.keys : undefined,
        side,
        align,
        portal,
        delayMs: 500,
        children: react.cloneElement(children, anchorProps),
      });
    }

    // 轻提示样式（本包私有 CSS，materialization 时注入一次）
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent =
        ".dshk-toast{position:fixed;left:50%;bottom:56px;transform:translateX(-50%) translateY(8px);z-index:950;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;padding:8px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);box-shadow:0 4px 16px rgba(0,0,0,.12);opacity:0;pointer-events:none;transition:opacity .15s var(--ds-ease-in-out),transform .15s var(--ds-ease-in-out)}" +
        ".dshk-toast[data-show]{opacity:1;transform:translateX(-50%) translateY(0)}" +
        // 插件行配置页骨架：字段控件用官方 SettingsForm/Switch 等（自带样式），
        // 这里只补 bool 字段行（对齐官方 .field 节奏）与页签间距。
        ".dshk-cfgp{display:flex;flex-direction:column;gap:12px;padding:4px 2px 8px;color:var(--dsw-alias-label-primary);font-size:13px}" +
        ".dshk-cfgp-tabs{flex:none}" +
        ".dshk-cfgp-fields > * + *{border-top:.5px solid var(--dsw-alias-border-l2)}" +
        ".dshk-cfgp-bfield{display:flex;flex-direction:column;gap:6px;padding:12px 0}" +
        ".dshk-cfgp-bhead{display:flex;align-items:center;gap:8px}" +
        ".dshk-cfgp-blabel{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}" +
        ".dshk-cfgp-badges{display:inline-flex;align-items:center;gap:8px}" +
        ".dshk-cfgp-reset{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}" +
        ".dshk-cfgp-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
        ".dshk-cfgp-reset:disabled{cursor:default}" +
        ".dshk-cfgp-hintline{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}";
      document.head.appendChild(style);
    }

    /** 轻提示：单例浮层，1.6s 自动淡出 */
    let toastTimer = 0;
    let toastEl = null;
    function flashToast(message) {
      if (typeof document === "undefined") return;
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "dshk-toast";
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = message;
      toastEl.setAttribute("data-show", "");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        if (toastEl) toastEl.removeAttribute("data-show");
      }, 1600);
    }

    /** 全局事件只挂一次。
     *
     *  apply 不是只跑一次：配置热提交、插件热更新都会让它重入。裸 addEventListener
     *  在 apply 里挂 document/window 监听，重入一次就多一个监听器——点一次链接被
     *  处理 N 次、开出 N 张标签页，而且页面越用越糟。注册表挂在目标对象上：重复
     *  调用只换实现（避免旧版本的 handler 赖着不走），不再加监听器。
     *  key 是调用点自己取的（同一事件类型上可能挂多个不同用途的监听器）。
     */
    function hookGlobal(target, key, type, handler, options) {
      const table = (target.__dshkHooks ??= {});
      const prev = table[key];
      if (prev) {
        prev.handler = handler;
        return;
      }
      const entry = { handler };
      table[key] = entry;
      target.addEventListener(type, (ev) => entry.handler(ev), options);
    }

    /** 写剪贴板：优先 Clipboard API；手机经局域网 http 访问时无安全上下文，退 execCommand */
    function writeClipboard(text) {
      const fallback = () => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      };
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        return navigator.clipboard.writeText(text).then(
          () => true,
          () => fallback(),
        );
      }
      return Promise.resolve(fallback());
    }

    /** 宿主 WebSocket 地址：桌面版页面跑在 dsh-app://app/ 自定义 scheme 上，
        location.host 是假主机名（ws://app/… 解析不到宿主），真实宿主 origin 由
        宿主注入 __DSH_TRANSPORT__.streamBaseUrl——取法缺失回落
        document.baseURI。失效条件：宿主改注入键名或不再注入（桌面启动即无流）。 */
    function kitWsUrl(pathname) {
      const base = globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI;
      const url = new URL(pathname, base);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.href;
    }

    // ── 浏览器半边日志 ──
    // 与宿主半边合流到同一个文件（<DSH_HOME>/dsh-kit/logs/kit.log）：页面白屏、按钮
    // 没反应这类只在浏览器侧的现象，宿主日志一个字都留不下。500ms 攒一批上报，
    // 免得异常风暴把网络打满；上报失败静默——日志不该反过来影响页面。
    // 组件半边用 kitLogger('<组件>')，与宿主半边同名同义，级别与格式都交给宿主统一排版。
    // 攒批与全局钩子都归 logs 组件行开（探针 404 = 该行被关）：关行时条目只走控制台
    // 镜像，不攒批也不发请求；钩子本身在 logsModule 里装。
    const kitLogBatch = [];
    let kitLogTimer = null;
    let kitLogSinkOn = false;
    /** 日志组件行的探针通过后才开；关 = 攒批作废，之后只留控制台镜像 */
    function kitLogSink(on) {
      kitLogSinkOn = on === true;
      if (!kitLogSinkOn) kitLogBatch.length = 0;
    }
    function kitClientLog(entry) {
      if (entry.level === "warn" || entry.level === "error") {
        const line = "[dsh-kit] " + entry.msg;
        if (entry.level === "error") console.error(line, entry.fields ?? "");
        else console.warn(line, entry.fields ?? "");
      }
      if (!kitLogSinkOn) return;
      kitLogBatch.push({
        level: entry.level,
        component: entry.component || "client",
        msg: String(entry.msg ?? "").slice(0, 1000),
        fields: entry.fields ?? undefined,
        scope: entry.scope || undefined,
      });
      if (kitLogBatch.length >= 50) {
        kitFlushLog();
        return;
      }
      if (kitLogTimer === null) {
        kitLogTimer = setTimeout(kitFlushLog, 500);
      }
    }
    function kitFlushLog() {
      if (kitLogTimer !== null) {
        clearTimeout(kitLogTimer);
        kitLogTimer = null;
      }
      if (kitLogBatch.length === 0) return;
      const entries = kitLogBatch.splice(0, kitLogBatch.length);
      void fetch("/dsh-kit/logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      })
        // 404/403 = 日志组件行被关（行关则端点不物化）：本页面剩下的报错不再白跑请求
        .then((res) => {
          if (res.status === 404 || res.status === 403) kitLogSink(false);
        })
        .catch(() => {});
    }
    /** 组件 logger：kitLogger('files').warn(msg, fields) */
    function kitLogger(component) {
      const call = (level) => (msg, fields, scope) => kitClientLog({ level, component, msg, fields, scope });
      return { debug: call("debug"), info: call("info"), warn: call("warn"), error: call("error") };
    }
    // 未捕获异常 / 未处理的 Promise 拒绝 / 页面隐藏与关闭时的冲刷钩子随 logs 组件行走：
    // 见 logsModule（行关 = 页面白屏这类现象没人收，这是关行的代价）。

    /** GET /dsh-kit/*，按 validate 校验回包形状（形状不符 = 失败，不当半个成功）；
        （如写文件的 409 冲突） */
    async function kitGetJson(url, signal, validate) {
      const res = await fetch(url, { signal });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || (validate && !validate(body))) {
        const error = new Error((body && body.error) || "HTTP " + res.status);
        error.status = res.status;
        error.body = body;
        kitClientLog({ level: "warn", msg: "GET 失败：" + url, fields: { status: res.status, err: error.message } });
        throw error;
      }
      return body;
    }
    /** POST /dsh-kit/*（JSON body，缺省 {}）；显式 ok:false 也算失败 */
    async function kitPostJson(url, payload, validate) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false || (validate && !validate(body))) {
        const error = new Error(body.error || "HTTP " + res.status);
        error.status = res.status;
        error.body = body;
        kitClientLog({ level: "warn", msg: "POST 失败：" + url, fields: { status: res.status, err: error.message } });
        throw error;
      }
      return body;
    }
    /** 其它 method / 自定义 opts 的 kit 取 JSON：日程、知识库、附件目录等端点
        回包不带 ok 字段，只按状态码判成败 */
    async function kitJson(url, opts, validate) {
      const res = await fetch(url, opts);
      const body = await res.json().catch(() => null);
      if (!res.ok || (validate && !validate(body))) {
        const error = new Error((body && body.error) || "HTTP " + res.status);
        error.status = res.status;
        error.body = body;
        kitClientLog({ level: "warn", msg: "请求失败：" + url, fields: { status: res.status, err: error.message } });
        throw error;
      }
      return body;
    }

    /** 语言判定：只认 DSH 的 locale 权威 —— <html lang> 由 dsh-client-locale 的
     *  syncDocumentLanguage 在启动与每次切换时同步。非 zh 一律按英文渲染。 */
    function resolveZh() {
      if (typeof document === "undefined" || !document.documentElement) return false;
      return /^zh/i.test(document.documentElement.lang || "");
    }
    // 语言切换响应：外部 store + <html lang> 的 MutationObserver。DSH 异步改写
    // <html lang> 后 bump version，组件经 useSyncExternalStore 订阅 version，
    // 变化即 re-render，届时各自词典已读到新语言。
    const localeStore = { version: 0, listeners: new Set() };
    const subscribeLocale = (fn) => {
      localeStore.listeners.add(fn);
      return () => localeStore.listeners.delete(fn);
    };
    const getLocaleVersion = () => localeStore.version;
    if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
      let lastLang = document.documentElement.lang || "";
      new MutationObserver(() => {
        const cur = document.documentElement.lang || "";
        if (cur !== lastLang) {
          lastLang = cur;
          localeStore.version++;
          for (const l of localeStore.listeners) {
            try { l(); } catch (_e) { /* ignore */ }
          }
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }

    /** 主视图会话行（sessions.list 快照没有 current）：
     *  主视图会话 = retainedBy.mainView > 0 的行（与官方 ui-session publishMain
     *  同判据）。选择器返回 byId 里的行对象本身——引用稳定，uSES getSnapshot 可用；
     *  retainedBy 是本地引用计数、不在 list 快照变更里，切会话要订阅 retainInfo。 */
    function mainRowOf(state) {
      const rows = Object.values(state?.byId ?? {});
      for (const row of rows) {
        if ((row?.retainedBy?.mainView ?? 0) > 0) return row;
      }
      return null;
    }

    // ─────────── 插件行配置页骨架 ───────────
    // 官方表单原语解析：缺成员时配置页降级为提示，不影响其余。
    const cfgUiPrim =
      typeof dswPrim.SettingsForm === "function"
      && typeof dswPrim.SettingsValueField === "function"
      && typeof dswPrim.Switch === "function"
      && typeof dswPrim.SegmentedTabs === "function"
      && typeof dswPrim.Tag === "function"
        ? dswPrim : null;
    // 骨架自带文案（字段 label/hint/组名是各组件词条，经 options.t 取）
    const CFG_UI_ZH = {
      loading: "正在读取配置…",
      unavailable: "配置当前不可读写（宿主未提供该命名空间，或为进程内会话）。",
      needHost: "宿主版本过旧：缺少官方设置表单组件，无法渲染配置页。",
      readonly: "当前 profile 只读，修改无法保存。",
      saveFail: "保存没有被接受，已保留修改供更正。",
      saving: "保存中…",
      save: "保存",
      overridden: "已覆盖",
      reset: "恢复默认",
      invalidNumber: "请填数字；留空表示恢复默认。",
      tabs: "配置分组",
    };
    const CFG_UI_EN = {
      loading: "Reading configuration…",
      unavailable: "Configuration is not readable/writable right now (namespace not served, or in-process session).",
      needHost: "Host too old: official settings form components are missing; the config page cannot render.",
      readonly: "The current profile is read-only; changes cannot be saved.",
      saveFail: "The save was not accepted; your edits are kept for correction.",
      saving: "Saving…",
      save: "Save",
      overridden: "Overridden",
      reset: "Reset to default",
      invalidNumber: "Enter a number; leave empty to restore the default.",
      tabs: "Config groups",
    };
    const cfgUiT = (key) => (resolveZh() ? CFG_UI_ZH[key] : CFG_UI_EN[key]);
    /**
     * 造一个插件行配置页组件（挂 plugins.row.config 槽，props = { view, form }）。
     * @param options.fields 字段表 [{key,type:'bool'|'number'|'string',min?,max?,group,labelKey,hintKey}]，
     *                        与组件宿主半边 Config schema 同源（渲染检查钉住）
     * @param options.groups 组键顺序（单组不出页签）；组名/labelKey/hintKey 经 options.t 取词
     * @param options.onSaved 保存被接受后回调（重拉自家配置快照喂门控，volatile 热提交即时生效）
     */
    function createConfigPage(options) {
      const fields = (options && options.fields) || [];
      const groups = (options && options.groups) || [];
      const t = options && typeof options.t === "function" ? options.t : cfgUiT;
      const onSaved = typeof (options && options.onSaved) === "function" ? options.onSaved : null;
      function ConfigPage(props) {
        react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
        const view = props && props.view;
        const form = props && props.form;
        const snap = form ? form.state : null;
        const [draft, setDraft] = react.useState(null); // 草稿：bool={set}；number/string={text}
        const [saving, setSaving] = react.useState(false);
        const [failed, setFailed] = react.useState(false);
        const [tab, setTab] = react.useState(groups[0]);
        if (view === "summary") return null;
        if (!form || !snap || snap.status !== "ready" || snap.value == null || typeof snap.value !== "object") {
          const msg = snap && snap.status === "unavailable" ? cfgUiT("unavailable") : cfgUiT("loading");
          return jsxRuntime.jsx("div", { className: "dshk-cfgp", children:
            jsxRuntime.jsx("div", { className: "dshk-note", children: msg }) });
        }
        if (!cfgUiPrim) {
          return jsxRuntime.jsx("div", { className: "dshk-cfgp", children:
            jsxRuntime.jsx("div", { className: "dshk-note", children: cfgUiT("needHost") }) });
        }
        // 官方语义（ui-primitives 的 SettingsFormModel）：value = 生效值（schema 默认 →
        // 合成层 → 用户层），base = 合成层（清掉后回落到的值），user 里**有键**才算覆盖
        //（值等于默认也是覆盖，不能比值）。草稿三态：set / clear（恢复默认）/ 无草稿。
        const value = snap.value;
        const baseLayer = snap.base && typeof snap.base === "object" ? snap.base : {};
        const userLayer = snap.user && typeof snap.user === "object" ? snap.user : null;
        const writable = snap.writable !== false;
        const draftOf = (key) => (draft && Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : null);
        const stored = (key) => userLayer !== null && Object.prototype.hasOwnProperty.call(userLayer, key);
        const textOf = (v) => (v == null ? "" : String(v));
        const stage = (key, entry) => {
          setFailed(false);
          setDraft((prev) => ({ ...(prev ?? {}), [key]: entry }));
        };
        const shownBool = (f) => { const d = draftOf(f.key); if (!d) return value[f.key] === true; if (d.kind === "clear") return baseLayer[f.key] === true; return d.bool === true; };
        const shownText = (f) => { const d = draftOf(f.key); if (!d) return textOf(value[f.key]); if (d.kind === "clear") return textOf(baseLayer[f.key]); return d.text; };
        const overriddenOf = (f) => { const d = draftOf(f.key); return d ? d.kind === "set" : stored(f.key); };
        const numBad = (f, d) => f.type === "number" && d != null && d.kind === "set" && d.text.trim() !== "" && !Number.isFinite(Number(d.text));
        const invalid = fields.some((f) => numBad(f, draftOf(f.key)));
        // 官方 plan 同序同判：clear 只在用户层真有这个键时发 unset；set 草稿与生效值
        // 同值就不发（等于没改）；空 plan 直接丢弃草稿
        const planOps = () => {
          const ops = [];
          for (const f of fields) {
            const d = draftOf(f.key);
            if (!d) continue;
            if (d.kind === "clear") {
              if (stored(f.key)) ops.push({ op: "unset", path: [f.key] });
            } else if (f.type === "bool") {
              if (d.bool !== (value[f.key] === true)) ops.push({ op: "set", path: [f.key], value: d.bool === true });
            } else if (f.type === "number") {
              if (d.text === textOf(value[f.key])) continue;
              const txt = d.text.trim();
              if (txt === "") ops.push({ op: "unset", path: [f.key] });
              else ops.push({ op: "set", path: [f.key], value: Math.trunc(Number(txt)) });
            } else {
              if (d.text === textOf(value[f.key])) continue;
              if (d.text.trim() === "") ops.push({ op: "unset", path: [f.key] });
              else ops.push({ op: "set", path: [f.key], value: d.text.trim() });
            }
          }
          return ops;
        };
        const save = async () => {
          if (!draft || !writable || saving || invalid) return;
          const ops = planOps();
          if (ops.length === 0) { setDraft(null); return; }
          setSaving(true);
          try {
            const ok = await form.mutate(ops, snap.revision);
            if (ok) {
              setDraft(null);
              if (onSaved) await onSaved();
            } else {
              setFailed(true); // 草稿保留供更正（官方同语义）
            }
          } catch {
            setFailed(true);
          } finally {
            setSaving(false);
          }
        };
        const boolRow = (f) => {
          const over = overriddenOf(f);
          const dis = !writable || saving;
          return jsxRuntime.jsxs("div", { className: "dshk-cfgp-bfield", children: [
            jsxRuntime.jsxs("div", { className: "dshk-cfgp-bhead", children: [
              jsxRuntime.jsx("span", { className: "dshk-cfgp-blabel", children: t(f.labelKey) }),
              over ? jsxRuntime.jsxs("span", { className: "dshk-cfgp-badges", children: [
                jsxRuntime.jsx(cfgUiPrim.Tag, { tone: "neutral", children: cfgUiT("overridden") }),
                jsxRuntime.jsx("button", { type: "button", className: "dshk-cfgp-reset", disabled: dis, onClick: () => stage(f.key, { kind: "clear" }), children: cfgUiT("reset") }),
              ] }) : null,
              jsxRuntime.jsx(cfgUiPrim.Switch, {
                checked: shownBool(f),
                label: t(f.labelKey),
                disabled: dis,
                onChange: (next) => stage(f.key, { kind: "set", bool: next === true }),
              }),
            ] }),
            jsxRuntime.jsx("p", { className: "dshk-cfgp-hintline", children: t(f.hintKey) }),
          ] }, f.key);
        };
        const valueField = (f) => {
          const d = draftOf(f.key);
          return jsxRuntime.jsx(cfgUiPrim.SettingsValueField, {
            id: "dshk-cfgp-" + f.key,
            label: t(f.labelKey),
            hint: t(f.hintKey),
            text: shownText(f),
            overridden: overriddenOf(f),
            invalid: numBad(f, d),
            numeric: f.type === "number",
            disabled: !writable || saving,
            overriddenLabel: cfgUiT("overridden"),
            resetLabel: cfgUiT("reset"),
            invalidLabel: cfgUiT("invalidNumber"),
            onEdit: (txt) => stage(f.key, { kind: "set", text: txt }),
            onReset: () => stage(f.key, { kind: "clear" }),
          }, f.key);
        };
        const fieldRows = (g) => fields.filter((f) => f.group === g).map((f) => (f.type === "bool" ? boolRow(f) : valueField(f)));
        const panel = (g) => jsxRuntime.jsx("div", { className: "dshk-cfgp-fields", id: "dshk-cfgp-panel-" + g, role: "tabpanel", "aria-label": t(g),
          children: fieldRows(g) });
        const active = groups.includes(tab) ? tab : groups[0];
        return jsxRuntime.jsxs("div", { className: "dshk-cfgp", children: [
          groups.length > 1
            ? jsxRuntime.jsx(cfgUiPrim.SegmentedTabs, {
                items: groups.map((g) => ({ value: g, label: t(g), id: "dshk-cfgp-tab-" + g, panelId: "dshk-cfgp-panel-" + g })),
                value: active, onChange: setTab, label: cfgUiT("tabs"), className: "dshk-cfgp-tabs",
              })
            : null,
          jsxRuntime.jsx(cfgUiPrim.SettingsForm, {
            labels: {
              unavailable: cfgUiT("unavailable"),
              readOnly: cfgUiT("readonly"),
              saveFailed: cfgUiT("saveFail"),
              save: cfgUiT("save"),
              saving: cfgUiT("saving"),
            },
            state: { available: true, writable, dirty: draft != null && planOps().length > 0, invalid, saving, failed },
            onSave: save,
            onDiscard: () => setDraft(null),
            children: groups.length > 1 ? panel(active) : panel(groups[0]),
          }),
        ] });
      }
      return ConfigPage;
    }

    // ─────────── 跨槽开合状态（kitUi）───────────
    // 底座单例持有：入口按钮（composer 工具行）与右栏 pane 宿主是多个独立槽位
    // 组件（分属不同组件半边），状态必须跨槽共享：模块级不可变快照 +
    // useSyncExternalStore 订阅（getSnapshot 返回模块绑定值，恒定引用直到 set 替换）。
    // 功能存在性只记 open 位：打开某功能 = 确保签在，切走不丢状态。「哪张签是激活的」
    // 归官方签表（activeRightbarFeature 读它），kitUi 不另存。内容类（diff /
    // 知识库页 / 浏览器页）是一内容一签，签表也归官方；文件树与对话区点击走官方
    // 右栏文件签，不进这里。
    // 侧栏那一格是单槽：tree / git / 知识库·日程 三者互斥。知识库与日程同属一个组件、
    // 共占那一格，槽内切哪一面由 vaultSideTab 记（tab 条画在组件自己的侧栏渲染器里）。
    let kitUi = { treeOpen: false, gitOpen: false, vaultSideOpen: false, vaultSideTab: "vault", terminals: [], activeTermId: null, termDockOpen: false, browserOpen: false, vaultOpen: false };
    // terminals/activeTermId/termDockOpen 是 dsh-kit-terminal 组件的水位（入口与坞
    // 分属两个槽位，状态必须共享一份）；本文件只读 termDockOpen 一处——Esc 收起坞。
    const kitUiListeners = new Set();
    function setKitUi(patch) {
      kitUi = { ...kitUi, ...patch };
      for (const listener of kitUiListeners) listener();
    }
    function subscribeKitUi(listener) {
      kitUiListeners.add(listener);
      return () => kitUiListeners.delete(listener);
    }
    const useKitUi = () => react.useSyncExternalStore(subscribeKitUi, () => kitUi);
    const getKitUi = () => kitUi;

    // ── 知识库页签（一页一签：地址即条目，开页走 openRightbarItem）──
    /** 路径尾名（签名用）：文件保留后缀，知识库页去掉 .md（与索引树的页名一致） */
    const baseName = (p) => String(p ?? "").split(/[\\/]/).pop() ?? "";
    const pageBasename = (p) => baseName(p).replace(/\.(md|markdown)$/i, "");

    /** 关一个功能签：只清存在性（激活与否归官方签表，这里不操心）；日程签无在场位读处，不列 */
    function closeFeatureTab(ui, tab) {
      if (tab === "vault") return { vaultOpen: false };
      return { browserOpen: false };
    }
    /** 功能存在性按挂载计数：一页一签，同一功能可同时挂着好几张签，关掉一张不等于
     *  功能不在场（最后一张卸掉才收）。计数为 0 时按 0 上报；入口开签不经这条路径。
     *  只登记有读处的功能：键前缀即功能名（日程签没有） */
    const featurePresence = { vault: 0, browser: 0 };
    function markFeaturePresence(feature, delta) {
      featurePresence[feature] = Math.max(0, featurePresence[feature] + delta);
      return { [feature + "Open"]: featurePresence[feature] > 0 };
    }

    /** 功能 → dock 签映射（页类型注册表；kind 即 openTab 用的类型名）。
     *  知识库 / 日程两张签由 dsh-kit/vault 组件自己注册，根只留文件签 */
    const RB_FEATURES = [
      { id: "dsh-kit-file", kind: "dshk-file", feature: "file", titleKey: "fileTabLabel" },
    ];
    // ─────────── 官方右侧边栏（本插件唯一工作台形态）───────────
    // 每个功能一张 dock 签（页类型），pane 正文是我们的组件。服务是宿主内部实现，
    // **运行期探测取用、绝不写进 dsh.client.inject**——硬声明缺失服务会让整个插件
    // 起不来。不可用则只剩 getKitUi() 侧的存在性补丁（入口不报错，
    // 签不出现）。
    /** sidebarRight 服务实例（openTab 用）：apply 时 ctx.inject(["sidebarRight"])
     *  捕获——服务属性不能直接读（`cannot get property without inject`），又不能
     *  写进 exports.inject（硬声明缺失服务整插件起不来） */
    let rightbarSr = null;
    /** 服务实例读取（文件地址拼装等消费方在别的包，直接导出访问器） */
    function getRightbarSr() {
      return rightbarSr;
    }
    /** 官方右栏可用时机（= 官方那张 session seat 是否在场）：对话在前台且有选中会话
     *  时 mounted 有值；全局面板（插件页 / 设置页）占住中栏或没选会话时 undefined。
     *  树 / 源代码管理 / 知识库三个工作区面与全部开签动作跟它同生灭——seat 不在场时
     *  右栏压根不画（开签必抛「no session surface is mounted」），左栏浏览区也得让回
     *  官方会话列表。信号没挂上（服务缺位 / 极简组合）时保持 true；信号翻假只收面、
     *  不清状态，回到对话即原样恢复（同官方右栏的签按会话保留）。 */
    const rightbarSeat = {
      available: true,
      subs: new Set(),
      set(v) {
        if (this.available === v) return;
        this.available = v;
        for (const s of [...this.subs]) s();
      },
      subscribe(s) {
        this.subs.add(s);
        return () => {
          this.subs.delete(s);
        };
      },
    };
    // 在场信号两路可选源：官方右栏自己的 mounted 首选（「没选会话」也含在内），
    // 缺位时回落 layout.panelInfo（全局面板占住中栏 = activePanelId 非空）
    const seatSrc = { mounted: null, panel: null };
    function seatAvailable() {
      if (seatSrc.mounted) return seatSrc.mounted.observable.getSnapshot() !== undefined;
      if (seatSrc.panel) {
        const info = seatSrc.panel.observable.getSnapshot();
        return !info || info.activePanelId === null || info.activePanelId === undefined;
      }
      return true;
    }
    const seatRefresh = () => rightbarSeat.set(seatAvailable());
    /** 挂一路在场信号；同源重复调用无副作用（服务重载会换实例，换源先退订旧的） */
    function attachSeatSignal(kind, observable) {
      if (!observable || typeof observable.getSnapshot !== "function") return;
      const prev = seatSrc[kind];
      if (prev && prev.observable === observable) return;
      if (prev && typeof prev.off === "function") {
        try { prev.off(); } catch { /* 旧订阅卸载失败不影响新订阅 */ }
      }
      const watch = { observable, off: null };
      seatSrc[kind] = watch;
      if (typeof observable.subscribe === "function") watch.off = observable.subscribe(seatRefresh);
      seatRefresh();
    }
    /** 在场信号订阅（KitSurfaces 用）：信号在 apply 期才挂上，晚于首渲染也接得住 */
    function useRightbarSeat() {
      return react.useSyncExternalStore(
        (cb) => rightbarSeat.subscribe(cb),
        () => rightbarSeat.available,
      );
    }

    /** 打开/聚焦右栏 dock 签（UI 事件路径）。seat 不在场（全局面板在前台 / 没选
     *  会话）或服务未就绪时静默放弃——调用方都已先走了 kitUi 侧的开签补丁，
     *  签内容状态不会丢 */
    function openRightbarTab(feature) {
      if (!rightbarSeat.available) return;
      const sr = rightbarSr;
      if (!sr || typeof sr.openTab !== "function") return;
      const f = tabKinds[feature];
      if (!f) return;
      try {
        sr.openTab(f.kind);
      } catch {
        /* 右栏异常不拖垮入口动作 */
      }
    }
    /** 关掉右栏的某类 dock 签（内容类页类型一张内容一张签，这里收的是该类的全部签；
     *  无签可关时静默——调用点都在「该消失」的语义位（浏览器收摊等） */
    function closeRightbarTab(feature) {
      for (const item of rightbarItems(feature)) closeRightbarItem(feature, item);
    }

    // ── 一内容一签（右栏资源地址）──
    // 内容类页类型按 dsh-resource://<段>/<编码后的条目> 认领地址：一个条目一张官方
    // 签，签条即切换器，pane 内不再自绘第二层标签条。地址同时是
    // 签的 contentId，随布局持久化——刷新后签与内容仍对得上，同址重复开复用同一张签。
    const RB_ADDRESS_PREFIX = {
      file: "dsh-resource://dshk-diff/",
      vault: "dsh-resource://dshk-vault/",
      browser: "dsh-resource://dshk-browser/",
    };
    /** 条目 → 资源地址（query 供「同一文件不同 diff 源」这类区分用） */
    function rightbarAddress(feature, item, query) {
      const prefix = RB_ADDRESS_PREFIX[feature];
      if (typeof prefix !== "string" || typeof item !== "string" || item === "") return "";
      const base = prefix + encodeURIComponent(item);
      return typeof query === "string" && query !== "" ? `${base}?${query}` : base;
    }
    /** 资源地址 → 条目；不是本 feature 的地址回 null */
    function rightbarItem(feature, address) {
      const prefix = RB_ADDRESS_PREFIX[feature];
      if (typeof prefix !== "string" || typeof address !== "string" || !address.startsWith(prefix)) return null;
      const rest = address.slice(prefix.length).split("?")[0] ?? "";
      try {
        return decodeURIComponent(rest);
      } catch {
        return null;
      }
    }
    /** 资源地址上的 query（没有回空串） */
    function rightbarQuery(feature, address) {
      const prefix = RB_ADDRESS_PREFIX[feature];
      if (typeof prefix !== "string" || typeof address !== "string" || !address.startsWith(prefix)) return "";
      const at = address.indexOf("?");
      return at < 0 ? "" : address.slice(at + 1);
    }
    /** 开一个条目（官方 openResource：认领地址 → 落一张签并激活；同址已开则复用）。
     *  options 直通宿主（replaceTab：让新页接管指定那张签，见 maybeAutoOpenBrowser） */
    function openRightbarItem(feature, item, query, options) {
      const address = rightbarAddress(feature, item, query);
      const sr = rightbarSr;
      if (address === "" || !rightbarSeat.available || !sr || typeof sr.openResource !== "function") return;
      try {
        sr.openResource(address, options);
      } catch {
        /* 右栏异常不拖垮入口动作 */
      }
    }
    /** 当前会话里本 feature 开着的签（官方 openTabs 名册，按 on-screen 会话过滤） */
    function rightbarTabsOf(feature) {
      const sr = rightbarSr;
      const f = tabKinds[feature];
      if (!sr || !f) return [];
      const inv = sr.openTabs;
      if (!inv || typeof inv.getSnapshot !== "function") return [];
      const mounted = sr.mounted;
      const sid = mounted && typeof mounted.getSnapshot === "function" ? mounted.getSnapshot() : undefined;
      const list = inv.getSnapshot();
      if (!Array.isArray(list)) return [];
      return list.filter((t) => t && t.kind === f.kind && (sid === undefined || t.sessionId === sid));
    }
    function rightbarItems(feature) {
      const out = [];
      for (const t of rightbarTabsOf(feature)) {
        const item = rightbarItem(feature, t.contentId);
        if (item !== null) out.push(item);
      }
      return out;
    }
    /** 开着哪些条目（跟随官方签表：刷新/关签/换会话都自动跟上） */
    function useRightbarItems(feature) {
      const key = react.useSyncExternalStore(
        (cb) => {
          const sr = rightbarSr;
          const inv = sr && sr.openTabs;
          const mounted = sr && sr.mounted;
          const offTabs = inv && typeof inv.subscribe === "function" ? inv.subscribe(cb) : null;
          const offMounted = mounted && typeof mounted.subscribe === "function" ? mounted.subscribe(cb) : null;
          return () => {
            if (typeof offTabs === "function") offTabs();
            if (typeof offMounted === "function") offMounted();
          };
        },
        () => rightbarTabsOf(feature).map((t) => String(t.contentId)).join("|"),
      );
      return react.useMemo(
        () => (key === "" ? [] : key.split("|").map((a) => rightbarItem(feature, a))).filter((x) => x !== null),
        [key, feature],
      );
    }
    /** 关掉某个条目那张签（条目没开则静默） */
    function closeRightbarItem(feature, item) {
      const sr = rightbarSr;
      if (!sr || typeof sr.close !== "function") return;
      const want = rightbarAddress(feature, item);
      const tab = rightbarTabsOf(feature).find((t) => String(t.contentId).split("?")[0] === want);
      if (!tab || tab.tabId === undefined) return;
      try {
        sr.close(tab.tabId);
      } catch {
        /* 右栏异常不拖垮入口动作 */
      }
    }
    /** 当前激活签对应哪个条目（没有激活签或不是本类回 null） */
    function activeRightbarItem(feature) {
      const sr = rightbarSr;
      const f = tabKinds[feature];
      if (!sr || !f || typeof sr.active !== "function") return null;
      try {
        const tab = sr.active();
        return tab && tab.kind === f.kind ? rightbarItem(feature, tab.contentId) : null;
      } catch {
        return null;
      }
    }
    /** 激活条目（跟随官方签表：切签/关签/换会话自动跟上） */
    function useActiveRightbarItem(feature) {
      useRightbarItems(feature);
      return activeRightbarItem(feature);
    }
  /** 当前激活签是不是本 feature 的（Esc 分层用） */
    function activeRightbarFeature(feature) {
      const sr = rightbarSr;
      const f = tabKinds[feature];
      if (!sr || !f || typeof sr.active !== "function") return false;
      try {
        return sr.active()?.kind === f.kind;
      } catch {
        return false;
      }
    }
    /** 关掉 on-screen 会话里当前激活的那张签（Esc：关当前内容签，不收功能签） */
    function closeActiveRightbarTab() {
      const sr = rightbarSr;
      if (!sr || typeof sr.active !== "function" || typeof sr.close !== "function") return false;
      try {
        const tab = sr.active();
        if (!tab || tab.id === undefined) return false;
        sr.close(tab.id);
        return true;
      } catch {
        return false;
      }
    }
    /** 打开一个文件的 diff（源代码管理更改清单的入口；文件树与对话区点击走官方
     *  右栏文件签，不进这里）。一个文件一张签：diff 源（未跟踪/已删）编进
     *  地址 query，故同文件换源是另一张签、同一源重复开复用原签。seat 不在场时不动 */
    function openFileAndDock(path, untracked, deleted) {
      if (!rightbarSeat.available) return;
      const q = [];
      if (untracked === true) q.push("u=1");
      if (deleted === true) q.push("d=1");
      openRightbarItem("file", path, q.join("&"));
    }
    /** 本签当前是否可见（官方口径：前台会话 + 右栏展开 + 本签激活）——停轮询用 */
    function tabVisible(props) {
      try {
        const info = typeof props?.useTabInfo === "function" ? props.useTabInfo() : null;
        return info?.tab?.visible !== false;
      } catch {
        return true;
      }
    }
    /** 本签认领的资源地址（签条即切换器，pane 正文只管自己这一张） */
    function tabAddress(props) {
      try {
        const info = typeof props?.useTabInfo === "function" ? props.useTabInfo() : null;
        const tab = info?.tab;
        const address = tab?.contentId ?? tab?.navigation?.address;
        return typeof address === "string" ? address : "";
      } catch {
        return "";
      }
    }

    /** 单槽互斥补丁：view = 'tree' | 'scm' | 'vault' | 'schedule' | null。
     *  知识库与日程共用侧栏那一格（组件内自己切 tab），两者都把 vaultSideOpen 置真 */
    function sidebarViewPatch(view) {
      return {
        treeOpen: view === "tree",
        gitOpen: view === "scm",
        vaultSideOpen: view === "vault" || view === "schedule",
        vaultSideTab: view === "schedule" ? "schedule" : "vault",
      };
    }

    exports.flashToast = flashToast;
    exports.KitTip = KitTip;
    exports.attachShortcutCatalog = attachShortcutCatalog;
    exports.writeClipboard = writeClipboard;
    exports.hookGlobal = hookGlobal;
    exports.kitGetJson = kitGetJson;
    exports.kitWsUrl = kitWsUrl;
    exports.kitPostJson = kitPostJson;
    exports.kitJson = kitJson;
    exports.kitClientLog = kitClientLog;
    exports.kitLogger = kitLogger;
    exports.kitLogSink = kitLogSink;
    exports.kitLogFlush = kitFlushLog;
    exports.resolveZh = resolveZh;
    exports.subscribeLocale = subscribeLocale;
    exports.getLocaleVersion = getLocaleVersion;
    exports.mainRowOf = mainRowOf;
    exports.createConfigPage = createConfigPage;
    exports.setKitUi = setKitUi;
    exports.subscribeKitUi = subscribeKitUi;
    exports.useKitUi = useKitUi;
    exports.getKitUi = getKitUi;
    exports.baseName = baseName;
    exports.pageBasename = pageBasename;
    exports.closeFeatureTab = closeFeatureTab;
    exports.RB_FEATURES = RB_FEATURES;
    exports.getRightbarSr = getRightbarSr;
    exports.openRightbarTab = openRightbarTab;
    exports.closeRightbarTab = closeRightbarTab;
    exports.rightbarAddress = rightbarAddress;
    exports.rightbarItem = rightbarItem;
    exports.rightbarQuery = rightbarQuery;
    exports.openRightbarItem = openRightbarItem;
    exports.rightbarItems = rightbarItems;
    exports.useRightbarItems = useRightbarItems;
    exports.closeRightbarItem = closeRightbarItem;
    exports.rightbarTabsOf = rightbarTabsOf;
    exports.markFeaturePresence = markFeaturePresence;
    exports.activeRightbarFeature = activeRightbarFeature;
    exports.activeRightbarItem = activeRightbarItem;
    exports.useActiveRightbarItem = useActiveRightbarItem;
    exports.closeActiveRightbarTab = closeActiveRightbarTab;
    exports.openFileAndDock = openFileAndDock;
    exports.tabAddress = tabAddress;
    exports.tabVisible = tabVisible;
    exports.FilePaneBody = FilePaneBody;
    exports.sidebarViewPatch = sidebarViewPatch;
    // 在场信号面：KitSurfaces 订阅它决定工作区面生灭，组件半边读它门控快捷键
    exports.rightbarSeat = rightbarSeat;
    exports.useRightbarSeat = useRightbarSeat;
    exports.attachSeatSignal = attachSeatSignal;
    // 跨组件服务座：文件树/SCM 组件（dsh-kit/files）物化期接管。
    // 必须是**座对象**而非直接给 exports 加键：kitBase 到 module.exports 是工厂尾部
    // 的一次性浅拷贝，组件后写的键只落在 module.exports 上，root 读 kitBase 读不到
    // （对象引用拷贝之前的键才能共享，后加组件只改得了座里的字段）
    // 功能 → dock 签（页类型）注册表：openRightbarTab/closeRightbarTab 按它把
    // feature 映射成官方 kind。root 的 file 行在这里，组件行由各组件 apply 时补登
    //（同 sidebarView：kitBase 到 module.exports 是一次性浅拷贝，后写的键只有落在
    // 座对象的字段上 root 才读得到）
    const tabKinds = { file: { id: "dsh-kit-file", kind: "dshk-file" } };
    exports.tabKinds = tabKinds;
    exports.sidebarView = { renderer: null }; // 侧栏浏览区 tree/git 分支渲染器（root 单槽分发）
    exports.inlineEdit = { active: false }; // 树行内改名激活中（root 全局快捷键让路）
    exports.diffPane = { Component: null }; // diff 正文组件（root 右栏「差异」签正文用）
    // 知识库那两处与 root 的接线：座对象由 dsh-kit/vault 组件物化期填字段（root 只读）
    exports.vaultView = { renderer: null }; // 侧栏知识库目录索引视图（root 单槽分发）
    exports.vaultRoute = { open: null }; // 文件树行点击的 vault 改道（命中返回 true）
    exports.vaultSearch = { open: false, held: 0 }; // 知识库搜索浮层/对话框开着（root 全局 Esc 让路）
    // 底座是活动 entry：client runner 按 client 插件形状物化本模块，必须带 apply
    //（载体 entry，本体无行为）
    exports.apply = async (ctx) => {
      if (typeof ctx?.inject === "function") {
        ctx.inject(["sidebarRight"], (c) => {
          rightbarSr = c.sidebarRight;
          attachSeatSignal("mounted", c.sidebarRight && c.sidebarRight.mounted);
        });
        // 回落源：右栏服务被组合出去时，仍认得出「全局面板占住中栏」
        ctx.inject(["layout"], (c) => attachSeatSignal("panel", c.layout && c.layout.panelInfo));
      }
    };
    return exports;
    })(require);
    const dock = kitBase;

    // ─────────── 官方 primitives 图标复用（能复用就不自绘）───
    // primitives 随宿主前端注册进 ModuleLoader；
    // 宿主没这个图标成员时回退自绘版本，不挡启动。
    const dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives");
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons[n];
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    // ─────────── 跨槽开合状态与操作（实现在共享底座 kitBase，单例共享）───
    const {
      setKitUi, subscribeKitUi, useKitUi, getKitUi,
      KitTip, attachShortcutCatalog, kitWsUrl,
        baseName, pageBasename,
      closeFeatureTab, RB_FEATURES,
      openRightbarTab, closeRightbarTab, openFileAndDock,
    rightbarAddress, rightbarItem, rightbarQuery, openRightbarItem,
      useRightbarItems, rightbarItems, closeRightbarItem, activeRightbarFeature, closeActiveRightbarTab, tabAddress,
      sidebarViewPatch, getRightbarSr,
      rightbarSeat, useRightbarSeat,
    } = dock;

    /** apply 时捕获的 ctx；KitSurfaces 用它动态 register/dispose sidebar.workspaces 单槽 */
    let slotsCtx = null;


    /** 官方 sessions 服务（拿当前会话 id 与 cwd，拼文件地址用），同上运行期捕获 */
    let sessionsSvc = null;
    // ─────────── 文件树点击 → 官方右栏文件签 ───────────
    // 官方打开文件签的公开通道是 sidebarRight.openResource(地址)（官方文件树与
    // 对话文件 chip 都走它）；文件签由宿主 documentpreview 以 `text` 类型认领
    // `dsh-resource://file/**`。地址 = session 域 + 会话 id + 路径，编码复刻官方
    // fileAddressFor：反斜杠归 /、剥前导 ./；cwd 内剥成相对，cwd 外保留绝对；
    // 逐段 encodeURIComponent、`:` 保留字面量（Windows 盘符）。会话未选中时
    // 无从定位工作区，放弃。
    /** 官方文件签的地址（`dsh-resource://file/session/<会话id>/<路径>`）：开签与
     *  问宿主「这个文件什么版本」共用同一个地址。会话未选中时无从定位工作区，返回 null */
    function fileAddressFor(path) {
      const list = sessionsSvc && typeof sessionsSvc.list?.getSnapshot === "function" ? sessionsSvc.list.getSnapshot() : null;
      const sessionId = mainRowOf(list)?.id;
      if (!sessionId) return null;
      const cwd = list.byId?.[sessionId]?.cwd ?? null;
      try {
        const util = require("@deepseek-ai/dsh-util-workspace-path");
        if (util && typeof util.fileAddressFor === "function") return util.fileAddressFor(sessionId, cwd, path);
      } catch (e) {
        /* 平台模块缺位：走下面的本地复刻 */
      }
      // 复刻官方编码；cwd 前缀比较有意不分大小写——盘符大小写不一致时剥成
      // 相对路径（session 域按会话 cwd 解析），官方的大小写敏感版会落成绝对路径
      const seg = (s) => encodeURIComponent(s).replace(/%3A/gi, ":");
      let norm = String(path).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
      const cwdNorm = cwd ? String(cwd).replace(/\\/g, "/").replace(/[\\/]+$/, "") : null;
      if (cwdNorm && norm.toLowerCase().startsWith(`${cwdNorm.toLowerCase()}/`)) norm = norm.slice(cwdNorm.length + 1);
      return `dsh-resource://file/session/${seg(sessionId)}/${norm.split("/").map(seg).join("/")}`;
    }
    function openOfficialFile(path, line) {
      // seat 不在场 = 右栏不画（全局面板在前台 / 没选会话）：开签必抛
      // 「no session surface is mounted」，这里先收手，别把内部错误当用户错误报
      if (!rightbarSeat.available) return false;
      const sr = getRightbarSr();
      if (!sr || typeof sr.openResource !== "function") return false;
      const address = fileAddressFor(path);
      if (address === null) return false;
      try {
        sr.openResource(address, line === undefined ? undefined : { params: { line } });
        return true;
      } catch (e) {
        // 宿主没有认领该地址的签类型（精简组合）等接线错误：点了没反应最难排查，
        // 至少给一句
        flashToast(`${t("officialOpenFail")}：${String(e?.message ?? e).slice(0, 120)}`);
        return false;
      }
    }
    /** 文件树行点击：vault 内 → 知识库（只读阅读视图）；其余 → 官方
     *  右栏文件签。
     *  vault 那一支归 dsh-kit/vault 组件（经 dock.vaultRoute 座接管）：组件不在场
     *  （未装 / 行关闭）时座里是 null，整条改道随之消失 */
    function openTreeFile(path) {
      if (dock.vaultRoute.open !== null && dock.vaultRoute.open(path) === true) return;
      openOfficialFile(path);
    }
    /** 打开外链：改投内置浏览器（端点落一个页 → 开成右栏签），端点不可用（浏览器
     *  行关闭 / 拉不起来）时按官方口径自己开新标签——已被 preventDefault 掉的默认
     *  跳转不兜底就是「点了毫无反应」。sessionId = 点击时所在会话，宿主按它把链接
     *  落进该会话自己的浏览器分区；非 http(s)（mailto: 等）直接走系统 */
    function openExternalUrl(href) {
      const url = String(href ?? "").trim();
      if (!/^(?:https?:)?\/\//i.test(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      kitJson("/dsh-kit/browser/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, sessionId: currentSessionId() }),
      })
        .then((r) => {
          const id = r && r.tabId;
          if (id === undefined || id === null) {
            window.open(url, "_blank", "noopener,noreferrer");
            return;
          }
          openRightbarItem("browser", String(id));
        })
        .catch(() => {
          window.open(url, "_blank", "noopener,noreferrer");
        });
    }

    // ── 侧栏索引视图单槽与入口按钮（文件树/源代码管理/知识库，三个入口按钮
    // + 快捷键共用）──
    // 侧栏只有一格（会话 ↔ 文件树 ↔ 源代码管理 ↔ 知识库目录），三个按钮的
    // 选中态直接取各自的开合位（选中态与侧栏显示相关、与右栏签
    // 无关）——所以三者必须互斥：否则同一个侧栏位上会有两个按钮一起亮，
    // 而视图按优先级只显示其中一个。
    // 语义：关 → 开；开 → 只把侧栏索引收回会话列表（功能签
    // 不跟着关——签的归宿是官方签 ✕ 与配置清场，入口按钮只管侧栏那格）。知识库钮
    // 只切左侧目录，点具体页才开右栏签；收起态顺带展开
    // 侧栏（视图渲染进铁轨等于不可见）。




    // KitSurfaces 渲染期 props 桥：右栏 pane/开始页的 inject 闭包经此取官方
    // useSessions（任务 pane/开始页要在跑任务数做徽标；槽位注册在 effect 里，
    // 拿不到渲染期 props，用模块变量中转）
    const shellShare = { current: null };


    // ─────────── 官方文件预览头部挂「下载到本机」───────────
    // 官方右栏文件预览的 text/markdown/PDF 各视图共用同一头部，末尾补一枚下载按钮。
    // 锚点只用官方 data 属性（类名是 CSS-modules 哈希逐版会变）：预览根
    // [data-textpreview-url]，路径取头部 [data-textpreview-path] 的 title——那是宿主
    // 解析好的绝对路径；meta 未到时是相对路径，非绝对先不挂（meta 到了头部重渲，
    // 观察器再进来补）。下载走 /dsh-kit/raw 的 dl 模式（服务端发 attachment，
    // iOS 不认 <a download>）。
    function injectPreviewDownload(root) {
      const pathEl = root.querySelector("[data-textpreview-path]");
      const header = pathEl !== null && pathEl.parentElement;
      if (!pathEl || !header || header.querySelector("[data-dshk-dl]")) return;
      const path = pathEl.getAttribute("title") || "";
      if (!/^(?:[a-z]:[\\/]|\/)/i.test(path)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dshk-preview-dl";
      btn.title = t("fileDownload");
      btn.setAttribute("aria-label", t("fileDownload"));
      btn.setAttribute("data-dshk-dl", "");
      btn.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M8 2.5v7.3"/><path d="M4.9 7.4 8 10.5l3.1-3.1"/><path d="M2.75 13.25h10.5"/>' +
        "</svg>";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // 点击时重读 title：头部会被官方复用（换文件/后到 meta 只改属性），闭包里
        // 的路径可能已过期
        const p = ev.currentTarget.closest("[data-textpreview-url]")?.querySelector("[data-textpreview-path]")?.getAttribute("title") || "";
        if (!p) return;
        // 读端点限根：工作区那一根由当前会话的 cwd 带上；知识库根由 vault 组件注册
        const cwd = currentSessionCwd();
        const a = document.createElement("a");
        a.href = `/dsh-kit/raw?path=${encodeURIComponent(p)}&dl=1${cwd === "" ? "" : `&cwd=${encodeURIComponent(cwd)}`}`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      header.appendChild(btn);
    }

    function scanPreviewDownload() {
      for (const root of document.querySelectorAll("[data-textpreview-url]")) {
        try {
          injectPreviewDownload(root);
        } catch (e) {
          /* 单根失败不挡其余 */
        }
      }
    }

    let previewDlScheduled = false;
    function schedulePreviewDownloadScan() {
      if (previewDlScheduled) return;
      previewDlScheduled = true;
      setTimeout(() => {
        previewDlScheduled = false;
        scanPreviewDownload();
      }, 100);
    }

    // ─────────── 对话 @ 引用（文件树 → 输入框）───────────
    // 官方 ui-conversation 注册 `conversation` 服务（ConversationController），
    // 其 .input = InputHub，`hub.shell(当前会话 id)` 返回 SessionInputShell
    // （公开 actions.setDraft 草稿写入 + 插入体
    // insertReference(ref, span) 引用芯片直插）——文件树「@到对话」优先直插
    // 真实引用 chip（不弹官方 @ 面板），失败兜底追加 @ 语法文本，均与手打
    // @ 等价（提交后按官方 file-reference 语法解析）。使用点现取（懒解析）。
    // 对话小窗当前绑定（chat 组件渲染期发布）：其余组件据此决定「动作发给谁」
    // ——引用写入的落点、回合完成通知的抑制都读它。收起时视为没有小窗。
    const chatSurface = { open: false, sessionId: null };
    function chatSurfaceSession() {
      return chatSurface.open ? chatSurface.sessionId : null;
    }

    /** 光标此刻在哪个输入面：'chat' 小窗 / 'main' 主面 / null 都不在 */
    function composerFocus() {
      try {
        const el = document.activeElement;
        // 官方输入框外壳；小窗里那一套也是同一个类，靠是否在自家面板内区分
        if (el === null || typeof el.closest !== "function" || el.closest('[class*="composerSeat"]') === null) return null;
        return el.closest(".dshk-chat-panel") !== null ? "chat" : "main";
      } catch {
        return null;
      }
    }
    /** 最近一次光标落过的输入面：工具条 / 树行这类入口「先夺焦点再动手」，
     *  动手那一刻已经不在输入框里了——不记住上一次就会落错面 */
    let lastComposerFace = null;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener(
        "focusin",
        () => {
          const face = composerFocus();
          if (face !== null) lastComposerFace = face;
        },
        true,
      );
    }

    /** 取「该收到这个动作」那条会话的输入 shell；任一步未就绪返回 null。
     *  落点按光标：光标在哪个输入框就归那面；动手时已经不在输入框里（点了工具条 /
     *  树行的按钮）就按「最近一次落过的面」，都没有才退到小窗——它才是当下在用的
     *  那张脸。 */
    function currentComposerShell() {
      if (!slotsCtx) return null;
      let conv;
      try {
        conv = slotsCtx.get("conversation");
      } catch {
        return null;
      }
      const hub = conv && conv.input;
      if (!hub || typeof hub.shell !== "function") return null;
      let sessions;
      try {
        sessions = slotsCtx.get("sessions");
      } catch {
        return null;
      }
      const chatId = chatSurfaceSession();
      const mainId = mainRowOf(sessions?.list?.getSnapshot?.())?.id ?? null;
      const face = composerFocus() ?? lastComposerFace;
      // 记住的那面没有会话（小窗收起 / 主面空着）时让给另一面
      const targetId = face === "chat" ? (chatId ?? mainId) : face === "main" ? (mainId ?? chatId) : (chatId ?? mainId);
      if (!targetId) return null;
      try {
        return hub.shell(targetId) ?? null;
      } catch {
        return null;
      }
    }

    /** 官方 @ 引用文本（对齐 dsh-client-ui-reference 的 formatFileMention）：
     *  路径无空白 → @rel/path；有空白 → @"rel/a b.txt"；目录保留开放引号 @"dir/ */
    function chatMentionText(relPath) {
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(relPath)) return null;
      if (relPath.endsWith("/")) return /\s/u.test(relPath) ? `@"${relPath}` : `@${relPath}`;
      return /\s/u.test(relPath) ? `@"${relPath}"` : `@${relPath}`;
    }



    // ─────────── 文案 ───────────
    const zh = {
      treeNewAny: "新建文件/目录",
      treeRename: "重命名",
      treeDelete: "删除",
      treeAt: "@ 到对话",
      treeAtUnavailable: "输入框未就绪（无会话或不可用）",
      treeCopyAbs: "复制绝对路径",
      treeCopyRel: "复制相对路径",
      treeCopied: "已复制路径",
      treeMenu: "更多操作",
      contentLoading: "加载中…",
      contentEmpty: "（空）",
      confirmDelete: "删除「{name}」？内容将移入回收站。",
      created: "已创建",
      renamed: "已重命名",
      deleted: "已删除",
      committed: "已提交",
      scDetached: "分离头",
      scGraph: "提交图谱",
      scGraphEmpty: "（尚无提交）",
      scGraphFail: "图谱加载失败",
      scGraphMore: "加载更多",
      edit: "编辑",
      gitM: "已修改",
      gitA: "新文件",
      gitD: "已删除",
      gitR: "重命名",
      gitU: "未跟踪",
      gitTip: "git 变更",
      contentBinary: "二进制文件，无法预览",
      fileDownload: "下载到本机",
      contentFail: "读取失败",
      officialOpenFail: "打开失败",
      scNoSeat: "当前不在对话中",

      fileTabLabel: "差异",
      // 官方「快捷键」页里的命令名与「为什么按不动」的说明（键位本身归官方页管）
      moved: "已移动",
      imported: "已导入",
      cancel: "取消",
      // 组件半边（vault 等）的共用失败前缀：它们经 rootT 回落，缺了会显示键名
      skOpFail: "操作失败",
    };
    const en = {
      treeNewAny: "New file/folder",
      treeRename: "Rename",
      treeDelete: "Delete",
      treeAt: "Insert @ mention",
      treeAtUnavailable: "Input box not ready (no session or unavailable)",
      treeCopyAbs: "Copy absolute path",
      treeCopyRel: "Copy relative path",
      treeCopied: "Path copied",
      treeMenu: "More actions",
      contentLoading: "Loading…",
      contentEmpty: "(empty)",
      confirmDelete: "Delete \"{name}\"? It will be moved to the Recycle Bin.",
      created: "Created",
      renamed: "Renamed",
      deleted: "Deleted",
      committed: "Committed",
      scDetached: "detached HEAD",
      scGraph: "Commit graph",
      scGraphEmpty: "(no commits yet)",
      scGraphFail: "Failed to load graph",
      scGraphMore: "Load more",
      gitM: "Modified",
      gitA: "Added",
      gitD: "Deleted",
      gitR: "Renamed",
      gitU: "Untracked",
      gitTip: "git change",
      edit: "Edit",
      contentBinary: "Binary file, preview unavailable",
      fileDownload: "Download file",
      contentFail: "Failed to read",
      officialOpenFail: "Open failed",
      scNoSeat: "Not in a conversation",

      fileTabLabel: "Diff",
      moved: "Moved",
      imported: "Imported",
      cancel: "Cancel",
      skOpFail: "Operation failed",
    };
    /** 语言判定与切换响应住在共享底座（所有组件共享同一份 locale store 与
     *  <html lang> MutationObserver），这里解构取用。 */
    const resolveZh = dock.resolveZh;
    // 每次现读现判，不在模块加载时钉死：DSH 的 locale 服务异步把语言同步到
    // <html lang>（syncDocumentLanguage），时机晚于本 bundle 顶层执行，一次性求值
    // 会拿到旧值而把界面锁死在英文。
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    const { subscribeLocale, getLocaleVersion } = dock;

    // ─────────── 样式 ───────────
    const UI_CSS = `
.dshk-head{flex:none;min-height:34px;display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:hidden}
.dshk-title{font-weight:600;color:var(--dsw-alias-label-primary);flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.dshk-status{color:var(--dsw-alias-label-tertiary)}
.dshk-spring{flex:1}
.dshk-btn{appearance:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);width:26px;height:26px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;padding:0}
.dshk-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 官方文件预览头部注入的下载按钮：度量对齐官方 tool 按钮（28×28 圆形热区、15px 图形） */
.dshk-preview-dl{appearance:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);width:28px;height:28px;border-radius:28px;cursor:pointer;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:6px;line-height:1}
.dshk-preview-dl:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshk-preview-dl svg{width:15px;height:15px;display:block}
/* 多终端：入口图标数量角标 + 标签条 + 堆叠 pane（隐藏 pane 离屏缓冲输出） */
.dshk-enbtn{position:relative}
/* 品牌主色是单色令牌（浅色主题近黑、深色主题近白），主色底上的文字一律用 bg-base 取反——
   写死 #fff 在深色主题就是白底白字（配置/文件/Git 的保存钮同此） */
.dshk-tabs{display:inline-flex;align-items:center;gap:2px;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dshk-tabs::-webkit-scrollbar{display:none}
.dshk-tab{display:inline-flex;align-items:center;gap:5px;flex:none;height:22px;padding:0 5px 0 9px;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;max-width:170px;user-select:none}
.dshk-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-tab-on,.dshk-tab-on:hover{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary)}
.dshk-tab-label{overflow:hidden;text-overflow:ellipsis}
.dshk-tab-x{appearance:none;border:0;background:none;color:inherit;width:15px;height:15px;border-radius:4px;font-size:10px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;visibility:hidden}
.dshk-tab:hover .dshk-tab-x,.dshk-tab-x:hover{visibility:visible}
.dshk-tab-x:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* 新建内联输入：头部下单行，\ 前缀建目录 */
.dshk-createrow{display:flex;gap:6px;padding:6px 8px}
.dshk-createrow input{flex:1;min-width:0;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px}
.dshk-createrow .dshk-btn{flex:none}
.dshk-row{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary);white-space:nowrap;user-select:none}
.dshk-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-chev{width:16px;flex:none;display:inline-flex;justify-content:center;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}
.dshk-ticonwrap{flex:none;display:inline-flex;align-items:center}
.dshk-arrow{transition:transform .15s var(--ds-ease-in-out);display:block}
.dshk-arrow-open{transform:rotate(90deg)}
/* 行内改名输入框（✎ 触发）：聚焦时只选中最后一个扩展名分隔符之前的主名 */
.dshk-rename{appearance:none;flex:1 1 auto;min-width:0;height:22px;box-sizing:border-box;border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1;padding:0 6px}
.dshk-rename:focus-visible{outline:none}
.dshk-note{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px}
/* 入口按钮选中态：底色用主题真实存在的 tool-bar-fill，图标转品牌色；
   :hover 一并声明避免 hover 规则在选中态下把底色洗掉 */
.dshk-enbtn[aria-pressed="true"],.dshk-enbtn[aria-pressed="true"]:hover{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-brand-primary)}
.dshk-pane-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 10px 12px}
/* pane 内联提示（文件已删除等）：弱化小字说明，不抢内容 */
.dshk-note{flex:none;padding:8px 12px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
/* 官方右栏 dock pane 正文（sidebar.right.pane.tab）：pane 内是普通文档流，
   外壳占满 100%×100%、内容区自己滚；这里只有普通文档流 */
.dshk-rbpane{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
/* 侧栏浏览区宿主（知识库目录 / 日程待办清单占 sidebar.workspaces） */
.dshk-sidehost{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden}
/* 侧栏那格（知识库 · 日程 共占）的顶部 tab 条：面板本体在下面 .dshk-sidebody。
   选中态 = 品牌色 + 下划线（不给填充底） */
.dshk-sidetabs{flex:none;display:flex;align-items:stretch;padding:0 6px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-sidetab{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;appearance:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;padding:9px 6px;cursor:pointer;white-space:nowrap;overflow:hidden}
.dshk-sidetab>span{overflow:hidden;text-overflow:ellipsis}
.dshk-sidetab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sidetab.is-active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.dshk-sidebody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
/* 左栏底部那枚入口钮（sidebar.footer.action）：整格（知识库 · 日程）的开合。手机上没有
   键盘，这一枚才是可达入口——那一格里的两枚 tab 只有那格已经开着才看得见。
   宿主给 wide：展开态一行图标 + 名，铁轨态只剩一枚 28px 方钮（与宿主 iconButton 同尺寸） */
.dshk-sidebtn{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:1;padding:5px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer;text-align:left}
.dshk-sidebtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sidebtn[aria-pressed=true]{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-brand-primary)}
.dshk-sidebtn>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-sidebtn.is-rail{width:28px;height:28px;justify-content:center;gap:0;padding:0}
/* 知识库（vault）：工具条+目录树投侧栏索引宿主，页编辑器投右栏 pane 宿主（拆两半 portal）。 */
   「选库进入阅读」——空间=顶层目录，树懒加载，[[wikilink]] 页内跳转带历史 */
.dshk-vault{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px}
.dshk-vault-hinttitle{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);padding:24px 16px 0;text-align:center}
.dshk-vault-hint{padding:10px 16px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;line-height:1.7}
.dshk-vault-toolbar{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-vault-tbarrow{display:flex;align-items:center;gap:6px;min-width:0}
.dshk-vault-tbpush{margin-left:auto}
.dshk-vault-search{flex:1 1 auto;min-width:0;width:100%;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px}
.dshk-vault-vsearch{position:fixed;z-index:1200;max-height:min(50vh,300px);overflow:auto;padding:4px 6px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18))}
.dshk-vault-hitrow{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:6px;cursor:pointer}
.dshk-vault-hitrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-hitrow.is-cur{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-hittitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-vault-hitsnippet{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-vault-rail{flex:none;width:150px;border-right:1px solid var(--dsw-alias-border-l2);overflow:auto;padding:4px 3px;display:flex;flex-direction:column}
/* 知识库拆两半：目录树投进侧栏索引宿主（占满宽，无右缘线），编辑器投进右栏签；
   position:relative 是给 .dshk-vault-toast 当定位祖先的——漏了它绝对定位就锚到
   视口，提示飘在窗口底部正中，看着像没反应 */
.dshk-vault-sidewrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;width:100%;position:relative}
.dshk-vault-sidewrap .dshk-vault-rail{flex:1 1 auto;width:auto;border-right:none}
/* 左轨细头部：当前空间名 */
.dshk-vault-railhead{display:flex;align-items:center;gap:4px;padding:2px 4px 4px;flex:none}
.dshk-vault-railtitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-treerow{display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.dshk-vault-treerow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-treerow.is-active{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary)}
/* 展开箭头位（内容 = 官方 IconTriangleRightFill14，自己管旋转），空目录留空位对齐 */
.dshk-vault-twist{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-treename{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.dshk-vault-ticon{width:13px;height:13px;flex:none;opacity:.75}
.dshk-vault-treeload{padding:3px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dshk-vault-reader{flex:1 1 auto;min-width:0;overflow:auto;display:flex;flex-direction:column}
.dshk-pdf{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-document-preview,var(--dsw-alias-bg-base))}
.dshk-pdf-bar{flex:none;display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dshk-pdf-pageno{width:52px;box-sizing:border-box;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:3px 6px;border-radius:6px;text-align:center;font-variant-numeric:tabular-nums}
.dshk-pdf-total{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshk-pdf-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}
.dshk-pdf-doc{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%}
.dshk-pdf-page{position:relative;flex:none;overflow:hidden;background:#fff}
.dshk-pdf-canvas{position:absolute;inset:0;display:block;width:100%;height:100%}
/* 文字层：版式全由 pdf.js 写在这几个变量上（字号 = --total-scale-factor × 页内
   单位高度；--total-scale-factor 由正文里那一行 setProperty 给），这里只补形状 */
.dshk-pdf-text{position:absolute;inset:0;overflow:clip;z-index:0;text-align:initial;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:canvastext;line-height:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
.dshk-pdf-text :is(span,br){color:#0000;white-space:pre;cursor:text;transform-origin:0 0;user-select:text;position:absolute;z-index:1;--font-height:0;--scale-x:1;--rotate:0deg;font-size:calc(var(--text-scale-factor) * var(--font-height));transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.dshk-pdf-text ::selection{background:var(--dsw-alias-bg-document-selection,rgba(0,90,200,.32));color:#0000}
.dshk-pdf-text br::selection{background:none}
.dshk-pdf-pagefail{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;padding:8px;text-align:center;font-size:12px;color:#b3261e;background:rgba(255,255,255,.9)}
.dshk-vault-editwrap{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;padding:8px 10px}
.dshk-vault-editbar{position:sticky;top:0;z-index:2;flex:none;display:flex;align-items:center;gap:6px;padding:6px 0;background:var(--dsw-alias-bg-base)}
.dshk-vault-crumb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:default;user-select:none}
/* 正文区不画外框：这一面是「页面」不是输入框，边框会把整页框成一块编辑区。
   滚动仍是 rtehost 自己（下面 .dshk-md 那条），这里只留弹性与不透明底色 */
.dshk-vault-rtehost{flex:1 1 auto;min-height:0;background:var(--dsw-alias-bg-base)}
/* 复用 .dshk-md 排版（标题/表格/引用/代码），只覆盖编辑态差异：
   滚动容器是 rtehost 自身，ProseMirror 去描边、正文区给最小高度 */
.dshk-vault-rtehost.dshk-md{flex:1 1 auto;overflow:auto;padding:12px 16px}
.dshk-vault-rtehost .ProseMirror{outline:none;min-height:60px;caret-color:var(--dsw-alias-brand-primary,#1971c2)}
/* gap cursor：表格 / 折叠块 / 代码块这类非 textblock 的块下方留白处的落点（打字就在那儿
   起一个段落）。vendor 把它画成 20px 横线 + 闪烁，看着像"横着的光标"。只改 ::after 的形状
   与颜色做成竖光标，容器那两条 display（聚焦才显示）照旧；特异性要比 vendor 后注入的
   .ProseMirror-gapcursor:after 高，否则被盖回去 */
.dshk-vault-rtehost .ProseMirror-gapcursor:after{top:-.18em;width:2px;height:1.25em;border-top:none;background:currentColor}
.dshk-vault-rtehost h5,.dshk-vault-rtehost h6{margin:1.2em 0 .5em;line-height:1.3}
.dshk-rte-doc p.is-empty::before{content:attr(data-placeholder);color:var(--dsw-alias-label-tertiary);pointer-events:none;float:left;height:0}
.dshk-rte-anchorflash,.dshk-rte-anchorflash-b{animation:dshkRteFlash 1.5s var(--ds-ease-in-out)}
@keyframes dshkRteFlash{0%{background:rgba(25,113,194,.22)}100%{background:transparent}}
/* wikilink 复用 .dshk-vault-wl（上面已有）；碎链加波浪下划线类 */
/* 代码盒：复用 .dshk-codebox/.dshk-codebar/.dshk-codecopy（上面已有）；
   语言选择器替代只读语言标签 */
.dshk-rte-langsel{appearance:none;border:0;background:none;font:inherit;font-family:ui-monospace,Consolas,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0 2px}
.dshk-rte-langsel:hover{color:var(--dsw-alias-label-primary)}
/* 语言下拉：挂 body 上按 fixed 贴输入框（代码盒 overflow:hidden 会截掉它），
   坐标由 rte-entry 按输入框实测位置写死，这层只管盒子长相 */
.dshk-langdrop{position:fixed;z-index:1200;min-width:112px;max-width:220px;max-height:min(50vh,320px);overflow:auto;padding:4px 0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18));user-select:none}
/* 收起走 hidden 属性：显式 display 会盖掉 UA 的 [hidden]{display:none}，不补这条收不住 */
.dshk-langdrop[hidden]{display:none}
.dshk-langopt{flex:none;padding:4px 10px;font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-langopt:hover,.dshk-langopt.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-langempty{flex:none;padding:6px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* 数学：KaTeX 渲染 + 点击改 tex 的内联输入 */
.dshk-rte-math{display:inline-block;cursor:pointer}
.dshk-rte-mathblock{display:block;cursor:pointer;text-align:center;margin:.6em 0}
.dshk-rte-math.is-editing,.dshk-rte-mathblock.is-editing{background:var(--dsw-alias-bg-layer-3);border-radius:6px}
.dshk-rte-math-input{font-family:ui-monospace,Consolas,monospace;font-size:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:2px 6px;min-width:120px}
.dshk-rte-mathblock .dshk-rte-math-input{width:70%}
/* mermaid 图块：vendor 只给类名，三副面孔（空块提示 / 编辑态源码框 / 渲染态图）
   的长相全在这层 CSS。少了 is-editing 那条「藏图」规则，编辑态就成了
   「一行正文号占位提示 + 浏览器默认 textarea」摞在一起。编辑态按公式块
   那副面孔做：灰底 + 一个等宽源码框，出框即渲染 */
.dshk-mermaid{margin:.6em 0;cursor:pointer}
.dshk-mermaid-body{overflow:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshk-mermaid-body svg{max-width:100%;height:auto}
/* mermaid 库没就位时的纯文本回退：源码原样铺开，不是提示行 */
.dshk-mermaid.as-code .dshk-mermaid-body{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;white-space:pre-wrap;text-align:left}
.dshk-mermaid-err{font-size:12px;color:#d9480f;padding:4px 0}
.dshk-mermaid.is-editing{background:var(--dsw-alias-bg-layer-3);border-radius:6px}
.dshk-mermaid.is-editing .dshk-mermaid-body{display:none}
.dshk-mermaid-input{display:block;box-sizing:border-box;width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:4px 7px;resize:none;outline:none;white-space:pre;overflow:hidden}
.dshk-mermaid-input:focus{border-color:var(--dsw-alias-brand-primary,#1971c2)}
.dshk-vault-details{margin:.6em 0;position:relative;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);padding:2px 10px 2px 26px}
.dshk-details-chev{position:absolute;left:8px;top:4px;width:16px;height:18px;display:flex;align-items:center;justify-content:center;border:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;cursor:pointer;padding:0;transition:transform .15s}
.dshk-details-chev:hover{color:var(--dsw-alias-label-primary)}
.dshk-details-title{padding:3px 0;min-height:18px}
.dshk-details-title>:first-child,.dshk-details-body>:first-child{margin-top:0}
.dshk-details-title>:last-child,.dshk-details-body>:last-child{margin-bottom:0}
.dshk-vault-details:not(.is-closed) .dshk-details-title{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-details-body{padding:3px 0}
.dshk-vault-details.is-closed .dshk-details-body{display:none}
/* 任务列表真复选框（TipTap TaskItem 自带 input，这里只排版） */
.dshk-vault-rtehost ul[data-type=taskList]{list-style:none;padding-left:.2em}
.dshk-vault-rtehost ul[data-type=taskList] li{display:flex;gap:6px;align-items:flex-start}
.dshk-vault-rtehost ul[data-type=taskList] li>label{flex:none;margin-top:3px}
.dshk-vault-rtehost ul[data-type=taskList] li[data-checked=true]>div{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
/* 未知块级 HTML 原样保留盒 */
.dshk-rte-rawbox{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;white-space:pre-wrap;word-break:break-all;margin:.6em 0}
/* 图片（vault 相对路径经 raw 端点解析） */
.dshk-rte-img{display:block;margin:.6em 0}
.dshk-rte-img img{max-width:100%;border-radius:6px}
.dshk-rte-img.is-broken img{display:none}
.dshk-rte-img .dshk-rte-imgmiss{display:none;font-size:12px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px}
.dshk-rte-img.is-broken .dshk-rte-imgmiss{display:inline-block}
/* 表头底色（编辑态） */
.dshk-vault-rtehost th{background:var(--dsw-alias-bg-layer-3)}
/* 阅读条下拉（目录/反链共用一个壳）：fixed 锚在触发钮下、右缘对齐按钮；
   目录条目按标题层级缩进，光标所在那条 is-cur 高亮 */
.dshk-vault-barmenu{position:fixed;z-index:1200;min-width:180px;max-width:320px;max-height:min(60vh,360px);overflow:auto;padding:4px 0;display:flex;flex-direction:column;gap:1px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18))}
.dshk-vault-barmenu-item{padding:5px 10px;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dshk-vault-barmenu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-barmenu-item.is-cur{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary);font-weight:600}
.dshk-vault-barmenu-empty{padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-wl{color:var(--dsw-alias-brand-primary);text-decoration:underline dotted}
.dshk-vault-wl-broken{color:var(--dsw-alias-label-tertiary);text-decoration:underline wavy}
/* 代码盒：语言条 + 复制钮；pre 自身边距归零由盒子接管 */
.dshk-codebox{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;margin:10px 0}
.dshk-codebox pre{margin:0;border:0;border-radius:0}
.dshk-codebar{display:flex;justify-content:space-between;align-items:center;padding:4px 10px;background:rgba(135,131,120,.12);font-size:11px}
.dshk-codecopy{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;padding:2px 6px;border-radius:5px}
.dshk-codecopy:hover{background:rgba(135,131,120,.2);color:var(--dsw-alias-label-primary)}
/* 数学公式（KaTeX 渲染结果 + 库未就绪时的原文回退） */
.dshk-md .dshk-math{color:inherit}
.dshk-md .dshk-math .katex-display{margin:.5em 0}
.dshk-vault-toast{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;padding:6px 14px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.18)}
/* 阅读条按钮：目录/反链（页面级入口）。is-empty = 没内容可列时留位变灰，
   别让阅读条忽长忽短 */
.dshk-vault-tbtn{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;min-width:24px;height:22px;padding:0 5px;border-radius:6px;cursor:pointer}
.dshk-vault-tbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-tbtn.is-empty{opacity:.45;cursor:default}
.dshk-vault-tbtn.is-empty:hover{background:none;color:var(--dsw-alias-label-secondary)}
/* 树行「新建」小按钮：只悬停显形（与文件树那枚同形态，但常驻宽度不占） */
.dshk-vault-treeplus{display:none;flex:none;appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;width:18px;height:18px;border-radius:4px;cursor:pointer;padding:0}
.dshk-vault-treeplus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-treerow:hover .dshk-vault-treeplus{display:inline-flex;align-items:center;justify-content:center}
/* 树头那两枚（新建 / 更多操作）常驻可见：树头不是行，没有悬停显形的落点 */
.dshk-vault-railhead .dshk-vault-treeplus{display:inline-flex;align-items:center;justify-content:center}
/* 面板对话框（移动到…/导入/删除确认共用）：fixed 遮罩 + 居中卡片；窄侧栏下也放得开 */
.dshk-vault-modalwrap{position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center}
.dshk-vault-modal{width:min(92vw,340px);max-height:min(84vh,560px);overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.24);padding:12px 14px}
.dshk-vault-modaltitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:8px}
.dshk-vault-modalline{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:4px 0;word-break:break-all}
.dshk-vault-modalfoot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.dshk-vault-dirlist{max-height:190px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin-top:4px}
.dshk-vault-diritem{display:block;width:100%;text-align:left;appearance:none;border:0;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:7px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-vault-diritem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-diritem.is-cur{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-brand-primary)}
.dshk-vault-radio{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary);margin-top:4px}
.dshk-vault-srcline{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
.dshk-vault-modalinput{width:100%;box-sizing:border-box;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;border-radius:6px;margin-top:4px}
/* 编辑面：撤销/重做 + 未保存脏点（表格命令在选区浮条上） */
.dshk-vault-dirtydot{flex:none;font-size:10px;line-height:1;color:var(--dsw-alias-warning,#e8a13c)}
/* CAS 冲突条：盘上被改而自动保存已暂停（不静默覆盖、不存档——由人裁决） */
.dshk-vault-conflict{flex:none;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-warning,#e8a13c);padding:0 0 8px}
/* 斜杠菜单（/ 唤出，两级）：定位在光标旁，放不下翻到光标上方，横向钳在视口内 */
.dshk-vault-slashmenu{position:fixed;z-index:1200;width:168px;max-height:300px;overflow:auto;padding:4px 0;display:flex;flex-direction:column;gap:1px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18))}
.dshk-vault-slashitem{display:flex;align-items:center;gap:7px;padding:4px 10px;margin:0 3px;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dshk-vault-slashitem:hover,.dshk-vault-slashitem.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-slashnum{flex:none;width:16px;text-align:center;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-slashicon{flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);border-radius:5px;font-size:11px;font-weight:700}
.dshk-vault-slashtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}
.dshk-vault-slashtitle{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-vault-slashdesc{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-slashmore{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-slashback{padding:4px 10px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-bottom:1px dashed var(--dsw-alias-border-l1);margin-bottom:2px}
.dshk-vault-slashback:hover{color:var(--dsw-alias-label-primary)}
/* 泡泡菜单（选区非空时浮在选区上方，放不下换下方）：行内格式条 + 色板 */
.dshk-vault-bubble{position:fixed;z-index:1200;display:flex;flex-direction:column;gap:4px;padding:4px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18));transform:translateX(-50%)}
.dshk-vault-bubblebar{display:flex;align-items:center;gap:2px}
.dshk-vault-bbtn{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;min-width:22px;height:22px;padding:0 4px;border-radius:5px;cursor:pointer}
.dshk-vault-bbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-bbtn.is-active{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-brand-primary)}
.dshk-vault-bsep{flex:none;width:1px;height:14px;background:var(--dsw-alias-border-l2);margin:0 2px}
.dshk-vault-bswatchrow{display:flex;flex-wrap:wrap;gap:4px;max-width:168px}
.dshk-vault-bswatch{flex:none;width:16px;height:16px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;padding:0}
.dshk-vault-bswatch-clear{width:100%;appearance:none;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:1;padding:2px 0;cursor:pointer}
.dshk-vault-bswatch-clear:hover{color:var(--dsw-alias-label-primary)}
/* 双链选择框：只列库里已有的页（碎链没入口），贴光标弹、键盘上下选 */
.dshk-vault-pick{position:fixed;z-index:1300;width:300px;max-height:320px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18));overflow:hidden}
.dshk-vault-pickinput{flex:none;width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:7px 10px;outline:none}
.dshk-vault-picklist{flex:1;min-height:0;overflow-y:auto;padding:4px}
.dshk-vault-pickitem{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer}
.dshk-vault-pickitem.is-cur{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-pickname{flex:1;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-vault-pickrel{flex:none;max-width:44%;font-size:10px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl}
.dshk-vault-pickempty{padding:12px 10px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* 插入表格弹窗：两个数字框 + 首行表头说明 + 取消/插入 */
.dshk-vault-tabledlg{display:flex;flex-direction:column;gap:8px}
.dshk-vault-tabledlg label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-vault-tabledlg label input{width:72px;box-sizing:border-box;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 7px;border-radius:6px}
.dshk-vault-tabledlg-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-tabledlg-row{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.dshk-vault-tbtn.is-primary{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-button-tool-bar-fill)}
/* 日程：左栏待办清单 + 右栏周时间网格（清单在侧栏、网格占主区）。
   --dshk-sched-band = 表头带高（角格与日期头共用，网格 sticky 滚动的基准） */
.dshk-sched-root{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;--dshk-sched-band:52px}
.dshk-sched-head{flex:none;display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-weeknav{display:flex;align-items:center;gap:6px}
.dshk-sched-weeklabel{min-width:104px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshk-sched-navbtn{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-navbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 表头右端的本周统计：总时长一行 + 事件/已过/未到一行小字。坞宽一紧就整段截断
   （完整数值在悬停提示里），但绝不挤网格 */
.dshk-sched-headstat{margin-left:auto;min-width:0;display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.dshk-sched-headstat b{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshk-sched-headstat .dshk-sched-statrow{max-width:100%}
/* 主区只剩网格：待办在侧栏、统计在表头（所有坞宽一致） */
.dshk-sched-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;min-width:0}
/* 表头（角格 + 7 个日期头 + 全天带）**放在滚动区之外**：留在滚动区里就得靠 sticky
压住，而 y 轴 mandatory 吸附把静止位置钉在「整点行贴在 sticky 表头下方」，
全天带那一行永远被盖住（chip 画了却看不见） */
.dshk-sched-topgrid{flex:none;display:grid;grid-template-columns:52px repeat(7,minmax(0,1fr));border-bottom:1px solid var(--dsw-alias-border-l2)}
/* y 轴 mandatory 吸附到整点行：静止位置恒为「某小时标签贴在滚动区上沿」 */
.dshk-sched-gridwrap{flex:1 1 auto;min-width:0;overflow:auto;scroll-snap-type:y mandatory;scroll-padding-top:4px}
/* 顶部 8px 是 00:00 行的呼吸空间 */
.dshk-sched-gridinner{padding-top:8px}
/* 每日列宽跟随坞宽（minmax(0,1fr) 均分），不设网格 min-width——设了的话窄坞
（下限 480，(480-52)/7≈61px/天）会横向滚动只露出四-五天；事件/全天chip均有
ellipsis，窄列只截字不破版 */
.dshk-sched-grid{display:grid;grid-template-columns:52px repeat(7,minmax(0,1fr))}
.dshk-sched-corner{height:var(--dshk-sched-band);box-sizing:border-box;background:var(--dsw-alias-bg-base)}
.dshk-sched-dayhead{box-sizing:border-box;height:var(--dshk-sched-band);text-align:center;padding:6px 0 4px;background:var(--dsw-alias-bg-base)}
.dshk-sched-wd{display:block;font-size:11px;color:var(--dshk-sched-wdcolor,var(--dsw-alias-label-tertiary))}
.dshk-sched-dnum{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;font-size:12px;margin-top:2px}
/* 主色底上的文字用 bg-base 而不是写死 #fff：品牌主色是单色令牌（浅色近黑 / 深色近白），
   写死白在深色主题就是白底白字——日程字体颜色不随深暗色变 */
.dshk-sched-dayhead.is-today .dshk-sched-dnum{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
/* 表头下的全天带：只放「有截止日且不带时刻的待办」（桌面口径），待办橙浅底、
   逾期红；不在本周的落周一列。**一列一个容器**（.dshk-sched-alldaycol）逐条堆叠
   ——chip 各自当网格项会全落进同一格互相盖住，读者只看得见最后一条 */
.dshk-sched-alldaycol{display:flex;flex-direction:column;gap:2px;padding:2px 0;min-width:0}
.dshk-sched-allday{padding:2px 4px;font-size:11px;background:#ffe8cc;color:#d9480f;border-radius:4px;margin:0 2px;min-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dshk-sched-allday:hover{filter:brightness(.97)}
.dshk-sched-allday.is-overdue{background:#ffe3e3;color:#c92a2a}
.dshk-sched-allday.is-done{background:#f1f3f5;color:#868e96}
.dshk-sched-allday.is-more{background:transparent;color:var(--dsw-alias-label-tertiary);text-align:center;cursor:default;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
/* 拉取失败提示（面板还挂着上一次的数据，口径已不可信——说出来而不是静默） */
.dshk-sched-headfail{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 8px}
.dshk-sched-taskfail{flex:none;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-sched-timeline{border-right:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-hourlabel{height:42px;padding-right:6px;font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:right;scroll-snap-align:start}
.dshk-sched-daycol{position:relative;border-left:1px solid var(--dsw-alias-border-l2);min-width:0}
.dshk-sched-cell{box-sizing:border-box;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 55%,transparent);cursor:pointer}
.dshk-sched-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-nowline{position:absolute;left:0;right:0;height:2px;background:var(--dsw-alias-danger,#cd3131);z-index:2;pointer-events:none}
.dshk-sched-nowline::before{content:"";position:absolute;left:-4px;top:-3px;width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-danger,#cd3131)}
/* 块颜色只表达状态（浅底深字）：还没到橙、进行中绿、已过去蓝、
   逾期红——同一门课在时间线上下会换色；计时段停了按已过去蓝，跑着的段不上网格 */
.dshk-sched-event{position:absolute;z-index:1;overflow:hidden;border-radius:6px;padding:2px 6px;font-size:11px;line-height:1.35;cursor:pointer;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 30%,transparent);box-sizing:border-box}
.dshk-sched-event:hover{filter:brightness(.96)}
.dshk-sched-event.is-todo{background:#ffe8cc;color:#d9480f}
.dshk-sched-event.is-doing{background:#d3f9d8;color:#2b8a3e}
.dshk-sched-event.is-past{background:#d0ebff;color:#1971c2}
.dshk-sched-event.is-overdue{background:#ffe3e3;color:#c92a2a}
/* 短段（按比例高度不足 18px）：紧凑排版把下限压到 14px 仍容得下单行标题，
   高度尽量贴合真实时长比例（border-box 后渲染高度=style 高度，不再被 padding 抬高） */
.dshk-sched-event.is-thin{padding:1px 4px;line-height:1.15;border-radius:4px}
.dshk-sched-evtitle{display:block;font-size:10px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
/* 块内第二行时刻（桌面口径：时刻加颜色已说完状态，不写"已过/进行中"字样）；
   is-thin 的矮块放不下，渲染层不输出这一行 */
.dshk-sched-evtime{display:block;font-size:9px;line-height:1.2;opacity:.85;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
/* 够高的块（≥48px）标题放开两行，行数由 line-clamp 限死——
   短块维持单行省略，避免半截字被容器裁掉 */
.dshk-sched-event.is-tall .dshk-sched-evtitle{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;word-break:break-word;line-clamp:2}
/* 待办清单（侧栏「日程」tab 整格）：表头与范围档钉死，行区吃满余高自己滚
   （不做分页加载——滚动本身就是「最多看几条，多了滚」） */
.dshk-sched-todo{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px}
.dshk-sched-todohead{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-todotitle{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-taskrows{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:4px 6px 10px}
.dshk-sched-task{display:flex;align-items:center;gap:7px;padding:4px;border-radius:6px}
.dshk-sched-task:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-tasktitle{flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px}
.dshk-sched-taskduebadge{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:1px 5px}
.dshk-sched-taskduebadge.is-overdue{color:var(--dsw-alias-danger,#cd3131);border-color:color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent)}
.dshk-sched-emptytasks{font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:8px 0}
/* 清单范围档（近三日/近一周/全部）：一排小 chip，复用 wdchip 的形态 */
/* 统计小字行（表头右端）：窄坞截断由 ellipsis 兜底，完整值在悬停提示里 */
.dshk-sched-statrow{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-sched-wdchip{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-wdchip.is-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dshk-sched-scopes{display:flex;gap:4px;align-items:center}
/* 清单行尾动作（悬停才显）+ 行首完成勾选 + 计时入口条 */
.dshk-sched-todobar{display:flex;align-items:center;gap:6px;margin-top:2px}
.dshk-sched-actionbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-actionbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sched-running{font-size:11px;color:var(--dsw-alias-brand-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-sched-taskcheck{flex:none;width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshk-sched-tasktitle.is-link{cursor:pointer}
.dshk-sched-tasktitle.is-link:hover{text-decoration:underline}
.dshk-sched-task.is-timing{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.dshk-sched-taskacts{flex:none;display:none;align-items:center;gap:2px}
.dshk-sched-task:hover .dshk-sched-taskacts{display:inline-flex}
.dshk-sched-tasktimer,.dshk-sched-taskact{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:1;width:20px;height:20px;border-radius:5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dshk-sched-tasktimer:hover,.dshk-sched-taskact:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sched-tasktimer.is-on{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.dshk-sched-taskact.is-arm{width:auto;padding:0 6px;color:var(--dsw-alias-danger,#cd3131);border-color:color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent)}
/* 表单（建 / 改条目与计时段共用）：标签内联在左、控件在右，一行一项；
   最长的周重复一次排完，切换类型 / 重复档都不出滚动 */
.dshk-vault-modal.is-wide{width:min(94vw,460px)}
.dshk-sched-form{display:flex;flex-direction:column;gap:5px}
.dshk-sched-field{display:flex;align-items:center;gap:8px}
.dshk-sched-fieldlabel{flex:none;width:52px;text-align:right;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-sched-fieldbody{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px}
.dshk-sched-form .dshk-vault-modalinput{margin-top:0}
.dshk-sched-form .dshk-vault-modalinput[type="number"]{max-width:96px}
.dshk-sched-form .dshk-sched-checkline{margin-left:60px}
.dshk-sched-when{display:flex;gap:6px}
.dshk-sched-when > *{flex:1 1 0;min-width:0}
.dshk-sched-textarea{resize:vertical;min-height:42px}
.dshk-sched-seg{display:flex;gap:4px;flex:1 1 auto;min-width:0}
.dshk-sched-segbtn{flex:1 1 0;min-width:0;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:5px 6px;border-radius:6px;cursor:pointer}
.dshk-sched-segbtn.is-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dshk-sched-weekdays{display:flex;gap:4px}
.dshk-sched-formhint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-sched-modalhint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-formerr{font-size:11px;color:var(--dsw-alias-danger,#cd3131)}
.dshk-sched-checkline{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-delask{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-delask > span{flex:1;min-width:0}
.dshk-sched-picklist{display:flex;flex-direction:column;gap:2px;max-height:200px;overflow:auto}
.dshk-sched-pick{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:5px;font-size:12px}
.dshk-sched-pick:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-picktitle{flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.dshk-sched-pickdue{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-sched-attachbtn{appearance:none;width:100%;margin-top:10px;border:1px solid var(--dsw-alias-brand-primary);background:none;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:1;padding:7px 10px;border-radius:6px;cursor:pointer}
.dshk-sched-attachbtn:hover:not([disabled]){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
/* 计时悬浮球（全局根）：右下角浮着，空闲时不占位 */
.dshk-sched-ballhost{position:fixed;right:18px;bottom:18px;z-index:1200}
.dshk-sched-ball{position:relative;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.dshk-sched-ballface{display:flex;align-items:center;gap:6px;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:7px 11px;border-radius:999px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.14)}
.dshk-sched-ballface:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-balldot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.dshk-sched-balltime{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.dshk-sched-ballpanel{min-width:180px;max-width:260px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.dshk-sched-balltitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-word}
.dshk-sched-ballmeta{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-sched-ballstop{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:6px 10px;border-radius:6px;cursor:pointer}
.dshk-sched-ballstop:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* order:1 —— 槽位容器 display:contents，本元素与官方 ContextMeter 环同为 dock 行的
   flex item；order 提到环后面才是真正最右（DOM 里槽位贡献永远在环左边）。
   不加 padding-top：dock 行自带 4px，加了会垂直错位 2px+ */

/* 手机触控增强：斜杠菜单（input-trigger）在触屏上滚不动/悬停粘滞的兜底。
   类名是前端构建哈希（_3e4SsG_*），升级换哈希后本段静默失效——需跟随维护。 */
@media (hover: none) {
  [class*="_3e4SsG_menu"]{touch-action:pan-y}
  [class*="_3e4SsG_viewport"]{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  [class*="_3e4SsG_item"]:hover{background:0 0}
  [class*="_3e4SsG_item"][class*="_3e4SsG_active"]{background:var(--dsw-alias-interactive-bg-hover)}
}
/* 轻提示（双击复制路径等的单例浮层） */
/* markdown 排版（RTE 宿主编辑态 + docx 预览共用）*/
.dshk-md{flex:1;min-height:0;overflow:auto;padding:12px 16px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary);user-select:text}
.dshk-md h1,.dshk-md h2,.dshk-md h3,.dshk-md h4{margin:1.2em 0 .5em;line-height:1.3}
.dshk-md h1{font-size:1.5em}.dshk-md h2{font-size:1.3em}.dshk-md h3{font-size:1.15em}
.dshk-md p{margin:.6em 0}
.dshk-md ul,.dshk-md ol{margin:.6em 0;padding-left:1.5em}
.dshk-md code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;background:var(--dsw-alias-interactive-bg-hover);border-radius:4px;padding:.15em .35em}
.dshk-md pre{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;overflow:auto}
.dshk-md pre code{background:none;padding:0}
.dshk-md blockquote{margin:.6em 0;padding:2px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dshk-md table{border-collapse:collapse;margin:.6em 0;font-size:12px}
.dshk-md th,.dshk-md td{border:1px solid var(--dsw-alias-border-l2);padding:4px 10px;text-align:left}
.dshk-md img{max-width:100%}
.dshk-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:1em 0}
.dshk-md a{color:var(--dsw-alias-brand-primary)}
.dshk-rowact{display:none;gap:2px;align-items:center;margin-left:auto}
.dshk-row:hover .dshk-rowact,.dshk-chg-row:hover .dshk-rowact,.dshk-vault-treerow:hover .dshk-rowact{display:inline-flex}
.dshk-rowact button{appearance:none;width:20px;height:20px;font-size:11px;line-height:1;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;padding:0}
.dshk-rowact button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 行 ⋯ 菜单：fixed 全局浮层（不受树 body 滚动裁切影响），主题令牌跟随 */
.dshk-menu{position:fixed;min-width:152px;padding:4px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18));z-index:1200;font-size:13px}
.dshk-menu > button{display:flex;width:100%;align-items:center;gap:8px;border:0;background:none;color:var(--dsw-alias-label-primary);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;white-space:nowrap}
.dshk-menu > button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-btn-save{appearance:none;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}
.dshk-btn-save[disabled]{opacity:.6;cursor:default}
.dshk-btn-cancel{appearance:none;background:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}
.dshk-btn-cancel:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}
/* 对话框的主 / 危险动作钮：删除钮靠左（margin-right:auto），取消与保存靠右 */
.dshk-btn-primary{appearance:none;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}
.dshk-btn-primary:hover:not([disabled]){filter:brightness(1.07)}
.dshk-btn-danger{appearance:none;margin-right:auto;border:1px solid color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent);background:none;color:var(--dsw-alias-danger,#cd3131);border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}
.dshk-btn-danger:hover:not([disabled]){background:color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 12%,transparent)}
/* ⋯ 菜单禁用项 */
.dshk-menu > button[disabled]{opacity:.5;cursor:default}
.dshk-menu > button[disabled]:hover{background:none}
`;

    /** 注入本插件样式（style），幂等 */
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit";
        tag.dataset.pluginCss = "dsh-kit/ui";
        tag.textContent = UI_CSS;
        document.head.appendChild(tag);
      }
    }


    // 轻提示/剪贴板：实现住在共享底座，这里解构取用
    const { flashToast, writeClipboard } = dock;

    // ─────────── 当前会话工作区 ───────────
    // 主视图会话行判定随会话行共享收进 dock（判据见 dock 注释）
    const mainRowOf = dock.mainRowOf;

    /** 当前主视图会话 id（点击类一次性动作用：浏览器分区、文件地址等）；拿不到给空串 */
    function currentSessionId() {
      try {
        const list = sessionsSvc && typeof sessionsSvc.list?.getSnapshot === "function" ? sessionsSvc.list.getSnapshot() : null;
        return mainRowOf(list)?.id ?? "";
      } catch {
        return "";
      }
    }
    /** 当前主视图会话的工作区目录（读端点限根用：工作区那一根由调用方带上）；
     *  拿不到给空串——服务端只把它当根集合里的一项，空着不影响其它根放行 */
    function currentSessionCwd() {
      try {
        const list = sessionsSvc && typeof sessionsSvc.list?.getSnapshot === "function" ? sessionsSvc.list.getSnapshot() : null;
        const cwd = mainRowOf(list)?.cwd;
        return typeof cwd === "string" ? cwd.trim() : "";
      } catch {
        return "";
      }
    }
    function useCurrentRow(props) {
      const useSessions = props && typeof props.useSessions === "function" ? props.useSessions : null;
      const row = useSessions ? useSessions(mainRowOf) : null;
      const sessionId = row?.id;
      const svc = sessionId ? sessionsSvc : null;
      const retain = svc && typeof svc.retainInfo === "function" ? svc.retainInfo(sessionId) : null;
      react.useSyncExternalStore(
        retain ? (fn) => retain.subscribe(fn) : () => () => {},
        retain ? () => retain.getSnapshot() : () => null,
      );
      return row ?? null;
    }
    function useCurrentCwd(props) {
      const row = useCurrentRow(props);
      const cwd = typeof row?.cwd === "string" ? row.cwd.trim() : "";
      return cwd || null;
    }

    // ─────────── kit 端点公共调用 ───────────
    // 宿主端点回包约定：成功 2xx（写端点另带 ok:true），失败非 2xx + { error }。
    // 实现住在组件间共享的 client 底座（kitBase），这里解构取用；
    // validate 是调用点自己的形状断言（缺项按失败处理，免得半个回包被当成功往下传）。
    const { kitGetJson, kitPostJson, kitJson } = dock;








    /** 单个官方图标（取不到退回给定字形）：navigation / 刷新 / 下拉箭头这类
     *  单件图标共用。回退字形保底——primitives 缺席时按钮仍然可读 */
    function OfficialIcon({ names, glyph, className }) {
      const C = dswIcon(...names);
      return C ? jsxRuntime.jsx(C, { className }) : jsxRuntime.jsx("span", { className, children: glyph });
    }

    /** 树行小图标（13px 暗淡，随 currentColor）：空目录无箭头后靠它区分文件/目录 */
    function TreeFolderIcon(props) {
      const _official = dswIcon("IconFolderClose16");
      if (_official) return jsxRuntime.jsx(_official, { className: "dshk-vault-ticon" });
      return jsxRuntime.jsx(
        "svg",
        {
          className: "dshk-vault-ticon",
          width: 13,
          height: 13,
          viewBox: "0 0 16 16",
          "aria-hidden": true,
          children: jsxRuntime.jsx("path", {
            d: "M1.5 3.5c0-.55.45-1 1-1h3.2l1.6 1.8h6.2c.55 0 1 .45 1 1v7.2c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1v-9z",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.2,
            strokeLinejoin: "round",
          }),
        },
      );
    }
    /** 官方文件类型图标（primitives FileTypeIcon + classifyFileType，官方 files
     *  分类器按扩展名出图形；
     *  primitives 不可用时回退空位（行内不留自绘图形） */
    function FileTypeIcon16({ name }) {
      const C = dswPrimIcons ? dswPrimIcons.FileTypeIcon : null;
      const kind = C && typeof dswPrimIcons.classifyFileType === "function" ? dswPrimIcons.classifyFileType(name) : null;
      return kind ? jsxRuntime.jsx(C, { kind, size: 13 }) : null;
    }

    /** 展开箭头：官方 IconTriangleRightFill14（右向实心三角，展开时 rotate 90° 朝下） */
    function ChevronIcon({ open }) {
      const _official = dswIcon("IconTriangleRightFill14");
      if (_official) return jsxRuntime.jsx(_official, { className: `dshk-arrow${open ? " dshk-arrow-open" : ""}` });
      return jsxRuntime.jsx(
        "svg",
        {
          width: 14,
          height: 14,
          viewBox: "0 0 14 14",
          "aria-hidden": true,
          className: `dshk-arrow${open ? " dshk-arrow-open" : ""}`,
          children: jsxRuntime.jsx("path", { d: "M4 3l5 4-5 4z", fill: "currentColor" }),
        },
      );
    }


    function TreeRowMenu({ entry, rect, anchor, actions, onClose }) {
      // 关闭手势（Esc / 点菜单外）必须长在本组件里：菜单是 fixed 浮层、渲染在各宿主
      // 自己的容器中，交给宿主各写一份必然有人漏（知识库就是这样漏成「菜单点不掉」的）。
      // click 走捕获相：宿主子树里的 stopPropagation 拦不住它；落在触发钮上的那次
      // 交给按钮自己——不然「再点一次关掉」会被这里先关掉再被 onClick 判成重新打开
      react.useEffect(() => {
        const onKey = (e) => {
          if (e.key === "Escape") onClose();
        };
        const onDoc = (e) => {
          if (!(e.target instanceof Element)) {
            onClose();
            return;
          }
          if (e.target.closest(".dshk-menu")) return;
          if (anchor && anchor.contains(e.target)) return;
          onClose();
        };
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("click", onDoc, true);
        return () => {
          window.removeEventListener("keydown", onKey, true);
          document.removeEventListener("click", onDoc, true);
        };
      }, [onClose, anchor]);
      const items = [];
      if (entry.dir && actions.onCreate) {
        items.push({ key: "nany", label: typeof actions.newLabel === "string" ? actions.newLabel : t("treeNewAny"), run: () => actions.onCreate(entry.path) });
      }
      // copyMode = "abs" 的宿主（知识库）拿绝对路径，标签一并对齐；缺省仍是相对路径
      const copyAbs = actions.copyMode === "abs";
      if (actions.onRename) items.push({ key: "rn", label: t("treeRename"), run: () => actions.onRename(entry) });
      // 宿主自定义项（知识库的「移动到…」「导入…」等）：顺序夹在重命名与复制之间
      for (const extra of actions.extraItems ?? []) items.push(extra);
      if (actions.onCopyPath) items.push({ key: "cr", label: copyAbs ? t("treeCopyAbs") : t("treeCopyRel"), run: () => actions.onCopyPath(entry, !copyAbs) });
      if (actions.onDelete) items.push({ key: "dl", label: t("treeDelete"), run: () => actions.onDelete(entry) });
      const height = items.length * 32 + 8;
      const MENU_W = 160; // min-width 152 + padding 8
      const viewportW = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1200;
      const viewportH = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800;
      const style = {
        left: Math.min(Math.max(8, rect.left), Math.max(8, viewportW - MENU_W)),
        top: Math.min(Math.max(8, rect.bottom + 6), Math.max(8, viewportH - height - 8)),
      };
      return jsxRuntime.jsx("div", {
        className: "dshk-menu",
        style,
        children: items.map((item) =>
          jsxRuntime.jsx(
            "button",
            {
              type: "button",
              onClick: () => {
                onClose();
                item.run();
              },
              children: item.label,
            },
            item.key,
          ),
        ),
      });
    }




    // ─────────── 入口按钮（conversation.input.left）───────────
    // 终端入口与坞本体在 dsh-kit/terminal 组件（注册在它自己的 shell.overlay）。
    // 选中态标记：aria-pressed 属性选择器命中 .dshk-enbtn[aria-pressed="true"]
    // 规则（底色 + 品牌色图标）。选中态底色必须用真实存在的 tool-bar-fill 令牌——
    // 不存在的变量（如 --dsw-alias-fill-l2）会解析成透明，选中态等于没有。

    // ── 侧边栏兜底与快捷键 ──
    // 文件树/源代码管理视图承载在 sidebar.workspaces 里，侧边栏收起时只剩图标栏，
    // 视图会挤进铁轨里很难看——所以打开动作做自动展开：状态探测官方切换按钮
    // （aria-label 随状态变化，收起态是「打开侧边栏」/"Open sidebar"，注意关键字
    // 是「打开」不是「展开」），只在收起态点击——幂等且方向安全。官方的
    // expandSidebar 回调不可用：该闭包捕获渲染时的 folded 状态，且槽位注销后不再
    // 刷新，残留宽态实例调用是空操作（收起后首次打开不展开的根因）。
    function sidebarBtn() {
      try {
        const labelled = document.querySelectorAll("[aria-label]");
        for (const el of labelled) {
          const label = (el.getAttribute("aria-label") ?? "").trim();
          if (!/侧边栏|sidebar/i.test(label)) continue;
          if (/^(打开|展开|Open|Expand)/i.test(label)) return { collapsed: true, btn: el };
          if (/^(收起|Collapse)/i.test(label)) return { collapsed: false, btn: el };
        }
      } catch {
        // 探测失败按展开处理
      }
      return { collapsed: false, btn: null };
    }
    /** 打开动作：收起态才点击官方切换按钮 */
    function expandSidebarNow() {
      const { collapsed, btn } = sidebarBtn();
      if (collapsed && btn) btn.click();
    }






    // ─────────── 右栏 pane 正文（每个 dock 签一个，key = 页类型 id）───────────
    // 官方 pane 是普通文档流：外壳 .dshk-rbpane 占满 100%×100%，内容区自己滚。
    // pane 挂载 = 官方签开着：把 getKitUi() 的功能存在性同步为真（入口按钮选中态、
    // 角标、自动跟随判定都读它）；pane 卸载（用户点官方签 ✕）同步回假——
    // 「签开着吗」以官方 pane 的挂载为准。
    // ── diff：一个文件一张官方右栏签（签条即切换器，pane 内不再自绘标签条）──
    /** diff pane：一个文件一张签。正文只渲染自己这张签的内容——地址即文件路径，
     *  query 带着 diff 源（未跟踪/已删），故刷新后重建签也认得回自己。
     *  只承载源代码管理更改清单点开的 diff；工作区文件的预览/编辑走官方右栏文件签 */
    function FilePaneBody(props) {
      const cwd = useCurrentCwd(props);
      const address = tabAddress(props);
      const path = rightbarItem("file", address) ?? "";
      // 官方 file 资源（宿主 watcher 推版本）：diff 正文拿它判「盘上这份是不是我读的那份」
      const fileAddress = path === "" ? null : fileAddressFor(path);
      const useResource = typeof props?.useResource === "function" ? props.useResource : null;
      const query = rightbarQuery("file", address);
      if (path === "") return null;
      const flag = (key) => new RegExp("(^|&)" + key + "=([^&]*)").exec(query);
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children: jsxRuntime.jsx(dock.diffPane.Component, { // dsh-kit/files 物化期挂上（渲染期取，boot 后必已物化）
        key: address,
        path,
        untracked: flag("u") !== null,
        deleted: flag("d") !== null,
        cwd,
        fileAddress,
        useResource,
      }) });
    }
    // ─────────── 面板宿主（shell.overlay 全帧浮层）───────────
    // 终端停靠在这里渲染（fixed 定位不受 composer 祖先
    // stacking context 影响）；知识库单实例挂载、文件树/索引的 sidebar.workspaces
    // 动态注册、几何 RO、快捷键监听全部挂在这个常驻根组件里。
    function KitSurfaces(props) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const sessionRow = useCurrentRow(props);
      const cwd = typeof sessionRow?.cwd === "string" && sessionRow.cwd.trim() !== "" ? sessionRow.cwd : null;
      const ui = useKitUi();
      // 官方右栏可用时机：seat 不在场（全局面板占住中栏 / 没选会话）时，索引视图
      // 一并让位给官方会话列表，与「右栏不存在」这件事保持同一时机
      const rightbarUp = useRightbarSeat();
      // useSessions 透传给右栏 pane（浏览器 pane 定位当前会话用）：inject 闭包
      // 从这里取最新值（槽位注册发生在 effect，渲染期的 props 用模块变量桥接）
      shellShare.current = props;

      // 侧边栏浏览区占用：单槽轮换——源代码管理 ↔ 文件树 ↔ 知识库·日程
      // （组件内自己切知识库/日程两个 tab），全关回官方会话列表。右栏不在场时
      // 不占（全局面板在前台时左栏该是官方会话列表）：开合状态留着，回到对话原样
      // 恢复。动态注册若在运行时抛错，捕获并回滚开合状态，避免入口被错误边界摘掉。
      react.useEffect(() => {
        if (!slotsCtx || !rightbarUp || (!ui.treeOpen && !ui.gitOpen && !ui.vaultSideOpen)) return undefined;
        let dispose;
        try {
          // 单槽遮蔽原生需要更低 priority（数字越小越先渲染，原生在 priority 0）。
          // owner 携带官方注入的 wide（侧边栏是否展开）：收起态各占用者自判不渲染
          // （挤进铁轨等于不可见）。
          dispose = slotsCtx.slots.register({ name: "sidebar.workspaces", priority: -1000 }, (owner) => {
            const side = owner ?? {};
            if (side.wide === false) return null;
            // 文件树/源代码管理分支归 dsh-kit/files、知识库·日程归 dsh-kit/vault，
            // 各经 kitBase 的座对象接管；两者都不在场（未装 / 行关闭）时不占槽
            const branch = dock.sidebarView.renderer ? dock.sidebarView.renderer({ ui, cwd, owner }) : null;
            if (branch) return branch;
            return dock.vaultView.renderer ? dock.vaultView.renderer({ ui, cwd, owner }) : null;
          });
        } catch (error) {
          kitClientLog({ level: "error", component: "root", msg: "注册 sidebar.workspaces 面板失败", fields: { err: String(error?.message ?? error) } });
          setKitUi({ treeOpen: false, gitOpen: false, vaultSideOpen: false });
          return undefined;
        }
        return () => {
          try {
            dispose();
          } catch {
            // 忽略注销异常
          }
        };
      }, [ui.treeOpen, ui.gitOpen, ui.vaultSideOpen, cwd, rightbarUp]);

      // Esc 分层：先关当前激活那张文档签（知识库关当前页那张、文件关当前文件那张），
      // 再关侧栏视图，最后收起终端坞（不拦截，避免挡掉其它 Esc 行为）。功能签归官方 ✕。
      // 组件自己的命令（知识库 Ctrl+Alt+/ 等）注册进官方 shortcuts 服务，动作闭包在
      // 组件自己的壳里刷新。

      react.useEffect(() => {
        const onKey = (e) => {
          if (e.key === "Escape") {
            if (dock.inlineEdit.active) return; // 树行改名输入激活（dsh-kit/files 经底座座上报）
            // 知识库搜索浮层开着时让路：Esc 归它自己（只关自己，不收标签页）
            if (dock.vaultSearch.open) return;
            // 代码块语言下拉的输入框在编辑器里，收起走它自己的 keydown：这里再收一次
            // 就是「Esc 顺手把这一页签关了」（浮层在 body 上，事件目标才是那个输入框）
            if (e.target instanceof Element && e.target.closest(".dshk-rte-langsel") !== null) return;
            // Esc 关当前激活那张内容签（diff / 知识库页，与官方签条的 ✕ 同语义——
            // 内容类页类型一内容一签，关闭走官方 close）
            if (activeRightbarFeature("file") || activeRightbarFeature("vault")) {
              closeActiveRightbarTab();
            } else if (getKitUi().gitOpen || getKitUi().treeOpen || getKitUi().vaultSideOpen) {
              // 侧栏视图单槽：关一格即可（树/scm/知识库·日程 互斥）；功能签不连带关
              setKitUi(sidebarViewPatch(null));
            } else if (getKitUi().termDockOpen) setKitUi({ termDockOpen: false }); // 只隐藏，不杀会话
          }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
      });

      // 知识库/日程的面板本体归 dsh-kit/vault 自己的壳（见该组件的 VaultShell），
      // 根壳只留 shellShare 桥与手机访问页的座位门控
      return null;
    }

    // ── 设置导航图标：官方 navIcon(id) 硬编码映射（models/agent-presets/plugins），
    // 未知 id 一律回退齿轮。没有注册缝，这里按标签文字找到对应行，把行内第一个
    // svg 换成自绘分层图标——纯外观增强：任何一步失败都静默保持齿轮。
    // 候选由各归属方注册（组件经 dock.registerNavIcon 注册自己的）。
    const NAV_ICONS = [];
    function registerNavIcon(entry) {
      if (entry) NAV_ICONS.push(entry);
    }

    let iconSwapPending = false;
    function swapKitNavIcons() {
      try {
        const rows = document.querySelectorAll('[role="dialog"][aria-modal="true"] nav button');
        if (rows.length === 0) return;
        for (const row of rows) {
          const span = row.querySelector("span");
          if (!span) continue;
          const entry = NAV_ICONS.find((candidate) => span.textContent === candidate.label());
          if (!entry) continue;
          const current = row.querySelector("svg");
          if (!current || current.getAttribute(entry.attr) === "1") continue;
          const holder = document.createElement("span");
          holder.innerHTML = entry.html;
          const icon = holder.firstElementChild;
          if (!icon) continue;
          icon.setAttribute(entry.attr, "1");
          current.replaceWith(icon);
        }
      } catch {
        // 外观增强失败即保持默认齿轮
      }
    }
    function scheduleNavIconSwap() {
      if (iconSwapPending) return;
      iconSwapPending = true;
      window.setTimeout(() => {
        iconSwapPending = false;
        swapKitNavIcons();
        window.setTimeout(swapKitNavIcons, 250); // React 重渲染后的二次补换
      }, 60);
    }

    // ─────────── dsh-kit/skills 组件（技能管理页）───────────
    // 技能池管理页（settings.section）：数据走本组件宿主半边 GET /dsh-kit/skills
    // （白名单根枚举 + 注册表归属增强）与 POST /dsh-kit/skills/op（move/delete/disable/
    // mount/unmount/history/commit/rollback）。分组显示：工作区(.agents|.dsh/skills) →
    // 用户级($DSH_HOME|~/.agents) → 技能池；插件自带/运行时来源只读展示。删除=移入回收站，
    // 禁用=改 frontmatter 双键。行禁用（宿主子模块不物化）时 /dsh-kit-skills/config 404，
    // 本组件不注册设置页；样式与词条随本组件自带。
    const skillsModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = kit;
    const { KitTip, kitGetJson, kitPostJson, kitJson, resolveZh, useCurrentCwd, registerNavIcon } = dock;

    // 组件私有文案（本组件自持词典，与根包字典互不依赖）
    const zh = {
      skillsLabel: "技能",
      skRefresh: "刷新",
      skLoading: "加载中…",
      skFail: "加载失败",
      skEmpty: "（此组暂无技能）",
      skNotCreated: "未创建",
      skRankTip: "所在位置的扫描优先级（数值越小越优先）",
      skWorkspace: "工作区",
      skUserLevel: "用户级",
      skPool: "技能池",
      skOther: "其他来源（插件自带/运行时，只读）",
      skNoCwdHint: "当前没有会话工作区：只显示用户级与技能池",
      skDisabled: "已禁用",
      skShadowed: "被覆盖",
      skShadowTip: "同名技能在更高优先级位置生效（优先级：.dsh > .agents > $DSH_HOME/skills > ~/.agents/skills）",
      skVersionTip: "技能自带版本（frontmatter version）：用来对照自己手上这份抄的是哪版",
      skByPlugin: "随插件",
      skHide: "收起",
      skView: "详情",
      skMove: "移动",
      skPickTarget: "选择目标位置",
      skDisable: "禁用",
      skEnable: "启用",
      skDelete: "删除",
      skConfirmDelete: "确认删除？",
      skCancel: "取消",
      skOverwrite: "目标已存在同名技能，覆盖？",
      skOpFail: "操作失败",
      skDone: "完成",
      skDeleted: "已删除",
      skMountTitle: "技能池挂载",
      skCarrierTip: "技能池里的技能以链接挂在这里；这个目录被 git 忽略，技能不进项目仓库",
      skNeedsChoice: "池技能挂在哪个根？选定后这个工作区的池链接都挂这里",
      skPickDsh: "用 .dsh/skills",
      skPickAgents: "用 .agents/skills",
      skIgnored: "已忽略",
      skNotIgnored: "未忽略",
      skPrepare: "体检并准备",
      skCarrierOwn: "载体根里有自己的技能",
      skCarrierOwnTip: "载体根里还有非链接的技能：它们不会进项目仓库，要收进仓库就搬到另一个根",
      skTracked: "载体根下有已进仓库的内容",
      skTrackedTip: "先把它们从仓库索引移除（文件保留），或搬到另一个根；否则挂链接会把池里的内容带进仓库",
      skMoveLocalTo: "搬到",
      skUntrack: "仅从仓库移除",
      skPrepared: "载体根已就绪",
      skMount: "挂载",
      skUnmount: "卸载",
      skMounted: "已挂载",
      skUnmounted: "已卸载",
      skPoolLink: "池链接",
      skLinkOut: "链接",
      skLinkTip: "指向技能池的链接：改它等于改池里的本体，所有挂载它的工作区同步生效",
      skLinkOutTip: "这是链接而不是实体：删除只断链，不影响目标",
      skBroken: "失效链接",
      skBrokenTip: "链接指向的池技能已不在（改名或删除），宿主发现时会静默跳过",
      skClean: "清理",
      skGit: "版本",
      skGitNow: "记一版",
      skGitNowTip: "提交信息写清这次改了什么——插件不会自动提交，历史就靠这句话读懂",
      skGitSubmit: "提交",
      skGitMsgPlaceholder: "写清这次改了什么",
      skGitNoChange: "没有改动可提交",
      skGitDone: "已记录",
      skGitVersions: "已记录",
      skGitLast: "上次提交",
      skGitDirty: "个文件未提交",
      skGitClean: "无未提交改动",
      skGitFiles: "文件",
      skGitEmpty: "（还没有提交）",
      skGitRollback: "回滚",
      skGitRollbackConfirm: "确认回滚？",
      skGitRollbackTip: "恢复成这次提交的样子，并记一条新提交（历史不重写，回滚本身也能再回滚）",
      skGitRolledBack: "已回滚",
      skGitSameVer: "已经是这一版",
      skGitDiscardAsk: "有未提交的改动会跟着一起丢掉，仍要回滚？",
      skGitNoDiff: "（文件组件行没开：看改动请用 git）",
      skGitDiffTip: "看这次提交对这个文件的改动",
      skGitNoGit: "这个环境里没有 git：不做版本记录",
      skGitFlat: "平铺技能（单根 .md）不做版本记录",
      skGitInitFail: "仓库初始化失败",
      skGitErr: "版本记录出错",
      skAgoJust: "刚刚",
      skAgoMin: "分钟前",
      skAgoHour: "小时前",
      skAgoDay: "天前",
      skMountCount: "挂载",
      skNoMount: "未挂载",
      skMountCountTip: "这个池技能被几个工作区挂着（登记表记的）。移动或删除本体时会把它们一并断掉",
      skMoveOutAsk: "移出技能池？",
      skMoveOutTip: "本体搬到目标根，别的工作区不再有它（挂载链接会被断开），版本记录也不再跟随",
      skMoveInAsk: "移入技能池？",
      skMoveInTip: "本体搬进池里共用，本工作区自动挂回来；以后改动立即对所有挂载它的工作区生效",
      skMoveInTipUser: "从用户级搬进池后不再全局可见：要用的工作区得各自挂载它",
      skMoveInTipFlat: "平铺 .md 会包成同名目录（入口文件改名 SKILL.md）再挂回来",
      skMoveOutConfirm: "确认移动",
      skMoved: "已移动",
      skDeleteMountedTip: "这个池技能还被别的工作区挂着：删除会一并断掉那些链接",
      contentFail: "读取失败",
      contentEmpty: "（空）",
      contentBinary: "二进制文件，无法预览",
    };
    const en = {
      skillsLabel: "Skills",
      skRefresh: "Refresh",
      skLoading: "Loading…",
      skFail: "Failed to load",
      skEmpty: "(no skills here)",
      skNotCreated: "not created",
      skRankTip: "Scan priority of this location (lower wins)",
      skWorkspace: "Workspace",
      skUserLevel: "User level",
      skPool: "Skill pool",
      skOther: "Other sources (plugin/runtime, read-only)",
      skNoCwdHint: "No session workspace: showing user-level and pool only",
      skDisabled: "Disabled",
      skShadowed: "Shadowed",
      skShadowTip: "A same-name skill at a higher-priority location takes effect (priority: .dsh > .agents > $DSH_HOME/skills > ~/.agents/skills)",
      skVersionTip: "Skill's own version (frontmatter version), to compare against your own copy",
      skByPlugin: "Plugin-bundled",
      skHide: "Hide",
      skView: "Details",
      skMove: "Move",
      skPickTarget: "Pick destination",
      skDisable: "Disable",
      skEnable: "Enable",
      skDelete: "Delete",
      skConfirmDelete: "Confirm delete?",
      skCancel: "Cancel",
      skOverwrite: "A skill with the same name exists at the target. Overwrite?",
      skOpFail: "Operation failed",
      skDone: "Done",
      skDeleted: "Deleted",
      skMountTitle: "Skill pool mount",
      skCarrierTip: "Pool skills are linked here; this directory is git-ignored, so skills never enter the project repo",
      skNeedsChoice: "Which root should hold the pool links? Every pool link in this workspace goes there afterwards",
      skPickDsh: "Use .dsh/skills",
      skPickAgents: "Use .agents/skills",
      skIgnored: "ignored",
      skNotIgnored: "not ignored",
      skPrepare: "Check and prepare",
      skCarrierOwn: "This root has skills of its own",
      skCarrierOwnTip: "The carrier root also holds non-link skills: they will not enter the project repo; move them to the other root to keep them in the repo",
      skTracked: "This root has content already in the repo",
      skTrackedTip: "Remove them from the repo index (files are kept) or move them to the other root; otherwise linking would drag pool content into the repo",
      skMoveLocalTo: "Move to",
      skUntrack: "Remove from repo only",
      skPrepared: "Carrier root ready",
      skMount: "Mount",
      skUnmount: "Unmount",
      skMounted: "Mounted",
      skUnmounted: "Unmounted",
      skPoolLink: "Pool link",
      skLinkOut: "Link",
      skLinkTip: "A link into the skill pool: editing it edits the pool copy, so every workspace mounting it changes too",
      skLinkOutTip: "This is a link, not a real entry: deleting only unlinks, the target is untouched",
      skBroken: "Broken link",
      skBrokenTip: "The pool skill it points to is gone (renamed or deleted); host discovery skips it silently",
      skClean: "Clean",
      skGit: "Versions",
      skGitNow: "Record",
      skGitNowTip: "Say what changed: the plugin never commits on its own, so this line is how the history reads",
      skGitSubmit: "Commit",
      skGitMsgPlaceholder: "What changed?",
      skGitNoChange: "Nothing to commit",
      skGitDone: "Recorded",
      skGitVersions: "commits",
      skGitLast: "last commit",
      skGitDirty: "uncommitted file(s)",
      skGitClean: "nothing uncommitted",
      skGitFiles: "files",
      skGitEmpty: "(no commits yet)",
      skGitRollback: "Roll back",
      skGitRollbackConfirm: "Confirm rollback?",
      skGitRollbackTip: "Restore to this commit and record a new one (history is never rewritten, so a rollback can itself be rolled back)",
      skGitRolledBack: "Rolled back",
      skGitSameVer: "Already at this version",
      skGitDiscardAsk: "Uncommitted changes will be lost too. Roll back anyway?",
      skGitNoDiff: "(file component row is off: use git to inspect changes)",
      skGitDiffTip: "See what this commit changed in this file",
      skGitNoGit: "No git in this environment: no version history",
      skGitFlat: "Flat skills (single .md) are not versioned",
      skGitInitFail: "Repository init failed",
      skGitErr: "Version history failed",
      skAgoJust: "just now",
      skAgoMin: "min ago",
      skAgoHour: "h ago",
      skAgoDay: "d ago",
      skMountCount: "Mounted in",
      skNoMount: "Not mounted",
      skMountCountTip: "How many workspaces mount this pool skill (from the mount registry). Moving or deleting the pool copy unlinks them all",
      skMoveOutAsk: "Move out of the skill pool?",
      skMoveOutTip: "The pool copy moves to the target root: other workspaces lose it (their links are removed) and the version history stops following it",
      skMoveInAsk: "Move into the skill pool?",
      skMoveInTip: "The copy moves into the pool and this workspace gets a link back; later edits take effect in every workspace mounting it",
      skMoveInTipUser: "Moving a user-level skill into the pool makes it no longer global: each workspace has to mount it",
      skMoveInTipFlat: "A flat .md is wrapped into a same-name directory (entry renamed SKILL.md) before linking back",
      skMoveOutConfirm: "Confirm move",
      skMoved: "Moved",
      skDeleteMountedTip: "Other workspaces still mount this pool skill: deleting unlinks them all",
      contentFail: "Failed to read",
      contentEmpty: "(empty)",
      contentBinary: "Binary file, preview unavailable",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    function fetchSkillsPage(cwd, signal) {
      const query = cwd ? "?cwd=" + encodeURIComponent(cwd) : "";
      return kitGetJson("/dsh-kit/skills" + query, signal, (b) => Array.isArray(b.groups));
    }

    function postSkillOp(payload) {
      return kitPostJson("/dsh-kit/skills/op", payload);
    }

    /** 物理根短标签（行内徽标与目标选择条共用） */
    const SK_ROOT_SHORT = {
      "project-dsh": ".dsh/skills",
      "project-agents": ".agents/skills",
      "user-dsh": "$DSH_HOME/skills",
      "user-agents": "~/.agents/skills",
    };

    function skRootShort(id) {
      return SK_ROOT_SHORT[id] ?? id;
    }

    function skGroupTitle(groupId) {
      if (groupId === "pool") return t("skPool");
      return groupId === "user" ? t("skUserLevel") : t("skWorkspace");
    }

    /** 宿主错误文案：带 message 时优先用它（error 字段是机器可读的码，如 not-prepared） */
    function skErrText(err) {
      return err && err.body && typeof err.body.message === "string" && err.body.message !== ""
        ? err.body.message
        : String(err?.message ?? err);
    }

    /** 相对时间（超过一周给日期）；提交列表用 */
    function skAgo(epochSec) {
      const diff = Math.max(0, Date.now() / 1000 - epochSec);
      if (diff < 60) return t("skAgoJust");
      if (diff < 3600) return `${Math.floor(diff / 60)} ${t("skAgoMin")}`;
      if (diff < 86400) return `${Math.floor(diff / 3600)} ${t("skAgoHour")}`;
      if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} ${t("skAgoDay")}`;
      const d = new Date(epochSec * 1000);
      const p = (v) => String(v).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    /**
     * 池技能的版本面板（只对池里的技能开放）：状态行 + 提交列表 + 写提交信息记一版 +
     * 点开某次提交里某个文件看改动 + 回滚。
     *
     * 插件**不自动提交**，所以这里的提交信息就是这份历史的全部信息量：信息为空不给提交。
     * 看改动复用文件组件的 diff 正文（`dock.diffPane` 座）；那一行没启用时不摆文件片，
     * 只留一句"用 git 看"。
     */
    function SkillGitPanel({ skill, cwd }) {
      const [git, setGit] = react.useState(null);
      const [error, setError] = react.useState("");
      const [note, setNote] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [composing, setComposing] = react.useState(false);
      const [message, setMessage] = react.useState("");
      const [confirmSha, setConfirmSha] = react.useState(null);
      const [pick, setPick] = react.useState(null);
      const [nonce, setNonce] = react.useState(0);
      const DiffC = dock.diffPane && dock.diffPane.Component ? dock.diffPane.Component : null;
      /** 拼文件绝对路径：技能目录来自宿主，按它自己的分隔符拼（Windows 上别混斜杠） */
      const filePath = (name) => (skill.path.includes("\\") ? `${skill.path}\\${name}` : `${skill.path}/${name}`);

      react.useEffect(() => {
        let alive = true;
        postSkillOp({ op: "history", src: skill.path, cwd })
          .then((body) => {
            if (alive && body && body.git) setGit(body.git);
          })
          .catch((err) => {
            if (alive) setError(skErrText(err));
          });
        return () => {
          alive = false;
        };
      }, [skill.path, cwd, nonce]);

      /** 发一条版本操作：成功回带最新状态，失败原样交回调用方判（dirty 要问一句再重发） */
      const post = async (payload) => {
        setBusy(true);
        setError("");
        setNote("");
        try {
          const body = await postSkillOp(payload);
          if (body && body.git) setGit(body.git);
          setComposing(false);
          setMessage("");
          setConfirmSha(null);
          setPick(null);
          return { ok: true, body };
        } catch (err) {
          return { ok: false, err };
        } finally {
          setBusy(false);
        }
      };
      const onCommit = async () => {
        const res = await post({ op: "commit", src: skill.path, message });
        if (res.ok) setNote(res.body && res.body.committed === false ? t("skGitNoChange") : t("skGitDone"));
        else setError(skErrText(res.err));
      };
      const onRollback = async (sha, discard) => {
        const res = await post({ op: "rollback", src: skill.path, sha, discard: discard === true });
        if (res.ok) {
          setNote(res.body && res.body.changed === false ? t("skGitSameVer") : t("skGitRolledBack"));
          return;
        }
        const body = res.err && res.err.body;
        if (body && body.error === "dirty" && discard !== true) {
          if (window.confirm(`${t("skGitDiscardAsk")}${typeof body.dirty === "number" ? `（${body.dirty}）` : ""}`)) {
            await onRollback(sha, true);
            return;
          }
          setConfirmSha(null);
          return;
        }
        setError(skErrText(res.err));
        setConfirmSha(null);
      };
      const onRollbackClick = (sha) => {
        if (confirmSha !== sha) {
          setConfirmSha(sha);
          return;
        }
        void onRollback(sha, false);
      };

      if (git === null) return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: t("skLoading") });
      const ready = git.available !== false && git.init === true;
      const status = !ready
        ? git.available === false
          ? t("skGitNoGit")
          : git.reason === "not-a-dir"
            ? t("skGitFlat")
            : `${t("skGitInitFail")}：${git.reason ?? ""}`
        : [
            `${t("skGitVersions")} ${git.commits.length}`,
            git.last ? `${t("skGitLast")} ${skAgo(git.last.time)}` : "",
            git.dirty > 0 ? `${git.dirty} ${t("skGitDirty")}` : t("skGitClean"),
          ]
            .filter((s) => s !== "")
            .join(" · ");

      return jsxRuntime.jsxs("div", {
        className: "dshk-sk-git",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-sk-bar",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-sk-bar-title", children: t("skGit") }),
              jsxRuntime.jsx("span", { className: "dshk-sk-desc", children: status }),
              jsxRuntime.jsx("span", { className: "dshk-sk-spacer" }),
              ready && !composing
                ? jsxRuntime.jsx(KitTip, {
                    label: t("skGitNowTip"),
                    children: jsxRuntime.jsx("button", {
                      type: "button",
                      className: "dshk-sk-btn",
                      disabled: busy,
                      onClick: () => setComposing(true),
                      children: t("skGitNow"),
                    }),
                  })
                : null,
            ],
          }),
          note !== "" ? jsxRuntime.jsx("div", { className: "dshk-sk-status", children: note }) : null,
          error !== "" ? jsxRuntime.jsx("div", { className: "dshk-sk-warn", title: error, children: `${t("skGitErr")}：${error}` }) : null,
          composing
            ? jsxRuntime.jsxs("div", {
                className: "dshk-sk-bar",
                children: [
                  jsxRuntime.jsx("input", {
                    className: "dshk-sk-input",
                    value: message,
                    placeholder: t("skGitMsgPlaceholder"),
                    disabled: busy,
                    onChange: (e) => setMessage(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter" && message.trim() !== "") void onCommit();
                    },
                  }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-sk-btn",
                    disabled: busy || message.trim() === "",
                    onClick: () => void onCommit(),
                    children: t("skGitSubmit"),
                  }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-sk-btn",
                    disabled: busy,
                    onClick: () => {
                      setComposing(false);
                      setMessage("");
                    },
                    children: t("skCancel"),
                  }),
                ],
              })
            : null,
          ready && git.commits.length === 0 ? jsxRuntime.jsx("div", { className: "dshk-sk-status", children: t("skGitEmpty") }) : null,
          ready && git.commits.length > 0 && DiffC === null
            ? jsxRuntime.jsx("div", { className: "dshk-sk-status", children: t("skGitNoDiff") })
            : null,
          ready
            ? git.commits.map((c) =>
                jsxRuntime.jsxs(
                  "div",
                  {
                    className: "dshk-sk-gitrow",
                    children: [
                      jsxRuntime.jsxs("div", {
                        className: "dshk-sk-line1",
                        children: [
                          jsxRuntime.jsx("span", { className: "dshk-sk-sha", title: c.sha, children: c.short }),
                          jsxRuntime.jsx("span", { className: "dshk-sk-desc", title: c.subject, children: `${skAgo(c.time)} · ${c.subject}` }),
                          jsxRuntime.jsx(KitTip, {
                            label: `${c.files} ${t("skGitFiles")} +${c.insertions} −${c.deletions}`,
                            children: jsxRuntime.jsx("span", { className: "dshk-sk-badge", children: `${c.files} · +${c.insertions} −${c.deletions}` }),
                          }),
                          jsxRuntime.jsx("span", { className: "dshk-sk-spacer" }),
                          confirmSha === c.sha
                            ? jsxRuntime.jsx("button", {
                                type: "button",
                                className: "dshk-sk-btn",
                                "data-danger": "1",
                                disabled: busy,
                                onClick: () => void onRollbackClick(c.sha),
                                children: t("skGitRollbackConfirm"),
                              })
                            : jsxRuntime.jsx(KitTip, {
                                label: t("skGitRollbackTip"),
                                children: jsxRuntime.jsx("button", {
                                  type: "button",
                                  className: "dshk-sk-btn",
                                  disabled: busy,
                                  onClick: () => onRollbackClick(c.sha),
                                  children: t("skGitRollback"),
                                }),
                              }),
                          confirmSha === c.sha
                            ? jsxRuntime.jsx("button", {
                                type: "button",
                                className: "dshk-sk-btn",
                                disabled: busy,
                                onClick: () => setConfirmSha(null),
                                children: t("skCancel"),
                              })
                            : null,
                        ],
                      }),
                      DiffC !== null && c.names.length > 0
                        ? jsxRuntime.jsx("div", {
                            className: "dshk-sk-files",
                            children: c.names.map((name) => {
                              const on = pick !== null && pick.sha === c.sha && pick.name === name;
                              return jsxRuntime.jsx(
                                "button",
                                {
                                  type: "button",
                                  className: "dshk-sk-file",
                                  title: t("skGitDiffTip"),
                                  "data-on": on ? "1" : undefined,
                                  disabled: busy,
                                  onClick: () => setPick(on ? null : { sha: c.sha, name }),
                                  children: name,
                                },
                                name,
                              );
                            }),
                          })
                        : null,
                      pick !== null && pick.sha === c.sha && DiffC !== null
                        ? jsxRuntime.jsx("div", {
                            className: "dshk-sk-diffbox",
                            children: jsxRuntime.jsx(DiffC, { path: filePath(pick.name), cwd: skill.path, commit: c.sha }),
                          })
                        : null,
                    ],
                  },
                  c.sha,
                ),
              )
            : null,
        ],
      });
    }


    // 设置导航图标（官方 navIcon 无注册缝，靠标签文字换行内 svg）：纯外观增强
    const SVG_SKILL_ICON =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 1.8 14.2 5 8 8.2 1.8 5z"/>' +
      '<path d="M1.8 8.1 8 11.2l6.2-3.1"/>' +
      '<path d="M1.8 11.3 8 14.4l6.2-3.1"/>' +
      "</svg>";

    // ─────────── 组件配置（/dsh-kit-skills/config）───────
    // 行开关（插件页组件行 switch）= 唯一开关。拉端点只为可达性——200 = 行启用；
    // 404（行禁用 → 子模块不物化）= 不注册设置页。
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
        const v = await kitJson("/dsh-kit-skills/config", undefined, (b) => b !== null && typeof b === "object");
        value = v;
      } catch {
        value = null; // 端点不可达（行禁用 404）：探明不可用
      }
      cfgSnap = value && typeof value === "object" ? { status: "ready", value } : { status: "unavailable" };
      emitCfg();
    }
    const subscribeCfg = (fn) => {
      cfgSubs.add(fn);
      return () => cfgSubs.delete(fn);
    };
    const getCfgSnapshot = () => cfgSnap;
    /** 组件可用性：端点 200（行启用）或未探明（乐观，apply 前的渲染窗口）= true；
     *  探明 404（行禁用 → 子模块不物化）= false */
    function cfgFromSnapshot(snap) {
      return { available: !snap || snap.status === "ready" };
    }

    // ─────────── 组件样式 ───────────
    // 技能管理页（settings.section）：三分组卡片；技能行单行布局，操作不换行、描述先收缩
    const SKS_CSS = `
.dshk-sk{font-size:13px;color:var(--dsw-alias-label-primary);user-select:text}
.dshk-sk-head{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
.dshk-sk-title{font-weight:600;font-size:14px}
.dshk-sk-status{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshk-sk-group{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin-bottom:12px;overflow:hidden}
.dshk-sk-group-head{display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px}
.dshk-sk-group-dir{font-family:ui-monospace,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:right}
/* 单行：名称/徽标 flex:none，描述 flex:1 收缩截断，操作区不换行 */
.dshk-sk-row{display:flex;align-items:center;gap:8px;padding:7px 12px;min-width:0}
.dshk-sk-row ~ .dshk-sk-row{border-top:1px solid var(--dsw-alias-border-l1)}
.dshk-sk-name{font-weight:600;white-space:nowrap;flex:none}
.dshk-sk-name[data-disabled]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dshk-sk-badge{flex:none;font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap;font-family:ui-monospace,Consolas,monospace}
.dshk-sk-badge-off{border-style:dashed;color:var(--dsw-alias-label-tertiary)}
.dshk-sk-desc{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dshk-sk-actions{flex:none;display:flex;align-items:center;gap:5px}
.dshk-sk-btn{appearance:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:1;padding:4px 9px;white-space:nowrap}
.dshk-sk-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sk-btn[data-danger="1"]{color:var(--dsw-alias-label-primary);font-weight:600;border-color:var(--dsw-alias-label-secondary)}
.dshk-sk-btn[disabled]{opacity:.5;cursor:default}
/* 展开式目标选择条：点复制/移动后出现在该行下方（同一时间只展开一行） */
.dshk-sk-target{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 12px;border-top:1px dashed var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sk-target-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sk-detail{padding:2px 12px 10px}
/* 挂载条：载体根 + git 忽略状态 + 体检入口（一行内换行排列） */
.dshk-sk-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 12px;margin-bottom:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sk-bar-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-sk-warn{color:var(--dsw-alias-label-primary);white-space:nowrap}
.dshk-sk-spacer{flex:1}
.dshk-sk-pre{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
/* 版本列表：提交号 + 每次提交的文件片（点开看该文件这次改了什么）+ diff 框 */
.dshk-sk-git{padding:4px 12px 10px}
.dshk-sk-sha{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshk-sk-gitrow{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;margin-top:6px}
.dshk-sk-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}
.dshk-sk-file{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.4;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;appearance:none}
.dshk-sk-file:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sk-file[data-on="1"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
.dshk-sk-diffbox{display:flex;flex-direction:column;max-height:340px;overflow:auto;margin-top:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.dshk-sk-input{flex:1;min-width:140px;padding:4px 7px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary)}
    `;
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit-skills/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit-skills";
        tag.dataset.pluginCss = "dsh-kit-skills/ui";
        tag.textContent = SKS_CSS;
        document.head.appendChild(tag);
      }
    }

    function SkillContent({ file, cwd }) {
      const [state, setState] = react.useState({ phase: "loading", text: "" });
      react.useEffect(() => {
        const controller = new AbortController();
        setState({ phase: "loading", text: "" });
        // cwd 是「工作区那一根」——项目级技能池（<cwd>/.agents/skills）靠它才在可读根内
        const root = typeof cwd === "string" && cwd.trim() !== "" ? `&cwd=${encodeURIComponent(cwd.trim())}` : "";
        kitGetJson(`/dsh-kit/read?path=${encodeURIComponent(file)}${root}`, controller.signal)
          .then((body) =>
            setState({
              phase: "ready",
              text: body.binary ? t("contentBinary") : body.content ?? "",
            }),
          )
          .catch((error) => {
            if (!controller.signal.aborted) setState({ phase: "error", text: String(error?.message ?? error) });
          });
        return () => controller.abort();
      }, [file, cwd]);
      if (state.phase === "loading") return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: t("skLoading") });
      if (state.phase === "error")
        return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: `${t("contentFail")}：${state.text}` });
      if (state.text.trim() === "") return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: t("contentEmpty") });
      return jsxRuntime.jsx("pre", { className: "dshk-sk-pre", children: state.text });
    }

    /** 展开式目标选择条：点选物理根即执行（不存在的根由宿主按需创建） */
    function TargetPicker({ roots, onPick }) {
      return jsxRuntime.jsxs("div", {
        className: "dshk-sk-target",
        children: [
          jsxRuntime.jsxs("span", { className: "dshk-sk-target-label", children: [t("skMove"), " · ", t("skPickTarget")] }),
          roots.map((root) =>
            jsxRuntime.jsx(
              "button",
              { type: "button", className: "dshk-sk-btn", title: root.dir, onClick: () => onPick(root.id), children: root.id === "pool" ? t("skPool") : skRootShort(root.id) },
              root.id,
            ),
          ),
        ],
      });
    }

    /**
     * 单个技能行（单行布局）：名称+徽标+描述截断+移动/禁用/删除/详情。
     * 池内技能没有禁用按钮（池不被扫描，禁用无意义）；移动展开目标选择条
     * （picker 状态提升到页面级，同一时间只允许一行展开）。
     * 技能只有移动、没有复制（副本与本体分叉，池技能的版本记录立刻失去意义），
     * 且沾池的移动前要确认：出池会断掉别的工作区的链接（登记表里的 mounts），
     * 进池会把本体交出去共用。
     */
    function SkillRow({ skill, groupId, allRoots, cwd, busy, runOp, picker, setPicker }) {
      const [open, setOpen] = react.useState(false);
      const [confirming, setConfirming] = react.useState(false);
      // 沾池的移动：picker 选完目标先停在这里等确认（{dest}）
      const [moveAsk, setMoveAsk] = react.useState(null);
      const [gitOpen, setGitOpen] = react.useState(false);
      // picker = 展开着目标选择条的那一行（技能路径）；单值保证同一时间只展开一行
      const pickerOpen = picker === skill.path;
      const targets = allRoots.filter((root) => root.id !== skill.root);
      // 链接条目（池挂载点）：只断链不动本体；也不给禁用——那会写穿到池里的本体，
      // 影响所有挂载它的工作区，要禁用请到池那一组去操作
      const isLink = skill.link === true;
      const isPool = groupId === "pool";
      // 动到池的移动（本体或挂载点，或目标就是池）要先确认
      const touchesPool = isPool || isLink;
      const mountCount = typeof skill.mounts === "number" ? skill.mounts : 0;
      const isUserSource = typeof skill.root === "string" && skill.root.startsWith("user-");

      const startPicker = () => setPicker(pickerOpen ? null : skill.path);
      const onDisable = () => runOp({ op: "disable", src: skill.path, cwd, disabled: !skill.disabled });
      const onUnmount = () => runOp({ op: "unmount", src: skill.path, cwd });
      const onDelete = () => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        runOp({ op: "delete", src: skill.path, cwd });
      };
      const pickDest = (rootId) => {
        setPicker(null);
        if (touchesPool || rootId === "pool") {
          setMoveAsk({ dest: rootId });
          return;
        }
        runOp({ op: "move", src: skill.path, dest: rootId, cwd });
      };
      const confirmMove = () => {
        const dest = moveAsk.dest;
        setMoveAsk(null);
        runOp({ op: "move", src: skill.path, dest, cwd });
      };

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-sk-row",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-sk-name", "data-disabled": skill.disabled || undefined, children: skill.name }),
              groupId !== "pool" && typeof skill.rank === "number"
                ? jsxRuntime.jsx(KitTip, { label: `${skRootShort(skill.root)} · ${t("skRankTip")}`, children: jsxRuntime.jsx("span", { className: "dshk-sk-badge", children: `(${skill.rank})` }) })
                : null,
              skill.disabled ? jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", children: t("skDisabled") }) : null,
              // 版本号（技能 frontmatter 的 version，自有约定）：池里的参考技能与个人
              // 副本靠它对照「抄的是哪版」
              typeof skill.version === "string" && skill.version !== ""
                ? jsxRuntime.jsx(KitTip, { label: t("skVersionTip"), children: jsxRuntime.jsx("span", { className: "dshk-sk-badge", children: `v${skill.version}` }) })
                : null,
              skill.shadowed ? jsxRuntime.jsx(KitTip, { label: t("skShadowTip"), children: jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", children: t("skShadowed") }) }) : null,
              isLink
                ? jsxRuntime.jsx(KitTip, {
                    label: skill.linkInPool === false ? t("skLinkOutTip") : t("skLinkTip"),
                    children: jsxRuntime.jsx("span", {
                      className: "dshk-sk-badge",
                      children: skill.linkInPool === false ? t("skLinkOut") : t("skPoolLink"),
                    }),
                  })
                : null,
              typeof skill.description === "string" && skill.description !== ""
                ? jsxRuntime.jsx("span", { className: "dshk-sk-desc", title: skill.description, children: skill.description })
                : null,
              // 池技能被几个工作区挂着（登记表）：0 = 谁也没用，可以删
              isPool
                ? jsxRuntime.jsx(KitTip, {
                    label: t("skMountCountTip"),
                    children: jsxRuntime.jsx("span", {
                      className: mountCount > 0 ? "dshk-sk-badge" : "dshk-sk-badge dshk-sk-badge-off",
                      children: mountCount > 0 ? `${t("skMountCount")} ${mountCount}` : t("skNoMount"),
                    }),
                  })
                : null,
              jsxRuntime.jsxs("div", {
                className: "dshk-sk-actions",
                children: [
                  groupId === "pool"
                    ? jsxRuntime.jsx(KitTip, {
                        label: t("skCarrierTip"),
                        children: jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => runOp({ op: "mount", src: skill.path, cwd }), children: t("skMount") }),
                      })
                    : null,
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: startPicker, children: t("skMove") }),
                  // 版本记录只给池里的技能（池是本体所在地，坏改动影响所有挂载方）
                  isPool
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setGitOpen((v) => !v), children: t("skGit") })
                    : null,
                  groupId !== "pool" && !isLink
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: onDisable, children: skill.disabled ? t("skEnable") : t("skDisable") })
                    : null,
                  isLink
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: onUnmount, children: t("skUnmount") })
                    : confirming
                      ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", "data-danger": "1", disabled: busy, onClick: onDelete, children: t("skConfirmDelete") })
                      : jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: onDelete, children: t("skDelete") }),
                  !isLink && confirming
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setConfirming(false), children: t("skCancel") })
                    : null,
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setOpen((v) => !v), children: open ? t("skHide") : t("skView") }),
                ],
              }),
            ],
          }),
          pickerOpen ? jsxRuntime.jsx(TargetPicker, { roots: targets, onPick: pickDest }) : null,
          isPool && gitOpen ? jsxRuntime.jsx(SkillGitPanel, { skill, cwd }) : null,
          moveAsk !== null
            ? jsxRuntime.jsxs("div", {
                className: "dshk-sk-bar",
                children: [
                  jsxRuntime.jsx("span", { className: "dshk-sk-warn", children: moveAsk.dest === "pool" ? t("skMoveInAsk") : t("skMoveOutAsk") }),
                  jsxRuntime.jsx("span", {
                    className: "dshk-sk-desc",
                    children:
                      moveAsk.dest === "pool"
                        ? (isUserSource ? t("skMoveInTipUser") : t("skMoveInTip")) +
                          (skill.kind === "file" ? `；${t("skMoveInTipFlat")}` : "")
                        : t("skMoveOutTip"),
                  }),
                  jsxRuntime.jsx("span", { className: "dshk-sk-spacer" }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: confirmMove, children: t("skMoveOutConfirm") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setMoveAsk(null), children: t("skCancel") }),
                ],
              })
            : null,
          isPool && confirming && mountCount > 0
            ? jsxRuntime.jsxs("div", {
                className: "dshk-sk-bar",
                children: [
                  jsxRuntime.jsx("span", { className: "dshk-sk-warn", children: `${t("skMountCount")} ${mountCount}` }),
                  jsxRuntime.jsx("span", { className: "dshk-sk-desc", children: t("skDeleteMountedTip") }),
                ],
              })
            : null,
          open ? jsxRuntime.jsx("div", { className: "dshk-sk-detail", children: jsxRuntime.jsx(SkillContent, { file: skill.file, cwd }) }) : null,
        ],
      });
    }

    /** 只读展示注册表里非白名单根的技能（插件自带/运行时/custom 目录等） */
    function ProviderRow({ item }) {
      return jsxRuntime.jsxs("div", {
        className: "dshk-sk-row",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-sk-line1",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-sk-name", children: item.name }),
              item.provider !== "" ? jsxRuntime.jsx("span", { className: "dshk-sk-badge", children: item.provider }) : null,
              item.source !== "" ? jsxRuntime.jsx("span", { className: "dshk-sk-badge", children: item.source }) : null,
              jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", children: t("skByPlugin") }),
            ],
          }),
          typeof item.description === "string" && item.description !== ""
            ? jsxRuntime.jsx("div", { className: "dshk-sk-desc", title: item.description, children: item.description })
            : null,
        ],
      });
    }

    /**
     * 挂载条：挂载点（用户自己选的载体根）+ git 忽略状态 + 体检入口。只呈现事实与机制操作——
     * 没选过就先让用户选一个根；选定后这个工作区的池链接都挂那儿，插件不再自己判断该用哪根。
     */
    function MountBar({ mount, busy, resolvePrompt, onChoose, onPrepare, onResolve, onCancelResolve }) {
      const needPrepare = mount.ignored === false || mount.tracked.length > 0 || mount.carrierOwn > 0;
      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-sk-bar",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-sk-bar-title", children: t("skMountTitle") }),
              mount.needsChoice
                ? jsxRuntime.jsx("span", { className: "dshk-sk-warn", children: t("skNeedsChoice") })
                : jsxRuntime.jsx(KitTip, {
                    label: t("skCarrierTip"),
                    children: jsxRuntime.jsx("span", { className: "dshk-sk-badge", title: mount.carrierDir, children: skRootShort(mount.carrierRoot) }),
                  }),
              mount.needsChoice
                ? null
                : mount.ignored === false
                  ? jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", children: t("skNotIgnored") })
                  : jsxRuntime.jsx("span", { className: "dshk-sk-badge", children: t("skIgnored") }),
              !mount.needsChoice && mount.carrierOwn > 0
                ? jsxRuntime.jsx(KitTip, { label: t("skCarrierOwnTip"), children: jsxRuntime.jsx("span", { className: "dshk-sk-warn", children: t("skCarrierOwn") }) })
                : null,
              !mount.needsChoice && mount.tracked.length > 0
                ? jsxRuntime.jsx(KitTip, {
                    label: t("skTrackedTip"),
                    children: jsxRuntime.jsx("span", { className: "dshk-sk-warn", children: `${t("skTracked")} · ${mount.tracked.length}` }),
                  })
                : null,
              jsxRuntime.jsx("span", { className: "dshk-sk-spacer" }),
              mount.needsChoice
                ? jsxRuntime.jsxs(jsxRuntime.Fragment, {
                    children: [
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => onChoose("project-dsh"), children: t("skPickDsh") }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => onChoose("project-agents"), children: t("skPickAgents") }),
                    ],
                  })
                : needPrepare
                  ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => onPrepare(), children: t("skPrepare") })
                  : null,
            ],
          }),
          resolvePrompt !== null
            ? jsxRuntime.jsxs("div", {
                className: "dshk-sk-bar",
                children: [
                  jsxRuntime.jsx("span", { className: "dshk-sk-warn", children: t("skTrackedTip") }),
                  jsxRuntime.jsx("span", { className: "dshk-sk-spacer" }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => onResolve("move"), children: `${t("skMoveLocalTo")} ${skRootShort(mount.otherRoot)}` }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => onResolve("untrack"), children: t("skUntrack") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: onCancelResolve, children: t("skCancel") }),
                ],
              })
            : null,
        ],
      });
    }

    const SK_GROUP_RANK = { workspace: 0, user: 1, pool: 2 };

    function SkillsManager(props) {
      const cwd = useCurrentCwd(props);
      const [data, setData] = react.useState(null);
      const [error, setError] = react.useState("");
      const [message, setMessage] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [nonce, setNonce] = react.useState(0);
      // 展开中的移动目标选择条（技能路径，单值）；单值保证同一时间只展开一行
      const [picker, setPicker] = react.useState(null);
      // 载体根下有已进仓库的内容时，等用户选处理方式（[] = 已弹出，等待选择）
      const [resolvePrompt, setResolvePrompt] = react.useState(null);

      react.useEffect(() => {
        const controller = new AbortController();
        fetchSkillsPage(cwd ?? "", controller.signal)
          .then((body) => {
            setData(body);
            setError("");
          })
          .catch((err) => {
            if (!controller.signal.aborted) setError(String(err?.message ?? err));
          });
        return () => controller.abort();
      }, [cwd, nonce]);

      /** 各操作成功后显示的那句话（带 warning 的响应用 warning） */
      const OP_DONE_KEY = { delete: "skDeleted", mount: "skMounted", unmount: "skUnmounted", prepare: "skPrepared", move: "skMoved" };

      const runOp = async (payload) => {
        if (busy) return;
        setBusy(true);
        setMessage("");
        try {
          let body = null;
          try {
            body = await postSkillOp(payload);
          } catch (err) {
            // 载体根下有已进仓库的内容：不是错误而是缺一个决定（搬到另一个根 / 仅从仓库移除）
            if (err && err.status === 409 && err.body && err.body.error === "tracked") {
              setResolvePrompt(Array.isArray(err.body.tracked) ? err.body.tracked : []);
              return;
            }
            if (err && err.status === 409 && window.confirm(t("skOverwrite"))) {
              // 覆盖重试同样可能失败：外层只有 finally，这里再抛就是未处理拒绝——
              // 用户只看到忙态消失、没有任何提示
              try {
                body = await postSkillOp({ ...payload, overwrite: true });
              } catch (retryErr) {
                setMessage(`${t("skOpFail")}：${skErrText(retryErr)}`);
                return;
              }
            } else {
              setMessage(`${t("skOpFail")}：${skErrText(err)}`);
              return;
            }
          }
          // 宿主做了但没做全（例如入池后没能挂回来）：照它的话说出来，别用"完成"糊过去
          const warning = body && typeof body.warning === "string" && body.warning !== "" ? body.warning : null;
          setMessage(warning ?? t(OP_DONE_KEY[payload.op] ?? "skDone"));
          setResolvePrompt(null);
          setPicker(null);
          setNonce((n) => n + 1);
        } finally {
          setBusy(false);
        }
      };

      const groups = data
        ? [...data.groups].sort((a, b) => (SK_GROUP_RANK[a.id] ?? 99) - (SK_GROUP_RANK[b.id] ?? 99))
        : [];
      const allRoots = data ? groups.flatMap((group) => group.roots) : [];

      return jsxRuntime.jsxs("div", {
        className: "dshk-sk",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-sk-head",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-sk-title", children: t("skillsLabel") }),
              message !== "" ? jsxRuntime.jsx("span", { className: "dshk-sk-status", children: message }) : null,
              error !== "" ? jsxRuntime.jsx("span", { className: "dshk-sk-status", title: error, children: `${t("skFail")}：${error}` }) : null,
              jsxRuntime.jsx("span", { style: { flex: 1 } }),
              jsxRuntime.jsx(KitTip, { label: t("skRefresh"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setNonce((n) => n + 1), children: "⟳" }) }),
            ],
          }),
          !cwd ? jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { marginBottom: 8 }, children: t("skNoCwdHint") }) : null,
          data && data.mount
            ? jsxRuntime.jsx(MountBar, {
                mount: data.mount,
                busy,
                resolvePrompt,
                onChoose: (carrier) => runOp({ op: "setcarrier", carrier, cwd }),
                onPrepare: () => runOp({ op: "prepare", cwd }),
                onResolve: (resolve) => runOp({ op: "prepare", cwd, resolve }),
                onCancelResolve: () => setResolvePrompt(null),
              })
            : null,
          data && Array.isArray(data.brokenLinks) && data.brokenLinks.length > 0
            ? jsxRuntime.jsxs("div", {
                className: "dshk-sk-group",
                children: [
                  jsxRuntime.jsxs("div", {
                    className: "dshk-sk-group-head",
                    children: [
                      jsxRuntime.jsx("span", { children: t("skBroken") }),
                      jsxRuntime.jsx("span", { children: `· ${data.brokenLinks.length}` }),
                      jsxRuntime.jsx("span", { className: "dshk-sk-group-dir", children: t("skBrokenTip") }),
                    ],
                  }),
                  data.brokenLinks.map((item) =>
                    jsxRuntime.jsxs(
                      "div",
                      {
                        className: "dshk-sk-row",
                        children: [
                          jsxRuntime.jsx("span", { className: "dshk-sk-name", children: item.name }),
                          jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", children: skRootShort(item.root) }),
                          jsxRuntime.jsx("span", { className: "dshk-sk-desc", title: item.path, children: item.target ?? item.path }),
                          jsxRuntime.jsxs("div", {
                            className: "dshk-sk-actions",
                            children: [
                              jsxRuntime.jsx("button", {
                                type: "button",
                                className: "dshk-sk-btn",
                                disabled: busy,
                                onClick: () => runOp({ op: "unmount", src: item.path, cwd }),
                                children: t("skClean"),
                              }),
                            ],
                          }),
                        ],
                      },
                      item.path,
                    ),
                  ),
                ],
              })
            : null,
          groups.map((group) =>
            jsxRuntime.jsxs(
              "div",
              {
                className: "dshk-sk-group",
                children: [
                  jsxRuntime.jsxs("div", {
                    className: "dshk-sk-group-head",
                    children: [
                      jsxRuntime.jsx("span", { children: skGroupTitle(group.id) }),
                      jsxRuntime.jsx("span", { children: `· ${group.skills.length}` }),
                      jsxRuntime.jsx("span", {
                        className: "dshk-sk-group-dir",
                        title: group.roots.map((root) => root.dir).join("\n"),
                        children: group.roots
                          .map((root) =>
                            root.id === "pool"
                              ? `${root.dir}${root.exists ? "" : `（${t("skNotCreated")}）`}`
                              : `${skRootShort(root.id)}(${root.rank})${root.exists ? "" : `（${t("skNotCreated")}）`}`,
                          )
                          .join(" | "),
                      }),
                    ],
                  }),
                  group.skills.length === 0
                    ? jsxRuntime.jsx("div", { className: "dshk-sk-row dshk-sk-status", children: t("skEmpty") })
                    : group.skills.map((skill) =>
                        jsxRuntime.jsx(
                          SkillRow,
                          { skill, groupId: group.id, allRoots, cwd, busy, runOp, picker, setPicker },
                          skill.path,
                        ),
                      ),
                ],
              },
              group.id,
            ),
          ),
          data && Array.isArray(data.providers) && data.providers.length > 0
            ? jsxRuntime.jsxs("div", {
                className: "dshk-sk-group",
                children: [
                  jsxRuntime.jsx("div", { className: "dshk-sk-group-head", children: jsxRuntime.jsx("span", { children: t("skOther") }) }),
                  data.providers.map((item, index) => jsxRuntime.jsx(ProviderRow, { item }, `${item.name}::${index}`)),
                ],
              })
            : null,
        ],
      });
    }

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      // 技能设置页：官方 settings.section 是挂载期声明槽位，inject 等声明落地再注册；
      // 行禁用（探针 404）时注销，入口从设置导航消失
      ctx.slots.inject("settings.section", () => {
        let unregister;
        const update = () => {
          if (cfgFromSnapshot(getCfgSnapshot()).available) {
            if (!unregister) {
              unregister = ctx.slots.register(
                { name: "settings.section", id: "kit-skills", order: 40, label: () => t("skillsLabel") },
                SkillsManager,
              );
            }
          } else if (unregister) {
            unregister();
            unregister = undefined;
          }
        };
        const off = subscribeCfg(update);
        update();
        return () => {
          off();
          if (unregister) {
            unregister();
            unregister = undefined;
          }
        };
      });
      registerNavIcon({ label: () => t("skillsLabel"), attr: "data-dshk-skill", html: SVG_SKILL_ICON });
      injectStyles();
      void loadCfg(); // 拉探针喂门控（404 = 行禁用，不注册设置页）
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    // 渲染级检查与直测引用
    exports.SkillsManager = SkillsManager;
    exports.SkillRow = SkillRow;
    exports.SkillGitPanel = SkillGitPanel;
    exports.fetchSkillsPage = fetchSkillsPage;
    exports.cfgFromSnapshot = cfgFromSnapshot;
    return module.exports;
    };

    // ─────────── 官方右侧边栏注册 ───────────
    // 根行只剩文件签（被动签，不给开始页条目——入口在左侧边栏）；知识库 / 日程 /
    // 浏览器的签与条目各归各自组件半边。服务运行期探测（见 RB_FEATURES 处注释）。
    const RB_BODY = {
      file: FilePaneBody,
    };
    function registerRightbar(rbCtx) {
      const tabs = rbCtx.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      for (const f of RB_FEATURES) {
        const Body = RB_BODY[f.feature];
        rbCtx.effect(() => tabs.register({
          id: f.id,
          kind: f.kind,
          ...(f.feature === "file" ? { patterns: ["dsh-resource://dshk-diff/**"] } : {}),
          title: (address) => (f.feature === "file" ? baseName(rightbarItem("file", address) ?? "") || t(f.titleKey) : t(f.titleKey)),
        }), `dsh-kit: rightbar tab type ${f.kind}`);
        rbCtx.effect(() => rbCtx.slots.inject("sidebar.right.pane.tab", () => rbCtx.slots.register({
          name: "sidebar.right.pane.tab",
          key: f.id,
          // cwd（浏览器 pane 定位当前会话）经 shellShare 桥接（pane 注册发生在 effect，
          // 渲染期的 props 由 KitSurfaces 的常驻桥供最新值）
          inject: () => ({
            useSessions: shellShare.current?.useSessions,
          }),
        }, Body)), `dsh-kit: rightbar pane body ${f.kind}`);
      }
    }


    // ─────────── 插件体 ───────────
    function apply(ctx) {
      slotsCtx = ctx;
      kitBase.apply(ctx); // 底座服务捕获（官方右栏 sidebarRight）

      // ── 官方文件预览的非 Chromium 引擎兜底（依赖宿主断言，升级复核见知识库「DSH 插件开发坑」）──
      // OpenHarmony 等引擎有两个叠加缺陷，缺一个就全站正常、只在真机发作：
      // ① 自定义 scheme 的 URL 解析：dsh-resource://file/… 的 hostname 恒为空 → 宿主
      //    client-resources 的 protocolOf 返回 undefined → 资源查找恒 none，预览恒报
      //    「文件资源服务不可用」；
      // ② boot 对 api-workspace-files 条目激活失败且**静默**（无报错无日志），file 协议
      //    provider 无人注册。
      // 兜底两步：shim 把 providerOf(undefined) 兜到 file provider；补注册在 boot 结束后
      // 手动跑一次该模块的 apply（合成最小 ctx，effect 立即执行）。**必须晚于 boot**：
      // boot 中途物化该模块会把宿主的静默激活失败变成「Failed to load plugins」横幅。
      // 健康浏览器：特性检测不过 + providers 已有 file，两步都空转。
      ctx.inject(["resources"], (rc) => {
        try {
          const reg = rc.resources;
          if (!reg || typeof reg.providerOf !== "function" || !(reg.providers instanceof Map)) return;
          let brokenUrlHost = false;
          try { brokenUrlHost = new URL("dsh-resource://file/x").hostname === ""; } catch (e) { brokenUrlHost = true; }
          if (!brokenUrlHost || reg.__dshkShimmed) return;
          reg.__dshkShimmed = true;
          const origProviderOf = reg.providerOf.bind(reg);
          reg.providerOf = function (protocol) {
            return protocol === void 0 ? reg.providers.get("file") : origProviderOf(protocol);
          };
        } catch (e) { /* 无害 */ }
      });
      ctx.inject(["resources", "remote"], (svc) => {
        setTimeout(() => {
          try {
            if (svc.resources.providers && svc.resources.providers.has("file")) return;
            const mod = require("@deepseek-ai/dsh-api-workspace-files");
            if (!mod || typeof mod.apply !== "function") return;
            mod.apply({
              resources: svc.resources,
              remote: svc.remote,
              effect: (fn) => { fn(); },
            });
          } catch (e) { /* 激活失败不可挽时维持宿主原状：预览报「文件资源服务不可用」 */ }
        }, 5000);
      });
      injectStyles();
      // 全帧浮层宿主：面板渲染、输入框入口与技能页的座位门控、快捷键监听全在
      // KitSurfaces（根作用域常驻，fiber 上下文内做动态 register/dispose）。
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          { name: "shell.overlay", id: "dsh-kit-surfaces", order: 900 },
          KitSurfaces,
        ),
      );
      // 官方右侧边栏：功能 dock 签 + 引导页清单。只在宿主
      // 提供该服务时生效（缺服务 = 只剩 getKitUi() 存在性补丁，签不出现）。用 inject
      // 等它就绪而非直接读——官方右栏与本插件的客户端加载顺序不保证
      //（sidebarRight 与在场信号的捕获在 kitBase.apply，本处只管右栏签与其它服务）
      if (typeof ctx.inject === "function") {
        ctx.inject(["sidebarRightTabs"], registerRightbar);
        // 官方 sessions 服务捕获：openOfficialFile 拼文件地址要当前会话 id 与 cwd
        ctx.inject(["sessions"], (sctx) => { sessionsSvc = sctx.sessions; });
      } else {
        registerRightbar(ctx);
      }
      // 导航图标替换是点击驱动的轻量方案：打开设置/面板内切换都源于一次 click
      dock.hookGlobal(document, "navIconSwap", "click", scheduleNavIconSwap, true);
      // 官方文件预览头部的下载按钮：预览根 mount（loading→text 整根重建）与路径
      // title 变化（meta 后到才补成绝对路径）都要接住，全走同一防抖扫描
      if (typeof MutationObserver !== "undefined" && document.documentElement) {
        new MutationObserver(schedulePreviewDownloadScan).observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["title"],
        });
        scanPreviewDownload();
      }
      // 组件半边激活（十个组件行各一个：files/chat/monitor/terminal/skills/search/
      // browser/vault/phone/logs）。**清单必须与组件行一一对应**：漏一个，那个组件的
      // apply 永不执行，探针再通也没人拉（日志行的浏览器半边就栽过这一处）。client
      // 入口注册总是发生，功能存在性由各组件自己的探针门控（行禁用只摘宿主半边端点，
      // 探针 404 的组件整体不注册）
      for (const componentMod of [exports.files, exports.chat, exports.monitor, exports.terminal, exports.skills, exports.search, exports.browser, exports.vault, exports.phone, exports.logs]) {
        if (componentMod && typeof componentMod.apply === "function") componentMod.apply(ctx);
      }
    }

    // ── dsh-kit/vault 组件（知识库 · 日程）──
// dsh-kit/vault 浏览器半边 —— 知识库 · 日程组件的 client 面。
// 收纳：侧栏那一格（顶部 tab 条切 知识库 目录索引 / 日程 待办清单）、右栏知识库页阅读面
// （vendor RTE 编辑态 + 双链 / 反链 / 目录导航）、右栏日程签（周时间网格 + 统计）、
// 开/关侧栏那一格（宿主快捷键）、对话文件路径改投知识库标签、组件配置页与快捷键。
// 数据走本组件宿主半边 /dsh-kit/vault/* 与 /dsh-kit/schedule/*；行开关即总开关：
// 宿主半边不物化时 /dsh-kit-vault/config 404，apply 直接不注册任何槽位与监听
//（侧栏、右栏签、对话改投全不出现）。
    const vaultModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const reactDom = require("react-dom");
    const dock = kit;
    // Esc 让路：浮层/对话框/行内菜单开着时 root 的全局 Esc 收手，只关最上层。
    // **按计数持有**，不用裸布尔——搜索浮层与对话框、行内菜单可能同时开着，
    // 先关的那个把 open 抹回 false 会让下层浮层（乃至页签）被同一个 Esc 收走
    const holdEsc = () => {
      dock.vaultSearch.held = (dock.vaultSearch.held ?? 0) + 1;
      dock.vaultSearch.open = true;
    };
    const releaseEsc = () => {
      const n = Math.max(0, (dock.vaultSearch.held ?? 0) - 1);
      dock.vaultSearch.held = n;
      dock.vaultSearch.open = n > 0;
    };
    const {
      getKitUi, setKitUi, useKitUi, KitTip, flashToast, writeClipboard,
      kitJson, kitPostJson, resolveZh, baseName, pageBasename,
      markFeaturePresence,
      openRightbarTab, closeRightbarTab, sidebarViewPatch,
      rightbarItem, openRightbarItem, rightbarItems, closeRightbarItem, useActiveRightbarItem, tabAddress, tabVisible,
      rightbarSeat, useRightbarSeat,
      useCurrentRow, currentComposerShell, chatMentionText,
      openOfficialFile, TreeRowMenu, TreeFolderIcon, FileTypeIcon16, ChevronIcon, OfficialIcon, dswIcon,
      expandSidebarNow, attachShortcutCatalog, t: rootT,
    } = dock;

    // 组件私有文案（树 / 页 / 日程 / 配置页）；共用词条（取消、已移动、已导入等）回落根包 t
    const zh = {
      kcfgGroupVault: "知识库",
      kcfgVaultRoot: "知识库根目录（绝对路径）",
      kcfgVaultRootHint: "普通 md 目录，指向哪里读哪里；清空恢复默认根。",
      kcfgBuiltinPdf: "PDF 用自带阅读器",
      kcfgBuiltinPdfHint: "库内 PDF 开成知识库页签（页码跳转、记住上次读到哪一页，不受官方预览的整文件大小上限）。关掉则一律走官方文件预览。",
      scVault: "知识库 · 日程",
      scVaultOff: "知识库已在配置页关闭",
      schedTab: "日程",
      schedToday: "今天",
      schedNoDue: "无期限",
      schedTasks: "待办",
      schedTaskDue: "截止",
      schedOverdue: "逾期",
      schedTasksEmpty: "暂无待办",
      schedScope3d: "近三日",
      schedScopeWeek: "近一周",
      schedScopeAll: "全部",
      schedStatsEvents: "事件",
      schedStatsDone: "已过",
      schedStatsOpen: "未到",
      schedStatsTitle: "本周统计",
      schedLoadFail: "日程刷新失败（面板是上一次的数据）",
      schedTimerStandalone: "独立计时（不挂待办）",
      schedNew: "新建",
      schedEdit: "编辑",
      schedDelete: "删除",
      schedSave: "保存",
      schedSaved: "已保存",
      schedDeleted: "已删除",
      schedOpFail: "操作失败：{error}",
      schedConfirmDelete: "删除「{name}」？",
      schedConfirm: "确认删除",
      schedSeriesHint: "重复日程：这里的改动作用于整个系列",
      schedKindTodo: "待办",
      schedKindEvent: "日程",
      schedStart: "开始",
      schedEnd: "结束",
      schedRepeat: "重复",
      schedRepeatNone: "不重复",
      schedRepeatDaily: "每天",
      schedRepeatWeekly: "每周",
      schedRepeatMonthly: "每月",
      schedRepeatEvery: "每",
      schedRepeatEnd: "重复到",
      schedLocation: "地点",
      schedDescription: "备注",
      schedTitleHint: "标题最多 16 字",
      schedTitle: "标题",
      schedTitleRequired: "标题必填",
      schedType: "类型",
      schedEndAfterStart: "日程要有起止时刻，且结束必须晚于开始",
      schedDone: "已完成",
      schedEntryTitle: "计时段",
      schedEntryNote: "这段在做什么",
      schedTimerStart: "开始计时",
      schedTimerStop: "停表",
      schedTimerRunning: "计时中",
      schedTimerPick: "选一条待办挂上，或起一段独立计时",
      schedTimerNoTodos: "没有未完成的待办",
      schedTimerSoloPh: "这段时间在做什么",
      schedTimerSoloBtn: "独立计时",
      schedTimerAttachBtn: "挂这条计时",
      schedTimerBallTip: "走秒与停表都在悬浮球上",
      schedWeekdays: "一,二,三,四,五,六,日",
      vaultTitle: "知识库",
      // 左栏底部那枚入口钮的名：它开的是整格（知识库 + 日程两 tab），不是某一个 tab
      vaultEntryTitle: "知识库·日程",
      vaultNotConfigured: "未配置知识库目录",
      vaultNotConfiguredHint: "在 设置 → 插件 → dsh-kit 里填写「知识库目录」后即可使用：目录内一切 md 文件即页面，支持双链跳转与全文搜索",
      vaultIndexFail: "索引失败：{error}",
      vaultSearchPh: "搜索笔记 / 资料库",
      vaultSearchEmpty: "无结果",
      vaultSearchFail: "搜索失败：{error}",
      vaultHitNote: "笔记",
      vaultLibrary: "资料库",
      vaultParentRoot: "根目录",
      vaultBackRoot: "返回知识库",
      vaultNew: "新建",
      vaultNewPh: "名称；\\ 开头建目录，可含 / 多级",
      vaultExists: "同名已存在，未改动",
      vaultLinks: "（改写 {n} 页双链）",
      vaultMoveTo: "移动到…",
      vaultMoveTitle: "移动「{name}」",
      vaultMoveLabel: "移动到",
      vaultMoveSkipped: "目标已有同名，按「跳过」处理",
      vaultImportMd: "导入 md 文件…",
      vaultImportFiles: "导入文件…",
      vaultImportTitle: "导入",
      vaultImportTo: "导入到：{dest}",
      vaultImportPick: "选择文件…",
      vaultImportPathPh: "或粘贴本机绝对路径",
      vaultImportName: "名称",
      vaultImportNeedSrc: "先选择文件，或填一个本机绝对路径",
      vaultLibAutoName: "同名自动加序号，不覆盖",
      vaultImportImgs: "（{n} 张图片进附件）",
      vaultConflict: "目标已有同名，怎么处理？",
      vaultConflictSkip: "跳过（什么都不做）",
      vaultConflictOverwrite: "覆盖（旧的送回收站）",
      vaultConflictRename: "自动加序号",
      vaultConfirmDeleteDir: "删除文件夹「{name}」及其 {n} 项？",
      vaultRecycleHint: "移入回收站",
      vaultRefresh: "刷新索引与目录树",
      vaultRefreshed: "已刷新",
      vaultBinaryHint: "二进制文件，知识库不渲染",
      vaultTooLargeHint: "文件超过 1MB，为避免写回截断，库内不编辑（请用外部编辑器）",
      vaultCopy: "复制",
      vaultCopied: "已复制",
      vaultBacklinks: "反链",
      vaultToc: "目录",
      vaultTocEmpty: "本文没有标题",
      vaultBlEmpty: "没有页面引用本页",
      vaultLibsFail: "渲染组件加载失败",
      vaultPickPage: "从左侧选择一页开始",
      pdfOpening: "正在打开 PDF…",
      pdfFailed: "PDF 打开失败",
      pdfMissing: "文件不存在或已被移动",
      pdfTooLarge: "文件过大，不在阅读器里打开",
      pdfPage: "页码",
      vaultPageGone: "页面不存在（可能已被移动或删除）",
      vaultCiteUnavailable: "对话输入框未就绪（无会话或不可用）",
      vaultIdxTruncated: "笔记太多：索引已达单次扫描上限（5000 页），搜索与反链只覆盖已索引的部分",
      vaultLibTruncated: "资料库清单已达上限（2000 项），资料库搜索只覆盖已列出的部分",
      vaultSaved: "已保存",
      vaultUnsaved: "有未保存修改",
      vaultSaveFail: "保存失败：{error}",
      vaultSaveConflict: "页面在盘上已被改动，自动保存已暂停",
      vaultSaveConflictOverwrite: "用我的覆盖盘上",
      vaultSaveConflictReload: "读盘上的（丢弃我的改动）",
      vaultAttachFail: "图片入库失败",
      rtePlaceholder: "输入正文，/ 唤出命令菜单",
      vmenuGHead: "标题与正文",
      vmenuH1: "标题 1",
      vmenuH1Desc: "一级标题",
      vmenuH2: "标题 2",
      vmenuH2Desc: "二级标题",
      vmenuH3: "标题 3",
      vmenuH3Desc: "三级标题",
      vmenuH4: "标题 4",
      vmenuH4Desc: "四级标题",
      vmenuBody: "正文",
      vmenuBodyDesc: "普通文本段落",
      vmenuGSpecial: "特殊块",
      vmenuHr: "分割线",
      vmenuHrDesc: "水平分割线",
      vmenuFold: "折叠块",
      vmenuFoldDesc: "可折叠内容区域",
      vmenuGList: "列表",
      vmenuUl: "无序列表",
      vmenuUlDesc: "圆点列表",
      vmenuOl: "有序列表",
      vmenuOlDesc: "编号列表",
      vmenuTodo: "任务列表",
      vmenuTodoDesc: "勾选待办",
      vmenuGMath: "数学公式与代码",
      vmenuMathInline: "行内公式",
      vmenuMathInlineDesc: "行内数学公式",
      vmenuMathBlock: "行间公式",
      vmenuMathBlockDesc: "独立公式区域",
      vmenuCode: "代码块",
      vmenuCodeDesc: "代码区域（语法高亮）",
      vmenuQuote: "引用",
      vmenuQuoteDesc: "引用块",
      vmenuWiki: "双链",
      vmenuWikiDesc: "链接到其它页面 [[页面]]",
      vmenuGChart: "图表",
      vmenuTable: "表格",
      vmenuTableDesc: "自定义行列（默认 3×3 带表头）",
      vmenuMermaid: "流程图",
      vmenuMermaidDesc: "Mermaid 文本绘图（流程 / 时序 / 甘特等）",
      vmenuGAttach: "附件",
      vmenuImage: "图片",
      vmenuImageDesc: "本地图片（大图自动压缩）",
      vlinkSearch: "搜索页面…",
      vlinkEmpty: "未找到匹配页面（这里只列已有页面）",
      vtableRows: "行",
      vtableCols: "列",
      vtableHint: "首行固定为表头",
      vtableOk: "插入",
      vtableCancel: "取消",
      vtableRange: "行列需在 1–20 之间",
      vtblRowAbove: "上方插入行",
      vtblRowBelow: "下方插入行",
      vtblRowDel: "删除行",
      vtblColLeft: "左侧插入列",
      vtblColRight: "右侧插入列",
      vtblColDel: "删除列",
      vtblAlignL: "左对齐",
      vtblAlignC: "居中",
      vtblAlignR: "右对齐",
      vtblHeadCol: "切换表头列",
      vtblDelTable: "删除表格",
      vtbUndo: "撤销",
      vtbRedo: "重做",
      vtbBold: "加粗",
      vtbItalic: "斜体",
      vtbUnderline: "下划线",
      vtbStrike: "删除线",
      vtbSup: "上标",
      vtbSub: "下标",
      vtbCode: "行内代码",
      vtbColor: "文字颜色",
      vtbHighlight: "高亮颜色",
      vtbLink: "链接",
      vtbLinkPrompt: "链接地址：",
      vtbLinkEditPrompt: "输入新地址修改链接，留空并确定删除链接：",
      vtbClear: "清除格式",
      vtbClearColor: "清除",
    };
    const en = {
      kcfgGroupVault: "Vault",
      kcfgVaultRoot: "Vault root directory (absolute path)",
      kcfgVaultRootHint: "A plain md directory read as-is; blank restores the default root.",
      kcfgBuiltinPdf: "Built-in PDF reader",
      kcfgBuiltinPdfHint: "In-vault PDFs open as knowledge-base tabs (page jump, remembers where you stopped, no official preview size cap). Off: everything goes to the official file preview.",
      scVault: "Vault · Schedule",
      scVaultOff: "Vault is switched off in the config page",
      schedTab: "Schedule",
      schedToday: "Today",
      schedNoDue: "No due date",
      schedTasks: "Tasks",
      schedTaskDue: "Due",
      schedOverdue: "Overdue",
      schedTasksEmpty: "No tasks",
      schedScope3d: "3 days",
      schedScopeWeek: "Week",
      schedScopeAll: "All",
      schedStatsEvents: "Events",
      schedStatsDone: "Past",
      schedStatsOpen: "Upcoming",
      schedStatsTitle: "This week",
      schedLoadFail: "Schedule refresh failed (showing the last fetched data)",
      schedTimerStandalone: "Standalone timer (no task)",
      schedNew: "New",
      schedEdit: "Edit",
      schedDelete: "Delete",
      schedSave: "Save",
      schedSaved: "Saved",
      schedDeleted: "Deleted",
      schedOpFail: "Action failed: {error}",
      schedConfirmDelete: "Delete “{name}”?",
      schedConfirm: "Confirm",
      schedSeriesHint: "Recurring event: changes here apply to the whole series",
      schedKindTodo: "Task",
      schedKindEvent: "Event",
      schedStart: "Start",
      schedEnd: "End",
      schedRepeat: "Repeat",
      schedRepeatNone: "Never",
      schedRepeatDaily: "Daily",
      schedRepeatWeekly: "Weekly",
      schedRepeatMonthly: "Monthly",
      schedRepeatEvery: "Every",
      schedRepeatEnd: "Ends on",
      schedLocation: "Location",
      schedDescription: "Notes",
      schedTitleHint: "Up to 16 characters",
      schedTitle: "Title",
      schedTitleRequired: "Title is required",
      schedType: "Type",
      schedEndAfterStart: "An event needs a start and an end, and the end must be after the start",
      schedDone: "Done",
      schedEntryTitle: "Time entry",
      schedEntryNote: "What this segment is for",
      schedTimerStart: "Start timer",
      schedTimerStop: "Stop",
      schedTimerRunning: "Timing",
      schedTimerPick: "Attach a task, or run a standalone timer",
      schedTimerNoTodos: "No unfinished tasks",
      schedTimerSoloPh: "What are you working on",
      schedTimerSoloBtn: "Standalone timer",
      schedTimerAttachBtn: "Attach this task",
      schedTimerBallTip: "Elapsed time and stop live on the floating timer",
      schedWeekdays: "Mo,Tu,We,Th,Fr,Sa,Su",
      vaultTitle: "Knowledge base",
      vaultEntryTitle: "Knowledge base · Schedule",
      vaultNotConfigured: "Knowledge base directory not configured",
      vaultNotConfiguredHint: "Set the knowledge base directory in Settings → Plugins → dsh-kit: every md file inside becomes a page, with wiki-links and full-text search",
      vaultIndexFail: "Index failed: {error}",
      vaultSearchPh: "Search notes / library",
      vaultSearchEmpty: "No results",
      vaultSearchFail: "Search failed: {error}",
      vaultHitNote: "Note",
      vaultLibrary: "Library",
      vaultParentRoot: "root",
      vaultBackRoot: "Back to knowledge base",
      vaultNew: "New",
      vaultNewPh: "Name; \\ prefix makes a folder, / for nested",
      vaultExists: "Already exists — nothing changed",
      vaultLinks: " (rewrote {n} page links)",
      vaultMoveTo: "Move to…",
      vaultMoveTitle: "Move “{name}”",
      vaultMoveLabel: "Move to",
      vaultMoveSkipped: "Same name exists in the target — skipped",
      vaultImportMd: "Import markdown…",
      vaultImportFiles: "Import files…",
      vaultImportTitle: "Import",
      vaultImportTo: "Into: {dest}",
      vaultImportPick: "Choose files…",
      vaultImportPathPh: "or paste an absolute path on this machine",
      vaultImportName: "Name",
      vaultImportNeedSrc: "Choose files or paste an absolute path first",
      vaultLibAutoName: "Same name → auto-numbered, never overwritten",
      vaultImportImgs: " ({n} images copied to attachments)",
      vaultConflict: "A same-named item already exists in the target:",
      vaultConflictSkip: "Skip (do nothing)",
      vaultConflictOverwrite: "Overwrite (old one to the Recycle Bin)",
      vaultConflictRename: "Auto-number",
      vaultConfirmDeleteDir: "Delete folder “{name}” and its {n} items?",
      vaultRecycleHint: "moved to the Recycle Bin",
      vaultRefresh: "Refresh index and tree",
      vaultRefreshed: "Refreshed",
      vaultBinaryHint: "Binary file — not rendered in the vault",
      vaultTooLargeHint: "Larger than 1 MB — editing here is disabled to avoid truncating the file (use an external editor)",
      vaultCopy: "Copy",
      vaultCopied: "Copied",
      vaultBacklinks: "Backlinks",
      vaultToc: "Outline",
      vaultTocEmpty: "No headings in this page",
      vaultBlEmpty: "No pages link here",
      vaultLibsFail: "Failed to load renderer components",
      vaultPickPage: "Pick a page on the left to start",
      pdfOpening: "Opening PDF…",
      pdfFailed: "PDF failed to open",
      pdfMissing: "File is gone or was moved",
      pdfTooLarge: "File is too large to open in the reader",
      pdfPage: "Page number",
      vaultPageGone: "Page not found (it may have been moved or deleted)",
      vaultCiteUnavailable: "Composer is not ready (no active session)",
      vaultIdxTruncated: "Too many notes: the index hit the per-scan cap (5000 pages); search and backlinks cover indexed pages only",
      vaultLibTruncated: "The library list hit its cap (2000 entries); library search covers listed files only",
      vaultSaved: "Saved",
      vaultUnsaved: "Unsaved changes",
      vaultSaveFail: "Save failed: {error}",
      vaultSaveConflict: "The page changed on disk; autosave is paused",
      vaultSaveConflictOverwrite: "Overwrite disk with mine",
      vaultSaveConflictReload: "Load the disk version (drop mine)",
      vaultAttachFail: "Failed to store the image",
      rtePlaceholder: "Type '/' for commands",
      vmenuGHead: "Headings & text",
      vmenuH1: "Heading 1",
      vmenuH1Desc: "Level 1 heading",
      vmenuH2: "Heading 2",
      vmenuH2Desc: "Level 2 heading",
      vmenuH3: "Heading 3",
      vmenuH3Desc: "Level 3 heading",
      vmenuH4: "Heading 4",
      vmenuH4Desc: "Level 4 heading",
      vmenuBody: "Body text",
      vmenuBodyDesc: "Plain text paragraph",
      vmenuGSpecial: "Special blocks",
      vmenuHr: "Divider",
      vmenuHrDesc: "Horizontal rule",
      vmenuFold: "Fold block",
      vmenuFoldDesc: "Collapsible content area",
      vmenuGList: "Lists",
      vmenuUl: "Bullet list",
      vmenuUlDesc: "Dotted list",
      vmenuOl: "Ordered list",
      vmenuOlDesc: "Numbered list",
      vmenuTodo: "Task list",
      vmenuTodoDesc: "Checklist items",
      vmenuGMath: "Math & code",
      vmenuMathInline: "Inline math",
      vmenuMathInlineDesc: "Inline math formula",
      vmenuMathBlock: "Math block",
      vmenuMathBlockDesc: "Standalone formula area",
      vmenuCode: "Code block",
      vmenuCodeDesc: "Code area with syntax highlighting",
      vmenuQuote: "Quote",
      vmenuQuoteDesc: "Blockquote",
      vmenuWiki: "Wiki link",
      vmenuWikiDesc: "Link to another page [[page]]",
      vmenuGChart: "Charts",
      vmenuTable: "Table",
      vmenuTableDesc: "Custom rows and columns (3×3 with header by default)",
      vmenuMermaid: "Diagram",
      vmenuMermaidDesc: "Mermaid text diagrams (flow / sequence / gantt…)",
      vmenuGAttach: "Attachment",
      vmenuImage: "Image",
      vmenuImageDesc: "Local image (large ones compressed)",
      vlinkSearch: "Search pages…",
      vlinkEmpty: "No matching page (only existing pages are listed)",
      vtableRows: "Rows",
      vtableCols: "Columns",
      vtableHint: "The first row is always the header",
      vtableOk: "Insert",
      vtableCancel: "Cancel",
      vtableRange: "Rows and columns must be between 1 and 20",
      vtblRowAbove: "Insert row above",
      vtblRowBelow: "Insert row below",
      vtblRowDel: "Delete row",
      vtblColLeft: "Insert column left",
      vtblColRight: "Insert column right",
      vtblColDel: "Delete column",
      vtblAlignL: "Align left",
      vtblAlignC: "Align center",
      vtblAlignR: "Align right",
      vtblHeadCol: "Toggle header column",
      vtblDelTable: "Delete table",
      vtbUndo: "Undo",
      vtbRedo: "Redo",
      vtbBold: "Bold",
      vtbItalic: "Italic",
      vtbUnderline: "Underline",
      vtbStrike: "Strikethrough",
      vtbSup: "Superscript",
      vtbSub: "Subscript",
      vtbCode: "Inline code",
      vtbColor: "Text color",
      vtbHighlight: "Highlight color",
      vtbLink: "Link",
      vtbLinkPrompt: "Link URL:",
      vtbLinkEditPrompt: "Enter a new URL to edit the link; leave empty and confirm to remove it:",
      vtbClear: "Clear formatting",
      vtbClearColor: "Clear",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? rootT(key);

    /** 打开知识库页并确保「知识库」dock 签在眼前（目录/搜索/反链/wikilink/
     *  对话路径统一走 VaultRootView 的 openPath）。anchor = `[[页#锚]]` 的锚点，
     *  跨页跳转时随开页带给 VaultPagePane 消费（见 vaultPendingAnchor） */
    /** 开一张知识库页签。newPane = 对照阅读（双链 / 反链 / 页内链接）：交给宿主的
     *  preferNewPane——目标页已在别处开着就跳过去、没开着就分割出另一格；树行与
     *  搜索单击不走这里传 true，仍在本栏开。 */
    function openVaultPageAndDock(path, anchor, newPane) {
      if (!rightbarSeat.available) return;
      // 先记锚再开签：开签可能同步挂载 pane，晚了就被它先消费掉
      vaultPendingAnchor = typeof anchor === "string" && anchor !== "" ? { path, anchor } : null;
      openRightbarItem("vault", path, undefined, newPane === true ? { preferNewPane: true } : undefined);
    }
    /** 点击路径落知识库标签（树行/对话拦截器共用）：先落地再派发——知识库未
     *  挂载时 VaultRootView 不在，挂载后经 vaultOpenRequest 消费请求 */
    function openVaultPathFromClick(path) {
      openVaultPageAndDock(path);
      vaultOpenRequest = path;
      window.dispatchEvent(new CustomEvent("dshk-vault-open"));
    }

    function openVaultEntry() {
      expandSidebarNow();
      return sidebarViewPatch("vault");
    }
    /** 知识库 · 日程 的唯一入口（宿主快捷键那条命令；左栏 tab 条也归它）：
     *  开 = 侧栏占住那一格（默认落在知识库 tab）；再点 = 回官方会话列表。
     *  那一格开着时点日程 tab 只是把面板换成待办清单并把右栏网格签带到眼前，
     *  不重跑本函数——整格的开合只有这一处入口。 */
    function toggleVaultEntry(ui) {
      if (ui.vaultSideOpen === true) return sidebarViewPatch(null);
      return openVaultEntry();
    }

    // ── portal 宿主登记（侧栏索引 → 右栏签）──
    // 知识库拆两半后 VaultRootView 单实例挂在 KitSurfaces，左树/工具条经
    // createPortal 投进侧栏；页编辑器由页签正文自己渲染（不再投右栏）。
    function makeHostSlot() {
      let el = null;
      const subs = new Set();
      return {
        get: () => el,
        set(next) {
          el = next;
          for (const s of subs) s();
        },
        subscribe(s) {
          subs.add(s);
          return () => subs.delete(s);
        },
      };
    }
    const vaultSideSlot = makeHostSlot();
    const useHostSlot = (slot) => react.useSyncExternalStore(slot.subscribe, slot.get);

    // ── 读页上下文（索引侧发布 → 页签侧消费）──
    // 页签正文渲染 VaultPagePane 需要库根 / 索引页表 / 开页入口 / 刷新 / toast，
    // 这些都住在常驻的索引视图里。发布走最小 store：索引侧**提交后** publish，
    // 页签侧订阅（索引刷新才会带着新对象过来）。
    const vaultReader = { root: null, earlyBody: null, indexPages: null, openPath: null, refreshIndex: null, setToast: null };
    let vaultReaderVersion = 0;
    const vaultReaderSubs = new Set();
    function publishVaultReader(patch) {
      Object.assign(vaultReader, patch);
      vaultReaderVersion += 1;
      for (const fn of vaultReaderSubs) fn();
    }
    /** 索引未就绪时的共享空页表：每次渲染现造 `[]` 会让页签侧的 useMemo 依赖恒变 */
    const VAULT_EMPTY_PAGES = [];
    /** 同上，目录表那一份（树行的展开钮判据每次渲染都读它） */
    const VAULT_EMPTY_DIRS = [];
    function useVaultReader() {
      react.useSyncExternalStore(
        (cb) => {
          vaultReaderSubs.add(cb);
          return () => vaultReaderSubs.delete(cb);
        },
        () => vaultReaderVersion,
      );
      return vaultReader;
    }
    // ─────────── 对话文件点击的知识库路由 ───────────
    // 官方对话中的文件点击（chips / markdown 内联代码 / 工具行 / 交付卡）原生
    // 走 sidebarRight.openResource 开右栏文件签，kit 不拦。唯一例外是 vault 内
    // 路径：改道知识库标签的只读阅读视图（互通是知识库本体能力，无开关）。
    let chatPreviewHook = null;

    // 官方 shortcuts 服务的 resolve 回调入口：注册发生在 apply（拿不到会话与
    // cwd），动作由 KitSurfaces 每次渲染刷新（闭包带最新 sessionId/cwd）。
    // 为空 = 浮层还没挂载，命令按 pass 放行不吞键。终端组件的同名入口在它自己包里。
    const shortcutRun = { vault: null };

    // ── M4 会话→笔记：vault 路径点击直达知识库标签 ──
    // vault root 的客户端缓存：拦截器/文件树路由判定用（vault 内路径开知识库标签
    // 的只读阅读视图，其余路径放行官方文件签——互通是知识库本体能力，无开关）。
    // VaultRootView 每次拉索引同步刷新；从未开过知识库时点击现取一次（索引端
    // 点宿主侧有 mtime 缓存），失败按无 vault 处理走原行为。vaultOpenRequest：
    // 坞收起时 VaultRootView 未挂载、open 事件没人听——请求先落地，挂载后消费。
    // vaultPendingAnchor：[[页#锚]] 跨页跳转的待落锚（openVaultPageAndDock 记、
    // 目标页 VaultPagePane 消费；同页锚点不经它，直接就地滚动）。
    let vaultRootHint = null;
    let vaultRootHintFetching = null;
    let vaultOpenRequest = null;
    let vaultPendingAnchor = null;
    function ensureVaultRootHint() {
      if (vaultRootHint !== null) return Promise.resolve(vaultRootHint);
      if (vaultRootHintFetching === null) {
        vaultRootHintFetching = kitJson("/dsh-kit/vault/index")
          .then((body) => {
            vaultRootHint = body && typeof body.root === "string" && body.root !== "" ? body.root : null;
            return vaultRootHint;
          })
          .catch(() => null)
          .finally(() => {
            vaultRootHintFetching = null;
          });
      }
      return vaultRootHintFetching;
    }

    /** title 是否为可接管路径：盘符/UNC/根斜杠绝对路径，或含分隔符的相对路径 */
    function isChatOpenPathish(title) {
      return (
        /^[A-Za-z]:[\\/]/.test(title) ||
        title.startsWith("\\\\") ||
        title.startsWith("/") ||
        (/[\\/]/.test(title) && !/\s/.test(title))
      );
    }

    /** 对话文件路径解析：绝对直接用；相对按 cwd 拼接（与官方 resolveWorkspacePath
     *  同语义）；反斜杠归一避免混用分隔符触发宿主校验问题。 */
    function resolveChatOpenPath(cwd, title) {
      // POSIX 写法的盘符绝对路径（/D:/… 或 \D:\…）先归一为盘符开头：这类路径
      // 官方 resolveWorkspacePath 同样按绝对处理，直接拼 cwd 会产出 D:\D:\…
      // 双盘符假路径（agent 回复里惯用 /D:/… 引用 Windows 绝对文件）。
      let t = title;
      if (/^\/[A-Za-z]:/.test(t)) t = t.slice(1);
      else if (/^\\[A-Za-z]:/.test(t)) t = t.slice(1);
      const raw =
        /^[A-Za-z]:[\\/]/.test(t) || t.startsWith("\\\\")
          ? t
          : t.startsWith("/")
            ? `${cwd}\\${t.slice(1)}`
            : `${cwd}\\${t}`;
      const parts = raw.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
      const out = [];
      for (const s of parts) {
        if (s === "..") out.pop();
        else out.push(s);
      }
      // out 已含盘符元素（D:）或 UNC 的首段；盘符形不能再补 `D:\` 前缀，
      // 否则产出 D:\D:\… 双盘符（绝对盘符 title 曾因此读不到文件）
      if (raw.startsWith("\\\\")) return `\\\\${out.join("\\")}`;
      return out.join("\\");
    }

    /** document capture：对话区文件点击的知识库路由（M4 会话→笔记）。三种载体
     *  的路径解析：① markdown 内联代码与「本轮文件改动」chips → button[title=路径]；
     *  ② read/write/edit 工具行（ui-tool ToolRow）→ button[class*="_fileLink"]，
     *     无 title，按钮文本即工具 path/file_path 参数按 cwd 相对化的路径；
     *  ③ 交付卡（dsh-client-ui-deliverables 的 PresentedFileCard）→ 路径在覆盖
     *     整卡的 .cardPreview 的 title 上。
     *  vault 内路径 preventDefault 改道知识库标签（只读阅读视图）；其余一律
     *  放行官方——官方原生 openResource 开右栏文件签（工作区文件面不做）。 */
    function onChatOpenFileClick(ev) {
      if (!ev.isTrusted) return;
      const hook = chatPreviewHook;
      if (!hook || !hook.vaultOn) return;
      if (!(ev.target instanceof Element)) return;
      // 弹层控件（aria-haspopup）不是文件链接，放行官方：模型选择器触发钮的
      // title=模型名（如 opencode-go/omen-alpha，含分隔符无空格）会被路径判定
      // 误吞，而 composer 就在对话 scrollBody 内部，位置判定挡不住它；交付卡的
      // 下拉键同理——那是宿主菜单，菜单项由网关注入脚本按项文本锁
      if (ev.target.closest("[aria-haspopup]")) return;
      const btn =
        ev.target.closest("button[title]") || ev.target.closest('button[class*="_fileLink"]');
      const card = ev.target.closest("[data-presented-file]");
      const anchor = btn !== null ? btn : card !== null ? card.querySelector("button[title]") : null;
      if (anchor === null) return;
      // 插件自身面板/入口的元素不拦（title 可能是路径的只有文件树行等）。
      // 但命中元素必须是真插件容器：面板打开时 body 挂的让位标记类
      // （dshk-pane-open/dshk-open）是全体对话的祖先，若不剔除，面板
      // 一开拦截就整体失效
      const kitAnc = anchor.closest('[class*="dshk-"]');
      if (kitAnc && kitAnc !== document.body && kitAnc !== document.documentElement) return;
      // 仅官方对话滚动区内的文件按钮（markdown 提及、产物 chips、工具行、交付卡
      // 都在其中）
      if (!anchor.closest('[class*="_scroll"]')) return;
      let path = (anchor.getAttribute("title") || "").trim();
      if (path === "" && btn !== null) {
        // ② 工具行 fileLink：文本必为路径（参数解析不出路径时官方渲染 span）；
        // 家目录缩写形态（~/…）客户端还原不了宿主 home，放行官方
        path = (btn.textContent || "").trim();
        if (path === "" || path.startsWith("~")) return;
      } else if (!isChatOpenPathish(path)) {
        return;
      }
      // 无会话工作区时：仅盘符绝对/UNC（含 /D:… 归一的盘符形态）可脱离 cwd 判定；
      // 相对路径解析无依，放行官方
      if (!hook.cwd) {
        const t2 = path.startsWith("\\\\") ? path : path.replace(/^[\\/](?=[A-Za-z]:)/, "");
        if (!/^[A-Za-z]:[\\/]/.test(t2) && !t2.startsWith("\\\\")) return;
      }
      const resolved = resolveChatOpenPath(hook.cwd, path);
      // root 已缓存：命中 vault 即改道（preventDefault），不命中放行官方
      if (vaultRootHint !== null) {
        if (isPathInsideVaultRoot(vaultRootHint, resolved)) {
          ev.preventDefault();
          ev.stopPropagation();
          openVaultPathFromClick(resolved);
        }
        return;
      }
      // root 未缓存（插件刚挂载的头几秒）：官方动作同步触发、无法事后撤回，不能
      // 先吞点击——放行官方，异步补判一次，命中 vault 再开知识库标签（此时官方
      // 文件签也会开着，多一个签可接受；root 几乎总在首次点击前就预取好了）
      void ensureVaultRootHint().then((r) => {
        if (r !== null && isPathInsideVaultRoot(r, resolved)) openVaultPathFromClick(resolved);
      });
    }

    /** 路径 → 分段（分隔符归一 + 解 ..）：同盘比较与取相对路径共用一处口径 */
    function pathSegs(p) {
      const out = [];
      for (const s of String(p).split(/[\\/]+/)) {
        if (s === "" || s === ".") continue;
        if (s === "..") out.pop();
        else out.push(s);
      }
      return out;
    }

    /** 相对引用解析成绝对路径：base 的分段 + 引用的分段（同样解 ..），按 base 的
     *  分隔符拼回。**先解 .. 再判界**——引用里的 ../../.. 必须在拼 URL 之前消掉，
     *  否则库内容（导入件 / 外部同步 / agent 写的 md）能用它拼出读库外文件的地址。 */
    function absJoinUnder(baseAbs, rel) {
      const base = String(baseAbs);
      const sep = base.includes("\\") ? "\\" : "/";
      const unixRoot = base.startsWith("/") && !/^[A-Za-z]:/.test(base) ? "/" : "";
      return unixRoot + [...pathSegs(base), ...pathSegs(rel)].join(sep);
    }

    /** base 内的相对路径（`/` 分隔、无前导分隔符；base 本身回 ""）：不在 base 内回 null。
     *  Windows 形根（盘符/UNC）只有**比较**大小写不敏感，返回段保留原样大小写——
     *  调用方拿它跟索引里的 rel（保留原样）做前缀比较，折了大小写就永远对不上。 */
    function relUnder(base, p) {
      if (typeof base !== "string" || typeof p !== "string" || base === "" || p === "") return null;
      const win = /^[A-Za-z]:[\\/]/.test(base) || base.startsWith("\\\\");
      const fold = (arr) => (win ? arr.map((s) => s.toLowerCase()) : arr);
      const r = fold(pathSegs(base));
      const segs = pathSegs(p);
      const t = fold(segs);
      if (t.length < r.length) return null;
      if (!r.every((seg, i) => t[i] === seg)) return null;
      return segs.slice(r.length).join("/");
    }

    /** M4 路由判据：path 是否落在 vault root 内（根本身不算内） */
    function isPathInsideVaultRoot(root, path) {
      const rel = relUnder(root, path);
      return rel !== null && rel !== "";
    }

    /** root 下 rel（`/` 分隔的相对路径）的绝对路径：按 **root 的分隔符**拼（宿主
     *  发来的 folders/library 路径是反斜杠，拼成正斜杠会让树缓存键、展开态、
     *  树上定位整条链对不上——那些键全是宿主路径）；只用于比对与请求参数 */
    function joinRelPath(root, rel) {
      const base = String(root).replace(/[\\/]+$/, "");
      return rel === "" ? base : absJoinUnder(base, rel);
    }

    /** 侧栏搜索的命中集合：宿主全文搜索给笔记页，笔记目录 / 资料库
     *  文件 / 资料库目录只按名字匹配（PDF 没有正文索引），四类合成一张表。一把尺子：
     *  路径命中 +8、末段名命中 +5，多词 AND；同分则按类型（能直接打开的在前）与名字排。
     *  命中行 = {kind, path, rel, label, sub, score}——kind 决定点击动作（页开阅读面、
     *  文件开官方文件右栏、目录换树根）。 */
    function vaultSearchHits(query, root, pages, folders, libItems) {
      const terms = String(query ?? "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((s) => s !== "");
      if (terms.length === 0) return [];
      const nameOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
      const parentOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
      /** 名字打分：路径 +8、末段 +5；有词一个都没中回 null */
      const scoreName = (rel) => {
        const lower = String(rel).toLowerCase();
        const name = nameOf(lower);
        let score = 0;
        for (const term of terms) {
          const inRel = lower.includes(term);
          const inName = name.includes(term);
          if (!inRel && !inName) return null;
          if (inRel) score += 8;
          if (inName) score += 5;
        }
        return score;
      };
      const parentLabel = (rel) => parentOf(rel) || t("vaultParentRoot");
      const rank = { page: 0, libfile: 1, dir: 2, libdir: 3 };
      const hits = [];
      for (const p of pages ?? []) {
        hits.push({ kind: "page", path: p.path, rel: p.rel, label: pageBasename(p.rel), sub: p.snippet ?? "", score: p.score ?? 0 });
      }
      for (const rel of folders ?? []) {
        const score = scoreName(rel);
        if (score !== null) {
          hits.push({ kind: "dir", path: joinRelPath(root, rel), rel, label: nameOf(rel), sub: `${t("vaultHitNote")} · ${parentLabel(rel)}`, score });
        }
      }
      for (const it of libItems ?? []) {
        const score = scoreName(it.rel);
        if (score === null) continue;
        hits.push({ kind: it.dir ? "libdir" : "libfile", path: it.path, rel: it.rel, label: nameOf(it.rel), sub: `${t("vaultLibrary")} · ${parentLabel(it.rel)}`, score });
      }
      hits.sort((a, b) => b.score - a.score || rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label, "zh"));
      return hits.slice(0, 20);
    }

    /** 知识库面板的文件管理请求：POST 端点 + sameOrigin 校验在宿主侧；错误串直接进 toast。
     *  成功形状统一 {ok:true, ...}，跳过（撞名不覆盖）由 skipped 字段回执。 */
    function vaultOp(path, payload) {
      return kitPostJson(path, payload, (b) => b.ok === true);
    }

    /** 浏览器上传：File → base64（去 data URL 前缀）——宿主拿不到本机绝对路径，
     *  这条是"选择文件"那条来源的过河桥 */
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result ?? "");
          resolve(text.slice(text.indexOf(",") + 1));
        };
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
    }

    /** 绝对路径的父目录（两种分隔符都认；无分隔符时回落原值）——移动对话框的默认落点 */
    function absParent(p) {
      const s = String(p ?? "");
      const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
      return i > 0 ? s.slice(0, i) : s;
    }

    /** 路径是否等于某前缀或落在其下（改名/移动/删除后同步树与页签用；两种分隔符都认） */
    function pathUnder(p, prefix) {
      return p === prefix || p.startsWith(`${prefix}\\`) || p.startsWith(`${prefix}/`);
    }

    /** 路径等值（分隔符无关）：树行 title、目标地址、缓存键可能各用一种分隔符，
     *  直接字符串比永远对不上——按分段比才是同一口径 */
    function samePath(a, b) {
      const x = pathSegs(String(a ?? ""));
      const y = pathSegs(String(b ?? ""));
      return x.length === y.length && x.every((s, i) => s === y[i]);
    }

    /** 改名/移动后把开着的那几张知识库签一起搬（等路径或整棵前缀）：旧地址收掉、
     *  新地址开一张——签的地址即页路径，搬页就是换地址 */
    function vaultTabsRetarget(oldPath, newPath, isDir) {
      for (const p of rightbarItems("vault")) {
        // 精确命中要给新路径本身（写成 p === oldPath || … 会把布尔 true 当新地址，
        // openRightbarItem 拿到非字符串直接空转——签被关掉却不再开）
        const moved = p === oldPath ? newPath : isDir && pathUnder(p, oldPath) ? newPath + p.slice(oldPath.length) : null;
        if (moved === null) continue;
        closeRightbarItem("vault", p);
        if (!rightbarItems("vault").includes(moved)) openRightbarItem("vault", moved);
      }
    }

    /** 删除后关掉落在删除集里的知识库签（含整棵子路径） */
    function vaultTabsClose(prefixes) {
      for (const p of rightbarItems("vault")) {
        if (prefixes.some((pre) => pathUnder(p, pre))) closeRightbarItem("vault", p);
      }
    }

    /** 移动/删除候选目标：库内目录（含根）。notes = 笔记侧（索引 folders + 库根），
     *  否则资料库侧（库内清单目录 + 库根）。每项 {path: 绝对路径, label: 显示名}。 */
    function vaultDirChoices(kind, root, folders, libRoot, libItems) {
      const out = [];
      if (kind === "lib") {
        if (libRoot !== null) out.push({ path: libRoot, label: t("vaultLibrary") });
        for (const it of libItems ?? []) {
          if (it.dir) out.push({ path: it.path, label: it.rel.split("/").join(" / ") });
        }
        return out;
      }
      if (root !== null) out.push({ path: root, label: t("vaultTitle") });
      for (const rel of folders ?? []) out.push({ path: joinRelPath(root, rel), label: rel.split("/").join(" / ") });
      return out;
    }

    /** 页内选区镜像（模块级、只由**当前激活**的页编辑器写）：左侧树的 @ 按钮在
     *  mousedown 时 preventDefault 保住选区，但点击本身仍会塌掉原生选区——所以引用
     *  时读这份镜像。多个页签同时挂载时只有激活那个能写，避免后台页清掉它。 */
    let vaultSelMirror = "";

    /** M4 笔记→会话：「引用到对话」的选区文本转引用块续在草稿后（首尾空行剥
     *  掉）。页面路径本体由 @ 引用芯片承载（与文件树
     *  「@到对话」同一条路径，此函数只管引用块文本）。render-check 直调。 */
    function vaultCiteText(draft, selText) {
      const base = typeof draft === "string" ? draft : "";
      const lines = typeof selText === "string" ? selText.replace(/\r\n?/g, "\n").split("\n") : [];
      while (lines.length > 0 && lines[0].trim() === "") lines.shift();
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      const quote = lines.length > 0 ? lines.map((l) => `> ${l}`).join("\n") + "\n\n" : "";
      const joiner = base !== "" && !base.endsWith("\n") ? "\n" : "";
      return base + joiner + quote;
    }

    /** 一页 @ 进对话输入框（左侧树行按钮的唯一实现）：以官方 @ 引用芯片直插
     *  （与文件树同一条路径），selText 非空时先落引用块。**成功不提示**——
     *  插进去的引用就摆在输入框里，再弹一条是噪音；只有失败原因经 notify 回报
     *  （组件各自有自己的 toast 通道）。 */
    function citeVaultPageToChat(pagePath, selText, notify) {
      const shell = currentComposerShell();
      if (!shell || typeof shell.actions?.setDraft !== "function") {
        notify("vaultCiteUnavailable");
        return;
      }
      const mention = chatMentionText(pagePath.replace(/\\/g, "/"));
      if (mention === null) {
        notify("vaultCiteUnavailable");
        return;
      }
      if (typeof selText === "string" && selText !== "") {
        const pre = typeof shell.state?.getSnapshot === "function" ? shell.state.getSnapshot() : null;
        const draft = pre && typeof pre.draft === "string" ? pre.draft : "";
        try {
          shell.actions.setDraft(vaultCiteText(draft, selText));
        } catch {
          notify("vaultCiteUnavailable");
          return;
        }
      }
      const chipRef = { source: "reference", ref: mention, label: pageBasename(pagePath) || pagePath, appearance: "file", clipboardText: mention };
      if (typeof shell.insertReference === "function") {
        const phase = shell.core && shell.core.state ? shell.core.state.phase : null;
        const detectText = typeof shell.projection?.detectText === "string" ? shell.projection.detectText : "";
        const rev = typeof shell.rev === "number" ? shell.rev : -1;
        if ((phase === "plain" || phase === "claimed") && rev >= 0) {
          const span = { start: detectText.length, end: detectText.length, draftRev: rev };
          let applied = false;
          try {
            applied = shell.insertReference(chipRef, span) === true;
          } catch {
            applied = false;
          }
          if (applied) return;
        }
      }
      // 兜底：@ 语法文本追加草稿末尾（与手打 @ 一致，此时面板可见属官方行为）
      const state = typeof shell.state?.getSnapshot === "function" ? shell.state.getSnapshot() : null;
      const draft = state && typeof state.draft === "string" ? state.draft : "";
      shell.actions.setDraft(draft === "" ? mention : `${draft} ${mention}`);
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
    /** KaTeX 公式按需加载（RTE 阅读与编辑都要）：js + css 一起上，重复调用只下一次 */
    function ensureKatex() {
      const jobs = [];
      if (typeof window.katex === "undefined") jobs.push(loadScript("/dsh-kit/vendor/katex.min.js"));
      if (!document.querySelector('link[data-dshk-katex]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/dsh-kit/vendor/katex.min.css";
        link.setAttribute("data-dshk-katex", "1");
        document.head.appendChild(link);
      }
      return Promise.all(jobs);
    }
    function ensureRteLib() {
      // mermaid 渲染器：vendor 的流程图节点只认 window.mermaid，没有就退化成代码块；
      // 宿主与 app.asar 都不带这个库，本插件自带一份，编辑器第一次碰到流程图才下
      if (typeof window.__dshkMermaidLoad !== "function") {
        window.__dshkMermaidLoad = () =>
          loadScript("/dsh-kit/vendor/mermaid.min.js").then(() => {
            window.DshRTE && typeof window.DshRTE.mermaidReady === "function" && window.DshRTE.mermaidReady();
          });
      }
      return typeof window.DshRTE === "object" && window.DshRTE !== null
        ? Promise.resolve()
        : loadScript("/dsh-kit/vendor/richeditor.bundle.js");
    }

    /** 日程图标：日历（圆角框 + 两枚吊耳 + 头部分隔线），与终端/任务描边体系一致 */
    function SchedIcon(props) {
      const _official = dswIcon("IconAlarmClockOutline16");
      if (_official) return jsxRuntime.jsx(_official, { className: props && props.className });
      return jsxRuntime.jsxs(
        "svg",
        {
          width: (props && props.size) ?? 15,
          height: (props && props.size) ?? 15,
          className: props && props.className,
          viewBox: "0 0 16 16",
          "aria-hidden": true,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsxRuntime.jsx("rect", { x: 2.8, y: 3.6, width: 10.4, height: 9.6, rx: 1.6 }),
            jsxRuntime.jsx("path", { d: "M5.4 2.2v2.6M10.6 2.2v2.6M2.8 7h10.4" }),
          ],
        },
      );
    }

    /** 知识库图标：书堆（三枚书脊，第三本微倾斜），与终端/任务描边体系一致 */
    function VaultIcon() {
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
            jsxRuntime.jsx("path", { d: "M3 2.6v10.8M6.6 2.6v10.8" }),
            jsxRuntime.jsx("rect", { x: 9.4, y: 2.6, width: 3.4, height: 10.8, rx: 0.9 }),
          ],
        },
      );
    }

    /** 知识库面板的对话框（移动到…/导入/删除确认共用）：fixed 遮罩 + 居中卡片。
     *  关闭手势长在自己身上（Esc / 点遮罩）——与菜单同一条约定：宿主各写一份必漏。
     *  内容与按钮归调用方，这里只管壳与关闭。 */
    /** wide：日程表单比「移动到 / 导入」那类小对话框宽一档 */
    function VaultDialog({ title, onClose, wide, children }) {
      react.useEffect(() => {
        // 让路座：Esc 归这个对话框（同 target 上 root 的捕获监听注册得更早，
        // 光 stopPropagation 拦不住它，会连带把右栏页签收了）
        holdEsc();
        const onKey = (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
          releaseEsc();
          window.removeEventListener("keydown", onKey, true);
        };
      }, [onClose]);
      return jsxRuntime.jsx("div", {
        className: "dshk-vault-modalwrap",
        onMouseDown: (e) => {
          if (e.target === e.currentTarget) onClose();
        },
        children: jsxRuntime.jsxs("div", {
          className: wide ? "dshk-vault-modal is-wide" : "dshk-vault-modal",
          children: [
            jsxRuntime.jsx("div", { className: "dshk-vault-modaltitle", children: title }),
            children,
          ],
        }),
      });
    }

    // ─────────── 知识库 md 链接解析（VaultPagePane / RteEditor 用）───────────
    /** 链接点击要不要交给我们：页内锚点与带协议/协议的 href 放行（RTE 的 Link
     *  扩展配了 openOnClick:false，点了本来也不跳），其余（相对路径 / 站内 / 裸
     *  路径）都算「文档内链接」候选，由调用方决定能不能解析成文件。 */
    function isDocHref(href) {
      const h = String(href ?? "").trim();
      if (h === "" || h.startsWith("#")) return false;
      return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(h);
    }
    /** 把 md 里的相对/站内链接解析为可打开的绝对路径；解析不出返回 null。
     *  fromPath 为当前文件绝对路径（正反斜杠皆可），cwd 为根（工作区或知识库根，
     *  合成 / 开头链接用）；href 的 query/hash 在这里剥掉，%xx 就地解码。 */
    function resolveMdLink(fromPath, cwd, href) {
      const raw = (() => {
      try {
        return decodeURIComponent(href.split(/[?#]/, 1)[0]);
      } catch {
        return href.split(/[?#]/, 1)[0];
      }
    })();
      if (raw === "") return null;
      const norm = (p) => {
        const parts = p.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
        const out = [];
        for (const s of parts) {
          if (s === "..") out.pop();
          else out.push(s);
        }
        return out.join("\\");
      };
      if (raw.startsWith("/")) {
        return cwd && cwd.trim() !== "" ? norm(`${cwd}\\${raw.slice(1)}`) : null;
      }
      const dir = fromPath.split(/[\\/]+/).slice(0, -1).join("\\");
      return norm(`${dir}\\${raw}`);
    }
    // ─────────── 阅读位置记忆（按文件绝对路径）───────────
    // 内容重载（刷新浏览器 / vault 重读 / 冲突回读）后落回用户原本看的大致
    // 位置。每条记录 = { scrollTop, anchor }：anchor 是光标字符偏移（内容变了
    // 也能落回附近），scrollTop 是精确视口位。运行时 Map + localStorage 持久化
    // （刷新之后也要在，纯内存不够）。RTE 编辑路径在用。
    const readPosStore = (() => {
      let map = new Map();
      try {
        const raw = JSON.parse(localStorage.getItem("dshk-read-pos") ?? "{}");
        if (raw && typeof raw === "object") {
          for (const [k, v] of Object.entries(raw)) {
            if (v && typeof v === "object" && Number.isFinite(v.scrollTop) && Number.isFinite(v.anchor)) map.set(k, v);
          }
        }
      } catch {
        /* 坏数据当作没有 */
      }
      let flushTimer = null;
      const persist = () => {
        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          try { localStorage.setItem("dshk-read-pos", JSON.stringify(Object.fromEntries(map))); } catch { /* 存不下就只在内存 */ }
        }, 400);
      };
      return {
        get: (p) => map.get(p),
        set(p, scrollTop, anchor) {
          map.delete(p); // 重插=刷新访问序，容量超限时淘汰最旧
          map.set(p, { scrollTop: Math.max(0, Math.round(scrollTop)), anchor: Math.max(0, Math.round(anchor)) });
          while (map.size > 300) map.delete(map.keys().next().value);
          persist();
        },
      };
    })();
    /** 记录当前位置（调用方节流）。隐藏容器不记：display:none 的 scrollTop 恒 0，
     *  会把真位置冲掉（非激活标签仍挂载，切走时会有 resize/兜底路径摸到这里） */
    function recordReadPos(key, el, anchor) {
      if (!el || el.getClientRects().length === 0) return;
      readPosStore.set(key, el.scrollTop, typeof anchor === "number" && Number.isFinite(anchor) ? anchor : 0);
    }
    /** 恢复：优先锚点（选区落回），再设 scrollTop。恢复必须等内容渲染后——挂载
     *  即设会白设（maxScroll 未建立）。容器还隐藏着（非激活标签被后台重读）就
     *  定时重试到可见为止；期间用户自己滚过（偏离顶部）则放弃，不抢滚动权。
     *  用 setTimeout 不用 rAF：后台/被遮挡的窗口 rAF 会停发，定时器照走。
     *  返回取消函数：调用方卸载时必须撤——重试会一直打到容器可见为止，
     *  页签早关了还在重试，回调摸的是已销毁的编辑器 */
    function restoreReadPos(key, el, applyAnchor) {
      const rec = readPosStore.get(key);
      if (!rec || rec.scrollTop <= 0 || !el) return () => {};
      let tries = 0;
      let timer = null;
      const step = () => {
        tries += 1;
        if (!el.isConnected) return; // 宿主已卸载：不再重试
        if (el.getClientRects().length === 0) {
          if (tries < 300) timer = setTimeout(step, 60);
          return;
        }
        if (el.scrollTop > 2) return;
        try { applyAnchor?.(rec.anchor); } catch { /* 选区失效按纯滚动恢复 */ }
        el.scrollTop = rec.scrollTop;
      };
      timer = setTimeout(step, 60);
      return () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
    }


    // ─────────── 日程模块（左栏待办清单 + 右栏周时间网格 + 全局计时悬浮球）───────────
    // 数据走宿主 /dsh-kit/schedule/* 端点：raw 全量 events + 区间展开 occurrences
    // （重复展开与 state 派生都在宿主做，这里只渲染）+ orphans + 进行中的计时。
    // 块颜色只表达状态（浅底深字）：还没到橙 / 进行中绿 / 已过去蓝 / 逾期红——
    // 不按标题散列取色（color 字段不读）；已闭合计时段按已过去蓝展示。
    // 写路径：面板的建 / 改 / 删 / 完成 / 计时 / 计时段编辑都走 POST
    // /dsh-kit/schedule/op，落盘走统一契约（events/<id>.json、
    // entries/<id>.json、timer.json，一条一文件 + 原子写）。字段白名单与校验
    // 只在宿主做——面板再抄一份，两处就会长出两套规则。

    /** 写完广播：侧栏清单 / 右栏网格 / 悬浮球据此立刻重取，不等 30s 轮询那一拍。
     *  版本号单调递增，面板当依赖读（useSyncExternalStore） */
    const schedBus = (() => {
      let version = 0;
      const listeners = new Set();
      return {
        subscribe: (fn) => {
          listeners.add(fn);
          return () => { listeners.delete(fn); };
        },
        getVersion: () => version,
        bump: () => {
          version += 1;
          // 单个订阅者抛错不能带倒其它面板（各自 try 不到的地方在这儿兜住）
          for (const fn of [...listeners]) {
            try {
              fn();
            } catch {
              /* 忽略 */
            }
          }
        },
      };
    })();

    /** 走一次日程写端点；成功即广播。失败把宿主给的原因抛出去（面板据此提示） */
    async function schedOp(payload) {
      const body = await kitPostJson("/dsh-kit/schedule/op", payload, (b) => b !== null && typeof b === "object");
      schedBus.bump();
      return body;
    }

    /** "YYYY-MM-DDTHH:mm[:ss]"（本地朴素串）→ Date；不是这个形状就 null */
    const schedParseDT = (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s ?? ""));
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
      return Number.isNaN(d.getTime()) ? null : d;
    };

    /** 起表走到 now 的走秒：不足一小时 MM:SS，超过一小时 H:MM:SS */
    const schedElapsed = (start, now = Date.now()) => {
      const from = schedParseDT(start);
      if (!from) return "";
      const secs = Math.max(0, Math.floor((now - from.getTime()) / 1000));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      return h > 0 ? `${h}:${schedPad2(m)}:${schedPad2(secs % 60)}` : `${schedPad2(m)}:${schedPad2(secs % 60)}`;
    };

    /** 起表时刻的钟点 "HH:mm"（悬浮球与计时浮层用） */
    const schedClockOf = (dt) => {
      const d = schedParseDT(dt);
      return d ? `${schedPad2(d.getHours())}:${schedPad2(d.getMinutes())}` : "";
    };

    /** 新建日程的默认时段：下一个整点起一小时（太晚就落次日 9:00） */
    function schedDefaultSlot() {
      const now = new Date();
      let startMins = (now.getHours() + 1) * 60;
      let day = schedDateOf(now);
      if (startMins > 21 * 60) {
        startMins = 9 * 60;
        day = schedAddDays(day, 1);
      }
      return {
        startDate: day,
        startTime: schedHHmm(startMins),
        endDate: day,
        endTime: schedHHmm(startMins + 60),
      };
    }

    const SCHED_DAY_START = 0; // 网格 0:00–24:00（起止时刻零裁剪）
    const SCHED_DAY_END = 24 * 60;
    const SCHED_HOUR_PX = 42;
    // 全天带一列最多画几条 chip，多的折成 +N（带高随之封顶）
    const SCHED_ALLDAY_MAX = 3;
    // 宿主 occurrence.state → 状态色类（浅底深字）
    const SCHED_STATE_CLASS = { todo: "is-todo", doing: "is-doing", past: "is-past" };

    const schedPad2 = (n) => String(n).padStart(2, "0");
    const schedDateOf = (d) => `${d.getFullYear()}-${schedPad2(d.getMonth() + 1)}-${schedPad2(d.getDate())}`;
    const schedToday = () => schedDateOf(new Date());
    const schedAddDays = (s, n) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + n);
      return schedDateOf(dt);
    };
    const schedMondayOf = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return schedAddDays(s, -((dt.getDay() + 6) % 7));
    };
    const schedHHmm = (mins) => `${schedPad2(Math.floor(mins / 60) % 24)}:${schedPad2(mins % 60)}`;
    const schedDiffDays = (a, b) => {
      const [ay, am, ad] = a.split("-").map(Number);
      const [by, bm, bd] = b.split("-").map(Number);
      return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
    };
    const schedNowDT = () => {
      const d = new Date();
      return `${schedDateOf(d)}T${schedPad2(d.getHours())}:${schedPad2(d.getMinutes())}`;
    };
    // 待办逾期：纯日期到**当天结束前**都不算逾期（只比"今天"），带时刻比到分钟
    const schedIsOverdue = (ev) => {
      if (ev.start !== undefined || ev.completedAt || typeof ev.due !== "string") return false;
      if (ev.due.includes("T")) return ev.due.slice(0, 16) <= schedNowDT();
      return ev.due < schedToday();
    };
    /** 待办截止日（due 的日期部分；无 due = ""） */
    const schedDueDay = (ev) => (typeof ev.due === "string" ? ev.due.slice(0, 10) : "");
    /**
     * 跨天块按日切片（客户端渲染用）：宿主的 occurrence 只有一份（date 起始、
     * endDate 结束），网格每列需要自己的那一片——首日 start→24:00、中间整天、
     * 末日 0:00→end。切出的片带 sliceStart/sliceEnd（当日边界）与 orig* 三元组
     * （完整时段，供时刻文案/tooltip）；单日块原样一片。
     */
    const schedSliceByDay = (o) => {
      const endDay = o.endDate && o.endDate > o.date ? o.endDate : o.date;
      const span = Math.max(0, schedDiffDays(o.date, endDay));
      // orig* = 完整时段（时刻文案/tooltip 用）——下面会把 startMins/endMins
      // 覆盖成当日切片边界，原始值得先存住
      const orig = { origDate: o.date, origEndDate: endDay, origStartMins: o.startMins, origEndMins: o.endMins };
      if (span === 0) {
        const end = o.endMins ?? Math.min(o.startMins + 60, SCHED_DAY_END);
        return [{ ...o, sliceStart: o.startMins, sliceEnd: end, ...orig }];
      }
      const pieces = [];
      for (let i = 0; i <= span; i++) {
        pieces.push({
          ...o,
          date: schedAddDays(o.date, i),
          startMins: i === 0 ? o.startMins : 0,
          endMins: i === span ? o.endMins ?? SCHED_DAY_END : SCHED_DAY_END,
          sliceStart: i === 0 ? o.startMins : 0,
          sliceEnd: i === span ? o.endMins ?? SCHED_DAY_END : SCHED_DAY_END,
          ...orig,
        });
      }
      return pieces;
    };
    /** 实例时刻文案：同日 "10:00–11:40"、跨一天 "22:00–次日01:00"、
     *  跨多天 "22:00–09-21 02:00"；无 end 只给开始时刻 */
    const schedOccTimeLabel = (date, endDate, startMins, endMins) => {
      const start = schedHHmm(startMins);
      if (endMins === null || endMins === undefined) return start;
      const end = schedHHmm(endMins);
      const endDay = endDate && endDate > date ? endDate : date;
      if (endDay === date) return `${start}–${end}`;
      const nextDay = endDay === schedAddDays(date, 1);
      if (resolveZh()) return nextDay ? `${start}–次日${end}` : `${start}–${endDay.slice(5)} ${end}`;
      return nextDay ? `${start}–${end} +1d` : `${start}–${endDay.slice(5)} ${end}`;
    };
    /** 切片块上的时刻小字：起点日给整条、中间整天「延续中」、尾巴日「←止01:00」 */
    const schedPieceTimeLabel = (o) => {
      const fromBefore = o.origDate !== undefined && o.date > o.origDate;
      const toAfter = o.origEndDate !== undefined && o.date < o.origEndDate;
      if (fromBefore && toAfter) return resolveZh() ? "延续中" : "ongoing";
      if (fromBefore) {
        const end = schedHHmm(o.origEndMins ?? o.sliceEnd);
        return resolveZh() ? `←止${end}` : `←${end}`;
      }
      return schedOccTimeLabel(o.origDate ?? o.date, o.origEndDate, o.origStartMins ?? o.startMins, o.origEndMins);
    };
    /** 清单行尾时刻：今天只给时刻，别的日子给「日期 + 时刻」 */
    const schedOccRowLabel = (o, today) => {
      const label = schedOccTimeLabel(o.date, o.endDate, o.startMins, o.endMins);
      return o.date === today ? label : `${o.date.slice(5)} ${label}`;
    };
    const schedWeekdays = () => (resolveZh() ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    const schedFmtDur = (ms) => {
      if (ms < 60000) return resolveZh() ? `${Math.round(ms / 1000)}秒` : `${Math.round(ms / 1000)}s`;
      const mins = Math.round(ms / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? (resolveZh() ? `${h}小时${m}分` : `${h}h ${m}m`) : resolveZh() ? `${m}分钟` : `${m}m`;
    };


    // 并行事件分列（贪心：按开始时间排序，塞进第一条不重叠的泳道）
    const schedAssignLanes = (items) => {
      const sorted = [...items].sort((a, b) => a.startMins - b.startMins || (a.endMins ?? 0) - (b.endMins ?? 0));
      const laneEnds = [];
      const result = sorted.map((item) => {
        const end = item.endMins ?? item.startMins + 60;
        let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.startMins);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(end);
        } else {
          laneEnds[lane] = end;
        }
        return { ...item, lane, lanes: 1 };
      });
      for (const item of result) item.lanes = laneEnds.length;
      return result;
    };

    /** 重复规则 → 宿主形状：weekly 不选星期就按起始日的星期展开（这也是合法规则） */
    function schedRecurrenceOf(f) {
      const rec = { type: f.repeat, interval: Math.max(1, Math.floor(Number(f.interval) || 1)) };
      if (f.repeat === "weekly" && f.weekDays.length > 0) rec.days = [...f.weekDays].sort((a, b) => a - b);
      if (f.repeatEnd !== "") rec.end = f.repeatEnd;
      return rec;
    }

    /** 表单初值：新建给空壳（默认无期限待办），编辑从条目派生 */
    function schedFormFrom(ev) {
      const slot = ev ? null : schedDefaultSlot();
      const rec = ev && ev.recurrence && typeof ev.recurrence === "object" ? ev.recurrence : null;
      const str = (v) => (typeof v === "string" ? v : "");
      const start = str(ev?.start);
      const end = str(ev?.end);
      const due = str(ev?.due);
      return {
        title: str(ev?.title),
        kind: ev && start !== "" ? "event" : "todo",
        dueDate: due.slice(0, 10),
        dueTime: due.includes("T") ? due.slice(11, 16) : "",
        startDate: start.slice(0, 10) || slot?.startDate || schedToday(),
        startTime: (start.includes("T") ? start.slice(11, 16) : "") || slot?.startTime || "09:00",
        endDate: (end.includes("T") ? end.slice(0, 10) : "") || slot?.endDate || start.slice(0, 10) || schedToday(),
        endTime: (end.includes("T") ? end.slice(11, 16) : "") || slot?.endTime || "10:00",
        repeat: rec && (rec.type === "daily" || rec.type === "weekly" || rec.type === "monthly") ? rec.type : "none",
        interval: typeof rec?.interval === "number" && rec.interval >= 1 ? Math.floor(rec.interval) : 1,
        weekDays: Array.isArray(rec?.days) ? rec.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [],
        repeatEnd: typeof rec?.end === "string" ? rec.end.slice(0, 10) : "",
        location: str(ev?.location),
        description: str(ev?.description),
        done: !!ev?.completedAt,
      };
    }

    /** 一个带标签的表单项（表单里全是它，样式一处改全改）：标签在左，控件占满右侧。
     *  group=true 时换成 div——分段选择没有可关联的表单元素，套 label 会让点标签变成"点第一枚按钮" */
    function schedField(label, control, group) {
      const Tag = group ? "div" : "label";
      return jsxRuntime.jsxs(Tag, { className: "dshk-sched-field", children: [
        jsxRuntime.jsx("span", { className: "dshk-sched-fieldlabel", children: label }),
        jsxRuntime.jsx("span", { className: "dshk-sched-fieldbody", children: control }),
      ] });
    }

    /** 表单里的一枚输入：控件类型与额外属性透传，样式一处改全改 */
    function schedInput(type, value, onChange, extra) {
      return jsxRuntime.jsx("input", { type, className: "dshk-vault-modalinput", value, onChange, ...extra });
    }

    /** 日期 + 时刻并排（截止 / 开始 / 结束三处同形） */
    function schedWhen(dateValue, timeValue, onDate, onTime) {
      return jsxRuntime.jsx("div", { className: "dshk-sched-when", children: [
        schedInput("date", dateValue, onDate),
        schedInput("time", timeValue, onTime),
      ] });
    }

    /** 分段选择（类型与重复两处同形）：options = [[值, 文案]] */
    function schedSeg(value, options, onPick) {
      return jsxRuntime.jsx("div", { className: "dshk-sched-seg", children: options.map(([val, text]) =>
        jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-segbtn" + (value === val ? " is-active" : ""), onClick: () => onPick(val), children: text }, "seg-" + val)) });
    }

    /**
     * 日程建 / 改浮层（侧栏清单行与右栏网格块开的是同一个）。
     * 校验与字段白名单在宿主做，这里只挡"当场就能看出来的错"（空标题、结束早于开始），
     * 其余错误原样显示宿主给的原因——面板不复制一份规则。
     */
    function SchedEventDialog({ ev, onClose }) {
      const [f, setF] = react.useState(() => schedFormFrom(ev));
      const [busy, setBusy] = react.useState(false);
      const [err, setErr] = react.useState("");
      const [delArm, setDelArm] = react.useState(false);
      const set = (patch) => setF((prev) => ({ ...prev, ...patch }));
      const isNew = !ev;
      const fail = (e) => setErr(e && e.message ? e.message : t("schedOpFail").replace("{error}", "?"));
      const save = async () => {
        const title = f.title.trim();
        if (title === "") return setErr(t("schedTitleRequired"));
        const payload = { title, location: f.location, description: f.description };
        if (f.kind === "event") {
          if (f.startDate === "" || f.startTime === "" || f.endDate === "" || f.endTime === "") return setErr(t("schedEndAfterStart"));
          payload.start = `${f.startDate}T${f.startTime}`;
          payload.end = `${f.endDate}T${f.endTime}`;
          if (payload.end <= payload.start) return setErr(t("schedEndAfterStart"));
          // 日程不写 due：宿主会静默互清，面板也别送两套真源过去
          payload.due = null;
          payload.recurrence = f.repeat === "none" ? null : schedRecurrenceOf(f);
        } else {
          payload.due = f.dueDate === "" ? null : f.dueTime === "" ? f.dueDate : `${f.dueDate}T${f.dueTime}`;
          payload.start = null;
          payload.end = null;
          payload.recurrence = null;
        }
        if (!isNew) payload.completedAt = f.done ? schedNowDT() : null;
        setBusy(true);
        setErr("");
        try {
          await schedOp(isNew ? { op: "create", input: payload } : { op: "update", id: ev.id, patch: payload });
          flashToast(t("schedSaved"));
          onClose();
        } catch (e) {
          fail(e);
        } finally {
          setBusy(false);
        }
      };
      const remove = async () => {
        setBusy(true);
        try {
          await schedOp({ op: "delete", id: ev.id });
          flashToast(t("schedDeleted"));
          onClose();
        } catch (e) {
          fail(e);
        } finally {
          setBusy(false);
        }
      };
      const wdays = schedWeekdays();
      const weekDayBtns =
        jsxRuntime.jsxs("div", { className: "dshk-sched-weekdays", children: wdays.map((w, i) =>
          jsxRuntime.jsx("button", {
            type: "button",
            className: `dshk-sched-wdchip${f.weekDays.includes(i + 1) ? " is-active" : ""}`,
            onClick: () => set({ weekDays: f.weekDays.includes(i + 1) ? f.weekDays.filter((d) => d !== i + 1) : [...f.weekDays, i + 1] }),
            children: w,
          }, `wd-${i}`),
        ) });
      return jsxRuntime.jsx(VaultDialog, {
        title: isNew ? `${t("schedNew")} · ${f.kind === "event" ? t("schedKindEvent") : t("schedKindTodo")}` : `${t("schedEdit")} · ${ev.title}`,
        onClose,
        wide: true,
        children: jsxRuntime.jsxs(react.Fragment, { children: [
          jsxRuntime.jsxs("div", { className: "dshk-sched-form", children: [
            schedField(t("schedTitle"), schedInput("text", f.title, (e) => set({ title: e.target.value }), {
              maxLength: 16, placeholder: t("schedTitleHint"),
            })),
            schedField(t("schedType"), schedSeg(f.kind, [["todo", t("schedKindTodo")], ["event", t("schedKindEvent")]], (v) => set({ kind: v })), true),
            !isNew
              ? jsxRuntime.jsxs("label", { className: "dshk-sched-checkline", children: [
                  jsxRuntime.jsx("input", { type: "checkbox", checked: f.done, onChange: (e) => set({ done: e.target.checked }) }),
                  jsxRuntime.jsx("span", { children: t("schedDone") }),
                ] })
              : null,
            f.kind === "todo"
              ? schedField(t("schedTaskDue"), schedWhen(f.dueDate, f.dueTime,
                  (e) => set({ dueDate: e.target.value }), (e) => set({ dueTime: e.target.value })))
              : jsxRuntime.jsxs(react.Fragment, { children: [
                  schedField(t("schedStart"), schedWhen(f.startDate, f.startTime,
                    (e) => set({ startDate: e.target.value }), (e) => set({ startTime: e.target.value }))),
                  schedField(t("schedEnd"), schedWhen(f.endDate, f.endTime,
                    (e) => set({ endDate: e.target.value }), (e) => set({ endTime: e.target.value }))),
                ] }),
            f.kind === "event"
              ? jsxRuntime.jsxs(react.Fragment, { children: [
                  schedField(t("schedRepeat"), schedSeg(f.repeat, [
                    ["none", t("schedRepeatNone")], ["daily", t("schedRepeatDaily")],
                    ["weekly", t("schedRepeatWeekly")], ["monthly", t("schedRepeatMonthly")],
                  ], (v) => set({ repeat: v })), true),
                  f.repeat !== "none"
                    ? jsxRuntime.jsxs(react.Fragment, { children: [
                        schedField(t("schedRepeatEvery"), schedInput("number", f.interval, (e) => set({ interval: e.target.value }), { min: 1, max: 99 })),
                        f.repeat === "weekly" ? schedField(t("schedRepeatWeekly"), weekDayBtns) : null,
                        // 结束日留空 = 一直重复（原生 date 控件不吃 placeholder，另起一行才标得清）
                        schedField(t("schedRepeatEnd"), schedInput("date", f.repeatEnd, (e) => set({ repeatEnd: e.target.value }))),
                      ] })
                    : null,
                  // 改期 = 改整个系列（拆分与"只改这一次"是另外的语义，面板不做）
                  ev?.recurrence ? jsxRuntime.jsx("div", { className: "dshk-sched-formhint", children: t("schedSeriesHint") }) : null,
                ] })
              : null,
            schedField(t("schedLocation"), schedInput("text", f.location, (e) => set({ location: e.target.value }), { maxLength: 200 })),
            schedField(t("schedDescription"), jsxRuntime.jsx("textarea", { className: "dshk-vault-modalinput dshk-sched-textarea", rows: 2, value: f.description, maxLength: 2000, onChange: (e) => set({ description: e.target.value }) })),
            err !== "" ? jsxRuntime.jsx("div", { className: "dshk-sched-formerr", children: err }) : null,
            delArm
              ? jsxRuntime.jsxs("div", { className: "dshk-sched-delask", children: [
                  jsxRuntime.jsx("span", { children: t("schedConfirmDelete").replace("{name}", ev.title) }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-danger", disabled: busy, onClick: () => void remove(), children: t("schedDelete") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", onClick: () => setDelArm(false), children: rootT("cancel") }),
                ] })
              : null,
          ] }),
          jsxRuntime.jsxs("div", { className: "dshk-vault-modalfoot", children: [
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", disabled: busy, onClick: onClose, children: rootT("cancel") }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-primary", disabled: busy, onClick: () => void save(), children: t("schedSave") }),
          ] }),
        ] }),
      });
    }

    /** 计时段编辑浮层：起止时刻 + 备注。只对已闭合的段开（进行中的段先停表——
     *  正在跑的那段还没写 end，改它等于伪造一段没发生过的时间） */
    function SchedEntryDialog({ owner, index, entry, onClose }) {
      const [start, setStart] = react.useState(() => String(entry.start ?? "").slice(0, 16));
      const [end, setEnd] = react.useState(() => String(entry.end ?? "").slice(0, 16));
      const [note, setNote] = react.useState(() => (typeof entry.note === "string" ? entry.note : ""));
      const [busy, setBusy] = react.useState(false);
      const [err, setErr] = react.useState("");
      const run = async (payload, after) => {
        setBusy(true);
        setErr("");
        try {
          await schedOp(payload);
          after();
          onClose();
        } catch (e) {
          setErr(e && e.message ? e.message : "?");
        } finally {
          setBusy(false);
        }
      };
      return jsxRuntime.jsx(VaultDialog, {
        title: t("schedEntryTitle"),
        onClose,
        wide: true,
        children: jsxRuntime.jsxs(react.Fragment, { children: [
          jsxRuntime.jsxs("div", { className: "dshk-sched-form", children: [
            schedField(t("schedStart"), schedInput("datetime-local", start, (e) => setStart(e.target.value))),
            schedField(t("schedEnd"), schedInput("datetime-local", end, (e) => setEnd(e.target.value))),
            schedField(t("schedEntryNote"), schedInput("text", note, (e) => setNote(e.target.value), { maxLength: owner ? 200 : 16 })),
            err !== "" ? jsxRuntime.jsx("div", { className: "dshk-sched-formerr", children: err }) : null,
          ] }),
          jsxRuntime.jsxs("div", { className: "dshk-vault-modalfoot", children: [
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-danger", disabled: busy, onClick: () => void run({ op: "entry-delete", owner, index }, () => flashToast(t("schedDeleted"))), children: t("schedDelete") }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", disabled: busy, onClick: onClose, children: rootT("cancel") }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-primary", disabled: busy, onClick: () => void run({ op: "entry-update", owner, index, patch: { start, end, note } }, () => flashToast(t("schedSaved"))), children: t("schedSave") }),
          ] }),
        ] }),
      });
    }

    /** 开始计时浮层：挂一条未完成的待办，或填个标题起独立计时。
     *  已在跑的那只表由宿主先闭合（全局单实例），这里不重复拦 */
    function SchedTimerStartDialog({ events, onClose }) {
      const openTodos = react.useMemo(
        () =>
          (Array.isArray(events) ? events : [])
            .filter((e) => e.start === undefined && !e.completedAt)
            .sort((a, b) => (a.due === b.due ? 0 : a.due === undefined ? 1 : b.due === undefined ? -1 : a.due < b.due ? -1 : 1)),
        [events],
      );
      const [picked, setPicked] = react.useState("");
      const [solo, setSolo] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [err, setErr] = react.useState("");
      const start = async (payload) => {
        setBusy(true);
        setErr("");
        try {
          await schedOp({ op: "timer-start", ...payload });
          onClose();
        } catch (e) {
          setErr(e && e.message ? e.message : "?");
        } finally {
          setBusy(false);
        }
      };
      return jsxRuntime.jsx(VaultDialog, {
        title: t("schedTimerStart"),
        onClose,
        children: jsxRuntime.jsxs(react.Fragment, { children: [
          jsxRuntime.jsxs("div", { className: "dshk-sched-form", children: [
            jsxRuntime.jsx("div", { className: "dshk-sched-modalhint", children: t("schedTimerPick") }),
            jsxRuntime.jsxs("div", { className: "dshk-sched-picklist", children: openTodos.length === 0
              ? jsxRuntime.jsx("div", { className: "dshk-sched-formhint", children: t("schedTimerNoTodos") })
              : openTodos.map((e2) =>
                  jsxRuntime.jsxs("label", { className: "dshk-sched-pick", children: [
                    jsxRuntime.jsx("input", { type: "radio", name: "sched-timer-todo", checked: picked === e2.id, onChange: () => setPicked(e2.id) }),
                    jsxRuntime.jsx("span", { className: "dshk-sched-picktitle", children: e2.title }),
                    typeof e2.due === "string" && e2.due !== "" ? jsxRuntime.jsx("span", { className: "dshk-sched-pickdue", children: e2.due.slice(5).replace("T", " ") }) : null,
                  ] }, `pick-${e2.id}`),
                ) }),
            schedField(t("schedTimerSoloBtn"), schedInput("text", solo, (e) => setSolo(e.target.value), { maxLength: 16, placeholder: t("schedTimerSoloPh") })),
            err !== "" ? jsxRuntime.jsx("div", { className: "dshk-sched-formerr", children: err }) : null,
            // 挂表钮与"独立计时"钮两条路，摆在同一摞里（选中的待办才出这一条）
            picked !== ""
              ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-attachbtn", disabled: busy, onClick: () => void start({ id: picked }), children: t("schedTimerAttachBtn") })
              : null,
          ] }),
          jsxRuntime.jsxs("div", { className: "dshk-vault-modalfoot", children: [
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", disabled: busy, onClick: onClose, children: rootT("cancel") }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-primary", disabled: busy || solo.trim() === "", onClick: () => void start({ title: solo.trim() }), children: t("schedTimerSoloBtn") }),
          ] }),
        ] }),
      });
    }

    // ── 日程数据钩子（清单与网格各自挂载、各自轮询）：侧栏待办清单只要事件与
    // 实例（needStats=false 省掉统计那次请求），右栏网格另取周统计；
    // 面板的建/改/删/完成/计时都走写端点（写完经 schedBus 立刻重取），30s 轮询兜底
    // 接住 agent 工具与外部写入的变化 ──
    // statsDate = 网格当前显示的那一周（周导航翻页即换口径）；清单不关心统计
    function useScheduleData(needStats = true, statsDate = null) {
      const [data, setData] = react.useState(() => ({ events: [], occurrences: [], orphans: [], runningTimer: null }));
      const [stats, setStats] = react.useState(null);
      // 拉取失败不静默：面板继续显示上一次的数据，但挂出提示（口径不可信要说出来）
      const [loadFail, setLoadFail] = react.useState(false);
      const [nowTick, setNowTick] = react.useState(() => Date.now());
      // 写完（面板自己或另一个面板/悬浮球写的）立刻重取，不等 30s 那一拍
      const writeVersion = react.useSyncExternalStore(schedBus.subscribe, schedBus.getVersion);
      const fetchData = react.useCallback(async () => {
        try {
          // 窗口对齐桌面侧栏（−90 ~ +180 天）：清单「全部」档与跨月翻看都要看全
          const body = await kitJson(
            `/dsh-kit/schedule/data?from=${encodeURIComponent(schedAddDays(schedToday(), -90))}&to=${encodeURIComponent(schedAddDays(schedToday(), 180))}`,
          );
          setData({
            events: Array.isArray(body.events) ? body.events : [],
            occurrences: Array.isArray(body.occurrences) ? body.occurrences : [],
            orphans: Array.isArray(body.orphans) ? body.orphans : [],
            runningTimer: body.runningTimer ?? null,
          });
        } catch {
          // 拉取失败保留旧数据，下一轮轮询再试（提示条由 loadFail 挂着）
          return false;
        }
        return true;
      }, []);
      const fetchStats = react.useCallback(async () => {
        try {
          setStats(await kitJson(`/dsh-kit/schedule/stats?scope=week&date=${encodeURIComponent(statsDate ?? schedToday())}`));
        } catch {
          setStats(null);
          return false;
        }
        return true;
      }, [statsDate]);
      react.useEffect(() => {
        void fetchData();
      }, [fetchData, writeVersion]);
      react.useEffect(() => {
        if (needStats) void fetchStats();
      }, [fetchStats, needStats, writeVersion]);
      // 可见时 30s 轮询（别处写进来的条目靠它进面板）+ 每分钟走当前时刻线
      react.useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          void fetchData().then((okData) => {
            if (!needStats) return setLoadFail(!okData);
            void fetchStats().then((okStats) => setLoadFail(!(okData && okStats)));
          });
          setNowTick(Date.now());
        }, 30000);
        const minute = setInterval(() => setNowTick(Date.now()), 60000);
        return () => {
          clearInterval(timer);
          clearInterval(minute);
        };
      }, [fetchData, fetchStats, needStats]);
      return { data, stats, loadFail, nowTick, fetchData, fetchStats };
    }

    /** 待办清单（侧栏「日程」tab 整格）——清单口径：
     *  行 = 逾期待办 → 有截止日待办 → 无期限待办（仅「全部」）→ 还没过去的定时
     *  事件实例（**一次一次列**，重复系列不合并）。范围档：近三日/近一周/全部
     *  （滑动窗口严格层层包含，逾期永远进前两档、无期限待办只在「全部」）；
     *  行全部渲染、这一层自己滚（不做分页加载）。
     *  计时入口在这一格顶部（新建 / 开始计时 + 计时中状态）；行可勾完成、点标题改
     *  单条、行尾悬停出计时与删除。 */
    const SCHED_TODO_SCOPES = ["3d", "week", "all"];
    const SCHED_SCOPE_KEY = { "3d": "schedScope3d", week: "schedScopeWeek", all: "schedScopeAll" };
    function schedTodoScopeSaved() {
      try {
        const saved = localStorage.getItem("dshk:sched:todoScope");
        if (SCHED_TODO_SCOPES.includes(saved)) return saved;
      } catch {
        /* 隐私模式等拿不到 localStorage 就用默认 */
      }
      return "3d";
    }
    /** 清单行派生（纯函数，render-check 直测）：把 events+occurrences 折成
     *  逾期待办 / 带截止待办 / 无期限待办 / 事件实例四组 */
    function schedBuildTodoRows(data) {
      const todos = (Array.isArray(data.events) ? data.events : []).filter((e) => e.start === undefined && !e.completedAt);
      const events = (Array.isArray(data.occurrences) ? data.occurrences : [])
        .filter((o) => o.state !== "past")
        .sort((a, b) => (a.date === b.date ? a.startMins - b.startMins : a.date < b.date ? -1 : 1));
      return {
        overdueTodos: todos.filter(schedIsOverdue),
        datedTodos: todos.filter((e) => !schedIsOverdue(e) && schedDueDay(e) !== ""),
        openTodos: todos.filter((e) => schedDueDay(e) === ""),
        events,
      };
    }
    function ScheduleTasksPanel() {
      const { data, loadFail } = useScheduleData(false);
      const [scope, setScope] = react.useState(schedTodoScopeSaved);
      // 三个浮层各管一件事：新建/编辑条目、起表（挂待办或独立）、行尾动作的错误提示
      const [editEv, setEditEv] = react.useState(null);
      const [newOpen, setNewOpen] = react.useState(false);
      const [delArmId, setDelArmId] = react.useState(null);
      const [timerOpen, setTimerOpen] = react.useState(false);
      const running = data.runningTimer ?? null;
      const eventById = react.useCallback(
        (id) => (Array.isArray(data.events) ? data.events : []).find((e) => e.id === id) ?? null,
        [data.events],
      );
      /** 行尾动作：起表（已在跑这只 = 停它）/ 标完成 / 删。失败一律提示原因，
       *  不静默——按钮点了没反应是最难查的那种问题 */
      const runOp = async (payload) => {
        try {
          await schedOp(payload);
        } catch (e) {
          flashToast(t("schedOpFail").replace("{error}", e && e.message ? e.message : "?"));
        }
      };
      const groups = react.useMemo(() => schedBuildTodoRows(data), [data]);
      const today = schedToday();
      // 前两档 = 滑动窗口（今天 +2/+6 天，严格层层包含）；「全部」不设窗
      const windowEnd = scope === "3d" ? schedAddDays(today, 2) : scope === "week" ? schedAddDays(today, 6) : null;
      const rows = react.useMemo(() => {
        const todoRows = [];
        // 逾期无条件进所有档（"今天该补的债"）
        for (const ev of groups.overdueTodos) todoRows.push({ key: ev.id, ev, overdue: true });
        const dated = [...groups.datedTodos].sort((a, b) => (a.due < b.due ? -1 : 1));
        for (const ev of dated) {
          if (windowEnd !== null && schedDueDay(ev) > windowEnd) continue;
          todoRows.push({ key: ev.id, ev });
        }
        if (windowEnd === null) {
          for (const ev of groups.openTodos) todoRows.push({ key: ev.id, ev });
        }
        for (const o of groups.events) {
          if (windowEnd === null || (o.date >= today && o.date <= windowEnd)) todoRows.push({ key: `${o.baseId}@${o.date}`, occ: o });
        }
        return todoRows;
      }, [groups, windowEnd, today]);
      const pickScope = (s) => {
        setScope(s);
        try {
          localStorage.setItem("dshk:sched:todoScope", s);
        } catch {
          /* 忽略 */
        }
      };
      return jsxRuntime.jsxs("div", { className: "dshk-sched-todo", children: [
        jsxRuntime.jsxs("div", { className: "dshk-sched-todohead", children: [
          jsxRuntime.jsx("div", { className: "dshk-sched-todotitle", children: `${t("schedTasks")} · ${rows.length}` }),
          // 计时入口在这一格：新建 + 开始计时（已开表时这里退成状态，停表在悬浮球）。
          // 排在范围档上面：范围档是切清单的档位钮，紧挨着下面那片清单读起来才是"切这一片"
          jsxRuntime.jsxs("div", { className: "dshk-sched-todobar", children: [
            jsxRuntime.jsx(KitTip, { label: t("schedNew"), children:
              jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-actionbtn", "aria-label": t("schedNew"), onClick: () => setNewOpen(true), children: `＋ ${t("schedNew")}` }) }),
            running
              ? jsxRuntime.jsx(KitTip, { label: `${running.title || t("schedTimerStandalone")} · ${t("schedTimerBallTip")}`, children:
                  jsxRuntime.jsx("span", { className: "dshk-sched-running", children: `${t("schedTimerRunning")} ${schedClockOf(running.start)}` }) })
              : jsxRuntime.jsx(KitTip, { label: t("schedTimerPick"), children:
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-actionbtn", "aria-label": t("schedTimerStart"), onClick: () => setTimerOpen(true), children: `▶ ${t("schedTimerStart")}` }) }),
          ] }),
          jsxRuntime.jsx("div", { className: "dshk-sched-scopes", children: SCHED_TODO_SCOPES.map((s) =>
            jsxRuntime.jsx("button", { type: "button", className: `dshk-sched-wdchip${scope === s ? " is-active" : ""}`, onClick: () => pickScope(s), children: t(SCHED_SCOPE_KEY[s]) }, s),
          ) }),
        ] }),
        // 行全部渲染，这一层自己滚（表头、操作条与范围档钉死）
        jsxRuntime.jsx("div", { className: "dshk-sched-taskrows", children: [
          // 拉取失败：行照旧显示上一次的数据，但顶上挂一句（数据已旧，说出来）
          loadFail ? jsxRuntime.jsx("div", { className: "dshk-sched-taskfail", children: t("schedLoadFail") }) : null,
          rows.length === 0
            ? jsxRuntime.jsx("div", { className: "dshk-sched-emptytasks", children: t("schedTasksEmpty") })
            : rows.map((row) => {
                if (row.occ) {
                  // 定时事件实例：行右给时刻（与待办行的截止同位对齐）。改的是整条
                  // 系列（重复系列不合并成一行，编辑落在 base 上）
                  const o = row.occ;
                  const base = eventById(o.baseId);
                  return jsxRuntime.jsxs("div", { className: "dshk-sched-task", children: [
                    jsxRuntime.jsx("span", { className: "dshk-sched-tasktitle is-link", title: t("schedEdit"), onClick: () => base && setEditEv(base), children: o.title }),
                    jsxRuntime.jsx("span", { className: "dshk-sched-taskduebadge", children: schedOccRowLabel(o, today) }),
                  ] }, row.key);
                }
                const ev = row.ev;
                const dueTxt = typeof ev.due === "string" ? ev.due.slice(5).replace("T", " ") : "";
                const isRunning = running !== null && running.id === ev.id;
                return jsxRuntime.jsxs("div", { className: `dshk-sched-task${isRunning ? " is-timing" : ""}`, children: [
                  jsxRuntime.jsx("input", {
                    type: "checkbox",
                    className: "dshk-sched-taskcheck",
                    checked: false,
                    "aria-label": t("schedDone"),
                    onChange: () => void runOp({ op: "done", id: ev.id, done: true }),
                  }),
                  jsxRuntime.jsx("span", { className: "dshk-sched-tasktitle is-link", title: t("schedEdit"), onClick: () => setEditEv(ev), children: ev.title }),
                  dueTxt
                    ? jsxRuntime.jsx("span", { className: `dshk-sched-taskduebadge${row.overdue ? " is-overdue" : ""}`, children: row.overdue ? `${t("schedOverdue")} ${dueTxt}` : dueTxt })
                    : jsxRuntime.jsx("span", { className: "dshk-sched-taskduebadge", children: t("schedNoDue") }),
                  // 行尾动作：悬停才显（窄侧栏常驻三枚钮太挤）
                  jsxRuntime.jsxs("span", { className: "dshk-sched-taskacts", children: [
                    jsxRuntime.jsx(KitTip, { label: isRunning ? t("schedTimerStop") : t("schedTimerStart"), children:
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: `dshk-sched-tasktimer${isRunning ? " is-on" : ""}`,
                        "aria-label": isRunning ? t("schedTimerStop") : t("schedTimerStart"),
                        onClick: () => void runOp(isRunning ? { op: "timer-stop" } : { op: "timer-start", id: ev.id }),
                        children: isRunning ? "■" : "▶",
                      }) }),
                    jsxRuntime.jsx(KitTip, { label: t("schedEdit"), children:
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-taskact", "aria-label": t("schedEdit"), onClick: () => setEditEv(ev), children: "✎" }) }),
                    jsxRuntime.jsx(KitTip, { label: delArmId === ev.id ? t("schedConfirmDelete").replace("{name}", ev.title) : t("schedDelete"), children:
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: `dshk-sched-taskact${delArmId === ev.id ? " is-arm" : ""}`,
                        "aria-label": t("schedDelete"),
                        // 两步删除：侧栏这么窄，塞不下一个确认浮层；第一步只亮起
                        // 这一枚钮，误点再点一次别的行就散了
                        onClick: () => {
                          if (delArmId === ev.id) {
                            setDelArmId(null);
                            void runOp({ op: "delete", id: ev.id });
                          } else setDelArmId(ev.id);
                        },
                        children: delArmId === ev.id ? t("schedConfirm") : "✕",
                      }) }),
                  ] }),
                ] }, row.key);
              }),
        ] }),
        editEv ? jsxRuntime.jsx(SchedEventDialog, { ev: editEv, onClose: () => setEditEv(null) }) : null,
        newOpen ? jsxRuntime.jsx(SchedEventDialog, { ev: null, onClose: () => setNewOpen(false) }) : null,
        timerOpen ? jsxRuntime.jsx(SchedTimerStartDialog, { events: data.events, onClose: () => setTimerOpen(false) }) : null,
      ] });
    }

    function ScheduleView({ active }) {
      const [weekStart, setWeekStart] = react.useState(() => schedMondayOf(schedToday()));
      // 统计跟着网格走：翻到哪一周就报哪一周（口径写死本周会让翻页后的数字对不上眼前这周）
      const { data, stats, loadFail, nowTick } = useScheduleData(true, weekStart);
      const gridRef = react.useRef(null);
      // 点块编辑：条目（事件/待办）与计时段各开自己的浮层
      const [editEv, setEditEv] = react.useState(null);
      const [entry, setEntry] = react.useState(null);

      const weekDates = react.useMemo(() => {
        const days = [];
        for (let i = 0; i < 7; i++) days.push(schedAddDays(weekStart, i));
        return days;
      }, [weekStart]);

      // 日程视图每次变为可见（挂载即激活 / 从别的标签切回）都把视口滚到当前
      // 时刻上方 1/3 处。"只滚一次"有坑：挂载时若视图还 display:none
      // （日程开着但激活位在别的标签），唯一一次机会被浪费，切回永远停在顶部。
      // rAF 再兜一帧：可见性翻转首帧 clientHeight 偶发未就绪，按真实视口重算
      react.useLayoutEffect(() => {
        if (!active) return undefined;
        const scrollToNow = () => {
          const el = gridRef.current;
          if (!el || el.clientHeight === 0) return;
          const now = new Date();
          const mins = now.getHours() * 60 + now.getMinutes();
          el.scrollTop = Math.max(0, ((mins - SCHED_DAY_START) / 60) * SCHED_HOUR_PX - el.clientHeight / 3);
        };
        scrollToNow();
        const raf = requestAnimationFrame(scrollToNow);
        return () => cancelAnimationFrame(raf);
      }, [active]);

      // 计时段上网格：事件 timeEntries 与独立计时段（orphans，
      // note=自由标题）合成显示块——只展示已闭合段（本端不做计时，进行中的
      // 段不会出现），按 start 日归属（与 timedMsInRange 统计口径一致）。
      // 画法与事件块同一套状态色：停下的段=已过去蓝
      const timedOcc = react.useMemo(() => {
        const segs = [];
        for (const ev of data.events) {
          (Array.isArray(ev.timeEntries) ? ev.timeEntries : []).forEach((t, i) => {
            if (t.end === undefined) return;
            segs.push({ baseId: `${ev.id}#timed${i}`, date: t.start.slice(0, 10), endDate: t.end.slice(0, 10), startMins: timerMinsOfDT(t.start), endMins: timerMinsOfDT(t.end), title: t.note || ev.title, virtual: false, isTimed: true, entryOwner: ev.id, entryIndex: i, entry: t });
          });
        }
        (Array.isArray(data.orphans) ? data.orphans : []).forEach((o, i) => {
          if (o.end === undefined) return;
          segs.push({ baseId: `orphan#timed${i}`, date: o.start.slice(0, 10), endDate: o.end.slice(0, 10), startMins: timerMinsOfDT(o.start), endMins: timerMinsOfDT(o.end), title: o.note || t("schedTimerStandalone"), virtual: false, isTimed: true, entryOwner: null, entryIndex: i, entry: o });
        });
        return segs;
      }, [data.events, data.orphans]);
      // 带时刻的待办上网格：截止只是一个**时刻**、不占一段时间——画成上沿对准
      // 截止时刻的 15 分钟小条，块上写「截止 HH:mm」（不写一段不存在的区间）。
      // 底色待办橙（逾期红）；只到日/无期限的待办不上块
      const choreOcc = react.useMemo(() => {
        const out = [];
        for (const ev of data.events) {
          if (ev.start !== undefined || ev.completedAt) continue;
          if (typeof ev.due !== "string" || !ev.due.includes("T")) continue;
          const date = ev.due.slice(0, 10);
          const dueMins = timerMinsOfDT(ev.due);
          const startMins = Math.min(dueMins, SCHED_DAY_END - 15);
          out.push({ baseId: ev.id, date, endDate: date, startMins, endMins: startMins + 15, title: ev.title, virtual: false, isChore: true, choreDueMins: dueMins, overdue: schedIsOverdue(ev) });
        }
        return out;
      }, [data.events]);
      const gridOcc = react.useMemo(() => {
        // 先按日切片再入池：跨天块/跨零点计时段在每列各得自己的那一片
        // （事件实例与计时段同一画法）。泳道按日分池：全周混排会让不同天、
        // 同时刻的事件互相挤占泳道，列间本无冲突
        const slices = [...(Array.isArray(data.occurrences) ? data.occurrences : []), ...choreOcc, ...timedOcc].flatMap(schedSliceByDay);
        const byDate = new Map();
        for (const o of slices) {
          const arr = byDate.get(o.date) ?? [];
          arr.push(o);
          byDate.set(o.date, arr);
        }
        const laid = [];
        for (const arr of byDate.values()) laid.push(...schedAssignLanes(arr));
        return laid.map((o) => {
          // 高度贴合真实时长比例：短段不再一律抬到 18px，
          // 但下限 14px + is-thin 紧凑排版保证单行标题仍可读
          const raw = ((o.sliceEnd - Math.max(o.sliceStart, SCHED_DAY_START)) / 60) * SCHED_HOUR_PX;
          return {
            ...o,
            top: ((Math.max(o.sliceStart, SCHED_DAY_START) - SCHED_DAY_START) / 60) * SCHED_HOUR_PX,
            height: Math.max(14, raw),
            thin: raw < 18,
          };
        });
      }, [data.occurrences, choreOcc, timedOcc]);
      // 表头下的全天带：只放「有截止日且不带时刻的待办」——位置即语义，用自己的
      // 状态色（未完成橙 / 逾期红 / 已完成灰置底）。不在本周的落周一列（tooltip
      // 写明原截止日）。**按列成栈**：同列多条各占一行，平铺会全叠进同一个网格
      // 单元互相盖住，读者只看得见最后一条（逾期一多整条带子就白了）
      const dateTodoByCol = react.useMemo(() => {
        const cols = new Map();
        for (const date of weekDates) cols.set(date, []);
        const monday = weekDates[0];
        for (const ev of Array.isArray(data.events) ? data.events : []) {
          if (ev.start !== undefined || typeof ev.due !== "string" || ev.due === "" || ev.due.includes("T")) continue;
          const day = ev.due.slice(0, 10);
          const inWeek = cols.has(day);
          const arr = cols.get(inWeek ? day : monday) ?? [];
          const done = !!ev.completedAt;
          arr.push({ baseId: ev.id, date: day, title: ev.title, done, late: !done && schedIsOverdue(ev), outOfWeek: !inWeek });
          cols.set(inWeek ? day : monday, arr);
        }
        // 本周那天的排前面，跨周堆积的按截止日从早到晚（逾期最久的先看见）
        for (const arr of cols.values()) {
          arr.sort((a, b) => (a.outOfWeek === b.outOfWeek ? a.date.localeCompare(b.date) : a.outOfWeek ? 1 : -1));
        }
        return cols;
      }, [data.events, weekDates]);

      const today = schedToday();
      const isCurrentWeek = weekDates.includes(today);
      const nowMins = new Date(nowTick).getHours() * 60 + new Date(nowTick).getMinutes();
      const hours = [];
      for (let h = SCHED_DAY_START / 60; h < SCHED_DAY_END / 60; h++) hours.push(h);

      // 表头：周导航靠左、本周统计靠右（待办清单在侧栏，网格页只剩网格与统计）
      const head = jsxRuntime.jsxs("div", {
        className: "dshk-sched-head",
        children: [
          jsxRuntime.jsxs("span", { className: "dshk-sched-weeknav", children: [
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setWeekStart((s) => schedAddDays(s, -7)), children: "‹" }),
            jsxRuntime.jsx("span", { className: "dshk-sched-weeklabel", children: `${weekDates[0].slice(5).replace("-", "/")} - ${weekDates[6].slice(5).replace("-", "/")}` }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setWeekStart((s) => schedAddDays(s, 7)), children: "›" }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setWeekStart(schedMondayOf(schedToday())), children: t("schedToday") }),
          ] }),
          loadFail
            ? jsxRuntime.jsx("span", { className: "dshk-sched-headfail", children: t("schedLoadFail") })
            : stats
              ? jsxRuntime.jsxs("span", { className: "dshk-sched-headstat", title: t("schedStatsTitle"), children: [
                jsxRuntime.jsx("b", { children: schedFmtDur(stats.totalMs) }),
                jsxRuntime.jsx("span", { className: "dshk-sched-statrow", children: `${t("schedStatsEvents")} ${stats.eventCount} · ${t("schedStatsDone")} ${stats.completedCount} · ${t("schedStatsOpen")} ${stats.openCount}` }),
              ] })
              : null,
        ],
      });

      // 表头（角格 + 日期头 + 全天带）与网格分成两块、上下叠：表头**不滚**，
      // 留在滚动区里的话 y 轴吸附会让它压住全天带那一行（chip 画了看不见）
      const topGrid = jsxRuntime.jsxs("div", {
        className: "dshk-sched-topgrid",
        children: [
          jsxRuntime.jsx("div", { className: "dshk-sched-corner", style: { gridRow: 1, gridColumn: 1 } }),
          // key 必须带前缀区分：日期头与日列同用裸日期曾致同级 key 冲突——React
          // 错配复用元素，切周时旧列不卸载不断往下叠加
          ...weekDates.map((date, i) =>
            jsxRuntime.jsxs("div", { className: `dshk-sched-dayhead${date === today ? " is-today" : ""}`, style: { gridRow: 1, gridColumn: i + 2 }, children: [
              jsxRuntime.jsx("span", { className: "dshk-sched-wd", children: schedWeekdays()[i] }),
              jsxRuntime.jsx("span", { className: "dshk-sched-dnum", children: Number(date.slice(8, 10)) }),
            ] }, `hd-${date}`),
          ),
          ...weekDates.map((date, i) => {
            const items = dateTodoByCol.get(date) ?? [];
            if (items.length === 0) return null;
            const shown = items.slice(0, SCHED_ALLDAY_MAX);
            const rest = items.slice(SCHED_ALLDAY_MAX);
            const zh = resolveZh();
            const chip = (o) => {
              const hint =
                `${o.title} · ${t("schedTaskDue")} ${o.date}` +
                (o.done ? ` · ${zh ? "已完成" : "done"}` : o.late ? ` · ${t("schedOverdue")}` : "") +
                (o.outOfWeek ? (zh ? `（不在本周）` : " (not this week)") : "");
              return jsxRuntime.jsx(
                "div",
                {
                  className: `dshk-sched-allday${o.done ? " is-done" : o.late ? " is-overdue" : ""}`,
                  title: hint,
                  children: o.title,
                },
                `ad-${o.baseId}`,
              );
            };
            return jsxRuntime.jsxs("div", { className: "dshk-sched-alldaycol", style: { gridRow: 2, gridColumn: i + 2 }, children: [
              ...shown.map(chip),
              // 溢出折叠成一条：带高随之封顶，不然一列十几条会把表头带撑得太高
              rest.length > 0
                ? jsxRuntime.jsx("div", {
                    className: "dshk-sched-allday is-more",
                    title: rest.map((o) => `${o.title} · ${t("schedTaskDue")} ${o.date}`).join("\n"),
                    children: `+${rest.length}`,
                  }, "ad-more")
                : null,
            ] }, `adc-${date}`);
          }),
        ],
      });

      const grid = jsxRuntime.jsxs("div", {
        className: "dshk-sched-grid",
        children: [
          jsxRuntime.jsx("div", { className: "dshk-sched-timeline", style: { gridColumn: 1 }, children: hours.map((h) =>
            jsxRuntime.jsx("div", { className: "dshk-sched-hourlabel", children: `${schedPad2(h)}:00` }, h),
          ) }, "tl"),
          ...weekDates.map((date) => {
            const inWeek = gridOcc.filter((o) => o.date === date);
            return jsxRuntime.jsxs("div", { className: "dshk-sched-daycol", "data-date": date, style: { gridColumn: weekDates.indexOf(date) + 2 }, children: [
              hours.map((h) =>
                jsxRuntime.jsx("div", {
                  className: "dshk-sched-cell",
                  style: { height: SCHED_HOUR_PX },
                }, h),
              ),
              date === today && isCurrentWeek
                ? jsxRuntime.jsx("div", { className: "dshk-sched-nowline", style: { top: ((Math.min(nowMins, SCHED_DAY_END) - SCHED_DAY_START) / 60) * SCHED_HOUR_PX } })
                : null,
              inWeek.map((o) => {
                // 块内第二行给时刻（时刻加颜色已说完状态，不写"已过/进行中"字样）：
                // 事件实例 起点日给整条（跨天含「次日」）、延续日「延续中」、尾巴「←止01:00」；
                // 带时刻待办是截止小条，只写「截止 HH:mm」（不写一段不存在的区间）。
                // 完整时段与地点/备注进 tooltip；够高的块标题放开两行（is-tall）
                const cross = o.origEndDate > o.origDate;
                const choreTime = `${t("schedTaskDue")} ${schedHHmm(o.choreDueMins ?? o.origEndMins)}`;
                const timeLine = o.isChore ? choreTime : schedPieceTimeLabel(o);
                const tipParts = [
                  o.isChore
                    ? `${o.title} · ${choreTime}`
                    : cross
                      ? `${o.origDate} ${schedHHmm(o.origStartMins)} – ${o.origEndDate} ${schedHHmm(o.origEndMins ?? 0)}`
                      : schedOccTimeLabel(o.origDate ?? o.date, o.origEndDate, o.origStartMins, o.origEndMins),
                  ...(o.isChore ? [] : [o.title]),
                  ...(o.location ? [o.location] : []),
                  ...(o.description ? [o.description] : []),
                ];
                const stateClass = o.isChore
                  ? o.overdue ? "is-overdue" : "is-todo"
                  : o.isTimed
                    ? "is-past"
                    : SCHED_STATE_CLASS[o.state] ?? "is-todo";
                // 矮到装不下两行的小条（截止小条/跨天尾巴）：标题与时刻挤一行
                const squeeze = o.isChore && o.thin;
                return jsxRuntime.jsxs("div", {
                  // 点块即改：事件块改条目、计时段块改那一段（网格就是编辑面）
                  onClick: () => {
                    if (o.isTimed) return setEntry({ owner: o.entryOwner, index: o.entryIndex, entry: o.entry });
                    const base = (Array.isArray(data.events) ? data.events : []).find((e) => e.id === o.baseId);
                    if (base) setEditEv(base);
                  },
                  className: `dshk-sched-event is-clickable ${stateClass}${o.height >= 48 ? " is-tall" : ""}${o.thin ? " is-thin" : ""}`,
                  style: {
                    top: o.top,
                    height: o.height,
                    // 泳道均分且零内缩：块边缘与列网格线严丝合缝
                    left: `${(o.lane * 100) / o.lanes}%`,
                    width: `${100 / o.lanes}%`,
                  },
                  title: tipParts.filter(Boolean).join("\n"),
                  children: [
                    jsxRuntime.jsx("span", { className: "dshk-sched-evtitle", children: squeeze ? `${o.title} ${choreTime}` : o.title }),
                    !o.thin && !o.isChore ? jsxRuntime.jsx("span", { className: "dshk-sched-evtime", children: timeLine }) : null,
                    !o.thin && o.isChore ? jsxRuntime.jsx("span", { className: "dshk-sched-evtime", children: choreTime }) : null,
                  ],
                }, `${o.baseId}@${o.date}`);
              }),
            ] }, `dc-${date}`);
          }),
        ],
      });

      // 网格吃满整格：待办清单在侧栏、统计进了表头，主区只剩一张全宽周网格
      return jsxRuntime.jsxs("div", { className: "dshk-sched-root", children: [
        head,
        jsxRuntime.jsx("div", { className: "dshk-sched-body", children: [
          topGrid,
          jsxRuntime.jsx("div", { className: "dshk-sched-gridwrap", ref: gridRef, children: jsxRuntime.jsx("div", { className: "dshk-sched-gridinner", children: grid }) }),
        ] }),
        editEv ? jsxRuntime.jsx(SchedEventDialog, { ev: editEv, onClose: () => setEditEv(null) }) : null,
        entry ? jsxRuntime.jsx(SchedEntryDialog, { owner: entry.owner, index: entry.index, entry: entry.entry, onClose: () => setEntry(null) }) : null,
      ] });
    }
    /** 计时段 "YYYY-MM-DDTHH:mm(:ss)" → 当日分钟数（网格块定位用） */
    function timerMinsOfDT(dt) {
      return Number(String(dt).slice(11, 13)) * 60 + Number(String(dt).slice(14, 16));
    }

    /**
     * 计时悬浮球（全局常驻，不进任何槽位）：有表在跑才出现，每秒走秒。
     *  入口在侧栏、停表在这里是刻意分开的两个位置——面板关掉、切到别的签时
     *  那只表还在跑，看不见表就等于这段时间没有着落。
     *  状态源是宿主 /dsh-kit/schedule/timer（10s 一轮 + 本端写完立刻重取）：
     *  别处起的表也走同一份 timer.json，这里跟着走。
     */
    function SchedTimerBall() {
      const version = react.useSyncExternalStore(schedBus.subscribe, schedBus.getVersion);
      const [timer, setTimer] = react.useState(null);
      const [now, setNow] = react.useState(() => Date.now());
      const [open, setOpen] = react.useState(false);
      const [stopping, setStopping] = react.useState(false);
      react.useEffect(() => {
        let alive = true;
        const load = async () => {
          try {
            const body = await kitJson("/dsh-kit/schedule/timer");
            if (alive) setTimer(body && body.runningTimer ? body.runningTimer : null);
          } catch {
            /* 端点不可达（组件行关了）就保持上一次，别把已经在跑的球撤掉 */
          }
        };
        void load();
        const poll = setInterval(() => {
          if (typeof document === "undefined" || document.visibilityState !== "hidden") void load();
        }, 10000);
        return () => {
          alive = false;
          clearInterval(poll);
        };
      }, [version]);
      react.useEffect(() => {
        if (!timer) return undefined;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
      }, [timer]);
      if (!timer) return null;
      const stop = async () => {
        setStopping(true);
        try {
          await schedOp({ op: "timer-stop" });
          setOpen(false);
        } catch (e) {
          flashToast(t("schedOpFail").replace("{error}", e && e.message ? e.message : "?"));
        } finally {
          setStopping(false);
        }
      };
      const title = timer.title || t("schedTimerStandalone");
      return jsxRuntime.jsxs("div", { className: `dshk-sched-ball${open ? " is-open" : ""}`, children: [
        jsxRuntime.jsx("button", {
          type: "button",
          className: "dshk-sched-ballface",
          "aria-label": title,
          title: title,
          onClick: () => setOpen((v) => !v),
          children: [
            jsxRuntime.jsx("span", { className: "dshk-sched-balldot" }),
            jsxRuntime.jsx("span", { className: "dshk-sched-balltime", children: schedElapsed(timer.start, now) }),
          ],
        }),
        open
          ? jsxRuntime.jsxs("div", { className: "dshk-sched-ballpanel", children: [
              jsxRuntime.jsx("div", { className: "dshk-sched-balltitle", children: title }),
              jsxRuntime.jsx("div", { className: "dshk-sched-ballmeta", children: `${t("schedStart")} ${schedClockOf(timer.start)}` }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-ballstop", disabled: stopping, onClick: () => void stop(), children: t("schedTimerStop") }),
            ] })
          : null,
      ] });
    }

    /** 悬浮球挂全局根（不进槽位）：apply 会重入，根只挂一次 */
    let schedBallRoot = null;
    function mountSchedBall(require) {
      if (schedBallRoot || typeof document === "undefined") return;
      const host = document.createElement("div");
      host.className = "dshk-sched-ballhost";
      document.body.appendChild(host);
      try {
        const { createRoot } = require("react-dom/client");
        schedBallRoot = createRoot(host);
        schedBallRoot.render(jsxRuntime.jsx(SchedTimerBall, {}));
      } catch (error) {
        // 拿不到 createRoot 就退化成「只在侧栏面板里起停表」：数据与端点都不受影响，
        // 悬浮球只是让那只表随时看得见
        host.remove();
        schedBallRoot = null;
      }
    }

    // ─────────── 知识库（vault：侧栏目录索引 + 右栏页阅读面，portal 拆两半）───────────
    // vault = 本组件行配置页配置的绝对目录，其内一切 md 即页面（数据契约见 src/vault/scanner.ts）。
    // 布局「选库进入阅读」：左 = 工具条（搜索 + ↻）+ 懒加载目录树；右 = 页阅读面
    // （TipTap 编辑态，vendor/richeditor.bundle.js 的 window.DshRTE 工厂：md ↔ 富文本
    // 往返、[[wikilink]]/公式/未知块 HTML 原样保留）。VaultRootView 单实例挂在组件壳里，
    // 两半经 portal 分投侧栏与右栏 pane 宿主。
    // 编辑面：目录 / 搜索 / 双链 / 反链 / 大纲导航 + 正文所见即所得（自动保存走
    // POST /dsh-kit/vault/write，mtime CAS 防覆盖别处改动）；盘上被别处改（stat 轮询
    // 发现 mtime 变化）就整页静默重读。全文搜索走本组件宿主端点（路径 8 / 文件名 5 / 正文 2）。

    /** 拆 frontmatter：返回 { fmText, rest }。fmText = "---…---" 块（含随后的
     *  首个换行）的字节级原文，无 frontmatter 时 fmText=""；rest = 其余全部。
     *  编辑面 fm 不进渲染器（当属性看），保存时原样拼回正文前面 */
    function vaultSplitFrontmatter(content) {
      const src = String(content ?? "");
      const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(src);
      if (!m) return { fmText: "", rest: src };
      return { fmText: m[0], rest: src.slice(m[0].length) };
    }

    /** 粘贴图片的压缩阈值：最长边 >2048 或体积 >400KB 才重编码，
     *  透明通道保 PNG、否则 JPEG 0.85；没过阈值按原字节走 */
    const PASTE_MAX_EDGE = 2048;
    const PASTE_MAX_BYTES = 400 * 1024;
    /** 透明探针的边长上限：整幅 getImageData 在 24MP 照片上是一次 ~96MB 分配加
     *  两千多万次逐像素读，粘一张图卡住半秒；缩到探针尺寸足够判「整幅不透明」 */
    const PASTE_PROBE_EDGE = 256;
    /** 图片 → {blob, ext}：小图/PNG 直接放行，中大图走 canvas 重编码 */
    async function shrinkPastedImage(file) {
      // PNG 源按「有透明」处理：保 PNG 无损，也免了探针——缩略会把小块透明区
      // 平均掉，logo 上一个洞被填成白块比多存几十 KB 难看得多
      const img = await decodeImage(file, file.type === "image/png");
      if (img.width <= PASTE_MAX_EDGE && img.height <= PASTE_MAX_EDGE && (file.type === "image/png" || file.size <= PASTE_MAX_BYTES)) {
        return { blob: file, ext: file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "png" };
      }
      return encodeViaCanvas(img, img.hasAlpha);
    }
    /** file → {width, height, hasAlpha, canvas}；assumeAlpha 为真时跳过透明探测 */
    function decodeImage(file, assumeAlpha) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const el = new Image();
        el.onload = () => {
          URL.revokeObjectURL(url);
          const width = el.naturalWidth;
          const height = el.naturalHeight;
          if (assumeAlpha === true) {
            resolve({ width, height, hasAlpha: true, canvas: el });
            return;
          }
          const scale = Math.min(1, PASTE_PROBE_EDGE / Math.max(width, height));
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(width * scale));
          cv.height = Math.max(1, Math.round(height * scale));
          const ctx = cv.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(el, 0, 0, cv.width, cv.height);
          // 透明像素按「有无透明」分流：整幅不透明的一律出 JPEG（小一半）
          const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
          let hasAlpha = false;
          for (let i = 3; i < px.length; i += 4) {
            if (px[i] < 255) { hasAlpha = true; break; }
          }
          resolve({ width, height, hasAlpha, canvas: el });
        };
        el.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("decode failed"));
        };
        el.src = url;
      });
    }
    function encodeViaCanvas(img, hasAlpha) {
      const scale = Math.min(1, PASTE_MAX_EDGE / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      const ctx = cv.getContext("2d");
      if (!hasAlpha) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      ctx.drawImage(img.canvas, 0, 0, cv.width, cv.height);
      const type = hasAlpha ? "image/png" : "image/jpeg";
      const url = cv.toDataURL(type, 0.85);
      const bin = atob(url.slice(url.indexOf(",") + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { blob: new Blob([bytes], { type }), ext: hasAlpha ? "png" : "jpg" };
    }
    function blobToBase64(blob) {
      return blob.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let out = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(out);
      });
    }

    /** 标题锚 slug：压空白为 -（中英混排原样保留，仅保证锚点匹配一致） */
    function vaultHeadingSlug(text) {
      return String(text ?? "").trim().replace(/\s+/g, "-");
    }

    /** wikilink 目标 → 页面：rel 全等 > rel 尾段 > 文件名（均不分大小写）。
     *  space 给定时（发起链接的页面所在空间），同层并列命中优先取同空间的——
     *  跨空间重名页时链接不再静默指向字典序小的那个 */
    function resolveVaultLink(pages, target, space) {
      const t = String(target ?? "").trim().replace(/\.md$/i, "").replace(/\\/g, "/").toLowerCase();
      if (t === "") return null;
      const base = t.split("/").pop() ?? t;
      const pref = typeof space === "string" && space !== "" ? `${space.toLowerCase()}/` : null;
      const prefer = (p, cur) => {
        if (cur === null || pref === null) return cur === null;
        const pIn = p.rel.toLowerCase().startsWith(pref);
        const cIn = cur.rel.toLowerCase().startsWith(pref);
        return pIn && !cIn;
      };
      let rel = null;
      let suffix = null;
      let baseName = null;
      for (const p of pages) {
        const relLower = p.rel.toLowerCase();
        if (relLower === t && prefer(p, rel)) rel = p;
        if (t.includes("/") && relLower.endsWith("/" + t) && prefer(p, suffix)) suffix = p;
        const b = relLower.split("/").pop() ?? relLower;
        if (b === base && prefer(p, baseName)) baseName = p;
      }
      return rel ?? suffix ?? baseName ?? null;
    }

    /** 反链：links 能解析到当前页的其它页面（O(页数×链接数)，键集一次构建） */
    function vaultBacklinks(pages, currentPath) {
      const current = pages.find((p) => p.path === currentPath);
      if (!current) return [];
      const keys = new Set();
      const add = (s) => keys.add(String(s ?? "").replace(/\.md$/i, "").toLowerCase());
      add(current.rel);
      const base = current.rel.split("/").pop() ?? "";
      add(base);
      return pages.filter((p) => {
        if (p.path === currentPath) return false;
        return p.links.some((l) => {
          const t = String(l ?? "").trim().replace(/\.md$/i, "").replace(/\\/g, "/").toLowerCase();
          if (keys.has(t)) return true;
          return keys.has(t.split("/").pop() ?? "");
        });
      });
    }

    /** 全篇大纲（页条「目录」用）：顶层标题一趟扫完，pos = 节点起点
     *  （scrollToPos 的口径）；空标题不进（没东西可点） */
    function vaultOutline(h) {
      const ed = h?.editor;
      if (!ed) return [];
      const items = [];
      try {
        ed.state.doc.forEach((node, offset) => {
          if (node.type.name !== "heading") return;
          const text = String(node.textContent).trim();
          if (text === "") return;
          items.push({ level: Number(node.attrs.level ?? 1), text, pos: offset });
        });
      } catch {
        return [];
      }
      return items;
    }

    // 左树行图标（与文件树同一套官方 primitives）——
    // 目录 = TreeFolderIcon、页面 = FileTypeIcon16、展开箭头 = ChevronIcon，
    // 三个都在文件树那边定义

    // 行开关是唯一门槛（探针 404 = 本组件整体不注册，压根走不到这里）；根目录是否
    // 配置好由 VaultRootView 从 /dsh-kit/vault/index 自取——那才是两端一致的配置源
    function VaultView() {
      return jsxRuntime.jsx(VaultRootView, {});
    }

    // 斜杠菜单的项表：两级（分组 → 条目），labelKey/descKey 走 i18n，match 是过滤
    // 用的附加关键词（英文 + 中文别名；命令本身由 vendor 句柄执行）。分组：
    // 标题与正文 / 特殊块 / 列表 / 数学公式与代码 / 图表 / 附件。
    // H5、H6 用得少不进菜单（正文里已有的照常渲染）；表格不列固定尺寸，点开自己填行列
    const VAULT_MENU = [
      {
        key: "head",
        labelKey: "vmenuGHead",
        match: "heading h1 h2 h3 h4 body 标题 正文",
        children: [
          { key: "h1", icon: "H1", labelKey: "vmenuH1", descKey: "vmenuH1Desc", match: "h1 一级" },
          { key: "h2", icon: "H2", labelKey: "vmenuH2", descKey: "vmenuH2Desc", match: "h2 二级" },
          { key: "h3", icon: "H3", labelKey: "vmenuH3", descKey: "vmenuH3Desc", match: "h3 三级" },
          { key: "h4", icon: "H4", labelKey: "vmenuH4", descKey: "vmenuH4Desc", match: "h4 四级" },
          { key: "body", icon: "P", labelKey: "vmenuBody", descKey: "vmenuBodyDesc", match: "body paragraph 正文 段落" },
        ],
      },
      {
        key: "special",
        labelKey: "vmenuGSpecial",
        match: "special divider hr fold quote wikilink 分割 特殊 引用 折叠 双链",
        children: [
          { key: "hr", icon: "—", labelKey: "vmenuHr", descKey: "vmenuHrDesc", match: "hr divider 分割线" },
          { key: "fold", icon: "▸", labelKey: "vmenuFold", descKey: "vmenuFoldDesc", match: "fold collapsible 折叠 折叠块" },
          { key: "quote", icon: "❝", labelKey: "vmenuQuote", descKey: "vmenuQuoteDesc", match: "quote blockquote 引用" },
          // 双链放最后：前三条的 1-9 数字键位不动。正文一个字不动，弹选择框挑页
          { key: "wiki", icon: "🔗", labelKey: "vmenuWiki", descKey: "vmenuWikiDesc", match: "wikilink link double 双链 链接" },
        ],
      },
      {
        key: "list",
        labelKey: "vmenuGList",
        match: "list bullet ordered task 列表 无序 有序 待办",
        children: [
          { key: "ul", icon: "•", labelKey: "vmenuUl", descKey: "vmenuUlDesc", match: "ul bullet 无序" },
          { key: "ol", icon: "1.", labelKey: "vmenuOl", descKey: "vmenuOlDesc", match: "ol ordered 有序" },
          { key: "todo", icon: "☑", labelKey: "vmenuTodo", descKey: "vmenuTodoDesc", match: "todo task 待办 任务" },
        ],
      },
      {
        key: "math",
        labelKey: "vmenuGMath",
        match: "math formula code 数学 公式 代码",
        children: [
          { key: "mathinline", icon: "∑", labelKey: "vmenuMathInline", descKey: "vmenuMathInlineDesc", match: "inline math 行内 公式" },
          { key: "mathblock", icon: "∫", labelKey: "vmenuMathBlock", descKey: "vmenuMathBlockDesc", match: "block math 行间 公式" },
          { key: "code", icon: "</>", labelKey: "vmenuCode", descKey: "vmenuCodeDesc", match: "code block fence 代码块" },
        ],
      },
      {
        key: "chart",
        labelKey: "vmenuGChart",
        match: "table mermaid chart diagram 表格 图表 流程图",
        children: [
          { key: "table", icon: "⊞", labelKey: "vmenuTable", descKey: "vmenuTableDesc", match: "table grid 表格" },
          { key: "mermaid", icon: "◇", labelKey: "vmenuMermaid", descKey: "vmenuMermaidDesc", match: "mermaid flow diagram 流程图" },
        ],
      },
      {
        key: "attach",
        labelKey: "vmenuGAttach",
        match: "attachment image picture 附件 图片",
        children: [
          { key: "image", icon: "IMG", labelKey: "vmenuImage", descKey: "vmenuImageDesc", match: "image picture photo 图片 插图" },
        ],
      },
    ];

    // ─────────── RTE 编辑面（知识库页专用，所见即所得）───────────
    // TipTap 富文本编辑器挂载 + 斜杠菜单 + 泡泡菜单 + 自动保存（2s 防抖 +
    // Ctrl+S + 卸载保底 + 冲突暂停）全部收拢在这里；落盘由 onSave(md, mode)
    // 回调承担（vault/write 带 _fm），mode ∈ auto|manual|overwrite，返回
    // 'ok'|'conflict'|'fail'。conflict 会暂停自动保存，直到父层重载
    // （docTick bump 重挂）或 overwrite 成功。
    // rteRef 直通 RTE 句柄（父层页条按钮 undo/redo/表格等照旧调用）。
    /** 知识库页面编辑器（一页一个实例，挂右栏签）：vendor RTE 可编辑态
     *  （editable:true），斜杠菜单 / 泡泡菜单 / 自动保存（2s 防抖 + Ctrl+S +
     *  卸载保底 + 冲突暂停）收在这里；落盘由 onSave(md, mode) 承担
     *  （POST /dsh-kit/vault/write，mtime CAS），mode ∈ auto|manual|overwrite，
     *  返回 'ok'|'conflict'|'gone'|'fail'。conflict / gone 都暂停自动保存：
     *  直到父层重载（docTick bump 重挂）或 overwrite 成功。
     *  ctlRef 暴露 { dirty, flush, flushManual, overwrite } 供切签与冲突条用。 */
    function RteEditor({ rteRef, ctlRef, docKey, docTick, initialMd, placeholder, labels, pages, onInsertImage, onReady, onWikiLink, resolveWiki, resolveSrc, onRelLink, onSave, onState, onPaste }) {
      const [libsReady, setLibsReady] = react.useState(false);
      const [libsFailed, setLibsFailed] = react.useState(false);
      const [inTableState, setInTableState] = react.useState(false);
      // 双链选择框：{x, y, above, query, sel} | null（只列库里已有的页，碎链没入口）
      const [pick, setPick] = react.useState(null);
      // 插入表格弹窗：{rows, cols} | null（斜杠菜单「图表 → 表格」点开自己填行列）
      const [tDlg, setTDlg] = react.useState(null);
      const rteHostRef = react.useRef(null);
      // 斜杠菜单：{query, sub, x, y, at} | null（/ 触发：行首或空白后，键入过滤，Esc/失焦关）
      const [menu, setMenu] = react.useState(null);
      const [menuIdx, setMenuIdx] = react.useState(0);
      // 泡泡菜单：{x, y, above} | null（选区非空时浮在选区上/下方）；bubPanel =
      // 展开的色板（"tc" 文字颜色 | "hc" 高亮）
      const [bub, setBub] = react.useState(null);
      const [bubPanel, setBubPanel] = react.useState(null);
      // ref 镜像 state：capture 监听读 ref，直接读 state 会停在旧渲染的闭包里
      const menuRef = react.useRef(menu);
      menuRef.current = menu;
      const menuIdxRef = react.useRef(menuIdx);
      menuIdxRef.current = menuIdx;
      const bubRef = react.useRef(bub);
      bubRef.current = bub;
      // 脏态用**位**记而不是拿 md 比：每次按键都比一次等于每次按键整篇序列化，
      // 长文档直接卡；挂载即干净、改动即脏、存成功即干净
      const dirtyRef = react.useRef(false);
      // 编辑代数：每次改动 +1。保存是异步的，返回时若代数已经变了（请求在飞期间
      // 又敲了字），就不能清脏位——否则关签时清理「无脏可存」而丢掉最后几次按键
      const editGenRef = react.useRef(0);
      const pausedRef = react.useRef(false); // 冲突 / 页面已不在 → 暂停自动保存
      const inTableRef = react.useRef(false);
      const initialMdRef = react.useRef(initialMd);
      initialMdRef.current = initialMd;
      // 父层回调 ref 镜像：编辑器实例闭包里永远读到最新
      const onReadyRef = react.useRef(onReady);
      onReadyRef.current = onReady;
      const onSaveRef = react.useRef(onSave);
      onSaveRef.current = onSave;
      // 本次挂载的串行保存入口（挂载 effect 建、清理时销）：控制面与自动保存共用一条
      // 队列，并发写必撞 CAS
      const saveQueueRef = react.useRef(null);
      const onStateRef = react.useRef(onState);
      onStateRef.current = onState;
      const onInsertImageRef = react.useRef(onInsertImage);
      onInsertImageRef.current = onInsertImage;
      const pagesRef = react.useRef(pages);
      pagesRef.current = pages;
      const confRef = react.useRef({ onWikiLink, resolveWiki, resolveSrc, onRelLink, labels, placeholder });
      confRef.current = { onWikiLink, resolveWiki, resolveSrc, onRelLink, labels, placeholder };

      // 光标所属标题链（面包屑）：heading 是顶层块互不嵌套，层级
      // 归属按「文档顺序」解释——从光标顶层块向前扫，遇到比链尾更高级（level
      // 更小）的标题就接上，得到 「# 一级 > ## 二级 > ### 三级」；二级标题归属
      // 它上面最近的同级/上级标题语境（二级属于最近的一级）。
      // 无任何标题覆盖返回空串隐藏
      const crumbOf = () => {
        const ed = rteRef.current?.editor;
        if (!ed) return "";
        try {
          const { $from } = ed.state.selection;
          const parts = [];
          let min = 99;
          for (let i = $from.index(0); i >= 0 && min > 1; i--) {
            const node = ed.state.doc.child(i);
            if (node.type.name !== "heading") continue;
            const level = Number(node.attrs.level ?? 1);
            if (level >= min) continue;
            const text = node.textBetween(0, node.content.size, "\n", " ").trim();
            if (text === "") continue;
            parts.unshift(`${"#".repeat(level)} ${text}`);
            min = level;
          }
          return parts.join(" > ");
        } catch {
          /* 文档替换瞬间 selection 可能短暂失效，按无标题处理 */
        }
        return "";
      };
      const report = () => {
        onStateRef.current?.({ dirty: dirtyRef.current, crumb: crumbOf() });
      };

      react.useEffect(() => {
        ensureRteLib()
          .then(() => ensureKatex())
          .then(() => setLibsReady(true))
          .catch(() => setLibsFailed(true));
      }, []);

      // 泡泡菜单重定位：选区非空且不在代码块内 → 浮在选区上方（放不下换
      // 下方）。selectionUpdate 高频回调只读 ref 不读 state；斜杠菜单开着时让位
      const bubbleSync = () => {
        const h = rteRef.current;
        const ed = h?.editor;
        if (!ed) return;
        const sel = ed.state.selection;
        if (sel.empty || menuRef.current !== null || ed.isActive("codeBlock")) {
          setBub(null);
          return;
        }
        const c1 = ed.view.coordsAtPos(sel.from);
        const c2 = ed.view.coordsAtPos(sel.to);
        if (!c1 || !c2) {
          setBub(null);
          return;
        }
        const above = Math.min(c1.top, c2.top) >= 44;
        setBub({
          x: Math.max(180, Math.min((c1.left + c2.right) / 2, window.innerWidth - 180)),
          y: above ? Math.min(c1.top, c2.top) - 8 : Math.max(c1.bottom, c2.bottom) + 8,
          above,
        });
      };
      // 当前层可见行：sub 空且无 query = 根级分组；有 query = 跨组扁平搜叶项；
      // sub 指向分组 = 该组子级。可传 mnArg 按暂态计算（syncSlashMenu 预判零匹配）
      const menuRows = (mnArg) => {
        const mn = mnArg ?? menuRef.current ?? { query: "", sub: null };
        const q = (mn.query ?? "").toLowerCase();
        if (mn.sub) {
          const group = VAULT_MENU.find((g) => g.key === mn.sub);
          const kids = group ? group.children : [];
          return q === "" ? kids : kids.filter((k) => (k.labelKey + k.match).toLowerCase().includes(q));
        }
        if (q !== "") {
          const out = [];
          for (const g of VAULT_MENU) {
            for (const k of g.children ?? [g]) {
              if ((g.labelKey + k.labelKey + g.match + k.match).toLowerCase().includes(q)) out.push(k);
            }
          }
          return out;
        }
        return VAULT_MENU;
      };
      // 双链选择框：贴光标弹，**只列库里已有的页**（碎链没入口，要连先建页）——
      // [[ 不做触发字符，那是要打得出来的字面文本，建链只走菜单
      const pickRowsOf = (query) => {
        const q = String(query ?? "").trim().toLowerCase();
        const list = pagesRef.current ?? [];
        return q === "" ? list : list.filter((p) => String(p.rel).toLowerCase().includes(q));
      };
      const openPick = () => {
        const ed = rteRef.current?.editor;
        if (!ed) return;
        const c = ed.view.coordsAtPos(ed.state.selection.from);
        const above = window.innerHeight - (c?.bottom ?? 220) < 260;
        setPick({
          x: Math.max(8, Math.min(c?.left ?? 240, (window.innerWidth || 1200) - 316)),
          y: above ? (c?.top ?? 200) - 6 : (c?.bottom ?? 220) + 4,
          above,
          query: "",
          sel: 0,
        });
      };
      const pickClose = () => {
        setPick(null);
        rteRef.current?.focus();
      };
      const pickInsert = (p) => {
        setPick(null);
        const h = rteRef.current;
        if (!h || !p) return;
        // 目标写 rel 还是页名：全库唯一时写页名（短、可读）；有重名就写 rel——
        // 解析同名优先，跨目录重名页照短名插会静默指向另一个页
        const base = pageBasename(p.rel);
        const dup = (pagesRef.current ?? []).some((q) => q !== p && pageBasename(q.rel).toLowerCase() === base.toLowerCase());
        h.insertWikiLink({ target: dup ? p.rel.replace(/\.md$/i, "") : base });
        h.editor.commands.insertContent(" ");
        h.focus();
      };
      // 选择框手势：↑↓ 选、Enter 落定、Esc 关；点框外即关（选区没动过，focus 即回原落点）
      react.useEffect(() => {
        if (pick === null) return undefined;
        const onKey = (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const dir = e.key === "ArrowDown" ? 1 : -1;
            setPick((prev) => {
              const list = pickRowsOf(prev.query);
              return { ...prev, sel: Math.max(0, Math.min(prev.sel + dir, list.length - 1)) };
            });
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const rows = pickRowsOf(pick.query);
            if (rows[pick.sel]) pickInsert(rows[pick.sel]);
            else pickClose();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            pickClose();
          }
        };
        const onDown = (e) => {
          if (e.target instanceof Element && e.target.closest(".dshk-vault-pick") !== null) return;
          pickClose();
        };
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("mousedown", onDown, true);
        return () => {
          window.removeEventListener("keydown", onKey, true);
          document.removeEventListener("mousedown", onDown, true);
        };
      }, [pick]);
      const tDlgPatch = (patch) => setTDlg((prev) => (prev === null ? prev : { ...prev, ...patch }));
      const tDlgInsert = () => {
        const d = tDlg;
        setTDlg(null);
        const rows = Math.min(20, Math.max(1, Math.round(Number(d?.rows)) || 3));
        const cols = Math.min(20, Math.max(1, Math.round(Number(d?.cols)) || 3));
        rteRef.current?.insertTable(rows, cols);
        rteRef.current?.focus();
      };
      /** 斜杠命令落地：先删掉 "/查询" 再套模板（菜单非破坏性，/ 是真实文本） */
      const applyMenuTemplate = (item) => {
        const h = rteRef.current;
        if (!h) return;
        const ed = h.editor;
        const { $from } = ed.state.selection;
        const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 80), $from.parentOffset, "\n", "\n");
        const m = /(?:^|[\s\u3000-\u303F\uFF01-\uFF5E])\/(\S*)$/.exec(textBefore);
        setMenu(null);
        if (m) {
          ed.view.dispatch(ed.view.state.tr.delete(Math.max(0, $from.pos - (m[1] ?? "").length - 1), $from.pos));
        }
        h.focus();
        if (!m) return;
        const key = item.key ?? "";
        if (key === "table") setTDlg({ rows: 3, cols: 3 });
        else if (key === "mermaid") {
          h.insertMermaidBlock();
          // 节点视图插入后自开源码框，但这次点击收尾时编辑器把焦点抢回正文，
          // 框当场失焦即收起（空图块等于白插一次）；下一帧补一次点击把编辑态拉回来
          requestAnimationFrame(() => rteHostRef.current?.querySelector(".dshk-mermaid")?.click());
        }
        else if (key === "image") onInsertImageRef.current?.();
        else if (key === "wiki") openPick();
        else if (key === "mathinline") h.insertMathInline();
        else if (key === "mathblock") h.insertMathBlock();
        else if (key === "code") h.insertCodeBlock();
        else if (key === "hr") h.insertHr();
        else if (key === "fold") h.insertDetails();
        else if (key === "ul") h.toggleBullet();
        else if (key === "ol") h.toggleOrdered();
        else if (key === "todo") h.toggleTask();
        else if (key === "quote") h.toggleQuote();
        else if (key === "body") h.setParagraph();
        else if (/^h[1-6]$/.test(key)) h.setHeading(Number(key.slice(1)));
      };
      const rteCmd = (fn) => {
        const h = rteRef.current;
        if (!h) return;
        fn(h);
        h.focus();
        bubbleSync();
      };
      /** 泡泡按钮点亮态：TipTap isActive */
      const bubActive = (name) => rteRef.current?.isActive(name) ?? false;
      /** 链接（prompt 交互）：已有链接改地址（空=删除），否则包新链接 */
      const bubLink = () =>
        rteCmd((h) => {
          const ed = h.editor;
          if (ed.isActive("link")) {
            const href = ed.getAttributes("link").href ?? "";
            const action = window.prompt(t("vtbLinkEditPrompt"), href);
            if (action === null) return;
            if (action.trim() === "") h.unsetLink();
            else h.setLink(action.trim());
          } else {
            const url = window.prompt(t("vtbLinkPrompt"), "https://");
            if (url) h.setLink(url.trim());
          }
        });
      const BUB_COLORS = ["#000000", "#333333", "#666666", "#999999", "#e03131", "#e8590c", "#f08c00", "#2f9e44", "#099268", "#1971c2", "#7048e8", "#d6336c"];
      const BUB_HIGHLIGHTS = ["#fff3bf", "#ffec99", "#ffe066", "#b2f2bb", "#99e9f2", "#bac8ff", "#d0bfff", "#ffc9c9", "#ffd8a8", "#fcc2d7"];

// 编辑器挂载（实例写 rteRef，文档变更防抖回写 + 自动保存，选区变化刷
      // 泡泡/斜杠/表格态）。docKey=归属路径；docTick 变化强制重挂（外部修改重读 /
      // 冲突回读）。自动保存钉住挂载页（docKey 局部闭包），切页后的卸载保底不会
      // 写错路径。就绪即回调 onReady——跨页锚点落位在这里消费
      react.useEffect(() => {
        const host = rteHostRef.current;
        if (!libsReady || libsFailed || !host) return undefined;
        const mountedKey = docKey;
        // 本次挂载的保存函数（卸载兜底用）：ref 镜像每帧都指向最新 onSave，清理时
        // 已经是新页那一版了
        const mountedSave = onSaveRef.current;
        const cf = confRef.current;
        const opts = {
          md: initialMdRef.current ?? "",
          // 所见即所得：页面恒为可编辑富文本，没有只读/编辑两态
          editable: true,
          placeholder: cf.placeholder,
          labels: cf.labels,
        };
        if (cf.onWikiLink) opts.onWikiLink = cf.onWikiLink;
        if (cf.resolveWiki) opts.resolveWiki = cf.resolveWiki;
        if (cf.resolveSrc) opts.resolveSrc = cf.resolveSrc;
        const h = window.DshRTE.create(host, opts);
        rteRef.current = h;
        pausedRef.current = false;
        dirtyRef.current = false;
        report();
        // 就绪回报：新开页签时 pane 先以 active=true 挂载、那时编辑器还没建（内容还在
        // 拉），激活沿那次锚点认领会落空——跨页锚点要在这里补认领（onReady 曾只赋值
        // 没调用，锚点跳转因此静默失效）
        onReadyRef.current?.();
        // 阅读位置：滚动节流记录 + create 之后一拍恢复（挂载即恢复会白设——
        // maxScroll 未建立）。docKey=归属路径
        let posTimer = null;
        const posAnchor = () => {
          try { return h.editor.state.selection.from; } catch { return 0; }
        };
        const onPosScroll = () => {
          if (posTimer !== null) return;
          posTimer = setTimeout(() => {
            posTimer = null;
            recordReadPos(mountedKey, host, posAnchor());
          }, 300);
        };
        host.addEventListener("scroll", onPosScroll);
        const cancelRestore = restoreReadPos(mountedKey, host, (anchor) => {
          try {
            const size = h.editor.state.doc.content.size;
            if (typeof anchor === "number" && anchor <= size) h.editor.commands.setTextSelection(anchor);
          } catch {
            /* 选区失效按纯滚动恢复 */
          }
        });
        // 自动保存（2s 防抖）：改动置脏，2s 后落盘；冲突/页面已不在则暂停。
        // **一条队列串行落盘**：并发两次写拿的是同一个 baseMtime，后一次必撞 CAS
        // 回 modified，用户看到的是自己刚存过一次造成的假冲突条；在飞期间的请求
        // 只记一次待办（manual/overwrite 优先），排在前一次落地后按最新内容再存
        let saveTimer = null;
        let saving = false;
        let queuedMode = null;
        const runSave = async (mode) => {
          const hh = rteRef.current;
          if (!hh) return "fail";
          const gen = editGenRef.current;
          const outcome = await onSaveRef.current(hh.getMd(), mode);
          // 只有「这次请求发出的内容」仍是最新时才清脏；在飞期间的改动另有一次保存
          if (outcome === "ok") {
            if (gen === editGenRef.current) dirtyRef.current = false;
          } else if (outcome !== "fail") pausedRef.current = true;
          report();
          return outcome;
        };
        // 排队跑完当前这次与所有待办；mode=auto 且已暂停时不入队
        const drain = async (first) => {
          if (saving) {
            if (first !== "auto" || queuedMode === null) queuedMode = first;
            return "queued";
          }
          saving = true;
          try {
            let out = await runSave(first);
            while (queuedMode !== null) {
              const next = queuedMode;
              queuedMode = null;
              out = await runSave(next);
            }
            return out;
          } finally {
            saving = false;
          }
        };
        const localAutosave = () => (pausedRef.current ? undefined : drain("auto"));
        // 控制面（切签 flush / Ctrl+S / 冲突覆盖）走同一条队列
        const enqueueSave = drain;
        saveQueueRef.current = enqueueSave;
        const flushSave = () => {
          if (saveTimer === null) return;
          saveTimer = null;
          void localAutosave();
        };
        const offUpdate = h.onUpdate(() => {
          dirtyRef.current = true;
          editGenRef.current += 1;
          report();
          clearTimeout(saveTimer);
          saveTimer = setTimeout(flushSave, 2000);
        });
        // 斜杠菜单同步：光标前 /xxx（行首/空白/CJK 或全角标点后，行中也能触发）
        // 即开/刷新菜单，前缀破坏即关。挂 update + selectionUpdate 覆盖全部输入
        // 路径（真实键入/IME/命令改写）。边界集与 applyMenuTemplate 的删除正则
        // 必须同源；ASCII 字母数字与 / 后不触发（URL 不捣乱）
        const syncSlashMenu = () => {
          const ed = rteRef.current?.editor;
          if (!ed) return;
          const { $from } = ed.state.selection;
          const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 80), $from.parentOffset, "\n", "\n");
          const m = /(?:^|[\s\u3000-\u303F\uFF01-\uFF5E])\/(\S*)$/.exec(textBefore);
          if (m) {
            const q = m[1] ?? "";
            // 查询无匹配即关：字面 "/" 打完随后出现的字符会让过滤落空，自动消失
            // 才不纠缠（菜单非破坏性，/ 始终是真实文本）
            if (q !== "" && menuRows({ query: q, sub: null }).length === 0) {
              setMenu(null);
              return;
            }
            const coords = ed.view.coordsAtPos($from.pos);
            // 查询变了高亮要回第一条：过滤后行序整个换掉，沿用旧下标会点在
            // 另一个条目上（甚至下标越界，按 Enter 插的是没高亮那一条）
            if (q !== menuRef.current?.query) {
              menuIdxRef.current = 0;
              setMenuIdx(0);
            }
            setMenu({ query: q, sub: null, x: coords?.left ?? 240, y: (coords?.bottom ?? 200) + 4, at: coords?.top ?? 0 });
          } else if (menuRef.current !== null) {
            setMenu(null);
          }
        };
        const offSelection = h.onSelectionUpdate(() => {
          bubbleSync();
          syncSlashMenu();
          const active = rteRef.current?.inTable() === true;
          if (active !== inTableRef.current) {
            inTableRef.current = active;
            setInTableState(active);
          }
          report();
        });
        const onKeyDown = (e) => {
          // 空图块退格删块：源码框空着时退格在框内是空操作，而图块节点的
          // stopEvent 恒真（编辑器不接管），框和块都不动——自己收这个块。
          // 位置按 DOM 反查（nodeDOM 与节点视图的 dom 是同一个对象），
          // 不靠 posAtDOM：图块是 atom，边界位置推不准。
          if (e.key === "Backspace" || e.key === "Delete") {
            const ta = e.target;
            const wrap = ta instanceof Element ? ta.closest(".dshk-mermaid") : null;
            const ed = rteRef.current?.editor;
            if (wrap !== null && ed !== undefined && ed !== null && ta.classList.contains("dshk-mermaid-input") && ta.value === "") {
              let pos = -1;
              ed.view.state.doc.descendants((node, p) => {
                if (node.type.name !== "mermaidBlock") return true;
                if (ed.view.nodeDOM(p) === wrap) { pos = p; return false; }
                return true;
              });
              if (pos === -1) return;
              e.preventDefault();
              e.stopPropagation();
              const view = ed.view;
              view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos).nodeSize));
              view.focus();
              return;
            }
          }
          // Tab / Shift+Tab：列表里升降级，其余一律吃掉（浏览器默认会把焦点带出编辑器）。
          // 表格与代码块放行给编辑器下层（表格跳格、代码块插两空格）
          if (e.key === "Tab") {
            const ed = rteRef.current?.editor;
            if (!ed) return;
            let ctx = "other";
            try {
              const { $from } = ed.state.selection;
              for (let d = $from.depth; d > 0; d--) {
                const name = $from.node(d).type.name;
                if (name === "tableCell" || name === "tableHeader") { ctx = "table"; break; }
                if (name === "codeBlock") { ctx = "code"; break; }
                if (name === "listItem") { ctx = "list"; break; }
                if (name === "taskItem") { ctx = "task"; break; }
              }
            } catch {
              return;
            }
            if (ctx === "table" || ctx === "code") return;
            e.preventDefault();
            e.stopPropagation();
            try {
              if (ctx === "list") (e.shiftKey ? ed.commands.liftListItem("listItem") : ed.commands.sinkListItem("listItem"));
              else if (ctx === "task") (e.shiftKey ? ed.commands.liftListItem("taskItem") : ed.commands.sinkListItem("taskItem"));
            } catch {
              /* schema 没有对应命令就当没按 */
            }
            return;
          }
          // Ctrl+Enter 在引用里：在引用块之后插一段（跳出去继续写正文）
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            const ed = rteRef.current?.editor;
            if (!ed) return;
            try {
              const { $from } = ed.state.selection;
              for (let d = $from.depth; d > 0; d--) {
                if ($from.node(d).type.name !== "blockquote") continue;
                e.preventDefault();
                e.stopPropagation();
                ed.chain().focus().insertContentAt($from.after(d), { type: "paragraph" }).run();
                return;
              }
            } catch {
              /* 结构变了按默认走 */
            }
          }
          // Ctrl+S：立即落盘（toast 反馈在 onSave 的 manual 分支）。
          // 先撤掉待触发的防抖（同内容不必再存一遍，mtime 少搅一次），再走串行队列
          // ——清脏与排队都由队列按编辑代数决定
          if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            e.stopPropagation();
            clearTimeout(saveTimer);
            saveTimer = null;
            void enqueueSave("manual");
            return;
          }
          // 泡泡菜单开着时 Esc 关它（分层：先色板后泡泡），不拦编辑器的其它按键
          if (menuRef.current === null && bubRef.current !== null && e.key === "Escape") {
            e.stopPropagation();
            setBubPanel(null);
            setBub(null);
            return;
          }
          if (menuRef.current !== null) {
            const rows = menuRows();
            const idx = rows.length === 0 ? 0 : Math.min(menuIdxRef.current, rows.length - 1);
            const row = rows[idx];
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setMenu(null);
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              menuIdxRef.current = rows.length === 0
                ? 0
                : e.key === "ArrowDown"
                  ? Math.min(idx + 1, rows.length - 1)
                  : Math.max(0, idx - 1);
              setMenuIdx(menuIdxRef.current);
              return;
            }
            if (e.key === "ArrowRight" && row && row.children) {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ ...menuRef.current, sub: row.key });
              menuIdxRef.current = 0;
              setMenuIdx(0);
              return;
            }
            if (e.key === "ArrowLeft" && menuRef.current.sub) {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ ...menuRef.current, sub: null });
              menuIdxRef.current = 0;
              setMenuIdx(0);
              return;
            }
            // 数字键 1-9 直达：分类层跳进第 n 组，条目层直接应用
            if (/^[1-9]$/.test(e.key)) {
              const target = rows[Number(e.key) - 1];
              if (!target) return;
              e.preventDefault();
              e.stopPropagation();
              if (target.children) {
                setMenu({ ...menuRef.current, sub: target.key });
                menuIdxRef.current = 0;
                setMenuIdx(0);
              } else {
                applyMenuTemplate(target);
              }
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (!row) {
                setMenu(null);
                return;
              }
              if (row.children) {
                setMenu({ ...menuRef.current, sub: row.key });
                menuIdxRef.current = 0;
                setMenuIdx(0);
                return;
              }
              applyMenuTemplate(row);
              return;
            }
          }
        };
        host.addEventListener("keydown", onKeyDown, true);
        // 滚动/窗口变化跟随：泡泡/斜杠菜单都是 fixed 定位，坐标只在重定位时刷新
        const onScrollOrResize = () => bubbleSync();
        host.addEventListener("scroll", onScrollOrResize, true);
        window.addEventListener("resize", onScrollOrResize);
        // 泡泡点击外部收起：编辑器内的点击由 selectionUpdate 处理（收光标即关、
        // 拖拽重选即跟位）；点在编辑器与泡泡之外（页条/空白/反链区）不产生选区
        // 变化事件，泡泡会卡在原地——document 捕获阶段兜底关闭
        const onDocMouseDown = (e) => {
          if (bubRef.current === null) return;
          const tEl = e.target;
          if (!(tEl instanceof Element)) return;
          if (tEl.closest(".dshk-vault-bubble") !== null || host.contains(tEl)) return;
          setBubPanel(null);
          setBub(null);
        };
        document.addEventListener("mousedown", onDocMouseDown, true);
        return () => {
          clearTimeout(saveTimer);
          saveQueueRef.current = null;
          // 阅读位置兜底记一次（隐藏容器由 recordReadPos 自行跳过）
          if (posTimer !== null) clearTimeout(posTimer);
          cancelRestore();
          host.removeEventListener("scroll", onPosScroll);
          recordReadPos(mountedKey, host, posAnchor());
          // 有防抖未触发的改动 → 卸载前尽力落盘（保底）。**走挂载那一刻的保存
          // 函数**：清理发生在新一次渲染之后，onSaveRef.current 已经是**新页**的
          // 了——拿它存旧页的内容等于把上一页的字写进下一页
          if (!pausedRef.current && dirtyRef.current && rteRef.current) {
            void mountedSave(rteRef.current.getMd(), "auto");
          }
          offUpdate();
          offSelection();
          host.removeEventListener("keydown", onKeyDown, true);
          host.removeEventListener("scroll", onScrollOrResize, true);
          window.removeEventListener("resize", onScrollOrResize);
          document.removeEventListener("mousedown", onDocMouseDown, true);
          setBub(null);
          setBubPanel(null);
          h.destroy();
          rteRef.current = null;
        };
        // initialMd 取挂载瞬间的盘上内容（ref），后续走 onUpdate 回写；
        // 日常保存不重挂（docTick 不动），打开新页（docKey）/外部重读（docTick）才重挂
      }, [libsReady, libsFailed, docKey, docTick]);

      // 控制面暴露给父层：切签 flush / Ctrl+S 语义 / 覆盖盘上 / 脏判定。
      // 三条保存路径都走挂载那条**串行队列**（并发写必撞 CAS），清脏与排队由队列
      // 按编辑代数决定（见 editGenRef）：在飞期间的改动另有一次保存
      const enqueued = (mode) => async () => {
        if (!rteRef.current) return "fail";
        if (pausedRef.current && mode === "auto") return "fail";
        const enqueue = saveQueueRef.current;
        const outcome = enqueue === null ? "fail" : await enqueue(mode);
        if (outcome === "ok" && mode === "overwrite") pausedRef.current = false;
        return outcome;
      };
      ctlRef.current = {
        dirty: () => dirtyRef.current,
        flush: enqueued("auto"),
        flushManual: enqueued("manual"),
        overwrite: enqueued("overwrite"),
      };

      // 链接点击：RTE 的 Link 扩展 openOnClick:false（浏览器在 contenteditable 里
      // 也不会自己跳），所有链接都得显式接管，否则一律「点了没反应」。文档内链接
      //  （相对/站内/裸路径）交父层解析成文件/页，带协议或 // 的走外链。
      const onLinkClick = (e) => {
        const el = e.target && typeof e.target.closest === "function" ? e.target.closest("a[href]") : null;
        if (!el) return;
        const href = (el.getAttribute("href") || "").trim();
        // 拖选后松手也会发 click：选区非折叠说明在选字，不是在点链接
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        if (!isDocHref(href)) {
          // 页内锚点仍归编辑器自己滚
          if (href === "" || href.startsWith("#")) return;
          e.preventDefault();
          e.stopPropagation();
          openExternalUrl(href);
          return;
        }
        const cb = confRef.current.onRelLink;
        if (typeof cb !== "function") return;
        e.preventDefault();
        e.stopPropagation();
        cb(href, el.textContent || "");
      };
      return jsxRuntime.jsxs("div", { className: "dshk-vault-editwrap", onPaste, onClickCapture: onLinkClick, children: [
        libsFailed
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultLibsFail") })
          : jsxRuntime.jsx("div", { className: "dshk-vault-rtehost dshk-md", ref: rteHostRef }),
        menu !== null
          ? jsxRuntime.jsx(
              "div",
              {
                className: "dshk-vault-slashmenu",
                // 位置自适应：默认光标下方；下方放不下翻到光标上方
                // （再不够就贴顶滚动），横向钳在视口内。行高按当前
                // 样式估算（叶子 30px，含容器纵向 padding）
                style: (() => {
                  const rowCount = menuRows({ query: menu.query ?? "", sub: menu.sub ?? null }).length;
                  const h = Math.min(rowCount * 30 + 8, 300);
                  const top = menu.y + h > window.innerHeight - 8
                    ? Math.max(8, (menu.at ?? menu.y) - h - 6)
                    : menu.y;
                  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 176));
                  return { left, top };
                })(),
                children: (() => {
                  const rows = menuRows();
                  const group = menu.sub ? VAULT_MENU.find((g) => g.key === menu.sub) : null;
                  const backRow = group
                    ? jsxRuntime.jsxs("div", {
                        className: "dshk-vault-slashback",
                        onMouseDown: (e) => {
                          e.preventDefault();
                          setMenu({ ...menuRef.current, sub: null });
                          menuIdxRef.current = 0;
                          setMenuIdx(0);
                        },
                        children: ["‹ ", t(group.labelKey)],
                      }, "back")
                    : null;
                  const rowsJsx = rows.length === 0
                    ? [jsxRuntime.jsx("div", { className: "dshk-vault-slashitem", children: t("vaultSearchEmpty") }, "empty")]
                    : rows.map((row, i) => {
                        const isGroup = !!row.children;
                        return jsxRuntime.jsxs(
                          "div",
                          {
                            className: `dshk-vault-slashitem${i === menuIdx ? " is-active" : ""}`,
                            onMouseDown: (e) => {
                              e.preventDefault();
                              if (isGroup) {
                                setMenu({ ...menuRef.current, sub: row.key });
                                menuIdxRef.current = 0;
                                setMenuIdx(0);
                              } else applyMenuTemplate(row);
                            },
                            children: isGroup
                              ? [
                                  // 分类行：序号徽章 + 组名 + ›
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashnum", children: i + 1 }, "num"),
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashtitle", children: t(row.labelKey) }, "title"),
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashmore", children: "›" }, "more"),
                                ]
                              : [
                                  // 条目行：图标徽章 + 标题/描述两行
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashicon", children: row.icon }, "icon"),
                                  jsxRuntime.jsxs("span", { className: "dshk-vault-slashtext", children: [
                                    jsxRuntime.jsx("span", { className: "dshk-vault-slashtitle", children: t(row.labelKey) }, "title"),
                                    jsxRuntime.jsx("span", { className: "dshk-vault-slashdesc", children: t(row.descKey) }, "desc"),
                                  ] }, "text"),
                                ],
                          },
                          (menu.sub ? menu.sub + "-" : "") + row.key,
                        );
                      });
                  return [backRow, ...rowsJsx];
                })(),
              },
              "slashmenu",
            )
          : null,
        bub !== null
          ? jsxRuntime.jsxs(
              "div",
              {
                className: "dshk-vault-bubble",
                style: { left: bub.x, top: bub.above ? undefined : bub.y, bottom: bub.above ? window.innerHeight - bub.y : undefined },
                onMouseDown: (e) => e.preventDefault(),
                children: [
                  jsxRuntime.jsxs("div", { className: "dshk-vault-bubblebar", children: [
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("bold") ? " is-active" : ""}`, title: t("vtbBold"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleBold().run()), children: "B" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("italic") ? " is-active" : ""}`, title: t("vtbItalic"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleItalic().run()), children: "I" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("underline") ? " is-active" : ""}`, title: t("vtbUnderline"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleUnderline().run()), children: "U̲" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("strike") ? " is-active" : ""}`, title: t("vtbStrike"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleStrike().run()), children: "S̶" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("superscript") ? " is-active" : ""}`, title: t("vtbSup"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleSuperscript().run()), children: "x²" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("subscript") ? " is-active" : ""}`, title: t("vtbSub"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleSubscript().run()), children: "x₂" }),
                    jsxRuntime.jsx("span", { className: "dshk-vault-bsep" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubPanel === "tc" ? " is-active" : ""}`, title: t("vtbColor"), onClick: () => setBubPanel((p) => (p === "tc" ? null : "tc")), children: "A" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubPanel === "hc" ? " is-active" : ""}`, title: t("vtbHighlight"), onClick: () => setBubPanel((p) => (p === "hc" ? null : "hc")), children: "▩" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("code") ? " is-active" : ""}`, title: t("vtbCode"), onClick: () => rteCmd((h) => h.editor.chain().focus().toggleCode().run()), children: "‹›" }),
                    jsxRuntime.jsx("span", { className: "dshk-vault-bsep" }),
                    jsxRuntime.jsx("button", { type: "button", className: `dshk-vault-bbtn${bubActive("link") ? " is-active" : ""}`, title: t("vtbLink"), onClick: bubLink, children: "🔗" }),
                    jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtbClear"), onClick: () => rteCmd((h) => h.clearFormat()), children: "⌫" }),
                  ] }),
                  // 表格浮条（选区落在表内才出）：文字键同一条 tablebar 规格，
                  // 命令作用在选区覆盖到的行列上。不做合并/拆分（md 管道表没有 colspan 载体）
                  inTableState
                    ? jsxRuntime.jsx("div", { className: "dshk-vault-bubblebar", children: [
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblRowAbove"), onClick: () => rteCmd((h) => h.tableAddRow(false)), children: "行↑" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblRowBelow"), onClick: () => rteCmd((h) => h.tableAddRow(true)), children: "行↓" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblRowDel"), onClick: () => rteCmd((h) => h.tableDeleteRow()), children: "−行" }),
                      jsxRuntime.jsx("span", { className: "dshk-vault-bsep" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblColLeft"), onClick: () => rteCmd((h) => h.tableAddCol(false)), children: "列←" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblColRight"), onClick: () => rteCmd((h) => h.tableAddCol(true)), children: "列→" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblColDel"), onClick: () => rteCmd((h) => h.tableDeleteCol()), children: "−列" }),
                      jsxRuntime.jsx("span", { className: "dshk-vault-bsep" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblAlignL"), onClick: () => rteCmd((h) => h.editor.chain().setCellAttribute("align", "left").run()), children: "左" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblAlignC"), onClick: () => rteCmd((h) => h.editor.chain().setCellAttribute("align", "center").run()), children: "中" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblAlignR"), onClick: () => rteCmd((h) => h.editor.chain().setCellAttribute("align", "right").run()), children: "右" }),
                      jsxRuntime.jsx("span", { className: "dshk-vault-bsep" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblHeadCol"), onClick: () => rteCmd((h) => h.editor.chain().toggleHeaderColumn().run()), children: "头列" }),
                      jsxRuntime.jsx("span", { className: "dshk-vault-bsep" }),
                      jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-bbtn", title: t("vtblDelTable"), onClick: () => rteCmd((h) => h.tableDelete()), children: "✕表" }),
                    ] })
                    : null,
                  bubPanel !== null
                    ? jsxRuntime.jsx("div", { className: "dshk-vault-bswatchrow", children: (bubPanel === "tc" ? BUB_COLORS : BUB_HIGHLIGHTS).map((c) =>
                        jsxRuntime.jsx("button", {
                          type: "button",
                          className: "dshk-vault-bswatch",
                          style: { background: c },
                          onClick: () => {
                            if (bubPanel === "tc") rteCmd((h) => h.setColor(c));
                            else rteCmd((h) => h.setHighlight(c));
                            setBubPanel(null);
                          },
                        }, c),
                      ).concat([
                        jsxRuntime.jsx("button", {
                          type: "button",
                          className: "dshk-vault-bswatch-clear",
                          onClick: () => {
                            rteCmd((h) => (bubPanel === "tc" ? h.unsetColor() : h.unsetHighlight()));
                            setBubPanel(null);
                          },
                          children: t("vtbClearColor"),
                        }, "clear"),
                      ]) })
                    : null,
                ],
              },
              "bubble",
            )
          : null,
        // 双链选择框：贴光标弹（下方放不下翻到上方），只列库里已有的页
        pick !== null
          ? jsxRuntime.jsx(
              "div",
              {
                className: "dshk-vault-pick",
                style: {
                  left: pick.x,
                  top: pick.y,
                  ...(pick.above ? { bottom: window.innerHeight - pick.y } : {}),
                },
                children: [
                  jsxRuntime.jsx("input", {
                    className: "dshk-vault-pickinput",
                    value: pick.query,
                    placeholder: t("vlinkSearch"),
                    autoFocus: true,
                    onChange: (e) => setPick((prev) => (prev === null ? prev : { ...prev, query: e.target.value, sel: 0 })),
                  }),
                  jsxRuntime.jsxs("div", { className: "dshk-vault-picklist", children: (() => {
                    const rows = pickRowsOf(pick.query);
                    if (rows.length === 0) return [jsxRuntime.jsx("div", { className: "dshk-vault-pickempty", children: t("vlinkEmpty") }, "empty")];
                    return rows.map((p, i) =>
                      jsxRuntime.jsxs(
                        "div",
                        {
                          className: `dshk-vault-pickitem${i === pick.sel ? " is-cur" : ""}`,
                          onMouseEnter: () => setPick((prev) => (prev === null ? prev : { ...prev, sel: i })),
                          onMouseDown: (e) => {
                            e.preventDefault();
                            pickInsert(p);
                          },
                          children: [
                            jsxRuntime.jsx("span", { className: "dshk-vault-pickname", children: pageBasename(p.rel) }),
                            jsxRuntime.jsx("span", { className: "dshk-vault-pickrel", children: p.rel }),
                          ],
                        },
                        p.path,
                      ),
                    );
                  })() }),
                ],
              },
              "wikipick",
            )
          : null,
        // 插入表格弹窗：行列自己填（固定尺寸那几档实际只用得到一两个）
        tDlg !== null
          ? jsxRuntime.jsx(VaultDialog, {
              title: t("vmenuTable"),
              onClose: () => {
                setTDlg(null);
                rteRef.current?.focus();
              },
              children: jsxRuntime.jsxs("div", { className: "dshk-vault-tabledlg", children: [
                jsxRuntime.jsxs("label", { children: [
                  jsxRuntime.jsx("span", { children: t("vtableRows") }),
                  jsxRuntime.jsx("input", { type: "number", min: 1, max: 20, value: tDlg.rows, onChange: (e) => tDlgPatch({ rows: e.target.value }) }),
                ] }, "rows"),
                jsxRuntime.jsxs("label", { children: [
                  jsxRuntime.jsx("span", { children: t("vtableCols") }),
                  jsxRuntime.jsx("input", { type: "number", min: 1, max: 20, value: tDlg.cols, onChange: (e) => tDlgPatch({ cols: e.target.value }) }),
                ] }, "cols"),
                jsxRuntime.jsx("span", { className: "dshk-vault-tabledlg-hint", children: `${t("vtableHint")} · ${t("vtableRange")}` }),
                jsxRuntime.jsxs("div", { className: "dshk-vault-tabledlg-row", children: [
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", onClick: () => {
                    setTDlg(null);
                    rteRef.current?.focus();
                  }, children: t("vtableCancel") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn is-primary", onClick: tDlgInsert, children: t("vtableOk") }),
                ] }, "btns"),
              ] }),
            }, "tabledlg")
          : null,
      ] });
    }

    /** 知识库索引半边（单实例，portal 进侧栏索引宿主）：工具条/目录树/搜索 +
     *  页标签编排（打开、关闭）。页编辑器不在本组件——每开一页一个
     *  VaultPagePane 经 portal 投进右栏 pane 宿主，一页一标签（多开）。
     *  树根默认 = 库根（vaultRoot），可在任意目录行上「在此打开」（或 Ctrl+点击）
     *  换到该目录，树头 ← 回库根。 */
    function VaultRootView() {
      const ui = useKitUi();
      const sideHost = useHostSlot(vaultSideSlot);
      const [index, setIndex] = react.useState(null);
      const [indexErr, setIndexErr] = react.useState("");
      // 面板的树根：null = 库根（vaultRoot）；非 null = 进入的绝对目录
      // （Ctrl+点击目录行 / 搜索结果点笔记目录；只影响本组件显示，不写配置页）
      const [rootHere, setRootHere] = react.useState(null);
      // 目录树：path → entries|null(加载中)；expanded: path → bool
      const [treeDirs, setTreeDirs] = react.useState({});
      const [expanded, setExpanded] = react.useState({});
      // 树行/树头 ⋯ 菜单（条目 + 锚点矩形）：重命名 / 移动到… / 导入… / 复制绝对路径 / 删除
      const [rowMenu, setRowMenu] = react.useState(null);
      const [searchQ, setSearchQ] = react.useState("");
      const [searchRes, setSearchRes] = react.useState(null);
      const [searchIdx, setSearchIdx] = react.useState(0);
      const [searchRect, setSearchRect] = react.useState(null);
      const searchRef = react.useRef(null);
      const searchTimer = react.useRef(null);
      const searchSeq = react.useRef(0);
      const [toast, setToast] = react.useState("");

      const current = useActiveRightbarItem("vault");
      // root 从 index 响应取而非入参；null = 索引未就绪（加载中/未配置/失败），
      // 整页态由下方早退分支承担
      const root = index !== null && typeof index.root === "string" && index.root !== "" ? index.root : null;
      const treeRoot = rootHere ?? root;
      // 资料库（根下 library/）：宿主给的清单只为计数与检索，树仍逐层现拉
      const libRoot = index !== null && index.library && typeof index.library.root === "string" ? index.library.root : null;
      const libItems = (index !== null && index.library && Array.isArray(index.library.items) ? index.library.items : []);

      const loadIndex = react.useCallback(async () => {
        try {
          const body = await kitJson("/dsh-kit/vault/index");
          setIndex(body);
          setIndexErr(body && body.root ? "" : "vault-not-configured");
          // M4：同步给对话拦截器做 vault 路径路由判定
          vaultRootHint = body && typeof body.root === "string" && body.root !== "" ? body.root : null;
        } catch (error) {
          setIndexErr(String(error?.message ?? error));
        }
      }, []);
      react.useEffect(() => {
        void loadIndex();
      }, [loadIndex]);
      /** 单层目录重取。silent = 背景重拉：不先清空成「加载中」，失败也保留旧条目
       *  （目录被删时父层的新条目已不含它，旧条目自然够不着，不必靠清空兜底）。
       *  非 silent = 交互路径（展开/换根后），要的就是「正在加载」与失败即空。
       *  资料库子树里不过滤扩展名（PDF 等文献也要看得见），笔记树只留 md。 */
      const fetchDir = react.useCallback(async (dir, silent = false) => {
        if (!silent) setTreeDirs((d) => ({ ...d, [dir]: null }));
        const lib = libRootRef.current;
        const all = lib !== null && relUnder(lib, dir) !== null;
        try {
          const body = await kitJson(`/dsh-kit/tree?path=${encodeURIComponent(dir)}`);
          const usable = (body.entries ?? []).filter((e) => {
            if (e.name.startsWith(".")) return false;
            // 库根下 library 由「资料库」那一行代表，这里跳过
            if (!all && lib !== null && e.path === lib) return false;
            if (e.dir) return all || !["attachments", "node_modules"].includes(e.name);
            return all || /\.md$/i.test(e.name);
          });
          setTreeDirs((d) => ({ ...d, [dir]: usable }));
        } catch {
          if (!silent) setTreeDirs((d) => ({ ...d, [dir]: [] }));
        }
      }, []);

      // 索引 + 已展开目录一起重拉的唯一实现（工具条 ↻ 与背景自动刷新共用）。
      // 目录树是懒加载缓存（treeDirs），只调 loadIndex 换不到树上的条目——外部
      // 增删的文件在侧栏看不见，刷新就等于没刷。
      // 展开态走 ref 读：免得这个回调跟着每次展开动作重建、把背景定时器重置
      const expandedRef = react.useRef(expanded);
      expandedRef.current = expanded;
      // 资料库根走 ref 读：fetchDir 按「这一层在不在资料库里」决定收不收非 md 文件，
      // 但索引每次重拉都会换对象——挂进依赖会让整棵树在每次刷新后重建
      const libRootRef = react.useRef(null);
      libRootRef.current = libRoot;
      const reloadData = react.useCallback(async () => {
        const dirs = Object.keys(expandedRef.current).filter((d) => expandedRef.current[d] === true);
        await loadIndex();
        await Promise.all(dirs.map((d) => fetchDir(d, true)));
      }, [loadIndex, fetchDir]);

      // 外部增删文件及时可见：打开页的正文
      // 刷新由 stat 轮询管，树/索引靠这里——窗口聚焦 + 30s 周期重拉；全程静默
      // （mtime 缓存让无变化的重拉接近零成本，不闪「加载中」也不弹提示）
      react.useEffect(() => {
        const refresh = () => {
          if (document.visibilityState === "hidden") return;
          void reloadData();
        };
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        const timer = setInterval(refresh, 30000);
        return () => {
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", refresh);
          clearInterval(timer);
        };
      }, [reloadData]);

      // 工具条 ↻：手动刷新要看得见结果，给 toast 回执；刷新中禁用按钮防连点
      const [refreshing, setRefreshing] = react.useState(false);
      // 搜索点到资料库目录后要滚到的那一行（见 revealLibDir / 下面的 effect）
      const [revealPath, setRevealPath] = react.useState(null);
      // 行内改名中的条目（绝对路径）；行内新建（createAt = 目标目录绝对路径 + 草稿）
      const [renamingPath, setRenamingPath] = react.useState(null);
      const [createAt, setCreateAt] = react.useState(null);
      const [createName, setCreateName] = react.useState("");
      // 行内改名/新建期间把 dock.inlineEdit 座置真：root 的 Esc 分层据此让路，
      // 否则按 Esc 取消编辑会顺手把右栏知识库页签（或整个侧栏视图）关掉
      react.useEffect(() => {
        dock.inlineEdit.active = renamingPath !== null || createAt !== null;
        return () => {
          dock.inlineEdit.active = false;
        };
      }, [renamingPath, createAt]);
      // 对话框（移动到…/导入/删除确认共用一份 state）：{kind, ...}；null = 没开
      const [dialog, setDialog] = react.useState(null);
      // 搜索框聚焦态（Esc 让路用）。放在已有 state 之后：渲染级检查按 useState
      // 槽位预置状态（改名/新建/对话框），插在中间会把那些槽位整体挪位
      const [searchFocused, setSearchFocused] = react.useState(false);
      // 有盘上操作在跑（对话框按钮置灰防连点）
      const [busy, setBusy] = react.useState(false);
      const railRef = react.useRef(null);
      const manualRefresh = react.useCallback(async () => {
        setRefreshing(true);
        try {
          await reloadData();
          setToast(t("vaultRefreshed"));
        } finally {
          setRefreshing(false);
        }
      }, [reloadData]);

      // 换根（首挂/Ctrl+点击目录行/搜索结果点目录/树头 ←）：树状态清空并展开根层
      react.useEffect(() => {
        setTreeDirs({});
        if (treeRoot === null) return;
        setExpanded({ [treeRoot]: true });
        void fetchDir(treeRoot);
      }, [treeRoot, fetchDir]);

      // 开页统一入口（侧栏目录/搜索/反链/对话路径/wikilink 都走这里）：
      // 打开或激活该页的知识库页签，右栏路径顺带把「知识库」dock 签带到眼前
      // （索引即入口）。anchor = [[页#锚]] 跨页跳转的落点，随开页交给目标 pane
      const openPath = react.useCallback((path, anchor, newPane) => {
        openVaultPageAndDock(path, anchor, newPane === true);
      }, []);

      // M4 会话→笔记：消费拦截器转来的开页请求。两种时序都接——组件还没挂载时点
      // 聊天路径，本组件才挂载（vaultOpenRequest 落地等着）；已挂载时走
      // window 事件
      react.useEffect(() => {
        const openReq = () => {
          if (vaultOpenRequest === null) return;
          const p = vaultOpenRequest;
          vaultOpenRequest = null;
          openPath(p);
        };
        openReq();
        window.addEventListener("dshk-vault-open", openReq);
        return () => window.removeEventListener("dshk-vault-open", openReq);
      }, [openPath]);

      /** 树上 `@`：把这一页 @ 进对话输入框。
       *  只有点的就是当前激活页时才带选区镜像——拿别的页的选区去引用本页会张冠李戴。 */
      const citeFromTree = (pagePath) => {
        citeVaultPageToChat(pagePath, pagePath === current ? vaultSelMirror : "", (key) => flashToast(t(key)));
      };
      /** 树行 ⋯「复制绝对路径」：笔记页与资料库文件一律给盘上绝对路径（相对路径
       *  的去扩展名形态是 wikilink 键，只在页面里用得上） */
      const copyVaultPath = (entry) => {
        void writeClipboard(entry.path).then((ok) => {
          if (ok) flashToast(t("treeCopied"));
        });
      };

      // 搜索结果是锚在搜索框下的临时浮层（不挤目录树）：随输入实时更新（去抖），
      // 点浮层外 / Esc / 选中 / 清空即关。seq 守卫：连打时只认最后一次查询的回包
      const runSearch = async (raw) => {
        const q = String(raw ?? "").trim();
        if (q === "") {
          setSearchRes(null);
          return;
        }
        const seq = ++searchSeq.current;
        setSearchIdx(0);
        setSearchRect(searchRef.current ? searchRef.current.getBoundingClientRect() : null);
        try {
          const body = await kitJson(`/dsh-kit/vault/search?q=${encodeURIComponent(q)}`);
          // 笔记命中来自宿主全文搜索；目录与资料库按名字匹配在本地合成（同一张表）
          if (seq === searchSeq.current) setSearchRes(vaultSearchHits(q, root, body.results ?? [], index?.folders ?? [], libItems));
        } catch (error) {
          if (seq === searchSeq.current) setToast(`${t("vaultSearchFail")} ${String(error?.message ?? error)}`);
        }
      };
      const scheduleSearch = (raw) => {
        const q = String(raw ?? "").trim();
        if (searchTimer.current !== null) clearTimeout(searchTimer.current);
        if (q === "") {
          setSearchRes(null);
          return;
        }
        searchTimer.current = setTimeout(() => {
          searchTimer.current = null;
          void runSearch(q);
        }, 200);
      };
      react.useEffect(() => () => {
        if (searchTimer.current !== null) clearTimeout(searchTimer.current);
      }, []);

      // 关闭手势长在浮层自己身上（同 TreeRowMenu 契约）：点浮层与搜索框之外才关；
      // 开着期间挂 dock.vaultSearch 座，KitSurfaces 的全局 Esc 让路——Esc 只关浮层，不收页签/侧栏。
      // 搜索框聚焦时也让路：去抖 + 请求在飞的那几百毫秒里座要是空的，Esc 会把页签收了
      react.useEffect(() => {
        if (searchRes === null && searchFocused !== true) return undefined;
        holdEsc();
        if (searchRes === null) return () => {
          releaseEsc();
        };
        const onDown = (e) => {
          if (e.target instanceof Element && !e.target.closest(".dshk-vault-vsearch") && !e.target.closest(".dshk-vault-search")) setSearchRes(null);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => {
          releaseEsc();
          document.removeEventListener("pointerdown", onDown, true);
        };
      }, [searchRes, searchFocused]);

      // toast 自动消隐
      react.useEffect(() => {
        if (toast === "") return undefined;
        const timer = setTimeout(() => setToast(""), 2600);
        return () => clearTimeout(timer);
      }, [toast]);

      // 树上定位：目标行要等它那层目录拉回来才在 DOM 里（treeDirs 变一次重试一次）；
      // 找到了就滚进视野并收工
      react.useEffect(() => {
        if (revealPath === null) return;
        const rail = railRef.current;
        const row = rail === null ? null : Array.from(rail.querySelectorAll(".dshk-vault-treerow")).find((el) => samePath(el.getAttribute("title"), revealPath));
        if (!row) return;
        row.scrollIntoView({ block: "nearest" });
        setRevealPath(null);
      }, [revealPath, treeDirs]);

      // 区域外点击 = 取消行内新建（丢弃草稿，不弹窗不代建）：误点代建会产生
      // 意外条目，弹窗又比一行输入的损失重；Enter 始终是显式创建
      react.useEffect(() => {
        if (createAt === null) return undefined;
        const onDown = (e) => {
          if (e.target instanceof Element && !e.target.closest(".dshk-createrow")) setCreateAt(null);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [createAt]);

      // 空表用同一个常量：`?? []` 每次渲染都是新数组，页签侧拿它当 useMemo 依赖
      // 就算依赖没真变也会重算（反链是 O(页数×链接数)）
      const indexPages = index?.pages ?? VAULT_EMPTY_PAGES;
      const indexDirs = index?.folders ?? VAULT_EMPTY_DIRS;
      /** 行 ⋯ / 树头 ⋯ 开关：同一颗触发钮再点一次关掉（菜单的关闭手势会跳过落在它上面的点击） */
      const openRowMenu = (anchor, entry, head) => {
        setRowMenu((prev) => (prev && prev.anchor === anchor ? null : { entry, head: head === true, rect: anchor.getBoundingClientRect(), anchor }));
      };
      /** 进入目录（Ctrl（⌘）+点击目录行 / 搜索结果点笔记目录）：树根换成该目录，
       *  树头 ← 回库根。换根只影响面板显示，不动配置页的 vaultRoot。
       *  资料库那一支不参与换根（它是文献面，见 dirRow） */
      const openHere = (dir) => {
        setRootHere(dir === root ? null : dir);
        setRowMenu(null);
        setSearchRes(null);
      };
      /** 搜索点到资料库目录：在树上定位——库根到父层全部展开，滚到那一行。
       *  展开是异步拉目录，行要等 treeDirs 落地才在，所以 revealPath 由渲染后的
       *  effect 消费（找不到就留着，下一次 treeDirs 变化再试） */
      const revealLibDir = (dirPath) => {
        const lib = libRootRef.current;
        if (lib === null) return;
        const rel = relUnder(lib, dirPath);
        if (rel === null) return;
        const open = { [lib]: true };
        // 逐层按库根的分隔符拼（树的缓存键与展开态全是宿主路径，拼成正斜杠整条链失配）
        const segs = rel === "" ? [] : rel.split("/");
        for (let i = 0; i < segs.length; i++) {
          const cur = joinRelPath(lib, segs.slice(0, i + 1).join("/"));
          open[cur] = true;
          void fetchDir(cur);
        }
        setExpanded((e) => ({ ...e, ...open }));
        setRevealPath(dirPath);
      };
      /** 搜索结果点击：页开阅读面、资料库文件开官方文件右栏、笔记目录换树根、
       *  资料库目录在树上定位 */
      const openHit = (hit) => {
        setSearchRes(null);
        if (hit.kind === "page") openPath(hit.path);
        else if (hit.kind === "libfile") openVaultAsset(hit.path);
        else if (hit.kind === "libdir") revealLibDir(hit.path);
        else openHere(hit.path);
      };
      /** 目录行是否有可展开的后代：笔记树看索引里的**下级目录**与页前缀，资料库子树
       *  看库内清单。只看页的话，刚建好、只装了子目录还没放笔记的目录没有展开钮，
       *  点了也不展开——那棵子树整片看不见（新目录本就该是能一层层点进去的） */
      const dirHasChildren = (dirPath) => {
        const lib = libRootRef.current;
        const libRel = lib === null ? null : relUnder(lib, dirPath);
        if (libRel !== null) return libItems.some((it) => it.rel.startsWith(libRel === "" ? "" : `${libRel}/`) && it.rel !== libRel);
        const rel = root === null ? null : relUnder(root, dirPath);
        if (rel === null || rel === "") return false;
        const prefix = `${rel}/`;
        return indexDirs.some((d) => d.startsWith(prefix)) || indexPages.some((p) => p.rel.startsWith(prefix));
      };
      const toggleDir = (dir) => {
        const opening = expanded[dir] !== true;
        setExpanded((e) => ({ ...e, [dir]: opening }));
        if (opening) void fetchDir(dir);
      };
      /** 这一行是不是资料库那一支（含库根那一行本身）：那支只浏览不换根，
       *  新建只建文件夹（库里放的是文献，空 md 页没有意义） */
      const isLibPath = (p) => libRoot !== null && p !== undefined && relUnder(libRoot, p) !== null;

      // ── 文件管理（建 / 改名 / 移动 / 导入 / 删除）────────────────────────────
      // 全部走宿主端点落盘，前端只管交互与刷新：目录树是懒加载缓存 + 索引派生，
      // 写完不重拉就等于没写（外部增删可见性靠的也是同一条重拉）
      /** 统一收尾：成功 toast + 回执，失败只 toast 并保留对话框/草稿（可改可重试） */
      const runVaultOp = async (job, describe) => {
        setBusy(true);
        try {
          const res = await job();
          setToast(describe(res));
          return res;
        } catch (error) {
          setToast(`${t("skOpFail")}：${error?.message ?? error}`);
          return null;
        } finally {
          setBusy(false);
        }
      };
      /** 改名/移动后把树的缓存键与展开态一起搬——不搬的话旧键全成了孤儿，
       *  整棵已展开的树会凭空消失（重拉也回不来：键不在了就不会去拉） */
      const retargetTree = (oldPath, newPath, isDir) => {
        const mapKey = (k) => (k === oldPath ? newPath : isDir && pathUnder(k, oldPath) ? newPath + k.slice(oldPath.length) : k);
        setTreeDirs((d) => {
          const next = {};
          for (const k of Object.keys(d)) next[mapKey(k)] = d[k];
          return next;
        });
        setExpanded((e) => {
          const next = {};
          for (const k of Object.keys(e)) next[mapKey(k)] = e[k];
          return next;
        });
      };
      /** 删除后丢掉落在删除集里的缓存键与展开态 */
      const forgetTree = (prefixes) => {
        const gone = (k) => prefixes.some((p) => pathUnder(k, p));
        setTreeDirs((d) => {
          const next = {};
          for (const k of Object.keys(d)) if (!gone(k)) next[k] = d[k];
          return next;
        });
        setExpanded((e) => {
          const next = {};
          for (const k of Object.keys(e)) if (!gone(k)) next[k] = e[k];
          return next;
        });
      };
      /** 新建入口（树头 + / 目录行 +）：展开目标目录并在它下面挂行内输入 */
      const startCreate = (dirPath) => {
        setRowMenu(null);
        setDialog(null);
        setCreateAt(dirPath);
        setCreateName("");
        if (expanded[dirPath] !== true) {
          setExpanded((e) => ({ ...e, [dirPath]: true }));
          void fetchDir(dirPath);
        }
      };
      /** 行内新建提交：`\` 前缀 = 建目录（资料库那一支一律目录），可含 `/` 多级；
       *  新页建好直接打开（与单击同语义），失败保留草稿 */
      const submitCreate = async () => {
        if (createAt === null) return;
        const raw = createName.trim();
        if (raw === "") return;
        const wantDir = raw.startsWith("\\") || isLibPath(createAt);
        const name = (wantDir ? raw.replace(/^\\+/, "") : raw).replace(/^[\\/]+|[\\/]+$/g, "");
        if (name === "") return;
        const dir = createAt;
        const res = await runVaultOp(
          () => vaultOp("/dsh-kit/vault/create", { dir, name, kind: wantDir ? "dir" : "page" }),
          (r) => (r.exists === true ? t("vaultExists") : t("created")),
        );
        if (res === null) return;
        setCreateAt(null);
        setCreateName("");
        if (wantDir) setExpanded((e) => ({ ...e, [res.path]: true }));
        else openPath(res.path);
        void fetchDir(dir);
        void loadIndex();
      };
      /** 行内改名提交（只换名字留原位置）：页的双链由宿主按解析改写，回执带页数；
       *  成功后树键、已开页签一起搬 */
      const submitRename = async (entry, currentLabel, rawValue) => {
        setRenamingPath(null);
        const name = String(rawValue ?? "").trim();
        if (name === "" || name === currentLabel) return;
        const res = await runVaultOp(
          () => vaultOp("/dsh-kit/vault/rename", { path: entry.path, name }),
          (r) => `${t("renamed")}${r.links > 0 ? t("vaultLinks").replace("{n}", String(r.links)) : ""}`,
        );
        if (res === null) return;
        retargetTree(entry.path, res.path, entry.dir === true);
        vaultTabsRetarget(entry.path, res.path, entry.dir === true);
        await reloadData();
      };
      /** 移动到…：候选目录 = 同侧全部分支（笔记侧走索引，资料库侧走库内清单） */
      const openMove = (entry) => {
        setRowMenu(null);
        setDialog({ kind: "move", entry, lib: isLibPath(entry.path), dest: absParent(entry.path), conflict: "skip" });
      };
      const submitMove = async () => {
        const d = dialog;
        if (d === null || d.kind !== "move") return;
        const res = await runVaultOp(
          () => vaultOp("/dsh-kit/vault/move", { path: d.entry.path, dest: d.dest, conflict: d.conflict }),
          (r) => (r.skipped ? t("vaultMoveSkipped") : `${t("moved")}${r.links > 0 ? t("vaultLinks").replace("{n}", String(r.links)) : ""}`),
        );
        if (res === null) return;
        setDialog(null);
        if (res.skipped === true) return;
        retargetTree(d.entry.path, res.path, d.entry.dir === true);
        vaultTabsRetarget(d.entry.path, res.path, d.entry.dir === true);
        setExpanded((e) => ({ ...e, [d.dest]: true }));
        void fetchDir(d.dest);
        await reloadData();
      };
      /** 导入：来源两条——浏览器选的文件（远端也能用）或本机绝对路径（宿主直拷，
       *  笔记页连带把页内引用的本地图片收进 attachments/）。落点 = 点开入口的那个目录 */
      const openImport = (dirPath, lib) => {
        setRowMenu(null);
        setDialog({ kind: "import", dest: dirPath, lib: lib === true, files: [], src: "", name: "", conflict: "skip" });
      };
      const submitImport = async () => {
        const d = dialog;
        if (d === null || d.kind !== "import") return;
        if (d.files.length === 0 && String(d.src ?? "").trim() === "") {
          setToast(t("vaultImportNeedSrc"));
          return;
        }
        const jobs = d.files.length > 0
          ? d.files.map((file) => ({ file, payload: null }))
          : [{ file: null, payload: { dest: d.dest, name: d.name, src: String(d.src).trim(), conflict: d.conflict } }];
        setBusy(true);
        let imported = 0;
        let skipped = 0;
        let images = 0;
        const fails = [];
        try {
          for (const job of jobs) {
            try {
              const payload = job.payload ?? {
                dest: d.dest,
                name: job.file.name,
                fileName: job.file.name,
                dataBase64: await fileToBase64(job.file),
                conflict: d.conflict,
              };
              const r = await vaultOp("/dsh-kit/vault/import", payload);
              if (r.skipped === true) skipped += 1;
              else imported += 1;
              images += r.images ?? 0;
            } catch (error) {
              fails.push(`${job.file ? job.file.name : String(d.src).trim()}：${error?.message ?? error}`);
            }
          }
        } finally {
          setBusy(false);
        }
        // 失败不只报首条：批量导入十条错只说一句等于没说（toast 两秒半就消，长单据
        // 也读不完——列前三条 + 余量，逐条原因都在里面）
        if (fails.length > 0) setToast(`${t("skOpFail")}：${fails.slice(0, 3).join("；")}${fails.length > 3 ? ` …+${fails.length - 3}` : ""}`);
        else {
          setDialog(null);
          const extra = [skipped > 0 ? t("vaultMoveSkipped") : "", images > 0 ? t("vaultImportImgs").replace("{n}", String(images)) : ""].join("");
          setToast(`${t("imported")} ${imported}${extra}`);
        }
        await reloadData();
        void fetchDir(d.dest);
        setExpanded((e) => ({ ...e, [d.dest]: true }));
      };
      /** 删除：确认后整单送宿主（Windows 进回收站），页签与树缓存同步收掉 */
      const openDelete = (entry) => {
        setRowMenu(null);
        setDialog({ kind: "delete", entry });
      };
      const submitDelete = async () => {
        const d = dialog;
        if (d === null || d.kind !== "delete") return;
        const res = await runVaultOp(
          () => vaultOp("/dsh-kit/vault/delete", { paths: [d.entry.path] }),
          (r) => (r.failed && r.failed.length > 0 ? `${t("deleted")} ${r.deleted}／${t("skOpFail")}：${r.failed.join("、")}` : `${t("deleted")} ${r.deleted}`),
        );
        if (res === null) return;
        setDialog(null);
        vaultTabsClose([d.entry.path]);
        forgetTree([d.entry.path]);
        await reloadData();
      };
      /** 行 ⋯ 接线：重命名 / 移动到… / 导入… / 复制绝对路径 / 删除。
       *  资料库根那一行只给导入（根目录名是写死的约定，宿主也硬拦改名/移动/删除） */
      const importItem = (entry, lib) => ({
        key: "im",
        label: lib ? t("vaultImportFiles") : t("vaultImportMd"),
        run: () => openImport(entry.path, lib),
      });
      const menuActionsFor = (row) => {
        // 树头 ⋯：落点 = 当前树根，只有导入（新建走旁边的 +）
        if (row.head === true) return { extraItems: [importItem(row.entry, isLibPath(row.entry.path))] };
        const entry = row.entry;
        const lib = isLibPath(entry.path);
        const atLibRoot = libRoot !== null && entry.path === libRoot;
        // 资料库那一行（库根本身）只有导入：改名 / 移动 / 删除对它都无从谈起，宿主也硬拦
        const extraItems = atLibRoot ? [] : [{ key: "mv", label: t("vaultMoveTo"), run: () => openMove(entry) }];
        if (entry.dir === true) extraItems.push(importItem(entry, lib));
        return {
          extraItems,
          onRename: atLibRoot ? undefined : (target) => setRenamingPath(target.path),
          onCopyPath: copyVaultPath,
          copyMode: "abs",
          onDelete: atLibRoot ? undefined : (target) => openDelete(target),
        };
      };
      /** 树头 ⋯ 的锚点条目：当前树根（路径即落点；head 标记让菜单只出导入） */
      const openHeadMenu = (anchor) => {
        if (treeRoot === null) return;
        const label = rootHere === null ? t("vaultTitle") : relUnder(root, rootHere) || rootHere;
        openRowMenu(anchor, { dir: true, name: label, path: treeRoot, head: true }, true);
      };
      /** 移动的目标里是不是已有同名（原地不动不算）——有才把冲突策略摆出来给用户选 */
      const moveClash = (d) => {
        if (d === null || d.kind !== "move" || absParent(d.entry.path) === d.dest) return false;
        if (d.lib) {
          const rel = relUnder(libRoot, d.dest);
          if (rel === null) return false;
          const want = `${rel === "" ? "" : `${rel}/`}${d.entry.name}`.toLowerCase();
          return libItems.some((it) => it.rel.toLowerCase() === want);
        }
        const rel = relUnder(root, d.dest);
        if (rel === null) return false;
        const want = `${rel === "" ? "" : `${rel}/`}${d.entry.name}`.toLowerCase();
        return (index?.folders ?? []).some((f) => f.toLowerCase() === want) || indexPages.some((p) => p.rel.toLowerCase() === want);
      };
      /** 撞名策略三选一（移动与导入共用）：跳过 / 覆盖（旧的送回收站）/ 自动加序号 */
      const conflictRadios = (value, onChange) =>
        [["skip", "vaultConflictSkip"], ["overwrite", "vaultConflictOverwrite"], ["rename", "vaultConflictRename"]].map(([v, key]) =>
          jsxRuntime.jsxs("label", { className: "dshk-vault-radio", children: [
            jsxRuntime.jsx("input", { type: "radio", name: "dshk-vault-conflict", checked: value === v, onChange: () => onChange(v) }),
            t(key),
          ] }, v),
        );
      /** 删目录的确认数量：笔记侧数页，资料库侧数库内清单条目 */
      const doomedCount = (entry) => {
        if (entry.dir !== true) return 0;
        if (isLibPath(entry.path)) {
          const rel = relUnder(libRoot, entry.path) ?? "";
          const prefix = rel === "" ? "" : `${rel}/`;
          return libItems.filter((it) => it.rel.startsWith(prefix) && it.rel !== rel).length;
        }
        return indexPages.filter((p) => pathUnder(p.path, entry.path)).length;
      };
      /** 树行 hover 的 `@` + `⋯`（目录行与文件行同形状）；行尾那枚 `+` 只在目录行 */
      const rowActs = (entry, label) =>
        jsxRuntime.jsxs("span", {
          className: "dshk-rowact",
          children: [
            // 保住选区：mousedown 默认行为会先塌掉编辑器里的选区
            jsxRuntime.jsx(KitTip, { label: t("treeAt"), align: "end", children: jsxRuntime.jsx("button", { type: "button", onMouseDown: (ev) => ev.preventDefault(), onClick: (ev) => { ev.stopPropagation(); citeFromTree(entry.path); }, children: "@" }) }),
            jsxRuntime.jsx(KitTip, {
              label: t("treeMenu"),
              align: "end",
              children: jsxRuntime.jsx("button", {
                type: "button",
                onClick: (ev) => {
                  ev.stopPropagation();
                  openRowMenu(ev.currentTarget, { dir: entry.dir === true, name: label, path: entry.path });
                },
                children: "⋯",
              }),
            }),
          ],
        });
      /** 行内改名输入：Enter 提交、Esc / 失焦取消。keepExt = 只有**资料库文件**
       *  才按扩展名切选区：笔记页的输入值本来就不含 .md，按点号切会把
       *  「2024.05 计划」切成「2024」，一动就成「2025.05 计划」 */
      const renameInput = (entry, label, keepExt) =>
        jsxRuntime.jsx("input", {
          className: "dshk-rename",
          defaultValue: label,
          spellCheck: false,
          autoFocus: true,
          "aria-label": t("treeRename"),
          onClick: (ev) => ev.stopPropagation(),
          onFocus: (ev) => {
            const v = ev.currentTarget.value;
            const i = v.lastIndexOf(".");
            ev.currentTarget.setSelectionRange(0, keepExt && i > 0 ? i : v.length);
          },
          onKeyDown: (ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") {
              ev.preventDefault();
              void submitRename(entry, label, ev.currentTarget.value);
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              setRenamingPath(null);
            }
          },
          onBlur: () => {
            if (renamingPath === entry.path) setRenamingPath(null);
          },
        }, "rename");
      /** 行内新建输入（挂在目标目录行下 / 树头上）：Enter 建、Esc 与空内容退格取消；
       *  区域外点击也取消（误点代建会留下意外条目） */
      const createRow = () =>
        jsxRuntime.jsxs("div", { className: "dshk-createrow", title: createAt ?? "", children: [
          jsxRuntime.jsx("input", {
            autoFocus: true,
            value: createName,
            spellCheck: false,
            placeholder: t("vaultNewPh"),
            onChange: (ev) => setCreateName(ev.target.value),
            onKeyDown: (ev) => {
              ev.stopPropagation();
              if (ev.key === "Enter") {
                ev.preventDefault();
                void submitCreate();
              } else if (ev.key === "Escape") {
                ev.preventDefault();
                setCreateAt(null);
              } else if (ev.key === "Backspace" && createName === "") setCreateAt(null);
            },
          }),
        ] });
      /** 目录行：点击折叠/展开；笔记目录另给 Ctrl（⌘）+点击 = 进入该目录（树头 ← 回库根）；
       *  空目录不给展开钮（没东西可展开，行本身保留——空目录有看得见的必要）。
       *  lib = 资料库那一支（含「资料库」那一行本身）：只浏览不换根 */
      const dirRow = (e, depth, hasChildren, lib) =>
        jsxRuntime.jsxs(
          "div",
          {
            children: [
              jsxRuntime.jsxs("div", {
                className: "dshk-vault-treerow",
                style: { paddingLeft: 10 + depth * 14 },
                title: e.path,
                onClick: (ev) => {
                  if (renamingPath === e.path) return; // 改名中：点击不触发展开/进目录
                  if (!lib && (ev.ctrlKey || ev.metaKey)) {
                    openHere(e.path);
                    return;
                  }
                  if (hasChildren) toggleDir(e.path);
                },
                children: [
                  // 展开箭头与文件树同一枚（官方 IconTriangleRightFill14）
                  jsxRuntime.jsx("span", { className: "dshk-vault-twist", children: hasChildren ? jsxRuntime.jsx(ChevronIcon, { open: expanded[e.path] === true }) : null }),
                  jsxRuntime.jsx(TreeFolderIcon, {}),
                  renamingPath === e.path ? renameInput(e, e.name, false) : jsxRuntime.jsx("span", { className: "dshk-vault-treename", children: e.name }),
                  // 行尾「新建」（悬停显形）：落点 = 这个目录
                  jsxRuntime.jsx(KitTip, {
                    label: t("vaultNew"),
                    align: "end",
                    children: jsxRuntime.jsx("button", {
                      type: "button",
                      className: "dshk-vault-treeplus",
                      onMouseDown: (ev) => ev.preventDefault(),
                      onClick: (ev) => {
                        ev.stopPropagation();
                        startCreate(e.path);
                      },
                      children: "+",
                    }),
                  }),
                  rowActs(e, e.name),
                ],
              }),
              createAt === e.path ? createRow() : null,
              renderDir(e.path, depth + 1),
            ],
          },
          e.path,
        );
      /** 文件行：笔记页进知识库阅读面；资料库文件进官方文件右栏（面板不渲染 PDF） */
      const fileRow = (e, depth, lib) => {
        const label = lib ? e.name : pageBasename(e.name);
        return jsxRuntime.jsxs(
          "div",
          {
            className: `dshk-vault-treerow${!lib && e.path === current ? " is-active" : ""}`,
            style: { paddingLeft: 10 + (depth + 1) * 14 },
            onClick: () => {
              if (renamingPath === e.path) return;
              if (lib) openVaultAsset(e.path);
              else openPath(e.path);
            },
            title: e.path,
            children: [
              jsxRuntime.jsx(FileTypeIcon16, { name: e.name }),
              renamingPath === e.path ? renameInput(e, label, lib) : jsxRuntime.jsx("span", { className: "dshk-vault-treename", children: label }),
              rowActs(e, label),
            ],
          },
          e.path,
        );
      };
      const renderDir = (dirPath, depth) => {
        if (expanded[dirPath] !== true) return null;
        const entries = treeDirs[dirPath];
        if (!entries) return jsxRuntime.jsx("div", { className: "dshk-vault-treeload", style: { paddingLeft: 10 + depth * 14 }, children: "…" }, `${dirPath}#load`);
        // 资料库子树里不过滤扩展名（文献照列，点开走官方文件右栏）
        const lib = libRootRef.current !== null && relUnder(libRootRef.current, dirPath) !== null;
        return entries.map((e) => (e.dir ? dirRow(e, depth, dirHasChildren(e.path), lib) : fileRow(e, depth, lib)));
      };
      /** 资料库那一行：库根的入口，**任何根下都在**（它挂在树体上，与当前根无关），
       *  计数取宿主清单里的文件数，展开后才现拉每一层 */
      const libRow = () => {
        if (libRoot === null) return null;
        const count = libItems.filter((it) => it.dir !== true).length;
        return dirRow({ dir: true, name: `${t("vaultLibrary")}${count > 0 ? ` (${count})` : ""}`, path: libRoot }, 0, libItems.length > 0, true);
      };

      // 读页上下文（页签侧 VaultPagePane 消费）在**提交后**发布，不在渲染期发：
      // 渲染期通知订阅者等于拿未提交的状态惊动别的组件（并发渲染下会撕裂/丢弃），
      // 而且每次渲染都换一份新对象的话页签侧 useMemo 恒不命中
      react.useEffect(() => {
        const refreshIndex = () => void loadIndex();
        if (root !== null) {
          publishVaultReader({ root, earlyBody: null, indexPages, openPath, refreshIndex, setToast });
          return;
        }
        let earlyBody;
        if (indexErr === "") earlyBody = jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") });
        else if (indexErr === "vault-not-configured") {
          earlyBody = jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "dshk-vault-hinttitle", children: t("vaultNotConfigured") }),
            jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultNotConfiguredHint") }),
          ] });
        } else earlyBody = jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: `${t("vaultIndexFail")} ${indexErr}` });
        publishVaultReader({ root: null, earlyBody, indexPages: null, openPath, refreshIndex, setToast });
      }, [root, indexErr, indexPages, openPath, setToast, loadIndex]);

      // root 未就绪的整页态：加载中 / 未配置 / 索引失败（root 就绪后的瞬时错误
      // 走主界面内的错误条，不早退）。发布给页签侧（页签正文自己渲染），
      // 侧栏索引在场时也照旧投一份
      if (root === null) {
        let earlyBody;
        if (indexErr === "") earlyBody = jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") });
        else if (indexErr === "vault-not-configured") {
          earlyBody = jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "dshk-vault-hinttitle", children: t("vaultNotConfigured") }),
            jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultNotConfiguredHint") }),
          ] });
        } else earlyBody = jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: `${t("vaultIndexFail")} ${indexErr}` });
        return ui.vaultSideOpen && ui.vaultSideTab !== "schedule" && sideHost
          ? reactDom.createPortal(jsxRuntime.jsx("div", { className: "dshk-vault", children: earlyBody }), sideHost, "dshk-vault-early")
          : null;
      }

      // 工具条 + 搜索结果 + 目录树 → 侧栏索引宿主；页编辑器 → 右栏 pane 宿主。
      // 单实例双 portal：两侧各自在场才投递（侧栏关闭/右栏关签互不影响）。
      // 工具条一行：搜索框占满 + 刷新收尾（换根改在树上 Ctrl+点击目录行，树头 ← 回库根）
      const sideContent = jsxRuntime.jsxs("div", { className: "dshk-vault-sidewrap", children: [
        jsxRuntime.jsxs("div", { className: "dshk-vault-toolbar", children: [
          jsxRuntime.jsxs("div", { className: "dshk-vault-tbarrow", children: [
            jsxRuntime.jsx("input", {
              ref: searchRef,
              className: "dshk-vault-search",
              value: searchQ,
              placeholder: t("vaultSearchPh"),
              spellCheck: false,
              onFocus: () => setSearchFocused(true),
              onBlur: () => setSearchFocused(false),
              onChange: (e) => {
                // 随输入实时搜（去抖）；清空即关浮层
                setSearchQ(e.target.value);
                scheduleSearch(e.target.value);
              },
              onKeyDown: (e) => {
                // 回车=打开当前条目（浮层没开但有词就立即搜，免等去抖）；↑↓ 移动；Esc 只关浮层
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (searchRes !== null) {
                    const hit = searchRes[Math.min(searchIdx, Math.max(0, searchRes.length - 1))];
                    if (hit) openHit(hit);
                  } else if (searchQ.trim() !== "") {
                    void runSearch(searchQ);
                  }
                } else if (e.key === "ArrowDown" && searchRes !== null) {
                  e.preventDefault();
                  setSearchIdx((i) => Math.min(i + 1, Math.max(0, searchRes.length - 1)));
                } else if (e.key === "ArrowUp" && searchRes !== null) {
                  e.preventDefault();
                  setSearchIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Escape" && searchRes !== null) {
                  // 全局 Esc 已挂 dock.vaultSearch 让路：这里只关浮层
                  e.preventDefault();
                  setSearchRes(null);
                }
              },
            }),
            jsxRuntime.jsx(KitTip, { label: t("vaultRefresh"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", "aria-label": t("vaultRefresh"), disabled: refreshing, onClick: () => void manualRefresh(), children: jsxRuntime.jsx(OfficialIcon, { names: ["IconRefreshOutline16", "IconRefreshOutline14"], glyph: "↻" }) }) }),
          ] }),
        ] }),
        searchRes !== null && searchRect
          ? jsxRuntime.jsxs("div", {
              className: "dshk-vault-vsearch",
              style: {
                left: Math.max(8, Math.min(searchRect.left, (window.innerWidth || 1200) - 248)),
                top: searchRect.bottom + 4,
                width: Math.max(searchRect.width, 230),
              },
              children: [
                searchRes.length === 0 ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultSearchEmpty") }) : null,
                searchRes.map((r, i) =>
                  jsxRuntime.jsxs("div", {
                    className: `dshk-vault-hitrow${i === Math.min(searchIdx, Math.max(0, searchRes.length - 1)) ? " is-cur" : ""}`,
                    onMouseEnter: () => setSearchIdx(i),
                    // mousedown 别抢搜索框焦点（失焦会打断打字与浮层刷新）
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => openHit(r),
                    children: [
                      // 显示名 = 末段（笔记页去 .md）；title 给完整 rel，点开按 kind 分流
                      jsxRuntime.jsx("span", { className: "dshk-vault-hittitle", title: r.rel, children: r.label }),
                      r.sub === "" ? null : jsxRuntime.jsx("span", { className: "dshk-vault-hitsnippet", children: r.sub }),
                    ],
                  }, `${r.kind}:${r.path}`),
                ),
              ],
            })
          : null,
        indexErr !== ""
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: indexErr === "vault-not-configured" ? t("vaultNotConfiguredHint") : `${t("vaultIndexFail")} ${indexErr}` })
          : null,
        // 树头：当前根（库根 = 知识库；进了子目录就显示库内相对路径）+ ← 回库根
        // + 新建 / 导入两个入口（树头没有自己的「行」，根级的建与导就落在这里）
        jsxRuntime.jsxs("div", { className: "dshk-vault-rail", ref: railRef, children: [
          jsxRuntime.jsxs("div", { className: "dshk-vault-railhead", children: [
            rootHere === null
              ? null
              : jsxRuntime.jsx(KitTip, { label: t("vaultBackRoot"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", "aria-label": t("vaultBackRoot"), onClick: () => setRootHere(null), children: jsxRuntime.jsx(OfficialIcon, { names: ["IconChevronLeftOutline14"], glyph: "←" }) }) }),
            jsxRuntime.jsx("span", {
              className: "dshk-vault-railtitle",
              title: treeRoot ?? "",
              children: rootHere === null ? t("vaultTitle") : relUnder(root, rootHere) || rootHere,
            }),
            jsxRuntime.jsx(KitTip, {
              label: t("vaultNew"),
              align: "end",
              children: jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-vault-treeplus",
                onClick: () => treeRoot !== null && startCreate(treeRoot),
                children: "+",
              }),
            }),
            jsxRuntime.jsx(KitTip, {
              label: t("treeMenu"),
              align: "end",
              children: jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-vault-treeplus",
                onClick: (ev) => openHeadMenu(ev.currentTarget),
                children: "⋯",
              }),
            }),
          ] }),
          createAt === treeRoot ? createRow() : null,
          libRow(),
          renderDir(treeRoot, 0),
          // 上限截断时说一声：搜索与反链只覆盖已索引的部分
          index !== null && index.truncated === true
            ? jsxRuntime.jsx("div", { className: "dshk-vault-treeload", children: t("vaultIdxTruncated") })
            : null,
          index !== null && index.library && index.library.truncated === true
            ? jsxRuntime.jsx("div", { className: "dshk-vault-treeload", children: t("vaultLibTruncated") })
            : null,
        ] }),
        rowMenu
          ? jsxRuntime.jsx(TreeRowMenu, {
              entry: rowMenu.entry,
              rect: rowMenu.rect,
              anchor: rowMenu.anchor,
              // 行 ⋯ / 树头 ⋯：重命名 / 移动到… / 导入… / 复制绝对路径 / 删除
              // （按行所属的那一支接线，资料库根只给导入）
              actions: menuActionsFor(rowMenu),
              onClose: () => setRowMenu(null),
            })
          : null,
        dialog !== null && dialog.kind === "move"
          ? jsxRuntime.jsxs(VaultDialog, {
              title: t("vaultMoveTitle").replace("{name}", dialog.entry.name),
              onClose: () => setDialog(null),
              children: [
                jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultMoveLabel") }),
                jsxRuntime.jsx("div", { className: "dshk-vault-dirlist", children:
                  vaultDirChoices(dialog.lib ? "lib" : "notes", root, index?.folders ?? [], libRoot, libItems)
                    .filter((c) => c.path !== dialog.entry.path && !(dialog.entry.dir === true && pathUnder(c.path, dialog.entry.path)))
                    .map((c) =>
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: `dshk-vault-diritem${c.path === dialog.dest ? " is-cur" : ""}`,
                        title: c.path,
                        onClick: () => setDialog((d) => ({ ...d, dest: c.path })),
                        children: c.label,
                      }, c.path),
                    ),
                }),
                moveClash(dialog)
                  ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                      jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultConflict") }),
                      ...conflictRadios(dialog.conflict, (v) => setDialog((d) => ({ ...d, conflict: v }))),
                    ] })
                  : null,
                jsxRuntime.jsxs("div", { className: "dshk-vault-modalfoot", children: [
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", onClick: () => setDialog(null), children: t("cancel") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-save", disabled: busy, onClick: () => void submitMove(), children: t("vaultMoveTo").replace("…", "") }),
                ] }),
              ],
            })
          : null,
        dialog !== null && dialog.kind === "import"
          ? jsxRuntime.jsxs(VaultDialog, {
              title: `${t("vaultImportTitle")} · ${dialog.lib ? t("vaultLibrary") : t("vaultTitle")}`,
              onClose: () => setDialog(null),
              children: [
                jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultImportTo").replace("{dest}", relUnder(root, dialog.dest) || dialog.dest) }),
                jsxRuntime.jsxs("div", { className: "dshk-vault-srcline", children: [
                  // 浏览器选文件（远端/手机也能用）：选中的文件按字节传给宿主落盘
                  jsxRuntime.jsx("label", { className: "dshk-btn-cancel", children: [
                    t("vaultImportPick"),
                    jsxRuntime.jsx("input", {
                      type: "file",
                      multiple: true,
                      style: { display: "none" },
                      accept: dialog.lib ? undefined : ".md,.markdown",
                      onChange: (ev) => {
                        const files = Array.from(ev.target.files ?? []);
                        setDialog((d) => ({ ...d, files, src: "" }));
                      },
                    }),
                  ] }),
                  dialog.files.length > 0
                    ? jsxRuntime.jsx("span", { className: "dshk-vault-modalline", children: dialog.files.map((f) => f.name).join("、") })
                    : null,
                ] }),
                dialog.files.length === 0
                  ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                      // 本机绝对路径直拷：宿主读盘，笔记页连带把页内引用的本地图片收进附件
                      jsxRuntime.jsx("input", {
                        className: "dshk-vault-modalinput",
                        value: dialog.src,
                        spellCheck: false,
                        placeholder: t("vaultImportPathPh"),
                        onChange: (ev) => setDialog((d) => ({ ...d, src: ev.target.value, name: "" })),
                      }),
                      jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultImportName") }),
                      jsxRuntime.jsx("input", {
                        className: "dshk-vault-modalinput",
                        value: dialog.name,
                        spellCheck: false,
                        placeholder: t("vaultImportName"),
                        onChange: (ev) => setDialog((d) => ({ ...d, name: ev.target.value })),
                      }),
                    ] })
                  : null,
                // 资料库那一支撞名一律自动加序号（文献没有"覆盖"语义）——策略项只给笔记页
                dialog.lib
                  ? jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultLibAutoName") })
                  : jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                      jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultConflict") }),
                      ...conflictRadios(dialog.conflict, (v) => setDialog((d) => ({ ...d, conflict: v }))),
                    ] }),
                jsxRuntime.jsxs("div", { className: "dshk-vault-modalfoot", children: [
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", onClick: () => setDialog(null), children: t("cancel") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-save", disabled: busy, onClick: () => void submitImport(), children: t("vaultImportTitle") }),
                ] }),
              ],
            })
          : null,
        dialog !== null && dialog.kind === "delete"
          ? jsxRuntime.jsxs(VaultDialog, {
              title: dialog.entry.dir === true
                ? t("vaultConfirmDeleteDir").replace("{name}", dialog.entry.name).replace("{n}", String(doomedCount(dialog.entry)))
                : t("confirmDelete").replace("{name}", dialog.entry.name),
              onClose: () => setDialog(null),
              children: [
                jsxRuntime.jsx("div", { className: "dshk-vault-modalline", title: dialog.entry.path, children: dialog.entry.path }),
                jsxRuntime.jsx("div", { className: "dshk-vault-modalline", children: t("vaultRecycleHint") }),
                jsxRuntime.jsxs("div", { className: "dshk-vault-modalfoot", children: [
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-cancel", onClick: () => setDialog(null), children: t("cancel") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-btn-save", disabled: busy, onClick: () => void submitDelete(), children: t("treeDelete") }),
                ] }),
              ],
            })
          : null,
        toast !== "" ? jsxRuntime.jsx("div", { className: "dshk-vault-toast", role: "status", children: toast }) : null,
      ] });

      return ui.vaultSideOpen && ui.vaultSideTab !== "schedule" && sideHost
        ? reactDom.createPortal(sideContent, sideHost, "dshk-vault-side")
        : null;
    }

    /** 单页正文上限（字节）：与宿主 src/vault/fs.ts 的 PAGE_WRITE_LIMIT 同值。
     *  读端点默认只回 512KB，这里显式要 1MB——超过 1MB 的页读回来就是半截，
     *  编辑器不给进（vaultTooLargeHint），否则自动保存会把尾部写丢 */
    const VAULT_PAGE_MAX_BYTES = 1048576;

    /** 知识库单页编辑视图（一页一张签的正文）：正文加载/所见即所得编辑/自动保存
     *  /CAS 冲突/外部修改跟随/粘贴图片入库都在这一层，页条给文档级命令与阅读条
     *  （目录・反链・面包屑）。active=false 的签仍挂载（保住滚动与草稿），只停掉
     *  stat 轮询，并在失活那一刻把防抖未落盘的改动写掉（「切走即存」）。 */
    function VaultPagePane({ path, active, root, indexPages, onOpenPage, onIndexRefresh, toast }) {
      // page: { loading, body(编辑器入参), binary, truncated, gone }——frontmatter 字节级原文
      // 存 ref（保存时原样拼回），不进 state（它不驱动渲染）
      const [page, setPage] = react.useState(null);
      // RTE 重挂载 tick：首次加载/外部修改重读/冲突回读时 bump（日常保存不重挂）
      const [docTick, setDocTick] = react.useState(0);
      // CAS 冲突：{ diskMtime } | null —— 自动保存暂停，出冲突条（覆盖 / 读盘上）
      const [conflict, setConflict] = react.useState(null);
      // 未保存脏点（RteEditor 上报）
      const [dirtyDot, setDirtyDot] = react.useState(false);
      // 阅读条：面包屑 + 页面级下拉（目录/反链，同时至多开一个）
      const [crumb, setCrumb] = react.useState("");
      const [barMenu, setBarMenu] = react.useState(null); // "toc" | "bl" | null
      const barMenuAnchorRef = react.useRef(null);
      const rteRef = react.useRef(null);
      const rteCtlRef = react.useRef(null);
      const fmRef = react.useRef("");
      const mtimeRef = react.useRef(0);
      const conflictRef = react.useRef(conflict);
      conflictRef.current = conflict;
      const pagesRef = react.useRef(indexPages);
      pagesRef.current = indexPages;
      // 引用到对话：@ 在左侧树的行上（见 VaultRootView），
      // 这里只负责把**激活页**的选区写进模块级镜像供那边读——非激活页不写，免得
      // 后台页签把镜像清掉。paneRef 仍用于判定选区是否落在本页内
      const paneRef = react.useRef(null);
      const activeRef = react.useRef(active);
      activeRef.current = active;
      react.useEffect(() => {
        const onSel = () => {
          if (!activeRef.current) return;
          const pane = paneRef.current;
          const sel = document.getSelection();
          vaultSelMirror = pane && sel && sel.anchorNode && pane.contains(sel.anchorNode) ? String(sel) : "";
        };
        document.addEventListener("selectionchange", onSel);
        return () => document.removeEventListener("selectionchange", onSel);
      }, []);

      // 拉本页内容（首次加载/外部修改/冲突回读共用）：拆掉 frontmatter（不进渲染器，
      // 原文存 fmRef 保存时拼回），docTick bump 驱动重挂载对齐盘上内容
      const loadCurrent = react.useCallback(async () => {
        setConflict(null);
        try {
          const body = await kitJson(`/dsh-kit/read?path=${encodeURIComponent(path)}&maxBytes=${VAULT_PAGE_MAX_BYTES}`);
          const raw = body.binary ? "" : (body.content ?? "");
          const { fmText, rest } = body.binary ? { fmText: "", rest: "" } : vaultSplitFrontmatter(raw);
          fmRef.current = fmText;
          mtimeRef.current = body.mtimeMs ?? 0;
          setPage({ loading: false, body: rest.trimStart(), binary: body.binary === true, truncated: body.truncated === true, gone: false });
          setDocTick((t) => t + 1);
        } catch {
          fmRef.current = "";
          mtimeRef.current = 0;
          setPage({ loading: false, body: "", binary: false, truncated: false, gone: true });
          setDocTick((t) => t + 1);
        }
      }, [path]);

      react.useEffect(() => {
        setPage({ loading: true, body: "", binary: false, truncated: false, gone: false });
        void loadCurrent();
        return undefined;
      }, [loadCurrent]);

      // 保存入口（RteEditor 自动保存 / Ctrl+S / 冲突覆盖都经 onSave 走到这里）。
      // content = fmRef（frontmatter 字节级原文）+ 编辑器 md，baseMtime 用读到
      // 那一版的 mtime；盘上不是它就回 modified → 出冲突条等用户裁决（插件不碰
      // git，没有存档兜底，绝不静默覆盖）；文件已不在回 missing → 丢弃这次写，
      // 否则改名/删除后的兜底保存会把旧路径的页写活回来。
      // outcome: ok | conflict | gone | fail
      const saveVaultPage = react.useCallback(
        async (bodyMd, mode = "auto") => {
          const content = fmRef.current + bodyMd;
          const base = mode === "overwrite" ? (conflictRef.current?.diskMtime ?? mtimeRef.current) : mtimeRef.current;
          try {
            const body = await kitJson("/dsh-kit/vault/write", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path, content, baseMtime: base }),
            });
            if (body.missing === true) {
              setPage({ loading: false, body: "", binary: false, truncated: false, gone: true });
              toast(t("vaultPageGone"));
              return "gone";
            }
            if (body.modified === true) {
              setConflict({ diskMtime: body.mtimeMs ?? 0 });
              toast(t("vaultSaveConflict"));
              return "conflict";
            }
            setConflict(null);
            mtimeRef.current = body.mtimeMs ?? mtimeRef.current;
            if (mode === "manual") {
              toast(t("vaultSaved"));
              onIndexRefresh();
            }
            return "ok";
          } catch (error) {
            toast(t("vaultSaveFail").replace("{error}", String(error?.message ?? error)));
            return "fail";
          }
        },
        [path, onIndexRefresh, toast],
      );
      // 冲突条按钮经它调，闭包永远新鲜
      const saveEditRef = react.useRef(null);
      saveEditRef.current = {
        overwrite: async () => (rteCtlRef.current ? rteCtlRef.current.overwrite() : "fail"),
        reload: () => loadCurrent(),
      };
      // 切走即存：激活位从 true 落到 false 的那一刻把防抖未触发的改动落盘（冲突中
      // 不动——静默覆盖盘上内容比丢一次自动保存糟得多，等用户切回来处理冲突条）。
      // 用“上一帧激活位”判边沿：写进 effect 清理函数会张冠李戴（清理属于上一次
      // 渲染，激活→失活时清的是「激活那帧」的空清理，等于永不触发）
      const wasActiveRef = react.useRef(active);
      react.useEffect(() => {
        const was = wasActiveRef.current;
        wasActiveRef.current = active;
        if (!was || active) return;
        if (conflictRef.current !== null) return;
        if (rteCtlRef.current && rteCtlRef.current.dirty()) void rteCtlRef.current.flush();
      }, [active]);

      // 外部修改实时刷新：只轮询激活页（后台签别白烧请求）。盘上变了且本地无脏改、
      // 无冲突 → 静默重读整页 + 刷索引（agent/外部编辑器改文件零手动刷新）；有脏改
      // 时不动，交给保存时的 CAS 冲突条。文件被外部删除也重读 → 显示已消失。
      // fetch 失败静默（尽力而为）
      react.useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          if (conflictRef.current !== null || (rteCtlRef.current && rteCtlRef.current.dirty())) return;
          void kitJson(`/dsh-kit/vault/stat?path=${encodeURIComponent(path)}`)
            .then((body) => {
              if (typeof body.mtimeMs === "number" && Math.abs(body.mtimeMs - mtimeRef.current) < 1) return;
              void loadCurrent();
              onIndexRefresh();
            })
            .catch(() => {});
        }, 4000);
        return () => clearInterval(timer);
      }, [active, path, loadCurrent, onIndexRefresh]);

      /** 图片入库并插到光标处：浏览器侧先按阈值压缩 → POST /dsh-kit/vault/attach
       *  进 attachments/（内容寻址，同内容不重写）→ 光标处插图片节点。
       *  粘贴与斜杠菜单「附件 → 图片」共用这一条管线（落库规则因此只有一套） */
      const attachAndInsert = async (files) => {
        for (const f of files) {
          try {
            const img = await shrinkPastedImage(f);
            const body = await kitJson("/dsh-kit/vault/attach", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ dataBase64: await blobToBase64(img.blob), fileName: `paste.${img.ext}` }),
            });
            if (typeof body.rel !== "string" || body.rel === "") throw new Error("no rel");
            rteRef.current?.insertImage(body.rel, f.name || "");
          } catch {
            toast(t("vaultAttachFail"));
          }
        }
      };
      const onEditPaste = (e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => /^image\//i.test(f.type));
        if (files.length === 0) return;
        e.preventDefault();
        void attachAndInsert(files);
      };
      // 斜杠菜单「附件 → 图片」：系统文件选择器选一张走上面那条管线（取消不吭声）
      const onPickImage = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0";
        input.onchange = () => {
          input.remove();
          const files = Array.from(input.files ?? []);
          if (files.length > 0) void attachAndInsert(files);
        };
        // 挂进文档再点：选择器在部分浏览器里只认在文档中的 input
        document.body.appendChild(input);
        input.click();
      };

      /** RTE 版标题锚滚动：vendor 按标题文本 slug 匹配，锚线摆位 + 装饰闪烁 */
      const scrollAnchorRte = (anchorRaw) => {
        const h = rteRef.current;
        if (!h) return false;
        return h.scrollToHeading(anchorRaw, vaultHeadingSlug);
      };
      // 跨页锚点消费：openVaultPageAndDock 记下 vaultPendingAnchor，本页在
      // 「渲染器就绪」（onReady，覆盖新开页）与「从未激活变激活」（覆盖页签已
      // 开着、不会重挂也就不会再触发 onReady 的路径）两个时机认领
      const consumePendingAnchor = () => {
        const pend = vaultPendingAnchor;
        if (!pend || pend.path !== path || rteRef.current === null) return false;
        vaultPendingAnchor = null;
        if (pend.anchor !== "") scrollAnchorRte(pend.anchor);
        return true;
      };
      const onRteReady = () => {
        consumePendingAnchor();
      };
      react.useEffect(() => {
        if (active) consumePendingAnchor();
      }, [active]);

      const backlinks = react.useMemo(() => vaultBacklinks(indexPages ?? [], path), [indexPages, path]);
      // 「目录」浮层的数据开层时现算：大纲 + 光标所在那条（点过哪里高亮哪里）
      const outlineAt = () => {
        const items = vaultOutline(rteRef.current);
        let cur = -1;
        try {
          const from = rteRef.current.editor.state.selection.from;
          for (let i = 0; i < items.length; i++) {
            if (items[i].pos < from) cur = i;
          }
        } catch {
          /* 无选区就不高亮 */
        }
        return { items, cur };
      };
      const openBarMenu = (which, e) => {
        barMenuAnchorRef.current = e.currentTarget;
        setBarMenu((prev) => (prev === which ? null : which));
      };
      // 浮层关闭手势长在自己身上（与搜索浮层/TreeRowMenu 同约定）：
      // 点浮层与触发钮之外 / Esc 即关，Esc 不下传（别顺带收页签）
      react.useEffect(() => {
        if (barMenu === null) return undefined;
        holdEsc();
        const onDown = (e) => {
          if (!(e.target instanceof Element)) {
            setBarMenu(null);
            return;
          }
          if (e.target.closest(".dshk-vault-barmenu") !== null) return;
          if (barMenuAnchorRef.current !== null && barMenuAnchorRef.current.contains(e.target)) return;
          setBarMenu(null);
        };
        const onKey = (e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          setBarMenu(null);
        };
        document.addEventListener("pointerdown", onDown, true);
        window.addEventListener("keydown", onKey, true);
        return () => {
          releaseEsc();
          document.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("keydown", onKey, true);
        };
      }, [barMenu]);

      const barRect = barMenu !== null && barMenuAnchorRef.current !== null ? barMenuAnchorRef.current.getBoundingClientRect() : null;
      const outline = barMenu === "toc" ? outlineAt() : null;
      return jsxRuntime.jsxs("div", { className: "dshk-vault-reader", ref: paneRef, children: [
        !page || page.loading === true
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") })
          : page.gone === true
            ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultPageGone") })
            : page.binary === true
              ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultBinaryHint") })
              // 读端点对 >1MB 只回前 1MB（truncated）：不能拿半截正文喂编辑器，
              // 否则自动保存会把文件写回成前 1MB，尾部丢光
              : page.truncated === true
                ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultTooLargeHint") })
              : jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                  jsxRuntime.jsxs("div", { className: "dshk-vault-editbar", children: [
                    // 页条 = 文档级命令 + 阅读条（sticky）：撤销/重做、未保存脏点；
                    // 右端是目录/反链两个页面级入口（长文滚到哪儿都够得到——吊在
                    // 页尾的老反链区就是够不到才撤掉的）。表格命令在选区浮条上，
                    // 空了按钮留原位置灰，别忽长忽短
                    jsxRuntime.jsx(KitTip, {
                      label: t("vtbUndo"),
                      children: jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dshk-vault-tbtn",
                        onClick: () => rteRef.current?.undo(),
                        children: "↶",
                      }),
                    }),
                    jsxRuntime.jsx(KitTip, {
                      label: t("vtbRedo"),
                      children: jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dshk-vault-tbtn",
                        onClick: () => rteRef.current?.redo(),
                        children: "↷",
                      }),
                    }),
                    dirtyDot ? jsxRuntime.jsx("span", { className: "dshk-vault-dirtydot", title: t("vaultUnsaved"), children: "●" }) : null,
                    jsxRuntime.jsx(KitTip, {
                      label: outline !== null && outline.items.length === 0 ? t("vaultTocEmpty") : t("vaultToc"),
                      children: jsxRuntime.jsx("button", {
                        type: "button",
                        className: `dshk-vault-tbtn${outline !== null && outline.items.length === 0 ? " is-empty" : ""}`,
                        onClick: (e) => openBarMenu("toc", e),
                        children: t("vaultToc"),
                      }),
                    }),
                    // 光标所属标题链（面包屑，二级归属最近一级）：
                    // 占满余宽、超长省略，title 给全文；无标题覆盖时隐藏
                    crumb === "" ? null : jsxRuntime.jsx("span", { className: "dshk-vault-crumb", title: crumb, children: crumb }),
                    jsxRuntime.jsx(KitTip, {
                      label: backlinks.length === 0 ? t("vaultBlEmpty") : t("vaultBacklinks"),
                      children: jsxRuntime.jsx("button", {
                        type: "button",
                        className: `dshk-vault-tbtn dshk-vault-tbpush${backlinks.length === 0 ? " is-empty" : ""}`,
                        onClick: (e) => openBarMenu("bl", e),
                        children: `${t("vaultBacklinks")}${backlinks.length > 0 ? ` ${backlinks.length}` : ""}`,
                      }),
                    }),
                  ] }),
                  // CAS 冲突条：盘上被改而自动保存已暂停，由人裁决（覆盖 / 读盘上）
                  conflict !== null
                    ? jsxRuntime.jsxs("div", { className: "dshk-vault-conflict", children: [
                        jsxRuntime.jsx("span", { children: `⚠ ${t("vaultSaveConflict")}` }),
                        jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => void saveEditRef.current.overwrite(), children: t("vaultSaveConflictOverwrite") }),
                        jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => saveEditRef.current.reload(), children: t("vaultSaveConflictReload") }),
                      ] }, "conflict")
                    : null,
                  jsxRuntime.jsx(RteEditor, {
                    rteRef,
                    ctlRef: rteCtlRef,
                    docKey: path,
                    docTick,
                    initialMd: page.body ?? "",
                    placeholder: t("rtePlaceholder"),
                    labels: { codeCopy: t("vaultCopy"), codeCopied: t("vaultCopied") },
                    pages: indexPages,
                    onInsertImage: onPickImage,
                    onReady: onRteReady,
                    onWikiLink: (target, anchor) => {
                      if (target === "") {
                        if (anchor !== "") scrollAnchorRte(anchor);
                        return;
                      }
                      const pages = pagesRef.current ?? [];
                      const ownerSpace = pages.find((p) => p.path === path)?.space ?? "";
                      const resolved = resolveVaultLink(pages, target, ownerSpace);
                      if (resolved) onOpenPage(resolved.path, anchor, true);
                      else toast(t("vaultPageGone"));
                    },
                    resolveWiki: (target) => resolveVaultLink(pagesRef.current ?? [], target) !== null,
                    resolveSrc: (src) => {
                      const raw = String(src ?? "");
                      if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
                      // 相对引用先解 .. 再判界：越界的（`../../..`）不接管，回空串让
                      // 编辑器走破损占位——库内容不该拼出读库外文件的地址。服务端
                      // 的读端点也限根（工作区 cwd + vault/skills 根），这里是第一道
                      const sep = String(root).includes("\\") ? "\\" : "/";
                      const base = /^attachments[\\/]/i.test(raw)
                        ? String(root)
                        : String(path).split(/[\\/]+/).slice(0, -1).join(sep);
                      const abs = absJoinUnder(base, raw);
                      if (!isPathInsideVaultRoot(root, abs)) return "";
                      // 相对地址（不带 origin）：桌面版页面在 dsh-app://app/ 下，图片走
                      // 宿主的应用协议转发才带得上鉴权；绝对 http://<host> 在桌面没有 cookie
                      return `/dsh-kit/raw?path=${encodeURIComponent(abs)}`;
                    },
                    // 相对/站内链接：库内 md 按页打开，库内非 md（文献/图片）走官方
                    // 文件右栏——只读阅读面不开 PDF，拦下来又不给去处就是死点击
                    onRelLink: (href) => {
                      const target = resolveMdLink(path, root, href);
                      if (!target || !isPathInsideVaultRoot(root, target)) return;
                      if (/\.md$/i.test(target)) onOpenPage(target, undefined, true);
                      else openVaultAsset(target);
                    },
                    onState: (s) => {
                      setDirtyDot(s.dirty === true);
                      setCrumb(typeof s.crumb === "string" ? s.crumb : "");
                    },
                    onSave: saveVaultPage,
                    onPaste: onEditPaste,
                  }),
                  barMenu !== null && barRect !== null
                    ? jsxRuntime.jsx(
                        "div",
                        {
                          className: "dshk-vault-barmenu",
                          style: { top: barRect.bottom + 6, right: Math.max(8, (window.innerWidth || 1200) - barRect.right) },
                          children: barMenu === "toc"
                            ? outline === null || outline.items.length === 0
                              ? jsxRuntime.jsx("div", { className: "dshk-vault-barmenu-empty", children: t("vaultTocEmpty") })
                              : outline.items.map((it, i) =>
                                  jsxRuntime.jsx(
                                    "div",
                                    {
                                      className: `dshk-vault-barmenu-item${i === outline.cur ? " is-cur" : ""}`,
                                      style: { paddingLeft: 10 + Math.max(0, it.level - 1) * 12 },
                                      title: it.text,
                                      onClick: () => {
                                        rteRef.current?.scrollToPos(it.pos);
                                        setBarMenu(null);
                                      },
                                      children: it.text,
                                    },
                                    `${it.pos}`,
                                  ),
                                )
                            : backlinks.length === 0
                              ? jsxRuntime.jsx("div", { className: "dshk-vault-barmenu-empty", children: t("vaultBlEmpty") })
                              : backlinks.map((p) =>
                                  jsxRuntime.jsx(
                                    "div",
                                    {
                                      className: "dshk-vault-barmenu-item",
                                      title: p.rel,
                                      onClick: () => {
                                        onOpenPage(p.path, undefined, true);
                                        setBarMenu(null);
                                      },
                                      children: pageBasename(p.rel),
                                    },
                                    p.path,
                                  ),
                                ),
                        },
                        "barmenu",
                      )
                    : null,
                ] }),
      ] });
    }


    /** 侧栏索引宿主（知识库目录/日程待办占 sidebar.workspaces 单槽）：
     *  wide=false（侧栏收起）不渲染——视图挤进铁轨等于不可见；宿主 div 交给
     *  portal 投递方（VaultRootView）填内容 */
    /** 侧栏浏览区（知识库 · 日程 共占的那一格）：顶部两个 tab 切换，面板本体
     *  由 tab 决定——知识库 = 目录索引宿主（VaultRootView 单实例 portal 进来），
     *  日程 = 待办清单。点日程 tab 顺带把右栏网格签带到眼前（网格才是日程主区）。
     *  owner.wide=false（侧栏收成铁轨）时不渲染。 */
    function SidebarVaultIndex(owner) {
      const side = owner ?? {};
      if (side.wide === false) return null;
      const ui = useKitUi();
      const tab = ui.vaultSideTab === "schedule" ? "schedule" : "vault";
      // tab 条只切不收：整格的开合归那条快捷键（与官方会话列表的互斥面）
      const pick = (next) => {
        if (next === tab) return;
        if (next === "schedule") openRightbarTab("schedule");
        setKitUi(sidebarViewPatch(next));
      };
      const tabBtn = (key, label, icon) =>
        jsxRuntime.jsx("button", {
          type: "button",
          className: `dshk-sidetab${tab === key ? " is-active" : ""}`,
          "aria-pressed": tab === key,
          onClick: () => pick(key),
          children: [jsxRuntime.jsx(icon, {}), jsxRuntime.jsx("span", { children: label })],
        }, key);
      return jsxRuntime.jsxs("div", { className: "dshk-sidehost", children: [
        jsxRuntime.jsx("div", { className: "dshk-sidetabs", children: [
          tabBtn("vault", t("vaultTitle"), VaultIcon),
          tabBtn("schedule", t("schedTab"), SchedIcon),
        ] }),
        tab === "schedule"
          ? jsxRuntime.jsx(ScheduleTasksPanel, {})
          : jsxRuntime.jsx("div", { className: "dshk-sidebody", ref: (el) => vaultSideSlot.set(el) }),
      ] });
    }

    /** 功能存在性跟随 pane 挂载（vault/browser 用） */
    function useFeaturePresence(feature) {
      react.useEffect(() => {
        setKitUi(markFeaturePresence(feature, 1));
        return () => setKitUi(markFeaturePresence(feature, -1));
      }, [feature]);
    }

    // ─────────── 库内 PDF 自带阅读器（pdf.js）───────────
    // 官方文件右栏的 PDF 是「字节视图」：不记阅读位置（重挂载 / 重载都回顶）、
    // 受宿主 readBytes 的整文件字节上限（默认 32 MiB）约束、没有页码跳转。本组件
    // 在 builtinPdf 开时把库内 PDF 收成自己的 dshk-vault 签，换来这三样。
    //
    // **版面尺寸走 CSS，不走 JS 算出来的内联宽高**：页盒宽度 = calc(100% × 相对基准
    // 页宽的比例)，高度由 aspect-ratio 自己算。栏宽一变浏览器立刻重排几百个盒子，
    // React 一帧里一个内联尺寸都不用写——**DOM 永远和容器同宽，不存在「容器已是新
    // 宽度、页盒还是旧宽度」的那一帧**。JS 只在画布上量尺寸。
    //
    // **锚点是视口中线，钉位每次 commit 都做**（见下面的 pin）：中线口径一条线贯穿
    // 落位 / 改栏宽 / 页码跳转 / 当前页。锚点只由用户滚动与页码跳转改写，改栏宽
    // 一律按它钉回去——改宽那一刻回读 scrollTop 量到的是「页高已经换了、位置还没
    // 钉回来」的中间态，记下来等于把漂移固化（页码就会没规律地跳）。
    const PDF_LIB_URL = "/dsh-kit/vendor/pdf.min.mjs";
    const PDF_WORKER_URL = "/dsh-kit/vendor/pdf.worker.min.mjs";
    /** 整文件字节护栏：端点不截断，超了在这里拦（几百 MB 的 PDF 会把一个签撑爆）；
     *  远高于官方那条 32 MiB，库里��� PDF 基本碰不到 */
    const PDF_MAX_BYTES = 256 * 1024 * 1024;
    /** 页间距 / 左右留白（px） */
    const PDF_GAP = 12;
    const PDF_PAD = 12;
    /** 拖分栏时画布等停手这么久才按新宽度重画：否则每帧都要取消上一次、重发整页
     *  渲染（几百页的书一帧几十到几百毫秒）。拖的过程中旧画面由 CSS 拉伸顶着 */
    const PDF_RASTER_SETTLE_MS = 140;
    /** 量不到尺寸的页（那一页自己坏了）先按 US Letter 铺，不让整篇排不出来 */
    const PDF_FALLBACK_BOX = { w: 612, h: 792 };
    const PDF_POS_KEY = "dshk.pdf.pos";

    let pdfLibTask = null;
    /** pdf.js 懒加载：只有库里真开了 PDF 签才下这 1.7MB */
    function ensurePdfLib() {
      if (pdfLibTask === null) {
        pdfLibTask = import(PDF_LIB_URL).then((mod) => {
          mod.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
          return mod;
        });
      }
      return pdfLibTask;
    }

    /**
     * 文档缓存：键 = 路径 + mtime + size（内容身份，改了就是另一份，位置也另记）。
     * 官方分栏开关会把这一页在 React 树里从一栏挪到另一栏（组件卸载重挂），没有
     * 缓存就是几十 MB 重下 + 重解析一遍。LRU 到量即 destroy，但**要引用计数**：
     * 签是 keepMounted 的，后台那栏仍持有 doc，销毁它等于把切回来的那栏打死。
     */
    const pdfDocs = new Map();
    /** 内容身份 → 仍挂着阅读器的数量（>0 的条目不可淘汰） */
    const pdfDocRefs = new Map();
    const PDF_DOC_CACHE_BYTES = 64 * 1024 * 1024;
    let pdfDocBytes = 0;
    function pdfDocEvict() {
      while (pdfDocBytes > PDF_DOC_CACHE_BYTES && pdfDocs.size > 1) {
        let key = null;
        for (const k of pdfDocs.keys()) {
          if ((pdfDocRefs.get(k) ?? 0) === 0) {
            key = k;
            break;
          }
        }
        if (key === null) break; // 全都被在用的阅读器持有：宁可超限也不打死活着的
        const entry = pdfDocs.get(key);
        pdfDocs.delete(key);
        pdfDocBytes -= entry.bytes;
        try {
          entry.task.destroy();
        } catch {
          /* 已销毁或传输已断 */
        }
      }
    }
    /** 命中即提到队尾（Map 保序即 LRU） */
    function pdfDocGet(key) {
      const entry = pdfDocs.get(key);
      if (entry === undefined) return null;
      pdfDocs.delete(key);
      pdfDocs.set(key, entry);
      return entry;
    }

    /** 阅读位置：{[内容身份]: {page}}。**只落页码**，页内比例不出这个阅读器——
     *  盘上那份比例是另一个口径的（旧算法记的是页顶相对视口顶），拿来当锚点会差
     *  半个视口。同源共享（桌面端 dsh-app://app/ 也一样），刷新浏览器、切会话都还在 */
    function pdfPosAll() {
      try {
        const raw = window.localStorage.getItem(PDF_POS_KEY);
        const v = raw === null ? null : JSON.parse(raw);
        return v !== null && typeof v === "object" && v !== null ? v : {};
      } catch {
        return {};
      }
    }
    function pdfPosGet(key) {
      const v = pdfPosAll()[key];
      return v !== null && typeof v === "object" ? v : null;
    }
    function pdfPosWrite(key, val) {
      try {
        const all = pdfPosAll();
        all[key] = val;
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k];
        window.localStorage.setItem(PDF_POS_KEY, JSON.stringify(all));
      } catch {
        /* 隐私模式 / 配额满：位置丢了不影响读 */
      }
    }

    /** 适宽基准 = 版面上最常出现的页宽（多数 PDF 同宽；宽窄混排取"多数"不抖，
     *  撞个数时取宽的） */
    function pdfBaseWidth(boxes) {
      if (boxes.length === 0) return 0;
      const counts = new Map();
      for (const b of boxes) {
        const key = Math.round(b.w * 2) / 2;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let best = 0;
      let bestCount = -1;
      for (const [w, c] of counts) {
        if (c > bestCount || (c === bestCount && w > best)) {
          best = w;
          bestCount = c;
        }
      }
      return best;
    }

    /** 锚点 = **视口中线**落在哪一页的哪个比例。一条线贯穿落位 / 改栏宽 / 页码跳转 /
     *  当前页；二分找越过中线的那页，几百页的书也不逐页量 */
    function pdfAnchorAt(root, host) {
      if (root === null || host === null || root.clientHeight === 0) return null;
      const kids = host.children;
      const n = kids.length;
      if (n === 0) return null;
      const frame = root.getBoundingClientRect();
      const y = frame.top + root.clientHeight / 2;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (kids[mid].getBoundingClientRect().bottom > y) hi = mid;
        else lo = mid + 1;
      }
      const rect = kids[lo].getBoundingClientRect();
      const h = Math.max(1, rect.height);
      return {
        page: Number(kids[lo].getAttribute("data-pdf-page")) || lo + 1,
        ratio: Math.min(1, Math.max(0, (y - rect.top) / h)),
      };
    }

    /** 锚点该在的 scrollTop。**现量 DOM**：版面刚变的那一帧，state 里的页高已经是
     *  新的、DOM 还是旧的，两边打架算出来的值会被旧的可滚范围夹掉。页还没排出来 /
     *  容器没有高度（这张签隐着）时给 null——别把位置抹成 0 */
    function pdfScrollFor(root, anchor) {
      if (root === null || anchor === null || root.clientHeight === 0) return null;
      const el = root.querySelector('.dshk-pdf-page[data-pdf-page="' + anchor.page + '"]');
      if (el === null) return null;
      const frame = root.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const want = root.scrollTop + (box.top - frame.top) + box.height * anchor.ratio - root.clientHeight / 2;
      return Math.max(0, Math.min(root.scrollHeight - root.clientHeight, want));
    }

    /** 「页顶对着视口顶」换算成中线口径（页码跳转与进场落位用） */
    function pdfTopRatio(root, el) {
      const h = Math.max(1, (el !== null && el.getBoundingClientRect().height) || 1);
      return Math.min(1, root.clientHeight / 2 / h);
    }

    /** 一页：盒子尺寸全交给 CSS（宽度百分比 + aspect-ratio），JS 只管光栅化与文字层。
     *  memo 住——拖分栏时栏宽每帧都在变，但这里的 props 一个都不变，重排交给浏览器 */
    const PdfPageBox = react.memo(function PdfPageBox(props) {
      const { doc, index, box, base, rasterW, visible, lib, active } = props;
      const canvasRef = react.useRef(null);
      const textRef = react.useRef(null);
      const [failed, setFailed] = react.useState(null);
      const drawnRef = react.useRef("");
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // 画布按**去抖后**的栏宽铺（不是按当下的盒子宽）：拖着的时候盒子由 CSS 拉伸，
      // 画布等停手再按新尺寸重画一次
      const ratio = box.w / (base > 0 ? base : box.w);
      const cssW = Math.max(40, Math.round(ratio * Math.max(120, rasterW - PDF_PAD * 2)));
      const stamp = cssW + "@" + box.w + "x" + box.h + "@" + dpr.toFixed(2);
      react.useEffect(() => {
        // 滚出视野的页留着画面不重画（回来时尺寸没变直接跳过）
        if (!visible || !active || rasterW === 0) return undefined;
        if (drawnRef.current === stamp) return undefined;
        drawnRef.current = stamp;
        const canvas = canvasRef.current;
        if (canvas === null) return undefined;
        let disposed = false;
        let task = null;
        (async () => {
          const page = await doc.getPage(index + 1);
          if (disposed) return;
          const natural = page.getViewport({ scale: 1 });
          const cssScale = cssW / natural.width;
          const viewport = page.getViewport({ scale: cssScale * dpr });
          // **画到离屏画布上再换**：直接改可见画布的 width/height 会当场把它清空，
          // 重画完之前那一片是白的——停手那一瞬整片页闪一下就是这么来的
          const buffer = document.createElement("canvas");
          buffer.width = Math.max(1, Math.floor(viewport.width));
          buffer.height = Math.max(1, Math.floor(viewport.height));
          const textContent = await page.getTextContent();
          if (disposed) return;
          task = page.render({ canvas: buffer, viewport });
          await task.promise;
          if (disposed) return;
          // 同一个任务里换尺寸 + 贴图，浏览器来不及画出中间那张空白
          canvas.width = buffer.width;
          canvas.height = buffer.height;
          const ctx = canvas.getContext("2d");
          if (ctx !== null) ctx.drawImage(buffer, 0, 0);
          const container = textRef.current;
          if (container === null || lib === null || !lib.TextLayer) return;
          container.textContent = "";
          // 文字层版式全靠这几个 CSS 变量（字号 = --total-scale-factor × 页内单位高度）。
          // pdf.js 自己只写 --min-font-size，缩放因子得由调用方给
          container.style.setProperty("--total-scale-factor", String(cssScale));
          const layer = new lib.TextLayer({
            textContentSource: textContent,
            container,
            viewport: page.getViewport({ scale: cssScale }),
          });
          await layer.render();
          if (disposed) layer.cancel();
        })().catch((error) => {
          if (!disposed) setFailed(String((error && error.message) || error));
        });
        return () => {
          disposed = true;
          if (task !== null) {
            try {
              task.cancel();
            } catch {
              /* 已画完 */
            }
          }
        };
      }, [doc, index, cssW, stamp, box, visible, rasterW, lib, active]);
      return jsxRuntime.jsx("div", {
        className: "dshk-pdf-page",
        "data-pdf-page": index + 1,
        // 宽度按「相对基准页宽的比例」铺满，高度由纵横比自己算——栏宽一变浏览器
        // 当场重排，React 一个内联宽高都不用写
        style: { width: "calc(100% * " + ratio + ")", aspectRatio: box.w + " / " + box.h },
        children: [
          jsxRuntime.jsx("canvas", { key: "c", ref: canvasRef, className: "dshk-pdf-canvas" }),
          jsxRuntime.jsx("div", { key: "t", ref: textRef, className: "dshk-pdf-text" }),
          failed === null ? null : jsxRuntime.jsx("div", { key: "e", className: "dshk-pdf-pagefail", children: failed }),
        ],
      });
    });

    /** 库内 PDF 签正文（path = 签地址解出的库内绝对路径） */
    function VaultPdfPane(props) {
      return vaultPdfPaneBody(props);
    }
    function vaultPdfPaneBody(props) {
      const path = props.path;
      const active = props.active !== false;
      const [doc, setDoc] = react.useState(null);
      const [lib, setLib] = react.useState(null);
      /** 每页的用户单位尺寸：{w, h}。宽窄混排各按自己的纵横比，不会被压扁 */
      const [boxes, setBoxes] = react.useState([]);
      const [ident, setIdent] = react.useState("");
      const [error, setError] = react.useState(null);
      const [notice, setNotice] = react.useState(null);
      /** 容器宽（ResizeObserver 量的当下值）与**光栅化用的宽**（停手后才跟上） */
      const [containerW, setContainerW] = react.useState(0);
      const [rasterW, setRasterW] = react.useState(0);
      const [curPage, setCurPage] = react.useState(1);
      /** 当下在视口附近（上下各 1.5 屏）的页：只有这些页要光栅化 */
      const [visible, setVisible] = react.useState(() => new Set());
      const [attempt, setAttempt] = react.useState(0);
      const scrollRef = react.useRef(null);
      const hostRef = react.useRef(null);
      /** 「读到哪」= 视口中线落在哪一页的哪个比例。**只由用户滚动与页码跳转改写**；
       *  改栏宽、进场落位都只按它钉回去，不在改宽那一刻回读 scrollTop 当锚点 */
      const anchorRef = react.useRef(null);
      /** 进场落点落在哪一页（盘上只记页码，记的就是它） */
      const bootRef = react.useRef(1);
      const count = boxes.length;
      const base = pdfBaseWidth(boxes);

      // 载入：内容身份 = 路径 + mtime + size（改过就是另一份，位置也另记）
      react.useEffect(() => {
        let alive = true;
        /** 本阅读器占住的内容身份（清理时释放，见 pdfDocRefs） */
        let heldKey = null;
        setDoc(null);
        setLib(null);
        setBoxes([]);
        setIdent("");
        setError(null);
        setNotice(null);
        setVisible(new Set());
        anchorRef.current = null;
        (async () => {
          const pdfLib = await ensurePdfLib();
          const stat = await kitJson("/dsh-kit/vault/stat?path=" + encodeURIComponent(path));
          if (!alive) return;
          if (stat === null || typeof stat !== "object" || stat.gone === true) {
            setError(t("pdfMissing"));
            return;
          }
          const size = Number(stat.size);
          if (Number.isFinite(size) && size > PDF_MAX_BYTES) {
            setNotice(t("pdfTooLarge") + " " + Math.round(size / 1048576) + " MB");
            return;
          }
          const key = path + "|" + stat.mtimeMs + "|" + stat.size;
          heldKey = key;
          pdfDocRefs.set(key, (pdfDocRefs.get(key) ?? 0) + 1);
          const saved = pdfPosGet(key);
          // 盘上只记页码：进来落在该页页顶。锚点等版面排出来由钉位那一步现算
          bootRef.current = Math.max(1, Number(saved && saved.page) || 1);
          let entry = pdfDocGet(key);
          if (entry === null) {
            const resp = await fetch("/dsh-kit/vault/file?path=" + encodeURIComponent(path), {
              credentials: "same-origin",
            });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const buf = new Uint8Array(await resp.arrayBuffer());
            const task = pdfLib.getDocument({ data: buf });
            const parsed = await task.promise;
            entry = { task, doc: parsed, bytes: buf.byteLength };
            pdfDocs.set(key, entry);
            pdfDocBytes += entry.bytes;
            pdfDocEvict();
          }
          if (!alive) return;
          setLib(pdfLib);
          setIdent(key);
          setDoc(entry.doc);
        })().catch((err) => {
          if (alive) setError(String((err && err.message) || err));
        });
        return () => {
          alive = false;
          if (heldKey !== null) {
            const left = (pdfDocRefs.get(heldKey) ?? 1) - 1;
            if (left <= 0) pdfDocRefs.delete(heldKey);
            else pdfDocRefs.set(heldKey, left);
            pdfDocEvict();
          }
        };
      }, [path, attempt]);

      // 版面度量：逐页取用户单位下的宽高，攒够一批提交一次（每页一次 setState 会把
      // 长文档的重渲染放大成几百上千次）。某一页自己坏了量不到就按 Letter 铺，
      // 一页坏掉不毁整篇
      react.useEffect(() => {
        if (doc === null) return undefined;
        let alive = true;
        const n = doc.numPages;
        const acc = new Array(n).fill(null);
        let filled = 0;
        let queued = false;
        const flush = () => {
          if (queued || !alive) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            if (!alive) return;
            setBoxes(acc.map((b) => b ?? PDF_FALLBACK_BOX));
          });
        };
        const jobs = [];
        for (let i = 0; i < n; i++) {
          jobs.push(
            doc.getPage(i + 1).then((page) => {
              const v = page.getViewport({ scale: 1 });
              acc[i] = { w: v.width, h: v.height };
              filled++;
              // 攒够一批提交一次（每页一次 setState 会把重渲染放大成几百上千次）
              if (filled % 32 === 0 || filled === n) flush();
            }),
          );
        }
        void Promise.allSettled(jobs).then(() => flush());
        return () => {
          alive = false;
        };
      }, [doc]);

      // 容器宽：一个 ResizeObserver 量滚动容器。量到 0 = 这张签被隐起来或栏被收起，
      // 不是版面变窄——记下来会把整篇塌成最小宽，留着上一次的。**依赖 count**：
      // 文档没就位时正文走的是另一棵树，滚动容器还不存在，挂不上观察器
      react.useEffect(() => {
        const root = scrollRef.current;
        if (root === null) return undefined;
        let last = 0;
        const measure = () => {
          const w = root.clientWidth;
          if (w <= 0 || w === last) return;
          last = w;
          setContainerW(w);
        };
        if (typeof ResizeObserver === "undefined") {
          measure();
          return undefined;
        }
        const ro = new ResizeObserver(measure);
        ro.observe(root);
        measure();
        return () => ro.disconnect();
      }, [count]);

      // 光栅化去抖：宽度每帧都在变，画布等停手 PDF_RASTER_SETTLE_MS 才按新宽重画。
      // 版面照走（CSS 跟着容器即时重排），拖的过程中旧画面由 CSS 拉伸顶着
      react.useEffect(() => {
        if (containerW === rasterW) return undefined;
        const timer = window.setTimeout(() => setRasterW(containerW), PDF_RASTER_SETTLE_MS);
        return () => window.clearTimeout(timer);
      }, [containerW, rasterW]);

      // 钉位：每次 commit 都校一次 + 下一帧复核。**不写依赖表**——页高可能在任意一次
      // commit 里变（容器的 ResizeObserver、页表出来、父组件重渲染……），挂依赖表必然
      // 漏掉某一帧，而漏掉的那一帧就是「拖栏宽时页面自己上下跑」
      react.useLayoutEffect(() => {
        const root = scrollRef.current;
        if (root === null || count === 0) return undefined;
        let a = anchorRef.current;
        if (a === null) {
          // 还没定下读到哪（刚打开、也没滚过）：按进场页落在页顶
          const boot = Math.min(bootRef.current, count);
          const el = root.querySelector('.dshk-pdf-page[data-pdf-page="' + boot + '"]');
          if (el === null) return undefined;
          a = { page: boot, ratio: pdfTopRatio(root, el) };
          anchorRef.current = a;
        }
        const pin = () => {
          const want = pdfScrollFor(root, anchorRef.current);
          if (want !== null && Math.abs(want - root.scrollTop) > 1) root.scrollTop = want;
        };
        pin();
        const raf = requestAnimationFrame(pin);
        return () => cancelAnimationFrame(raf);
      });

      // 滚动 → 当前页与「读到哪」；停手 400ms 记一次位置。**只有真滚过才改锚点**——
      // 落位那一下的程序滚动不改（它就是按锚点来的，改回去只会把它钉歪）
      react.useEffect(() => {
        const root = scrollRef.current;
        if (root === null) return undefined;
        let frame = 0;
        let timer = 0;
        const measure = (fromScroll) => {
          frame = 0;
          const a = pdfAnchorAt(root, hostRef.current);
          if (a === null) return;
          if (fromScroll) anchorRef.current = a;
          setCurPage((cur) => (cur === a.page ? cur : a.page));
          if (!fromScroll || ident === "") return;
          if (timer !== 0) window.clearTimeout(timer);
          timer = window.setTimeout(() => pdfPosWrite(ident, { page: a.page }), 400);
        };
        const onScroll = () => {
          if (frame === 0) frame = requestAnimationFrame(() => measure(true));
        };
        root.addEventListener("scroll", onScroll, { passive: true });
        measure(false);
        return () => {
          root.removeEventListener("scroll", onScroll);
          if (frame !== 0) cancelAnimationFrame(frame);
          if (timer !== 0) window.clearTimeout(timer);
        };
      }, [count, ident]);

      // 懒光栅：一个观察器管全篇（上下各 1.5 屏），进出视野都记一下——改栏宽后要重画的
      // 正是此刻在视野里的那几页。观察器只随页数重建：挂在栏宽上会让拖分栏每帧重新
      // observe 全部 N 页
      react.useEffect(() => {
        const root = scrollRef.current;
        const host = hostRef.current;
        if (root === null || host === null || count === 0) return undefined;
        if (typeof IntersectionObserver === "undefined") {
          setVisible(new Set(Array.from({ length: count }, (_, i) => i)));
          return undefined;
        }
        const io = new IntersectionObserver(
          (entries) => {
            setVisible((prev) => {
              let next = prev;
              for (const entry of entries) {
                const idx = Number(entry.target.getAttribute("data-pdf-page")) - 1;
                if (!(idx >= 0) || prev.has(idx) === entry.isIntersecting) continue;
                if (next === prev) next = new Set(prev);
                if (entry.isIntersecting) next.add(idx);
                else next.delete(idx);
              }
              return next === prev ? prev : next;
            });
          },
          { root, rootMargin: "150% 0px" },
        );
        for (const el of host.children) io.observe(el);
        return () => io.disconnect();
      }, [count]);

      const jumpTo = (page) => {
        const root = scrollRef.current;
        if (root === null || count === 0) return;
        const p = Math.min(Math.max(1, Math.round(page)), count);
        const el = root.querySelector('.dshk-pdf-page[data-pdf-page="' + p + '"]');
        if (el === null) return;
        const a = { page: p, ratio: pdfTopRatio(root, el) };
        anchorRef.current = a;
        const want = pdfScrollFor(root, a);
        if (want !== null) root.scrollTop = want;
        setCurPage(p);
      };

      if (error !== null) {
        return jsxRuntime.jsx("div", { className: "dshk-vault-reader", children: jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("pdfFailed") + "：" + error }) });
      }
      if (notice !== null) {
        return jsxRuntime.jsx("div", { className: "dshk-vault-reader", children: jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: notice }) });
      }
      if (doc === null || lib === null) {
        return jsxRuntime.jsx("div", { className: "dshk-vault-reader", children: jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("pdfOpening") }) });
      }

      return jsxRuntime.jsxs("div", { className: "dshk-pdf", children: [
        jsxRuntime.jsxs("div", { key: "bar", className: "dshk-pdf-bar", children: [
          jsxRuntime.jsx("input", {
            key: "n",
            className: "dshk-pdf-pageno",
            type: "text",
            inputMode: "numeric",
            value: String(curPage),
            "aria-label": t("pdfPage"),
            onChange: (e) => jumpTo(Number(String(e.target.value).replace(/\D/g, "")) || 1),
          }),
          jsxRuntime.jsxs("span", { key: "of", className: "dshk-pdf-total", children: ["/ ", String(doc.numPages)] }),
        ] }),
        jsxRuntime.jsxs("div", { key: "scroll", className: "dshk-pdf-scroll", ref: scrollRef, children: [
          jsxRuntime.jsx("div", {
            className: "dshk-pdf-doc",
            ref: hostRef,
            // children 必须进 props：宿主 jsx(type, props, key) 的第三参是 key，放第三个
            // 位置会被 React 当 key 丢掉（页盒一个都不进 DOM）
            children: boxes.map((b, i) =>
              jsxRuntime.jsx(PdfPageBox, {
                key: i,
                doc,
                index: i,
                box: b,
                base,
                rasterW,
                visible: visible.has(i),
                lib,
                active,
              }),
            ),
          }),
        ] }),
      ] });
    }

    /** 知识库 pane：一个页一张官方签（地址即页路径），正文只渲染自己这一页。
     *  读页所需的库根/索引页表/开页入口由常驻的索引视图经 publishVaultReader
     *  发布过来——页签侧不持有索引状态，索引侧也不再有 pane portal */
    function VaultPaneBody(props) {
      useFeaturePresence("vault");
      useVCfgVersion();
      const reader = useVaultReader();
      const path = rightbarItem("vault", tabAddress(props)) ?? "";
      // tabVisible 内部调的是宿主钩子（useTabInfo）——**必须每次渲染都调、且只调一次**：
      // 写在返回表达式里会被上面的 early return 分支跳过，两次渲染钩子数对不上 → React #300
      const active = tabVisible(props);
      // 索引侧没挂过（刷新后签被恢复、用户没开过侧栏）时正文自己拉一次索引：
      // 页正文要库根与页表（反链、相对链接、库内判定），缺了就只能白屏
      const [own, setOwn] = react.useState(null);
      react.useEffect(() => {
        if (path === "" || reader.root !== null || own !== null) return undefined;
        let alive = true;
        kitJson("/dsh-kit/vault/index", undefined, (b) => !!b)
          .then((body) => {
            if (!alive) return;
            setOwn({ root: typeof body?.root === "string" ? body.root : "", indexPages: Array.isArray(body?.pages) ? body.pages : [] });
          })
          .catch(() => {
            if (alive) setOwn({ root: "", indexPages: [] });
          });
        return () => {
          alive = false;
        };
      }, [path, reader.root, own]);
      const root = reader.root ?? own?.root ?? null;
      const indexPages = reader.indexPages ?? own?.indexPages ?? null;
      return jsxRuntime.jsxs("div", { className: "dshk-rbpane", children: [
        reader.earlyBody != null
          ? jsxRuntime.jsx("div", { className: "dshk-vault", children: reader.earlyBody })
          : path === ""
            ? jsxRuntime.jsx("div", { className: "dshk-vault-reader", children: jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultPickPage") }) })
            : builtinPdfOn() && isPdfPath(path)
              ? jsxRuntime.jsx(VaultPdfPane, { path, active })
              : root === null
                ? jsxRuntime.jsx("div", { className: "dshk-vault-reader", children: jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") }) })
                : jsxRuntime.jsx(VaultPagePane, {
                    path,
                    active,
                    root,
                    indexPages,
                    // 索引侧不在时：开页退回本模块的入口、刷新无回调可调（页签本组件开）
                    onOpenPage: (p, anchor, newPane) => {
                      if (typeof reader.openPath === "function") reader.openPath(p, anchor, newPane);
                      else openVaultPageAndDock(p, anchor, newPane);
                    },
                    onIndexRefresh: () => {
                      if (typeof reader.refreshIndex === "function") reader.refreshIndex();
                    },
                    toast: reader.setToast ?? (() => {}),
                  }),
      ] });
    }
    /** 日程 pane：ScheduleView（pane 内上待办 + 下网格） */
    function SchedulePaneBody() {
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children: jsxRuntime.jsx(ScheduleView, { active: true }) });
    }

    // ─────────── 本组件生效配置（声明式模型）───────────
    // 配置真源 = 本组件宿主 Config（src/vault/index.ts）。client 启动拉
    // /dsh-kit-vault/config 喂快照；行开关关闭时该端点随宿主半边不物化而 404，
    // apply 据此整体不注册（侧栏索引、右栏签、入口按钮、对话改投全不出现）。
    let vSnap = null;
    let vAvailable = false;
    const getVSnap = () => vSnap;
    const V_CFG_DEFAULTS = { vaultRoot: "", builtinPdf: false };
    function vCfgFromSnapshot(snap) {
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return { ...V_CFG_DEFAULTS };
      const v = snap.value;
      return {
        vaultRoot: typeof v.vaultRoot === "string" ? v.vaultRoot : "",
        builtinPdf: v.builtinPdf === true,
      };
    }
    /** 库内 PDF 走自带阅读器（页码跳转 / 记阅读位置 / 不吃官方字节上限） */
    function builtinPdfOn() {
      return vCfgFromSnapshot(vSnap).builtinPdf;
    }
    /** 配置订阅：快照是模块变量（不是 state），不订阅的话**签先于配置到达时
     *  会一直停在旧分支上**——配置到了也不重渲染 */
    const vCfgSubs = new Set();
    function useVCfgVersion() {
      const [, bump] = react.useReducer((n) => n + 1, 0);
      react.useEffect(() => {
        vCfgSubs.add(bump);
        return () => {
          vCfgSubs.delete(bump);
        };
      }, []);
    }
    function isPdfPath(p) {
      return /\.pdf$/i.test(String(p ?? ""));
    }
    /** 库内非 md 文件（资料库文献 / md 内链接）的去处：PDF 且自带阅读器开 → 知识库
     *  签；其余照旧走官方文件右栏（图片 / xlsx / 未知类型官方认领得更好） */
    function openVaultAsset(path) {
      if (builtinPdfOn() && isPdfPath(path)) {
        openVaultPageAndDock(path);
        return;
      }
      openOfficialFile(path);
    }
    /** 拉生效配置；返回 false = 宿主半边不可达（行关闭）= 本组件 client 面整体不注册 */
    async function loadCfg() {
      try {
        const body = await kitJson("/dsh-kit-vault/config");
        vAvailable = !!(body && typeof body === "object");
        vSnap = vAvailable ? { status: "ready", value: body } : null;
      } catch {
        vAvailable = false;
        vSnap = null;
      }
      for (const bump of vCfgSubs) bump();
      return vAvailable;
    }

    // ─────────── 配置页（plugins.row.config）───────────
    // 骨架（草稿/保存/官方表单接线）在 dock，这里只喂本组件字段表与词条；
    // 字段清单与 src/vault/index.ts 的 Config schema 同源（render-check 钉住）。
    const VAULT_CFG_FIELDS = [
      { key: "vaultRoot", type: "string", group: "kcfgGroupVault", labelKey: "kcfgVaultRoot", hintKey: "kcfgVaultRootHint" },
      { key: "builtinPdf", type: "bool", group: "kcfgGroupVault", labelKey: "kcfgBuiltinPdf", hintKey: "kcfgBuiltinPdfHint" },
    ];
    const VAULT_CFG_GROUPS = ["kcfgGroupVault"];
    const VaultConfigPage = dock.createConfigPage({
      fields: VAULT_CFG_FIELDS,
      groups: VAULT_CFG_GROUPS,
      t,
      onSaved: async () => { await loadCfg(); },
    });

    // ─────────── 右栏两张功能签（官方 sidebarRightTabs）───────────
    // 两张都是被动签，**开始页不给条目**：入口是快捷键与左栏 tab 条。
    // 服务运行期探测取用，缺服务只剩 kitUi 侧的存在性补丁（签不出现），不写进
    // dsh.client.inject。知识库是「一页一签」的内容类页类型：按 dsh-resource
    // 地址认领，签名取页名；日程仍是单张功能签（签里是周网格，没有多实例形态）
    const VAULT_RB_TABS = [
      { id: "dsh-kit-vault", kind: "dshk-vault", feature: "vault", titleKey: "vaultTitle", perItem: true, keepMounted: true },
      { id: "dsh-kit-schedule", kind: "dshk-schedule", feature: "schedule", titleKey: "schedTab" },
    ];
    const VAULT_RB_BODY = { vault: VaultPaneBody, schedule: SchedulePaneBody };
    function registerRightbar(rbCtx) {
      const tabs = rbCtx.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      for (const f of VAULT_RB_TABS) {
        const Body = VAULT_RB_BODY[f.feature];
        rbCtx.effect(() => tabs.register({
          id: f.id,
          kind: f.kind,
          ...(f.perItem === true ? { patterns: ["dsh-resource://dshk-vault/**"], keepMounted: true } : {}),
          title: (address) =>
            f.perItem === true ? pageBasename(rightbarItem(f.feature, address) ?? "") || t(f.titleKey) : t(f.titleKey),
        }), "dsh-kit-vault: rightbar tab type " + f.kind);
        rbCtx.effect(() => rbCtx.slots.inject("sidebar.right.pane.tab", () => rbCtx.slots.register({
          name: "sidebar.right.pane.tab",
          key: f.id,
        }, Body)), "dsh-kit-vault: rightbar pane body " + f.kind);
      }
    }

    // ─────────── 官方快捷键服务 ───────────
    // 知识库索引开合命令注册进宿主 shortcuts 服务 = 进官方「快捷键」页（Ctrl+/）：
    // 录制、冲突检测、持久化全归官方。默认键只给 web:macos/web:windows（web 端放行表
    // 内）与 desktop 三档；运行期 inject。
    const VAULT_SHORTCUT_DEFAULTS = (code) => ({
      "web:macos": { code, modifiers: ["primary", "alt"] },
      "web:windows": { code, modifiers: ["primary", "alt"] },
      "desktop:macos": { code, modifiers: ["primary", "alt"] },
      "desktop:windows": { code, modifiers: ["primary", "alt"] },
      "desktop:linux": { code, modifiers: ["primary", "alt"] },
    });
    function registerShortcuts(scCtx) {
      const shortcuts = scCtx.shortcuts;
      if (!shortcuts || typeof shortcuts.register !== "function") return;
      attachShortcutCatalog(shortcuts.catalog);
      scCtx.effect(() => shortcuts.register({
        id: "dsh-kit.vault.toggle",
        label: () => t("scVault"),
        aliases: ["vault", "knowledge base", "dsh-kit"],
        defaults: VAULT_SHORTCUT_DEFAULTS("Slash"),
        // editable/terminal 都要：聊天输入行里、终端里按都该生效
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => {
          if (!vAvailable) return { status: "blocked", reason: t("scVaultOff") };
          if (!rightbarSeat.available) return { status: "blocked", reason: rootT("scNoSeat") };
          const run = shortcutRun.vault;
          if (run == null) return { status: "pass" };
          return { status: "handled", run };
        },
      }), "dsh-kit-vault: shortcut dsh-kit.vault.toggle");
    }

    // ─────────── 左栏底部入口钮（sidebar.footer.action）───────────
    /** 知识库 · 日程的常驻入口：开 = 左栏那一格占住并落在知识库 tab（与快捷键同语义
     *  的 toggleVaultEntry），再点 = 回官方会话列表。手机上没键盘，这一枚才是可达的
     *  入口——那一格里的「知识库/日程」两枚 tab 只有那格已经开着才看得见。
     *  名叫「知识库·日程」而不是「知识库」：它开的是整格，格名与两枚 tab 一致。
     *  seat 不在场（没选会话 / 全局面板在前台）时不画：那时右栏压根不画、索引视图
     *  也一并让位给官方会话列表，画出来点了也没有面可开。 */
    function VaultFooterEntry({ wide }) {
      const ui = useKitUi();
      const seatUp = useRightbarSeat();
      if (!seatUp) return null;
      const rail = wide === false;
      return jsxRuntime.jsx(KitTip, {
        label: t("vaultEntryTitle"),
        command: "dsh-kit.vault.toggle",
        side: "top",
        children: jsxRuntime.jsx("button", {
          type: "button",
          className: rail ? "dshk-sidebtn is-rail" : "dshk-sidebtn",
          "aria-pressed": ui.vaultSideOpen === true,
          onClick: () => setKitUi(toggleVaultEntry(getKitUi())),
          children: rail
            ? jsxRuntime.jsx(VaultIcon, {})
            : [jsxRuntime.jsx(VaultIcon, {}, "icon"), jsxRuntime.jsx("span", { children: t("vaultEntryTitle") }, "label")],
        }),
      });
    }

    // ─────────── 组件常驻壳（shell.overlay）───────────
    // 知识库单实例（侧栏目录 / 右栏页签任一在场即挂载，两侧 portal 自取）+ 对话文件
    // 点击路由的渲染期状态 + 快捷键动作闭包（闭包要最新会话与 cwd，不能注册期固定）。
    function VaultShell(props) {
      const ui = useKitUi();
      const sessionRow = useCurrentRow(props);
      const cwd = typeof sessionRow?.cwd === "string" && sessionRow.cwd.trim() !== "" ? sessionRow.cwd : null;
      // 对话文件点击的知识库路由状态：当前会话 cwd 每次渲染同步，供模块级 capture
      // 拦截器读取（组件不在场时拦截器整个不注册）
      chatPreviewHook = { cwd, vaultOn: true };
      shortcutRun.vault = () => setKitUi(toggleVaultEntry(getKitUi()));
      react.useEffect(() => () => { chatPreviewHook = null; }, []);
      if (!(ui.vaultOpen || ui.vaultSideOpen)) return null;
      return jsxRuntime.jsx("div", { style: { display: "none" }, children: jsxRuntime.jsx(VaultView, {}) });
    }

    exports.inject = ["slots"];
    // 行开关即总开关：宿主半边不物化时 /dsh-kit-vault/config 404，这里整体不注册
    //（侧栏索引、右栏知识库/日程签、对话路径改投、快捷键全不出现）。
    exports.apply = async (ctx) => {
      if (!(await loadCfg())) return;
      // 计时悬浮球：全局根，与槽位无关（面板全关时那只表也看得见、停得掉）
      mountSchedBall(require);
      // 本组件的两张 dock 签 kind 补登（openRightbarTab/closeRightbarTab 按 feature 查 kind）
      dock.tabKinds.vault = { id: "dsh-kit-vault", kind: "dshk-vault" };
      dock.tabKinds.schedule = { id: "dsh-kit-schedule", kind: "dshk-schedule" };
      // 座对象（root 只读，本组件填字段）：侧栏索引视图 + 文件树行点击的 vault 改道
      dock.vaultView.renderer = ({ owner }) => jsxRuntime.jsx(SidebarVaultIndex, { ...(owner ?? {}) });
      dock.vaultRoute.open = (path) => {
        if (vaultRootHint === null || !isPathInsideVaultRoot(vaultRootHint, path)) return false;
        openVaultPathFromClick(path);
        return true;
      };
      // vault root 预取：文件树/对话点击的判定同步读缓存，等点击时再取来不及
      //（索引端点宿主侧有 mtime 缓存，零成本）
      void ensureVaultRootHint();
      // 左栏底部入口钮（sidebar.footer.action）：与快捷键同一个动作（整格开合）。
      // 手机上没有键盘，这是那一格唯一的入口——输入行那枚钮已退场，格内的 tab 条
      // 只有格已经开着才看得见
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-kit-vault", order: 20 }, VaultFooterEntry));
      // 常驻壳（order 910：根壳 900 之后）
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register({ name: "shell.overlay", id: "dsh-kit-vault", order: 910 }, VaultShell));
      // 右栏两张签 + pane 正文
      ctx.inject(["sidebarRightTabs"], registerRightbar);
      // 对话文件点击的知识库路由（vault 内路径改道知识库标签，其余放行官方）
      dock.hookGlobal(document, "chatOpenFile", "click", onChatOpenFileClick, true);
      // 官方快捷键服务：知识库索引开合
      ctx.inject(["shortcuts"], registerShortcuts);
      // 配置页挂本组件行：槽位 key = <包名>#<行id>（宿主按精确 key 匹配本行）
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#vault" }, VaultConfigPage));
    };

    // 渲染级检查取用
    exports.VaultFooterEntry = VaultFooterEntry;
    exports.VaultShell = VaultShell;
    exports.VaultView = VaultView;
    exports.VaultRootView = VaultRootView;
    exports.VaultPaneBody = VaultPaneBody;
    exports.SchedulePaneBody = SchedulePaneBody;
    exports.ScheduleView = ScheduleView;
    exports.ScheduleTasksPanel = ScheduleTasksPanel;
    exports.SchedEventDialog = SchedEventDialog;
    exports.SchedEntryDialog = SchedEntryDialog;
    exports.SchedTimerStartDialog = SchedTimerStartDialog;
    exports.SchedTimerBall = SchedTimerBall;
    exports.schedOp = schedOp;
    exports.schedBus = schedBus;
    exports.schedElapsed = schedElapsed;
    exports.VaultDialog = VaultDialog;
    exports.VaultPagePane = VaultPagePane;
    exports.RteEditor = RteEditor;
    exports.SidebarVaultIndex = SidebarVaultIndex;
    exports.VaultConfigPage = VaultConfigPage;
    exports.VAULT_CFG_FIELDS = VAULT_CFG_FIELDS;
    exports.vCfgFromSnapshot = vCfgFromSnapshot;
    exports.getVSnap = getVSnap;
    exports.loadCfg = loadCfg;
    exports.registerRightbar = registerRightbar;
    exports.registerShortcuts = registerShortcuts;
    exports.VaultIcon = VaultIcon;
    exports.SchedIcon = SchedIcon;
    exports.vaultSearchHits = vaultSearchHits;
    exports.vaultSplitFrontmatter = vaultSplitFrontmatter;
    exports.resolveVaultLink = resolveVaultLink;
    exports.vaultBacklinks = vaultBacklinks;
    exports.vaultOutline = vaultOutline;
    exports.vaultHeadingSlug = vaultHeadingSlug;
    exports.vaultTabsRetarget = vaultTabsRetarget;
    exports.vaultTabsClose = vaultTabsClose;
    exports.vaultDirChoices = vaultDirChoices;
    exports.vaultCiteText = vaultCiteText;
    // PDF 阅读器的版面算术：纯函数，render-check 直测（锚点 ↔ 滚动量往返）
    exports.pdfAnchorAt = pdfAnchorAt;
    exports.pdfScrollFor = pdfScrollFor;
    exports.pdfTopRatio = pdfTopRatio;
    exports.pdfBaseWidth = pdfBaseWidth;
    exports.PdfPageBox = PdfPageBox;
    exports.VaultPdfPane = VaultPdfPane;
    exports.pathUnder = pathUnder;
    exports.absParent = absParent;
    exports.resolveMdLink = resolveMdLink;
    exports.isDocHref = isDocHref;
    exports.readPosStore = readPosStore;
    exports.recordReadPos = recordReadPos;
    exports.restoreReadPos = restoreReadPos;
    exports.ensureVaultRootHint = ensureVaultRootHint;
    exports.openVaultPathFromClick = openVaultPathFromClick;
    exports.relUnder = relUnder;
    exports.pathSegs = pathSegs;
    exports.isPathInsideVaultRoot = isPathInsideVaultRoot;
    exports.openVaultPageAndDock = openVaultPageAndDock;
    exports.onChatOpenFileClick = onChatOpenFileClick;
    exports.timerMinsOfDT = timerMinsOfDT;
    exports.schedAssignLanes = schedAssignLanes;
    exports.useHostSlot = useHostSlot;
    exports.vaultSideSlot = vaultSideSlot;
    exports.useVaultReader = useVaultReader;
    exports.toggleVaultEntry = toggleVaultEntry;
    exports.openVaultEntry = openVaultEntry;
    exports.shortcutRun = shortcutRun;

    return module.exports;
};

    // ── dsh-kit/phone 组件（手机访问）──
    // dsh-kit/phone 浏览器半边 —— 手机访问组件的 client 面。
    // 收纳：设置页「手机访问」整块（网关启停 / 二维码 / 链接复制与轮换）、组件配置页
    // （端口 / 远程域名 / 网关常驻）与设置导航的手机图标。
    // 数据走本组件宿主半边 /dsh-kit/phone/*；行开关即总开关：宿主半边不物化时
    // /dsh-kit-phone/config 404，apply 直接不注册任何槽位（设置页整块与配置页都不出现）。
    const phoneModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = kit;
    const {
      KitTip, kitGetJson, kitPostJson, kitJson, resolveZh, subscribeLocale, getLocaleVersion,
      writeClipboard, registerNavIcon, t: rootT,
    } = dock;

    // 组件私有文案（手机访问页与配置页）
    const zh = {
      phoneGateStart: "启动网关",
      phoneGateStop: "关闭网关",
      phoneStoppedHint: "网关未启动。开启后可用「刷新链接」作废旧链接。",
      phoneTitle: "手机访问",
      phoneStatusOn: "网关运行中 · 端口 {port}",
      phoneStatusErr: "网关未运行：{error}",
      phoneLoading: "正在生成链接…",
      phoneLoadFail: "读取失败：{error}",
      phoneLan: "局域网",
      phoneRemote: "远程",
      phoneScanHint: "用手机浏览器扫码，或复制地址到手机打开；首次打开后该设备长期有效。",
      phoneCopy: "复制链接",
      phoneCopied: "已复制",
      phoneRemoteCaution: "远程链接含访问令牌，二维码谨防被他人扫码。",
      phoneRotate: "刷新链接",
      phoneRotateHint: "作废当前链接并生成新链接，已授权设备将全部失效。",
      phoneRotated: "链接已刷新，旧链接已失效",
      phoneGateFail: "网关启停失败：{error}",
      phoneRotateFail: "刷新失败：{error}",
      kcfgGroupPhone: "手机访问",
      kcfgPhonePort: "手机访问端口（1–65535）",
      kcfgPhonePortHint: "网关对外端口（绑定 0.0.0.0）。",
      kcfgPhoneRemoteDomain: "手机远程域名",
      kcfgPhoneRemoteDomainHint: "远程访问域名（如内网穿透地址），留空只用局域网。",
      kcfgPhoneKeepGatewayOn: "网关常驻",
      kcfgPhoneKeepGatewayOnHint: "页面关闭后网关继续跑。",
    };
    const en = {
      phoneGateStart: "Start gateway",
      phoneGateStop: "Stop gateway",
      phoneStoppedHint: "Gateway is off. Use \"New link\" after starting to invalidate old links.",
      phoneTitle: "Phone access",
      phoneStatusOn: "Gateway running · port {port}",
      phoneStatusErr: "Gateway not running: {error}",
      phoneLoading: "Generating links…",
      phoneLoadFail: "Failed to load: {error}",
      phoneLan: "LAN",
      phoneRemote: "Remote",
      phoneScanHint: "Scan with your phone browser, or copy the address over; a device stays authorized once opened.",
      phoneCopy: "Copy link",
      phoneCopied: "Copied",
      phoneRemoteCaution: "The remote link carries an access token; keep the QR code from being scanned by others.",
      phoneRotate: "New link",
      phoneRotateHint: "Invalidate the current link and issue a new one; all authorized devices are signed out.",
      phoneRotated: "Link rotated; the old one is dead",
      phoneGateFail: "Could not {op} the gateway: {error}",
      phoneRotateFail: "Rotate failed: {error}",
      kcfgGroupPhone: "Phone access",
      kcfgPhonePort: "Phone access port (1–65535)",
      kcfgPhonePortHint: "Gateway port bound on 0.0.0.0.",
      kcfgPhoneRemoteDomain: "Phone remote domain",
      kcfgPhoneRemoteDomainHint: "Remote access domain (e.g. a tunnel host); leave blank for LAN only.",
      kcfgPhoneKeepGatewayOn: "Keep gateway on",
      kcfgPhoneKeepGatewayOnHint: "Keeps the gateway running after the page closes.",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? rootT(key);
    /** 带占位符的文案变体：tf("phoneStatusOn", { port: 3090 }) */
    const tf = (key, vars) => {
      let s = lang()[key] ?? rootT(key);
      for (const [name, value] of Object.entries(vars ?? {})) s = s.split("{" + name + "}").join(String(value));
      return s;
    };

    // ─────────── 组件配置（/dsh-kit-phone/config）───────────
    // 网关状态与链接不走这里（走 /dsh-kit/phone/info|link）；本端点只做可达性探针：
    // 200 = 行启用；404（行禁用 → 子模块不物化）= 设置页整块与配置页都不注册。
    let pAvailable = false;
    async function loadCfg() {
      try {
        const body = await kitJson("/dsh-kit-phone/config");
        pAvailable = !!(body && typeof body === "object");
      } catch {
        pAvailable = false;
      }
      return pAvailable;
    }

    // ─────────── 配置页（plugins.row.config）───────────
    // 骨架（草稿/保存/官方表单接线）在 dock，这里只喂本组件字段表与词条；
    // 字段清单与 src/phone/index.ts 的 Config schema 同源（render-check 钉住）。
    const PHONE_CFG_FIELDS = [
      { key: "phonePort", type: "number", min: 1, max: 65535, group: "kcfgGroupPhone", labelKey: "kcfgPhonePort", hintKey: "kcfgPhonePortHint" },
      { key: "phoneRemoteDomain", type: "string", group: "kcfgGroupPhone", labelKey: "kcfgPhoneRemoteDomain", hintKey: "kcfgPhoneRemoteDomainHint" },
      { key: "phoneKeepGatewayOn", type: "bool", group: "kcfgGroupPhone", labelKey: "kcfgPhoneKeepGatewayOn", hintKey: "kcfgPhoneKeepGatewayOnHint" },
    ];
    const PHONE_CFG_GROUPS = ["kcfgGroupPhone"];
    const PhoneConfigPage = dock.createConfigPage({
      fields: PHONE_CFG_FIELDS,
      groups: PHONE_CFG_GROUPS,
      t,
      onSaved: async () => { await loadCfg(); },
    });

    // ─────────── 组件样式 ───────────
    const PHONE_CSS = `
/* 手机访问页（settings.section 内联区块，与技能页同级） */
.dshk-phone{width:100%;max-width:460px}
.dshk-phone-head{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
.dshk-phone-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-phone-status{margin:0 0 10px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dshk-phone-notice{font-size:11px;line-height:1.5;color:var(--dsw-alias-brand-primary)}
.dshk-phone-body{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding-bottom:4px}
.dshk-phone-tabs{display:inline-flex;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3)}
.dshk-phone-tab{appearance:none;border:0;background:none;font:inherit;font-size:11px;line-height:1;padding:5px 12px;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-phone-tab[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dshk-phone-qrwrap{display:flex;align-items:center;justify-content:center;min-height:120px;border-radius:10px;background:#fff;padding:6px;align-self:center}
.dshk-phone-urlrow{display:flex;align-items:center;gap:6px;width:100%}
.dshk-phone-copybtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer}
.dshk-phone-copybtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-phone-copybtn[disabled]{opacity:.5;cursor:default}
.dshk-phone-hint{margin:0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.dshk-phone-gatebtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:9px 10px;border-radius:8px;cursor:pointer;width:100%;margin-bottom:10px}
.dshk-phone-rotate{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.dshk-phone-rotate:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-phone-rotate[disabled]{opacity:.5;cursor:default}
.dshk-phone-gatebtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-phone-gatebtn[disabled]{opacity:.5;cursor:default}
.dshk-phone-gatebtn-stop{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
`;
    /** 注入本组件样式（幂等；行关闭时不注册槽位也就不会注入） */
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit-phone/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit-phone";
        tag.dataset.pluginCss = "dsh-kit-phone/ui";
        tag.textContent = PHONE_CSS;
        document.head.appendChild(tag);
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

    // ─────────── 手机访问页（settings.section，与技能页同类）───────────
    // 数据源：本组件宿主半边 /dsh-kit/phone/info|link（网关状态与带令牌链接）。
    // 这些端点挂在主 webserver（只绑回环，LAN 够不到），宿主侧另有同源校验。
    // 二维码用 vendored qrcode-generator（/dsh-kit/vendor/qrcode.js），首次打开
    // 面板时按需加载，与终端组件的 xterm 同策略。
    function fetchPhoneInfo(signal) {
      // 字段以宿主回包为准：网关状态看 gatewayOn/running
      return kitGetJson("/dsh-kit/phone/info", signal, (b) => typeof b.gatewayOn === "boolean");
    }
    function fetchPhoneLinks(signal) {
      return kitGetJson("/dsh-kit/phone/link", signal, (b) => Array.isArray(b.links));
    }
    /** 把链接画上 canvas：白色静区 + 码点，按 devicePixelRatio 输出清晰图 */
    function drawPhoneQr(canvas, text) {
      const qrcode = window.qrcode;
      if (typeof qrcode !== "function") throw new Error("qrcode lib not loaded");
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const quiet = 4;
      const cell = Math.max(3, Math.floor(220 / (count + quiet * 2)));
      const size = cell * (count + quiet * 2);
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#111111";
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) ctx.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
        }
      }
    }
    function PhoneSection() {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const [info, setInfo] = react.useState(null);
      const [linkData, setLinkData] = react.useState(null);
      const [loadErr, setLoadErr] = react.useState("");
      const [activeIdx, setActiveIdx] = react.useState(0);
      const [qrReady, setQrReady] = react.useState(false);
      const [copied, setCopied] = react.useState(false);
      const [notice, setNotice] = react.useState("");
      const canvasRef = react.useRef(null);
      // 网关启停开关（POST /dsh-kit/phone/gateway；状态文件直管，不经 settings）。
      // 远程域名/端口属插件配置，编辑入口在原生设置页（Config schema 自动生成）
      const [gateBusy, setGateBusy] = react.useState(false);
      const toggleGateway = async (next) => {
        if (gateBusy) return;
        setGateBusy(true);
        try {
          const body = await kitPostJson("/dsh-kit/phone/gateway", { on: next }, (b) => typeof b.gatewayOn === "boolean");
          // 以端点回包为准更新状态（不依赖 settings 读取器，无滞后）
          setInfo((info) =>
            info === null
              ? info
              : { ...info, gatewayOn: body.gatewayOn, running: body.running === true, error: body.error ?? null },
          );
          if (body.gatewayOn && body.running) {
            fetchPhoneLinks(new AbortController().signal).then(setLinkData).catch(() => {});
          } else {
            setLinkData(null);
          }
        } catch (e) {
          setNotice(tf("phoneGateFail", { op: next ? t("phoneGateStart") : t("phoneGateStop"), error: String(e?.message ?? e) }));
          setTimeout(() => setNotice(""), 3000);
        }
        setGateBusy(false);
      };
      // 手动轮换令牌：作废旧链接生成新链接（启停不轮换，见宿主 setGatewayEnabled）
      const rotateLink = async () => {
        if (gateBusy) return;
        setGateBusy(true);
        try {
          const body = await kitPostJson("/dsh-kit/phone/rotate", {}, (b) => Array.isArray(b.links));
          setLinkData(body);
          setNotice(t("phoneRotated"));
          setTimeout(() => setNotice(""), 3000);
        } catch (e) {
          setNotice(tf("phoneRotateFail", { error: String(e?.message ?? e) }));
          setTimeout(() => setNotice(""), 3000);
        }
        setGateBusy(false);
      };

      // 打开即取状态与链接；网关未跑时只显示原因。端口与远程域名是热提交，
      // 这一页不会自己重挂——切回窗口时重取一次，否则改完设置回来看到的还是旧二维码
      const refreshCtrl = react.useRef(null);
      const refresh = react.useCallback(() => {
        // 上一发还在飞就掐掉：切回窗口/焦点连发时，旧回包可能盖住新状态
        refreshCtrl.current?.abort();
        const ctrl = new AbortController();
        refreshCtrl.current = ctrl;
        fetchPhoneInfo(ctrl.signal)
          .then((body) => {
            // 成功即清错误位：否则一次瞬时失败会永久盖住状态行（只能重挂组件才消）
            setLoadErr("");
            setInfo(body);
            if (body.gatewayOn && body.running) {
              return fetchPhoneLinks(ctrl.signal).then(setLinkData).catch((e) => setLoadErr(String(e?.message ?? e)));
            }
            setLinkData(null);
            return undefined;
          })
          .catch((e) => setLoadErr(String(e?.message ?? e)));
      }, []);
      react.useEffect(() => {
        refresh();
        const onFocus = () => refresh();
        window.addEventListener("focus", onFocus);
        return () => {
          window.removeEventListener("focus", onFocus);
          refreshCtrl.current?.abort();
        };
      }, [refresh]);
      // vendored 二维码库按需加载一次
      react.useEffect(() => {
        if (typeof window !== "undefined" && typeof window.qrcode === "function") {
          setQrReady(true);
          return undefined;
        }
        loadScript("/dsh-kit/vendor/qrcode.js")
          .then(() => setQrReady(true))
          .catch(() => {});
        return undefined;
      }, []);

      const links = linkData && Array.isArray(linkData.links) ? linkData.links : [];
      // 链接会随网卡/网关开关变少变多，索引要收敛，否则越界后二维码空白
      const active = links[activeIdx] ?? links[0] ?? null;
      const activeUrl = active ? active.url : "";
      // 链接统一出二维码（LAN/远程同等待遇）；远程链接公网可达，页面提示谨防
      // 他人扫码（见 phoneRemoteCaution）。悬停复制按钮 title 可查看完整链接。
      const activeIsRemote = !!(active && active.label === "remote");
      react.useEffect(() => {
        if (!qrReady || activeUrl === "" || !canvasRef.current) return;
        try {
          drawPhoneQr(canvasRef.current, activeUrl);
        } catch {
          // 绘制失败不阻塞面板：仍可点「复制链接」获取
        }
      }, [qrReady, activeUrl]);

      const copyActive = () => {
        if (activeUrl === "") return;
        writeClipboard(activeUrl).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }
        });
      };

      const gatewayOn = info !== null && info.gatewayOn === true;
      let statusNode = jsxRuntime.jsx("p", { className: "dshk-phone-status", children: t("phoneLoading") });
      if (info !== null) {
        if (!gatewayOn) statusNode = jsxRuntime.jsx("p", { className: "dshk-phone-status", children: t("phoneStoppedHint") });
        else if (!info.running) statusNode = jsxRuntime.jsx("p", { className: "dshk-phone-status", children: tf("phoneStatusErr", { error: info.error ?? "unknown" }) });
        else statusNode = jsxRuntime.jsx("p", { className: "dshk-phone-status", children: tf("phoneStatusOn", { port: info.port }) });
      }
      if (loadErr !== "") {
        statusNode = jsxRuntime.jsx("p", { className: "dshk-phone-status", children: tf("phoneLoadFail", { error: loadErr }) });
      }

      return jsxRuntime.jsxs("div", {
        className: "dshk-phone",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-phone-head",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-phone-title", children: t("phoneTitle") }),
              jsxRuntime.jsx("span", { style: { flex: 1 } }),
              notice !== ""
                ? jsxRuntime.jsx("span", { className: "dshk-phone-notice", role: "status", children: notice })
                : null,
            ],
          }),
          jsxRuntime.jsx("button", {
            type: "button",
            className: gatewayOn ? "dshk-phone-gatebtn dshk-phone-gatebtn-stop" : "dshk-phone-gatebtn",
            disabled: gateBusy,
            onClick: () => {
              toggleGateway(!gatewayOn);
            },
            children: t(gatewayOn ? "phoneGateStop" : "phoneGateStart"),
          }),
          statusNode,
          links.length > 0
            ? jsxRuntime.jsxs(
                "div",
                {
                  className: "dshk-phone-body",
                  children: [
                    links.length > 1
                      ? jsxRuntime.jsx("div", {
                          className: "dshk-phone-tabs",
                          children: links.map((item, index) =>
                            jsxRuntime.jsx(
                              "button",
                              {
                                type: "button",
                                className: "dshk-phone-tab",
                                "aria-pressed": index === activeIdx,
                                onClick: () => setActiveIdx(index),
                                children: item.label === "remote" ? t("phoneRemote") : t("phoneLan"),
                              },
                              item.url,
                            ),
                          ),
                        })
                      : null,
                    jsxRuntime.jsx("div", { className: "dshk-phone-qrwrap", children: jsxRuntime.jsx("canvas", { ref: canvasRef, "aria-label": "QR code" }) }),
                    jsxRuntime.jsxs("div", {
                      className: "dshk-phone-urlrow",
                      children: [
                        jsxRuntime.jsx("button", {
                          type: "button",
                          className: "dshk-phone-copybtn",
                          title: activeUrl,
                          onClick: copyActive,
                          children: copied ? t("phoneCopied") : t("phoneCopy"),
                        }),
                        gatewayOn
                          ? jsxRuntime.jsx(KitTip, {
                              label: t("phoneRotateHint"),
                              children: jsxRuntime.jsx("button", {
                                type: "button",
                                className: "dshk-phone-rotate",
                                disabled: gateBusy,
                                onClick: () => {
                                  rotateLink();
                                },
                                children: t("phoneRotate"),
                              }),
                            })
                          : null,
                      ],
                    }),
                    jsxRuntime.jsx("p", { className: "dshk-phone-hint", children: t(activeIsRemote ? "phoneRemoteCaution" : "phoneScanHint") }),
                  ],
                },
              )
            : null,
        ],
      });
    }

    // ─────────── 设置导航图标 ───────────
    // 官方 navIcon(id) 只认 models/agent-presets/plugins 三个内置 id，没有注册缝；
    // 这里按标签文字找到设置导航里的「手机访问」行，把行内第一个 svg 换成自绘图标
    // （消费方在根包的 swapKitNavIcons，候选表经 dock.registerNavIcon 共享）。
    const PHONE_NAV_ICON = {
      label: () => t("phoneTitle"),
      attr: "data-dshk-phone",
      html:
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/>' +
        '<path d="M6.8 3.4h2.4"/>' +
        '<path d="M8 12.6h.01"/>' +
        "</svg>",
    };

    exports.inject = ["slots"];
    // 行开关即总开关：宿主半边不物化时 /dsh-kit-phone/config 404，这里整体不注册
    // （设置页「手机访问」整块、组件配置页与导航图标全不出现）。
    exports.apply = async (ctx) => {
      if (!(await loadCfg())) return;
      ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "kit-phone", order: 45, label: () => t("phoneTitle") },
        PhoneSection,
      ));
      // 配置页挂本组件行：槽位 key = <包名>#<行id>（宿主按精确 key 匹配本行）
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#phone" }, PhoneConfigPage));
      registerNavIcon(PHONE_NAV_ICON);
      injectStyles();
    };

    // 渲染级检查取用
    exports.PhoneSection = PhoneSection;
    exports.PhoneConfigPage = PhoneConfigPage;
    exports.PHONE_CFG_FIELDS = PHONE_CFG_FIELDS;
    exports.PHONE_NAV_ICON = PHONE_NAV_ICON;
    exports.loadCfg = loadCfg;
    exports.drawPhoneQr = drawPhoneQr;
    exports.fetchPhoneInfo = fetchPhoneInfo;
    exports.fetchPhoneLinks = fetchPhoneLinks;
    return module.exports;
    };
    // ─────────── 组件半边模块 ───────────
    // 每个组件一个隔离壳，同住本 factory：kit 形参即根 exports（同一对象引用，
    // 见文件尾的组件模块执行段），座对象机制不变。
    // 组件模块执行只组装导出（无副作用），apply 由根 apply 尾部的激活循环调用。
    // ── dsh-kit/files 组件（文件树 · 源代码管理）──
// dsh-kit/files 浏览器半边 —— 文件树与源代码管理组件的 client 面。
// 收纳：侧栏文件树（目录树/新建/改名/删除/@ 到对话）+ 源代码管理（状态/差异/
// 提交/分支/推送/提交图谱）+ SCM diff 签正文（DiffPane，挂 kitBase 的 diffPane
// 座供 root 的 FilePaneBody 取用）。数据走本组件宿主半边的端点（路径沿用
// /dsh-kit/*）。入口按钮经 slots.inject 自注册，开关 = 本组件自己的 Config
// （fileTreeEnabled/sourceControlEnabled，经 /dsh-kit-files/config 拉取）；
// 侧栏浏览区的 tree/git 分支经 kitBase.sidebarView 座交给 root 单槽分发，
// 全局快捷键经宿主 shortcuts 服务注册（键位与冲突归官方快捷键页），组合键读组件自己的配置。
    const filesModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = kit;
    const {
      setKitUi, getKitUi, useKitUi,
      KitTip, attachShortcutCatalog,
      openFileAndDock, openTreeFile, sidebarViewPatch,
      rightbarItems, closeRightbarItem,
      flashToast, writeClipboard, kitGetJson, kitPostJson, kitJson,
      resolveZh, currentComposerShell, chatMentionText,
      expandSidebarNow, TreeRowMenu, TreeFolderIcon, FileTypeIcon16, ChevronIcon,
      rightbarSeat,
    } = dock;
    const dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives");
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons[n];
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    // 组件私有文案（本组件自持词典；语言判定/切换响应来自 dock）
    const zh = {
      noCwd: "没有可用的会话工作区：先打开或创建一个会话",
      treeLabel: "文件树",
      treeRefresh: "刷新",
      treeLoading: "加载中…",
      treeEmpty: "（空目录）",
      treeFail: "加载失败",
      treeTruncated: "条目过多，列表已截断",
      // git 行尾徽标（M/A/D/R/U）的悬停文案：本包 t() 只读本包词典，root 那份读不到
      gitM: "已修改",
      gitA: "新文件",
      gitD: "已删除",
      gitR: "重命名",
      gitU: "未跟踪",
      gitTip: "git 变更",
      treeNewAny: "新建文件/目录",
      treeNewPh: "名称，\\ 开头新建文件夹，可含 / 多级，回车创建",
      treeRename: "重命名",
      treeCopyAbs: "复制绝对路径",
      treeCopied: "已复制路径",
      treeAt: "@ 到对话",
      treeAtUnavailable: "输入框未就绪（无会话或不可用）",
      treeMenu: "更多操作",
      scTitle: "源代码管理",
      scDiffTotal: "已跟踪改动的行数合计（未跟踪文件不计入）",
      scRefreshFail: "刷新失败：{error}（下面是上次读到的内容）",
      scStaged: "暂存的更改",
      scChanges: "更改",
      scEmpty: "（没有更改）",
      scNotGit: "当前目录不是 git 仓库",
      scInit: "初始化仓库",
      scInitFail: "初始化失败",
      scStage: "暂存",
      scUnstage: "取消暂存",
      scDiscard: "放弃更改",
      scDiscardConfirm: "放弃该文件的未暂存改动？此操作不可恢复。",
      cmtPlaceholder: "提交信息（必填）",
      scCommit: "提交",
      scCommitAll: "提交全部更改",
      cmtAllConfirm: "暂存区为空，将暂存并提交全部更改（含新文件）。继续？",
      scBranch: "分支",
      scBranchNew: "新分支名（Enter 新建）",
      scBranchCreate: "新建",
      scBranchCreateSwitch: "新建并切换",
      scBranchDelete: "删除分支",
      scBranchDeleteConfirm: "删除分支「{name}」？",
      scBranchForceConfirm: "该分支未合并，强制删除？（分支上的提交可能丢失）",
      scBranchCurrent: "当前",
      scBranchEmpty: "（暂无分支）",
      scBranchCreated: "已创建分支 {name}",
      scBranchNewTag: "新建",
      scBranchCreatedTag: "本次新建的分支",
      scBranchSwitched: "已切换到 {name}",
      scBranchDeleted: "已删除分支 {name}",
      scBranchOpFail: "分支操作失败",
      scPublish: "发布分支",
      scPullDone: "已拉取",
      scPullFail: "拉取失败",
      scSynced: "已同步，无待推送提交",
      scPushAhead: "推送 {n} 个提交到远程",
      scPushDone: "已推送",
      scPushFail: "推送失败",
      scPushConfirm: "推送到远程仓库？",
      scPushForceConfirm: "推送被拒绝：远程有本地没有的新提交。以本地为准强制推送？远程上本地没有的提交将丢失！",
      scPushNoUpstream: "当前分支没有上游，首次推送前需先设置",
      scPushSetUpstream: "设置上游并推送",
      scGraph: "提交图谱",
      scGraphFail: "图谱加载失败",
      scGraphEmpty: "（暂无提交）",
      scGraphMore: "加载更多",
      scDetached: "游离 HEAD",
      diffFail: "diff 加载失败",
      diffBaseParent: "与上一版（父提交 {base}）对比",
      diffBaseRoot: "根提交：与空树对比（全部为新增）",
      diffEmpty: "（无未暂存差异）",
      diffUntracked: "未跟踪文件，暂无 diff",
      diffUntrackedBinary: "未跟踪文件是二进制，没有可逐行展示的内容",
      diffUntrackedTruncated: "文件超过 512KB，仅显示前 512KB",
      diffUntrackedFailed: "未跟踪文件读取失败",
      diffOpenFile: "在侧边栏打开整个文件",
      diffOpenFileShort: "全文",
      diffSplit: "双栏对比",
      diffUnified: "单栏对比",
      contentLoading: "加载中…",
      contentEmpty: "（空文件）",
      pvDeletedNote: "文件已删除——此标签仅展示删除 diff；可在源代码管理里 ↩ 恢复文件",
      kcfgGroupFeatures: "功能开关",

      kcfgFileTreeEnabled: "文件树",
      kcfgFileTreeEnabledHint: "侧栏文件树与文件打开入口的总开关。",
      kcfgSourceControlEnabled: "源代码管理",
      kcfgSourceControlEnabledHint: "源代码管理签（状态/差异/提交图谱/分支）。",
      kcfgHideOfficialFilesEntry: "隐藏官方「工作区文件」入口",
      kcfgHideOfficialFilesEntryHint: "那只是个目录按钮；隐藏后文件仍可从对话/文件树/搜索进入。",
      // 命令名复用面板标题（treeLabel/scTitle）；这两条是官方「快捷键」页里
      // 「按不动」时显示的说明
      scTreeOff: "文件树已在配置页关闭",
      scScmOff: "源代码管理已在配置页关闭",
      scNoSeat: "当前不在对话中",
      // 本包 t() 只看本包词典（root 的同名词条读不到）：用到就得在这里备一份
      skOpFail: "操作失败",
      confirmDelete: "删除「{name}」？内容将移入回收站。",
      created: "已创建",
      renamed: "已重命名",
      deleted: "已删除",
      committed: "已提交",
      saving: "保存中…",
    };
    const en = {
      noCwd: "No session workspace available: open or create a session first",
      treeLabel: "Files",
      treeRefresh: "Refresh",
      treeLoading: "Loading…",
      treeEmpty: "(empty)",
      treeFail: "Failed to load",
      treeTruncated: "Too many entries, list truncated",
      // git status badge (M/A/D/R/U) tooltips: this module's t() only reads its own dict
      gitM: "Modified",
      gitA: "Added",
      gitD: "Deleted",
      gitR: "Renamed",
      gitU: "Untracked",
      gitTip: "git change",
      treeNewAny: "New file/folder",
      treeNewPh: "Name, \\ prefix creates a folder, / for nesting, Enter to create",
      treeRename: "Rename",
      treeCopyAbs: "Copy absolute path",
      treeCopied: "Path copied",
      treeAt: "Insert @ mention",
      treeAtUnavailable: "Composer is not ready (no active session)",
      treeMenu: "More actions",
      scTitle: "Source Control",
      scDiffTotal: "Line totals of tracked changes (untracked files excluded)",
      scRefreshFail: "Refresh failed: {error} (the content below is the last read)",
      scStaged: "Staged Changes",
      scChanges: "Changes",
      scEmpty: "(no changes)",
      scNotGit: "This folder is not in a git repository",
      scInit: "Initialize Repository",
      scInitFail: "git init failed",
      scStage: "Stage",
      scUnstage: "Unstage",
      scDiscard: "Discard changes",
      scDiscardConfirm: "Discard unstaged changes in this file? This cannot be undone.",
      cmtPlaceholder: "Commit message (required)",
      scCommit: "Commit",
      scCommitAll: "Commit All",
      cmtAllConfirm: "Nothing staged. Stage ALL changes (including untracked) and commit?",
      scBranch: "Branches",
      scBranchNew: "New branch name (Enter to create)",
      scBranchCreate: "Create",
      scBranchCreateSwitch: "Create & switch",
      scBranchDelete: "Delete branch",
      scBranchDeleteConfirm: "Delete branch \"{name}\"?",
      scBranchForceConfirm: "This branch is not fully merged. Force delete? (commits on it may be lost)",
      scBranchCurrent: "current",
      scBranchEmpty: "(no branches)",
      scBranchCreated: "Created branch {name}",
      scBranchNewTag: "new",
      scBranchCreatedTag: "Just created",
      scBranchSwitched: "Switched to {name}",
      scBranchDeleted: "Deleted branch {name}",
      scBranchOpFail: "Branch operation failed",
      scPublish: "Publish branch",
      scPullDone: "Pulled",
      scPullFail: "Pull failed",
      scSynced: "Synced — nothing to push",
      scPushAhead: "Push {n} commit(s) to remote",
      scPushDone: "Pushed",
      scPushFail: "Push failed",
      scPushConfirm: "Push to the remote repository?",
      scPushForceConfirm: "Push rejected — the remote has commits not in local. Force push (local wins)? Commits only on the remote will be LOST!",
      scPushNoUpstream: "This branch has no upstream; set one before the first push",
      scPushSetUpstream: "Set upstream & push",
      scGraph: "Commit graph",
      scGraphFail: "Failed to load the graph",
      scGraphEmpty: "(no commits)",
      scGraphMore: "Load more",
      scDetached: "Detached HEAD",
      diffFail: "Failed to load diff",
      diffBaseParent: "Compared with parent commit {base}",
      diffBaseRoot: "Root commit: diffed against empty tree (all additions)",
      diffEmpty: "(no unstaged changes)",
      diffUntracked: "Untracked file, no diff yet",
      diffUntrackedBinary: "Untracked file is binary, nothing to show line by line",
      diffUntrackedTruncated: "File exceeds 512KB, showing the first 512KB",
      diffUntrackedFailed: "Failed to read the untracked file",
      diffOpenFile: "Open the whole file in the sidebar",
      diffOpenFileShort: "Full",
      diffSplit: "Side-by-side",
      diffUnified: "Single column",
      contentLoading: "Loading…",
      contentEmpty: "(empty file)",
      pvDeletedNote: "File deleted — this tab shows the deletion diff only; restore it via ↩ in source control",


      kcfgGroupFeatures: "Features",
      kcfgFileTreeEnabled: "File tree",
      kcfgFileTreeEnabledHint: "Master switch for the sidebar file tree and file entries.",
      kcfgSourceControlEnabled: "Source control",
      kcfgSourceControlEnabledHint: "The source control tab (status, diffs, commit graph, branches).",
      kcfgHideOfficialFilesEntry: "Hide the official Workspace files entry",
      kcfgHideOfficialFilesEntryHint: "That entry is just a directory button; files stay reachable from chat, the tree, and search.",
      scTreeOff: "File tree is switched off in the config page",
      scScmOff: "Source control is switched off in the config page",
      scNoSeat: "Not in a conversation",
      skOpFail: "Operation failed",
      confirmDelete: "Delete \"{name}\"? It will be moved to the Recycle Bin.",
      created: "Created",
      renamed: "Renamed",
      deleted: "Deleted",
      committed: "Committed",
      saving: "Saving…",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;
    /** 带占位符的文案变体：tf("x", { n: 1 }) */
    const tf = (key, vars) => {
      let s = lang()[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) s = s.split("{" + name + "}").join(String(value));
      return s;
    };

    // ─────────── 组件配置（/dsh-kit-files/config，Config schema 唯一真源）───────
    // 键位不在这里：两条命令注册进官方 shortcuts 服务（见 registerShortcuts），
    // 录制与持久化归官方「快捷键」页。
    const F_CFG_DEFAULTS = {
      fileTreeEnabled: true,
      sourceControlEnabled: true,
      hideOfficialFilesEntry: false,
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
        const v = await kitJson("/dsh-kit-files/config", undefined, (b) => b !== null && typeof b === "object");
        value = v;
      } catch {
        value = null; // 端点不可达：null → cfgFromSnapshot 走内置默认
      }
      cfgSnap = value && typeof value === "object" ? { status: "ready", value } : null;
      emitCfg();
      sweepDisabledViews();
    }
    const subscribeCfg = (fn) => {
      cfgSubs.add(fn);
      return () => cfgSubs.delete(fn);
    };
    const getCfgSnapshot = () => cfgSnap;
    /** 从快照提取生效配置（字段缺失/非法逐项回退默认） */
    function cfgFromSnapshot(snap) {
      const out = { ...F_CFG_DEFAULTS };
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return out;
      const v = snap.value;
      out.fileTreeEnabled = v.fileTreeEnabled !== false;
      out.sourceControlEnabled = v.sourceControlEnabled !== false;
      out.hideOfficialFilesEntry = v.hideOfficialFilesEntry === true;
      return out;
    }
    /** 配置关但侧栏视图还开着（配置页保存 / entry 重启瞬间）：立即归位，文件随来源清掉 */
    function sweepDisabledViews() {
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      const ui = getKitUi();
      if (!cfg.fileTreeEnabled && ui.treeOpen) setKitUi({ treeOpen: false });
      if (!cfg.sourceControlEnabled && ui.gitOpen) setKitUi({ gitOpen: false });
    }
    /** 隐藏官方右栏「工作区文件」入口：body 标记 + FILES_CSS 的 display:none。
        锚点 data-sidebar-right-guide-entry 是官方胶囊的稳定属性（失效形态 = 静默不隐藏） */
    function syncOfficialFilesMask() {
      if (typeof document === "undefined" || !document.body) return;
      document.body.classList.toggle("dshk-hide-official-files", cfgFromSnapshot(getCfgSnapshot()).hideOfficialFilesEntry === true);
    }

    // ─────────── 组件样式 ───────────
    const FILES_CSS = `
/* 隐藏官方右栏「工作区文件」入口（hideOfficialFilesEntry 开时 body 挂标记类）：
   那只是个目录按钮，与文件树功能重复 */
body.dshk-hide-official-files [data-sidebar-right-guide-entry="files"]{display:none}
/* 文件树：作为 sidebar.workspaces 单槽 occupant 填满侧边栏浏览区（非浮层）。
   行/箭头对齐原生工作区树（Radius 8、padding 0 8、gap 6、hover 用 interactive-bg-hover） */
.dshk-tree{width:100%;height:100%;display:flex;flex-direction:column;pointer-events:auto}
.dshk-tree-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 4px 12px;font-size:13px}
.dshk-name{overflow:hidden;text-overflow:ellipsis}
.dshk-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:12px}
.dshk-file .dshk-name{color:var(--dsw-alias-label-secondary)}
/* git 状态徽标与 diff 着色 */
.dshk-gitbadge{flex:none;margin-left:auto;font-size:10px;line-height:14px;padding:0 5px;border-radius:6px;font-family:ui-monospace,Consolas,monospace;border:1px solid currentColor}
.dshk-gitbadge[data-k="U"]{color:#73c991}
.dshk-gitbadge[data-k="A"]{color:#73c991}
.dshk-gitbadge[data-k="M"]{color:#e2c08d}
.dshk-gitbadge[data-k="R"]{color:#4daafc}
.dshk-gitbadge[data-k="D"]{color:#e7757f}
/* ±N 行数统计（更改清单行内） */
.dshk-nums{flex:none;display:inline-flex;gap:4px;font-family:ui-monospace,Consolas,monospace;font-size:10px;line-height:14px}
.dshk-nadd{color:#73c991}
.dshk-ndel{color:#e7757f}
/* 提交框 + 行悬停操作 + 可折叠组头（源代码管理） */
.dshk-cmt{display:flex;gap:6px;padding:8px 8px 2px}
.dshk-cmt-input{flex:1;min-width:0;height:30px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;padding:0 10px}
.dshk-cmt-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dshk-chg-head{cursor:pointer;user-select:none}
.dshk-chg-chev{flex:none;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:transform .15s var(--ds-ease-in-out);display:inline-block}
.dshk-chg-chev[data-open]{transform:rotate(90deg)}
/* 无基线的整文件着色（未跟踪 / 已删除）：新增绿、删除红 */
.dshk-inline{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all;padding:4px 0;user-select:text;color:var(--dsw-alias-label-secondary)}
.dshk-il-add{color:#0dbc79;background:rgba(13,188,121,.08)}
.dshk-il-del{color:#cd3131;background:rgba(205,49,49,.08)}
/* hunk 视图：只渲染改动附近。行号列定宽不折行，长行交给文本列 */
.dshk-hunks{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;padding:4px 0 12px;user-select:text;color:var(--dsw-alias-label-secondary)}
.dshk-hunk+.dshk-hunk{margin-top:8px}
.dshk-hunkhead{position:sticky;top:0;z-index:1;padding:2px 8px;font-size:11px;color:#4daafc;background:var(--dsw-alias-interactive-bg-hover)}
.dshk-drow{display:flex;align-items:flex-start;white-space:pre-wrap;word-break:break-all}
.dshk-dno{flex:none;width:36px;padding:0 6px;text-align:right;color:var(--dsw-alias-label-tertiary);opacity:.65;user-select:none;font-variant-numeric:tabular-nums}
.dshk-dtext{flex:1;min-width:0;padding-right:8px}
.dshk-drow-add{background:rgba(13,188,121,.08)}
.dshk-drow-add .dshk-dtext{color:#0dbc79}
.dshk-drow-del{background:rgba(205,49,49,.08)}
.dshk-drow-del .dshk-dtext{color:#cd3131}
/* 双栏：左右各半，缺的一侧留空占位，中缝一条线 */
.dshk-dcell{flex:1 1 50%;min-width:0;display:flex;align-items:flex-start;white-space:pre-wrap;word-break:break-all}
.dshk-dcell+.dshk-dcell{border-left:1px solid var(--dsw-alias-border-l1)}
.dshk-dcell-add{background:rgba(13,188,121,.08)}
.dshk-dcell-add .dshk-dtext{color:#0dbc79}
.dshk-dcell-del{background:rgba(205,49,49,.08)}
.dshk-dcell-del .dshk-dtext{color:#cd3131}
.dshk-dcell-void{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-btn.dshk-textbtn{width:auto;padding:0 8px;font-size:11px}
/* 「更改」清单（源代码管理视图） */
.dshk-changes{margin:2px 4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dshk-chg-head{display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px}
.dshk-chg-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshk-diff{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;padding:4px 0;white-space:pre;overflow-x:auto;user-select:text;color:var(--dsw-alias-label-secondary)}
.dshk-diff-add{color:#0dbc79;background:rgba(13,188,121,.08)}
.dshk-diff-del{color:#cd3131;background:rgba(205,49,49,.08)}
.dshk-diff-hunk{color:#4daafc}
.dshk-diff-meta{color:var(--dsw-alias-label-tertiary)}
/* 源代码管理：分支/推送/图谱（头部工具、分支浮层、提交图谱） */
.dshk-headbtn{flex:none}
.dshk-headbtn-on{color:var(--dsw-alias-brand-primary)}
/* 选择器要带 .dshk-btn：基础类的 width:26px 在根 UI_CSS 里、而本模块样式先注入，
   同特异度下基础类反而后生效，方钮定宽会把分支名压成 0 宽（只剩图标与 ▾） */
.dshk-btn.dshk-branchbtn{display:inline-flex;flex:0 0 auto;min-width:0;width:auto;align-items:center;gap:4px;max-width:60%;overflow:hidden;padding:2px 7px;border-color:var(--dsw-alias-border-l2)}
.dshk-branchbtn>svg,.dshk-branchbtn .dshk-caret{flex:none}
.dshk-caret{font-size:9px;color:var(--dsw-alias-label-tertiary)}
.dshk-pushhint{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-pushhint span{flex:1;min-width:0}
.dshk-branch-title{padding:5px 10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px}
.dshk-branch-row{display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px;cursor:pointer}
.dshk-branch-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-branch-cur{color:var(--dsw-alias-brand-primary)}
.dshk-branch-ico{flex:none;font-size:8px;color:var(--dsw-alias-label-tertiary)}
.dshk-branch-cur .dshk-branch-ico{color:var(--dsw-alias-brand-primary)}
.dshk-branch-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-branch-track{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-branch-gone{color:#e7757f}
.dshk-branch-curtag{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-branch-new{display:flex;gap:6px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshk-branch-new .dshk-cmt-input{height:26px;font-size:11px}
.dshk-branch-new .dshk-btn-save,.dshk-branch-new .dshk-btn-cancel{white-space:nowrap}
.dshk-branch-del{appearance:none;flex:none;width:18px;height:18px;font-size:10px;line-height:1;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:4px;padding:0}
.dshk-branch-newtag{flex:none;font-size:10px;color:var(--dsw-alias-brand-primary)}
.dshk-branch-del:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 分支浮层（fixed 悬浮面板）：自带内部滚动，不参与 .dshk-tree 的 flex 挤压 */
.dshk-branch-menu{width:236px;max-height:min(70vh,420px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box}
.dshk-branch-menu .dshk-branch-title{flex:none;padding:6px 10px 4px;background:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-branch-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 0}
.dshk-branch-menu .dshk-branch-new{flex:none;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
/* 提交图谱（结构化 lane + SVG 绘制，横向滚动；窄容器隐藏作者/时间列） */
.dshk-graph{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6;overflow-x:auto;user-select:text;padding:2px 0;container-type:inline-size}
.dshk-grow{display:flex;align-items:center;white-space:pre;padding:0 8px;min-height:24px}
.dshk-gsvg{flex:none;display:block}
.dshk-gref{flex:none;font-size:10px;line-height:1.4;margin-right:4px;padding:0 5px;border-radius:5px;border:1px solid currentColor;white-space:nowrap}
.dshk-gref[data-k="head"]{color:#e2c08d}
.dshk-gref[data-k="branch"]{color:#4daafc}
.dshk-gref[data-k="tag"]{color:#b088e0}
.dshk-gref[data-k="remote"]{color:#73c991}
.dshk-ghash{flex:none;color:var(--dsw-alias-label-tertiary);width:62px;display:inline-block;margin-right:6px}
.dshk-gsubj{flex:1;min-width:0;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis}
.dshk-gauthor{flex:none;max-width:110px;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:8px}
.dshk-gdate{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:8px;white-space:nowrap}
.dshk-gmore{display:block;margin:6px auto;padding:5px 14px;appearance:none;background:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font:inherit;font-size:12px;cursor:pointer}
.dshk-gmore:hover{color:var(--dsw-alias-label-primary)}
.dshk-gmore[disabled]{opacity:.55;cursor:default}
@container (max-width: 520px){.dshk-gauthor,.dshk-gdate{display:none}}
    `;
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit-files/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit-files";
        tag.dataset.pluginCss = "dsh-kit-files/ui";
        tag.textContent = FILES_CSS;
        document.head.appendChild(tag);
      }
    }

    // ─────────── 配置页（挂组件行，骨架在 dock）───────
    const FILES_CFG_FIELDS = [
      { key: "fileTreeEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgFileTreeEnabled", hintKey: "kcfgFileTreeEnabledHint" },
      { key: "sourceControlEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgSourceControlEnabled", hintKey: "kcfgSourceControlEnabledHint" },
      { key: "hideOfficialFilesEntry", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgHideOfficialFilesEntry", hintKey: "kcfgHideOfficialFilesEntryHint" },
    ];
    const FILES_CFG_GROUPS = ["kcfgGroupFeatures"];
    const FilesConfigPage = dock.createConfigPage({
      fields: FILES_CFG_FIELDS,
      groups: FILES_CFG_GROUPS,
      t,
      onSaved: async () => {
        try {
          const body = await kitJson("/dsh-kit-files/config");
          if (body && typeof body === "object") {
            cfgSnap = { status: "ready", value: body };
            emitCfg();
          }
        } catch {
          /* 重拉失败不动快照 */
        }
        sweepDisabledViews();
      },
    });

    // ─────────── 官方快捷键服务 ───────
    // 文件树 / 源代码管理两条命令注册进宿主 shortcuts 服务 = 进官方「快捷键」页
    // （Ctrl+/）：录制、冲突检测、跨设备默认值、持久化都归官方。运行期 inject。
    // 默认键只给 web:macos/web:windows（web 端放行表只认三键组合或 primary+alt/shift）
    // 与 desktop 三档。
    function registerShortcuts(scCtx) {
      const shortcuts = scCtx.shortcuts;
      if (!shortcuts || typeof shortcuts.register !== "function") return;
      attachShortcutCatalog(shortcuts.catalog);
      const commands = [
        {
          id: "dsh-kit-files.tree.toggle",
          labelKey: "treeLabel",
          aliases: ["file tree", "workspace files", "dsh-kit"],
          code: "Comma",
          // web 档不能用 Mod+Alt+,：宿主 0.2.0 起「打开设置」在 web 也是 Mod+Alt+,，
          // shortcuts.register 跨全部档位查重，同键位直接抛错（会带走本组件两条命令）
          webModifiers: ["primary", "shift"],
          enabled: (cfg) => cfg.fileTreeEnabled,
          offKey: "scTreeOff",
          // 与入口按钮同语义：单槽互斥，收起态先展开侧栏
          run: () => {
            if (!getKitUi().treeOpen) expandSidebarNow();
            setKitUi(sidebarViewPatch(getKitUi().treeOpen ? null : "tree"));
          },
        },
        {
          id: "dsh-kit-files.scm.toggle",
          labelKey: "scTitle",
          aliases: ["source control", "git", "dsh-kit"],
          code: "Period",
          webModifiers: ["primary", "alt"],
          enabled: (cfg) => cfg.sourceControlEnabled,
          offKey: "scScmOff",
          run: () => {
            if (!getKitUi().gitOpen) expandSidebarNow();
            setKitUi(sidebarViewPatch(getKitUi().gitOpen ? null : "scm"));
          },
        },
      ];
      const defaultsOf = (code, webModifiers) => ({
        "web:macos": { code, modifiers: webModifiers },
        "web:windows": { code, modifiers: webModifiers },
        "desktop:macos": { code, modifiers: ["primary", "alt"] },
        "desktop:windows": { code, modifiers: ["primary", "alt"] },
        "desktop:linux": { code, modifiers: ["primary", "alt"] },
      });
      for (const cmd of commands) {
        scCtx.effect(() => shortcuts.register({
          id: cmd.id,
          label: () => t(cmd.labelKey),
          aliases: cmd.aliases,
          defaults: defaultsOf(cmd.code, cmd.webModifiers),
          regions: ["page", "editable", "terminal"],
          modals: [],
          resolve: () => {
            if (!cmd.enabled(cfgFromSnapshot(getCfgSnapshot()))) return { status: "blocked", reason: t(cmd.offKey) };
            // 右栏不在场（全局面板在前台 / 没选会话）：侧栏索引视图与右栏同生灭
            if (!rightbarSeat.available) return { status: "blocked", reason: t("scNoSeat") };
            return { status: "handled", run: cmd.run };
          },
        }), `dsh-kit-files: shortcut ${cmd.id}`);
      }
    }

    // ─────────── 文件树 ───────────
    // 数据走宿主半边只读端点 /dsh-kit/tree（官方 browse RPC 只列目录不列文件）。
    // 端点限根（工作区 + 各组件注册的根），cwd 是「工作区那一根」——不带就被拒。
    function fetchTree(path, signal, cwd) {
      const root = typeof cwd === "string" && cwd.trim() !== "" ? `&cwd=${encodeURIComponent(cwd.trim())}` : "";
      return kitGetJson(`/dsh-kit/tree?path=${encodeURIComponent(path)}${root}`, signal, (b) => Array.isArray(b.entries));
    }

    /** git 状态：available:false = 非 git 目录，前端隐藏徽标；available 时含
        branch/upstream/ahead/behind/detached/unborn（宿主 status -b 分支摘要） */
    function fetchGitStatus(cwd, signal) {
      return kitGetJson(`/dsh-kit/git/status?cwd=${encodeURIComponent(cwd)}`, signal, (b) => typeof b.available === "boolean");
    }
    /** git 图谱：available:false = 非 git 目录/失败；records 空数组 = 尚无提交；
        hasMore = 还有更早提交（load more 用 skip=已取条数续传） */
    function fetchGitLog(cwd, n, skip, signal) {
      const url = `/dsh-kit/git/log?cwd=${encodeURIComponent(cwd)}&n=${Number(n) || 120}&skip=${Number(skip) || 0}`;
      return kitGetJson(url, signal, (b) => typeof b.available === "boolean");
    }
    /** git 本地分支列表（{current, branches:[{name,isHead,upstream,track,trackParsed}]}） */
    function fetchGitBranch(cwd, signal) {
      return kitGetJson(`/dsh-kit/git/branch?cwd=${encodeURIComponent(cwd)}`, signal, (b) => typeof b.available === "boolean");
    }
    /** 图谱引用装饰解析（与宿主侧 src/files/git.ts parseDecoration 保持同步，入参为 %D 原文） */
    function parseDecoration(text) {
      const out = [];
      if (typeof text !== "string" || text === "") return out;
      for (const item of text.split(",").map((x) => x.trim())) {
        if (item === "") continue;
        if (item === "HEAD") out.push({ kind: "head", name: "HEAD", pointsTo: null });
        else if (item.startsWith("HEAD -> ")) out.push({ kind: "head", name: "HEAD", pointsTo: item.slice(8) });
        else if (item.startsWith("tag: ")) out.push({ kind: "tag", name: item.slice(5) });
        else if (item.startsWith("origin/")) out.push({ kind: "remote", name: item });
        else out.push({ kind: "branch", name: item });
      }
      return out;
    }

    /** 在目录初始化仓库（源代码管理空态按钮用；已是仓库则幂等返回 created:false） */
    function fetchGitInit(cwd) {
      return kitPostJson("/dsh-kit/git/init", { cwd }, (b) => typeof b.created === "boolean");
    }

    /** 文件管理操作（新建/重命名/删除）：POST /dsh-kit/fs/op，宿主做子树与名称校验 */
    function postFsOp(payload) {
      return kitPostJson("/dsh-kit/fs/op", payload, (b) => b.ok === true);
    }

    /** 文件行尾的 git 状态小徽标（M/A/D/R/U）：porcelain 未跟踪是 "??"，统一显示 U */
    function GitBadge({ xy }) {
      const s = String(xy).trim();
      const label = s === "??" || s === "?" ? "U" : s || "M";
      const tipMap = { M: "gitM", A: "gitA", D: "gitD", R: "gitR", U: "gitU" };
      return jsxRuntime.jsx("span", {
        className: "dshk-gitbadge",
        "data-k": label,
        title: `${t(tipMap[label] ?? "gitTip")}（${String(xy)}）`,
        children: label,
      });
    }

    /** git 状态轮询周期：可见时低频拉取，回窗口/聚焦立即补一次 */
    // 每次轮询都要 spawn 一个 git 进程（实测本机 status 54–276ms、log 81–110ms），
    // 所以默认档取 8s：动作后的刷新（stage/commit/branch 成功后各自 kick）与
    // 「可见性/焦点变化立即补一拍」不受影响，只影响"放着不动时的自动跟随"这一档。
  const GIT_POLL_MS = 8000;
  /** SCM 清单常开时用快拍：人盯着面板等的就是「agent 刚改完有没有出现」
   *  （一次 status+numstat 在本机 54–276ms，3s 一拍的代价可接受，且不可见时本就不轮） */
  const GIT_POLL_FAST_MS = 3000;
    /** git 轮询共享时钟：状态/提交图谱两处轮询共用一条 interval（各自挂载时
   *  订阅、卸载退订），避免同一拍上叠出多条定时器；谁在看才轮谁由各视图的挂载与
   *  可见性门控负责，这里只管节拍。订阅各自报想要的拍长，时钟按最短的走（全部
   *  退订后时钟自己停掉）。 */
  const gitTickSubs = new Map();
  let gitTickTimer = null;

  function fireGitTick() {
    if (document.visibilityState === "hidden") return;
    for (const sub of [...gitTickSubs.keys()]) {
      try {
        sub();
      } catch {
        // 单个订阅异常不拖垮其它视图
      }
    }
  }

  function armGitTick() {
    if (gitTickTimer !== null) {
      window.clearInterval(gitTickTimer);
      gitTickTimer = null;
    }
    if (gitTickSubs.size === 0) return;
    gitTickTimer = window.setInterval(fireGitTick, Math.min(...gitTickSubs.values()));
  }

  function subscribeGitTick(fn, ms = GIT_POLL_MS) {
    gitTickSubs.set(fn, ms);
    armGitTick();
    return () => {
      gitTickSubs.delete(fn);
      armGitTick();
    };
  }

    /**
     * 解析 unified patch 的 hunk 段：每行带新旧行号，只认 hunk（diff/index/---/+++
     * 头与 "\ No newline" 之类杂项行跳过）。上下文行数由 git 决定——端点没给 -U。
     * @param patch unified patch 文本
     * @returns [{oldStart,oldLines,newStart,newLines,rows:[{kind,text,oldNo,newNo}]}]，无 hunk 时 null
     */
    function parsePatchHunks(patch) {
      const hunks = [];
      let cur = null;
      let oldNo = 0;
      let newNo = 0;
      for (const line of String(patch ?? "").split(/\r?\n/)) {
        // hunk 之前有 diff/index 头部是常态，进了 hunk 再见到才是下一段文件
        if (cur !== null && (line.startsWith("diff ") || line.startsWith("index "))) break;
        const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (m) {
          oldNo = Number(m[1]);
          newNo = Number(m[3]);
          cur = { oldStart: oldNo, oldLines: m[2] === undefined ? 1 : Number(m[2]), newStart: newNo, newLines: m[4] === undefined ? 1 : Number(m[4]), rows: [] };
          hunks.push(cur);
          continue;
        }
        if (cur === null) continue;
        if (line.startsWith("+")) cur.rows.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
        else if (line.startsWith("-")) cur.rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
        else if (line.startsWith(" ")) cur.rows.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
      }
      return hunks.length > 0 ? hunks : null;
    }

    /** 双栏配对：连续的删除行与新增行按序两两成对，多出的一侧留空格；上下文行两侧同格 */
    function splitRowsOf(rows) {
      const out = [];
      let i = 0;
      while (i < rows.length) {
        const row = rows[i];
        if (row.kind === "ctx") {
          out.push({ left: row, right: row });
          i += 1;
          continue;
        }
        const dels = [];
        const adds = [];
        while (i < rows.length && rows[i].kind === "del") dels.push(rows[i++]);
        while (i < rows.length && rows[i].kind === "add") adds.push(rows[i++]);
        for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) out.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
      return out;
    }

    function FolderIcon(props) {
      const _official = dswIcon("IconFolderOpenOutline16");
      if (_official) return jsxRuntime.jsx(_official, { className: props && props.className });
      return jsxRuntime.jsx(
        "svg",
        {
          width: 15,
          height: 15,
          viewBox: "0 0 16 16",
          "aria-hidden": true,
          children: jsxRuntime.jsx("path", {
            d: "M1.5 3.5c0-.55.45-1 1-1h3.2l1.6 1.8h6.2c.55 0 1 .45 1 1v7.2c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1v-9z",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.2,
            strokeLinejoin: "round",
          }),
        },
      );
    }

    /** 分支图标（进入更改视图的入口钮）：git branch 风格两节点一弧线——官方
     *  IconBranchOutline16 不像分支，故自绘 */
    function BranchIcon(props) {
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
          children: [
            jsxRuntime.jsx("circle", { cx: 4, cy: 3.5, r: 1.7 }),
            jsxRuntime.jsx("circle", { cx: 4, cy: 12.5, r: 1.7 }),
            jsxRuntime.jsx("circle", { cx: 11.5, cy: 6, r: 1.7 }),
            jsxRuntime.jsx("path", { d: "M4 5.2v5.6" }),
            jsxRuntime.jsx("path", { d: "M11.4 7.7c-.3 2.1-2.6 2.5-5.6 3" }),
          ],
        },
      );
    }

    /** 新建文件图标：文件折角 + 加号（文件/目录共用单入口后唯一的新建图标） */
    function FilePlusIcon(props) {
      const _official = dswIcon("IconPlusOutline16");
      if (_official) return jsxRuntime.jsx(_official, { className: props && props.className });
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
            jsxRuntime.jsx("path", { d: "M3.5 1.5h5l4 4v9h-9z" }),
            jsxRuntime.jsx("path", { d: "M8.5 1.5v4h4" }),
            jsxRuntime.jsx("path", { d: "M8 7.8v3.4M6.3 9.5h3.4" }),
          ],
        },
      );
    }

    /** 复制绝对路径图标：经典双矩形 copy */
    function CopyAbsIcon(props) {
      const _official = dswIcon("IconCopyOutline16");
      if (_official) return jsxRuntime.jsx(_official, { className: props && props.className });
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
            jsxRuntime.jsx("path", { d: "M9.5 3.5h-5a1 1 0 0 0-1 1v5" }),
            jsxRuntime.jsx("rect", { x: "6.5", y: "6.5", width: "7", height: "7", rx: "1" }),
          ],
        },
      );
    }

    /** 行悬停操作小按钮（新建/重命名/删除共用）：点击不触发行本身的打开/折叠。
     *  提示走官方气泡并右对齐——行尾一排小钮，居中的气泡会盖住相邻行 */
    function RowActionBtn({ title, onClick, children }) {
      return jsxRuntime.jsx(KitTip, {
        label: title,
        align: "end",
        children: jsxRuntime.jsx("button", {
          type: "button",
          // 按下不夺焦点：光标留在输入框里，「@ 到对话」的落点判据（按光标选面）才准
          onMouseDown: (e) => e.preventDefault(),
          onClick: (e) => {
            e.stopPropagation();
            onClick(e); // 事件转发：⋯ 菜单需要 currentTarget 定位锚点
          },
          children,
        }),
      });
    }

    /**
     * 单层目录状态：{status:'loading'|'ready'|'error', entries?, truncated?, error?}
     * actions 可选——缺省时不渲染行悬停操作（渲染级验证桩调用即不带）：
     *   onCreate(dirPath,isDir) / onDelete(entry) / onRename(entry)=进入行内改名；
     *   onCopyPath(entry, relative)=复制绝对/相对路径；
     *   renamingPath + onRenameSubmit(entry,value) + onRenameCancel() 驱动行内输入框。
     */
    function TreeNode({ entry, depth, expanded, onToggle, onOpenFile, actions }) {
      const info = entry.dir ? expanded[entry.path] : undefined;
      const acts = actions ?? {};
      const renaming = !!acts.onRenameSubmit && acts.renamingPath === entry.path;
      // 行按钮「常用 + 更多」：常驻 hover 只留 @到对话、复制绝对路径与 ⋯ 菜单；
      // 新建/复制相对/重命名/删除收敛进 ⋯（留 @ 和绝对路径）
      const rowActions = [];
      if (acts.onMention) {
        rowActions.push(jsxRuntime.jsx(RowActionBtn, { title: t("treeAt"), onClick: () => acts.onMention(entry), children: "@" }, "at"));
      }
      if (acts.onCopyPath) {
        rowActions.push(jsxRuntime.jsx(RowActionBtn, { title: t("treeCopyAbs"), onClick: () => acts.onCopyPath(entry, false), children: jsxRuntime.jsx(CopyAbsIcon, {}) }, "ca"));
      }
      if (acts.onMenu) {
        rowActions.push(jsxRuntime.jsx(RowActionBtn, { title: t("treeMenu"), onClick: (e) => acts.onMenu(entry, e.currentTarget), children: "⋯" }, "mm"));
      }
      // 改名输入框：聚焦时只选中最后一个 "." 之前的主名（保留扩展名）；
      // 目录与点开头的隐藏文件（如 .gitignore）没有扩展名概念，选全名
      const nameEl = renaming
        ? jsxRuntime.jsx("input", {
            className: "dshk-rename",
            defaultValue: entry.name,
            spellCheck: false,
            autoFocus: true,
            "aria-label": t("treeRename"),
            onClick: (e) => e.stopPropagation(),
            onFocus: (e) => {
              const v = e.currentTarget.value;
              const i = v.lastIndexOf(".");
              const end = !entry.dir && i > 0 ? i : v.length;
              e.currentTarget.setSelectionRange(0, end);
            },
            onKeyDown: (e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                acts.onRenameSubmit(entry, e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                acts.onRenameCancel();
              }
            },
            onBlur: () => {
              if (acts.renamingPath === entry.path) acts.onRenameCancel();
            },
          }, "rename")
        : jsxRuntime.jsx("span", { className: "dshk-name", children: entry.name }, "name");
      const rowChildren = [
        // 空目录（宿主 /tree 附 empty 标记）没有可展开内容：去掉箭头、点击不折叠，
        // 行本身保留——空目录有"看得见"的必要；目录/文件
        // 图标常驻（箭头消失后空目录靠它和文件区分）
        jsxRuntime.jsx("span", { className: "dshk-chev", children: entry.dir && entry.empty !== true ? jsxRuntime.jsx(ChevronIcon, { open: !!info }) : null }, "chev"),
        jsxRuntime.jsx("span", { className: "dshk-ticonwrap", children: entry.dir ? jsxRuntime.jsx(TreeFolderIcon, {}) : jsxRuntime.jsx(FileTypeIcon16, { name: entry.name }) }, "dicon"),
        nameEl,
      ];
      if (rowActions.length > 0) {
        rowChildren.push(jsxRuntime.jsx("span", { className: "dshk-rowact", children: rowActions }, "acts"));
      }
      const rows = [jsxRuntime.jsxs("div", {
        className: `dshk-row${entry.dir ? "" : " dshk-file"}`,
        style: { paddingLeft: 8 + depth * 14 },
        title: entry.path,
        onClick: () => {
          if (renaming) return; // 行内改名中：点击不触发打开/折叠
          if (entry.dir) {
            if (entry.empty !== true) onToggle(entry);
          } else onOpenFile(entry.path);
        },
        children: rowChildren,
      }, entry.path)];
      if (entry.dir && info) {
        if (info.status === "loading") {
          rows.push(jsxRuntime.jsx("div", { className: "dshk-note", style: { paddingLeft: 8 + (depth + 1) * 14 }, children: t("treeLoading") }, `${entry.path}::loading`));
        } else if (info.status === "error") {
          rows.push(jsxRuntime.jsx("div", { className: "dshk-note", style: { paddingLeft: 8 + (depth + 1) * 14 }, title: info.error ?? "", children: `${t("treeFail")}${info.error ? `：${info.error}` : ""}` }, `${entry.path}::error`));
        } else if (info.entries.length === 0) {
          rows.push(jsxRuntime.jsx("div", { className: "dshk-note", style: { paddingLeft: 8 + (depth + 1) * 14 }, children: t("treeEmpty") }, `${entry.path}::empty`));
        } else {
          for (const child of info.entries) {
            rows.push(jsxRuntime.jsx(TreeNode, { entry: child, depth: depth + 1, expanded, onToggle, onOpenFile, actions }, child.path));
          }
          if (info.truncated) {
            rows.push(jsxRuntime.jsx("div", { className: "dshk-note", style: { paddingLeft: 8 + (depth + 1) * 14 }, children: t("treeTruncated") }, `${entry.path}::truncated`));
          }
        }
      }
      return jsxRuntime.jsxs(jsxRuntime.Fragment, { children: rows });
    }

    function FileTreePanel({ cwd, onOpenFile }) {
      // expanded: 路径 → 目录单层状态；根目录就是 cwd
      const [expanded, setExpanded] = react.useState({});
      // 供 nonce 刷新 effect 读取最新展开集合（保留展开状态用）
      const expandedRef = react.useRef({});
      expandedRef.current = expanded;
      const [nonce, setNonce] = react.useState(0);
      const abortsRef = react.useRef(new Set());
      // 正在行内改名的条目路径；null = 无
      const [renamingPath, setRenamingPath] = react.useState(null);
      // ⋯ 菜单：{entry, rect}；null = 关闭
      const [menuFor, setMenuFor] = react.useState(null);

      const loadDir = (dirPath) => {
        const controller = new AbortController();
        abortsRef.current.add(controller);
        setExpanded((m) => ({ ...m, [dirPath]: { status: "loading" } }));
        fetchTree(dirPath, controller.signal, cwd)
          .then((body) => {
            setExpanded((m) => ({
              ...m,
              [dirPath]: { status: "ready", entries: body.entries, truncated: body.truncated === true },
            }));
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setExpanded((m) => ({ ...m, [dirPath]: { status: "error", error: String(error?.message ?? error) } }));
          })
          .finally(() => {
            abortsRef.current.delete(controller);
          });
      };

      // cwd 切换：整树重置（展开状态不保留——那是另一棵树）
      react.useEffect(() => {
        abortsRef.current.forEach((c) => c.abort());
        abortsRef.current.clear();
        if (!cwd) {
          setExpanded({});
          return undefined;
        }
        setExpanded({ [cwd]: { status: "loading" } });
        loadDir(cwd);
        return () => {
          abortsRef.current.forEach((c) => c.abort());
          abortsRef.current.clear();
        };
      }, [cwd]);

      // ⟳ 手动刷新：保留展开状态，只重拉根与所有已展开层的内容（树是懒加载的，
      // 展开过的目录才需要刷新；未展开的下层等用户点开时自然拉最新）
      react.useEffect(() => {
        if (!nonce || !cwd) return undefined;
        const keys = Object.keys(expandedRef.current);
        const next = {};
        for (const k of keys) next[k] = { status: "loading" };
        setExpanded(next);
        for (const k of keys) loadDir(k);
        return undefined;
      }, [nonce]);

      const toggleDir = (entry) => {
        setExpanded((m) => {
          if (m[entry.path]) {
            const next = { ...m };
            delete next[entry.path];
            return next;
          }
          return { ...m, [entry.path]: { status: "loading" } };
        });
        if (!expanded[entry.path]) loadDir(entry.path);
      };

      // ── 文件管理（新建/重命名/删除）：数据走 POST /dsh-kit/fs/op，宿主做子树校验 ──
      /** 取父目录：无分隔符时回落 cwd */
      const parentOf = (p) => {
        const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
        return i > 0 ? p.slice(0, i) : cwd ?? p;
      };
      // ── 复制路径：entry.path 本就是绝对路径；相对路径 = 去掉树根（cwd）前缀 ──
      // 前缀比较必须卡在分隔符边界（cwd=D:\proj 时 D:\project2\x 不能误切成 ect2\x），
      // 不满足边界时回落绝对路径
      const copyEntryPath = (entry, relative) => {
        let text = entry.path;
        if (relative && cwd && entry.path.startsWith(cwd)) {
          const rest = entry.path.slice(cwd.length);
          if (rest === "" || /^[\\/]/.test(rest)) text = rest.replace(/^[\\/]+/, "");
        }
        writeClipboard(text).then((ok) => {
          if (ok) flashToast(t("treeCopied"));
        });
      };
      /** 清掉以 prefix 为根的整棵子树的展开缓存（目录改名/删除后这些键全部过期） */
      const pruneExpandedFrom = (prefix) => {
        const a = `${prefix}\\`;
        const b = `${prefix}/`;
        setExpanded((m) => {
          const next = {};
          for (const k of Object.keys(m)) {
            if (k === prefix || k.startsWith(a) || k.startsWith(b)) continue;
            next[k] = m[k];
          }
          return next;
        });
      };
      // ── 相对路径（@ 引用用，/ 分隔、目录尾 /）：越界/无法表示回落 null ──
      const relativePathOf = (entry) => {
        if (!cwd || !entry.path.startsWith(cwd)) return null;
        const rest = entry.path.slice(cwd.length);
        if (rest !== "" && !/^[\\/]/.test(rest)) return null;
        const norm = (rest === "" ? entry.name : rest.replace(/^[\\/]+/, "")).replace(/\\/g, "/");
        return entry.dir ? `${norm.replace(/\/+$/, "")}/` : norm;
      };
      // ── 对话 @ 引用：把选中条目作为官方引用直接插入当前会话输入框 ──
      // 优先走官方引用芯片直插（shell.insertReference，官方 @ 面板 pick 的
      // 那套槽位事件监听体，公开实例方法）：phase 须为 plain/claimed、
      // span.draftRev 须等于当前 rev（CAS），成功即产生真实引用 chip（提交
      // 时按官方 codec 序列化为 @语法文本），不经过官方 @ 面板；失败兜底为
      // @ 语法文本追加草稿末尾（与手打一致，此时面板可见属官方行为）。
      const mentionEntry = (entry) => {
        const shell = currentComposerShell();
        if (!shell || typeof shell.actions?.setDraft !== "function") {
          flashToast(t("treeAtUnavailable"));
          return;
        }
        const relPath = relativePathOf(entry);
        if (relPath === null) {
          flashToast(t("treeAtUnavailable"));
          return;
        }
        const mention = chatMentionText(relPath);
        if (mention === null) {
          flashToast(t("treeAtUnavailable"));
          return;
        }
        // 目录的开放引号形态（@"dir/）补上闭合引号，作为独立引用提交
        const chipMention = mention.includes('"') && !mention.endsWith('"') ? `${mention}"` : mention;
        const chipRef = {
          source: "reference",
          ref: chipMention,
          label: entry.dir ? `${(entry.name || "").replace(/\/+$/, "")}/` : entry.name || relPath.split("/").pop() || relPath,
          appearance: entry.dir ? "folder" : "file",
          clipboardText: mention,
        };
        if (typeof shell.insertReference === "function") {
          const phase = shell.core && shell.core.state ? shell.core.state.phase : null;
          const detectText = typeof shell.projection?.detectText === "string" ? shell.projection.detectText : "";
          const rev = typeof shell.rev === "number" ? shell.rev : -1;
          if ((phase === "plain" || phase === "claimed") && rev >= 0) {
            const span = { start: detectText.length, end: detectText.length, draftRev: rev };
            let applied = false;
            try {
              applied = shell.insertReference(chipRef, span) === true;
            } catch {
              applied = false;
            }
            if (applied) return;
          }
        }
        // 兜底：官方 @ 语法文本追加草稿末尾
        const state = typeof shell.state?.getSnapshot === "function" ? shell.state.getSnapshot() : null;
        const draft = state && typeof state.draft === "string" ? state.draft : "";
        shell.actions.setDraft(draft === "" ? mention : `${draft} ${mention}`);
      };
      /** 已打开的文件被改名/删除后关掉对应那张 diff 签（含其子路径） */
      const closeStalePreview = (prefix) => {
        for (const item of rightbarItems("file")) {
          if (item === prefix || item.startsWith(prefix + "\\") || item.startsWith(prefix + "/")) closeRightbarItem("file", item);
        }
      };
      const runFsOp = async (payload, confirmText) => {
        if (confirmText && !window.confirm(confirmText)) return false;
        try {
          await postFsOp({ cwd, ...payload });
          return true;
        } catch (error) {
          flashToast(`${t("skOpFail")}：${error?.message ?? error}`);
          return false;
        }
      };
      // 新建文件/目录单入口：内联输入，
      // `\` 开头 = 新建文件夹（剥前缀），否则建文件；可带 / 多级。头部按钮与
      // 目录行 ⋯ 菜单都汇到这里（createAt = 目标目录）
      const [createAt, setCreateAt] = react.useState(null);
      const [createName, setCreateName] = react.useState("");
      // 区域外点击 = 取消新建（直接丢弃已输入内容，不弹窗不代建）：误点代建
      // 会产生意外条目，弹窗又比一行输入的损失重；Enter 始终是显式创建
      react.useEffect(() => {
        if (createAt === null) return undefined;
        const onDown = (e) => {
          if (e.target instanceof Element && !e.target.closest(".dshk-createrow")) setCreateAt(null);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [createAt]);
      const startCreate = (dirPath) => {
        if (!cwd) return;
        setCreateAt(dirPath ?? cwd);
        setCreateName("");
      };
      const submitCreate = async () => {
        const dirPath = createAt ?? cwd;
        const raw = createName.trim();
        if (raw === "") return;
        const wantDir = raw.startsWith("\\");
        const name = (wantDir ? raw.slice(1) : raw).trim();
        if (name === "") return;
        const okDone = await runFsOp({ op: "create", dir: dirPath, name, kind: wantDir ? "dir" : "file" });
        if (!okDone) return;
        flashToast(t("created"));
        setCreateAt(null);
        setCreateName("");
        loadDir(dirPath);
      };
      // ── 行内改名（✎ 触发）：聚焦时只选中最后一个扩展名分隔符之前的
      // 主名（目录/隐藏文件选全名），Enter 提交、Esc/失焦取消；改名期间把
      // dock.inlineEdit 座置真，root 的 Esc 分层据此让路（不会顺手关掉树/预览）──
      const startRename = (entry) => {
        if (!cwd) return;
        setRenamingPath(entry.path);
      };
      const cancelRename = () => setRenamingPath(null);
      const submitRename = async (entry, rawValue) => {
        setRenamingPath(null);
        const name = String(rawValue ?? "").trim();
        if (name === "" || name === entry.name) return;
        const okDone = await runFsOp({ op: "rename", path: entry.path, name });
        if (!okDone) return;
        flashToast(t("renamed"));
        closeStalePreview(entry.path);
        pruneExpandedFrom(entry.path);
        loadDir(parentOf(entry.path));
      };
      react.useEffect(() => {
        dock.inlineEdit.active = renamingPath !== null;
        return () => {
          dock.inlineEdit.active = false;
        };
      }, [renamingPath]);
      const deleteEntry = async (entry) => {
        const okDone = await runFsOp(
          { op: "delete", path: entry.path },
          t("confirmDelete").replace("{name}", entry.name),
        );
        if (!okDone) return;
        flashToast(t("deleted"));
        closeStalePreview(entry.path);
        pruneExpandedFrom(entry.path);
        loadDir(parentOf(entry.path));
      };
      const treeActions = {
        onCreate: startCreate,
        onDelete: deleteEntry,
        onRename: startRename,
        onCopyPath: copyEntryPath,
        onMention: mentionEntry,
        onMenu: (entry, anchor) => setMenuFor((prev) => (prev && prev.anchor === anchor ? null : { entry, rect: anchor.getBoundingClientRect(), anchor })),
        renamingPath,
        onRenameSubmit: submitRename,
        onRenameCancel: cancelRename,
      };

      const rootInfo = cwd ? expanded[cwd] : undefined;

      return jsxRuntime.jsxs("div", {
        className: "dshk-tree",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-head",
            children: [
              jsxRuntime.jsx(FolderIcon, {}),
              // 显示当前目录路径（不显示"文件树"文字），过长时省略号，hover 悬浮看全
              jsxRuntime.jsx("span", { className: "dshk-dir", title: cwd ?? "", children: cwd ?? t("treeLabel") }),
              // 根目录新建文件/目录（单入口，\ 前缀建目录）
              cwd
                ? jsxRuntime.jsx(KitTip, {
                    label: t("treeNewAny"),
                    children: jsxRuntime.jsx("button", {
                      type: "button",
                      className: "dshk-btn",
                      onClick: () => startCreate(cwd),
                      children: jsxRuntime.jsx(FilePlusIcon, {}),
                    }),
                  })
                : null,
              jsxRuntime.jsx(KitTip, {
                label: t("treeRefresh"),
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn",
                  onClick: () => setNonce((n) => n + 1),
                  children: "⟳",
                }),
              }),
            ],
          }),
          // 新建内联输入：挂在头部下、目标目录由触发入口决定；
          // Enter 创建、Esc/空内容退格/区域外点击取消（✓ 按钮取消：回车即建，不需要
          // 第二确认点）
          createAt !== null
            ? jsxRuntime.jsxs("div", { className: "dshk-createrow", title: createAt, children: [
                jsxRuntime.jsx("input", {
                  autoFocus: true,
                  value: createName,
                  placeholder: t("treeNewPh"),
                  onChange: (e) => setCreateName(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === "Enter") void submitCreate();
                    if (e.key === "Escape") setCreateAt(null);
                    if (e.key === "Backspace" && createName === "") setCreateAt(null);
                  },
                }),
              ] })
            : null,
          jsxRuntime.jsx("div", {
            className: "dshk-tree-body",
            children:
              !cwd
              ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("noCwd") })
              : !rootInfo || rootInfo.status === "loading"
                ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeLoading") })
                : rootInfo.status === "error"
                  ? jsxRuntime.jsx("div", { className: "dshk-note", title: rootInfo.error ?? "", children: `${t("treeFail")}${rootInfo.error ? `：${rootInfo.error}` : ""}` })
                  : rootInfo.entries.length === 0
                    ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeEmpty") })
                    : jsxRuntime.jsxs(jsxRuntime.Fragment, {
                        children: [
                          rootInfo.entries.map((entry) =>
                            jsxRuntime.jsx(TreeNode, { entry, depth: 0, expanded, onToggle: toggleDir, onOpenFile, actions: treeActions }, entry.path),
                          ),
                          rootInfo.truncated
                            ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeTruncated") })
                            : null,
                        ],
                      }),
          }),
          menuFor
            ? jsxRuntime.jsx(TreeRowMenu, {
                entry: menuFor.entry,
                rect: menuFor.rect,
                anchor: menuFor.anchor,
                actions: treeActions,
                onClose: () => setMenuFor(null),
              })
            : null,
        ],
      });
    }

    // ─────────── 树行 ⋯ 菜单（收敛操作：新建/复制相对/重命名/删除）───────────
    // fixed 定位浮层（树 body 滚动裁切不影响的全局层），按钮下方左缘对齐、
    // 向右展开（与官方对话三点菜单方向一致），右侧空间不足时回退左移。
    // anchor = 开菜单的那颗触发钮：宿主据此把它做成开关（再点一次关掉）。

    // ─────────── 分支浮层（fixed 悬浮面板，quick-pick）───────────
    // 不参与 .dshk-tree 的 flex 布局——更改条目再多也不会挤压分支列表；面板自带
    // 纵向滚动，超出视口高度时 clamp 至视口内。Esc / 点击面板外关闭；点回触发
    // 按钮不关（按钮自身 onClick 负责切换），用 data-popkey 识别。
    function GitBranchMenu({ rect, branches, busy, name, created, onName, onCreate, onSwitch, onDelete, onClose }) {
      const hostRef = react.useRef(null);
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") onClose(); };
        const onDown = (e) => {
          if (e.target instanceof Element) {
            const el = e.target.closest("[data-popkey]");
            if (el && el.getAttribute("data-popkey") === "branch") return; // 触发按钮自己管切换
          }
          if (hostRef.current && e.target instanceof Element && !hostRef.current.contains(e.target)) onClose();
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("pointerdown", onDown, true);
        return () => {
          window.removeEventListener("keydown", onKey, true);
          window.removeEventListener("pointerdown", onDown, true);
        };
      }, [onClose]);
      const MENU_W = 236;
      const viewportW = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1200;
      const viewportH = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800;
      const style = {
        left: Math.min(Math.max(8, rect.left), Math.max(8, viewportW - MENU_W)),
        top: Math.min(Math.max(8, rect.top), Math.max(8, viewportH - 420)),
      };
      return jsxRuntime.jsxs("div", {
        ref: hostRef,
        className: "dshk-menu dshk-branch-menu",
        style,
        children: [
          jsxRuntime.jsx("div", { className: "dshk-branch-title", children: t("scBranch") }),
          jsxRuntime.jsx("div", { className: "dshk-branch-list", children:
            Array.isArray(branches?.branches) && branches.branches.length > 0
              ? branches.branches.map((b) =>
                  jsxRuntime.jsxs(
                    "div",
                    {
                      className: "dshk-branch-row" + (b.isHead ? " dshk-branch-cur" : ""),
                      title: b.upstream
                        ? `${b.upstream}${b.trackParsed && (b.trackParsed.ahead || b.trackParsed.behind) ? " [" + (b.trackParsed.ahead ? "ahead " + b.trackParsed.ahead : "") + (b.trackParsed.behind ? " behind " + b.trackParsed.behind : "") + "]" : ""}`
                        : b.name,
                      onClick: () => { if (!b.isHead && !busy) onSwitch(b.name); },
                      children: [
                        jsxRuntime.jsx("span", { className: "dshk-branch-ico", children: b.isHead ? "●" : "○" }),
                        jsxRuntime.jsx("span", { className: "dshk-branch-name", children: b.name }),
                        created && b.name === created
                          ? jsxRuntime.jsx(KitTip, { label: t("scBranchCreatedTag"), children: jsxRuntime.jsx("span", { className: "dshk-branch-newtag", children: t("scBranchNewTag") }) })
                          : null,
                        trackBadgeFor(b),
                        jsxRuntime.jsx("span", { className: "dshk-spring" }),
                        b.isHead
                          ? jsxRuntime.jsx("span", { className: "dshk-branch-curtag", children: t("scBranchCurrent") })
                          : jsxRuntime.jsx(KitTip, {
                              label: t("scBranchDelete"),
                              align: "end",
                              children: jsxRuntime.jsx("button", {
                                type: "button",
                                className: "dshk-branch-del",
                                disabled: busy,
                                onClick: (e) => { e.stopPropagation(); onDelete(b.name); },
                                children: "✕",
                              }),
                            }),
                      ],
                    },
                    b.name,
                  ),
                )
              : jsxRuntime.jsx("div", { className: "dshk-note", children: t("scBranchEmpty") }),
          }),
          jsxRuntime.jsxs("div", { className: "dshk-branch-new", children: [
            jsxRuntime.jsx("input", {
              autoFocus: true,
              className: "dshk-cmt-input",
              placeholder: t("scBranchNew"),
              value: name,
              onChange: (e) => onName(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter") onCreate(false); },
            }),
            jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-btn-save",
              disabled: name.trim() === "" || busy,
              onClick: () => onCreate(false),
              children: t("scBranchCreate"),
            }),
            jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-btn-cancel",
              disabled: name.trim() === "" || busy,
              onClick: () => onCreate(true),
              children: t("scBranchCreateSwitch"),
            }),
          ] }),
        ],
      });
    }
    /** 分支行上游领先/落后/失效小标记（与面板内 trackBadge 同源，独立函数便于悬浮面板复用） */
    function trackBadgeFor(b) {
      const tp = b.trackParsed;
      if (!tp) return null;
      if (tp.gone === true) return jsxRuntime.jsx("span", { className: "dshk-branch-track dshk-branch-gone", title: b.track || b.upstream, children: "gone" });
      if (tp.ahead === 0 && tp.behind === 0) return null;
      return jsxRuntime.jsx("span", { className: "dshk-branch-track", title: b.track || b.upstream, children: `${tp.ahead ? "↑" + tp.ahead : ""}${tp.behind ? "↓" + tp.behind : ""}` });
    }

    // ─────────── 源代码管理视图（sidebar.workspaces 的 git 模式）───────────
    // 文件树头部分支按钮进入；与文件树互斥占用同一单槽，**无 ✕**——原文件树入口
    // 按钮（及 Ctrl+Alt+.）就是切换开关：树 ⇄ 源代码管理 来回切。
    // 布局：标题行（分支按钮（官方分支图形+名称）+条目数+图谱/同步/刷新）
    // →「暂存的更改」组 →「更改」组（未跟踪 U 归入更改组）；分支浮层是
    // fixed 悬浮层（不参与面板布局，更改条目再多分支也完整显示；Esc/外部点击关闭，
    // 分支列表自带滚动；新建分支输入打开即聚焦，仅新建不切换时浮层保留、新分支
    // 打「新建」标记）。非 git 目录给「初始化仓库」按钮（POST /git/init，幂等）。

    // 图谱视图（⧉ 切换）见 GitGraphPanel；同步钮 = 拉取+推送（有上游）/
    // 发布分支（无上游，push -u），失败且无上游时给「设置上游并推送」提示；
    // 推送入口先 confirm 防误触，被远程 reject 后可 confirm 以本地为准 --force 覆盖。
    function GitChangesPanel({ cwd, onOpenFile, ...owner }) {
      const [data, setData] = react.useState(null); // null=加载中；{available, root?, entries?}
      const [initializing, setInitializing] = react.useState(false);
      const [msg, setMsg] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [collapsed, setCollapsed] = react.useState({});
      // 刷新可观测：最后读到的时刻 + 上次失败原因。失败保留旧数据（不清空），
      // 只把原因显示出来——「静默停在旧数据」是「不知道新改动」的主因
      const [err, setErr] = react.useState("");
      const fetchRef = react.useRef(null);
      const seqRef = react.useRef(0);
      const ctrlRef = react.useRef(null);
      fetchRef.current = () => {
        if (!cwd) return;
        ctrlRef.current?.abort();
        const c = new AbortController();
        ctrlRef.current = c;
        const seq = ++seqRef.current;
        fetchGitStatus(cwd, c.signal)
          .then((b) => {
            // seq 守卫：慢响应不覆盖更新的那次
            if (c.signal.aborted || seq !== seqRef.current) return;
            setData(b);
            setErr("");
          })
          .catch((e) => {
            if (c.signal.aborted || seq !== seqRef.current) return;
            setErr(String(e?.message ?? e));
          });
      };
      // 视图：changes（更改清单，默认）⇄ graph（提交图谱）；分支浮层内联展开
      const [view, setView] = react.useState("changes");
      // 图谱视图激活时本面板不轮 status：图谱面板自己轮 log，两个都轮等于同一拍上
      // 多 spawn 一个 git 进程；切回 changes 视图时 effect 重跑会立即补一拍
      react.useEffect(() => {
        if (view !== "graph" && fetchRef.current) fetchRef.current();
        const tick = () => {
          if (view === "graph") return;
          if (document.visibilityState !== "hidden" && fetchRef.current) fetchRef.current();
        };
        const unsubscribe = subscribeGitTick(tick, GIT_POLL_FAST_MS);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          unsubscribe();
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
          ctrlRef.current?.abort();
        };
      }, [cwd, view]);
      // agent 一回合跑完（会话行 running 由真变假）立刻补一拍：人盯着面板等的就是
      // 「改完了没」，那一下正好是清单该变的时候（轮询只是兜底）
      const running = useCurrentRow(owner)?.running === true;
      const wasRunning = react.useRef(running);
      react.useEffect(() => {
        if (wasRunning.current === true && running === false) fetchRef.current?.();
        wasRunning.current = running;
      }, [running, cwd]);
      const [branchOpen, setBranchOpen] = react.useState(false);
      const [branches, setBranches] = react.useState(null); // null=未加载；{current, branches[]}
      const [newBranch, setNewBranch] = react.useState("");
      const [createdBranch, setCreatedBranch] = react.useState(null); // 刚新建的分支名（列表打「新建」标记）
      const [branchBusy, setBranchBusy] = react.useState(false);
      const [pushing, setPushing] = react.useState(false);
      const [pulling, setPulling] = react.useState(false);
      // 分支浮层（fixed 悬浮）：anchor 为按钮矩形锚点 {left, top}
      const [branchAnchor, setBranchAnchor] = react.useState(null);
      const branchBtnRef = react.useRef(null);
      /** 按钮锚点：按钮左下 + 6px，视口内 clamp（浮层自带内部滚动，上限留高） */
      const anchorOf = (ref) => {
        const el = ref.current;
        const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1200;
        const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800;
        if (!el) return { left: 8, top: 8 };
        const r = el.getBoundingClientRect();
        return {
          left: Math.min(Math.max(8, r.left), Math.max(8, vw - 244)),
          top: Math.min(Math.max(8, r.bottom + 6), Math.max(8, vh - 430)),
        };
      };
      const openBranch = () => {
        setBranchAnchor(anchorOf(branchBtnRef));
        setBranchOpen(true);
      };
      const closeBranch = () => {
        setBranchOpen(false);
        setBranchAnchor(null);
        setCreatedBranch(null);
      };
      const toggleBranch = () => {
        if (branchOpen) closeBranch();
        else openBranch();
      };
      const [pushHint, setPushHint] = react.useState(false); // 无上游时的「设置上游并推送」提示
      // 图谱面板暴露的刷新句柄（图谱挂载后由 GitGraphPanel 回填），供头部 ⟳ 一并刷新
      const graphRef = react.useRef(null);
      const branchRef = react.useRef(null);
      branchRef.current = () => {
        if (!cwd) return;
        const c = new AbortController();
        fetchGitBranch(cwd, c.signal)
          .then((b) => {
            if (!c.signal.aborted && b.available === true) setBranches(b);
          })
          .catch(() => {});
      };
      // 分支浮层数据：打开时拉取（关闭后保留已加载数据，下次瞬开）
      react.useEffect(() => {
        if (branchOpen && branchRef.current) branchRef.current();
      }, [branchOpen, cwd]);

      /** 推送（upstream=true 时设置上游再推，即首次推送）：入口先确认防误触；
          失败若为远程拒绝（non-fast-forward）→ 询问「以本地为准」强制重推 */
      const doPush = async (withUpstream) => {
        if (pushing || !cwd || !available) return false;
        if (!window.confirm(t("scPushConfirm"))) return false;
        setPushing(true);
        try {
          const payload = { cwd, op: "push", upstream: withUpstream === true };
          try {
            await kitPostJson("/dsh-kit/git/op", payload);
          } catch (error) {
            const message = String(error?.message ?? error);
            const rejected = /\!\s*\[rejected\]|non-fast-forward|failed to push some refs|fetch first/i.test(message);
            const hintable = /no upstream/i.test(message) || /no configured push destination/i.test(message) || /couldn't find remote ref/i.test(message);
            setPushHint(hintable);
            // 远程有新提交被拒：确认后以本地为准覆盖（远程上本地没有的提交丢失）
            if (!rejected || !window.confirm(t("scPushForceConfirm"))) {
              flashToast(`${t("scPushFail")}：${message}`);
              return false;
            }
            await kitPostJson("/dsh-kit/git/op", { ...payload, force: true });
          }
          flashToast(t("scPushDone"));
          setPushHint(false);
          if (fetchRef.current) fetchRef.current();
          return true;
        } finally {
          setPushing(false);
        }
      };

      /** 拉取（⋯ 菜单；缺上游/冲突等错误原文 toast）：成功后刷新状态与图谱 */
      const doPull = async () => {
        if (pulling || !cwd || !available) return false;
        setPulling(true);
        try {
          await kitPostJson("/dsh-kit/git/op", { cwd, op: "pull" });
          flashToast(t("scPullDone"));
          if (fetchRef.current) fetchRef.current();
          if (graphRef.current) graphRef.current();
          return true;
        } catch (error) {
          flashToast(`${t("scPullFail")}：${error?.message ?? error}`);
          return false;
        } finally {
          setPulling(false);
        }
      };

      /** 分支操作（新建/切换/删除）：成功后刷新状态 + 分支列表 */
      const runBranchOp = async (payload, confirmText) => {
        if (branchBusy || !cwd) return false;
        if (confirmText !== undefined && confirmText !== null && !window.confirm(confirmText)) return false;
        setBranchBusy(true);
        try {
          await kitPostJson("/dsh-kit/git/op", { cwd, ...payload });
          if (fetchRef.current) fetchRef.current();
          if (branchRef.current) branchRef.current();
          setNewBranch("");
          return true;
        } catch (error) {
          flashToast(`${t("scBranchOpFail")}：${error?.message ?? error}`);
          return false;
        } finally {
          setBranchBusy(false);
        }
      };

      /** 新建分支（doSwitch=true 时一并切换）；成功后收起浮层（分支名已变） */
      const createBranch = async (doSwitch) => {
        const name = newBranch.trim();
        if (name === "" || branchBusy) return;
        const ok = await runBranchOp({ op: "branchCreate", name, switch: doSwitch === true });
        if (ok) {
          flashToast(t(doSwitch ? "scBranchSwitched" : "scBranchCreated").replace("{name}", name));
          if (doSwitch) {
            closeBranch(); // 已切换：收起浮层，头部分支按钮显示新名
          } else {
            setCreatedBranch(name); // 仅新建：浮层保留，列表刷新后新分支打「新建」标记
          }
        }
      };

      /** 写操作（暂存/取消暂存/放弃/提交）：可选二次确认，成功后静默刷新状态 */
      const runOp = async (payload, confirmText) => {
        if (busy || !cwd) return false;
        if (confirmText !== undefined && confirmText !== null && !window.confirm(confirmText)) return false;
        setBusy(true);
        try {
          await kitPostJson("/dsh-kit/git/op", { cwd, ...payload });
          if (fetchRef.current) fetchRef.current();
          return true;
        } catch (error) {
          flashToast(`${t("skOpFail")}：${error?.message ?? error}`);
          return false;
        } finally {
          setBusy(false);
        }
      };

      const doCommit = async () => {
        const message = msg.trim();
        if (message === "" || busy || !available) return false;
        // 暂存区为空 → 提交全部更改（含新文件），需确认；否则只提交已暂存
        const all = stagedList.length === 0;
        const okDone = await runOp({ op: "commit", message, all }, all ? t("cmtAllConfirm") : undefined);
        if (okDone) {
          setMsg("");
          flashToast(t("committed"));
        }
        return okDone;
      };

      const available = data !== null && data.available === true;
      const entries = available && Array.isArray(data.entries) ? data.entries : [];
      const root = available ? data.root ?? null : null;
      // 分组：暂存（xy 第一列非空格且非 ??）与其余（含未跟踪 U），分两组
      const stagedList = [];
      const workList = [];
      for (const e of entries) {
        const first = e.xy && e.xy[0] !== " " && e.xy[0] !== "?" ? stagedList : workList;
        first.push(e);
      }
      const groups = [
        { key: "staged", title: t("scStaged"), list: stagedList, isStaged: true },
        { key: "work", title: t("scChanges"), list: workList, isStaged: false },
      ].filter((g) => g.list.length > 0);

      const renderRow = (item, isStaged) => {
        const rel =
          root && item.abs.startsWith(root)
            ? item.abs.slice(root.length).replace(/^[\\/]/, "")
            : item.path;
        const segs = rel.split(/[\\/]/);
        const name = segs[segs.length - 1];
        const dir = segs.slice(0, -1).join("/");
        const isUntracked = String(item.xy).trim() === "??";
        // 已删除文件（xy 含 D）：工作区里已无文本可读，点击进「仅删除 diff」预览
        // （git diff HEAD 能给出被删内容；不做文本预览以免"文件不存在"报错）
        const isDeleted = !isUntracked && (item.xy[0] === "D" || item.xy[1] === "D");
        return jsxRuntime.jsxs(
          "div",
          {
            className: "dshk-row dshk-chg-row",
            title: item.abs,
            onClick: () => onOpenFile(item.abs, isUntracked, isDeleted),
            children: [
              jsxRuntime.jsx("span", { className: "dshk-name", children: name }),
              dir !== "" ? jsxRuntime.jsx("span", { className: "dshk-dir", title: rel, children: dir }) : null,
              // 悬停操作（行内命令）：暂存＋ / 放弃↩ / 取消暂存－
              jsxRuntime.jsxs("span", { className: "dshk-rowact", children: [
                isStaged
                  ? jsxRuntime.jsx(KitTip, { label: t("scUnstage"), align: "end", children: jsxRuntime.jsx("button", { type: "button", disabled: busy, onClick: (e) => { e.stopPropagation(); runOp({ op: "unstage", path: item.abs }); }, children: "－" }) })
                  : jsxRuntime.jsx(KitTip, { label: t("scStage"), align: "end", children: jsxRuntime.jsx("button", { type: "button", disabled: busy, onClick: (e) => { e.stopPropagation(); runOp({ op: "stage", path: item.abs }); }, children: "＋" }) }),
                !isStaged && !isUntracked
                  ? jsxRuntime.jsx(KitTip, { label: t("scDiscard"), align: "end", children: jsxRuntime.jsx("button", { type: "button", disabled: busy, onClick: (e) => { e.stopPropagation(); runOp({ op: "discard", path: item.abs }, t("scDiscardConfirm")); }, children: "↩" }) })
                  : null,
              ] }),
              item.stats
                ? jsxRuntime.jsxs("span", { className: "dshk-nums", children: [
                    jsxRuntime.jsx("span", { className: "dshk-nadd", children: `+${item.stats.a}` }),
                    jsxRuntime.jsx("span", { className: "dshk-ndel", children: `−${item.stats.d}` }),
                  ] })
                : null,
              jsxRuntime.jsx(GitBadge, { xy: item.xy }),
            ],
          },
          item.abs,
        );
      };

      const initRepo = async () => {
        if (initializing || !cwd) return;
        setInitializing(true);
        try {
          await fetchGitInit(cwd);
          if (fetchRef.current) fetchRef.current();
        } catch (error) {
          flashToast(`${t("scInitFail")}：${error?.message ?? error}`);
        } finally {
          setInitializing(false);
        }
      };

      const ahead = available && typeof data?.ahead === "number" ? data.ahead : 0;
      // ±行数合计（相对 HEAD 的已跟踪改动；未跟踪文件没有 numstat，不计入）
      const totals = react.useMemo(() => {
        let added = 0;
        let deleted = 0;
        let counted = 0;
        for (const e of entries) {
          if (!e?.stats) continue;
          added += Number(e.stats.a) || 0;
          deleted += Number(e.stats.d) || 0;
          counted++;
        }
        return { added, deleted, counted };
      }, [entries]);

      return jsxRuntime.jsxs("div", {
        className: "dshk-tree",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-head",
            children: [
              // 分支按钮（官方分支图形 + 名称；推送计数不在这里——它有自己的
              // 推送按钮，分支显示不与推送语义重叠）：点击开固定悬浮分支浮层
              available && data
                ? jsxRuntime.jsx(KitTip, {
                    label: t("scBranch"),
                    children: jsxRuntime.jsx("button", {
                      type: "button",
                      ref: branchBtnRef,
                      className: "dshk-btn dshk-branchbtn" + (branchOpen ? " dshk-headbtn-on" : ""),
                      "data-popkey": "branch",
                      "aria-pressed": branchOpen || undefined,
                      // 名字长时省略号截断，悬停出全名（头部一整行要放得下四颗钮）
                      title: data.detached === true ? t("scDetached") : data.branch || "",
                      onClick: toggleBranch,
                      children: [
                        jsxRuntime.jsx(dswIcon("IconBranchOutline16") ?? BranchIcon, {}),
                        jsxRuntime.jsx("span", {
                          className: "dshk-branch-name",
                          children: data.detached === true ? t("scDetached") : data.branch || "—",
                        }),
                        jsxRuntime.jsx("span", { className: "dshk-caret", children: "▾" }),
                      ],
                    }),
                  })
                : jsxRuntime.jsx("span", { className: "dshk-dir", title: root ?? "", children: t("scTitle") }),
              // 条目数不在头部重复：下方分组标题已经各带一个 N
              // ±行数合计：numstat 相对 HEAD（未跟踪文件不在其中，故 tooltip 说明）
              totals.counted > 0
                ? jsxRuntime.jsx(KitTip, {
                    label: t("scDiffTotal"),
                    children: jsxRuntime.jsx("span", {
                      className: "dshk-status",
                      children: `+${totals.added} −${totals.deleted}`,
                    }),
                  })
                : null,
              jsxRuntime.jsx("span", { className: "dshk-spring" }),
              // 同步钮（↑↓）：有上游=
              // 先拉后推，无上游=发布（首次推送）；错误原文 toast
              available && data && data.detached !== true
                ? jsxRuntime.jsx(KitTip, {
                    label: pushing || pulling
                      ? t("saving")
                      : !data.upstream
                        ? t("scPublish")
                        : ahead > 0
                          ? t("scPushAhead").replace("{n}", String(ahead))
                          : t("scSynced"),
                    children: jsxRuntime.jsx("button", {
                      type: "button",
                      className: "dshk-btn dshk-headbtn",
                      disabled: pushing || pulling || data.unborn === true,
                      onClick: () => void (async () => {
                        if (data.upstream) {
                          const ok = await doPull();
                          if (!ok) return;
                        }
                        await doPush(!(data.upstream));
                      })(),
                      children: pushing || pulling ? "…" : ahead > 0 ? `↑${ahead}` : "↑↓",
                    }),
                  })
                : null,
              jsxRuntime.jsx(KitTip, {
                label: t("scGraph"),
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn dshk-headbtn" + (view === "graph" ? " dshk-headbtn-on" : ""),
                  "aria-pressed": view === "graph" || undefined,
                  onClick: () => setView((v) => (v === "graph" ? "changes" : "graph")),
                  children: "⧉",
                }),
              }),
              jsxRuntime.jsx(KitTip, {
                label: t("treeRefresh"),
                children: jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn",
                  onClick: () => {
                    if (fetchRef.current) fetchRef.current();
                    if (graphRef.current) graphRef.current();
                  },
                  children: "⟳",
                }),
              }),
            ],
          }),
          // 刷新失败：旧数据留在下面，原因写在上面（静默停在旧数据最要命）
          err !== ""
            ? jsxRuntime.jsx("div", {
                className: "dshk-note",
                children: t("scRefreshFail").replace("{error}", err),
              })
            : null,
          // 分支浮层 / ⋯ 操作菜单：fixed 悬浮（.dshk-menu 模式），不参与面板布局，
          // 更改条目再多也不会挤压分支列表；关浮层由组件内 Esc/外部点击触发
          branchOpen && branchAnchor
            ? jsxRuntime.jsx(GitBranchMenu, {
                rect: branchAnchor,
                branches,
                busy: branchBusy,
                name: newBranch,
                created: createdBranch,
                onName: setNewBranch,
                onCreate: createBranch,
                onSwitch: async (name) => {
                  const ok = await runBranchOp({ op: "branchSwitch", name });
                  if (ok) {
                    flashToast(t("scBranchSwitched").replace("{name}", name));
                    closeBranch();
                  }
                },
                onDelete: async (name) => {
                  if (!window.confirm(t("scBranchDeleteConfirm").replace("{name}", name))) return;
                  const ok = await runBranchOp({ op: "branchDelete", name });
                  if (ok) {
                    flashToast(t("scBranchDeleted").replace("{name}", name));
                    return;
                  }
                  // -d 失败（典型：未合并）→ 二次确认强制删除
                  if (window.confirm(t("scBranchForceConfirm"))) {
                    const ok2 = await runBranchOp({ op: "branchDelete", name, force: true });
                    if (ok2) flashToast(t("scBranchDeleted").replace("{name}", name));
                  }
                },
                onClose: closeBranch,
              })
            : null,
          // 无上游提示（push 失败后出现）：一键设置上游并重推
          pushHint && view === "changes"
            ? jsxRuntime.jsxs("div", { className: "dshk-pushhint", children: [
                jsxRuntime.jsx("span", { children: t("scPushNoUpstream") }),
                jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-btn-save",
                  disabled: pushing,
                  onClick: () => doPush(true),
                  children: t("scPushSetUpstream"),
                }),
              ] })
            : null,
          jsxRuntime.jsx("div", {
            className: "dshk-tree-body",
            children:
              !cwd
                ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("noCwd") })
                : data === null
                  ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeLoading") })
                  : !available
                    ? jsxRuntime.jsxs("div", { style: { padding: "16px 10px", textAlign: "center" }, children: [
                        jsxRuntime.jsx("div", { className: "dshk-note", style: { padding: 0 }, children: t("scNotGit") }),
                        jsxRuntime.jsx("div", { style: { marginTop: 10 } , children:
                          jsxRuntime.jsx("button", {
                            type: "button",
                            className: "dshk-btn-save",
                            disabled: initializing,
                            onClick: initRepo,
                            children: t(initializing ? "saving" : "scInit"),
                          }),
                        }),
                      ] })
                    : view === "graph"
                    ? jsxRuntime.jsx(GitGraphPanel, { cwd, refreshRef: graphRef })
                    : jsxRuntime.jsxs(jsxRuntime.Fragment, {
                        children: [
                          // 提交框：暂存空=提交全部（需确认），否则只提交已暂存
                          jsxRuntime.jsxs("div", { className: "dshk-cmt", children: [
                            jsxRuntime.jsx("input", {
                              className: "dshk-cmt-input",
                              placeholder: t("cmtPlaceholder"),
                              value: msg,
                              onChange: (e) => setMsg(e.target.value),
                              onKeyDown: (e) => { if (e.key === "Enter") doCommit(); },
                            }),
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dshk-btn-save",
                              disabled: msg.trim() === "" || busy,
                              onClick: doCommit,
                              children: t(stagedList.length > 0 ? "scCommit" : "scCommitAll"),
                            }),
                          ] }),
                          data?.untrackedTruncated === true
                            ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeTruncated") })
                            : null,
                          groups.length === 0
                            ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("scEmpty") })
                            : groups.map((group) => {
                                const isOpen = !collapsed[group.key];
                                return jsxRuntime.jsxs(
                                  "div",
                                  {
                                    className: "dshk-changes",
                                    children: [
                                      jsxRuntime.jsxs("div", {
                                        className: "dshk-chg-head",
                                        onClick: () => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] })),
                                        children: [
                                          jsxRuntime.jsx("span", { className: "dshk-chg-chev", "data-open": isOpen || undefined, children: "▶" }),
                                          jsxRuntime.jsx("span", { children: group.title }),
                                          jsxRuntime.jsx("span", { className: "dshk-chg-count", children: String(group.list.length) }),
                                        ],
                                      }),
                                      isOpen ? group.list.map((item) => renderRow(item, group.isStaged)) : null,
                                    ],
                                  },
                                  group.key,
                                );
                              }),
                        ],
                      }),
          }),
        ],
      });
    }

    // ─────────── 提交图谱（源代码管理面板的 graph 视图）───────────
    // 数据走 GET /dsh-kit/git/log（结构化提交记录：完整/短哈希、父哈希、作者、
    // 时间戳、说明、引用装饰），lane 几何由前端从父哈希计算后 SVG 绘制。
    // 行布局：图谱列 → 引用装饰 chip → 短哈希 → 说明 → 作者 → 相对时间。行不可点，完整
    // 信息（作者 · 时间 + 说明）走 title 悬停。
    // refreshRef：头部 ⟳ 一并刷新的句柄（由 GitChangesPanel 传入并回填）。
    /** 图谱 lane 配色（按 lane 生命周期循环取用，同一条线颜色恒定） */
    const LANE_COLORS = ["#4daafc", "#73c991", "#e2c08d", "#b088e0"];
    const GRAPH_ROW_H = 22;
    const GRAPH_GAP = 14;
    const GRAPH_R = 4;

    /** 提交记录 → 图谱几何（纯函数，render-check 直调）。
     * records 按 --topo-order 到达（子先于父，宿主端点保证）。算法：槽位数组持有
     * 「期待到达的哈希+颜色」；每行先并拢所有指向本提交的槽位（合并线收进主槽位
     * 色），无来源则取首个空槽/追加；首父继承本行槽位（线穿过节点延续），次父取
     * 空槽/追加（新色，同父去重）。输出每行：rec、节点 lane/颜色、进边（被消费
     * 的线）、出边（父边）、直通竖线；x 单位=槽位序号，渲染层乘 GRAPH_GAP。窗口
     * 末仍未消费的槽位由各行画到自身行底，load more 续传后自然延续。 */
    function computeCommitGraph(records) {
      const rows = [];
      let slots = []; // Array<{hash, color} | null>
      let colorSeq = 0;
      let laneCount = 1;
      const newColor = () => colorSeq++ % LANE_COLORS.length;
      for (const rec of records ?? []) {
        if (!rec || typeof rec.H !== "string" || rec.H === "") continue;
        const prev = slots.slice();
        const ins = [];
        let lane = -1;
        let laneColor = -1;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] && prev[i].hash === rec.H) {
            ins.push({ x: i, color: prev[i].color });
            if (lane < 0) {
              lane = i;
              laneColor = prev[i].color;
            }
          }
        }
        if (lane < 0) {
          lane = prev.findIndex((s) => s === null);
          if (lane < 0) lane = prev.length;
          laneColor = newColor();
        }
        const next = prev.slice();
        for (const e of ins) next[e.x] = null; // 被消费的线终结于本节点
        const outs = [];
        const parents = Array.isArray(rec.p) ? rec.p.filter((x) => typeof x === "string" && x !== "") : [];
        parents.forEach((ph, pi) => {
          let idx;
          let color;
          if (pi === 0) {
            // 首父必须占节点槽位（线穿过节点延续）；父已被别的槽位等待也照建——
            // 到时多线并拢进父节点，正是分叉的画法
            idx = lane;
            color = laneColor;
          } else {
            if (next.some((s) => s && s.hash === ph)) return;
            idx = next.findIndex((s) => s === null);
            if (idx < 0) {
              idx = next.length;
              next.push(null);
            }
            color = newColor();
          }
          next[idx] = { hash: ph, color };
          outs.push({ x: idx, color });
        });
        const consumed = new Set(ins.map((e) => e.x));
        const passes = [];
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] && !consumed.has(i)) passes.push({ x: i, color: prev[i].color });
        }
        rows.push({ rec, lane, color: laneColor, ins, outs, passes });
        slots = next;
        while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop(); // 尾部空槽回收
        laneCount = Math.max(laneCount, slots.length);
      }
      return { rows, laneCount };
    }

    /** 单行图谱 SVG：进边（top→节点）/出边（节点→bottom）三次曲线（竖直切出、
     *  竖直切入），直通槽位画竖线，节点实心圆。行盒高 GRAPH_ROW_H，
     *  x(i)=i*GRAPH_GAP+GAP/2+2 */
    function CommitGraphSvg({ row, laneCount }) {
      const x = (i) => GRAPH_GAP / 2 + 2 + i * GRAPH_GAP;
      const w = Math.max(1, laneCount) * GRAPH_GAP + 4;
      const mid = GRAPH_ROW_H / 2;
      const nx = x(row.lane);
      const parts = [];
      row.passes.forEach((p, i) =>
        parts.push(
          jsxRuntime.jsx("path", { d: `M ${x(p.x)} 0 L ${x(p.x)} ${GRAPH_ROW_H}`, stroke: p.color, strokeWidth: 2, fill: "none", opacity: 0.9 }, "p" + i),
        ),
      );
      row.ins.forEach((e, i) => {
        const ex = x(e.x);
        const d =
          ex === nx
            ? `M ${ex} 0 L ${ex} ${mid}`
            : `M ${ex} 0 C ${ex} ${mid}, ${nx} ${mid - GRAPH_R - 1}, ${nx} ${mid}`;
        parts.push(jsxRuntime.jsx("path", { d, stroke: e.color, strokeWidth: 2, fill: "none", opacity: 0.9 }, "i" + i));
      });
      row.outs.forEach((e, i) => {
        const ex = x(e.x);
        const d =
          ex === nx
            ? `M ${nx} ${mid} L ${ex} ${GRAPH_ROW_H}`
            : `M ${nx} ${mid} C ${nx} ${mid + GRAPH_R + 1}, ${ex} ${mid}, ${ex} ${GRAPH_ROW_H}`;
        parts.push(jsxRuntime.jsx("path", { d, stroke: e.color, strokeWidth: 2, fill: "none", opacity: 0.9 }, "o" + i));
      });
      parts.push(jsxRuntime.jsx("circle", { cx: nx, cy: mid, r: GRAPH_R, fill: LANE_COLORS[row.color % LANE_COLORS.length] ?? "#888" }, "n"));
      return jsxRuntime.jsx("svg", { className: "dshk-gsvg", width: w, height: GRAPH_ROW_H, viewBox: `0 0 ${w} ${GRAPH_ROW_H}`, children: parts });
    }

    function GitGraphPanel({ cwd, refreshRef }) {
      const [data, setData] = react.useState(null); // null=加载中；{available, records?, hasMore?}
      const [error, setError] = react.useState(null);
      const [more, setMore] = react.useState(false); // load more 在途
      const fetchRef = react.useRef(null);
      // 序号守卫：轮询与「加载更多」并发时，先发后到的整页响应会把已追加的记录
      // 盖回第一页（GitChangesPanel 同款）
      const seqRef = react.useRef(0);
      const ctrlRef = react.useRef(null);
      fetchRef.current = () => {
        if (!cwd) return;
        ctrlRef.current?.abort();
        const c = new AbortController();
        ctrlRef.current = c;
        const seq = ++seqRef.current;
        fetchGitLog(cwd, 200, 0, c.signal)
          .then((b) => {
            if (c.signal.aborted || seq !== seqRef.current) return;
            setError(null);
            setData(b);
          })
          .catch((e) => {
            if (!c.signal.aborted && e?.name !== "AbortError") setError(String(e?.message ?? e));
          });
      };
      // load more：skip=已取条数续传，追加到已加载记录后（lane 几何对追加稳定——
      // 新记录只会消费/延续已有槽位，不改变前面行的画法）
      const loadMore = () => {
        if (!cwd || more || !data || data.available !== true || data.hasMore !== true) return;
        ctrlRef.current?.abort();
        const c = new AbortController();
        ctrlRef.current = c;
        const seq = ++seqRef.current;
        setMore(true);
        fetchGitLog(cwd, 200, Array.isArray(data.records) ? data.records.length : 0, c.signal)
          .then((b) => {
            if (c.signal.aborted || seq !== seqRef.current) return;
            if (b.available !== true) throw new Error("unavailable");
            setData((prev) => ({
              available: true,
              root: prev && prev.root,
              records: [...(prev && Array.isArray(prev.records) ? prev.records : []), ...(Array.isArray(b.records) ? b.records : [])],
              hasMore: b.hasMore === true,
            }));
          })
          .catch((e) => {
            if (!c.signal.aborted && seq === seqRef.current && e?.name !== "AbortError") setError(String(e?.message ?? e));
          })
          .finally(() => setMore(false));
      };
      // 把本面板的刷新函数暴露给父级的 ⟳
      if (refreshRef) refreshRef.current = () => fetchRef.current();
      react.useEffect(() => {
        if (fetchRef.current) fetchRef.current();
        const tick = () => {
          if (document.visibilityState !== "hidden" && fetchRef.current) fetchRef.current();
        };
        const unsubscribe = subscribeGitTick(tick);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          unsubscribe();
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
          ctrlRef.current?.abort();
        };
      }, [cwd]);

      const renderRefChips = (d) => {
        const decs = parseDecoration(d);
        return decs.map((r, i) =>
          jsxRuntime.jsx(
            "span",
            {
              className: "dshk-gref",
              "data-k": r.kind,
              title: r.kind === "head" && r.pointsTo ? `HEAD → ${r.pointsTo}` : r.name,
              children: r.kind === "head" && r.pointsTo ? r.pointsTo : r.name,
            },
            `${r.kind}-${i}`,
          ),
        );
      };

      if (!cwd) {
        return jsxRuntime.jsx("div", { className: "dshk-note", children: t("noCwd") });
      }

      // ── 图谱列表 ──
      if (data === null) {
        return jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeLoading") });
      }
      if (data.available !== true) {
        return jsxRuntime.jsx("div", { className: "dshk-note", children: error ? `${t("scGraphFail")}：${error}` : t("scGraphFail") });
      }
      const records = Array.isArray(data.records) ? data.records : [];
      if (records.length === 0) {
        return jsxRuntime.jsx("div", { className: "dshk-note", children: t("scGraphEmpty") });
      }
      const geo = computeCommitGraph(records);
      const fmtDate = (at) => {
        if (!Number.isFinite(at) || at <= 0) return "";
        const d = new Date(at * 1000);
        const p2 = (v) => String(v).padStart(2, "0");
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
      };
      const relTime = (at) => {
        if (!Number.isFinite(at) || at <= 0) return "";
        const diff = Date.now() / 1000 - at;
        if (diff < 90) return resolveZh() ? "刚刚" : "just now";
        if (diff < 3600) return resolveZh() ? `${Math.round(diff / 60)} 分钟前` : `${Math.round(diff / 60)}m ago`;
        if (diff < 86400) return resolveZh() ? `${Math.round(diff / 3600)} 小时前` : `${Math.round(diff / 3600)}h ago`;
        if (diff < 86400 * 30) return resolveZh() ? `${Math.round(diff / 86400)} 天前` : `${Math.round(diff / 86400)}d ago`;
        return fmtDate(at).slice(0, 10);
      };
      return jsxRuntime.jsx("div", {
        className: "dshk-graph",
        children: [
          ...geo.rows.map((row, i) =>
            jsxRuntime.jsxs(
              "div",
              {
                className: "dshk-grow",
                title: `${row.rec.an} · ${fmtDate(row.rec.at)}\n${row.rec.s}`,
                children: [
                  jsxRuntime.jsx(CommitGraphSvg, { row, laneCount: geo.laneCount }),
                  renderRefChips(row.rec.d),
                  jsxRuntime.jsx("span", { className: "dshk-ghash", children: row.rec.h }),
                  jsxRuntime.jsx("span", { className: "dshk-gsubj", children: row.rec.s }),
                  jsxRuntime.jsx("span", { className: "dshk-gauthor", children: row.rec.an }),
                  jsxRuntime.jsx("span", { className: "dshk-gdate", title: fmtDate(row.rec.at), children: relTime(row.rec.at) }),
                ],
              },
              `${row.rec.H}-${i}`,
            ),
          ),
          data.hasMore === true
            ? jsxRuntime.jsx(
                "button",
                { type: "button", className: "dshk-gmore", disabled: more === true, onClick: loadMore, children: more ? t("contentLoading") : t("scGraphMore") },
                "more",
              )
            : null,
        ],
      });
    }


    /** SCM 专用 diff 签：源代码管理更改清单点文件在这里看差异，工作区文件不在本
     *  面板预览/编辑（树与对话区点击改投官方右栏文件签）。commit（可选）= 钉定到某个提交
     *  （技能版本面板进入，diff 与该提交的第一父对比）；deleted=工作区已删除（纯红展示全文）；
     *  untracked=未跟踪（整文件按新增着色，内容来自 read）。 */
    function DiffPane({ path, untracked, deleted, cwd, commit, fileAddress, useResource }) {
      const [state, setState] = react.useState({ phase: "loading" });
      const [diff, setDiff] = react.useState({ phase: "loading" });
      const [reloadNonce, setReloadNonce] = react.useState(0);
      const [split, setSplit] = react.useState(false); // 双栏对比（单栏为默认，右栏窄）
      // 「盘上这份是不是我读的那份」：宿主 file 资源带版本号（watcher 推帧），
      // 读到的 diff 记下当时的版本，对不上就是盘上被改过——直接重读换新内容。
      // useResource 是宿主注入的标准 hook，必须无条件调用：按 fileAddress 是否为空
      // 条件调用会让 hook 数随会话选中态变化，React 直接抛「Rendered fewer hooks
      // than expected」，整张签空白。地址不是资源 URL 时它返回 status:"none"。
      const meta = typeof useResource === "function" ? useResource(fileAddress ?? "") : null;
      const version = meta?.value?.version;
      const readVersionRef = react.useRef(null);
      const reload = () => {
        readVersionRef.current = version ?? null;
        setReloadNonce((n) => n + 1);
        if (diffFetchRef.current) diffFetchRef.current();
      };
      // deleted 翻转（同一文件先打开后被删 / ↩ 恢复后重开）：实例不重挂（key=path），
      // 手动跟上——解除删除态时重读内容（未跟踪/着色用），进删除态无需动作
      //（渲染分支直接读 deleted prop）
      const deletedRef = react.useRef(deleted);
      react.useEffect(() => {
        if (deletedRef.current === deleted) return;
        deletedRef.current = deleted;
        if (deleted !== true) setReloadNonce((n) => n + 1);
      }, [deleted]);

      // diff 拉取（静默版）：已有内容时后台更新不闪「加载中」，数据到位再整体替换
      // 仓库定位：会话 cwd 拿不到时用文件所在目录——端点要求 cwd 是目录，传文件路径
      // 会被拒（400「不是目录」）；而 cwd 一旦缺失就早退的话，请求根本不发不出去，
      // 面板会永远停在「加载中…」
      const repoDir = cwd && cwd !== path ? cwd : path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
      const diffFetchRef = react.useRef(null);
      diffFetchRef.current = () => {
        const c = new AbortController();
        const commitQ = commit ? `&commit=${encodeURIComponent(commit)}` : "";
        kitGetJson(`/dsh-kit/git/diff?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(repoDir)}${commitQ}`, c.signal, (b) => b.available === true)
          .then((b) => {
            if (c.signal.aborted) return;
            // 这份 diff 算在宿主的哪个文件版本上（version 为 undefined = 宿主没装
            // workspace-files 行，这个资源没有 provider，不跟随）
            readVersionRef.current = version ?? null;
            setDiff({
              phase: "ready",
              untracked: b.untracked === true,
              clean: b.clean === true,
              base: typeof b.base === "string" ? b.base : "",
              blobMissing: b.blobMissing === true,
              text: typeof b.diff === "string" ? b.diff : null,
            });
          })
          .catch((error) => {
            if (!c.signal.aborted && error?.name !== "AbortError") setDiff({ phase: "error", error: String(error?.message ?? error) });
          });
      };
      // diff 数据：进入时拉一次；之后由宿主 file 资源的版本号驱动（见下方版本对照）
      // 版本是事件驱动推来的（不自己轮询）：比每 8s 猜一次准，也省掉每张签一个 git 进程
      react.useEffect(() => {
        setDiff({ phase: "loading" });
        if (diffFetchRef.current) diffFetchRef.current();
      }, [path, repoDir, commit]);

      // 版本对照：宿主推了新版本 = 盘上被改过，直接重读。只认「有版本可比」——
      // 首次拿到 live 版本（read 还是 null）也要重读一次，否则资源晚到时这份 diff
      // 永远停在旧内容。commit 钉定的内容不可变，不参与跟随
      react.useEffect(() => {
        if (commit !== undefined || version === undefined) return;
        if (version === readVersionRef.current) return;
        reload();
      }, [version, commit]);

      // 内容读取只服务未跟踪文件：它没有基线，整文件按新增着色。有基线的走 hunk
      // 视图，行号由 git 给，根本不需要新像——给它们读整份文件是白拉一次（>512KB
      // 还会被截断）。已删除文件读不到，不发请求
      // 判据取宿主回的 diff.untracked，不取地址带下来的 untracked 标志：后者只是
      // 面板点开时写进地址的提示，地址丢了（刷新/重开签）就变成假，而正文分支按
      // 宿主的事实走——两者不同步时读永远不发，面板卡在「加载中…」
      react.useEffect(() => {
        if (diff.untracked !== true || deleted === true) return;
        const controller = new AbortController();
        kitGetJson(`/dsh-kit/read?path=${encodeURIComponent(path)}${typeof cwd === "string" && cwd.trim() !== "" ? `&cwd=${encodeURIComponent(cwd.trim())}` : ""}`, controller.signal, (b) => typeof b.content !== "undefined")
          .then((body) => {
            if (controller.signal.aborted) return;
            setState({ phase: "ready", body });
          })
          .catch((error) => {
            if (controller.signal.aborted || error?.name === "AbortError") return;
            // 读失败要说出来：笼统回落成"暂无 diff"会让人以为是没差异，实际是拿不到内容
            setState({ phase: "error", error: String(error?.message ?? error) });
          });
        return () => controller.abort();
      }, [path, reloadNonce, diff.untracked, deleted]);

      /** diff 视图：只渲染 hunk（单栏带行号 / 双栏并排）——长文件只改几行时不必
       *  每次翻整篇，上下文行数由 git 的 -U 决定（默认 3）。
       *  没有 hunk（空/非 unified patch）才原样贴出。commit 模式下该提交已删除的
       *  文件与工作区删除文件一样纯红展示。顶部基线说明见 renderDiffView 包装层。 */
      /** hunk 头：与 git 同形，但计数为 1 时也照写（git 会省略成 `@@ -1 +1 @@`） */
      const hunkHeadOf = (h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
      /** 单栏：每行「旧行号 新行号 文本」 */
      const renderUnifiedHunks = (hunks) =>
        jsxRuntime.jsx("div", {
          className: "dshk-hunks",
          children: hunks.map((h, hi) =>
            jsxRuntime.jsxs(
              "section",
              {
                className: "dshk-hunk",
                children: [
                  jsxRuntime.jsx("div", { key: "h", className: "dshk-hunkhead", children: hunkHeadOf(h) }),
                  ...h.rows.map((r, ri) =>
                    jsxRuntime.jsxs(
                      "div",
                      {
                        className: `dshk-drow dshk-drow-${r.kind}`,
                        children: [
                          jsxRuntime.jsx("span", { className: "dshk-dno", children: r.oldNo === null ? "" : String(r.oldNo) }),
                          jsxRuntime.jsx("span", { className: "dshk-dno", children: r.newNo === null ? "" : String(r.newNo) }),
                          jsxRuntime.jsx("span", { className: "dshk-dtext", children: r.text === "" ? " " : r.text }),
                        ],
                      },
                      `${hi}-${ri}`,
                    ),
                  ),
                ],
              },
              `h${hi}`,
            ),
          ),
        });
      /** 双栏的一格：缺的一侧留空占位，行号各取自己那侧 */
      const splitCell = (cell, noKey) =>
        jsxRuntime.jsxs("span", {
          className: cell === null ? "dshk-dcell dshk-dcell-void" : `dshk-dcell dshk-dcell-${cell.kind}`,
          children: [
            jsxRuntime.jsx("span", { className: "dshk-dno", children: cell === null || cell[noKey] === null ? "" : String(cell[noKey]) }),
            jsxRuntime.jsx("span", { className: "dshk-dtext", children: cell === null || cell.text === "" ? " " : cell.text }),
          ],
        });
      const renderSplitHunks = (hunks) =>
        jsxRuntime.jsx("div", {
          className: "dshk-hunks",
          children: hunks.map((h, hi) =>
            jsxRuntime.jsxs(
              "section",
              {
                className: "dshk-hunk",
                children: [
                  jsxRuntime.jsx("div", { key: "h", className: "dshk-hunkhead", children: hunkHeadOf(h) }),
                  ...splitRowsOf(h.rows).map((pair, ri) =>
                    jsxRuntime.jsx(
                      "div",
                      { className: "dshk-drow", children: [splitCell(pair.left, "oldNo"), splitCell(pair.right, "newNo")] },
                      `${hi}-${ri}`,
                    ),
                  ),
                ],
              },
              `h${hi}`,
            ),
          ),
        });
      const renderDiffBody = () => {
        if (diff.phase === "loading") return jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentLoading") });
        if (diff.phase === "error")
          return jsxRuntime.jsx("div", { className: "dshk-note", title: diff.error, children: `${t("diffFail")}：${diff.error}` });
        if (deleted === true || (commit && diff.blobMissing === true)) {
          // 已删除文件：不看 raw diff（diff --git/index/--- 等元数据是噪音）——
          // 只抽删除行、剥掉前缀 `-`，整块按"已删除"红色展示（= 被删文件全文）。
          // commit 钉定模式下该提交已删除的文件（新像不存在）同样处理
          if (diff.clean || diff.text === null) return jsxRuntime.jsx("div", { className: "dshk-note", children: t("diffEmpty") });
          const raw = diff.text.split(/\r?\n/);
          const hunkAt = raw.findIndex((l) => l.startsWith("@@"));
          const metaAt = raw.findIndex((l) => l.startsWith("---"));
          const body = hunkAt >= 0 ? raw.slice(hunkAt) : metaAt >= 0 ? raw.slice(metaAt + 1) : raw;
          const removed = body.filter((l) => l.startsWith("-")).map((l) => (l.length > 1 ? l.slice(1) : ""));
          if (removed.length === 0) return jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentEmpty") });
          return jsxRuntime.jsx(
            "div",
            {
              className: "dshk-inline",
              children: removed.map((text, i) =>
                jsxRuntime.jsx("div", { className: "dshk-il-del", children: text === "" ? " " : text }, i),
              ),
            },
          );
        }
        if (diff.untracked) {
          // 未跟踪文件没有基线版本：整文件按"新增"着色展示（对齐 git 对未跟踪
          // 文件的 diff 语义）。内容来自 /dsh-kit/read；拿不到时把原因说出来——
          // 二进制 / 过大被截断 / 读取失败是三回事，笼统一句"暂无 diff"没法判断。
          const body = state.body ?? null;
          const content = body && typeof body.content === "string" ? body.content : null;
          const reason =
            body && body.binary === true
              ? t("diffUntrackedBinary")
              : body && body.truncated === true
                ? t("diffUntrackedTruncated")
                : state.phase === "error"
                  ? `${t("diffUntrackedFailed")}：${state.error}`
                  : null;
          if (content === null) {
            return jsxRuntime.jsx("div", {
              className: "dshk-note",
              children: state.phase === "loading" ? t("contentLoading") : reason ?? t("diffUntracked"),
            });
          }
          const view = jsxRuntime.jsx(
            "div",
            {
              className: "dshk-inline",
              children: content.split(/\r?\n/).map((text, i) =>
                jsxRuntime.jsx("div", { className: "dshk-il-add", children: text === "" ? " " : text }, i),
              ),
            },
          );
          if (reason === null) return view;
          return jsxRuntime.jsxs(jsxRuntime.Fragment, {
            children: [
              jsxRuntime.jsx("div", { key: "n", className: "dshk-note", children: reason }),
              view,
            ],
          });
        }
        if (diff.clean || diff.text === null) return jsxRuntime.jsx("div", { className: "dshk-note", children: t("diffEmpty") });

        const hunks = parsePatchHunks(diff.text);
        if (hunks !== null) return split ? renderSplitHunks(hunks) : renderUnifiedHunks(hunks);
        const lines = diff.text.split(/\r?\n/);
        return jsxRuntime.jsx("div", {
          className: "dshk-diff",
          children: lines.map((line, i) => {
            const cls = line.startsWith("+")
              ? "add"
              : line.startsWith("-")
                ? "del"
                : line.startsWith("@@")
                  ? "hunk"
                  : line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")
                    ? "meta"
                    : "ctx";
            return jsxRuntime.jsx("div", { className: `dshk-diff-${cls}`, children: line === "" ? " " : line }, i);
          }),
        });
      };
      const renderDiffView = () => {
        const body = renderDiffBody();
        if (commit && diff.phase === "ready") {
          return jsxRuntime.jsxs("div", {
            className: "dshk-diffwrap",
            children: [
              jsxRuntime.jsx("div", {
                className: "dshk-diffnote",
                children: diff.base ? tf("diffBaseParent", { base: diff.base }) : t("diffBaseRoot"),
              }),
              body,
            ],
          });
        }
        return body;
      };

      // 头部：路径（签名由页签 chip 承担）+ 打开全文 + 单栏/双栏切换；正文恒为 diff 视图。
      // 删除态没有可开的文件、也没有可分栏的两侧，两个钮都不出现
      const headActions = [
        deleted !== true &&
          jsxRuntime.jsx(KitTip, {
            label: t("diffOpenFile"),
            side: "bottom",
            children: jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-btn dshk-enbtn dshk-textbtn",
              onClick: () => openOfficialFile(path),
              children: t("diffOpenFileShort"),
            }),
          }),
        deleted !== true &&
          untracked !== true &&
          jsxRuntime.jsx(KitTip, {
            label: t(split === true ? "diffUnified" : "diffSplit"),
            side: "bottom",
            children: jsxRuntime.jsx("button", {
              type: "button",
              className: `dshk-btn dshk-enbtn${split === true ? " dshk-headbtn-on" : ""}`,
              "aria-pressed": split,
              onClick: () => setSplit((v) => !v),
              children: "⇄",
            }),
          }),
      ];
      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsx("div", {
            className: "dshk-head",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-title", children: path }),
              jsxRuntime.jsx("span", { className: "dshk-spring" }),
              ...headActions,
            ],
          }),
          deleted === true
            ? jsxRuntime.jsxs(jsxRuntime.Fragment, {
                children: [
                  jsxRuntime.jsx("div", { className: "dshk-note", children: t("pvDeletedNote") }),
                  jsxRuntime.jsx("div", { className: "dshk-pane-body", children: renderDiffView() }),
                ],
              })
            : jsxRuntime.jsx("div", { className: "dshk-pane-body", children: renderDiffView() }),
        ],
      });
    }

    /** 文件树入口：非文件树态 → 打开文件树（顺带展开收起的侧栏）；已是 → 关闭回
     *  会话列表。走单槽互斥补丁（打开文件树同时让出源代码管理/知识库目录/日程
     *  待办那一格），关闭动作保留已打开的文件标签（标签有独立 ✕） */
    function FileTreeEntry() {
      const ui = useKitUi();
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      if (cfg.fileTreeEnabled === false) return null;
      return jsxRuntime.jsx(KitTip, {
        label: t("treeLabel"),
        command: "dsh-kit-files.tree.toggle",
        side: "top",
        children: jsxRuntime.jsx("button", {
          type: "button",
          className: "dshk-btn dshk-enbtn",
          "aria-pressed": ui.treeOpen,
          onClick: () => {
            if (!ui.treeOpen) expandSidebarNow();
            setKitUi(sidebarViewPatch(ui.treeOpen ? null : "tree"));
          },
          children: jsxRuntime.jsx(FolderIcon, {}),
        }),
      });
    }

    /** 源代码管理入口：同文件树语义（互斥占格，关闭保留已打开的文件标签） */
    function ScmEntry() {
      const ui = useKitUi();
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      if (cfg.sourceControlEnabled === false) return null;
      return jsxRuntime.jsx(KitTip, {
        label: t("scTitle"),
        command: "dsh-kit-files.scm.toggle",
        side: "top",
        children: jsxRuntime.jsx("button", {
          type: "button",
          className: "dshk-btn dshk-enbtn",
          "aria-pressed": ui.gitOpen,
          onClick: () => {
            if (!ui.gitOpen) expandSidebarNow();
            setKitUi(sidebarViewPatch(ui.gitOpen ? null : "scm"));
          },
          children: jsxRuntime.jsx(BranchIcon, {}),
        }),
      });
    }

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      // 组件配置页：挂本组件行（槽位 key = <包名>#<行id>）
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#files" }, FilesConfigPage),
      );
      // 输入框入口（官方 conversation 挂载期声明槽位，inject 等声明落地再注册——
      // 直接 register 会炸整树 boot）。开关门控在组件内读本组件配置（关 = 渲染
      // null，volatile 热提交即时生效）
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register({ name: "conversation.input.left", id: "dsh-kit-filetree", order: 10 }, FileTreeEntry),
      );
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register({ name: "conversation.input.left", id: "dsh-kit-scm", order: 11 }, ScmEntry),
      );
      // 侧栏浏览区 tree/git 分支渲染器：root 的 sidebar.workspaces 单槽分发到这
      // （owner 携带官方注入的 wide，收起态各占用者自判不渲染）
      dock.sidebarView.renderer = ({ ui, cwd, owner }) => {
        const side = owner ?? {};
        if (side.wide === false) return null;
        if (ui.gitOpen) {
          return jsxRuntime.jsx(GitChangesPanel, { cwd, onOpenFile: (p, untracked, deleted) => openFileAndDock(p, untracked === true, deleted === true), ...owner });
        }
        if (ui.treeOpen) {
          return jsxRuntime.jsx(FileTreePanel, { cwd, onOpenFile: (p) => openTreeFile(p), ...owner });
        }
        return null;
      };
      // 官方快捷键服务：文件树/源代码管理两条命令注册进官方页。运行期 inject。
      ctx.inject(["shortcuts"], registerShortcuts);
      // 官方入口掩码跟随本组件配置：配置页保存 → 重拉快照 → 广播 → 标记类即时切换
      subscribeCfg(syncOfficialFilesMask);
      syncOfficialFilesMask();
      void loadCfg(); // 拉配置喂门控（失败保持内置默认）
      injectStyles();
    }

    exports.inject = ["slots"];
    exports.apply = apply;
    // 渲染级检查与面板引用供测试断言；DiffPane 另挂 root 的 diff 正文座（座对象
    // 与 root 的 kitBase 共享同一引用，root 读得到）
    exports.DiffPane = DiffPane;
    exports.parsePatchHunks = parsePatchHunks;
    exports.splitRowsOf = splitRowsOf;
    dock.diffPane.Component = DiffPane;
    exports.TreeNode = TreeNode;
    exports.FileTreePanel = FileTreePanel;
    exports.GitChangesPanel = GitChangesPanel;
    exports.GitGraphPanel = GitGraphPanel;
    exports.CommitGraphSvg = CommitGraphSvg;
    exports.GitBranchMenu = GitBranchMenu;
    exports.computeCommitGraph = computeCommitGraph;
    exports.fetchTree = fetchTree;
    exports.FileTreeEntry = FileTreeEntry;
    exports.ScmEntry = ScmEntry;
    // 配置面（内置默认表 / 组件行配置页）供测试断言与宿主默认同源比对
    exports.F_CFG_DEFAULTS = F_CFG_DEFAULTS;
    exports.FilesConfigPage = FilesConfigPage;
    return module.exports;
};

    // ── dsh-kit/monitor 组件（用量与监视）──
// dsh-kit/monitor 浏览器半边 —— 用量与监视组件的 client 面。
// 现收纳：余额与用量芯片（UsageLine）+ 复读提示（MonitorLine）
// + 会话通知（系统通知）。
//
// 数据走宿主 /dsh-kit/usage（key 在宿主侧复用模型配置，浏览器拿不到）。状态带
// 右缘只出**一张**芯片：当前会话选中的模型 provider（modelDirectories 服务按
// sessionId 给的共享目录 store，composer 模型座同源）归类出 deepseek/opencode
// 卡位，端点没配对应 provider 或识别不出（如 sensenova）= 不出。芯片只放
// 数值（¥余额 / 5h 窗口百分比），全名在悬停提示；点芯片浮层贴正上方只出该家
// 明细——定位与关闭复用官方 primitives 的 useAnchoredPosition /
// useDismissOnOutsidePointer / Tooltip，面板样式复刻官方 ContextMeter 浮层
// （哈希类名复用不了，CSS 原样抄）；primitives 缺位时降级为右下角
// 固定浮层、无 Tooltip。modelDirectories 是懒就绪服务：就绪时 version++ 通知
// 订阅者重跑 effect，否则「服务后到」的挂载永远拿不到数据源。
//
// 开关 = 本组件自己的 Config（usageEnabled，默认开），经 /dsh-kit-monitor/config
// 拉取：关 = 端点 403 + 芯片不出，两者由同一份配置驱动。
    const monitorModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const reactDom = require("react-dom");
    const dock = kit;
    const { kitJson, resolveZh, subscribeLocale, getLocaleVersion, chatSurfaceSession } = dock;
    const dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives");
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons[n];
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    // 组件私有文案（本组件自持词典）；语言判定/切换响应来自 dock
    const zh = {
      usageRefresh: "刷新",
      usageUpdatedAt: "更新于",
      usageDeepseek: "DeepSeek 余额",
      usageOpencode: "OpenCode Go",
      usageAvailable: "可用",
      usagePaused: "余额不足或已停机",
      usageBalanceTotal: "总余额",
      usageBalanceGranted: "赠送",
      usageBalanceToppedUp: "充值",
      usageW5h: "5 小时窗口",
      usageWeek: "本周窗口",
      usageMonth: "本月窗口",
      usageResets: "重置",
      usageNoCard: "模型配置未提供此服务的用量数据",
      usageOfficialPage: "官方用量页",
      // 会话监视（复读提示）
      monitorWarn: "检测到输出在重复（已连续 {copies} 遍），继续重复到 {stop} 遍将停止本回合",
      monitorStopping: "重复持续，正在停止当前回合…",
      monitorStop: "停止",
      // 会话通知
      notifyCompleteTitle: "{title} · 回合完成",
      notifyCompleteBody: "点击回到该会话",
      notifyErrorTitle: "{title} · 回合出错",
      notifyErrorBody: "这一轮没能正常做完，点开看看",
      notifyAbortedTitle: "{title} · 回合已中止",
      notifyAbortedBody: "这一轮被停下了",
      notifyBlockedTitle: "{title} · 回合被卡住",
      notifyBlockedBody: "这一轮没能推进下去，点开看看",
      notifyMaxTokensTitle: "{title} · 撞上输出上限",
      notifyMaxTokensBody: "这一轮因输出 token 触顶结束",
      notifyLoopBreakTitle: "{title} · 检测到死循环已停止",
      notifyLoopBreakBody: "模型输出陷入重复，已自动中止该轮",
      notifyCompactTitle: "{title} · 上下文压缩完成",
      notifyCompactBody: "上下文已压缩完成",
      notifyCompactBodyTokens: "已压缩约 {tokens} tokens 的历史",
      notifyQuestionTitle: "{title} · 等你回答",
      notifyQuestionBody: "agent 提了一个问题",
      notifyApprovalTitle: "{title} · 等你批准",
      notifyApprovalBody: "{tool} 等待批准",
      notifyPlanTitle: "{title} · 等你批准计划",
      notifyPlanBody: "agent 提交了计划等你批准",
      notifyToolFallback: "工具调用",
      // 本组件配置页字段（骨架通用文案在 dock）
      kcfgGroupUsage: "用量与余额",
      kcfgUsageEnabled: "余额与用量芯片",
      kcfgUsageEnabledHint: "composer 下方状态带显示当前会话 provider 的余额/配额芯片。",
      kcfgGroupMonitor: "会话监视与通知",
      kcfgNotifyEnabled: "会话桌面通知",
      kcfgNotifyEnabledHint: "页面不在前台时，回合收尾/压缩完成/agent 提问提醒你一次。",
      kcfgMonitorEnabled: "输出复读守卫",
      kcfgMonitorEnabledHint: "同一句话或连续几句话在结尾连续重复时：先提示，继续重复才停止该回合。",
      kcfgMonitorWarnCopies: "提示档：连续重复遍数（3–10）",
      kcfgMonitorWarnCopiesHint: "结尾同一句（或同一组连续句）重复到这么多遍，先在当前会话提示。",
      kcfgMonitorStopCopies: "停止档：连续重复遍数（4–20）",
      kcfgMonitorStopCopiesHint: "重复继续到这么多遍才自动停止该回合；不大于提示档时按提示档+1 处理。",
      kcfgGroupRequest: "模型请求",
      kcfgSessionHeader: "OpenCode Go 会话头",
      kcfgSessionHeaderHint: "发往 opencode / opencode-go 的模型请求按会话携带 x-opencode-session（复用 DSH 会话 id）：网关按它做路由亲和与提示词缓存，缺失会 400。关掉后不再注入。",
    };
    const en = {
      usageRefresh: "Refresh",
      usageUpdatedAt: "Updated",
      usageDeepseek: "DeepSeek balance",
      usageOpencode: "OpenCode Go",
      usageAvailable: "available",
      usagePaused: "low balance or suspended",
      usageBalanceTotal: "Total",
      usageBalanceGranted: "Granted",
      usageBalanceToppedUp: "Topped up",
      usageW5h: "5-hour window",
      usageWeek: "Weekly window",
      usageMonth: "Monthly window",
      usageResets: "resets",
      usageNoCard: "No usage data for this service in the model config",
      usageOfficialPage: "Usage dashboard",
      monitorWarn: "Output is repeating (the same text {copies} times in a row); reaching {stop} will stop this turn",
      monitorStopping: "Repetition continues — stopping this turn…",
      monitorStop: "Stop",
      notifyCompleteTitle: "{title} · turn finished",
      notifyCompleteBody: "Click to return to this session",
      notifyErrorTitle: "{title} · turn errored",
      notifyErrorBody: "This turn could not finish — open it to take a look",
      notifyAbortedTitle: "{title} · turn stopped",
      notifyAbortedBody: "This turn was stopped",
      notifyBlockedTitle: "{title} · turn blocked",
      notifyBlockedBody: "This turn could not make progress — open it to take a look",
      notifyMaxTokensTitle: "{title} · output limit reached",
      notifyMaxTokensBody: "This turn ended at the output token ceiling",
      notifyLoopBreakTitle: "{title} · dead loop stopped",
      notifyLoopBreakBody: "The model output started repeating itself, so that turn was stopped",
      notifyCompactTitle: "{title} · context compacted",
      notifyCompactBody: "Context compaction finished",
      notifyCompactBodyTokens: "Compacted ~{tokens} tokens of history",
      notifyQuestionTitle: "{title} · waiting for your answer",
      notifyQuestionBody: "The agent asked a question",
      notifyApprovalTitle: "{title} · waiting for approval",
      notifyApprovalBody: "{tool} awaits approval",
      notifyPlanTitle: "{title} · plan awaiting approval",
      notifyPlanBody: "The agent submitted a plan for your approval",
      notifyToolFallback: "A tool call",
      kcfgGroupUsage: "Usage & balance",
      kcfgUsageEnabled: "Balance & usage chip",
      kcfgUsageEnabledHint: "Shows a balance/quota chip for the session's provider under the composer.",
      kcfgGroupMonitor: "Session monitor & notifications",
      kcfgNotifyEnabled: "Session desktop notifications",
      kcfgNotifyEnabledHint: "One reminder on turn completion / compaction / agent questions while the page is in the background.",
      kcfgMonitorEnabled: "Repetition guard",
      kcfgMonitorEnabledHint: "When a sentence (or a few consecutive sentences) repeats at the end: warn first, stop the turn only if it keeps repeating.",
      kcfgMonitorWarnCopies: "Warn at N consecutive repeats (3–10)",
      kcfgMonitorWarnCopiesHint: "Show an in-session hint once the same ending text repeats this many times.",
      kcfgMonitorStopCopies: "Stop at N consecutive repeats (4–20)",
      kcfgMonitorStopCopiesHint: "Stop the turn only once the repetition reaches this many times; values at or below the warn level are treated as warn+1.",
      kcfgGroupRequest: "Model requests",
      kcfgSessionHeader: "OpenCode Go session header",
      kcfgSessionHeaderHint: "Model requests to opencode / opencode-go carry x-opencode-session per session (reusing the DSH session id): the gateway uses it for routing affinity and prompt caching, and 400s without it. Turn off to stop injecting.",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // 组件配置快照：拉本组件自己的 /dsh-kit-monitor/config（用量开关 + 监视/通知 +
    // 会话头注入，全部字段——组件的 Config schema 是唯一真源）。快照形状统一为
    // { status:'ready', value }；端点不可达按全默认处理（与门控同源语义）。
    const M_CFG_DEFAULTS = {
      usageEnabled: true,
      monitorEnabled: true,
      monitorWarnCopies: 3,
      monitorStopCopies: 5,
      notifyEnabled: true,
      sessionHeaderEnabled: true,
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
      out.monitorWarnCopies =
        Number.isInteger(v.monitorWarnCopies) && v.monitorWarnCopies >= 3 && v.monitorWarnCopies <= 10
          ? v.monitorWarnCopies
          : M_CFG_DEFAULTS.monitorWarnCopies;
      out.monitorStopCopies =
        Number.isInteger(v.monitorStopCopies) && v.monitorStopCopies >= 4 && v.monitorStopCopies <= 20
          ? v.monitorStopCopies
          : M_CFG_DEFAULTS.monitorStopCopies;
      if (out.monitorStopCopies <= out.monitorWarnCopies) out.monitorStopCopies = out.monitorWarnCopies + 1;
      out.notifyEnabled = v.notifyEnabled !== false;
      out.sessionHeaderEnabled = v.sessionHeaderEnabled !== false;
      return out;
    }
    void loadCfg();
    /** 带占位符的文案变体：tf("monitorWarn", { copies: 3, stop: 5 }) */
    const tf = (key, vars) => {
      let s = lang()[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) s = s.split(`{${name}}`).join(String(value));
      return s;
    };
    // 主视图会话行判定随会话行共享收进 dock
    const mainRowOf = dock.mainRowOf;

    // ─────────── 句子级复读检测（判据真源 src/monitor/loop-guard.ts，此处手抄）───────────
    // 单位是句子：结尾同一句（或连续几句话）连续重复 N 遍才算复读。字符级周期扫描与
    // 「单步字符上限」都已删除——它们把正常长输出、结构重复当成失控，是误杀来源。
    const MONITOR_WARN_COPIES = 3;
    const MONITOR_MIN_BLOCK_CHARS = 6;
    const MONITOR_MAX_BLOCK_UNITS = 8;
    const MONITOR_SCAN_MS = 1000; // 界面扫描节奏；判据本身与时间无关
    const MONITOR_ACCUM_MAX = 12000; // 只看尾部若干句，累积文本留余量封顶
    const MONITOR_SENTENCE_END = new Set(["。", "！", "？", "；", "…", "!", "?", ";"]);

    function monitorNormalizeUnit(raw) {
      return String(raw).replace(/\s+/g, " ").trim();
    }

    /** 切句：句末标点/换行/不夹在数字中间的英文句点处断句；尾部未收束句 complete=false */
    function monitorSegment(text) {
      const out = [];
      if (typeof text !== "string" || text === "") return out;
      const n = text.length;
      let start = 0;
      const push = (end, complete) => {
        const norm = monitorNormalizeUnit(text.slice(start, end));
        if (norm !== "") out.push({ text: norm, complete });
        start = end;
      };
      for (let i = 0; i < n; i++) {
        const ch = text[i];
        if (ch === "\n") {
          push(i + 1, true);
          continue;
        }
        if (MONITOR_SENTENCE_END.has(ch)) {
          let j = i + 1;
          while (j < n && MONITOR_SENTENCE_END.has(text[j])) j++;
          push(j, true);
          i = j - 1;
          continue;
        }
        if (ch === ".") {
          const prev = text[i - 1];
          const next = text[i + 1];
          const digitPrev = prev !== undefined && prev >= "0" && prev <= "9";
          const digitNext = next !== undefined && next >= "0" && next <= "9";
          if (!digitPrev && !digitNext && (next === undefined || /\s/.test(next))) push(i + 1, true);
        }
      }
      if (start < n) push(n, false);
      return out;
    }

    /** 尾部连续重复块扫描：最小块 1..8 句、块字符数 ≥6、连续重复 ≥3 遍即命中 */
    function monitorTailLoop(units) {
      let end = units.length;
      while (end > 0 && units[end - 1].complete !== true) end--;
      const n = end;
      if (n < MONITOR_WARN_COPIES) return null;
      for (let p = 1; p <= MONITOR_MAX_BLOCK_UNITS && p * MONITOR_WARN_COPIES <= n; p++) {
        let chars = 0;
        for (let k = n - p; k < n; k++) chars += units[k].text.length;
        if (chars < MONITOR_MIN_BLOCK_CHARS) continue;
        let copies = 1;
        while ((copies + 1) * p <= n) {
          let same = true;
          for (let k = 0; k < p; k++) {
            if (units[n - (copies + 1) * p + k].text !== units[n - p + k].text) {
              same = false;
              break;
            }
          }
          if (!same) break;
          copies++;
        }
        if (copies >= MONITOR_WARN_COPIES) return { units: p, copies, chars };
      }
      return null;
    }

    function monitorDetectLoop(text) {
      if (typeof text !== "string" || text === "") return null;
      return monitorTailLoop(monitorSegment(text));
    }

    // 当前会话只做「提示 + 手动停止」：宿主侧 loop-breaker 才是执行档（覆盖全部会话，
    // 命中停止档时 cancel）。旧实现自己 cancel 再自动续跑话术，正是误判扰民那一套，已删。
    function MonitorLine(props) {
      const { useChat, useSession, sessionId } = props;
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion);
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      const nodes = typeof useChat === "function" ? useChat((s) => s.legacy.nodes) : [];
      const partial = typeof useChat === "function" ? useChat((s) => s.legacy.partial) : null;
      const running = typeof useSession === "function" ? useSession((s) => s.running) : false;
      const [hit, setHit] = react.useState(null);
      const textRef = react.useRef("");
      // 组装运行中文本：partial（流式中）优先，否则最新未中断 assistant 节点兜底
      react.useEffect(() => {
        if (!running) {
          textRef.current = "";
          setHit(null);
          return;
        }
        let text = "";
        if (partial && Array.isArray(partial.blocks)) {
          for (const b of partial.blocks) {
            if ((b.kind === "text" || b.kind === "reasoning") && typeof b.text === "string") text += b.text;
          }
        }
        if (text === "") {
          for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            if (n && n.kind === "assistant") {
              if (n.interrupted !== true && Array.isArray(n.blocks)) {
                let t = "";
                for (const b of n.blocks) {
                  if ((b.kind === "text" || b.kind === "reasoning") && typeof b.text === "string") t += b.text;
                }
                text = t;
              }
              break;
            }
          }
        }
        textRef.current = text.length > MONITOR_ACCUM_MAX ? text.slice(-MONITOR_ACCUM_MAX) : text;
      }, [partial, nodes, running]);
      // 1s 节流扫描：只在命中结果变化时 setState（流式高频 setState 会拖渲染）
      react.useEffect(() => {
        if (!cfg.monitorEnabled || !running) {
          setHit(null);
          return undefined;
        }
        const scan = () => {
          const found = monitorDetectLoop(textRef.current);
          setHit((prev) => {
            if (found === null) return prev === null ? prev : null;
            if (prev && prev.units === found.units && prev.copies === found.copies && prev.chars === found.chars) return prev;
            return found;
          });
        };
        const timer = setInterval(scan, MONITOR_SCAN_MS);
        scan();
        return () => clearInterval(timer);
      }, [running, cfg.monitorEnabled]);
      if (!cfg.monitorEnabled || !running || !hit || hit.copies < cfg.monitorWarnCopies) return null;
      const stopping = hit.copies >= cfg.monitorStopCopies;
      const line = stopping
        ? t("monitorStopping")
        : tf("monitorWarn", { copies: String(hit.copies), stop: String(cfg.monitorStopCopies) });
      return jsxRuntime.jsxs("div", {
        className: "dshk-monitor-line",
        children: [
          jsxRuntime.jsx("span", { className: "dshk-monitor-text", children: line }),
          jsxRuntime.jsx("button", {
            type: "button",
            className: "dshk-monitor-cancel",
            onClick: () => {
              try {
                const sessions = slotsCtx ? slotsCtx.get("sessions") : null;
                const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : null;
                const sess = binding && binding.session;
                if (sess && typeof sess.cancel === "function") void sess.cancel().catch(() => {});
              } catch {
                // 服务未就绪：忽略
              }
            },
            children: t("monitorStop"),
          }),
        ],
      });
    }

    // ─────────── 会话通知（回合收尾 / 上下文压缩 / agent 提问）───────────
    // 页面不在前台、或事件不属于当前打开的会话时弹一条系统通知（浏览器
    // Notification API）；不支持或被拒就是没有提醒，没有第二层替代标记。
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
    //     请求，只是另成一类文案与正文取法（见 notifyKindOf）。
    // 抑制规则见 notifyWanted（一个总开关管全部提醒，不分类配置）；页面完全关掉时
    // 浏览器端无从运行，无通知可言。
    const notifyState = {
      /** sessionId -> 上次已知 running（沿检测基线；首帧只播种不发通知） */
      running: new Map(),
      /** sessionId -> {seq}：事件窗口已读到的持久 seq（压缩沿的基线，首帧只播种） */
      compactions: new Map(),
      /** sessionId -> 最近一次 turn/end 的 reason.kind：收尾通知的分类依据。
       *  事件窗口只对「上台」过的会话开着，所以从未打开过的会话查不到 reason，
       *  notifyTurnKind 会退回中性的「回合完成」。 */
      turnEnd: new Map(),
      /** 首帧标志：页面刚打开时列表里已在跑的会话不补发通知 */
      primed: false,
      /** 权限只申请一次（浏览器侧事实，不进 settings） */
      asked: false,
      /** 点通知的导航口：官方 uiWorkspace（缺位时只聚焦窗口） */
      nav: null,
    };
    const NOTIFY_BODY_MAX = 140; // 提问正文截断长度：桌面通知两行即满，长了被裁

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

    /** 值不值得打扰：总开关 + 不是「人正看着这个会话」（页面可见且聚焦、事件正是
     *  被看着的会话时，界面自己会说）。被看着的可以是主面那条，也可以是对话小窗
     *  正显示的那条——小窗开着时人就在看它，那条回合收尾不该再弹系统通知。
     *  五类提醒共用这一条判据（不分类配置）
     *  @param watched 主面会话 id；@param extraWatched 额外被看着的会话（小窗那条） */
    function notifyWanted(cfg, sessionId, watched, foreground, extraWatched) {
      if (!cfg.notifyEnabled) return false;
      if (foreground !== true) return true;
      return sessionId !== watched && sessionId !== extraWatched;
    }

    /**
     * 通知判定核心（依赖注入，render-check 直测）：把列表快照投影成应发的收尾通知，
     * 顺带把沿写回 state。抑制：见 notifyWanted；子会话（导航细节，属噪音）、首帧
     * 播种、以及**已归档**的会话都不发。提问/批准不走这里——它们是既成事实，由
     * 事件瀑布那条口直接投递。
     * @param input {ids,byId,current,foreground,archived} archived = 已归档会话 id 集
     * @returns [{kind: TURN_END_KINDS 之一, sessionId, title}]
     */
    function notifyDiffCore(state, input, cfg) {
      const events = [];
      const byId = input.byId ?? {};
      const foreground = input.foreground === true;
      // 归档动作（stopActivity）自己会停掉会话的活，那条 running 沿是用户动作的回声、
      // 不是「回合收尾」——被归档的会话不再打扰（归档的会话仍在列表里，落定判定挡不住）
      const archived = input.archived instanceof Set ? input.archived : new Set(Array.isArray(input.archived) ? input.archived : []);
      const wanted = (sessionId) => notifyWanted(cfg, sessionId, input.current, foreground, input.watched);
      const titleOf = (id) => byId[id]?.displayTitle ?? id;
      const seen = new Set();
      for (const id of input.ids ?? []) {
        const row = byId[id];
        if (!row) continue;
        seen.add(id);
        const was = state.running.get(id);
        state.running.set(id, row.running === true);
        // 只认 true→false 的沿：首帧播种、仍在跑、子会话、已归档都不发
        if (!state.primed || was !== true || row.running === true || row.origin === "subagent") continue;
        if (archived.has(id)) continue;
        // 分类看本回合 turn/end 的 reason（事件窗口记在 state.turnEnd，见
        // notifyCompactionCore）：出错/中止/卡住/撞上限各有各的说法，不一律报完成
        if (wanted(id)) events.push({ kind: notifyTurnKind(state.turnEnd?.get(id)), sessionId: id, title: titleOf(id) });
      }
      for (const id of [...state.running.keys()]) if (!seen.has(id)) state.running.delete(id);
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
     * 事件窗口扫描核心（依赖注入，render-check 直测）：一趟增量里同时办两件事——
     *  ① 记账 `turn/end` 的 reason（收尾通知的分类依据，见 notifyTurnKind）：任何
     *     kind 的 turn/end 都记，只有无 reason 的才留着旧值；不产通知；
     *  ② `compaction/end`（不带 error）即一次压缩收尾——手动 /compact 与回合中途的
     *     自动压缩都落这条事件，模型无关的 tool-result prune 不在其中。
     * 只认 append 增量：窗口首帧（页面刚打开）与 replace/prepend（重连重放、翻旧页）
     * 一律只播种——刷新页面不重报历史压缩。
     * 覆盖边界：官方只为「上台」过的会话开事件窗，从未打开过的会话看不到它的压缩，
     *  收尾分类对它也就退到默认的「回合完成」（不猜，见 notifyTurnKind）。
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
        // ① 收尾分类依据：把本回合的结束原因存下来，等 running 沿落地时取用。
        //    存整个 reason 对象而非仅 kind——宿主侧熔断走 cancel({kind:'hook'})，
        //    那条 cause 里带 reason 串，是「这是熔断停的、不是人停的」的唯一凭据。
        if (event.type === "turn/end") {
          const reason = event.data?.reason;
          if (reason && typeof reason.kind === "string" && reason.kind !== "") state.turnEnd.set(id, reason);
          continue;
        }
        if (event.type !== "compaction/end") continue;
        const data = event.data;
        if (!data || data.error) continue; // 失败的压缩不算完成（那个回合的失败另有报法）
        if (input.origin === "subagent") continue; // 子会话属导航噪音
        if (!notifyWanted(cfg, id, input.current, input.foreground === true, input.watched)) continue;
        events.push({ kind: "compact", sessionId: id, title: input.title, body: notifyCompactBody(entries, data.compactionId) });
      }
      return events;
    }

    /** 宿主侧熔断写在 cancel cause 里的标记（与 src/monitor/loop-breaker.ts 同串） */
    const NOTIFY_LOOP_CAUSE = "dsh-kit:dead-loop";
    /** 收尾通知按 turn/end 的 reason 分类：官方 TurnEndReason 的可读子集各有各的
     *  文案，缺 reason 的会话（从未打开过、没有事件窗）退回「回合完成」——那不是
     *  猜，是我们对未知结局的诚实说法。
     *  @param reason 整条 reason 对象（kind + 可能的 cause），不是仅 kind */
    function notifyTurnKind(reason) {
      // turn/end 的 aborted 形如 {kind:'aborted', reason:<AgentCancelCause>}；
      // 熔断那条 cause 是 {kind:'hook', reason:'dsh-kit:dead-loop'}
      const cause = reason && typeof reason === "object" ? reason.reason : null;
      if (reason && typeof reason === "object" && reason.kind === "aborted" && cause && cause.reason === NOTIFY_LOOP_CAUSE) {
        return "loopBreak";
      }
      const kind = reason && typeof reason === "object" ? reason.kind : reason;
      switch (kind) {
        case "error":
          return "error";
        case "aborted":
          return "aborted";
        case "blocked":
          return "blocked";
        case "max-tokens":
          return "maxTokens";
        case "completed":
        default:
          return "complete";
      }
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

    /** 桌面通知可用：API 在、且没被明确拒绝。「default」（未定）也算可用——有些壳
     *  （Electron 桌面端）根本不弹授权框，卡死在等 granted 等于永远走兜底 */
    function notifyCanPost() {
      const perm = notifyPermState();
      return perm === "granted" || perm === "default";
    }

    /** 顺带申请一次权限：浏览器要手势才弹框，这里发多半被忽略，但下一次起状态就准了 */
    function notifyAskPermission() {
      if (notifyState.asked || notifyPermState() !== "default") return;
      notifyState.asked = true;
      try {
        Notification.requestPermission(() => {});
      } catch {
        /* 不支持就算了：构造失败有兜底 */
      }
    }

    /** 点通知 → 聚焦窗口并切到该会话。
     *  导航走官方 `uiWorkspace.openSession`：它是「一次 UI 导航动作」，选中会话并显示
     *  其对话，内部管 mainView 引用计数与面板 reveal。`ctx.sessions` 上没有导航方法
     *  （那里的 open 是私有实现类的「拉历史尾页」），而自行 retain 会与侧栏的
     *  mainView 引用互相踩，故缺 uiWorkspace 时只聚焦窗口。 */
    function notifyOpenSession(sessionId) {
      try {
        window.focus();
      } catch {
        /* 非浏览器环境 */
      }
      const workspace = notifyState.nav;
      if (!workspace || typeof workspace.openSession !== "function") return;
      try {
        workspace.openSession(sessionId);
      } catch {
        /* 会话已不在列表：只聚焦 */
      }
    }

    /** 投递一条系统通知。**不带 tag**：Windows 把同 tag 的新通知当「替换」，旧的
     *  那条不在时就只替换、不展示 */
    function notifyDeliver(ev) {
      // 除提问/批准/计划评审外都共用「点击回到该会话」这个正文
      const TITLE_BY_KIND = {
        complete: "notifyCompleteTitle",
        error: "notifyErrorTitle",
        aborted: "notifyAbortedTitle",
        blocked: "notifyBlockedTitle",
        maxTokens: "notifyMaxTokensTitle",
        loopBreak: "notifyLoopBreakTitle",
        compact: "notifyCompactTitle",
        approval: "notifyApprovalTitle",
        plan: "notifyPlanTitle",
        question: "notifyQuestionTitle",
      };
      const BODY_BY_KIND = {
        complete: "notifyCompleteBody",
        error: "notifyErrorBody",
        aborted: "notifyAbortedBody",
        blocked: "notifyBlockedBody",
        maxTokens: "notifyMaxTokensBody",
        loopBreak: "notifyLoopBreakBody",
        compact: "notifyCompactBody",
      };
      const title = tf(TITLE_BY_KIND[ev.kind] ?? "notifyQuestionTitle", { title: ev.title });
      const bodyKey = BODY_BY_KIND[ev.kind];
      const body = bodyKey ? t(bodyKey) : ev.body ?? "";
      if (!notifyCanPost()) return;
      notifyAskPermission();
      try {
        const note = new Notification(title, { body, silent: true });
        note.onclick = () => {
          notifyOpenSession(ev.sessionId);
          try {
            note.close();
          } catch {
            /* 已自动关闭 */
          }
        };
      } catch {
        /* 构造被拒（部分环境只认 ServiceWorker 通知）：发不出去就是发不出去 */
      }
    }

    /** 回合收尾的 kind：走「落定判定」再投递（notifyTurnKind 的全部取值） */
    const TURN_END_KINDS = new Set(["complete", "error", "aborted", "blocked", "maxTokens", "loopBreak"]);

    /** 事件入口（订阅回调与首帧共用）：读快照 → 核心判定 → 逐条投递 */
    function notifyEvaluate(sessions, workspaces) {
      let cfg;
      let list;
      try {
        cfg = cfgFromSnapshot(getCfgSnapshot());
        list = sessions.list.getSnapshot();
      } catch {
        return; // 服务异常：本轮跳过，下条推送再来
      }
      // 归档集（软依赖）：归档动作自己停的会话不算「回合收尾」。读不到就当没有归档，
      // 不让工作区服务的问题连累其余提醒
      let archived = null;
      try {
        const wsnap = workspaces && typeof workspaces.list?.getSnapshot === "function" ? workspaces.list.getSnapshot() : null;
        if (wsnap && Array.isArray(wsnap.archivedSessionIds)) archived = wsnap.archivedSessionIds;
      } catch {
        archived = null;
      }
      const events = notifyDiffCore(notifyState, { ids: list.ids, byId: list.byId, current: mainRowOf(list)?.id, watched: chatSurfaceSession(), foreground: notifyForeground(), archived }, cfg);
      for (const ev of events) {
        // 只有回合收尾要落定判定（到点仍在列表且空闲）；提问/批准是既成事实，直接发。
        if (TURN_END_KINDS.has(ev.kind)) notifyCompleteSettled(sessions, ev);
        else notifyDeliver(ev);
      }
    }

    /** 压缩完成入口（事件窗口订阅回调）：读窗口快照 → 核心判定 → 逐条投递。
     *  不走收尾那套落定判定：压缩是已经落地的事实，回合状态无关 */
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
          watched: chatSurfaceSession(),
          foreground: notifyForeground(),
        },
        cfg,
      );
      for (const ev of events) notifyDeliver(ev);
    }

    /** 收尾通知的落地判定：到点仍在列表里且空闲才算真收尾。kind 由调用方按
     *  turn/end 的 reason 带进来，这里只判「是不是真的停了」。 */
    function notifyCompleteSettled(sessions, ev) {
      let row = null;
      try {
        row = sessions.list.getSnapshot().byId?.[ev.sessionId] ?? null;
      } catch {
        return; // 服务异常：放弃本次
      }
      if (!row || row.running === true) return; // 已不在列表 / 又跑起来了：不算收尾
      notifyDeliver(ev);
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
      // 第 5 个参数不能漏：小窗正显示这条会话时人也算「看着」，不该再弹桌面通知
      if (!notifyWanted(cfg, sessionId, mainRowOf(list)?.id, notifyForeground(), chatSurfaceSession())) return;
      notifyDeliver({
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
    /** 事件 scope 拿到的是 `session-<uuid>` 形式，会话列表与 openSession 认的是裸
     *  id——不归一会取不到会话名、点提醒也跳不过去。取不到就原样留着 */
    function notifySessionId(sessions, scopeId) {
      const raw = String(scopeId ?? "");
      if (raw === "") return raw;
      try {
        const byId = sessions.list.getSnapshot().byId ?? {};
        if (byId[raw]) return raw;
        const bare = raw.startsWith("session-") ? raw.slice(8) : "";
        return bare !== "" && byId[bare] ? bare : raw;
      } catch {
        return raw;
      }
    }

    function notifyRequestListener(sessions, kind) {
      return function (request, next) {
        try {
          const sessionId = notifySessionId(sessions, sessions.scopeOf(this));
          if (sessionId !== undefined) {
            notifyEventDeliver(sessions, notifyKindOf(kind, request), sessionId, request);
          }
        } catch {
          /* 旁听失败不影响作答链路 */
        }
        return next();
      };
    }


    // 本组件配置页（插件页 dsh-kit/monitor 行「配置」）：骨架在 dock，这里只喂字段表
    const MONITOR_CFG_FIELDS = [
      { key: "usageEnabled", type: "bool", group: "kcfgGroupUsage", labelKey: "kcfgUsageEnabled", hintKey: "kcfgUsageEnabledHint" },
      { key: "monitorEnabled", type: "bool", group: "kcfgGroupMonitor", labelKey: "kcfgMonitorEnabled", hintKey: "kcfgMonitorEnabledHint" },
      { key: "monitorWarnCopies", type: "number", min: 3, max: 10, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorWarnCopies", hintKey: "kcfgMonitorWarnCopiesHint" },
      { key: "monitorStopCopies", type: "number", min: 4, max: 20, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorStopCopies", hintKey: "kcfgMonitorStopCopiesHint" },
      { key: "notifyEnabled", type: "bool", group: "kcfgGroupMonitor", labelKey: "kcfgNotifyEnabled", hintKey: "kcfgNotifyEnabledHint" },
      { key: "sessionHeaderEnabled", type: "bool", group: "kcfgGroupRequest", labelKey: "kcfgSessionHeader", hintKey: "kcfgSessionHeaderHint" },
    ];
    const MONITOR_CFG_GROUPS = ["kcfgGroupUsage", "kcfgGroupMonitor", "kcfgGroupRequest"];
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
        // 芯片（pill、hover/展开态同色）
        ".dshk-usage-trigger{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:24px;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
        ".dshk-usage-trigger:hover,.dshk-usage-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
        ".dshk-usage-trigger.dshk-usage-hot{color:var(--dsw-alias-danger)}",
        ".dshk-usage-trigger.dshk-usage-hot:hover,.dshk-usage-trigger.dshk-usage-hot[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}",
        // 面板（定位经 primitives useAnchoredPosition，portal 到 body）；背景是半透明色，磨砂 backdrop-filter 缺了背后的界面会整个透出来
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
        // 会话监视条（composer.dock 槽）
        ".dshk-monitor-line{display:flex;align-items:center;gap:10px;padding:5px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 8%,transparent);font-size:12px;color:var(--dsw-alias-label-secondary)}",
        ".dshk-monitor-text{flex:1;min-width:0}",
        ".dshk-monitor-cancel{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:none;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
        ".dshk-monitor-cancel:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}",
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
      return null;
    }

    /** 芯片数据模块级缓存：换会话/重挂载 60s 内不重复打端点（宿主还有 60s 缓存） */
    const usageData = { body: null, at: 0 };

    const USAGE_CURRENCY_SYMBOL = { CNY: "¥", USD: "$", TWD: "NT$", HKD: "HK$", EUR: "€" };
    /** 各家官方用量页（浮层底部链接） */
    const USAGE_LINKS = {
      deepseek: "https://platform.deepseek.com/usage",
      opencode: "https://opencode.ai/zh/go",
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
     *   9:00–12:00、14:00–18:00（opencode 无公开口径不标）。
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
     * 芯片内容（纯数值）：
     *   deepseek → 单文本 ¥余额；opencode → 全部窗口百分比数组（5h、周、月顺序）。
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
      const wins = [card.windows && card.windows.rolling, card.windows && card.windows.weekly, card.windows && card.windows.monthly];
      const parts = wins.map((win) => (win && Number.isFinite(win.percent) ? win.percent : null)).filter((p) => p !== null);
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
          /* 读不到就靠投影 */
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
      // Esc 关浮层
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
      const kindTitle = () => (kind === "deepseek" ? t("usageDeepseek") : t("usageOpencode"));

      /** 浮层里的窗口行：dt/dd 官方行 + 进度条（官方 bar/segment 样式），sub 行放重置倒计时 */
      const windowBlock = (label, win) => {
        if (!win) return null;
        const percent = Number.isFinite(win.percent) ? win.percent : null;
        const resetAt = win.resetsAt ? Date.parse(win.resetsAt) : null;
        const sub = resetAt ? `${t("usageResets")} ${usageFmtCountdown(resetAt, now)}` : "";
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
        } else {
          const win = card.windows && card.windows.rolling;
          const percent = win ? (Number.isFinite(win.percent) ? win.percent : null) : null;
          if (percent !== null) figure = `${percent}%`;
          body = [
            windowBlock(t("usageW5h"), card.windows && card.windows.rolling),
            windowBlock(t("usageWeek"), card.windows && card.windows.weekly),
            windowBlock(t("usageMonth"), card.windows && card.windows.monthly),
          ];
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
        (kind === "deepseek" ? t("usageDeepseek") : `${kindTitle()} · ${resolveZh() ? "5小时/周/月窗口" : "5h/week/month"}`) +
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
          ? jsxRuntime.jsx(usageTooltip, { label: tooltipLabel, side: "top", delayMs: 500, disabled: open, children: trigger })
          : jsxRuntime.jsx("span", { title: tooltipLabel, children: trigger }),
        panel,
      ] });
    }

    exports.inject = ["slots"];
    exports.apply = async (ctx) => {
      slotsCtx = ctx;
      // 组件配置页：挂在插件页本组件行上的「配置」。行由 dsh-kit bundle 的 patch
      // 声明，槽位 key = <包名>#<行id>（宿主按精确 key 匹配本行）
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#monitor" }, MonitorConfigPage),
      );
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
      // 复读提示条（同槽 order 5，排官方 StatsLine 之后；monitorEnabled 门控在组件内）
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-kit-monitor", order: 5 },
          MonitorLine,
        ),
      );
      // 会话通知：订阅官方数据源（就绪时机不保证，用 inject 等）
      ctx.inject(["sessions"], (sctx) => {
        const offs = [];
        // 归档集（软依赖）：归档动作自己停的会话不算「回合收尾」；服务缺位退回旧行为
        let workspacesSvc = null;
        const evaluate = () => notifyEvaluate(sctx.sessions, workspacesSvc);
        // 点通知的导航口：uiWorkspace.openSession 是官方的一次 UI 导航动作
        // （选中会话 + 显示对话，内部管 mainView 引用计数与面板 reveal）。
        // 精简组合缺这个服务时，notifyOpenSession 只聚焦窗口。
        if (typeof sctx.inject === "function") {
          sctx.inject(["uiWorkspace"], (wctx) => {
            notifyState.nav = wctx.uiWorkspace ?? null;
          });
          sctx.inject(["workspaces"], (wctx) => {
            workspacesSvc = wctx.workspaces ?? null;
          });
        }
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
          for (const id of [...notifyState.turnEnd.keys()]) if (!live.has(id)) notifyState.turnEnd.delete(id);
        };
        const sync = () => {
          evaluate();
          syncCompactionSubs();
        };
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
      // 提问 / 批准事件：旁听官方 remote 瀑布（根 ctx 上收全部会话的请求，含后台
      // 会话——官方 UI 只在会话上台时接管，那半边它接不到）。remote 服务缺位
      // 时静默降级：只剩回合收尾与压缩两类通知
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
    exports.monitorSegment = monitorSegment;
    exports.monitorTailLoop = monitorTailLoop;
    exports.monitorDetectLoop = monitorDetectLoop;
    exports.notifyDiffCore = notifyDiffCore;
    exports.notifyKindOf = notifyKindOf;
    exports.notifyBodyOf = notifyBodyOf;
    exports.notifyCompactionCore = notifyCompactionCore;
    exports.notifyTurnKind = notifyTurnKind;
    exports.notifyCompleteSettled = notifyCompleteSettled;
    exports.notifySessionId = notifySessionId;
    exports.usageIsPeak = usageIsPeak;
    // 配置面（内置默认表 / 组件行配置页 / 快照解析）供测试断言与宿主默认同源比对
    exports.M_CFG_DEFAULTS = M_CFG_DEFAULTS;
    exports.MonitorConfigPage = MonitorConfigPage;
    exports.cfgFromSnapshot = cfgFromSnapshot;
    return exports;
};

    // ── dsh-kit/search 组件（网页搜索）──
// dsh-kit/search 浏览器半边 —— 网页搜索组件的 client 面。
// 搜索本体全在宿主半边（web seam 接管 + 引擎链，src/search/），client 面只有本组件行
// 的「配置」页（搜索结果条数）。行开关即总开关：关行 = 宿主模块不物化 = 不接管 seam，
// base 钉的官方搜索原样生效。
    const searchModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const dock = kit;

    // 组件私有文案（配置页骨架文案在 dock）
    const zh = {
      kcfgGroupSearch: "网页搜索",
      kcfgSearchMaxResults: "搜索结果条数（1–8）",
      kcfgSearchMaxResultsHint: "每次搜索保留的条数。",
    };
    const en = {
      kcfgGroupSearch: "Web search",
      kcfgSearchMaxResults: "Search results (1–8)",
      kcfgSearchMaxResultsHint: "How many results each search keeps.",
    };
    const lang = () => (dock.resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // 本组件配置页（插件页本组件行「配置」）：骨架在 dock，这里只喂字段表与词条
    const SEARCH_CFG_FIELDS = [
      { key: "searchMaxResults", type: "number", min: 1, max: 8, group: "kcfgGroupSearch", labelKey: "kcfgSearchMaxResults", hintKey: "kcfgSearchMaxResultsHint" },
    ];
    const SEARCH_CFG_GROUPS = ["kcfgGroupSearch"];
    const SearchConfigPage = dock.createConfigPage({
      fields: SEARCH_CFG_FIELDS,
      groups: SEARCH_CFG_GROUPS,
      t,
    });

    exports.inject = ["slots"];
    exports.apply = async (ctx) => {
      // 配置页挂在插件页本组件行上：槽位 key = <包名>#<行id>（宿主按精确 key 匹配本行）
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#search" }, SearchConfigPage),
      );
    };

    // 渲染级检查取用
    exports.SearchConfigPage = SearchConfigPage;
    exports.SEARCH_CFG_FIELDS = SEARCH_CFG_FIELDS;
    return exports;
};

    // ── dsh-kit/browser 组件（内置浏览器）──
// dsh-kit/browser 浏览器半边 —— 内置浏览器组件的 client 面。
// 收纳：右栏「浏览器」功能签（页签条 + URL 栏 + 实时画面 canvas 人机共驾）、agent
// 导航自动切签、浏览器收摊收签、对话链接改投内置浏览器、隐藏官方「浏览器」入口。
// 数据走本组件宿主半边 /dsh-kit/browser WS（state/event 广播 + frame 帧流）；
// 行开关即总开关：宿主半边不物化时 /dsh-kit-browser/config 404，apply 直接不注册
// 任何槽位与监听（面板、右栏签、链接改投、官方入口掩码全不出现）。
// 分区（scope）＝ 会话 id：页签按对话隔离，浏览器实例与 profile 全局共享登录态。
    const browserModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = kit;
    const {
      getKitUi, setKitUi, KitTip, flashToast, kitJson, kitWsUrl, resolveZh,
      closeFeatureTab, markFeaturePresence, closeRightbarTab,
      useCurrentRow, currentSessionId, shellShare,
      rightbarItem, rightbarItems, openRightbarItem, closeRightbarItem, rightbarTabsOf, tabAddress, tabVisible,
    } = dock;
    const dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives");
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons[n];
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    // 组件私有文案（配置页骨架文案在 dock）
    const zh = {
      kcfgGroupBrowser: "内置浏览器",
      browserUrlPh: "输入 HTTP(S) 地址",
      browserGo: "前往",
      browserBack: "后退",
      browserForward: "前进",
      browserReload: "刷新",
      browserExternal: "在系统浏览器中打开",
      browserNewTab: "新建页签",
      browserReconnect: "连接断开，重连中…",
      browserNotRunning: "浏览器未启动——在上方输入网址回车，或等 agent 首次使用时自动拉起",
      browserNoPages: "没有打开的页面——在上方输入网址回车，或等 agent 下次导航自动出现在这里",
      dockBrowser: "内置浏览器",
      rbGuideBrowserDesc: "agent 驱动的真实浏览器，可实时观看与接管",
      browserStarting: "正在拉起浏览器…",
      browserStartHint: "输入网址开始浏览——回车后这一页就落在这张签里",
      browserErrEmpty: "请输入地址。",
      browserErrInvalid: "这个地址无效或过长。",
      browserErrProtocol: "只支持 HTTP 和 HTTPS 地址。",
      browserErrCredentials: "地址不能包含用户名或密码。",
      kcfgChatOpenLinkInBrowser: "对话链接改投内置浏览器",
      kcfgChatOpenLinkInBrowserHint: "对话里点 http(s) 链接改在内置浏览器打开。",
      kcfgHideOfficialBrowserEntry: "隐藏官方「浏览器」入口",
      kcfgHideOfficialBrowserEntryHint: "避免与内置浏览器重复。",
    };
    const en = {
      kcfgGroupBrowser: "Built-in browser",
      browserUrlPh: "Enter an HTTP(S) address",
      browserGo: "Go",
      browserBack: "Back",
      browserForward: "Forward",
      browserReload: "Reload",
      browserExternal: "Open in system browser",
      browserNewTab: "New tab",
      browserReconnect: "Reconnecting…",
      browserNotRunning: "Browser not started — type a URL above or wait for the agent's first use",
      browserNoPages: "No open pages — type a URL above, or the agent's next navigation will appear here",
      dockBrowser: "Built-in browser",
      rbGuideBrowserDesc: "Agent-driven real browser you can watch live and take over",
      browserStarting: "Starting browser…",
      browserStartHint: "Enter an address to start browsing — it opens in this tab",
      browserErrEmpty: "Enter an address.",
      browserErrInvalid: "That address is invalid or too long.",
      browserErrProtocol: "Only HTTP and HTTPS addresses are supported.",
      browserErrCredentials: "Addresses cannot contain a username or password.",
      kcfgChatOpenLinkInBrowser: "Open chat links in the built-in browser",
      kcfgChatOpenLinkInBrowserHint: "http(s) links in chat open in the built-in browser.",
      kcfgHideOfficialBrowserEntry: "Hide the official Browser entry",
      kcfgHideOfficialBrowserEntryHint: "Avoids duplicating the built-in browser.",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // ─────────── 本组件生效配置（声明式模型）───────────
    // 配置真源 = 本组件宿主 Config（src/browser/index.ts）。client 启动拉
    // /dsh-kit-browser/config 喂快照；行开关关闭时该端点随宿主半边不物化而 404，
    // apply 据此整体不注册。快照未就绪/拉取失败一律回退内置默认（功能全开）。
    let bSnap = null;
    let bAvailable = false;
    const bSubs = new Set();
    const subscribeBCfg = (listener) => { bSubs.add(listener); return () => bSubs.delete(listener); };
    const getBSnap = () => bSnap;
    const B_CFG_DEFAULTS = { chatOpenLinkInBrowser: true, hideOfficialBrowserEntry: false };
    function bCfgFromSnapshot(snap) {
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return { ...B_CFG_DEFAULTS };
      const v = snap.value;
      return {
        chatOpenLinkInBrowser: v.chatOpenLinkInBrowser === true,
        hideOfficialBrowserEntry: v.hideOfficialBrowserEntry === true,
      };
    }
    /** 拉生效配置；返回 false = 宿主半边不可达（行关闭）= 本组件 client 面整体不注册 */
    async function loadCfg() {
      try {
        const body = await kitJson("/dsh-kit-browser/config");
        bAvailable = !!(body && typeof body === "object");
        bSnap = bAvailable ? { status: "ready", value: body } : null;
      } catch {
        bAvailable = false;
        bSnap = null;
      }
      for (const listener of [...bSubs]) listener();
      return bAvailable;
    }

    /** agent 动了某一页 → 把那一页的签开/激活到眼前（一页一签：无抑制，
     *  agent 操作浏览器为安全起见必须可见，人关掉的签下次导航照样弹回）。
     *  页集对账（brwReconcile）与面板导航事件共用此入口。
     *  从入口开出来的那张签还没认领到页（地址不是 dsh-resource://dshk-browser/…）：
     *  这一页落进那张签，不另开一张把它永远留空。判据读官方签表本身，不靠谁记过
     *  「刚才打算接管」——那种意图会被同批的任意缺签页抢走 */
    function maybeAutoOpenBrowser(pageId) {
      if (pageId === undefined || pageId === null) return;
      const empty = rightbarTabsOf("browser").find(
        (t) => rightbarItem("browser", String(t.contentId ?? "")) === null,
      );
      if (empty) {
        openRightbarItem("browser", String(pageId), "", { replaceTab: empty.tabId });
        return;
      }
      openRightbarItem("browser", String(pageId));
    }
    /** 浏览器没了（优雅关闭/空闲自动关/整只崩溃/页崩光）→ 收掉官方浏览器签
     *  （sidebarRight.close）：正常浏览器语义「没了就没了」，agent 下次开页面板
     *  照常弹回 */
    function closeBrowserDockForGone() {
      if (!getKitUi().browserOpen) return;
      closeRightbarTab("browser");
      setKitUi(closeFeatureTab(getKitUi(), "browser"));
    }



    /** 浏览器图标：地球（圆 + 经纬弧线），与终端描边体系一致 */
    function BrowserIcon(props) {
      // 官方 IconBrowseOutline16 不合理，故自绘
      return jsxRuntime.jsxs(
        "svg",
        {
          width: (props && props.size) ?? 15,
          height: (props && props.size) ?? 15,
          className: props && props.className,
          viewBox: "0 0 16 16",
          "aria-hidden": true,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsxRuntime.jsx("circle", { cx: 8, cy: 8, r: 6 }),
            jsxRuntime.jsx("path", { d: "M2 8h12" }),
            jsxRuntime.jsx("path", { d: "M8 2c1.8 1.6 2.7 3.6 2.7 6S9.8 12.4 8 14c-1.8-1.6-2.7-3.6-2.7-6S6.2 3.6 8 2z" }),
          ],
        },
      );
    }

    // ─────────── 内置浏览器面板（右栏浏览器签）───────────
    // 数据走宿主半边 /dsh-kit/browser WS：state/event 广播 + frame 帧流（jpeg）+
    // watch 引用计数 + open/activate/closeTab/nav/newTab（人操作）+ input（人机共驾）。
    // 分区（scope = 本 pane 所属会话 id）：页签按对话隔离，浏览器实例与 profile
    // 全局共享（登录态一份）——连接先报 scope，宿主只回本分区的 state/帧/事件，
    // 换会话即重连换分区。
    // 设计定位：面板是 agent 浏览器的「现场直播 + 遥控」——canvas 绘观察页实时
    // 画面；人的点击/滚轮/键入经画布坐标换算回传宿主，派发到观察页。观察指针由
    // 宿主维护：agent 的 navigate/act、人的地址栏导航与新建页都把它切到那一页，
    // 面板即那块画面（没有第二套 follow 开关）。面板常驻挂在右侧
    // 标签页容器：WS 管帧流与共驾输入；「agent 导航自动切到浏览器标签」的事件源
    // 已升级为壳层常驻（ShellBrowserEvents），标签被收掉（0 页自动收/人为关）也能弹回。
    // 生命周期：关标签仅停流不关浏览器（分区空闲 10 分钟自动收该对话的页、全局无页
    // 无观察者时空闲关实例，登录态保留在专用 profile，重开无损）。

    // 关页签即关（无确认）：「agent 活动页」的宿主识别与实际操作页常对
    // 不上，据此弹「agent 在用」确认只会误拦；agent 被关页后按 URL 重走即可

    // 工具栏图标 = 官方浏览器签同一套 primitives（后退/前进 Chevron14、刷新
    // Refresh14、前往 Link14、外部打开 RightUp16 传 size 14）；取不到该成员
    // 时回退同尺寸自绘，不挡渲染
    const BRW_ICON_NAME = {
      back: "IconChevronLeftOutline14",
      forward: "IconChevronRightOutline14",
      reload: "IconRefreshOutline14",
      go: "IconLinkOutline14",
      external: "IconRightUpOutline16",
    };
    const BRW_ICON_FALLBACK = {
      back: ["M10 3.2L5.6 8L10 12.8"],
      forward: ["M6 3.2L10.4 8L6 12.8"],
      reload: ["M12.6 6.1A4.8 4.8 0 1 0 12.9 9.4", "M12.7 2.9V6.3H9.3"],
      go: ["M2.8 8h9.6", "M9.2 4.4L12.8 8l-3.6 3.6"],
      external: ["M6.6 3.2h6.2v6.2", "M12.8 3.2L6.4 9.6", "M12.4 9.4v2.8a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V4.8a1.6 1.6 0 0 1 1.6-1.6h2.4"],
    };
    function BrwToolIcon({ name }) {
      const Official = dswIcon(BRW_ICON_NAME[name]);
      if (Official) return jsxRuntime.jsx(Official, name === "external" ? { size: 14 } : {});
      return jsxRuntime.jsx("svg", {
        width: 14,
        height: 14,
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": true,
        stroke: "currentColor",
        strokeWidth: 1.2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        children: (BRW_ICON_FALLBACK[name] ?? []).map((d) => jsxRuntime.jsx("path", { d }, d)),
      });
    }

    // ── 一页一签 ──
    // 页集是真相、官方签条是它的投影：分区控制连接只收 state/event（不订帧），负责
    // 「页没签就开一张、页没了就收掉那张签」；每张签自己一条连接按页订帧、收共驾输入。
    // 人关签（官方 ✕）= 关掉那张签对应的页，故撤签时经控制连接发 closeTab。
    const brwScopes = new Map();
    const brwClosedByUser = new Set(); // 人关签时登记的页：宿主那侧关页失败也不回弹签
    function brwConn(scope) {
      let entry = brwScopes.get(scope);
      if (entry) return entry;
      entry = { ws: null, retry: null, version: 0, pages: [], running: false, closed: false, hadPages: false, subs: new Set() };
      brwScopes.set(scope, entry);
      const publish = () => {
        entry.version += 1;
        for (const fn of entry.subs) fn();
      };
      const send = (obj) => {
        try {
          entry.ws?.send(JSON.stringify({ ...obj, scope }));
        } catch {
          // 已断：重连后由 state 校正
        }
      };
      const applyState = (msg) => {
        entry.pages = Array.isArray(msg.pages) ? msg.pages : [];
        entry.running = msg.running === true;
        publish();
        brwReconcile(scope);
      };
      const connect = () => {
        const ws = new WebSocket(kitWsUrl("/dsh-kit/browser"));
        entry.ws = ws;
        ws.onopen = () => {
          entry.retry = null;
          send({ t: "scope" });
        };
        ws.onmessage = (e) => {
          let msg;
          try {
            msg = JSON.parse(e.data);
          } catch {
            return;
          }
          if (!msg || typeof msg !== "object") return;
          if (msg.t === "state") {
            entry.closed = false;
            applyState(msg);
          } else if (msg.t === "event" && (msg.kind === "navigated" || msg.kind === "scope" || msg.kind === "closed" || msg.kind === "crashed")) {
            entry.running = msg.kind === "closed" ? false : entry.running;
            entry.closed = msg.kind === "closed";
            publish();
            brwReconcile(scope);
          }
        };
        ws.onclose = () => {
          entry.ws = null;
          if (entry.subs.size === 0) {
            drop();
            return;
          }
          entry.retry = window.setTimeout(connect, 2500);
        };
        ws.onerror = () => {};
      };
      // 这个分区没人看了：关连接、删条目。少了它，brwScopes 只增不减（用过 N 个
      // 会话就 N 条常驻连接，宿主侧也各留一条），而条目一旦断死又永不重连——
      // 回到那个会话时页集/事件永远不来，签空白且不报错
      const drop = () => {
        if (entry.subs.size > 0 || brwScopes.get(scope) !== entry) return;
        brwScopes.delete(scope);
        if (entry.retry !== null) window.clearTimeout(entry.retry);
        entry.retry = null;
        try {
          entry.ws?.close();
        } catch {
          // 已断
        }
        entry.ws = null;
      };
      entry.drop = drop;
      connect();
      return entry;
    }
    /** 页集 ⇄ 官方签条对账：页没签开一张（跳过人关过的），签的页没了收掉那张签。
     *  页集为空（浏览器还没起来/已收摊）时一律不动——那种时刻由壳层的
     *  closeBrowserDockForGone 收整片，空列表不代表哪一页被关掉了 */
    function brwReconcile(scope) {
      const entry = brwScopes.get(scope);
      if (!entry) return;
      const ids = new Set(entry.pages.map((p) => Number(p.tabId)).filter((id) => Number.isFinite(id)));
      for (const id of [...brwClosedByUser]) if (!ids.has(id)) brwClosedByUser.delete(id);
      if (ids.size === 0) return;
      for (const item of rightbarItems("browser")) {
        const id = Number(item);
        if (!ids.has(id)) {
          brwClosedByUser.delete(id);
          closeRightbarItem("browser", item);
        }
      }
      const open = new Set(rightbarItems("browser").map((x) => Number(x)));
      for (const id of ids) {
        if (open.has(id) || brwClosedByUser.has(id)) continue;
        maybeAutoOpenBrowser(id);
      }
    }
    /** 关掉一张签对应的页（人点官方 ✕ 时 pane 卸载走这里） */
    function brwClosePage(scope, pageId) {
      // 空签没有页（pageId 是 null）：Number(null) 是 0，而宿主页号从 1 起——发过去
      // 只会换回一条「页不存在：0」的报错提示
      const id = Number(pageId);
      if (!Number.isFinite(id) || id <= 0) return;
      brwClosedByUser.add(id);
      const entry = brwScopes.get(scope);
      if (entry?.ws) {
        try {
          entry.ws.send(JSON.stringify({ t: "closeTab", tabId: id, scope }));
        } catch {
          // 已断：页留到分区空闲回收
        }
      }
    }
    /** 本签那一页的页 id：从入口开出来的那张签没有地址，就没有页——必须回 null。
     *  Number(null) 是 0，让它冒充 0 号页的话回车会把 tabId:0 发给宿主，宿主当成
     *  「这页没了」而新开一页，于是新页另开一张签，本签永远空着 */
    function brwPageIdOf(props) {
      const raw = rightbarItem("browser", tabAddress(props));
      return raw === null ? null : Number(raw);
    }
    function brwPageOf(scope, pageId) {
      const entry = brwScopes.get(scope);
      if (!entry) return null;
      return entry.pages.find((p) => Number(p.tabId) === Number(pageId)) ?? null;
    }
    /** 签条标题：页标题（宿主事件流带回来的活标题），没有就退回地址的 host */
    function BrowserTabTitle(props) {
      const scope = useCurrentRow(props)?.id ?? "";
      const pageId = brwPageIdOf(props);
      const entry = brwScopes.get(scope);
      // 订阅回调必须定形（useCallback）：useSyncExternalStore 一见 subscribe 换了身份就
      // 退订+重订，而退订清理会 drop 连接——不定形 = 每次重渲染都把共享控制连接拆了重建
      const subscribeEntry = react.useCallback((cb) => {
        if (!entry) return () => {};
        entry.subs.add(cb);
        return () => entry.subs.delete(cb);
      }, [entry]);
      react.useSyncExternalStore(subscribeEntry, () => entry?.version ?? 0);
      const page = brwPageOf(scope, pageId);
      const title = typeof page?.title === "string" ? page.title.trim() : "";
      if (title !== "") return title;
      try {
        return page?.url ? new URL(page.url).host || page.url : t("dockBrowser");
      } catch {
        return t("dockBrowser");
      }
    }

    /** 画面容器 → 帧封顶（设备像素）。量容器不量画布：画布的尺寸由上一帧决定，
     *  拿它量会自激（帧大 → 画布大 → 要更大的帧）。没布局（面板还没挂上/宽度为零）
     *  返回 null，宿主落兜底封顶 */
    function frameSizeOf(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return null;
      const dpr = window.devicePixelRatio || 1;
      return { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) };
    }

    function BrowserPanel({ active, scope, pageId }) {
      const [state, setState] = react.useState({ running: false, launching: false, pages: [], activeId: null, viewId: null });
      const [draft, setDraft] = react.useState("");
      const [visible, setVisible] = react.useState(document.visibilityState === "visible");
      const [connLost, setConnLost] = react.useState(false);
      const canvasRef = react.useRef(null);
      const bodyRef = react.useRef(null); // 画面容器：帧封顶按它的尺寸 ×DPR 报给宿主
      const imeRef = react.useRef(null); // 透明输入：IME 组合事件宿主（canvas 不可编辑，组合起不来）
      const wsRef = react.useRef(null);
      const frameRef = react.useRef(null); // 最新帧（绘制去抖：只画最新）
      const rafRef = react.useRef(0);
      const moveRef = react.useRef(0); // 输入节流（~30/s）
      const downRef = react.useRef(null); // 双击判定（时间+距离窗）
      // 分区（本 pane 所属会话 id）：连接按它认领分区，消息都带它——换会话时 WS 重连
      // 到新分区（effect 依赖 scope），宿主只回本分区的 state/frame/event
      const scopeRef = react.useRef(scope);
      scopeRef.current = scope;
      const pageIdRef = react.useRef(pageId);
      pageIdRef.current = pageId;
      // watch 门控与事件回调里要读「最新」的激活/可见态，走 ref（闭包会停在创建帧）
      const activeRef = react.useRef(active);
      activeRef.current = active;
      const visibleRef = react.useRef(visible);
      visibleRef.current = visible;

      // 本签那一页（一页一签：URL 栏/导航/共驾输入都作用于它，地址即页 id）
      const myPage = (state.pages ?? []).find((p) => p.tabId === pageId) ?? null;
      const viewUrl = myPage?.url ?? "";
      const live = state.running === true;

      // 让位布局（body 类/宽度/拖拽）由右侧标签页容器统一负责，本组件只管内容。



      // 帧绘制：base64 jpeg → Image 解码 → canvas（尺寸随帧更新，宽 100% 等比）。
      // Image 实例复用：每帧 new Image 会把分配与 GC 压进帧路径（每秒几十帧），
      // 复用同一个对象只换 src——上一帧没解完就被新 src 顶掉，正是我们要的（旧帧已过期）
      const frameImgRef = react.useRef(null);
      const drawFrame = react.useCallback((data) => {
        let img = frameImgRef.current;
        if (!img) {
          img = new Image();
          frameImgRef.current = img;
        }
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(img, 0, 0);
        };
        img.src = `data:image/jpeg;base64,${data}`;
      }, []);

      // WS 生命周期：挂载连接 + 断线重连（2.5s）+ 换分区重连；watch 跟随「实时画面
      // 模式 + 页面可见」。握手后先报分区（scope），再发 watch——宿主按连接分区回
      // state/帧/事件，别的对话的页签与画面不会串进来。
      react.useEffect(() => {
        let disposed = false;
        let retry = null;
        const connect = () => {
          const ws = new WebSocket(kitWsUrl("/dsh-kit/browser"));
          wsRef.current = ws;
          ws.onopen = () => {
            if (disposed) return;
            setConnLost(false);
            sendScope(); // 认领分区（换会话重连时也靠它）
            sendWatch(); // 首连补发：effect 里那次检查时握手未完成，会被 readyState 挡掉
          };
          ws.onmessage = (e) => {
            let msg;
            try {
              msg = JSON.parse(e.data);
            } catch {
              return;
            }
            if (!msg || typeof msg !== "object") return;
            if (msg.t === "state") {
              setState((prev) => ({ ...prev, ...msg }));
              // 全部页签被关后清掉画布残帧：死页面的定格不能伪装成直播
              if (!(msg.pages ?? []).length && canvasRef.current) {
                const ctx2d = canvasRef.current.getContext("2d");
                if (ctx2d) ctx2d.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              }
              return;
            }
            if (msg.t === "frame" && typeof msg.data === "string" && msg.tabId === pageIdRef.current) {
              frameRef.current = msg.data;
              if (!rafRef.current) {
                rafRef.current = window.requestAnimationFrame(() => {
                  rafRef.current = 0;
                  const data = frameRef.current;
                  frameRef.current = null;
                  if (data) drawFrame(data);
                });
              }
              return;
            }
            if (msg.t === "newTab" || msg.t === "opened") {
              // 「open / newTab」的回包：宿主把新建或导航到的那一页号报回来。本签还没页、
              // 或本签那一页已不在分区页集里（宿重重启后页号从头数、旧签地址还留着旧号），
              // 就据此直接认领这一页——页集对账按连接分区走，缺了这一拍就是「回车没反应」
              const id = Number(msg.tabId);
              const mineId = pageIdRef.current;
              const known = brwScopes.get(scopeRef.current ?? "")?.pages ?? [];
              const mineGone = mineId !== null && !known.some((p) => Number(p.tabId) === Number(mineId));
              if (Number.isFinite(id) && (mineId === null || mineGone)) maybeAutoOpenBrowser(id);
              return;
            }
            if (msg.t === "event") {
              if (msg.kind === "navigated" && typeof msg.url === "string") {
                setState((prev) => {
                  const pages = (prev.pages ?? []).map((p) =>
                    p.tabId === msg.tabId ? { ...p, url: msg.url, title: msg.title ?? p.title } : p,
                  );
                  return { ...prev, pages, running: true };
                });
                brwReconcile(scopeRef.current);
                return;
              }
              if (msg.kind === "crashed" || msg.kind === "closed") {
                setState((prev) => ({ ...prev, running: msg.kind === "closed" ? false : prev.running }));
                return;
              }
              if (msg.kind === "error" && typeof msg.message === "string") {
                flashToast(msg.message);
              }
            }
          };
          ws.onclose = () => {
            if (disposed) return;
            setConnLost(true);
            setState((prev) => ({ ...prev, running: false }));
            retry = window.setTimeout(connect, 2500);
          };
          ws.onerror = () => {};
        };
        connect();
        return () => {
          disposed = true;
          if (retry !== null) window.clearTimeout(retry);
          // 官方 ✕ 关掉这张签 = 收掉它那一页（控制连接仍在，消息发得出去）
          brwClosePage(scopeRef.current, pageIdRef.current);
          try {
            wsRef.current?.close();
          } catch {
            // 已断
          }
        };
      }, [drawFrame, scope]);

      // watch 开关：「浏览器标签激活 + 页面可见」才要帧（切走/隐藏即停流，回来自动
      // 续）；WS 本身保持连接（自动打开的事件源）。onopen 另有补发——首次连接建立
      // 时本 effect 已跑过（握手未完成被 readyState 挡掉），不补发首连收不到帧。
      const sendScope = () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== 1) return;
        try {
          ws.send(JSON.stringify({ t: "scope", scope: scopeRef.current ?? "" }));
        } catch {
          // 已断
        }
      };
      const sendWatch = () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== 1) return;
        try {
          ws.send(JSON.stringify({ t: "watch", on: visibleRef.current === true && activeRef.current === true, scope: scopeRef.current ?? "", tabId: pageIdRef.current, size: frameSizeOf(bodyRef.current) }));
        } catch {
          // 已断
        }
      };
      react.useEffect(() => {
        sendWatch();
      }, [visible, active, connLost]);
      // 入口开出来的那张空签被认领到页（maybeAutoOpenBrowser 换掉签内容）时要重订帧流：
      // watch 只在可见性/激活态与连接建立时发，页号 null → 1 这一步没人发，宿主那侧
      // 还订着「没有页」，画面就永远空白——直到别的动作把它挤掉重来
      react.useEffect(() => {
        sendWatch();
      }, [pageId]);
      // 面板被拖大/缩放后要重报尺寸：不重报的话帧封顶还是旧的，画面被放大发虚。
      // 去抖是因为拖动是连续的小变化，每一帧都重报只是徒增 WS 消息
      react.useEffect(() => {
        const el = bodyRef.current;
        if (!el || typeof ResizeObserver !== "function") return undefined;
        let timer = null;
        const ro = new ResizeObserver(() => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            sendWatch();
          }, 200);
        });
        ro.observe(el);
        return () => {
          ro.disconnect();
          if (timer !== null) clearTimeout(timer);
        };
      }, []);
      react.useEffect(() => {
        const onVis = () => {
          // 事件回调先于重渲染：先同步 ref 再发，避免 watch 带着过期的可见态
          const vis = document.visibilityState === "visible";
          visibleRef.current = vis;
          setVisible(vis);
          sendWatch();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
      }, []);

      // ── 人机共驾：画布输入 → 页面坐标 → 宿主派发（仅运行中；未运行不误拉起）──
      // 所有面板消息都带上本 pane 的分区（scope）：宿主按连接分区派发到该对话的观察页
      const sendInput = (obj) => {
        try {
          wsRef.current?.send(JSON.stringify({ ...obj, scope: scopeRef.current ?? "", tabId: pageIdRef.current }));
        } catch {
          // 已断：丢帧无害（下一帧画面自校正）
        }
      };
      const pagePoint = (e) => {
        const c = canvasRef.current;
        if (!c) return null;
        const rect = c.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || !c.width || !c.height) return null;
        const x = ((e.clientX - rect.left) * c.width) / rect.width;
        const y = ((e.clientY - rect.top) * c.height) / rect.height;
        return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
      };
      const onCanvasPointerDown = (e) => {
        if (!live) return;
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        e.preventDefault();
        try {
          canvasRef.current?.setPointerCapture?.(e.pointerId);
        } catch {
          // 捕获失败不影响转发
        }
        const p = pagePoint(e);
        if (!p) return;
        const now = Date.now();
        const dbl =
          downRef.current !== null &&
          now - downRef.current.t < 350 &&
          Math.abs(p.x - downRef.current.x) < 12 &&
          Math.abs(p.y - downRef.current.y) < 12;
        downRef.current = { t: now, x: p.x, y: p.y };
        sendInput({ t: "input", kind: "mousedown", x: p.x, y: p.y, button: e.button, clicks: dbl ? 2 : 1 });
        // 键入目标：透明输入钉在按下点并接管焦点——它的组合事件（中文输入法）
        // 与 keydown（英文逐键/快捷键）两条路都从这里出去
        const ime = imeRef.current;
        if (ime) {
          ime.style.left = `${e.clientX}px`;
          ime.style.top = `${e.clientY}px`;
          try {
            ime.focus({ preventScroll: true });
          } catch {
            ime.focus();
          }
        }
      };
      const onCanvasPointerMove = (e) => {
        if (!live) return;
        const now = performance.now();
        if (now - moveRef.current < 33) return; // ~30/s 节流（悬停 + 拖拽共用）
        moveRef.current = now;
        const p = pagePoint(e);
        if (!p) return;
        sendInput({ t: "input", kind: "mousemove", x: p.x, y: p.y });
      };
      const onCanvasPointerUp = (e) => {
        if (!live) return;
        const p = pagePoint(e);
        if (!p) return;
        sendInput({ t: "input", kind: "mouseup", x: p.x, y: p.y, button: e.button });
      };
      const onCanvasWheel = (e) => {
        if (!live) return;
        e.preventDefault(); // 画面滚动交给远端页面，不滚面板
        sendInput({ t: "input", kind: "wheel", dx: e.deltaX, dy: e.deltaY });
      };
      const onCanvasKeyDown = (e) => {
        if (!live) return;
        // IME 组合中的 keydown（key=Process / keyCode 229）合成不出任何字，跳过；
        // 组合文本由透明输入的 compositionend → kind:'text' 整段出
        if (e.isComposing === true || e.keyCode === 229) return;
        // 纯修饰键不单独转发（并入下一个键的组合串）
        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
        e.preventDefault(); // 焦点留在画布，Tab 等也透传给页面
        const parts = [];
        if (e.ctrlKey) parts.push("Control");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey) parts.push("Meta");
        parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
        sendInput({ t: "input", kind: "key", combo: parts.join("+") });
      };

      /** 地址栏校验（口径同官方浏览器）：只收 HTTP(S)、不收带凭据的地址、长度封顶。
       *  mailto:/tel: 之类补成 http:// 会变成打不开的地址，故只收 HTTP(S) */
      const parseUrl = (raw) => {
        const text = String(raw ?? "").trim();
        if (text === "") return { error: t("browserErrEmpty") };
        let u = null;
        try {
          u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `http://${text}`);
        } catch {
          return { error: t("browserErrInvalid") };
        }
        if (u.protocol !== "http:" && u.protocol !== "https:") return { error: t("browserErrProtocol") };
        if (u.username !== "" || u.password !== "") return { error: t("browserErrCredentials") };
        if (u.hostname === "" || u.href.length > 2048) return { error: t("browserErrInvalid") };
        return { url: u.href };
      };
      const go = (raw) => {
        const parsed = parseUrl(raw);
        if (parsed.error !== undefined) {
          flashToast(parsed.error);
          return;
        }
        const withScheme = parsed.url;
        setDraft(withScheme);
        // 先本地反馈（宿主 navigated 事件随后校正）；一签一页，作用于本签那张页
        setState((prev) => ({
          ...prev,
          running: true,
          pages: (prev.pages ?? []).map((p) => (p.tabId === pageIdRef.current ? { ...p, url: withScheme, title: "" } : p)),
        }));
        // 本签还没有页（从入口开出来的那张）：要宿主另开一页，别去动别的签正在看的页。
        // 新页建出来后由 maybeAutoOpenBrowser 认领进本签
        const mine = pageIdRef.current;
        try {
          wsRef.current?.send(JSON.stringify({ t: "open", url: withScheme, scope: scopeRef.current ?? "", tabId: mine, fresh: mine === null }));
        } catch {
          // 连接断开时忽略（重连后用户可再按）
        }
      };

      // URL 栏跟随本签那一页：导航事件（宿主侧校正）把地址栏对到它
      react.useEffect(() => {
        setDraft(viewUrl);
      }, [pageId, viewUrl]);

      // 在系统浏览器打开：web 端 = 你自己浏览器的新标签页，
      // 桌面壳里 = 系统浏览器。地址取本签那一页——没有地址就没得开
      const openExternal = () => {
        const url = String(viewUrl ?? "").trim();
        if (url === "") return;
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {
          // 弹窗被拦：无副作用
        }
      };

      // 画面占位（居中提示）：没帧可看的三种情形；断线/启动失败
      // 另走顶部提示条，不占画面（定格帧保留，重连回来自动续上）
      const start = connLost
        ? null
        : !live && state.launching === true
          ? t("browserStarting")
          : !live && viewUrl === ""
            ? t("browserNotRunning")
            : pageId === null
              ? t("browserStartHint")
              : myPage === null
                ? t("browserNoPages")
                : null;

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          // 工具栏（规格同官方浏览器签）：后退/前进/刷新 + 地址框（「前往」聚焦才现形）
          // + 新页（＋，落新页即新签）+ 在系统浏览器中打开；都作用于本签那一页
          jsxRuntime.jsxs("form", {
            className: "dshk-brw-bar",
            onSubmit: (e) => {
              e.preventDefault();
              go(draft);
            },
            children: [
              jsxRuntime.jsx(KitTip, { label: t("browserBack"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", "aria-label": t("browserBack"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "back" }), children: jsxRuntime.jsx(BrwToolIcon, { name: "back" }) }) }),
              jsxRuntime.jsx(KitTip, { label: t("browserForward"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", "aria-label": t("browserForward"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "forward" }), children: jsxRuntime.jsx(BrwToolIcon, { name: "forward" }) }) }),
              jsxRuntime.jsx(KitTip, { label: t("browserReload"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", "aria-label": t("browserReload"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "reload" }), children: jsxRuntime.jsx(BrwToolIcon, { name: "reload" }) }) }),
              jsxRuntime.jsxs("div", {
                className: "dshk-brw-addrbox",
                children: [
                  jsxRuntime.jsx("input", {
                    className: "dshk-brw-url",
                    value: draft,
                    placeholder: t("browserUrlPh"),
                    "aria-label": t("browserUrlPh"),
                    spellCheck: false,
                    onChange: (e) => setDraft(e.target.value),
                  }),
                  jsxRuntime.jsx(KitTip, { label: t("browserGo"), children: jsxRuntime.jsx("button", { type: "submit", className: "dshk-brw-tool dshk-brw-go", "aria-label": t("browserGo"), children: jsxRuntime.jsx(BrwToolIcon, { name: "go" }) }) }),
                ],
              }),
              jsxRuntime.jsx(KitTip, { label: t("browserNewTab"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", "aria-label": t("browserNewTab"), onClick: () => sendInput({ t: "newTab" }), children: "＋" }) }),
              jsxRuntime.jsx(KitTip, { label: t("browserExternal"), children: jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", "aria-label": t("browserExternal"), disabled: viewUrl === "", onClick: openExternal, children: jsxRuntime.jsx(BrwToolIcon, { name: "external" }) }) }),
            ],
          }),
          // 顶部提示条：断线取警示色、启动失败取
          // 错误色；压在画面上方，定格帧不动（重连回来自动续流）
          connLost ? jsxRuntime.jsx("div", { className: "dshk-brw-warn", role: "status", children: t("browserReconnect") }) : null,
          !connLost && !live && state.error ? jsxRuntime.jsx("div", { className: "dshk-brw-fail", role: "alert", children: state.error }) : null,
          jsxRuntime.jsx("div", {
            className: "dshk-brw-body",
            ref: bodyRef,
            children: [
              jsxRuntime.jsx("canvas", {
                className: `dshk-brw-canvas${start === null ? "" : " dshk-brw-canvas-off"}`,
                ref: canvasRef,
                tabIndex: 0,
                onPointerDown: onCanvasPointerDown,
                onPointerMove: onCanvasPointerMove,
                onPointerUp: onCanvasPointerUp,
                onWheel: onCanvasWheel,
                onKeyDown: onCanvasKeyDown,
                onContextMenu: (e) => e.preventDefault(), // 右键菜单交给远端页面
              }),
              start === null ? null : jsxRuntime.jsx("div", { className: "dshk-brw-start", role: "status", children: start }),
            ],
          }),
          // 透明输入：IME 组合事件宿主（画布不可编辑，中文组合事件起不来）。
          // 点击画布后焦点在此（见 onCanvasPointerDown）——keydown 必须也挂它，
          // 否则英文逐键/快捷键的 keydown 冒泡不到处理器（键盘输入全断的根因）。
          // 组合中 value 只累积不发送；compositionend 把提交文本整段发宿主
          // （kind:'text' → 远端 keyboard.insertText）。非组合的 input（英文
          // 逐键已被 keydown preventDefault 拦下，不入 value）只清 value 不发，
          // 防残字混入下次组合。
          jsxRuntime.jsx("input", {
            ref: imeRef,
            className: "dshk-brw-ime",
            autoComplete: "off",
            tabIndex: -1,
            onKeyDown: onCanvasKeyDown,
            onInput: (e) => {
              const el = e.currentTarget;
              if (el.dataset.composing === "1" || e.isComposing === true) return;
              el.value = "";
            },
            onCompositionStart: (e) => {
              e.currentTarget.dataset.composing = "1";
            },
            onCompositionEnd: (e) => {
              const el = e.currentTarget;
              el.dataset.composing = "0";
              const text = typeof e.data === "string" && e.data !== "" ? e.data : el.value;
              el.value = "";
              if (text !== "") sendInput({ t: "input", kind: "text", text });
            },
          }),
        ],
      });
    }


    /** 功能存在性跟随 pane 挂载（本组件的右栏签用）：pane 挂载 = 官方签开着 */
    function useFeaturePresence(feature) {
      react.useEffect(() => {
        setKitUi(markFeaturePresence(feature, 1));
        return () => setKitUi(markFeaturePresence(feature, -1));
      }, [feature]);
    }
    /** 浏览器 pane（一页一签）：地址即页 id，正文只画自己那一页。页没了（agent 或
     *  别的页签关的）即收掉这张签——人关签则是反过来撤签关页（见 pane 卸载） */
    function BrowserPaneBody(props) {
      useFeaturePresence("browser");
      // tabVisible 内部调宿主钩子，必须每次渲染无条件调一次（见知识库「DSH 插件开发坑」）
      const active = tabVisible(props);
      const scope = useCurrentRow(props)?.id ?? "";
      const pageId = brwPageIdOf(props);
      const seenRef = react.useRef(false);
      // 分区 = 所属会话；没有会话就没有分区（也不连控制连接）
      const conn = scope ? brwConn(scope) : null;
      const subscribeConn = react.useCallback((cb) => {
        if (!conn) return () => {};
        conn.subs.add(cb);
        return () => {
          conn.subs.delete(cb);
          conn.drop?.();
        };
      }, [conn]);
      react.useSyncExternalStore(subscribeConn, () => conn?.version ?? 0);
      // 页集非空却找不到自己那一页 = 那页真的没了（关掉/崩溃）→ 收掉这张签。
      // 页集为空是「浏览器没起来/已收摊」，不是「这一页没了」，那时不动（见 brwReconcile）
      const gone = conn !== null && conn.pages.length > 0 && seenRef.current && brwPageOf(scope, pageId) === null;
      react.useEffect(() => {
        if (Number.isFinite(pageId)) seenRef.current = true;
      }, [pageId]);
      react.useEffect(() => {
        if (gone) {
          try {
            props.actions?.close?.();
          } catch {
            // 签已不在
          }
        }
      }, [gone]);
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children: jsxRuntime.jsx(BrowserPanel, { active, scope, pageId }) });
    }

    /** 壳层常驻（shell.overlay）：浏览器事件源 + 官方「浏览器」入口掩码。
     *  面板标签会被收掉（0 页自动收/人为关闭），「agent 开页切到浏览器」不能依赖
     *  面板自己活着——壳层恒听宿主广播；浏览器收摊顺手收掉标签。 */
    function BrowserShell(props) {
      const row = useCurrentRow(props);
      const sessionId = row?.id ?? null;
      const snap = react.useSyncExternalStore(subscribeBCfg, getBSnap);
      const cfg = bCfgFromSnapshot(snap);
      // 隐藏官方右栏「浏览器」入口（hideOfficialBrowserEntry）：body 标记 + CSS
      // display:none，锚点 data-sidebar-right-guide-entry 是官方胶囊的稳定属性。
      // 「工作区文件」入口的同类标记归 dsh-kit/files 组件
      react.useEffect(() => {
        document.body.classList.toggle("dshk-hide-official-browser", cfg.hideOfficialBrowserEntry === true);
        return () => {
          document.body.classList.remove("dshk-hide-official-browser");
        };
      }, [cfg.hideOfficialBrowserEntry]);

      // 浏览器「没了就没了」：页集由分区控制连接（brwConn）统一收，壳层只盯着
      // 「曾有页又归零 / 实例关闭」这一刻把浏览器那张签收掉——正常浏览器语义，
      // agent 下次开页照常弹回（新页 = 新签，由控制连接的页集→签条对账开出来）
      const conn = sessionId ? brwConn(sessionId) : null;
      const subscribeConn = react.useCallback((cb) => {
        if (!conn) return () => {};
        conn.subs.add(cb);
        return () => {
          conn.subs.delete(cb);
          conn.drop?.();
        };
      }, [conn]);
      const connVersion = react.useSyncExternalStore(subscribeConn, () => conn?.version ?? 0);
      void connVersion;
      react.useEffect(() => {
        if (!conn) return;
        if (conn.pages.length > 0) {
          conn.hadPages = true;
          return;
        }
        // 曾有页又归零（页崩光/分区回收）或实例已关：收掉浏览器那张签
        if (conn.hadPages || conn.closed === true) {
          conn.hadPages = false;
          closeBrowserDockForGone();
        }
      }, [conn, connVersion]);

      return null;
    }

    // ─────────── 对话链接改投内置浏览器（设置项 chatOpenLinkInBrowser，默认开）───────────
    /** 官方 markdown 把链接渲染成 `<a target="_blank">`（新标签打开，系统浏览器接管）。
     *  开启后把对话滚动区内的 http(s) 链接改投内置浏览器：宿主端点
     *  /dsh-kit/browser/open 落出一个页，回包带页 id → 开成一张签（地址即页 id）。
     *  点击即达，不依赖面板是否已挂载/已连上 WS。
     *  判定链任何一环不命中都放行官方：自家面板元素、非 http(s)（相对链接/mailto/锚点）。 */
    function onChatLinkClick(ev) {
      if (!ev.isTrusted) return;
      const cfg = bCfgFromSnapshot(getBSnap());
      if (cfg.chatOpenLinkInBrowser !== true) return;
      if (!(ev.target instanceof Element)) return;
      const kitAnc = ev.target.closest('[class*="dshk-"]');
      if (kitAnc && kitAnc !== document.body && kitAnc !== document.documentElement) return;
      const anchor = ev.target.closest("a[href]");
      if (!anchor || anchor.hasAttribute("download")) return;
      // 仅官方对话滚动区内的链接（markdown 正文、工具输出、web_search 结果都在其中）
      if (!anchor.closest('[class*="_scroll"]')) return;
      const href = (anchor.getAttribute("href") || "").trim();
      if (!/^https?:\/\//i.test(href)) return;
      ev.preventDefault();
      ev.stopPropagation();
      openExternalUrl(href);
    }


    // ─────────── 右栏「浏览器」功能签（官方 sidebarRightTabs）───────────
    // 一个功能一张 dock 签（页类型），pane 正文是本组件。服务是宿主内部实现，
    // 运行期探测取用、绝不写进 dsh.client.inject（硬声明缺失服务整个插件起不来）；
    // 缺服务只剩 getKitUi() 侧的存在性补丁（签不出现）。
    function registerRightbar(rbCtx) {
      const tabs = rbCtx.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      // 一页一签：按 dsh-resource 地址认领（地址即页 id，布局持久化，刷新后签与页
      // 仍对得上）。签名走标题槽（页标题会变），这里只给开局默认值
      rbCtx.effect(() => tabs.register({
        id: "dsh-kit-browser",
        kind: "dshk-browser",
        patterns: ["dsh-resource://dshk-browser/**"],
        // 保活：pane 正文里是这一页的 WS 与画布，切签/收栏时不能拆（拆了会把
        // 这一页当成关掉）。帧流按 tabVisible 自己停（见 BrowserPaneBody）
        keepMounted: true,
        title: () => t("dockBrowser"),
        guide: [{ order: 110, title: () => t("dockBrowser"), description: () => t("rbGuideBrowserDesc"), icon: BrowserIcon }],
      }), "dsh-kit-browser: rightbar tab type dshk-browser");
      rbCtx.effect(() => rbCtx.slots.inject("sidebar.right.pane.tab", () => rbCtx.slots.register({
        name: "sidebar.right.pane.tab",
        key: "dsh-kit-browser",
        // 会话行经 root 的 shellShare 桥（pane 注册发生在 effect，渲染期 props 由
        // 常驻的 KitSurfaces 桥供最新值）
        inject: () => ({ useSessions: shellShare.current?.useSessions }),
      }, BrowserPaneBody)), "dsh-kit-browser: rightbar pane body dshk-browser");
      // 签条标题 = 那一页的活标题（标题随内容变）。会话行同样经
      // shellShare 桥取（标题要按分区找那一页）
      rbCtx.effect(() => rbCtx.slots.inject("sidebar.right.pane.tab.title", () => rbCtx.slots.register({
        name: "sidebar.right.pane.tab.title",
        key: "dsh-kit-browser",
        inject: () => ({ useSessions: shellShare.current?.useSessions }),
      }, BrowserTabTitle)), "dsh-kit-browser: rightbar tab title dshk-browser");
    }

    // ─────────── 配置页（plugins.row.config）───────────
    // 骨架（草稿/保存/官方表单接线）在 dock，这里只喂本组件字段表与词条；
    // 字段清单与 src/browser/index.ts 的 Config schema 同源（render-check 钉住）。
    const BROWSER_CFG_FIELDS = [
      { key: "chatOpenLinkInBrowser", type: "bool", group: "kcfgGroupBrowser", labelKey: "kcfgChatOpenLinkInBrowser", hintKey: "kcfgChatOpenLinkInBrowserHint" },
      { key: "hideOfficialBrowserEntry", type: "bool", group: "kcfgGroupBrowser", labelKey: "kcfgHideOfficialBrowserEntry", hintKey: "kcfgHideOfficialBrowserEntryHint" },
    ];
    const BROWSER_CFG_GROUPS = ["kcfgGroupBrowser"];
    const BrowserConfigPage = dock.createConfigPage({
      fields: BROWSER_CFG_FIELDS,
      groups: BROWSER_CFG_GROUPS,
      t,
      onSaved: async () => {
        await loadCfg();
      },
    });

    // 组件私有样式：面板（工具栏/地址框/提示条/画布/透明 IME 输入）+ 官方入口掩码
    const BROWSER_CSS = `
/* 工具栏/地址框/提示条/空状态规格：38px 工具栏、28px 图标钮、0.5px 分隔线、
   dsw 令牌与字号（哈希类名不跨包复用，故只搬规格不搬类名）。
   画布（帧流 + 人机共驾）是本插件特有，官方无对应物；页签条没有——一个页一张
   官方右栏签，切换器是官方签条 */
.dshk-brw-bar{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:4px;height:38px;padding:5px 6px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.dshk-brw-tool{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-brw-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* label-quaternary 官方有引用但本宿主主题未定义——带回退链，将来补上即自动对齐 */
.dshk-brw-tool:disabled{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary));cursor:default}
.dshk-brw-addrbox{position:relative;flex:auto;min-width:0}
.dshk-brw-url{box-sizing:border-box;width:100%;height:28px;padding:0 34px 0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dshk-brw-url:focus{outline:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
/* 「前往」贴地址框右缘，聚焦时才现形 */
.dshk-brw-go{position:absolute;top:0;right:0;visibility:hidden;opacity:0}
.dshk-brw-addrbox:focus-within .dshk-brw-go{visibility:visible;opacity:1}
.dshk-brw-warn{flex:none;padding:6px 12px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary));background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 8%,transparent)}
.dshk-brw-fail{flex:none;padding:6px 12px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.dshk-brw-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base)}
.dshk-brw-canvas{max-width:100%;max-height:100%;margin:auto;display:block;outline:none}
.dshk-brw-canvas-off{display:none}
.dshk-brw-start{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);text-align:center}
/* 透明 IME 输入：只做组合事件宿主，视觉隐形、不拦截点击 */
.dshk-brw-ime{position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;border:0;padding:0;margin:0;outline:none;pointer-events:none;z-index:-1;background:transparent}
/* 隐藏官方右栏「浏览器」入口（hideOfficialBrowserEntry）：iframe 预览框，站点覆盖面天然受限 */
body.dshk-hide-official-browser [data-sidebar-right-guide-entry="browser"]{display:none}
`;
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit-browser/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit";
        tag.dataset.pluginCss = "dsh-kit-browser/ui";
        tag.textContent = BROWSER_CSS;
        document.head.appendChild(tag);
      }
    }

    exports.inject = ["slots"];
    // 行开关即总开关：宿主半边不物化时 /dsh-kit-browser/config 404，这里整体不注册
    //（面板、右栏签、链接改投、官方入口掩码全不出现）。
    exports.apply = async (ctx) => {
      if (!(await loadCfg())) return;
      // 本组件的 dock 签 kind 补登（openRightbarTab/closeRightbarTab 按 feature 查 kind）
      dock.tabKinds.browser = { id: "dsh-kit-browser", kind: "dshk-browser" };
      injectStyles();
      // 右栏功能签：官方 sidebarRightTabs 是挂载期声明的服务，inject 等它就绪
      ctx.inject(["sidebarRightTabs"], registerRightbar);
      // 壳层常驻事件源（agent 导航自动切签 + 收签 + 入口掩码）
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register({ name: "shell.overlay", id: "dsh-kit-browser", order: 920 }, BrowserShell),
      );
      // 对话链接改投内置浏览器（默认开：配置页 chatOpenLinkInBrowser）
      dock.hookGlobal(document, "chatLink", "click", onChatLinkClick, true);
      // 配置页挂本组件行：槽位 key = <包名>#<行id>（宿主按精确 key 匹配本行）
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#browser" }, BrowserConfigPage),
      );
    };

    // 渲染级检查取用
    exports.BrowserPanel = BrowserPanel;
    exports.BrowserPaneBody = BrowserPaneBody;
    exports.BrowserShell = BrowserShell;
    exports.BrowserIcon = BrowserIcon;
    exports.maybeAutoOpenBrowser = maybeAutoOpenBrowser;
    exports.closeBrowserDockForGone = closeBrowserDockForGone;
    exports.onChatLinkClick = onChatLinkClick;
    exports.registerRightbar = registerRightbar;
    exports.bCfgFromSnapshot = bCfgFromSnapshot;
    exports.getBSnap = getBSnap;
    exports.BROWSER_CFG_FIELDS = BROWSER_CFG_FIELDS;
    exports.BrowserConfigPage = BrowserConfigPage;
    return module.exports;
};

    // ── dsh-kit/terminal 组件（终端）──
// dsh-kit/terminal 浏览器半边 —— 终端组件的 client 面。
// 收纳：对话输入行的终端入口（多会话角标）+ 底部停靠多标签终端坞 + xterm 胶水
// （引擎 = 官方 webTerminals 服务，PTY 归宿主：会话工作区绑定、刷新保活、后台清理）。
// 入口与坞分属两个槽位（conversation.input.left / shell.overlay），共享 kitBase 的
// kitUi 跨槽状态（terminals/activeTermId/termDockOpen）；开关读本组件 Config
// （/dsh-kit-terminal/config），键位注册进官方 shortcuts 服务。xterm 静态资源走主包
// /dsh-kit/vendor 白名单（静态口套件共用）。
    const terminalModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = kit;
    const {
      setKitUi, getKitUi, useKitUi, useCurrentRow,
      KitTip, attachShortcutCatalog,
      flashToast, resolveZh, subscribeLocale, getLocaleVersion, kitJson,
    } = dock;

    // 组件私有文案（本组件自持词典；contentFail 与 root 的技能页同文，
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
      officialTermUnavailable: "官方终端服务不可用",
      termLimit: "宿主终端数量已达上限：先结束一些再新建",
      contentFail: "读取失败",
      scTerminal: "终端",
      scTerminalOff: "终端组件已在插件页停用",
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
      officialTermUnavailable: "Official terminal service unavailable",
      termLimit: "Host terminal limit reached: kill some terminals first",
      contentFail: "Failed to read",
      scTerminal: "Terminal",
      scTerminalOff: "Terminal component is disabled on the plugin page",
    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // ─────────── 组件配置（/dsh-kit-terminal/config）───────
    // 行开关（插件页组件行 switch）= 唯一开关。拉端点只为可达性——200 = 行启用；
    // 404（行禁用 → 子模块不物化）= 隐藏入口并结束会话。
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
        value = null; // 端点不可达（行禁用 404）：探明不可用
      }
      cfgSnap = value && typeof value === "object" ? { status: "ready", value } : { status: "unavailable" };
      emitCfg();
      sweepDisabledTerm();
    }
    const subscribeCfg = (fn) => {
      cfgSubs.add(fn);
      return () => cfgSubs.delete(fn);
    };
    const getCfgSnapshot = () => cfgSnap;
    /** 组件可用性：端点 200（行启用）或未探明（乐观，apply 前的渲染窗口）= true；
     *  探明 404（行禁用 → 子模块不物化）= false */
    function cfgFromSnapshot(snap) {
      return { available: !snap || snap.status === "ready" };
    }
    /** 行禁用但会话还开着（entry 重启 / 探针失败翻转）：立即清场——结束全部终端，
     *  与「行关 = 入口消失」的语义一致。每条配置通道都经 loadCfg，故清场挂在那里 */
    function sweepDisabledTerm() {
      if (cfgFromSnapshot(getCfgSnapshot()).available) return;
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
    /** 官方终端模型服务：apply 期 inject 捕获 */
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
            // 语义）——否则想复制选中文字，^C 直达 shell 把正在运行的
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
            const viewKey = `dsh-kit-term-${term.id}-g${restartKey}`;
            const contentId = `dsh-kit-term-${term.id}-g${restartKey}`;
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
      if (!cfg.available) return null;
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
        if (ui.terminals.length === 0 || !ui.termDockOpen || !cfg.available) return undefined;
        document.documentElement.style.setProperty("--dshk-dock-h", DOCK_H);
        document.body.classList.add("dshk-open");
        return () => {
          document.body.classList.remove("dshk-open");
          document.documentElement.style.removeProperty("--dshk-dock-h");
        };
      }, [ui.termDockOpen, ui.terminals.length, cfg.available]);

      if (!cfg.available || ui.terminals.length === 0) return null;
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

    // ─────────── 官方快捷键服务 ───────
    // 终端命令注册进宿主 shortcuts 服务 = 进官方「快捷键」页（Ctrl+/）：录制、冲突
    // 检测、跨设备默认值、持久化都归官方；运行期 inject。默认键只给 web:macos/web:windows（web 端放行表只认三键组合或
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
        // editable/terminal 都要：聊天输入行里、终端里按都该生效
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => {
          if (!cfgFromSnapshot(getCfgSnapshot()).available) return { status: "blocked", reason: t("scTerminalOff") };
          // 会话在 run 期读：resolve 与 run 之间隔着宿主调度，按钮可能已重渲染换过会话
          return { status: "handled", run: () => setKitUi(toggleTermDock(getKitUi(), lastSession.id, lastSession.cwd)) };
        },
      }), "dsh-kit-terminal: shortcut dsh-kit.terminal.toggle");
    }

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      // 行禁用（子模块不物化）时本组件 client 面的可达性探针 404，入口与坞自行隐藏
      // 输入框入口与坞：官方 conversation / shell 挂载期声明槽位，inject 等声明
      // 落地再注册——直接 register 抛 not declared 且炸掉整个 web boot
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register({ name: "conversation.input.left", id: "dsh-kit-terminal", order: 14 }, TerminalEntry),
      );
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register({ name: "shell.overlay", id: "dsh-kit-terminal", order: 910 }, TerminalSurfaces),
      );
      // 官方终端模型服务：apply 期 inject 捕获
      ctx.inject(["webTerminals"], (tctx) => { webTerminalsSvc = tctx.webTerminals; });
      // 官方快捷键服务：运行期 inject
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
    exports.termTabLabel = termTabLabel;
    exports.makeTerm = makeTerm;
    exports.toggleTermDock = toggleTermDock;
    exports.spawnTerm = spawnTerm;
    exports.killTerm = killTerm;
    exports.cfgFromSnapshot = cfgFromSnapshot;
    exports.registerShortcuts = registerShortcuts;
    exports.xtermTheme = xtermTheme;
    return module.exports;
};

    // ── dsh-kit/chat 组件（对话小窗）──
    // 贴边常驻的把手 + 点开成浮窗。内核是宿主官方 conversation.content 工厂的
    // embedded 变体（官方子智能体侧栏同款用法），本组件只自绘外壳与做会话绑定：
    // 自己 retain 一条会话，与主面选中哪个会话无关（独立小窗）。
    // 行开关 = 总开关：宿主半边不物化时 /dsh-kit-chat/config 404，apply 整体不注册。
    const chatModule = (kit, require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const reactDom = require("react-dom");
    const dock = kit;
    const { resolveZh, subscribeLocale, getLocaleVersion, kitJson, flashToast, mainRowOf, KitTip, chatSurface, dswIcon } = dock;

    // ─────────── 组件私有文案 ───────────
    const zh = {
      title: "对话小窗",
      open: "打开对话小窗",
      collapse: "收起小窗",
      newChat: "新建对话",
      toMain: "与主面互换（小窗看主面这条）",
      workspace: "工作区",
      session: "对话",
      noWorkspace: "还没有工作区，先在主面打开一个会话",
      noSession: "这个工作区还没有对话",
      pickSession: "选择已有对话",
      createFail: "新建会话失败",
      unsupported: "当前宿主不支持内嵌对话",
      scChat: "对话小窗",
      scChatOff: "对话小窗已在配置页关闭",
      kcfgGroupChat: "对话小窗",
      kcfgRememberWindow: "记住窗口位置",
      kcfgRememberWindowHint: "浮窗拖动与缩放后的位置跨刷新恢复。",
      kcfgRememberTarget: "记住工作区与会话",
      kcfgRememberTargetHint: "下次打开小窗回到同一个工作区与对话。",

    };
    const en = {
      title: "Chat window",
      open: "Open chat window",
      collapse: "Collapse chat window",
      newChat: "New chat",
      toMain: "Swap with the main session",
      workspace: "Workspace",
      session: "Chat",
      noWorkspace: "No workspace yet — open a session in the main panel first",
      noSession: "This workspace has no conversation yet",
      pickSession: "Pick an existing chat",
      createFail: "Failed to create a session",
      unsupported: "This host does not support an embedded conversation",
      scChat: "Chat window",
      scChatOff: "Chat window is switched off in the config page",
      kcfgGroupChat: "Chat window",
      kcfgRememberWindow: "Remember window geometry",
      kcfgRememberWindowHint: "Restore the window position and size across reloads.",
      kcfgRememberTarget: "Remember workspace and chat",
      kcfgRememberTargetHint: "Reopen the chat window on the same workspace and conversation.",

    };
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;

    // ─────────── 组件配置页（plugins.row.config，key = dsh-kit#chat）───────────
    // 骨架在 dock；字段清单与 src/chat/index.ts 的 Config schema 同源（渲染级检查钉住）。
    const CHAT_CFG_FIELDS = [
      { key: "rememberWindow", type: "bool", group: "kcfgGroupChat", labelKey: "kcfgRememberWindow", hintKey: "kcfgRememberWindowHint" },
      { key: "rememberTarget", type: "bool", group: "kcfgGroupChat", labelKey: "kcfgRememberTarget", hintKey: "kcfgRememberTargetHint" },
    ];
    const ChatConfigPage = dock.createConfigPage({ fields: CHAT_CFG_FIELDS, groups: ["kcfgGroupChat"], t });

    // ─────────── 生效配置快照（/dsh-kit-chat/config）───────────
    // 真源 = 本组件宿主 Config（src/chat/index.ts）。
    const CHAT_CFG_DEFAULTS = { rememberWindow: true, rememberTarget: true };
    let cSnap = null;
    const cCfgSubs = new Set();
    const emitCfg = () => {
      for (const fn of cCfgSubs) {
        try {
          fn();
        } catch {
          /* 订阅者已卸载 */
        }
      }
    };
    const getCSnap = () => cSnap;
    const subscribeCfg = (fn) => {
      cCfgSubs.add(fn);
      return () => cCfgSubs.delete(fn);
    };
    function cCfgFromSnapshot(snap) {
      const out = { ...CHAT_CFG_DEFAULTS };
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return out;
      const v = snap.value;
      for (const key of Object.keys(CHAT_CFG_DEFAULTS)) {
        if (typeof v[key] === "boolean") out[key] = v[key];
      }
      return out;
    }
    /** 拉生效配置；返回 false = 行关闭（探针 404）= 本组件 client 面整体不注册 */
    async function loadCfg() {
      try {
        const body = await kitJson("/dsh-kit-chat/config");
        cSnap = body && typeof body === "object" ? { status: "ready", value: body } : null;
      } catch {
        cSnap = null;
      }
      emitCfg();
      return cSnap !== null;
    }

    // ─────────── 小窗状态（跨槽共享的模块级 store）───────────
    // 存的是「小窗自己那条会话」，与主面选中无关；记忆按配置决定要不要落盘。
    const MEM_KEY = "dshk-chat/v1";
    const EMPTY = [];
    function readMem() {
      try {
        const raw = globalThis.localStorage ? globalThis.localStorage.getItem(MEM_KEY) : null;
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    const mem0 = readMem();
    let chatSnap = {
      open: false,
      workspaceId: typeof mem0.workspaceId === "string" ? mem0.workspaceId : null,
      sessionId: typeof mem0.sessionId === "string" ? mem0.sessionId : null,
      rect: mem0.rect && typeof mem0.rect === "object" ? mem0.rect : null,
      ball: mem0.ball && typeof mem0.ball === "object" ? mem0.ball : null,
    };
    const chatSubs = new Set();
    function emitChat() {
      for (const fn of chatSubs) {
        try {
          fn();
        } catch {
          /* 订阅者已卸载 */
        }
      }
    }
    const getChatSnap = () => chatSnap;
    const subscribeChat = (fn) => {
      chatSubs.add(fn);
      return () => chatSubs.delete(fn);
    };
    const useChat = () => react.useSyncExternalStore(subscribeChat, getChatSnap);
    function writeMem(cfg) {
      if (typeof globalThis.localStorage === "undefined") return;
      const payload = {};
      if (cfg.rememberTarget) {
        payload.workspaceId = chatSnap.workspaceId;
        payload.sessionId = chatSnap.sessionId;
      }
      if (cfg.rememberWindow && chatSnap.rect) payload.rect = chatSnap.rect;
      if (cfg.rememberWindow && chatSnap.ball) payload.ball = chatSnap.ball;
      try {
        globalThis.localStorage.setItem(MEM_KEY, JSON.stringify(payload));
      } catch {
        /* 隐私模式等：记忆失败不影响使用 */
      }
    }
    /** 写小窗状态；persist = false 用于拖拽过程（松手再落盘） */
    function setChat(patch, persist = true, cfg = null) {
      chatSnap = { ...chatSnap, ...patch };
      emitChat();
      if (persist) writeMem(cfg ?? cCfgFromSnapshot(getCSnap()));
    }

    // ─────────── 宿主会话服务（apply 期 inject 捕获）───────────
    let sessionsSvc = null;
    /** 官方 uiWorkspace：⇄ 互换要把主面换到小窗这条会话（缺位时不动，免得两边撞同一条） */
    let uiWorkspaceSvc = null;
    const RETAIN_SOURCE = "dshKitChat";
    /** 保留一条会话当锚，只把「仍对应当前目标」的那条交给 SessionProvider。
     *  effect 换引用（释放旧、保留新）与 state 落地之间，宿主 store 的同步重绘会
     *  插进来：那一拍里 state 还是刚释放的旧引用，喂给宿主会抛
     *  「Session reference … is released」。故连目标 id 一起记、按 id 把门。 */
    function useSessionRef(sessionId) {
      const [held, setHeld] = react.useState(null);
      react.useEffect(() => {
        if (!sessionId || !sessionsSvc || typeof sessionsSvc.retain !== "function") {
          setHeld(null);
          return undefined;
        }
        let reference = null;
        try {
          reference = sessionsSvc.retain(sessionId, { source: RETAIN_SOURCE });
        } catch {
          setHeld(null);
          return undefined;
        }
        setHeld({ id: sessionId, ref: reference });
        return () => {
          try {
            reference.release();
          } catch {
            /* 已释放 */
          }
          setHeld(null);
        };
      }, [sessionId]);
      return held !== null && held.id === sessionId ? held.ref : null;
    }

    // ─────────── 目标解析（纯函数，渲染级检查直测）───────────
    /** 路径归一（只用于比对）：反斜杠归 /、去尾分隔符、盘符不分大小写 */
    function normPath(value) {
      if (typeof value !== "string") return "";
      const s = value.replace(/\\/g, "/").replace(/\/+$/, "");
      return /^[a-z]:/i.test(s) ? s.toLowerCase() : s;
    }
    /** 主面会话 cwd 命中的工作区 */
    function workspaceOfCwd(workspaces, cwd) {
      const key = normPath(cwd);
      if (key === "") return null;
      for (const ws of workspaces ?? EMPTY) {
        if (normPath(ws?.path) === key) return ws;
      }
      return null;
    }
    /** 会话归属的工作区：按 sessionIds 认（会话 cwd 未必等于工作区路径，
     *  跨工作区「切到主面当前对话」要连工作区一起换，否则会话不在当前工作区里） */
    function workspaceOfSession(workspaces, sessionId) {
      if (!sessionId) return null;
      for (const ws of workspaces ?? EMPTY) {
        if (Array.isArray(ws?.sessionIds) && ws.sessionIds.includes(sessionId)) return ws;
      }
      return null;
    }
    /** 工作区里可用的会话行：未归档、非子智能体，按更新时间倒序。空白会话留着
     *  （它可能就是当前那条：草稿在里面，换走会丢），但下拉不列它——空白会话的
     *  displayTitle 是工作区名，与「新建对话」同一件事，列出来只会让人以为点错了 */
    function sessionsOfWorkspace(workspace, listState, archivedIds) {
      if (!workspace) return EMPTY;
      const byId = listState?.byId ?? {};
      const archived = archivedIds instanceof Set ? archivedIds : new Set(Array.isArray(archivedIds) ? archivedIds : EMPTY);
      const rows = [];
      for (const id of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : EMPTY) {
        if (archived.has(id)) continue;
        const row = byId[id];
        if (!row || row.origin === "subagent") continue;
        rows.push(row);
      }
      rows.sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
      return rows;
    }
    /** 下拉与标题里的会话名：空白会话一律显示「新建对话」 */
    function sessionLabel(row, emptyLabel) {
      if (!row) return emptyLabel;
      return row.blank === true ? t("newChat") : (row.displayTitle ?? row.id);
    }
    /** 目标工作区：记忆 > 主面会话 cwd > 第一个 */
    function resolveWorkspace(workspaces, rememberedId, mainCwd) {
      const list = Array.isArray(workspaces) ? workspaces : EMPTY;
      for (const ws of list) {
        if (rememberedId && ws?.workspaceId === rememberedId) return ws;
      }
      return workspaceOfCwd(list, mainCwd) ?? list[0] ?? null;
    }
    /** 目标会话：记忆（仍在工作区且未归档）> 最近一条有内容的 > 空白会话。
     *  excludeId（主面那条）永不选：宿主一条会话只有一个输入框编辑器实例，两处同时
     *  渲染同一条时后挂载的那份会抢走输入框，主面那个变成「假框」。 */
    function resolveSessionId(rows, rememberedId, excludeId = null) {
      for (const row of rows ?? EMPTY) {
        if (rememberedId && row?.id === rememberedId && row.id !== excludeId) return rememberedId;
      }
      return (rows ?? EMPTY).find((r) => r?.blank !== true && r?.id !== excludeId)?.id
        ?? (rows ?? EMPTY).find((r) => r?.id !== excludeId)?.id
        ?? null;
    }

    // ─────────── 窗口几何 ───────────
    const PANEL_W = 420;
    const PANEL_H = 620;
    const NARROW = 640;
    function clampNum(v, lo, hi) {
      return Math.min(hi, Math.max(lo, v));
    }
    function viewport() {
      const w = typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1280;
      const h = typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 800;
      return { w, h };
    }
    /** 贴着视口的矩形：记忆值越界时收回视口内；窄屏（手机）整屏铺满，不摆浮窗 */
    function rectOf(ui, cfg) {
      const vp = viewport();
      if (vp.w <= NARROW) return null;
      const r = ui.rect;
      const w = clampNum(typeof r?.w === "number" ? r.w : PANEL_W, 320, Math.min(720, vp.w - 32));
      const h = clampNum(typeof r?.h === "number" ? r.h : PANEL_H, 320, Math.max(320, vp.h - 32));
      const fallbackX = vp.w - w - 12;
      const x = clampNum(typeof r?.x === "number" ? r.x : fallbackX, 8, Math.max(8, vp.w - w - 8));
      const y = clampNum(typeof r?.y === "number" ? r.y : Math.max(48, Math.round((vp.h - h) / 2)), 8, Math.max(8, vp.h - h - 8));
      return { x, y, w, h };
    }

    // ─────────── 内嵌对话内核 ───────────
    /** 只留对话这一个 view（与官方子智能体侧栏同款取舍） */
    function FixedChatView(props) {
      return props.renderSlot("conversation.session", { view: "chat" });
    }
    /** 小窗正文：宿主官方 conversation.content 的 embedded 变体 */
    function ChatSessionBody(props) {
      const session = typeof props.useSession === "function" ? props.useSession((v) => v) : null;
      const hero = !!session && session.blank === true && session.running !== true;
      const note = jsxRuntime.jsx("div", { className: "dshk-chat-note", children: t("unsupported") });
      if (typeof props.renderFactorySlot !== "function") return note;
      return props.renderFactorySlot(
        "conversation.content",
        { variant: "embedded", phase: hero ? "hero" : "active", hero },
        { slots: { views: FixedChatView }, fallback: note },
      );
    }

    // ─────────── 下拉浮层 ───────────
    function PickMenu({ label, title, items, onPick, onClose }) {
      // 遮罩先渲染、条目带定位层：同为定位元素时靠 DOM 先后决定层叠，
      // 反过来（遮罩在后）它会盖住条目，点条目永远点不中。
      return jsxRuntime.jsxs("div", { className: "dshk-chat-menu", children: [
        jsxRuntime.jsx("button", { type: "button", className: "dshk-chat-menu-mask", "aria-label": label, onClick: onClose }),
        jsxRuntime.jsx("div", { className: "dshk-chat-menu-h", children: title }),
        ...items.map((item) =>
          jsxRuntime.jsx("button", {
            type: "button",
            key: item.key,
            className: "dshk-chat-menu-i",
            "aria-current": item.current === true ? "true" : undefined,
            onClick: () => {
              onPick(item);
              onClose();
            },
            children: [
              jsxRuntime.jsx("span", { className: "dshk-chat-menu-t", children: item.label }),
              item.hint ? jsxRuntime.jsx("span", { className: "dshk-chat-menu-x", children: item.hint }) : null,
            ],
          }),
        ),
      ] });
    }

    // ─────────── 面板 ───────────
    function ChatPanel(props) {
      const { ui, cfg, workspaces, rows, ws, body, onSessionId, onWorkspaceId, onCreate, mainId, mainTitle, onPickMain } = props;
      const [menu, setMenu] = react.useState(null);
      const rect = rectOf(ui, cfg);
      const running = rows.some((r) => r?.id === ui.sessionId && r?.running === true);
      const sessionTitle = sessionLabel(rows.find((r) => r?.id === ui.sessionId), t("noSession"));
      const wsTitle = ws?.title ?? ws?.path ?? t("noWorkspace");

      react.useEffect(() => {
        if (menu === null) return undefined;
        const onKey = (e) => {
          if (e.key === "Escape") setMenu(null);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
      }, [menu]);

      const onKeyDown = (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (menu !== null) setMenu(null);
        else setChat({ open: false });
      };

      /** 头部拖动 / 右下角缩放：过程只改内存，松手落盘 */
      const startDrag = (ev) => {
        if (ev.button !== 0 || rect === null) return;
        if (ev.target instanceof Element && ev.target.closest("button") !== null) return;
        ev.preventDefault();
        const base = rect;
        const from = { x: ev.clientX, y: ev.clientY };
        const move = (e) => {
          setChat(
            {
              rect: {
                x: clampNum(base.x + (e.clientX - from.x), 8, Math.max(8, viewport().w - base.w - 8)),
                y: clampNum(base.y + (e.clientY - from.y), 8, Math.max(8, viewport().h - base.h - 8)),
                w: base.w,
                h: base.h,
              },
            },
            false,
          );
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          writeMem(cCfgFromSnapshot(getCSnap()));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      };

      const startResize = (ev) => {
        if (ev.button !== 0 || rect === null) return;
        ev.preventDefault();
        ev.stopPropagation();
        const base = rect;
        const from = { x: ev.clientX, y: ev.clientY };
        const move = (e) => {
          const vp = viewport();
          setChat(
            {
              rect: {
                x: base.x,
                y: base.y,
                w: clampNum(base.w + (e.clientX - from.x), 320, Math.min(720, vp.w - base.x - 8)),
                h: clampNum(base.h + (e.clientY - from.y), 320, Math.max(320, vp.h - base.y - 8)),
              },
            },
            false,
          );
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          writeMem(cCfgFromSnapshot(getCSnap()));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      };

      const headBtn = (key, title, children, onClick, opts) =>
        jsxRuntime.jsxs("button", {
          type: "button",
          key,
          className: "dshk-chat-hb",
          title,
          disabled: opts?.disabled === true,
          "aria-pressed": opts?.pressed,
          onClick,
          children,
        });

      const style = rect === null ? { inset: "0" } : { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px" };

      return jsxRuntime.jsxs("div", {
        className: "dshk-chat-panel",
        style,
        onKeyDown,
        children: [
          jsxRuntime.jsxs("div", { className: "dshk-chat-head", onPointerDown: startDrag, children: [
            jsxRuntime.jsxs("div", { className: "dshk-chat-hgroup", children: [
              headBtn("ws", wsTitle, [jsxRuntime.jsx("span", { className: "dshk-chat-hlabel", children: t("workspace") }), jsxRuntime.jsx("span", { className: "dshk-chat-hval", children: wsTitle })], () => setMenu(menu === "ws" ? null : "ws"), menu === "ws" ? { pressed: true } : undefined),
              headBtn("sess", sessionTitle, [jsxRuntime.jsx("span", { className: "dshk-chat-hlabel", children: t("session") }), jsxRuntime.jsx("span", { className: "dshk-chat-hval", children: sessionTitle })], () => setMenu(menu === "sess" ? null : "sess"), menu === "sess" ? { pressed: true } : undefined),
              headBtn("new", t("newChat"), jsxRuntime.jsx("span", { className: "dshk-chat-hplus", children: "+" }), () => onCreate()),
              headBtn("main", mainId !== null && mainId !== ui.sessionId ? t("toMain") + (mainTitle === "" ? "" : " · " + mainTitle) : undefined, jsxRuntime.jsx("span", { className: "dshk-chat-hfollow", children: "⇄" }), () => onPickMain(), { disabled: mainId === null || ui.sessionId === null || mainId === ui.sessionId }),
              headBtn("close", t("collapse"), jsxRuntime.jsx("span", { className: "dshk-chat-hclose", children: "✕" }), () => setChat({ open: false })),
            ] }),
            running ? jsxRuntime.jsx("span", { className: "dshk-chat-run" }) : null,
            menu === "ws"
              ? jsxRuntime.jsx(PickMenu, {
                  label: t("workspace"),
                  title: t("workspace"),
                  items: workspaces.map((w) => ({ key: w.workspaceId, label: w.title ?? w.path, hint: w.path, current: w.workspaceId === ws?.workspaceId })),
                  onPick: (item) => onWorkspaceId(item.key),
                  onClose: () => setMenu(null),
                })
              : null,
            menu === "sess"
              ? jsxRuntime.jsx(PickMenu, {
                  label: t("session"),
                  title: t("pickSession"),
                  items: rows.filter((r) => r.blank !== true && r.id !== mainId).map((r) => ({ key: r.id, label: sessionLabel(r, r.id), hint: r.running === true ? "…" : undefined, current: r.id === ui.sessionId })),
                  onPick: (item) => onSessionId(item.key),
                  onClose: () => setMenu(null),
                })
              : null,
          ] }),
          jsxRuntime.jsx("div", { className: "dshk-chat-body", children: body }),
          rect === null ? null : jsxRuntime.jsx("div", { className: "dshk-chat-grip", onPointerDown: startResize }),
        ],
      });
    }

    // ─────────── 悬浮把手（可拖动 · 贴边收起 · 悬停滑出）───────────
    const SNAP = 40; // 松手时离边缘多近算「贴边」（贴着才算，别在半路就收进去）
    const BALL = 34; // 圆球边长
    /** 把手停靠侧：null = 自由位置（拖到哪儿停哪儿）。没记忆过时贴右边——左右由拖出来定 */
    function ballDockOf(ui) {
      const saved = ui.ball;
      if (saved === null || saved === undefined) return "right";
      return saved.dock;
    }
    function ChatBall({ cfg, ui, title, running }) {
      const saved = ui.ball ?? null;
      const dock = ballDockOf(ui);
      const vp = viewport();
      // 纵向一律用记下的 y（贴边也不例外），top 取球的中心（CSS 一律 translateY(-50%)）。
      // 贴边只把横向交给 CSS：left/right 定停哪侧，translateX 负责收进边缘那 9px
      const top = clampNum(saved?.y ?? Math.round(vp.h / 2), 0, Math.max(0, vp.h - BALL));
      const ballStyle = dock === null
        ? { left: clampNum(saved?.x ?? (vp.w - BALL), 0, Math.max(0, vp.w - BALL)), top }
        : { top };
      // 拖动与点击分家：位移不足几像素按点击算（开窗）
      const startDrag = (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const from = { x: ev.clientX, y: ev.clientY };
        const origin = dock !== null
          ? { x: (dock === "left" ? 0 : vp.w - BALL), y: clampNum(saved?.y ?? Math.round(vp.h / 2), 0, Math.max(0, vp.h - BALL)) }
          : { x: clampNum(saved?.x ?? vp.w - BALL, 0, Math.max(0, vp.w - BALL)), y: clampNum(saved?.y ?? Math.round(vp.h / 2), 0, Math.max(0, vp.h - BALL)) };
        let moved = false;
        let last = origin;
        const move = (e) => {
          if (!moved && Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) < 4) return;
          moved = true;
          const now = viewport();
          last = {
            x: clampNum(origin.x + (e.clientX - from.x), 0, Math.max(0, now.w - BALL)),
            y: clampNum(origin.y + (e.clientY - from.y), 0, Math.max(0, now.h - BALL)),
          };
          setChat({ ball: { dock: null, x: last.x, y: last.y } }, false);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (!moved) {
            setChat({ open: true }, true, cfg);
            return;
          }
          // 拖到边缘附近就贴边收起，否则停在拖到的地方
          const v = viewport();
          const nearLeft = last.x <= SNAP;
          const nearRight = v.w - (last.x + BALL) <= SNAP;
          const side = nearLeft && (!nearRight || last.x < v.w / 2) ? "left" : nearRight ? "right" : null;
          setChat({ ball: side === null ? { dock: null, x: last.x, y: last.y } : { dock: side, x: last.x, y: last.y } }, true, cfg);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      };
      const Fish = dswIcon("FishLogo");
      return jsxRuntime.jsx(KitTip, {
        label: title === "" ? t("open") : t("open") + " · " + title,
        side: dock === "left" ? "right" : "left",
        children: jsxRuntime.jsx("button", {
          type: "button",
          className: "dshk-chat-ball",
          style: ballStyle,
          "aria-label": t("open"),
          onPointerDown: startDrag,
          children: [
            Fish ? jsxRuntime.jsx(Fish, { size: 16, className: "dshk-chat-ballfish" }) : jsxRuntime.jsx("span", { className: "dshk-chat-ballg" }),
            running ? jsxRuntime.jsx("span", { className: "dshk-chat-baldot" }) : null,
          ],
        }),
      });
    }

    // ─────────── 浮层宿主（shell.overlay，root 作用域常驻）───────────
    function ChatSurface(props) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion);
      const cfg = cCfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCSnap));
      const ui = useChat();
      const useWorkspaces = typeof props.useWorkspaces === "function" ? props.useWorkspaces : null;
      const useSessions = typeof props.useSessions === "function" ? props.useSessions : null;
      const workspaces = useWorkspaces ? (useWorkspaces((s) => s?.items) ?? EMPTY) : EMPTY;
      const listState = useSessions ? useSessions((s) => s) : null;
      const archived = useWorkspaces ? (useWorkspaces((s) => s?.archivedSessionIds) ?? EMPTY) : EMPTY;
      const mainRow = mainRowOf(listState);

      // 目标解析：记忆 > 主面会话 cwd > 第一个，再取该工作区最近一条未归档。
      // 当前目标仍有效时不动（避免对话中途被换走）
      const ws = react.useMemo(
        () => resolveWorkspace(workspaces, ui.workspaceId, mainRow?.cwd),
        [workspaces, ui.workspaceId, mainRow?.cwd],
      );
      const rows = react.useMemo(() => sessionsOfWorkspace(ws, listState, archived), [ws, listState, archived]);
      const wantedId = resolveSessionId(rows, ui.sessionId, mainRow?.id ?? null);
      const valid = wantedId !== null && rows.some((r) => r?.id === wantedId);

      // 工作区里一条可用对话都没有 → 新建一条（空会话落在官方 hero 相位）
      const creating = react.useRef(null);
      const wsId = ws?.workspaceId ?? null;
      react.useEffect(() => {
        if (valid || !wsId || !sessionsSvc || typeof sessionsSvc.create !== "function") return;
        if (creating.current === wsId) return;
        creating.current = wsId;
        sessionsSvc
          .create({ workspaceId: wsId })
          .then((id) => {
            creating.current = null;
            setChat({ sessionId: id, workspaceId: wsId }, true, cfg);
          })
          .catch(() => {
            creating.current = null;
            flashToast(t("createFail"));
          });
      }, [valid, wsId]);

      react.useEffect(() => {
        if (valid && wantedId !== ui.sessionId) setChat({ sessionId: wantedId }, true, cfg);
        else if (wsId !== null && wsId !== ui.workspaceId) setChat({ workspaceId: wsId }, true, cfg);
      }, [valid, wantedId, wsId]);

      // 发布当前落点：引用写入按光标选面、回合完成通知对「正看着的那条」免打扰，
      // 都读它。渲染期直接赋值（同 VaultShell 的 chatPreviewHook），收起即视为没有小窗。
      chatSurface.open = ui.open;
      chatSurface.sessionId = valid ? wantedId : null;

      const ref = useSessionRef(valid ? wantedId : null);
      const body =
        ref && typeof props.SessionProvider === "function"
          ? jsxRuntime.jsx(props.SessionProvider, { session: ref, children: props.renderSlot("dsh-kit.chat.session", {}) })
          : jsxRuntime.jsx("div", { className: "dshk-chat-note", children: t("noSession") });

      const current = rows.find((r) => r?.id === ui.sessionId) ?? null;
      const onCreate = () => {
        if (!wsId || !sessionsSvc || typeof sessionsSvc.create !== "function") return;
        creating.current = wsId;
        sessionsSvc
          .create({ workspaceId: wsId })
          .then((id) => setChat({ sessionId: id, workspaceId: wsId }, true, cfg))
          .catch(() => {
            creating.current = null;
            flashToast(t("createFail"));
          });
      };

      const node = jsxRuntime.jsxs("div", {
        className: "dshk-chat-root " + (ballDockOf(ui) === null ? "is-free" : "is-dock-" + ballDockOf(ui)),
        children: [
          ui.open
            ? jsxRuntime.jsx(ChatPanel, {
                ui,
                cfg,
                workspaces,
                rows,
                ws,
                body,
                onCreate,
                mainId: mainRow?.id ?? null,
                mainTitle: mainRow?.displayTitle ?? "",
                onPickMain: () => {
                  const mainId = mainRow?.id ?? null;
                  const chatId = ui.sessionId;
                  if (mainId === null || chatId === null || mainId === chatId) return;
                  // ⇄ 是两边互换：主面接手小窗这条，小窗接手主面这条。宿主一条会话只有
                  // 一个输入框编辑器实例，两边同一条会互相抢（主面变假框、@ 引用插错面）
                  // ——主面不让开，小窗就显示不了主面那条。先换主面（同步更新 mainView
                  // 保留），再设小窗目标；主面那条可能属于别的工作区，连工作区一起换。
                  if (!uiWorkspaceSvc || typeof uiWorkspaceSvc.openSession !== "function") return;
                  try {
                    uiWorkspaceSvc.openSession(chatId);
                  } catch {
                    return; // 主面没接走就别动小窗：两边撞同一条的代价更大
                  }
                  const owner = workspaceOfSession(workspaces, mainId);
                  setChat({ sessionId: mainId, workspaceId: owner?.workspaceId ?? ui.workspaceId }, true, cfg);
                },
                onSessionId: (id) => setChat({ sessionId: id }, true, cfg),
                onWorkspaceId: (id) => setChat({ workspaceId: id, sessionId: null }, true, cfg),
              })
            : null,
          // 展开时不留把手：它停靠在屏幕边缘，会压在浮窗右边沿上（收起态才常显）
          ui.open ? null : jsxRuntime.jsx(ChatBall, { cfg, ui, title: sessionLabel(current, t("title")), running: current?.running === true }),
        ],
      });
      // **portal 到 body**：右栏全屏时那张签的 pane 宿主 z-index 高于官方 overlay 层，
      // 而本组件的渲染位置在那层内部——层内再大的 z-index 也压不过它（同样的道理，
      // 计时悬浮球挂的是全局根）。脱离那层后把手与浮窗在所有面板之上。
      if (reactDom && typeof reactDom.createPortal === "function" && typeof document !== "undefined" && document.body) {
        return reactDom.createPortal(node, document.body);
      }
      return node;
    }

    // ─────────── 样式 ───────────
    const CHAT_CSS = [
      '.dshk-chat-root{position:fixed;inset:0;pointer-events:none;z-index:60}',
      '.dshk-chat-root>*{pointer-events:auto}',
      // 悬浮球：圆形把手，可拖到任意位置（含纵向）；贴边时只露一条边，悬停滑出
      '.dshk-chat-ball{position:absolute;display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:none;border-radius:50%;cursor:grab;background:var(--dsw-alias-bg-base,rgba(20,20,20,.92));box-shadow:0 2px 10px rgba(0,0,0,.28);color:var(--dsw-alias-label-secondary,#888);transition:transform .18s ease}',
      '.dshk-chat-ball:active{cursor:grabbing}',
      // 贴边：top 由正文给（记住的纵向位置），这里只定侧别与收进边缘的位移
      '.dshk-chat-root.is-dock-right .dshk-chat-ball{right:0;transform:translateY(-50%) translateX(calc(100% - 9px))}',
      '.dshk-chat-root.is-dock-left .dshk-chat-ball{left:0;transform:translateY(-50%) translateX(calc(-100% + 9px))}',
      '.dshk-chat-root.is-dock-right:hover .dshk-chat-ball,.dshk-chat-root.is-dock-right .dshk-chat-ball:focus-visible{transform:translateY(-50%)}',
      '.dshk-chat-root.is-dock-left:hover .dshk-chat-ball,.dshk-chat-root.is-dock-left .dshk-chat-ball:focus-visible{transform:translateY(-50%)}',
      '.dshk-chat-root.is-free .dshk-chat-ball{transform:translateY(-50%)}',
      '.dshk-chat-ball:hover{color:var(--dsw-alias-label-primary,#eee)}',
      '@media (prefers-reduced-motion:reduce){.dshk-chat-ball{transition:none}}',
      '.dshk-chat-ballfish{display:block}',
      '.dshk-chat-ballg{width:15px;height:15px;border-radius:50%;border:1.4px solid currentColor;position:relative}',
      '.dshk-chat-ballg:after{content:"";position:absolute;left:2.5px;top:1.5px;width:8px;height:5px;border-radius:1px 1px 2px 2px;background:currentColor}',
      '.dshk-chat-baldot{position:absolute;top:-1px;right:-1px;width:8px;height:8px;border-radius:50%;background:#37c26b;box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#fff)}',
      '.dshk-chat-panel{position:fixed;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.12));border-radius:12px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 12px 40px rgba(0,0,0,.34)}',
      '@media (max-width:640px){.dshk-chat-panel{border-radius:0;border:none}}',
      '.dshk-chat-head{flex:none;position:relative;display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.12));cursor:grab;user-select:none}',
      '.dshk-chat-hgroup{display:flex;align-items:center;gap:4px;min-width:0;flex:1}',
      '.dshk-chat-hb{display:inline-flex;align-items:center;gap:4px;max-width:150px;padding:4px 8px;border:none;border-radius:6px;background:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#888);font-size:12px;line-height:1.4}',
      '.dshk-chat-hb:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-primary,#eee)}',
      '.dshk-chat-hb[aria-pressed="true"]{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-primary,#eee)}',
      '.dshk-chat-hb:disabled{opacity:.45;cursor:default}',
      '.dshk-chat-hlabel{color:var(--dsw-alias-label-tertiary,#777);font-size:11px}',
      '.dshk-chat-hval{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshk-chat-hplus{font-size:15px;line-height:1}',
      '.dshk-chat-hclose{font-size:12px;line-height:1}',
      '.dshk-chat-run{flex:none;width:6px;height:6px;border-radius:50%;background:#37c26b;box-shadow:0 0 0 3px rgba(55,194,107,.18)}',
      '.dshk-chat-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.dshk-chat-body>*{flex:1;min-height:0}',
      // 小窗里不显示 kit 的输入行入口钮（文件树 / 源代码管理 / 终端）：
      // 它们开的是右栏与侧栏，在浮窗里点开只会把浮窗底下换成别的面板。只藏按钮不够
      // ——官方 Tooltip 壳会留一个空占位，:has 一并收掉。
      '.dshk-chat-panel .dshk-enbtn{display:none}',
      '.dshk-chat-panel :has(> .dshk-enbtn){display:none}',
      '.dshk-chat-note{padding:16px;color:var(--dsw-alias-label-tertiary,#777);font-size:12px;text-align:center}',
      '.dshk-chat-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize}',
      '.dshk-chat-grip:after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-right:1.2px solid var(--dsw-alias-label-tertiary,#777);border-bottom:1.2px solid var(--dsw-alias-label-tertiary,#777);border-radius:0 0 3px 0}',
      '.dshk-chat-menu{position:absolute;top:100%;left:0;right:0;z-index:5;margin-top:4px;padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.12));background:var(--dsw-alias-bg-base,#fff);box-shadow:0 10px 30px rgba(0,0,0,.3);max-height:320px;overflow:auto}',
      '.dshk-chat-menu-h{position:relative;z-index:1;padding:4px 8px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary,#777)}',
      '.dshk-chat-menu-i{position:relative;z-index:1;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:none;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary,#eee);font-size:12px}',
      '.dshk-chat-menu-i:hover{background:rgba(127,127,127,.16)}',
      '.dshk-chat-menu-i[aria-current="true"]{font-weight:600}',
      '.dshk-chat-menu-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshk-chat-menu-x{flex:none;color:var(--dsw-alias-label-tertiary,#777);font-size:11px;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshk-chat-menu-mask{position:fixed;inset:0;border:none;background:none;cursor:default}',
    ].join("\n");
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit-chat/ui"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-kit-chat";
      tag.dataset.pluginCss = "dsh-kit-chat/ui";
      tag.textContent = CHAT_CSS;
      document.head.appendChild(tag);
    }

    // ─────────── 快捷键（官方 shortcuts 服务，开合小窗）───────────
    /** 开关小窗：收起态按它展开，已展开按它收起（把手只在收起态常显） */
    function toggleChat() {
      setChat({ open: !chatSnap.open });
    }
    function registerShortcuts(scCtx) {
      const shortcuts = scCtx.shortcuts;
      if (!shortcuts || typeof shortcuts.register !== "function") return;
      attachShortcutCatalog(shortcuts.catalog);
      scCtx.effect(() => shortcuts.register({
        id: "dsh-kit.chat.toggle",
        label: () => t("scChat"),
        aliases: ["chat window", "chat pane", "dsh-kit"],
        // 分号：Ctrl+Alt+; —— 字母键 C/V/X/Z/Y/Q/H 与 primary 组合是系统保留
        // （剪贴板 / 退出 / 历史），web 端一律拒收；web:linux 只放行 Slash 与
        // Comma/Period+shift，故不声明那一档
        defaults: {
          "web:macos": { code: "Semicolon", modifiers: ["primary", "alt"] },
          "web:windows": { code: "Semicolon", modifiers: ["primary", "alt"] },
          "desktop:macos": { code: "Semicolon", modifiers: ["primary", "alt"] },
          "desktop:windows": { code: "Semicolon", modifiers: ["primary", "alt"] },
          "desktop:linux": { code: "Semicolon", modifiers: ["primary", "alt"] },
        },
        // editable/terminal 都要：聊天输入行里、终端里按都该生效
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => {
          if (getCSnap() === null) return { status: "blocked", reason: t("scChatOff") };
          return { status: "handled", run: toggleChat };
        },
      }), "dsh-kit-chat: shortcut dsh-kit.chat.toggle");
    }

    // ─────────── 插件体 ───────────
    async function apply(ctx) {
      // 行禁用 → 探针 404 → 整体不注册（把手与浮窗全不出现）；返回值必须等、必须判，
      // 否则配置快照缺失会回落默认全开，关行后小窗照常渲染
      if (!(await loadCfg())) return;
      ctx.inject(["sessions"], (sctx) => {
        sessionsSvc = sctx.sessions ?? null;
      });
      ctx.inject(["uiWorkspace"], (wctx) => {
        uiWorkspaceSvc = wctx.uiWorkspace ?? null;
      });
      // 官方快捷键服务：运行期 inject
      ctx.inject(["shortcuts"], registerShortcuts);
      // 贴边常驻面 + 小窗会话正文（子槽 scope=session → 本组件才拿到 SessionProvider）
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-kit-chat",
            order: 930,
            children: { "dsh-kit.chat.session": { kind: "single", scope: "session" } },
          },
          ChatSurface,
        ),
      );
      ctx.slots.inject("dsh-kit.chat.session", () =>
        ctx.slots.register({ name: "dsh-kit.chat.session", id: "dsh-kit-chat-body" }, ChatSessionBody),
      );
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: "dsh-kit#chat" }, ChatConfigPage),
      );
      injectStyles();
    }

    exports.inject = ["slots"];
    exports.apply = apply;
    exports.ChatConfigPage = ChatConfigPage;
    exports.CHAT_CFG_FIELDS = CHAT_CFG_FIELDS;
    exports.ChatSurface = ChatSurface;
    exports.ChatSessionBody = ChatSessionBody;
    exports.ChatBall = ChatBall;
    exports.ChatPanel = ChatPanel;
    exports.CHAT_CFG_DEFAULTS = CHAT_CFG_DEFAULTS;
    exports.registerShortcuts = registerShortcuts;
    exports.toggleChat = toggleChat;
    exports.cCfgFromSnapshot = cCfgFromSnapshot;
    exports.loadCfg = loadCfg;
    exports.normPath = normPath;
    exports.workspaceOfCwd = workspaceOfCwd;
    exports.workspaceOfSession = workspaceOfSession;
    exports.sessionsOfWorkspace = sessionsOfWorkspace;
    exports.resolveWorkspace = resolveWorkspace;
    exports.resolveSessionId = resolveSessionId;
    exports.sessionLabel = sessionLabel;
    exports.rectOf = rectOf;
    exports.getChatSnap = getChatSnap;
    exports.setChat = setChat;
    return exports;
    };

    // dsh-kit/logs 浏览器半边 —— 日志组件行的 client 面。
    //
    // 本组件不注册任何槽位与界面，只做两件事：把底座的攒批闸打开（关行 = 页面的 warn /
    // error 只走控制台镜像，不发请求），以及装上「未捕获异常 / 未处理的 Promise 拒绝 /
    // 页面隐藏与关闭时冲刷」这几个全局钩子。行禁用 → 宿主半边不物化 →
    // /dsh-kit-logs/config 404 → 什么都不装：页面白屏这类只在页面里留不下的现象就没人收，
    // 这就是关掉本行的代价。
    const logsModule = (kit, require) => {
      var exports = {};
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

      async function apply(ctx) {
        let reachable = false;
        try {
          const res = await fetch("/dsh-kit-logs/config", { cache: "no-store" });
          reachable = res.ok;
        } catch {
          reachable = false;
        }
        if (!reachable || typeof window === "undefined") return;

        kit.kitLogSink(true);
        const boot = kit.kitLogger("client");
        kit.hookGlobal(window, "kitLogError", "error", (event) => {
          boot.error(event.message || "未捕获异常", {
            source: event.filename + ":" + event.lineno + ":" + event.colno,
            stack: String(event.error?.stack ?? "").slice(0, 600),
          });
        });
        kit.hookGlobal(window, "kitLogRejection", "unhandledrejection", (event) => {
          const reason = event.reason;
          boot.error("未处理的 Promise 拒绝", {
            reason: String(reason?.message ?? reason ?? "").slice(0, 300),
            stack: String(reason?.stack ?? "").slice(0, 600),
          });
        });
        // 攒批靠 setTimeout，而后台标签页的定时器会被节流到分钟级、直接关页则永远发不出去，
        // 所以页面隐藏/关闭时立刻冲刷
        kit.hookGlobal(document, "kitLogVisibility", "visibilitychange", () => {
          if (document.visibilityState === "hidden") kit.kitLogFlush();
        });
        kit.hookGlobal(window, "kitLogPagehide", "pagehide", kit.kitLogFlush);
      }

      exports.inject = ["slots"];
      exports.apply = apply;
      return exports;
    };

    // 组件模块执行必须在 kitBase/root 设施组装完成之后（见下方 exports.files 赋值
    // 处）——组件体执行期会读 dock.createConfigPage 等成员
    // slots 是唯一依赖：配置走各组件自己的 Config schema + 原生设置页，client 拉
    // 自己的 /dsh-kit-<行id>/config 快照做门控
    // 共享面暴露给组件半边：kit 形参即本对象（apply/inject 是插件形状，不暴露）
    for (const [k, v] of Object.entries(kitBase)) if (k !== "apply" && k !== "inject") exports[k] = v;
    // 组件半边消费的 root 侧设施：闭包引用 root 模块状态（sessionsSvc/rightbarSr/
    // slotsCtx/vault 状态等），组件拿到的就是这里的活引用
    exports.useCurrentRow = useCurrentRow;
    exports.useCurrentCwd = useCurrentCwd;
    // 会话 id 与常驻壳层 props 桥（浏览器组件的右栏签与链接改投用）
    exports.currentSessionId = currentSessionId;
    exports.shellShare = shellShare;
    exports.currentComposerShell = currentComposerShell;
    exports.chatSurface = chatSurface;
    exports.chatSurfaceSession = chatSurfaceSession;
    exports.composerFocus = composerFocus;
    exports.chatMentionText = chatMentionText;
    // 主行文案与官方文件签打开（组件半边的共用词条回落 rootT、资料库文件开官方右栏）
    exports.t = t;
    exports.openOfficialFile = openOfficialFile;
    exports.dswIcon = dswIcon;
    exports.sidebarBtn = sidebarBtn;
    exports.expandSidebarNow = expandSidebarNow;
    exports.TreeRowMenu = TreeRowMenu;
    exports.TreeFolderIcon = TreeFolderIcon;
    exports.FileTypeIcon16 = FileTypeIcon16;
    exports.ChevronIcon = ChevronIcon;
    exports.OfficialIcon = OfficialIcon;
    exports.openTreeFile = openTreeFile;
    exports.registerNavIcon = registerNavIcon;
    // 组件模块执行（files/monitor/terminal/skills/search/browser/vault/phone/logs）：必须在
    // kitBase 浅拷贝与 root 设施都挂上 exports 之后——组件体执行期会读 dock.createConfigPage 等成员
    exports.files = filesModule(exports, require);
    exports.chat = chatModule(exports, require);
    exports.monitor = monitorModule(exports, require);
    exports.terminal = terminalModule(exports, require);
    exports.skills = skillsModule(exports, require);
    exports.search = searchModule(exports, require);
    exports.browser = browserModule(exports, require);
    exports.vault = vaultModule(exports, require);
    exports.phone = phoneModule(exports, require);
    exports.logs = logsModule(exports, require);
    exports.inject = ["slots"];
    exports.apply = apply;
    return module.exports;
  },
});
