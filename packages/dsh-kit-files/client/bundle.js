// dsh-kit-files 浏览器半边 —— 文件树与源代码管理组件的 client 面。
// 收纳：侧栏文件树（目录树/新建/改名/删除/@ 到对话）+ 源代码管理（状态/差异/
// 提交/分支/推送/提交图谱）+ SCM diff 签正文（DiffPane，挂 kitBase 的 diffPane
// 座供 root 的 FilePaneBody 取用）。数据走本组件宿主半边的端点（路径沿用
// /dsh-kit/*）。入口按钮经 slots.inject 自注册，开关 = 本组件自己的 Config
// （fileTreeEnabled/sourceControlEnabled，经 /dsh-kit-files/config 拉取）；
// 侧栏浏览区的 tree/git 分支经 kitBase.sidebarView 座交给 root 单槽分发，
// 全局快捷键（Ctrl+, / Ctrl+Shift+.）在这里自挂，组合键读组件自己的配置。
window.__ModuleLoader__.load({
  id: "dsh-kit-files",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const dock = require("dsh-kit");
    const {
      setKitUi, getKitUi, useKitUi,
      openFileAndDock, openTreeFile, sidebarViewPatch,
      flashToast, writeClipboard, kitGetJson, kitPostJson, kitJson,
      resolveZh, currentComposerShell, chatMentionText,
      expandSidebarNow, TreeRowMenu, TreeFolderIcon, FileTypeIcon16, ChevronIcon,
      parseCombo, comboMatches,
    } = dock;
    let dswPrimIcons = null;
    try { dswPrimIcons = require("@deepseek-ai/dsh-client-ui-primitives"); } catch { /* 回退自绘 */ }
    const dswIcon = (...names) => {
      for (const n of names) {
        const c = dswPrimIcons ? dswPrimIcons[n] : null;
        if (typeof c === "function" || typeof c === "object") return c;
      }
      return null;
    };

    // 组件私有文案（tree*/sc*/图谱/diff 词条随面板迁入本包；语言判定/切换响应来自 dock）
    const zh = {
      noCwd: "没有可用的会话工作区：先打开或创建一个会话",
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
      scCommitDetail: "提交详情",
      scBack: "返回",
      scMergedCommit: "合并提交",
      scAuthored: "作者",
      diffFail: "diff 加载失败",
      diffBaseParent: "与上一版（父提交 {base}）对比",
      diffBaseRoot: "根提交：与空树对比（全部为新增）",
      diffEmpty: "（无未暂存差异）",
      diffUntracked: "未跟踪文件，暂无 diff",
      contentLoading: "加载中…",
      contentEmpty: "（空文件）",
      pvDeletedNote: "文件已删除——此标签仅展示删除 diff；可在源代码管理里 ↩ 恢复文件",
      kcfgGroupFeatures: "功能开关",
      kcfgGroupShortcuts: "快捷键",


      kcfgFileTreeEnabled: "文件树",
      kcfgFileTreeEnabledHint: "侧栏文件树与文件打开入口的总开关。",
      kcfgSourceControlEnabled: "源代码管理",
      kcfgSourceControlEnabledHint: "源代码管理签（状态/差异/提交图谱/分支）。",
      kcfgFileTreeShortcut: "文件树",
      kcfgFileTreeShortcutHint: "点方框后按组合键；默认 Ctrl+,",
      kcfgScShortcut: "源代码管理",
      kcfgScShortcutHint: "点方框后按组合键；默认 Ctrl+Shift+.（句点）",
    };
    const en = {
      noCwd: "No session workspace available: open or create a session first",
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
      scCommitDetail: "Commit detail",
      scBack: "Back",
      scMergedCommit: "Merge commit",
      scAuthored: "Author",
      diffFail: "Failed to load diff",
      diffBaseParent: "Compared with parent commit {base}",
      diffBaseRoot: "Root commit: diffed against empty tree (all additions)",
      diffEmpty: "(no unstaged changes)",
      diffUntracked: "Untracked file, no diff yet",
      contentLoading: "Loading…",
      contentEmpty: "(empty file)",
      pvDeletedNote: "File deleted — this tab shows the deletion diff only; restore it via ↩ in source control",


      kcfgGroupFeatures: "Features",
      kcfgGroupShortcuts: "Shortcuts",
      kcfgFileTreeEnabled: "File tree",
      kcfgFileTreeEnabledHint: "Master switch for the sidebar file tree and file entries.",
      kcfgSourceControlEnabled: "Source control",
      kcfgSourceControlEnabledHint: "The source control tab (status, diffs, commit graph, branches).",
      kcfgFileTreeShortcut: "File tree",
      kcfgFileTreeShortcutHint: "Click the box, then press the combo; default Ctrl+,",
      kcfgScShortcut: "Source control",
      kcfgScShortcutHint: "Click the box, then press the combo; default Ctrl+Shift+. (period)",
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
    const F_CFG_DEFAULTS = {
      fileTreeEnabled: true,
      sourceControlEnabled: true,
      fileTreeShortcut: "Ctrl+,",
      scShortcut: "Ctrl+Shift+.",
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
      out.fileTreeShortcut =
        typeof v.fileTreeShortcut === "string" && parseCombo(v.fileTreeShortcut)
          ? v.fileTreeShortcut
          : F_CFG_DEFAULTS.fileTreeShortcut;
      out.scShortcut =
        typeof v.scShortcut === "string" && parseCombo(v.scShortcut)
          ? v.scShortcut
          : F_CFG_DEFAULTS.scShortcut;
      return out;
    }
    /** 配置关但侧栏视图还开着（配置页保存 / entry 重启瞬间）：立即归位，文件随来源清掉 */
    function sweepDisabledViews() {
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      const ui = getKitUi();
      if (!cfg.fileTreeEnabled && ui.treeOpen) setKitUi({ treeOpen: false, files: [], activeFile: null });
      if (!cfg.sourceControlEnabled && ui.gitOpen) setKitUi({ gitOpen: false, files: [], activeFile: null });
    }

    // ─────────── 组件样式 ───────────
    const FILES_CSS = `
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
      { key: "fileTreeShortcut", type: "combo", group: "kcfgGroupShortcuts", labelKey: "kcfgFileTreeShortcut", hintKey: "kcfgFileTreeShortcutHint" },
      { key: "scShortcut", type: "combo", group: "kcfgGroupShortcuts", labelKey: "kcfgScShortcut", hintKey: "kcfgScShortcutHint" },
    ];
    const FILES_CFG_GROUPS = ["kcfgGroupFeatures", "kcfgGroupShortcuts"];
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

    // ─────────── 全局快捷键（Ctrl+, / Ctrl+Shift+.，组合键读组件配置）───────
    const onFilesShortcutKey = (e) => {
      if (dock.inlineEdit.active || dock.shortcutCapture.active) return; // 树行改名输入 / 配置页录制组合键时让路
      const cfg = cfgFromSnapshot(getCfgSnapshot());
      const treeCombo = parseCombo(cfg.fileTreeShortcut);
      const scCombo = parseCombo(cfg.scShortcut);
      if (treeCombo && cfg.fileTreeEnabled && comboMatches(e, treeCombo)) {
        e.preventDefault();
        e.stopPropagation();
        // 与入口按钮同语义：单槽互斥，收起态先展开侧栏
        if (!getKitUi().treeOpen) expandSidebarNow();
        setKitUi(sidebarViewPatch(getKitUi().treeOpen ? null : "tree"));
        return;
      }
      if (scCombo && cfg.sourceControlEnabled && comboMatches(e, scCombo)) {
        e.preventDefault();
        e.stopPropagation();
        if (!getKitUi().gitOpen) expandSidebarNow();
        setKitUi(sidebarViewPatch(getKitUi().gitOpen ? null : "scm"));
      }
    };

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
        const items = getKitUi().files ?? [];
        const rest = items.filter((pv) => !stale(pv.path));
        if (rest.length === items.length) return;
        const patch = { files: rest };
        if (getKitUi().activeFile && stale(getKitUi().activeFile)) {
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

    /** 文件树入口：非文件树态 → 打开文件树（顺带展开收起的侧栏）；已是 → 关闭回
     *  会话列表。走单槽互斥补丁（打开文件树同时让出源代码管理/知识库目录/日程
     *  待办那一格），关闭动作保留已打开的文件标签（标签有独立 ✕） */
    function FileTreeEntry() {
      const ui = useKitUi();
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      if (cfg.fileTreeEnabled === false) return null;
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
      const cfg = cfgFromSnapshot(react.useSyncExternalStore(subscribeCfg, getCfgSnapshot));
      if (cfg.sourceControlEnabled === false) return null;
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

    // ─────────── 插件体 ───────────
    function apply(ctx) {
      // 组件配置页：挂本组件行（行由 dsh-kit bundle 的 patch 声明，槽位 key =
      // <包名>#<行id>，两种包名口径各挂一枚防宿主改口径）
      for (const key of ["dsh-kit#files", "dsh-kit-files#files"]) {
        ctx.slots.inject("plugins.row.config", () =>
          ctx.slots.register({ name: "plugins.row.config", key }, FilesConfigPage),
        );
      }
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
          return jsxRuntime.jsx(GitChangesPanel, { cwd, onOpenFile: (p, untracked, deleted, commit) => openFileAndDock(p, "scm", untracked === true, deleted === true, commit), ...owner });
        }
        if (ui.treeOpen) {
          return jsxRuntime.jsx(FileTreePanel, { cwd, onOpenFile: (p) => openTreeFile(p), ...owner });
        }
        return null;
      };
      document.addEventListener("keydown", onFilesShortcutKey, true);
      void loadCfg(); // 拉配置喂门控（失败保持内置默认）
      injectStyles();
    }

    exports.inject = ["slots"];
    exports.apply = apply;
    // 渲染级检查与面板引用供测试断言；DiffPane 另挂 root 的 diff 正文座（座对象
    // 与 root 的 kitBase 共享同一引用，root 读得到）
    exports.DiffPane = DiffPane;
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
    return module.exports;
  },
});
