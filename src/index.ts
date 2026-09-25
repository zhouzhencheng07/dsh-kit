// dsh-kit — DSH 页面能力插件包（宿主半边）
//
// 当前能力：
//   文件树（file tree）——GET /dsh-kit/tree?path=<绝对目录> 返回该层
//     目录+文件的 JSON 列表（官方 browse RPC 只列目录不列文件，故自建）；
//   文件预览（file preview）——GET /dsh-kit/read?path=<绝对文件> 读取文本
//     内容（限长 + 二进制探测），浏览器端在右侧 details 列展示；
//   网页搜索（web search）：向 web seam 注册
//     'free-search' provider（免费引擎链），实现见 src/web-search.ts +
//     src/engine-chain.ts + src/engines/*。
//
// 浏览器半边（client/bundle.js）：终端/文件树入口按钮注册在对话输入框工具行
// （conversation.input.left），面板本体挂 shell.overlay 全帧浮层；终端开合底部
// 停靠面板（Ctrl+`），文件树临时接管侧边栏浏览区（sidebar.workspaces 单槽）。
// 插件配置页（Config schema 声明式模型，编辑面在插件页本行「配置」）提供功能开关
// 与快捷键自定义；其中 searchEnabled 由宿主消费（开=免费引擎链，关=转发官方渠道，
// 重启后生效），其余开关浏览器端消费。
//
// 宿主半边（本文件）挂这些端点（webserver 默认只绑 loopback）：
//   1) 静态 /dsh-kit/vendor/* —— xterm 官方预编译 UMD，按需加载；
//   2) GET /dsh-kit/tree?path=… —— 单层目录列表（含文件），只读；
//   3) GET /dsh-kit/read?path=… —— 单文件文本内容，只读；
//   4) GET /dsh-kit/raw?path=… —— 原始字节透传（扩展名白名单 + Range/206；官方
//      文件预览头部的「下载到本机」与 vault 图片/附件走这里）；
//   5) POST /dsh-kit/fs/op —— 文件树新建/重命名/删除（删除优先移入回收站）；
//   6) GET /dsh-kit/git/status|diff|log|show|branch、POST /dsh-kit/git/init|op ——
//      源代码管理。status 含分支/领先信息（branch/upstream/ahead/behind），
//      log 是提交图谱（git log --all --graph），show 是单个提交详情，
//      branch 是本地分支列表；op 含 stage/unstage/discard/commit/push/
//      branchCreate/branchSwitch/branchDelete。
//   另有 WebSocket /dsh-kit/browser（见下方浏览器面板端点）。
//
// 终端自 0.1.6 起不走本插件：dock 界面仍在（client 半边），引擎换官方
// webTerminals 服务（PTY 归宿主：系统用户权限、刷新不丢、shell 选择），宿主半边
// 不再需要 node-pty 与终端端点。

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { applySkillPool } from './skill-pool.ts'
import { applyOpenCodeSessionHeader } from './core/index.ts'
import { applyWebSearch } from './web-search.ts'
import { startPhoneGateway, lanAddresses, defaultStateFile, loadGatewayState, saveGatewayState } from './phone-gateway.ts'
import type { PhoneGatewayHandle } from './phone-gateway.ts'
import { BrowserService, normalizeScope, DEFAULT_SCOPE } from './browser.ts'
import { loadToolsModule, buildBrowserTools } from './browser-tools.ts'
import { syncScheduleStore, buildScheduleTools, isDateStr, todayStr } from './schedule.ts'
import { VaultScanner, defaultVaultRoot } from './vault.ts'
import { createEntry, renameEntry, moveEntry, importEntry, deleteEntries, parseConflict } from './vault-fs.ts'
import { sameOrigin } from './core/index.ts'

/** 手机访问网关对外端口（0.0.0.0）的默认值，可在设置里改（phonePort，1-65535） */
const PHONE_PORT = 3090

export const name = 'dsh-kit'

const require = createRequire(import.meta.url)

// ── 宿主对象最小依赖面 ──
// cordis ctx / webServer / settings 等都是运行时才挂载的宿主组合对象，类型不随
// 插件分发；这里只声明本插件实际触达的成员（与 browser-tools.ts / skill-pool.ts
// 同一约定）。inject 回调的 services 袋按 any 传入，各回调自行具化参数类型。

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
  /** cordis 事件面（llm/stream 瀑布监听用）；缺失时按会话注入整体降级 */
  on?(event: string, listener: (...args: any[]) => any, options?: unknown): unknown
  get(name: string): unknown
}

interface KitWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
}

interface KitWebServer {
  register(route: KitWebRoute): () => void
  registerUpgrade(route: {
    path: string
    handler: (req: http.IncomingMessage, socket: import('node:net').Socket, head: Buffer) => void
  }): () => void
  port: number
}

/** 插件设置的运行时形状（loader 按 Config schema 解析 profile 补丁里的 config 后
 *  传入 apply；字段缺失时由 readSettings 兜内置默认） */
type KitSettings = Record<string, unknown>

interface KitCredentials {
  readRecord?: (name: string) => Promise<{ kind?: string; payload?: any } | null>
}

/** 目录选择 seam 的能力对象（宿主 picker 后端注册；未组合该后端时服务不存在） */
interface KitDirectoryPicker {
  capability?: () => { kind?: string }
}

interface KitWebCtx {
  webServer: KitWebServer
  credentials: KitCredentials
  effect(fn: () => void | (() => void), label?: string): void
}

/**
 * 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录）。从
 * process.argv[1]（dsh 启动脚本；tsx 开发模式下可能是相对路径，先 path.resolve
 * 成绝对路径，否则 pnpm-workspace.yaml 检查落空）向上走。非 DSH 环境返回 null。
 */
function findMonorepoRoot(): string | null {
  const anchor = process.argv[1]
  if (!anchor) return null
  const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor)
  let dir = path.dirname(abs)
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * 多锚点加载 dsh-kit 的运行时依赖（ws，为 DSH 自身依赖，不在 dsh-kit 的
 * package.json 里）。按可靠度依次尝试：
 *   1) 本模块 import.meta.url —— 真实安装形态（registry tarball 带依赖）命中这里；
 *   2) DSH 本体锚点（process.argv[1]，绝对路径化）—— 软链装进 profile 后真实路径
 *      落在源仓库、够不到 fallback node_modules，改用 dsh 启动脚本所在处的
 *      node_modules（ws 挂在这里）；
 *   3) DSH monorepo 的 .pnpm store —— patched 依赖挂在某个 workspace 包
 *      （如 subprocess-local）的 node_modules，profile 与 dsh bin 都够不到；
 *      直接从 pnpm store 按 spec 定位实体加载。
 * 都失败返回 null（浏览器面板不可用，插件其余功能正常）。
 */
function loadDep(spec: string): any {
  try {
    return require(spec)
  } catch {
    // 落到后续锚点
  }
  const anchor = process.argv[1]
  if (anchor) {
    const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor)
    try {
      return createRequire(abs)(spec)
    } catch {
      // 落到 monorepo store
    }
  }
  const root = findMonorepoRoot()
  if (root) {
    const pnpm = path.join(root, 'node_modules', '.pnpm')
    if (fs.existsSync(pnpm)) {
      let entries: string[] = []
      try {
        entries = fs.readdirSync(pnpm)
      } catch {
        /* ignore */
      }
      for (const e of entries) {
        if (!(e === spec + '@' || e.startsWith(spec + '@'))) continue
        const pkgJson = path.join(pnpm, e, 'node_modules', spec, 'package.json')
        if (!fs.existsSync(pkgJson)) continue
        try {
          return createRequire(pkgJson)(spec)
        } catch {
          // 试下一个候选版本
        }
      }
    }
  }
  return null
}

const WebSocketServer = loadDep('ws')?.WebSocketServer ?? null
if (!WebSocketServer) {
  console.warn('dsh-kit: ws 不可用，浏览器面板不可用')
}

// ── 插件设置 schema（0.1.7 起的声明式模型）──
// loader 读 profile 补丁里本 entry 的 config，按 Config 解析出默认值后传进 apply
// 第二参；设置页挂在插件页本插件行的「配置」（plugins.row.config）。
// **字段必须 .volatile()**：宿主 SettingsForms 只把 volatile 字段投影进表单
// （非 volatile 只能改 profile 补丁文件，界面上不可见）；volatile 写入 = 热提交
// （原地改 fiber config 的 ref，不重启 entry），所以 readSettings 统一解引用。
// Config 必须在模块加载期就存在（loader 实例化前读），所以用 loadDep 同步解析
// schemastery（锚点链同 ws）。解析失败 → 不导出 Config（本 entry 无设置页），
// apply 里落 FALLBACK_SETTINGS 兜底，插件其余功能不受影响。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // 隐藏官方右栏「工作区文件」入口胶囊（纯浏览器端消费，宿主不读）：那只是个
        // 目录按钮，与文件树功能重复；隐藏后文件仍可从对话/文件树/搜索进入
        hideOfficialFilesEntry: z.boolean().default(false).volatile(),
        hideOfficialBrowserEntry: z.boolean().default(false).volatile(),
        // 对话里的 http(s) 链接点击改投内置浏览器（默认开）。门控在浏览器半边（需要
        // browserEnabled 同时开），宿主只提供 /dsh-kit/browser/open 这条管道
        chatOpenLinkInBrowser: z.boolean().default(true).volatile(),
        skillsPageEnabled: z.boolean().default(true).volatile(),
        searchEnabled: z.boolean().default(true).volatile(),
        searchMaxResults: z.number().step(1).min(1).max(8).default(2).volatile(),
        // phoneEnabled = 「手机访问」页入口可见性（纯显示开关）。
        // 网关启停不走 settings（读取器回填滞后），改由状态文件 + kit 端点直管。
        phoneEnabled: z.boolean().default(true).volatile(),
        phoneRemoteDomain: z.string().default('').volatile(),
        phonePort: z.number().step(1).min(1).max(65535).default(3090).volatile(),
        phoneKeepGatewayOn: z.boolean().default(false).volatile(),
        // 知识库（vault）：总开关，默认关——关 = 不开 vault 端点（默认根是 $DSH_HOME 下
        // 的固定位置，没开功能就不该在盘上凭空出现目录；插件也不建骨架目录，指向哪里
        // 读哪里）；开 = 右栏「知识库」标签 + 只读索引/搜索端点（端点挂载在 boot 期，
        // 改开关重启后生效）。
        // 库是普通 md 目录，插件不为 agent 注册检索工具。
        vaultEnabled: z.boolean().default(false).volatile(),
        // vaultRoot = 知识库根目录（绝对路径；schema 默认值 = defaultVaultRoot()，字段恒有值）。
        // 宿主据此提供只读索引/搜索端点，数据契约见 src/vault.ts 头注释。
        // schema 默认值即默认根：设置面与运行时读到的都是实际路径（与其他配置项
        // 同一口径——字段恒有值），用户显式清空保存为 '' 时由读取侧兜底回默认
        vaultRoot: z.string().default(defaultVaultRoot()).volatile(),
        // 内置浏览器总开关（默认开）：关=不注册 browser_* 工具（重启生效）；浏览器
        // 半边入口按钮与面板同步隐藏。execute 内另有守卫兜底（注册期竞态时挡调用）。
        // 自动切面板与画面跟随 agent 是恒定行为（无开关）——人为切走浏览器
        // 标签后的"不再拽回"抑制在客户端侧实现。
        browserEnabled: z.boolean().default(true).volatile(),
        // 会话监视与通知（monitorEnabled/monitorWaitMs/monitorMaxAuto/
        // monitorRepeatThreshold/notifyEnabled）随组件化迁入 dsh-kit-monitor 的
        // Config（配置页在插件页该组件行）；终端开关（terminalEnabled）同理随
        // dsh-kit-terminal 迁出，主包不再消费这两组字段。
        // 键位不在这里：左右栏开合归宿主自带快捷键，本插件的终端/知识库命令在
        // client 半边注册进宿主 shortcuts 服务（官方「快捷键」页录制与持久化）
      })
    : undefined

/** Config 缺席（schemastery 不可达）时 readSettings 的兜底：只覆盖宿主消费的关键键
 *  （搜索条数、手机端口、库根），其余键缺省行为由读取侧的比较式兜住 */
const FALLBACK_SETTINGS: KitSettings = {
  searchMaxResults: 2,
  phonePort: PHONE_PORT,
  vaultRoot: '',
}

// vendor 静态资源：白名单文件名 → client/vendor/ 下同名文件
const VENDOR_DIR = fileURLToPath(new URL('../client/vendor/', import.meta.url))
const VENDOR_FILES = new Map([
  ['/dsh-kit/vendor/xterm.js', 'xterm.js'],
  ['/dsh-kit/vendor/addon-fit.js', 'addon-fit.js'],
  ['/dsh-kit/vendor/xterm.css', 'xterm.css'],
  ['/dsh-kit/vendor/qrcode.js', 'qrcode.js'],
  // vault 页面渲染器（TipTap 引擎只读态；懒加载）
  ['/dsh-kit/vendor/richeditor.bundle.js', 'richeditor.bundle.js'],
  // KaTeX 数学公式（vault 阅读态渲染 $...$ / $$...$$；懒加载）
  ['/dsh-kit/vendor/katex.min.js', 'katex.min.js'],
  ['/dsh-kit/vendor/katex.min.css', 'katex.min.css'],
])
const VENDOR_SUBDIRS = new Map([
  // KaTeX 字体：css 里以 fonts/ 相对路径引用，URL 段固定 fonts，磁盘上隔离在
  // katex_fonts/ 免得和未来其他字体混放
  ['fonts', 'katex_fonts'],
])
const VENDOR_TYPES = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
])

export async function apply(ctx: KitCtx, config: KitSettings = {}): Promise<void> {
  // ── 插件设置（0.1.7 声明式模型）──
  // 值 = loader 按 Config schema 解析 profile 补丁后的 entry config（见模块顶层
  // Config 注释）。配置变更 = 宿主重启本 entry（profile patchReload: live），apply
  // 重跑即拿到新值——搜索 provider 门控、手机网关启停都在启动期评估，不再需要
  // onChange 钩子。readSettings = schema 默认值 + entry config 的合并视图，供全部
  // 消费点（搜索条数、browserEnabled/vaultRoot 门控、手机网关端口等）现读。
  const defaults: KitSettings = Config ? Config({}) : FALLBACK_SETTINGS
  // 返回 any：消费点（搜索条数/手机端口等）直接当具体类型用，与旧 readSettings 同口径。
  // volatile 字段在 fiber config 里是稳定 ref（{get}，表单热更新原地改它），统一解引用
  const readRef = (v: unknown): any =>
    v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function'
      ? (v as { get: () => unknown }).get()
      : v
  const readSettings = (): any => {
    const out: Record<string, unknown> = { ...defaults }
    for (const [key, value] of Object.entries(config ?? {})) out[key] = readRef(value)
    return out
  }
  applyWebSearch(ctx, {
    getEnabled: () => readSettings().searchEnabled !== false,
    getMaxResults: () => readSettings().searchMaxResults,
  })

  // 技能池端点（实现见 src/skill-pool.ts）：自带 webServer 注入与同源校验。
  // skills 注册表是可选增强（归属展示），服务晚于本行就绪也无碍——注入回调捕获引用。
  let skillsRegistry: unknown = null
  ctx.inject(['skills'], (skillsCtx: { skills: unknown }) => {
    skillsRegistry = skillsCtx.skills
  })
  applySkillPool(ctx, { getRegistry: () => skillsRegistry })
  // OpenCode Go 会话头按会话注入（实现见 src/opencode-session.ts）
  applyOpenCodeSessionHeader(ctx, (m) => console.warn(`dsh-kit: ${m}`))

  // agents 注册表（dsh-agent，宿主组合里的可选服务）：浏览器工具的分区解析
  // （browserScopeOf）沿 parentSession 上溯用；缺失时分区落 DEFAULT_SCOPE。
  let agentsRegistry: any = null
  ctx.inject(['agents'], (capacityCtx: { agents: any }) => {
    agentsRegistry = capacityCtx.agents
  })

  // ── 内置浏览器（src/browser.ts + src/browser-tools.ts）──
  // 服务懒启动（首次工具调用/面板 watch 才拉起 Edge），这里只建对象与注册：
  //   工具注册门控 = settings 就绪 + tools 就绪（双键注入），关=不注册（重启生效）；
  //   execute 内有 isDisabled 守卫兜底注册期竞态；dispose 挂 ctx.effect（插件卸载
  //   时关浏览器，profile 保留）。
  const browserService = new BrowserService({ log: (m) => console.log(`dsh-kit: ${m}`) })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      void browserService.dispose()
    })
  }
  const browserToolsMod = browserService.available ? await loadToolsModule((m) => console.warn(`dsh-kit: ${m}`)) : null
  // 浏览器分区解析（工具侧）：调用方会话 id；子代理沿 durable parentSession 上溯到仍存活的
  // 最顶层会话——子代理的浏览归它所属的主对话，主对话面板里看得见，不另开隐身页签。
  // 认不出调用方会话（宿主辅助调用 / 注册表未挂）就落 DEFAULT_SCOPE，与面板的兜底同一格。
  const browserScopeOf = (exec?: unknown): string => {
    const agent = (exec as { agent?: { id?: string; session?: { header?: { parentSession?: string } } } | null } | undefined)?.agent
    const id = typeof agent?.id === 'string' ? agent.id : ''
    if (id === '') return DEFAULT_SCOPE
    let root = id
    let parent = agent?.session?.header?.parentSession
    for (let i = 0; i < 16 && typeof parent === 'string' && parent !== ''; i++) {
      const up = agentsRegistry?.get?.(parent) as { session?: { header?: { parentSession?: string } } } | undefined
      if (!up) break
      root = parent
      parent = up?.session?.header?.parentSession
    }
    return root
  }
  let browserDefs: ReturnType<typeof buildBrowserTools> | null = null
  try {
    browserDefs =
      browserToolsMod && typeof browserToolsMod.defineTool === 'function'
        ? buildBrowserTools({ defineTool: browserToolsMod.defineTool, service: browserService, ctx, isDisabled: () => readSettings().browserEnabled === false, scopeOf: browserScopeOf })
        : null
  } catch (error) {
    // 构建失败降级为无浏览器工具，不炸插件树（可用性优先，同 node-pty 先例）
    console.warn(`dsh-kit: 浏览器工具构建失败，本插件浏览器工具未注册：${error instanceof Error ? error.message : error}`)
    browserDefs = null
  }
  if (browserService.available && !browserDefs) {
    console.warn('dsh-kit: dsh-tools 不可达或形态不符，浏览器工具未注册（其余功能不受影响）')
  }
  ctx.inject(['settings', 'tools'], (caps: { tools: { register: (def: unknown) => void } }) => {
    if (readSettings().browserEnabled === false) return
    if (!browserDefs) return
    for (const def of browserDefs) {
      try {
        caps.tools.register(def)
      } catch (error) {
        console.warn(`dsh-kit: 浏览器工具注册失败：${error instanceof Error ? error.message : error}`)
      }
    }
  })

  // ── 日程模块（src/schedule.ts）：结构化日程/待办 ──
  //   agent 工具恒开（schedule_query 日/周/月汇总、schedule_create 建、
  //   schedule_update 三态改（null=清空、skip 跳过重复系列的一次）、
  //   schedule_delete 按 id 删整个系列）；只读日程签在 client/bundle.js
  //   挂右栏槽位；HTTP 端点（只读）在下方 webServer 注入块注册。
  // 日程存储固定 $DSH_HOME/dsh-kit/schedule/（一条一文件），与知识库（vaultRoot）无关，
  // 无配置门槛
  const scheduleStore = syncScheduleStore()
  const scheduleToolsMod = await loadToolsModule((m) => console.warn(`dsh-kit: ${m}`))
  const scheduleDefs =
    scheduleToolsMod && typeof scheduleToolsMod.defineTool === 'function'
      ? buildScheduleTools({ defineTool: scheduleToolsMod.defineTool, store: scheduleStore })
      : null
  if (!scheduleDefs) {
    console.warn('dsh-kit: dsh-tools 不可达，日程 agent 工具未注册（日程面板不受影响）')
  }
  ctx.inject(['settings', 'tools'], (caps: { tools: { register: (def: unknown) => void } }) => {
    if (!scheduleDefs) return
    for (const def of scheduleDefs) {
      try {
        caps.tools.register(def)
      } catch (error) {
        console.warn(`dsh-kit: 日程工具注册失败：${error instanceof Error ? error.message : error}`)
      }
    }
  })

  // ── 知识库扫描器（src/vault.ts）：提到 apply 级——webServer 注入可能重进，
  //   vault 端点块共享同一实例（mtime 缓存也就不用重建）。
  //   vaultRoot 留空用默认根（即开即用）；只读——不建目录不碰 git
  const vaultScanner = new VaultScanner(() => {
    try {
      const configured = String(readSettings().vaultRoot ?? '').trim()
      return configured === '' ? defaultVaultRoot() : configured
    } catch {
      return ''
    }
  })

  // webServer 可能在本插件 apply 之后才挂载，用动态注入等它就绪
  ctx.inject(['webServer', 'credentials'], (webCtx: KitWebCtx) => {
    webCtx.effect(() => {
      // ── 生效配置只读端点（client 功能门控的数据源）──
      // 0.1.7 起宿主客户端无 settingsScope，client 启动拉一次本端点喂快照
      // （cfgFromSnapshot 门控）；配置编辑在原生设置页，变更随 entry 重启生效。
      webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/config',
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify(readSettings()))
        },
      })
      // ── vendor 静态资源 ──
      const disposeVendor = webCtx.webServer.register({
        kind: 'prefix',
        path: '/dsh-kit/vendor',
        handler: (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://dsh-kit.local').pathname
          const notFound = () => {
            res.writeHead(404)
            res.end()
          }
          // 子目录资源（KaTeX 字体 fonts/*.woff2 等）：单段文件名白名单字符校验，
          // 杜绝路径穿越
          let file: string | null
          const sub = /^\/dsh-kit\/vendor\/(fonts)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname)
          if (sub) {
            file = path.join(VENDOR_SUBDIRS.get(sub[1] ?? '') ?? '', sub[2] ?? '')
          } else {
            file = VENDOR_FILES.get(pathname) ?? null
          }
          if (file === null || (req.method !== 'GET' && req.method !== 'HEAD')) {
            notFound()
            return
          }
          fs.readFile(path.join(VENDOR_DIR, file), (error, body) => {
            if (error) {
              notFound()
              return
            }
            res.writeHead(200, {
              'content-type': VENDOR_TYPES.get(path.extname(file)) ?? 'application/octet-stream',
              'cache-control': 'no-cache',
            })
            res.end(req.method === 'HEAD' ? undefined : body)
          })
        },
      })

      // ── 浏览器面板 WebSocket 端点（src/browser.ts 的面板面）──
      // 协议：hello（连接即回 state）→ 浏览器端；watch {on}（帧流订阅引用计数，
      // 0 时停流）/ open {url}（URL 栏导航）/ activate {tabId}（切观察页）/
      // closeTab {tabId}（关页）/ nav {op}（back/forward/reload）/ newTab（＋）
      // → 宿主。每条消息可带 scope（会话 id，见 normalizeScope）：连接按它认领分区，
      // state/event/frame 都按分区投递——不同对话各看各的页签与画面，浏览器实例与
      // profile 仍是全局共享的。面板挂舞台「浏览器」功能签，关闭标签即断 WS。
      // 同源校验同终端；开关关闭时面板入口在浏览器端已隐藏，此处不再重复门控。
      // 另有 HTTP 侧的 /dsh-kit/browser/open（见下）：对话链接点击改投内置浏览器，
      // 走它而不是 WS——点击发生时面板未必已挂载/已连上，HTTP 不依赖任一状态。
      if (browserService.available) {
        const browserSockets = new Map<any, string>()
        const sendTo = (ws: any, obj: unknown) => {
          try {
            if (ws.readyState === 1) ws.send(JSON.stringify(obj))
          } catch {
            // 连接正在断开
          }
        }
        /** 按分区投递：scope 为 undefined = 全局事件（实例级），发给每条连接 */
        const broadcast = (obj: unknown, scope?: string) => {
          for (const [ws, key] of browserSockets) {
            if (scope !== undefined && key !== scope) continue
            sendTo(ws, obj)
          }
        }
        /** 预序列化广播：帧体是几百 KB 的 base64 字符串，逐连接 JSON.stringify 会把
         *  同一份大字符串重复编码 N 次——一次编好，同分区的连接复用同一个串 */
        const broadcastJson = (json: string, scope: string) => {
          for (const [ws, key] of browserSockets) {
            if (key !== scope) continue
            try {
              if (ws.readyState === 1) ws.send(json)
            } catch {
              // 连接正在断开
            }
          }
        }
        /** 回发某条连接自己分区的 state（连接认领分区、分区事件、全局事件都走它） */
        const sendState = (ws: any) => {
          const scope = browserSockets.get(ws)
          if (scope === undefined) return
          void browserService.state(scope).then((s) => sendTo(ws, { t: 'state', ...s }))
        }
        const sendStateAll = () => {
          for (const ws of browserSockets.keys()) sendState(ws)
        }
        const sendStateScope = (scope: string) => {
          for (const [ws, key] of browserSockets) {
            if (key === scope) sendState(ws)
          }
        }
        const offBrowserEvent = browserService.on((evt) => {
          // ws 投影统一字段形状：state/closed 无 tabId/url/title（投影为 undefined，JSON 序列化时丢弃）
          const flat = evt as { kind: string; scope?: string; tabId?: number; url?: string; title?: string }
          const scoped = evt.kind === 'scope' || evt.kind === 'navigated' || evt.kind === 'crashed'
          broadcast({ t: 'event', kind: flat.kind, scope: flat.scope, tabId: flat.tabId, url: flat.url, title: flat.title }, scoped ? flat.scope : undefined)
          // 页集/指针变了要重发 state（closed/state 是实例级的，各连接按自己分区取）
          if (scoped) sendStateScope(flat.scope!)
          else sendStateAll()
        })
        void offBrowserEvent
        const bwss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
        bwss.on('connection', (ws: any) => {
          browserSockets.set(ws, DEFAULT_SCOPE)
          /** 本连接当前订着的分区（null = 没订流）；换分区时先退订旧分区 */
          let watchedScope: string | null = null
          const scopeOf = () => browserSockets.get(ws) ?? DEFAULT_SCOPE
          const openWatch = (scope: string) => {
            // 分区内单回调（同分区多连接扇出同一份帧）
            void browserService.watcherOpen(scope, (data) => broadcastJson(JSON.stringify({ t: 'frame', data }), scope))
            // 点开浏览器面板就该是「浏览器在、有页签」：本分区没有页就开一页
            // （懒启动 + 空白页签；运行中 ensure 是幂等 no-op）
            void browserService.ensurePage(scope)
          }
          const closeWatch = () => {
            if (watchedScope === null) return
            browserService.watcherClose(watchedScope)
            watchedScope = null
          }
          sendState(ws)
          ws.on('message', (raw: any) => {
            let msg: any
            try {
              msg = JSON.parse(String(raw))
            } catch {
              return
            }
            if (!msg || typeof msg !== 'object') return
            // 面板每条消息都带 scope（会话 id）：认领/切换分区，换分区时帧流跟着换
            if (typeof msg.scope === 'string') {
              const next = normalizeScope(msg.scope)
              if (next !== scopeOf()) {
                browserSockets.set(ws, next)
                if (watchedScope !== null) {
                  closeWatch()
                  openWatch(next)
                }
                sendState(ws)
              }
            }
            const scope = scopeOf()
            if (msg.t === 'watch') {
              if (msg.on === true && watchedScope !== scope) {
                closeWatch()
                watchedScope = scope
                openWatch(scope)
              } else if (msg.on === true) {
                // 已订阅的连接重发 watch = 面板重新激活：浏览器若已收摊（关最后一页/
                // 空闲关闭），懒启动拉回并自带空白页签（同 openWatch 语义）
                void browserService.ensurePage(scope)
              } else if (msg.on === false && watchedScope !== null) {
                closeWatch()
              }
              return
            }
            if (msg.t === 'open' && typeof msg.url === 'string') {
              // 失败不发 error 事件：面板已经切到浏览器签，网址打不开时浏览器自己的错误页
              // 就是反馈（普通浏览器也这样），起不来时面板按 state.error 显示原因。
              // 别的操作（切页/关页/新页）失败仍要报——那些没有"页面上看得见"的等价物
              void browserService.humanOpen(scope, msg.url)
              return
            }
            if (msg.t === 'activate' && msg.tabId !== undefined) {
              void browserService.activatePage(scope, Number(msg.tabId)).then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
              })
              return
            }
            if (msg.t === 'closeTab' && msg.tabId !== undefined) {
              void browserService.closePage(scope, Number(msg.tabId)).then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
              })
              return
            }
            if (msg.t === 'newTab') {
              void browserService.humanNewTab(scope).then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
              })
              return
            }
            if (msg.t === 'nav' && (msg.op === 'back' || msg.op === 'forward' || msg.op === 'reload')) {
              void browserService.history(scope, msg.op).then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
              })
              return
            }
            if (msg.t === 'close') {
              // 优雅关闭（cookie 落盘；下次打开免重新登录）——实例级，所有对话一起收
              void browserService.closeNow()
              return
            }
            if (msg.t === 'input') {
              // 人机共驾：面板输入回传本分区观察页（未运行时宿主拒绝，不误拉起）
              void browserService.humanInput(scope, msg)
              return
            }
          })
          ws.on('close', () => {
            browserSockets.delete(ws)
            closeWatch()
          })
          ws.on('error', () => {
            // close 会跟着来
          })
        })
        const disposeBrowserUpgrade = webCtx.webServer.registerUpgrade({
          path: '/dsh-kit/browser',
          handler: (req, socket, head) => {
            if (!sameOrigin(req)) {
              socket.destroy()
              return
            }
            bwss.handleUpgrade(req, socket, head, (ws: any) => bwss.emit('connection', ws, req))
          },
        })
        const disposeBrowserProbe = webCtx.webServer.register({
          kind: 'exact',
          path: '/dsh-kit/browser',
          handler: (_req, res) => {
            res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('dsh-kit browser: WebSocket Upgrade Required')
          },
        })
        void disposeBrowserUpgrade
        void disposeBrowserProbe

        // 对话里的链接改投内置浏览器（浏览器半边 onChatLinkClick 调用）。语义与面板
        // URL 栏一致（humanOpen：作用于观察页、不动 agent 活动页；浏览器没在跑时
        // ensure() 拉起），好处是点击不必等面板挂载与 WS 就绪。browserEnabled 关时
        // 客户端已不拦（改回官方新标签行为），这里再挡一道防止直接打端点。
        const disposeBrowserOpen = webCtx.webServer.register({
          kind: 'exact',
          path: '/dsh-kit/browser/open',
          handler: (req, res) => {
            const json = (code: number, obj: unknown) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(obj))
            }
            if (req.method !== 'POST') {
              json(405, { error: 'method not allowed' })
              return
            }
            if (req.headers.origin !== undefined && !sameOrigin(req)) {
              json(403, { error: 'cross-origin denied' })
              return
            }
            if (readSettings().browserEnabled === false) {
              json(503, { error: '内置浏览器已关闭' })
              return
            }
            let raw = ''
            req.on('data', (c) => { raw += c.toString('utf8') })
            req.on('end', () => {
              let body: any
              try {
                body = JSON.parse(raw || '{}')
              } catch {
                json(400, { error: 'bad json' })
                return
              }
              const url = String(body?.url ?? '').trim()
              if (!/^https?:\/\//i.test(url)) {
                json(400, { error: '仅支持 http/https URL' })
                return
              }
              // 分区 = 点链接时的会话（客户端带 sessionId）：链接落在该对话自己的观察页
              void browserService.humanOpen(normalizeScope(body?.sessionId), url).then((r) => {
                if (r.ok) json(200, { ok: true, tabId: r.tabId, url: r.url })
                else json(502, { error: r.error })
              })
            })
          },
        })
        void disposeBrowserOpen
      }

      // ── 手机访问网关（src/phone-gateway.ts）──
      // 网关启用位以状态文件直管（loadGatewayState/enabled 字段）：settings 读取器
      // 回填有时序滞后（实测开关写了但 reader 仍报旧值，重进设置页"恢复未开启"），
      // 手机访问页的启停按钮走 /dsh-kit/phone/gateway 端点，不经过 settings。
      // phoneEnabled 只管页面入口可见性，与网关启停解耦。
      const stateFile = defaultStateFile()
      const pageVisible = () => readSettings().phoneEnabled === true
      const phoneRemoteDomain = () => String(readSettings().phoneRemoteDomain ?? '').trim()
      /** 网关端口：设置里读，缺失/非法回落默认 3090 */
      const phonePort = (): number => {
        const n = readSettings().phonePort
        return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : PHONE_PORT
      }
      /** 重启后保留开启：勾选时启动才恢复上次启用位；不勾=每次启动网关都是关的 */
      const phoneKeepGatewayOn = () => readSettings().phoneKeepGatewayOn === true
      const warnLog = (msg: string) => console.warn(`dsh-kit: ${msg}`)
      // 远程视图（走网关）下要不要连挑选入口一起锁：宿主 picker 是 browse（应用内列目录/
      // 建文件夹，远程客户端自己就能选）时不该锁；native 或未挂载（判据未知，按宿主的
      // hide the affordance 语义）则锁——native 的 pick 在宿主屏幕弹 OS 对话框，远程端点了
      // 对话框开在电脑上、自己这边零反馈。逐次读服务而不缓存对象：profile patch 换后端的
      // 热重载后立刻跟随。
      const lockPickerEntries = (): boolean => {
        try {
          const picker = ctx.get('directoryPicker') as KitDirectoryPicker | null | undefined
          return picker?.capability?.()?.kind !== 'browse'
        } catch {
          return true
        }
      }
      // dsh web ≥ v0.1.2-alpha.5 的浏览器鉴权：网关反代须自带签名会话 cookie，
      // 否则手机端访问 index 一律 401。密钥即 credentials 服务的
      // client-connection/browser-session 记录（与 dsh web 共享），b64url 解码回
      // 32 字节原始密钥。读不到时按降级处理：网关其余功能不受影响，仅手机访问 401。
      let dshSessionSecret: Buffer | null = null
      const loadDshSessionSecret = () => {
        try {
          const creds = webCtx.credentials
          if (!creds || typeof creds.readRecord !== 'function') return
          creds.readRecord('client-connection/browser-session').then((record) => {
            const payload = record?.payload
            if (record?.kind !== 'grant' || !payload || payload.version !== 1 || typeof payload.secret !== 'string' || payload.secret === '') {
              warnLog('浏览器会话密钥记录不可用，手机访问将显示 401（网关其余功能正常）')
              return
            }
            const pad = '='.repeat((4 - (payload.secret.length % 4)) % 4)
            const raw = Buffer.from(payload.secret.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64')
            if (raw.length !== 32) {
              warnLog(`浏览器会话密钥长度异常（${raw.length}B），手机访问将显示 401（网关其余功能正常）`)
              return
            }
            dshSessionSecret = raw
          }, (error) => {
            warnLog(`读取浏览器会话密钥失败：${error?.message ?? error}，手机访问将显示 401（网关其余功能正常）`)
          })
        } catch (error) {
          warnLog(`读取浏览器会话密钥失败：${error instanceof Error ? error.message : error}，手机访问将显示 401（网关其余功能正常）`)
        }
      }
      loadDshSessionSecret()
      let phoneGw: PhoneGatewayHandle | null = null
      let phoneGwError: string | null = null
      const bootGwState = loadGatewayState(stateFile, warnLog)
      // 启动评估：readSettings 自 apply 起就是完整值（声明式配置），注入段末尾
      // 直接评估网关启用位，无需等设置服务回调。
      let phoneGwWanted = false
      const bootEvalGateway = () => {
        phoneGwWanted = phoneKeepGatewayOn() && bootGwState.enabled === true
        if (bootGwState.enabled !== phoneGwWanted) {
          saveGatewayState(stateFile, { token: bootGwState.token, enabled: phoneGwWanted }, warnLog)
        }
        syncPhoneGateway()
      }
      /** 现役实例监听的端口；null = 无实例。用于识别端口配置变更 */
      let gwPort: number | null = null
      /** 按当前启用位同步网关启停 */
      const syncPhoneGateway = () => {
        // 端口配置变更：关掉旧端口的现役实例，走下方重启动路径按新端口起步
        if (phoneGw !== null && gwPort !== null && gwPort !== phonePort()) {
          try {
            phoneGw.close()
          } catch {
            // 死实例 close 可能抛错，忽略
          }
          phoneGw = null
          phoneGwError = null
        }
        // 启动失败（如端口被占）后 phoneGw 仍持有已死实例且 state().error 落定，
        // 若只判 phoneGw === null 会永远跳过重试——带 error 的实例视为死实例，
        // 先关掉清空再重新起步。
        if (phoneGwWanted && (phoneGw === null || phoneGw.state().error !== null)) {
          if (phoneGw !== null) {
            try {
              phoneGw.close()
            } catch {
              // 死实例 close 可能抛错，忽略
            }
            phoneGw = null
            phoneGwError = null
          }
          try {
            gwPort = phonePort()
            phoneGw = startPhoneGateway({ port: gwPort, upstreamPort: webCtx.webServer.port, log: warnLog, sessionSecret: () => dshSessionSecret, lockPickerEntries })
            phoneGwError = null
          } catch (error) {
            gwPort = null
            phoneGwError = String(error instanceof Error ? error.message : error)
            warnLog(`手机访问网关启动失败：${phoneGwError}`)
          }
        } else if (!phoneGwWanted && phoneGw !== null) {
          phoneGw.close()
          phoneGw = null
        }
      }
      // 启动评估（配置在本 entry 加载时已解析，无时序差）
      bootEvalGateway()
      /** 改启用位（持久化到状态文件 + 热启停）；由 /dsh-kit/phone/gateway 端点调用。
       *  令牌轮换不再随启停自动发生——页内「刷新链接」按钮经 rotate 端点手动触发，
       *  重启/重开沿用同一令牌（已授权设备不掉线） */
      const setGatewayEnabled = (on: boolean) => {
        phoneGwWanted = on === true
        const token = phoneGw ? phoneGw.token() : loadGatewayState(stateFile, warnLog).token
        saveGatewayState(stateFile, { token, enabled: phoneGwWanted }, warnLog)
        syncPhoneGateway()
      }
      /** 带令牌的可扫码链接：局域网每个 IPv4 一条 + 远程域名（配置了才有） */
      const phoneLinks = (): Array<{ label: string; url: string }> => {
        if (!phoneGw) return []
        const k = encodeURIComponent(phoneGw.token())
        const links = lanAddresses().map((ip) => ({ label: 'lan', url: `http://${ip}:${phonePort()}/?k=${k}` }))
        if (phoneRemoteDomain() !== '') {
          links.push({ label: 'remote', url: `https://${phoneRemoteDomain()}/?k=${k}` })
        }
        return links
      }
      const phoneJson = (res: http.ServerResponse, code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(obj))
      }
      /** GET 类守卫：同源 fetch 的 GET 可能不带 Origin，带了就必须匹配 Host */
      const phoneGuardGet = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
        const origin = req.headers.origin
        if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
          phoneJson(res, 403, { error: 'cross-origin denied' })
          return false
        }
        if (req.method !== 'GET') {
          phoneJson(res, 405, { error: 'method not allowed' })
          return false
        }
        return true
      }
      const disposePhoneInfo = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/phone/info',
        handler: (req, res) => {
          if (!phoneGuardGet(req, res)) return
          phoneJson(res, 200, {
            visible: pageVisible(),
            gatewayOn: phoneGwWanted,
            running: phoneGw !== null && phoneGw.state().listening,
            error: phoneGwError ?? phoneGw?.state().error ?? null,
            port: phoneGw ? (phoneGw.port() ?? phonePort()) : phonePort(),
            remoteDomain: phoneRemoteDomain(),
            fingerprint: phoneGw ? phoneGw.fingerprint() : null,
          })
        },
      })
      const disposePhoneLink = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/phone/link',
        handler: (req, res) => {
          if (!phoneGuardGet(req, res)) return
          // 死实例（启动失败/端口被占）不出链接：扫了也是连不上
          if (!phoneGw || !phoneGw.state().listening) {
            phoneJson(res, 409, { error: phoneGwError ?? phoneGw?.state().error ?? 'gateway disabled' })
            return
          }
          phoneJson(res, 200, { links: phoneLinks(), fingerprint: phoneGw.fingerprint() })
        },
      })
      // 手动轮换端点：页内「刷新链接」按钮（+ 脚本/异常场景）作废旧链接用。
      // 启停不再自动轮换——见 setGatewayEnabled。
      const disposePhoneRotate = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/phone/rotate',
        handler: (req, res) => {
          // POST 走 JSON content-type：跨源必触发 CORS 预检被拦，Origin 存在时
          // 仍做同源校验（剥 Origin 的网关链路也能用）
          if (req.method !== 'POST') {
            phoneJson(res, 405, { error: 'method not allowed' })
            return
          }
          if (req.headers.origin !== undefined && !sameOrigin(req)) {
            phoneJson(res, 403, { error: 'cross-origin denied' })
            return
          }
          if (!phoneGw || !phoneGw.state().listening) {
            phoneJson(res, 409, { error: phoneGwError ?? phoneGw?.state().error ?? 'gateway disabled' })
            return
          }
          phoneGw.rotate()
          phoneJson(res, 200, { links: phoneLinks(), fingerprint: phoneGw.fingerprint() })
        },
      })
      const disposePhoneGateway = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/phone/gateway',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            phoneJson(res, 405, { error: 'method not allowed' })
            return
          }
          if (req.headers.origin !== undefined && !sameOrigin(req)) {
            phoneJson(res, 403, { error: 'cross-origin denied' })
            return
          }
          let raw = ''
          req.on('data', (c) => { raw += c.toString('utf8') })
          req.on('end', () => {
            let on: unknown = null
            try {
              on = JSON.parse(raw || '{}').on
            } catch {
              on = null
            }
            if (typeof on !== 'boolean') {
              phoneJson(res, 400, { error: 'body 需 {"on": true|false}' })
              return
            }
            setGatewayEnabled(on)
            // server.listen/close 是异步的：listening/error 事件在下一轮事件
            // 循环才触发，立即读 state() 会拿到旧值——实测启停回包恒报
            // running:false + error:null（前端显示"网关未运行：unknown"）。
            // 轮询到状态落定（目标达成 / 出错 / 500ms 超时）再回包。
            const t0 = Date.now()
            const settle = () => {
              const gw = phoneGw
              const running = gw !== null && gw.state().listening
              const error = phoneGwError ?? gw?.state().error ?? null
              if (running === on || error !== null || Date.now() - t0 >= 500) {
                phoneJson(res, 200, { gatewayOn: phoneGwWanted, running, error })
                return
              }
              setTimeout(settle, 30)
            }
            settle()
          })
        },
      })

      // ── 日程端点：/dsh-kit/schedule/*（src/schedule.ts 单例 store）──
      //   面板只读，端点也只有读：GET data?from&to → { events(raw 全量),
      //   occurrences(区间展开,带 endDate/state), orphans }；GET stats?scope&date → 统计。
      //   写路径只走 agent 工具（工具直调 store，不经 HTTP）与望舒端；
      //   重复展开只在宿主做（客户端只渲染 occurrence）；个人规模 raw 全量直发。
      const schedJson = (res: http.ServerResponse, code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(obj))
      }
      const disposeSchedule: Array<() => void> = []
      const schedRoute = (
        path: string,
        handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void,
      ) => {
        disposeSchedule.push(
          webCtx.webServer.register({
            kind: 'exact',
            path,
            handler: (req, res) => {
              handler(req, res, new URL(req.url ?? '/', 'http://dsh-kit.local'))
            },
          }),
        )
      }
      const schedDateParam = (url: URL, key: 'from' | 'to' | 'date'): string => {
        const raw = url.searchParams.get(key) ?? ''
        return isDateStr(raw) ? raw : todayStr()
      }
      schedRoute('/dsh-kit/schedule/data', (req, res, url) => {
        if (req.method !== 'GET') return schedJson(res, 405, { error: 'method not allowed' })
        const from = schedDateParam(url, 'from')
        const to = schedDateParam(url, 'to')
        schedJson(res, 200, {
          events: scheduleStore.list(),
          occurrences: scheduleStore.occurrences(from, to),
          orphans: scheduleStore.listOrphans(),
        })
      })
      schedRoute('/dsh-kit/schedule/stats', (req, res, url) => {
        if (req.method !== 'GET') return schedJson(res, 405, { error: 'method not allowed' })
        const rawScope = url.searchParams.get('scope') ?? 'day'
        const scope = rawScope === 'week' || rawScope === 'month' ? rawScope : 'day'
        schedJson(res, 200, scheduleStore.stats(scope, schedDateParam(url, 'date')))
      })

      // ── 知识库（vault，src/vault.ts + src/vault-fs.ts）──
      // vaultRoot 是配置页配置的绝对目录，在工作区外；读端点出索引 / 单页 mtime /
      // 全文搜索，写端点（src/vault-fs.ts）只管目录级文件管理：新建 / 重命名 /
      // 移动 / 导入 / 删除。页面正文的写入仍归 agent 文件工具与外部编辑器。
      // 全部端点在 vaultRoot 未配置/不存在时回 400 vault-not-configured。
      const disposeVault: Array<() => void> = []
      const vaultRoute = (
        path: string,
        handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void,
      ) => {
        disposeVault.push(
          webCtx.webServer.register({
            kind: 'exact',
            path,
            handler: (req, res) => {
              handler(req, res, new URL(req.url ?? '/', 'http://dsh-kit.local'))
            },
          }),
        )
      }
      const vaultGuard = (res: http.ServerResponse): string | null => {
        // 总开关关着就整片端点一起拒：知识库默认关，前端入口同步隐藏，
        // 这里挡的是直接打端点的路径
        if (readSettings().vaultEnabled !== true) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify({ error: 'vault-disabled' }))
          return null
        }
        const root = vaultScanner.root()
        if (root === null) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify({ error: 'vault-not-configured' }))
          return null
        }
        return root
      }
      const vaultJson = (res: http.ServerResponse, code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(obj))
      }
      vaultRoute('/dsh-kit/vault/index', (req, res) => {
        if (req.method !== 'GET') return vaultJson(res, 405, { error: 'method not allowed' })
        const root = vaultGuard(res)
        if (root === null) return
        void vaultScanner
          .scan()
          .then((index) => vaultJson(res, 200, index ?? { root: null, spaces: [], pages: [] }))
          .catch((error) => vaultJson(res, 500, { error: error instanceof Error ? error.message : String(error) }))
      })
      // 外部修改实时刷新：只回打开页的 mtime，不读正文——前端
      // 轮询发现 mtime 变化且本地无脏改即自动重读整页（AI/编辑器改文件零手动刷新）
      vaultRoute('/dsh-kit/vault/stat', (req, res, url) => {
        if (req.method !== 'GET') return vaultJson(res, 405, { error: 'method not allowed' })
        const root = vaultGuard(res)
        if (root === null) return
        const resolved = path.resolve(String(url.searchParams.get('path') ?? ''))
        const rel = path.relative(root, resolved)
        if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') return vaultJson(res, 400, { error: '页面不在 vault 内' })
        try {
          const stat = fs.statSync(resolved)
          return vaultJson(res, 200, { mtimeMs: stat.mtimeMs })
        } catch {
          // 文件已被外部删除：回 gone，前端按需重读（页签显示已消失）
          return vaultJson(res, 200, { gone: true })
        }
      })
      vaultRoute('/dsh-kit/vault/search', (req, res, url) => {
        if (req.method !== 'GET') return vaultJson(res, 405, { error: 'method not allowed' })
        const root = vaultGuard(res)
        if (root === null) return
        const q = (url.searchParams.get('q') ?? '').slice(0, 200)
        void vaultScanner
          .search(q, 20)
          .then((result) => vaultJson(res, 200, result ?? { root, results: [] }))
          .catch((error) => vaultJson(res, 500, { error: error instanceof Error ? error.message : String(error) }))
      })

      // ── 文件管理端点（src/vault-fs.ts）──
      // 面板树上的目录级管理：create / rename / move / import / delete。路径一律
      // 绝对路径且必须落在 vault 根内（resolveInside 拒 `..` 段并 realpath 比包含，
      // 挡软链与短名绕行）；撞名策略由前端选（skip/overwrite/rename），资料库那一支
      // 固定自动加序号。笔记页改名 / 移动会顺带改写指向它的双链（目录整体搬移不改，
      // 文件名没变解析结果就不变）；删除走回收站。导入两条来源：本机绝对路径直拷
      // （md 页连带把页内引用的本地图片收进 attachments/）与浏览器上传的字节。
      const vaultReadBody = (req: http.IncomingMessage, limit: number): Promise<Record<string, unknown>> =>
        new Promise((resolve) => {
          let raw = ''
          req.on('data', (c) => {
            raw += c
            if (raw.length > limit) req.destroy()
          })
          req.on('end', () => {
            try {
              const body: unknown = JSON.parse(raw === '' ? '{}' : raw)
              resolve(body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {})
            } catch {
              resolve({})
            }
          })
          req.on('error', () => resolve({}))
        })
      const VAULT_BODY_LIMIT = 1024 * 1024
      /** 导入上限：base64 文本长度（≈32MB 原始字节），PDF 这类文献够用 */
      const VAULT_IMPORT_LIMIT = 48 * 1024 * 1024
      const vaultPost = (
        path: string,
        action: (body: Record<string, unknown>, root: string) => unknown,
        limit: number = VAULT_BODY_LIMIT,
      ) => {
        vaultRoute(path, (req, res) => {
          if (req.method !== 'POST') return vaultJson(res, 405, { error: 'method not allowed' })
          if (!sameOrigin(req)) return vaultJson(res, 403, { error: 'cross-origin denied' })
          const root = vaultGuard(res)
          if (root === null) return
          void vaultReadBody(req, limit).then((body) => {
            void Promise.resolve()
              .then(() => action(body, root))
              .then((result) => vaultJson(res, 200, { ok: true, ...(result as object) }))
              .catch((error) => vaultJson(res, 400, { error: error instanceof Error ? error.message : String(error) }))
          })
        })
      }
      vaultPost('/dsh-kit/vault/create', (body, root) =>
        createEntry(root, String(body.dir ?? ''), body.name, body.kind === 'dir' ? 'dir' : 'page'),
      )
      vaultPost('/dsh-kit/vault/rename', async (body, root) => {
        // 双链改写要用**操作前**的页面集合（改完名字旧页已不在索引里，判重名会走偏）
        const index = await vaultScanner.scan()
        return renameEntry(root, String(body.path ?? ''), body.name, index?.pages ?? [])
      })
      vaultPost('/dsh-kit/vault/move', async (body, root) => {
        const index = await vaultScanner.scan()
        return moveEntry(root, String(body.path ?? ''), String(body.dest ?? ''), parseConflict(body.conflict), index?.pages ?? [])
      })
      vaultPost(
        '/dsh-kit/vault/import',
        async (body, root) => {
          const data = typeof body.dataBase64 === 'string' && body.dataBase64 !== '' ? Buffer.from(body.dataBase64, 'base64') : undefined
          return importEntry(root, {
            destAbs: String(body.dest ?? ''),
            name: body.name,
            fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
            srcPath: typeof body.src === 'string' ? body.src : undefined,
            data,
            conflict: parseConflict(body.conflict),
          })
        },
        VAULT_IMPORT_LIMIT,
      )
      vaultPost('/dsh-kit/vault/delete', async (body, root) => {
        const paths = Array.isArray(body.paths) ? body.paths : []
        return deleteEntries(root, paths)
      })

      return () => {
        disposeVendor()
        disposePhoneInfo()
        disposePhoneLink()
        disposePhoneRotate()
        disposePhoneGateway()
        for (const dispose of disposeSchedule) dispose()
        for (const dispose of disposeVault) dispose()
        if (phoneGw) phoneGw.close()
      }
    }, 'dsh-kit: vendor/config/phone/vault/schedule endpoints')
  })
}
