[English](README.en.md) | 中文

# dsh-kit

面向 DeepSeek Harness (dsh) 的**页面能力套件插件**：给 DSH 的浏览器界面加装可选能力，
每个能力独立、互不依赖；全部关闭时 DSH 保持原版。

## 功能

工作台住在**官方右侧边栏**（宿主 0.1.5+ 的 `sidebar.right`）：文件 / 知识库 / 日程 /
后台任务 / 浏览器各一张 dock 签，签里再分文档签（一文件一签、一知识库页一签）。
索引类视图（文件树、源代码管理、知识库目录）共用左侧边栏一格，对话列常驻。

- **终端**（工具行开关 / **Ctrl+/**）：底部多标签终端坞，绑定开启时所在会话的工作区，
  隐藏时后台 shell 继续运行；Windows 优先 pwsh
- **文件树**（工具行开关 / **Ctrl+,**）：以会话工作区为根浏览、新建/重命名/删除
  （回收站）/复制路径；点文件在右栏「文件」签开一个文档签（一文件一签、点签切换、
  ✕ 单关；超过设置卡的「文件标签数上限」，默认 3，自动关掉最久没看的那个），
  md 所见即所得、自动保存 + mtime CAS 防覆盖，AI 改盘自动跟随 / diff 着色；
  **md 里的相对 / 站内链接点击直接在文件签打开目标文件**
- **源代码管理**（工具行开关 / **Ctrl+Alt+.**）：页内 git 工作台——暂存/取消暂存/
  放弃/提交、diff 视图、分支切换与新建删除、↑↓ 同步（先拉后推）、提交图谱；
  非 git 目录可一键初始化
- **日程**（入口在右栏开始页条目与待办卡；无 composer 钮、无专属快捷键）：
  日程 pane 内左待办 + 右周网格 + 本周统计；agent 经 `schedule_query`/`schedule_create`
  只读汇总、只建不改（人主导）；数据结构化落盘 `$DSH_HOME/dsh-kit/schedule.json`
- **知识库**（工具行开关 / **Ctrl+Alt+K**）：默认地址开箱即用（数据目录下
  `dsh-kit\vault`，可在设置改绝对路径）——左栏目录树选页，右栏「知识库」签里每页一个
  文档签（可多开、✕ 单关），`[[双链]]` 页内跳转（前进/后退）+ 反链 + 碎链点击建页 +
  全文搜索（wiki 区）；TipTap 富文本所见即所得（2s 自动保存 + mtime CAS）；
  与对话互通——聊天里的 vault 路径点击直达、工具条「引用到对话」把页面/选区插进输入框；
  使用规则以 `dsh-kit-vault` 技能进 agent 上下文，agent 经 `vault_search` 检索、
  文件工具直接读写、改完自行 git 提交；git 自动存档（初始化一次 + 人工保存/删除后各一提交）
- **后台任务**（入口在右栏开始页条目与自动跟随）：列出会话运行中的后台任务，可查看
  输出、结束任务（等同官方 `job_output`/`job_kill`）
- **内置浏览器**（右栏「浏览器」签，默认开）：agent 以 7 个 `browser_*` 工具驱动系统 Edge
  （vendored playwright-core，专用持久 profile）——快照→动作→断言的 GUI 测试循环、
  截图（多模态模型直看，否则落盘）；面板显示 agent 浏览器的实时画面，
  点击/滚轮/键入直接作用于同一页面（人机共驾）；agent 每次导航自动把浏览器签拽到眼前
- **技能管理**（设置面板新页）：工作区/用户级/技能池三组展示，支持复制、移动、删除、
  禁用/启用；被同名技能覆盖者打虚线徽标
- **手机访问**（设置面板新页）：手机扫码连上本机 dsh web——令牌鉴权网关（默认端口
  3090，可改），默认每次启动关闭；局域网与远程双通道，HTTP/WS 全量透传
- **网页搜索**（自 dsh-free-search 并入）：免 key 引擎链替换付费的 `deepseek-official`——
  专用引擎（GitHub / arXiv / StackExchange / HN，按查询特征参与）优先，其后通用引擎
  Tavily（免 key）→ Bing → Sogou 逐个故障转移；可经设置卡开关与条数
- **会话监视**（默认开）：回合因 429 限流等可重试错误终态结束后，等待自动发送
  「继续」（连续自动续跑次数有上限）；流式输出重复内容（死循环征兆）时自动停止
  回合并续跑；有动作时 composer 上方显示横幅可取消，只监视当前打开的会话
- **设置卡**：dsh-kit 配置卡——各功能独立开关、快捷键自定义（终端/文件树/源代码管理/
  知识库/侧栏左右两键）、搜索结果条数、文件签上限、知识库目录、会话监视参数、手机访问

## 安装与更新

安装最新 release（推荐）：

```bash
dsh plugin --profile web add "github:zhouzhencheng07/dsh-kit#semver:*"
```

或跟踪 main 分支最新提交：

```bash
dsh plugin --profile web add "github:zhouzhencheng07/dsh-kit"
```

更新到最新版：

```bash
dsh plugin --profile web update dsh-kit
```

本包声明了 `dsh.bundle.patch`，会被激活为 profile 的 bundle 层。安装/更新后重启
`dsh web`：工具行出现文件树/源代码管理/知识库/终端四个开关，工作台以官方右侧边栏
承载（五类 dock 签），AI 的 `web_search` 同时切到免费多源搜索。

**宿主版本要求**：dsh ≥ 0.1.5（依赖官方右侧边栏服务 `sidebar.right`）。
老宿主没有该服务时插件照常加载，但工作台签不会出现、入口按钮点了没有面板——
先升 dsh 再装本插件。

## 工作原理

- `src/*.ts` → `dist/`（tsc 构建产物入库）：宿主半边——挂 `/dsh-kit/terminal` WS
  （node-pty）、`/tree`、`/read`、`/stat`、`/raw`（Range/206）、`/write`（cwd 子树 +
  mtime CAS）、`/fs/op`、`/upload`、`/git/*`、`/browser`（内置浏览器 WS）、`/jobs/*`、
  `/schedule/*`、`/vault/*`（知识库）、`/skills`、`/phone/*`（手机网关）等端点
- `client/bundle.js`：浏览器半边（手写 ModuleLoader bundle，**零构建**）——
  `conversation.input.left` 注册四个入口钮；官方右栏 `sidebarRightTabs` 注册五类 dock 签、
  pane 正文经 `sidebar.right.pane.tab` 提供；终端坞与计时件自绘；设置页与设置卡注册进
  settings 槽位
- `client/vendor/*`：xterm / CodeMirror 6 / TipTap 富文本 / pdf.js / SheetJS / mammoth /
  KaTeX / DOMPurify，全部按需懒加载，由 `/dsh-kit/vendor/*` 静态伺服
- `src/web-search.ts` + `src/engine-chain.ts` + `src/engines/*`：向 web seam 注册
  `free-search` provider，受设置卡 `searchEnabled` 门控
- `cordis.patch.yml`：把 dsh-kit 插件行 insert 进 bundle 层，web 行 `searchProvider`
  改为 `free-search`
- 宿主侧 `node-pty`/`ws`/`@deepseek-ai/*` 不声明依赖：运行时从 profile fallback
  node_modules 解析（声明了 pnpm 会装出第二份实例）

## 环境要求

- dsh ≥ 0.1.5（官方右侧边栏）
- Node.js ≥ 22（dsh 自身要求）
- 零 dependencies 声明；宿主半边 TS 源码 + 预构建 `dist`，浏览器半边零构建

## 许可证

MIT
