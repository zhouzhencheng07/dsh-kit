// 搜狗引擎：走 HTML 结果页的免费中文网页搜索（无需密钥）。
// https://www.sogou.com/web?query=...
//
// 搜狗的结果页是服务端直出 HTML，结果锚点指向 /link?url=... 跳转页，
// 真实地址要从跳转页的 `window.location.replace("...")` 里解出来。
// 非官方接口、有限频；只当兜底，不做首选。

const SOGOU_WEB = 'https://www.sogou.com/web'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export const sogouEngine = {
  id: 'sogou',
  available: () => true,
  async search(query: string, { maxResults = 5, signal }: { maxResults?: number; signal?: AbortSignal } = {}) {
    const url = `${SOGOU_WEB}?query=${encodeURIComponent(query)}`
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal,
    })
    if (!resp.ok) {
      throw new Error(`sogou: HTTP ${resp.status}`)
    }
    const html = await resp.text()
    const blocks = parseResultBlocks(html)
    if (blocks.length === 0) {
      throw new Error('sogou: no results in SERP (anti-bot or layout change)')
    }
    // 把 /link?url=... 跳转解成真实地址（并发、限量）。
    const resolved = await Promise.all(
      blocks.slice(0, maxResults).map(async (b) => {
        if (!b.redirect) return { ...b, url: '' }
        try {
          return { ...b, url: await resolveSogouLink(b.redirect, signal) }
        } catch {
          return { ...b, url: '' }
        }
      }),
    )
    const items = resolved.filter((it) => it.url)
    // 全部 /link 解析失败与「没有结果」同义：抛错让链继续往下走，别当成功返回空
    if (items.length === 0) throw new Error('sogou: no resolvable results')
    return { items }
  },
}

interface SogouBlock {
  title: string
  snippet: string
  redirect: string
}

function parseResultBlocks(html: string): SogouBlock[] {
  const blocks: SogouBlock[] = []
  const wraps = html.match(/<div class="vrwrap">[\s\S]*?(?=<div class="vrwrap">|$)/g) ?? []
  for (const wrap of wraps) {
    const titleMatch = wrap.match(
      /<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    )
    if (!titleMatch) continue
    const redirect = titleMatch[1] ?? ''
    const title = cleanText(titleMatch[2] ?? '')
    const snippetMatch = wrap.match(
      /<div[^>]*class="[^"]*fz-mid space-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    )
    const snippet = snippetMatch ? cleanText(snippetMatch[1] ?? '') : ''
    if (!title && !snippet) continue
    blocks.push({ title, snippet, redirect })
  }
  return blocks
}

async function resolveSogouLink(redirect: string, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(`https://www.sogou.com${redirect}`, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.sogou.com/web',
    },
    redirect: 'manual',
    signal,
  })
  const page = await resp.text()
  const m = page.match(/location\.replace\("([^"]+)"\)/) ?? page.match(/URL='([^']+)'/)
  if (!m) throw new Error('no target')
  return m[1] ?? ''
}

function cleanText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
