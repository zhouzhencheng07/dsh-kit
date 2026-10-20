// dsh-kit 用量与监视组件（宿主半边入口）
//
// 组件化切片：/dsh-kit/usage 聚合端点 + 用量芯片（client/bundle.js）+ 会话通知
// + OpenCode Go 会话头
// 按会话注入（opencode-session.ts），从 dsh-kit 主包迁出，独立成 entry（bundle
// patch 插单，profile 里行 id: monitor）。provider 配置读取不依赖主包：经宿主
// configEditor 服务现读 llm-pi-ai entry 的合成配置
// （inherited+override 两层 providers 浅合并），凭证经宿主 credentials 按引用
// 解析，key 不出宿主进程。


import { registerUsageRoutes } from './usage.ts'
import { applyOpenCodeSessionHeader } from './opencode-session.ts'
import { loadDep, sameOrigin } from '../core/index.ts'
import { kitLogEmit } from '../core/log.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitWebCtx {
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => void | Promise<void> }): () => void }
  credentials: Record<string, unknown>
}

// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // 用量与余额芯片开关。默认开——key 不在本组件配置里（复用模型配置
        // llm-pi-ai.providers 的凭证引用），开 = /dsh-kit/usage 端点放行 +
        // client 半边出余额/配额芯片，关 = 端点 403 + 芯片不出。
        usageEnabled: z.boolean().default(true).volatile(),
        // 会话通知（纯浏览器端消费，宿主不读）：回合收尾、上下文压缩完成或 agent 提问时，
        // 若页面不在前台（或事件不属于当前打开的会话）弹桌面通知——浏览器 Notification
        // API，未授权就不发（不再退回标题闪烁）。收尾按 turn/end 的 reason 分类（完成/出错/中止/
        // 卡住/撞上限各有文案）。一个总开关管全部提醒，不分类配置。
        notifyEnabled: z.boolean().default(true).volatile(),
        // OpenCode Go 会话头注入（宿主侧 opencode-session.ts）：发往 opencode /
        // opencode-go 的模型请求按会话带 x-opencode-session，网关缺它直接 400。
        // 门控在 llm/stream 监听里现读，关掉当场生效（不用重启）；行关闭 = 模块
        // 不物化 = 同样不注入。
        sessionHeaderEnabled: z.boolean().default(true).volatile(),
      })
    : undefined

export async function apply(ctx: any, config: KitSettings = {}): Promise<void> {
  const defaults: KitSettings = Config
    ? Config({})
    : { usageEnabled: true, notifyEnabled: true, sessionHeaderEnabled: true }
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

  // OpenCode Go 会话头按会话注入（实现见 ./opencode-session.ts）。本组件是它唯一的
  // 归属：开关走本行配置页，行关闭则模块不物化、等于不注入。
  applyOpenCodeSessionHeader(ctx, {
    log: (m) => kitLogEmit('warn', 'session-header', '', m),
    enabled: () => readSettings().sessionHeaderEnabled !== false,
  })

  const disposers: Array<() => void> = []
  ctx.inject(['webServer', 'credentials'], (webCtx: KitWebCtx) => {
    // 组件自己的只读配置快照：client 半边拉它做芯片门控（各组件行同一口径：200 = 行启用、404 = 行关闭）
    disposers.push(
      webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit-monitor/config',
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
      }),
    )
    disposers.push(
      registerUsageRoutes({
        webServer: webCtx.webServer,
        credentials: webCtx.credentials,
        readSettings: () => readSettings(),
        readProviderConfig: () => {
          // entry 配置由 configEditor 读：inherited = bundle 层合成值，
          // override = profile patch（cordis.patch.yml）层，providers 浅合并后者优先
          try {
            const editor = ctx.get('configEditor') as
              | { configuration?: () => Array<{ entry?: { options?: { id?: string } }; inherited?: unknown; override?: unknown }> }
              | undefined
            const row = editor?.configuration?.().find((r) => r.entry?.options?.id === 'llm-pi-ai')
            if (!row) return null
            const providers: Record<string, unknown> = {}
            for (const layer of [row.inherited, row.override]) {
              if (layer !== null && typeof layer === 'object') Object.assign(providers, (layer as { providers?: unknown }).providers)
            }
            return { providers }
          } catch {
            return null
          }
        },
      }),
    )
  })

  // entry 注销时撤路由（disposers 由注入回调在 apply 期间同步填充）
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
