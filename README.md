[English](README.en.md) | 中文

# dsh-kit

面向 DeepSeek Harness (dsh) 的**页面能力套件插件**：给 DSH 的浏览器界面加装可选能力，
每个能力独立、互不依赖；全部关闭时 DSH 保持原版。

## 功能

- **终端**（工具行开关 / **Ctrl+/**）：底部多标签终端坞，绑定开启时所在会话的工作区，
  隐藏时后台 shell 继续运行；Windows 优先 pwsh
- **文件树**（工具行开关）：以会话工作区为根浏览文件，支持新建/重命名/删除
  （回收站）/复制路径；点文件开舞台「文件」标签（**文件共用一个标签**，点新文件
  换内容，不然一屏标签太乱；md 所见即所得，自动保存 +
  mtime CAS 防覆盖，AI 改盘自动跟随）/ diff 着色
- **源代码管理**（工具行开关，默认 **Ctrl+Alt+.**）：页内 git 工作台——暂存/取消暂存/
  放弃/提交、diff 视图、分支切换与新建删除、一键 push、提交图谱；非 git 目录可一键初始化
- **日程**（工具行开关，默认 **Ctrl+Alt+S**）：开=侧栏待办索引 + 舞台周网格一次到位，
  再点=两边一起收。侧栏待办列表勾选/计时/点开舞台编辑，
  舞台周时间网格 + 本周统计；agent 经 `schedule_query`/`schedule_create` 只读
  汇总、只建不改（人主导）；数据结构化落盘 `$DSH_HOME/dsh-kit/schedule.json`
- **知识库**（工具行开关，默认 **Ctrl+Alt+K**）：默认地址开箱即用（数据目录下 `dsh-kit\vault`，可在设置改绝对路径）——选库（顶层目录）
  进入阅读，懒加载目录树，**每页一个舞台标签（可多开、✕ 单关）**，`[[双链]]` 页内跳转（前进/后退）+ 反链 + 碎链点击
  建页 + 全文搜索（wiki 区）；TipTap 富文本所见即所得编辑（2s 自动保存 +
  mtime CAS 防覆盖）；与对话互通——聊天里的 vault 路径点击直达页面、页条
  「引用到对话」把页面/选区插进输入框；使用规则以 `dsh-kit-vault` 技能进 agent
  上下文（一题一页/双链/提示卡等格式约定 + git 提交存档），agent 经 `vault_search`
  工具检索 wiki 页、文件工具直接读写（文件即接口）、改完自行 git 提交；git 自动
  存档——初始化一次 + 人工保存/删除后各一提交，随时整体回退（未装 git 自动跳过，
  attachments/ 与 library/ 不入存档）
- **工作台三段式布局**（2026-09-10 定稿）：左侧栏放索引（官方会话 ↔ 文件树 ↔
  知识库目录 ↔ 日程待办单槽轮换）、中间舞台放当前工作对象（文件/后台任务/日程/
  知识库/浏览器标签共存 + 「+」菜单）、右侧对话列常驻（保底 400px）。工具行
  五钮：文件树/源代码管理/知识库/日程/终端；侧栏底部按钮区：任务/浏览器/计时
  三钮常驻 + 文件钮被动出现；知识库/日程两钮开合成对（侧栏索引与舞台标签一起
  开、一起关），计时钮起表/运行态/停表确认。宽度模型：拖未钉标签调全局共享默认
  （未钉标签联动），图钉按功能类型钉住当前宽度（localStorage）。文件标签被动打开
  ——文件树/源代码管理/对话链接点开即开（共用一个可编辑标签）
- **后台任务**（舞台「+」菜单或底部钮打开）：列出会话运行中的后台任务，可查看输出、
  结束任务（等同官方 `job_output`/`job_kill`）；标签与菜单项带运行中计数
- **内置浏览器**（舞台「+」菜单或底部钮打开，默认开）：agent 以 5 个 `browser_*` 工具驱动系统 Edge
  （vendored playwright-core，专用持久 profile）——快照→动作→断言的 GUI 测试循环、
  截图（多模态模型直看，否则落盘）；浏览器标签显示 agent 浏览器的实时
  画面，点击/滚轮/键入直接作用于 agent 正在操作的同一页面（人机共驾）；
  agent 每次导航舞台自动切到浏览器标签（无抑制——人关掉/隐藏也会被下次导航
  拽回，agent 操作浏览器必须可见）
- **技能管理**（设置面板新页）：工作区/用户级/技能池三组展示，支持复制、移动、删除、
  禁用/启用；被同名技能覆盖者打虚线徽标
- **手机访问**（设置面板新页）：手机扫码连上本机 dsh web——令牌鉴权网关（默认端口
  3090，可改），默认每次启动关闭；局域网与远程双通道，HTTP/WS 全量透传
- **网页搜索**（自 dsh-free-search 并入）：免 key 引擎链（Tavily → Bing → Sogou，
  按优先级故障转移）替换付费的 `deepseek-official`，可经设置卡开关
- **会话监视**（默认开）：回合因 429 限流等可重试错误终态结束后，等待自动发送
  「继续」（连续自动续跑次数有上限）；流式输出重复内容（死循环征兆）时自动停止
  回合并续跑；有动作时 composer 上方显示横幅可取消，只监视当前打开的会话
- **设置卡**：dsh-kit 配置卡——各功能独立开关、快捷键自定义（终端/文件树/源代码管理/
  知识库/日程/侧边栏/舞台）、搜索结果条数、会话监视参数等

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
`dsh web`：工具行出现文件树/源代码管理/知识库/日程/终端五个开关，侧栏底部按钮区
与中间舞台承载任务/浏览器/知识库/日程等面板，AI 的 `web_search`
同时切到免费多源搜索。

## 工作原理

- `src/index.js`：宿主半边——挂 `conversation` `/dsh-kit/terminal` WS 端点
  （node-pty）、`/tree`、`/read`（512 KB 限长 + 文本解码）、`/write`（cwd 子树 +
  mtime CAS）、`/fs/op`、`/jobs/kill|output`、`/browser`（内置浏览器 WS）与手机
  访问网关端点
- `client/bundle.js`：浏览器半边（手写 ModuleLoader bundle，无构建）——
  `conversation.input.left` 注册五个开关（文件树/源代码管理/知识库/日程/终端）；
  文件树、源代码管理、知识库目录与日程待办共用侧栏槽，中间舞台、终端坞与计时
  悬浮窗自绘（CSS 让位）；设置页与设置卡注册进 settings 槽位
- `src/web-search.js` + `src/engine-chain.js` + `src/engines/*`：向 web seam 注册
  `free-search` provider，受设置卡 `searchEnabled` 门控
- `cordis.patch.yml`：把 dsh-kit 插件行 insert 进 bundle 层，web 行 `searchProvider`
  改为 `free-search`
- 宿主侧 `node-pty`/`ws` 不声明依赖：运行时从 profile fallback node_modules 解析

## 环境要求

- Node.js ≥ 22（dsh 自身要求）
- 纯 ESM、零依赖声明、零构建

## 许可证

MIT