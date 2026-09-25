// dsh-kit/vault 组件（宿主半边入口）——知识库 · 日程
//
// 能力本体在 ./scanner.ts（VaultScanner：md 目录扫描索引 / wikilink 提取 / 全文
// 搜索，只读）、./fs.ts（树上的新建 / 重命名 / 移动 / 导入 / 删除，删除走回收站）
// 与 ./schedule.ts（日程结构化存储 + 4 个 schedule_* agent 工具）；本文件是组件的
// 装配面：工具注册、端点、配置。
// 组件行关闭 = 本模块不物化 = 日程工具不注册、端点全 404，client 半边探到 404 后
// 整体不注册（侧栏索引、右栏知识库/日程签、对话路径改投全不出现）——行开关就是
// 这块能力的总开关。
// 配置：vaultRoot（知识库根目录绝对路径，留空用默认根）；编辑面在插件页本组件行的
// 「配置」。日程存储固定 $DSH_HOME/dsh-kit/schedule/（一条一文件），与知识库根无关，
// 无配置门槛。
//
// 端点（同源校验；webserver 默认只绑 loopback）：
//   GET  /dsh-kit-vault/config      —— 生效配置快照（client 门控与可达性探针：404 = 行关闭）
//   GET  /dsh-kit/vault/index       —— 索引（root / folders / pages / library）
//   GET  /dsh-kit/vault/stat        —— 单页 mtime（外部修改轮询）
//   GET  /dsh-kit/vault/search      —— 全文搜索
//   POST /dsh-kit/vault/create|rename|move|import|delete —— 目录级文件管理
//   GET  /dsh-kit/schedule/data     —— 事件 + 区间展开 + 独立计时段
//   GET  /dsh-kit/schedule/stats    —— 统计
// 知识库端点未配置 / 根不存在时回 400 vault-not-configured（前端渲染引导）。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'

import { loadToolsModule, sameOrigin } from '../core/index.ts'
import { VaultScanner, defaultVaultRoot } from './scanner.ts'
import { createEntry, renameEntry, moveEntry, importEntry, deleteEntries, parseConflict } from './fs.ts'
import { syncScheduleStore, buildScheduleTools, isDateStr, todayStr } from './schedule.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
}

interface KitWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void> }): () => void
}

interface KitWebCtx {
  webServer: KitWebServer
  effect(fn: () => void | (() => void), label?: string): void
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

const require = createRequire(import.meta.url)

export const name = 'dsh-kit/vault'

// ── 组件设置 schema（0.1.7 声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用后每次现读。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // vaultRoot = 知识库根目录（绝对路径；schema 默认值 = defaultVaultRoot()，
        // 字段恒有值）。宿主据此提供只读索引 / 搜索端点与文件管理端点，数据契约见
        // ./scanner.ts 头注释；用户显式清空保存为 '' 时由读取侧兜回默认根。
        vaultRoot: z.string().default(defaultVaultRoot()).volatile(),
      })
    : undefined

export async function apply(ctx: KitCtx, config: KitSettings = {}): Promise<void> {
  const defaults: KitSettings = Config ? Config({}) : { vaultRoot: '' }
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

  // ── 日程模块（./schedule.ts）：结构化日程 / 待办 ──
  //   agent 工具恒开（schedule_query 日/周/月汇总、schedule_create 建、
  //   schedule_update 三态改（null=清空、skip 跳过重复系列的一次）、
  //   schedule_delete 按 id 删整个系列）；只读日程签在 client/bundle.js 的
  //   vaultModule。行关闭 = 本模块不物化 = 工具不存在。
  const scheduleStore = syncScheduleStore()
  const scheduleToolsMod = await loadToolsModule((m) => console.warn('dsh-kit: ' + m))
  const scheduleDefs =
    scheduleToolsMod && typeof scheduleToolsMod.defineTool === 'function'
      ? buildScheduleTools({ defineTool: scheduleToolsMod.defineTool, store: scheduleStore })
      : null
  if (!scheduleDefs) {
    console.warn('dsh-kit: dsh-tools 不可达，日程 agent 工具未注册（日程面板不受影响）')
  }
  ctx.inject(['settings', 'tools'], (caps: { tools: { register: (def: unknown) => void } }) => {
    if (!scheduleDefs) return
    for (const def of scheduleDefs) {
      try {
        caps.tools.register(def)
      } catch (error) {
        console.warn('dsh-kit: 日程工具注册失败：' + (error instanceof Error ? error.message : error))
      }
    }
  })

  // ── 知识库扫描器（./scanner.ts）：提到 apply 级——webServer 注入可能重进，
  //   知识库端点块共享同一实例（mtime 缓存也就不用重建）。
  //   vaultRoot 留空用默认根（即开即用）；只读
  const vaultScanner = new VaultScanner(() => {
    try {
      const configured = String(readSettings().vaultRoot ?? '').trim()
      return configured === '' ? defaultVaultRoot() : configured
    } catch {
      return ''
    }
  })

  // webServer 可能在本组件 apply 之后才挂载，用动态注入等它就绪
  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    webCtx.effect(() => {
      // ── 生效配置快照（client 门控与可达性探针）──
      // client 启动拉一次；行关闭时本端点随模块不物化而 404，client 据此整体不注册。
      const disposeConfig = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit-vault/config',
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify({ vaultRoot: String(readSettings().vaultRoot ?? '') }))
        },
      })

      const json = (res: http.ServerResponse, code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(obj))
      }
      const route = (
        path: string,
        handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void,
      ) =>
        webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: (req, res) => {
            handler(req, res, new URL(req.url ?? '/', 'http://dsh-kit.local'))
          },
        })

      // ── 日程端点：/dsh-kit/schedule/*（./schedule.ts 单例 store）──
      //   面板只读，端点也只有读：GET data?from&to → { events(raw 全量),
      //   occurrences(区间展开,带 endDate/state), orphans }；GET stats?scope&date → 统计。
      //   写路径只走 agent 工具（工具直调 store，不经 HTTP）与望舒端；
      //   重复展开只在宿主做（客户端只渲染 occurrence）；个人规模 raw 全量直发。
      const schedDateParam = (url: URL, key: 'from' | 'to' | 'date'): string => {
        const raw = url.searchParams.get(key) ?? ''
        return isDateStr(raw) ? raw : todayStr()
      }
      const disposeSchedule: Array<() => void> = []
      disposeSchedule.push(
        route('/dsh-kit/schedule/data', (req, res, url) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const from = schedDateParam(url, 'from')
          const to = schedDateParam(url, 'to')
          json(res, 200, {
            events: scheduleStore.list(),
            occurrences: scheduleStore.occurrences(from, to),
            orphans: scheduleStore.listOrphans(),
          })
        }),
      )
      disposeSchedule.push(
        route('/dsh-kit/schedule/stats', (req, res, url) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const rawScope = url.searchParams.get('scope') ?? 'day'
          const scope = rawScope === 'week' || rawScope === 'month' ? rawScope : 'day'
          json(res, 200, scheduleStore.stats(scope, schedDateParam(url, 'date')))
        }),
      )

      // ── 知识库（./scanner.ts + ./fs.ts）──
      // vaultRoot 是配置页配置的绝对目录，在工作区外；读端点出索引 / 单页 mtime /
      // 全文搜索，写端点只管目录级文件管理。页面正文的写入仍归 agent 文件工具与
      // 外部编辑器。根未配置 / 不存在时回 400 vault-not-configured。
      const disposeVault: Array<() => void> = []
      const vaultRoute = (
        path: string,
        handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void,
      ) => {
        disposeVault.push(route(path, handler))
      }
      const vaultGuard = (res: http.ServerResponse): string | null => {
        const root = vaultScanner.root()
        if (root === null) {
          json(res, 400, { error: 'vault-not-configured' })
          return null
        }
        return root
      }
      vaultRoute('/dsh-kit/vault/index', (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const root = vaultGuard(res)
        if (root === null) return
        void vaultScanner
          .scan()
          .then((index) => json(res, 200, index ?? { root: null, spaces: [], pages: [] }))
          .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }))
      })
      // 外部修改实时刷新：只回打开页的 mtime，不读正文——前端轮询发现 mtime 变化
      // 且本地无脏改即自动重读整页（AI / 编辑器改文件零手动刷新）
      vaultRoute('/dsh-kit/vault/stat', (req, res, url) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const root = vaultGuard(res)
        if (root === null) return
        const resolved = path.resolve(String(url.searchParams.get('path') ?? ''))
        const rel = path.relative(root, resolved)
        if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') return json(res, 400, { error: '页面不在 vault 内' })
        try {
          const stat = fs.statSync(resolved)
          return json(res, 200, { mtimeMs: stat.mtimeMs })
        } catch {
          // 文件已被外部删除：回 gone，前端按需重读（页签显示已消失）
          return json(res, 200, { gone: true })
        }
      })
      vaultRoute('/dsh-kit/vault/search', (req, res, url) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const root = vaultGuard(res)
        if (root === null) return
        const q = (url.searchParams.get('q') ?? '').slice(0, 200)
        void vaultScanner
          .search(q, 20)
          .then((result) => json(res, 200, result ?? { root, results: [] }))
          .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }))
      })

      // ── 文件管理端点（./fs.ts）──
      // 面板树上的目录级管理：create / rename / move / import / delete。路径一律
      // 绝对路径且必须落在 vault 根内（resolveInside 拒上跳段并 realpath 比包含，
      // 挡软链与短名绕行）；撞名策略由前端选（skip/overwrite/rename），资料库那一支
      // 固定自动加序号。笔记页改名 / 移动会顺带改写指向它的双链（目录整体搬移不改，
      // 文件名没变解析结果就不变）；删除走回收站。导入两条来源：本机绝对路径直拷
      // （md 页连带把页内引用的本地图片收进 attachments/）与浏览器上传的字节。
      const vaultReadBody = (req: http.IncomingMessage, limit: number): Promise<Record<string, unknown>> =>
        new Promise((resolve) => {
          let raw = ''
          req.on('data', (c) => {
            raw += c
            if (raw.length > limit) req.destroy()
          })
          req.on('end', () => {
            try {
              const body: unknown = JSON.parse(raw === '' ? '{}' : raw)
              resolve(body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {})
            } catch {
              resolve({})
            }
          })
          req.on('error', () => resolve({}))
        })
      const VAULT_BODY_LIMIT = 1024 * 1024
      /** 导入上限：base64 文本长度（≈32MB 原始字节），PDF 这类文献够用 */
      const VAULT_IMPORT_LIMIT = 48 * 1024 * 1024
      const vaultPost = (
        path: string,
        action: (body: Record<string, unknown>, root: string) => unknown,
        limit: number = VAULT_BODY_LIMIT,
      ) => {
        vaultRoute(path, (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin denied' })
          const root = vaultGuard(res)
          if (root === null) return
          void vaultReadBody(req, limit).then((body) => {
            void Promise.resolve()
              .then(() => action(body, root))
              .then((result) => json(res, 200, { ok: true, ...(result as object) }))
              .catch((error) => json(res, 400, { error: error instanceof Error ? error.message : String(error) }))
          })
        })
      }
      vaultPost('/dsh-kit/vault/create', (body, root) =>
        createEntry(root, String(body.dir ?? ''), body.name, body.kind === 'dir' ? 'dir' : 'page'),
      )
      vaultPost('/dsh-kit/vault/rename', async (body, root) => {
        // 双链改写要用**操作前**的页面集合（改完名字旧页已不在索引里，判重名会走偏）
        const index = await vaultScanner.scan()
        return renameEntry(root, String(body.path ?? ''), body.name, index?.pages ?? [])
      })
      vaultPost('/dsh-kit/vault/move', async (body, root) => {
        const index = await vaultScanner.scan()
        return moveEntry(root, String(body.path ?? ''), String(body.dest ?? ''), parseConflict(body.conflict), index?.pages ?? [])
      })
      vaultPost(
        '/dsh-kit/vault/import',
        async (body, root) => {
          const data = typeof body.dataBase64 === 'string' && body.dataBase64 !== '' ? Buffer.from(body.dataBase64, 'base64') : undefined
          return importEntry(root, {
            destAbs: String(body.dest ?? ''),
            name: body.name,
            fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
            srcPath: typeof body.src === 'string' ? body.src : undefined,
            data,
            conflict: parseConflict(body.conflict),
          })
        },
        VAULT_IMPORT_LIMIT,
      )
      vaultPost('/dsh-kit/vault/delete', async (body, root) => {
        const paths = Array.isArray(body.paths) ? body.paths : []
        return deleteEntries(root, paths)
      })

      return () => {
        disposeConfig()
        for (const dispose of disposeSchedule) dispose()
        for (const dispose of disposeVault) dispose()
      }
    }, 'dsh-kit/vault: config/vault/schedule endpoints')
  })
}
