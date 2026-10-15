// Bing 引擎：走 RSS 输出的免费通用网页搜索（无需密钥）。
// https://www.bing.com/search?q=...&format=rss
//
// `format=rss` 是未写进文档但长期稳定的参数：把结果页以 RSS 2.0 吐出
// （每条 title/link/description；硬上限 10 条——`count` 参数被忽略）。
// 服务端可能 302 到区域主机（cn.bing.com 等），fetch 透明跟随，结果即区域化的。
// 非官方接口、有限频；排在 Tavily（首选）之后、搜狗（兜底）之前。

const BING_SEARCH = 'https://www.bing.com/search'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export const bingEngine = {
  id: 'bing',
  available: () => true,
  async search(query: string, { maxResults = 5, signal }: { maxResults?: number; signal?: AbortSignal } = {}) {
    const url = `${BING_SEARCH}?q=${encodeURIComponent(query)}&format=rss`
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal })
    if (!resp.ok) {
      throw new Error(`bing: HTTP ${resp.status}`)
    }
    const xml = await resp.text()
    const items = parseBingRss(xml).slice(0, maxResults)
    if (items.length === 0) {
      throw new Error('bing: no results in RSS (anti-bot or layout change)')
    }
    return { items }
  },
}

/** RSS 2.0 文本 → 规范 items。导出仅为单元测试（正则解析是唯一脆弱点） */
export function parseBingRss(xml: string): Array<{ url: string; title?: string; snippet?: string }> {
  const items: Array<{ url: string; title?: string; snippet?: string }> = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1] ?? ''
    const url = decodeEntities(extractTag(block, 'link'))
    const title = decodeEntities(extractTag(block, 'title'))
    const snippet = decodeEntities(extractTag(block, 'description'))
    if (!url) continue
    items.push({ url, title: title || undefined, snippet: snippet || undefined })
  }
  return items
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? (m[1] ?? '').trim() : ''
}

/** 实体解码：数字实体先解，&amp; 最后解（避免双重解码） */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCode(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function safeFromCode(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}
