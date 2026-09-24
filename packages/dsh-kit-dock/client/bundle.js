// dsh-kit-dock 浏览器半边 —— 组件间共享的 client 底座（手写 bundle，与主包同形态）。
// 组件包在 dsh.client.external 声明本包，factory 里 require("dsh-kit-dock") 取共享面；
// 客户端模块系统按依赖图先物化被依赖者，无需约定加载顺序。
// 本片收纳：kit 端点调用三件套 + 轻提示 + 剪贴板 + 会话行共享判定 + 插件行配置页
// 骨架（createConfigPage）。kitUi 跨槽状态与右栏 pane 契约后续轮迁入。
window.__ModuleLoader__.load({
  id: "dsh-kit-dock",
  factory: (require) => {
    var exports = {};
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    let dswPrim = null;
    try { dswPrim = require("@deepseek-ai/dsh-client-ui-primitives"); } catch { /* 老宿主：配置页降级 */ }

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

    /** GET /dsh-kit/*，按 validate 校验回包形状（形状不符 = 失败，不当半个成功）；
        （如写文件的 409 冲突） */
    async function kitGetJson(url, signal, validate) {
      const res = await fetch(url, { signal });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || (validate && !validate(body))) {
        const error = new Error((body && body.error) || "HTTP " + res.status);
        error.status = res.status;
        error.body = body;
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

    /** 主视图会话行（0.1.6 会话面多实例化后 sessions.list 快照没有 current）：
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
    // 官方表单原语解析：老宿主 primitives 缺成员时配置页降级为提示，不影响其余。
    const cfgUiPrim =
      dswPrim
      && typeof dswPrim.SettingsForm === "function"
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
        const base = snap.value;
        const writable = snap.writable !== false;
        const draftOf = (key) => (draft && Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : null);
        // entry null = 撤销该字段的草稿；改回与受理值同文/同值也走撤销（不是记同值覆盖）。
        // 官方语义：失败提示由下一次编辑或保存清除
        const stage = (key, entry) => {
          setFailed(false);
          setDraft((prev) => {
            const next = { ...(prev ?? {}) };
            if (entry == null) delete next[key];
            else next[key] = entry;
            return Object.keys(next).length > 0 ? next : null;
          });
        };
        const baseText = (f) => (base[f.key] == null ? "" : String(base[f.key]));
        const numBad = (f, d) => f.type === "number" && d != null && d.text.trim() !== "" && !Number.isFinite(Number(d.text));
        const invalid = fields.some((f) => numBad(f, draftOf(f.key)));
        const save = async () => {
          if (!draft || !writable || saving || invalid) return;
          // bool → set；number 空串 → unset、有限数 → set 截断整数（非法草稿挡在
          // invalid）；string 空 → unset、否则 set 原文。unset = 回 schema 默认
          const ops = [];
          for (const f of fields) {
            const d = draftOf(f.key);
            if (!d) continue;
            if (f.type === "bool") ops.push({ op: "set", path: [f.key], value: d.set });
            else if (f.type === "number") {
              const txt = d.text.trim();
              if (txt === "") ops.push({ op: "unset", path: [f.key] });
              else ops.push({ op: "set", path: [f.key], value: Math.trunc(Number(txt)) });
            } else if (d.text === "") ops.push({ op: "unset", path: [f.key] });
            else ops.push({ op: "set", path: [f.key], value: d.text });
          }
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
          const d = draftOf(f.key);
          const dis = !writable || saving;
          return jsxRuntime.jsxs("div", { className: "dshk-cfgp-bfield", children: [
            jsxRuntime.jsxs("div", { className: "dshk-cfgp-bhead", children: [
              jsxRuntime.jsx("span", { className: "dshk-cfgp-blabel", children: t(f.labelKey) }),
              d ? jsxRuntime.jsxs("span", { className: "dshk-cfgp-badges", children: [
                jsxRuntime.jsx(cfgUiPrim.Tag, { tone: "neutral", children: cfgUiT("overridden") }),
                jsxRuntime.jsx("button", { type: "button", className: "dshk-cfgp-reset", disabled: dis, onClick: () => stage(f.key, null), children: cfgUiT("reset") }),
              ] }) : null,
              jsxRuntime.jsx(cfgUiPrim.Switch, {
                checked: d ? d.set : base[f.key] === true,
                label: t(f.labelKey),
                disabled: dis,
                onChange: (next) => stage(f.key, next === (base[f.key] === true) ? null : { set: next }),
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
            text: d ? d.text : baseText(f),
            overridden: d != null,
            invalid: numBad(f, d),
            numeric: f.type === "number",
            disabled: !writable || saving,
            overriddenLabel: cfgUiT("overridden"),
            resetLabel: cfgUiT("reset"),
            invalidLabel: cfgUiT("invalidNumber"),
            onEdit: (txt) => stage(f.key, txt === baseText(f) ? null : { text: txt }),
            onReset: () => stage(f.key, null),
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
            state: { available: true, writable, dirty: draft != null, invalid, saving, failed },
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
    // 组件（分属不同组件包），状态必须跨包跨槽共享：模块级不可变快照 +
    // useSyncExternalStore 订阅（getSnapshot 返回模块绑定值，恒定引用直到 set 替换）。
    // 功能存在性（open 位）与激活位（activeFeature）分离：打开某功能 = 确保签
    // 存在并激活，切走不丢状态（diff/知识库的文档签状态在 kitUi 里，官方 dock
    // 签关掉再开即恢复）。files 与 vaultPages 同构（浏览器式：顶部一条标签条 +
    // 下面若干内容页）——一页一标签、点击切换、✕ 单关；源代码管理/提交图谱点开
    // 都往 files 标签条里加标签，同路径复用一个（重开刷新 diff/未跟踪状态）。
    // 文件树与对话区点击已改投官方右栏文件签，不进这里。diff 签非激活仍挂载
    // （display:none）保住滚动位置，超内部上限（3）自动关最久没看的那张。
    let kitUi = { treeOpen: false, gitOpen: false, vaultIdxOpen: false, files: [], activeFile: null, terminals: [], activeTermId: null, termDockOpen: false, browserOpen: false, schedOpen: false, vaultOpen: false, vaultPages: [], activeVaultPage: null, activeFeature: null };
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

    /** diff 签内部上限（不外露为设置项——签只来自 SCM/提交图谱，堆积面小）：
     *  超限自动关最久没看的那张 */
    const PREVIEW_MAX = 3;
    /** 打开文件 = 文件签条上加一个文件标签（已开过则复用、只刷新状态并激活）。
     *  usedAt 是 LRU 判据（超上限时关掉最久没看的那张，绝不含本次）；
     *  deleted=已删除文件，只承载删除 diff。commit（可选）= 提交钉定模式
     *  （图谱提交详情进入，diff 视图与该提交的第一父对比）；重开同路径时
     *  commit 随入口刷新（从 SCM 更改列表重开即清除钉定） */
    function openFileTab(ui, path, from, untracked, deleted, commit) {
      const now = Date.now();
      const commitRef = typeof commit === "string" && commit !== "" ? commit : undefined;
      const items = ui.files ?? [];
      let list = items.some((x) => x.path === path)
        ? items.map((x) => (x.path === path ? { ...x, from: from ?? x.from, untracked: untracked === true, deleted: deleted === true, commit: commitRef, usedAt: now } : x))
        : [...items, { path, from: from ?? "scm", untracked: untracked === true, deleted: deleted === true, commit: commitRef, usedAt: now }];
      const max = PREVIEW_MAX;
      while (list.length > max) {
        let oldest = null;
        for (const x of list) {
          if (x.path !== path && (oldest === null || x.usedAt < oldest.usedAt)) oldest = x;
        }
        if (oldest === null) break;
        list = list.filter((x) => x.path !== oldest.path);
      }
      return { files: list, activeFile: path, activeFeature: "file" };
    }
    /** 只激活一个文件标签（标签条点击走这里）：刷新 usedAt（LRU 判据是「最久没看
     *  的那张」），不重设 diff/未跟踪状态——那是入口（openFileTab）的事 */
    function activateFileTab(ui, path) {
      const items = ui.files ?? [];
      if (!items.some((x) => x.path === path)) return {};
      const now = Date.now();
      return { files: items.map((x) => (x.path === path ? { ...x, usedAt: now } : x)), activeFile: path, activeFeature: "file" };
    }
    /** 关一个文件标签：激活位顺延邻居；关光了整片文件区收摊（走 closeFeatureTab，
     *  激活位顺延到余下的存在标签） */
    function closeFileTab(ui, path) {
      const items = ui.files ?? [];
      const idx = items.findIndex((x) => x.path === path);
      if (idx < 0) return {};
      const rest = items.filter((x) => x.path !== path);
      if (rest.length === 0) return { ...closeFeatureTab(ui, "file"), files: [], activeFile: null };
      const patch = { files: rest };
      if (ui.activeFile === path) patch.activeFile = rest[Math.min(idx, rest.length - 1)].path;
      return patch;
    }

    // ── 知识库页标签（多开：与文件标签同款交互）──
    // 一页一标签、点击切换、✕ 单关；vaultOpen 是「知识库这一片有没有」，
    // 没有任何页标签时它承载一张「请选择页面」空签（入口点开即见右栏签，打开时
    // 中间页面也要相应打开）。
    /** 路径尾名（标签名用）：文件保留后缀，知识库页去掉 .md（与索引树的页名一致） */
    const baseName = (p) => String(p ?? "").split(/[\\/]/).pop() ?? "";
    const pageBasename = (p) => baseName(p).replace(/\.(md|markdown)$/i, "");
    /** 开/激活一个知识库页标签（树/搜索/反链/闲聊路径/wikilink 点击都走这里） */
    function openVaultPageTab(ui, path) {
      const pages = ui.vaultPages ?? [];
      const list = pages.includes(path) ? pages : [...pages, path];
      return {
        vaultPages: list,
        activeVaultPage: path,
        vaultOpen: true,
        activeFeature: "vault",
      };
    }
    /** 只激活（标签条点击走这里） */
    function activateVaultPage(ui, path) {
      if (!(ui.vaultPages ?? []).includes(path)) return {};
      return { vaultPages: ui.vaultPages, activeVaultPage: path, vaultOpen: true, activeFeature: "vault" };
    }
    /** 关一个知识库页标签：激活位顺延邻居；关光了则整片知识库区收摊
     *  （索引视图不跟着关——那是侧栏的事，输入行入口管它） */
    function closeVaultPageTab(ui, path) {
      const pages = ui.vaultPages ?? [];
      const idx = pages.indexOf(path);
      if (idx < 0) return {};
      const rest = pages.filter((p) => p !== path);
      // 关光了走 closeFeatureTab：清 vaultOpen 的同时把激活位顺延到别的标签
      if (rest.length === 0) {
        return { ...closeFeatureTab(ui, "vault"), vaultPages: [], activeVaultPage: null };
      }
      const patch = { vaultPages: rest };
      if (ui.activeVaultPage === path) patch.activeVaultPage = rest[Math.min(idx, rest.length - 1)];
      return patch;
    }
    /** 关一个功能签：清存在性；关的是激活签时激活位顺延剩余签 */
    function closeFeatureTab(ui, tab) {
      const patch = {};
      if (tab === "file") {
        patch.files = [];
        patch.activeFile = null;
      } else if (tab === "schedule") patch.schedOpen = false;
      else if (tab === "vault") {
        patch.vaultOpen = false;
        patch.vaultPages = [];
        patch.activeVaultPage = null;
      } else patch.browserOpen = false;
      if (ui.activeFeature === tab) {
        const remaining = [];
        if (tab !== "file" && (ui.files?.length ?? 0) > 0) remaining.push("file");
        if (tab !== "schedule" && ui.schedOpen) remaining.push("schedule");
        if (tab !== "vault" && ui.vaultOpen) remaining.push("vault");
        if (tab !== "browser" && ui.browserOpen) remaining.push("browser");
        patch.activeFeature = remaining[0] ?? null;
      }
      return patch;
    }
    /** 打开/激活一个功能签（输入行入口与自动跟随共用）：确保存在并
     *  激活、不清别的标签。浏览器不做抑制（agent 干活必回眼前） */
    function openFeatureTab(ui, tab) {
      if (tab === "schedule") return { schedOpen: true, activeFeature: "schedule" };
      if (tab === "vault") return { vaultOpen: true, activeFeature: "vault" };
      return { browserOpen: true, activeFeature: "browser" };
    }

    /** 功能 → dock 签映射（页类型注册表；kind 即 openTab 用的类型名） */
    const RB_FEATURES = [
      { id: "dsh-kit-file", kind: "dshk-file", feature: "file", titleKey: "fileTabLabel" },
      { id: "dsh-kit-vault", kind: "dshk-vault", feature: "vault", titleKey: "vaultTitle" },
      { id: "dsh-kit-schedule", kind: "dshk-schedule", feature: "schedule", titleKey: "schedTab" },
      { id: "dsh-kit-browser", kind: "dshk-browser", feature: "browser", titleKey: "dockBrowser" },
    ];
    /** sidebarRight 服务实例（openTab 用）：apply 时 ctx.inject(["sidebarRight"])
     *  捕获——服务属性不能直接读（`cannot get property without inject`），又不能
     *  写进 exports.inject（0.1.2 无此服务，硬声明整插件起不来） */
    let rightbarSr = null;
    /** 服务实例读取（文件地址拼装等消费方在别的包，直接导出访问器） */
    function getRightbarSr() {
      return rightbarSr;
    }

    /** 打开/聚焦右栏 dock 签（UI 事件路径）。服务未就绪或宿主不支持时静默放弃
     *  ——调用方都已先走了 kitUi 侧的开签补丁，签内容状态不会丢 */
    function openRightbarTab(feature) {
      const sr = rightbarSr;
      if (!sr || typeof sr.openTab !== "function") return;
      const f = RB_FEATURES.find((x) => x.feature === feature);
      if (!f) return;
      try {
        sr.openTab(f.kind);
      } catch {
        /* 右栏异常不拖垮入口动作 */
      }
    }
    /** 关掉右栏的某类 dock 签（官方 close API：按 kind 在 mounted surface 的
     *  layout 签表里找到 id 再关）。服务未就绪或签不在时静默——调用点都在
     *  「签该消失」的语义位（最后一页文档签关掉 / 浏览器没了） */
    function closeRightbarTab(feature) {
      const sr = rightbarSr;
      const f = RB_FEATURES.find((x) => x.feature === feature);
      if (!sr || !f || typeof sr.close !== "function") return;
      try {
        // mounted() 返回 surface {layout, history, minted}——签表在 layout.tabs
        const surface = typeof sr.mounted === "function" ? sr.mounted() : undefined;
        const tabsMap = surface && surface.layout ? surface.layout.tabs : undefined;
        const tab = tabsMap ? Object.values(tabsMap).find((x) => x && x.kind === f.kind) : null;
        if (tab && tab.id !== undefined) sr.close(tab.id);
      } catch {
        /* 右栏异常不拖垮入口动作 */
      }
    }
    /** 「开功能签」：dock 签交给官方 openTab；kitUi 只补存在性（入口按钮选中态 /
     *  角标 / 浏览器自动跟随判定还要读它）。服务未就绪时只剩存在性补丁 */
    function openFeatureDock(ui, feature) {
      openRightbarTab(feature);
      return openFeatureTab(ui, feature);
    }

    /** 打开 diff 签并确保「文件」dock 签在眼前（源代码管理/提交图谱统一入口；
     *  文件树与对话区点击已改投官方右栏文件签，不再进这里） */
    function openFileAndDock(path, from, untracked, deleted, commit) {
      setKitUi(openFileTab(kitUi, path, from, untracked === true, deleted === true, typeof commit === "string" && commit !== "" ? commit : undefined));
      openRightbarTab("file");
    }

    /** 单槽互斥补丁：view = 'tree' | 'scm' | 'vault' | null */
    function sidebarViewPatch(view) {
      return {
        treeOpen: view === "tree",
        gitOpen: view === "scm",
        vaultIdxOpen: view === "vault",
      };
    }

    // ── 多终端会话模型 ──
    // terminals:[{id, sessionId, cwd}] 创建顺序即标签顺序；每个终端在创建那一刻
    // 绑定当时的会话（官方引擎按会话起 PTY，cwd 定在会话工作区，cwd 只剩标签
    // 文案用途）。termDockOpen 只管坞的可见性——隐藏不杀进程，后台标签的 shell
    // 继续跑、xterm 继续缓冲输出；标签 ✕ 才真正结束对应宿主终端。
    let termSeq = 0;
    const makeTerm = (sessionId, cwd) => ({ id: `term-${++termSeq}`, sessionId, cwd });
    /** 入口按钮与 Ctrl+/ 共用：开=恢复视图（无会话则新建绑定当前会话）；关=仅隐藏 */
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
    /** 标签 ✕：从列表移除（组件卸载即断 WS 杀进程），激活位顺延邻居 */
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

    exports.flashToast = flashToast;
    exports.writeClipboard = writeClipboard;
    exports.kitGetJson = kitGetJson;
    exports.kitPostJson = kitPostJson;
    exports.kitJson = kitJson;
    exports.resolveZh = resolveZh;
    exports.subscribeLocale = subscribeLocale;
    exports.getLocaleVersion = getLocaleVersion;
    exports.mainRowOf = mainRowOf;
    exports.createConfigPage = createConfigPage;
    exports.setKitUi = setKitUi;
    exports.subscribeKitUi = subscribeKitUi;
    exports.useKitUi = useKitUi;
    exports.getKitUi = getKitUi;
    exports.PREVIEW_MAX = PREVIEW_MAX;
    exports.openFileTab = openFileTab;
    exports.activateFileTab = activateFileTab;
    exports.closeFileTab = closeFileTab;
    exports.baseName = baseName;
    exports.pageBasename = pageBasename;
    exports.openVaultPageTab = openVaultPageTab;
    exports.activateVaultPage = activateVaultPage;
    exports.closeVaultPageTab = closeVaultPageTab;
    exports.closeFeatureTab = closeFeatureTab;
    exports.openFeatureTab = openFeatureTab;
    exports.RB_FEATURES = RB_FEATURES;
    exports.getRightbarSr = getRightbarSr;
    exports.openRightbarTab = openRightbarTab;
    exports.closeRightbarTab = closeRightbarTab;
    exports.openFeatureDock = openFeatureDock;
    exports.openFileAndDock = openFileAndDock;
    exports.sidebarViewPatch = sidebarViewPatch;
    exports.toggleTermDock = toggleTermDock;
    exports.spawnTerm = spawnTerm;
    exports.killTerm = killTerm;
    exports.makeTerm = makeTerm;
    // 底座是活动 entry：client runner 按 client 插件形状物化本模块，必须带 apply
    //（宿主半边同款：载体 entry，本体无行为）
    exports.apply = async (ctx) => {
      if (typeof ctx?.inject === "function") {
        ctx.inject(["sidebarRight"], (c) => { rightbarSr = c.sidebarRight; });
      }
    };
    return exports;
  },
});
