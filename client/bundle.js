// dsh-kit 浏览器半边 —— 手写 client bundle，与官方 lib/client.js 产物同形，
// 无构建步骤：改完本文件刷新浏览器即生效（本地目录 junction 直装）。
//
// 结构：
//   入口：conversation.input.left（composer 工具行，文件树/源代码管理/知识库/
//     终端四个小图标钮，工作区级工具跟 session 走）。知识库钮是开合切换：开 =
//     侧栏索引视图，再点 = 侧栏回会话列表；日程没有 composer 钮（日程只有一个
//     家：右栏 dock 签，入口归右栏开始页条目与待办卡）。
//   右栏（唯一工作台形态，宿主 0.1.5+）：sidebarRightTabs 注册四类 dock 签，
//     pane 正文经 slots.inject（sidebar.right.pane.tab）按 id 提供，pane 内自管
//     文档签条。dock 签本身没有按钮：diff/知识库是被动签（SCM/树/对话点开
//     即开），日程/浏览器走右栏开始页清单与自动跟随。开始页保留官方
//     ShippedGuide（罗盘 + 胶囊条目），我们只贡献 guide 条目：日程/浏览器
//     两枚（diff/知识库是被动签，不给条目），官方「工作区文件」条目
//     垫底（配置可隐藏）。后台任务不做面板（0.1.7 官方会话头部自带
//     任务清单 + 实时输出 + 停止，本插件原面板退役）。
//     缺 sidebarRight 服务时只剩 kitUi 侧的存在性补丁——入口按钮
//     不报错，签由官方侧自己决定要不要出现。
//   终端：底部停靠面板（快捷键亦可切换），0.1.6 起引擎为官方 webTerminals
//   服务（PTY 归宿主），本插件只做 xterm 胶水。
//   功能存在性（kitUi）：files/activeFile（diff 签）与
//     vaultPages/activeVaultPage 是文档签；schedOpen/browserOpen/vaultOpen 是功能签在场
//     （入口按钮选中态与角标读它）；activeFeature 是当前激活的功能（Esc 关哪张
//     文档签、浏览器自动跟随的判据）。索引类视图（知识库目录树）住侧栏
//     sidebar.workspaces 单槽，点条目开对应右栏签。
//   文件树：打开时临时注册进单槽 sidebar.workspaces——把侧边栏浏览区整体换成
//     文件树，关闭时 dispose 注销、原生工作区列表自动回归。根目录 = 当前会话工作
//     目录，数据走宿主半边 /dsh-kit/tree。点击文件改投官方右栏文件签
//     （sidebarRight.openResource，kit 不自建预览/编辑）；vault 内 md 页直达
//     知识库编辑器。
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

    // ─────────── 官方 primitives 图标复用（能复用就不自绘）───
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

    /** agent 动浏览器 → 把右栏浏览器签拽到眼前（壳层常驻事件源与面板共用此入口）。
     *  无抑制标志（agent 操作浏览器为安全起见必须可见——
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
      { id: "dsh-kit-browser", kind: "dshk-browser", feature: "browser", titleKey: "dockBrowser" },
    ];
    /** sidebarRight 服务实例（openTab 用）：apply 时 ctx.inject(["sidebarRight"])
     *  捕获——服务属性不能直接读（`cannot get property without inject`），又不能
     *  写进 exports.inject（0.1.2 无此服务，硬声明整插件起不来） */
    let rightbarSr = null;
    /** 官方 sessions 服务（拿当前会话 id 与 cwd，拼文件地址用），同上运行期捕获 */
    let sessionsSvc = null;
    /** 官方终端模型服务（dock 终端引擎，0.1.6+）：view() 按 (会话, key) 给
     *  TerminalView，xterm 胶水见 TerminalPane。缺服务 = 终端坞报「需要 0.1.6+」 */
    let webTerminalsSvc = null;
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
    /** 打开知识库页并确保「知识库」dock 签在眼前（目录/搜索/反链/wikilink/
     *  对话路径统一走 VaultRootView 的 openPath）。anchor = `[[页#锚]]` 的锚点，
     *  跨页跳转时随开页带给 VaultPagePane 消费（见 vaultPendingAnchor） */
    function openVaultPageAndDock(path, anchor) {
      setKitUi(openVaultPageTab(kitUi, path));
      openRightbarTab("vault");
      vaultPendingAnchor = typeof anchor === "string" && anchor !== "" ? { path, anchor } : null;
    }
    /** 点击路径落知识库标签（树行/对话拦截器共用）：先落地再派发——知识库未
     *  挂载时 VaultRootView 不在，挂载后经 vaultOpenRequest 消费请求 */
    function openVaultPathFromClick(path) {
      openVaultPageAndDock(path);
      vaultOpenRequest = path;
      window.dispatchEvent(new CustomEvent("dshk-vault-open"));
    }
    // ─────────── 文件树点击 → 官方右栏文件签 ───────────
    // 官方打开文件签的公开通道是 sidebarRight.openResource(地址)（官方文件树与
    // 对话文件 chip 都走它）；文件签由宿主 documentpreview 以 `text` 类型认领
    // `dsh-resource://file/**`。地址 = session 域 + 会话 id + 路径，编码复刻官方
    // fileAddressFor：反斜杠归 /、剥前导 ./；cwd 内剥成相对，cwd 外保留绝对；
    // 逐段 encodeURIComponent、`:` 保留字面量（Windows 盘符）。会话未选中时
    // 无从定位工作区，放弃。
    function openOfficialFile(path, line) {
      const sr = rightbarSr;
      if (!sr || typeof sr.openResource !== "function") return false;
      const list = sessionsSvc && typeof sessionsSvc.list?.getSnapshot === "function" ? sessionsSvc.list.getSnapshot() : null;
      const sessionId = mainRowOf(list)?.id;
      if (!sessionId) return false;
      const cwd = list.byId?.[sessionId]?.cwd ?? null;
      let address = null;
      try {
        const util = require("@deepseek-ai/dsh-util-workspace-path");
        if (util && typeof util.fileAddressFor === "function") address = util.fileAddressFor(sessionId, cwd, path);
      } catch (e) {
        /* 平台模块缺位：走下面的本地复刻 */
      }
      if (address === null) {
        // 复刻官方编码；cwd 前缀比较有意不分大小写——盘符大小写不一致时剥成
        // 相对路径（session 域按会话 cwd 解析），官方的大小写敏感版会落成绝对路径
        const seg = (s) => encodeURIComponent(s).replace(/%3A/gi, ":");
        let norm = String(path).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
        const cwdNorm = cwd ? String(cwd).replace(/\\/g, "/").replace(/[\\/]+$/, "") : null;
        if (cwdNorm && norm.toLowerCase().startsWith(`${cwdNorm.toLowerCase()}/`)) norm = norm.slice(cwdNorm.length + 1);
        address = `dsh-resource://file/session/${seg(sessionId)}/${norm.split("/").map(seg).join("/")}`;
      }
      try {
        sr.openResource(address, line === undefined ? undefined : { params: { line } });
        return true;
      } catch (e) {
        // 右栏 seat 未 mount（极早期）/ 宿主无文件认领类型（精简组合）：点了没
        // 反应最难排查，至少给一句
        flashToast(`${t("officialOpenFail")}：${String(e?.message ?? e).slice(0, 120)}`);
        return false;
      }
    }
    /** 文件树行点击：vault 内 → 知识库（只读阅读视图）；其余 → 官方
     *  右栏文件签（kit 不再有工作区文件预览/编辑面） */
    function openTreeFile(path) {
      const r = vaultRootHint;
      if (r !== null && isPathInsideVaultRoot(r, path)) {
        openVaultPathFromClick(path);
        return;
      }
      openOfficialFile(path);
    }

    // ── 侧栏索引视图单槽与入口按钮（文件树/源代码管理/知识库，三个入口按钮
    // + 快捷键共用）──
    // 侧栏只有一格（会话 ↔ 文件树 ↔ 源代码管理 ↔ 知识库目录），三个按钮的
    // 选中态直接取各自的开合位（选中态与侧栏显示相关、与右栏签
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
    // 语义：关 → 开；开 → 只把侧栏索引收回会话列表（功能签
    // 不跟着关——签的归宿是官方签 ✕ 与配置清场，入口按钮只管侧栏那格）。知识库钮
    // 只切左侧目录，点具体页才开右栏签；收起态顺带展开
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

    // ─────────── 插件配置 ───────────
    // 数据通道：官方 settings scope（宿主 installSettingsSection 注册的
    // dsh-kit 命名空间）。默认值与宿主 Config schema（src/index.ts）逐项同值——
    // 恢复默认拿的是宿主组合基座（base），基座只有 vaultRoot 一项，其余键在
    // cfgFormat 里回落这里的默认值，两处不同步会出现「默认值漂移」。
    // 快照未就绪时一律回退内置默认——功能全开、默认键位。
    const CFG_DEFAULTS = {
      terminalEnabled: true,
      fileTreeEnabled: true,
      sourceControlEnabled: true,
      hideOfficialFilesEntry: false,
      hideOfficialBrowserEntry: false,
      chatOpenLinkInBrowser: true,
      skillsPageEnabled: true,
      searchEnabled: true,
      searchMaxResults: 2,
      phoneEnabled: true,
      phoneRemoteDomain: "",
      phonePort: 3090,
      phoneKeepGatewayOn: false,
      browserEnabled: true,
      monitorEnabled: true,
      monitorWaitMs: 15000,
      monitorMaxAuto: 5,
      monitorRepeatThreshold: 3,
      notifyEnabled: true,
      usageEnabled: false,
      vaultEnabled: false,
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
    /** 从官方 scope 快照提取生效配置（字段缺失/非法逐项回退默认） */
    function cfgFromSnapshot(snap) {
      if (!snap || snap.status !== "ready" || !snap.value || typeof snap.value !== "object") return { ...CFG_DEFAULTS };
      const v = snap.value;
      return {
        terminalEnabled: v.terminalEnabled !== false,
        fileTreeEnabled: v.fileTreeEnabled !== false,
        sourceControlEnabled: v.sourceControlEnabled !== false,
        hideOfficialFilesEntry: v.hideOfficialFilesEntry === true,
        hideOfficialBrowserEntry: v.hideOfficialBrowserEntry === true,
        chatOpenLinkInBrowser: v.chatOpenLinkInBrowser === true,
        skillsPageEnabled: v.skillsPageEnabled !== false,
        searchEnabled: v.searchEnabled !== false,
        phoneEnabled: v.phoneEnabled === true,
        phoneRemoteDomain: typeof v.phoneRemoteDomain === "string" ? v.phoneRemoteDomain : "",
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
        notifyEnabled: v.notifyEnabled !== false,
        usageEnabled: v.usageEnabled === true,
        vaultEnabled: v.vaultEnabled === true,
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
    // 模块级通道（apply 注入 / KitSurfaces 订阅）
    // ── 插件配置快照（0.1.7：宿主客户端已无 settingsScope 服务）──
    // 配置真源 = 宿主 Config schema + profile 补丁（插件页本行「配置」页编辑）。
    // client 启动拉 GET /dsh-kit/config 喂快照，全部功能门控照旧走 cfgFromSnapshot；
    // 快照形状保持 { status:'ready', value } 与旧 scope 相同。配置页保存成功后会
    // 重拉一次本端点（volatile 热提交即时生效）；其余情况（profile 文件直改）刷新
    // 页面取新值（拉取失败保持 null → 功能按内置默认）。
    let cfgSnapshot = null;
    const cfgListeners = new Set();
    const subscribeCfg = (listener) => {
      cfgListeners.add(listener);
      return () => cfgListeners.delete(listener);
    };
    const getCfgSnapshot = () => cfgSnapshot;
    function applyConfigSnapshot(value) {
      cfgSnapshot = value && typeof value === "object" ? { status: "ready", value } : null;
      for (const listener of [...cfgListeners]) listener();
    }
    let vaultSearchOpen = false; // 知识库搜索浮层开着：同上让路——Esc 归浮层自关，不收页签/不收侧栏
    let inlineEditCapture = false; // 树行内改名输入激活：面板快捷键（含 Esc 分层关闭）让路

    // ─────────── 对话文件点击的知识库路由 ───────────
    // 官方对话中的文件点击（chips / markdown 内联代码 / 工具行 / 交付卡）原生
    // 走 sidebarRight.openResource 开右栏文件签，kit 不拦。唯一例外是 vault 内
    // 路径：改道知识库标签的只读阅读视图（互通是知识库本体能力，无开关）。
    let chatPreviewHook = null;
    // KitSurfaces 渲染期 props 桥：右栏 pane/开始页的 inject 闭包经此取官方
    // useSessions（任务 pane/开始页要在跑任务数做徽标；槽位注册在 effect 里，
    // 拿不到渲染期 props，用模块变量中转）
    const shellShare = { current: null };

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
     *  放行官方——官方原生 openResource 开右栏文件签，kit 不再接管工作区文件。 */
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

    // ─────────── 对话链接改投内置浏览器（设置项 chatOpenLinkInBrowser，默认开）───────────
    /** 官方 markdown 把链接渲染成 `<a target="_blank">`（新标签打开，系统浏览器接管）。
     *  开启后把对话滚动区内的 http(s) 链接改投右栏浏览器签：宿主端点
     *  /dsh-kit/browser/open 与面板 URL 栏同一条 humanOpen 语义（作用于观察页、浏览器
     *  没在跑时拉起），点击即达，不依赖面板是否已挂载/已连上 WS。
     *  判定链任何一环不命中都放行官方：自家面板元素、非 http(s)（相对链接/mailto/锚点）、
     *  浏览器总开关关着（那开关关时入口与面板都隐藏，改投只会开出一个空壳）。 */
    function onChatLinkClick(ev) {
      if (!ev.isTrusted) return;
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      if (cfg.chatOpenLinkInBrowser !== true || cfg.browserEnabled !== true) return;
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
      setKitUi(openFeatureDock(kitUi, "browser"));
      // 失败不提示（吞掉 rejection 免成 unhandled）：面板上一步已切到浏览器签——
      // 网址打不开时浏览器自己的错误页就是反馈（同普通浏览器），浏览器起不来时
      // 面板的未启动提示会带上宿主报的原因。再弹 toast 只是重复的噪音。
      // sessionId = 点击时所在会话：宿主按它把链接落进该对话自己的浏览器分区
      kitJson("/dsh-kit/browser/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: href, sessionId: currentSessionId() }),
      }).catch(() => {});
    }

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
        const a = document.createElement("a");
        a.href = `/dsh-kit/raw?path=${encodeURIComponent(p)}&dl=1`;
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
      const current = mainRowOf(sessions?.list?.getSnapshot?.())?.id;
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

    /** base 内的相对路径（`/` 分隔、无前导分隔符；base 本身回 ""）：不在 base 内回 null。
     *  Windows 形根（盘符/UNC）大小写不敏感，POSIX 根大小写敏感。 */
    function relUnder(base, p) {
      if (typeof base !== "string" || typeof p !== "string" || base === "" || p === "") return null;
      const win = /^[A-Za-z]:[\\/]/.test(base) || base.startsWith("\\\\");
      const lc = (arr) => (win ? arr.map((s) => s.toLowerCase()) : arr);
      const r = lc(pathSegs(base));
      const t = lc(pathSegs(p));
      if (t.length < r.length) return null;
      if (!r.every((seg, i) => t[i] === seg)) return null;
      return t.slice(r.length).join("/");
    }

    /** M4 路由判据：path 是否落在 vault root 内（根本身不算内） */
    function isPathInsideVaultRoot(root, path) {
      const rel = relUnder(root, path);
      return rel !== null && rel !== "";
    }

    /** root 下 rel（`/` 分隔的相对路径）的绝对路径：正斜杠在 Node 侧照收，只用于
     *  比对与请求参数（不落盘打印） */
    function joinRelPath(root, rel) {
      const base = String(root).replace(/[\\/]+$/, "");
      return rel === "" ? base : `${base}/${rel}`;
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

    /** 改名/移动后把已开的知识库页签一起搬（等路径或整棵前缀）；无变化回 null。
     *  撞上已开页时并成一格（去重保序），激活页跟着搬。 */
    function vaultTabsRetarget(ui, oldPath, newPath, isDir) {
      const pages = ui.vaultPages ?? [];
      const map = (p) => {
        if (p === oldPath) return newPath;
        return isDir && pathUnder(p, oldPath) ? newPath + p.slice(oldPath.length) : p;
      };
      const next = pages.map(map);
      if (next.every((p, i) => p === pages[i])) return null;
      const list = [];
      for (const p of next) if (!list.includes(p)) list.push(p);
      const patch = { vaultPages: list };
      if (ui.activeVaultPage != null) patch.activeVaultPage = map(ui.activeVaultPage);
      return patch;
    }

    /** 删除后关掉落在删除集里的页签（含整棵子路径）；没有受影响页签回 null */
    function vaultTabsClose(ui, prefixes) {
      const pages = ui.vaultPages ?? [];
      const stale = (p) => prefixes.some((pre) => pathUnder(p, pre));
      const rest = pages.filter((p) => !stale(p));
      if (rest.length === pages.length) return null;
      const patch = { vaultPages: rest };
      if (ui.activeVaultPage != null && stale(ui.activeVaultPage)) {
        patch.activeVaultPage = rest.length > 0 ? rest[rest.length - 1] : null;
      }
      return patch;
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

    /** 一页 @ 进对话输入框（左侧树行按钮的唯一实现）：以官方 @ 引用芯片直插
     *  （与文件树「@到对话」同款方法），selText 非空时先落引用块。**成功不提示**——
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
      officialTermUnavailable: "官方终端服务不可用：此功能需要 DSH 0.1.6+",
      termLimit: "宿主终端数量已达上限：先结束一些再新建",
      treeLabel: "文件树",
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
      scDetached: "分离头",
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
      scGraphEmpty: "（尚无提交）",
      scGraphFail: "图谱加载失败",
      scGraphMore: "加载更多",
      scCommitDetail: "提交详情",
      scBack: "返回",
      scMergedCommit: "合并提交",
      scAuthored: "作者",
      scFiles: "更改的文件",
      edit: "编辑",
      diffFail: "diff 加载失败",
      diffEmpty: "（无未暂存差异）",
      diffUntracked: "未跟踪文件，暂无 diff",
      diffBaseParent: "与上一版（父提交 {base}）对比",
      diffBaseRoot: "根提交：与空树对比（全部为新增）",
      gitM: "已修改",
      gitA: "新文件",
      gitD: "已删除",
      gitR: "重命名",
      gitU: "未跟踪",
      gitTip: "git 变更",
      contentLoading: "加载中…",
      contentBinary: "二进制文件，无法预览",
      fileDownload: "下载到本机",
      contentFail: "读取失败",
      officialOpenFail: "打开失败",
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
      skVersionTip: "技能自带版本（frontmatter version）：用来对照自己手上这份抄的是哪版",
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
      monitorContinueText: "继续",
      monitorLoopBreakText: "检测到你的输出在重复相同内容，可能陷入了死循环。请立即停止重复，简要说明当前状态，换一种方式继续完成任务。",
      monitorCancel: "取消",
      monitorRepeatErr: "重复输出（死循环征兆）",
      monitorStopping: "监视：检测到重复输出（死循环征兆），正在停止当前回合…",
      monitorCapped: "监视：已连续自动继续 {max} 次，暂停自动续跑（重复输出仍会中止）",
      monitorAutoIn: "监视：检测到{err}，{sec} 秒后自动继续（第 {n}/{max} 次）",
      monitorErr429: "请求被限流（429）",
      monitorBgTitle: "429 自动续跑",
      monitorBgItem: "{title}：{sec} 秒后自动继续（第 {n}/{max} 次）",
      monitorBgCapped: "{title}：已连续自动继续 {max} 次，暂停（正常完成一轮后恢复）",
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
      browserUrlPh: "输入 HTTP(S) 地址",
      browserGo: "前往",
      browserBack: "后退",
      browserForward: "前进",
      browserReload: "刷新",
      browserExternal: "在系统浏览器中打开",
      browserNewTab: "新建页签",
      browserCloseTab: "关闭页签",
      browserReconnect: "连接断开，重连中…",
      browserNotRunning: "浏览器未启动——在上方输入网址回车，或等 agent 首次使用时自动拉起",
      browserNoPages: "没有打开的页面——在上方输入网址回车，或等 agent 下次导航自动出现在这里",
      dockBrowser: "内置浏览器",
      pvCloseTab: "关闭此标签",
      pvDeletedNote: "文件已删除——此标签仅展示删除 diff；可在源代码管理里 ↩ 恢复文件",
      rbGuideSchedDesc: "周网格、待办与统计（只读）",
      rbGuideBrowserDesc: "agent 驱动的真实浏览器，可实时观看与接管",
      rbFeatureDisabled: "该功能已在设置中停用",
      fileTabLabel: "文件",
      browserStarting: "正在拉起浏览器…",
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
      phoneRotateFail: "刷新失败：{error}",
      kcfgLoading: "正在读取配置…",
      kcfgUnavailable: "配置当前不可读写（宿主未提供该命名空间，或为进程内会话）。",
      kcfgReadonly: "当前 profile 只读，修改无法保存。",
      kcfgSaved: "已保存",
      kcfgSaveFail: "保存失败：{error}",
      kcfgSave: "保存",
      kcfgDiscard: "放弃修改",
      kcfgGroupFeatures: "功能开关",
      kcfgGroupMonitor: "会话监视与通知",
      kcfgGroupPhone: "手机访问",
      kcfgGroupVault: "知识库",
      kcfgGroupShortcuts: "快捷键",
      kcfgTerminalEnabled: "终端面板",
      kcfgFileTreeEnabled: "文件树",
      kcfgSourceControlEnabled: "源代码管理",
      kcfgSkillsPageEnabled: "技能管理页",
      kcfgSearchEnabled: "免费网页搜索",
      kcfgSearchMaxResults: "搜索结果条数（1–8）",
      kcfgBrowserEnabled: "内置浏览器",
      kcfgChatOpenLinkInBrowser: "对话链接改投内置浏览器",
      kcfgHideOfficialFilesEntry: "隐藏官方「工作区文件」入口",
      kcfgHideOfficialBrowserEntry: "隐藏官方「浏览器」入口",
      kcfgUsageEnabled: "余额与用量芯片",
      kcfgNotifyEnabled: "会话桌面通知",
      kcfgMonitorEnabled: "会话监视（429 续跑 / 死循环打断）",
      kcfgMonitorWaitMs: "429 等待毫秒（5000–600000）",
      kcfgMonitorMaxAuto: "429 连续续跑上限（1–10）",
      kcfgMonitorRepeatThreshold: "死循环判定重复次数（2–10）",
      kcfgPhoneEnabled: "「手机访问」页入口",
      kcfgPhonePort: "手机访问端口（1–65535）",
      kcfgPhoneRemoteDomain: "手机远程域名",
      kcfgPhoneKeepGatewayOn: "网关常驻",
      kcfgVaultEnabled: "知识库（默认关）",
      kcfgVaultRoot: "知识库根目录（绝对路径）",
      kcfgSidebarShortcut: "侧栏开合",
      kcfgRightbarShortcut: "右栏开合",
      kcfgTerminalShortcut: "终端",
      kcfgFileTreeShortcut: "文件树",
      kcfgScShortcut: "源代码管理",
      kcfgVaultShortcut: "知识库",
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
      schedTimerStandalone: "独立计时（不挂待办）",
      schedWeekdays: "一,二,三,四,五,六,日",
      vaultTitle: "知识库",
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
      moved: "已移动",
      imported: "已导入",
      cancel: "取消",
      vaultRefresh: "刷新索引与目录树",
      vaultRefreshed: "已刷新",
      vaultBinaryHint: "二进制文件，知识库不渲染",
      vaultCopy: "复制",
      vaultCopied: "已复制",
      vaultBacklinks: "反链",
      vaultToc: "目录",
      vaultTocEmpty: "本文没有标题",
      vaultBlEmpty: "没有页面引用本页",
      vaultLibsFail: "渲染组件加载失败",
      vaultPickPage: "从左侧选择一页开始",
      vaultPageGone: "页面不存在（可能已被移动或删除）",
      vaultCiteUnavailable: "对话输入框未就绪（无会话或不可用）",
      save: "保存",
      saving: "保存中…",
      discard: "放弃修改",
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
      treeLabel: "Files",
      treeRefresh: "Refresh",
      treeLoading: "Loading…",
      treeEmpty: "(empty)",
      treeFail: "Failed to load",
      treeTruncated: "Too many entries, list truncated",
      treeNewAny: "New file/folder",
      treeNewPh: "Name, \\ prefix creates a folder, / for nesting, Enter to create",
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
      scDetached: "detached HEAD",
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
      scGraphEmpty: "(no commits yet)",
      scGraphFail: "Failed to load graph",
      scGraphMore: "Load more",
      scCommitDetail: "Commit detail",
      scBack: "Back",
      scMergedCommit: "Merge commit",
      scAuthored: "Author",
      scFiles: "Changed files",
      diffFail: "Failed to load diff",
      diffEmpty: "(no unstaged changes)",
      diffUntracked: "Untracked file, no diff yet",
      diffBaseParent: "Compared with parent commit {base}",
      diffBaseRoot: "Root commit: diffed against empty tree (all additions)",
      gitM: "Modified",
      gitA: "Added",
      gitD: "Deleted",
      gitR: "Renamed",
      gitU: "Untracked",
      gitTip: "git change",
      edit: "Edit",
      contentLoading: "Loading…",
      contentBinary: "Binary file, preview unavailable",
      fileDownload: "Download file",
      contentFail: "Failed to read",
      officialOpenFail: "Open failed",
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
      skVersionTip: "Skill's own version (frontmatter version), to compare against your own copy",
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
      monitorRepeatErr: "repeated output (dead-loop sign)",
      monitorStopping: "Monitor: repeated output detected (dead-loop sign), stopping the current turn…",
      monitorCapped: "Monitor: auto-continued {max} times in a row, pausing auto-continue (repeats are still stopped)",
      monitorAutoIn: "Monitor: {err}; auto-continue in {sec}s (attempt {n}/{max})",
      monitorErr429: "rate limit (429)",
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
      browserUrlPh: "Enter an HTTP(S) address",
      browserGo: "Go",
      browserBack: "Back",
      browserForward: "Forward",
      browserReload: "Reload",
      browserExternal: "Open in system browser",
      browserNewTab: "New tab",
      browserCloseTab: "Close tab",
      browserReconnect: "Reconnecting…",
      browserNotRunning: "Browser not started — type a URL above or wait for the agent's first use",
      browserNoPages: "No open pages — type a URL above, or the agent's next navigation will appear here",
      dockBrowser: "Built-in browser",
      pvCloseTab: "Close this tab",
      pvDeletedNote: "File deleted — this tab shows the deletion diff only; restore it via ↩ in source control",
      rbGuideSchedDesc: "Weekly grid, todos, and stats (read-only)",
      rbGuideBrowserDesc: "Agent-driven real browser you can watch live and take over",
      rbFeatureDisabled: "This feature is disabled in settings",
      fileTabLabel: "Files",
      browserStarting: "Starting browser…",
      phoneGateStart: "Start gateway",
      phoneGateStop: "Stop gateway",
      phoneStoppedHint: "Gateway is off. Use \"New link\" after starting to invalidate old links.",
      save: "Save",
      saving: "Saving…",
      discard: "Discard",
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
      phoneRotateFail: "Rotate failed: {error}",
      kcfgLoading: "Loading configuration…",
      kcfgUnavailable: "Configuration is unavailable right now (the host does not serve this namespace, or this is an in-process session).",
      kcfgReadonly: "The profile is read-only; changes cannot be saved.",
      kcfgSaved: "Saved",
      kcfgSaveFail: "Save failed: {error}",
      kcfgSave: "Save",
      kcfgDiscard: "Discard changes",
      kcfgGroupFeatures: "Features",
      kcfgGroupMonitor: "Session monitor & notifications",
      kcfgGroupPhone: "Phone access",
      kcfgGroupVault: "Vault",
      kcfgGroupShortcuts: "Shortcuts",
      kcfgTerminalEnabled: "Terminal panel",
      kcfgFileTreeEnabled: "File tree",
      kcfgSourceControlEnabled: "Source control",
      kcfgSkillsPageEnabled: "Skills manager page",
      kcfgSearchEnabled: "Free web search",
      kcfgSearchMaxResults: "Search results (1–8)",
      kcfgBrowserEnabled: "Built-in browser",
      kcfgChatOpenLinkInBrowser: "Open chat links in the built-in browser",
      kcfgHideOfficialFilesEntry: "Hide the official Workspace files entry",
      kcfgHideOfficialBrowserEntry: "Hide the official Browser entry",
      kcfgUsageEnabled: "Balance & usage chip",
      kcfgNotifyEnabled: "Session desktop notifications",
      kcfgMonitorEnabled: "Session monitor (429 retry / loop break)",
      kcfgMonitorWaitMs: "429 wait in ms (5000–600000)",
      kcfgMonitorMaxAuto: "429 max consecutive retries (1–10)",
      kcfgMonitorRepeatThreshold: "Loop detection repeats (2–10)",
      kcfgPhoneEnabled: "Show the Phone access page",
      kcfgPhonePort: "Phone access port (1–65535)",
      kcfgPhoneRemoteDomain: "Phone remote domain",
      kcfgPhoneKeepGatewayOn: "Keep gateway on",
      kcfgVaultEnabled: "Vault (off by default)",
      kcfgVaultRoot: "Vault root directory (absolute path)",
      kcfgSidebarShortcut: "Toggle sidebar",
      kcfgRightbarShortcut: "Toggle right bar",
      kcfgTerminalShortcut: "Terminal",
      kcfgFileTreeShortcut: "File tree",
      kcfgScShortcut: "Source control",
      kcfgVaultShortcut: "Vault",
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
      schedTimerStandalone: "Standalone timer (no task)",
      schedWeekdays: "Mo,Tu,We,Th,Fr,Sa,Su",
      vaultTitle: "Knowledge base",
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
      moved: "Moved",
      imported: "Imported",
      cancel: "Cancel",
      vaultRefresh: "Refresh index and tree",
      vaultRefreshed: "Refreshed",
      vaultBinaryHint: "Binary file — not rendered in the vault",
      vaultCopy: "Copy",
      vaultCopied: "Copied",
      vaultBacklinks: "Backlinks",
      vaultToc: "Outline",
      vaultTocEmpty: "No headings in this page",
      vaultBlEmpty: "No pages link here",
      vaultLibsFail: "Failed to load renderer components",
      vaultPickPage: "Pick a page on the left to start",
      vaultPageGone: "Page not found (it may have been moved or deleted)",
      vaultCiteUnavailable: "Composer is not ready (no active session)",
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
.dshk-head{flex:none;min-height:34px;display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshk-title{font-weight:600;color:var(--dsw-alias-label-primary);flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
/* 终端坞标签是固定短文字，不参与弹性：head 里 title 与 spring 双 flex:1 会把空闲
   空间对半分，宽窗口下标签簇（页签/路径）飘到中间，只有窄窗口看着正常 */
.dshk-dock-label{flex:0 0 auto}
.dshk-sub{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.dshk-status{color:var(--dsw-alias-label-tertiary)}
.dshk-spring{flex:1}
.dshk-btn{appearance:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);width:26px;height:26px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;padding:0}
.dshk-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 官方文件预览头部注入的下载按钮：度量对齐官方 tool 按钮（28×28 圆形热区、15px 图形） */
.dshk-preview-dl{appearance:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);width:28px;height:28px;border-radius:28px;cursor:pointer;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:6px;line-height:1}
.dshk-preview-dl:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshk-preview-dl svg{width:15px;height:15px;display:block}
/* 隐藏官方右栏「工作区文件」入口（hideOfficialFilesEntry 开时 body 挂标记类） */
body.dshk-hide-official-files [data-sidebar-right-guide-entry="files"]{display:none}
/* 隐藏官方右栏「浏览器」入口（hideOfficialBrowserEntry）：iframe 预览框，站点覆盖面天然受限 */
body.dshk-hide-official-browser [data-sidebar-right-guide-entry="browser"]{display:none}
.dshk-term{height:100%}
/* padding 加在 .xterm 元素上：fit addon 从该元素读 padding 并从可用面积扣除，cols/rows 不会算错 */
.dshk-term .xterm{height:100%;box-sizing:border-box;padding:6px 10px}
.dshk-term .xterm-viewport::-webkit-scrollbar{width:8px}
.dshk-term .xterm-viewport::-webkit-scrollbar-thumb{background:rgba(127,127,127,.3);border-radius:4px}
.dshk-term .xterm-viewport::-webkit-scrollbar-track{background:transparent}
.dshk-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:13px}
/* 多终端：入口图标数量角标 + 标签条 + 堆叠 pane（隐藏 pane 离屏缓冲输出） */
.dshk-enbtn{position:relative}
/* 品牌主色是单色令牌（浅色主题近黑、深色主题近白），主色底上的文字一律用 bg-base 取反——
   写死 #fff 在深色主题就是白底白字（终端角标、配置/文件/Git 的保存钮、手机设置签同此） */
.dshk-term-badge{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:9px;line-height:14px;text-align:center;font-weight:600}
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
/* pane 内联提示（文件已删除等）：弱化小字说明，不抢内容 */
.dshk-note{flex:none;padding:8px 12px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
/* 官方右栏 dock pane 正文（sidebar.right.pane.tab）：pane 内是普通文档流，
   外壳占满 100%×100%、内容区自己滚；这里只有普通文档流 */
.dshk-rbpane{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
.dshk-rbpane .dshk-pane-view{flex:1 1 auto;min-height:0}
.dshk-rbpane .dshk-vault-panehost{flex:1 1 auto;min-height:0}
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
/* 会话头部 429 状态条（原右栏任务签顶部状态块；任务签退役后移到头部，
   与官方后台任务入口同域）。仅当后台会话有待续跑/已封顶时渲染，零常驻。 */
.dshk-mbg{position:relative}
.dshk-mbg-trigger{display:inline-flex;align-items:center;gap:5px;min-height:26px;padding:2px 7px;border:0;background:none;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:12px;line-height:18px}
.dshk-mbg-trigger:hover,.dshk-mbg-trigger[aria-expanded="true"]{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l1,transparent)}
.dshk-mbg-dot{flex:none;width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-warning,#e2c08d)}
.dshk-mbg-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:80;display:flex;flex-direction:column;gap:2px;min-width:300px;max-width:min(460px,92vw);padding:7px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.2))}
.dshk-mbg-menu .dshk-monitor-cancel{margin-left:auto}
/* 配置页（插件页 dsh-kit 行「配置」，plugins.row.config）：分组行式表单，
   外观跟随宿主令牌；保存栏吸底右侧。 */
.dshk-cfgp{display:flex;flex-direction:column;gap:14px;padding:4px 2px 8px;color:var(--dsw-alias-label-primary);font-size:13px}
.dshk-cfgp-group{display:flex;flex-direction:column;gap:1px}
.dshk-cfgp-grouptitle{margin:0 0 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshk-cfgp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;padding:3px 8px;border-radius:7px}
.dshk-cfgp-row:hover{background:var(--dsw-alias-fill-l1,transparent)}
.dshk-cfgp-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary)}
.dshk-cfgp-ctl{flex:none;display:inline-flex;align-items:center}
.dshk-cfgp-ctl input[type="text"],.dshk-cfgp-ctl input[type="number"]{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;min-width:0}
.dshk-cfgp-ctl input[type="text"]{width:260px;max-width:52vw}
.dshk-cfgp-ctl input[type="number"]{width:110px}
.dshk-cfgp-ctl input:disabled{opacity:.5;cursor:default}
.dshk-cfgp-actions{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;justify-content:flex-end;padding:10px 2px 2px;background:linear-gradient(to top,var(--dsw-alias-bg-layer-1) 70%,transparent)}
.dshk-cfgp-hint{margin-right:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshk-cfgp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:6px 14px;border-radius:7px;cursor:pointer}
.dshk-cfgp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-cfgp-btn:disabled{opacity:.5;cursor:default}
.dshk-cfgp-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6fff);color:var(--dsw-alias-bg-base,#fff)}
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
.dshk-vault-panehost{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dshk-vault-panehost .dshk-vault-reader{padding:0 2px}
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
.dshk-vault-editwrap{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;padding:8px 10px}
.dshk-vault-editbar{position:sticky;top:0;z-index:2;flex:none;display:flex;align-items:center;gap:6px;padding:6px 0;background:var(--dsw-alias-bg-base)}
.dshk-vault-crumb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:default;user-select:none}
.dshk-vault-rtehost{flex:1 1 auto;min-height:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-base)}
/* 复用 .dshk-md 排版（标题/表格/引用/代码），只覆盖编辑态差异：
   滚动容器是 rtehost 自身，ProseMirror 去描边、正文区给最小高度 */
.dshk-vault-rtehost.dshk-md{flex:1 1 auto;overflow:auto;padding:12px 16px}
.dshk-vault-rtehost .ProseMirror{outline:none;min-height:60px;caret-color:var(--dsw-alias-brand-primary,#1971c2)}
.dshk-vault-rtehost h5,.dshk-vault-rtehost h6{margin:1.2em 0 .5em;line-height:1.3}
.dshk-rte-doc p.is-empty::before{content:attr(data-placeholder);color:var(--dsw-alias-label-tertiary);pointer-events:none;float:left;height:0}
.dshk-rte-anchorflash,.dshk-rte-anchorflash-b{animation:dshkRteFlash 1.5s var(--ds-ease-in-out)}
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
/* 日程模块：中心区第三 tab——周时间网格 + 待办/统计侧栏；计时芯片挂输入区 dock。
   --dshk-sched-toprow = 顶部一条的高度上限（矮坞里侧栏先被压、统计自己滚，
   清单卡不拉伸到统计高度、只有约三行行区，见 .is-tasks/.dshk-sched-taskrows） */
.dshk-sched-root{height:100%;display:flex;flex-direction:column;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;--dshk-sched-band:52px;--dshk-sched-toprow:218px}
.dshk-sched-head{flex:none;display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshk-sched-title{font-weight:600;font-size:15px}
.dshk-sched-weeknav{display:flex;align-items:center;gap:6px}
.dshk-sched-weeklabel{min-width:104px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshk-sched-navbtn{appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-navbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 顶部一条（左待办 + 右统计）→ 下网格（所有坞宽一致）。
   不做整体左右分栏（待办+统计整列在左、网格在右）——待办行的固定件（勾选/截止
   徽章/计时钮）占 ~150px，坞宽一紧就只剩把网格挤成每天十几像素这一条路
   （默认 300px 右栏、手机竖屏都实测过） */
.dshk-sched-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;min-width:0}
/* y 轴 mandatory 吸附到整点行：静止位置恒为「某小时标签贴在表头带下方」，
标签既不会被 sticky 角格盖掉半截，也不会漂进表头区；
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
/* 主色底上的文字用 bg-base 而不是写死 #fff：品牌主色是单色令牌（浅色近黑 / 深色近白），
   写死白在深色主题就是白底白字——日程字体颜色不随深暗色变 */
.dshk-sched-dayhead.is-today .dshk-sched-dnum{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
/* 表头下的全天带：只放「有截止日且不带时刻的待办」（桌面口径），待办橙浅底、
   逾期红；不在本周的落周一列 */
.dshk-sched-allday{grid-row:2;padding:2px 4px;font-size:11px;background:#ffe8cc;color:#d9480f;border-radius:4px;margin:2px 2px;min-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dshk-sched-allday:hover{filter:brightness(.97)}
.dshk-sched-allday.is-overdue{background:#ffe3e3;color:#c92a2a}
.dshk-sched-allday.is-done{background:#f1f3f5;color:#868e96}
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
/* 顶部一条最高 = 统计卡高度 + 上下内边距（36% 是矮坞的第二道闸：pane 一矮，
   --dshk-sched-toprow 会占掉大半屏，得让网格先活）。整条高度由待办卡（限高
   --dshk-sched-toprow）与统计卡里较高的那个决定，与待办条数无关 */
.dshk-sched-sidecol{flex:none;width:auto;min-width:0;max-height:min(36%,calc(var(--dshk-sched-toprow) + 20px));box-sizing:border-box;display:flex;flex-direction:row;align-items:stretch;gap:10px;padding:10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
/* 待办卡不拉伸到统计卡高度：行区固定约三行高、其余卡内滚（表头与档位钉死，
   不做分页加载——限高滚动本身就是「最多看几条，多了滚」本身） */
.dshk-sched-card.is-tasks{flex:1 1 auto;min-width:0;min-height:0;align-self:flex-start;box-sizing:border-box;overflow:hidden}
.dshk-sched-taskrows{flex:0 0 auto;max-height:66px;overflow:auto;display:flex;flex-direction:column;gap:8px}
/* 统计卡窄而固定（数值列不需要宽度）；单列而非两列：四格两列时每格只剩约 80px，
   「13小时46分」这种值（固有宽 82px）会被折断成两行（实测 576 坞宽下正是如此） */
/* 统计卡跟随清单卡等高：标题钉顶，两行统计在剩余空间垂直居中——
   清单高一分，统计的留白就摊到上下两半，不会全堆在底部 */
.dshk-sched-card.is-stats{flex:0 0 clamp(118px,30%,220px);width:auto}
.dshk-sched-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-3);min-height:0;overflow:auto}
.dshk-sched-cardtitle{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-sched-cardhead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
.dshk-sched-task{display:flex;align-items:center;gap:7px;padding:4px 4px;border-radius:6px}
.dshk-sched-task:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshk-sched-tasktitle{flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px}
.dshk-sched-taskduebadge{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:1px 5px}
.dshk-sched-taskduebadge.is-overdue{color:var(--dsw-alias-danger,#cd3131);border-color:color-mix(in srgb,var(--dsw-alias-danger,#cd3131) 45%,transparent)}
.dshk-sched-emptytasks{font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:8px 0}
/* 清单范围档（近三日/近一周/全部）：一排小 chip，复用 wdchip 的形态 */
/* 统计两行（桌面同款）：总时长一行大字 + 事件/已过/未到一行小字；
   小字行 11px 在最窄 118px 卡里也放得下（「事件 12 · 已过 8 · 未到 20」约 150px，
   超宽时 nowrap 截断由卡内滚兜底） */
.dshk-sched-statsgrid{display:flex;flex-direction:column;gap:2px;margin:auto 0}
.dshk-sched-statsgrid b{font-size:15px;font-weight:600}
.dshk-sched-statrow{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshk-sched-wdchip{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer}
.dshk-sched-wdchip.is-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dshk-sched-scopes{display:flex;gap:4px;align-items:center}
/* 会话监视条（composer 上方细条，仅有动作时出现） */
.dshk-monitor-line{display:flex;align-items:center;gap:10px;padding:5px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bd6) 8%,transparent);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshk-monitor-text{flex:1;min-width:0}
.dshk-monitor-cancel{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:none;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-monitor-cancel:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
/* order:1 —— 槽位容器 display:contents，本元素与官方 ContextMeter 环同为 dock 行的
   flex item；order 提到环后面才是真正最右（DOM 里槽位贡献永远在环左边）。
   不加 padding-top：dock 行自带 4px，加了会垂直错位 2px+ */
.dshk-usage{order:1;margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:2px}
.dshk-usage-win{display:inline-flex;align-items:center;gap:2px}
.dshk-usage-win.is-hot{color:var(--dsw-alias-danger)}
.dshk-usage-sep{color:var(--dsw-alias-label-tertiary);opacity:.7}
.dshk-usage-peak{color:var(--dsw-alias-danger);font-weight:600;margin-right:4px}
/* 芯片 = 官方 ContextMeter trigger 同款（pill、hover/展开态同色） */
.dshk-usage-trigger{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:24px;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}
.dshk-usage-trigger:hover,.dshk-usage-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshk-usage-trigger.dshk-usage-hot{color:var(--dsw-alias-danger)}
.dshk-usage-trigger.dshk-usage-hot:hover,.dshk-usage-trigger.dshk-usage-hot[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
/* 面板 = 官方 ContextMeter panel 同款（定位经 primitives useAnchoredPosition，portal 到 body） */
.dshk-usage-pop{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:min(264px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:fixed}
.dshk-usage-header{align-items:center;gap:6px;display:flex}
.dshk-usage-headline{color:var(--dsw-alias-label-tertiary);min-width:0}
.dshk-usage-percent{color:var(--dsw-alias-label-primary);font-weight:500}
.dshk-usage-figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.dshk-usage-hot{color:var(--dsw-alias-danger)}
.dshk-usage-rows{margin:6px 0 0}
.dshk-usage-row{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex;margin:0}
.dshk-usage-row dt{color:var(--dsw-alias-label-secondary)}
.dshk-usage-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}
.dshk-usage-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:1px 0 0}
.dshk-usage-bar{corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:5px 0 8px;display:flex;overflow:hidden}
.dshk-usage-segment{background:var(--meter-tint,var(--dsw-alias-label-tertiary));border-radius:1px;flex:none;min-width:2px;height:100%}
.dshk-usage-segment.is-hot{--meter-tint:var(--dsw-alias-danger)}
.dshk-usage-foot{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:7px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}
.dshk-usage-link{margin-left:auto;color:var(--dsw-alias-label-secondary);text-decoration:none;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px}
.dshk-usage-link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshk-usage-refresh{appearance:none;border:.5px solid var(--dsw-alias-border-l1);background:0 0;border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-usage-refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* 内置浏览器面板：URL 栏 + 实时画面 canvas（人机共驾） */
/* 右侧标签页容器：内容视图占满（非激活标签 display:none 保挂载） */
.dshk-pane-view{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
/* 功能内容区（文件/知识库）：顶部文档签条 + 下面的内容页；签条超宽横向滚动
   （滚动条隐藏），标签多了滑过去点，不被裁掉 */
.dshk-subtabs{flex:none;display:flex;align-items:center;gap:2px;min-width:0;padding:6px 8px 4px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dshk-subtabs::-webkit-scrollbar{display:none}
/* 工具栏/地址框/提示条/空状态规格照抄官方右栏浏览器签
   （@deepseek-ai/dsh-client-ui-sidebar-browser 的 Browser.module.css：38px 工具栏、
   28px 图标钮、0.5px 分隔线、dsw 令牌与字号；哈希类名不跨包复用，仅搬规格）。
   页签条与画布（多页切换 + 人机共驾）是本插件特有，官方无对应物 */
.dshk-brw-tabrow{flex:none;display:flex;align-items:center;gap:4px;height:32px;padding:0 6px;min-width:0;overflow:hidden}
.dshk-brw-newtab{padding:0 7px;font-size:13px}
.dshk-brw-bar{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:4px;height:38px;padding:5px 6px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.dshk-brw-tool{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshk-brw-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* label-quaternary 官方有引用但本宿主主题未定义——带回退链，将来补上即自动对齐 */
.dshk-brw-tool:disabled{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary));cursor:default}
.dshk-brw-addrbox{position:relative;flex:auto;min-width:0}
.dshk-brw-url{box-sizing:border-box;width:100%;height:28px;padding:0 34px 0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dshk-brw-url:focus{outline:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
/* 「前往」贴地址框右缘，聚焦时才现形（官方 addressGo 同款） */
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
.dshk-row:hover .dshk-rowact,.dshk-chg-row:hover .dshk-rowact,.dshk-vault-treerow:hover .dshk-rowact{display:inline-flex}
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
.dshk-btn-save{appearance:none;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-radius:6px;font:inherit;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}
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
/* 分支按钮的领先/落后计数（main ↑1↓2） */
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
      return typeof window.DshRTE === "object" && window.DshRTE !== null
        ? Promise.resolve()
        : loadScript("/dsh-kit/vendor/richeditor.bundle.js");
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
    // 0.1.6 宿主多实例化：会话选择归视图所有，sessions.list 快照不再有 current；
    // 主视图会话 = retainedBy.mainView > 0 的行（与官方 ui-session publishMain
    // 同判据）。选择器必须返回稳定引用（uSES getSnapshot 约束）——返回 byId 里的
    // 行对象本身；retainedBy 是本地引用计数、不在 list 快照变更里，切会话要靠
    // 订阅当前主行的 retainInfo（旧主行归零）触发重扫。
    function mainRowOf(state) {
      const rows = Object.values(state?.byId ?? {});
      for (const row of rows) {
        if ((row?.retainedBy?.mainView ?? 0) > 0) return row;
      }
      return null;
    }
    /** 当前主视图会话 id（点击类一次性动作用：浏览器分区、文件地址等）；拿不到给空串 */
    function currentSessionId() {
      try {
        const list = sessionsSvc && typeof sessionsSvc.list?.getSnapshot === "function" ? sessionsSvc.list.getSnapshot() : null;
        return mainRowOf(list)?.id ?? "";
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

    // ─────────── 终端坞（多标签）───────────
    // TerminalPane = 一个终端会话（一条 WS/一个 pty），挂载即连接、卸载即杀；
    // TerminalDock = 底部停靠容器：头部标签条（＋ 新建 / — 隐藏），body 纵向堆叠
    // 各 pane，仅激活 pane 可见。隐藏的 pane 保持挂载：xterm 离屏继续缓冲输出，
    // 切回不丢内容（display:none 期间跳过 fit，切回由 ResizeObserver 自动补）。
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
        // 本组件只做 xterm 胶水。旧自家 WS+node-pty 引擎已随 0.1.6 适配退役。
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
          if (cleanupState) cleanupState(); // 结束宿主终端（同旧引擎「关闭即杀」）
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


    // ─────────── kit 端点公共调用 ───────────
    // 宿主端点回包约定：成功 2xx（写端点另带 ok:true），失败非 2xx + { error }。
    // 取用口径收在这一处，省得每个调用点重写一遍 json().catch() 与错误报文；
    // validate 是调用点自己的形状断言（缺项按失败处理，免得半个回包被当成功
    // 往下传）——各端点形状不同，所以断言留在调用点。
    /** GET /dsh-kit/* 取 JSON；抛出的错误带 status/body，供按状态码分流
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

    // ─────────── 文件树 ───────────
    // 数据走宿主半边只读端点 /dsh-kit/tree（官方 browse RPC 只列目录不列文件）。
    function fetchTree(path, signal) {
      return kitGetJson(`/dsh-kit/tree?path=${encodeURIComponent(path)}`, signal, (b) => Array.isArray(b.entries));
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
    /** git 单个提交详情（图谱点开行用） */
    function fetchGitShow(cwd, commit, signal) {
      return kitGetJson(
        `/dsh-kit/git/show?cwd=${encodeURIComponent(cwd)}&commit=${encodeURIComponent(commit)}`,
        signal,
        (b) => typeof b.available === "boolean",
      );
    }
    /** git 本地分支列表（{current, branches:[{name,isHead,upstream,track,trackParsed}]}） */
    function fetchGitBranch(cwd, signal) {
      return kitGetJson(`/dsh-kit/git/branch?cwd=${encodeURIComponent(cwd)}`, signal, (b) => typeof b.available === "boolean");
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
    // git 轮询间隔：每次轮询都要 spawn 一个 git 进程（实测本机 status 54–276ms、
  // log 81–110ms），4s 一拍在 SCM 视图常开时是稳定可见的后台开销。动作后的刷新
  // （stage/commit/branch 成功后各自 kick）与「可见性/焦点变化立即补一拍」不受影响，
  // 所以拉长到 8s 只影响"放着不动时的自动跟随"这一档。
  const GIT_POLL_MS = 8000;
  /** git 轮询共享时钟：状态/图谱/文件 diff 三处轮询共用一条 interval（各自挂载时
   *  订阅、卸载退订），避免同一拍上叠出多条定时器；谁在看才轮谁由各视图的挂载与
   *  可见性门控负责，这里只管节拍。全部退订后时钟自己停掉。 */
  const gitTickSubs = new Set();
  let gitTickTimer = null;
  function subscribeGitTick(fn) {
    gitTickSubs.add(fn);
    if (gitTickTimer === null) {
      gitTickTimer = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        for (const sub of [...gitTickSubs]) {
          try {
            sub();
          } catch {
            // 单个订阅异常不拖垮其它视图
          }
        }
      }, GIT_POLL_MS);
    }
    return () => {
      gitTickSubs.delete(fn);
      if (gitTickSubs.size === 0 && gitTickTimer !== null) {
        window.clearInterval(gitTickTimer);
        gitTickTimer = null;
      }
    };
  }

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

    /** 终端图标：官方 TerminalGuideIcon 同款（dsh-client-ui-sidebar-terminal 的
     *  引导条目图形，未导出，按 0.1.6-alpha.2 原样复刻两笔：深色圆角卡 + 白色提示符）。
     *  深浅主题都用硬编码配色（官方原样）——深色下白提示符仍是高对比主体 */
    function TerminalIcon(props) {
      return jsxRuntime.jsxs(
        "svg",
        {
          width: 15,
          height: 15,
          viewBox: "0 0 28 28",
          "aria-hidden": true,
          fill: "none",
          children: [
            jsxRuntime.jsx("rect", { x: "3", y: "5", width: "22", height: "19", rx: "3", fill: "#17191d" }),
            jsxRuntime.jsx("path", { d: "m8 10 4 4-4 4M15 18h5", stroke: "#fff", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }),
          ],
        },
      );
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
     *  树同款）：按扩展名出图形；
     *  primitives 不可用时回退空位（行内不留自绘图形） */
    function FileTypeIcon16({ name }) {
      const C = dswPrimIcons ? dswPrimIcons.FileTypeIcon : null;
      const kind = C && typeof dswPrimIcons.classifyFileType === "function" ? dswPrimIcons.classifyFileType(name) : null;
      return kind ? jsxRuntime.jsx(C, { kind, size: 13 }) : null;
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
      // 新建文件/目录单入口（vault 同款）：内联输入，
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

    /** 知识库面板的对话框（移动到…/导入/删除确认共用）：fixed 遮罩 + 居中卡片。
     *  关闭手势长在自己身上（Esc / 点遮罩）——与菜单同一条约定：宿主各写一份必漏。
     *  内容与按钮归调用方，这里只管壳与关闭。 */
    function VaultDialog({ title, onClose, children }) {
      react.useEffect(() => {
        const onKey = (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
      }, [onClose]);
      return jsxRuntime.jsx("div", {
        className: "dshk-vault-modalwrap",
        onMouseDown: (e) => {
          if (e.target === e.currentTarget) onClose();
        },
        children: jsxRuntime.jsxs("div", {
          className: "dshk-vault-modal",
          children: [
            jsxRuntime.jsx("div", { className: "dshk-vault-modaltitle", children: title }),
            children,
          ],
        }),
      });
    }

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
    // 发布分支（无上游，push -u），失败且无上游时给「设置上游并推送」提示；
    // 推送入口先 confirm 防误触，被远程 reject 后可 confirm 以本地为准 --force 覆盖。
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
        const unsubscribe = subscribeGitTick(tick);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          unsubscribe();
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
        };
      }, [cwd, view]);
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
              // 分支按钮（官方分支图形 + 名称；推送计数不在这里——它有自己的
              // 推送按钮，分支显示不与推送语义重叠）：点击开固定悬浮分支浮层
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
              // 同步钮（↑↓）：有上游=
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
    // 时间戳、说明、引用装饰），lane 几何由前端从父哈希计算后 SVG 绘制。
    // 行布局：图谱列 → 引用装饰 chip → 短哈希 → 说明 → 作者 → 相对时间。点提交行进详情（/dsh-kit/git/show）：作者/时间/说明/文件
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
        const unsubscribe = subscribeGitTick(tick);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          unsubscribe();
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

    /** SCM 专用 diff 签（原 FileEditorPane 瘦身）：源代码管理/提交图谱点文件在
     *  这里看差异。工作区文件的预览/编辑已退役——树与对话区点击改投官方右栏
     *  文件签。commit（可选）= 提交钉定模式（图谱提交详情进入，diff 与该提交的
     *  第一父对比）；deleted=工作区已删除（纯红展示全文）；untracked=未跟踪
     *  （整文件按新增着色，内容来自 read）。 */
    function DiffPane({ path, untracked, deleted, cwd, commit }) {
      const [state, setState] = react.useState({ phase: "loading" });
      const [diff, setDiff] = react.useState({ phase: "loading" });
      const [reloadNonce, setReloadNonce] = react.useState(0);
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
      const diffFetchRef = react.useRef(null);
      diffFetchRef.current = () => {
        const c = new AbortController();
        const commitQ = commit ? `&commit=${encodeURIComponent(commit)}` : "";
        kitGetJson(`/dsh-kit/git/diff?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? path)}${commitQ}`, c.signal, (b) => b.available === true)
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
      // diff 数据：进入时拉一次，可见期间低频静默跟随（AI 边改边看也能跟上），
      // 转回可见/聚焦立即补。commit 钉定模式的 diff 不可变（固定对某提交的
      // 第一父），拉一次即可不轮询
      react.useEffect(() => {
        if (!cwd) return undefined;
        setDiff({ phase: "loading" });
        if (diffFetchRef.current) diffFetchRef.current();
        if (commit) return undefined;
        const tick = () => {
          if (document.visibilityState !== "hidden" && diffFetchRef.current) diffFetchRef.current();
        };
        const unsubscribe = subscribeGitTick(tick);
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("focus", tick);
        return () => {
          unsubscribe();
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("focus", tick);
        };
      }, [path, cwd, commit]);

      // 内容读取：只服务于 diff 着色（常规视图的新像 = 盘上内容；未跟踪 = 整文件
      // 按新增着色）。截断（>512KB）或读失败时着色回落原始 patch，不作为错误展示。
      // 已删除文件读不到，不发请求
      react.useEffect(() => {
        if (deleted === true) return undefined;
        const controller = new AbortController();
        kitGetJson(`/dsh-kit/read?path=${encodeURIComponent(path)}`, controller.signal, (b) => typeof b.content !== "undefined")
          .then((body) => {
            if (controller.signal.aborted) return;
            setState({ phase: "ready", body });
          })
          .catch(() => {
            /* 读失败只降着色，不作为错误展示 */
          });
        return () => controller.abort();
      }, [path, reloadNonce, deleted]);

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

      // 头部只剩路径（签名由页签 chip 承担）；正文恒为 diff 视图
      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          jsxRuntime.jsx("div", {
            className: "dshk-head",
            children: jsxRuntime.jsx("span", { className: "dshk-title", children: path }),
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

    // ─────────── 入口按钮（conversation.input.left）───────────
    // 只负责开合与按压态；面板本体在 KitSurfaces（shell.overlay）渲染。
    // 选中态标记：aria-pressed 属性选择器命中 .dshk-enbtn[aria-pressed="true"]
    // 规则（底色 + 品牌色图标）。选中态底色必须用真实存在的 tool-bar-fill 令牌——
    // 不存在的变量（如 --dsw-alias-fill-l2）会解析成透明，选中态等于没有。
    function TerminalEntry(props) {
      const ui = useKitUi();
      const row = useCurrentRow(props);
      const sessionId = row?.id ?? null;
      const cwd = typeof row?.cwd === "string" ? row.cwd : null;
      const count = ui.terminals.length;
      const dockOn = ui.termDockOpen && count > 0;
      return jsxRuntime.jsxs("button", {
        type: "button",
        className: "dshk-btn dshk-enbtn",
        "aria-pressed": dockOn,
        title: count > 0 ? `${t("label")} · ${count}` : t("label"),
        onClick: () => {
          // 只开/关终端坞：隐藏不杀进程，后台会话继续跑；无会话时新建并绑定
          // 当时的当前会话（之后切换会话不影响已开终端）
          setKitUi(toggleTermDock(kitUi, sessionId, cwd));
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

    /** 知识库入口（输入行，源代码管理与终端之间）：
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
      // 字段以宿主回包为准：visible 是页面可见性，网关状态看 gatewayOn/running
      return kitGetJson("/dsh-kit/phone/info", signal, (b) => typeof b.visible === "boolean");
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
      const [info, setInfo] = react.useState(null);
      const [linkData, setLinkData] = react.useState(null);
      const [loadErr, setLoadErr] = react.useState("");
      const [activeIdx, setActiveIdx] = react.useState(0);
      const [qrReady, setQrReady] = react.useState(false);
      const [copied, setCopied] = react.useState(false);
      const [notice, setNotice] = react.useState("");
      const canvasRef = react.useRef(null);
      // 网关启停开关（POST /dsh-kit/phone/gateway；状态文件直管，不经 settings）。
      // 远程域名/端口属插件配置，编辑入口在原生设置页（0.1.7 起 Config schema 自动生成）
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

    // ─────────── 日程模块（中心区第三 tab：周时间网格 + 待办 + 统计 + 计时）───────────
    // 数据走宿主 /dsh-kit/schedule/* 端点：raw 全量 events + 区间展开 occurrences
    // （重复展开与 state 派生都在宿主做，这里只渲染）+ orphans。
    // 块颜色只表达状态（浅底深字）：还没到橙 / 进行中绿 / 已过去蓝 / 逾期红——
    // 不按标题散列取色，存量 color 字段保留但不读；已闭合计时段按已过去蓝展示。
    // 面板只读：写路径归 agent 工具（schedule_query/create/update/delete）与
    // 望舒端；计时（起停/计时段编辑）不做，数据里的段只展示不编辑。

    // 标题字数上限：与宿主 store 截断/工具描述同一口径（重要信息做标题，其余写备注）
    const SCHED_TITLE_MAX = 16;
    const SCHED_DAY_START = 0; // 网格 0:00–24:00（与鸿蒙端一致，起止时刻零裁剪）
    const SCHED_DAY_END = 24 * 60;
    const SCHED_HOUR_PX = 42;
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

    // ── 日程数据钩子（拆两半共用）：日程 pane 内待办卡与周网格各自
    // 挂载、各自轮询；面板只读无写操作，30s 轮询兜底接住 agent 工具与
    // 望舒端写进来的变化 ──
    function useScheduleData() {
      const [data, setData] = react.useState(() => ({ events: [], occurrences: [], orphans: [] }));
      // 统计口径固定周（日/月视图先不做）
      const [stats, setStats] = react.useState(null);
      const [nowTick, setNowTick] = react.useState(() => Date.now());
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
          });
        } catch {
          // 拉取失败保留旧数据，下一轮轮询再试
        }
      }, []);
      const fetchStats = react.useCallback(async () => {
        try {
          setStats(await kitJson(`/dsh-kit/schedule/stats?scope=week&date=${encodeURIComponent(schedToday())}`));
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
      react.useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
          void fetchData();
          setNowTick(Date.now());
        }, 30000);
        const minute = setInterval(() => setNowTick(Date.now()), 60000);
        return () => {
          clearInterval(timer);
          clearInterval(minute);
        };
      }, [fetchData]);
      return { data, stats, nowTick, fetchData, fetchStats };
    }

    /** 待办卡（日程 pane 顶部横条）——清单口径：
     *  行 = 逾期待办 → 有截止日待办 → 无期限待办（仅「全部」）→ 还没过去的定时
     *  事件实例（**一次一次列**，重复系列不合并）。面板只读：行只展示标题与
     *  截止/时刻，无勾选、无计时、无编辑入口。范围档：近三日/近一周/全部
     *  （滑动窗口严格层层包含，逾期永远进前两档、无期限待办只在「全部」）；
     *  行全部渲染，卡限高、多了卡内滚。 */
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
    function ScheduleTasksCard({ data }) {
      const [scope, setScope] = react.useState(schedTodoScopeSaved);
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
      return jsxRuntime.jsxs("div", { className: "dshk-sched-card is-tasks", children: [
        jsxRuntime.jsxs("div", { className: "dshk-sched-cardhead", children: [
          jsxRuntime.jsx("div", { className: "dshk-sched-cardtitle", children: `${t("schedTasks")} · ${rows.length}` }),
          // 范围档与标题同排（不占独立一行，卡更矮）
          jsxRuntime.jsx("div", { className: "dshk-sched-scopes", children: SCHED_TODO_SCOPES.map((s) =>
            jsxRuntime.jsx("button", { type: "button", className: `dshk-sched-wdchip${scope === s ? " is-active" : ""}`, onClick: () => pickScope(s), children: t(SCHED_SCOPE_KEY[s]) }, s),
          ) }),
        ] }),
        // 行全部渲染，这一层自己滚（只露两行，表头不动）
        jsxRuntime.jsx("div", { className: "dshk-sched-taskrows", children:
          rows.length === 0
            ? jsxRuntime.jsx("div", { className: "dshk-sched-emptytasks", children: t("schedTasksEmpty") })
            : rows.map((row) => {
                if (row.occ) {
                  // 定时事件实例：行右给时刻（与待办行的截止同位对齐）
                  const o = row.occ;
                  return jsxRuntime.jsxs("div", { className: "dshk-sched-task", children: [
                    jsxRuntime.jsx("span", { className: "dshk-sched-tasktitle", title: o.title, children: o.title }),
                    jsxRuntime.jsx("span", { className: "dshk-sched-taskduebadge", children: schedOccRowLabel(o, today) }),
                  ] }, row.key);
                }
                const ev = row.ev;
                const dueTxt = typeof ev.due === "string" ? ev.due.slice(5).replace("T", " ") : "";
                return jsxRuntime.jsxs("div", { className: "dshk-sched-task", children: [
                  jsxRuntime.jsx("span", { className: "dshk-sched-tasktitle", title: ev.title, children: ev.title }),
                  dueTxt
                    ? jsxRuntime.jsx("span", { className: `dshk-sched-taskduebadge${row.overdue ? " is-overdue" : ""}`, children: row.overdue ? `${t("schedOverdue")} ${dueTxt}` : dueTxt })
                    : jsxRuntime.jsx("span", { className: "dshk-sched-taskduebadge", children: t("schedNoDue") }),
                ] }, row.key);
              }),
        }),
      ] });
    }

    function ScheduleView({ active }) {
      const { data, stats, nowTick } = useScheduleData();
      const [weekStart, setWeekStart] = react.useState(() => schedMondayOf(schedToday()));
      const gridRef = react.useRef(null);

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
            segs.push({ baseId: `${ev.id}#timed${i}`, date: t.start.slice(0, 10), endDate: t.end.slice(0, 10), startMins: timerMinsOfDT(t.start), endMins: timerMinsOfDT(t.end), title: t.note || ev.title, virtual: false, isTimed: true });
          });
        }
        (Array.isArray(data.orphans) ? data.orphans : []).forEach((o, i) => {
          if (o.end === undefined) return;
          segs.push({ baseId: `orphan#timed${i}`, date: o.start.slice(0, 10), endDate: o.end.slice(0, 10), startMins: timerMinsOfDT(o.start), endMins: timerMinsOfDT(o.end), title: o.note || t("schedTimerStandalone"), virtual: false, isTimed: true });
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
      // 状态色（未完成橙 / 逾期红 / 已完成灰置底）；不在本周的落周一列
      const dateTodoOcc = react.useMemo(
        () =>
          (Array.isArray(data.events) ? data.events : [])
            .filter((e) => e.start === undefined && typeof e.due === "string" && e.due !== "" && !e.due.includes("T"))
            .map((e) => {
              const done = !!e.completedAt;
              const late = !done && schedIsOverdue(e);
              return { baseId: e.id, date: e.due, title: e.title, done, late };
            }),
        [data.events],
      );

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
          // 行定位全部显式（1 表头 / 2 全天带 / 3 时段）：全天带 chip 一旦出现，
          // 自动布局会把 timeline/日列塞进第 2 行错位——旧代码这条带从没真跑过
          jsxRuntime.jsx("div", { className: "dshk-sched-corner", style: { gridRow: 1, gridColumn: 1 } }),
          // key 必须带前缀区分：日期头与日列同用裸日期曾致同级 key 冲突——React
          // 错配复用元素，切周时旧列不卸载不断往下叠加
          ...weekDates.map((date, i) =>
            jsxRuntime.jsxs("div", { className: `dshk-sched-dayhead${date === today ? " is-today" : ""}`, style: { gridRow: 1, gridColumn: i + 2 }, children: [
              jsxRuntime.jsx("span", { className: "dshk-sched-wd", children: schedWeekdays()[i] }),
              jsxRuntime.jsx("span", { className: "dshk-sched-dnum", children: Number(date.slice(8, 10)) }),
            ] }, `hd-${date}`),
          ),
          ...dateTodoOcc.map((o) => {
            const col = weekDates.indexOf(o.date);
            const outOfWeek = col < 0;
            const zh = resolveZh();
            const hint =
              `${o.title} · ${t("schedTaskDue")} ${o.date}` +
              (o.done ? ` · ${zh ? "已完成" : "done"}` : o.late ? ` · ${t("schedOverdue")}` : "") +
              (outOfWeek ? (zh ? `（不在本周）` : " (not this week)") : "");
            return jsxRuntime.jsx(
              "div",
              {
                className: `dshk-sched-allday${o.done ? " is-done" : o.late ? " is-overdue" : ""}`,
                style: { gridRow: 2, gridColumn: outOfWeek ? 2 : col + 2 },
                title: hint,
                children: o.title,
              },
              `ad-${o.baseId}`,
            );
          }),
          jsxRuntime.jsx("div", { className: "dshk-sched-timeline", style: { gridRow: 3, gridColumn: 1 }, children: hours.map((h) =>
            jsxRuntime.jsx("div", { className: "dshk-sched-hourlabel", children: `${schedPad2(h)}:00` }, h),
          ) }, "tl"),
          ...weekDates.map((date) => {
            const inWeek = gridOcc.filter((o) => o.date === date);
            return jsxRuntime.jsxs("div", { className: "dshk-sched-daycol", "data-date": date, style: { gridRow: 3, gridColumn: weekDates.indexOf(date) + 2 }, children: [
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
                  className: `dshk-sched-event ${stateClass}${o.height >= 48 ? " is-tall" : ""}${o.thin ? " is-thin" : ""}`,
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

      // 顶部一条：待办卡（左，吃满余宽）+ 统计卡（右，固定窄列），周网格在下方吃满
      // 余高（所有坞宽一致）
      const sideCol = jsxRuntime.jsxs("div", { className: "dshk-sched-sidecol", children: [
        jsxRuntime.jsx(ScheduleTasksCard, { data }),
        stats
          ? jsxRuntime.jsxs("div", { className: "dshk-sched-card is-stats", children: [
              jsxRuntime.jsx("div", { className: "dshk-sched-cardtitle", children: t("schedStatsTitle") }),
              // 两行（桌面同款）：总时长一行大字 + 事件/已过/未到一行小字
              jsxRuntime.jsxs("div", { className: "dshk-sched-statsgrid", children: [
                jsxRuntime.jsx("b", { children: schedFmtDur(stats.totalMs) }),
                jsxRuntime.jsx("span", { className: "dshk-sched-statrow", children: `${t("schedStatsEvents")} ${stats.eventCount} · ${t("schedStatsDone")} ${stats.completedCount} · ${t("schedStatsOpen")} ${stats.openCount}` }),
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
      ] });
    }
    /** 计时段 "YYYY-MM-DDTHH:mm(:ss)" → 当日分钟数（网格块定位用） */
    function timerMinsOfDT(dt) {
      return Number(String(dt).slice(11, 13)) * 60 + Number(String(dt).slice(14, 16));
    }

    // ─────────── 内置浏览器面板（右栏浏览器签）───────────
    // 数据走宿主半边 /dsh-kit/browser WS：state/event 广播 + frame 帧流（jpeg）+
    // watch 引用计数 + open/activate/closeTab/nav/newTab（人操作）+ input（人机共驾）。
    // 分区（scope = 本 pane 所属会话 id）：页签按对话隔离，浏览器实例与 profile
    // 全局共享（登录态一份）——连接先报 scope，宿主只回本分区的 state/帧/事件，
    // 换会话即重连换分区。
    // 设计定位：面板是 agent 浏览器的「现场直播 + 遥控」——canvas 绘观察页实时
    // 画面；人的点击/滚轮/键入经画布坐标换算回传宿主，派发到观察页（人与 agent 可
    // 各看各页，画面是否跟随 agent 由宿主侧 follow 开关决定）。面板常驻挂在右侧
    // 标签页容器：WS 管帧流与共驾输入；「agent 导航自动切到浏览器标签」的事件源
    // 已升级为壳层常驻（ShellBrowserEvents），标签被收掉（0 页自动收/人为关）也能弹回。
    // 生命周期：关标签仅停流不关浏览器（分区空闲 10 分钟自动收该对话的页、全局无页
    // 无观察者时空闲关实例，登录态保留在专用 profile，重开无损）。

    // 关页签即关（无确认）：「agent 活动页」的宿主识别与实际操作页常对
    // 不上，据此弹「agent 在用」确认只会误拦；agent 被关页后按 URL 重走即可

    // 工具栏图标 = 官方浏览器签同一套 primitives（后退/前进 Chevron14、刷新
    // Refresh14、前往 Link14、外部打开 RightUp16 传 size 14）；取不到（老宿主）
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

    function BrowserPanel({ active, scope }) {
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
      // 分区（本 pane 所属会话 id）：连接按它认领分区，消息都带它——换会话时 WS 重连
      // 到新分区（effect 依赖 scope），宿主只回本分区的 state/frame/event
      const scopeRef = react.useRef(scope);
      scopeRef.current = scope;
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
          const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/dsh-kit/browser`);
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
          ws.send(JSON.stringify({ t: "watch", on: visibleRef.current === true && activeRef.current === true, scope: scopeRef.current ?? "" }));
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
      // 所有面板消息都带上本 pane 的分区（scope）：宿主按连接分区派发到该对话的观察页
      const sendInput = (obj) => {
        try {
          wsRef.current?.send(JSON.stringify({ ...obj, scope: scopeRef.current ?? "" }));
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
          wsRef.current?.send(JSON.stringify({ t: "open", url: withScheme, scope: scopeRef.current ?? "" }));
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

      // 在系统浏览器打开（官方工具栏同款）：web 端 = 你自己浏览器的新标签页，
      // 桌面壳里 = 系统浏览器。地址取观察页——没有观察页就没得开
      const openExternal = () => {
        const url = String(viewUrl ?? "").trim();
        if (url === "") return;
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {
          // 弹窗被拦：无副作用
        }
      };

      // 画面占位（官方空状态同款居中提示）：没帧可看的三种情形；断线/启动失败
      // 另走顶部提示条，不占画面（定格帧保留，重连回来自动续上）
      const start = connLost
        ? null
        : !live && state.launching === true
          ? t("browserStarting")
          : !live && viewUrl === ""
            ? t("browserNotRunning")
            : (state.pages ?? []).length === 0
              ? t("browserNoPages")
              : null;

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
          // 工具栏（规格同官方浏览器签）：后退/前进/刷新 + 地址框（「前往」聚焦才现形）
          // + 在系统浏览器中打开；都作用于观察页
          jsxRuntime.jsxs("form", {
            className: "dshk-brw-bar",
            onSubmit: (e) => {
              e.preventDefault();
              go(draft);
            },
            children: [
              jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", title: t("browserBack"), "aria-label": t("browserBack"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "back" }), children: jsxRuntime.jsx(BrwToolIcon, { name: "back" }) }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", title: t("browserForward"), "aria-label": t("browserForward"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "forward" }), children: jsxRuntime.jsx(BrwToolIcon, { name: "forward" }) }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", title: t("browserReload"), "aria-label": t("browserReload"), disabled: !live, onClick: () => sendInput({ t: "nav", op: "reload" }), children: jsxRuntime.jsx(BrwToolIcon, { name: "reload" }) }),
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
                  jsxRuntime.jsx("button", { type: "submit", className: "dshk-brw-tool dshk-brw-go", title: t("browserGo"), "aria-label": t("browserGo"), children: jsxRuntime.jsx(BrwToolIcon, { name: "go" }) }),
                ],
              }),
              jsxRuntime.jsx("button", { type: "button", className: "dshk-brw-tool", title: t("browserExternal"), "aria-label": t("browserExternal"), disabled: viewUrl === "", onClick: openExternal, children: jsxRuntime.jsx(BrwToolIcon, { name: "external" }) }),
            ],
          }),
          // 顶部提示条（官方 failure / sandboxWarning 同款）：断线取警示色、启动失败取
          // 错误色；压在画面上方，定格帧不动（重连回来自动续流）
          connLost ? jsxRuntime.jsx("div", { className: "dshk-brw-warn", role: "status", children: t("browserReconnect") }) : null,
          !connLost && !live && state.error ? jsxRuntime.jsx("div", { className: "dshk-brw-fail", role: "alert", children: state.error }) : null,
          jsxRuntime.jsx("div", {
            className: "dshk-brw-body",
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

    // ─────────── 知识库（vault：侧栏目录索引 + 右栏页编辑器，portal 拆两半）───────────
    // vault = 配置页配置的绝对目录，其内一切 md 即页面（数据契约见 src/vault.ts）。
    // 布局「选库进入阅读」：左窄条 = 空间（顶层目录）+
    // 懒加载目录树；右 = 真·所见即所得编辑区（TipTap 富文本，vendor/richeditor
    // .bundle.js 的 window.DshRTE 工厂：md ↔ 富文本往返、[[wikilink]]/公式/
    // 未知块 HTML 原样保留）。
    // 知识库 = 纯只读阅读面：目录/搜索/双链/反链/大纲导航，渲染走 vendor RTE
    // 只读态。页面本体由 agent 文件工具或外部编辑器写（文件即接口），插件没有写入
    // 端点——盘上被改（stat 轮询发现 mtime 变化）就整页静默重读。搜索走宿主
    // 全文端点（路径 8 / 文件名 5 / 正文 2）。

    /** 拆 frontmatter：返回 { fmText, rest }。fmText = "---…---" 块（含随后的
     *  首个换行）的字节级原文，无 frontmatter 时 fmText=""；rest = 其余全部。
     *  只读态 fm 不进渲染器（当属性看），也无需保存回拼 */
    function vaultSplitFrontmatter(content) {
      const src = String(content ?? "");
      const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(src);
      if (!m) return { fmText: "", rest: src };
      return { fmText: m[0], rest: src.slice(m[0].length) };
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
    // 三个都在文件树那边定义，这里不再自绘

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
    // ─────────── 用量与余额（UsageLine，composer.dock）───────────
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
     * 各家高峰时段（本地时区，仅工作日，[起,止) 分钟数）：
     *   DeepSeek 工作日 9:00–12:00、14:00–18:00；z.ai 工作日 14:00–18:00；
     *   opencode 无公开时段不标。高峰时芯片前加红色「峰」字提示限流风险。
     */
    const USAGE_PEAK_WINDOWS = {
      deepseek: [
        [540, 720],
        [840, 1080],
      ],
      zai: [[840, 1080]],
    };
    function usageIsPeak(kind, now) {
      const wins = USAGE_PEAK_WINDOWS[kind];
      if (!wins) return false;
      const day = now.getDay();
      if (day === 0 || day === 6) return false;
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

    /** UI 取消按钮：丢弃待发射 plan（失败沿已消费，不会重排） */
    function monitorCancelPlan(id) {
      const st = monitorSessions.get(id);
      if (st && st.plan) {
        st.plan = null;
        monitorRebuildItems(); // 立即重建快照并 emit
      }
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
      let cancellable = false;
      if (plan?.phase === "waiting") {
        const sec = Math.max(0, Math.ceil((plan.fireAt - now) / 1000));
        line = tf("monitorAutoIn", { err: tf("monitorRepeatErr"), sec: String(sec), n: String(loopBreaksRef.current + 1), max: String(cfg.monitorMaxAuto) });
        cancellable = true;
      } else if (plan?.phase === "stopping") {
        line = tf("monitorStopping");
      } else if (watcherItem?.phase === "waiting") {
        const sec = Math.max(0, Math.ceil((watcherItem.fireAt - now) / 1000));
        line = tf("monitorAutoIn", { err: tf("monitorErr429"), sec: String(sec), n: String(watcherItem.continues + 1), max: String(watcherItem.max) });
        cancellable = true;
      } else if (watcherItem?.phase === "capped") {
        line = tf("monitorCapped", { max: String(watcherItem.max) });
      }
      if (!line) return null;
      return jsxRuntime.jsxs("div", {
        className: "dshk-monitor-line",
        children: [
          jsxRuntime.jsx("span", { className: "dshk-monitor-text", children: line }),
          cancellable
            ? jsxRuntime.jsx("button", {
                type: "button",
                className: "dshk-monitor-cancel",
                onClick: () => (plan ? setPlan(null) : monitorCancelPlan(sessionId)),
                children: t("monitorCancel"),
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

    // ─────────── RTE 编辑面（知识库页专用，所见即所得）───────────
    // TipTap 富文本编辑器挂载 + 斜杠菜单 + 泡泡菜单 + 自动保存（2s 防抖 +
    // Ctrl+S + 卸载保底 + 冲突暂停）全部收拢在这里；落盘由 onSave(md, mode)
    // 回调承担（vault/write 带 _fm），mode ∈ auto|manual|overwrite，返回
    // 'ok'|'conflict'|'fail'。conflict 会暂停自动保存，直到父层重载
    // （docTick bump 重挂）或 overwrite 成功。
    // rteRef 直通 RTE 句柄（父层页条按钮 undo/redo/表格等照旧调用）；
    // ctlRef 暴露 { dirty, flush, flushManual, overwrite } 供切页 flush。
    /** 知识库页面渲染器（一页一个实例，挂右栏 pane 宿主）：vendor RTE 只读态
     *  （editable:false），只负责加载 / 阅读位置记忆 / wikilink 与页内链接点击 /
     *  面包屑上报 / 就绪回调（跨页锚点落位消费点）。写入半边全退役——没有斜杠
     *  菜单、泡泡菜单、自动保存与冲突条。 */
    function RteEditor({ rteRef, docKey, docTick, initialMd, labels, onReady, onWikiLink, resolveWiki, resolveSrc, onRelLink, onState }) {
      const [libsReady, setLibsReady] = react.useState(false);
      const [libsFailed, setLibsFailed] = react.useState(false);
      const rteHostRef = react.useRef(null);
      const initialMdRef = react.useRef(initialMd);
      initialMdRef.current = initialMd;
      // 父层回调 ref 镜像：编辑器实例闭包里永远读到最新
      const onReadyRef = react.useRef(onReady);
      onReadyRef.current = onReady;
      const onStateRef = react.useRef(onState);
      onStateRef.current = onState;
      const confRef = react.useRef({ onWikiLink, resolveWiki, resolveSrc, onRelLink, labels });
      confRef.current = { onWikiLink, resolveWiki, resolveSrc, onRelLink, labels };

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
        onStateRef.current?.({ crumb: crumbOf() });
      };

      react.useEffect(() => {
        ensureRteLib()
          .then(() => ensureKatex())
          .then(() => setLibsReady(true))
          .catch(() => setLibsFailed(true));
      }, []);

      // 编辑器挂载（实例写 rteRef，只读态）。docKey=归属路径；docTick 变化强制
      // 重挂（外部修改重读）。就绪即回调 onReady——跨页锚点落位在这里消费
      react.useEffect(() => {
        const host = rteHostRef.current;
        if (!libsReady || libsFailed || !host) return undefined;
        const mountedKey = docKey;
        const cf = confRef.current;
        const opts = {
          md: initialMdRef.current ?? "",
          // 只读：内容不可编辑，仍保留选区/命令能力（锚点落位、复制）
          editable: false,
          labels: cf.labels,
        };
        if (cf.onWikiLink) opts.onWikiLink = cf.onWikiLink;
        if (cf.resolveWiki) opts.resolveWiki = cf.resolveWiki;
        if (cf.resolveSrc) opts.resolveSrc = cf.resolveSrc;
        const h = window.DshRTE.create(host, opts);
        rteRef.current = h;
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
        // 只读态的选区跟随：非编辑内容上 PM 不自动吃点击选区，点哪就把选区落
        // 到哪——面包屑与「目录」的当前项高亮才有据可依
        const onClickSetSel = (e) => {
          const ed = rteRef.current?.editor;
          if (!ed || !(e.target instanceof Element) || !host.contains(e.target)) return;
          try {
            const at = ed.view.posAtCoords({ left: e.clientX, top: e.clientY });
            if (at && typeof at.pos === "number") {
              ed.commands.setTextSelection(at.pos);
              report();
            }
          } catch {
            /* 坐标落在内容外按无操作处理 */
          }
        };
        host.addEventListener("click", onClickSetSel);
        // 选区跟随上报：锚点/目录跳转（vendor scrollToPos 派 selection 事务）、
        // 点击落选区、恢复阅读位三者都会改选区——面包屑与「目录」当前项高亮靠它刷新
        const offSelection = h.onSelectionUpdate(() => report());
        // 就绪回调：跨页锚点落位（vaultPendingAnchor）在这里消费
        onReadyRef.current?.();
        return () => {
          // 阅读位置兜底记一次（隐藏容器由 recordReadPos 自行跳过）
          if (posTimer !== null) clearTimeout(posTimer);
          host.removeEventListener("scroll", onPosScroll);
          recordReadPos(mountedKey, host, posAnchor());
          host.removeEventListener("click", onClickSetSel);
          offSelection();
          h.destroy();
          rteRef.current = null;
        };
        // initialMd 取挂载瞬间的盘上内容（ref），外部修改重读（docTick）才重挂
      }, [libsReady, libsFailed, docKey, docTick]);

      // 文档内链接点击：RTE 的 Link 扩展 openOnClick:false（点了不跳），相对链接
      // 不接管就等于「点了没反应」——捕获期拦下来交父层解析成文件/页再打开
      const onLinkClick = (e) => {
        const el = e.target && typeof e.target.closest === "function" ? e.target.closest("a[href]") : null;
        if (!el) return;
        const href = el.getAttribute("href") || "";
        const cb = confRef.current.onRelLink;
        if (!isDocHref(href) || typeof cb !== "function") return;
        e.preventDefault();
        e.stopPropagation();
        cb(href, el.textContent || "");
      };
      return jsxRuntime.jsx("div", { className: "dshk-vault-editwrap", onClickCapture: onLinkClick, children:
        libsFailed
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultLibsFail") })
          : jsxRuntime.jsx("div", { className: "dshk-vault-rtehost dshk-md", ref: rteHostRef }),
      });
    }

    /** 知识库索引半边（单实例，portal 进侧栏索引宿主）：工具条/目录树/搜索 +
     *  页标签编排（打开、关闭）。页编辑器不在本组件——每开一页一个
     *  VaultPagePane 经 portal 投进右栏 pane 宿主，一页一标签（多开）。
     *  树根默认 = 库根（vaultRoot），可在任意目录行上「在此打开」（或 Ctrl+点击）
     *  换到该目录，树头 ← 回库根——这就是原来的空间/文件夹筛选框的替身。 */
    function VaultRootView() {
      const ui = useKitUi();
      const sideHost = useHostSlot(vaultSideSlot);
      const paneHost = useHostSlot(vaultPaneSlot);
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
      const [searching, setSearching] = react.useState(false);
      const [toast, setToast] = react.useState("");

      // 激活页 = 当前标签；页编辑器的全部状态住在各自的 VaultPagePane 里
      const current = ui.activeVaultPage ?? null;
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
            // 笔记树里不再单列 library 那一格——库根下它由「资料库」那一行代表
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
      // 对话框（移动到…/导入/删除确认共用一份 state）：{kind, ...}；null = 没开
      const [dialog, setDialog] = react.useState(null);
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
      const openPath = react.useCallback((path, anchor) => {
        openVaultPageAndDock(path, anchor);
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

      /** 树上 `@`：把这一页 @ 进对话输入框（页条上不再有 @）。
       *  只有点的就是当前激活页时才带选区镜像——拿别的页的选区去引用本页会张冠李戴。 */
      const citeFromTree = (pagePath) => {
        citeVaultPageToChat(pagePath, pagePath === current ? vaultSelMirror : "", (key) => flashToast(t(key)));
      };
      /** 树行 ⋯「复制绝对路径」：笔记页与资料库文件一律给盘上绝对路径（相对路径
       *  的去扩展名形态是 wikilink 键，只在页面里用得上，面板不再发） */
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
        setSearching(true);
        try {
          const body = await kitJson(`/dsh-kit/vault/search?q=${encodeURIComponent(q)}`);
          // 笔记命中来自宿主全文搜索；目录与资料库按名字匹配在本地合成（同一张表）
          if (seq === searchSeq.current) setSearchRes(vaultSearchHits(q, root, body.results ?? [], index?.folders ?? [], libItems));
        } catch (error) {
          if (seq === searchSeq.current) setToast(`${t("vaultSearchFail")} ${String(error?.message ?? error)}`);
        }
        if (seq === searchSeq.current) setSearching(false);
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
      // 开着期间挂 vaultSearchOpen，KitSurfaces 的全局 Esc 让路——Esc 只关浮层，不收页签/侧栏
      react.useEffect(() => {
        if (searchRes === null) return undefined;
        vaultSearchOpen = true;
        const onDown = (e) => {
          if (e.target instanceof Element && !e.target.closest(".dshk-vault-vsearch") && !e.target.closest(".dshk-vault-search")) setSearchRes(null);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => {
          vaultSearchOpen = false;
          document.removeEventListener("pointerdown", onDown, true);
        };
      }, [searchRes]);

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
        const row = rail === null ? null : Array.from(rail.querySelectorAll(".dshk-vault-treerow")).find((el) => el.getAttribute("title") === revealPath);
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

      const indexPages = index?.pages ?? [];
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
        let cur = lib;
        for (const seg of rel === "" ? [] : rel.split("/")) {
          cur = `${cur}/${seg}`;
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
        else if (hit.kind === "libfile") openOfficialFile(hit.path);
        else if (hit.kind === "libdir") revealLibDir(hit.path);
        else openHere(hit.path);
      };
      /** 目录行是否有可展开的后代：笔记树看索引页前缀，资料库子树看库内清单 */
      const dirHasChildren = (dirPath) => {
        const lib = libRootRef.current;
        const libRel = lib === null ? null : relUnder(lib, dirPath);
        if (libRel !== null) return libItems.some((it) => it.rel.startsWith(libRel === "" ? "" : `${libRel}/`) && it.rel !== libRel);
        const rel = root === null ? null : relUnder(root, dirPath);
        if (rel === null || rel === "") return false;
        return indexPages.some((p) => p.rel.startsWith(`${rel}/`));
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
        const patch = vaultTabsRetarget(kitUi, entry.path, res.path, entry.dir === true);
        if (patch) setKitUi(patch);
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
        const patch = vaultTabsRetarget(kitUi, d.entry.path, res.path, d.entry.dir === true);
        if (patch) setKitUi(patch);
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
        if (fails.length > 0) setToast(`${t("skOpFail")}：${fails[0]}`);
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
        const patch = vaultTabsClose(kitUi, [d.entry.path]);
        if (patch) setKitUi(patch);
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
            jsxRuntime.jsx("button", { type: "button", title: t("treeAt"), onMouseDown: (ev) => ev.preventDefault(), onClick: (ev) => { ev.stopPropagation(); citeFromTree(entry.path); }, children: "@" }),
            jsxRuntime.jsx("button", {
              type: "button",
              title: t("treeMenu"),
              onClick: (ev) => {
                ev.stopPropagation();
                openRowMenu(ev.currentTarget, { dir: entry.dir === true, name: label, path: entry.path });
              },
              children: "⋯",
            }),
          ],
        });
      /** 行内改名输入（与文件树同款交互）：Enter 提交、Esc / 失焦取消；打开时只选中
       *  主名（页与资料保留扩展名，目录选全名） */
      const renameInput = (entry, label, isDir) =>
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
            ev.currentTarget.setSelectionRange(0, !isDir && i > 0 ? i : v.length);
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
                  renamingPath === e.path ? renameInput(e, e.name, true) : jsxRuntime.jsx("span", { className: "dshk-vault-treename", children: e.name }),
                  // 行尾「新建」（悬停显形）：落点 = 这个目录
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "dshk-vault-treeplus",
                    title: t("vaultNew"),
                    onMouseDown: (ev) => ev.preventDefault(),
                    onClick: (ev) => {
                      ev.stopPropagation();
                      startCreate(e.path);
                    },
                    children: "+",
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
              if (lib) openOfficialFile(e.path);
              else openPath(e.path);
            },
            title: e.path,
            children: [
              jsxRuntime.jsx(FileTypeIcon16, { name: e.name }),
              renamingPath === e.path ? renameInput(e, label, false) : jsxRuntime.jsx("span", { className: "dshk-vault-treename", children: label }),
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
      // 工具条一行：搜索框占满 + 刷新收尾（换根改在树上 Ctrl+点击目录行，树头 ← 回库根，
      // 前进后退已随访问序退役）
      const sideContent = jsxRuntime.jsxs("div", { className: "dshk-vault-sidewrap", children: [
        jsxRuntime.jsxs("div", { className: "dshk-vault-toolbar", children: [
          jsxRuntime.jsxs("div", { className: "dshk-vault-tbarrow", children: [
            jsxRuntime.jsx("input", {
              ref: searchRef,
              className: "dshk-vault-search",
              value: searchQ,
              placeholder: t("vaultSearchPh"),
              spellCheck: false,
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
                  // 全局 Esc 已挂 vaultSearchOpen 让路：这里只关浮层
                  e.preventDefault();
                  setSearchRes(null);
                }
              },
            }),
            jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", "aria-label": t("vaultRefresh"), title: t("vaultRefresh"), disabled: refreshing, onClick: () => void manualRefresh(), children: jsxRuntime.jsx(OfficialIcon, { names: ["IconRefreshOutline16", "IconRefreshOutline14"], glyph: "↻" }) }),
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
              : jsxRuntime.jsx("button", { type: "button", className: "dshk-sched-navbtn", "aria-label": t("vaultBackRoot"), title: t("vaultBackRoot"), onClick: () => setRootHere(null), children: jsxRuntime.jsx(OfficialIcon, { names: ["IconChevronLeftOutline14"], glyph: "←" }) }),
            jsxRuntime.jsx("span", {
              className: "dshk-vault-railtitle",
              title: treeRoot ?? "",
              children: rootHere === null ? t("vaultTitle") : relUnder(root, rootHere) || rootHere,
            }),
            jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-vault-treeplus",
              title: t("vaultNew"),
              onClick: () => treeRoot !== null && startCreate(treeRoot),
              children: "+",
            }),
            jsxRuntime.jsx("button", {
              type: "button",
              className: "dshk-vault-treeplus",
              title: t("treeMenu"),
              onClick: (ev) => openHeadMenu(ev.currentTarget),
              children: "⋯",
            }),
          ] }),
          createAt === treeRoot ? createRow() : null,
          libRow(),
          renderDir(treeRoot, 0),
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

      // 页签半边：每开一页一个 pane（非激活 display:none 保持挂载——切回不丢
      // 滚动位置），一页都没开时是「去索引挑一页」的空态
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
                onIndexRefresh: () => void loadIndex(),
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

    /** 知识库单页阅读视图（一页一个实例，挂右栏 pane 宿主）：正文加载/外部修改
     *  静默跟随/阅读条（目录・反链・面包屑）都在这一层。没有写入——盘上变了
     *  整页静默重读（页面由 agent 文件工具或外部编辑器维护，文件即接口）。active=false
     *  的 pane 仍挂载（保住滚动位置与页签），只停掉 stat 轮询。 */
    function VaultPagePane({ path, active, root, indexPages, onOpenPage, onIndexRefresh, toast }) {
      // page: { loading, body(渲染入参), binary, gone }——frontmatter 拆掉不进渲染器
      const [page, setPage] = react.useState(null);
      // RTE 重挂载 tick：首次加载/外部修改重读时 bump
      const [docTick, setDocTick] = react.useState(0);
      // 阅读条：面包屑 + 页面级下拉（目录/反链，同时至多开一个）
      const [crumb, setCrumb] = react.useState("");
      const [barMenu, setBarMenu] = react.useState(null); // "toc" | "bl" | null
      const barMenuAnchorRef = react.useRef(null);
      const rteRef = react.useRef(null);
      const mtimeRef = react.useRef(0);
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

      // 拉本页内容（首次加载/外部修改共用）：拆掉 frontmatter（只读态当属性看，
      // 不进渲染器），docTick bump 驱动重挂载对齐盘上内容
      const loadCurrent = react.useCallback(async () => {
        try {
          const body = await kitJson(`/dsh-kit/read?path=${encodeURIComponent(path)}`);
          const raw = body.binary ? "" : (body.content ?? "");
          const { rest } = body.binary ? { rest: "" } : vaultSplitFrontmatter(raw);
          mtimeRef.current = body.mtimeMs ?? 0;
          setPage({ loading: false, body: rest.trimStart(), binary: body.binary === true, gone: false });
          setDocTick((t) => t + 1);
        } catch {
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

      // 外部修改实时刷新：只轮询激活页（后台标签别白烧请求）。盘上变了 → 静默
      // 重读整页 + 刷索引（agent/外部编辑器改文件零手动刷新）；文件被外部删除也重读 →
      // 显示已消失。fetch 失败静默（尽力而为）。只读没有本地脏改，无需守卫
      react.useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => {
          if (document.visibilityState === "hidden") return;
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
          document.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("keydown", onKey, true);
        };
      }, [barMenu]);

      const barRect = barMenu !== null && barMenuAnchorRef.current !== null ? barMenuAnchorRef.current.getBoundingClientRect() : null;
      const outline = barMenu === "toc" ? outlineAt() : null;
      return jsxRuntime.jsxs("div", { className: "dshk-vault-reader", style: { display: active ? "flex" : "none" }, ref: paneRef, children: [
        !page || page.loading === true
          ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("contentLoading") })
          : page.gone === true
            ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultPageGone") })
            : page.binary === true
              ? jsxRuntime.jsx("div", { className: "dshk-vault-hint", children: t("vaultBinaryHint") })
              : jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                  jsxRuntime.jsxs("div", { className: "dshk-vault-editbar", children: [
                    // 阅读条 sticky：长文滚到哪儿都够得到——目录/反链是页面级入口
                    // （「谁提到这一页」「本文有什么小节」），吊在页尾的老反链区
                    // 就是够不到才撤掉的。空了按钮留原位置灰，别忽长忽短
                    jsxRuntime.jsx("button", {
                      type: "button",
                      className: `dshk-vault-tbtn${outline !== null && outline.items.length === 0 ? " is-empty" : ""}`,
                      title: outline !== null && outline.items.length === 0 ? t("vaultTocEmpty") : t("vaultToc"),
                      onClick: (e) => openBarMenu("toc", e),
                      children: t("vaultToc"),
                    }),
                    // 光标所属标题链（面包屑，二级归属最近一级）：
                    // 占满余宽、超长省略，title 给全文；无标题覆盖时隐藏
                    crumb === "" ? null : jsxRuntime.jsx("span", { className: "dshk-vault-crumb", title: crumb, children: crumb }),
                    jsxRuntime.jsx("button", {
                      type: "button",
                      className: `dshk-vault-tbtn dshk-vault-tbpush${backlinks.length === 0 ? " is-empty" : ""}`,
                      title: backlinks.length === 0 ? t("vaultBlEmpty") : t("vaultBacklinks"),
                      onClick: (e) => openBarMenu("bl", e),
                      children: `${t("vaultBacklinks")}${backlinks.length > 0 ? ` ${backlinks.length}` : ""}`,
                    }),
                  ] }),
                  jsxRuntime.jsx(RteEditor, {
                    rteRef,
                    docKey: path,
                    docTick,
                    initialMd: page.body ?? "",
                    labels: { codeCopy: t("vaultCopy"), codeCopied: t("vaultCopied") },
                    onReady: onRteReady,
                    onWikiLink: (target, anchor) => {
                      if (target === "") {
                        if (anchor !== "") scrollAnchorRte(anchor);
                        return;
                      }
                      const pages = pagesRef.current ?? [];
                      const ownerSpace = pages.find((p) => p.path === path)?.space ?? "";
                      const resolved = resolveVaultLink(pages, target, ownerSpace);
                      if (resolved) onOpenPage(resolved.path, anchor);
                      else toast(t("vaultPageGone"));
                    },
                    resolveWiki: (target) => resolveVaultLink(pagesRef.current ?? [], target) !== null,
                    resolveSrc: (src) => {
                      if (/^(https?:|data:)/i.test(src)) return src;
                      const pageDir = () => path.split(/[\\/]/).slice(0, -1).join("\\");
                      const abs = /^attachments\//i.test(src) ? `${root}/${src}` : `${pageDir()}/${src}`;
                      return `http://${location.host}/dsh-kit/raw?path=${encodeURIComponent(abs)}`;
                    },
                    // 相对/站内链接解析到库内 md 页 → 按页打开（库外或非 md 不接管，
                    // 别把只读阅读的语义混进工作区文件）
                    onRelLink: (href) => {
                      const target = resolveMdLink(path, root, href);
                      if (target && /\.md$/i.test(target) && isPathInsideVaultRoot(root, target)) onOpenPage(target);
                    },
                    onState: (s) => {
                      setCrumb(typeof s.crumb === "string" ? s.crumb : "");
                    },
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
                                        onOpenPage(p.path);
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
    // 官方 pane 是普通文档流：外壳 .dshk-rbpane 占满 100%×100%，内容区自己滚。
    // pane 挂载 = 官方签开着：把 kitUi 的功能存在性同步为真（入口按钮选中态、
    // 角标、自动跟随判定都读它）；pane 卸载（用户点官方签 ✕）同步回假——
    // 「签开着吗」以官方 pane 的挂载为准。文件/知识库的文档签状态（files/
    // vaultPages）在卸载后保留，重开签即恢复，与关签前一致。
    /** 功能存在性跟随 pane 挂载（schedule/browser/vault 用） */
    function useFeaturePresence(feature) {
      react.useEffect(() => {
        setKitUi(openFeatureTab(kitUi, feature));
        return () => setKitUi(closeFeatureTab(kitUi, feature));
      }, [feature]);
    }
    /** diff pane：文档签条 + 多实例 DiffPane（非激活 display:none 保挂载——
     *  滚动位置不丢）。只承载源代码管理/提交图谱点开的 diff；工作区文件的
     *  预览/编辑已改投官方右栏文件签。不做存在性同步：files 状态本来就在
     *  kitUi，官方签关了重开，文档签原样恢复。最后一页 diff 签关掉 → 官方
     *  「文件」dock 签一起关（同浏览器「没了就没了」，没有空页状态） */
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
                children: jsxRuntime.jsx(DiffPane, {
                  key: pv.path,
                  path: pv.path,
                  untracked: pv.untracked === true,
                  deleted: pv.deleted === true,
                  commit: pv.commit,
                  cwd,
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
      // 最后一页关掉 → 官方「知识库」dock 签一起关（同文件
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
    /** 日程 pane：ScheduleView（pane 内上待办 + 下网格） */
    function SchedulePaneBody() {
      useFeaturePresence("schedule");
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children: jsxRuntime.jsx(ScheduleView, { active: true }) });
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
                  x.phase === "waiting"
                    ? jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dshk-monitor-cancel",
                        onClick: () => monitorCancelPlan(x.id),
                        children: t("monitorCancel"),
                      })
                    : null,
                ] }, x.id);
              }),
            })
          : null,
      ] });
    }
    /** 浏览器 pane（agent 驱动 + 人机共驾 + 自动跟随；与独立面板同构，不加功能）。
     *  分区 = 本 pane 所属会话 id——页签按对话隔离，同一浏览器实例/profile 共享登录态 */
    function BrowserPaneBody(props) {
      useFeaturePresence("browser");
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      const scope = useCurrentRow(props)?.id ?? "";
      return jsxRuntime.jsx("div", { className: "dshk-rbpane", children:
        cfg.browserEnabled === false
          ? jsxRuntime.jsx("div", { className: "dshk-note", children: t("rbFeatureDisabled") })
          : jsxRuntime.jsx(BrowserPanel, { active: true, scope }),
      });
    }
    // ─────────── 面板宿主（shell.overlay 全帧浮层）───────────
    // 终端停靠在这里渲染（fixed 定位不受 composer 祖先
    // stacking context 影响）；知识库单实例挂载、文件树/索引的 sidebar.workspaces
    // 动态注册、几何 RO、快捷键监听全部挂在这个常驻根组件里。
    function KitSurfaces(props) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const sessionRow = useCurrentRow(props);
      const cwd = typeof sessionRow?.cwd === "string" && sessionRow.cwd.trim() !== "" ? sessionRow.cwd : null;
      const sessionId = sessionRow?.id ?? null;
      const ui = useKitUi();
      const snap = react.useSyncExternalStore(subscribeCfg, getCfgSnapshot);
      const cfg = cfgFromSnapshot(snap);
      // useSessions 透传给右栏 pane（浏览器 pane 定位当前会话用）：inject 闭包
      // 从这里取最新值（槽位注册发生在 effect，渲染期的 props 用模块变量桥接）
      shellShare.current = props;
      // 对话文件点击的知识库路由状态：当前会话 cwd 与知识库开关每次渲染同步，
      // 供模块级 capture 拦截器读取（vault 关闭时拦截器完全不介入）
      chatPreviewHook = {
        cwd,
        vaultOn: cfg.vaultEnabled !== false,
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

      // 座位门控：按配置动态注册/注销输入框入口与技能页（配置页
      // 本体不受门控，否则关掉就再也打不开）。快照未就绪按默认全开处理，首个
      // ready 快照到达后本效果自动重跑纠正。
      react.useEffect(() => {
        if (!slotsCtx) return undefined;
        const handles = [];
        const want = [
          // 会话监视条：composer 上方环境条（官方 StatsLine order 0，排其后）
          ["monitor", cfg.monitorEnabled, () =>
            slotsCtx.slots.register(
              { name: "conversation.composer.dock", id: "dsh-kit-monitor", order: 5 },
              MonitorLine,
            )],
          // 429 后台会话状态条：会话头部动作区，排官方后台任务清单（order 20）之后；
          // 仅当后台会话有待续跑/封顶时自渲染（组件内自门控，零常驻）
          ["monitorBg", cfg.monitorEnabled, () =>
            slotsCtx.slots.register(
              { name: "conversation.session.header.actions", id: "dsh-kit-monitor-bg", order: 21 },
              MonitorBgAction,
            )],
          // 余额与用量芯片：同一条状态带，排监视条之后
          ["usage", cfg.usageEnabled, () =>
            slotsCtx.slots.register(
              { name: "conversation.composer.dock", id: "dsh-kit-usage", order: 6 },
              UsageLine,
            )],
          // 输入框入口排序（左→右）：文件树、源代码管理、知识库、终端
          // 手机访问与技能页同类，走 settings.section 页面入口（order：技能 40 → 手机 45）
          ["filetree", cfg.fileTreeEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-filetree", order: 10 }, FileTreeEntry)],
          ["scm", cfg.sourceControlEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-scm", order: 11 }, ScmEntry)],
          ["vault", cfg.vaultEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-vault", order: 12 }, VaultEntry)],
          ["terminal", cfg.terminalEnabled, () =>
            slotsCtx.slots.register({ name: "conversation.input.left", id: "dsh-kit-terminal", order: 14 }, TerminalEntry)],
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

      // 配置关闭但视图还开着（如原生配置页保存、entry 重启前的瞬间）：立即归位，文件随来源跟随清掉；
      // 终端功能关闭 = 结束全部终端会话（连 WS 杀 pty，与单终端时代语义一致）
      react.useEffect(() => {
        if (!cfg.terminalEnabled && (ui.termDockOpen || ui.terminals.length > 0)) {
          setKitUi({ terminals: [], activeTermId: null, termDockOpen: false });
        }
        if (!cfg.fileTreeEnabled && ui.treeOpen) setKitUi({ treeOpen: false, files: [], activeFile: null });
        if (!cfg.sourceControlEnabled && ui.gitOpen) setKitUi({ gitOpen: false, files: [], activeFile: null });
        // 配置门控清场走 closeFeatureTab：清存在性的同时把激活位顺延到剩余标签
        if (!cfg.browserEnabled && ui.browserOpen) setKitUi(closeFeatureTab(kitUi, "browser"));
        if (!cfg.vaultEnabled && (ui.vaultOpen || ui.vaultIdxOpen)) {
          setKitUi({ ...closeFeatureTab(kitUi, "vault"), vaultIdxOpen: false });
        }
      }, [cfg.terminalEnabled, cfg.fileTreeEnabled, cfg.sourceControlEnabled, cfg.browserEnabled, cfg.vaultEnabled]);

      // 侧边栏浏览区占用：单槽轮换——源代码管理 ↔ 文件树 ↔ 知识库
      // 目录，全关回官方会话列表。
      // 动态注册若在运行时抛错，捕获并回滚开合状态，避免入口被错误边界摘掉。
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
              return jsxRuntime.jsx(FileTreePanel, { cwd, onOpenFile: (p) => openTreeFile(p), ...owner });
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

      // 隐藏官方右栏「工作区文件」入口（hideOfficialFilesEntry）：那只是个目录
      // 按钮，与文件树功能重复。body 标记 + CSS display:none，锚点
      // data-sidebar-right-guide-entry 是官方胶囊的稳定属性（旧置灰方案同款）
      react.useEffect(() => {
        document.body.classList.toggle("dshk-hide-official-files", cfg.hideOfficialFilesEntry === true);
        document.body.classList.toggle("dshk-hide-official-browser", cfg.hideOfficialBrowserEntry === true);
        return () => {
          document.body.classList.remove("dshk-hide-official-files");
          document.body.classList.remove("dshk-hide-official-browser");
        };
      }, [cfg.hideOfficialFilesEntry, cfg.hideOfficialBrowserEntry]);

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
      // 拦截避免页面其它快捷键抢先），对应功能关闭时不响应。
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
          if (inlineEditCapture) return;
          if (termCombo && cfg.terminalEnabled && comboMatches(e, termCombo)) {
            e.preventDefault();
            e.stopPropagation();
            // 与入口按钮同语义：只开/关坞（隐藏不杀进程）；无会话时新建绑定当前会话
            setKitUi(toggleTermDock(kitUi, sessionId, cwd));
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
            // 或宿主无此能力（0.1.2）时静默。这个位给右栏开合（日程无左侧栏半边，
            // 不需要全局键）
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
            // 知识库搜索浮层开着时让路：Esc 归它自己（只关自己，不收标签页）
            if (vaultSearchOpen) return;
            // Esc 关当前激活那张文档签（知识库关当前页那张、diff 关当前
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
      // agent 操作浏览器必须可见）；浏览器收摊 → 顺手收掉标签。两者兼得：正常浏览器的
      // 「没了就没了」+ agent 干活时画面自动回眼前。
      // 分区 = 当前会话：连接先报 scope（宿主只回本会话的 navigated），换会话即重连；
      // 0 页收签只在「曾经有页又变 0」时触发——本会话刚开面板（页还没建）不该被收掉。
      react.useEffect(() => {
        if (cfg.browserEnabled === false) return undefined;
        let disposed = false;
        let retry = null;
        let ws = null;
        let hadPages = false;
        const connect = () => {
          ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/dsh-kit/browser`);
          ws.onopen = () => {
            if (disposed) return;
            try {
              ws.send(JSON.stringify({ t: "scope", scope: sessionId ?? "" }));
            } catch {
              // 已断
            }
          };
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
              else if (msg.kind === "closed") {
                hadPages = false;
                closeBrowserDockForGone();
              }
              return;
            }
            if (msg.t === "state" && msg.launching !== true && msg.running === true) {
              // 页崩光残留（running 但 0 页）= 浏览器实质没了，收掉标签。
              // running:false 不作依据——快照无历史，启动失败也会落到这个形状，
              // 收掉标签会让用户连错误线索都看不到；「曾活着→没了」由 closed 事件负责。
              // 本会话刚开、页还没建（hadPages 为假）时不动它
              if ((msg.pages ?? []).length > 0) hadPages = true;
              else if (hadPages) {
                hadPages = false;
                closeBrowserDockForGone();
              }
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
      }, [cfg.browserEnabled, sessionId]);

      return jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
          cfg.terminalEnabled && ui.terminals.length > 0
            ? jsxRuntime.jsx(TerminalDock, {
                open: ui.termDockOpen,
                cwd,
                onSpawn: () => {
                  if (!sessionId) {
                    flashToast(t("noCwd"));
                    return;
                  }
                  setKitUi(spawnTerm(kitUi, sessionId, cwd));
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
      return kitGetJson(`/dsh-kit/skills${query}`, signal, (b) => Array.isArray(b.groups));
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
        kitGetJson(`/dsh-kit/read?path=${encodeURIComponent(file)}`, controller.signal)
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
              // 版本号（技能 frontmatter 的 version，自有约定）：池里的参考技能与个人
              // 副本靠它对照「抄的是哪版」
              typeof skill.version === "string" && skill.version !== ""
                ? jsxRuntime.jsx("span", { className: "dshk-sk-badge", title: t("skVersionTip"), children: `v${skill.version}` })
                : null,
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

    // ─────────── 官方右侧边栏注册（宿主 0.1.5+）───────────
    // 四个功能各注册一张 dock 页类型（id=正文槽 key，kind=openTab 类型名）+
    // pane 正文。开始页归官方 ShippedGuide（罗盘 + 胶囊条目，条目按 order 升序）：
    // 我们只贡献 guide 条目（RB_GUIDE：日程→浏览器），order 取 100+ 垫在
    // 全部官方条目之后（官方现值：工作区文件 10 / 新建终端 20 / 浏览器模式 30）；
    // 文件/知识库是被动签，不给条目——入口在左侧边栏。
    // 后台任务不做签（0.1.7 官方会话头部自带任务清单 + 实时输出 + 停止）。
    // 服务运行期探测（见 RB_FEATURES 处注释）。
    const RB_BODY = {
      file: FilePaneBody,
      vault: VaultPaneBody,
      schedule: SchedulePaneBody,
      browser: BrowserPaneBody,
    };
    function registerRightbar(rbCtx) {
      const tabs = rbCtx.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      const RB_GUIDE = {
        schedule: { order: 100, icon: SchedIcon, descKey: "rbGuideSchedDesc" },
        browser: { order: 110, icon: BrowserIcon, descKey: "rbGuideBrowserDesc" },
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
          // cwd（浏览器 pane 定位当前会话）经 shellShare 桥接（pane 注册发生在 effect，
          // 渲染期的 props 由 KitSurfaces 的常驻桥供最新值）
          inject: () => ({
            useSessions: shellShare.current?.useSessions,
          }),
        }, Body)), `dsh-kit: rightbar pane body ${f.kind}`);
      }
      // 探测落地：入口走右栏（rightbarStore 的订阅者据此重渲染）
      rightbarStore.setActive(true);
    }

    // ─────────── 配置页（0.1.7 plugins.row.config）───────────
    // 插件页（侧栏「插件」）dsh-kit 行的「配置」控件进这里：页面宿主按
    // rowId（=entry id「dsh-kit」）绑定宿主命名空间，经 props.form 给已受理值
    // （form.state）与原子写回（form.mutate）。字段清单与 src/index.ts 的 Config
    // schema 同源（render-check 钉住）。草稿本地自持，只有「保存」才写入——
    // 离开页面即丢，符合页面宿主「离开丢弃暂存」的约定；保存成功后 entry
    // 由宿主重启，开关类改动即时生效。
    const KIT_CFG_FIELDS = [
      { key: "terminalEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgTerminalEnabled" },
      { key: "fileTreeEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgFileTreeEnabled" },
      { key: "sourceControlEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgSourceControlEnabled" },
      { key: "skillsPageEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgSkillsPageEnabled" },
      { key: "searchEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgSearchEnabled" },
      { key: "searchMaxResults", type: "number", min: 1, max: 8, group: "kcfgGroupFeatures", labelKey: "kcfgSearchMaxResults" },
      { key: "browserEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgBrowserEnabled" },
      { key: "chatOpenLinkInBrowser", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgChatOpenLinkInBrowser" },
      { key: "hideOfficialFilesEntry", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgHideOfficialFilesEntry" },
      { key: "hideOfficialBrowserEntry", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgHideOfficialBrowserEntry" },
      { key: "usageEnabled", type: "bool", group: "kcfgGroupFeatures", labelKey: "kcfgUsageEnabled" },
      { key: "monitorEnabled", type: "bool", group: "kcfgGroupMonitor", labelKey: "kcfgMonitorEnabled" },
      { key: "monitorWaitMs", type: "number", min: 5000, max: 600000, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorWaitMs" },
      { key: "monitorMaxAuto", type: "number", min: 1, max: 10, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorMaxAuto" },
      { key: "monitorRepeatThreshold", type: "number", min: 2, max: 10, group: "kcfgGroupMonitor", labelKey: "kcfgMonitorRepeatThreshold" },
      { key: "notifyEnabled", type: "bool", group: "kcfgGroupMonitor", labelKey: "kcfgNotifyEnabled" },
      { key: "phoneEnabled", type: "bool", group: "kcfgGroupPhone", labelKey: "kcfgPhoneEnabled" },
      { key: "phonePort", type: "number", min: 1, max: 65535, group: "kcfgGroupPhone", labelKey: "kcfgPhonePort" },
      { key: "phoneRemoteDomain", type: "string", group: "kcfgGroupPhone", labelKey: "kcfgPhoneRemoteDomain" },
      { key: "phoneKeepGatewayOn", type: "bool", group: "kcfgGroupPhone", labelKey: "kcfgPhoneKeepGatewayOn" },
      { key: "vaultEnabled", type: "bool", group: "kcfgGroupVault", labelKey: "kcfgVaultEnabled" },
      { key: "vaultRoot", type: "string", group: "kcfgGroupVault", labelKey: "kcfgVaultRoot" },
      { key: "sidebarShortcut", type: "string", group: "kcfgGroupShortcuts", labelKey: "kcfgSidebarShortcut" },
      { key: "rightbarShortcut", type: "string", group: "kcfgGroupShortcuts", labelKey: "kcfgRightbarShortcut" },
      { key: "terminalShortcut", type: "string", group: "kcfgGroupShortcuts", labelKey: "kcfgTerminalShortcut" },
      { key: "fileTreeShortcut", type: "string", group: "kcfgGroupShortcuts", labelKey: "kcfgFileTreeShortcut" },
      { key: "scShortcut", type: "string", group: "kcfgGroupShortcuts", labelKey: "kcfgScShortcut" },
      { key: "vaultShortcut", type: "string", group: "kcfgGroupShortcuts", labelKey: "kcfgVaultShortcut" },
    ];
    /** KIT_CFG_FIELDS 的分组顺序（组名键也用于 t() 取组标题） */
    const KIT_CFG_GROUPS = ["kcfgGroupFeatures", "kcfgGroupMonitor", "kcfgGroupPhone", "kcfgGroupVault", "kcfgGroupShortcuts"];
    /** 两个值是否 JSON 意义上不同（数字统一比较，避免 "3" 与 3 抖动） */
    function kitCfgDiffers(a, b) {
      if (a === b) return false;
      if (typeof a === "number" && typeof b === "number") return a !== b;
      return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    }
    /**
     * dsh-kit 行配置页。props = { view, form }：view "summary" 返回 null（行描述
     * 已有）；form 缺席/loading/unavailable 时给一行说明。ready 时按
     * KIT_CFG_FIELDS 分组渲染草稿表单，「保存」把差异字段一次 mutate 写回
     * （带读取时的 revision 做围栏），「放弃修改」丢草稿。
     */
    function KitConfigPage(props) {
      react.useSyncExternalStore(subscribeLocale, getLocaleVersion); // 跟随 DSH 语言切换重绘
      const view = props && props.view;
      const form = props && props.form;
      const snap = form ? form.state : null;
      const [draft, setDraft] = react.useState(null); // 仅存改动过的字段
      const [saving, setSaving] = react.useState(false);
      // 命名空间换版（保存成功/别处改动）且无未保存草稿时不需要动作——快照
      // 由页面宿主随渲染下发，draft 只按字段覆盖，不整包重置
      if (view === "summary") return null;
      if (!form || !snap || snap.status !== "ready" || snap.value == null || typeof snap.value !== "object") {
        const msg = snap && snap.status === "unavailable" ? t("kcfgUnavailable") : t("kcfgLoading");
        return jsxRuntime.jsx("div", { className: "dshk-cfgp", children:
          jsxRuntime.jsx("div", { className: "dshk-note", children: msg }) });
      }
      const base = snap.value;
      const setField = (key, value) => {
        setDraft((prev) => {
          const next = { ...(prev ?? {}) };
          // 改回与受理值一致 = 撤销该字段的草稿（不是记一个同值覆盖）
          if (!kitCfgDiffers(value, base[key])) delete next[key];
          else next[key] = value;
          return Object.keys(next).length > 0 ? next : null;
        });
      };
      const dirtyCount = draft ? Object.keys(draft).length : 0;
      const writable = snap.writable !== false;
      const save = async () => {
        if (!draft || dirtyCount === 0 || !writable || saving) return;
        setSaving(true);
        try {
          const ops = KIT_CFG_FIELDS
            .filter((f) => Object.prototype.hasOwnProperty.call(draft, f.key))
            .map((f) => ({ op: "set", path: [f.key], value: draft[f.key] }));
          const ok = await form.mutate(ops, snap.revision);
          if (ok) {
            setDraft(null);
            // volatile 热提交即时生效：重拉快照喂门控（值同源 readSettings，已解引用）
            try {
              const body = await kitJson("/dsh-kit/config");
              if (body && typeof body === "object") applyConfigSnapshot(body);
            } catch {
              // 重拉失败不动快照：下次页面刷新自然取到
            }
            flashToast(t("kcfgSaved"));
          } else {
            flashToast(tf("kcfgSaveFail", { error: "rejected" }));
          }
        } catch (error) {
          flashToast(tf("kcfgSaveFail", { error: String(error?.message ?? error) }));
        } finally {
          setSaving(false);
        }
      };
      const controlOf = (f) => {
        const cur = draft && Object.prototype.hasOwnProperty.call(draft, f.key) ? draft[f.key] : base[f.key];
        if (f.type === "bool") {
          return jsxRuntime.jsx("input", {
            type: "checkbox",
            checked: cur === true,
            disabled: !writable || saving,
            onChange: (e) => setField(f.key, e.currentTarget.checked),
          });
        }
        if (f.type === "number") {
          return jsxRuntime.jsx("input", {
            type: "number",
            value: typeof cur === "number" ? String(cur) : "",
            min: f.min,
            max: f.max,
            step: 1,
            disabled: !writable || saving,
            onChange: (e) => {
              const raw = e.currentTarget.value;
              if (raw === "") { setField(f.key, null); return; } // 清空 = 暂记 null，保存时被 schema 拒绝比静默改值好
              const n = Number(raw);
              if (Number.isFinite(n)) setField(f.key, Math.trunc(n));
            },
          });
        }
        return jsxRuntime.jsx("input", {
          type: "text",
          value: typeof cur === "string" ? cur : "",
          disabled: !writable || saving,
          onChange: (e) => setField(f.key, e.currentTarget.value),
        });
      };
      const groups = KIT_CFG_GROUPS.map((g) => ({
        title: t(g),
        fields: KIT_CFG_FIELDS.filter((f) => f.group === g),
      })).filter((g) => g.fields.length > 0);
      return jsxRuntime.jsxs("div", { className: "dshk-cfgp", children: [
        groups.map((g) => jsxRuntime.jsxs("div", { className: "dshk-cfgp-group", children: [
          jsxRuntime.jsx("h4", { className: "dshk-cfgp-grouptitle", children: g.title }),
          g.fields.map((f) => jsxRuntime.jsxs("div", { className: "dshk-cfgp-row", children: [
            jsxRuntime.jsx("span", { className: "dshk-cfgp-label", children: t(f.labelKey) }),
            jsxRuntime.jsx("span", { className: "dshk-cfgp-ctl", children: controlOf(f) }),
          ] }, f.key)),
        ] }, g.title)),
        jsxRuntime.jsxs("div", { className: "dshk-cfgp-actions", children: [
          !writable ? jsxRuntime.jsx("span", { className: "dshk-cfgp-hint", children: t("kcfgReadonly") }) : null,
          jsxRuntime.jsx("button", {
            type: "button",
            className: "dshk-cfgp-btn",
            disabled: !writable || saving || dirtyCount === 0,
            onClick: () => setDraft(null),
            children: t("kcfgDiscard"),
          }),
          jsxRuntime.jsx("button", {
            type: "button",
            className: "dshk-cfgp-btn dshk-cfgp-btn-primary",
            disabled: !writable || saving || dirtyCount === 0,
            onClick: save,
            children: saving ? "…" : t("kcfgSave"),
          }),
        ] }),
      ] });
    }

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      slotsCtx = ctx;
      // 配置页（0.1.7）：挂进插件页的 plugins.row.config 槽，key 由页面宿主按
      // <包名>#<行id> 匹配（本插件单行，行 id = dsh-kit）。命名空间未伺服时页面
      // 宿主不传 form，组件自带降级文案；注册随本 entry 生命周期生灭。
      ctx.slots.inject("plugins.row.config", () => ctx.slots.register(
        { name: "plugins.row.config", key: "dsh-kit#dsh-kit" },
        KitConfigPage,
      ));
      // 用量芯片的「当前会话模型 provider」数据源（composer 模型座同一份状态）。
      // 服务缺位（老宿主/精简组合）= 芯片不显示，其余功能不受影响
      ctx.inject(["modelDirectories"], (mctx) => {
        usageModelDirs = mctx.modelDirectories || null;
        usageDirsNotify();
      });
      // 全局 429 续跑器主循环：轮询自守卫（slots/settings 未就绪直接跳过），
      // monitorEnabled 关闭时 tick 空转；模块随页面销毁，无独立清理需求
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
      // ── 官方文件预览的鸿蒙兼容兜底（依赖宿主断言，升级复核见知识库「DSH 插件开发坑」）──
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
      // 拉一次生效配置喂功能门控（见模块顶 cfgSnapshot 注释）；失败保持内置默认
      kitJson("/dsh-kit/config")
        .then((body) => {
          if (body && typeof body === "object") applyConfigSnapshot(body);
        })
        .catch(() => {});
      // 全帧浮层宿主：面板渲染、输入框入口与技能页的座位门控、快捷键监听全在
      // KitSurfaces（根作用域常驻，fiber 上下文内做动态 register/dispose）。
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          { name: "shell.overlay", id: "dsh-kit-surfaces", order: 900 },
          KitSurfaces,
        ),
      );
      // 官方右侧边栏：五个功能 dock 签 + 引导页清单。只在宿主
      // 提供该服务时生效（缺服务 = 只剩 kitUi 存在性补丁，签不出现）。用 inject
      // 等它就绪而非直接读——官方右栏与本插件的客户端加载顺序不保证
      if (typeof ctx.inject === "function") {
        ctx.inject(["sidebarRightTabs"], registerRightbar);
        ctx.inject(["sidebarRight"], (srCtx) => { rightbarSr = srCtx.sidebarRight; });
        // 官方 sessions 服务捕获：openOfficialFile 拼文件地址要当前会话 id 与 cwd
        ctx.inject(["sessions"], (sctx) => { sessionsSvc = sctx.sessions; });
        // 官方终端模型服务捕获：dock 终端引擎（0.1.6+，缺失时终端坞报版本提示）
        ctx.inject(["webTerminals"], (tctx) => { webTerminalsSvc = tctx.webTerminals; });
      } else {
        registerRightbar(ctx);
      }
      // 导航图标替换是点击驱动的轻量方案：打开设置/面板内切换都源于一次 click
      document.addEventListener("click", scheduleSkillIconSwap, true);
      // 对话文件点击的知识库路由：vault 内路径改道知识库标签，其余放行官方
      //（门控见 onChatOpenFileClick 与 chatPreviewHook）
      document.addEventListener("click", onChatOpenFileClick, true);
      // 对话链接改投内置浏览器（默认开：配置页 chatOpenLinkInBrowser）
      document.addEventListener("click", onChatLinkClick, true);
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
    }

    // slots 是唯一依赖：settingsScope 已随宿主 0.1.7 移除（配置改走 Config
    // schema + 原生设置页，client 拉 /dsh-kit/config 只读快照做门控）
    exports.inject = ["slots"];
    exports.apply = apply;
    return module.exports;
  },
});
