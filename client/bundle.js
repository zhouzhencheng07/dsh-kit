// dsh-kit 浏览器半边 —— 手写 client bundle，与官方 lib/client.js 产物同形，
// 无构建步骤：改完本文件刷新浏览器即生效（本地目录 junction 直装）。
//
// 结构：
//   入口：conversation.input.left（composer 工具行，文件树/源代码管理/知识库/
//     终端四个小图标钮，工作区级工具跟 session 走）。知识库钮是开合切换：开 =
//     侧栏索引视图，再点 = 侧栏回会话列表；日程没有 composer 钮（日程只有一个
//     家：右栏 dock 签，入口归右栏开始页条目与待办卡，2026-09-11 用户定稿，
//     侧栏待办索引与专属快捷键一并退役）。
//   右栏（唯一工作台形态，宿主 0.1.5+）：sidebarRightTabs 注册五类 dock 签，
//     pane 正文经 slots.inject（sidebar.right.pane.tab）按 id 提供，pane 内自管
//     文档签条。dock 签本身没有按钮：文件/知识库是被动签（索引/对话链接点开
//     即开），任务/日程/浏览器走右栏开始页清单与自动跟随。开始页保留官方
//     ShippedGuide（罗盘 + 胶囊条目），我们只贡献 guide 条目：日程/浏览器/
//     后台任务三枚（文件/知识库是被动签，不给条目），官方「文件」条目垫底。
//     自建舞台与宽度模型 2026-09-12 整体退役（宿主基线 0.1.5-rc.2 起不再需要
//     回退路径）：缺 sidebarRight 服务时只剩 kitUi 侧的存在性补丁——入口按钮
//     不报错，签由官方侧自己决定要不要出现。
//   终端：底部停靠面板（快捷键亦可切换），数据走宿主半边 /dsh-kit/terminal WS。
//   功能存在性（kitUi）：files/activeFile 与 vaultPages/activeVaultPage+vaultHist
//     是文档签与访问序；jobsOpen/schedOpen/browserOpen/vaultOpen 是功能签在场
//     （入口按钮选中态与角标读它）；activeFeature 是当前激活的功能（Esc 关哪张
//     文档签、浏览器自动跟随的判据）。索引类视图（知识库目录树）住侧栏
//     sidebar.workspaces 单槽，点条目开对应右栏签。
//   文件树：打开时临时注册进单槽 sidebar.workspaces——把侧边栏浏览区整体换成
//     文件树，关闭时 dispose 注销、原生工作区列表自动回归。根目录 = 当前会话工作
//     目录，数据走宿主半边 /dsh-kit/tree。点击文件 → 右栏文件签展示/编辑内容，
//     数据走宿主半边 /dsh-kit/read；PDF 走 /dsh-kit/raw 原始字节端点（Range/206），
//     pdf.js（vendor 懒加载）逐页 canvas 渲染——Edge 内置查看器对 http:// 源
//     灰屏，不可依赖。
// xterm 不打进 bundle，由宿主半边伺服 /dsh-kit/vendor/* 静态资源（官方预编译
// UMD），首次打开终端面板时按需加载。
//
// 外观跟随：面板 chrome 全部用 --dsw-alias-* 令牌（随 DSH 明暗主题自动切换）；
// xterm 需要具体色值，从 body 的 data-ds-dark-theme 属性判断明暗，
// 再读令牌的 computed 值做背景/前景，ANSI 用明/暗两套通用标准调色板，
// 并用 MutationObserver 监听属性变化热更新。
//
// 让位布局：打开终端时给 body 挂 dshk-open 类 + 根节点设 --dshk-dock-h，
// 样式规则把中列（对话）padding-bottom 顶开终端高度——对话窗口不被遮挡；
// 面板宽度也跟随对话列。类名匹配用语义后缀 _centerCol
// （全站仅 dsh-client-ui-layout 使用，已核实唯一）。
window.__ModuleLoader__.load({
  id: "dsh-kit",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let jsxRuntime = require("react/jsx-runtime");
    let reactDom = require("react-dom");

    // ─────────── 官方 primitives 图标复用（用户定稿 2026-09-11：能复用就不自绘）───
    // primitives 随宿主前端注册进 ModuleLoader（官方各 client lib 同款 require）；
    // 取不到（0.1.2 老宿主/异常环境）时各图标回退自绘版本，不挡启动。
    let dswPrimIcons = null;
    try { dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives"); } catch { /* 回退自绘 */ }
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons ? dswPrimIcons[n] : null;
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    /** 终端面板高度（与让位 padding 共用一个变量） */
    const DOCK_H = "min(34vh, 330px)";

    /** apply 时捕获的 ctx；KitSurfaces 用它动态 register/dispose sidebar.workspaces 单槽 */
    let slotsCtx = null;

    // ─────────── 跨槽开合状态 ───────────
    // 入口按钮（composer 工具行）与右栏 pane 宿主是多个
    // 独立槽位组件，状态必须跨槽共享：模块级不可变快照 + useSyncExternalStore 订阅
    // （getSnapshot 返回模块绑定值，恒定引用直到 set 替换）。
    // 功能存在性（open 位）与激活位（activeFeature）分离：打开某功能 = 确保签
    // 存在并激活，切走不丢状态（文件/知识库的文档签状态在 kitUi 里，官方 dock
    // 签关掉再开即恢复）。files 与 vaultPages 同构（浏览器式：顶部一条标签条 +
    // 下面若干内容页）——一页一标签、点击切换、✕ 单关；文件树/源代码管理/对话
    // 链接点开都往这条标签条里加标签，同路径复用一个（重开刷新 diff/未跟踪状态）。
    // 文件非激活仍挂载（display:none）保住滚动与未落盘草稿，超「文件标签数上限」
    // 自动关最久没看的那张；vaultHist 是知识库 ← → 的访问序（与标签存在性解耦）。
    let kitUi = { treeOpen: false, gitOpen: false, vaultIdxOpen: false, files: [], activeFile: null, terminals: [], activeTermId: null, termDockOpen: false, jobsOpen: false, browserOpen: false, schedOpen: false, vaultOpen: false, vaultPages: [], activeVaultPage: null, vaultHist: { stack: [], idx: -1 }, activeFeature: null };
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

    /** agent 动浏览器 → 把右栏浏览器签拽到眼前（壳层常驻事件源与面板共用此入口）。
     *  无抑制标志（用户定稿 2026-09-10：agent 操作浏览器为安全起见必须可见——
     *  人为关掉/隐藏的浏览器签，agent 下次导航照样弹回） */
    function maybeAutoOpenBrowser() {
      if (kitUi.activeFeature === "browser" && kitUi.browserOpen === true) return;
      setKitUi(openFeatureDock(kitUi, "browser"));
    }
    /** 浏览器没了（优雅关闭/空闲自动关/整只崩溃/页崩光）→ 收掉官方浏览器签
     *  （sidebarRight.close）：正常浏览器语义「没了就没了」，agent 下次开页面板
     *  照常弹回 */
    function closeBrowserDockForGone() {
      if (!kitUi.browserOpen) return;
      closeRightbarTab("browser");
      setKitUi(closeFeatureTab(kitUi, "browser"));
    }

    const PREVIEW_MAX_DEFAULT = 3;
    /** 文件标签上限（设置卡可配 1-20；快照未就绪回落默认 3，与 CFG_DEFAULTS
     *  同值）——标签条上最多同时开几个文件标签，再开新的就关掉最久没看的那张 */
    function previewLimit() {
      const v = cfgFromSnapshot(getCfgSnapshot()).previewMaxTabs;
      return Math.max(1, Number.isInteger(v) ? v : PREVIEW_MAX_DEFAULT);
    }
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
        : [...items, { path, from: from ?? "tree", untracked: untracked === true, deleted: deleted === true, commit: commitRef, usedAt: now }];
      const max = previewLimit();
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

    // ── 知识库页标签（多开，2026-09-10 用户定稿：与文件标签同款交互）──
    // 一页一标签、点击切换、✕ 单关；vaultOpen 是「知识库这一片有没有」，
    // 没有任何页标签时它承载一张「请选择页面」空签（入口点开即见右栏签，用户
    // 定稿「打开时中间页面也要相应打开」）。vaultHist 是 ← → 的访问序，与标签
    // 存在性解耦：标签被关掉的历史项在关闭时剪掉。
    /** 路径尾名（标签名用）：文件保留后缀，知识库页去掉 .md（与索引树的页名一致） */
    const baseName = (p) => String(p ?? "").split(/[\\/]/).pop() ?? "";
    const pageBasename = (p) => baseName(p).replace(/\.(md|markdown)$/i, "");
    function vaultHistPush(h, path) {
      const stack = (h?.stack ?? []).slice(0, (h?.idx ?? -1) + 1);
      if (stack[stack.length - 1] !== path) stack.push(path);
      return { stack, idx: stack.length - 1 };
    }
    /** 剪掉已关闭页的历史项；激活位按剪后的长度夹紧 */
    function vaultHistPrune(h, gone) {
      const stack = (h?.stack ?? []).filter((p) => !gone.has(p));
      return { stack, idx: Math.max(-1, Math.min(h?.idx ?? -1, stack.length - 1)) };
    }
    /** 开/激活一个知识库页标签（树/搜索/反链/闲聊路径/wikilink 点击都走这里，
     *  顺带记一条访问序） */
    function openVaultPageTab(ui, path, hist = true) {
      const pages = ui.vaultPages ?? [];
      const list = pages.includes(path) ? pages : [...pages, path];
      return {
        vaultPages: list,
        activeVaultPage: path,
        vaultOpen: true,
        vaultHist: hist ? vaultHistPush(ui.vaultHist ?? { stack: [], idx: -1 }, path) : (ui.vaultHist ?? { stack: [], idx: -1 }),
        activeFeature: "vault",
      };
    }
    /** 只激活（标签条点击/← → 走这里，不动访问序） */
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
        return { ...closeFeatureTab(ui, "vault"), vaultPages: [], activeVaultPage: null, vaultHist: { stack: [], idx: -1 } };
      }
      const patch = { vaultPages: rest, vaultHist: vaultHistPrune(ui.vaultHist ?? { stack: [], idx: -1 }, new Set([path])) };
      if (ui.activeVaultPage === path) patch.activeVaultPage = rest[Math.min(idx, rest.length - 1)];
      return patch;
    }
    /** 关一个功能签：清存在性；关的是激活签时激活位顺延剩余签 */
    function closeFeatureTab(ui, tab) {
      const patch = {};
      if (tab === "file") {
        patch.files = [];
        patch.activeFile = null;
      } else if (tab === "jobs") patch.jobsOpen = false;
      else if (tab === "schedule") patch.schedOpen = false;
      else if (tab === "vault") {
        patch.vaultOpen = false;
        patch.vaultPages = [];
        patch.activeVaultPage = null;
        patch.vaultHist = { stack: [], idx: -1 };
      } else patch.browserOpen = false;
      if (ui.activeFeature === tab) {
        const remaining = [];
        if (tab !== "file" && (ui.files?.length ?? 0) > 0) remaining.push("file");
        if (tab !== "jobs" && ui.jobsOpen) remaining.push("jobs");
        if (tab !== "schedule" && ui.schedOpen) remaining.push("schedule");
        if (tab !== "vault" && ui.vaultOpen) remaining.push("vault");
        if (tab !== "browser" && ui.browserOpen) remaining.push("browser");
        patch.activeFeature = remaining[0] ?? null;
      }
      return patch;
    }
    /** 打开/激活一个功能签（输入行入口与自动跟随共用）：确保存在并
     *  激活、不清别的标签。浏览器的抑制已废除（agent 干活必回眼前） */
    function openFeatureTab(ui, tab) {
      if (tab === "jobs") return { jobsOpen: true, activeFeature: "jobs" };
      if (tab === "schedule") return { schedOpen: true, activeFeature: "schedule" };
      if (tab === "vault") return { vaultOpen: true, activeFeature: "vault" };
      return { browserOpen: true, activeFeature: "browser" };
    }

    // ─────────── 官方右侧边栏（宿主 0.1.5+，本插件唯一工作台形态）───────────
    // 每个功能一张 dock 签（页类型），pane 正文是我们的组件。服务是宿主内部实现，
    // **运行期探测取用、绝不写进 dsh.client.inject**——老宿主（0.1.2）没有该服务，
    // 硬声明整个插件起不来。探测成功 = rightbarActive 翻真；不可用则只剩 kitUi
    // 侧的存在性补丁（入口不报错，签不出现）。
    const rightbarStore = {
      active: false,
      subs: new Set(),
      setActive(v) {
        if (this.active === v) return;
        this.active = v;
        for (const s of this.subs) s();
      },
      subscribe(s) {
        this.subs.add(s);
        return () => this.subs.delete(s);
      },
    };
    /** 功能 → dock 签映射（页类型注册表；kind 即 openTab 用的类型名） */
    const RB_FEATURES = [
      { id: "dsh-kit-file", kind: "dshk-file", feature: "file", titleKey: "fileTabLabel" },
      { id: "dsh-kit-vault", kind: "dshk-vault", feature: "vault", titleKey: "vaultTitle" },
      { id: "dsh-kit-schedule", kind: "dshk-schedule", feature: "schedule", titleKey: "schedTab" },
      { id: "dsh-kit-jobs", kind: "dshk-jobs", feature: "jobs", titleKey: "dockJobs" },
      { id: "dsh-kit-browser", kind: "dshk-browser", feature: "browser", titleKey: "dockBrowser" },
    ];
    /** sidebarRight 服务实例（openTab 用）：apply 时 ctx.inject(["sidebarRight"])
     *  捕获——服务属性不能直接读（`cannot get property without inject`），又不能
     *  写进 exports.inject（0.1.2 无此服务，硬声明整插件起不来） */
    let rightbarSr = null;
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
    /** 打开文件并确保「文件」dock 签在眼前（文件树/源代码管理/图谱/对话链接统一入口） */
    function openFileAndDock(path, from, untracked, deleted, commit) {
      setKitUi(openFileTab(kitUi, path, from, untracked === true, deleted === true, typeof commit === "string" && commit !== "" ? commit : undefined));
      openRightbarTab("file");
    }
    /** 打开知识库页并确保「知识库」dock 签在眼前（目录/搜索/反链/wikilink/
     *  对话路径统一走 VaultRootView 的 openPath） */
    function openVaultPageAndDock(path) {
      setKitUi(openVaultPageTab(kitUi, path));
      openRightbarTab("vault");
    }

    // ── 侧栏索引视图单槽与入口按钮（文件树/源代码管理/知识库，三个入口按钮
    // + 快捷键共用；日程待办索引 2026-09-11 退役——日程只剩
    // 右栏 dock 签一个家，入口归右栏开始页条目与待办卡，用户定稿）──
    // 侧栏只有一格（会话 ↔ 文件树 ↔ 源代码管理 ↔ 知识库目录），三个按钮的
    // 选中态直接取各自的开合位（用户定稿：选中态与侧栏显示相关、与右栏签
    // 无关）——所以三者必须互斥：否则同一个侧栏位上会有两个按钮一起亮，
    // 而视图按优先级只显示其中一个。
    /** 单槽互斥补丁：view = 'tree' | 'scm' | 'vault' | null */
    function sidebarViewPatch(view) {
      return {
        treeOpen: view === "tree",
        gitOpen: view === "scm",
        vaultIdxOpen: view === "vault",
      };
    }
    // 语义：关 → 开；开 → 只把侧栏索引收回会话列表（用户定稿 2026-09-10：功能签
    // 不跟着关——签的归宿是官方签 ✕ 与配置清场，入口按钮只管侧栏那格）。知识库钮
    // 只切左侧目录（用户定稿 2026-09-11），点具体页才开右栏签；收起态顺带展开
    // 侧栏（视图渲染进铁轨等于不可见）。
    function openVaultEntry() {
      expandSidebarNow();
      return sidebarViewPatch("vault");
    }
    function toggleVaultEntry(ui) {
      if (ui.vaultIdxOpen === true) return sidebarViewPatch(null);
      return openVaultEntry();
    }

    // ── portal 宿主登记（侧栏索引 ↔ 右栏内容）──
    // 知识库拆两半后 VaultRootView 单实例挂在 KitSurfaces，左树/工具条与页编辑器
    // 经 createPortal 分投两侧：宿主 DOM 节点由侧栏占用组件与右栏 pane 登记。
    // 宿主出现/消失走最小 store（useSyncExternalStore）驱动 VaultRootView 重渲染。
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
    const vaultPaneSlot = makeHostSlot();
    const useHostSlot = (slot) => react.useSyncExternalStore(slot.subscribe, slot.get);

    // ── 多终端会话模型 ──
    // terminals:[{id,cwd}] 创建顺序即标签顺序；每个终端在创建那一刻绑定当时的
    // 会话工作区，之后切换会话不影响已开的终端。termDockOpen 只管坞的可见性——
    // 隐藏不杀进程，后台标签的 shell 继续跑、xterm 继续缓冲输出；标签 ✕ 才断开
    // 对应 WS（宿主随即杀掉 pty）。
    let termSeq = 0;
    const makeTerm = (cwd) => ({ id: `term-${++termSeq}`, cwd });
    /** 入口按钮与 Ctrl+/ 共用：开=恢复视图（无会话则新建绑定当前 cwd）；关=仅隐藏 */
    function toggleTermDock(ui, cwd) {
      if (ui.termDockOpen) return { termDockOpen: false };
      if (ui.terminals.length === 0) {
        const nt = cwd ? makeTerm(cwd) : null;
        return nt ? { termDockOpen: true, terminals: [nt], activeTermId: nt.id } : { termDockOpen: true };
      }
      return { termDockOpen: true, activeTermId: ui.activeTermId ?? ui.terminals[ui.terminals.length - 1].id };
    }
    /** ＋ 新建终端：绑定调用那一刻的当前会话工作区 */
    function spawnTerm(ui, cwd) {
      const nt = makeTerm(cwd ?? "");
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

    // ─────────── 插件配置 ───────────
    // 数据通道：官方 settings scope（宿主 installSettingsSection 注册的
    // dsh-kit 命名空间）。默认值与宿主 Config schema（src/index.ts）逐项同值——
    // 恢复默认回落的是宿主 base，两处不同步会出现「默认值漂移」。
    // 快照未就绪时一律回退内置默认——功能全开、默认键位。
    const CFG_DEFAULTS = {
      terminalEnabled: true,
      fileTreeEnabled: true,
      sourceControlEnabled: true,
      chatOpenFilePreview: true,
      skillsPageEnabled: true,
      searchEnabled: true,
      searchMaxResults: 2,
      previewMaxTabs: 3,
      phoneEnabled: true,
      phoneRemoteDomain: "",
      phonePort: 3090,
      phoneKeepGatewayOn: false,
      jobsEnabled: true,
      browserEnabled: true,
      monitorEnabled: true,
      monitorWaitMs: 15000,
      monitorMaxAuto: 3,
      monitorRepeatThreshold: 3,
      vaultEnabled: true,
      vaultRoot: "",
      terminalShortcut: "Ctrl+/",
      fileTreeShortcut: "Ctrl+,",
      scShortcut: "Ctrl+Alt+.",
      vaultShortcut: "Ctrl+Alt+K",
      rightbarShortcut: "Ctrl+Alt+B",
      sidebarShortcut: "Ctrl+B",
    };
    /** 组合键规范化主键：单字符统一大写、空格记作 Space */
    function normComboKey(key) {
      return key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
    }
    /** 解析 "Ctrl+Alt+T" 形式为匹配结构；无主键或重复修饰键返回 null */
    function parseCombo(text) {
      const parts = String(text ?? "").trim().split("+").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      const out = { ctrl: false, alt: false, shift: false, meta: false, key: null };
      for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === "ctrl" && !out.ctrl) out.ctrl = true;
        else if (lower === "alt" && !out.alt) out.alt = true;
        else if (lower === "shift" && !out.shift) out.shift = true;
        else if (lower === "meta" && !out.meta) out.meta = true;
        else if (out.key === null) out.key = normComboKey(part);
        else return null;
      }
      return out.key === null ? null : out;
    }
    /** keydown 是否命中组合键 */
    function comboMatches(e, combo) {
      return (
        !!e.ctrlKey === combo.ctrl &&
        !!e.altKey === combo.alt &&
        !!e.shiftKey === combo.shift &&
        !!e.metaKey === combo.meta &&
        normComboKey(e.key) === combo.key
      );
    }
    /** keydown 转规范串（纯修饰键返回 null，调用方继续等待）；修饰键固定顺序 */
    function comboFromEvent(e) {
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
      const parts = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      parts.push(normComboKey(e.key));
      return parts.join("+");
    }
    /** 从官方 scope 快照提取生效配置（字段缺失/非法逐项回退默认） */
    function cfgFromSnapshot(snap) {
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return { ...CFG_DEFAULTS };
      const v = snap.value;
      return {
        terminalEnabled: v.terminalEnabled !== false,
        fileTreeEnabled: v.fileTreeEnabled !== false,
        sourceControlEnabled: v.sourceControlEnabled !== false,
        chatOpenFilePreview: v.chatOpenFilePreview === true,
        skillsPageEnabled: v.skillsPageEnabled !== false,
        searchEnabled: v.searchEnabled !== false,
        previewMaxTabs:
          Number.isInteger(v.previewMaxTabs) && v.previewMaxTabs >= 1 && v.previewMaxTabs <= 20
            ? v.previewMaxTabs
            : CFG_DEFAULTS.previewMaxTabs,
        phoneEnabled: v.phoneEnabled === true,
        phoneRemoteDomain: typeof v.phoneRemoteDomain === "string" ? v.phoneRemoteDomain : "",
        jobsEnabled: v.jobsEnabled !== false,
        browserEnabled: v.browserEnabled !== false,
        monitorEnabled: v.monitorEnabled !== false,
        monitorWaitMs:
          Number.isInteger(v.monitorWaitMs) && v.monitorWaitMs >= 5000 && v.monitorWaitMs <= 600000
            ? v.monitorWaitMs
            : CFG_DEFAULTS.monitorWaitMs,
        monitorMaxAuto:
          Number.isInteger(v.monitorMaxAuto) && v.monitorMaxAuto >= 1 && v.monitorMaxAuto <= 10
            ? v.monitorMaxAuto
            : CFG_DEFAULTS.monitorMaxAuto,
        monitorRepeatThreshold:
          Number.isInteger(v.monitorRepeatThreshold) && v.monitorRepeatThreshold >= 2 && v.monitorRepeatThreshold <= 10
            ? v.monitorRepeatThreshold
            : CFG_DEFAULTS.monitorRepeatThreshold,
        vaultEnabled: v.vaultEnabled !== false,
        vaultRoot: typeof v.vaultRoot === "string" ? v.vaultRoot : "",
        terminalShortcut:
          typeof v.terminalShortcut === "string" && parseCombo(v.terminalShortcut)
            ? v.terminalShortcut
            : CFG_DEFAULTS.terminalShortcut,
        fileTreeShortcut:
          typeof v.fileTreeShortcut === "string" && parseCombo(v.fileTreeShortcut)
            ? v.fileTreeShortcut
            : CFG_DEFAULTS.fileTreeShortcut,
        scShortcut:
          typeof v.scShortcut === "string" && parseCombo(v.scShortcut)
            ? v.scShortcut
            : CFG_DEFAULTS.scShortcut,
        vaultShortcut:
          typeof v.vaultShortcut === "string" && parseCombo(v.vaultShortcut)
            ? v.vaultShortcut
            : CFG_DEFAULTS.vaultShortcut,
        rightbarShortcut:
          typeof v.rightbarShortcut === "string" && parseCombo(v.rightbarShortcut)
            ? v.rightbarShortcut
            : CFG_DEFAULTS.rightbarShortcut,
        sidebarShortcut:
          typeof v.sidebarShortcut === "string" && parseCombo(v.sidebarShortcut)
            ? v.sidebarShortcut
            : CFG_DEFAULTS.sidebarShortcut,
      };
    }
    // 模块级通道（apply 注入 / KitSurfaces 订阅 / 设置卡捕获互斥）
    let cfgScope = null;
    let shortcutCapture = null; // 正在录制快捷键的字段名；非 null 时面板快捷键监听让路
    let schedModalOpen = false; // 日程弹窗开着：KitSurfaces 的 Esc 不收标签页（Esc 归弹窗自关）
    let inlineEditCapture = false; // 树行内改名输入激活：面板快捷键（含 Esc 分层关闭）让路
    const subscribeCfg = (listener) => (cfgScope ? cfgScope.subscribe(listener) : () => {});
    const getCfgSnapshot = () => (cfgScope ? cfgScope.getSnapshot() : null);

    // ─────────── 对话文件点击接管（设置项，默认关闭）───────────
    // 官方对话中「产物文件」chips、markdown 内联代码提及与 read/write/edit
    // 工具行的文件链接都点击走 session.openWorkspacePath RPC → 系统默认程序
    // 打开（前两者渲染成 button[title=路径]，工具行是 button[class*=_fileLink]
    // 文本路径，详见拦截器注释）；插件 /dsh-kit/read 支持任意绝对路径，开启
    // cfg.chatOpenFilePreview 后在这里拦截并把路径交给右侧预览面板。
    // 判定链任何一环不命中都放行官方。
    let chatPreviewHook = null;
    // KitSurfaces 渲染期 props 桥：右栏 pane/开始页的 inject 闭包经此取官方
    // useSessions（任务 pane/开始页要在跑任务数做徽标；槽位注册在 effect 里，
    // 拿不到渲染期 props，用模块变量中转）
    const shellShare = { current: null };

    // ── M4 会话→笔记（用户定稿 2026-09-09）：vault 路径点击直达知识库标签 ──
    // vault root 的客户端缓存：拦截器路由判定用（vault 内路径开知识库标签而非
    // 文件预览，且不受 chatOpenFilePreview 门控——互通是知识库本体能力）。
    // VaultRootView 每次拉索引同步刷新；从未开过知识库时点击现取一次（索引端
    // 点宿主侧有 mtime 缓存），失败按无 vault 处理走原行为。vaultOpenRequest：
    // 坞收起时 VaultRootView 未挂载、open 事件没人听——请求先落地，挂载后消费。
    let vaultRootHint = null;
    let vaultRootHintFetching = null;
    let vaultOpenRequest = null;
    function ensureVaultRootHint() {
      if (vaultRootHint !== null) return Promise.resolve(vaultRootHint);
      if (vaultRootHintFetching === null) {
        vaultRootHintFetching = schedFetch("/dsh-kit/vault/index")
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

    /** document capture：开启配置后接管官方对话区文件打开按钮的点击。
     *  两种形态：① markdown 内联代码与「产物文件」chips → button[title=路径]；
     *  ② read/write/edit 工具行（ui-tool ToolRow）→ button[class*="_fileLink"]，
     *     无 title，按钮文本即工具 path/file_path 参数按 cwd 相对化的路径
     *     （relativizeToCwd 剥掉的前缀由 resolveChatOpenPath 拼回，语义还原）。
     *  vault 内路径优先路由到知识库标签（M4 会话→笔记），见尾部分支。 */
    function onChatOpenFileClick(ev) {
      if (!ev.isTrusted) return;
      const hook = chatPreviewHook;
      if (!hook || !(hook.ready || hook.vaultOn)) return;
      if (!(ev.target instanceof Element)) return;
      const btn =
        ev.target.closest("button[title]") || ev.target.closest('button[class*="_fileLink"]');
      if (!btn) return;
      // 弹层控件（aria-haspopup）不是文件链接，放行官方：模型选择器触发钮的
      // title=模型名（如 opencode-go/omen-alpha，含分隔符无空格）会被路径判定
      // 误吞，而 composer 就在对话 scrollBody 内部，位置判定挡不住它
      if (btn.hasAttribute("aria-haspopup")) return;
      // 插件自身面板/入口的元素不拦（title 可能是路径的只有文件树行等）。
      // 但命中元素必须是真插件容器：面板打开时 body 挂的让位标记类
      // （dshk-pane-open/dshk-open）是全体对话的祖先，若不剔除，预览/终端
      // 一开拦截就整体失效（点击放行官方 → 系统默认程序打开）
      const kitAnc = btn.closest('[class*="dshk-"]');
      if (kitAnc && kitAnc !== document.body && kitAnc !== document.documentElement) return;
      // 仅官方对话滚动区内的文件按钮（markdown 提及、产物 chips、工具行都在其中）
      if (!btn.closest('[class*="_scroll"]')) return;
      let path = (btn.getAttribute("title") || "").trim();
      if (path === "") {
        // ② 工具行 fileLink：文本必为路径（参数解析不出路径时官方渲染 span）；
        // 家目录缩写形态（~/…）客户端还原不了宿主 home，放行官方
        path = (btn.textContent || "").trim();
        if (path === "" || path.startsWith("~")) return;
      } else if (!isChatOpenPathish(path)) {
        return;
      }
      // 无会话工作区时：仅盘符绝对/UNC（含 /D:… 归一的盘符形态）可脱离 cwd
      // 预览；相对路径解析无依，放行官方
      if (!hook.cwd) {
        const t2 = path.startsWith("\\\\") ? path : path.replace(/^[\\/](?=[A-Za-z]:)/, "");
        if (!/^[A-Za-z]:[\\/]/.test(t2) && !t2.startsWith("\\\\")) return;
      }
      const resolved = resolveChatOpenPath(hook.cwd, path);
      // 知识库优先路由（M4 会话→笔记）：vault 内路径的归宿是知识库标签的
      // WYSIWYG 编辑器，不是文件预览。preventDefault 只在两条路都有着落时才
      // 做（root 未缓存走异步判定时必须 hook.ready 兜底预览，否则吞掉官方
      // 点击无法恢复）
      if (hook.vaultOn && (vaultRootHint !== null || hook.ready)) {
        if (vaultRootHint !== null && isPathInsideVaultRoot(vaultRootHint, resolved)) {
          ev.preventDefault();
          ev.stopPropagation();
          hook.openVaultPage(resolved);
          return;
        }
        if (vaultRootHint === null && hook.ready) {
          ev.preventDefault();
          ev.stopPropagation();
          void ensureVaultRootHint().then((r) => {
            if (r !== null && isPathInsideVaultRoot(r, resolved)) hook.openVaultPage(resolved);
            else hook.openPreview(resolved);
          });
          return;
        }
      }
      if (!hook.ready) return; // 预览接管未开启：放行官方（系统默认程序打开）
      ev.preventDefault();
      ev.stopPropagation();
      hook.openPreview(resolved);
    }

    // ─────────── 对话 @ 引用（文件树 → 输入框）───────────
    // 官方 ui-conversation 注册 `conversation` 服务（ConversationController），
    // 其 .input = InputHub，`hub.shell(当前会话 id)` 返回 SessionInputShell
    // （公开 actions.setDraft 草稿写入 + 官方 @ 面板同款插入体
    // insertReference(ref, span) 引用芯片直插）——文件树「@到对话」优先直插
    // 真实引用 chip（不弹官方 @ 面板），失败兜底追加 @ 语法文本，均与手打
    // @ 等价（提交后按官方 file-reference 语法解析）。使用点现取（懒解析）。
    /** 取当前会话的输入 shell；任一步未就绪返回 null */
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
      const current = sessions?.list?.getSnapshot?.()?.current;
      if (!current) return null;
      try {
        return hub.shell(current) ?? null;
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

    /** M4 路由判据：path 是否落在 vault root 内。分隔符归一 + 解 ..；Windows 形
     *  根（盘符/UNC）大小写不敏感，POSIX 根大小写敏感。path 等于根本身不算内。 */
    function isPathInsideVaultRoot(root, path) {
      if (typeof root !== "string" || typeof path !== "string" || root === "" || path === "") return false;
      const norm = (p) => {
        const out = [];
        for (const s of p.split(/[\\/]+/)) {
          if (s === "" || s === ".") continue;
          if (s === "..") out.pop();
          else out.push(s);
        }
        return out;
      };
      const win = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");
      const lc = (arr) => (win ? arr.map((s) => s.toLowerCase()) : arr);
      const r = lc(norm(root));
      const t = lc(norm(path));
      if (t.length <= r.length) return false;
      return r.every((seg, i) => t[i] === seg);
    }

    /** M4 笔记→会话：「引用到对话」的选区文本转引用块续在草稿后（首尾空行剥
     *  掉）。页面路径本体由 @ 引用芯片承载（2026-09-10 用户定稿：与文件树
     *  「@到对话」同款方法，此函数只管引用块文本）。render-check 直调。 */
    function vaultCiteText(draft, selText) {
      const base = typeof draft === "string" ? draft : "";
      const lines = typeof selText === "string" ? selText.replace(/\r\n?/g, "\n").split("\n") : [];
      while (lines.length > 0 && lines[0].trim() === "") lines.shift();
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      const quote = lines.length > 0 ? lines.map((l) => `> ${l}`).join("\n") + "\n\n" : "";
      const joiner = base !== "" && !base.endsWith("\n") ? "\n" : "";
      return base + joiner + quote;
    }

    // ─────────── 文案 ───────────
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
      treeLabel: "文件树",
      treeClose: "关闭文件树",
      treeRefresh: "刷新",
      treeLoading: "加载中…",
      treeEmpty: "（空目录）",
      treeFail: "加载失败",
      treeTruncated: "条目过多，列表已截断",
      treeNewAny: "新建文件/目录",
      treeNewPh: "名称，\\ 开头新建文件夹，可含 / 多级，回车创建",
      treeRename: "重命名",
      treeDelete: "删除",
      treeCopyAbs: "复制绝对路径",
      treeCopyRel: "复制相对路径",
      treeCopied: "已复制路径",
      treeAt: "@ 到对话",
      treeAtUnavailable: "输入框未就绪（无会话或不可用）",
      treeMenu: "更多操作",
      confirmDelete: "删除「{name}」？内容将移入回收站。",
      created: "已创建",
      renamed: "已重命名",
      deleted: "已删除",
      scTitle: "源代码管理",
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
      committed: "已提交",
      scBranch: "分支",
      scBranchNew: "新分支名（Enter 新建）",
      scBranchCreate: "新建",
      scBranchCreateSwitch: "新建并切换",
      scBranchSwitch: "切换分支",
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
      scBranchUpstream: "上游",
      scDetached: "分离头",
      scPublish: "发布分支",
      scPullDone: "已拉取",
      scPullFail: "拉取失败",
      scSynced: "已同步，无待推送提交",
      scPushAhead: "推送 {n} 个提交到远程",
      scBehind: "落后 {n} 个提交",
      scPushDone: "已推送",
      scPushFail: "推送失败",
      scPushNoUpstream: "当前分支没有上游，首次推送前需先设置",
      scPushSetUpstream: "设置上游并推送",
      scGraph: "提交图谱",
      scGraphEmpty: "（尚无提交）",
      scGraphFail: "图谱加载失败",
      scGraphMore: "加载更多",
      scCommitDetail: "提交详情",
      scBack: "返回",
      scMergedCommit: "合并提交",
      scAuthored: "作者",
      scFiles: "更改的文件",
      contentClose: "关闭预览",
      toDiff: "切换到 diff 视图",
      toText: "切换到原文视图",
      edit: "编辑",
      editSave: "保存",
      editCancel: "取消",
      editSaved: "已保存",
      editFail: "保存失败",
      editConflict: "文件在打开后被外部修改，重新加载最新版本？",
      diffFail: "diff 加载失败",
      diffEmpty: "（无未暂存差异）",
      diffUntracked: "未跟踪文件，暂无 diff",
      diffBaseParent: "与上一版（父提交 {base}）对比",
      diffBaseRoot: "根提交：与空树对比（全部为新增）",
      mdCopyCode: "复制代码",
      mdCopied: "已复制",
      gitM: "已修改",
      gitA: "新文件",
      gitD: "已删除",
      gitR: "重命名",
      gitU: "未跟踪",
      gitTip: "git 变更",
      contentLoading: "加载中…",
      contentBinary: "二进制文件，无法预览",
      pdfNewTab: "在新标签页打开",
      pdfJump: "跳转到指定页",
      sheetRowCap: "表格较大，仅加载部分行列；悬停单元格可看完整内容",
      previewTooLarge: "文件超过 20MB，不预览",
      contentTruncated: "文件较大，仅显示前 512 KB",
      contentFail: "读取失败",
      contentEmpty: "（空文件）",
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
      skByPlugin: "随插件",
      skHide: "收起",
      skView: "详情",
      skCopy: "复制",
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
      cfgTitle: "套件（dsh-kit）",
      cfgDesc: "功能开关、快捷键与套件配置。",
      cfgGroupSidebar: "侧边栏",
      cfgTerminalEnabled: "启用终端",
      cfgTerminalEnabledHint: "隐藏入口与快捷键",
      cfgFileTreeEnabled: "启用文件树",
      cfgFileTreeEnabledHint: "隐藏入口与快捷键",
      cfgChatOpenFilePreview: "对话文件用插件预览打开",
      cfgChatOpenFilePreviewHint: "关 = 交回系统默认程序",
      cfgSkillsPageEnabled: "启用技能页",
      cfgSkillsPageEnabledHint: "关 = 不显示「技能」页",
      cfgSearchEnabled: "启用网页搜索",
      cfgSearchEnabledHint: "关 = 走官方搜索（重启生效）",
      cfgSearchMaxResults: "搜索结果条数",
      cfgSearchMaxResultsHint: "1-8，默认 2",
      cfgPhoneEnabled: "显示「手机访问」页",
      cfgPhoneEnabledHint: "设置里的「手机访问」页入口",
      cfgJobsEnabled: "启用后台任务面板",
      cfgJobsEnabledHint: "查看并结束后台任务",
      cfgBrowserEnabled: "启用内置浏览器",
      cfgBrowserEnabledHint: "实时查看并操作 agent 的浏览器（重启生效）",
      cfgMonitorEnabled: "启用会话监视",
      cfgMonitorEnabledHint: "回合失败自动续跑、死循环自动打断；只看当前会话",
      cfgMonitorWaitMs: "失败后等待(毫秒)",
      cfgMonitorWaitMsHint: "等多久自动发「继续」（5000-600000）",
      cfgMonitorMaxAuto: "自动继续上限(次)",
      cfgMonitorMaxAutoHint: "连续续跑达到即暂停（1-10）",
      cfgMonitorRepeatThreshold: "重复判定(次)",
      cfgMonitorRepeatThresholdHint: "重复片段达此次数判死循环（2-10）",
      monitorContinueText: "继续",
      monitorLoopBreakText: "检测到你的输出在重复相同内容，可能陷入了死循环。请立即停止重复，简要说明当前状态，换一种方式继续完成任务。",
      monitorCancel: "取消",
      monitorRepeatErr: "重复输出（死循环征兆）",
      monitorStopping: "监视：检测到重复输出（死循环征兆），正在停止当前回合…",
      monitorCapped: "监视：已连续自动继续 {max} 次，暂停自动续跑（重复输出仍会中止）",
      monitorAutoIn: "监视：检测到{err}，{sec} 秒后自动继续（第 {n}/{max} 次）",
      monitorErr429: "请求被限流（429）",
      monitorErrSERVER: "服务端错误",
      monitorErrTIMEOUT: "请求超时",
      monitorErrTRANSPORT: "网络传输错误",
      monitorErrEMPTY_RESPONSE: "模型返回空响应",
      cfgPreviewMaxTabs: "文件标签数上限",
      cfgPreviewMaxTabsHint: "超限自动关最久没看的（1-20）",
      browserUrlPh: "输入网址，回车打开",
      browserGo: "打开",
      browserBack: "后退",
      browserForward: "前进",
      browserReload: "刷新",
      browserNewTab: "新建页签",
      browserCloseTab: "关闭页签",
      browserStarting: "浏览器启动中…",
      browserReconnect: "连接断开，重连中…",
      browserNotRunning: "浏览器未启动——在上方输入网址回车，或等 agent 首次使用时自动拉起",
      browserNoPages: "没有打开的页面——在上方输入网址回车，或等 agent 下次导航自动出现在这里",
      dockPreview: "预览",
      dockJobs: "后台任务",
      dockBrowser: "浏览器",
      pvCloseTab: "关闭此标签",
      pvDeletedNote: "文件已删除——此标签仅展示删除 diff；可在源代码管理里 ↩ 恢复文件",
      rbGuideSchedDesc: "周网格、待办与计时",
      rbGuideBrowserDesc: "agent 驱动的内置浏览器",
      rbGuideJobsDesc: "后台任务的输出与停止",
      rbFeatureDisabled: "该功能已在设置中停用",
      fileTabLabel: "文件",
      vaultIdxTitle: "知识库目录",
      browserStarting: "正在拉起浏览器…",
      browserErr: "浏览器出错：{error}",
      phoneGateStart: "启动网关",
      phoneGateStop: "关闭网关",
      phoneStoppedHint: "网关未启动。开启后可用「刷新链接」作废旧链接。",
      cfgRemoteHint: "非本机访问：上游把设置镜像钉在本机浏览器，配置在手机/远程只读——请在电脑端查看与修改。",
      cfgPhoneRemoteDomain: "远程域名",
      cfgPhonePort: "网关端口",
      cfgPhonePortHint: "网关端口，1-65535；保存即重启网关",
      cfgPhoneKeepGatewayOn: "重启后保留开启",
      cfgPhoneKeepGatewayOnHint: "重启后恢复上次开启状态",
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
      phonePortInvalid: "端口需为 1-65535 的整数",
      phoneRotate: "刷新链接",
      phoneRotateHint: "作废当前链接并生成新链接，已授权设备将全部失效。",
      phoneRotated: "链接已刷新，旧链接已失效",
      phoneRotateFail: "刷新失败：{error}",
      jobsTitle: "后台任务",
      jobsEmpty: "没有运行中的后台任务。",
      jobsStatusRunning: "运行中",
      jobsStatusStopping: "停止中",
      jobsStatusCompleted: "已完成",
      jobsStatusKilled: "已结束",
      jobsStatusFailed: "失败",
      jobsDuration: "已运行 {duration}",
      jobsKill: "结束",
      jobsKillHint: "结束此任务（等同 job_kill）",
      jobsRowClose: "关闭",
      jobsRowCloseHint: "从列表移除（任务已结束，仅收起显示）",
      jobsKillDone: "已请求结束",
      jobsKillFail: "结束失败：{error}",
      jobsClose: "关闭任务面板",
      jobsOutputEmpty: "（暂无输出）",
      jobsOutputTransient: "输出读取失败：{error}",
      schedTab: "日程",
      schedNew: "新建",
      schedToday: "今天",
      schedEdit: "编辑日程",
      schedCreate: "新建日程",
      schedCreateTask: "新建待办",
      schedTitle: "标题",
      schedTitlePh: "事项标题…",
      schedDesc: "备注",
      schedLoc: "地点",
      schedStart: "开始",
      schedEnd: "结束",
      schedAllDay: "全天",
      schedRepeat: "重复",
      schedRepeatNone: "不重复",
      schedRepeatDaily: "每天",
      schedRepeatWeekly: "每周",
      schedRepeatMonthly: "每月",
      schedRepeatInterval: "间隔",
      schedDayUnit: "天",
      schedWeekUnit: "周",
      schedMonthUnit: "月",
      schedRepeatUntil: "结束于",
      schedColor: "颜色",
      schedSave: "保存",
      schedDelete: "删除",
      schedDeleteConfirm: "确认删除？",
      schedClose: "关闭",
      schedTasks: "待办",
      schedAdd: "添加",
      schedTaskDue: "截止",
      schedNoDue: "无日期",
      schedOverdue: "逾期",
      schedTasksEmpty: "暂无待办",
      schedStatsTotal: "总时长",
      schedStatsEvents: "事件",
      schedStatsDone: "已完成",
      schedStatsOpen: "待办",
      schedStatsTitle: "本周统计",
      schedEmptyWeek: "本周暂无日程安排",
      schedPickTimer: "选择要计时的待办",
      schedTimerStandalone: "独立计时（不挂待办）",
      schedEditEntry: "编辑计时",
      timerLabelPh: "在做点什么（必填名目）",
      timerStartBtn: "开始计时",
      timerTitleRequired: "先写个名目（独立计时必带标题）",
      timerStopConfirm: "确定结束计时？",
      timerDoneStop: "完成",
      timerStopYes: "是",
      timerGridBadge: "计时",
      schedWeekdays: "一,二,三,四,五,六,日",
      schedDelDone: "已删除",
      schedSaved: "已保存",
      schedOpFail: "操作失败：{error}",
      cfgVaultEnabled: "启用知识库",
      cfgVaultEnabledHint: "输入行入口：侧栏目录 + 右栏页编辑",
      cfgVaultRoot: "知识库目录",
      cfgVaultRootHint: "vault 根目录绝对路径；空 = 数据目录下 dsh-kit\\knowledge",
      vaultTitle: "知识库",
      vaultNotConfigured: "未配置知识库目录",
      vaultNotConfiguredHint: "在 设置 → 插件 → dsh-kit 里填写「知识库目录」后即可使用：目录内一切 md 文件即页面，支持双链跳转与全文搜索",
      vaultIndexFail: "索引失败：{error}",
      vaultHistBack: "后退",
      vaultHistFwd: "前进",
      vaultSpaceAll: "全部",
      vaultSearchPh: "搜索 wiki 笔记，回车执行",
      vaultSearchEmpty: "无结果",
      vaultSearchFail: "搜索失败：{error}",
      vaultRefresh: "刷新索引与目录树",
      vaultRefreshed: "已刷新",
      vaultNewAny: "新建页面/目录",
      vaultNewPh: "标题，\\ 开头新建目录，可含 / 多级，回车创建",
      vaultCreate: "创建",
      vaultSaved: "已保存",
      vaultUnsaved: "有未保存修改",
      vaultBinaryHint: "二进制文件，知识库不渲染",
      vaultCopy: "复制",
      vaultCopied: "已复制",
      vaultSaveFail: "保存失败：{error}",
      vaultConflict: "页面已被外部修改——已加载最新版，请重试",
      vaultBacklinks: "反链",
      vaultBroken: "页面不存在，点击创建",
      vaultEmptySpace: "此库还没有页面",
      vaultPickPage: "从左侧选择一页开始",
      vaultPageGone: "页面不存在（可能已被移动或删除）",
      vaultDelBtn: "删除",
      vaultCiteBtn: "引用到对话",
      vaultCited: "已插入对话输入框",
      vaultCiteUnavailable: "对话输入框未就绪（无会话或不可用）",
      vaultDelConfirm: "确认删除以下页面？（移入回收站；vault 为 git 仓库时自动生成一个提交，可整体撤回）",
      vaultDeleted: "已删除",
      vaultDelFail: "删除失败（文件被占用？已保留）：",
      vaultConflict: "页面在盘上已被修改，自动保存已暂停",
      vaultConflictOverwrite: "覆盖盘上",
      vaultConflictReload: "读取盘上版本",
      vaultTableAddRow: "加行",
      vaultTableAddCol: "加列",
      vaultTableDelRow: "删行",
      vaultTableDelCol: "删列",
      vaultTableDel: "删表",
      rtePlaceholder: "输入正文，/ 唤出命令菜单",
      rteLoadFail: "富文本引擎加载失败，已退回纯文本编辑",
      vmenuGHead: "标题与正文",
      vmenuH1: "标题 1",
      vmenuH1Desc: "一级标题",
      vmenuH2: "标题 2",
      vmenuH2Desc: "二级标题",
      vmenuH3: "标题 3",
      vmenuH3Desc: "三级标题",
      vmenuH4: "标题 4",
      vmenuH4Desc: "四级标题",
      vmenuH5: "标题 5",
      vmenuH5Desc: "五级标题",
      vmenuH6: "标题 6",
      vmenuH6Desc: "六级标题",
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
      vmenuGTable: "表格",
      vmenuTable1: "1×2",
      vmenuTable1Desc: "1 行 2 列",
      vmenuTable2: "2×2",
      vmenuTable2Desc: "2 行 2 列",
      vmenuTable3: "3×3",
      vmenuTable3Desc: "3 行 3 列",
      vmenuTable4: "4×4",
      vmenuTable4Desc: "4 行 4 列",
      vmenuTable5: "5×5",
      vmenuTable5Desc: "5 行 5 列",
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
      cfgTerminalShortcut: "终端快捷键",
      cfgFileTreeShortcut: "文件树快捷键",
      cfgSidebarShortcut: "左栏开合快捷键",
      cfgSourceControlEnabled: "启用源代码管理",
      cfgSourceControlEnabledHint: "隐藏入口与快捷键",
      cfgScShortcut: "源代码管理快捷键",
      cfgVaultShortcut: "知识库快捷键",
      cfgRightbarShortcut: "右栏开合快捷键",
      cfgCapturing: "按下组合键…（Esc 取消）",
      cfgCapture: "修改",
      overridden: "已覆盖",
      resetDefault: "恢复默认",
      save: "保存",
      saving: "保存中…",
      discard: "放弃修改",
      unsaved: "未保存",
      readOnly: "本部署的设置为只读。",
      loadingCfg: "正在读取配置…",
      saveFailed: "本部署没有接受这些值，已保留供你修改。",
      invalidCombo: "需一个主键 + 至少一个修饰键。",
      invalidNumber: "超出允许范围。",
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
      treeLabel: "Files",
      treeClose: "Close file tree",
      treeRefresh: "Refresh",
      treeLoading: "Loading…",
      treeEmpty: "(empty)",
      treeFail: "Failed to load",
      treeTruncated: "Too many entries, list truncated",
      treeNewAny: "New file/folder",
      treeNewPh: "Name, \\ prefix creates a folder, / for nesting, Enter to create",
      treeRename: "Rename",
      treeRename: "Rename",
      treeDelete: "Delete",
      treeCopyAbs: "Copy absolute path",
      treeCopyRel: "Copy relative path",
      treeCopied: "Path copied",
      treeAt: "Insert @ mention",
      treeAtUnavailable: "Composer is not ready (no active session)",
      treeMenu: "More actions",
      confirmDelete: "Delete \"{name}\"? It will be moved to the Recycle Bin.",
      created: "Created",
      renamed: "Renamed",
      deleted: "Deleted",
      scTitle: "Source Control",
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
      committed: "Committed",
      scBranch: "Branches",
      scBranchNew: "New branch name (Enter to create)",
      scBranchCreate: "Create",
      scBranchCreateSwitch: "Create & switch",
      scBranchSwitch: "Switch branch",
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
      scBranchUpstream: "upstream",
      scDetached: "detached HEAD",
      scPublish: "Publish branch",
      scPullDone: "Pulled",
      scPullFail: "Pull failed",
      scSynced: "Synced — nothing to push",
      scPushAhead: "Push {n} commit(s) to remote",
      scBehind: "{n} commit(s) behind",
      scPushDone: "Pushed",
      scPushFail: "Push failed",
      scPushNoUpstream: "This branch has no upstream; set one before the first push",
      scPushSetUpstream: "Set upstream & push",
      scGraph: "Commit graph",
      scGraphEmpty: "(no commits yet)",
      scGraphFail: "Failed to load graph",
      scGraphMore: "Load more",
      scCommitDetail: "Commit detail",
      scBack: "Back",
      scMergedCommit: "Merge commit",
      scAuthored: "Author",
      scFiles: "Changed files",
      contentClose: "Close preview",
      toDiff: "Switch to diff view",
      toText: "Switch to plain view",
      diffFail: "Failed to load diff",
      diffEmpty: "(no unstaged changes)",
      diffUntracked: "Untracked file, no diff yet",
      diffBaseParent: "Compared with parent commit {base}",
      diffBaseRoot: "Root commit: diffed against empty tree (all additions)",
      mdCopyCode: "Copy",
      mdCopied: "Copied",
      gitM: "Modified",
      gitA: "Added",
      gitD: "Deleted",
      gitR: "Renamed",
      gitU: "Untracked",
      gitTip: "git change",
      edit: "Edit",
      editSave: "Save",
      editCancel: "Cancel",
      editSaved: "Saved",
      editFail: "Save failed",
      editConflict: "File changed on disk since it was loaded. Reload the latest version?",
      contentLoading: "Loading…",
      contentBinary: "Binary file, preview unavailable",
      pdfNewTab: "Open in new tab",
      pdfJump: "Jump to page",
      sheetRowCap: "Large sheet: partially loaded; hover a cell for full content",
      previewTooLarge: "File exceeds 20MB, preview skipped",
      contentTruncated: "File is large, only first 512 KB shown",
      contentFail: "Failed to read",
      contentEmpty: "(empty file)",
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
      skByPlugin: "Plugin-bundled",
      skHide: "Hide",
      skView: "Details",
      skCopy: "Copy",
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
      cfgTitle: "Kit (dsh-kit)",
      cfgDesc: "Feature switches, shortcuts and kit settings.",
      cfgGroupSidebar: "Sidebars",
      cfgTerminalEnabled: "Enable terminal",
      cfgTerminalEnabledHint: "Hides entry and shortcut",
      cfgFileTreeEnabled: "Enable file tree",
      cfgFileTreeEnabledHint: "Hides entry and shortcut",
      cfgChatOpenFilePreview: "Open chat files in plugin preview",
      cfgChatOpenFilePreviewHint: "Off = system default app",
      cfgSkillsPageEnabled: "Enable skills page",
      cfgSkillsPageEnabledHint: "Off = no Skills page in Settings",
      cfgSearchEnabled: "Enable web search",
      cfgSearchEnabledHint: "Off = official search (restart to apply)",
      cfgSearchMaxResults: "Search result count",
      cfgSearchMaxResultsHint: "1-8, default 2",
      cfgPhoneEnabled: "Show phone access page",
      cfgPhoneEnabledHint: "Entry for the \"Phone access\" page",
      cfgJobsEnabled: "Enable background jobs panel",
      cfgJobsEnabledHint: "Watch and stop background jobs",
      cfgBrowserEnabled: "Enable built-in browser",
      cfgBrowserEnabledHint: "Watch and operate the agent's browser (restart to apply)",
      cfgMonitorEnabled: "Enable session monitor",
      cfgMonitorEnabledHint: "Auto-continue after failures, break output dead-loops; current session only",
      cfgMonitorWaitMs: "Wait after failure (ms)",
      cfgMonitorWaitMsHint: "Wait before auto-\"Continue\" (5000-600000)",
      cfgMonitorMaxAuto: "Auto-continue limit",
      cfgMonitorMaxAutoHint: "Pause after this many consecutive resumes (1-10)",
      cfgMonitorRepeatThreshold: "Repeat threshold",
      cfgMonitorRepeatThresholdHint: "Repeated blocks counted as dead-loop (2-10)",
      monitorContinueText: "Continue",
      monitorLoopBreakText: "Your output appears to be repeating itself, which suggests an infinite loop. Stop repeating immediately, briefly state the current status, and continue the task in a different way.",
      monitorCancel: "Cancel",
      monitorRepeatErr: "repeated output (dead-loop sign)",
      monitorStopping: "Monitor: repeated output detected (dead-loop sign), stopping the current turn…",
      monitorCapped: "Monitor: auto-continued {max} times in a row, pausing auto-continue (repeats are still stopped)",
      monitorAutoIn: "Monitor: {err}; auto-continue in {sec}s (attempt {n}/{max})",
      monitorErr429: "rate limit (429)",
      monitorErrSERVER: "server error",
      monitorErrTIMEOUT: "request timeout",
      monitorErrTRANSPORT: "network transport error",
      monitorErrEMPTY_RESPONSE: "empty model response",
      cfgPreviewMaxTabs: "Max file tabs",
      cfgPreviewMaxTabsHint: "Closes the least-recently-viewed tab over the limit (1-20)",
      browserUrlPh: "Type a URL and press Enter",
      browserGo: "Go",
      browserBack: "Back",
      browserForward: "Forward",
      browserReload: "Reload",
      browserNewTab: "New tab",
      browserCloseTab: "Close tab",
      browserStarting: "Browser starting…",
      browserReconnect: "Reconnecting…",
      browserNotRunning: "Browser not started — type a URL above or wait for the agent's first use",
      browserNoPages: "No open pages — type a URL above, or the agent's next navigation will appear here",
      dockPreview: "Preview",
      dockJobs: "Background tasks",
      dockBrowser: "Browser",
      pvCloseTab: "Close this tab",
      pvDeletedNote: "File deleted — this tab shows the deletion diff only; restore it via ↩ in source control",
      rbGuideSchedDesc: "Weekly grid, todos, and a timer",
      rbGuideBrowserDesc: "Built-in browser driven by the agent",
      rbGuideJobsDesc: "Output and controls for background tasks",
      rbFeatureDisabled: "This feature is disabled in settings",
      fileTabLabel: "Files",
      vaultIdxTitle: "Knowledge base",
      browserStarting: "Starting browser…",
      browserErr: "Browser error: {error}",
      phoneGateStart: "Start gateway",
      phoneGateStop: "Stop gateway",
      phoneStoppedHint: "Gateway is off. Use \"New link\" after starting to invalidate old links.",
      cfgRemoteHint: "Non-local access: upstream pins the settings mirror to the local machine, so config stays read-only here — please view and edit it on the computer.",
      cfgPhoneRemoteDomain: "Remote domain",
      cfgPhonePort: "Gateway port",
      cfgPhonePortHint: "Gateway port, 1-65535; gateway restarts on save",
      cfgPhoneKeepGatewayOn: "Keep enabled across restarts",
      cfgPhoneKeepGatewayOnHint: "Restores last enabled state on restart",
      cfgTerminalShortcut: "Terminal shortcut",
      cfgFileTreeShortcut: "File tree shortcut",
      cfgSidebarShortcut: "Left sidebar toggle",
      cfgSourceControlEnabled: "Enable source control",
      cfgSourceControlEnabledHint: "Hides entry and shortcut",
      cfgScShortcut: "Source control shortcut",
      cfgVaultShortcut: "Knowledge base shortcut",
      cfgRightbarShortcut: "Right sidebar toggle",
      cfgCapturing: "Press a combo… (Esc to cancel)",
      cfgCapture: "Change",
      overridden: "Overridden",
      resetDefault: "Reset to default",
      save: "Save",
      saving: "Saving…",
      discard: "Discard",
      unsaved: "Unsaved",
      readOnly: "This deployment stores settings read-only.",
      loadingCfg: "Reading configuration…",
      saveFailed: "The deployment did not accept these values; they were left for you to correct.",
      invalidCombo: "One main key plus at least one modifier.",
      invalidNumber: "Out of the allowed range.",
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
      phonePortInvalid: "Port must be an integer from 1-65535",
      phoneRotate: "New link",
      phoneRotateHint: "Invalidate the current link and issue a new one; all authorized devices are signed out.",
      phoneRotated: "Link rotated; the old one is dead",
      phoneRotateFail: "Rotate failed: {error}",
      jobsTitle: "Background jobs",
      jobsEmpty: "No running background jobs.",
      jobsStatusRunning: "running",
      jobsStatusStopping: "stopping",
      jobsStatusCompleted: "completed",
      jobsStatusKilled: "cancelled",
      jobsStatusFailed: "failed",
      jobsDuration: "Running for {duration}",
      jobsKill: "Stop",
      jobsKillHint: "Stop this job (same as job_kill)",
      jobsRowClose: "Close",
      jobsRowCloseHint: "Remove from list (job has finished; display only)",
      jobsKillDone: "Stop requested",
      jobsKillFail: "Failed to stop: {error}",
      jobsClose: "Close tasks panel",
      jobsOutputEmpty: "(no output yet)",
      jobsOutputTransient: "Failed to read output: {error}",
      schedTab: "Schedule",
      schedNew: "New",
      schedToday: "Today",
      schedEdit: "Edit entry",
      schedCreate: "New entry",
      schedCreateTask: "New task",
      schedTitle: "Title",
      schedTitlePh: "Entry title…",
      schedDesc: "Notes",
      schedLoc: "Location",
      schedStart: "Start",
      schedEnd: "End",
      schedAllDay: "All day",
      schedRepeat: "Repeat",
      schedRepeatNone: "None",
      schedRepeatDaily: "Daily",
      schedRepeatWeekly: "Weekly",
      schedRepeatMonthly: "Monthly",
      schedRepeatInterval: "Every",
      schedDayUnit: "day(s)",
      schedWeekUnit: "week(s)",
      schedMonthUnit: "month(s)",
      schedRepeatUntil: "Until",
      schedColor: "Color",
      schedSave: "Save",
      schedDelete: "Delete",
      schedDeleteConfirm: "Confirm delete?",
      schedClose: "Close",
      schedTasks: "Tasks",
      schedAdd: "Add",
      schedTaskDue: "Due",
      schedNoDue: "No date",
      schedOverdue: "Overdue",
      schedTasksEmpty: "No tasks",
      schedStatsTotal: "Total time",
      schedStatsEvents: "Events",
      schedStatsDone: "Done",
      schedStatsOpen: "Open",
      schedStatsTitle: "This week",
      schedEmptyWeek: "No events this week",
      schedPickTimer: "Pick a task to time",
      schedTimerStandalone: "Standalone timer (no task)",
      schedEditEntry: "Edit timer entry",
      timerLabelPh: "What are you working on (required)",
      timerStartBtn: "Start",
      timerTitleRequired: "Name it first (standalone timers need a title)",
      timerStopConfirm: "Stop this timer?",
      timerDoneStop: "Done",
      timerStopYes: "Yes",
      timerGridBadge: "Timer",
      schedWeekdays: "Mo,Tu,We,Th,Fr,Sa,Su",
      schedDelDone: "Deleted",
      schedSaved: "Saved",
      schedOpFail: "Operation failed: {error}",
      cfgVaultEnabled: "Enable knowledge base",
      cfgVaultEnabledHint: "Composer entry: sidebar directory + right-dock page editor",
      cfgVaultRoot: "Knowledge base directory",
      cfgVaultRootHint: "Vault root absolute path; empty = dsh-kit\\knowledge in the data directory",
      vaultTitle: "Knowledge base",
      vaultNotConfigured: "Knowledge base directory not configured",
      vaultNotConfiguredHint: "Set the knowledge base directory in Settings → Plugins → dsh-kit: every md file inside becomes a page, with wiki-links and full-text search",
      vaultIndexFail: "Index failed: {error}",
      vaultHistBack: "Back",
      vaultHistFwd: "Forward",
      vaultSpaceAll: "All",
      vaultSearchPh: "Search wiki notes, Enter to run",
      vaultSearchEmpty: "No results",
      vaultSearchFail: "Search failed: {error}",
      vaultRefresh: "Refresh index and tree",
      vaultRefreshed: "Refreshed",
      vaultNewAny: "New page/folder",
      vaultNewPh: "Title, \\ prefix creates a folder, / for nesting, Enter to create",
      vaultCreate: "Create",
      vaultSaved: "Saved",
      vaultUnsaved: "Unsaved changes",
      vaultBinaryHint: "Binary file — not rendered in the vault",
      vaultCopy: "Copy",
      vaultCopied: "Copied",
      vaultSaveFail: "Save failed: {error}",
      vaultConflict: "Page changed externally — latest version loaded, please retry",
      vaultBacklinks: "Backlinks",
      vaultBroken: "Page does not exist, click to create",
      vaultEmptySpace: "No pages in this space yet",
      vaultPickPage: "Pick a page on the left to start",
      vaultPageGone: "Page not found (it may have been moved or deleted)",
      vaultDelBtn: "Delete",
      vaultCiteBtn: "Cite to chat",
      vaultCited: "Inserted into composer",
      vaultCiteUnavailable: "Composer is not ready (no active session)",
      vaultDelConfirm: "Delete these pages? (Moved to recycle bin; if the vault is a git repo one commit is created so this is fully revertible)",
      vaultDeleted: "Deleted",
      vaultDelFail: "Delete failed (file locked? kept):",
      vaultConflict: "The page was modified on disk; autosave paused",
      vaultConflictOverwrite: "Overwrite disk",
      vaultConflictReload: "Load disk version",
      vaultTableAddRow: "Add row",
      vaultTableAddCol: "Add col",
      vaultTableDelRow: "Del row",
      vaultTableDelCol: "Del col",
      vaultTableDel: "Del table",
      rtePlaceholder: "Type '/' for commands",
      rteLoadFail: "Rich text engine failed to load; fell back to plain text editing",
      vmenuGHead: "Headings & text",
      vmenuH1: "Heading 1",
      vmenuH1Desc: "Level 1 heading",
      vmenuH2: "Heading 2",
      vmenuH2Desc: "Level 2 heading",
      vmenuH3: "Heading 3",
      vmenuH3Desc: "Level 3 heading",
      vmenuH4: "Heading 4",
      vmenuH4Desc: "Level 4 heading",
      vmenuH5: "Heading 5",
      vmenuH5Desc: "Level 5 heading",
      vmenuH6: "Heading 6",
      vmenuH6Desc: "Level 6 heading",
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
      vmenuGTable: "Tables",
      vmenuTable1: "1×2",
      vmenuTable1Desc: "1 row 2 cols",
      vmenuTable2: "2×2",
      vmenuTable2Desc: "2 rows 2 cols",
      vmenuTable3: "3×3",
      vmenuTable3Desc: "3 rows 3 cols",
      vmenuTable4: "4×4",
      vmenuTable4Desc: "4 rows 4 cols",
      vmenuTable5: "5×5",
      vmenuTable5Desc: "5 rows 5 cols",
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
    /** 语言判定：只认 DSH 的 locale 权威 —— <html lang> 由 dsh-client-locale 的
     *  syncDocumentLanguage 在启动与每次切换时同步（设置→通用→语言），页面内
     *  恒有值（服务端标记初始为 en）。不设 navigator.language 回退：中文系统
     *  浏览器语言恒为 zh-CN，回退会把 DSH 已切到英文的界面锁回中文（实测回归的
     *  根源）；且 DSH 自身无浏览器语言匹配时的兜底语义就是英文（FALLBACK_LOCALE），
     *  插件保持一致即可。非 zh 一律按英文渲染。 */
    function resolveZh() {
      if (typeof document === "undefined" || !document.documentElement) return false;
      return /^zh/i.test(document.documentElement.lang || "");
    }
    // 每次现读现判，不在模块加载时钉死：DSH 的 locale 服务异步把语言同步到
    // <html lang>（syncDocumentLanguage），时机晚于本 bundle 顶层执行，一次性求值
    // 会拿到旧值而把界面锁死在英文。
    const lang = () => (resolveZh() ? zh : en);
    const t = (key) => lang()[key] ?? key;
    /** 带占位符的文案变体：tf("phoneStatusOn", { port: 3090 }) */
    const tf = (key, vars) => {
      let s = lang()[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) s = s.split(`{${name}}`).join(String(value));
      return s;
    };

    // 语言切换响应：外部 store + <html lang> 的 MutationObserver。DSH 异步改写
    // <html lang> 后 bump version，组件经 useSyncExternalStore 订阅 version，
    // 变化即 re-render，届时 t/tf 已读到新语言。与上方 cfg 快照订阅同一模式。
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

    // ─────────── 样式 ───────────
    const UI_CSS = `
.dshk-dock{position:fixed;left:0;width:100%;bottom:0;height:var(--dshk-dock-h,${DOCK_H});display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-top:1px solid var(--dsw-alias-border-l1);box-shadow:0 -6px 20px rgba(0,0,0,.14);z-index:800;pointer-events:auto}
.dshk-head{flex:none;height:34px;display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-sub{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.dshk-status{color:var(--dsw-alias-label-tertiary)}
.dshk-spring{flex:1}
.dshk-btn{appearance:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);width:26px;height:26px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;padding:0}
.dshk-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-body{flex:1 1 auto;min-height:0;padding:4px 8px 8px;position:relative}
.dshk-term{height:100%}
.dshk-term .xterm{height:100%}
.dshk-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:13px}
/* 多终端：入口图标数量角标 + 标签条 + 堆叠 pane（隐藏 pane 离屏缓冲输出） */
.dshk-enbtn{position:relative}
.dshk-term-badge{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:9px;line-height:14px;text-align:center;font-weight:600}
.dshk-tabs{display:inline-flex;align-items:center;gap:2px;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dshk-tabs::-webkit-scrollbar{display:none}
.dshk-tab{display:inline-flex;align-items:center;gap:5px;flex:none;height:22px;padding:0 5px 0 9px;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;max-width:170px;user-select:none}
.dshk-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-tab-on,.dshk-tab-on:hover{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary)}
.dshk-tab-label{overflow:hidden;text-overflow:ellipsis}
.dshk-tab-x{appearance:none;border:0;background:none;color:inherit;width:15px;height:15px;border-radius:4px;font-size:10px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;visibility:hidden}
.dshk-tab:hover .dshk-tab-x,.dshk-tab-x:hover{visibility:visible}
.dshk-tab-x:hover{background:var(--dsw-alias-interactive-bg-hover)}
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
/* 文件树：作为 sidebar.workspaces 单槽 occupant 填满侧边栏浏览区（非浮层）。
   行/箭头对齐原生工作区树（Radius 8、padding 0 8、gap 6、hover 用 interactive-bg-hover） */
.dshk-tree{width:100%;height:100%;display:flex;flex-direction:column;pointer-events:auto}
.dshk-tree-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 4px 12px;font-size:13px}
/* 新建内联输入（vault createrow 同款）：头部下单行，\ 前缀建目录 */
.dshk-createrow{display:flex;gap:6px;padding:6px 8px}
.dshk-createrow input{flex:1;min-width:0;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px}
.dshk-createrow .dshk-btn{flex:none}
.dshk-row{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary);white-space:nowrap;user-select:none}
.dshk-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-chev{width:16px;flex:none;display:inline-flex;justify-content:center;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}
.dshk-ticonwrap{flex:none;display:inline-flex;align-items:center}
.dshk-arrow{transition:transform .15s var(--ds-ease-in-out);display:block}
.dshk-arrow-open{transform:rotate(90deg)}
.dshk-name{overflow:hidden;text-overflow:ellipsis}
.dshk-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:12px}
.dshk-file .dshk-name{color:var(--dsw-alias-label-secondary)}
/* 行内改名输入框（✎ 触发）：聚焦时只选中最后一个扩展名分隔符之前的主名 */
.dshk-rename{appearance:none;flex:1 1 auto;min-width:0;height:22px;box-sizing:border-box;border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1;padding:0 6px}
.dshk-rename:focus-visible{outline:none}
.dshk-note{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px}
/* 入口按钮选中态：底色用主题真实存在的 tool-bar-fill，图标转品牌色；
   :hover 一并声明避免 hover 规则在选中态下把底色洗掉 */
.dshk-enbtn[aria-pressed="true"],.dshk-enbtn[aria-pressed="true"]:hover{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-brand-primary)}
.dshk-pane-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 10px 12px}
.dshk-pane-pre{margin:0;padding:4px 0;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;tab-size:4;-webkit-overflow-scrolling:touch;user-select:text}
/* PDF 预览：pdf.js 逐页 canvas，纵向滚动（面板身即滚动容器）。懒加载：
   全量占位（第 1 页纵横比）撑出真实滚动条，进预载区才渲染 canvas、滚远释放位图；
   右下角 sticky 悬浮页码指示器（当前页实时 + 输入回车跳页） */
.dshk-pdfwrap{padding:8px 0 16px;display:flex;flex-direction:column;align-items:center}
.dshk-pdf-scroll{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}
.dshk-pdf-slot{background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);max-width:100%;display:flex;align-items:center;justify-content:center}
.dshk-pdf-slotno{color:#9a9a9a;font-size:13px;user-select:none}
/* 页码指示器挂预览面板标题栏（固定 UI 区，不遮内容），占位/canvas 全由 mountPdfViewer 管 */
.dshk-pdf-indicator{flex:none;display:flex;align-items:center;gap:2px;padding:2px 10px;border-radius:999px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-pdf-jump{width:3.2em;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:center;outline:none}
/* Excel 预览：工作表标签 + 虚拟滚动表（冻结表头 sticky、窗口渲染、固定行高列宽，
   单元格 textContent 注入免消毒） */
.dshk-sheetwrap{padding:6px 0 16px;display:flex;flex-direction:column;gap:8px}
.dshk-sheet-tabs{display:flex;gap:4px;flex-wrap:wrap}
.dshk-sheet-tab{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:2px 10px;font-size:12px;cursor:pointer;max-width:14em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-sheet-tab-on,.dshk-sheet-tab-on:hover{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary);border-color:transparent}
.dshk-sheet-scroll{flex:1 1 auto;min-height:0;overflow:auto}
.dshk-sheet-head{position:sticky;top:0;z-index:2;display:flex;width:max-content;min-width:100%;background:var(--dsw-alias-bg-base);border-bottom:2px solid var(--dsw-alias-border-l2)}
.dshk-sheet-hcell{flex:none;padding:0 8px;line-height:25px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-sheet-body{position:relative}
.dshk-sheet-window{position:absolute;left:0}
.dshk-sheet-row{display:flex;width:max-content;min-width:100%}
.dshk-sheet-cell{flex:none;padding:0 8px;line-height:25px;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-right:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-sheet-num{text-align:right;font-variant-numeric:tabular-nums}
/* docx 预览：mammoth 语义 HTML 复用 .dshk-md 排版，补表格/图片规则 */
.dshk-docwrap{padding:8px 0 16px}
.dshk-doc{max-width:72em;margin:0 auto}
.dshk-doc table,.dshk-md table{border-collapse:collapse}
.dshk-doc td,.dshk-doc th,.dshk-md td,.dshk-md th{border:1px solid var(--dsw-alias-border-l1);padding:3px 8px}
.dshk-doc img{max-width:100%}
/* 官方右栏 dock pane 正文（sidebar.right.pane.tab）：pane 内是普通文档流，
   外壳占满 100%×100%、内容区自己滚——自建舞台的 fixed 外壳与 body 让位类已退役，
   这里只剩普通文档流 */
.dshk-rbpane{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
.dshk-rbpane-scroll{overflow:auto}
.dshk-rbpane .dshk-pane-view{flex:1 1 auto;min-height:0}
.dshk-rbpane .dshk-vault-panehost{flex:1 1 auto;min-height:0}
/* 计时芯片（会话 header 工具区）：空闲=▶，运行=脉冲点+实时时长；起表浮层
   复用 .dshk-timer-pick、贴 header 右缘 */
.dshk-htimer{position:relative;display:inline-flex}
.dshk-htimer-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;cursor:pointer;font-variant-numeric:tabular-nums;white-space:nowrap}
.dshk-htimer-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-htimer-chip.is-running{color:var(--dsw-alias-brand-primary);border-color:currentColor}
.dshk-htimer-elapsed{min-width:56px;text-align:left}
.dshk-timer-pick.is-header{left:auto;right:12px;bottom:auto;top:46px}
/* 侧栏索引宿主（知识库目录/日程待办入口占 sidebar.workspaces） */
.dshk-sidehost{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;pointer-events:auto}
/* 技能管理页（settings.section）：三分组卡片；技能行单行布局，操作不换行、描述先收缩 */
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
.dshk-sk-pre{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
/* 插件设置卡（settings.plugin.item）：对齐官方 CardForm 观感 */
.dshk-cfg-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;margin:0}
.dshk-cfg-card[data-open]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dshk-cfg-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}
.dshk-cfg-headtext{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.dshk-cfg-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dshk-cfg-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dshk-cfg-pill{flex:none;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dshk-cfg-chev{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s var(--ds-ease-in-out);display:block}
.dshk-cfg-chev[data-open]{transform:rotate(180deg)}
.dshk-cfg-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dshk-cfg-field{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:.8px solid var(--dsw-alias-border-l1)}
.dshk-cfg-group ~ .dshk-cfg-group{margin-top:10px}
.dshk-cfg-grouptitle{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary);padding:6px 0 2px}
.dshk-cfg-field:last-child{border-bottom:none}
.dshk-cfg-sub{margin-left:14px}
.dshk-cfg-fieldtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dshk-cfg-label{font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary)}
.dshk-cfg-badges{display:inline-flex;align-items:center;gap:8px;flex:none;height:19px}
.dshk-cfg-badge{display:inline-flex;align-items:center;height:19px;box-sizing:border-box;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.dshk-cfg-reset{font:inherit;background:none;border:0;padding:0;height:18px;display:inline-flex;align-items:center;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dshk-cfg-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.dshk-cfg-check{flex:none;width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}
.dshk-cfg-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dshk-cfg-invalid{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dshk-cfg-status{padding:6px 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}
.dshk-cfg-combo{appearance:none;flex:1;min-width:0;font:inherit;font-family:ui-monospace,Consolas,monospace;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;line-height:1.5}
.dshk-cfg-combo:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-cfg-combo:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dshk-cfg-combo[data-capturing]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-secondary)}
.dshk-cfg-text{flex:1;min-width:0;width:200px;font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;line-height:1.5}
.dshk-cfg-num{flex:none;width:64px}
.dshk-phone-port{flex:none;width:5.5em;font-size:11px;padding:5px 8px}
.dshk-cfg-text:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dshk-cfg-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding:12px 0 4px}
.dshk-cfg-err{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.dshk-cfg-btn{appearance:none;font:inherit;cursor:pointer;font-size:13px;line-height:1.5;border-radius:8px;padding:5px 14px}
.dshk-cfg-btn-discard{background:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dshk-cfg-btn-save{border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.dshk-cfg-btn[disabled]{opacity:.5;cursor:default}
/* 手机访问页（settings.section 内联区块，与技能页同级） */
.dshk-phone{width:100%;max-width:460px}
.dshk-phone-head{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
.dshk-phone-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-phone-status{margin:0 0 10px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dshk-phone-notice{font-size:11px;line-height:1.5;color:var(--dsw-alias-brand-primary)}
.dshk-phone-body{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding-bottom:4px}
.dshk-phone-tabs{display:inline-flex;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3)}
.dshk-phone-tab{appearance:none;border:0;background:none;font:inherit;font-size:11px;line-height:1;padding:5px 12px;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-phone-tab[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);color:#fff}
.dshk-phone-qrwrap{display:flex;align-items:center;justify-content:center;min-height:120px;border-radius:10px;background:#fff;padding:6px;align-self:center}
.dshk-phone-urlrow{display:flex;align-items:center;gap:6px;width:100%}
.dshk-phone-copybtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer}
.dshk-phone-copybtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-phone-copybtn[disabled]{opacity:.5;cursor:default}
.dshk-phone-hint{margin:0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.dshk-phone-domain{display:flex;align-items:center;gap:6px;width:100%;margin-bottom:10px}
.dshk-phone-domain-label{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-phone-domain-input{flex:1;min-width:0;font-size:11px;padding:5px 8px}
.dshk-phone-gatebtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:9px 10px;border-radius:8px;cursor:pointer;width:100%;margin-bottom:10px}
.dshk-phone-rotate{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.dshk-phone-rotate:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-phone-rotate[disabled]{opacity:.5;cursor:default}
.dshk-phone-gatebtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-phone-gatebtn[disabled]{opacity:.5;cursor:default}
.dshk-phone-gatebtn-stop{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
/* 后台任务面板（任务按钮 + 居中浮层）。点击遮罩收起（kn应行为同 terminal 坞） */
/* 后台任务面板：右栏任务 pane 内容 */
.dshk-jobs-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-jobs-headside{display:flex;align-items:center;gap:6px}
.dshk-jobs-count{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dshk-jobs-close{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:1;width:22px;height:22px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dshk-jobs-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-jobs-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:1px;overflow:auto;padding:0 10px 10px}
.dshk-jobs-row{display:flex;flex-direction:column;gap:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-fill-l2,transparent)}
.dshk-jobs-row[data-live="true"]{background:var(--dsw-alias-interactive-bg-hover,transparent)}
.dshk-jobs-row[data-done="true"]{opacity:.55}
.dshk-jobs-rowline{display:flex;align-items:center;gap:8px;min-width:0}
.dshk-jobs-kind{flex:none;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:5px;padding:0 6px;font-size:11px;line-height:18px}
.dshk-jobs-label{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.dshk-jobs-status{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dshk-jobs-actions{display:flex;align-items:center;gap:6px;flex:none}
.dshk-jobs-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:1;padding:4px 9px;border-radius:6px;cursor:pointer}
.dshk-jobs-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-jobs-btn:disabled{opacity:.5;cursor:default}
.dshk-jobs-btn-kill{border-color:color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent);color:var(--dsw-alias-danger,#cd3131)}
.dshk-jobs-output{margin-top:2px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;user-select:text}
.dshk-jobs-empty{padding:10px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center}
/* 知识库（vault）：工具条+目录树投侧栏索引宿主，页编辑器投右栏 pane 宿主（拆两半 portal）。 */
   「选库进入阅读」——空间=顶层目录，树懒加载，[[wikilink]] 页内跳转带历史 */
.dshk-vault{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px}
.dshk-vault-hinttitle{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);padding:24px 16px 0;text-align:center}
.dshk-vault-hint{padding:10px 16px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;line-height:1.7}
.dshk-vault-toolbar{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-vault-tbarrow{display:flex;align-items:center;gap:6px;min-width:0}
.dshk-vault-tbpush{margin-left:auto}
.dshk-vault-spacesel{flex:1 1 auto;min-width:0;max-width:200px;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:5px 6px;border-radius:6px}
.dshk-vault-search{flex:1 1 auto;min-width:0;width:100%;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px}
.dshk-vault-searchres{flex:none;max-height:200px;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l2);padding:4px 6px;display:flex;flex-direction:column;gap:2px}
.dshk-vault-hitrow{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:6px;cursor:pointer}
.dshk-vault-hitrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-hittitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshk-vault-hitsnippet{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-vault-main{flex:1 1 auto;min-height:0;display:flex}
.dshk-vault-rail{flex:none;width:150px;border-right:1px solid var(--dsw-alias-border-l2);overflow:auto;padding:4px 3px;display:flex;flex-direction:column}
/* 知识库拆两半：目录树投进侧栏索引宿主（占满宽，无右缘线），编辑器投进右栏签；
   position:relative 是给 .dshk-vault-toast 当定位祖先的——漏了它绝对定位就锚到
   视口，提示飘在窗口底部正中，看着像没反应 */
.dshk-vault-sidewrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;width:100%;position:relative}
.dshk-vault-sidewrap .dshk-vault-rail{flex:1 1 auto;width:auto;border-right:none}
.dshk-vault-panehost{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dshk-vault-panehost .dshk-vault-reader{padding:0 2px}
/* 左轨细头部：当前空间名 + 根级新建（+ 按钮常驻淡显，悬停加深） */
.dshk-vault-railhead{display:flex;align-items:center;gap:4px;padding:2px 4px 4px;flex:none}
.dshk-vault-railtitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-treeplus{flex:none;width:17px;height:17px;line-height:15px;text-align:center;border-radius:4px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshk-vault-treeplus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-treerow:hover .dshk-vault-treeplus{visibility:visible}
.dshk-vault-railhead .dshk-vault-treeplus{visibility:visible;opacity:.6}
.dshk-vault-railhead .dshk-vault-treeplus:hover{opacity:1}
/* 树内建页输入行（出现在目标目录行下方） */
.dshk-vault-createrow{display:flex;align-items:center;gap:2px;padding:2px 4px}
.dshk-vault-createrow input{flex:1;min-width:0;font-size:12px;padding:2px 4px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dshk-vault-treerow{display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.dshk-vault-treerow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-treerow.is-active{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary)}
.dshk-vault-twist{flex:none;display:inline-block;width:10px;text-align:center;transition:transform .12s var(--ds-ease-in-out);font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-twist.is-open{transform:rotate(90deg)}
.dshk-vault-treename{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.dshk-vault-ticon{width:13px;height:13px;flex:none;opacity:.75}
.dshk-vault-treeload{padding:3px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dshk-vault-reader{flex:1 1 auto;min-width:0;overflow:auto;display:flex;flex-direction:column}
.dshk-vault-pagebar{flex:none;display:flex;justify-content:flex-end;padding:6px 10px 0}
.dshk-vault-editwrap{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;padding:8px 10px}
.dshk-vault-editbar{flex:none;display:flex;align-items:center;gap:6px;padding-bottom:6px}
.dshk-vault-crumb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:default;user-select:none}
.dshk-vault-dirtydot{flex:none;color:var(--dsw-alias-warning,#e8a13c);font-size:10px;line-height:1;margin-left:2px}
.dshk-vault-rtehost{flex:1 1 auto;min-height:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-base)}
/* 复用 .dshk-md 排版（标题/表格/引用/代码），只覆盖编辑态差异：
   滚动容器是 rtehost 自身，ProseMirror 去描边、正文区给最小高度 */
.dshk-vault-rtehost.dshk-md{flex:1 1 auto;overflow:auto;padding:12px 16px}
.dshk-vault-rtehost .ProseMirror{outline:none;min-height:60px;caret-color:var(--dsw-alias-brand-primary,#1971c2)}
.dshk-vault-rtehost h5,.dshk-vault-rtehost h6{margin:1.2em 0 .5em;line-height:1.3}
.dshk-rte-doc p.is-empty::before{content:attr(data-placeholder);color:var(--dsw-alias-label-tertiary);pointer-events:none;float:left;height:0}
.dshk-rte-anchorflash{animation:dshkRteFlash 1.5s var(--ds-ease-in-out)}
@keyframes dshkRteFlash{0%{background:rgba(25,113,194,.22)}100%{background:transparent}}
/* wikilink 复用 .dshk-vault-wl（上面已有）；碎链加波浪下划线类 */
/* 代码盒：复用 .dshk-codebox/.dshk-codebar/.dshk-codecopy（上面已有）；
   语言选择器替代只读语言标签 */
.dshk-rte-langsel{appearance:none;border:0;background:none;font:inherit;font-family:ui-monospace,Consolas,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0 2px}
.dshk-rte-langsel:hover{color:var(--dsw-alias-label-primary)}
/* 数学：KaTeX 渲染 + 点击改 tex 的内联输入 */
.dshk-rte-math{display:inline-block;cursor:pointer}
.dshk-rte-mathblock{display:block;cursor:pointer;text-align:center;margin:.6em 0}
.dshk-rte-math.is-editing,.dshk-rte-mathblock.is-editing{background:var(--dsw-alias-bg-layer-3);border-radius:6px}
.dshk-rte-math-input{font-family:ui-monospace,Consolas,monospace;font-size:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:2px 6px;min-width:120px}
.dshk-rte-mathblock .dshk-rte-math-input{width:70%}
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
/* 表格选中格高亮 + 表头底色（编辑态） */
.dshk-vault-rtehost .ProseMirror-selectedcell{outline:2px solid var(--dsw-alias-brand-primary,#1971c2)}
.dshk-vault-rtehost th{background:var(--dsw-alias-bg-layer-3)}
/* frontmatter 属性条 + CAS 冲突条 */
.dshk-vault-conflict{flex:none;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-warning,#e8a13c);padding:4px 2px 8px}
.dshk-vault-rtefallback{flex:1 1 auto;min-height:0;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.7;padding:10px 12px}
.dshk-vault-backlinks{border-top:1px dashed var(--dsw-alias-border-l2);margin:16px 0 4px;padding:8px 2px 12px;display:flex;flex-direction:column;gap:4px}
.dshk-vault-blrow{appearance:none;text-align:left;border:0;background:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 4px;border-radius:5px}
.dshk-vault-blrow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-wl{color:var(--dsw-alias-brand-primary);text-decoration:underline dotted}
.dshk-vault-wl-broken{color:var(--dsw-alias-label-tertiary);text-decoration:underline wavy}
/* 代码盒：语言条 + 复制钮（wangshu 同款）；pre 自身边距归零由盒子接管 */
.dshk-codebox{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;margin:10px 0}
.dshk-codebox pre{margin:0;border:0;border-radius:0}
.dshk-codebar{display:flex;justify-content:space-between;align-items:center;padding:4px 10px;background:rgba(135,131,120,.12);font-size:11px}
.dshk-codelang{text-transform:uppercase;letter-spacing:.4px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace}
.dshk-codecopy{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;padding:2px 6px;border-radius:5px}
.dshk-codecopy:hover{background:rgba(135,131,120,.2);color:var(--dsw-alias-label-primary)}
/* 数学公式（KaTeX 渲染结果 + 库未就绪时的原文回退） */
.dshk-md .dshk-math{color:inherit}
.dshk-md .dshk-math .katex-display{margin:.5em 0}
.dshk-vault-toast{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;padding:6px 14px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.18)}
/* 编辑增强（wangshu 三件套分工，互不重复）：编辑条=文档级命令（保存/撤销/
   重做）、泡泡菜单=选区行内格式、斜杠菜单=块插入（分类→条目，图标+标题+描述） */
.dshk-vault-tbsep{flex:none;width:1px;height:16px;background:var(--dsw-alias-border-l2);margin:0 2px}
.dshk-vault-tbtn{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;min-width:24px;height:22px;padding:0 5px;border-radius:6px;cursor:pointer}
.dshk-vault-tbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-slashmenu{position:fixed;z-index:60;width:168px;max-height:300px;overflow:auto;padding:4px 0;display:flex;flex-direction:column;gap:1px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.12)}
.dshk-vault-slashitem{display:flex;align-items:center;gap:7px;padding:4px 10px;margin:0 3px;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dshk-vault-slashitem:hover,.dshk-vault-slashitem.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-vault-slashnum{flex:none;width:16px;text-align:center;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-slashicon{flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);border-radius:5px;font-size:11px;font-weight:700}
.dshk-vault-slashtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}
.dshk-vault-slashtitle{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-vault-slashdesc{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshk-vault-slashmore{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* 泡泡菜单（wangshu 同款）：选区上方浮出行内格式条；颜色/高亮点开在条下挂第二行色板 */
.dshk-vault-bubble{position:fixed;z-index:60;display:flex;flex-direction:column;gap:4px;padding:4px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.12);transform:translateX(-50%)}
.dshk-vault-bubblebar{display:flex;align-items:center;gap:2px}
.dshk-vault-bsep{flex:none;width:1px;height:16px;background:var(--dsw-alias-border-l2);margin:0 2px}
.dshk-vault-bbtn{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;min-width:26px;height:26px;padding:0 4px;border-radius:6px;cursor:pointer}
.dshk-vault-bbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-vault-bbtn.is-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dshk-vault-bswatchrow{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;border-top:1px solid var(--dsw-alias-border-l1);padding-top:4px}
.dshk-vault-bswatch{flex:none;width:20px;height:20px;border-radius:4px;border:1px solid rgba(0,0,0,.12);cursor:pointer;padding:0}
.dshk-vault-bswatch-clear{appearance:none;border:0;background:none;font:inherit;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px 6px;align-self:center}
.dshk-vault-bswatch-clear:hover{color:var(--dsw-alias-label-primary)}
.dshk-vault-slashback{padding:4px 10px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-bottom:1px dashed var(--dsw-alias-border-l1);margin-bottom:2px}
.dshk-vault-slashback:hover{color:var(--dsw-alias-label-primary)}
.dshk-vault-slashmore{font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* 日程模块：中心区第三 tab——周时间网格 + 待办/统计侧栏；计时芯片挂输入区 dock */
.dshk-sched-root{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;--dshk-sched-band:52px}
.dshk-sched-head{flex:none;display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-title{font-weight:600;font-size:15px}
.dshk-sched-weeknav{display:flex;align-items:center;gap:6px}
.dshk-sched-weeklabel{min-width:104px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshk-sched-navbtn{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-navbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sched-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;min-width:0}
/* y 轴 mandatory 吸附到整点行：静止位置恒为「某小时标签贴在表头带下方」，
标签既不会被 sticky 角格盖掉半截，也不会漂进表头区（2026-09-06 两轮反馈的根治）；
scroll-padding 与 --dshk-sched-band 绑定，改带高只需改一处 */
.dshk-sched-gridwrap{flex:1 1 auto;min-width:0;overflow:auto;scroll-snap-type:y mandatory;scroll-padding-top:calc(var(--dshk-sched-band) + 4px)}
/* 顶部 8px 是 00:00 行与表头带的呼吸空间（s=0 时) */
.dshk-sched-gridinner{padding-top:8px}
/* 每日列宽跟随坞宽（minmax(0,1fr) 均分），不设网格 min-width——设了的话窄坞
（下限 480，(480-52)/7≈61px/天）会横向滚动只露出四-五天；事件/全天chip均有
ellipsis，窄列只截字不破版 */
.dshk-sched-grid{display:grid;grid-template-columns:52px repeat(7,minmax(0,1fr))}
.dshk-sched-corner{position:sticky;top:0;z-index:3;height:var(--dshk-sched-band);box-sizing:border-box;background:var(--dsw-alias-bg-base)}
.dshk-sched-dayhead{position:sticky;top:0;z-index:3;box-sizing:border-box;height:var(--dshk-sched-band);text-align:center;padding:6px 0 4px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-wd{display:block;font-size:11px;color:var(--dshk-sched-wdcolor,var(--dsw-alias-label-tertiary))}
.dshk-sched-dnum{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;font-size:12px;margin-top:2px}
.dshk-sched-dayhead.is-today .dshk-sched-dnum{background:var(--dsw-alias-brand-primary);color:#fff}
.dshk-sched-allday{grid-row:2;border-left:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);padding:2px 4px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l2);border-radius:4px;margin:2px 2px;min-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-sched-timeline{border-right:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-hourlabel{height:42px;padding-right:6px;font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:right;scroll-snap-align:start}
.dshk-sched-daycol{position:relative;border-left:1px solid var(--dsw-alias-border-l2);min-width:0}
.dshk-sched-cell{box-sizing:border-box;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 55%,transparent);cursor:pointer}
.dshk-sched-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-nowline{position:absolute;left:0;right:0;height:2px;background:var(--dsw-alias-danger,#cd3131);z-index:2;pointer-events:none}
.dshk-sched-nowline::before{content:"";position:absolute;left:-4px;top:-3px;width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-danger,#cd3131)}
.dshk-sched-event{position:absolute;z-index:1;overflow:hidden;border-radius:6px;padding:2px 6px;color:#fff;font-size:11px;line-height:1.35;cursor:pointer;background:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,#fff 30%,transparent);box-sizing:border-box}
.dshk-sched-event:hover{filter:brightness(1.08)}
/* 短段（按比例高度不足 18px）：紧凑排版把下限压到 14px 仍容得下单行标题，
   高度尽量贴合真实时长比例（border-box 后渲染高度=style 高度，不再被 padding 抬高） */
.dshk-sched-event.is-thin{padding:1px 4px;line-height:1.15;border-radius:4px}
.dshk-sched-evtitle{display:block;font-size:10px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
/* 够高的块（≥48px）标题放开两行，行数由 line-clamp 限死——
   短块维持单行省略，避免半截字被容器裁掉 */
.dshk-sched-event.is-tall .dshk-sched-evtitle{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;word-break:break-word;line-clamp:2}
/* 上条下网（用户定稿 2026-09-06）：待办/统计横条在上，周网格在下吃满坞宽 */
.dshk-sched-sidecol{flex:0 0 240px;min-width:0;display:flex;flex-direction:column;gap:10px;padding:10px;border-right:1px solid var(--dsw-alias-border-l2);overflow:auto}
/* 日程：待办卡与周网格同住日程 pane（待办列表在左列） */
.dshk-sched-sidewrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;width:100%;overflow:auto;padding:6px}
.dshk-sched-sidewrap .dshk-sched-card.is-tasks{flex:1 1 auto}
.dshk-sched-card.is-tasks{flex:1 1 auto;min-width:0}
.dshk-sched-card.is-stats{flex:none;width:230px}
.dshk-sched-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-3)}
.dshk-sched-cardtitle{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-cardhead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
.dshk-sched-taskinput{flex:1;min-width:0;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px}
.dshk-sched-taskdue{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:4px 6px;border-radius:6px}
.dshk-sched-task{display:flex;align-items:center;gap:7px;padding:4px 4px;border-radius:6px}
.dshk-sched-task:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-tasktitle{flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;cursor:pointer;font-size:12px}
.dshk-sched-taskduebadge{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:1px 5px}
.dshk-sched-taskduebadge.is-overdue{color:var(--dsw-alias-danger,#cd3131);border-color:color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent)}
.dshk-sched-tasktimer{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;width:20px;height:20px;border-radius:999px;cursor:pointer;flex:none}
.dshk-sched-tasktimer:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dshk-sched-emptytasks{font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:8px 0}
.dshk-sched-statsgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dshk-sched-stat{display:flex;flex-direction:column;gap:2px}
.dshk-sched-stat b{font-size:15px;font-weight:600}
.dshk-sched-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-sched-overlay{position:fixed;inset:0;background:color-mix(in srgb,#000 45%,transparent);z-index:1000;display:flex;align-items:center;justify-content:center}
.dshk-sched-modal{width:420px;max-width:92vw;max-height:86vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 12px 40px color-mix(in srgb,#000 30%,transparent)}
/* 标题字数上限（用户定稿 2026-09-07：标题只放重要信息，细节写备注）——
   计数器悬浮输入框右缘，与 maxLength 同一常量 */
.dshk-sched-countwrap{position:relative}
.dshk-sched-countwrap .dshk-sched-input,.dshk-sched-countwrap .dshk-sched-taskinput{padding-right:44px}
.dshk-sched-count{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.dshk-sched-modaltitle{font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.dshk-sched-x{appearance:none;border:none;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;padding:4px 6px;border-radius:6px;cursor:pointer;flex:none}
.dshk-sched-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshk-sched-input{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;border-radius:6px;width:100%;box-sizing:border-box}
.dshk-sched-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
textarea.dshk-sched-input{resize:vertical}
.dshk-sched-row{display:flex;gap:10px;align-items:flex-end}
.dshk-sched-row .dshk-sched-field{flex:1;min-width:0}
.dshk-sched-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-check{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
.dshk-sched-wdchip{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-wdchip.is-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.dshk-sched-colors{display:flex;gap:6px;flex-wrap:wrap}
.dshk-sched-color{appearance:none;width:18px;height:18px;border-radius:999px;border:2px solid transparent;cursor:pointer;padding:0}
.dshk-sched-color.is-active{border-color:var(--dsw-alias-label-primary)}
.dshk-sched-actions{display:flex;align-items:center;gap:8px;margin-top:2px}
.dshk-sched-ghost{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;padding:7px 12px;border-radius:8px;cursor:pointer}
.dshk-sched-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-primary{appearance:none;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:12px;line-height:1;padding:7px 14px;border-radius:8px;cursor:pointer}
.dshk-sched-primary:disabled{opacity:.5;cursor:default}
.dshk-sched-danger{appearance:none;border:1px solid color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent);background:none;color:var(--dsw-alias-danger,#cd3131);font:inherit;font-size:12px;line-height:1;padding:7px 12px;border-radius:8px;cursor:pointer}
/* 计时：悬浮小窗（运行中且不在计时页时漂浮内容区右下，坞展开自动让位）+
   计时标签页视图 + 周网格橙色计时段（wangshu 同款 #fd7e14） */
.dshk-sched-timerdot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-danger,#cd3131);animation:dshk-sched-pulse 1.2s ease-in-out infinite}
@keyframes dshk-sched-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dshk-timer-pill{position:fixed;right:12px;bottom:14px;z-index:700;display:inline-flex;align-items:center;gap:8px;padding:7px 9px 7px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 6px 20px color-mix(in srgb,#000 22%,transparent);cursor:pointer;user-select:none}
.dshk-timer-pill:hover{border-color:var(--dsw-alias-brand-primary)}
/* 会话监视条（composer 上方细条，仅有动作时出现） */
.dshk-monitor-line{display:flex;align-items:center;gap:10px;padding:5px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 8%,transparent);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-monitor-text{flex:1;min-width:0}
.dshk-monitor-cancel{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:none;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-monitor-cancel:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
.dshk-timer-pilltitle{min-width:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-primary)}
.dshk-timer-pilltime{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dshk-timer-stopmeta{display:flex;align-items:center;gap:10px;min-width:0;margin:2px 0 8px}
.dshk-timer-stopname{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-primary)}
.dshk-timer-stopelapsed{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dshk-timer-pickback{position:fixed;inset:0;z-index:788}
.dshk-timer-pick{position:fixed;left:56px;bottom:10px;z-index:790;width:260px;max-height:60vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px;display:flex;flex-direction:column;gap:6px}
.dshk-timer-picktask{appearance:none;border:0;background:none;text-align:left;padding:6px 8px;border-radius:6px;display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;color:var(--dsw-alias-label-primary)}
.dshk-timer-picktask:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-timer-picktask .dshk-sched-tasktitle{flex:1;min-width:0}
.dshk-timer-pickrow{display:flex;gap:6px;align-items:center;margin-top:2px}
.dshk-timer-root{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:0 12px 12px}
.dshk-timer-nowline{display:flex;align-items:center;gap:7px}
.dshk-timer-nowlabel{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-timer-bigelapsed{font-family:ui-monospace,Consolas,monospace;font-size:30px;line-height:1.25;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dshk-timer-nowmeta{display:flex;align-items:center;gap:8px;min-width:0}
.dshk-timer-nowtitle{flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px;color:var(--dsw-alias-label-primary)}
.dshk-timer-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshk-timer-startrow{display:flex;gap:6px;align-items:center}
.dshk-timer-startrow .dshk-sched-taskinput{flex:1;min-width:0}
.dshk-timer-rec{display:flex;align-items:center;gap:8px;padding:4px 2px;border-radius:6px;font-size:12px}
.dshk-timer-rec:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-timer-rectitle{flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;color:var(--dsw-alias-label-primary)}
.dshk-timer-rectime{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-timer-recdur{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-timer-total{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-event.is-timed{background:color-mix(in srgb,#fd7e14 16%,transparent);color:var(--dsw-alias-label-primary);box-shadow:none;border-left:3px solid #fd7e14}
/* 内置浏览器面板：URL 栏 + 实时画面 canvas（人机共驾） */
/* 右侧标签页容器：内容视图占满（非激活标签 display:none 保挂载） */
.dshk-pane-view{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
/* 功能内容区（文件/知识库）：顶部文档签条 + 下面的内容页；签条超宽横向滚动
   （滚动条隐藏），标签多了滑过去点，不被裁掉 */
.dshk-subtabs{flex:none;display:flex;align-items:center;gap:2px;min-width:0;padding:6px 8px 4px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dshk-subtabs::-webkit-scrollbar{display:none}
.dshk-brw-tabrow,.dshk-pv-tabrow{flex:none;display:flex;align-items:center;gap:4px;padding:8px 10px 2px;min-width:0;overflow:hidden}
.dshk-brw-newtab{padding:0 7px;font-size:13px}
.dshk-brw-nav{flex:none;min-width:26px}
.dshk-jobs-btn:disabled{opacity:.4;cursor:default}
.dshk-brw-bar{display:flex;gap:6px;padding:0 12px 8px}
.dshk-brw-url{flex:1;min-width:0;font-size:12px;font-family:ui-monospace,Consolas,monospace;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.dshk-brw-url:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dshk-brw-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:0 10px 10px;overflow:hidden}
.dshk-brw-canvas{max-width:100%;height:auto;margin:auto 0;display:block;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);outline:none}
.dshk-brw-canvas:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.dshk-brw-note{padding:8px 12px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
/* 透明 IME 输入：只做组合事件宿主，视觉隐形、不拦截点击 */
.dshk-brw-ime{position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;border:0;padding:0;margin:0;outline:none;pointer-events:none;z-index:-1;background:transparent}
/* 手机触控增强：斜杠菜单（input-trigger）在触屏上滚不动/悬停粘滞的兜底。
   类名是前端构建哈希（_3e4SsG_*），升级换哈希后本段静默失效——需跟随维护。 */
@media (hover: none) {
  [class*="_3e4SsG_menu"]{touch-action:pan-y}
  [class*="_3e4SsG_viewport"]{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  [class*="_3e4SsG_item"]:hover{background:0 0}
  [class*="_3e4SsG_item"][class*="_3e4SsG_active"]{background:var(--dsw-alias-interactive-bg-hover)}
}
/* 轻提示（双击复制路径等的单例浮层） */
.dshk-toast{position:fixed;left:50%;bottom:56px;transform:translateX(-50%) translateY(8px);z-index:950;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;padding:8px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);box-shadow:0 4px 16px rgba(0,0,0,.12);opacity:0;pointer-events:none;transition:opacity .15s var(--ds-ease-in-out),transform .15s var(--ds-ease-in-out)}
.dshk-toast[data-show]{opacity:1;transform:translateX(-50%) translateY(0)}
/* 预览 Markdown 渲染视图 */
.dshk-md{flex:1;min-height:0;overflow:auto;padding:12px 16px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary);user-select:text}
.dshk-md h1,.dshk-md h2,.dshk-md h3,.dshk-md h4{margin:1.2em 0 .5em;line-height:1.3}
.dshk-md h1{font-size:1.5em}.dshk-md h2{font-size:1.3em}.dshk-md h3{font-size:1.15em}
.dshk-md p{margin:.6em 0}
.dshk-md ul,.dshk-md ol{margin:.6em 0;padding-left:1.5em}
.dshk-md code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;background:var(--dsw-alias-interactive-bg-hover);border-radius:4px;padding:.15em .35em}
.dshk-md pre{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;overflow:auto}
.dshk-md pre code{background:none;padding:0}
.dshk-md-code{margin:.6em 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.dshk-md-code pre{margin:0;border:0;border-radius:0}
.dshk-md-codebar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 10px;background:var(--dsw-alias-bg-layer-3);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-md-lang{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-md-copy{appearance:none;border:0;background:none;font:inherit;font-size:11px;line-height:1.4;cursor:pointer;color:var(--dsw-alias-label-secondary);padding:2px 6px;border-radius:4px}
.dshk-md-copy:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshk-md blockquote{margin:.6em 0;padding:2px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dshk-md table{border-collapse:collapse;margin:.6em 0;font-size:12px}
.dshk-md th,.dshk-md td{border:1px solid var(--dsw-alias-border-l2);padding:4px 10px;text-align:left}
.dshk-md img{max-width:100%}
.dshk-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:1em 0}
.dshk-md a{color:var(--dsw-alias-brand-primary)}
/* CodeMirror 宿主与语法配色令牌（明暗两套，随 data-ds-dark-theme） */
.dshk-cm-host{flex:1;min-height:0;display:flex}
.dshk-cm-host .cm-editor{flex:1;min-width:0;height:100%;background:var(--dsw-alias-bg-base)}
.dshk-cm-host .cm-scroller{overflow:auto;height:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55}
/* 短文件长行：内容区至少撑满面板高度，横向滚动条钉在面板底部而非内容中部 */
.dshk-cm-host .cm-content{min-height:100%}
/* CM6 baseTheme 自带 .cm-focused 的 1px dotted #212121 轮廓——写死的深灰虚线，点击进
   编辑器就冒出来（暗色主题下更是深底上的黑线），用户实测报「点击后多个虚线边框」。
   直接清掉：文本编辑面不需要焦点环（光标本身就是提示，当前签也标着当前文件），
   容器边框保持常态不随点击变化 */
.dshk-cm-host .cm-editor.cm-focused{outline:none}
.dshk-cm-scope{--dshk-tok-keyword:#953800;--dshk-tok-string:#0a3069;--dshk-tok-comment:#697077;--dshk-tok-number:#0550ae;--dshk-tok-fn:#8250df;--dshk-tok-type:#0550ae;--dshk-tok-operator:#953800;--dshk-tok-meta:#6639ba;--dshk-tok-link:#0550ae;--dshk-tok-heading:#0550ae}
body[data-ds-dark-theme] .dshk-cm-scope{--dshk-tok-keyword:#ff7b72;--dshk-tok-string:#a5d6ff;--dshk-tok-comment:#8b949e;--dshk-tok-number:#79c0ff;--dshk-tok-fn:#d2a8ff;--dshk-tok-type:#ffa657;--dshk-tok-operator:#ff7b72;--dshk-tok-meta:#79c0ff;--dshk-tok-link:#a5d6ff;--dshk-tok-heading:#f0883e}
/* Live Preview 调色板（亮色兜底在 vendor 主题里，这里只补暗色） */
body[data-ds-dark-theme] .dshk-cm-scope{--dshk-lp-bar:#30363d;--dshk-lp-tborder:#30363d;--dshk-lp-co-blue:#58a6ff;--dshk-lp-co-blue-bg:rgba(88,166,255,.13);--dshk-lp-co-teal:#39c5cf;--dshk-lp-co-teal-bg:rgba(57,197,207,.12);--dshk-lp-co-green:#3fb950;--dshk-lp-co-green-bg:rgba(63,185,80,.13);--dshk-lp-co-orange:#e0823d;--dshk-lp-co-orange-bg:rgba(224,130,61,.13);--dshk-lp-co-red:#f85149;--dshk-lp-co-red-bg:rgba(248,81,73,.13);--dshk-lp-co-purple:#d2a8ff;--dshk-lp-co-purple-bg:rgba(210,168,255,.13);--dshk-lp-co-gray:#8b949e;--dshk-lp-co-gray-bg:rgba(139,148,158,.15)}
.dshk-editarea.dshk-cm-host{min-height:280px}
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
.dshk-rowact{display:none;gap:2px;align-items:center;margin-left:auto}
.dshk-row:hover .dshk-rowact,.dshk-chg-row:hover .dshk-rowact{display:inline-flex}
.dshk-rowact button{appearance:none;width:20px;height:20px;font-size:11px;line-height:1;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;padding:0}
.dshk-rowact button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 行 ⋯ 菜单：fixed 全局浮层（不受树 body 滚动裁切影响），主题令牌跟随 */
.dshk-menu{position:fixed;min-width:152px;padding:4px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.18));z-index:1200;font-size:13px}
.dshk-menu > button{display:flex;width:100%;align-items:center;gap:8px;border:0;background:none;color:var(--dsw-alias-label-primary);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;white-space:nowrap}
.dshk-menu > button:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* 全文件着色 diff：完整内容内联渲染，删除红/新增绿/上下文正常 */
.dshk-inline{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all;padding:4px 0;user-select:text;color:var(--dsw-alias-label-secondary)}
.dshk-il-add{color:#0dbc79;background:rgba(13,188,121,.08)}
.dshk-il-del{color:#cd3131;background:rgba(205,49,49,.08)}
/* 「更改」清单（源代码管理视图） */
.dshk-changes{margin:2px 4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dshk-chg-head{display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px}
.dshk-diff{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;padding:4px 0;white-space:pre;overflow-x:auto;user-select:text;color:var(--dsw-alias-label-secondary)}
.dshk-diff-add{color:#0dbc79;background:rgba(13,188,121,.08)}
.dshk-diff-del{color:#cd3131;background:rgba(205,49,49,.08)}
.dshk-diff-hunk{color:#4daafc}
.dshk-diff-meta{color:var(--dsw-alias-label-tertiary)}
/* 编辑模式 */
.dshk-edithost{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px;padding:4px 10px 12px}
.dshk-editarea{flex:1 1 auto;min-height:0;width:100%;box-sizing:border-box;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;padding:8px 10px;white-space:pre;overflow:auto}
.dshk-editarea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dshk-btn-save{appearance:none;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff;border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}
.dshk-btn-save[disabled]{opacity:.6;cursor:default}
.dshk-btn-cancel{appearance:none;background:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}
.dshk-btn-cancel:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}
/* 源代码管理：分支/推送/图谱（头部工具、分支浮层、提交图谱） */
.dshk-headbtn{flex:none}
.dshk-headbtn-on{color:var(--dsw-alias-brand-primary)}
/* width:auto 覆盖 .dshk-btn 的 26px 方钮定宽——否则按钮恒 26 宽，图标与分支名
   被 flex 压成 0 宽，只剩 ▾ 可见（「源代码管理图标没了」的根因） */
.dshk-branchbtn{display:inline-flex;flex:none;width:auto;align-items:center;gap:4px;max-width:150px;padding:2px 7px;border-color:var(--dsw-alias-border-l2)}
.dshk-branchbtn .dshk-branch-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshk-caret{font-size:9px;color:var(--dsw-alias-label-tertiary)}
.dshk-pushhint{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-pushhint span{flex:1;min-width:0}
.dshk-branch{margin:2px 4px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
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
/* 分支按钮的领先/落后计数（vs 式 main ↑1↓2） */
.dshk-branch-ar{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* 分支浮层（fixed 悬浮面板）：自带内部滚动，不参与 .dshk-tree 的 flex 挤压 */
.dshk-branch-menu{width:236px;max-height:min(70vh,420px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box}
.dshk-branch-menu .dshk-branch-title{flex:none;padding:6px 10px 4px;background:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-branch-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 0}
.dshk-branch-menu .dshk-branch-new{flex:none;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
/* ⋯ 菜单禁用项 */
.dshk-menu > button[disabled]{opacity:.5;cursor:default}
.dshk-menu > button[disabled]:hover{background:none}
/* 提交图谱（结构化 lane + SVG 绘制，横向滚动；窄容器隐藏作者/时间列） */
.dshk-graph{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6;overflow-x:auto;user-select:text;padding:2px 0;container-type:inline-size}
.dshk-grow{display:flex;align-items:center;white-space:pre;padding:0 8px;min-height:24px}
.dshk-grow-click{cursor:pointer}
.dshk-grow-click:hover{background:var(--dsw-alias-interactive-bg-hover)}
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
.dshk-gdetail-head{display:flex;align-items:center;gap:8px;padding:6px 10px}
.dshk-gdetail-title{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-gmeta{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-gmeta-row{display:flex;gap:8px;align-items:baseline;font-size:12px}
.dshk-gmeta-k{flex:none;color:var(--dsw-alias-label-tertiary);width:44px}
.dshk-gmeta-date{flex:1;min-width:0;text-align:right;color:var(--dsw-alias-label-tertiary)}
.dshk-gmeta-hash{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;margin-top:2px}
.dshk-gmeta-subj{font-size:12px;color:var(--dsw-alias-label-primary);margin-top:2px}
.dshk-gmeta-body{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;margin-top:2px}
.dshk-gmeta-merge{margin-top:2px;font-size:11px;color:#e2c08d}
.dshk-gfiles-head{padding:5px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshk-gfile{display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px;cursor:pointer}
.dshk-gfile:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-gfile .dshk-name{flex:none}
.dshk-gfile .dshk-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

    /** 注入 xterm.css（link）与本插件样式（style），幂等 */
    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-kit/ui"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-kit";
        tag.dataset.pluginCss = "dsh-kit/ui";
        tag.textContent = UI_CSS;
        document.head.appendChild(tag);
      }
      if (document.querySelector('link[data-plugin-css="dsh-kit/xterm"]') === null) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.dataset.plugin = "dsh-kit";
        link.dataset.pluginCss = "dsh-kit/xterm";
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
    /** 预览增强库按需加载：md 渲染（marked+DOMPurify）/ 代码读写（CodeMirror 6）。
     *  全部走 /dsh-kit/vendor/*，不打开对应文件类型就一个字节都不下载。 */
    function ensureMdLibs() {
      const jobs = [];
      if (typeof window.marked === "undefined") jobs.push(loadScript("/dsh-kit/vendor/marked.min.js"));
      if (typeof window.DOMPurify === "undefined") jobs.push(loadScript("/dsh-kit/vendor/purify.min.js"));
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
    function ensureCmLib() {
      return typeof window.CM6 === "object" && window.CM6 !== null
        ? Promise.resolve()
        : loadScript("/dsh-kit/vendor/codemirror.bundle.js");
    }
    function ensureRteLib() {
      return typeof window.DshRTE === "object" && window.DshRTE !== null
        ? Promise.resolve()
        : loadScript("/dsh-kit/vendor/richeditor.bundle.js");
    }
    /** 解析沙箱（srcdoc iframe 新 realm，原生 Promise）。不能在宿主页面直接跑解
     *  析库：DSH 前端把 window.Promise 换成了自己的实现（外观伪装 native），pdf.js
     *  3.x 渲染管线在它上面会卡死——第 1 页渲染后所有后续 page.render() 永久
     *  pending（同浏览器同库在同源空白页 34ms 渲染成功，已二分定位）；mammoth 的
     *  转换同样是真 Promise 链。srcdoc iframe 是全新 realm、原生 Promise；不带
     *  sandbox 属性保持同源，主文档可直接调用沙箱函数、互传字节/字符串（pdf 的
     *  canvas 反着来：在主文档创建、沙箱执笔——跨文档采纳会丢位图）。 */
    const boxPromises = new Map(); // key → Promise<win>，失败即剔除可重试
    function ensureBox(key, scripts, setup) {
      const cached = boxPromises.get(key);
      if (cached) return cached;
      const p = new Promise((resolve, reject) => {
        const ifr = document.createElement("iframe");
        ifr.style.display = "none";
        ifr.srcdoc = "<!doctype html><html><head></head><body></body></html>";
        const fail = (error) => {
          boxPromises.delete(key);
          reject(error);
        };
        ifr.onload = () => {
          const win = ifr.contentWindow;
          const origin = location.origin;
          const loadAt = (i) => {
            if (i >= scripts.length) {
              try {
                if (setup) setup(win);
                resolve(win);
              } catch (error) {
                fail(error);
              }
              return;
            }
            try {
              const s = win.document.createElement("script");
              s.src = origin + scripts[i];
              s.onload = () => loadAt(i + 1);
              s.onerror = () => fail(new Error(scripts[i] + " 加载失败"));
              win.document.head.appendChild(s);
            } catch (error) {
              fail(error);
            }
          };
          loadAt(0);
        };
        ifr.onerror = () => fail(new Error("沙箱 iframe 创建失败"));
        document.body.appendChild(ifr);
      });
      boxPromises.set(key, p);
      return p;
    }
    function ensurePdfBox() {
      return ensureBox("pdf", ["/dsh-kit/vendor/pdf.min.js"], (win) => {
        win.pdfjsLib.GlobalWorkerOptions.workerSrc = location.origin + "/dsh-kit/vendor/pdf.worker.min.js";
      });
    }
    /** SheetJS 解析：打开工作簿留在沙箱（__dshkSheetOpen），按表号取**全量格式化
     *  矩阵**（__dshkSheetGet）——虚拟滚动渲染，不再生成表格 HTML。上限 5 万行 ×
     *  256 列 + 150 万单元格总量（超限裁行并标记 truncated）；列宽取自工作簿
     *  !cols（wpx/wch 换算），无则默认。raw:false 取显示文本（日期等已格式化）。 */
    function ensureSheetBox() {
      return ensureBox("sheet", ["/dsh-kit/vendor/xlsx.full.min.js"], (win) => {
        const X = win.XLSX;
        const ROW_CAP = 50000;
        const COL_CAP = 256;
        const CELL_CAP = 1500000;
        let boxWb = null;
        win.__dshkSheetOpen = (bytes) => {
          boxWb = X.read(bytes, { type: "array" });
          return boxWb.SheetNames.slice();
        };
        win.__dshkSheetGet = (idx) => {
          if (!boxWb) throw new Error("工作簿未打开");
          const name = boxWb.SheetNames[idx];
          const ws = boxWb.Sheets[name];
          const range = X.utils.decode_range(ws["!ref"] ?? "A1");
          const totalRows = range.e.r - range.s.r + 1;
          const totalCols = range.e.c - range.s.c + 1;
          const cols = Math.min(totalCols, COL_CAP);
          const rows = Math.min(totalRows, ROW_CAP, Math.max(1, Math.floor(CELL_CAP / cols)));
          range.e.c = range.s.c + cols - 1;
          range.e.r = range.s.r + rows - 1;
          // 裁剪后的工作表：范围收界；合并只保留完整落界的（虚拟滚动不跨格渲染，
          // 仅首行横向合并由渲染层单独处理）
          const merges = (ws["!merges"] ?? []).filter((m) => m.e.r <= range.e.r && m.e.c <= range.e.c);
          const clipped = Object.assign({}, ws, { "!ref": X.utils.encode_range(range), "!merges": merges });
          const matrix = X.utils.sheet_to_json(clipped, { header: 1, raw: false, defval: "" });
          const norm = matrix.map((r) => {
            const out = new Array(cols);
            for (let c = 0; c < cols; c++) out[c] = r && r[c] != null ? String(r[c]) : "";
            return out;
          });
          while (norm.length < rows) norm.push(new Array(cols).fill(""));
          const header = norm.shift() ?? new Array(cols).fill("");
          const headerSpans = merges
            .filter((m) => m.s.r === range.s.r)
            .map((m) => ({ c: m.s.c - range.s.c, span: Math.min(m.e.c, range.e.c) - m.s.c + 1 }))
            .filter((s) => s.c >= 0 && s.span > 1);
          const rawCols = ws["!cols"] ?? [];
          const colWidths = [];
          for (let c = 0; c < cols; c++) {
            const w = rawCols[c];
            if (w && w.wpx) colWidths.push(Math.min(360, Math.max(40, Math.round(w.wpx))));
            else if (w && w.wch) colWidths.push(Math.min(360, Math.max(40, Math.round(w.wch * 8 + 12))));
            else colWidths.push(110);
          }
          return {
            name,
            header,
            headerSpans,
            rows: norm,
            colWidths,
            totalRows,
            totalCols,
            shownRows: rows,
            shownCols: cols,
            truncated: totalRows > rows || totalCols > cols,
          };
        };
      });
    }
    /** mammoth 解析：docx → 语义 HTML（标题/列表/表格/粗斜体/内联 base64 图片）。
     *  jszip 用 instanceof ArrayBuffer 验型——跨 realm 会失败，须在沙箱内重建
     *  原生 ArrayBuffer 再喂给 mammoth（SheetJS 只做索引访问所以不受此限）。 */
    function ensureDocBox() {
      return ensureBox("doc", ["/dsh-kit/vendor/mammoth.browser.min.js"], (win) => {
        win.__dshkDocxParse = (bytes) => {
          const ab = new win.ArrayBuffer(bytes.length);
          new win.Uint8Array(ab).set(bytes);
          return win.mammoth.convertToHtml({ arrayBuffer: ab }).then((r) => r.value);
        };
      });
    }
    /** PDF 懒加载查看器：先按第 1 页纵横比铺全量占位（滚动条即真实页数长度），
     *  占位进入预载区（IntersectionObserver，root=滚动容器）才渲染 canvas，
     *  距所有预载区页超过 EVICT 页则释放位图——大文档内存只随视口附近页数走。
     *  页码指示器（实时当前页 + 回车跳页）挂 headSlot（面板标题栏槽位，固定区
     *  不遮内容），跳转由占位承接、滚过去即渲染。cancelled() 为真则中止；返回
     *  dispose（断观察器/监听 + 清 DOM）或 null（未建成）。 */
    async function mountPdfViewer(scrollEl, headSlot, doc, cancelled) {
      const p1 = await doc.getPage(1);
      if (cancelled()) return null;
      const vb1 = p1.getViewport({ scale: 1 });
      const total = doc.numPages;
      const scroller = scrollEl.closest(".dshk-pane-body") ?? scrollEl;
      const EVICT = 6; // 距所有预载区页超过此数才释放位图（滞回，防边界反复渲染）
      const slots = [null];
      const rendered = new Map(); // 页码 → canvas
      const pending = new Set();  // 已入队未完成
      const visible = new Set();  // 预载区内的页（observer 维护）
      const queue = [];
      let disposed = false;
      let rendering = false;
      let pageTops = null; // 各占位在滚动内容中的 offset（二分当前页/跳页用）
      let topsDirty = true;
      let currentPage = 1;
      let scrollRaf = 0;
      let resizeTimer = 0;
      let lastW = 0;

      const slotWidth = () => Math.max(280, (scrollEl.clientWidth || 480) - 20);
      const slotLabel = (p) => {
        const no = document.createElement("span");
        no.className = "dshk-pdf-slotno";
        no.textContent = String(p);
        return no;
      };
      // canvas 释放/重建尺寸后把占位还原成带页码的空白页
      const restoreSlot = (p) => {
        const slot = slots[p];
        slot.textContent = "";
        slot.appendChild(slotLabel(p));
        slot.style.aspectRatio = `${vb1.width} / ${vb1.height}`;
        topsDirty = true;
      };

      const frag = document.createDocumentFragment();
      const indicator = document.createElement("div");
      indicator.className = "dshk-pdf-indicator";
      const jump = document.createElement("input");
      jump.className = "dshk-pdf-jump";
      jump.type = "text";
      jump.inputMode = "numeric";
      jump.value = "1";
      jump.setAttribute("aria-label", t("pdfJump"));
      const totalSpan = document.createElement("span");
      totalSpan.textContent = `/ ${total}`;
      indicator.append(jump, totalSpan);
      for (let i = 1; i <= total; i++) {
        const slot = document.createElement("div");
        slot.className = "dshk-pdf-slot";
        slot.dataset.page = String(i);
        slot.appendChild(slotLabel(i));
        slots.push(slot);
        frag.appendChild(slot);
      }
      scrollEl.appendChild(frag);
      // 指示器挂标题栏槽位（React 提供挂载点）；槽位缺席时静默降级为无指示器
      if (headSlot) headSlot.appendChild(indicator);

      const applySizes = () => {
        lastW = slotWidth();
        for (let i = 1; i <= total; i++) slots[i].style.width = `${lastW}px`;
      };
      applySizes();
      for (let i = 1; i <= total; i++) slots[i].style.aspectRatio = `${vb1.width} / ${vb1.height}`;

      const nearVisible = (p, slack) => {
        for (const v of visible) if (Math.abs(p - v) <= slack) return true;
        return false;
      };
      const evictFar = () => {
        for (const [p, canvas] of rendered) {
          if (nearVisible(p, EVICT)) continue;
          canvas.remove();
          rendered.delete(p);
          restoreSlot(p);
        }
      };
      const pump = () => {
        if (rendering || disposed) return;
        let next = 0;
        while (queue.length) {
          const p = queue.shift();
          if (rendered.has(p) || !pending.has(p)) continue;
          if (visible.has(p)) { next = p; break; }
          pending.delete(p); // 已滚离预载区：丢弃，路过时 observer 会重新入队
        }
        if (!next) return;
        rendering = true;
        renderPage(next)
          .catch((error) => console.warn("[dsh-kit] pdf 页渲染失败", next, error))
          .finally(() => {
            pending.delete(next);
            rendering = false;
            if (!disposed) pump();
          });
      };
      const renderPage = async (p) => {
        const slot = slots[p];
        if (disposed || !slot || !slot.isConnected || rendered.has(p)) return;
        const page = await doc.getPage(p);
        if (disposed || rendered.has(p)) return;
        const vb = page.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const w = slotWidth();
        const viewport = page.getViewport({ scale: (w / vb.width) * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        // 混合页尺寸文档：渲染时把占位比例改成实际值，防渲染完成瞬间跳动
        slot.style.aspectRatio = `${vb.width} / ${vb.height}`;
        slot.textContent = "";
        slot.appendChild(canvas);
        rendered.set(p, canvas);
        topsDirty = true;
        // intent:"print"——续绘走微任务而非 rAF，宿主窗口被遮挡时不冻结（见 ensurePdfBox 注释）
        await page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "#ffffff", intent: "print" }).promise;
      };
      const io = new IntersectionObserver(
        (entries) => {
          if (disposed) return;
          for (const en of entries) {
            const p = Number(en.target.dataset.page);
            if (en.isIntersecting) visible.add(p);
            else visible.delete(p);
          }
          for (const p of visible) {
            if (!rendered.has(p) && !pending.has(p)) { pending.add(p); queue.push(p); }
          }
          evictFar();
          pump();
        },
        { root: scroller, rootMargin: "1500px 0px" }
      );
      for (let i = 1; i <= total; i++) io.observe(slots[i]);

      const recomputeTops = () => {
        const sRect = scroller.getBoundingClientRect();
        const st = scroller.scrollTop;
        pageTops = [0];
        for (let i = 1; i <= total; i++) pageTops[i] = slots[i].getBoundingClientRect().top - sRect.top + st;
        topsDirty = false;
      };
      const syncCurrent = () => {
        if (topsDirty || !pageTops) recomputeTops();
        const center = scroller.scrollTop + scroller.clientHeight * 0.5;
        let lo = 1;
        let hi = total;
        let ans = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (pageTops[mid] <= center) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        currentPage = ans;
        if (document.activeElement !== jump) jump.value = String(ans);
      };
      const onScroll = () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          if (!disposed) syncCurrent();
        });
      };
      scroller.addEventListener("scroll", onScroll, { passive: true });

      const jumpTo = (n) => {
        const target = Math.min(total, Math.max(1, n));
        if (topsDirty || !pageTops) recomputeTops();
        scroller.scrollTop = Math.max(0, pageTops[target] - 12);
        syncCurrent();
      };
      jump.addEventListener("focus", () => jump.select());
      jump.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { jumpTo(parseInt(jump.value, 10) || 1); jump.blur(); }
        else if (e.key === "Escape") { jump.value = String(currentPage); jump.blur(); }
      });
      jump.addEventListener("blur", () => { jump.value = String(currentPage); });

      // 面板可拖宽：宽度变化后按新宽度重摆——已渲染页全部释放重渲染，简单可靠
      const ro = new ResizeObserver(() => {
        if (disposed) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (disposed || Math.abs(slotWidth() - lastW) < 4) return;
          for (const [p, canvas] of [...rendered]) { canvas.remove(); rendered.delete(p); restoreSlot(p); }
          applySizes();
          syncCurrent();
          for (const p of visible) {
            if (!pending.has(p)) { pending.add(p); queue.push(p); }
          }
          pump();
        }, 200);
      });
      ro.observe(scrollEl);

      const teardown = () => {
        disposed = true;
        clearTimeout(resizeTimer);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        io.disconnect();
        ro.disconnect();
        scroller.removeEventListener("scroll", onScroll);
        // 只在本查看器 DOM 还挂着时清空——effect 清理可能已 innerHTML=""，
        // 而新一次 mount 已建好内容，此时再清会误伤新查看器；指示器 pill 自摘
        if (slots[1] && slots[1].isConnected) scrollEl.textContent = "";
        indicator.remove();
      };
      syncCurrent();
      return teardown;
    }
    /** Excel 虚拟滚动表：冻结表头（sticky）+ 窗口渲染——数据全量在手，只画视口
     *  附近 ±若干行，滚动时重算窗口（rAF 节流）；固定行高 + 固定列宽（来自工作
     *  簿）是窗口化的前提。单元格用 textContent 注入，天然免消毒。返回 dispose。 */
    function mountSheetTable(scrollEl, sheet) {
      scrollEl.textContent = "";
      const ROW_H = 26;
      const totalW = sheet.colWidths.reduce((a, b) => a + b, 0);
      // 冻结表头：sticky 钉在滚动口顶部，横向随内容滚动，宽度对齐列
      const head = document.createElement("div");
      head.className = "dshk-sheet-head";
      head.style.height = `${ROW_H}px`;
      const spans = new Map(sheet.headerSpans.map((s) => [s.c, s.span]));
      let c = 0;
      while (c < sheet.header.length) {
        const cell = document.createElement("div");
        cell.className = "dshk-sheet-hcell";
        const span = spans.has(c) ? spans.get(c) : 1;
        cell.style.width = `${sheet.colWidths.slice(c, c + span).reduce((a, b) => a + b, 0)}px`;
        cell.textContent = sheet.header[c] ?? "";
        head.appendChild(cell);
        c += span;
      }
      // 撑出真实滚动高度的空壳 + 绝对定位的渲染窗口
      const bodyWrap = document.createElement("div");
      bodyWrap.className = "dshk-sheet-body";
      bodyWrap.style.height = `${sheet.rows.length * ROW_H}px`;
      bodyWrap.style.width = `${totalW}px`;
      const winEl = document.createElement("div");
      winEl.className = "dshk-sheet-window";
      bodyWrap.appendChild(winEl);
      scrollEl.append(head, bodyWrap);

      let raf = 0;
      const isNumeric = (v) => /^-?[\d,.\s]+%?$/.test(v) && /\d/.test(v);
      const render = () => {
        raf = 0;
        const first = Math.max(0, Math.floor(scrollEl.scrollTop / ROW_H) - 5);
        const count = Math.ceil(scrollEl.clientHeight / ROW_H) + 11;
        const last = Math.min(sheet.rows.length, first + count);
        winEl.style.top = `${first * ROW_H}px`;
        winEl.textContent = "";
        const frag = document.createDocumentFragment();
        for (let i = first; i < last; i++) {
          const row = document.createElement("div");
          row.className = "dshk-sheet-row";
          row.style.height = `${ROW_H}px`;
          const cells = sheet.rows[i];
          for (let j = 0; j < cells.length; j++) {
            const cell = document.createElement("div");
            cell.className = "dshk-sheet-cell" + (isNumeric(cells[j]) ? " dshk-sheet-num" : "");
            cell.style.width = `${sheet.colWidths[j]}px`;
            cell.textContent = cells[j];
            cell.title = cells[j]; // 省略时悬停看全值
            row.appendChild(cell);
          }
          frag.appendChild(row);
        }
        winEl.appendChild(frag);
      };
      const onScroll = () => {
        if (!raf) raf = requestAnimationFrame(render);
      };
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
      render();
      return () => {
        if (raf) cancelAnimationFrame(raf);
        scrollEl.removeEventListener("scroll", onScroll);
      };
    }
    function extOf(p) {
      const m = /\.([a-z0-9]+)$/i.exec(String(p ?? ""));
      return m ? m[1].toLowerCase() : "";
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

    // ─────────── 轻提示 ───────────
    let toastTimer = 0;
    let toastEl = null;
    /** 轻提示：单例浮层，1.6s 自动淡出 */
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

    // ─────────── 当前会话工作区 ───────────
    // 选择器必须返回稳定引用（uSES getSnapshot 约束），派生放在选择器外。
    function useCurrentCwd(props) {
      const useSessions = props && typeof props.useSessions === "function" ? props.useSessions : null;
      const useWorkspaces = props && typeof props.useWorkspaces === "function" ? props.useWorkspaces : null;
      const current = useSessions ? useSessions((s) => s.current) : undefined;
      const summary = useSessions ? useSessions((s) => (current ? s.byId[current] : undefined)) : undefined;
      const recentId = useWorkspaces ? useWorkspaces((s) => s.recentWorkspaceId) : undefined;
      const items = useWorkspaces ? useWorkspaces((s) => s.items) : undefined;
      if (summary && typeof summary.cwd === "string" && summary.cwd.trim() !== "") return summary.cwd;
      if (items && recentId) {
        const ws = items.find((w) => w.workspaceId === recentId);
        if (ws && typeof ws.path === "string" && ws.path.trim() !== "") return ws.path;
      }
      return null;
    }

    // ─────────── 终端坞（多标签）───────────
    // TerminalPane = 一个终端会话（一条 WS/一个 pty），挂载即连接、卸载即杀；
    // TerminalDock = 底部停靠容器：头部标签条（＋ 新建 / — 隐藏），body 纵向堆叠
    // 各 pane，仅激活 pane 可见。隐藏的 pane 保持挂载：xterm 离屏继续缓冲输出，
    // 切回不丢内容（display:none 期间跳过 fit，切回由 ResizeObserver 自动补）。
    function TerminalPane({ term, visible, restartKey, onRestart, onShell }) {
      const bodyRef = react.useRef(null);
      const [state, setState] = react.useState({ phase: "connecting", detail: "" });
      const visibleRef = react.useRef(visible);
      visibleRef.current = visible;

      react.useEffect(() => {
        if (!term.cwd) {
          setState({ phase: "error", detail: t("noCwd") });
          return undefined;
        }
        let disposed = false;
        setState({ phase: "connecting", detail: "" });

        let termInst = null;
        let host = null;
        let ws = null;
        let fitAddon = null;
        let resizeTimer = 0;
        let themeObserver = null;

        const sendResize = () => {
          if (disposed || !visibleRef.current || !termInst || !fitAddon) return; // 隐藏时不 fit
          try {
            fitAddon.fit();
          } catch {
            return;
          }
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: "r", cols: termInst.cols, rows: termInst.rows }));
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
              lineHeight: 1.25,
              fontFamily: 'ui-monospace, Consolas, "Cascadia Mono", "Courier New", monospace',
              cursorBlink: true,
              scrollback: 5000,
              theme: xtermTheme(),
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
              if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d }));
            });
            ro.observe(bodyRef.current);

            ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/dsh-kit/terminal`);
            ws.onopen = () => {
              ws.send(JSON.stringify({ t: "init", cwd: term.cwd, cols: termInst.cols, rows: termInst.rows }));
            };
            ws.onmessage = (ev) => {
              let m;
              try {
                m = JSON.parse(ev.data);
              } catch {
                return;
              }
              if (!m || typeof m !== "object") return;
              if (m.t === "o" && typeof m.d === "string") {
                termInst.write(m.d);
              } else if (m.t === "started") {
                setState({ phase: "ready", detail: m.shell ?? "" });
                if (onShell) onShell(term.id, m.shell ?? "");
                if (visibleRef.current) termInst.focus(); // 后台启动的终端不抢焦点
              } else if (m.t === "exit") {
                setState({ phase: "exited", detail: String(m.exitCode ?? "") });
                termInst.write(`\r\n\x1b[90m[${t("exited")} · ${t("code")} ${m.exitCode}]\x1b[0m\r\n`);
              } else if (m.t === "error") {
                setState({ phase: "error", detail: String(m.message ?? "") });
                termInst.write(`\r\n\x1b[31m${m.message ?? ""}\x1b[0m\r\n`);
              }
            };
            ws.onclose = () => {
              if (!disposed) {
                setState((s) => (s.phase === "ready" || s.phase === "connecting" ? { phase: "exited", detail: "" } : s));
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
          if (ws) {
            ws.onclose = null;
            try {
              ws.close();
            } catch {
              // 已关闭
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
      }, [term.id, restartKey]);

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
              jsxRuntime.jsx("span", { className: "dshk-title", children: t("label") }),
              jsxRuntime.jsxs("span", { className: "dshk-tabs", children: [
                items.map((tab) =>
                  jsxRuntime.jsxs("div", {
                    className: `dshk-tab${tab.id === activeId ? " dshk-tab-on" : ""}`,
                    title: tab.cwd ?? "",
                    onClick: () => onActivate(tab.id),
                    children: [
                      jsxRuntime.jsx("span", { className: "dshk-tab-label", children: termTabLabel(tab, items) }),
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dshk-tab-x",
                        title: t("termTabClose"),
                        onClick: (e) => {
                          e.stopPropagation();
                          onKill(tab.id);
                        },
                        children: "✕",
                      }),
                    ],
                  }, tab.id),
                ),
              ] }),
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn",
                title: t("termNew"),
                onClick: onSpawn,
                children: "＋",
              }),
              activeItem
                ? jsxRuntime.jsx("span", {
                    className: "dshk-sub",
                    title: activeItem.cwd ?? "",
                    children: `${shells[activeItem.id] ? `${shells[activeItem.id]} · ` : ""}${activeItem.cwd ?? ""}`,
                  })
                : null,
              jsxRuntime.jsx("span", { className: "dshk-spring" }),
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn",
                title: t("restart"),
                onClick: () => {
                  if (!activeId) return;
                  setRestartMap((m) => ({ ...m, [activeId]: (m[activeId] ?? 0) + 1 }));
                },
                children: "⟳",
              }),
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn",
                title: t("termHide"),
                onClick: onHide,
                children: "—",
              }),
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn",
                title: t("termCloseAll"),
                onClick: onKillAll,
                children: "✕",
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


    // ─────────── 文件树 ───────────
    // 数据走宿主半边只读端点 /dsh-kit/tree（官方 browse RPC 只列目录不列文件）。
    function fetchTree(path, signal) {
      return fetch(`/dsh-kit/tree?path=${encodeURIComponent(path)}`, { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !Array.isArray(body.entries)) {
          throw new Error((body && body.error) || `HTTP ${res.status}`);
        }
        return body;
      });
    }

    /** git 状态：available:false = 非 git 目录，前端隐藏徽标；available 时含
        branch/upstream/ahead/behind/detached/unborn（宿主 status -b 分支摘要） */
    function fetchGitStatus(cwd, signal) {
      return fetch(`/dsh-kit/git/status?cwd=${encodeURIComponent(cwd)}`, { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || typeof body.available !== "boolean") {
          throw new Error(`HTTP ${res.status}`);
        }
        return body;
      });
    }
    /** git 图谱：available:false = 非 git 目录/失败；records 空数组 = 尚无提交；
        hasMore = 还有更早提交（load more 用 skip=已取条数续传） */
    function fetchGitLog(cwd, n, skip, signal) {
      const url = `/dsh-kit/git/log?cwd=${encodeURIComponent(cwd)}&n=${Number(n) || 120}&skip=${Number(skip) || 0}`;
      return fetch(url, { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || typeof body.available !== "boolean") {
          throw new Error(`HTTP ${res.status}`);
        }
        return body;
      });
    }
    /** git 单个提交详情（图谱点开行用） */
    function fetchGitShow(cwd, commit, signal) {
      return fetch(`/dsh-kit/git/show?cwd=${encodeURIComponent(cwd)}&commit=${encodeURIComponent(commit)}`, { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || typeof body.available !== "boolean") {
          throw new Error(`HTTP ${res.status}`);
        }
        return body;
      });
    }
    /** git 本地分支列表（{current, branches:[{name,isHead,upstream,track,trackParsed}]}） */
    function fetchGitBranch(cwd, signal) {
      return fetch(`/dsh-kit/git/branch?cwd=${encodeURIComponent(cwd)}`, { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || typeof body.available !== "boolean") {
          throw new Error(`HTTP ${res.status}`);
        }
        return body;
      });
    }
    /** 图谱引用装饰解析（与宿主侧 src/git.js parseDecoration 保持同步，入参为 %D 原文） */
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
      return fetch("/dsh-kit/git/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      }).then(async (res) => {
        const b = await res.json().catch(() => ({}));
        if (!res.ok || typeof b.created !== "boolean") throw new Error(b.error || `HTTP ${res.status}`);
        return b;
      });
    }

    /** 文件管理操作（新建/重命名/删除）：POST /dsh-kit/fs/op，宿主做子树与名称校验 */
    function postFsOp(payload) {
      return fetch("/dsh-kit/fs/op", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (res) => {
        const b = await res.json().catch(() => ({}));
        if (!res.ok || !b.ok) throw new Error(b.error || `HTTP ${res.status}`);
        return b;
      });
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
    const GIT_POLL_MS = 4000;

    /**
     * 把 unified patch 的 hunk 套回完整新文件内容，产出全文件着色行：
     * [type, text]，type ∈ ctx | add | del。上下文行来自新文件本体，
     * 删除行插在原位、不推进新文件游标。hunk 与内容对不上时返回 null（调用方回退原始 patch）。
     */
    function buildInlineRows(patch, newLines) {
      const lines = String(patch ?? "").split("\n");
      const rows = [];
      let idx = 0;
      let i = 0;
      let seenHunk = false;
      while (i < lines.length && !/^@@ /.test(lines[i])) i++;
      for (; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("diff ") || line.startsWith("index ")) break;
        const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (m) {
          seenHunk = true;
          const newStart = parseInt(m[1], 10);
          if (newStart < idx + 1) return null; // hunk 乱序，放弃内联
          while (idx < newStart - 1) {
            if (idx >= newLines.length) return null;
            rows.push(["ctx", newLines[idx++]]);
          }
          continue;
        }
        if (line.startsWith("+")) {
          rows.push(["add", line.slice(1)]);
          idx++;
        } else if (line.startsWith("-")) {
          rows.push(["del", line.slice(1)]);
        } else if (line.startsWith(" ")) {
          if (idx >= newLines.length) return null;
          rows.push(["ctx", newLines[idx] === undefined ? line.slice(1) : newLines[idx]]);
          idx++;
        }
        // "\ No newline at end of file" 等杂项行忽略
      }
      while (idx < newLines.length) rows.push(["ctx", newLines[idx++]]);
      return seenHunk ? rows : null;
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
     *  IconBranchOutline16 用户过目后觉得不像分支，2026-09-11 还原自绘 */
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

    /** 终端图标：与 FolderIcon 同为描边风格（16 网格），保证两个 footer 按钮观感一致 */
    /** 终端图标：与 FolderIcon 同为描边风格（16 网格），保证两个 footer 按钮观感一致
     *  （官方 IconCodeOutline16 是「代码」不是「终端」，2026-09-11 用户定稿还原自绘） */
    function TerminalIcon(props) {
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
            jsxRuntime.jsx("path", { d: "M2 4.5h12v8H2z" }),
            jsxRuntime.jsx("path", { d: "M4.4 7.2l1.8 1.3-1.8 1.3" }),
            jsxRuntime.jsx("path", { d: "M8.5 9.3h2.6" }),
          ],
        },
      );
    }

    /** 后台任务图标：正方形框（用户定稿：任务标记用方框，不要待办清单样式）。
    外框圆角方 + 顶部短横线（窗口/任务语义），与终端描边体系一致 */
    // 三个图标吃 size/className——官方开始页胶囊条目按条目状态传 22/26 号
    function JobsIcon(props) {
      // 官方 IconQueueOutline14 用户过目后觉得不合理，2026-09-11 还原自绘
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
            jsxRuntime.jsx("rect", { x: 3.2, y: 3.2, width: 9.6, height: 9.6, rx: 1.6 }),
            jsxRuntime.jsx("path", { d: "M5.4 6.3h5.2" }),
          ],
        },
      );
    }

    /** 浏览器图标：地球（圆 + 经纬弧线），与终端/任务描边体系一致 */
    function BrowserIcon(props) {
      // 官方 IconBrowseOutline16 用户过目后觉得不合理，2026-09-11 还原自绘
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
     *  树同款，2026-09-11 用户定稿「文件图标用官方的」）：按扩展名出图形；
     *  primitives 不可用时回退空位（行内不留自绘图形） */
    function FileTypeIcon16({ name }) {
      const C = dswPrimIcons ? dswPrimIcons.FileTypeIcon : null;
      const kind = C && typeof dswPrimIcons.classifyFileType === "function" ? dswPrimIcons.classifyFileType(name) : null;
      return kind ? jsxRuntime.jsx(C, { kind, size: 13 }) : null;
    }
    /** 删除图标：垃圾桶 */
    function TrashIcon(props) {
      const _official = dswIcon("IconTrashOutline16");
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
            jsxRuntime.jsx("path", { d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 10h6.6L12 4" }),
            jsxRuntime.jsx("path", { d: "M6.7 6.8v4.6M9.3 6.8v4.6" }),
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

    /** 复制相对路径图标：单矩形 + 省略点（前缀被略去） */
    function CopyRelIcon() {
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
            jsxRuntime.jsx("rect", { x: "3.5", y: "4.5", width: "9.5", height: "7.5", rx: "1" }),
            jsxRuntime.jsx("path", { d: "M6 8.25h.01M8.25 8.25h.01M10.5 8.25h.01", strokeWidth: 1.6 }),
          ],
        },
      );
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

    /** 行悬停操作小按钮（新建/重命名/删除共用）：点击不触发行本身的打开/折叠 */
    function RowActionBtn({ title, onClick, children }) {
      return jsxRuntime.jsx("button", {
        type: "button",
        title,
        onClick: (e) => {
          e.stopPropagation();
          onClick(e); // 事件转发：⋯ 菜单需要 currentTarget 定位锚点
        },
        children,
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
      // 新建/复制相对/重命名/删除收敛进 ⋯（用户定稿：留 @ 和绝对路径）
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
        // 行本身保留——空目录有"看得见"的必要（用户定稿 2026-09-07）；目录/文件
        // 图标常驻（箭头消失后空目录靠它和文件区分，2026-09-08）
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
        fetchTree(dirPath, controller.signal)
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
      // 同款槽位事件监听体，公开实例方法）：phase 须为 plain/claimed、
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
      /** 已打开的文件被改名/删除后关掉对应文件标签（含其子路径；激活位顺延） */
      const closeStalePreview = (prefix) => {
        const stale = (f) => f === prefix || f.startsWith(`${prefix}\\`) || f.startsWith(`${prefix}/`);
        const items = kitUi.files ?? [];
        const rest = items.filter((pv) => !stale(pv.path));
        if (rest.length === items.length) return;
        const patch = { files: rest };
        if (kitUi.activeFile && stale(kitUi.activeFile)) {
          patch.activeFile = rest.length > 0 ? rest[rest.length - 1].path : null;
        }
        setKitUi(patch);
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
      // 新建文件/目录单入口（用户定稿 2026-09-08，vault 同款）：内联输入，
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
      // 主名（目录/隐藏文件选全名），Enter 提交、Esc/失焦取消；改名期间面板快捷键
      // 让路（inlineEditCapture），Esc 不会顺手关掉树/预览 ──
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
        inlineEditCapture = renamingPath !== null;
        return () => {
          inlineEditCapture = false;
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
        onMenu: (entry, anchor) => setMenuFor({ entry, rect: anchor.getBoundingClientRect() }),
        renamingPath,
        onRenameSubmit: submitRename,
        onRenameCancel: cancelRename,
      };
      // ⋯ 菜单：点菜单外任意处关闭
      react.useEffect(() => {
        if (!menuFor) return undefined;
        const onDoc = (e) => {
          if (!(e.target instanceof Element) || !e.target.closest(".dshk-menu")) setMenuFor(null);
        };
        document.addEventListener("click", onDoc, true);
        return () => document.removeEventListener("click", onDoc, true);
      }, [menuFor]);

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
                ? jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-btn",
                    title: t("treeNewAny"),
                    onClick: () => startCreate(cwd),
                    children: jsxRuntime.jsx(FilePlusIcon, {}),
                  })
                : null,
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn",
                title: t("treeRefresh"),
                onClick: () => setNonce((n) => n + 1),
                children: "⟳",
              }),
            ],
          }),
          // 新建内联输入（vault 同款）：挂在头部下、目标目录由触发入口决定；
          // Enter 创建、Esc/空内容退格/区域外点击取消（✓ 按钮取消，用户定稿
          // 2026-09-08：回车即建，不需要第二确认点）
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
    function TreeRowMenu({ entry, rect, actions, onClose }) {
      react.useEffect(() => {
        const onKey = (e) => {
          if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
      }, [onClose]);
      const items = [];
      if (entry.dir && actions.onCreate) {
        items.push({ key: "nany", label: t("treeNewAny"), run: () => actions.onCreate(entry.path) });
      }
      if (actions.onCopyPath) items.push({ key: "cr", label: t("treeCopyRel"), run: () => actions.onCopyPath(entry, true) });
      if (actions.onRename) items.push({ key: "rn", label: t("treeRename"), run: () => actions.onRename(entry) });
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

    // ─────────── 分支浮层（fixed 悬浮面板，vs 式 quick-pick）───────────
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
                          ? jsxRuntime.jsx("span", { className: "dshk-branch-newtag", title: t("scBranchCreatedTag"), children: t("scBranchNewTag") })
                          : null,
                        trackBadgeFor(b),
                        jsxRuntime.jsx("span", { className: "dshk-spring" }),
                        b.isHead
                          ? jsxRuntime.jsx("span", { className: "dshk-branch-curtag", children: t("scBranchCurrent") })
                          : jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dshk-branch-del",
                              title: t("scBranchDelete"),
                              disabled: busy,
                              onClick: (e) => { e.stopPropagation(); onDelete(b.name); },
                              children: "✕",
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
    // 按钮（及 Ctrl+E）就是切换开关：树 ⇄ 源代码管理 来回切。
    // 布局：标题行（分支按钮（官方分支图形+名称）+条目数+图谱/同步/刷新）
    // →「暂存的更改」组 →「更改」组（未跟踪 U 归入更改组）；分支浮层是
    // fixed 悬浮层（不参与面板布局，更改条目再多分支也完整显示；Esc/外部点击关闭，
    // 分支列表自带滚动；新建分支输入打开即聚焦，仅新建不切换时浮层保留、新分支
    // 打「新建」标记）。非 git 目录给「初始化仓库」按钮（POST /git/init，幂等）。
    // 图谱视图（⧉ 切换）见 GitGraphPanel；同步钮 = 拉取+推送（有上游）/
    // 发布分支（无上游，push -u），失败且无上游时给「设置上游并推送」提示。
    function GitChangesPanel({ cwd, onOpenFile }) {
      const [data, setData] = react.useState(null); // null=加载中；{available, root?, entries?}
      const [initializing, setInitializing] = react.useState(false);
      const [msg, setMsg] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [collapsed, setCollapsed] = react.useState({});
      const fetchRef = react.useRef(null);
      fetchRef.current = () => {
        if (!cwd) return;
        const c = new AbortController();
        fetchGitStatus(cwd, c.signal)
          .then((b) => {
            if (!c.signal.aborted) setData(b);
          })
          .catch(() => {});
      };
      react.useEffect(() => {
        if (fetchRef.current) fetchRef.current();
        const tick = () => {
          if (document.visibilityState !== "hidden" && fetchRef.current) fetchRef.current();
        };
        const timer = window.setInterval(tick, GIT_POLL_MS);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
        };
      }, [cwd]);

      // 视图：changes（更改清单，默认）⇄ graph（提交图谱）；分支浮层内联展开
      const [view, setView] = react.useState("changes");
      const [branchOpen, setBranchOpen] = react.useState(false);
      const [branches, setBranches] = react.useState(null); // null=未加载；{current, branches[]}
      const [newBranch, setNewBranch] = react.useState("");
      const [createdBranch, setCreatedBranch] = react.useState(null); // 刚新建的分支名（列表打「新建」标记）
      const [branchBusy, setBranchBusy] = react.useState(false);
      const [pushing, setPushing] = react.useState(false);
      const [pulling, setPulling] = react.useState(false);
      // 分支浮层（fixed 悬浮）：anchor 为按钮矩形锚点 {left, top}（⋯ 菜单
      // 2026-09-11 用户定稿撤除，拉取推送收敛进 ↑↓ 同步钮）
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

      /** 推送（upstream=true 时设置上游再推，即首次推送）：失败按无上游给提示 */
      const doPush = async (withUpstream) => {
        if (pushing || !cwd || !available) return false;
        setPushing(true);
        try {
          const res = await fetch("/dsh-kit/git/op", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd, op: "push", upstream: withUpstream === true }),
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok || !b.ok) throw new Error(b.error || `HTTP ${res.status}`);
          flashToast(t("scPushDone"));
          setPushHint(false);
          if (fetchRef.current) fetchRef.current();
          return true;
        } catch (error) {
          const message = String(error?.message ?? error);
          flashToast(`${t("scPushFail")}：${message}`);
          const hintable = /no upstream/i.test(message) || /no configured push destination/i.test(message) || /couldn't find remote ref/i.test(message);
          setPushHint(hintable);
          return false;
        } finally {
          setPushing(false);
        }
      };

      /** 拉取（⋯ 菜单；缺上游/冲突等错误原文 toast）：成功后刷新状态与图谱 */
      const doPull = async () => {
        if (pulling || !cwd || !available) return false;
        setPulling(true);
        try {
          const res = await fetch("/dsh-kit/git/op", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd, op: "pull" }),
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok || !b.ok) throw new Error(b.error || `HTTP ${res.status}`);
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
          const res = await fetch("/dsh-kit/git/op", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd, ...payload }),
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok || !b.ok) throw new Error(b.error || `HTTP ${res.status}`);
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
          const res = await fetch("/dsh-kit/git/op", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd, ...payload }),
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok || !b.ok) throw new Error(b.error || `HTTP ${res.status}`);
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
        const isUntracked = String(item.xy).trim() === "?";
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
                  ? jsxRuntime.jsx("button", { type: "button", title: t("scUnstage"), disabled: busy, onClick: (e) => { e.stopPropagation(); runOp({ op: "unstage", path: item.abs }); }, children: "－" })
                  : jsxRuntime.jsx("button", { type: "button", title: t("scStage"), disabled: busy, onClick: (e) => { e.stopPropagation(); runOp({ op: "stage", path: item.abs }); }, children: "＋" }),
                !isStaged && !isUntracked
                  ? jsxRuntime.jsx("button", { type: "button", title: t("scDiscard"), disabled: busy, onClick: (e) => { e.stopPropagation(); runOp({ op: "discard", path: item.abs }, t("scDiscardConfirm")); }, children: "↩" })
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

      return jsxRuntime.jsxs("div", {
        className: "dshk-tree",
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-head",
            children: [
              // 分支按钮（vs 式：官方分支图形 + 名称，2026-09-11 用户定稿「分支
              // 按钮换成分支」；推送计数不在这里——2026-09-07 用户定稿迁同步钮）
              // 迁到独立推送按钮，分支显示不与推送语义重叠）：点击开固定悬浮分支浮层
              available && data
                ? jsxRuntime.jsx("button", {
                    type: "button",
                    ref: branchBtnRef,
                    className: "dshk-btn dshk-branchbtn" + (branchOpen ? " dshk-headbtn-on" : ""),
                    title: t("scBranch"),
                    "data-popkey": "branch",
                    "aria-pressed": branchOpen || undefined,
                    onClick: toggleBranch,
                    children: [
                      jsxRuntime.jsx(dswIcon("IconBranchOutline16") ?? BranchIcon, {}),
                      jsxRuntime.jsx("span", {
                        className: "dshk-branch-name",
                        children: data.detached === true ? t("scDetached") : data.branch || "—",
                      }),
                      jsxRuntime.jsx("span", { className: "dshk-caret", children: "▾" }),
                    ],
                  })
                : jsxRuntime.jsx("span", { className: "dshk-dir", title: root ?? "", children: t("scTitle") }),
              available && entries.length > 0
                ? jsxRuntime.jsx("span", { className: "dshk-status", children: String(entries.length) })
                : null,
              jsxRuntime.jsx("span", { className: "dshk-spring" }),
              // 同步钮（vs 式 ↑↓，2026-09-11 用户定稿接管原 ⋯ 菜单职责）：有上游=
              // 先拉后推，无上游=发布（首次推送）；错误原文 toast
              available && data && data.detached !== true
                ? jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-btn dshk-headbtn",
                    disabled: pushing || pulling || data.unborn === true,
                    title: pushing || pulling
                      ? t("saving")
                      : !data.upstream
                        ? t("scPublish")
                        : ahead > 0
                          ? t("scPushAhead").replace("{n}", String(ahead))
                          : t("scSynced"),
                    onClick: () => void (async () => {
                      if (data.upstream) {
                        const ok = await doPull();
                        if (!ok) return;
                      }
                      await doPush(!(data.upstream));
                    })(),
                    children: pushing || pulling ? "…" : ahead > 0 ? `↑${ahead}` : "↑↓",
                  })
                : null,
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn dshk-headbtn" + (view === "graph" ? " dshk-headbtn-on" : ""),
                title: t("scGraph"),
                "aria-pressed": view === "graph" || undefined,
                onClick: () => setView((v) => (v === "graph" ? "changes" : "graph")),
                children: "⧉",
              }),
              // ⋯ 操作菜单 2026-09-11 用户定稿撤除（拉取推送收敛进 ↑↓ 同步钮）
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-btn",
                title: t("treeRefresh"),
                onClick: () => {
                  if (fetchRef.current) fetchRef.current();
                  if (graphRef.current) graphRef.current();
                },
                children: "⟳",
              }),
            ],
          }),
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
                    ? jsxRuntime.jsx(GitGraphPanel, { cwd, root, refreshRef: graphRef, onOpenFile })
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
                              title: stagedList.length > 0 ? t("scCommit") : t("scCommitAll"),
                              onClick: doCommit,
                              children: t(stagedList.length > 0 ? "scCommit" : "scCommitAll"),
                            }),
                          ] }),
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
                                          jsxRuntime.jsx("span", { className: "dshk-sk-status", children: String(group.list.length) }),
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
    // 时间戳、说明、引用装饰），lane 几何由前端从父哈希计算后 SVG 绘制——同一
    // 分支线全程一色、分叉合并处曲线平滑（旧 ASCII 方案按字符列着色，分叉后同线
    // 中途变色、拐角碎裂）。行布局：图谱列 → 引用装饰 chip → 短哈希 → 说明 →
    // 作者 → 相对时间。点提交行进详情（/dsh-kit/git/show）：作者/时间/说明/文件
    // 清单，清单行可点开进右侧预览面板（A 类按未跟踪语义进原文视图）。
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

    function GitGraphPanel({ cwd, root, refreshRef, onOpenFile }) {
      const [data, setData] = react.useState(null); // null=加载中；{available, records?, hasMore?}
      const [error, setError] = react.useState(null);
      const [sel, setSel] = react.useState(null); // null=列表；否则为选中的提交哈希
      const [detail, setDetail] = react.useState(null); // null | {phase, meta?, files?}
      const [more, setMore] = react.useState(false); // load more 在途
      const fetchRef = react.useRef(null);
      fetchRef.current = () => {
        if (!cwd) return;
        const c = new AbortController();
        fetchGitLog(cwd, 200, 0, c.signal)
          .then((b) => {
            if (c.signal.aborted) return;
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
        const c = new AbortController();
        setMore(true);
        fetchGitLog(cwd, 200, Array.isArray(data.records) ? data.records.length : 0, c.signal)
          .then((b) => {
            if (c.signal.aborted) return;
            if (b.available !== true) throw new Error("unavailable");
            setData((prev) => ({
              available: true,
              root: prev && prev.root,
              records: [...(prev && Array.isArray(prev.records) ? prev.records : []), ...(Array.isArray(b.records) ? b.records : [])],
              hasMore: b.hasMore === true,
            }));
          })
          .catch(() => {})
          .finally(() => setMore(false));
      };
      // 把本面板的刷新函数暴露给父级的 ⟳
      if (refreshRef) refreshRef.current = () => fetchRef.current();
      react.useEffect(() => {
        if (fetchRef.current) fetchRef.current();
        const tick = () => {
          if (document.visibilityState !== "hidden" && fetchRef.current) fetchRef.current();
        };
        const timer = window.setInterval(tick, GIT_POLL_MS);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
        };
      }, [cwd]);

      /** 详情拉取控制器（供返回键中止在途请求） */
      const detailFetchRef = react.useRef(null);
      const openDetail = (hash) => {
        setSel(hash);
        setDetail({ phase: "loading" });
        const c = new AbortController();
        detailFetchRef.current = c;
        fetchGitShow(cwd, hash, c.signal)
          .then((b) => {
            if (c.signal.aborted) return;
            if (b.available !== true) throw new Error("unavailable");
            setDetail({ phase: "ready", meta: b.meta, files: b.files || [] });
          })
          .catch((e) => {
            if (!c.signal.aborted) setDetail({ phase: "error", error: String(e?.message ?? e) });
          });
      };
      const closeDetail = () => {
        const c = detailFetchRef.current;
        if (c) {
          try {
            c.abort();
          } catch {
            // 已结束
          }
        }
        setSel(null);
        setDetail(null);
      };

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

      // ── 提交详情子视图 ──
      if (sel !== null) {
        const isMerge = typeof detail?.meta?.parents === "string" && detail.meta.parents.trim().includes(" ");
        return jsxRuntime.jsxs("div", { className: "dshk-graph", children: [
          jsxRuntime.jsxs("div", { className: "dshk-gdetail-head", children: [
            jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-btn-cancel",
              onClick: closeDetail,
              children: t("scBack"),
            }),
            jsxRuntime.jsx("span", { className: "dshk-gdetail-title", children: t("scCommitDetail") }),
          ] }),
          detail === null || detail.phase === "loading"
            ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("treeLoading") })
            : detail.phase === "error"
              ? jsxRuntime.jsx("div", { className: "dshk-note", children: `${t("scGraphFail")}：${detail.error}` })
              : jsxRuntime.jsxs("div", { children: [
                  jsxRuntime.jsxs("div", { className: "dshk-gmeta", children: [
                    jsxRuntime.jsxs("div", { className: "dshk-gmeta-row", children: [
                      jsxRuntime.jsx("span", { className: "dshk-gmeta-k", children: t("scAuthored") }),
                      jsxRuntime.jsx("span", { children: detail.meta.an }),
                      jsxRuntime.jsx("span", { className: "dshk-gmeta-date", children: detail.meta.ad }),
                    ] }),
                    jsxRuntime.jsx("div", { className: "dshk-gmeta-hash", children: detail.meta.H }),
                    jsxRuntime.jsx("div", { className: "dshk-gmeta-subj", children: detail.meta.s }),
                    detail.meta.b
                      ? jsxRuntime.jsx("div", { className: "dshk-gmeta-body", children: detail.meta.b })
                      : null,
                    isMerge
                      ? jsxRuntime.jsx("div", { className: "dshk-gmeta-merge", children: `${t("scMergedCommit")}：${detail.meta.parents}` })
                      : null,
                  ] }),
                  jsxRuntime.jsx("div", { className: "dshk-gfiles-head", children: t("scFiles") }),
                  detail.files.length === 0
                    ? jsxRuntime.jsx("div", { className: "dshk-note", children: isMerge ? t("scMergedCommit") : t("scEmpty") })
                    : detail.files.map((f) => {
                        const st = f.st === "C" ? "R" : f.st;
                        const base = f.path.split(/[\\/]/).pop() || f.path;
                        return jsxRuntime.jsxs(
                          "div",
                          {
                            className: "dshk-gfile",
                            title: f.abs,
                            onClick: () => onOpenFile(f.abs, false, false, sel),
                            children: [
                              jsxRuntime.jsx("span", { className: "dshk-gitbadge", "data-k": st, children: st }),
                              jsxRuntime.jsx("span", { className: "dshk-name", children: base }),
                              jsxRuntime.jsx("span", { className: "dshk-dir", children: f.path }),
                            ],
                          },
                          f.path,
                        );
                      }),
                ] }),
        ] });
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
                className: "dshk-grow dshk-grow-click",
                title: `${row.rec.an} · ${fmtDate(row.rec.at)}\n${row.rec.s}`,
                onClick: () => openDetail(row.rec.H),
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

    // ─────────── 文件签（可编辑，自绘）───────────
    // 文件树/源代码管理/对话链接点文件 → 文件签（工作台定稿 2026-09-10：
    // 预览标签退役，点开即可编辑）。md 走 RteEditor（与知识库同一套 TipTap
    // WYSIWYG + 自动保存）；其余文本走 CM6 直接编辑；两套都吃同一自动保存语义
    // （2s 防抖 + Ctrl+S + 卸载保底 + mtime CAS 冲突条），保存走 /dsh-kit/write。
    // 外部修改可见性（vault 同款）：/dsh-kit/stat 轮询 mtime，无脏改时静默重读
    // ——AI 改文件页面自动跟随。PDF/Excel/docx 只读视图与 diff 视图保持原样。
    /** 把 md 里的相对/站内链接解析为可打开的绝对路径；解析不出返回 null。
     *  fromPath 为当前文件绝对路径（正反斜杠皆可），cwd 为工作区根
     *  （合成站内 / 开头链接用），href 已剥过 query/hash。 */
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
    // 内容重载（刷新浏览器 / 外部改动跟随重读 / 手动 ↻ / 冲突回读）后落回用户
    // 原本看的大致位置。每条记录 = { scrollTop, anchor }：anchor 是光标字符偏移
    // （内容变了也能落回附近），scrollTop 是精确视口位。运行时 Map + localStorage
    // 持久化（刷新之后也要在，纯内存不够）。CM6 与 RTE 两条编辑路径共用。
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
     *  用 setTimeout 不用 rAF：后台/被遮挡的窗口 rAF 会停发，定时器照走 */
    function restoreReadPos(key, el, applyAnchor) {
      const rec = readPosStore.get(key);
      if (!rec || rec.scrollTop <= 0 || !el) return;
      let tries = 0;
      const step = () => {
        tries += 1;
        if (el.getClientRects().length === 0) {
          if (tries < 300) setTimeout(step, 60);
          return;
        }
        if (el.scrollTop > 2) return;
        try { applyAnchor?.(rec.anchor); } catch { /* 选区失效按纯滚动恢复 */ }
        el.scrollTop = rec.scrollTop;
      };
      setTimeout(step, 60);
    }

    function FileEditorPane({ path, source, untracked, deleted, cwd, commit, onOpenFile }) {
      const [state, setState] = react.useState({ phase: "loading" });
      // git/diff 视图状态——xy=null 表示无变更或非仓库；diff 数据懒加载。
      // 视图模式：默认随入口（源代码管理=diff，文件树=原文；未跟踪文件没有
      // 基线，即便从 SCM 进入也默认原文），头部 ⇄ 随时互切；
      // 同一标签会话内换文件保留用户选中的模式。
      // 二进制专用预览通道（pdf/xlsx/docx）：git diff 只有 "Binary files differ"
      // 一句话——无 diff 视图
      const isPdf = /\.pdf$/i.test(path);
      const isSheet = /\.(xlsx|xlsm|xls)$/i.test(path);
      const isDoc = /\.docx$/i.test(path);
      const binaryPreview = isPdf || isSheet || isDoc;
      const isMd = /\.(md|markdown)$/i.test(path);
      const [mode, setMode] = react.useState(deleted === true || (source === "scm" && untracked !== true && !binaryPreview) ? "diff" : "text");
      const [diff, setDiff] = react.useState({ phase: "loading" });
      // 来源切换（文件树 ↔ 源代码管理）时视图模式回到该来源的默认视图：
      // 标签在 tree/scm 之间复用同一实例，mode 只随挂载初始化一次，不跟随
      // source 的话在树里看过原文后进 SCM 点文件仍是原文——来源变了
      // 默认视图就该跟着换；同一来源内换文件仍保留用户手动选中的模式。
      const sourceRef = react.useRef(source);
      react.useEffect(() => {
        if (sourceRef.current === source) return;
        sourceRef.current = source;
        setMode(deleted === true || (source === "scm" && untracked !== true && !binaryPreview) ? "diff" : "text");
      }, [source]);
      // deleted 翻转（同一文件先打开后被删 / ↩ 恢复后重开）：实例不重挂（key=path），
      // 这里手动跟上——进 deleted 强制 diff 视图并置 deleted 态；解除则重读文本
      const deletedRef = react.useRef(deleted);
      react.useEffect(() => {
        if (deletedRef.current === deleted) return;
        deletedRef.current = deleted;
        if (deleted === true) {
          setMode("diff");
          setState({ phase: "deleted" });
        } else {
          setMode(source === "scm" && untracked !== true && !binaryPreview ? "diff" : "text");
          setReloadNonce((n) => n + 1);
        }
      }, [deleted]);
      const [reloadNonce, setReloadNonce] = react.useState(0);
      // md 编辑面：frontmatter 字节级原文（保存原样拼回）+ RTE 重挂 tick + 冲突
      const [docTick, setDocTick] = react.useState(0);
      const [conflict, setConflict] = react.useState(null); // { diskMtime } | null
      const [dirtyDot, setDirtyDot] = react.useState(false);
      const rteRef = react.useRef(null);
      const rteCtlRef = react.useRef(null);
      // 文本（非 md）CM 编辑面
      const [textDraft, setTextDraft] = react.useState("");
      const [textSaved, setTextSaved] = react.useState("");
      const [saving, setSaving] = react.useState(false);
      // CM 宿主元素进 state（回调 ref，不是 ref.current）：宿主随视图切换（原文 ⇄
      // diff）会被 React 换成新节点，元素本身必须是 effect 依赖，编辑器才会重建到
      // 新宿主上——否则旧实例留在已摘除的节点上，切回来是一片空白（2026-09-10 GUI
      // 实测抓出）
      const [cmHost, setCmHost] = react.useState(null);
      const conflictRef = react.useRef(conflict);
      conflictRef.current = conflict;
      const [cmReady, setCmReady] = react.useState(false);
      // PDF 渲染态：错误信息 / 渲染完成（占位与 canvas 由 mountPdfViewer 直接管）
      const [pdfError, setPdfError] = react.useState(null);
      const [pdfDone, setPdfDone] = react.useState(false);
      // Excel 渲染态：sheetNames（非 null 即工作簿已在沙箱打开）/ sheetIdx（活动表）/
      // sheet（活动表全量矩阵，虚拟滚动渲染）/ 错误
      const [sheetNames, setSheetNames] = react.useState(null);
      const [sheetIdx, setSheetIdx] = react.useState(0);
      const [sheet, setSheet] = react.useState(null);
      const [sheetError, setSheetError] = react.useState(null);
      const sheetHostRef = react.useRef(null);
      // docx 渲染态：消毒后的语义 HTML / 错误
      const [docHtml, setDocHtml] = react.useState(null);
      const [docError, setDocError] = react.useState(null);
      const pdfHostRef = react.useRef(null);
      // 标题栏页码指示器槽位（React 只给挂载点，内容归 mountPdfViewer 命令式管理）
      const pdfIndicatorRef = react.useRef(null);
      react.useEffect(() => {
        ensureCmLib().then(() => setCmReady(true)).catch(() => {});
        return undefined;
      }, []);

      // diff 拉取（静默版）：已有内容时后台更新不闪「加载中」，数据到位再整体替换
      const diffFetchRef = react.useRef(null);
      diffFetchRef.current = () => {
        const c = new AbortController();
        const commitQ = commit ? `&commit=${encodeURIComponent(commit)}` : "";
        fetch(`/dsh-kit/git/diff?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? path)}${commitQ}`, { signal: c.signal })
          .then(async (res) => {
            const b = await res.json().catch(() => null);
            if (!res.ok || !b || b.available !== true) throw new Error(b?.error ?? `HTTP ${res.status}`);
            return b;
          })
          .then((b) => {
            if (!c.signal.aborted)
              setDiff({
                phase: "ready",
                untracked: b.untracked === true,
                clean: b.clean === true,
                base: typeof b.base === "string" ? b.base : "",
                content: typeof b.content === "string" ? b.content : undefined,
                blobMissing: b.blobMissing === true,
                text: typeof b.diff === "string" ? b.diff : null,
              });
          })
          .catch((error) => {
            if (!c.signal.aborted && error?.name !== "AbortError") setDiff({ phase: "error", error: String(error?.message ?? error) });
          });
      };
      // diff 数据（仅 diff 视图激活时）：进入时拉一次，可见期间低频静默跟随
      // （AI 边改边看也能跟上），转回可见/聚焦立即补；切回原文视图即停轮询。
      // 已删除文件即使二进制也拉（删除 diff 是一行 "Binary files differ"，可显示）。
      // commit 钉定模式的 diff 不可变（固定对某提交的第一父），拉一次即可不轮询
      react.useEffect(() => {
        if (mode !== "diff" || (binaryPreview && deleted !== true) || !cwd) return undefined;
        setDiff({ phase: "loading" });
        if (diffFetchRef.current) diffFetchRef.current();
        if (commit) return undefined;
        const tick = () => {
          if (document.visibilityState !== "hidden" && diffFetchRef.current) diffFetchRef.current();
        };
        const timer = window.setInterval(tick, GIT_POLL_MS);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
        };
      }, [mode, path, cwd, commit]);

      react.useEffect(() => {
        // 已删除文件：文本必然读不到（报错无意义），标签只承载删除 diff——
        // 不发 read 请求，直接进 deleted 态（文本面全部隐藏）
        if (deleted === true) {
          setState({ phase: "deleted" });
          return undefined;
        }
        const controller = new AbortController();
        setState({ phase: "loading" });
        fetch(`/dsh-kit/read?path=${encodeURIComponent(path)}`, { signal: controller.signal })
          .then(async (res) => {
            const body = await res.json().catch(() => null);
            if (!res.ok || !body || typeof body.content === "undefined") {
              throw new Error((body && body.error) || `HTTP ${res.status}`);
            }
            return body;
          })
          .then((body) => {
            if (controller.signal.aborted) return;
            setState({ phase: "ready", body });
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setState({ phase: "error", error: String(error?.message ?? error) });
          });
        return () => controller.abort();
      }, [path, reloadNonce, deleted]);

      const ready = state.phase === "ready" && state.body && !state.body.binary && state.body.content !== null;
      // md：frontmatter 拆分（保存原样拼回），正文交 RteEditor
      const mdParts = react.useMemo(() => (ready && isMd ? vaultSplitFrontmatter(state.body.content ?? "") : null), [ready, isMd, state.body?.content]);
      // 外部修改实时刷新（vault 同款）：无脏改、无冲突时轮询 mtime，变了静默重读
      react.useEffect(() => {
        if (state.phase !== "ready" || deleted === true) return undefined;
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          if (conflictRef.current !== null) return;
          const dirty = isMd ? (rteCtlRef.current?.dirty() ?? false) : textDirtyRef.current;
          if (dirty) return;
          void fetch(`/dsh-kit/stat?path=${encodeURIComponent(path)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => {
              if (!body || typeof body.mtimeMs !== "number") return;
              if (Math.abs(body.mtimeMs - (state.body?.mtimeMs ?? 0)) < 1) return;
              setReloadNonce((n) => n + 1);
            })
            .catch(() => {});
        }, 4000);
        return () => clearInterval(timer);
      }, [state.phase, state.body?.mtimeMs, path, deleted, isMd]);

      // ── 保存：POST /dsh-kit/write（cwd 子树校验 + mtime CAS）；409 → 冲突条
      // （覆盖盘上/读取盘上），绝不静默覆盖。mode ∈ auto|manual|overwrite ──
      const writeFile = async (content, baseMtime, mode) => {
        const res = await fetch("/dsh-kit/write", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, cwd, content, baseMtime }),
        });
        const b = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setConflict({ diskMtime: typeof b.mtimeMs === "number" ? b.mtimeMs : 0 });
          return "conflict";
        }
        if (!res.ok || !b.ok) throw new Error(b.error || `HTTP ${res.status}`);
        setConflict(null);
        setState((s) => (s.phase === "ready" && s.body ? { ...s, body: { ...s.body, content, mtimeMs: typeof b.mtimeMs === "number" ? b.mtimeMs : s.body.mtimeMs } } : s));
        if (mode === "manual") flashToast(t("editSaved"));
        return "ok";
      };
      /** md 保存（RteEditor onSave 回调）：content = frontmatter 原文 + 编辑器 md */
      const saveMd = async (bodyMd, mode) => {
        if (!mdParts) return "fail";
        try {
          return await writeFile(mdParts.fmText + bodyMd, mode === "overwrite" ? (conflictRef.current?.diskMtime ?? 0) : (state.body?.mtimeMs ?? 0), mode);
        } catch (error) {
          flashToast(`${t("editFail")}：${error?.message ?? error}`);
          return "fail";
        }
      };
      // 非 md 文本的脏判定走 ref（stat 轮询与 CM 闭包都要读最新值）
      const textDirtyRef = react.useRef(false);
      textDirtyRef.current = textDraft !== textSaved;
      const textBaseRef = react.useRef(0);
      textBaseRef.current = state.body?.mtimeMs ?? 0;
      const saveText = async (content, mode) => {
        try {
          return await writeFile(content, mode === "overwrite" ? (conflictRef.current?.diskMtime ?? 0) : textBaseRef.current, mode);
        } catch (error) {
          flashToast(`${t("editFail")}：${error?.message ?? error}`);
          return "fail";
        }
      };
      // CM 自动保存：文档变更 2s 防抖落盘；Ctrl+S 立即；卸载保底 flush
      react.useEffect(() => {
        if (!cmReady || isMd || !ready || state.body?.truncated) return undefined;
        setTextDraft(state.body.content ?? "");
        setTextSaved(state.body.content ?? "");
        return undefined;
      }, [cmReady, isMd, ready, path, reloadNonce, state.body?.content]);
      // CM 编辑面：文档变更 2s 防抖落盘；Ctrl+S 立即；卸载保底 flush。
      // 截断文件（>512KB）只读——保存会丢 512KB 之后的内容，同一个宿主分两种模式
      // （此前只读那份用另一个 ref 且从没挂到 DOM 上，截断文件等于空白编辑器）
      react.useEffect(() => {
        if (!cmReady || isMd || !cmHost || !ready) return undefined;
        const readOnly = state.body?.truncated === true;
        let timer = null;
        const h = window.CM6.create(cmHost, { doc: state.body.content ?? "", readOnly, language: extOf(path) });
        // 阅读位置：滚动节流记录 + 内容就绪后恢复（截断只读分支同样适用）
        const scrollEl = h.view?.scrollDOM ?? null;
        let posTimer = null;
        const posAnchor = () => {
          try { return h.view.state.selection.main.head; } catch { return 0; }
        };
        const onPosScroll = () => {
          if (posTimer !== null) return;
          posTimer = setTimeout(() => {
            posTimer = null;
            recordReadPos(path, scrollEl, posAnchor());
          }, 300);
        };
        scrollEl?.addEventListener("scroll", onPosScroll);
        restoreReadPos(path, scrollEl, (anchor) => {
          if (h.view && typeof anchor === "number" && anchor <= h.view.state.doc.length) h.view.dispatch({ selection: { anchor } });
        });
        const posCleanup = () => {
          if (posTimer !== null) clearTimeout(posTimer);
          scrollEl?.removeEventListener("scroll", onPosScroll);
          recordReadPos(path, scrollEl, posAnchor()); // 切页/卸载兜底记一次
        };
        if (readOnly) {
          // 只读：不装自动保存/Ctrl+S（无改动可存）
          return () => {
            posCleanup();
            h.destroy();
          };
        }
        h.onDocChanged((text) => {
          setTextDraft(text);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            void saveText(text, "auto").then((outcome) => {
              if (outcome === "ok") setTextSaved(text);
            });
          }, 2000);
        });
        const flushNow = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          return saveText(h.getDoc?.() ?? textDraftRef.current, "manual").then((outcome) => {
            if (outcome === "ok") setTextSaved(textDraftRef.current);
            return outcome;
          });
        };
        const onKeyDown = (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            e.stopPropagation();
            void flushNow();
          }
        };
        cmHost.addEventListener("keydown", onKeyDown, true);
        return () => {
          if (timer) {
            clearTimeout(timer);
            // 卸载保底：防抖未落盘的改动尽力写一次（冲突放弃）
            if (!conflictRef.current && textDraftRef.current !== textSavedRef.current) {
              void saveText(textDraftRef.current, "auto");
            }
          }
          cmHost.removeEventListener("keydown", onKeyDown, true);
          posCleanup();
          h.destroy();
        };
      }, [cmHost, cmReady, isMd, ready, path, reloadNonce, state.body?.truncated]);
      // CM 闭包用的最新草稿镜像
      const textDraftRef = react.useRef(textDraft);
      textDraftRef.current = textDraft;
      const textSavedRef = react.useRef(textSaved);
      textSavedRef.current = textSaved;

      // ── PDF 渲染：pdf.js 在 iframe 沙箱（原生 Promise realm）里画 canvas
      // （库懒加载）。查看器本体懒加载：全量占位 + 进视口渲染 + 滚远释放位图，
      // 无页数上限；canvas 建在主文档（跨文档采纳会丢位图），沙箱 pdf.js 只执笔
      react.useEffect(() => {
        if (!isPdf || state.phase !== "ready") return undefined;
        const host = pdfHostRef.current;
        if (!host) return undefined;
        let alive = true;
        let doc = null;
        let disposeUi = null;
        setPdfError(null);
        setPdfDone(false);
        const origin = location.origin;
        ensurePdfBox()
          .then((win) => {
            if (!alive) return null;
            return win.pdfjsLib
              .getDocument({
                url: `${origin}/dsh-kit/raw?path=${encodeURIComponent(path)}`,
                // 关 eval 化字体变换：pdf.js <4.2 有 FontMatrix 注入任意 JS 的路子
                // （CVE-2024-4367），沙箱与主文档同源，不关等于给恶意 PDF 开后门
                isEvalSupported: false,
                cMapUrl: `${origin}/dsh-kit/vendor/cmaps/`,
                cMapPacked: true,
                standardFontDataUrl: `${origin}/dsh-kit/vendor/standard_fonts/`,
              })
              .promise.then((d) => d);
          })
          .then((d) => {
            if (!alive || !d) return undefined;
            doc = d;
            return mountPdfViewer(host, pdfIndicatorRef.current, d, () => !alive);
          })
          .then((dispose) => {
            if (!dispose) return;
            disposeUi = dispose;
            if (alive) setPdfDone(true);
          })
          .catch((error) => {
            if (alive) setPdfError(String(error?.message ?? error));
          });
        return () => {
          alive = false;
          if (disposeUi) disposeUi();
          host.innerHTML = "";
          if (doc) doc.destroy();
        };
      }, [isPdf, state.phase, path, reloadNonce]);
      // ── Excel 渲染：fetch raw 字节 → 沙箱打开工作簿（全量留沙箱）→ 按表取矩阵
      react.useEffect(() => {
        if (!isSheet || state.phase !== "ready") return undefined;
        let alive = true;
        setSheetNames(null);
        setSheet(null);
        setSheetIdx(0);
        setSheetError(null);
        if ((state.body?.size ?? 0) > 20 * 1024 * 1024) {
          setSheetError(t("previewTooLarge"));
          return undefined;
        }
        const origin = location.origin;
        Promise.all([
          fetch(`${origin}/dsh-kit/raw?path=${encodeURIComponent(path)}`).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
          ensureSheetBox(),
        ])
          .then(([buf, win]) => setSheetNames(win.__dshkSheetOpen(new Uint8Array(buf))))
          .catch((error) => {
            if (alive) setSheetError(String(error?.message ?? error));
          });
        return () => {
          alive = false;
        };
      }, [isSheet, state.phase, path, reloadNonce]);
      // 活动表矩阵加载（工作簿留在沙箱，切表零重复解析）
      react.useEffect(() => {
        if (!isSheet || sheetNames === null) return undefined;
        let alive = true;
        setSheet(null);
        ensureSheetBox()
          .then((win) => {
            if (!alive) return;
            setSheet(win.__dshkSheetGet(Math.min(sheetIdx, sheetNames.length - 1)));
          })
          .catch((error) => {
            if (alive) setSheetError(String(error?.message ?? error));
          });
        return () => {
          alive = false;
        };
      }, [isSheet, sheetNames, sheetIdx]);
      // 矩阵 → 虚拟滚动表挂载（切表/换文件时 host 内容由 mount 自己清）
      react.useEffect(() => {
        const host = sheetHostRef.current;
        if (!isSheet || !sheet || !host) return undefined;
        return mountSheetTable(host, sheet);
      }, [isSheet, sheet]);
      // ── docx 渲染：fetch raw 字节 → mammoth 沙箱转语义 HTML → DOMPurify 消毒
      react.useEffect(() => {
        if (!isDoc || state.phase !== "ready") return undefined;
        let alive = true;
        setDocHtml(null);
        setDocError(null);
        if ((state.body?.size ?? 0) > 20 * 1024 * 1024) {
          setDocError(t("previewTooLarge"));
          return undefined;
        }
        const origin = location.origin;
        Promise.all([
          fetch(`${origin}/dsh-kit/raw?path=${encodeURIComponent(path)}`).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
          ensureDocBox(),
          ensureMdLibs(),
        ])
          .then(([buf, win]) => win.__dshkDocxParse(new Uint8Array(buf)))
          .then((html) => {
            if (!alive) return;
            setDocHtml(window.DOMPurify.sanitize(html, { ADD_DATA_URI_TAGS: ["img"] }));
          })
          .catch((error) => {
            if (alive) setDocError(String(error?.message ?? error));
          });
        return () => {
          alive = false;
        };
      }, [isDoc, state.phase, path, reloadNonce]);
      // 只读 CM 那份已并入上面（同一个宿主按 truncated 决定 readOnly）

      /** diff 视图：优先全文件着色（hunk 套回完整新像，删除红/新增绿）；
       *  截断大文件或 hunk 对不上时回退原始 patch 渲染。新像来源两分支——
       *  常规视图 = 当前盘上内容；commit 钉定模式 = 该提交时刻的内容（端点
       *  随 diff 带回，盘上已是别的版本不能叠）。commit 模式下该提交已删除的
       *  文件（新像不存在）与工作区删除文件同款纯红展示；内容缺失（过大/二进制）
       *  回落原始 patch。顶部基线说明见 renderDiffView 包装层。 */
      const renderDiffBody = () => {
        if (diff.phase === "loading") return jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentLoading") });
        if (diff.phase === "error")
          return jsxRuntime.jsx("div", { className: "dshk-note", title: diff.error, children: `${t("diffFail")}：${diff.error}` });
        if (deleted === true || (commit && diff.blobMissing === true)) {
          // 已删除文件：不看 raw diff（diff --git/index/--- 等元数据是噪音）——
          // 只抽删除行、剥掉前缀 `-`，整块按"已删除"红色展示（= 被删文件全文）。
          // commit 钉定模式下该提交已删除的文件（新像不存在）同款处理
          if (diff.clean || diff.text === null) return jsxRuntime.jsx("div", { className: "dshk-note", children: t("diffEmpty") });
          const removed = diff.text
            .split("\n")
            .filter((l) => l.startsWith("-") && !l.startsWith("---"))
            .map((l) => (l.length > 1 ? l.slice(1) : ""));
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
          // 文件的 diff 语义，避免只给一行空提示）；内容截断/未就绪时才回落提示
          const content =
            state.body && !state.body.truncated && typeof state.body.content === "string" ? state.body.content : null;
          if (content !== null) {
            return jsxRuntime.jsx(
              "div",
              {
                className: "dshk-inline",
                children: content.split("\n").map((text, i) =>
                  jsxRuntime.jsx("div", { className: "dshk-il-add", children: text === "" ? " " : text }, i),
                ),
              },
            );
          }
          return jsxRuntime.jsx("div", { className: "dshk-note", children: t("diffUntracked") });
        }
        if (diff.clean || diff.text === null) return jsxRuntime.jsx("div", { className: "dshk-note", children: t("diffEmpty") });

        // 新像：常规视图 = 当前盘上内容（read 带回）；commit 钉定 = 该提交时刻的
        // 内容（diff 响应带回，不读盘——盘上已是别的版本，套上去会错位着色）。
        // 钉定模式无新像（过大/二进制）时 null → 回落原始 patch
        const newLines =
          commit
            ? typeof diff.content === "string"
              ? diff.content.split("\n")
              : null
            : state.body && !state.body.truncated && typeof state.body.content === "string"
              ? state.body.content.split("\n")
              : null;
        const rows = newLines ? buildInlineRows(diff.text, newLines) : null;
        if (rows) {
          return jsxRuntime.jsx(
            "div",
            {
              className: "dshk-inline",
              children: rows.map(([type, text], i) =>
                jsxRuntime.jsx("div", { className: `dshk-il-${type}`, children: text === "" ? " " : text }, i),
              ),
            },
          );
        }
        const lines = diff.text.split("\n");
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

      const renderConflictbar = () =>
        conflict !== null
          ? jsxRuntime.jsxs("div", { className: "dshk-vault-conflict", children: [
              jsxRuntime.jsx("span", { children: `⚠ ${t("vaultConflict")}` }),
              jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-sched-navbtn",
                onClick: () => {
                  // 覆盖盘上：md 走 RteEditor ctl（含暂停复位），文本直接写
                  if (isMd) void rteCtlRef.current?.overwrite();
                  else void saveText(textDraftRef.current, "overwrite").then((outcome) => {
                    if (outcome === "ok") setTextSaved(textDraftRef.current);
                  });
                },
                children: t("vaultConflictOverwrite"),
              }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setReloadNonce((n) => n + 1), children: t("vaultConflictReload") }),
            ] }, "conflict")
          : null;

      let body;
      if (state.phase === "loading") {
        body = jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentLoading") });
      } else if (state.phase === "error") {
        body = jsxRuntime.jsx("div", { className: "dshk-note", title: state.error, children: `${t("contentFail")}：${state.error}` });
      } else if (state.phase === "deleted" || !state.body) {
        // 已删除（或异常无 body）：deleted 的渲染走独立分支（说明行 + diff 视图），
        // body 只兜占位——严禁在这里读 state.body 的字段（b.binary 崩溃的教训）
        body = jsxRuntime.jsx("div", { className: "dshk-note", children: state.phase === "deleted" ? t("pvDeletedNote") : t("contentLoading") });
      } else {
        const b = state.body;
        if (isPdf) {
          // PDF：pdf.js 逐页 canvas 渲染（Edge 内置查看器对 http:// 源一律灰屏，
          // iframe/顶层都不可用——见 src/index.js raw 端点注释）
          body = jsxRuntime.jsxs("div", {
            className: "dshk-pane-body dshk-pdfwrap",
            children: [
              pdfError
                ? jsxRuntime.jsx("div", { className: "dshk-note", title: pdfError, children: `${t("contentFail")}：${pdfError}` })
                : null,
              jsxRuntime.jsx("div", { className: "dshk-pdf-scroll", ref: pdfHostRef }),
              !pdfError && !pdfDone
                ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentLoading") })
                : null,
            ],
          });
        } else if (isSheet) {
          const activeIdx = sheetNames ? Math.min(sheetIdx, sheetNames.length - 1) : 0;
          body = jsxRuntime.jsxs("div", {
            className: "dshk-pane-body dshk-sheetwrap",
            children: [
              sheetError
                ? jsxRuntime.jsx("div", { className: "dshk-note", title: sheetError, children: `${t("contentFail")}：${sheetError}` })
                : null,
              sheetNames
                ? jsxRuntime.jsx(
                    "div",
                    {
                      className: "dshk-sheet-tabs",
                      children: sheetNames.map((name, i) =>
                        jsxRuntime.jsx("button", {
                          type: "button",
                          className: "dshk-sheet-tab" + (i === activeIdx ? " dshk-sheet-tab-on" : ""),
                          title: name,
                          onClick: () => setSheetIdx(i),
                          children: name,
                        }),
                      ),
                    },
                  )
                : null,
              jsxRuntime.jsx("div", { className: "dshk-sheet-scroll", ref: sheetHostRef }),
              sheet && sheet.truncated
                ? jsxRuntime.jsx("div", {
                    className: "dshk-note",
                    title: `共 ${sheet.totalRows} 行 × ${sheet.totalCols} 列，已加载前 ${sheet.shownRows} 行 × ${sheet.shownCols} 列`,
                    children: t("sheetRowCap"),
                  })
                : null,
              !sheetError && sheetNames === null
                ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentLoading") })
                : null,
            ],
          });
        } else if (isDoc) {
          body = jsxRuntime.jsxs("div", {
            className: "dshk-pane-body dshk-docwrap",
            children: [
              docError
                ? jsxRuntime.jsx("div", { className: "dshk-note", title: docError, children: `${t("contentFail")}：${docError}` })
                : null,
              docHtml !== null
                ? jsxRuntime.jsx("div", { className: "dshk-md dshk-doc", dangerouslySetInnerHTML: { __html: docHtml } })
                : null,
              !docError && docHtml === null
                ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentLoading") })
                : null,
            ],
          });
        } else if (b.binary) {
          body = jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentBinary") });
        } else if (b.content === null) {
          // 空文件（content === ""）不落这里：那是个能写的目标，给编辑器；只有
          // host 给不出文本（content 为 null）才提示空内容
          body = jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentEmpty") });
        } else {
          body = jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            b.truncated ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("contentTruncated") }) : null,
            renderConflictbar(),
            isMd
              ? jsxRuntime.jsx(RteEditor, {
                  rteRef,
                  ctlRef: rteCtlRef,
                  docKey: path,
                  docTick,
                  initialMd: mdParts?.rest.trimStart() ?? "",
                  placeholder: t("rtePlaceholder"),
                  labels: { codeCopy: t("vaultCopy"), codeCopied: t("vaultCopied") },
                  onSave: saveMd,
                  onState: (s) => setDirtyDot(s.dirty === true),
                })
              : cmReady
                ? jsxRuntime.jsx("div", { className: "dshk-editarea dshk-cm-host dshk-cm-scope", ref: setCmHost })
                : jsxRuntime.jsx("pre", { className: "dshk-pane-pre", children: b.content }),
          ] });
        }
      }

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-head",
            children: [
              // 标题行显示绝对路径（文件名已由页签 chip 承担，重复信息去掉；
              // 用户定稿 2026-09-05：同仓多目录/同名校验场景下绝对路径更有用）
              jsxRuntime.jsx("span", { className: "dshk-title", children: path }),
              // 未落盘脏点：跟在标题后（此前在编辑面提示条里，2026-09-10 用户要求
              // 去掉自动保存提示——提示没了，脏点挪过来还不丢这个信息）
              dirtyDot || textDraft !== textSaved
                ? jsxRuntime.jsx("span", { className: "dshk-vault-dirtydot", title: t("vaultUnsaved"), children: "●" })
                : null,
              jsxRuntime.jsx("span", { className: "dshk-spring" }),
              // PDF 页码指示器：挂标题栏固定区不遮内容；文档加载失败时不给槽位
              isPdf && state.phase === "ready" && !pdfError
                ? jsxRuntime.jsx("span", { ref: pdfIndicatorRef })
                : null,
              // 原文 ⇄ diff 双视图切换（同一标签，入口只决定默认视图）；
              // PDF 无 diff 视图，不显示
              !binaryPreview && deleted !== true
                ? jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-btn",
                    title: t(mode === "diff" ? "toText" : "toDiff"),
                    onClick: () => setMode((m) => (m === "diff" ? "text" : "diff")),
                    children: "⇄",
                  })
                : null,
              // PDF 新标签页兜底：手机端个别浏览器不支持 iframe 内嵌 PDF
              isPdf && state.phase === "ready"
                ? jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-btn",
                    title: t("pdfNewTab"),
                    onClick: () => window.open(`/dsh-kit/raw?path=${encodeURIComponent(path)}`, "_blank", "noopener"),
                    children: "↗",
                  })
                : null,
            ],
          }),
          deleted === true
            ? jsxRuntime.jsxs(jsxRuntime.Fragment, {
                children: [
                  jsxRuntime.jsx("div", { className: "dshk-brw-note", children: t("pvDeletedNote") }),
                  jsxRuntime.jsx("div", { className: "dshk-pane-body", children: renderDiffView() }),
                ],
              })
            : mode === "diff" && !binaryPreview
              ? jsxRuntime.jsx("div", { className: "dshk-pane-body", children: renderDiffView() })
              : body,
        ],
      });
    }

    // ─────────── 入口按钮（conversation.input.left）───────────
    // 只负责开合与按压态；面板本体在 KitSurfaces（shell.overlay）渲染。
    // 选中态标记：aria-pressed 属性选择器命中 .dshk-enbtn[aria-pressed="true"]
    // 规则（底色 + 品牌色图标）。此前用的 --dsw-alias-fill-l2 在主题里并不存在，
    // 背景解析为透明，选中态等于没有——已换成真实存在的 tool-bar-fill 令牌。
    function TerminalEntry(props) {
      const ui = useKitUi();
      const cwd = useCurrentCwd(props);
      const count = ui.terminals.length;
      const dockOn = ui.termDockOpen && count > 0;
      return jsxRuntime.jsxs("button", {
        type: "button",
        className: "dshk-btn dshk-enbtn",
        "aria-pressed": dockOn,
        title: count > 0 ? `${t("label")} · ${count}` : t("label"),
        onClick: () => {
          // 只开/关终端坞：隐藏不杀进程，后台会话继续跑；无会话时新建并绑定
          // 当时的当前会话工作区（之后切换会话不影响已开终端）
          setKitUi(toggleTermDock(kitUi, cwd));
        },
        children: [
          jsxRuntime.jsx(TerminalIcon, {}),
          count > 0
            ? jsxRuntime.jsx("span", { className: "dshk-term-badge", "aria-hidden": true, children: String(count) })
            : null,
        ],
      });
    }

    // ── 侧边栏兜底与快捷键 ──
    // 文件树/源代码管理视图承载在 sidebar.workspaces 里，侧边栏收起时只剩图标栏，
    // 视图会挤进铁轨里很难看——所以打开动作做自动展开：状态探测官方切换按钮
    // （aria-label 随状态变化，收起态是「打开侧边栏」/"Open sidebar"，注意关键字
    // 是「打开」不是「展开」），只在收起态点击——幂等且方向安全。此前优先走官方
    // 注入的 expandSidebar 回调，但该闭包捕获渲染时的 folded 状态且槽位注销后不再
    // 刷新，残留宽态实例调用是空操作（收起后首次打开不展开的根因），已整体移除。
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
    /** 快捷键用：展开/收起侧边栏切换 */
    function toggleSidebar() {
      const { btn } = sidebarBtn();
      if (btn) btn.click();
    }

    /** 文件树入口：非文件树态 → 打开文件树（顺带展开收起的侧栏）；已是 → 关闭回
     *  会话列表。走单槽互斥补丁（打开文件树同时让出源代码管理/知识库目录/日程
     *  待办那一格），关闭动作保留已打开的文件标签（标签有独立 ✕） */
    function FileTreeEntry() {
      const ui = useKitUi();
      return jsxRuntime.jsx("button", {
        type: "button",
        className: "dshk-btn dshk-enbtn",
        "aria-pressed": ui.treeOpen,
        title: t("treeLabel"),
        onClick: () => {
          if (!ui.treeOpen) expandSidebarNow();
          setKitUi(sidebarViewPatch(ui.treeOpen ? null : "tree"));
        },
        children: jsxRuntime.jsx(FolderIcon, {}),
      });
    }

    /** 源代码管理入口：同文件树语义（互斥占格，关闭保留已打开的文件标签） */
    function ScmEntry() {
      const ui = useKitUi();
      return jsxRuntime.jsx("button", {
        type: "button",
        className: "dshk-btn dshk-enbtn",
        "aria-pressed": ui.gitOpen,
        title: t("scTitle"),
        onClick: () => {
          if (!ui.gitOpen) expandSidebarNow();
          setKitUi(sidebarViewPatch(ui.gitOpen ? null : "scm"));
        },
        children: jsxRuntime.jsx(BranchIcon, {}),
      });
    }

    /** 知识库入口（输入行，源代码管理与终端之间，2026-09-10 用户定稿）：
     *  开 = 只切侧栏索引视图（点具体页才开右栏知识库签）；
     *  再点 = 侧栏回会话列表（右栏知识库签与页签不跟着关）。
     *  按钮与快捷键同语义（toggleVaultEntry） */
    function VaultEntry() {
      const ui = useKitUi();
      return jsxRuntime.jsx("button", {
        type: "button",
        className: "dshk-btn dshk-enbtn",
        "aria-pressed": ui.vaultIdxOpen,
        title: t("vaultTitle"),
        onClick: () => setKitUi(toggleVaultEntry(kitUi)),
        children: jsxRuntime.jsx(VaultIcon, {}),
      });
    }

    // ─────────── 手机访问页（settings.section，与技能页同类）───────────
    // 数据源：宿主半边 /dsh-kit/phone/info|link（rotate 无 UI 入口——轮换在
    // 宿主侧随「关闭→开启」自动触发）。这些端点挂在主 webserver
    // （只绑回环，LAN 够不到），宿主侧另有同源校验。二维码用 vendored
    // qrcode-generator（/dsh-kit/vendor/qrcode.js），首次打开面板时按需加载，
    // 与 xterm 同策略。
    function fetchPhoneInfo(signal) {
      return fetch("/dsh-kit/phone/info", { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        // 字段以宿主回包为准：visible 是页面可见性，网关状态看 gatewayOn/running
        if (!res.ok || !body || typeof body.visible !== "boolean") throw new Error(`HTTP ${res.status}`);
        return body;
      });
    }
    function fetchPhoneLinks(signal) {
      return fetch("/dsh-kit/phone/link", { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !Array.isArray(body.links)) throw new Error((body && body.error) || `HTTP ${res.status}`);
        return body;
      });
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
      const [info, setInfo] = react.useState(null);
      const [linkData, setLinkData] = react.useState(null);
      const [loadErr, setLoadErr] = react.useState("");
      const [activeIdx, setActiveIdx] = react.useState(0);
      const [qrReady, setQrReady] = react.useState(false);
      const [copied, setCopied] = react.useState(false);
      const [notice, setNotice] = react.useState("");
      const canvasRef = react.useRef(null);
      // 远程域名的页内编辑（配置卡不再承载）：草稿态 + 保存即写 settings 并刷新链接
      const [domainValue, setDomainValue] = react.useState("");
      const [domainTouched, setDomainTouched] = react.useState(false);
      const [domainSaving, setDomainSaving] = react.useState(false);
      // 网关端口页内编辑：与远程域名同一条保存链（保存后宿主按新端口重启网关）
      const [portValue, setPortValue] = react.useState("");
      const [portTouched, setPortTouched] = react.useState(false);
      // 网关启停开关（POST /dsh-kit/phone/gateway；状态文件直管，不经 settings）
      const [gateBusy, setGateBusy] = react.useState(false);
      const toggleGateway = async (next) => {
        if (gateBusy) return;
        setGateBusy(true);
        try {
          const res = await fetch("/dsh-kit/phone/gateway", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ on: next }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || typeof body.gatewayOn !== "boolean") throw new Error(`HTTP ${res.status}`);
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
        } catch {
          // 失败保持原状：下一次 info 刷新为准
        }
        setGateBusy(false);
      };
      // 手动轮换令牌：作废旧链接生成新链接（启停不再自动轮换，见宿主 setGatewayEnabled）
      const rotateLink = async () => {
        if (gateBusy) return;
        setGateBusy(true);
        try {
          const res = await fetch("/dsh-kit/phone/rotate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || !Array.isArray(body.links)) throw new Error(`HTTP ${res.status}`);
          setLinkData(body);
          setNotice(t("phoneRotated"));
          setTimeout(() => setNotice(""), 3000);
        } catch (e) {
          setNotice(tf("phoneRotateFail", { error: String(e?.message ?? e) }));
          setTimeout(() => setNotice(""), 3000);
        }
        setGateBusy(false);
      };
      const shownDomain = domainTouched
        ? domainValue
        : info && typeof info.remoteDomain === "string"
          ? info.remoteDomain
          : "";
      const shownPort = portTouched
        ? portValue
        : info && Number.isFinite(info.port)
          ? String(info.port)
          : "3090";
      const savePhoneNet = async () => {
        if (domainSaving || !cfgScope) return;
        // 端口草稿非法：阻断保存并提示（不落盘、不清草稿）
        let nextPort = null;
        if (portTouched) {
          const n = Number(String(portValue).trim());
          if (!Number.isInteger(n) || n < 1 || n > 65535) {
            setNotice(t("phonePortInvalid"));
            setTimeout(() => setNotice(""), 3000);
            return;
          }
          nextPort = n;
        }
        setDomainSaving(true);
        try {
          if (domainTouched) await cfgScope.set("phoneRemoteDomain", shownDomain.trim());
          if (nextPort !== null) await cfgScope.set("phonePort", nextPort);
          setDomainTouched(false);
          setPortTouched(false);
          setNotice(t("save") + " ✓");
          if (info !== null && info.gatewayOn && info.running) {
            fetchPhoneLinks(new AbortController().signal).then(setLinkData).catch(() => {});
          }
          // 端口变更时宿主侧重启网关是异步的：延迟刷新状态与链接跟进新端口
          if (nextPort !== null) {
            setTimeout(() => {
              fetchPhoneInfo(new AbortController().signal)
                .then((body) => {
                  setInfo(body);
                  if (body.gatewayOn && body.running) {
                    return fetchPhoneLinks(new AbortController().signal).then(setLinkData).catch(() => {});
                  }
                  return undefined;
                })
                .catch(() => {});
            }, 1200);
          }
        } catch {
          // 保存失败保持草稿供修改
        } finally {
          setDomainSaving(false);
          setTimeout(() => setNotice(""), 3000);
        }
      };

      // 打开即取状态与链接；网关未跑时只显示原因
      react.useEffect(() => {
        const ctrl = new AbortController();
        fetchPhoneInfo(ctrl.signal)
          .then((body) => {
            setInfo(body);
            if (body.gatewayOn && body.running) {
              return fetchPhoneLinks(ctrl.signal).then(setLinkData).catch((e) => setLoadErr(String(e?.message ?? e)));
            }
            return undefined;
          })
          .catch((e) => setLoadErr(String(e?.message ?? e)));
        return () => ctrl.abort();
      }, []);
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
      const activeUrl = links[activeIdx] ? links[activeIdx].url : "";
      // 链接统一出二维码（LAN/远程同等待遇）；远程链接公网可达，页面提示谨防
      // 他人扫码（见 phoneRemoteCaution）。悬停复制按钮 title 可查看完整链接。
      const activeIsRemote = !!(links[activeIdx] && links[activeIdx].label === "remote");
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
          cfgScope
            ? jsxRuntime.jsx("button", {
                type: "button",
                className: gatewayOn ? "dshk-phone-gatebtn dshk-phone-gatebtn-stop" : "dshk-phone-gatebtn",
                disabled: gateBusy,
                onClick: () => {
                  toggleGateway(!gatewayOn);
                },
                children: t(gatewayOn ? "phoneGateStop" : "phoneGateStart"),
              })
            : null,
          statusNode,
          cfgScope
            ? jsxRuntime.jsxs("div", {
                className: "dshk-phone-domain",
                children: [
                  jsxRuntime.jsx("span", { className: "dshk-phone-domain-label", children: t("cfgPhoneRemoteDomain") }),
                  jsxRuntime.jsx("input", {
                    type: "text",
                    className: "dshk-cfg-text dshk-phone-domain-input",
                    value: shownDomain,
                    placeholder: "dsh.example.com",
                    spellCheck: false,
                    disabled: domainSaving,
                    onChange: (e) => {
                      setDomainValue(e.target.value);
                      setDomainTouched(true);
                    },
                  }),
                  jsxRuntime.jsx("span", { className: "dshk-phone-domain-label", children: t("cfgPhonePort") }),
                  jsxRuntime.jsx("input", {
                    type: "number",
                    className: "dshk-cfg-text dshk-phone-port",
                    min: 1,
                    max: 65535,
                    step: 1,
                    value: shownPort,
                    title: t("cfgPhonePortHint"),
                    disabled: domainSaving,
                    onChange: (e) => {
                      setPortValue(e.target.value);
                      setPortTouched(true);
                    },
                  }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-phone-copybtn",
                    disabled: domainSaving || (!domainTouched && !portTouched),
                    onClick: () => {
                      savePhoneNet();
                    },
                    children: t("save"),
                  }),
                ],
              })
            : null,
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
                          ? jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dshk-phone-rotate",
                              title: t("phoneRotateHint"),
                              disabled: gateBusy,
                              onClick: () => {
                                rotateLink();
                              },
                              children: t("phoneRotate"),
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

    // ─────────── 后台任务面板 ───────────
    // 入口在右栏开始页条目（签带运行中计数徽标）；
    // 右栏路径由官方 dock 签承载 pane，回退路径由 KitSurfaces 在
    // shell.overlay 渲染——右栏任务签。任务数据源与官方
    // JobListAction 相同——useSessions 的 jobsBySession（session/jobs 推送）。
    // 「结束」走 dsh-kit 宿主端点（/dsh-kit/jobs/kill，权限按 session 隔离，
    // 与 job_kill 同一套 caller 语义）；输出常显，每个任务各走 /dsh-kit/jobs/
    // output 增量轮询。终态任务保留在列（session/jobs 推送本就含终态，此前是
    // 面板自己滤掉的），行动作变「关闭」=仅从显示移除，不持久化。

    /** 任务时长：中文「x分y秒」/ 英文 "x m y s"，秒级取整 */
    function fmtJobDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const seconds = total % 60;
      const minutes = Math.floor(total / 60) % 60;
      const hours = Math.floor(total / 3600);
      const zhLang = resolveZh();
      if (hours > 0) return zhLang ? `${hours}小时${minutes}分` : `${hours}h ${minutes}m`;
      if (minutes > 0) return zhLang ? `${minutes}分${seconds}秒` : `${minutes}m ${seconds}s`;
      return zhLang ? `${seconds}秒` : `${seconds}s`;
    }

    function JobsPanel(props) {
      const useSessions = props && typeof props.useSessions === "function" ? props.useSessions : null;
      const current = useSessions ? useSessions((s) => s.current) : undefined;
      const jobs = useSessions ? useSessions((s) => (current ? s.jobsBySession[current] : undefined)) : undefined;
      const live = Array.isArray(jobs) ? jobs.filter((j) => j.status === "running" || j.status === "stopping") : [];
      const [outputs, setOutputs] = react.useState({});
      const [killing, setKilling] = react.useState(null);
      const [now, setNow] = react.useState(() => Date.now());
      // 用户定稿 2026-09-05：终态任务保留在列（运行中在前、终态在后淡化显示），
      // 行动作从「结束」变「关闭」=仅从显示移除；关闭记录与终态清单都是页面
      // 会话内存态——刷新/重启不保留（终态任务本来就只活在宿主进程内存里）。
      const [dismissed, setDismissed] = react.useState(() => new Set());
      const doneFetched = react.useRef(new Set()); // 终态且已成功拉过输出 → 不再轮询（终态无新量）
      const isLive = (j) => j.status === "running" || j.status === "stopping";
      const shownOrdered = Array.isArray(jobs)
        ? [...jobs.filter((j) => !dismissed.has(j.id) && isLive(j)), ...jobs.filter((j) => !dismissed.has(j.id) && !isLive(j))]
        : [];

      // 时长随秒更新（有 live 任务才计时）
      react.useEffect(() => {
        if (live.length === 0) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, [live.length]);

      // 输出增量轮询：显示中且未拉到终态的任务各每秒拉一次（用户定稿：输出
      // 常显不再要「输出」按钮）。拉到终态即标记 doneFetched 停拉——终态没有
      // 新量，且无 readOutput 的终态任务每次都返回全量 output，重复拉会重复
      // 追加。终态行保留在列（见上），输出冻结在最后一拉。面板读取走宿主
      // job-tee 的独立游标（src/job-tee.ts），与模型侧 job_output 互不抢量，
      // 两边都能看到全量输出；页面隐藏时暂停，回前台下一秒续上。
      const shownIdsKey = shownOrdered.map((j) => j.id).join("\n");
      react.useEffect(() => {
        if (!current || shownIdsKey === "") return undefined;
        let disposed = false;
        const pollOne = (id) => {
          fetch(
            `/dsh-kit/jobs/output?sessionId=${encodeURIComponent(current)}&jobId=${encodeURIComponent(id)}`,
          )
            .then((res) => res.json().catch(() => null))
            .then((body) => {
              if (disposed) return;
              if (!body || !body.job) {
                setOutputs((prev) => ({ ...prev, [id]: { text: "", error: "HTTP" } }));
                return;
              }
              setOutputs((prev) => ({
                ...prev,
                [id]: {
                  text: (prev[id]?.text ?? "") + (typeof body.text === "string" ? body.text : ""),
                  error: null,
                },
              }));
              const st = body.job.status;
              if (st === "completed" || st === "killed" || st === "failed") doneFetched.current.add(id);
            })
            .catch(() => {
              if (!disposed) setOutputs((prev) => ({ ...prev, [id]: { text: prev[id]?.text ?? "", error: "network" } }));
            });
        };
        const tick = () => {
          if (document.visibilityState === "hidden") return;
          for (const id of shownIdsKey.split("\n")) {
            if (doneFetched.current.has(id)) continue;
            pollOne(id);
          }
        };
        tick();
        const timer = setInterval(tick, 1000);
        return () => {
          disposed = true;
          clearInterval(timer);
        };
      }, [current, shownIdsKey]);

      const killJob = async (job) => {
        setKilling(job.id);
        try {
          const res = await fetch("/dsh-kit/jobs/kill", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: current, jobId: job.id }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
          flashToast(t("jobsKillDone"));
        } catch (error) {
          flashToast(tf("jobsKillFail", { error: String(error?.message ?? error) }));
        } finally {
          setKilling(null);
        }
      };

      // 让位布局（body 类/宽度/拖拽）由右侧标签页容器统一负责，本组件只管内容。

      const statusWord = (job) => {
        switch (job.status) {
          case "running": return t("jobsStatusRunning");
          case "stopping": return t("jobsStatusStopping");
          case "completed": return t("jobsStatusCompleted");
          case "killed": return t("jobsStatusKilled");
          case "failed": return t("jobsStatusFailed");
          default: return job.status;
        }
      };

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-jobs-head",
            children: [
              jsxRuntime.jsxs("span", {
                className: "dshk-jobs-headside",
                children: [
                  jsxRuntime.jsx("span", { children: t("jobsTitle") }),
                  jsxRuntime.jsx("span", { className: "dshk-jobs-count", children: String(live.length) }),
                ],
              }),
            ],
          }),
          shownOrdered.length === 0
            ? jsxRuntime.jsx("div", { className: "dshk-jobs-empty", children: t("jobsEmpty") })
            : jsxRuntime.jsx("div", {
                className: "dshk-jobs-list",
                children: shownOrdered.map((job) => {
                  const out = outputs[job.id];
                  const stopBusy = killing === job.id || job.status === "stopping";
                  const done = !isLive(job);
                  return jsxRuntime.jsxs("div", {
                    className: "dshk-jobs-row",
                    "data-live": job.status === "running" || undefined,
                    "data-done": done || undefined,
                    children: [
                      jsxRuntime.jsxs("div", {
                        className: "dshk-jobs-rowline",
                        children: [
                          jsxRuntime.jsx("span", { className: "dshk-jobs-kind", children: job.kind }),
                          jsxRuntime.jsx("span", { className: "dshk-jobs-label", title: job.label, children: job.label }),
                          jsxRuntime.jsx("span", {
                            className: "dshk-jobs-status",
                            title: job.detail ?? statusWord(job),
                            children:
                              !done
                                ? `${statusWord(job)} · ${tf("jobsDuration", { duration: fmtJobDuration(now - job.startedAt) })}`
                                : job.finishedAt !== undefined
                                  ? `${statusWord(job)} · ${tf("jobsDuration", { duration: fmtJobDuration(job.finishedAt - job.startedAt) })}`
                                  : statusWord(job),
                          }),
                          jsxRuntime.jsxs("span", {
                            className: "dshk-jobs-actions",
                            children: [
                              done
                                ? jsxRuntime.jsx("button", {
                                    type: "button",
                                    className: "dshk-jobs-btn",
                                    title: t("jobsRowCloseHint"),
                                    onClick: () => setDismissed((prev) => new Set(prev).add(job.id)),
                                    children: t("jobsRowClose"),
                                  })
                                : jsxRuntime.jsx("button", {
                                    type: "button",
                                    className: "dshk-jobs-btn dshk-jobs-btn-kill",
                                    disabled: stopBusy,
                                    title: t("jobsKillHint"),
                                    onClick: () => killJob(job),
                                    children: t("jobsKill"),
                                  }),
                            ],
                          }),
                        ],
                      }),
                      jsxRuntime.jsx("div", {
                        className: "dshk-jobs-output",
                        children:
                          out && out.error
                            ? tf("jobsOutputTransient", { error: out.error })
                            : out && out.text && out.text.length > 0
                              ? out.text
                              : t("jobsOutputEmpty"),
                      }),
                    ],
                  }, job.id);
                }),
              }),
        ],
      });
    }

    // ─────────── 日程模块（中心区第三 tab：周时间网格 + 待办 + 统计 + 计时）───────────
    // 数据走宿主 /dsh-kit/schedule/* 端点：raw 全量 events + 区间展开 occurrences
    // （重复展开在宿主做，这里只渲染）+ runningTimer。
    // 日程给人看（周网格形态），agent 只看汇总走 schedule_query/create 工具。
    // 计时全局单实例（timer/start 遇 running 先自动 stop），芯片挂 conversation.composer.dock。

    const SCHED_COLORS = ["#228be6", "#40c057", "#fd7e14", "#e64980", "#7048e8", "#f59f00"];
    // 标题字数上限：与宿主 store 截断/工具描述同一口径（重要信息做标题，其余写备注）
    const SCHED_TITLE_MAX = 16;
    const SCHED_DAY_START = 0; // 网格起点 00:00（全天制，起止时刻零裁剪）
    const SCHED_DAY_END = 24 * 60;
    const SCHED_HOUR_PX = 42;

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
    /** "YYYY-MM-DDTHH:mm" → 当日分钟数；解析不了返回 null */
    const schedMins = (dt) => {
      if (typeof dt !== "string") return null;
      const m = dt.split("T")[1];
      if (!m) return null;
      const [hh, mm] = m.split(":").map(Number);
      return hh * 60 + mm;
    };
    const schedHHmm = (mins) => `${schedPad2(Math.floor(mins / 60) % 24)}:${schedPad2(mins % 60)}`;
    const schedWeekdays = () => (resolveZh() ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    const schedFmtDur = (ms) => {
      if (ms < 60000) return resolveZh() ? `${Math.round(ms / 1000)}秒` : `${Math.round(ms / 1000)}s`;
      const mins = Math.round(ms / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? (resolveZh() ? `${h}小时${m}分` : `${h}h ${m}m`) : resolveZh() ? `${m}分钟` : `${m}m`;
    };

    const schedFetch = async (path, opts) => {
      const res = await fetch(path, opts);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
      return body;
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

    // ── 日程数据钩子（拆两半共用，2026-09-10）：日程 pane 内待办卡与周网格各自
    // 挂载、各自轮询，靠 dshk-sched-changed 事件即时互相同步（写操作一处发生
    // 两边即时跟进）；轮询只是兜底，30s 节奏轻端点可承受 ──
    function useScheduleData() {
      const [data, setData] = react.useState(() => ({ events: [], occurrences: [], runningTimer: null, orphans: [] }));
      // 统计口径固定周（用户定稿 2026-09-06：日/月视图先不做）
      const [stats, setStats] = react.useState(null);
      const [nowTick, setNowTick] = react.useState(() => Date.now());
      const fetchData = react.useCallback(async () => {
        try {
          const body = await schedFetch(
            `/dsh-kit/schedule/data?from=${encodeURIComponent(schedAddDays(schedToday(), -8))}&to=${encodeURIComponent(schedAddDays(schedToday(), 60))}`,
          );
          setData({
            events: Array.isArray(body.events) ? body.events : [],
            occurrences: Array.isArray(body.occurrences) ? body.occurrences : [],
            runningTimer: body.runningTimer ?? null,
            orphans: Array.isArray(body.orphans) ? body.orphans : [],
          });
        } catch {
          // 拉取失败保留旧数据，下一轮轮询再试
        }
      }, []);
      const fetchStats = react.useCallback(async () => {
        try {
          setStats(await schedFetch(`/dsh-kit/schedule/stats?scope=week&date=${encodeURIComponent(schedToday())}`));
        } catch {
          setStats(null);
        }
      }, []);
      react.useEffect(() => {
        void fetchData();
      }, [fetchData]);
      react.useEffect(() => {
        void fetchStats();
      }, [fetchStats]);
      // 可见时 30s 轮询（agent 经 schedule_create 建的条目靠它进面板）+ 每分钟走当前时刻线
      // + dshk-sched-changed 事件（写操作即时互相同步，轮询只是兜底）
      react.useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          void fetchData();
          setNowTick(Date.now());
        }, 30000);
        const minute = setInterval(() => setNowTick(Date.now()), 60000);
        const onChanged = () => {
          void fetchData();
          void fetchStats();
        };
        window.addEventListener("dshk-sched-changed", onChanged);
        return () => {
          clearInterval(timer);
          clearInterval(minute);
          window.removeEventListener("dshk-sched-changed", onChanged);
        };
      }, [fetchData, fetchStats]);
      const mutate = react.useCallback(
        async (path, body) => {
          try {
            await schedFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
            // 刷新走 dshk-sched-changed 事件：日程 pane/悬浮计时件共用一条
            // 同步通道，一处写操作全部即时跟进（避免各轮询节奏的 10~30s 滞后）
            window.dispatchEvent(new Event("dshk-sched-changed"));
          } catch (error) {
            flashToast(tf("schedOpFail", { error: String(error?.message ?? error) }));
          }
        },
        [],
      );
      return { data, stats, nowTick, fetchData, fetchStats, mutate };
    }

    /** 待办卡（日程 pane 左列；侧栏待办索引半边 2026-09-11 随索引视图退役）：
     *  勾选完成、标题点击编辑（顺带把日程签带到眼前）、▶ 起表。数据由调用方给
     *  （useScheduleData 的 data/mutate），编辑弹窗卡内自理 */
    function ScheduleTasksCard({ data, mutate }) {
      const [modal, setModal] = react.useState(null);
      const tasks = react.useMemo(
        () =>
          data.events
            // 完成的待办不再显示（用户定稿 2026-09-09：记录保留——计时段/统计/
            // 网格橙块都还在，只是列表不堆积）
            .filter((e) => e.start === undefined && !e.completedAt)
            .sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1),
        [data.events],
      );
      const today = schedToday();
      return jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        jsxRuntime.jsxs("div", { className: "dshk-sched-card is-tasks", children: [
          jsxRuntime.jsxs("div", { className: "dshk-sched-cardhead", children: [
            jsxRuntime.jsx("div", { className: "dshk-sched-cardtitle", children: t("schedTasks") }),
            // 待办与日程同一数据形状（无 start 而已）——创建走同一个弹窗（task 模式）
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-ghost", onClick: () => setModal({ id: null, kind: "task", values: { title: "", due: schedToday() } }), children: `+ ${t("schedAdd")}` }),
          ] }),
          tasks.length === 0
            ? jsxRuntime.jsx("div", { className: "dshk-sched-emptytasks", children: t("schedTasksEmpty") })
            : tasks.map((task) => {
                const overdue = !task.completedAt && task.due !== undefined && task.due < today;
                return jsxRuntime.jsxs("div", { className: "dshk-sched-task", children: [
                  jsxRuntime.jsx("input", {
                    type: "checkbox",
                    checked: task.completedAt != null,
                    onChange: () => void mutate("/dsh-kit/schedule/done", { id: task.id, done: task.completedAt == null }),
                  }),
                  jsxRuntime.jsx("span", { className: "dshk-sched-tasktitle", title: task.title, onClick: () => { setKitUi(openFeatureDock(kitUi, "schedule")); setModal({ id: task.id, kind: "task", values: { ...task } }); }, children: task.title }),
                  task.due
                    ? jsxRuntime.jsx("span", { className: `dshk-sched-taskduebadge${overdue ? " is-overdue" : ""}`, children: overdue ? `${t("schedOverdue")} ${task.due.slice(5)}` : task.due.slice(5) })
                    : null,
                  task.completedAt == null
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-tasktimer", title: t("timerStartBtn"), onClick: () => void mutate("/dsh-kit/schedule/timer-start", { id: task.id }), children: "▶" })
                    : null,
                ] }, task.id);
              }),
        ] }),
        modal
          ? jsxRuntime.jsx(ScheduleModal, {
              modal,
              onClose: () => setModal(null),
              onSave: async (id, values) => {
                if (id) await mutate("/dsh-kit/schedule/update", { id, ...values });
                else await mutate("/dsh-kit/schedule/create", values);
                setModal(null);
              },
              onDelete: async (id) => {
                await mutate("/dsh-kit/schedule/delete", { id });
                setModal(null);
              },
            })
          : null,
      ] });
    }

    function ScheduleView({ active }) {
      const { data, stats, nowTick, fetchData, fetchStats, mutate } = useScheduleData();
      const [weekStart, setWeekStart] = react.useState(() => schedMondayOf(schedToday()));
      const [modal, setModal] = react.useState(null); // { id?, values, kind: 'event'|'task' }
      const gridRef = react.useRef(null);

      const weekDates = react.useMemo(() => {
        const days = [];
        for (let i = 0; i < 7; i++) days.push(schedAddDays(weekStart, i));
        return days;
      }, [weekStart]);

      // 日程视图每次变为可见（挂载即激活 / 从别的标签切回）都把视口滚到当前
      // 时刻上方 1/3 处。旧版"只滚一次"有坑：挂载时若视图还 display:none
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

      // 计时段上网格（wangshu 对齐）：事件 timeEntries 与独立计时段（orphans，
      // note=自由标题）合成显示块——停了的才显示（进行中的没形状），按 start 日
      // 归属（与 timedMsInRange 统计口径一致）。独立段不可编辑（无 base 条目）
      const timedOcc = react.useMemo(() => {
        const segs = [];
        for (const ev of data.events) {
          (Array.isArray(ev.timeEntries) ? ev.timeEntries : []).forEach((t, i) => {
            if (t.end === undefined) return;
            // owner/index/rawStart/rawEnd/note 供段编辑弹窗寻址（entry-update/delete 同一套下标）
            segs.push({ baseId: `${ev.id}#timed${i}`, date: t.start.slice(0, 10), startMins: timerMinsOfDT(t.start), endMins: timerMinsOfDT(t.end), allDay: false, title: ev.title, virtual: false, isTimed: true, owner: ev.id, index: i, rawStart: t.start, rawEnd: t.end, note: t.note });
          });
        }
        (Array.isArray(data.orphans) ? data.orphans : []).forEach((o, i) => {
          if (o.end === undefined) return;
          segs.push({ baseId: `orphan#timed${i}`, date: o.start.slice(0, 10), startMins: timerMinsOfDT(o.start), endMins: timerMinsOfDT(o.end), allDay: false, title: o.note || t("schedTimerStandalone"), virtual: false, isTimed: true, owner: null, index: i, rawStart: o.start, rawEnd: o.end, note: o.note });
        });
        return segs;
      }, [data.events, data.orphans]);
      const gridOcc = react.useMemo(() => {
        // 泳道按日分池：每列独立布道。全周混排会让不同天、同时刻的事件互相
        // 挤占泳道（周一 9-10 与周二 9:30-10:30 各拿半列宽），列间本无冲突
        const byDate = new Map();
        for (const o of [...data.occurrences.filter((o) => !o.allDay), ...timedOcc]) {
          const arr = byDate.get(o.date) ?? [];
          arr.push(o);
          byDate.set(o.date, arr);
        }
        const laid = [];
        for (const arr of byDate.values()) laid.push(...schedAssignLanes(arr));
        return laid.map((o) => {
          // 高度贴合真实时长比例（用户定稿 2026-09-08）：短段不再一律抬到 18px，
          // 但下限 14px + is-thin 紧凑排版保证单行标题仍可读
          const raw = (((o.endMins ?? o.startMins + 60) - Math.max(o.startMins, SCHED_DAY_START)) / 60) * SCHED_HOUR_PX;
          return {
            ...o,
            top: ((Math.max(o.startMins, SCHED_DAY_START) - SCHED_DAY_START) / 60) * SCHED_HOUR_PX,
            height: Math.max(14, raw),
            thin: raw < 18,
          };
        });
      }, [data.occurrences, timedOcc]);
      const allDayOcc = react.useMemo(() => data.occurrences.filter((o) => o.allDay), [data.occurrences]);

      const openCreate = (date, hour) => {
        const hh = hour ?? 9;
        setModal({
          id: null,
          kind: "event",
          values: {
            title: "",
            description: "",
            location: "",
            start: `${date}T${schedPad2(hh)}:00`,
            end: `${date}T${schedPad2(Math.min(hh + 1, 23))}:00`,
            allDay: false,
            recurrence: null,
            color: SCHED_COLORS[data.events.length % SCHED_COLORS.length],
          },
        });
      };
      const openEdit = (occ) => {
        const base = data.events.find((e) => e.id === occ.baseId);
        if (!base) return;
        setModal({ id: base.id, kind: "event", values: { ...base } });
      };
      // 计时段编辑（网格=时间分配视图，段与日程一样可改可删）：从段上带的
      // owner/index 寻址，orphan 的 note 即标题
      const openEntryEdit = (occ) => {
        setModal({ kind: "entry", owner: occ.owner ?? null, index: occ.index, values: { note: occ.note || "", start: occ.rawStart, end: occ.rawEnd } });
      };

      const today = schedToday();
      const isCurrentWeek = weekDates.includes(today);
      const nowMins = new Date(nowTick).getHours() * 60 + new Date(nowTick).getMinutes();
      const hours = [];
      for (let h = SCHED_DAY_START / 60; h < SCHED_DAY_END / 60; h++) hours.push(h);

      const head = jsxRuntime.jsxs("div", {
        className: "dshk-sched-head",
        children: [
          jsxRuntime.jsx("span", { className: "dshk-sched-title", children: t("schedTab") }),
          jsxRuntime.jsxs("span", { className: "dshk-sched-weeknav", children: [
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setWeekStart((s) => schedAddDays(s, -7)), children: "‹" }),
            jsxRuntime.jsx("span", { className: "dshk-sched-weeklabel", children: `${weekDates[0].slice(5).replace("-", "/")} - ${weekDates[6].slice(5).replace("-", "/")}` }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setWeekStart((s) => schedAddDays(s, 7)), children: "›" }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => setWeekStart(schedMondayOf(schedToday())), children: t("schedToday") }),
          ] }),
        ],
      });

      const grid = jsxRuntime.jsxs("div", {
        className: "dshk-sched-grid",
        children: [
          jsxRuntime.jsx("div", { className: "dshk-sched-corner" }),
          // key 必须带前缀区分：日期头与日列同用裸日期曾致同级 key 冲突——React
          // 错配复用元素，切周时旧列不卸载不断往下叠加
          ...weekDates.map((date, i) =>
            jsxRuntime.jsxs("div", { className: `dshk-sched-dayhead${date === today ? " is-today" : ""}`, children: [
              jsxRuntime.jsx("span", { className: "dshk-sched-wd", children: schedWeekdays()[i] }),
              jsxRuntime.jsx("span", { className: "dshk-sched-dnum", children: Number(date.slice(8, 10)) }),
            ] }, `hd-${date}`),
          ),
          ...allDayOcc.map((o) =>
            jsxRuntime.jsx("div", { className: "dshk-sched-allday", style: { gridColumn: (weekDates.indexOf(o.date) + 2) || 1 }, children: o.title }, `ad-${o.baseId}-${o.date}`),
          ),
          jsxRuntime.jsx("div", { className: "dshk-sched-timeline", children: hours.map((h) =>
            jsxRuntime.jsx("div", { className: "dshk-sched-hourlabel", children: `${schedPad2(h)}:00` }, h),
          ) }, "tl"),
          ...weekDates.map((date) => {
            const inWeek = gridOcc.filter((o) => o.date === date);
            return jsxRuntime.jsxs("div", { className: "dshk-sched-daycol", "data-date": date, children: [
              hours.map((h) =>
                jsxRuntime.jsx("div", {
                  className: "dshk-sched-cell",
                  style: { height: SCHED_HOUR_PX },
                  onClick: () => openCreate(date, h),
                }, h),
              ),
              date === today && isCurrentWeek
                ? jsxRuntime.jsx("div", { className: "dshk-sched-nowline", style: { top: ((Math.min(nowMins, SCHED_DAY_END) - SCHED_DAY_START) / 60) * SCHED_HOUR_PX } })
                : null,
              inWeek.map((o) => {
                // 块内只留标题（时刻纵向就在轴上，完整时段进 tooltip，悬停即看）；
                // 其余信息（地点/备注）同样进 tooltip。够高的块标题放开两行（is-tall）
                const tipParts = [
                  `${schedHHmm(o.startMins)}${o.endMins !== null ? "–" + schedHHmm(o.endMins) : ""}`,
                  o.title,
                  ...(o.location ? [o.location] : []),
                  ...(o.description ? [o.description] : []),
                ];
                return jsxRuntime.jsxs("div", {
                  className: `dshk-sched-event${o.isTimed ? " is-timed" : ""}${o.height >= 48 ? " is-tall" : ""}${o.thin ? " is-thin" : ""}`,
                  style: {
                    top: o.top,
                    height: o.height,
                    // 泳道均分且零内缩：块边缘与列网格线严丝合缝（用户定稿 2026-09-08）
                    left: `${(o.lane * 100) / o.lanes}%`,
                    width: `${100 / o.lanes}%`,
                    ...(o.color && !o.isTimed ? { background: o.color } : {}),
                  },
                  title: tipParts.filter(Boolean).join("\n"),
                  onClick: (e) => {
                    e.stopPropagation();
                    if (o.isTimed) openEntryEdit(o);
                    else openEdit(o);
                  },
                  children: [
                    jsxRuntime.jsx("span", { className: "dshk-sched-evtitle", children: o.isTimed ? `⏱ ${o.title}` : o.title }),
                  ],
                }, `${o.baseId}@${o.date}`);
              }),
            ] }, `dc-${date}`);
          }),
        ],
      });

      // 左待办 + 右周网格（右栏 pane 定稿 2026-09-11，待办卡回归 pane）：左列
      // 待办+统计卡片、右列网格吃满余宽；侧栏待办索引与左列共用待办卡组件
      const sideCol = jsxRuntime.jsxs("div", { className: "dshk-sched-sidecol", children: [
        jsxRuntime.jsx(ScheduleTasksCard, { data, mutate }),
        stats
          ? jsxRuntime.jsxs("div", { className: "dshk-sched-card is-stats", children: [
              jsxRuntime.jsx("div", { className: "dshk-sched-cardtitle", children: t("schedStatsTitle") }),
              jsxRuntime.jsxs("div", { className: "dshk-sched-statsgrid", children: [
                jsxRuntime.jsxs("div", { className: "dshk-sched-stat", children: [jsxRuntime.jsx("b", { children: schedFmtDur(stats.totalMs) }), jsxRuntime.jsx("span", { children: t("schedStatsTotal") })] }),
                jsxRuntime.jsxs("div", { className: "dshk-sched-stat", children: [jsxRuntime.jsx("b", { children: String(stats.eventCount) }), jsxRuntime.jsx("span", { children: t("schedStatsEvents") })] }),
                jsxRuntime.jsxs("div", { className: "dshk-sched-stat", children: [jsxRuntime.jsx("b", { children: String(stats.completedCount) }), jsxRuntime.jsx("span", { children: t("schedStatsDone") })] }),
                jsxRuntime.jsxs("div", { className: "dshk-sched-stat", children: [jsxRuntime.jsx("b", { children: String(stats.openCount) }), jsxRuntime.jsx("span", { children: t("schedStatsOpen") })] }),
              ] }),
            ] })
          : null,
      ] });

      return jsxRuntime.jsxs("div", { className: "dshk-sched-root", children: [
        head,
        jsxRuntime.jsxs("div", { className: "dshk-sched-body", children: [
          sideCol,
          jsxRuntime.jsx("div", { className: "dshk-sched-gridwrap", ref: gridRef, children: jsxRuntime.jsx("div", { className: "dshk-sched-gridinner", children: grid }) }),
        ] }),
        modal
          ? jsxRuntime.jsx(ScheduleModal, {
              modal,
              onClose: () => setModal(null),
              onSave: async (id, values) => {
                if (modal.kind === "entry") await mutate("/dsh-kit/schedule/entry-update", { owner: modal.owner, index: modal.index, ...values });
                else if (id) await mutate("/dsh-kit/schedule/update", { id, ...values });
                else await mutate("/dsh-kit/schedule/create", values);
                setModal(null);
              },
              onDelete: async (id) => {
                if (modal.kind === "entry") await mutate("/dsh-kit/schedule/entry-delete", { owner: modal.owner, index: modal.index });
                else await mutate("/dsh-kit/schedule/delete", { id });
                setModal(null);
              },
            })
          : null,
      ] });
    }

    function ScheduleModal({ modal, onClose, onSave, onDelete }) {
      const isTask = modal.kind === "task";
      const isEntry = modal.kind === "entry";
      const entryOrphan = isEntry && modal.owner === null;
      const [values, setValues] = react.useState(() => ({ ...modal.values }));
      const [confirming, setConfirming] = react.useState(false);
      // 可关闭窗口语义（与 dsh 自身弹窗一致，2026-09-08 用户定稿：无取消键）——
      // Esc / 点背景 / 右上 ✕ 都直接关窗，未保存的编辑即放弃。挂 schedModalOpen
      // 让 KitSurfaces 的全局 Esc（收标签页那个）让路；本监听 stopPropagation
      // 兜底，Esc 只关本弹窗
      react.useEffect(() => {
        schedModalOpen = true;
        const onKey = (e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
          schedModalOpen = false;
          window.removeEventListener("keydown", onKey, true);
        };
      }, [onClose]);
      const set = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));
      const rec = values.recurrence || null;
      const setRec = (patch) => setValues((prev) => ({ ...prev, recurrence: { ...(prev.recurrence || { type: "weekly" }), ...patch } }));
      const weekdays = schedWeekdays();
      // 计时段：独立段 note 即标题必填（同 16 字口径）；挂条目段备注可选
      const invalid = isEntry
        ? entryOrphan && (values.note ?? "").trim() === ""
        : (values.title ?? "").trim() === "";
      return jsxRuntime.jsxs("div", { className: "dshk-sched-overlay", onClick: onClose, children: [
        jsxRuntime.jsxs("div", { className: "dshk-sched-modal", onClick: (e) => e.stopPropagation(), children: [
          jsxRuntime.jsxs("div", { className: "dshk-sched-modaltitle", children: [
            jsxRuntime.jsx("span", { children: isEntry ? t("schedEditEntry") : modal.id ? t("schedEdit") : modal.kind === "task" ? t("schedCreateTask") : t("schedCreate") }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-x", "aria-label": t("schedClose"), title: t("schedClose"), onClick: onClose, children: "✕" }),
          ] }),
          isEntry ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            jsxRuntime.jsxs("div", { className: "dshk-sched-countwrap", children: [
              jsxRuntime.jsx("input", { className: "dshk-sched-input", maxLength: entryOrphan ? SCHED_TITLE_MAX : 200, value: values.note ?? "", placeholder: entryOrphan ? t("schedTitlePh") : t("schedDesc"), autoFocus: true, onChange: (e) => set("note", e.target.value.slice(0, entryOrphan ? SCHED_TITLE_MAX : 200)) }),
              entryOrphan ? jsxRuntime.jsx("span", { className: "dshk-sched-count", children: `${(values.note ?? "").length}/${SCHED_TITLE_MAX}` }) : null,
            ] }),
            jsxRuntime.jsxs("div", { className: "dshk-sched-row", children: [
              jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                jsxRuntime.jsx("span", { children: t("schedStart") }),
                jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "datetime-local", value: values.start ?? "", onChange: (e) => set("start", e.target.value) }),
              ] }),
              jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                jsxRuntime.jsx("span", { children: t("schedEnd") }),
                jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "datetime-local", value: values.end ?? "", onChange: (e) => set("end", e.target.value) }),
              ] }),
            ] }),
          ] })
          : jsxRuntime.jsxs("div", { className: "dshk-sched-countwrap", children: [
            jsxRuntime.jsx("input", { className: "dshk-sched-input", maxLength: SCHED_TITLE_MAX, value: values.title ?? "", placeholder: t("schedTitlePh"), autoFocus: true, onChange: (e) => set("title", e.target.value.slice(0, SCHED_TITLE_MAX)) }),
            jsxRuntime.jsx("span", { className: "dshk-sched-count", children: `${(values.title ?? "").length}/${SCHED_TITLE_MAX}` }),
          ] }),
          !isEntry && isTask
            ? jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                jsxRuntime.jsx("span", { children: t("schedTaskDue") }),
                jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "date", value: values.due ?? "", onChange: (e) => set("due", e.target.value) }),
              ] })
            : !isEntry
              ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                jsxRuntime.jsxs("div", { className: "dshk-sched-row", children: [
                  jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                    jsxRuntime.jsx("span", { children: t("schedStart") }),
                    jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "datetime-local", value: values.start ?? "", onChange: (e) => set("start", e.target.value) }),
                  ] }),
                  jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                    jsxRuntime.jsx("span", { children: t("schedEnd") }),
                    jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "datetime-local", value: values.end ?? "", onChange: (e) => set("end", e.target.value) }),
                  ] }),
                ] }),
                jsxRuntime.jsxs("label", { className: "dshk-sched-check", children: [
                  jsxRuntime.jsx("input", { type: "checkbox", checked: values.allDay === true, onChange: (e) => set("allDay", e.target.checked) }),
                  jsxRuntime.jsx("span", { children: t("schedAllDay") }),
                ] }),
                rec
                  ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                jsxRuntime.jsxs("div", { className: "dshk-sched-row", children: [
                  jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                    jsxRuntime.jsx("span", { children: t("schedRepeat") }),
                    jsxRuntime.jsx("select", { className: "dshk-sched-input", value: rec.type, onChange: (e) => { if (e.target.value === "none") set("recurrence", null); else setRec({ type: e.target.value }); }, children: [
                      jsxRuntime.jsx("option", { value: "none", children: t("schedRepeatNone") }),
                      jsxRuntime.jsx("option", { value: "daily", children: t("schedRepeatDaily") }),
                      jsxRuntime.jsx("option", { value: "weekly", children: t("schedRepeatWeekly") }),
                      jsxRuntime.jsx("option", { value: "monthly", children: t("schedRepeatMonthly") }),
                    ] }),
                  ] }),
                        jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                          jsxRuntime.jsx("span", { children: t("schedRepeatInterval") }),
                          jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "number", min: 1, value: rec.interval ?? 1, onChange: (e) => setRec({ interval: Math.max(1, Number(e.target.value) || 1) }) }),
                          jsxRuntime.jsx("span", { children: rec.type === "daily" ? t("schedDayUnit") : rec.type === "weekly" ? t("schedWeekUnit") : t("schedMonthUnit") }),
                        ] }),
                      ] }),
                      rec.type === "weekly"
                        ? jsxRuntime.jsx("div", { className: "dshk-sched-row", children: weekdays.map((wd, i) =>
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: `dshk-sched-wdchip${(rec.days ?? []).includes(i + 1) ? " is-active" : ""}`,
                              onClick: () => {
                                const cur = new Set(rec.days ?? []);
                                if (cur.has(i + 1)) cur.delete(i + 1);
                                else cur.add(i + 1);
                                if (cur.size > 0) setRec({ days: [...cur].sort((a, b) => a - b) });
                              },
                              children: wd,
                            }, i),
                          ) })
                        : null,
                      jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                        jsxRuntime.jsx("span", { children: t("schedRepeatUntil") }),
                        jsxRuntime.jsx("input", { className: "dshk-sched-input", type: "date", value: rec.end ?? "", onChange: (e) => setRec({ end: e.target.value || undefined }) }),
                      ] }),
                    ] })
                  : null,
                !rec
                  ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-ghost", onClick: () => setRec({ type: "weekly", interval: 1, days: [new Date().getDay() === 0 ? 7 : new Date().getDay()] }), children: `+ ${t("schedRepeat")}` })
                  : null,
              ] })
              : null,
            !isEntry ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            jsxRuntime.jsxs("div", { className: "dshk-sched-row", children: [
              jsxRuntime.jsxs("label", { className: "dshk-sched-field", children: [
                jsxRuntime.jsx("span", { children: t("schedLoc") }),
                jsxRuntime.jsx("input", { className: "dshk-sched-input", value: values.location ?? "", onChange: (e) => set("location", e.target.value) }),
              ] }),
              jsxRuntime.jsxs("div", { className: "dshk-sched-field", children: [
                jsxRuntime.jsx("span", { children: t("schedColor") }),
                jsxRuntime.jsx("div", { className: "dshk-sched-colors", children: SCHED_COLORS.map((c) =>
                  jsxRuntime.jsx("button", { type: "button", className: `dshk-sched-color${values.color === c ? " is-active" : ""}`, style: { background: c }, onClick: () => set("color", c) }, c),
                ) }),
              ] }),
            ] }),
            jsxRuntime.jsx("textarea", { className: "dshk-sched-input", rows: 2, value: values.description ?? "", placeholder: t("schedDesc"), onChange: (e) => set("description", e.target.value) }),
            ] }) : null,
            jsxRuntime.jsxs("div", { className: "dshk-sched-actions", children: [
              (modal.id || isEntry)
                ? confirming
                  ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-danger", onClick: () => void onDelete(modal.id), children: t("schedDeleteConfirm") })
                  : jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-ghost", onClick: () => setConfirming(true), children: t("schedDelete") })
                : null,
              jsxRuntime.jsx("span", { style: { flex: 1 } }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-primary", disabled: invalid, onClick: () => void onSave(modal.id, values), children: t("schedSave") }),
            ] }),
          ] }),
      ] });
    }

    /** 计时段的已流逝时长（本地朴素时间串 → hh:mm:ss）；纯函数，渲染与测试共用 */
    function timerElapsedStr(nowTick, startStr) {
      const [d, tm = "00:00"] = String(startStr).split("T");
      const [y, mo, dd] = d.split("-").map(Number);
      const tp = tm.split(":").map(Number);
      const startMs = new Date(y, mo - 1, dd, tp[0] ?? 0, tp[1] ?? 0, tp[2] ?? 0).getTime();
      const s = Math.max(0, Math.floor((nowTick - startMs) / 1000));
      return `${schedPad2(Math.floor(s / 3600))}:${schedPad2(Math.floor((s % 3600) / 60))}:${schedPad2(s % 60)}`;
    }
    /** 计时段 "YYYY-MM-DDTHH:mm(:ss)" → 当日分钟数（网格橙块定位用） */
    function timerMinsOfDT(dt) {
      return Number(String(dt).slice(11, 13)) * 60 + Number(String(dt).slice(14, 16));
    }

    /** 运行态轮询三件套（10s 轻端点 + dshk-sched-changed 即时 + 秒针仅运行中），
     *  悬浮小窗与收起栏起表钮共用同一套节奏 */
    function useRunningTimer() {
      const [running, setRunning] = react.useState(null); // { id, start, title }
      const [nowTick, setNowTick] = react.useState(() => Date.now());
      const refresh = react.useCallback(async () => {
        try {
          const body = await schedFetch("/dsh-kit/schedule/timer");
          setRunning(body.runningTimer ?? null);
        } catch {
          /* 静默：计时件不打扰 */
        }
      }, []);
      react.useEffect(() => {
        void refresh();
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          void refresh();
          setNowTick(Date.now());
        }, 10000);
        const onChanged = () => void refresh();
        window.addEventListener("dshk-sched-changed", onChanged);
        return () => {
          clearInterval(timer);
          window.removeEventListener("dshk-sched-changed", onChanged);
        };
      }, [refresh]);
      react.useEffect(() => {
        if (!running) return undefined;
        setNowTick(Date.now());
        const tick = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(tick);
      }, [running && running.id, running && running.start]);
      const stop = react.useCallback(() => {
        schedFetch("/dsh-kit/schedule/timer-stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          .then(() => {
            setRunning(null);
            window.dispatchEvent(new Event("dshk-sched-changed"));
          })
          .catch(() => {});
      }, []);
      return { running, nowTick, refresh, stop };
    }

    /** 悬浮计时小窗：计时运行时常驻内容区右下（坞展开/收起都自动让位）。显示
     *  名目（挂待办取待办标题，store.runningTimer 已解析；独立计时取名目）。
     *  点整颗球弹「确定结束计时？」确认窗：是=停止，完成=停止并勾掉待办（仅挂
     *  待办时出现），✕/Esc/点背景=关窗继续计时（用户定稿 2026-09-09：停止入口
     *  只此一处，误触不会丢计时） */
    function FloatingTimerPill() {
      const { running, nowTick, stop } = useRunningTimer();
      const [confirming, setConfirming] = react.useState(false);
      if (!running) return null;
      const name = running.title || t("schedTimerStandalone");
      return jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        jsxRuntime.jsxs("div", {
          className: "dshk-timer-pill",
          title: name,
          onClick: () => setConfirming(true),
          children: [
            jsxRuntime.jsx("span", { className: "dshk-sched-timerdot" }),
            jsxRuntime.jsx("span", { className: "dshk-timer-pilltitle", title: name, children: name }),
            jsxRuntime.jsx("span", { className: "dshk-timer-pilltime", children: timerElapsedStr(nowTick, running.start) }),
          ],
        }),
        confirming
          ? jsxRuntime.jsx(TimerStopModal, { running, nowTick, stop, onClose: () => setConfirming(false) })
          : null,
      ] });
    }

    // ─────────── 内置浏览器面板（右栏浏览器签）───────────
    // 数据走宿主半边 /dsh-kit/browser WS：state/event 广播 + frame 帧流（jpeg）+
    // watch 引用计数 + open/activate/closeTab/nav/newTab（人操作）+ input（人机共驾）。
    // 设计定位：面板是 agent 隔离浏览器的「现场直播 + 遥控」——canvas 绘观察页实时
    // 画面；人的点击/滚轮/键入经画布坐标换算回传宿主，派发到观察页（人与 agent 可
    // 各看各页，画面是否跟随 agent 由宿主侧 follow 开关决定）。面板常驻挂在右侧
    // 标签页容器：WS 管帧流与共驾输入；「agent 导航自动切到浏览器标签」的事件源
    // 已升级为壳层常驻（ShellBrowserEvents），标签被收掉（0 页自动收/人为关）也能弹回。
    // 生命周期：关标签仅停流不关浏览器（空闲 10 分钟自动优雅关，登录态保留在
    // 专用 profile，重开无损）。

    // 关页签即关（无确认，用户定稿）：「agent 活动页」的宿主识别与实际操作页常对
    // 不上，据此弹「agent 在用」确认只会误拦；agent 被关页后按 URL 重走即可

    function BrowserPanel({ active }) {
      const [state, setState] = react.useState({ running: false, launching: false, pages: [], activeId: null, viewId: null });
      const [draft, setDraft] = react.useState("");
      const [visible, setVisible] = react.useState(document.visibilityState === "visible");
      const [connLost, setConnLost] = react.useState(false);
      const canvasRef = react.useRef(null);
      const imeRef = react.useRef(null); // 透明输入：IME 组合事件宿主（canvas 不可编辑，组合起不来）
      const wsRef = react.useRef(null);
      const frameRef = react.useRef(null); // 最新帧（绘制去抖：只画最新）
      const rafRef = react.useRef(0);
      const moveRef = react.useRef(0); // 输入节流（~30/s）
      const downRef = react.useRef(null); // 双击判定（时间+距离窗）
      // watch 门控与事件回调里要读「最新」的激活/可见态，走 ref（闭包会停在创建帧）
      const activeRef = react.useRef(active);
      activeRef.current = active;
      const visibleRef = react.useRef(visible);
      visibleRef.current = visible;

      // 观察页（页签条/URL 栏数据源；URL 栏与导航按钮都作用于它）
      const viewPage = (state.pages ?? []).find((p) => p.viewed) ?? null;
      const viewUrl = viewPage?.url ?? "";
      const live = state.running === true;

      // 让位布局（body 类/宽度/拖拽）由右侧标签页容器统一负责，本组件只管内容。

      // agent 导航 → 自动切到浏览器标签：统一走模块级 maybeAutoOpenBrowser（壳层
      // 常驻事件源与面板共用同一入口，抑制与「已在浏览器标签」的判断都在那边）

      // 帧绘制：base64 jpeg → Image 解码 → canvas（尺寸随帧更新，宽 100% 等比）
      const drawFrame = react.useCallback((data) => {
        const img = new Image();
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

      // WS 生命周期：挂载连接 + 断线重连（2.5s）；watch 跟随「实时画面模式 + 页面可见」
      react.useEffect(() => {
        let disposed = false;
        let retry = null;
        const connect = () => {
          const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/dsh-kit/browser`);
          wsRef.current = ws;
          ws.onopen = () => {
            if (disposed) return;
            setConnLost(false);
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
            if (msg.t === "frame" && typeof msg.data === "string") {
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
            if (msg.t === "event") {
              if (msg.kind === "navigated" && typeof msg.url === "string") {
                setState((prev) => {
                  const pages = (prev.pages ?? []).map((p) =>
                    p.tabId === msg.tabId ? { ...p, url: msg.url, title: msg.title ?? p.title } : p,
                  );
                  return { ...prev, pages, running: true };
                });
                maybeAutoOpenBrowser();
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
          try {
            wsRef.current?.close();
          } catch {
            // 已断
          }
        };
      }, [drawFrame]);

      // watch 开关：「浏览器标签激活 + 页面可见」才要帧（切走/隐藏即停流，回来自动
      // 续）；WS 本身保持连接（自动打开的事件源）。onopen 另有补发——首次连接建立
      // 时本 effect 已跑过（握手未完成被 readyState 挡掉），不补发首连收不到帧。
      const sendWatch = () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== 1) return;
        try {
          ws.send(JSON.stringify({ t: "watch", on: visibleRef.current === true && activeRef.current === true }));
        } catch {
          // 已断
        }
      };
      react.useEffect(() => {
        sendWatch();
      }, [visible, active, connLost]);
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
      const sendInput = (obj) => {
        try {
          wsRef.current?.send(JSON.stringify(obj));
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

      const go = (raw) => {
        const text = String(raw ?? "").trim();
        if (text === "") return;
        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
        setDraft(withScheme);
        // 先本地反馈（宿主 navigated 事件随后校正）；humanOpen 作用于观察页
        setState((prev) => ({
          ...prev,
          running: true,
          pages: (prev.pages ?? []).map((p) => (p.viewed ? { ...p, url: withScheme, title: "" } : p)),
        }));
        try {
          wsRef.current?.send(JSON.stringify({ t: "open", url: withScheme }));
        } catch {
          // 连接断开时忽略（重连后用户可再按）
        }
      };

      // URL 栏跟随观察页：切页签/导航事件（宿主侧校正）都把地址栏对到观察页
      react.useEffect(() => {
        setDraft(viewUrl);
      }, [viewPage?.tabId, viewUrl]);

      const tabLabel = (p) => {
        if (typeof p.title === "string" && p.title.trim() !== "") return p.title;
        try {
          return new URL(p.url).host || p.url;
        } catch {
          return p.url || `#${p.tabId}`;
        }
      };

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          // 页签条：高亮=观察页；× 关页签（直关无确认）；＋ 新页签
          jsxRuntime.jsx("div", {
            className: "dshk-brw-tabrow",
            children: jsxRuntime.jsxs("span", {
              className: "dshk-tabs",
              children: [
                (state.pages ?? []).map((p) =>
                  jsxRuntime.jsxs("span", {
                    className: `dshk-tab${p.viewed ? " dshk-tab-on" : ""}`,
                    title: p.url,
                    onClick: () => sendInput({ t: "activate", tabId: p.tabId }),
                    children: [
                      jsxRuntime.jsx("span", { className: "dshk-tab-label", children: tabLabel(p) }),
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dshk-tab-x",
                        "aria-label": t("browserCloseTab"),
                        title: t("browserCloseTab"),
                        onClick: (e) => {
                          e.stopPropagation();
                          sendInput({ t: "closeTab", tabId: p.tabId });
                        },
                        children: "✕",
                      }),
                    ],
                  }, p.tabId),
                ),
                jsxRuntime.jsx("button", {
                  type: "button",
                  className: "dshk-tab dshk-brw-newtab",
                  title: t("browserNewTab"),
                  "aria-label": t("browserNewTab"),
                  onClick: () => sendInput({ t: "newTab" }),
                  children: "＋",
                }),
              ],
            }),
          }),
          // URL 栏 + 前进/后退/刷新（都作用于观察页）
          jsxRuntime.jsxs("form", {
            className: "dshk-brw-bar",
            onSubmit: (e) => {
              e.preventDefault();
              go(draft);
            },
            children: [
              jsxRuntime.jsx("button", { type: "button", className: "dshk-jobs-btn dshk-brw-nav", title: t("browserBack"), "aria-label": t("browserBack"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "back" }), children: "◀" }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-jobs-btn dshk-brw-nav", title: t("browserForward"), "aria-label": t("browserForward"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "forward" }), children: "▶" }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-jobs-btn dshk-brw-nav", title: t("browserReload"), "aria-label": t("browserReload"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "reload" }), children: "⟳" }),
              jsxRuntime.jsx("input", {
                className: "dshk-brw-url",
                value: draft,
                placeholder: t("browserUrlPh"),
                onChange: (e) => setDraft(e.target.value),
                spellCheck: false,
              }),
              jsxRuntime.jsx("button", { type: "submit", className: "dshk-jobs-btn", children: t("browserGo") }),
            ],
          }),
          jsxRuntime.jsx("div", {
            className: "dshk-brw-body",
            children: jsxRuntime.jsx("canvas", {
              className: "dshk-brw-canvas",
              ref: canvasRef,
              tabIndex: 0,
              onPointerDown: onCanvasPointerDown,
              onPointerMove: onCanvasPointerMove,
              onPointerUp: onCanvasPointerUp,
              onWheel: onCanvasWheel,
              onKeyDown: onCanvasKeyDown,
              onContextMenu: (e) => e.preventDefault(), // 右键菜单交给远端页面
            }),
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
          connLost
            ? jsxRuntime.jsx("div", { className: "dshk-brw-note", children: t("browserReconnect") })
            : state.running === false && state.launching === true
              ? jsxRuntime.jsx("div", { className: "dshk-brw-note", children: t("browserStarting") })
              : state.running === false && viewUrl === ""
                ? jsxRuntime.jsx("div", { className: "dshk-brw-note", children: t("browserNotRunning") })
                : (state.pages ?? []).length === 0
                  ? jsxRuntime.jsx("div", { className: "dshk-brw-note", children: t("browserNoPages") })
                  : null,
        ],
      });
    }

    // ─────────── 知识库（vault：侧栏目录索引 + 右栏页编辑器，portal 拆两半）───────────
    // vault = 设置卡配置的绝对目录，其内一切 md 即页面（数据契约见 src/vault.ts）。
    // 布局「选库进入阅读」（用户定稿 2026-09-06）：左窄条 = 空间（顶层目录）+
    // 懒加载目录树；右 = 真·所见即所得编辑区（TipTap 富文本，vendor/richeditor
    // .bundle.js 的 window.DshRTE 工厂：md ↔ 富文本往返、[[wikilink]]/公式/
    // callout/未知块 HTML 原样保留）。保存 = wangshu 同款自动保存（2s 防抖 +
    // 切页 flush + Ctrl+S）走 vault 写端点 mtime CAS；盘上被外部修改时暂停自
    // 动保存出冲突条（覆盖盘上 / 读取盘上），绝不静默覆盖。frontmatter 在编辑
    // 器外剥离成属性条展示，保存时字节级原样写回。搜索走宿主全文端点。

    /** 拆 frontmatter：返回 { fmText, rest }。fmText = "---…---" 块（含随后的
     *  首个换行）的字节级原文，无 frontmatter 时 fmText=""；rest = 其余全部。
     *  保存 = fmText + 编辑器 md，未编辑过的头部字节永不走样 */
    function vaultSplitFrontmatter(content) {
      const src = String(content ?? "");
      const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(src);
      if (!m) return { fmText: "", rest: src };
      return { fmText: m[0], rest: src.slice(m[0].length) };
    }

    /** 孤儿级联（用户定稿：删除时同步删掉因此变孤儿的页，git 单提交可整体撤回）。
     *  返回应删页面清单：目标自身 + 「全部反链都在删除集内」的递归闭包；删除前
     *  就已零入链的页不动（那是既有状态，不连坐）；根 AGENTS.md 约定文件受保护 */
    function vaultCascadeDelete(pages, targetPath) {
      const current = pages.find((p) => p.path === targetPath);
      if (!current) return [];
      const linkers = new Map(); // 页面 path → 引用它的页面 path 集合
      for (const p of pages) {
        for (const l of p.links) {
          const hit = resolveVaultLink(pages, l, p.space);
          if (!hit) continue;
          if (!linkers.has(hit.path)) linkers.set(hit.path, new Set());
          linkers.get(hit.path).add(p.path);
        }
      }
      const doomed = new Set([targetPath]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of pages) {
          if (doomed.has(p.path)) continue;
          const bl = linkers.get(p.path);
          if (!bl || bl.size === 0) continue;
          let allDoomed = true;
          for (const src of bl) {
            if (!doomed.has(src)) {
              allDoomed = false;
              break;
            }
          }
          if (allDoomed) {
            doomed.add(p.path);
            changed = true;
          }
        }
      }
      return pages.filter((p) => doomed.has(p.path) && p.rel.toUpperCase() !== "AGENTS");
    }

    /** 标题锚 slug：压空白为 -（中英混排原样保留，仅保证锚点匹配一致） */
    function vaultHeadingSlug(text) {
      return String(text ?? "").trim().replace(/\s+/g, "-");
    }

    /** wikilink 目标 → 页面：rel 全等 > rel 尾段 > 标题 > 文件名（均不分大小写）。
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
      let title = null;
      let baseName = null;
      for (const p of pages) {
        const relLower = p.rel.toLowerCase();
        if (relLower === t && prefer(p, rel)) rel = p;
        if (t.includes("/") && relLower.endsWith("/" + t) && prefer(p, suffix)) suffix = p;
        if (p.title.toLowerCase() === t && prefer(p, title)) title = p;
        const b = relLower.split("/").pop() ?? relLower;
        if (b === base && prefer(p, baseName)) baseName = p;
      }
      return rel ?? suffix ?? title ?? baseName ?? null;
    }

    /** 反链：links 能解析到当前页的其它页面（O(页数×链接数)，键集一次构建） */
    function vaultBacklinks(pages, currentPath) {
      const current = pages.find((p) => p.path === currentPath);
      if (!current) return [];
      const keys = new Set();
      const add = (s) => keys.add(String(s ?? "").replace(/\.md$/i, "").toLowerCase());
      add(current.rel);
      add(current.title);
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

    /** 左树行图标（单色 svg，随 currentColor 走主题）：目录 / 页面 / 目录+新增 */
    const VaultFolderIcon = (props) => {
      const _official = dswIcon("IconFolderClose16");
      return _official
        ? jsxRuntime.jsx(_official, { className: "dshk-vault-ticon" })
        : jsxRuntime.jsx("svg", { className: "dshk-vault-ticon", viewBox: "0 0 16 16", children: jsxRuntime.jsx("path", { d: "M1.5 4.5a1 1 0 0 1 1-1h3.1l1.7 1.9h5.7a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1v-8.5z", fill: "none", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }) });
    };
    const VaultPageIcon = () =>
      jsxRuntime.jsx("svg", { className: "dshk-vault-ticon", viewBox: "0 0 16 16", children: jsxRuntime.jsx("path", { d: "M4 2.2a0.7 0.7 0 0 1 0.7-0.7h4.2l3.6 3.6v8.6a0.7 0.7 0 0 1-0.7 0.7H4.7a0.7 0.7 0 0 1-0.7-0.7v-11.5z M9 1.8v3.3h3.3", fill: "none", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }) });

    /** 斜杠菜单：两级（wangshu 同款）——根级为分组（标题/列表含子级，多级标题
     *  快速插），叶级为插入模板。label 走 i18n，match 是中英过滤词 */
    // 斜杠菜单（wangshu 同款两级结构：分类 → 条目；条目行 = 图标徽章+标题+描述）。
    // 三件套分工不重复（wangshu 同款）：块插入只在这里，行内格式在泡泡菜单，
    // 文档级命令（撤销/重做/保存）在编辑条。条目语义：prefix = 当前行换前缀
    // （原前缀剥掉，同 wangshu 的 toggle*）；insert = 删掉 "/查询" 后插模板，
    // cursor = 光标落点偏移；rows/cols = 表格尺寸，模板按下表现生成
    const VAULT_MENU = [
      {
        key: "head",
        labelKey: "vmenuGHead",
        match: "heading h1 h2 h3 h4 h5 h6 body 标题 正文",
        children: [
          { key: "h1", icon: "H1", labelKey: "vmenuH1", descKey: "vmenuH1Desc", match: "h1 一级", prefix: "# " },
          { key: "h2", icon: "H2", labelKey: "vmenuH2", descKey: "vmenuH2Desc", match: "h2 二级", prefix: "## " },
          { key: "h3", icon: "H3", labelKey: "vmenuH3", descKey: "vmenuH3Desc", match: "h3 三级", prefix: "### " },
          { key: "h4", icon: "H4", labelKey: "vmenuH4", descKey: "vmenuH4Desc", match: "h4 四级", prefix: "#### " },
          { key: "h5", icon: "H5", labelKey: "vmenuH5", descKey: "vmenuH5Desc", match: "h5 五级", prefix: "##### " },
          { key: "h6", icon: "H6", labelKey: "vmenuH6", descKey: "vmenuH6Desc", match: "h6 六级", prefix: "###### " },
          { key: "body", icon: "P", labelKey: "vmenuBody", descKey: "vmenuBodyDesc", match: "body paragraph 正文 段落", prefix: "" },
        ],
      },
      {
        key: "special",
        labelKey: "vmenuGSpecial",
        match: "special divider hr fold quote 分割 特殊 引用 折叠",
        children: [
          { key: "hr", icon: "—", labelKey: "vmenuHr", descKey: "vmenuHrDesc", match: "hr divider 分割线", insert: "\n---\n" },
          { key: "fold", icon: "▸", labelKey: "vmenuFold", descKey: "vmenuFoldDesc", match: "fold collapsible 折叠 折叠块", insert: "<details>\n<summary>\n标题\n</summary>\n\n内容\n</details>" },
          { key: "quote", icon: "❝", labelKey: "vmenuQuote", descKey: "vmenuQuoteDesc", match: "quote blockquote 引用", prefix: "> " },
        ],
      },
      {
        key: "list",
        labelKey: "vmenuGList",
        match: "list bullet ordered task 列表 无序 有序 待办",
        children: [
          { key: "ul", icon: "•", labelKey: "vmenuUl", descKey: "vmenuUlDesc", match: "ul bullet 无序", prefix: "- " },
          { key: "ol", icon: "1.", labelKey: "vmenuOl", descKey: "vmenuOlDesc", match: "ol ordered 有序", prefix: "1. " },
          { key: "todo", icon: "☑", labelKey: "vmenuTodo", descKey: "vmenuTodoDesc", match: "todo task 待办 任务", prefix: "- [ ] " },
        ],
      },
      {
        key: "math",
        labelKey: "vmenuGMath",
        match: "math formula code 数学 公式 代码",
        children: [
          { key: "mathinline", icon: "∑", labelKey: "vmenuMathInline", descKey: "vmenuMathInlineDesc", match: "inline math 行内 公式", insert: "$$", cursor: 1 },
          { key: "mathblock", icon: "∫", labelKey: "vmenuMathBlock", descKey: "vmenuMathBlockDesc", match: "block math 行间 公式", insert: "\n$$\n\n$$", cursor: 4 },
          { key: "code", icon: "</>", labelKey: "vmenuCode", descKey: "vmenuCodeDesc", match: "code block fence 代码块", insert: "```\n\n```", cursor: 4 },
        ],
      },
      {
        key: "table",
        labelKey: "vmenuGTable",
        match: "table 表格",
        children: [
          { key: "t1x2", icon: "⊟", labelKey: "vmenuTable1", descKey: "vmenuTable1Desc", match: "table 1x2 表格", rows: 1, cols: 2 },
          { key: "t2x2", icon: "⊞", labelKey: "vmenuTable2", descKey: "vmenuTable2Desc", match: "table 2x2 表格", rows: 2, cols: 2 },
          { key: "t3x3", icon: "⊟", labelKey: "vmenuTable3", descKey: "vmenuTable3Desc", match: "table 3x3 表格", rows: 3, cols: 3 },
          { key: "t4x4", icon: "⊞", labelKey: "vmenuTable4", descKey: "vmenuTable4Desc", match: "table 4x4 表格", rows: 4, cols: 4 },
          { key: "t5x5", icon: "⊟", labelKey: "vmenuTable5", descKey: "vmenuTable5Desc", match: "table 5x5 表格", rows: 5, cols: 5 },
        ],
      },
    ];

    /** rows×cols markdown 表格模板：首行表头 + 分隔线 + rows-1 空白行体 */
    function vaultTableTemplate(rows, cols) {
      const row = (fill) => `| ${Array(cols).fill(fill).join(" | ")} |`;
      return `${row("列")}\n${row("---")}${Array(Math.max(rows - 1, 0))
        .fill("")
        .map(() => `\n${row(" ")}`)
        .join("")}`;
    }

    // ─────────── 会话监视器（conversation.composer.dock 座位）───────────
    // 对话页内监视当前打开的会话，两条自动化路径：
    // ① 终态失败续跑：回合以可重试类错误终态（RATE_LIMIT/SERVER/TIMEOUT/
    //    TRANSPORT/EMPTY_RESPONSE——宿主 llm-retry 链内部 5 次退避耗尽后才落到
    //    turn-error）结束时，等 monitorWaitMs 再 inputActions.setDraft("继续")+
    //    submit()（官方停止按钮同款 wire 语义的用户侧续跑通道）。
    // ② 死循环停止：仅回合运行中每 1s 扫描「当前流文本」（双源：宿主 partial
    //    投影优先，退最新未中断 assistant 节点——本宿主 legacy.partial 恒 null
    //    且节点落地即全长），尾部自重叠连续重复 ≥monitorRepeatThreshold 次判
    //    死循环 → sessions 服务 cancel() 停止当前回合（官方停止按钮同款调用），
    //    停止完成后照 ① 等待续跑。
    // 约束：连续自动续跑达 monitorMaxAuto 次暂停（一次正常完成的回合即重置）；
    // 停止动作不受上限（防死循环烧 token），续跑受上限；等待期间用户介入（手动
    // 发消息使回合运行 / 草稿非空）即放弃本次自动续跑；同一条 turn-error 只自动
    // 接管一次。仅监视当前打开的会话——dock 座位随会话页挂载/卸载，切走即停。
    const MONITOR_RETRYABLE = new Set(["RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"]);
    const MONITOR_SCAN_MS = 1000; // 扫描周期：检测延迟 1-2s；真实死循环以分钟计，绰绰有余
    const MONITOR_MIN_BLOCK = 8; // 重复块最短长度：放过短分隔符/标点（--- 、换行噪声）
    const MONITOR_MAX_BLOCK = 128; // 重复块最长扫描长度：兜住长句循环，扫描成本封顶
    /** 错误码 → 本地化短语；未知码原样显示 */
    function monitorErrText(code) {
      const key = `monitorErr${code}`;
      const s = tf(key);
      return s === key ? String(code || "") : s;
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

    /** ① 接管判据（纯函数）：可接管的错误 = 对话「最后一条事件」的 turn-error——
     *  错误的 seq 必须等于全部节点的最大 seq。只按 handledRef 记账不看点位会让
     *  历史错误被重新接管：429 失败后人工/自动续跑成功、对话正常收尾，那条历史
     *  turn-error 仍在，切会话回来（记账清空）就误判成当前失败再发一轮「继续」。
     *  用 max-seq 而非「末条节点恰好是 turn-error」：宿主在尾部追加记账类节点时
     *  后者会漏判。无 seq 字段时（理论不出现）保守不接管。 */
    function monitorTakeoverError(nodes) {
      let lastErr = null;
      let maxSeq = null;
      for (const n of nodes ?? []) {
        if (!n) continue;
        if (typeof n.seq === "number" && (maxSeq === null || n.seq > maxSeq)) maxSeq = n.seq;
        if (n.kind === "turn-error") lastErr = n;
      }
      if (!lastErr || maxSeq === null || lastErr.seq !== maxSeq) return null;
      return lastErr;
    }
    /** ③ 恢复判定（纯函数）：回合收尾的最后一个节点不是 turn-error（失败收尾）、
     *  也不是 interrupted 的 assistant（监视器自己 cancel 停的），就算一次正常
     *  完成的回合。空对话不算恢复。 */
    function monitorRecoveredTail(nodes) {
      const last = (nodes ?? [])[(nodes ?? []).length - 1];
      if (!last) return false;
      if (last.kind === "turn-error") return false;
      if (last.kind === "assistant" && last.interrupted === true) return false;
      return true;
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
      // plan: null | {phase:"waiting",fireAt,code,seq,reason} | {phase:"stopping"} | {phase:"capped",max}
      const [plan, setPlan] = react.useState(null);
      const [now, setNow] = react.useState(() => Date.now());
      const [autoCount, setAutoCount] = react.useState(0);
      const handledRef = react.useRef(new Set()); // 已接管的 turn-error seq（会话切换清空）
      const partialTextRef = react.useRef(null); // 最新流式文本（partial.blocks 拼接）
      const partialKeyRef = react.useRef(null); // 镜像侧记录的当前流 turn/step
      const lastStreamKeyRef = react.useRef(null); // 上次扫描的数据源标识（换源 = 新回合）
      const lastLenRef = react.useRef(0); // 本源扫描基线
      const nodesSeqRef = react.useRef(null); // 最新「未中断」assistant 节点 seq
      const nodesTextRef = react.useRef(null); // 该节点的文本（回合内步骤落地即扫一次）
      const stoppingRef = react.useRef(false); // cancel 已发出（防重复触发；续跑后复位）
      // 会话切换：监视状态全部归零
      react.useEffect(() => {
        handledRef.current = new Set();
        partialTextRef.current = null;
        partialKeyRef.current = null;
        lastStreamKeyRef.current = null;
        lastLenRef.current = 0;
        nodesSeqRef.current = null;
        nodesTextRef.current = null;
        stoppingRef.current = false;
        setPlan(null);
        setAutoCount(0);
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
      // ① 终态失败检测：空闲 + 「最后一条事件」是未接管的可重试 turn-error → 计划
      //    等待（历史错误不接管，见 monitorTakeoverError 注释）
      react.useEffect(() => {
        if (!cfg.monitorEnabled || running || !inputActions) return;
        const lastErr = monitorTakeoverError(nodes);
        if (!lastErr) return;
        const key = String(lastErr.seq);
        if (handledRef.current.has(key)) return;
        handledRef.current.add(key);
        if (!MONITOR_RETRYABLE.has(lastErr.code)) return; // AUTH 等不可重试类不自动续
        if (autoCount >= cfg.monitorMaxAuto) {
          setPlan({ phase: "capped", max: cfg.monitorMaxAuto });
          return;
        }
        setPlan({ phase: "waiting", fireAt: Date.now() + cfg.monitorWaitMs, code: lastErr.code, seq: lastErr.seq, reason: "error" });
      }, [nodes, running, cfg.monitorEnabled, cfg.monitorMaxAuto, cfg.monitorWaitMs, autoCount, inputActions]);
      // ③ 恢复清零（回合边界判定）：盯 running 由 true→false 的那次收尾，末尾形状
      //    按 monitorRecoveredTail 判——正常完成即连续计数清零、capped 一并解除。
      //    旧实现要求「末条节点必须是未打断的 assistant」，工具收尾/宿主尾部记账
      //    节点都会漏判，计数跨健康回合一路累到 capped，之后再不自动续跑。收尾
      //    节点可能晚 running 一拍落地，延迟一拍再读 nodesRef；不做 cleanup——
      //    重复判定幂等（setAutoCount(0) 恒安全），transition 只会排一个
      const nodesRef = react.useRef(nodes);
      nodesRef.current = nodes;
      const prevRunningRef = react.useRef(false);
      react.useEffect(() => {
        const was = prevRunningRef.current;
        prevRunningRef.current = running;
        if (!was || running) return;
        if (autoCount === 0 && plan?.phase !== "capped") return;
        setTimeout(() => {
          if (monitorRecoveredTail(nodesRef.current)) {
            setAutoCount(0);
            setPlan((p) => (p?.phase === "capped" ? null : p));
          }
        }, 50);
      }, [running, autoCount, plan]);
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
      // stopping → 停止完成转等待（上限内）或 capped（超限：停而不续）；
      // 停止超时（cancel 失败/被拒）放弃并复位
      react.useEffect(() => {
        if (plan?.phase !== "stopping") return undefined;
        if (!running) {
          if (autoCount >= cfg.monitorMaxAuto) setPlan({ phase: "capped", max: cfg.monitorMaxAuto });
          else setPlan({ phase: "waiting", fireAt: Date.now() + 2500, code: "", seq: 0, reason: "repeat" });
          return undefined;
        }
        const giveUp = setTimeout(() => {
          stoppingRef.current = false;
          setPlan(null);
        }, 15000);
        return () => clearTimeout(giveUp);
      }, [plan, running, autoCount, cfg.monitorMaxAuto]);
      // 等待期间用户介入（手动发消息使回合运行）→ 放弃本次自动续跑
      react.useEffect(() => {
        if (plan?.phase === "waiting" && running) setPlan(null);
      }, [running, plan]);
      // 倒计时跳动
      react.useEffect(() => {
        if (plan?.phase !== "waiting") return undefined;
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
      }, [plan]);
      // 到点执行：草稿非空（用户在打字）或回合又跑起来都视为介入，放弃续跑；
      // 超限兜底转 capped（正常路径到不了这里——stopping 转换已挡）
      react.useEffect(() => {
        if (plan?.phase !== "waiting") return;
        if (Date.now() < plan.fireAt) return;
        if (autoCount >= cfg.monitorMaxAuto) {
          setPlan({ phase: "capped", max: cfg.monitorMaxAuto });
          return;
        }
        if (running || String(draft ?? "").trim() !== "") {
          setPlan(null);
          return;
        }
        // 话术分流（用户定稿）：429 等失败发「继续」；死循环发带循环提示的话——
        // 让 agent 知道自己卡在循环里，停止重复并换方式推进
        inputActions.setDraft(tf(plan.reason === "repeat" ? "monitorLoopBreakText" : "monitorContinueText"));
        inputActions.submit();
        stoppingRef.current = false; // 续跑已发出：本会话下一回合的死循环仍要接管
        setAutoCount((c) => c + 1);
        setPlan(null);
      }, [plan, now, running, draft, autoCount, cfg.monitorMaxAuto, inputActions]);
      if (!plan || !cfg.monitorEnabled) return null;
      let line = "";
      if (plan.phase === "waiting") {
        const sec = Math.max(0, Math.ceil((plan.fireAt - now) / 1000));
        const err = plan.reason === "repeat" ? tf("monitorRepeatErr") : monitorErrText(plan.code);
        line = tf("monitorAutoIn", { err, sec: String(sec), n: String(autoCount + 1), max: String(cfg.monitorMaxAuto) });
      } else if (plan.phase === "stopping") {
        line = tf("monitorStopping");
      } else if (plan.phase === "capped") {
        line = tf("monitorCapped", { max: String(cfg.monitorMaxAuto) });
      }
      return jsxRuntime.jsxs("div", {
        className: "dshk-monitor-line",
        children: [
          jsxRuntime.jsx("span", { className: "dshk-monitor-text", children: line }),
          plan.phase === "waiting"
            ? jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-monitor-cancel",
                onClick: () => setPlan(null),
                children: t("monitorCancel"),
              })
            : null,
        ],
      });
    }

    function VaultView() {
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      // 只保留开关门槛；vaultRoot 不读 settings 快照——手机/远程浏览器拿不到设置
      // 镜像（快照恒 loading，回退默认空串），root 由 VaultRootView 从
      // /dsh-kit/vault/index 自取，那才是两端一致的配置源
      if (cfg.vaultEnabled === false) {
        return jsxRuntime.jsxs("div", { className: "dshk-vault", children: [
          jsxRuntime.jsx("div", { className: "dshk-vault-hinttitle", children: t("vaultNotConfigured") }),
          jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultNotConfiguredHint") }),
        ] });
      }
      return jsxRuntime.jsx(VaultRootView, {});
    }

    // ─────────── RTE 编辑面（知识库页与工作区 md 共用，2026-09-10 合流）───────────
    // TipTap 富文本编辑器挂载 + 斜杠菜单 + 泡泡菜单 + 自动保存（2s 防抖 +
    // Ctrl+S + 卸载保底 + 冲突暂停）全部收拢在这里；端点差异（vault 带_fm
    // / 工作区文件走 /dsh-kit/write）由 onSave(md, mode) 回调承担，mode ∈
    // auto|manual|overwrite，返回 'ok'|'conflict'|'fail'。conflict 会暂停
    // 自动保存，直到父层重载（docTick bump 重挂）或 overwrite 成功。
    // rteRef 直通 RTE 句柄（父层页条按钮 undo/redo/表格等照旧调用）；
    // ctlRef 暴露 { dirty, flush, flushManual, overwrite } 供切页 flush。
    function RteEditor({ rteRef, ctlRef, docKey, docTick, initialMd, placeholder, labels, onWikiLink, resolveWiki, resolveSrc, onSave, onState, onPaste }) {
      const [libsReady, setLibsReady] = react.useState(false);
      const [libsFailed, setLibsFailed] = react.useState(false);
      const [md, setMd] = react.useState(initialMd ?? "");
      const [inTableState, setInTableState] = react.useState(false);
      const rteHostRef = react.useRef(null);
      // 斜杠菜单：{query, x, y} | null（/ 触发：行首或空白后，键入过滤，Esc/失焦关）
      const [menu, setMenu] = react.useState(null);
      const [menuIdx, setMenuIdx] = react.useState(0);
      // 泡泡菜单：{x, y, above} | null（选区非空时浮在选区上/下方）；bubPanel =
      // 展开的色板（"tc" 文字颜色 | "hc" 高亮）
      const [bub, setBub] = react.useState(null);
      const [bubPanel, setBubPanel] = react.useState(null);
      // ref 镜像 state：capture 监听读 ref，直接读 state 会停在旧渲染的闭包里
      const menuRef = react.useRef(menu);
      const menuIdxRef = react.useRef(menuIdx);
      menuRef.current = menu;
      menuIdxRef.current = menuIdx;
      const bubRef = react.useRef(bub);
      bubRef.current = bub;
      const mdRef = react.useRef(md);
      mdRef.current = md;
      const savedMdRef = react.useRef(initialMd ?? "");
      const pausedRef = react.useRef(false); // 冲突暂停自动保存
      const initialMdRef = react.useRef(initialMd);
      initialMdRef.current = initialMd;
      // 父层回调 ref 镜像：编辑器实例闭包里永远读到最新
      const onSaveRef = react.useRef(onSave);
      onSaveRef.current = onSave;
      const onStateRef = react.useRef(onState);
      onStateRef.current = onState;
      const confRef = react.useRef({ onWikiLink, resolveWiki, resolveSrc, labels, placeholder });
      confRef.current = { onWikiLink, resolveWiki, resolveSrc, labels, placeholder };

      // 光标所属标题链（VS Code 面包屑同款）：heading 是顶层块互不嵌套，层级
      // 归属按「文档顺序」解释——从光标顶层块向前扫，遇到比链尾更高级（level
      // 更小）的标题就接上，得到 「# 一级 > ## 二级 > ### 三级」；二级标题归属
      // 它上面最近的同级/上级标题语境（用户定稿：二级属于最近的一级）。
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
        const h = rteRef.current;
        onStateRef.current?.({
          dirty: h ? h.getMd() !== savedMdRef.current : false,
          inTable: inTableRef.current,
          crumb: crumbOf(),
        });
      };
      const inTableRef = react.useRef(false);

      react.useEffect(() => {
        ensureRteLib()
          .then(() => ensureMdLibs())
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
      const applyMenuTemplate = (item) => {
        const h = rteRef.current;
        if (!h) return;
        const ed = h.editor;
        const { $from } = ed.state.selection;
        const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 80), $from.parentOffset, "\n", "\n");
        const m = /(?:^|[\s\u3000-\u303F\uFF01-\uFF5E])\/(\S*)$/.exec(textBefore);
        setMenu(null);
        if (m) {
          // 删掉 "/查询" 再应用条目
          ed.view.dispatch(ed.view.state.tr.delete(Math.max(0, $from.pos - (m[1] ?? "").length - 1), $from.pos));
        }
        h.focus();
        if (!m) return;
        const key = item.key ?? "";
        if (item.rows) h.insertTable(item.rows, item.cols ?? item.rows);
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
      /** 链接（wangshu 同款 prompt 交互）：已有链接改地址（空=删除），否则包新链接 */
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
      // 泡泡/斜杠/表格态）。docKey=归属路径；docTick 变化强制重挂（冲突回读）。
      // 自动保存钉住挂载页（docKey 局部闭包），切页后的卸载保底不会写错路径
      react.useEffect(() => {
        const host = rteHostRef.current;
        if (!libsReady || libsFailed || !host) return undefined;
        const mountedKey = docKey;
        const cf = confRef.current;
        const opts = {
          md: initialMdRef.current ?? "",
          placeholder: cf.placeholder,
          labels: cf.labels,
        };
        if (cf.onWikiLink) opts.onWikiLink = cf.onWikiLink;
        if (cf.resolveWiki) opts.resolveWiki = cf.resolveWiki;
        if (cf.resolveSrc) opts.resolveSrc = cf.resolveSrc;
        const h = window.DshRTE.create(host, opts);
        rteRef.current = h;
        pausedRef.current = false;
        // 挂载即对齐基准：初次 serialize 可能规整化原文格式（尾随空行等），
        // 基准取编辑器 md 而非盘上原文——打开即编辑不误报脏
        const initial = h.getMd();
        savedMdRef.current = initial;
        mdRef.current = initial;
        setMd(initial);
        report();
        // 阅读位置：滚动节流记录 + create 之后一拍恢复（挂载即恢复会白设——
        // maxScroll 未建立）。docKey=归属路径，工作区 md 与知识库页同享
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
        restoreReadPos(mountedKey, host, (anchor) => {
          try {
            const size = h.editor.state.doc.content.size;
            if (typeof anchor === "number" && anchor <= size) h.editor.commands.setTextSelection(anchor);
          } catch {
            /* 选区失效按纯滚动恢复 */
          }
        });
        // 自动保存（wangshu 同款 2s 防抖）：变更后 350ms 算 md（脏点基准），
        // 2s 后落盘；冲突时暂停（pausedRef）
        let mdTimer = null;
        let saveTimer = null;
        const localAutosave = async () => {
          if (pausedRef.current) return;
          const hh = rteRef.current;
          if (!hh) return;
          const bodyMd = hh.getMd();
          const outcome = await onSaveRef.current(bodyMd, "auto");
          if (outcome === "conflict") pausedRef.current = true;
          else if (outcome === "ok") {
            savedMdRef.current = bodyMd;
            mdRef.current = bodyMd;
            setMd(bodyMd);
          }
          report();
        };
        const flushSave = () => {
          if (saveTimer === null) return;
          saveTimer = null;
          void localAutosave();
        };
        const offUpdate = h.onUpdate(() => {
          report(); // 键入改标题文本时面包屑即时跟随（dirty/inTable 同值时 React 直接跳出）
          clearTimeout(mdTimer);
          mdTimer = setTimeout(() => {
            mdTimer = null;
            const hh = rteRef.current;
            if (!hh) return;
            const v = hh.getMd();
            mdRef.current = v;
            setMd(v);
          }, 350);
          clearTimeout(saveTimer);
          saveTimer = setTimeout(flushSave, 2000);
        });
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
            setMenu({ query: q, sub: null, x: coords?.left ?? 240, y: (coords?.bottom ?? 200) + 4, at: coords?.top ?? 0 });
            setMenuIdx((i) => i);
          } else if (menuRef.current !== null) {
            setMenu(null);
          }
        };
        const onKeyDown = (e) => {
          // Ctrl+S：立即落盘（toast 反馈在 onSave 的 manual 分支）
          if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            e.stopPropagation();
            void (async () => {
              const hh = rteRef.current;
              if (!hh) return;
              const outcome = await onSaveRef.current(hh.getMd(), "manual");
              if (outcome === "ok") {
                savedMdRef.current = hh.getMd();
                report();
              }
            })();
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
            // 数字键 1-9 直达（wangshu 同款）：分类层跳进第 n 组，条目层直接应用
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
          clearTimeout(mdTimer);
          clearTimeout(saveTimer);
          // 阅读位置兜底记一次（隐藏容器由 recordReadPos 自行跳过）
          if (posTimer !== null) clearTimeout(posTimer);
          host.removeEventListener("scroll", onPosScroll);
          recordReadPos(mountedKey, host, posAnchor());
          // 有防抖未触发的改动 → 卸载前尽力落盘（wangshu 同款保底；钉住挂载页
          // 路径，冲突时放弃）
          if (
            !pausedRef.current
            && rteRef.current
            && rteRef.current.getMd() !== savedMdRef.current
          ) {
            void onSaveRef.current(rteRef.current.getMd(), "auto");
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
        // 日常保存不重挂（docTick 不动），打开新页（docKey）/冲突回读（docTick）才重挂
      }, [libsReady, libsFailed, docKey, docTick]);

      // 控制面暴露给父层：切页 flush / Ctrl&S 语义 / 覆盖盘上 / 脏判定
      ctlRef.current = {
        dirty: () => (rteRef.current ? rteRef.current.getMd() !== savedMdRef.current : false),
        flush: async () => {
          const hh = rteRef.current;
          if (!hh || pausedRef.current) return "fail";
          const outcome = await onSaveRef.current(hh.getMd(), "auto");
          if (outcome === "ok") {
            savedMdRef.current = hh.getMd();
            report();
          }
          return outcome;
        },
        flushManual: async () => {
          const hh = rteRef.current;
          if (!hh) return "fail";
          const outcome = await onSaveRef.current(hh.getMd(), "manual");
          if (outcome === "ok") {
            savedMdRef.current = hh.getMd();
            report();
          }
          return outcome;
        },
        overwrite: async () => {
          const hh = rteRef.current;
          if (!hh) return "fail";
          const outcome = await onSaveRef.current(hh.getMd(), "overwrite");
          if (outcome === "ok") {
            pausedRef.current = false;
            savedMdRef.current = hh.getMd();
            report();
          }
          return outcome;
        },
      };

      return jsxRuntime.jsxs("div", { className: "dshk-vault-editwrap", onPaste, children: [
        libsFailed
          ? jsxRuntime.jsx("textarea", { className: "dshk-vault-rtefallback", value: md, onChange: (e) => setMd(e.target.value), spellCheck: false })
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
                                  // 分类行（wangshu 同款）：序号徽章 + 组名 + ›
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashnum", children: i + 1 }, "num"),
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashtitle", children: t(row.labelKey) }, "title"),
                                  jsxRuntime.jsx("span", { className: "dshk-vault-slashmore", children: "›" }, "more"),
                                ]
                              : [
                                  // 条目行（wangshu 同款）：图标徽章 + 标题/描述两行
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
      ] });
    }

    /** 知识库索引半边（单实例，portal 进侧栏索引宿主）：空间/目录树/搜索/建页 +
     *  页标签编排（打开、关闭、← → 访问序）。页编辑器不在本组件——每开一页一个
     *  VaultPagePane 经 portal 投进右栏 pane 宿主，一页一标签（2026-09-10 多开定稿）。 */
    function VaultRootView() {
      const ui = useKitUi();
      const sideHost = useHostSlot(vaultSideSlot);
      const paneHost = useHostSlot(vaultPaneSlot);
      const [index, setIndex] = react.useState(null);
      const [indexErr, setIndexErr] = react.useState("");
      const [space, setSpace] = react.useState(""); // '' = 全部库
      // 目录树：path → entries|null(加载中)；expanded: path → bool
      const [treeDirs, setTreeDirs] = react.useState({});
      const [expanded, setExpanded] = react.useState({});
      // 建页/建目录合并入口（用户定稿 2026-09-07）：createDir = 内联输入框所在
      // 目录（null 关闭）；输入 `\` 开头 = 新建目录（剥掉前缀），否则建页面；
      // 两者都还可带 / 多级。区域外点击 = 取消（直接丢弃，理由同文件树）
      const [createDir, setCreateDir] = react.useState(null);
      const [createTitle, setCreateTitle] = react.useState("");
      react.useEffect(() => {
        if (createDir === null) return undefined;
        const onDown = (e) => {
          if (e.target instanceof Element && !e.target.closest(".dshk-vault-createrow")) setCreateDir(null);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [createDir]);
      const [searchQ, setSearchQ] = react.useState("");
      const [searchRes, setSearchRes] = react.useState(null);
      const [searching, setSearching] = react.useState(false);
      const [toast, setToast] = react.useState("");

      // 激活页 = 当前标签；页编辑器的全部状态住在各自的 VaultPagePane 里
      const current = ui.activeVaultPage ?? null;
      // root 从 index 响应取而非入参；null = 索引未就绪（加载中/未配置/失败），
      // 整页态由下方早退分支承担
      const root = index !== null && typeof index.root === "string" && index.root !== "" ? index.root : null;
      const treeRoot = root === null ? null : root + (space === "" ? "" : "/" + space);

      const loadIndex = react.useCallback(async () => {
        try {
          const body = await schedFetch("/dsh-kit/vault/index");
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
       *  非 silent = 交互路径（展开/建页后），要的就是「正在加载」与失败即空。 */
      const fetchDir = react.useCallback(async (dir, silent = false) => {
        if (!silent) setTreeDirs((d) => ({ ...d, [dir]: null }));
        try {
          const body = await schedFetch(`/dsh-kit/tree?path=${encodeURIComponent(dir)}`);
          const usable = (body.entries ?? []).filter((e) => {
            if (e.dir) return !e.name.startsWith(".") && !["attachments", "node_modules"].includes(e.name);
            return /\.md$/i.test(e.name);
          });
          setTreeDirs((d) => ({ ...d, [dir]: usable }));
        } catch {
          if (!silent) setTreeDirs((d) => ({ ...d, [dir]: [] }));
        }
      }, []);

      // 索引 + 已展开目录一起重拉的唯一实现（工具条 ↻ 与背景自动刷新共用）。
      // 目录树是懒加载缓存（treeDirs），只调 loadIndex 换不到树上的条目——外部
      // 增删的文件在侧栏看不见，刷新就等于没刷（2026-09-11 用户报「刷新不可用」）。
      // 展开态走 ref 读：免得这个回调跟着每次展开动作重建、把背景定时器重置
      const expandedRef = react.useRef(expanded);
      expandedRef.current = expanded;
      const reloadData = react.useCallback(async () => {
        const dirs = Object.keys(expandedRef.current).filter((d) => expandedRef.current[d] === true);
        await loadIndex();
        await Promise.all(dirs.map((d) => fetchDir(d, true)));
      }, [loadIndex, fetchDir]);

      // 外部增删文件及时可见（vscode 式，用户定稿 2026-09-09）：打开页的正文
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
      const manualRefresh = react.useCallback(async () => {
        setRefreshing(true);
        try {
          await reloadData();
          setToast(t("vaultRefreshed"));
        } finally {
          setRefreshing(false);
        }
      }, [reloadData]);

      // 空间切换：树状态清空并展开根层（root 未就绪时只清空，不拉树）
      react.useEffect(() => {
        setTreeDirs({});
        if (treeRoot === null) return;
        setExpanded({ [treeRoot]: true });
        void fetchDir(treeRoot);
      }, [treeRoot, fetchDir]);

      // 开页统一入口（侧栏目录/搜索/反链/碎链建页/对话路径/wikilink 都走这里）：
      // 打开或激活该页的知识库页签，右栏路径顺带把「知识库」dock 签带到眼前
      // （索引即入口）。切页前的未存草稿由被切走的那个 pane 自己在失活时
      // flush（标签仍挂载，草稿不会丢）。
      const openPath = react.useCallback((path) => {
        openVaultPageAndDock(path);
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

      const createInSpace = react.useCallback(
        async (title, dir) => {
          let trimmed = String(title ?? "").trim();
          if (trimmed === "") return;
          // dir 给定时空间/子前缀由目录推导（树上建页）；不给则用空间下拉（碎链建页）
          let sp = space;
          if (dir) {
            const sub = dir.startsWith(root) ? dir.slice(root.length).replace(/^[\\/]+/, "") : "";
            const segs = sub === "" ? [] : sub.split(/[\\/]/);
            sp = segs[0] ?? "";
            const prefix = segs.slice(1).join("/");
            if (prefix !== "") trimmed = `${prefix}/${trimmed}`;
          }
          try {
            const body = await schedFetch("/dsh-kit/vault/page", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ space: sp, title: trimmed }),
            });
            setCreateDir(null);
            setCreateTitle("");
            if (dir) {
              setExpanded((e) => ({ ...e, [dir]: true }));
              void fetchDir(dir);
            }
            await loadIndex();
            if (body.path) openPath(body.path);
          } catch (error) {
            setToast(`${t("vaultSaveFail")} ${String(error?.message ?? error)}`);
          }
        },
        [space, root, current, loadIndex, openPath, fetchDir],
      );
      // 新建目录（树上建目录按钮）：端点幂等，已存在也算成功；空目录 tree 照列
      const mkdirIn = react.useCallback(
        async (name, dir) => {
          let trimmed = String(name ?? "").trim();
          if (trimmed === "") return;
          const sub = dir.startsWith(root) ? dir.slice(root.length).replace(/^[\\/]+/, "") : "";
          const segs = sub === "" ? [] : sub.split(/[\\/]/);
          const sp = segs[0] ?? "";
          const prefix = segs.slice(1).join("/");
          if (prefix !== "") trimmed = `${prefix}/${trimmed}`;
          try {
            await schedFetch("/dsh-kit/vault/mkdir", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ space: sp, dir: trimmed }),
            });
            setCreateDir(null);
            setCreateTitle("");
            setExpanded((e) => ({ ...e, [dir]: true }));
            void fetchDir(dir);
          } catch (error) {
            setToast(`${t("vaultSaveFail")} ${String(error?.message ?? error)}`);
          }
        },
        [root, fetchDir],
      );

      const runSearch = async () => {
        const q = searchQ.trim();
        if (q === "") {
          setSearchRes(null);
          return;
        }
        setSearching(true);
        try {
          const body = await schedFetch(`/dsh-kit/vault/search?q=${encodeURIComponent(q)}`);
          setSearchRes(body.results ?? []);
        } catch (error) {
          setToast(`${t("vaultSearchFail")} ${String(error?.message ?? error)}`);
        }
        setSearching(false);
      };

      // toast 自动消隐
      react.useEffect(() => {
        if (toast === "") return undefined;
        const timer = setTimeout(() => setToast(""), 2600);
        return () => clearTimeout(timer);
      }, [toast]);

      const indexPages = index?.pages ?? [];
      // 历史前进/后退 = 在访问序里挪位并激活对应页标签（标签还在才挪得动，
      // 被关掉的历史项在关闭时已剪掉）。未落盘草稿由失活的 pane 自己收尾
      const hist = ui.vaultHist ?? { stack: [], idx: -1 };
      const histGo = (toIdx) => {
        const path = hist.stack[toIdx];
        if (path === undefined) return;
        setKitUi({ ...activateVaultPage(kitUi, path), vaultHist: { stack: hist.stack, idx: toIdx } });
      };
      const histBack = () => histGo(Math.max(0, hist.idx - 1));
      const histFwd = () => histGo(Math.min(hist.stack.length - 1, hist.idx + 1));
      const toggleDir = (dir) => {
        const opening = expanded[dir] !== true;
        setExpanded((e) => ({ ...e, [dir]: opening }));
        if (opening) void fetchDir(dir);
      };
      // 目录行悬停 +（单一建页/目录按钮，或左轨头部）→ 该目录下弹出内联建输入
      const startCreate = (dir) => {
        setCreateDir(dir);
        setCreateTitle("");
        setExpanded((e) => ({ ...e, [dir]: true }));
        void fetchDir(dir);
      };
      const submitCreate = (dir) => {
        const raw = createTitle.trim();
        if (raw === "") return;
        // `\` 前缀建目录（可多级），其余建页面
        if (raw.startsWith("\\")) {
          const name = raw.slice(1).trim();
          if (name !== "") void mkdirIn(name, dir);
        } else {
          void createInSpace(raw, dir);
        }
      };
      const createRow = (dir, depth, key) =>
        jsxRuntime.jsxs(
          "div",
          {
            className: "dshk-vault-createrow",
            style: { marginLeft: 4 + depth * 14 },
            children: [
              jsxRuntime.jsx("input", {
                autoFocus: true,
                value: createTitle,
                placeholder: t("vaultNewPh"),
                onChange: (e) => setCreateTitle(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") submitCreate(dir);
                  if (e.key === "Escape") setCreateDir(null);
                  if (e.key === "Backspace" && createTitle === "") setCreateDir(null);
                },
              }),
            ],
          },
          key,
        );
      const renderDir = (dirPath, depth) => {
        if (expanded[dirPath] !== true) return null;
        const entries = treeDirs[dirPath];
        if (!entries) return jsxRuntime.jsx("div", { className: "dshk-vault-treeload", style: { paddingLeft: 10 + depth * 14 }, children: "…" }, `${dirPath}#load`);
        return entries.map((e) => {
          if (e.dir) {
            // 空目录判定（用户定稿 2026-09-07）：vault 语义下没有后代的目录
            // 就是空的——索引页（root 相对 rel）无一落在该目录前缀下即空，
            // 去掉展开钮（没东西可展开），行保留（有看到空目录的必要）
            const rel = e.path.slice(treeRoot.length).split(/[\\/]+/).filter(Boolean).join("/");
            const prefix = space === "" ? `${rel}/` : `${space}/${rel}/`;
            const hasPage = indexPages.some((p) => p.rel.startsWith(prefix));
            return jsxRuntime.jsxs(
              "div",
              {
                children: [
                  jsxRuntime.jsxs("div", {
                    className: "dshk-vault-treerow",
                    style: { paddingLeft: 10 + depth * 14 },
                    onClick: () => {
                      if (hasPage) toggleDir(e.path);
                    },
                    children: [
                      hasPage ? jsxRuntime.jsx("span", { className: `dshk-vault-twist${expanded[e.path] === true ? " is-open" : ""}`, children: "▸" }) : jsxRuntime.jsx("span", { className: "dshk-vault-twist" }),
                      jsxRuntime.jsx(VaultFolderIcon, {}),
                      jsxRuntime.jsx("span", { className: "dshk-vault-treename", children: e.name }),
                      jsxRuntime.jsx("span", {
                        className: "dshk-vault-treeplus",
                        title: `${t("vaultNewAny")} · ${e.name}`,
                        onClick: (ev) => {
                          ev.stopPropagation();
                          startCreate(e.path);
                        },
                        children: "+",
                      }),
                    ],
                  }),
                  createDir === e.path ? createRow(e.path, depth + 1, `${e.path}#create`) : null,
                  renderDir(e.path, depth + 1),
                ],
              },
              e.path,
            );
          }
          return jsxRuntime.jsx(
            "div",
            {
              className: `dshk-vault-treerow${e.path === current ? " is-active" : ""}`,
              style: { paddingLeft: 10 + (depth + 1) * 14 },
              // 点目录条目 = 开右栏知识库签看页（索引即入口，工作台定稿）
              onClick: () => {
                openPath(e.path);
              },
              title: e.path,
              children: [
                jsxRuntime.jsx(VaultPageIcon, {}),
                jsxRuntime.jsx("span", { className: "dshk-vault-treename", children: e.name.replace(/\.(md|markdown)$/i, "") }),
              ],
            },
            e.path,
          );
        });
      };

      // root 未就绪的整页态：加载中 / 未配置 / 索引失败（root 就绪后的瞬时错误
      // 走主界面内的错误条，不早退）。portal 进任一在场的宿主（右栏优先）
      if (root === null) {
        let earlyBody;
        if (indexErr === "") earlyBody = jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") });
        else if (indexErr === "vault-not-configured") {
          earlyBody = jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "dshk-vault-hinttitle", children: t("vaultNotConfigured") }),
            jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultNotConfiguredHint") }),
          ] });
        } else earlyBody = jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: `${t("vaultIndexFail")} ${indexErr}` });
        const target = ui.vaultOpen && paneHost ? paneHost : sideHost;
        return target
          ? reactDom.createPortal(jsxRuntime.jsx("div", { className: "dshk-vault", children: earlyBody }), target, "dshk-vault-early")
          : null;
      }

      // 工具条 + 搜索结果 + 目录树 → 侧栏索引宿主；页编辑器 → 右栏 pane 宿主。
      // 单实例双 portal：两侧各自在场才投递（侧栏关闭/右栏关签互不影响）。
      // 工具条两行（用户定稿 2026-09-11）：上行导航/空间/刷新，下行搜索独占——
      // 挤在一行时搜索框只剩半截宽，占位提示都被截掉
      const sideContent = jsxRuntime.jsxs("div", { className: "dshk-vault-sidewrap", children: [
        jsxRuntime.jsxs("div", { className: "dshk-vault-toolbar", children: [
          jsxRuntime.jsxs("div", { className: "dshk-vault-tbarrow", children: [
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", "aria-label": t("vaultHistBack"), title: t("vaultHistBack"), disabled: hist.idx <= 0, onClick: histBack, children: "←" }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", "aria-label": t("vaultHistFwd"), title: t("vaultHistFwd"), disabled: hist.idx >= hist.stack.length - 1, onClick: histFwd, children: "→" }),
            jsxRuntime.jsxs("select", {
              className: "dshk-vault-spacesel",
              value: space,
              onChange: (e) => setSpace(e.target.value),
              children: [
                jsxRuntime.jsx("option", { value: "", children: t("vaultSpaceAll") }),
                (index?.spaces ?? []).map((s) => jsxRuntime.jsx("option", { value: s, children: s }, s)),
              ],
            }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn dshk-vault-tbpush", "aria-label": t("vaultRefresh"), title: t("vaultRefresh"), disabled: refreshing, onClick: () => void manualRefresh(), children: "↻" }),
          ] }),
          jsxRuntime.jsxs("div", { className: "dshk-vault-tbarrow", children: [
            jsxRuntime.jsx("input", {
              className: "dshk-vault-search",
              value: searchQ,
              placeholder: t("vaultSearchPh"),
              onChange: (e) => setSearchQ(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") void runSearch();
              },
            }),
          ] }),
        ] }),
        searchRes !== null
          ? jsxRuntime.jsxs("div", { className: "dshk-vault-searchres", children: [
              searchRes.length === 0 ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultSearchEmpty") }) : null,
              searchRes.map((r) =>
                jsxRuntime.jsxs("div", { className: "dshk-vault-hitrow", onClick: () => { setSearchRes(null); openPath(r.path); }, children: [
                  jsxRuntime.jsx("span", { className: "dshk-vault-hittitle", children: r.title }),
                  jsxRuntime.jsx("span", { className: "dshk-vault-hitsnippet", children: r.snippet }),
                ] }, r.path),
              ),
            ] })
          : null,
        indexErr !== ""
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: indexErr === "vault-not-configured" ? t("vaultNotConfiguredHint") : `${t("vaultIndexFail")} ${indexErr}` })
          : null,
        jsxRuntime.jsxs("div", { className: "dshk-vault-rail", children: [
          jsxRuntime.jsxs("div", { className: "dshk-vault-railhead", children: [
            jsxRuntime.jsx("span", { className: "dshk-vault-railtitle", title: treeRoot, children: space === "" ? t("vaultSpaceAll") : space }),
            jsxRuntime.jsx("span", {
              className: "dshk-vault-treeplus",
              title: `${t("vaultNewAny")} · ${space === "" ? t("vaultSpaceAll") : space}`,
              onClick: () => startCreate(treeRoot),
              children: "+",
            }),
          ] }),
          createDir === treeRoot ? createRow(treeRoot, 0, `${treeRoot}#create`) : null,
          renderDir(treeRoot, 0),
        ] }),
        toast !== "" ? jsxRuntime.jsx("div", { className: "dshk-vault-toast", role: "status", children: toast }) : null,
      ] });

      // 页签半边：每开一页一个 pane（非激活 display:none 保持挂载——切回不丢
      // 滚动/草稿/撤销栈），一页都没开时是「去索引挑一页」的空态
      const vaultPages = ui.vaultPages ?? [];
      const stageContent =
        vaultPages.length === 0
          ? jsxRuntime.jsx("div", { className: "dshk-vault-reader", children: jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultPickPage") }) })
          : vaultPages.map((p) =>
              jsxRuntime.jsx(VaultPagePane, {
                path: p,
                active: p === current,
                root,
                indexPages,
                onOpenPage: openPath,
                onMissingLink: (title) => void createInSpace(title),
                onSaved: () => void loadIndex(),
                onDeleted: (paths) => {
                  // 级联删掉的页连着标签一起关（关的是当前页时激活位自动顺延）
                  let next = kitUi;
                  let patch = {};
                  for (const gonePath of paths) {
                    patch = { ...patch, ...closeVaultPageTab(next, gonePath) };
                    next = { ...next, ...patch };
                  }
                  setKitUi(patch);
                  void loadIndex();
                },
                toast: setToast,
              }, p),
            );

      return jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        ui.vaultIdxOpen && sideHost
          ? reactDom.createPortal(sideContent, sideHost, "dshk-vault-side")
          : null,
        ui.vaultOpen && paneHost
          ? reactDom.createPortal(stageContent, paneHost, "dshk-vault-pane")
          : null,
      ] });
    }

    /** 知识库单页编辑器（一页一个实例，挂右栏 pane 宿主）：正文加载/自动保存/CAS 冲突/
     *  外部修改跟随/删除/引用到对话/粘贴上传全在这一层，索引侧只管挑页与建页。
     *  active=false 的 pane 仍挂载（保住滚动与草稿），但停掉 stat 轮询并在失活
     *  那一刻 flush 未落盘的改动——「切走即存」，不靠卸载兜底。 */
    function VaultPagePane({ path, active, root, indexPages, onOpenPage, onMissingLink, onSaved, onDeleted, toast }) {
      // page: { loading, body(编辑器入参), binary, gone }——frontmatter 字节级原文
      // 存 ref（保存时原样拼回），不进 state（它不驱动渲染）
      const [page, setPage] = react.useState(null);
      // RTE 重挂载 tick：首次加载/冲突回读/外部修改时 bump；日常保存不重挂
      const [docTick, setDocTick] = react.useState(0);
      // CAS 冲突：{ diskMtime } | null —— 自动保存暂停，出冲突条（覆盖/读取）
      const [conflict, setConflict] = react.useState(null);
      // 表格上下文按钮随选区显隐（选区落在表格内即亮）+ 脏点（RteEditor 上报）
      const [inTable, setInTable] = react.useState(false);
      const [dirtyDot, setDirtyDot] = react.useState(false);
      // 页条面包屑：光标所属标题链（VS Code 同款位置指示，RteEditor 上报）
      const [crumb, setCrumb] = react.useState("");
      const rteRef = react.useRef(null);
      const rteCtlRef = react.useRef(null);
      const fmRef = react.useRef("");
      const mtimeRef = react.useRef(0);
      const conflictRef = react.useRef(conflict);
      conflictRef.current = conflict;
      const pagesRef = react.useRef(indexPages);
      pagesRef.current = indexPages;
      // 引用到对话：编辑器根 ref（判定选区落在本页内）与选区镜像——点页条按钮
      // 会塌掉原生选区，selectionchange 即时留底
      const paneRef = react.useRef(null);
      const selTextRef = react.useRef("");
      react.useEffect(() => {
        const onSel = () => {
          const pane = paneRef.current;
          const sel = document.getSelection();
          selTextRef.current = pane && sel && sel.anchorNode && pane.contains(sel.anchorNode) ? String(sel) : "";
        };
        document.addEventListener("selectionchange", onSel);
        return () => document.removeEventListener("selectionchange", onSel);
      }, []);

      // 拉本页内容（首次加载/冲突回读/外部修改共用）：拆 frontmatter，body 交给
      // RTE，docTick bump 驱动重挂载对齐盘上内容
      const loadCurrent = react.useCallback(async () => {
        setConflict(null);
        try {
          const body = await schedFetch(`/dsh-kit/read?path=${encodeURIComponent(path)}`);
          const raw = body.binary ? "" : (body.content ?? "");
          const { fmText, rest } = body.binary ? { fmText: "", rest: "" } : vaultSplitFrontmatter(raw);
          fmRef.current = fmText;
          mtimeRef.current = body.mtimeMs ?? 0;
          setPage({ loading: false, body: rest.trimStart(), binary: body.binary === true, gone: false });
          setDocTick((t) => t + 1);
        } catch {
          fmRef.current = "";
          mtimeRef.current = 0;
          setPage({ loading: false, body: "", binary: false, gone: true });
          setDocTick((t) => t + 1);
        }
      }, [path]);

      react.useEffect(() => {
        setPage({ loading: true, body: "", binary: false, gone: false });
        void loadCurrent();
        return undefined;
      }, [loadCurrent]);

      // 保存入口（RteEditor 自动保存/Ctrl+S/冲突覆盖都经 onSave 回调到这里）。
      // content = fmRef（frontmatter 字节级原文）+ 编辑器 md；冲突=出冲突条暂停
      // 自动保存，绝不静默覆盖。outcome: ok|conflict|fail
      const saveVaultPage = react.useCallback(
        async (bodyMd, mode = "auto") => {
          const base = mode === "overwrite" ? (conflictRef.current?.diskMtime ?? 0) : mtimeRef.current;
          try {
            const body = await schedFetch("/dsh-kit/vault/write", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path, content: fmRef.current + bodyMd, baseMtime: base }),
            });
            if (body.modified === true) {
              setConflict({ diskMtime: body.mtimeMs ?? 0 });
              toast(t("vaultConflict"));
              return "conflict";
            }
            setConflict(null);
            mtimeRef.current = body.mtimeMs ?? mtimeRef.current;
            if (mode === "manual" || mode === "overwrite") toast(t("vaultSaved"));
            onSaved();
            return "ok";
          } catch (error) {
            toast(`${t("vaultSaveFail")} ${String(error?.message ?? error)}`);
            return "fail";
          }
        },
        [path, onSaved, toast],
      );
      // ref 镜像：冲突条按钮经它调，闭包永远新鲜
      const saveEditRef = react.useRef(null);
      saveEditRef.current = {
        overwrite: async () => (rteCtlRef.current ? rteCtlRef.current.overwrite() : "fail"),
        reload: () => loadCurrent(),
      };
      // 切走即存：激活位从 true 落到 false 的那一刻把防抖未触发的改动落盘（冲突中
      // 不动——静默覆盖盘上内容比丢一次自动保存糟得多，等用户切回来处理冲突条）。
      // 用“上一帧激活位”判定边沿：写进 effect 清理函数会张冠李戴（清理属于上一次
      // 渲染，激活→失活时清的是「激活那帧」的空清理，等于永不触发）
      const wasActiveRef = react.useRef(active);
      react.useEffect(() => {
        const was = wasActiveRef.current;
        wasActiveRef.current = active;
        if (!was || active) return;
        if (conflictRef.current !== null) return;
        if (rteCtlRef.current && rteCtlRef.current.dirty()) void rteCtlRef.current.flush();
      }, [active]);
      // 外部修改实时刷新（VS Code 同款）：只轮询激活页（后台标签别白烧请求）。
      // 盘上变了且本地无脏改、无冲突 → 静默重读整页 + 刷索引（AI/编辑器改文件
      // 零手动刷新）；有脏改时不动——未保存内容由保存时 CAS 冲突条保护。文件
      // 被外部删除也重读 → 页面显示已消失。fetch 失败静默（尽力而为）
      react.useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          if (conflictRef.current !== null || (rteCtlRef.current && rteCtlRef.current.dirty())) return;
          void schedFetch(`/dsh-kit/vault/stat?path=${encodeURIComponent(path)}`)
            .then((body) => {
              if (typeof body.mtimeMs === "number" && Math.abs(body.mtimeMs - mtimeRef.current) < 1) return;
              void loadCurrent();
              onSaved();
            })
            .catch(() => {});
        }, 4000);
        return () => clearInterval(timer);
      }, [active, path, loadCurrent, onSaved]);

      const deleteCurrent = async () => {
        const pages = pagesRef.current ?? [];
        const doomed = vaultCascadeDelete(pages, path);
        const list = doomed.map((p) => `· ${p.title}`).join("\n");
        if (!window.confirm(`${t("vaultDelConfirm")}\n${list}`)) return;
        try {
          const body = await schedFetch("/dsh-kit/vault/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ paths: doomed.map((p) => p.path) }),
          });
          toast(`${t("vaultDeleted")} ×${String(body.deleted ?? "")}${body.committed === true ? " · git" : ""}`);
          if (Array.isArray(body.failed) && body.failed.length > 0) {
            toast(`${t("vaultDelFail")} ${body.failed.join("、")}`);
          }
          onDeleted(doomed.map((p) => p.path));
        } catch (error) {
          toast(`${t("vaultSaveFail")} ${String(error?.message ?? error)}`);
        }
      };
      /** M4 笔记→会话：本页以官方 @ 引用芯片插入对话输入框（2026-09-10 用户
       *  定稿：与文件树「@到对话」同款方法——insertReference 直插真实芯片，
       *  失败兜底追加 @ 语法文本）。vault 页在会话工作区外，ref 用正斜杠绝对
       *  路径：@token 提交后就是提示文本（FILE_REFERENCE_PROMPT 指引模型读
       *  路径），agent 走文件工具读绝对路径，不受 cwd 相对语义约束。有选区时
       *  先落引用块再插芯片——芯片按 detectText 末端 + draftRev CAS 定位，
       *  必须在 setDraft 之后现读 rev（shell 上的都是活getter）。 */
      const citeToChat = () => {
        const shell = currentComposerShell();
        if (!shell || typeof shell.actions?.setDraft !== "function") {
          flashToast(t("vaultCiteUnavailable"));
          return;
        }
        const mention = chatMentionText(path.replace(/\\/g, "/"));
        if (mention === null) {
          flashToast(t("vaultCiteUnavailable"));
          return;
        }
        if (selTextRef.current !== "") {
          const pre = typeof shell.state?.getSnapshot === "function" ? shell.state.getSnapshot() : null;
          const draft = pre && typeof pre.draft === "string" ? pre.draft : "";
          try {
            shell.actions.setDraft(vaultCiteText(draft, selTextRef.current));
          } catch {
            flashToast(t("vaultCiteUnavailable"));
            return;
          }
        }
        const chipRef = { source: "reference", ref: mention, label: pageBasename(path) || path, appearance: "file", clipboardText: mention };
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
            if (applied) {
              toast(t("vaultCited"));
              return;
            }
          }
        }
        // 兜底：@ 语法文本追加草稿末尾（与手打 @ 一致，此时面板可见属官方行为）
        const state = typeof shell.state?.getSnapshot === "function" ? shell.state.getSnapshot() : null;
        const draft = state && typeof state.draft === "string" ? state.draft : "";
        shell.actions.setDraft(draft === "" ? mention : `${draft} ${mention}`);
        toast(t("vaultCited"));
      };
      /** 编辑态粘贴截图：图片文件上传到 vault attachments/，光标处插入图片节点。
       *  上传前先幂等建 attachments/（/dsh-kit/upload 要求目录已存在，新 vault
       *  首次粘贴不建目录必 400） */
      const onEditPaste = (e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => /^image\//i.test(f.type));
        if (files.length === 0) return;
        e.preventDefault();
        void (async () => {
          try {
            await schedFetch("/dsh-kit/vault/mkdir", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ dir: "attachments" }),
            });
          } catch {
            /* 已存在等幂等失败场景不拦；上传失败另有提示 */
          }
          for (const f of files) {
            const fd = new FormData();
            fd.append("file", f, f.name || "paste.png");
            fetch(`/dsh-kit/upload?dir=${encodeURIComponent(`${root}/attachments`)}`, { method: "POST", body: fd })
              .then((r) => r.json())
              .then((body) => {
                const name = body?.saved?.[0]?.name;
                if (!name) throw new Error(body?.warning || "upload failed");
                rteRef.current?.insertImage(`attachments/${name}`, f.name || name);
              })
              .catch(() => toast(t("vaultSaveFail")));
          }
        })();
      };
      /** RTE 版标题锚滚动：vendor 按 doc 里的标题文本 slug 匹配，滚动+光标落点 */
      const scrollAnchorRte = (anchorRaw) => {
        const h = rteRef.current;
        if (!h) return false;
        return h.scrollToHeading(anchorRaw, vaultHeadingSlug);
      };
      const backlinks = react.useMemo(() => vaultBacklinks(indexPages ?? [], path), [indexPages, path]);

      return jsxRuntime.jsxs("div", { className: "dshk-vault-reader", style: { display: active ? "flex" : "none" }, ref: paneRef, children: [
        !page || page.loading === true
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") })
          : page.gone === true
            ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultPageGone") })
            : page.binary === true
              ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultBinaryHint") })
              : jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                  jsxRuntime.jsxs("div", { className: "dshk-vault-editbar", children: [
                    // 真·所见即所得（用户定稿）：页面恒为 TipTap 富文本编辑器。
                    // 页条=文档级命令（引用到对话/删除/撤销/重做）+ 光标小节
                    // 面包屑 + 脏标记 + 冲突处理；保存全自动（2s 防抖/失活
                    // flush/Ctrl+S）。行内格式在泡泡菜单、块插入在斜杠菜单、
                    // 表格按钮随选区显隐
                    // onMouseDown preventDefault：按钮默认行为会先塌掉文档
                    // 选区（镜像随之清空），拦下后选区保留、click 时才取得到
                    jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", title: t("vaultCiteBtn"), onMouseDown: (e) => e.preventDefault(), onClick: citeToChat, children: "@" }),
                    jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => void deleteCurrent(), children: t("vaultDelBtn") }),
                    jsxRuntime.jsx("span", { className: "dshk-vault-tbsep" }),
                    jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vtbUndo"), onClick: () => rteRef.current?.undo(), children: "↶" }),
                    jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vtbRedo"), onClick: () => rteRef.current?.redo(), children: "↷" }),
                    // 光标所属标题链（VS Code 面包屑同款，二级归属最近一级）：
                    // 占满余宽、超长省略，title 给全文；无标题覆盖时隐藏
                    crumb === "" ? null : jsxRuntime.jsx("span", { className: "dshk-vault-crumb", title: crumb, children: crumb }),
                    inTable
                      ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                          jsxRuntime.jsx("span", { className: "dshk-vault-tbsep" }),
                          jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vaultTableAddRow"), onClick: () => rteRef.current?.tableAddRow(true), children: "＋行" }),
                          jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vaultTableAddCol"), onClick: () => rteRef.current?.tableAddCol(true), children: "＋列" }),
                          jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vaultTableDelRow"), onClick: () => rteRef.current?.tableDeleteRow(), children: "－行" }),
                          jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vaultTableDelCol"), onClick: () => rteRef.current?.tableDeleteCol(), children: "－列" }),
                          jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-tbtn", title: t("vaultTableDel"), onClick: () => rteRef.current?.tableDelete(), children: "✕表" }),
                        ] })
                      : null,
                    dirtyDot ? jsxRuntime.jsx("span", { className: "dshk-vault-dirtydot", title: t("vaultUnsaved"), children: "●" }) : null,
                  ] }),
                  conflict !== null
                    ? jsxRuntime.jsxs("div", { className: "dshk-vault-conflict", children: [
                        jsxRuntime.jsx("span", { children: `⚠ ${t("vaultConflict")}` }),
                        jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => void saveEditRef.current.overwrite(), children: t("vaultConflictOverwrite") }),
                        jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", onClick: () => saveEditRef.current.reload(), children: t("vaultConflictReload") }),
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
                    onWikiLink: (target, anchor) => {
                      if (target === "") {
                        if (anchor !== "") scrollAnchorRte(anchor);
                        return;
                      }
                      const pages = pagesRef.current ?? [];
                      const ownerSpace = pages.find((p) => p.path === path)?.space ?? "";
                      const resolved = resolveVaultLink(pages, target, ownerSpace);
                      if (resolved) onOpenPage(resolved.path);
                      else onMissingLink(target);
                    },
                    resolveWiki: (target) => resolveVaultLink(pagesRef.current ?? [], target) !== null,
                    resolveSrc: (src) => {
                      if (/^(https?:|data:)/i.test(src)) return src;
                      const pageDir = () => path.split(/[\\/]/).slice(0, -1).join("\\");
                      const abs = /^attachments\//i.test(src) ? `${root}/${src}` : `${pageDir()}/${src}`;
                      return `http://${location.host}/dsh-kit/raw?path=${encodeURIComponent(abs)}`;
                    },
                    onSave: saveVaultPage,
                    onState: (s) => {
                      setDirtyDot(s.dirty === true);
                      setInTable(s.inTable === true);
                      setCrumb(typeof s.crumb === "string" ? s.crumb : "");
                    },
                    onPaste: onEditPaste,
                  }),
                ] }),
        backlinks.length > 0
          ? jsxRuntime.jsxs("div", { className: "dshk-vault-backlinks", children: [
              jsxRuntime.jsxs("span", { className: "dshk-sched-cardtitle", children: [t("vaultBacklinks"), " (", String(backlinks.length), ")"] }),
              backlinks.map((p) =>
                jsxRuntime.jsx("button", { type: "button", className: "dshk-vault-blrow", onClick: () => onOpenPage(p.path), children: p.title }, p.path),
              ),
            ] })
          : null,
      ] });
    }

    /** 「确定结束计时？」确认窗（悬浮小窗与侧栏计时钮共用）：完成=停止并勾掉
     *  待办（仅挂待办时出现）、是=停止、✕/Esc/点背景=关窗继续。停止入口统一
     *  走确认窗，误触不会丢计时 */
    function TimerStopModal({ running, nowTick, stop, onClose }) {
      // 确认窗打开期间接管 Esc（同 ScheduleModal 约定）：Esc 只关确认窗不收标签页
      react.useEffect(() => {
        schedModalOpen = true;
        const onKey = (e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
          schedModalOpen = false;
          window.removeEventListener("keydown", onKey, true);
        };
      }, [onClose]);
      const name = running.title || t("schedTimerStandalone");
      // 停止并完成待办：先停表（段已闭合落库）再勾 done，两步都成功才算
      const finishAndDone = async () => {
        onClose();
        try {
          await schedFetch("/dsh-kit/schedule/timer-stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          if (running.id) await schedFetch("/dsh-kit/schedule/done", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: running.id, done: true }) });
        } catch {
          /* 失败静默：下一轮轮询会校正运行态 */
        }
        window.dispatchEvent(new Event("dshk-sched-changed"));
      };
      return jsxRuntime.jsxs("div", { className: "dshk-sched-overlay", onClick: onClose, children: [
        jsxRuntime.jsxs("div", { className: "dshk-sched-modal", onClick: (e) => e.stopPropagation(), children: [
          jsxRuntime.jsxs("div", { className: "dshk-sched-modaltitle", children: [
            jsxRuntime.jsx("span", { children: t("timerStopConfirm") }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-x", "aria-label": t("schedClose"), title: t("schedClose"), onClick: onClose, children: "✕" }),
          ] }),
          jsxRuntime.jsxs("div", { className: "dshk-timer-stopmeta", children: [
            jsxRuntime.jsx("span", { className: "dshk-timer-stopname", title: name, children: name }),
            jsxRuntime.jsx("span", { className: "dshk-timer-stopelapsed", children: timerElapsedStr(nowTick, running.start) }),
          ] }),
          jsxRuntime.jsxs("div", { className: "dshk-sched-actions", children: [
            jsxRuntime.jsx("span", { style: { flex: 1 } }),
            running.id ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-ghost", onClick: () => void finishAndDone(), children: t("timerDoneStop") }) : null,
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-primary", onClick: () => { onClose(); stop(); }, children: t("timerStopYes") }),
          ] }),
        ] }),
      ] });
    }

    /** 内容区文档签条（浏览器式页签）：一文档一签、点击切换、✕ 单关；
     *  label(path) 决定签名（文件带后缀、知识库页去掉 .md）。文件区与知识库区
     *  的 pane 正文共用 */
    const docChips = (paths, activePath, activate, closeOne, label) =>
      paths.map((p) =>
        jsxRuntime.jsxs("span", {
          className: `dshk-tab${p === activePath ? " dshk-tab-on" : ""}`,
          title: p,
          onClick: () => setKitUi(activate(p)),
          children: [
            jsxRuntime.jsx("span", { className: "dshk-tab-label", children: label(p) }),
            jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-tab-x",
              "aria-label": t("pvCloseTab"),
              title: t("pvCloseTab"),
              onClick: (e) => {
                e.stopPropagation();
                setKitUi(closeOne(p));
              },
              children: "✕",
            }),
          ],
        }, p),
      );

    /** 侧栏索引宿主（知识库目录/日程待办占 sidebar.workspaces 单槽）：
     *  wide=false（侧栏收起）不渲染——视图挤进铁轨等于不可见；宿主 div 交给
     *  portal 投递方（VaultRootView）填内容 */
    function SidebarVaultIndex(owner) {
      const side = owner ?? {};
      if (side.wide === false) return null;
      return jsxRuntime.jsx("div", { className: "dshk-sidehost", ref: (el) => vaultSideSlot.set(el) });
    }

    // ─────────── 右栏 pane 正文（每个 dock 签一个，key = 页类型 id）───────────
    // 官方 pane 是普通文档流：外壳 .dshk-rbpane 占满 100%×100%，内容区自己滚，
    // 自建舞台的 position:fixed 外壳与对话让位类已退役。
    // pane 挂载 = 官方签开着：把 kitUi 的功能存在性同步为真（入口按钮选中态、
    // 角标、自动跟随判定都读它）；pane 卸载（用户点官方签 ✕）同步回假——
    // 「签开着吗」以官方 pane 的挂载为准。文件/知识库的文档签状态（files/
    // vaultPages）在卸载后保留，重开签即恢复，与关签前一致。
    /** 功能存在性跟随 pane 挂载（jobs/schedule/browser 用） */
    function useFeaturePresence(feature) {
      react.useEffect(() => {
        setKitUi(openFeatureTab(kitUi, feature));
        return () => setKitUi(closeFeatureTab(kitUi, feature));
      }, [feature]);
    }
    /** 文件 pane：文档签条 + 多实例 FileEditorPane（非激活 display:none 保挂载
     *  ——滚动/草稿/撤销栈不丢）。不做存在性同步：
     *  files 状态本来就在 kitUi，官方签关了重开，文档签原样恢复。
     *  最后一页文档签关掉 → 官方「文件」dock 签一起关（用户定稿 2026-09-11，
     *  同浏览器「没了就没了」，没有空页状态；再点文件时 openFileAndDock 重开签） */
    function FilePaneBody(props) {
      const ui = useKitUi();
      const cwd = useCurrentCwd(props);
      const files = ui.files ?? [];
      const fileCount = files.length;
      react.useEffect(() => {
        if (fileCount === 0) closeRightbarTab("file");
      }, [fileCount]);
      return jsxRuntime.jsxs("div", { className: "dshk-rbpane", children: [
        fileCount > 0 ? jsxRuntime.jsx("div", { className: "dshk-subtabs", children: docChips(files.map((x) => x.path), ui.activeFile, (p) => activateFileTab(kitUi, p), (p) => closeFileTab(kitUi, p), (p) => baseName(p) || t("fileTabLabel")) }) : null,
        files.map((pv) =>
              jsxRuntime.jsx("div", {
                className: "dshk-pane-view",
                style: { display: pv.path === ui.activeFile ? "flex" : "none" },
                children: jsxRuntime.jsx(FileEditorPane, {
                  key: pv.path,
                  path: pv.path,
                  source: pv.from ?? "tree",
                  untracked: pv.untracked === true,
                  deleted: pv.deleted === true,
                  commit: pv.commit,
                  cwd,
                  onOpenFile: (p, untracked) => openFileAndDock(p, "md-link", untracked === true),
                }),
              }, pv.path),
            ),
      ] });
    }
    /** 知识库 pane：页签条 + portal 宿主（VaultRootView 单实例投页编辑器进来）。
     *  vaultOpen 跟随挂载——KitSurfaces 靠它决定挂不挂 VaultView；挂载期间
     *  vaultOpen 被别处收掉（Esc 关光页签的「收摊」分支）也强制回真，pane 在
     *  官方签就得有内容（0 页时显示「去索引挑一页」空态） */
    function VaultPaneBody() {
      const ui = useKitUi();
      react.useEffect(() => {
        if (!ui.vaultOpen) setKitUi({ vaultOpen: true });
      }, [ui.vaultOpen]);
      react.useEffect(() => () => setKitUi({ vaultOpen: false }), []);
      const vaultPages = ui.vaultPages ?? [];
      // 最后一页关掉 → 官方「知识库」dock 签一起关（2026-09-11 用户定稿，同文件
      // 「没了就没了」，没有空页状态）；页签状态留在 kitUi，重开即恢复
      const pageCount = vaultPages.length;
      react.useEffect(() => {
        if (pageCount === 0) closeRightbarTab("vault");
      }, [pageCount]);
      return jsxRuntime.jsxs("div", { className: "dshk-rbpane", children: [
        vaultPages.length > 0 ? jsxRuntime.jsx("div", { className: "dshk-subtabs", children: docChips(vaultPages, ui.activeVaultPage, (p) => activateVaultPage(kitUi, p), (p) => closeVaultPageTab(kitUi, p), (p) => pageBasename(p) || t("vaultTitle")) }) : null,
        // 宿主常驻渲染（页签条之后），portal 目标缺失的时序问题不存在
        jsxRuntime.jsx("div", { className: "dshk-vault-panehost", ref: (el) => vaultPaneSlot.set(el) }),
      ] });
    }
    /** 日程 pane：ScheduleView（pane 内左待办 + 右周网格） */
    function SchedulePaneBody() {
      useFeaturePresence("schedule");
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children: jsxRuntime.jsx(ScheduleView, { active: true }) });
    }
    /** 后台任务 pane */
    function JobsPaneBody(props) {
      useFeaturePresence("jobs");
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      return jsxRuntime.jsx("div", { className: "dshk-rbpane dshk-rbpane-scroll", children:
        cfg.jobsEnabled === false
          ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("rbFeatureDisabled") })
          : jsxRuntime.jsx(JobsPanel, { ...props }),
      });
    }
    /** 浏览器 pane（agent 驱动 + 人机共驾 + 自动跟随；与独立面板同构，不加功能） */
    function BrowserPaneBody() {
      useFeaturePresence("browser");
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children:
        cfg.browserEnabled === false
          ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("rbFeatureDisabled") })
          : jsxRuntime.jsx(BrowserPanel, { active: true }),
      });
    }
    /** 计时芯片（会话 header 工具区）：空闲=开始钮（弹起表
     *  浮层：待办清单 + 自由名目），运行=脉冲点 + 实时时长（点击弹停表确认）。
     *  浮层挂 header 右缘（fixed） */
    function HeaderTimer() {
      const { running, nowTick, stop } = useRunningTimer();
      const [timerPick, setTimerPick] = react.useState(false);
      const [confirming, setConfirming] = react.useState(false);
      const [pickLabel, setPickLabel] = react.useState("");
      const [pickTasks, setPickTasks] = react.useState([]);
      react.useEffect(() => {
        if (!timerPick) return undefined;
        let alive = true;
        void schedFetch(`/dsh-kit/schedule/data?from=${encodeURIComponent(schedToday())}&to=${encodeURIComponent(schedToday())}`)
          .then((b) => {
            if (!alive) return;
            const evs = Array.isArray(b && b.events) ? b.events : [];
            setPickTasks(evs.filter((e) => e.start === undefined && !e.completedAt).sort((a, b2) => ((a.due ?? "9999") < (b2.due ?? "9999") ? -1 : 1)));
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [timerPick]);
      const startTimer = (payload) => {
        void schedFetch("/dsh-kit/schedule/timer-start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
          .then(() => {
            setTimerPick(false);
            setPickLabel("");
            window.dispatchEvent(new Event("dshk-sched-changed"));
          })
          .catch(() => {});
      };
      return jsxRuntime.jsxs("div", { className: "dshk-htimer", children: [
        jsxRuntime.jsxs("button", {
          type: "button",
          className: `dshk-htimer-chip${running ? " is-running" : ""}`,
          title: running ? `${running.title || t("schedTimerStandalone")} · ${timerElapsedStr(nowTick, running.start)}` : t("timerStartBtn"),
          onClick: () => { if (running) setConfirming(true); else setTimerPick(!timerPick); },
          children: [
            running ? jsxRuntime.jsx("span", { className: "dshk-sched-timerdot", "aria-hidden": true }) : "▶",
            running ? jsxRuntime.jsx("span", { className: "dshk-htimer-elapsed", children: timerElapsedStr(nowTick, running.start) }) : null,
          ],
        }),
        timerPick
          ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              jsxRuntime.jsx("div", { className: "dshk-timer-pickback", onClick: () => setTimerPick(false) }),
              jsxRuntime.jsxs("div", { className: "dshk-timer-pick is-header", onClick: (e) => e.stopPropagation(), children: [
                jsxRuntime.jsx("div", { className: "dshk-sched-cardtitle", children: t("schedPickTimer") }),
                pickTasks.length === 0
                  ? jsxRuntime.jsx("div", { className: "dshk-sched-emptytasks", children: t("schedTasksEmpty") })
                  : pickTasks.map((task) =>
                      jsxRuntime.jsxs("button", {
                        type: "button",
                        className: "dshk-timer-picktask",
                        onClick: () => startTimer({ id: task.id }),
                        children: [
                          jsxRuntime.jsx("span", { className: "dshk-sched-tasktitle", title: task.title, children: task.title }),
                          task.due ? jsxRuntime.jsx("span", { className: "dshk-sched-taskduebadge", children: task.due.slice(5) }) : null,
                        ],
                      }, task.id),
                    ),
                jsxRuntime.jsxs("div", { className: "dshk-timer-pickrow", children: [
                  jsxRuntime.jsx("input", {
                    className: "dshk-sched-taskinput",
                    value: pickLabel,
                    maxLength: SCHED_TITLE_MAX,
                    placeholder: t("timerLabelPh"),
                    onChange: (e) => setPickLabel(e.target.value.slice(0, SCHED_TITLE_MAX)),
                    onKeyDown: (e) => {
                      if (e.key === "Enter" && pickLabel.trim() !== "") startTimer({ title: pickLabel.trim() });
                    },
                  }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-sched-primary",
                    disabled: pickLabel.trim() === "",
                    title: pickLabel.trim() === "" ? t("timerTitleRequired") : undefined,
                    onClick: () => {
                      if (pickLabel.trim() !== "") startTimer({ title: pickLabel.trim() });
                    },
                    children: "▶",
                  }),
                ] }),
              ] }),
            ] })
          : null,
        confirming && running
          ? jsxRuntime.jsx(TimerStopModal, { running, nowTick, stop, onClose: () => setConfirming(false) })
          : null,
      ] });
    }

    // ─────────── 面板宿主（shell.overlay 全帧浮层）───────────
    // 终端停靠面板与文件预览面板在这里渲染（fixed 定位不受 composer 祖先
    // stacking context 影响）；文件树的 sidebar.workspaces 动态注册、让位 body 类、
    // 快捷键监听全部挂在这个常驻根组件里。
    // ─────────── 面板宿主（shell.overlay 全帧浮层）───────────
    // 终端停靠在这里渲染（fixed 定位不受 composer 祖先
    // stacking context 影响）；知识库单实例挂载、文件树/索引的 sidebar.workspaces
    // 动态注册、几何 RO、快捷键监听全部挂在这个常驻根组件里。
    function KitSurfaces(props) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const cwd = useCurrentCwd(props);
      const ui = useKitUi();
      const snap = react.useSyncExternalStore(subscribeCfg, getCfgSnapshot);
      const cfg = cfgFromSnapshot(snap);
      // useSessions 透传给右栏任务 pane/开始页（在跑任务徽标）：inject 闭包
      // 从这里取最新值（槽位注册发生在 effect，渲染期的 props 用模块变量桥接）
      shellShare.current = props;
      // 对话文件点击接管状态：面板门控（文件标签可用）与当前会话 cwd 每次渲染同步，
      // 供模块级 capture 拦截器读取。ready=false（默认）时拦截器完全不介入。
      chatPreviewHook = {
        ready: cfg.chatOpenFilePreview === true && (cfg.fileTreeEnabled || cfg.sourceControlEnabled),
        cwd,
        openPreview: (p) => openFileAndDock(p, "chat", false),
        // M4 会话→笔记：vault 内路径点击直达知识库标签（不受预览接管门控）
        vaultOn: cfg.vaultEnabled !== false,
        openVaultPage: (p) => {
          openVaultPageAndDock(p);
          // 先落地再派发：知识库未挂载时 VaultRootView 未挂载，挂载后消费请求
          vaultOpenRequest = p;
          window.dispatchEvent(new CustomEvent("dshk-vault-open"));
        },
      };

      // 卸载时清空模块级接管状态，避免拦截器持有失效闭包
      react.useEffect(() => () => { chatPreviewHook = null; }, []);

      // vault root 预取：对话路径点击的 M4 路由判定同步读 vaultRootHint——
      // 等用户点击时再取来不及（官方动作同步触发，无法事后撤回）。插件挂载即
      // 预取一次（宿主 mtime 缓存，零成本）；VaultRootView 每次拉索引也会刷新
      react.useEffect(() => {
        if (cfg.vaultEnabled === false) return undefined;
        void ensureVaultRootHint();
        return undefined;
      }, [cfg.vaultEnabled]);

      // 座位门控：按配置动态注册/注销输入框入口与技能页（设置卡
      // 本体不受门控，否则关掉就再也打不开）。快照未就绪按默认全开处理，首个
      // ready 快照到达后本效果自动重跑纠正。
      react.useEffect(() => {
        if (!slotsCtx) return undefined;
        const handles = [];
        const want = [
          // 归档会话视图 2026-09-11 整个退役（用户定稿：会话量大了加载慢、实际
          // 无恢复需求；官方侧栏菜单的归档动作本身不受影响）
          // 会话监视条：composer 上方环境条（官方 StatsLine order 0，排其后）
          ["monitor", cfg.monitorEnabled, () =>
            slotsCtx.slots.register(
              { name: "conversation.composer.dock", id: "dsh-kit-monitor", order: 5 },
              MonitorLine,
            )],
          // 输入框入口排序（左→右）：文件树、源代码管理、知识库、终端
          // （日程钮 2026-09-11 撤——日程只剩右栏 dock 签，入口归右栏开始页
          // 条目与待办卡，侧栏待办索引同日退役；知识库 2026-09-10 从侧栏底部钮
          // 移到这里，用户定稿；
          // 手机访问与技能页同类，走 settings.section 页面入口（order：技能 40 → 手机 45）
          ["filetree", cfg.fileTreeEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-filetree", order: 10 }, FileTreeEntry)],
          ["scm", cfg.sourceControlEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-scm", order: 11 }, ScmEntry)],
          ["vault", cfg.vaultEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-vault", order: 12 }, VaultEntry)],
          ["terminal", cfg.terminalEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-terminal", order: 14 }, TerminalEntry)],
          // 侧栏底部按钮区 2026-09-11 撤（用户定稿：后台任务/浏览器入口归右栏
          // 开始页清单与自动跟随，侧栏底部不再驻钮）
          ["skills", cfg.skillsPageEnabled, () =>
            slotsCtx.slots.register(
              { name: "settings.section", id: "kit-skills", order: 40, label: () => t("skillsLabel") },
              SkillsManager,
            )],
          ["phone", cfg.phoneEnabled, () =>
            slotsCtx.slots.register(
              { name: "settings.section", id: "kit-phone", order: 45, label: () => t("phoneTitle") },
              PhoneSection,
            )],
        ];
        for (const [key, enabled, make] of want) {
          if (!enabled) continue;
          try {
            handles.push(make());
          } catch (error) {
            console.error(`[dsh-kit] 注册座位失败：${key}`, error);
          }
        }
        return () => {
          for (const dispose of handles) {
            try {
              dispose();
            } catch {
              // 忽略注销异常
            }
          }
        };
      }, [cfg.phoneEnabled, cfg.terminalEnabled, cfg.fileTreeEnabled, cfg.sourceControlEnabled, cfg.skillsPageEnabled, cfg.monitorEnabled, cfg.vaultEnabled]);

      // 配置关闭但视图还开着（如设置卡保存瞬间）：立即归位，文件随来源跟随清掉；
      // 终端功能关闭 = 结束全部终端会话（连 WS 杀 pty，与单终端时代语义一致）
      react.useEffect(() => {
        if (!cfg.terminalEnabled && (ui.termDockOpen || ui.terminals.length > 0)) {
          setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
        }
        if (!cfg.fileTreeEnabled && ui.treeOpen) setKitUi({ treeOpen: false, files: [], activeFile: null });
        if (!cfg.sourceControlEnabled && ui.gitOpen) setKitUi({ gitOpen: false, files: [], activeFile: null });
        // 配置门控清场走 closeFeatureTab：清存在性的同时把激活位顺延到剩余标签
        if (!cfg.jobsEnabled && ui.jobsOpen) setKitUi(closeFeatureTab(kitUi, "jobs"));
        if (!cfg.browserEnabled && ui.browserOpen) setKitUi(closeFeatureTab(kitUi, "browser"));
        if (!cfg.vaultEnabled && (ui.vaultOpen || ui.vaultIdxOpen)) {
          setKitUi({ ...closeFeatureTab(kitUi, "vault"), vaultIdxOpen: false });
        }
      }, [cfg.terminalEnabled, cfg.fileTreeEnabled, cfg.sourceControlEnabled, cfg.jobsEnabled, cfg.browserEnabled, cfg.vaultEnabled]);

      // 侧边栏浏览区占用：单槽轮换（工作台定稿）——源代码管理 ↔ 文件树 ↔ 知识库
      // 目录，全关回官方会话列表（日程待办索引 2026-09-11 退役，见入口按钮注释）。
      // 动态注册若在运行时抛错，捕获并回滚开合状态，避免入口被错误边界退役。
      react.useEffect(() => {
        if (!slotsCtx || (!ui.treeOpen && !ui.gitOpen && !ui.vaultIdxOpen)) return undefined;
        let dispose;
        try {
          // 单槽遮蔽原生需要更低 priority（数字越小越先渲染，原生在 priority 0）。
          // owner 携带官方注入的 wide（侧边栏是否展开）：收起态各占用者自判不渲染
          // （挤进铁轨等于不可见）。
          dispose = slotsCtx.slots.register({ name: "sidebar.workspaces", priority: -1000 }, (owner) => {
            const side = owner ?? {};
            if (side.wide === false) return null;
            if (ui.gitOpen) {
              return jsxRuntime.jsx(GitChangesPanel, { cwd, onOpenFile: (p, untracked, deleted, commit) => openFileAndDock(p, "scm", untracked === true, deleted === true, commit), ...owner });
            }
            if (ui.treeOpen) {
              return jsxRuntime.jsx(FileTreePanel, { cwd, onOpenFile: (p) => openFileAndDock(p, "tree", false), ...owner });
            }
            return jsxRuntime.jsx(SidebarVaultIndex, { ...owner });
          });
        } catch (error) {
          console.error("[dsh-kit] 注册 sidebar.workspaces 面板失败：", error);
          setKitUi({ treeOpen: false, gitOpen: false, vaultIdxOpen: false, files: [], activeFile: null });
          return undefined;
        }
        return () => {
          try {
            dispose();
          } catch {
            // 忽略注销异常
          }
        };
      }, [ui.treeOpen, ui.gitOpen, ui.vaultIdxOpen, cwd]);

      // 终端让位布局：坞可见时挂 body 类 + 设高度变量，样式规则顶起对话/详情列
      //（隐藏/无会话时不顶——后台会话继续跑但不占布局）
      react.useEffect(() => {
        if (ui.terminals.length === 0 || !ui.termDockOpen || !cfg.terminalEnabled) return undefined;
        document.documentElement.style.setProperty("--dshk-dock-h", DOCK_H);
        document.body.classList.add("dshk-open");
        return () => {
          document.body.classList.remove("dshk-open");
          document.documentElement.style.removeProperty("--dshk-dock-h");
        };
      }, [ui.termDockOpen, ui.terminals.length, cfg.terminalEnabled]);

      // 快捷键统一在此监听：组合键来自配置（默认 Ctrl+E / Ctrl+Alt+. 等，capture
      // 拦截避免页面其它快捷键抢先），对应功能关闭时不响应；设置卡录制新键时让路。
      // Esc 分层：先关当前激活那张文档签（知识库关当前页那张、文件关当前文件那张），
      // 再关侧栏视图（不拦截，避免挡掉其它 Esc 行为）。功能签归官方 ✕，Esc 不碰。

      react.useEffect(() => {
        const termCombo = parseCombo(cfg.terminalShortcut);
        const treeCombo = parseCombo(cfg.fileTreeShortcut);
        const scCombo = parseCombo(cfg.scShortcut);
        const vaultCombo = parseCombo(cfg.vaultShortcut);
        const rbCombo = parseCombo(cfg.rightbarShortcut);
        const sidebarCombo = parseCombo(cfg.sidebarShortcut);
        const onKey = (e) => {
          if (shortcutCapture !== null) return;
          if (inlineEditCapture) return;
          if (termCombo && cfg.terminalEnabled && comboMatches(e, termCombo)) {
            e.preventDefault();
            e.stopPropagation();
            // 与入口按钮同语义：只开/关坞（隐藏不杀进程）；无会话时新建绑定当前 cwd
            setKitUi(toggleTermDock(kitUi, cwd));
            return;
          }
          if (treeCombo && cfg.fileTreeEnabled && comboMatches(e, treeCombo)) {
            e.preventDefault();
            e.stopPropagation();
            // Ctrl+E 只管文件树（与入口按钮同语义，单槽互斥）
            if (!kitUi.treeOpen) expandSidebarNow();
            setKitUi(sidebarViewPatch(kitUi.treeOpen ? null : "tree"));
            return;
          }
          if (scCombo && cfg.sourceControlEnabled && comboMatches(e, scCombo)) {
            e.preventDefault();
            e.stopPropagation();
            // 源代码管理同语义：非 SCM 态 → 打开（展开侧边栏）；已是 → 关闭回会话列表
            if (!kitUi.gitOpen) expandSidebarNow();
            setKitUi(sidebarViewPatch(kitUi.gitOpen ? null : "scm"));
            return;
          }
          if (vaultCombo && cfg.vaultEnabled !== false && comboMatches(e, vaultCombo)) {
            e.preventDefault();
            e.stopPropagation();
            // 与输入行知识库钮同语义：开=侧栏索引，再点=收回会话列表
            setKitUi(toggleVaultEntry(kitUi));
            return;
          }
          if (rbCombo && comboMatches(e, rbCombo)) {
            e.preventDefault();
            e.stopPropagation();
            // 右栏收起/展开走官方 sidebarRight 服务（无参 toggle）；服务未就绪
            // 或宿主无此能力（0.1.2）时静默。日程快捷键 2026-09-11 撤（用户定稿：
            // 日程无左侧栏半边，不需要全局键），这个位让给右栏开合
            const sr = rightbarSr;
            if (sr && typeof sr.toggleExpanded === "function") {
              try {
                sr.toggleExpanded();
              } catch {
                /* 右栏异常不拖垮其它快捷键 */
              }
            }
            return;
          }
          if (sidebarCombo && comboMatches(e, sidebarCombo)) {
            e.preventDefault();
            e.stopPropagation();
            toggleSidebar();
            return;
          }
          if (e.key === "Escape") {
            // 日程弹窗开着时让路：Esc 归弹窗自己（只关弹窗，不收标签页）
            if (schedModalOpen) return;
            // Esc 关当前激活那张文档签（知识库关当前页那张、文件关当前文件
            // 那张，各自与标签条的 ✕ 同语义）。功能签归官方 ✕，Esc 不收
            // 功能签（kitUi 收了 pane 还在，状态会对不上）
            const vaultPages = kitUi.vaultPages ?? [];
            const files = kitUi.files ?? [];
            const activeVault = kitUi.activeVaultPage ?? vaultPages[vaultPages.length - 1] ?? null;
            const activeFile = kitUi.activeFile ?? files[files.length - 1]?.path ?? null;
            if (kitUi.activeFeature === "vault" && activeVault) {
              setKitUi(closeVaultPageTab(kitUi, activeVault));
            } else if (kitUi.activeFeature === "file" && activeFile) {
              setKitUi(closeFileTab(kitUi, activeFile));
            } else if (vaultPages.length > 0) {
              setKitUi(closeVaultPageTab(kitUi, activeVault));
            } else if (files.length > 0) {
              setKitUi(closeFileTab(kitUi, activeFile));
            } else if (kitUi.gitOpen || kitUi.treeOpen || kitUi.vaultIdxOpen) {
              // 侧栏视图单槽：关一格即可（四者互斥）；功能签不连带关
              setKitUi(sidebarViewPatch(null));
            } else if (kitUi.termDockOpen) setKitUi({ termDockOpen: false }); // 只隐藏，不杀会话
          }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
        // cwd 必须在依赖里：否则闭包缓存首帧（会话未水化时为 null）的工作区，
        // 之后按快捷键开终端永远绑到 null
      }, [cwd, cfg.terminalEnabled, cfg.fileTreeEnabled, cfg.terminalShortcut, cfg.fileTreeShortcut, cfg.scShortcut, cfg.vaultShortcut, cfg.rightbarShortcut, cfg.sidebarShortcut]);

      // ShellBrowserEvents：壳层常驻浏览器事件源（与面板 WS 并存，不订阅帧流）。
      // 面板标签会被收掉（0 页自动收/人为关闭），「agent 开页切到浏览器」不能依赖
      // 面板自己活着——壳层恒听宿主广播：navigated → 拽出右栏浏览器签（无抑制，
      // 用户定稿 2026-09-10：agent 操作浏览器必须可见）；浏览器收摊 → 顺手收掉
      // 标签。两者兼得：正常浏览器的「没了就没了」+ agent 干活时画面自动回眼前
      react.useEffect(() => {
        if (cfg.browserEnabled === false) return undefined;
        let disposed = false;
        let retry = null;
        let ws = null;
        const connect = () => {
          ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/dsh-kit/browser`);
          ws.onmessage = (e) => {
            let msg;
            try {
              msg = JSON.parse(e.data);
            } catch {
              return;
            }
            if (!msg || typeof msg !== "object") return;
            if (msg.t === "event") {
              if (msg.kind === "navigated") maybeAutoOpenBrowser();
              else if (msg.kind === "closed") closeBrowserDockForGone();
              return;
            }
            if (msg.t === "state" && msg.launching !== true && msg.running === true && (msg.pages ?? []).length === 0) {
              // 页崩光残留（running 但 0 页）= 浏览器实质没了，收掉标签。
              // running:false 不作依据——快照无历史，启动失败也会落到这个形状，
              // 收掉标签会让用户连错误线索都看不到；「曾活着→没了」由 closed 事件负责
              closeBrowserDockForGone();
            }
          };
          ws.onclose = () => {
            if (disposed) return;
            retry = window.setTimeout(connect, 2500);
          };
          ws.onerror = () => {};
        };
        connect();
        return () => {
          disposed = true;
          if (retry !== null) window.clearTimeout(retry);
          try {
            ws?.close();
          } catch {
            // 已断
          }
        };
      }, [cfg.browserEnabled]);

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          cfg.terminalEnabled && ui.terminals.length > 0
            ? jsxRuntime.jsx(TerminalDock, {
                open: ui.termDockOpen,
                cwd,
                onSpawn: () => {
                  if (!cwd) {
                    flashToast(t("noCwd"));
                    return;
                  }
                  setKitUi(spawnTerm(kitUi, cwd));
                },
                onHide: () => setKitUi({ termDockOpen: false }),
                onActivate: (id) => setKitUi({ activeTermId: id, termDockOpen: true }),
                onKill: (id) => setKitUi(killTerm(kitUi, id)),
                onKillAll: () => setKitUi({ terminals: [], activeTermId: null, termDockOpen: false }),
              })
            : null,
          // 知识库单实例：侧栏目录/右栏页签任一在场即挂载（两侧 portal 自取），
          // 隐藏包装层不影响 portal 内容落点
          cfg.vaultEnabled !== false && (ui.vaultOpen || ui.vaultIdxOpen)
            ? jsxRuntime.jsx("div", { style: { display: "none" }, children: jsxRuntime.jsx(VaultView, {}) })
            : null,
          // 悬浮计时小窗：运行中且没在看计时页才现身（组件内部自判），平时零占用
          jsxRuntime.jsx(FloatingTimerPill, {}),
        ],
      });
    }

    // ─────────── 技能管理页（settings.section）───────────
    // 数据走宿主半边 GET /dsh-kit/skills（白名单根枚举+注册表归属增强）与
    // POST /dsh-kit/skills/op（copy/move/delete/disable）。分组显示：
    // 工作区(.agents|.dsh/skills) → 用户级($DSH_HOME|~/.agents) → 技能池；
    // 插件自带/运行时来源只读展示。删除=移入池内 .trash，禁用=改 frontmatter 双键。
    function fetchSkillsPage(cwd, signal) {
      const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      return fetch(`/dsh-kit/skills${query}`, { signal }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !Array.isArray(body.groups)) {
          throw new Error((body && body.error) || `HTTP ${res.status}`);
        }
        return body;
      });
    }

    function postSkillOp(payload) {
      return fetch("/dsh-kit/skills/op", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = new Error(body.error || `HTTP ${res.status}`);
          error.status = res.status;
          throw error;
        }
        return body;
      });
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

    // ── 设置导航图标：官方 navIcon(id) 硬编码映射（models/agent-presets/plugins），
    // 未知 id 一律回退齿轮。没有注册缝，这里按标签文字找到对应行，把行内第一个
    // svg 换成自绘分层图标——纯外观增强：任何一步失败都静默保持齿轮。
    const SVG_OPEN =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    const NAV_ICON_HTML = [
      {
        label: () => t("skillsLabel"),
        attr: "data-dshk-skill",
        html:
          SVG_OPEN +
          '<path d="M8 1.8 14.2 5 8 8.2 1.8 5z"/>' +
          '<path d="M1.8 8.1 8 11.2l6.2-3.1"/>' +
          '<path d="M1.8 11.3 8 14.4l6.2-3.1"/>' +
          "</svg>",
      },
      {
        label: () => t("phoneTitle"),
        attr: "data-dshk-phone",
        html:
          SVG_OPEN +
          '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/>' +
          '<path d="M6.8 3.4h2.4"/>' +
          '<path d="M8 12.6h.01"/>' +
          "</svg>",
      },
    ];

    let iconSwapPending = false;
    function swapKitNavIcons() {
      try {
        const rows = document.querySelectorAll('[role="dialog"][aria-modal="true"] nav button');
        if (rows.length === 0) return;
        for (const row of rows) {
          const span = row.querySelector("span");
          if (!span) continue;
          const entry = NAV_ICON_HTML.find((candidate) => span.textContent === candidate.label());
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
    function scheduleSkillIconSwap() {
      if (iconSwapPending) return;
      iconSwapPending = true;
      window.setTimeout(() => {
        iconSwapPending = false;
        swapKitNavIcons();
        window.setTimeout(swapKitNavIcons, 250); // React 重渲染后的二次补换
      }, 60);
    }

    function SkillContent({ file }) {
      const [state, setState] = react.useState({ phase: "loading", text: "" });
      react.useEffect(() => {
        const controller = new AbortController();
        setState({ phase: "loading", text: "" });
        fetch(`/dsh-kit/read?path=${encodeURIComponent(file)}`, { signal: controller.signal })
          .then(async (res) => {
            const body = await res.json().catch(() => null);
            if (!res.ok || !body) throw new Error((body && body.error) || `HTTP ${res.status}`);
            return body;
          })
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
      }, [file]);
      if (state.phase === "loading") return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: t("skLoading") });
      if (state.phase === "error")
        return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: `${t("contentFail")}：${state.text}` });
      if (state.text.trim() === "") return jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { padding: "6px 0 0" }, children: t("contentEmpty") });
      return jsxRuntime.jsx("pre", { className: "dshk-sk-pre", children: state.text });
    }

    /** 展开式目标选择条：点选物理根即执行（不存在的根由宿主按需创建） */
    function TargetPicker({ roots, mode, onPick }) {
      return jsxRuntime.jsxs("div", {
        className: "dshk-sk-target",
        children: [
          jsxRuntime.jsxs("span", { className: "dshk-sk-target-label", children: [mode === "copy" ? t("skCopy") : t("skMove"), " · ", t("skPickTarget")] }),
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
     * 单个技能行（单行布局）：名称+徽标+描述截断+复制/移动/禁用/删除/详情。
     * 池内技能没有禁用按钮（池不被扫描，禁用无意义）；复制/移动展开目标选择条
     * （picker 状态提升到页面级，同一时间只允许一行展开）。
     */
    function SkillRow({ skill, groupId, allRoots, cwd, busy, runOp, picker, setPicker }) {
      const [open, setOpen] = react.useState(false);
      const [confirming, setConfirming] = react.useState(false);
      const pickerOpen = picker !== null && picker.key === skill.path && (picker.mode === "copy" || picker.mode === "move");
      const targets = allRoots.filter((root) => root.id !== skill.root);

      const startPicker = (mode) => setPicker(pickerOpen ? null : { key: skill.path, mode });
      const onDisable = () => runOp({ op: "disable", src: skill.path, cwd, disabled: !skill.disabled });
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
        runOp({ op: picker.mode, src: skill.path, dest: rootId, cwd });
      };

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsxs("div", {
            className: "dshk-sk-row",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-sk-name", "data-disabled": skill.disabled || undefined, children: skill.name }),
              groupId !== "pool" && typeof skill.rank === "number"
                ? jsxRuntime.jsx("span", { className: "dshk-sk-badge", title: `${skRootShort(skill.root)} · ${t("skRankTip")}`, children: `(${skill.rank})` })
                : null,
              skill.disabled ? jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", children: t("skDisabled") }) : null,
              skill.shadowed ? jsxRuntime.jsx("span", { className: "dshk-sk-badge dshk-sk-badge-off", title: t("skShadowTip"), children: t("skShadowed") }) : null,
              typeof skill.description === "string" && skill.description !== ""
                ? jsxRuntime.jsx("span", { className: "dshk-sk-desc", title: skill.description, children: skill.description })
                : null,
              jsxRuntime.jsxs("div", {
                className: "dshk-sk-actions",
                children: [
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => startPicker("copy"), children: t("skCopy") }),
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => startPicker("move"), children: t("skMove") }),
                  groupId !== "pool"
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: onDisable, children: skill.disabled ? t("skEnable") : t("skDisable") })
                    : null,
                  confirming
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", "data-danger": "1", disabled: busy, onClick: onDelete, children: t("skConfirmDelete") })
                    : jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: onDelete, children: t("skDelete") }),
                  confirming
                    ? jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setConfirming(false), children: t("skCancel") })
                    : null,
                  jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, onClick: () => setOpen((v) => !v), children: open ? t("skHide") : t("skView") }),
                ],
              }),
            ],
          }),
          pickerOpen ? jsxRuntime.jsx(TargetPicker, { roots: targets, mode: picker.mode, onPick: pickDest }) : null,
          open ? jsxRuntime.jsx("div", { className: "dshk-sk-detail", children: jsxRuntime.jsx(SkillContent, { file: skill.file }) }) : null,
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

    const SK_GROUP_RANK = { workspace: 0, user: 1, pool: 2 };

    function SkillsManager(props) {
      const cwd = useCurrentCwd(props);
      const [data, setData] = react.useState(null);
      const [error, setError] = react.useState("");
      const [message, setMessage] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [nonce, setNonce] = react.useState(0);
      // 展开中的复制/移动目标选择条（{key,mode}）；单值保证同一时间只展开一行
      const [picker, setPicker] = react.useState(null);

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

      const runOp = async (payload) => {
        if (busy) return;
        setBusy(true);
        setMessage("");
        try {
          try {
            await postSkillOp(payload);
          } catch (err) {
            if (err && err.status === 409 && window.confirm(t("skOverwrite"))) {
              await postSkillOp({ ...payload, overwrite: true });
            } else {
              setMessage(`${t("skOpFail")}：${err?.message ?? err}`);
              return;
            }
          }
          setMessage(payload.op === "delete" ? t("skDeleted") : t("skDone"));
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
              jsxRuntime.jsx("button", { type: "button", className: "dshk-sk-btn", disabled: busy, title: t("skRefresh"), onClick: () => setNonce((n) => n + 1), children: "⟳" }),
            ],
          }),
          !cwd ? jsxRuntime.jsx("div", { className: "dshk-sk-status", style: { marginBottom: 8 }, children: t("skNoCwdHint") }) : null,
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

    // ─────────── 插件设置卡（settings.plugin.item）───────────
    // 交互规范照官方 CardForm（同 dsh-memory 卡片）：编辑只暂存草稿、保存才写；
    // "已覆盖" = raw user 层含该键；恢复默认暂存 base 值（保存时 unset 回落默认）。
    // 写入后回读 user 层验证落盘（Host 是唯一权威，scope.set 失败静默回滚重读）。
    // 快捷键字段是捕获控件：点「修改」进录制态，下一个含非修饰主键的 keydown 即为
    // 新组合键；录制期模块级 shortcutCapture 置位，KitSurfaces 面板快捷键让路。
    const CFG_FIELDS = [
      { key: "terminalEnabled", kind: "bool" },
      { key: "fileTreeEnabled", kind: "bool" },
      { key: "previewMaxTabs", kind: "number", max: 20 },
      { key: "sourceControlEnabled", kind: "bool" },
      { key: "chatOpenFilePreview", kind: "bool" },
      { key: "skillsPageEnabled", kind: "bool" },
      { key: "searchEnabled", kind: "bool" },
      { key: "searchMaxResults", kind: "number" },
      { key: "phoneEnabled", kind: "bool" },
      { key: "phoneKeepGatewayOn", kind: "bool" },
      { key: "jobsEnabled", kind: "bool" },
      { key: "browserEnabled", kind: "bool" },
      { key: "monitorEnabled", kind: "bool" },
      { key: "monitorWaitMs", kind: "number", min: 5000, max: 600000 },
      { key: "monitorMaxAuto", kind: "number", min: 1, max: 10 },
      { key: "monitorRepeatThreshold", kind: "number", min: 2, max: 10 },
      { key: "vaultEnabled", kind: "bool" },
      { key: "vaultRoot", kind: "text" },
      { key: "terminalShortcut", kind: "combo" },
      { key: "fileTreeShortcut", kind: "combo" },
      { key: "scShortcut", kind: "combo" },
      { key: "vaultShortcut", kind: "combo" },
      { key: "rightbarShortcut", kind: "combo" },
      { key: "sidebarShortcut", kind: "combo" },
    ];
    // 分组渲染：开关行 + 该功能启用时才显示的子配置（所见即所得，保存才落盘生效）；
    // switchKey 为 null 的组没有开关行，只列字段（侧边栏组：左右两键，无启用开关）。
    // title 组头（侧边栏这类无单一开关的组）——其余组的功能开关行本身就是组头。
    // 组顺序（2026-09-11 用户定稿整理）：侧边栏（左右放一起）→ 文件树 → 源代码管理
    // → 终端 → 知识库 → 后台任务 → 浏览器 → 会话监视 → 对话文件预览 → 技能页
    // → 网页搜索 → 手机访问（用户定稿放最下）。远程域名不在此卡——编辑入口在
    // 「手机访问」页内。
    const CFG_GROUPS = [
      { title: "cfgGroupSidebar", switchKey: null, fields: ["sidebarShortcut", "rightbarShortcut"] },
      { switchKey: "fileTreeEnabled", fields: ["fileTreeShortcut", "previewMaxTabs"] },
      { switchKey: "sourceControlEnabled", fields: ["scShortcut"] },
      { switchKey: "terminalEnabled", fields: ["terminalShortcut"] },
      { switchKey: "vaultEnabled", fields: ["vaultRoot", "vaultShortcut"] },
      { switchKey: "jobsEnabled", fields: [] },
      { switchKey: "browserEnabled", fields: [] },
      { switchKey: "monitorEnabled", fields: ["monitorWaitMs", "monitorMaxAuto", "monitorRepeatThreshold"] },
      { switchKey: "chatOpenFilePreview", fields: [] },
      { switchKey: "skillsPageEnabled", fields: [] },
      { switchKey: "searchEnabled", fields: ["searchMaxResults"] },
      { switchKey: "phoneEnabled", fields: ["phoneKeepGatewayOn"] },
    ];
    const cfgSpec = Object.fromEntries(CFG_FIELDS.map((f) => [f.key, f]));
    const cfgLabelKey = (field, suffix) =>
      `cfg${field[0].toUpperCase()}${field.slice(1)}${suffix}`;

    /** 字段显示文本：bool → "true"/"false"；number → 整数字符串；text/combo → 字符串（空回落内置默认） */
    function cfgFormat(field, value) {
      if (cfgSpec[field].kind === "bool") return value === false ? "false" : "true";
      if (cfgSpec[field].kind === "number") return String(Number.isFinite(value) ? value : CFG_DEFAULTS[field]);
      return typeof value === "string" && value.trim() !== "" ? value : CFG_DEFAULTS[field];
    }
    /** 草稿文本 → 写入计划；非法（数字越界/非整数、组合键缺主键/修饰键）返回 undefined 阻断保存 */
    function cfgParse(field, text) {
      if (cfgSpec[field].kind === "bool") return { kind: "set", value: text === "true" };
      if (cfgSpec[field].kind === "number") {
        const trimmed = String(text ?? "").trim();
        const n = Number(trimmed);
        const hi = cfgSpec[field].max ?? 8;
        const lo = cfgSpec[field].min ?? 1;
        return Number.isInteger(n) && n >= lo && n <= hi ? { kind: "set", value: n } : undefined;
      }
      if (cfgSpec[field].kind === "text") return { kind: "set", value: String(text ?? "").trim() };
      const trimmed = String(text ?? "").trim();
      return parseCombo(trimmed) ? { kind: "set", value: trimmed } : undefined;
    }

    function KitConfigCard({ scope }) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
      react.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      const [drafts, setDrafts] = react.useState({});
      const [saving, setSaving] = react.useState(false);
      const [failed, setFailed] = react.useState(false);
      const [open, setOpen] = react.useState(false);
      // 正在录制快捷键的字段；null = 非录制态（同一时间至多一个）
      const [capturing, setCapturing] = react.useState(null);
      // 非本机访问（手机/远程）时上游把设置镜像钉在本机，快照会永远停在 loading——
      // 数秒后仍未就绪且地址栏非回环，就把"读取中"换成明确的远程只读提示。
      const [stuckLoading, setStuckLoading] = react.useState(false);
      const offDevice =
        typeof location !== "undefined" && !["localhost", "127.0.0.1"].includes(location.hostname);
      react.useEffect(() => {
        if (snapshot.status !== "loading") {
          setStuckLoading(false);
          return undefined;
        }
        if (!offDevice) return undefined;
        const timer = setTimeout(() => setStuckLoading(true), 4000);
        return () => clearTimeout(timer);
      }, [snapshot.status, offDevice]);
      const loadingHint = stuckLoading && offDevice ? t("cfgRemoteHint") : t("loadingCfg");

      // 录制期：capture 截获下一个组合键；Esc 取消；纯修饰键继续等待
      react.useEffect(() => {
        if (!capturing) return undefined;
        shortcutCapture = capturing;
        const onKey = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") {
            setCapturing(null);
            return;
          }
          const combo = comboFromEvent(e);
          if (!combo) return;
          setDrafts((d) => ({ ...d, [capturing]: { text: combo, clear: false } }));
          setFailed(false);
          setCapturing(null);
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
          shortcutCapture = null;
          window.removeEventListener("keydown", onKey, true);
        };
      }, [capturing]);

      // 卡壳永远渲染（加载中也一样）：静默隐身的卡无法和注册失败区分
      try {
        return renderCard();
      } catch (error) {
        console.error("[dsh-kit] 设置卡渲染错误：", error);
        return jsxRuntime.jsx("li", {
          className: "dshk-cfg-card",
          children: jsxRuntime.jsx("p", {
            className: "dshk-cfg-status",
            role: "status",
            children: `dsh-kit card render error: ${String(error?.message ?? error)}`,
          }),
        });
      }

      function renderCard() {
        const loading = snapshot.status === "loading";
        const available = snapshot.status === "ready";
        const writable = snapshot.writable === true;

        /** raw user 层是否携带该键（"已覆盖"的判据） */
        const stored = (field) =>
          snapshot.user !== undefined && snapshot.user !== null && typeof snapshot.user === "object"
            ? Object.prototype.hasOwnProperty.call(snapshot.user, field)
            : false;
        const sectionText = (field) =>
          cfgFormat(
            field,
            available && snapshot.value && typeof snapshot.value === "object" ? snapshot.value[field] : undefined,
          );
        const stagedOf = (field) => drafts[field];

        const fieldState = (field) => {
          const staged = stagedOf(field);
          if (staged === undefined) return { text: sectionText(field), overridden: stored(field), invalid: false };
          if (staged.clear) return { text: staged.text, overridden: false, invalid: false };
          const parsed = cfgParse(field, staged.text);
          return { text: staged.text, overridden: true, invalid: parsed === undefined };
        };

        const edit = (field, text) => {
          setDrafts((d) => ({ ...d, [field]: { text, clear: false } }));
          setFailed(false);
        };
        // 恢复默认：暂存 base 值 + clear 标记（保存时 unset，回落 schema 默认）
        const resetField = (field) => {
          const base = snapshot.base && typeof snapshot.base === "object" ? snapshot.base[field] : undefined;
          setDrafts((d) => ({ ...d, [field]: { text: cfgFormat(field, base), clear: true } }));
          setFailed(false);
        };
        const discard = () => {
          setDrafts({});
          setFailed(false);
          setCapturing(null);
        };

        /** 保存要执行的写入列表：无变化跳过、非法阻断整体（返回 null） */
        const computeWrites = () => {
          if (!available) return [];
          const writes = [];
          for (const { key } of CFG_FIELDS) {
            const staged = stagedOf(key);
            if (staged === undefined) continue;
            if (staged.clear) {
              if (stored(key)) writes.push({ run: () => clearField(key) });
              continue;
            }
            if (staged.text === sectionText(key)) continue;
            const parsed = cfgParse(key, staged.text);
            if (parsed === undefined) return null;
            writes.push({ run: () => storeField(key, parsed.value) });
          }
          return writes;
        };
        const freshUser = () => scope.getSnapshot().user;
        const storeField = async (field, value) => {
          await scope.set(field, value);
          const user = freshUser();
          return !!(user && typeof user === "object" && user[field] === value);
        };
        const clearField = async (field) => {
          await scope.unset(field);
          const user = freshUser();
          return !(user && typeof user === "object" && Object.prototype.hasOwnProperty.call(user, field));
        };

        const writes = computeWrites();
        const dirty = writes === null || writes.length > 0;
        const invalid = writes === null;
        const blocked = !dirty || invalid || saving;

        const save = async () => {
          const freshWrites = computeWrites();
          if (freshWrites === null || freshWrites.length === 0 || saving) return;
          setSaving(true);
          setFailed(false);
          let landed = true;
          for (const write of freshWrites) landed = (await write.run()) && landed;
          if (landed) setDrafts({});
          setSaving(false);
          setFailed(!landed);
        };

        const startCapture = (field) => setCapturing(capturing === field ? null : field);

        const badges = (state, field) =>
          state.overridden
            ? jsxRuntime.jsxs("span", {
                className: "dshk-cfg-badges",
                children: [
                  jsxRuntime.jsx("span", { className: "dshk-cfg-badge", children: t("overridden") }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-cfg-reset",
                    disabled: !writable,
                    onClick: () => resetField(field),
                    children: t("resetDefault"),
                  }),
                ],
              })
            : null;

        const renderField = (field, isSub) => {
          const spec = cfgSpec[field];
          const state = fieldState(field);
          const control =
            spec.kind === "bool"
              ? jsxRuntime.jsx("input", {
                  type: "checkbox",
                  className: "dshk-cfg-check",
                  checked: state.text === "true",
                  disabled: !writable,
                  onChange: () => edit(field, state.text === "true" ? "false" : "true"),
                })
              : spec.kind === "number"
                ? jsxRuntime.jsx("input", {
                    type: "number",
                    className: "dshk-cfg-text dshk-cfg-num",
                    min: spec.min ?? 1,
                    max: spec.max ?? 8,
                    step: 1,
                    value: state.text,
                    disabled: !writable,
                    onChange: (e) => edit(field, e.target.value),
                  })
                : spec.kind === "text"
                ? jsxRuntime.jsx("input", {
                    type: "text",
                    className: "dshk-cfg-text",
                    value: state.text,
                    placeholder: "dsh.example.com",
                    spellCheck: false,
                    disabled: !writable,
                    onChange: (e) => edit(field, e.target.value),
                  })
                : jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-cfg-combo",
                    "data-capturing": capturing === field || undefined,
                    disabled: !writable,
                    onClick: () => startCapture(field),
                    children: capturing === field ? t("cfgCapturing") : state.text,
                  });
          // 官方行模型（对齐通用设置页）：左列 = 标题(14px) + 说明(12px 三级色)
          // 纵排，控件恒右置。组合键字段无说明——按钮文本即当前值，非法时说明位
          // 原位显示错误；「已覆盖/恢复默认」徽标插在文本列与控件之间。
          const hintText = t(cfgLabelKey(field, "Hint"));
          const textCol = jsxRuntime.jsxs("div", {
            className: "dshk-cfg-fieldtext",
            children: [
              jsxRuntime.jsx("span", { className: "dshk-cfg-label", children: t(cfgLabelKey(field, "")) }),
              state.invalid
                ? jsxRuntime.jsx("span", {
                    className: "dshk-cfg-invalid",
                    children: t(spec.kind === "number" ? "invalidNumber" : "invalidCombo"),
                  })
                : spec.kind === "combo" || !hintText
                  ? null
                  : jsxRuntime.jsx("span", { className: "dshk-cfg-hint", children: hintText }),
            ],
          });
          return jsxRuntime.jsxs("div", {
            className: isSub ? "dshk-cfg-field dshk-cfg-sub" : "dshk-cfg-field",
            children: [textCol, badges(state, field), control],
          });
        };

        return jsxRuntime.jsxs("li", {
          className: "dshk-cfg-card",
          "data-open": open || undefined,
          children: [
            jsxRuntime.jsxs("button", {
              type: "button",
              className: "dshk-cfg-head",
              "aria-expanded": open,
              onClick: () => setOpen(!open),
              children: [
                jsxRuntime.jsxs("span", {
                  className: "dshk-cfg-headtext",
                  children: [
                    jsxRuntime.jsx("span", { className: "dshk-cfg-name", children: t("cfgTitle") }),
                    jsxRuntime.jsx("span", { className: "dshk-cfg-desc", children: t("cfgDesc") }),
                  ],
                }),
                dirty ? jsxRuntime.jsx("span", { className: "dshk-cfg-pill", children: t("unsaved") }) : null,
                jsxRuntime.jsx("svg", {
                  width: 14,
                  height: 14,
                  viewBox: "0 0 14 14",
                  fill: "none",
                  xmlns: "http://www.w3.org/2000/svg",
                  "aria-hidden": true,
                  className: "dshk-cfg-chev",
                  "data-open": open || undefined,
                  children: jsxRuntime.jsx("path", {
                    d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
                    fill: "currentColor",
                  }),
                }),
              ],
            }),
            open
              ? jsxRuntime.jsxs("div", {
                  className: "dshk-cfg-body",
                  children: [
                    loading ? jsxRuntime.jsx("p", { className: "dshk-cfg-status", role: "status", children: loadingHint }) : null,
                    !loading && !available
                      ? jsxRuntime.jsx("p", { className: "dshk-cfg-status", role: "status", children: t("readOnly") })
                      : null,
                    available && !writable
                      ? jsxRuntime.jsx("p", { className: "dshk-cfg-status", role: "status", children: t("readOnly") })
                      : null,
                    available
                      ? CFG_GROUPS.map((group) => {
                          // 勾选启用才展开该功能的子配置（草稿态即时显隐，保存落盘生效）；
                          // switchKey 为 null 的组没有开关行（侧边栏组：左右两键 + 左栏
                          // 启用位平铺，title 作组头）
                          const on = group.switchKey === null ? true : fieldState(group.switchKey).text === "true";
                          return jsxRuntime.jsxs(
                            "div",
                            {
                              className: "dshk-cfg-group",
                              children: [
                                group.title ? jsxRuntime.jsx("div", { className: "dshk-cfg-grouptitle", children: t(group.title) }) : null,
                                group.switchKey === null ? null : renderField(group.switchKey),
                                on ? group.fields.map((f) => renderField(f, group.switchKey !== null)) : null,
                              ],
                            },
                            group.switchKey ?? group.title ?? group.fields.join("+"),
                          );
                        })
                      : null,
                    available
                      ? jsxRuntime.jsxs("div", {
                          className: "dshk-cfg-footer",
                          children: [
                            failed ? jsxRuntime.jsx("p", { className: "dshk-cfg-err", role: "status", children: t("saveFailed") }) : null,
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dshk-cfg-btn dshk-cfg-btn-discard",
                              disabled: !dirty || saving,
                              onClick: discard,
                              children: t("discard"),
                            }),
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dshk-cfg-btn dshk-cfg-btn-save",
                              disabled: blocked,
                              onClick: save,
                              children: t(saving ? "saving" : "save"),
                            }),
                          ],
                        })
                      : null,
                  ],
                })
              : null,
          ],
        });
      }
    }

    // ─────────── 官方右侧边栏注册（宿主 0.1.5+，替换已退役的探针）───────────
    // 五个功能各注册一张 dock 页类型（id=正文槽 key，kind=openTab 类型名）+
    // pane 正文。开始页归官方 ShippedGuide（罗盘 + 胶囊条目，条目按 order 升序）：
    // 我们只贡献 guide 条目（RB_GUIDE：日程→浏览器→后台任务，官方「文件」条目
    // order 10 垫底）；文件/知识库是被动签，不给条目——入口在左侧边栏
    // （用户定稿 2026-09-11）。服务运行期探测（见 RB_FEATURES 处注释）。
    const RB_BODY = {
      file: FilePaneBody,
      vault: VaultPaneBody,
      schedule: SchedulePaneBody,
      jobs: JobsPaneBody,
      browser: BrowserPaneBody,
    };
    function registerRightbar(rbCtx) {
      const tabs = rbCtx.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      const RB_GUIDE = {
        schedule: { order: 7, icon: SchedIcon, descKey: "rbGuideSchedDesc" },
        browser: { order: 8, icon: BrowserIcon, descKey: "rbGuideBrowserDesc" },
        jobs: { order: 9, icon: JobsIcon, descKey: "rbGuideJobsDesc" },
      };
      for (const f of RB_FEATURES) {
        const Body = RB_BODY[f.feature];
        const guide = RB_GUIDE[f.feature];
        rbCtx.effect(() => tabs.register({
          id: f.id,
          kind: f.kind,
          title: () => t(f.titleKey),
          ...guide ? { guide: [{ order: guide.order, title: () => t(f.titleKey), description: () => t(guide.descKey), icon: guide.icon }] } : {},
        }), `dsh-kit: rightbar tab type ${f.kind}`);
        rbCtx.effect(() => rbCtx.slots.inject("sidebar.right.pane.tab", () => rbCtx.slots.register({
          name: "sidebar.right.pane.tab",
          key: f.id,
          // cwd / 运行中任务数经 shellShare 桥接（pane 注册发生在 effect，
          // 渲染期的 props 由 KitSurfaces 的常驻桥供最新值）
          inject: () => ({
            useSessions: shellShare.current?.useSessions,
            useWorkspaces: shellShare.current?.useWorkspaces,
          }),
        }, Body)), `dsh-kit: rightbar pane body ${f.kind}`);
      }
      // 计时：会话 header 右对齐工具区（list 型）。corner 席位是 single 型且被
      // 官方右栏展开钮占着，不去抢
      rbCtx.effect(() => rbCtx.slots.inject("conversation.session.header.utilities", () => rbCtx.slots.register({
        name: "conversation.session.header.utilities",
        id: "dsh-kit-timer",
        order: 10,
      }, HeaderTimer)), "dsh-kit: header timer chip");
      // 探测落地：入口走右栏（rightbarStore 的订阅者据此重渲染）
      rightbarStore.setActive(true);
    }

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      slotsCtx = ctx;
      injectStyles();
      // 插件配置数据通道：官方 settings scope 绑定本插件命名空间（宿主半边
      // 已按 ctx.settings.installSection 注册 dsh-kit）。绑定失败（老宿主缺 settingsScope）
      // 时 cfgScope 保持 null，功能按内置默认全开、卡片不出现。
      if (ctx.settingsScope && typeof ctx.settingsScope.bind === "function") {
        cfgScope = ctx.settingsScope.bind({ namespace: "dsh-kit" });
      }
      // 全帧浮层宿主：面板渲染、输入框入口与技能页的座位门控、快捷键监听全在
      // KitSurfaces（根作用域常驻，fiber 上下文内做动态 register/dispose）。
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          { name: "shell.overlay", id: "dsh-kit-surfaces", order: 900 },
          KitSurfaces,
        ),
      );
      // 设置→插件配置 卡片（dsh-kit 命名空间）。常驻不受功能开关门控——
      // 否则关掉就再也打不开。
      if (cfgScope) {
        ctx.slots.inject("settings.plugin.item", () =>
          ctx.slots.register(
            {
              name: "settings.plugin.item",
              key: "dsh-kit",
              id: "dsh-kit",
              order: 30,
              inject: () => ({ scope: cfgScope }),
            },
            KitConfigCard,
          ),
        );
      }
      // 官方右侧边栏：五个功能 dock 签 + 引导页清单 + header 计时。只在宿主
      // 提供该服务时生效（缺服务 = 只剩 kitUi 存在性补丁，签不出现）。用 inject
      // 等它就绪而非直接读——官方右栏与本插件的客户端加载顺序不保证
      if (typeof ctx.inject === "function") {
        ctx.inject(["sidebarRightTabs"], registerRightbar);
        ctx.inject(["sidebarRight"], (srCtx) => { rightbarSr = srCtx.sidebarRight; });
      } else {
        registerRightbar(ctx);
      }
      // 计时入口现居会话 header 工具区（右坞时代曾挂 composer/坞收起栏/侧栏底部
      // 按钮，均随迁移退役）；运行态另有悬浮小窗与日程 pane 内芯片。组件内部拉
      // /dsh-kit/schedule/* 数据，与 session 无关。
      // 导航图标替换是点击驱动的轻量方案：打开设置/面板内切换都源于一次 click
      document.addEventListener("click", scheduleSkillIconSwap, true);
      // 对话文件点击接管（默认关闭：设置卡 chatOpenFilePreview 开启才生效）
      document.addEventListener("click", onChatOpenFileClick, true);
    }

    exports.inject = ["slots", "settingsScope"];
    exports.apply = apply;
    return module.exports;
  },
});
