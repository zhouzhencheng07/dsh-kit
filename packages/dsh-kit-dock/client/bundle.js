// dsh-kit-dock 浏览器半边 —— 组件间共享的 client 底座（手写 bundle，与主包同形态）。
// 组件包在 dsh.client.external 声明本包，factory 里 require("dsh-kit-dock") 取共享面；
// 客户端模块系统按依赖图先物化被依赖者，无需约定加载顺序。
// 本片收纳：kit 端点调用三件套 + 轻提示 + 剪贴板。kitUi 跨槽状态与右栏 pane 契约
// 后续轮迁入。
window.__ModuleLoader__.load({
  id: "dsh-kit-dock",
  factory: (require) => {
    var exports = {};
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // 轻提示样式（本包私有 CSS，materialization 时注入一次）
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent =
        ".dshk-toast{position:fixed;left:50%;bottom:56px;transform:translateX(-50%) translateY(8px);z-index:950;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;padding:8px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);box-shadow:0 4px 16px rgba(0,0,0,.12);opacity:0;pointer-events:none;transition:opacity .15s var(--ds-ease-in-out),transform .15s var(--ds-ease-in-out)}" +
        ".dshk-toast[data-show]{opacity:1;transform:translateX(-50%) translateY(0)}";
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

    exports.flashToast = flashToast;
    exports.writeClipboard = writeClipboard;
    exports.kitGetJson = kitGetJson;
    exports.kitPostJson = kitPostJson;
    exports.kitJson = kitJson;
    exports.resolveZh = resolveZh;
    exports.subscribeLocale = subscribeLocale;
    exports.getLocaleVersion = getLocaleVersion;
    // 底座是活动 entry：client runner 按 client 插件形状物化本模块，必须带 apply
    //（宿主半边同款：载体 entry，本体无行为）
    exports.apply = async () => {};
    return exports;
  },
});
