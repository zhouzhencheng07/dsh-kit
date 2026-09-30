// dsh-kit 内置浏览器组件（宿主半边入口）
//
// 能力本体在 ./browser.ts（BrowserService：vendored playwright 驱动系统 Edge/Chrome、
// 按会话分区隔离的页集、帧流中继）与 ./browser-tools.ts（7 个 browser_* agent 工具）；
// 本文件是组件的装配面：agent 工具注册、面板端点、配置。
// 组件行关闭 = 本模块不物化 = 工具不注册、端点不挂、面板与链接改投在 client 半边
// 探到 404 后整体不生效——行开关就是这块能力的总开关。
// 配置：chatOpenLinkInBrowser（对话链接改投内置浏览器）、hideOfficialBrowserEntry
// （隐藏官方「浏览器」入口，纯外观）；编辑面在插件页本组件行的「配置」。
//
// 端点（同源校验；webserver 默认只绑 loopback）：
//   GET  /dsh-kit-browser/config —— 生效配置快照（client 门控与可达性探针：404 = 行关闭）
//   WS   /dsh-kit/browser        —— 面板面（state/event/frame 广播 + 人操作回传）
//   GET  /dsh-kit/browser        —— 非 Upgrade 请求的 426 提示
//   POST /dsh-kit/browser/open   —— 对话链接改投（不依赖面板已挂载/已连 WS）

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'

import { BrowserService, normalizeScope, DEFAULT_SCOPE } from './browser.ts'
import { buildBrowserTools } from './browser-tools.ts'
import { loadToolsModule, sameOrigin } from '../core/index.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
  get(name: string): unknown
}

interface KitWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void> }): () => void
  registerUpgrade(route: { path: string; handler: (req: http.IncomingMessage, socket: import('node:net').Socket, head: Buffer) => void }): () => void
}

/**
 * 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录），loadDep 的
 * 第三锚点用。非 DSH 环境返回 null。
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

/** 多锚点加载宿主运行时依赖（schemastery / ws，不在本包 dependencies 里），同主包口径 */
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

const require = createRequire(import.meta.url)

// 面板 WebSocket 服务器（ws 是 DSH 自身依赖，不在本包 dependencies 里）；
// 取不到只影响面板帧流，agent 工具照常可用
const WebSocketServer = loadDep('ws')?.WebSocketServer ?? null
if (!WebSocketServer) {
  console.warn('dsh-kit: ws 不可用，浏览器面板不可用')
}

export const name = 'dsh-kit/browser'

// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用后每次现读。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // 对话里的 http(s) 链接点击改投内置浏览器（默认开）：门控在 client 半边
        //（需浏览器组件可用），这里只提供 /dsh-kit/browser/open 这条管道
        chatOpenLinkInBrowser: z.boolean().default(true).volatile(),
        // 隐藏官方右栏「浏览器」入口（默认关；纯外观增强，client 挂 body 标记）
        hideOfficialBrowserEntry: z.boolean().default(false).volatile(),
      })
    : undefined

export async function apply(ctx: KitCtx, config: KitSettings = {}): Promise<void> {
  const defaults: KitSettings = Config ? Config({}) : { chatOpenLinkInBrowser: true, hideOfficialBrowserEntry: false }
  // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
  const readRef = (v: unknown): any =>
    v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function'
      ? (v as { get: () => unknown }).get()
      : v
  const readSettings = (): any => {
    const out: Record<string, unknown> = { ...defaults }
    for (const [key, value] of Object.entries(config ?? {})) out[key] = readRef(value)
    return out
  }

  // ── 浏览器服务（懒启动：首次工具调用/面板 watch 才拉起 Edge）──
  // 这里只建对象与注册；dispose 挂 ctx.effect（插件卸载/行收起时关浏览器，profile 保留）。
  const browserService = new BrowserService({ log: (m) => console.log(`dsh-kit: ${m}`) })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      void browserService.dispose()
    })
  }

  // agents 注册表（dsh-agent，宿主组合里的可选服务）：分区解析沿 parentSession 上溯用；
  // 缺失时分区落 DEFAULT_SCOPE。
  let agentsRegistry: any = null
  ctx.inject(['agents'], (capacityCtx: { agents: any }) => {
    agentsRegistry = capacityCtx.agents
  })

  // 浏览器分区解析（工具侧）：调用方会话 id；子代理沿 durable parentSession 上溯到仍存活的
  // 最顶层会话——子代理的浏览归它所属的主对话，主对话面板里看得见，不另开隐身页签。
  // 认不出调用方会话（宿主辅助调用 / 注册表未挂）就落 DEFAULT_SCOPE，与面板的兜底同一格。
  const scopeOf = (exec?: unknown): string => {
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

  const toolsMod = browserService.available ? await loadToolsModule((m) => console.warn(`dsh-kit: ${m}`)) : null
  let toolDefs: ReturnType<typeof buildBrowserTools> | null = null
  try {
    toolDefs =
      toolsMod && typeof toolsMod.defineTool === 'function'
        ? buildBrowserTools({ defineTool: toolsMod.defineTool, service: browserService, ctx, scopeOf })
        : null
  } catch (error) {
    // 构建失败降级为无浏览器工具，不炸插件树（可用性优先）
    console.warn(`dsh-kit: 浏览器工具构建失败，本组件浏览器工具未注册：${error instanceof Error ? error.message : error}`)
    toolDefs = null
  }
  if (browserService.available && !toolDefs) {
    console.warn('dsh-kit: dsh-tools 不可达或形态不符，浏览器工具未注册（其余功能不受影响）')
  }
  ctx.inject(['settings', 'tools'], (caps: { tools: { register: (def: unknown) => void } }) => {
    if (!toolDefs) return
    for (const def of toolDefs) {
      try {
        caps.tools.register(def)
      } catch (error) {
        console.warn(`dsh-kit: 浏览器工具注册失败：${error instanceof Error ? error.message : error}`)
      }
    }
  })

  // webServer 可能在本组件 apply 之后才挂载，用动态注入等它就绪
  ctx.inject(['webServer'], (webCtx: { webServer: KitWebServer; effect(fn: () => void | (() => void), label?: string): void }) => {
    webCtx.effect(() => {
      // ── 生效配置只读端点（client 门控与可达性探针）──
      // client 启动拉一次喂 cfgFromSnapshot；行关闭时本端点随模块不物化而 404，
      // client 探到 404 就整体不注册（面板、右栏签、链接改投全不出现）。
      const disposeBrowserConfig = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit-browser/config',
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify(readSettings()))
        },
      })

      // ── 浏览器面板 WebSocket 端点（browser.ts 的面板面）──
      // 协议：连接即回 state → 浏览器端；watch {on, tabId}（**按页**订阅帧流，每页
      // 一条 CDP 会话、该页无订阅者即停流）/ open {url, tabId}（URL 栏导航，作用于
      // 该页）/ closeTab {tabId}（关页）/
      // nav {op, tabId}（back/forward/reload，作用于该页）/ newTab（＋，回包带新页 id）/
      // input {…, tabId}（人机共驾，作用于该页）。面板一签一页，一连接只画自己那张签的页，
      // 故帧按页投递（frame 消息带 tabId）。
      // → 宿主。每条消息可带 scope（会话 id，见 normalizeScope）：连接按它认领分区，
      // state/event/frame 都按分区投递——不同对话各看各的页签与画面，浏览器实例与
      // profile 仍是全局共享的。面板挂舞台「浏览器」功能签，关闭标签即断 WS。
      // 同源校验同终端。另有 HTTP 侧的 /dsh-kit/browser/open（见下）：对话链接点击改投
      // 内置浏览器，走它而不是 WS——点击发生时面板未必已挂载/已连上，HTTP 不依赖任一状态。
      // 卸载时要摘的东西（行关闭 = 端点不挂；不摘的话重开一轮会叠两套）
      const mounted: { off?: () => void; bwss?: { close: () => void }; upgrade?: () => void; probe?: () => void } = {}
      if (browserService.available && WebSocketServer) {
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
        mounted.off = browserService.on((evt) => {
          // ws 投影统一字段形状：state/closed 无 tabId/url/title（投影为 undefined，JSON 序列化时丢弃）
          const flat = evt as { kind: string; scope?: string; tabId?: number; url?: string; title?: string }
          const scoped = evt.kind === 'scope' || evt.kind === 'navigated' || evt.kind === 'crashed'
          broadcast({ t: 'event', kind: flat.kind, scope: flat.scope, tabId: flat.tabId, url: flat.url, title: flat.title }, scoped ? flat.scope : undefined)
          // 页集/指针变了要重发 state（closed/state 是实例级的，各连接按自己分区取）
          if (scoped && flat.scope !== undefined) sendStateScope(flat.scope)
          else sendStateAll()
        })
        const bwss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
        mounted.bwss = bwss
        bwss.on('connection', (ws: any) => {
          browserSockets.set(ws, DEFAULT_SCOPE)
          /** 本连接订着的「分区 + 页」（面板一签一页，一连接只画自己那张签的页）；
           *  换分区或换页时先退订旧的 */
          let watched: { scope: string; tabId: number } | null = null
          const scopeOfConn = () => browserSockets.get(ws) ?? DEFAULT_SCOPE
          const openWatch = (scope: string, tabId: number) => {
            // 帧按页投：同页多连接复路同一条 CDP 会话，不同页各挂各的流。连接本身
            // 当订阅者标识，退订只摘自己那一份。
            // 失败必须回话：页不存在（宿主重启后页号从头数，而签地址里还留着旧页号）
            // 时静默丢弃的话，这张签会永久空白且没有任何症状
            void browserService
              .watcherOpen(scope, tabId, ws, (frameTabId, data) =>
                sendTo(ws, { t: 'frame', tabId: frameTabId, data }))
              .then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
              })
          }
          const closeWatch = () => {
            if (watched === null) return
            browserService.watcherClose(watched.scope, watched.tabId, ws)
            watched = null
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
            // 面板每条消息都带 scope（会话 id）：认领/切换分区。分区换 = 页集也换，
            // 旧订阅随旧分区一起摘掉；新分区看哪一页由客户端随后的 watch 消息说
            //（拿旧页号去新分区订必然订不到——页集是按分区隔离的）
            if (typeof msg.scope === 'string') {
              const next = normalizeScope(msg.scope)
              if (next !== scopeOfConn()) {
                browserSockets.set(ws, next)
                closeWatch()
                sendState(ws)
              }
            }
            const scope = scopeOfConn()
            if (msg.t === 'watch') {
              // 看帧不等于开浏览器：面板打开/重新激活都只订流，浏览器由「有理由的
              // 动作」拉起（地址栏导航、「＋」新页签、agent 工具、对话链接改投）。
              // 页还不存在时订阅会被拒并回一条 error（见 openWatch），客户端重开签即可。
              // null 与 undefined 同义：没有页。Number(null) 是 0，会去订/关「0 号页」
              const want = msg.on === true && msg.tabId != null ? Number(msg.tabId) : null
              if (want !== null && (watched === null || watched.scope !== scope || watched.tabId !== want)) {
                closeWatch()
                watched = { scope, tabId: want }
                openWatch(scope, want)
              } else if (want === null && watched !== null) {
                closeWatch()
              }
              return
            }
            if (msg.t === 'open' && typeof msg.url === 'string') {
              // 失败不发 error 事件：面板已经切到浏览器签，网址打不开时浏览器自己的错误页
              // 就是反馈（普通浏览器也这样），起不来时面板按 state.error 显示原因。
              // 别的操作（关页/新页）失败仍要报——那些没有"页面上看得见"的等价物
              const target = msg.tabId == null ? null : Number(msg.tabId)
              // fresh = 这张签还没有页（从入口开出来的那张）：另开一页，不动别的签正在看的页
              void browserService.humanOpen(scope, msg.url, target, msg.fresh === true && target === null)
              return
            }

            if (msg.t === 'closeTab' && msg.tabId != null) {
              void browserService.closePage(scope, Number(msg.tabId)).then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
              })
              return
            }
            if (msg.t === 'newTab') {
              void browserService.humanNewTab(scope).then((r) => {
                if (!r.ok) sendTo(ws, { t: 'event', kind: 'error', message: r.error })
                else sendTo(ws, { t: 'newTab', tabId: r.tabId ?? null })
              })
              return
            }
            if (msg.t === 'nav' && (msg.op === 'back' || msg.op === 'forward' || msg.op === 'reload')) {
              void browserService.history(scope, msg.op, msg.tabId == null ? null : Number(msg.tabId)).then((r) => {
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
              // 人机共驾：面板输入回传该签对应的页（未运行时宿主拒绝，不误拉起）
              void browserService.humanInput(scope, msg, msg.tabId == null ? null : Number(msg.tabId))
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
        mounted.upgrade = disposeBrowserUpgrade
        mounted.probe = disposeBrowserProbe
      }

      // 对话里的链接改投内置浏览器（client 半边 onChatLinkClick 调用）。语义与面板
      // URL 栏一致（humanOpen：作用于该签那一页、不动 agent 活动页；浏览器没在跑时
      // ensure() 拉起），好处是点击不必等面板挂载与 WS 就绪。
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
          if (!sameOrigin(req)) {
            json(403, { error: 'cross-origin denied' })
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
            // 分区 = 点链接时的会话（客户端带 sessionId）：链接落在该对话自己的分区，回包页 id 开签
            // newPage：点链接要另开一页。不给的话 humanOpen 落本分区「观察页」——
            // 正在看的那张签内容会被顶掉、前进后退历史丢失，还为同一页多开一张签
            void browserService.humanOpen(normalizeScope(body?.sessionId), url, null, true).then((r) => {
              if (r.ok) json(200, { ok: true, tabId: r.tabId, url: r.url })
              else json(502, { error: r.error })
            })
          })
        },
      })
      // 行关闭/重载插件时端点必须跟着没：少了这个，关掉行之后
      // /dsh-kit-browser/config 与 /dsh-kit/browser 仍对外应答，再开一轮还会叠两套
      return () => {
        mounted.off?.()
        mounted.upgrade?.()
        mounted.probe?.()
        disposeBrowserOpen()
        disposeBrowserConfig()
        try {
          mounted.bwss?.close()
        } catch {
          // 已关
        }
      }
    })
  })
}
