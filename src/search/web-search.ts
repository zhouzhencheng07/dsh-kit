// dsh-kit 网页搜索：web seam 接线（引擎链见 ./engine-chain.ts，引擎在 ./engines/）
//
// 注册 id 为 'free-search' 的搜索 provider——Tavily 免 key 优先，Bing RSS / Sogou /
// GitHub / arXiv / StackExchange / HN 自动故障转移；原生引用卡片照常渲染（seam 直接
// 消费 sources[]）。
//
// provider 选择：seam 的 searchProvider 配置在 base 层钉成 deepseek-official
// （付费模型调用，dsh-base/cordis.patch.yml）。本组件加载时才把它改指到 free-search。
// **不要在 bundle patch 里静态钉**：行禁用 = 本模块不物化 = 没有 provider 顶
// free-search 这个 id，seam 每次搜索抛 WEB_PROVIDER_CONFIGURED_MISSING；加载时接管
// 才有「关行 = base 钉的官方 provider 原样服务」。
//
// 宿主断言（0.2.2-rc.1 代码级，见知识库「DSH 插件开发坑」）：WebRuntime 的 provider
// 选择是 volatile 配置引用 web.config.searchProvider（schemastery .volatile() 的产物，
// {get} + cosmokit 全局写符号），selectSearchProvider 每次 search() 现读
// get() ?? $DSH_WEB_SEARCH_PROVIDER。本组件加载时经该引用改指到 free-search。
//
// 引用缺失 / 不带写符号 / 写了读不回 = 不钉不注册，仅「免费链不生效」，官方搜索照常。
//
// 显式钉了别的 provider（profile 补丁层把 id 指回别的）就让路：只在当前值是 undefined
// 或 base 默认值时才接管。

import { searchChain } from './engine-chain.ts'

export const SEARCH_PROVIDER_ID = 'free-search'

/** base 层钉的官方 provider id（= 无人显式选择时的值，也是我们只在此值上接管的原因） */
const BASE_PROVIDER_ID = 'deepseek-official'

/** 条数上限的 schema 默认值（配置给不出合法值时兜底） */
const DEFAULT_MAX_RESULTS = 2

/** web seam 的 provider 契约（我们注册的那一个） */
interface SeamSearchProvider {
  id: string
  available?(): boolean
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<{
    content?: string
    sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>
    truncated: boolean
  }>
}

/** cordis volatile 配置引用的写入口：cosmokit 用 Symbol.for 发布，跨 ESM/CJS 副本通用 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** volatile 配置引用：get 读当前快照；写入经 cosmokit 的全局符号键 */
interface VolatileRef<T> {
  get(): T
  [key: symbol]: unknown
}

/** web 服务里本层触达的最小面（其余成员不声明） */
interface SeamWebService {
  registerSearchProvider: (provider: SeamSearchProvider) => unknown
  searchProviders?: Map<string, SeamSearchProvider>
  /** provider 选择：volatile 引用，seam 每次 search() 现读 */
  config?: { searchProvider?: VolatileRef<string | undefined> }
}

/** cordis ctx 里本层用到的最小面（effect 可缺：缺失时不做还原） */
interface KitCtx {
  inject(deps: string[], cb: (webCtx: { web: SeamWebService }) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
}

export interface ApplyWebSearchOptions {
  /** 单次搜索的条数上限，每次现读；给不出 1-8 整数时回落默认值 */
  getMaxResults?: () => unknown
  log?: (message: string) => void
}

function resultCapOf(getMaxResults: () => unknown): number {
  const n = getMaxResults()
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_MAX_RESULTS
}

/** 经 cosmokit 写符号提交新值；读不回来（只读引用）算失败 */
function writeRef(ref: VolatileRef<string | undefined>, value: string | undefined): boolean {
  const write = ref[VOLATILE_WRITE]
  if (typeof write !== 'function') return false
  try {
    ;(write as (this: unknown, next: string | undefined) => void).call(ref, value)
  } catch {
    return false
  }
  return ref.get() === value
}

/**
 * 把 seam 的选择改指到 free-search，返回还原函数。
 * 宿主没暴露可写的配置引用、或已被显式钉在别的 provider 上 → null（调用方据此不注册）。
 */
function pinProvider(web: SeamWebService): (() => void) | null {
  const ref = web.config?.searchProvider
  if (!ref || typeof ref.get !== 'function') return null
  const prev = ref.get()
  if (prev !== undefined && prev !== BASE_PROVIDER_ID) return null
  if (!writeRef(ref, SEARCH_PROVIDER_ID)) return null
  return () => {
    if (ref.get() === SEARCH_PROVIDER_ID) writeRef(ref, prev)
  }
}

/** 接管 web seam 的选择并注册免费链 provider。挂 ctx.effect：行卸载时两者一起还回去。 */
export function applyWebSearch(ctx: KitCtx, options: ApplyWebSearchOptions = {}): void {
  const { getMaxResults = () => DEFAULT_MAX_RESULTS, log } = options
  const disposers: Array<() => void> = []
  ctx.inject(['web'], (webCtx) => {
    const web = webCtx.web
    const register = web.registerSearchProvider
    if (web.searchProviders?.has(SEARCH_PROVIDER_ID)) {
      log?.(`"${SEARCH_PROVIDER_ID}" 已被注册（该 id 已被占用），免费搜索未启用`)
      return
    }
    const unpin = pinProvider(web)
    if (!unpin) {
      log?.('web seam 不接受 free-search 的 provider 指定（config.searchProvider 缺失/不可写，或已被显式钉在别家），免费搜索未启用')
      return
    }
    let unregister: (() => void) | null = null
    try {
      const result = register.call(web, {
        id: SEARCH_PROVIDER_ID,
        available: () => true,
        async search(request, signal) {
          // 条数取「seam 请求量与设置上限的较小值」：seam 要得少就少给（省上下文），
          // 要得多也不超过设置上限（条数多 = 无谓的 token 消耗）
          const cap = resultCapOf(getMaxResults)
          const maxResults = Math.min(request.maxResults ?? cap, cap)
          const { items, summary } = await searchChain(request.query, { maxResults, signal })
          return {
            ...(summary ? { content: summary } : {}),
            sources: items.map((item) => ({
              url: item.url,
              ...(item.title ? { title: item.title } : {}),
              ...(item.snippet ? { snippet: item.snippet } : {}),
              ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
            })),
            // seam 自己按 request.maxResults 截断 sources[]
            truncated: false,
          }
        },
      })
      unregister = typeof result === 'function' ? (result as () => void) : null
    } catch (error) {
      log?.(`free-search provider 注册失败：${error instanceof Error ? error.message : String(error)}`)
      unpin()
      return
    }
    log?.(`免费搜索已接管 web seam（${SEARCH_PROVIDER_ID}）`)
    // 注册挂在 web 服务自己的 fiber 上，不随本行卸载自动摘——和还原一起挂本插件 effect
    disposers.push(() => unregister?.(), unpin)
  })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* 已注销 */
        }
      }
    }, 'dsh-kit-search.teardown')
  }
}
