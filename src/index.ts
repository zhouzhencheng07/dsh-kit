// dsh-kit — DSH 页面能力套件（主行宿主半边）
//
// 本文件只剩主行自己那点装配：手机访问网关（./phone-gateway.ts）、vendor 静态资源
// （xterm / qrcode / 知识库阅读器的 TipTap 与 KaTeX）、主行生效配置快照
// GET /dsh-kit/config、OpenCode Go 会话头注入（./core/opencode-session.ts）。
// 页面能力本身已按组件行拆开（cordis.patch.yml 里 insert 七行，行 name = 包名 +
// exports 子路径）：dsh-kit/files（文件树 · 源代码管理）、dsh-kit/skills（技能）、
// dsh-kit/terminal（终端）、dsh-kit/monitor（用量与监视）、dsh-kit/search（网页搜索）、
// dsh-kit/browser（内置浏览器）、dsh-kit/vault（知识库 · 日程）——行关闭 = 该子模块
// 不物化 = 它的端点与 agent 工具一起消失。
//
// 浏览器半边（client/bundle.js）：各功能入口注册在对话输入框工具行
// （conversation.input.left），面板本体挂 shell.overlay 与官方右栏签；组件各自的
// client 面住在 bundle 尾部的 xModule 隔离壳里，激活由根 apply 尾部循环触发。
// 插件配置页（Config schema 声明式模型）分两层：主行管手机访问（本文件 Config），
// 组件行管自己的细粒度开关（如知识库的 vaultRoot）。
//
// 本行端点（webserver 默认只绑 loopback）：
//   GET  /dsh-kit/config            —— 主行生效配置快照（client 功能门控的数据源）
//   GET  /dsh-kit/vendor/*          —— xterm / qrcode / richeditor / katex 静态资源
//   GET  /dsh-kit/phone/info|link   —— 手机访问状态与带令牌链接
//   POST /dsh-kit/phone/rotate|gateway —— 轮换令牌 / 热启停网关

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { applyOpenCodeSessionHeader, sameOrigin } from './core/index.ts'
import { startPhoneGateway, lanAddresses, defaultStateFile, loadGatewayState, saveGatewayState } from './phone-gateway.ts'
import type { PhoneGatewayHandle } from './phone-gateway.ts'

/** 手机访问网关对外端口（0.0.0.0）的默认值，可在设置里改（phonePort，1-65535） */
const PHONE_PORT = 3090

export const name = 'dsh-kit'

const require = createRequire(import.meta.url)

// ── 宿主对象最小依赖面 ──
// cordis ctx / webServer / settings 等都是运行时才挂载的宿主组合对象，类型不随
// 插件分发；这里只声明本插件实际触达的成员（与 browser-tools.ts 同一约定）。inject 回调的 services 袋按 any 传入，各回调自行具化参数类型。

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

// ── 插件设置 schema（0.1.7 起的声明式模型）──
// loader 读 profile 补丁里本 entry 的 config，按 Config 解析出默认值后传进 apply
// 第二参；设置页挂在插件页本插件行的「配置」（plugins.row.config）。
// **字段必须 .volatile()**：宿主 SettingsForms 只把 volatile 字段投影进表单
// （非 volatile 只能改 profile 补丁文件，界面上不可见）；volatile 写入 = 热提交
// （原地改 fiber config 的 ref，不重启 entry），所以 readSettings 统一解引用。
// Config 必须在模块加载期就存在（loader 实例化前读），所以用 loadDep 同步解析
// schemastery。解析失败 → 不导出 Config（本 entry 无设置页），
// apply 里落 FALLBACK_SETTINGS 兜底，插件其余功能不受影响。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // phoneEnabled = 「手机访问」页入口可见性（纯显示开关）。
        // 网关启停不走 settings（读取器回填滞后），改由状态文件 + kit 端点直管。
        phoneEnabled: z.boolean().default(true).volatile(),
        phoneRemoteDomain: z.string().default('').volatile(),
        phonePort: z.number().step(1).min(1).max(65535).default(3090).volatile(),
        phoneKeepGatewayOn: z.boolean().default(false).volatile(),
        // 各组件行的细粒度配置都在组件自己的 Config 里（src/<组件>/index.ts）：
        // 知识库 vaultRoot 在 dsh-kit/vault，浏览器链接改投 / 官方入口掩码在
        // dsh-kit/browser，用量监视在 dsh-kit/monitor，搜索条数在 dsh-kit/search，
        // 文件树 / 源代码管理在 dsh-kit/files。行开关 = 该组件的总开关，所以主行
        // 不再有 vaultEnabled / browserEnabled / monitorEnabled / terminalEnabled
        // 这类与行同粒度的字段。
        // 键位不在这里：左右栏开合归宿主自带快捷键，本插件的终端/知识库命令在
        // client 半边注册进宿主 shortcuts 服务（官方「快捷键」页录制与持久化）
      })
    : undefined

/** Config 缺席（schemastery 不可达）时 readSettings 的兜底：只覆盖宿主消费的关键键
 *  （手机端口），其余键缺省行为由读取侧的比较式兜住 */
const FALLBACK_SETTINGS: KitSettings = {
  phonePort: PHONE_PORT,
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
  // 消费点（vaultRoot 门控、手机网关端口等）现读。
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
  // 网页搜索已随组件化迁入 dsh-kit/search（src/search/），
  // 技能池迁入 dsh-kit/skills（src/skills/），内置浏览器迁入 dsh-kit/browser
  // （src/browser/），主包不再装配这三块。
  // OpenCode Go 会话头按会话注入（实现见 src/core/opencode-session.ts）
  applyOpenCodeSessionHeader(ctx, (m) => console.warn(`dsh-kit: ${m}`))

  // 日程工具（src/vault/index.ts）与知识库扫描器随组件行迁走，主行不再装配。

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

      return () => {
        disposeVendor()
        disposePhoneInfo()
        disposePhoneLink()
        disposePhoneRotate()
        disposePhoneGateway()
        if (phoneGw) phoneGw.close()
      }
    }, 'dsh-kit: vendor/config/phone endpoints')
  })
}
