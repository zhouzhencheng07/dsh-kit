// dsh-kit/vault 浏览器半边渲染级检查：加载真实 root client bundle（kitBase 随 factory
// 执行）后直测组件导出面、本组件行配置页、右栏两张签 + 快捷键与左栏底部入口钮、apply 装配门控
//（行关闭 = 探针 404 = 一个槽都不注册）与宿主半边源哨兵。
// 组件 = 单包内模块（root client 的 exports.vault），无独立 bundle；
// 知识库/日程的行为级渲染检查（VaultRootView/VaultPagePane/ScheduleView/纯函数）
// 仍在根 render-check.cjs（harness 合并 exports.vault 后直测同一份代码）。
// 用法（dsh-kit 根）：node tests\render-check-vault.cjs
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
    querySelectorAll: () => [],
    createElement: () => ({ className: "", textContent: "", dataset: {}, setAttribute: () => {}, removeAttribute: () => {}, remove: () => {}, style: {}, firstElementChild: null, replaceWith: () => {} }),
    head: { appendChild: () => {} },
    body: { classList: { add() {}, remove() {} }, appendChild: () => {}, hasAttribute: () => false },
  };
}
if (!global.window) global.window = { innerWidth: 1600, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isSecureContext: false, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} };
if (!global.location) global.location = { protocol: "http:", host: "127.0.0.1:3081" };
if (!global.MutationObserver) global.MutationObserver = class { observe() {} };
if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} disconnect() {} };
if (!global.CustomEvent) global.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };

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
  if (name === "react-dom") return { createPortal: (children, container, key) => ({ type: "portal", props: { children, container, key }, $$dshk: "portal" }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primStub;
  throw new Error("unexpected dock require: " + name);
};

// 1) 共享底座 + 组件模块：root bundle 真实加载，组件导出面取 exports.vault
const dockExports = loadBundle(__dirname + "/../client/bundle.js", requireMap);
const comps = dockExports.vault;

check("vault 导出 apply（client 插件形状）与 inject 声明 slots", typeof comps.apply === "function" && Array.isArray(comps.inject) && comps.inject[0] === "slots");
check(
  "vault 导出面齐全（索引/页/日程/壳/配置页/路由/入口与侧栏渲染器）",
  typeof comps.VaultView === "function" && typeof comps.VaultRootView === "function" &&
    typeof comps.VaultPaneBody === "function" && typeof comps.SchedulePaneBody === "function" &&
    typeof comps.ScheduleView === "function" && typeof comps.ScheduleTasksPanel === "function" &&
    typeof comps.VaultShell === "function" && typeof comps.VaultFooterEntry === "function" &&
    typeof comps.SidebarVaultIndex === "function" &&
    typeof comps.VaultConfigPage === "function" &&
    typeof comps.onChatOpenFileClick === "function" && Array.isArray(comps.VAULT_CFG_FIELDS),
);

// 2) 配置页：单组（不出页签）、唯一字段是知识库根目录（文本，值取宿主表单）
{
  const fakeForm = { state: { status: "ready", value: { vaultRoot: "D:/notes" }, revision: 5, writable: true }, mutate: async () => true };
  stateSeq = 0;
  stateStore.clear();
  callLog = [];
  const out = comps.VaultConfigPage({ view: "page", form: fakeForm });
  check("VaultConfigPage 渲染无异常且单组不出页签", !!out && typeof out === "object" && !callLog.some((c) => c[1] === primStub.SegmentedTabs));
  const field = callLog.find((c) => c[1] === primStub.SettingsValueField);
  check(
    "唯一字段：知识库根目录（文本、回显受理值、带说明）",
    !!field &&
      field[2].id === "dshk-cfgp-vaultRoot" &&
      field[2].numeric !== true &&
      field[2].text === "D:/notes" &&
      ["知识库根目录（绝对路径）", "Vault root directory (absolute path)"].includes(field[2].label) &&
      typeof field[2].hint === "string" &&
      field[2].hint.length > 0,
  );
  check("summary 视图返回 null（行详情收起态）", comps.VaultConfigPage({ view: "summary", form: fakeForm }) === null);
  check("vCfgFromSnapshot：无快照回默认空串、ready 快照取受理值", comps.vCfgFromSnapshot(null).vaultRoot === "" && comps.vCfgFromSnapshot({ status: "ready", value: { vaultRoot: "D:/v" } }).vaultRoot === "D:/v");
}
  // ── 测验：纯逻辑与浮层的渲染桩检查 ──
  {
    stateSeq = 0;
    stateStore.clear();
    const single = { type: "single", stem: "1+1=?", options: ["一", "二"], answer: "B", explain: "" };
    const item = comps.qzMakeItem(single, "数学/1.1", false);
    check("qzMakeItem：不打乱时展示序即存储序，答案字母映射、来源页随行", item.displayOrder.join("") === "01" && item.displayAnswer === "B" && item.rel === "数学/1.1");
    const judge = { q: { type: "judge", stem: "x", options: [], answer: true }, rel: "", displayOrder: [], displayAnswer: "" };
    const blank = { q: { type: "blank", stem: "y", options: [], answer: [["北京", "帝都"]] }, rel: "", displayOrder: [], displayAnswer: "" };
    check(
      "qzJudge：选择集合全等（部分对算错）、判断布尔、填空命中任一别名",
      comps.qzJudge(item, { choice: "B", judge: null, blanks: [] }) === true &&
        comps.qzJudge(item, { choice: "AB", judge: null, blanks: [] }) === false &&
        comps.qzJudge(judge, { choice: "", judge: true, blanks: [] }) === true &&
        comps.qzJudge(blank, { choice: "", judge: null, blanks: [" 北　京 "] }) === true &&
        comps.qzJudge(blank, { choice: "", judge: null, blanks: ["上海"] }) === false,
    );
    check("qzNorm：全角转半角 + 去空白 + 小写（判题跨端口径）", comps.qzNorm("Ａ Bｃ１") === "abc1");
    check("qzAnswerText/qzStoredAnswerText：展示串按打乱序、存储串按原序", comps.qzAnswerText(item) === "B. 二" && comps.qzStoredAnswerText(single) === "B");
    const pages = [{ rel: "a", questions: [{ id: "1", type: "judge", stem: "x", options: [], answer: true }, { id: "2", type: "single", stem: "y", options: ["p", "q"], answer: "A" }, { id: "3", type: "single", stem: "z", options: [], answer: null }] }];
    const prog = { "1": { streak: 3, mastered: true, updatedMs: 0 } };
    check(
      "qzAnswerable：能答的题 = 有选项有答案的选择 / 有布尔答案的判断 / 至少一空的填空",
      comps.qzAnswerable({ type: "single", options: ["p", "q"], answer: "A" }) === true &&
        comps.qzAnswerable({ type: "single", options: ["p", "q"], answer: "" }) === false &&
        comps.qzAnswerable({ type: "single", options: [], answer: null }) === false &&
        comps.qzAnswerable({ type: "judge", answer: true }) === true &&
        comps.qzAnswerable({ type: "judge", answer: null }) === false &&
        comps.qzAnswerable({ type: "blank", answer: [["北京", "帝都"]] }) === true &&
        comps.qzAnswerable({ type: "blank", answer: null }) === false,
    );
    check(
      "qzQuestionsOf/qzStatOf/qzFilterStatus/qzFilterKinds：范围入口的池子口径（答不了的题不进池不计数）",
      comps.qzQuestionsOf(pages).length === 2 &&
        comps.qzStatOf(comps.qzQuestionsOf(pages), prog).mastered === 1 &&
        comps.qzFilterStatus(comps.qzQuestionsOf(pages), "unmastered", prog).length === 1 &&
        comps.qzFilterKinds(comps.qzQuestionsOf(pages), ["judge"]).length === 1,
    );
    check("qzIsAnswered/qzEmptyAnswer：提交钮的可用判据", comps.qzIsAnswered(single, comps.qzEmptyAnswer(single)) === false && comps.qzIsAnswered(single, { choice: "A", judge: null, blanks: [] }) === true);
    callLog = [];
    check("VaultQuizOverlay：无请求回 null", comps.VaultQuizOverlay() === null);
    comps.qzOpen({ kind: "page", path: "D:/v/数学/1.1.md", title: "1.1" });
    const portal = comps.VaultQuizOverlay();
    check("VaultQuizOverlay：有请求 portal 到 body（key 随请求换）", !!portal && portal.$$dshk === "portal" && portal.props.container === global.document.body);
    comps.qzClose();
    check("qzClose 后浮层回 null", comps.VaultQuizOverlay() === null);
    callLog = [];
    // 渲染桩下 root 未发布：浮层走「载入中」壳（bar + body）不炸
    const shellNode = comps.VaultQuizModal({ req: { kind: "page", path: "D:/v/数学/1.1.md", title: "1.1" } });
    check(
      "VaultQuizModal：渲染桩下出全屏壳（dshk-quiz + body），不因缺数据炸",
      !!shellNode && shellNode.type === "div" && shellNode.props.className === "dshk-quiz" && callLog.some((c) => c[2] && c[2].className === "dshk-quiz-body"),
    );
  }

// 3) apply 装配门控：行关闭（探针 404）= 一个槽都不注册；可用 = 壳 + 右栏两签 +
//    两个配置页 key + 两个座 + 快捷键
async function checkApply() {
  const run = async (available) => {
    const registered = [];
    const slotInjects = [];
    const svcInjects = [];
    const shortcutCmds = [];
    const clickListeners = [];
    const origAdd = global.document.addEventListener;
    global.document.addEventListener = (type, fn, capture) => { clickListeners.push([type, capture === true]); };
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/dsh-kit-vault/config")) {
        if (!available) return { ok: false, status: 404, json: async () => ({ error: "HTTP 404" }) };
        return { ok: true, status: 200, json: async () => ({ vaultRoot: "" }) };
      }
      return { ok: true, status: 200, json: async () => ({ root: "D:/v", folders: [], pages: [], library: null }) };
    };
    const ctx = {
      slots: { register: (seat) => registered.push(seat), inject: (k, cb) => { slotInjects.push(k); cb(); } },
      inject: (deps, cb) => {
        svcInjects.push(deps.join(","));
        if (deps.includes("sidebarRightTabs")) {
          cb({
            sidebarRightTabs: { register: (t) => registered.push(t) },
            effect: (fn) => { fn(); },
            slots: { inject: (k, inner) => { slotInjects.push(k); inner(); }, register: (seat) => registered.push(seat) },
          });
        }
        if (deps.includes("shortcuts")) {
          cb({ shortcuts: { register: (cmd) => { shortcutCmds.push(cmd); return () => {}; }, catalog: null }, effect: (fn) => { fn(); } });
        }
      },
    };
    await comps.apply(ctx);
    global.document.addEventListener = origAdd;
    return { registered, slotInjects, svcInjects, shortcutCmds, clickListeners };
  };
  const off = await run(false);
  check("行关闭（/dsh-kit-vault/config 404）：一个槽、一个服务注入都不发生", off.registered.length === 0 && off.slotInjects.length === 0 && off.svcInjects.length === 0);
  const on = await run(true);
  check("apply 激活不抛错且等 sidebarRightTabs/shortcuts 声明（inject 而非直读）", on.svcInjects.includes("sidebarRightTabs") && on.svcInjects.includes("shortcuts"));
  const keys = on.registered.filter((s) => s && s.name === "plugins.row.config").map((s) => s.key);
  check("配置页挂本组件行（单包单口径 key）", keys.includes("dsh-kit#vault") && keys.length === 1);
  check(
    "右栏两签注册：kind=dshk-vault/dshk-schedule + pane 正文槽位",
    on.registered.some((s) => s && s.kind === "dshk-vault" && s.id === "dsh-kit-vault") &&
      on.registered.some((s) => s && s.kind === "dshk-schedule" && s.id === "dsh-kit-schedule") &&
      on.slotInjects.includes("sidebar.right.pane.tab"),
  );
  check(
    "两张签都是被动签：右栏开始页一律不给条目（入口在左栏：底部那一枚 + 格内 tab 条）",
    !on.registered.some((s) => s && Array.isArray(s.guide)),
  );
  check(
    "对话区那枚知识库入口钮已退场 + 常驻壳挂 shell.overlay（id 稳定）",
    on.registered.every((s) => !(s && s.name === "conversation.input.left")) &&
      on.registered.some((s) => s && s.name === "shell.overlay" && s.id === "dsh-kit-vault"),
  );
  check(
    "入口钮登记进左栏形态切换条（dsh-kit-vault / order 40；整条归 root 渲染，本组件不再自己占槽）",
    dockExports.sideForms.some((e) => e && e.id === "dsh-kit-vault" && e.order === 40 && e.Component === comps.VaultFooterEntry) &&
      !on.slotInjects.includes("sidebar.footer.action"),
  );
  check("对话文件点击路由挂 document capture 监听", on.clickListeners.some((c) => c[0] === "click" && c[1] === true));
  const vaultCmd = on.shortcutCmds.find((c) => c.id === "dsh-kit.vault.toggle");
  check(
    "知识库命令注册进官方 shortcuts（label/别名/Ctrl+Alt+/，region 覆盖 page/editable/terminal）",
    !!vaultCmd && typeof vaultCmd.label() === "string" && Array.isArray(vaultCmd.aliases) &&
      vaultCmd.defaults["web:windows"].code === "Slash" && String(vaultCmd.defaults["web:windows"].modifiers) === "primary,alt" &&
      ["page", "editable", "terminal"].every((r) => vaultCmd.regions.includes(r)) && vaultCmd.modals.length === 0,
  );
  check(
    "dock 签 kind 补登（openRightbarTab/closeRightbarTab 按 feature 查 tabKinds）",
    dockExports.tabKinds.vault.kind === "dshk-vault" && dockExports.tabKinds.schedule.kind === "dshk-schedule",
  );
  check(
    "座对象填好：侧栏那格渲染器（tab 条 + 知识库目录 / 日程待办）+ 文件树行点击改道（命中返回 true）",
    typeof dockExports.vaultView.renderer === "function" && typeof dockExports.vaultRoute.open === "function" &&
      dockExports.vaultRoute.open("D:/not-vault/x.md") === false,
  );
}

// 3.5) 形态切换条上的那一枚（VaultFooterEntry）：seat 在场才画；点了 = 那一格占住并
//      落在知识库 tab（与快捷键同语义），再点回官方会话列表；名字/键帽走悬停气泡
{
  const walk = (node, pred, out = []) => {
    if (!node || typeof node !== "object") return out;
    if (pred(node)) out.push(node);
    const kids = node.props ? node.props.children : undefined;
    for (const ch of Array.isArray(kids) ? kids : kids === undefined || kids === null ? [] : [kids]) walk(ch, pred, out);
    return out;
  };
  const btnOf = (el) => walk(el, (n) => n.type === "button" && typeof (n.props && n.props.className) === "string" && n.props.className === "dshk-sfbtn")[0] ?? null;
  const renderEntry = () => { stateSeq = 0; stateStore.clear(); callLog = []; return comps.VaultFooterEntry({}); };
  dockExports.setKitUi({ treeOpen: false, gitOpen: false, vaultSideOpen: false, vaultSideTab: "vault" });
  dockExports.rightbarSeat.set(false);
  check("seat 不在场（没选会话 / 全局面板在前台）时不画那一枚", renderEntry() === null);
  dockExports.rightbarSeat.set(true);
  const raw = renderEntry();
  check(
    "那一枚是图标钮：名字与键帽走官方气泡（四枚一行，不出文字）",
    raw.type === dockExports.KitTip && typeof raw.props.label === "string" && raw.props.command === "dsh-kit.vault.toggle" &&
      walk(raw, (n) => n.type === "span").length === 0,
  );
  const vBtn = btnOf(raw);
  check("未占用时 aria-pressed=false", !!vBtn && vBtn.props["aria-pressed"] === false);
  if (vBtn) vBtn.props.onClick();
  check(
    "点它 = 左栏那一格占住并落在知识库 tab（与快捷键同一动作，文件树/SCM 让格）",
    dockExports.getKitUi().vaultSideOpen === true && dockExports.getKitUi().vaultSideTab === "vault" &&
      dockExports.getKitUi().treeOpen === false && dockExports.getKitUi().gitOpen === false,
  );
  if (vBtn) vBtn.props.onClick();
  check("再点一次 = 回官方会话列表（整格开合只有这一处入口）", dockExports.getKitUi().vaultSideOpen === false);
}

// 4) 源哨兵：宿主半边搬进组件目录、主包与 client 摘干净、端点与配置齐备
{
  const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");
  const bundleSrc = read("client/bundle.js");
  // 套件没有根入口模块：查的是「知识库的装配没渗进别的组件行」
  const hostSrc = ["browser", "chat", "files", "logs", "monitor", "phone", "search", "skills", "terminal"]
    .map((d) => read(`src/${d}/index.ts`)).join("\n");
  const compSrc = read("src/vault/index.ts");
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  const sliceBetween = (from, to) => {
    const i = bundleSrc.indexOf(from);
    const j = bundleSrc.indexOf(to, i);
    return i < 0 || j < 0 ? "" : bundleSrc.slice(i, j);
  };

  // 迁移说明注释会提到旧键名，判据只看代码段
  const hostCode = hostSrc.replace(/\/\/[^\n]*/g, "");
  check(
    "别的组件行没有知识库与日程字段，client 默认表 / 字段表也没有",
    !/vault(Enabled|Root)/.test(hostCode) &&
      !bundleSrc.includes("const CFG_DEFAULTS = {") && !bundleSrc.includes("const KIT_CFG_FIELDS = [") &&
      !bundleSrc.includes("kcfgVaultEnabled"),
  );
  check(
    "别的组件行不装配知识库与日程（无 scanner / vault-fs / schedule / 端点）",
    !hostCode.includes("VaultScanner") && !hostCode.includes("createEntry") && !hostCode.includes("syncScheduleStore") &&
      !hostCode.includes("/dsh-kit/vault/") && !hostCode.includes("/dsh-kit/schedule/"),
  );
  check(
    "阅读面的第三方库路由归知识库行注册（pdf.js / TipTap / mermaid / KaTeX + fonts 前缀），不夹带别家的资源",
    compSrc.includes("registerVendorFiles") && compSrc.includes("registerVendorSubdir") &&
      ["/dsh-kit/vendor/pdf.min.mjs", "/dsh-kit/vendor/pdf.worker.min.mjs", "/dsh-kit/vendor/richeditor.bundle.js", "/dsh-kit/vendor/mermaid.min.js", "/dsh-kit/vendor/katex.min.js", "/dsh-kit/vendor/katex.min.css"].every((u) => compSrc.includes("['" + u + "',")) &&
      compSrc.includes("'/dsh-kit/vendor/fonts'") && !/xterm[.]js|qrcode[.]js/.test(compSrc),
  );
  // 代码盒正文可编辑的命门：node view 的 ignoreMutation 判据必须收在「控件区」——
  // 写成「contentDOM 之外的都忽略」会把浏览器删空代码块时摘 <code> 的结构改动一起吞掉，
  // 文档停在旧内容、此后打字只改 DOM 不进文档（重开回到旧内容）
  const vendorSrc = read("client/vendor/richeditor.bundle.js");
  const barVar = (vendorSrc.match(/(\w+)\.className="dshk-codebar"/) || [])[1];
  check(
    "代码盒 node view 只挡控件（ignoreMutation 判据 = 语言条/复制钮，正文与结构改动全放行）",
    !!barVar &&
      new RegExp(`ignoreMutation\\(\\w+\\)\\{return ${barVar}\\.contains\\(\\w+\\.target\\)\\}`).test(vendorSrc) &&
      !/ignoreMutation:\(\)=>!0,update\(\w+\)\{return \w+\.type\.name!=="codeBlock"/.test(vendorSrc),
  );
  // code 是 contentDOM，多行文本必须块级：行内排版时 Chromium 删空代码块会摘掉空的 <code>，
  // node view 与文档失步。这条 CSS 关掉的是触发点，上面的判据是失步后的兜底
  check(
    "代码盒正文块级排版（pre code{display:block}）",
    /\.dshk-codebox pre code\{display:block\}/.test(bundleSrc),
  );
  // 语法高亮装饰只落 .hljs-* 类名：色板归面板层（浅色 + 宿主深色主题两套）
  check(
    "语法高亮色板在面板层（.hljs-* 浅色一套 + 宿主深色主题一套）",
    /\.dshk-codebox \.hljs-keyword,/.test(bundleSrc) &&
      /\.dshk-codebox \.hljs-string,/.test(bundleSrc) &&
      /body\[data-ds-dark-theme\] \.dshk-codebox \.hljs-keyword,/.test(bundleSrc) &&
      /body\[data-ds-dark-theme\] \.dshk-codebox \.hljs-string,/.test(bundleSrc),
  );
  // 树行图标不参与 flex 收缩：窄面板 + 长名字会把 svg 图标按内容宽度分摊压小
  check(
    "树行图标 flex:none（窄面板不压小图标，收缩全走名字省略号）",
    /\.dshk-vault-treerow>svg\{flex:none\}/.test(bundleSrc),
  );
  // 斜杠命令落地后的还焦点必须同步（PM 原生 view.focus）：TipTap focus 命令把真聚焦
  // 排到下一帧，点菜单项时焦点已落回面板容器、编辑器处于失焦态，那一帧聚焦会抢走
  // wiki 选择框搜索框 / 公式输入框刚拿到的焦点——框弹了也等于没输入口
  const menuBody = sliceBetween("const applyMenuTemplate", "const rteCmd");
  check(
    "斜杠命令落地同步还焦点（ed.view.focus，不走下一帧才聚焦的 TipTap 命令）",
    /ed\.view\.focus\(\)/.test(menuBody) && !/\bh\.focus\(\)/.test(menuBody),
  );
  // 泡泡菜单的「引用到对话」走树行 @ 同一条管线（citeVaultPageToChat），选区现读
  // 编辑器状态而不是选区镜像（镜像为树行跨组件引用而生，编辑面里点按钮那一刻
  // 选区就攥在手里）；空选区兜底给空串
  const bubCiteBody = sliceBetween("const bubCite = () => {", "const BUB_COLORS");
  check(
    "泡泡菜单挂「引用到对话」（现读编辑器选区走引用管线，成功收泡泡）",
    bundleSrc.includes('title: t("vtbCite"), onClick: bubCite') &&
      /citeVaultPageToChat\(docKey, selText,/.test(bubCiteBody) &&
      /vaultSelectionText\(h\.editor\)/.test(bubCiteBody) &&
      /setBub\(null\)/.test(bubCiteBody),
  );
  // 树行 @ 的选区镜像与泡泡同一条取文本口径：编辑器状态优先（DOM 文本在表格多格
  // 会多出一倍空行、原子节点整块丢），编辑器选区不可用才退回 DOM 文本
  check(
    "树行 @ 的选区镜像走编辑器状态（原子节点按 md 写法补回）",
    /vaultSelectionText\(handle\.editor\)/.test(bundleSrc) && /vaultCiteText\(draft, selText\)|vaultCiteText/.test(bundleSrc),
  );
  // 双链选择框一次搜出页面与标题：标题随索引走（宿主提取 ATX，frontmatter/围栏/
  // #标签 都不算），客户端页行/标题行并成一列混排；| 后写别名不进搜索，
  // 标题行插 [[页#标题|别名]]（锚点 = 标题原文，与编辑器解析同口径才能滚到位）
  const scannerSrc = read("src/vault/scanner.ts");
  const pickBody = sliceBetween("const pickRowsOf = (query) => {", "const openPick = () => {");
  check(
    "双链选择框搜页面+标题：宿主索引带标题（extractHeadings），客户端页行/标题行混排与 | 别名",
    scannerSrc.includes("export function extractHeadings") &&
      scannerSrc.includes("heads: extractHeadings(content)") &&
      /p\.heads \?\? \[\]/.test(pickBody) &&
      /kind: "head"/.test(pickBody) &&
      /score: score \+ 6/.test(pickBody) &&
      bundleSrc.includes("pickSplit(pick?.query).alias"),
  );
  // 资料行（实物在库的挂载项）与页行同形：hover = @ + ⋯；悬挂条目没有真实路径
  // 可引，条件展开不给 @（渲染桩会把 null 记进 children 数组，别留空位）
  const refRowBody = sliceBetween("const refRow = (rel, dirPath, depth) => {", "const dirRow =");
  check(
    "资料行 hover = @ + ⋯（复用 citeFromTree；悬挂条目不给 @）",
    /citeFromTree\(item\.path\)/.test(refRowBody) &&
      refRowBody.includes("...(!missing ? [") &&
      refRowBody.indexOf("citeFromTree") < refRowBody.indexOf('label: t("treeMenu")'),
  );
  check(
    "组件入口自持端点与配置（日程不注册 agent 工具）",
    compSrc.includes("name = 'dsh-kit/vault'") && compSrc.includes("syncScheduleStore()") &&
      !compSrc.includes("defineTool") && !compSrc.includes("buildScheduleTools") &&
      compSrc.includes("/dsh-kit-vault/config") && compSrc.includes("/dsh-kit/vault/index") &&
      compSrc.includes("/dsh-kit/schedule/data") && compSrc.includes("vaultRoot"),
  );
  check(
    "root 的 open/closeRightbarTab 按 tabKinds 座查 kind（组件行不靠静态 RB_FEATURES）",
    bundleSrc.includes("const f = tabKinds[feature];") && bundleSrc.includes("const tabKinds = {};") && bundleSrc.includes("exports.tabKinds = tabKinds;"),
  );
  check(
    "知识库/日程 client 半边整体收进 vaultModule（root 侧只剩座与跨槽状态）",
    bundleSrc.includes("const vaultModule = (kit, require) => {") &&
      bundleSrc.includes("exports.vault = vaultModule(exports, require);") &&
      bundleSrc.includes("exports.vaultView = { renderer: null }") &&
      bundleSrc.includes("exports.vaultRoute = { open: null }"),
  );
  check("组件行声明 + exports 子路径 + locale 齐备", patchSrc.includes("name: dsh-kit/vault") && !!pkg.exports["./vault"] && !!pkg.exports["./vault/locale/*.json"]);
  check(
    "组件行中文名与描述在 locale/vault（宿主按行 name 全串解析）",
    read("locale/vault/zh.json").includes("知识库 · 日程") && read("locale/vault/en.json").includes("Knowledge base · Schedule"),
  );
  // 卡片文案是给用户看的承诺：退役的能力不能再挂在上面（日程工具已改成技能池技能）
  check(
    "行卡片文案不承诺已退役的日程 agent 工具（卡片里不出现 schedule_*）",
    !read("locale/vault/zh.json").includes("schedule_") && !read("locale/vault/en.json").includes("schedule_"),
  );
  // 字段表与宿主 Config schema 同源（改必须两处同改，漂移即红）
  // 只取键名：vaultRoot 的默认值是表达式（defaultVaultRoot()），值比对由根 render-check 管
  const schemaKeys = [...compSrc.matchAll(/^ {8}(\w+): z\.(?:boolean|number|string)\(\)/gm)].map((m) => m[1]);
  const fieldKeys = comps.VAULT_CFG_FIELDS.map((f) => f.key);
  check(
    "配置页字段表与宿主 schema 同源（" + schemaKeys.length + " 项）",
    schemaKeys.length === fieldKeys.length && schemaKeys.every((k) => fieldKeys.includes(k)),
  );
  // ── 测验：契约钉在宿主半边，入口与浮层钉在 client 半边 ──
  const quizSrc = read("src/vault/quiz.ts");
  const quizFsSrc = read("src/vault/fs.ts");
  check(
    "宿主测验端点九件套 + 伴生文件跟随（改名/移动/删除/覆盖带走 .quiz）",
    compSrc.includes("/dsh-kit/vault/quiz-scope") && compSrc.includes("/dsh-kit/vault/quiz-progress") &&
      compSrc.includes("/dsh-kit/vault/quiz-revision") && compSrc.includes("/dsh-kit/vault/quiz-save") &&
      compSrc.includes("/dsh-kit/vault/quiz-record") && compSrc.includes("/dsh-kit/vault/quiz-mark") &&
      compSrc.includes("/dsh-kit/vault/quiz-forget") && compSrc.includes("/dsh-kit/vault/quiz-threshold") &&
      quizFsSrc.includes("followPage") && quizFsSrc.includes("siblingsForDelete") && quizFsSrc.includes("discard(root, "),
  );
  check(
    "测验跨端契约哨兵：.quiz 布局、内容哈希 id（sha256 前 16 位）、归一化空白表、掌握度键序确定",
    quizSrc.includes("QUIZ_DIR = '.quiz'") && quizSrc.includes("STATE_DIR = '.quiz-state'") &&
      quizSrc.includes("PROGRESS_SUFFIX = '.progress.json'") && quizSrc.includes("CONFLICT_MARK") &&
      quizSrc.includes("createHash('sha256')") && quizSrc.includes("slice(0, 16)") &&
      quizSrc.includes("WS_RE") && quizSrc.includes("sortedProgress"),
  );
  check(
    "测验浮层挂常驻壳 + 页条/树菜单两个入口",
    bundleSrc.includes("jsxRuntime.jsx(VaultQuizOverlay, {})") &&
      bundleSrc.includes("jsxRuntime.jsx(VaultQuizEntry, { path, root, active })") &&
      /key: "qz", label: t\("qzEntry"\)/.test(bundleSrc) &&
      bundleSrc.includes('"/dsh-kit/vault/quiz-record"') && bundleSrc.includes('"/dsh-kit/vault/quiz-save"'),
  );
  // 测验浮层自己认 Esc：设置 / 作答 / 小结三个阶段都关（不整层关的那一层是「编辑题目」，
  // 那是带未保存内容的输入面，退出走 ✕）
  check(
    "测验浮层 Esc：设置 / 作答 / 小结都关，编辑题目那层不整层关",
    /if \(e\.key === "Escape"\) \{\s*\n\s*if \(stage === "edit"\) return;/.test(bundleSrc) &&
      /if \(stage !== "session"\) return;/.test(bundleSrc),
  );
  const quizEntryBody = sliceBetween("function VaultQuizEntry({ path, root, active }) {", "function VaultQuizOverlay() {");
  check(
    "页条测验入口：徽标 = 已掌握/能答题数（fetch 题目与掌握度、全掌握标绿）",
    quizEntryBody.includes("quiz-progress?") && quizEntryBody.includes("filter(qzAnswerable)") &&
      quizEntryBody.includes("qzIsMastered(prog, x.id)") && quizEntryBody.includes("dshk-quiz-done") &&
      bundleSrc.includes("exports.qzAnswerable = qzAnswerable;"),
  );

  // ── 首页签（右栏第三张）：注册三处 + 工具条入口 + enterDir 通道 + 组件哨兵 ──
  const homePaneSrc = sliceBetween("function HomePagePane() {", "─────────── 本组件生效配置");
  check(
    "首页签注册三处（RB_TABS / RB_BODY / tabKinds 补登）+ 工具条入口开签",
    bundleSrc.includes('{ id: "dsh-kit-home", kind: "dshk-home", feature: "home", titleKey: "homeTab" }') &&
      bundleSrc.includes("home: HomePagePane") &&
      bundleSrc.includes('dock.tabKinds.home = { id: "dsh-kit-home", kind: "dshk-home" }') &&
      bundleSrc.includes('openRightbarTab("home")'),
  );
  check(
    "首页签数据面：自取索引 + 每集 quiz-scope/progress 汇总 + 浮层关闭重拉（不挂轮询）",
    homePaneSrc.includes('kitJson("/dsh-kit/vault/index"') &&
      homePaneSrc.includes('"/dsh-kit/vault/quiz-scope?"') && homePaneSrc.includes('"/dsh-kit/vault/quiz-progress?"') &&
      homePaneSrc.includes("qzStatOf(qzQuestionsOf(") &&
      homePaneSrc.includes("if (req === null) setNonce"),
  );
  check(
    "首页行联动左栏：知识集行 enterDir（reader 通道）+ 页行 openPath；条数常量与桌面同款",
    bundleSrc.includes("enterDir: openHere") &&
      homePaneSrc.includes("reader.enterDir") && homePaneSrc.includes("reader.openPath") &&
      bundleSrc.includes("HOME_SETS_LIMIT = 8") && bundleSrc.includes("HOME_RECENT_LIMIT = 8"),
  );

  // ── 树头动作平铺 + 资料段／添加资料同归属（只看树根）──
  check(
    "树头三钮平铺（新建/添加资料/导入）：添加资料跟树根认集、导入直开，单项 ⋯ 菜单退役",
    bundleSrc.includes("const headKs = ksRefsOf(treeRoot) !== null ? treeRoot : ksAncestorOf(treeRoot);") &&
      bundleSrc.includes("startAdding(headKs)") &&
      bundleSrc.includes("openImport(treeRoot, isLibPath(treeRoot))") &&
      !bundleSrc.includes("openHeadMenu"),
  );
  check(
    "树顶资料段与添加资料同一归属（headKs，只看树根；读笔记不再浮别处的资料）",
    bundleSrc.includes("const ksCurrentAbs = headKs;") &&
      bundleSrc.includes("const ksCurrentRefs = headKs === null ? null : ksRefsOf(headKs) ?? [];") &&
      !bundleSrc.includes("ksStartRels"),
  );
}

(async () => {
  await checkApply();
  console.log(failed === 0 ? "ALL RENDER OK (vault)" : "FAILED: " + failed);
  process.exit(failed === 0 ? 0 : 1);
})();
