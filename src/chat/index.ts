// dsh-kit/chat 组件（宿主半边入口）——对话小窗
//
// 能力本体在 client/bundle.js 的 chatModule（贴边常驻把手 + 浮窗外壳 + 会话绑定）；
// 本模块只做两件事：暴露行可达性探针，以及本组件的细粒度设置。
//   GET /dsh-kit-chat/config —— 生效配置快照（client 门控与可达性探针：404 = 行关闭）
// 行开关（插件页组件行 switch）= 总开关：行禁用 → 本模块不物化 → 端点 404 → client
// 半边整体不注册（把手与浮窗都不出现）。
//
// 小窗不需要自己的端点：会话、工作区、历史全走宿主官方的 sessions / workspace 服务。

import http from 'node:http'

import { loadDep, sameOrigin } from '../core/index.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect(fn: () => void | (() => void), label?: string): void
}

interface KitWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void> }): () => void
}

interface KitWebCtx {
  webServer: KitWebServer
}

export const name = 'dsh-kit/chat'

// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile 写入
// = 热提交，readSettings 统一解引用后每次现读。取值语义与默认值的唯一副本在
// client/bundle.js 的 CHAT_CFG_DEFAULTS（渲染级检查钉住两处同源）。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // 把手与浮窗贴左侧（false = 贴右侧）。
        edgeLeft: z.boolean().default(false).volatile(),
        // 记住浮窗的位置与尺寸（跨刷新恢复）。
        rememberWindow: z.boolean().default(true).volatile(),
        // 记住上次用的工作区与会话（小窗是独立的，与主面各自切换）。
        rememberTarget: z.boolean().default(true).volatile(),
      })
    : undefined

export async function apply(ctx: KitCtx, config: KitSettings = {}): Promise<void> {
  const defaults: KitSettings = Config ? Config({}) : {}
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

  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-kit-chat/config',
      handler: (req, res) => {
        const json = (code: number, obj: unknown) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'GET') {
          json(405, { error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          json(403, { error: 'cross-origin denied' })
          return
        }
        json(200, readSettings())
      },
    })
  })
}
