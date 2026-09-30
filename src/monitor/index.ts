// dsh-kit 用量与监视组件（宿主半边入口）
//
// 组件化切片：/dsh-kit/usage 聚合端点 + 用量芯片（client/bundle.js）+ 输出侧
// 死循环熔断（loop-breaker.ts，宿主侧覆盖全部会话）+ 会话通知，从 dsh-kit 主包
// 迁出，独立成 entry（bundle patch 插单，profile 里行 id: monitor）。provider
// 配置读取不依赖主包：经宿主 configEditor 服务现读 llm-pi-ai entry 的合成配置
// （inherited+override 两层 providers 浅合并），凭证经宿主 credentials 按引用
// 解析，key 不出宿主进程。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { registerUsageRoutes } from './usage.ts'
import { registerLoopGuard } from './loop-breaker.ts'
import { sameOrigin } from '../core/index.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitWebCtx {
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => void | Promise<void> }): () => void }
  credentials: Record<string, unknown>
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

/** 多锚点加载宿主运行时依赖（schemastery，不在本包 dependencies 里），同主包口径 */
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
        // 死循环熔断（宿主侧 loop-breaker.ts 消费，客户端也读同名字段）：
        // 模型输出出现复读、绕圈或单步过长时，宿主侧 cancel 该 agent 的当前
        // 回合——覆盖全部会话，不依赖页面开着。客户端那一层只管当前会话的
        // 补充检测与打断话术。
        monitorEnabled: z.boolean().default(true).volatile(),
        // 单步输出字符兜底阈值：复读到这么长必被拦下
        monitorStepMaxChars: z.number().step(1).min(20000).max(400000).default(60000).volatile(),
        // 单会话最多自动打断几次（客户端话术用；宿主熔断每次都停，不受此限）
        monitorMaxLoopBreaks: z.number().step(1).min(1).max(10).default(3).volatile(),
        // 尾部整块重复的判定次数（另两条判据不依赖它）
        monitorRepeatThreshold: z.number().step(1).min(2).max(10).default(3).volatile(),
        // 会话通知（纯浏览器端消费，宿主不读）：回合收尾、上下文压缩完成或 agent 提问时，
        // 若页面不在前台（或事件不属于当前打开的会话）弹桌面通知——浏览器 Notification
        // API，未授权时退标题闪烁。收尾按 turn/end 的 reason 分类（完成/出错/中止/
        // 卡住/撞上限各有文案）。一个总开关管全部提醒，不分类配置。
        notifyEnabled: z.boolean().default(true).volatile(),
      })
    : undefined

export async function apply(ctx: any, config: KitSettings = {}): Promise<void> {
  const defaults: KitSettings = Config
    ? Config({})
    : { usageEnabled: true, monitorEnabled: true, monitorStepMaxChars: 60000, monitorMaxLoopBreaks: 3, monitorRepeatThreshold: 3, notifyEnabled: true }
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

  // 输出侧死循环熔断（宿主侧）：覆盖【全部】会话，与页面开没开、当前看哪个会话
  // 无关——这是客户端那一层做不到的（它挂在当前会话的组件上，切走即失效，而
  // 人不在正是循环白烧额度的时候）。判据见 loop-guard.ts。
  // 等 agent 服务就位再挂（它不总在本组件之前加载）
  ctx.inject(['agent'], () => {
    disposers.push(registerLoopGuard(ctx, { readSettings: () => readSettings() }))
  })

  // entry 注销时撤路由（disposers 由注入回调在 apply 期间同步填充）
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
