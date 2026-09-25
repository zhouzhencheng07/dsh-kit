// dsh-kit 用量与余额宿主半边
//
// 从模型配置发现 provider（llm-pi-ai entry 配置经宿主 configEditor 读，providers.<id>.apiKeyEnv
// 是凭证引用名），经 credentials 服务按引用解析 key（每请求现读，改配置即生效、
// key 不出宿主进程），聚合两家上游给浏览器芯片：
//   deepseek  GET {base|api.deepseek.com}/user/balance    Bearer        余额（币种/总额/赠送/充值）
//   opencode  GET {provider.baseURL}/usage                Bearer        rolling(5h)/weekly/monthly 百分比+重置
// opencode 的配额上游是非官方承诺的契约（失效只挂对应卡，见知识库「dsh-kit 用量」页）。
//
// 端点（同源校验同 index.ts；webserver 默认只绑 loopback）：
//   GET /dsh-kit/usage[?fresh=1] → { providers:{deepseek?|opencode?}, at }
//   卡按配置出现：模型配置里没配对应 provider（且无 DEEPSEEK_API_KEY 引用）就不出卡。
//   usageEnabled 总开关关闭时 403 usage-disabled（前端入口同步隐藏）。
//
// 缓存：每家独立 60s（桌面 + 手机同看不重复打上游）；fresh=1 绕读仍回写。
// 单飞：同一家的并发请求共享一次上游调用。

import http from 'node:http'

import { sameOrigin } from '../core/index.ts'

/** 宿主对象最小依赖面（与其它模块同约定：只声明实际触达的成员） */
interface UsageWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void> }): () => void
}
export interface UsageDeps {
  webServer: UsageWebServer
  /** dsh-credentials 服务：resolve 解析凭证引用；readRecord 只是占位共享（弱类型检查要求至少一个同名成员） */
  credentials: {
    resolve?: (ref: string) => Promise<{ value: string; source: string } | undefined>
    readRecord?: (name: string) => Promise<unknown>
  }
  /** 总开关（usageEnabled），关 = 端点 403、前端入口同步隐藏 */
  readSettings: () => { usageEnabled?: boolean }
  /** llm-pi-ai entry 配置现读（configEditor，老宿主退 settings.get），缺服务时回 null */
  readProviderConfig: () => unknown
}

/** 上游请求超时 */
const UPSTREAM_TIMEOUT_MS = 15000
/** 每家上游结果缓存时长：配额窗口变化慢，多客户端同看也不该反复打 */
const CACHE_TTL_MS = 60000

type ProviderKind = 'deepseek' | 'opencode'

/** 发现出的一个上游卡位：kind 是浏览器侧固定卡位；ref+base 标识缓存身份（配置改了自然换缓存键） */
interface Discovered {
  kind: ProviderKind
  envRef: string
  base: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 扫模型配置里的 providers，按 id / 凭证引用名归类到两种卡位（子串匹配）。
 * 官方内置 deepseek 不在 llm-pi-ai 里，另用标准引用名 DEEPSEEK_API_KEY 兜底探测
 * （resolve 不中即不出卡）。识别不出的一律忽略（如 sensenova 这类无关 provider）。
 */
async function discoverProviders(deps: UsageDeps): Promise<Discovered[]> {
  const found = new Map<ProviderKind, Discovered>()
  const add = (d: Discovered) => {
    if (!found.has(d.kind)) found.set(d.kind, d)
  }
  const cfg = deps.readProviderConfig() as { providers?: unknown } | null | undefined
  const providers = cfg?.providers
  if (providers !== null && typeof providers === 'object') {
    for (const [id, raw] of Object.entries(providers as Record<string, { apiKeyEnv?: unknown; baseURL?: unknown }>)) {
      const envRef = str(raw?.apiKeyEnv)
      if (envRef === '') continue
      const base = str(raw?.baseURL)
      if (/deepseek/i.test(id) || /deepseek/i.test(envRef)) {
        add({ kind: 'deepseek', envRef, base: base !== '' ? base.replace(/\/+$/, '') : 'https://api.deepseek.com' })
      } else if (/opencode/i.test(id) || /opencode/i.test(envRef)) {
        add({ kind: 'opencode', envRef, base: base !== '' ? base.replace(/\/+$/, '') : 'https://opencode.ai/zen/go/v1' })
      }
    }
  }
  if (!found.has('deepseek')) {
    // 模型配置没写 deepseek provider 时探测标准引用名（官方内置适配器同款），有才出卡
    const hit = await deps.credentials.resolve?.('DEEPSEEK_API_KEY').catch(() => undefined)
    if (hit?.value) add({ kind: 'deepseek', envRef: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com' })
  }
  return [...found.values()]
}

interface CacheEntry {
  tag: string
  at: number
  value: ProviderResult
}

/** 各家上游的归一化结果：ok:false 挂本家错误，不拖垮别家 */
type ProviderResult = { ok: true } & Record<string, unknown> | { ok: false; error: string }

async function fetchUpstream(d: Discovered, key: string): Promise<ProviderResult> {
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${key}` }
  let url: string
  try {
    url = new URL(d.base + pathOf(d)).href
  } catch {
    return { ok: false, error: `baseURL 非法：${d.base}` }
  }
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
  } catch (error) {
    return { ok: false, error: `请求失败：${error instanceof Error ? error.message : error}` }
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200)
    return { ok: false, error: `HTTP ${res.status}${text !== '' ? `：${text}` : ''}` }
  }
  let body: any
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: '响应不是 JSON' }
  }
  if (d.kind === 'deepseek') {
    const infos = Array.isArray(body?.balance_infos)
      ? body.balance_infos.map((i: Record<string, unknown>) => ({
          currency: str(i.currency),
          total: str(i.total_balance),
          granted: str(i.granted_balance),
          toppedUp: str(i.topped_up_balance),
        }))
      : []
    return { ok: true, available: body?.is_available === true, infos }
  }
  const u = body?.usage
  const win = (w: any) =>
    w === null || typeof w !== 'object'
      ? null
      : { status: str(w.status) || null, percent: Number.isFinite(w.percent) ? w.percent : null, resetsAt: str(w.resetsAt) || null }
  return { ok: true, windows: { rolling: win(u?.rolling), weekly: win(u?.weekly), monthly: win(u?.monthly) } }
}

function pathOf(d: Discovered): string {
  return d.kind === 'deepseek' ? '/user/balance' : '/usage'
}

/** 注册 /dsh-kit/usage；返回注销函数（插件卸载时撤路由） */
export function registerUsageRoutes(deps: UsageDeps): () => void {
  const cache = new Map<ProviderKind, CacheEntry>()
  const inflight = new Map<ProviderKind, Promise<ProviderResult>>()

  const getCard = async (d: Discovered, fresh: boolean): Promise<ProviderResult> => {
    const tag = `${d.envRef}@${d.base}`
    const hit = cache.get(d.kind)
    if (hit?.tag === tag) {
      if (!fresh && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
      const running = inflight.get(d.kind)
      if (running) return running
    }
    const run = (async (): Promise<ProviderResult> => {
      try {
        const resolved = await deps.credentials.resolve?.(d.envRef).catch(() => undefined)
        if (!resolved?.value) return { ok: false, error: `未配置凭证引用 ${d.envRef}` }
        return await fetchUpstream(d, resolved.value)
      } finally {
        inflight.delete(d.kind)
      }
    })()
    inflight.set(d.kind, run)
    const value = await run
    cache.set(d.kind, { tag, at: Date.now(), value })
    return value
  }

  return deps.webServer.register({
    kind: 'exact',
    path: '/dsh-kit/usage',
    handler: (req, res) => {
      const json = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(obj))
      }
      if (req.method !== 'GET') {
        json(405, { error: 'method not allowed' })
        return
      }
      if (typeof req.headers.origin === 'string' && req.headers.origin !== '' && !sameOrigin(req)) {
        json(403, { error: 'cross-origin denied' })
        return
      }
      if (deps.readSettings().usageEnabled !== true) {
        json(403, { error: 'usage-disabled' })
        return
      }
      const fresh = new URL(req.url ?? '/', 'http://dsh-kit.local').searchParams.has('fresh')
      void (async () => {
        const discovered = await discoverProviders(deps)
        const providers: Record<string, ProviderResult> = {}
        await Promise.all(discovered.map(async (d) => {
          providers[d.kind] = await getCard(d, fresh)
        }))
        json(200, { providers, at: Date.now() })
      })().catch((error) => json(500, { error: error instanceof Error ? error.message : String(error) }))
    },
  })
}
