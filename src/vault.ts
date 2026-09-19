// vault 知识库宿主半边 —— 扫描索引 / wikilink 解析 / 内容搜索。**只读**：
// 插件面板不提供任何写入（建页/写回/改名/删除/上传全退役），页面由 agent 的
// 文件工具或外部编辑器写——「文件即接口」，插件只管把这棵目录读出来。
// 数据契约：vault 是设置卡配置的一个绝对目录（vaultRoot，留空用默认根
// defaultVaultRoot()），其内 md 文件是页面（attachments/ 与点前缀目录除外），
// 根下 library/ 是**资料库**（任意格式文献：只列清单、
// 不读正文、不进检索）。插件不持有第二真源；索引由扫描派生、mtime 增量缓存，
// 进程内存态，重启重扫。
// 不建骨架目录、不碰 git：目录不存在就是未配置态，前端渲染引导。
// 生命周期：跟随 webServer 注入段创建，随插件卸载丢弃（无外部资源）。降级路径：
// 根不存在 → 索引端点回 { root: null }，前端渲染引导；扫描/搜索失败按空结果+错误字段回。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface VaultPage {
  /** 绝对路径（realpath 归一后） */
  path: string
  /** 相对 vault 根的正斜杠路径，去 .md 扩展名（wikilink 解析键；页面名 = 文件名） */
  rel: string
  /** 顶层目录（空间；根下单文件页 space 为 ''） */
  space: string
  /** 正文 wikilink 原始目标（未解析） */
  links: string[]
  mtimeMs: number
  size: number
}

/** 资料库条目（library/ 子树里的任意文件与目录；不进页面索引、不读正文——
 *  面板给的只是「有什么」，打开与预览归官方文件面） */
export interface VaultLibraryEntry {
  /** 绝对路径 */
  path: string
  /** 库内相对路径（`/` 分隔、含扩展名；目录不带尾斜杠） */
  rel: string
  dir: boolean
}

export interface VaultLibrary {
  /** library/ 的绝对路径（realpath 后） */
  root: string
  /** 库内全部条目（目录 + 任意格式文件） */
  items: VaultLibraryEntry[]
  /** 超过单次清单上限被截断（只影响清单，树仍可逐层展开） */
  truncated?: boolean
}

export interface VaultIndex {
  /** 非 null：scan() 未配置/不存在时整体返回 null，走到这里必已配置 */
  root: string
  /** 笔记目录（相对 root、`/` 分隔、含各级；不含资料库子树） */
  folders: string[]
  pages: VaultPage[]
  /** 根下 library/ 的清单；目录不存在为 null（前端据此决定资料库那一行在不在） */
  library: VaultLibrary | null
  /** 超过单次扫描上限被截断 */
  truncated?: boolean
}

const MD_EXTS = new Set(['.md', '.markdown'])
/** 不进索引与树的目录名（attachments 约定放二进制，由外部工具维护；点前缀一律隐藏） */
const SKIP_DIRS = new Set(['attachments', '.git', '.trash', 'node_modules'])
const SCAN_FILE_LIMIT = 5000
/** 资料库目录名（根下这一层是约定：library/ 即资料库）；清单上限独立于页数上限 */
const LIBRARY_DIR = 'library'
const LIBRARY_LIMIT = 2000

/** 插件数据目录（$DSH_HOME/dsh-kit；与 schedule.ts 同式，各自轻量持有） */
function dshKitDataDir(): string {
  const env = process.env.DSH_HOME
  const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-kit')
}

/** vault 默认根（vaultRoot 留空时即开即用）：数据目录下的 vault 子树（与模块同名），与
 *  browser-profile/screenshots 等运行产物不混居 */
export function defaultVaultRoot(): string {
  return path.join(dshKitDataDir(), 'vault')
}

export function isMdPath(p: string): boolean {
  return MD_EXTS.has(path.extname(p).toLowerCase())
}

/** 正文 wikilink 提取：[[目标]] / [[目标|别名]]，目标剥 #锚点；去重保序 */
export function extractWikiLinks(content: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[([^\[\]#|]+)(?:#[^\[\]|]*)?(?:\|[^\[\]]*)?\]\]/g
  for (const m of content.matchAll(re)) {
    const target = (m[1] ?? '').trim()
    if (target === '') continue
    const key = target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

interface CacheEntry {
  mtimeMs: number
  size: number
  page: Omit<VaultPage, 'path' | 'mtimeMs' | 'size'>
  /** 小写化正文缓存（search 免每查询全库重读；仅 ≤256KB 的页缓存，超大页
   *  搜索时现读，不心疼内存也不失控） */
  content: string | null
}

/** 单页正文缓存上限 */
const SEARCH_CACHE_CAP = 256 * 1024

export class VaultScanner {
  private rootProvider: () => string
  /** mtime 增量缓存：重扫只重读变化文件，walk 本身每次全量（readdir 便宜） */
  private cache = new Map<string, CacheEntry>()

  constructor(rootProvider: () => string) {
    this.rootProvider = rootProvider
  }

  /** 读设置回调的容错包装：设置未就绪抛错时按未配置处理 */
  root(): string | null {
    let raw = ''
    try {
      raw = String(this.rootProvider() ?? '')
    } catch {
      return null
    }
    const trimmed = raw.trim()
    if (trimmed === '') return null
    try {
      const stat = fs.statSync(trimmed)
      if (!stat.isDirectory()) return null
      return fs.realpathSync(trimmed)
    } catch {
      return null
    }
  }

  /** 全量 walk + mtime 增量读。root 不存在回 null（前端渲染未配置引导）。
   *  根下 library/ 与笔记分家：整棵子树进 library 清单（任意格式、不读正文、不进检索），
   *  页面索引与 folders 都不含它——资料库是文献不是页面。 */
  async scan(): Promise<VaultIndex | null> {
    const root = this.root()
    if (root === null) return null
    const folders = new Set<string>()
    const pages: VaultPage[] = []
    let truncated = false
    // 资料库用持有对象收（闭包里赋值，标量会被 TS 的控制流分析窄化成 never）
    const lib: { root: string | null; items: VaultLibraryEntry[]; truncated: boolean } = {
      root: null,
      items: [],
      truncated: false,
    }
    /** 资料库子树单趟清单：任意格式文件 + 目录，点前缀跳过；不 stat、不读正文 */
    const walkLibrary = async (dir: string, prefix: string): Promise<void> => {
      let dirents: fs.Dirent[]
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const dirent of dirents) {
        if (lib.items.length >= LIBRARY_LIMIT) {
          lib.truncated = true
          return
        }
        if (dirent.name.startsWith('.')) continue
        const full = path.join(dir, dirent.name)
        const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
        if (dirent.isDirectory()) {
          lib.items.push({ path: full, rel, dir: true })
          await walkLibrary(full, rel)
          continue
        }
        if (dirent.isFile()) lib.items.push({ path: full, rel, dir: false })
      }
    }
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (pages.length >= SCAN_FILE_LIMIT) {
        truncated = true
        return
      }
      let dirents: fs.Dirent[]
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const dirent of dirents) {
        if (pages.length >= SCAN_FILE_LIMIT) {
          truncated = true
          return
        }
        const full = path.join(dir, dirent.name)
        if (dirent.isDirectory()) {
          if (dirent.name.startsWith('.') || SKIP_DIRS.has(dirent.name)) continue
          if (depth === 0 && dirent.name === LIBRARY_DIR) {
            lib.root = full
            await walkLibrary(full, '')
            continue
          }
          folders.add(path.relative(root, full).split(path.sep).join('/'))
          await walk(full, depth + 1)
          continue
        }
        if (!dirent.isFile() || !isMdPath(dirent.name)) continue
        const space = depth === 0 ? '' : path.relative(root, dir).split(path.sep)[0] ?? ''
        const rel = path
          .relative(root, full)
          .split(path.sep)
          .join('/')
          .replace(/\.(md|markdown)$/i, '')
        let stat: fs.Stats
        try {
          stat = await fs.promises.stat(full)
        } catch {
          continue
        }
        const cached = this.cache.get(full)
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          pages.push({ ...cached.page, path: full, mtimeMs: stat.mtimeMs, size: stat.size })
          continue
        }
        try {
          const content = await fs.promises.readFile(full, 'utf8')
          const page = {
            rel,
            space,
            links: extractWikiLinks(content),
          }
          this.cache.set(full, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            page,
            content: content.length <= SEARCH_CACHE_CAP ? content.toLowerCase() : null,
          })
          pages.push({ ...page, path: full, mtimeMs: stat.mtimeMs, size: stat.size })
        } catch {
          // 读失败（编码/权限）跳过该页，不阻断整体
        }
      }
    }
    await walk(root, 0)
    // 清缓存里已消失的文件，防长期驻留泄漏
    const alive = new Set(pages.map((p) => p.path))
    for (const key of this.cache.keys()) {
      if (!alive.has(key)) this.cache.delete(key)
    }
    pages.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base', numeric: true }))
    lib.items.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base', numeric: true }))
    return {
      root,
      folders: [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
      pages,
      library: lib.root === null ? null : { root: lib.root, items: lib.items, truncated: lib.truncated },
      truncated,
    }
  }

  /** 全文搜索覆盖根下全部索引页（attachments、点前缀目录与资料库子树本就不进索引）。
   *  打分 = 多词 AND + 词面加权：路径 +8 > 文件名 +5 > 正文 +2——路径权重最高
   *  意味着文件名就是检索键。小库逐文件读可接受，大库换索引是后续阶段。
   *  返回带 snippet 的前 limit 条（显示名客户端取 rel 末段，不单独回标题）。 */
  async search(
    query: string,
    limit: number,
  ): Promise<{ root: string; results: Array<{ path: string; rel: string; snippet: string; score: number }> } | null> {
    const index = await this.scan()
    if (index === null) return null
    const q = query.trim().toLowerCase()
    if (q === '') return { root: index.root, results: [] }
    const terms = q.split(/\s+/).filter((t) => t !== '')
    const results: Array<{ path: string; rel: string; snippet: string; score: number }> = []
    for (const page of index.pages) {
      // 正文优先取 mtime 缓存（scan 刚刷新过，命中即免读盘）；超大页等未缓存者现读
      let content = this.cache.get(page.path)?.content ?? null
      if (content === null) {
        try {
          content = (await fs.promises.readFile(page.path, 'utf8')).toLowerCase()
        } catch {
          continue
        }
      }
      let score = 0
      const relLower = page.rel.toLowerCase()
      const baseLower = relLower.split('/').pop() ?? ''
      let missing = false
      for (const term of terms) {
        const inRel = relLower.includes(term)
        const inBase = baseLower.includes(term)
        const inBody = content.includes(term)
        if (!inRel && !inBase && !inBody) {
          missing = true
          break
        }
        if (inRel) score += 8
        if (inBase) score += 5
        if (inBody) score += 2
      }
      if (missing) continue
      // snippet：第一个词的首个出现位置附近 ±60 字符
      const first = terms[0]
      const at = first === undefined ? -1 : content.indexOf(first)
      const snippet = at < 0 ? '' : content.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, ' ').trim()
      results.push({ path: page.path, rel: page.rel, snippet, score })
    }
    results.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
    return { root: index.root ?? '', results: results.slice(0, limit) }
  }
}
