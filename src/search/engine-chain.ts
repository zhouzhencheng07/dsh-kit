// 免费引擎链（接管宿主 web seam 的网页搜索）。
//
// 按优先级逐个尝试，失败自动换下一家。专用引擎（GitHub / arXiv / StackExchange /
// HN）只在查询强烈指向各自领域时参与；通用引擎（Tavily 免钥、Bing RSS、搜狗 HTML）
// 始终参与。全部免费：Tavily 没设 TAVILY_API_KEY 时走免钥模式，其余一律无需密钥。

import { tavilyEngine } from './engines/tavily.ts'
import { bingEngine } from './engines/bing.ts'
import { sogouEngine } from './engines/sogou.ts'
import { githubEngine } from './engines/github.ts'
import { arxivEngine } from './engines/arxiv.ts'
import { stackExchangeEngine } from './engines/stackexchange.ts'
import { hnEngine } from './engines/hn.ts'

/** 规范化的单条结果（seam 与工具返回共用这个形状） */
export interface SearchResultItem {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export interface SearchResult {
  items: SearchResultItem[]
  summary?: string
}

/** 引擎契约：available 廉价离线；match 仅专用引擎有 */
export interface SearchEngine {
  id: string
  available(): boolean
  match?(query: string): boolean
  search(query: string, opts: { maxResults?: number; signal?: AbortSignal }): Promise<SearchResult>
}

// 优先级：命中的专用引擎最前（各领域它们最对口），其后通用引擎按结果质量排。
const ENGINES: SearchEngine[] = [
  githubEngine,
  arxivEngine,
  stackExchangeEngine,
  hnEngine,
  tavilyEngine,
  bingEngine,
  sogouEngine,
]

const ENGINE_TIMEOUT_MS = 12_000

/**
 * 跑一次链式搜索：返回第一个成功引擎的规范化结果；全部失败时抛错，
 * 错误信息带各引擎的逐家尝试记录。
 */
export async function searchChain(
  query: string,
  { maxResults = 5, signal }: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<{ items: SearchResultItem[]; summary?: string }> {
  const q = typeof query === 'string' ? query.trim() : ''
  if (!q) {
    throw new Error('free-search: query is empty')
  }
  const attempts: string[] = []
  for (const engine of ENGINES) {
    if (!engine.available()) continue
    if (typeof engine.match === 'function' && !engine.match(q)) continue
    try {
      const result = await runWithTimeout(engine, q, maxResults, signal)
      return {
        items: capItems(result.items, maxResults),
        ...(result.summary ? { summary: result.summary } : {}),
      }
    } catch (error) {
      attempts.push(`${engine.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(
    `free-search: no usable engine answered (${attempts.join('; ') || 'no engine available'})`,
  )
}

function runWithTimeout(engine: SearchEngine, query: string, maxResults: number, signal: AbortSignal | undefined): Promise<SearchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS)
  timer.unref?.()
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return engine
    .search(query, { maxResults, signal: controller.signal })
    .finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    })
}

function capItems(items: unknown, maxResults: number): SearchResultItem[] {
  if (!Array.isArray(items)) return []
  return maxResults > 0 ? items.slice(0, maxResults) : items
}
