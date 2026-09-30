// dsh-kit 技能池宿主半边
//
// 技能池 <DSH_HOME>/dsh-kit/skill-pool 不挂任何扫描根（DSH 不会把它当技能源）：它是跨工作区
// 共用技能的**本体**所在地。要让某个工作区看见池里的技能，就在该工作区的一个项目级根
// 里建一条指向池的目录链接（载体根选择、git 体检与建链/断链见 ./mount.ts）。技能永远
// 不进项目仓库——载体根整目录被 git 忽略。
//
// 端点（同源校验；webserver 默认只绑 loopback）：
//   GET  /dsh-kit/skills?cwd=<会话cwd>
//       按三个逻辑组返回：workspace（.dsh/.agents 两根聚合）、user（$DSH_HOME 与
//       ~/.agents 两根聚合）、pool。每个技能带 root（物理根）、rank（DSH 扫描
//       优先级，越小越优先）、shadowed（同名跨根时非最优者）；链接条目另带
//       link/linkTarget/linkInPool；池技能另带 mounts（被几个工作区挂了——读的时候
//       顺手把本项目里看到的链接登记进账，失效条目清掉）。另附注册表中非白名单来源的
//       技能（只读展示）、失效链接清单、以及载体根状态 mount。
//   POST /dsh-kit/skills/op   body 为 JSON：
//       {op:'move',  src, dest, overwrite?}   搬到目标根（dest=物理根 id）。技能只有移动、
//                                             没有复制（副本与本体分叉，版本记录失去意义）：
//                                             进池 = 本体入池 + 原地留链接（平铺 .md 包成同名
//                                             目录再挂——池靠目录链接挂载，挂不住一个文件），
//                                             出池 = 先断掉所有挂载链接再搬本体（不带 .git）
//       {op:'delete', src}                    删除；Windows 移入回收站（链接只断链）
//       {op:'disable', src, disabled}         改 SKILL.md frontmatter 双键
//       {op:'setcarrier', carrier}            记住本项目的载体根（两根都在用时二选一）
//       {op:'prepare', resolve?:'move'|'untrack'}
//                                             体检载体根：处理已进仓库的内容 + 写忽略
//       {op:'mount', src}                     在载体根建指向池技能的链接（并登记挂载点）
//       {op:'unmount', src}                   断链（池里的本体不动）
//       {op:'history', src}                   池技能的历史（提交列表 + 未提交改动；顺带补基线）
//       {op:'commit', src, message}           按给定提交信息记一版（空信息拒绝，无改动不提交）
//       {op:'rollback', src, sha, discard?}   回滚到某次提交（恢复内容 + 记一条新提交）；
//                                             有未提交改动时必须带 discard:true
//       同名冲突回 409 {error:'conflict'}，客户端确认后带 overwrite:true 重发；
//       载体根有已进仓库的内容时回 409 {error:'tracked', tracked:[...]}。
//
// 安全边界：
//   - 可写范围白名单：池目录、项目级两根（自 cwd 推导）、用户级两根；之外一律拒绝。
//   - 源必须是某根的**直接子项**（官方发现规则就是一层：dir/SKILL.md 或根下 *.md）。
//   - 路径按**父目录 realpath** 做包含性校验、条目本身按 lstat 判类型：链接条目算在它
//     所在的根里，绝不被 realpath 带去池里当成本体（否则"删除工作区里的挂载技能"会删掉
//     池里的本体）。

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { recycleDelete, findProjectRoot } from '../core/index.ts'
import { sameOrigin } from '../core/index.ts'
import {
  computeMountState,
  forgetMount,
  liveMounts,
  mountLink,
  mountPrecondition,
  prepareCarrier,
  setCarrier,
  syncMounts,
  relinkMounts,
  unmountLink,
  type MountState,
  type ProjectDirs,
  type ProjectRootId,
} from './mount.ts'
import { adoptLegacy, dshHome, kitPath } from '../core/data-path.ts'
import { ensurePoolBaseline, poolGitCommit, poolGitRollback, poolGitState } from './pool-git.ts'
import { parseFrontmatter } from './frontmatter.ts'

const POOL_DIRNAME = 'skill-pool'

/**
 * 物理根定义：group = 所属逻辑分组；rank = DSH 扫描优先级（数值越小越优先，
 * roots() 常量照官方那套；pool 不是扫描根，不参与排序）。
 */
interface PhysicalRoot {
  id: string
  group: string
  rank: number | null
}

const PHYSICAL_ROOTS: PhysicalRoot[] = [
  { id: 'project-dsh', group: 'workspace', rank: 100 },
  { id: 'project-agents', group: 'workspace', rank: 200 },
  { id: 'user-dsh', group: 'user', rank: 400 },
  { id: 'user-agents', group: 'user', rank: 500 },
  { id: 'pool', group: 'pool', rank: null },
]

/** 逻辑分组展示顺序：工作区 → 用户级 → 技能池 */
const GROUP_ORDER = ['workspace', 'user', 'pool']

export interface SkillEntry {
  name: string
  description: string
  /** frontmatter version（自有约定，DSH 不读） */
  version?: string
  path: string
  file: string | null
  kind: 'dir' | 'file'
  disabled: boolean
  modelInvocable: boolean
  userInvocable: boolean
  root?: string
  rank?: number | null
  shadowed?: boolean
  /** 条目本身是链接（池挂载点即指向池的目录链接） */
  link?: boolean
  /** 链接目标 realpath；失效链接为 null（失效条目本身不进技能列表，见 brokenLinks） */
  linkTarget?: string | null
  /** 链接目标落在技能池内 */
  linkInPool?: boolean
  /** 池技能被几个工作区挂载（登记表；只有池组带） */
  mounts?: number
}

/** 失效链接：链接指向的池技能已不在（改名/删除），宿主发现时会静默跳过 */
export interface BrokenLink {
  root: string
  name: string
  path: string
  target: string | null
}

interface PhysicalRootWithDir extends PhysicalRoot {
  dir: string
}

/** GET 枚举里每个物理根的聚合桶 */
interface ResolvedRoot {
  id: string
  dir: string
  exists: boolean
  rank: number | null
  skills: SkillEntry[]
}

/** 技能池目录（<DSH_HOME>/dsh-kit/skill-pool）：不是 DSH 扫描根，只作跨工作区共用的本体
 *  所在地。池路径真相只此一处（vault 的「知识库目录」等用户配置与它无关）。 */
export function defaultPoolDir(): string {
  return kitPath(POOL_DIRNAME)
}

/** 老位置的池搬进 dsh-kit/，并重指工作区里那些绝对路径链接 */
function adoptLegacyPool(): void {
  if (adoptLegacy(path.join(dshHome(), POOL_DIRNAME), defaultPoolDir())) relinkMounts(defaultPoolDir())
}

/** 项目级两根的物理位置；没有会话 cwd（或 cwd 非法）时返回 null */
export function resolveProjectDirs(cwd: unknown): ProjectDirs | null {
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  try {
    const projectRoot = findProjectRoot(fs.realpathSync(path.resolve(cwd.trim())))
    return {
      projectRoot,
      dshDir: path.join(projectRoot, '.dsh', 'skills'),
      agentsDir: path.join(projectRoot, '.agents', 'skills'),
    }
  } catch {
    // cwd 非法就没有项目级两根
    return null
  }
}

/** 解析全部白名单物理根（带逻辑分组与 rank） */
export function resolveRoots(cwd: unknown): PhysicalRootWithDir[] {
  const home = dshHome()
  const dirById: Record<string, string> = {
    pool: defaultPoolDir(),
    'user-dsh': path.join(home, 'skills'),
    'user-agents': path.join(os.homedir(), '.agents', 'skills'),
  }
  const project = resolveProjectDirs(cwd)
  if (project !== null) {
    dirById['project-dsh'] = project.dshDir
    dirById['project-agents'] = project.agentsDir
  }
  const roots: PhysicalRootWithDir[] = []
  for (const def of PHYSICAL_ROOTS) {
    const dir = dirById[def.id]
    if (dir === undefined) continue
    roots.push({ ...def, dir })
  }
  return roots
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isLinkAt(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function boolFlag(value: unknown): boolean | null {
  if (value === undefined) return null
  const v = String(value).trim().toLowerCase()
  return v !== '' && v !== 'false' && v !== 'no' && v !== '0'
}

/**
 * 行级改写 frontmatter 的两个弃用键（不重写其余内容，零 YAML 依赖）：
 * disabled=true → 两键置为 true/false（已有则原位改值，缺失则补在块尾）；
 * disabled=false → 删除这两行。无 frontmatter 且要禁用时新建一个最小块。
 */
function setDisableFlags(text: string, disabled: boolean): string {
  const lines = text.split(/\r?\n/)
  // 定位首块（第 0 行必须是 --- 围栏）
  if (lines[0] !== undefined && /^---[ \t]*$/.test(lines[0])) {
    let closeIdx = -1
    for (let i = 1; i < Math.min(lines.length, 200); i++) {
      if (/^---[ \t]*$/.test(lines[i]!)) {
        closeIdx = i
        break
      }
    }
    if (closeIdx > 0) {
      const keepRe = /^[A-Za-z][A-Za-z0-9_-]*[ \t]*:/
      const dropRe = /^(disable-model-invocation|user-invocable)[ \t]*:/
      if (!disabled) {
        const filtered = lines.filter((line, i) => !(i > 0 && i < closeIdx && dropRe.test(line)))
        return filtered.join('\n')
      }
      const wanted: Record<string, string> = { 'disable-model-invocation': 'true', 'user-invocable': 'false' }
      const inner = lines.slice(1, closeIdx)
      for (const key of Object.keys(wanted)) {
        const idx = inner.findIndex((line) => {
          const m = keepRe.exec(line)
          return (m?.[0] ?? '').slice(0, -1).trim().toLowerCase() === key
        })
        if (idx >= 0) inner[idx] = `${key}: ${wanted[key]}`
        else inner.push(`${key}: ${wanted[key]}`)
      }
      return [...lines.slice(0, 1), ...inner, ...lines.slice(closeIdx)].join('\n')
    }
  }
  // 没有 frontmatter：禁用则补最小块，启用则原样返回
  if (!disabled) return text
  return `---\ndisable-model-invocation: true\nuser-invocable: false\n---\n${text}`
}

/** 扫单个根：一层条目，目录须含 SKILL.md，平铺 .md 也算技能 */
function scanRoot(root: PhysicalRootWithDir): SkillEntry[] {
  const skills: SkillEntry[] = []
  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(root.dir, { withFileTypes: true })
  } catch {
    return skills
  }
  for (const ent of dirents) {
    if (ent.name.startsWith('.')) continue
    const entryPath = path.join(root.dir, ent.name)
    const isLink = isLinkAt(entryPath)
    // 链接（含 Windows junction）在 Dirent 上 isDirectory()=false、isSymbolicLink()=true，
    // 按 Dirent 判类型会把挂载进来的技能整条漏掉（宿主用 stat，照常发现）
    const linkStat = isLink ? safeStat(entryPath) : null
    const isEntryDir = isLink ? linkStat?.isDirectory() === true : ent.isDirectory()
    const isEntryFile = isLink ? linkStat?.isFile() === true : ent.isFile()
    let skillFile: string | null = null
    let kind: 'dir' | 'file' | null = null
    if (isEntryDir) {
      const candidate = path.join(entryPath, 'SKILL.md')
      if (fs.existsSync(candidate)) {
        kind = 'dir'
        skillFile = candidate
      }
    } else if (isEntryFile && /\.md$/i.test(ent.name)) {
      kind = 'file'
      skillFile = entryPath
    }
    if (kind === null || skillFile === null) continue
    let text = ''
    try {
      text = fs.readFileSync(skillFile, 'utf8')
    } catch {
      // 读不了就保留占位信息
    }
    const fm = parseFrontmatter(text)
    const disableModel = boolFlag(fm['disable-model-invocation'])
    const userInvocableRaw = fm['user-invocable']
    const modelInvocable = disableModel === null ? true : !disableModel
    const userInvocable = userInvocableRaw === undefined ? true : boolFlag(userInvocableRaw) === true
    skills.push({
      name: typeof fm['name'] === 'string' && fm['name'] !== '' ? fm['name'] : ent.name.replace(/\.md$/i, ''),
      description: fm['description'] ?? '',
      ...(typeof fm['version'] === 'string' && fm['version'] !== '' ? { version: fm['version'] } : {}),
      path: entryPath,
      file: skillFile,
      kind,
      disabled: modelInvocable === false || userInvocable === false,
      modelInvocable,
      userInvocable,
      ...(isLink ? { link: true, linkTarget: safeRealpath(entryPath) } : {}),
    })
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return skills
}

/** 失效链接：链接目标没了（池里的技能被改名/删除）——宿主侧会静默跳过，只有这里能看见 */
function scanBrokenLinks(root: PhysicalRootWithDir): BrokenLink[] {
  const out: BrokenLink[] = []
  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(root.dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of dirents) {
    if (ent.name.startsWith('.')) continue
    const full = path.join(root.dir, ent.name)
    if (!isLinkAt(full)) continue
    if (fs.existsSync(path.join(full, 'SKILL.md'))) continue
    out.push({ root: root.id, name: ent.name, path: full, target: safeRealpath(full) })
  }
  return out
}

/**
 * 删掉一整个技能目录，带几次重试：Windows 上目录被占用是常态（git 子进程的 CWD、
 * 编辑器/杀软句柄），一次 EPERM 就报失败会让移动半途而废（目标已复制、源还在）。
 */
async function rmSkillDir(dir: string): Promise<void> {
  // 占用往往是短暂的（杀软扫刚建出来的 git 对象、编辑器句柄），所以退让得久一点
  const delays = [150, 400, 900, 1600, 2600]
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY'
      if (!transient || attempt >= delays.length) throw error
      await new Promise((resolve) => setTimeout(resolve, delays[attempt] ?? 900))
    }
  }
}

/**
 * 断掉所有指向这个池本体的挂载链接（登记表 + 本项目两根里能看到的），返回断掉的路径。
 * 出池、删除本体前都必须先做：那些链接只存在于各自的磁盘上，断了才不会悬空。
 */
function detachPoolLinks(roots: PhysicalRootWithDir[], poolDir: string, srcReal: string): string[] {
  const unmounted: string[] = []
  for (const rec of liveMounts(poolDir, srcReal)) {
    if (unmountLink(rec.link).ok) unmounted.push(rec.link)
    forgetMount(poolDir, rec.link)
  }
  for (const root of roots) {
    let dirents: fs.Dirent[]
    try {
      dirents = fs.readdirSync(root.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of dirents) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(root.dir, ent.name)
      if (unmounted.includes(full) || !isLinkAt(full) || safeRealpath(full) !== srcReal) continue
      if (unmountLink(full).ok) unmounted.push(full)
      forgetMount(poolDir, full)
    }
  }
  return unmounted
}

interface Located {
  root: PhysicalRootWithDir & { real: string }
  /** 条目自身的路径（不解析链接——链接条目要留在它所在的根里） */
  path: string
  /** 相对根的层级串：'' = 直接子项 */
  rel: string
  isLink: boolean
  /** 链接目标 realpath；非链接或失效链接为 null */
  target: string | null
}

/**
 * 路径必须真实存在且落在某个白名单根内。包含性用**父目录**的 realpath 判定：
 * 条目本身可能是链接（realpath 会跳到池里，导致它被误判成池的根本体）。
 */
function locateInside(roots: PhysicalRootWithDir[], rawPath: unknown): Located | null {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return null
  const lexical = path.resolve(rawPath.trim())
  let lst: fs.Stats
  try {
    lst = fs.lstatSync(lexical)
  } catch {
    return null
  }
  for (const root of roots) {
    let realRoot: string
    let parentReal: string
    try {
      realRoot = fs.realpathSync(root.dir)
      parentReal = fs.realpathSync(path.dirname(lexical))
    } catch {
      continue
    }
    const rel = path.relative(realRoot, parentReal)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    const isLink = lst.isSymbolicLink()
    return { root: { ...root, real: realRoot }, path: lexical, rel, isLink, target: isLink ? safeRealpath(lexical) : null }
  }
  return null
}

/** 源必须是根的直接子项（官方技能发现只有一层） */
function directChildOnly(located: Located): boolean {
  return located.rel === ''
}

/** 删除/移动链接条目时的保护：链接只断链，绝不递归进目标 */
const LINK_DELETE_HINT = '这是链接（池挂载点）：用「卸载」断链，池里的本体不受影响'

function jsonOf(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(obj))
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) {
        rejectPromise(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        rejectPromise(new Error('invalid json'))
      }
    })
    req.on('error', rejectPromise)
  })
}

interface SkillWebCtx {
  effect(fn: () => void | (() => void), label?: string): void
  webServer: {
    register(route: {
      kind: string
      path: string
      handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
    }): () => void
  }
}

/** cordis ctx 里本层用到的最小面 */
interface KitCtx {
  inject(deps: string[], cb: (webCtx: SkillWebCtx) => void): void
}

interface SkillPoolHooks {
  getRegistry?: () => unknown
}

/**
 * 注册技能池端点。registryApi 由外部注入回调捕获（ctx.skills 服务可能晚于本模块就绪）。
 */
export function applySkillPool(ctx: KitCtx, hooks?: SkillPoolHooks): void {
  adoptLegacyPool()
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const origins = (req: http.IncomingMessage): boolean => sameOrigin(req)

      // ── GET 枚举 ──
      const disposeList = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/skills',
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            jsonOf(res, 405, { error: 'method not allowed' })
            return
          }
          if (!origins(req)) {
            jsonOf(res, 403, { error: 'cross-origin denied' })
            return
          }
          const url = new URL(req.url ?? '/', 'http://dsh-kit.local')
          const cwd = url.searchParams.get('cwd') ?? ''
          const roots = resolveRoots(cwd)
          const projectDirs = resolveProjectDirs(cwd)
          const scannedDirs: string[] = []
          const buckets = new Map<string, ResolvedRoot[]>(GROUP_ORDER.map((id): [string, ResolvedRoot[]] => [id, []]))
          const brokenLinks: BrokenLink[] = []
          const poolReal = safeRealpath(defaultPoolDir())
          // 本工作区里看到的池链接（下面补进挂载登记表：手工建的链接也能进账）
          const seenMounts: Array<{ poolSkillDir: string; project: string; link: string }> = []
          for (const root of roots) {
            const exists = isDir(root.dir)
            const skills = exists ? scanRoot(root) : []
            for (const skill of skills) {
              skill.root = root.id
              skill.rank = root.rank
              const target = skill.linkTarget
              if (skill.link === true) {
                skill.linkInPool =
                  typeof target === 'string' && poolReal !== null &&
                  (target === poolReal || target.startsWith(`${poolReal}${path.sep}`))
                if (skill.linkInPool === true && typeof target === 'string' && projectDirs !== null) {
                  seenMounts.push({ poolSkillDir: target, project: projectDirs.projectRoot, link: skill.path })
                }
              }
            }
            buckets.get(root.group)!.push({ id: root.id, dir: root.dir, exists, rank: root.rank, skills })
            if (exists) {
              scannedDirs.push(root.dir)
              brokenLinks.push(...scanBrokenLinks(root))
            }
          }
          // 三逻辑组：物理根聚合；同名跨根按 rank（小者优先）标注被覆盖
          const groups = GROUP_ORDER.map((id) => {
            const rootsOf = buckets.get(id)!
            return { id, roots: rootsOf, skills: rootsOf.flatMap((r) => r.skills) }
          })
          const winner = new Map<string, number>()
          for (const group of groups) {
            for (const skill of group.skills) {
              if (typeof skill.rank !== 'number') continue
              const cur = winner.get(skill.name)
              if (cur === undefined || skill.rank < cur) winner.set(skill.name, skill.rank)
            }
          }
          for (const group of groups) {
            for (const skill of group.skills) {
              const best = winner.get(skill.name)
              skill.shadowed = typeof skill.rank === 'number' && best !== undefined && best < skill.rank
            }
          }
          // 池技能被几个工作区挂载：登记本工作区看到的链接，顺手清失效条目
          const poolDir = defaultPoolDir()
          const mountCounts = syncMounts(poolDir, seenMounts)
          for (const group of groups) {
            if (group.id !== 'pool') continue
            for (const skill of group.skills) skill.mounts = mountCounts[path.basename(skill.path)] ?? 0
          }
          // 载体根状态（挂载入口据此渲染；无会话 cwd 时为 null）
          const mount: MountState | null = projectDirs !== null ? await computeMountState(projectDirs) : null
          // 注册表增强：插件自带 / 运行时 / custom 等不在白名单根里的技能，只读展示。
          const providers: Array<Record<string, unknown>> = []
          const registry = hooks && typeof hooks.getRegistry === 'function' ? hooks.getRegistry() : null
          if (registry !== null && registry !== undefined && typeof (registry as { list?: unknown }).list === 'function') {
            try {
              // 注册表方法必须以 registry 为接收者调用——解绑（const l = registry.list; l()）会断 this 链
              const summaries = (registry as { list: (opts?: { cwd?: string }) => unknown }).list(
                typeof cwd === 'string' && cwd.trim() !== '' ? { cwd: cwd.trim() } : {},
              )
              for (const summary of Array.isArray(summaries) ? summaries : []) {
                const s = summary as { name?: unknown; description?: unknown; provider?: unknown; source?: unknown; invocation?: unknown; resourceBase?: { path?: unknown } }
                if (!s || typeof s.name !== 'string') continue
                const base = s.resourceBase && typeof s.resourceBase.path === 'string' ? s.resourceBase.path : ''
                const covered = base !== '' && scannedDirs.some((dir) => {
                  const rel = path.relative(dir, base)
                  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
                })
                if (covered) continue
                providers.push({
                  name: s.name,
                  description: typeof s.description === 'string' ? s.description : '',
                  provider: typeof s.provider === 'string' ? s.provider : '',
                  source: typeof s.source === 'string' ? s.source : '',
                  invocation: s.invocation ?? null,
                })
              }
            } catch (error) {
              // 注册表不可用就不给这一段，枚举本身不受影响
              console.warn('[dsh-kit] skills registry list failed:', error instanceof Error ? error.message : error)
            }
          }
          jsonOf(res, 200, { cwd, groups, providers, brokenLinks, mount })
        },
      })

      // ── POST 操作 ──
      const disposeOp = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/skills/op',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            jsonOf(res, 405, { error: 'method not allowed' })
            return
          }
          if (!origins(req)) {
            jsonOf(res, 403, { error: 'cross-origin denied' })
            return
          }
          let body: any
          try {
            body = await readBody(req)
          } catch (error) {
            jsonOf(res, 400, { error: `请求体非法：${error instanceof Error ? error.message : error}` })
            return
          }
          const cwd = typeof body.cwd === 'string' ? body.cwd : ''
          const roots = resolveRoots(cwd)
          const projectDirs = resolveProjectDirs(cwd)

          try {
            // ── 载体根 / 挂载（机制操作，与技能条目的复制搬家分开）──
            if (body.op === 'setcarrier') {
              const carrier: ProjectRootId | null =
                body.carrier === 'project-dsh' || body.carrier === 'project-agents' ? body.carrier : null
              if (carrier === null) {
                jsonOf(res, 400, { error: '未知载体根' })
                return
              }
              if (projectDirs === null) {
                jsonOf(res, 400, { error: '没有会话工作区' })
                return
              }
              setCarrier(projectDirs.projectRoot, carrier)
              jsonOf(res, 200, { ok: true, op: 'setcarrier', mount: await computeMountState(projectDirs) })
              return
            }

            if (body.op === 'prepare') {
              if (projectDirs === null) {
                jsonOf(res, 400, { error: '没有会话工作区' })
                return
              }
              const resolve = body.resolve === 'move' || body.resolve === 'untrack' ? body.resolve : undefined
              const state = await computeMountState(projectDirs)
              const result = await prepareCarrier(projectDirs, state, resolve)
              if (!result.ok) {
                jsonOf(res, result.needResolve === true ? 409 : 400, {
                  error: result.needResolve === true ? 'tracked' : 'prepare-failed',
                  message: result.error ?? '载体根里有已进仓库的内容',
                  tracked: result.tracked ?? [],
                  mount: state,
                })
                return
              }
              jsonOf(res, 200, {
                ok: true,
                op: 'prepare',
                moved: result.moved ?? [],
                skipped: result.skipped ?? [],
                untracked: result.untracked ?? [],
                ignoreFile: result.ignoreFile ?? '',
                wroteIgnore: result.wroteIgnore === true,
                mount: await computeMountState(projectDirs),
              })
              return
            }

            if (body.op === 'mount' || body.op === 'unmount') {
              const located = locateInside(roots, body.src)
              if (!located || !directChildOnly(located)) {
                jsonOf(res, 400, { error: '源不是白名单根下的技能条目' })
                return
              }
              if (body.op === 'unmount') {
                if (!located.isLink) {
                  jsonOf(res, 400, { error: '这不是链接（不是池挂载点）' })
                  return
                }
                const result = unmountLink(located.path)
                if (!result.ok) {
                  jsonOf(res, 400, { error: result.error ?? '断链失败' })
                  return
                }
                forgetMount(defaultPoolDir(), located.path)
                jsonOf(res, 200, { ok: true, op: 'unmount', path: located.path })
                return
              }
              if (located.root.id !== 'pool') {
                jsonOf(res, 400, { error: '只有池里的技能能挂载到工作区' })
                return
              }
              if (projectDirs === null) {
                jsonOf(res, 400, { error: '没有会话工作区' })
                return
              }
              const state = await computeMountState(projectDirs)
              const pre = mountPrecondition(state)
              if (!pre.ok) {
                jsonOf(res, 400, { error: 'not-prepared', message: pre.error ?? '载体根未就绪', mount: state })
                return
              }
              const mounted = mountLink(located.path, state.carrierDir)
              if (!mounted.ok) {
                jsonOf(res, 400, { error: 'mount-failed', message: mounted.error ?? '挂载失败', mount: state })
                return
              }
              if (typeof mounted.path === 'string') {
                syncMounts(defaultPoolDir(), [{ poolSkillDir: located.path, project: projectDirs.projectRoot, link: mounted.path }])
              }
              jsonOf(res, 200, { ok: true, op: 'mount', path: mounted.path, mount: await computeMountState(projectDirs) })
              return
            }

            // ── 池技能的版本记录（每技能一仓；提交信息由人或 agent 给，见 ./pool-git.ts）──
            if (body.op === 'history' || body.op === 'commit' || body.op === 'rollback') {
              const located = locateInside(roots, body.src)
              if (!located || !directChildOnly(located)) {
                jsonOf(res, 400, { error: '源不是白名单根下的技能条目' })
                return
              }
              if (located.root.id !== 'pool') {
                jsonOf(res, 400, { error: 'not-in-pool', message: '只有技能池里的技能做版本记录' })
                return
              }
              if (body.op === 'history') {
                jsonOf(res, 200, { ok: true, op: 'history', git: await poolGitState(located.path) })
                return
              }
              if (body.op === 'commit') {
                const result = await poolGitCommit(located.path, typeof body.message === 'string' ? body.message : '')
                if (!result.ok) {
                  jsonOf(res, 400, {
                    error: 'commit-failed',
                    message: result.error ?? '提交失败',
                    git: await poolGitState(located.path),
                  })
                  return
                }
                jsonOf(res, 200, { ok: true, op: 'commit', committed: result.committed, git: await poolGitState(located.path) })
                return
              }
              const rolled = await poolGitRollback(
                located.path,
                typeof body.sha === 'string' ? body.sha : '',
                body.discard === true,
              )
              if (!rolled.ok) {
                jsonOf(res, 400, {
                  // dirty = 有未提交改动，客户端确认"一起丢掉"后带 discard 重发
                  error: rolled.dirty > 0 ? 'dirty' : 'rollback-failed',
                  message: rolled.error ?? '回滚失败',
                  dirty: rolled.dirty,
                  git: await poolGitState(located.path),
                })
                return
              }
              jsonOf(res, 200, { ok: true, op: 'rollback', changed: rolled.changed, git: await poolGitState(located.path) })
              return
            }

            if (body.op === 'move') {
              const located = locateInside(roots, body.src)
              if (!located || !directChildOnly(located)) {
                jsonOf(res, 400, { error: '源不是白名单根下的技能条目' })
                return
              }
              const destRoot = roots.find((r) => r.id === body.dest)
              if (!destRoot) {
                jsonOf(res, 400, { error: '未知目标根' })
                return
              }
              let destReal: string
              try {
                // 目标根不存在则按需创建（池/工作区/用户级首次使用即落盘）
                fs.mkdirSync(destRoot.dir, { recursive: true })
                destReal = fs.realpathSync(destRoot.dir)
              } catch {
                jsonOf(res, 400, { error: '目标根不可用' })
                return
              }
              if (destReal === located.root.real) {
                jsonOf(res, 400, { error: '目标与源在同一根' })
                return
              }
              // 链接源搬的是它指向的本体（链接本身只是个挂载点）
              const srcReal = located.target ?? safeRealpath(located.path)
              if (srcReal === null) {
                jsonOf(res, 400, { error: '源不可读' })
                return
              }
              const srcIsDir = isDir(srcReal)
              const baseName = path.basename(located.path)
              const flatMd = !srcIsDir && /\.md$/i.test(baseName)
              if (destRoot.id === 'pool' && !srcIsDir && !flatMd) {
                jsonOf(res, 400, { error: 'not-a-skill', message: '只有技能能进池：含 SKILL.md 的目录，或平铺 .md 文件' })
                return
              }
              // 平铺 .md 进池要包成同名目录（入口文件改名 SKILL.md）：池靠目录链接挂载，挂不住
              // 一个文件。名字沿用文件名（去掉 .md），与扫描回落的名字一致
              const wrap = destRoot.id === 'pool' && flatMd
              const name = wrap ? baseName.replace(/\.md$/i, '') : baseName
              const dst = path.join(destReal, name)
              // 自指保护：dst 就是源本身（例如另一个根里有同名实体，而这条恰是指向它的链接）。
              // 放任下去会先 rmSync(dst) 删掉本体、再对着悬空链接复制——本体就此消失
              const dstReal = safeRealpath(dst)
              if (dstReal !== null && dstReal === srcReal) {
                jsonOf(res, 400, { error: 'same-target', message: '源与目标指向同一处，没有可搬的东西' })
                return
              }
              if (destRoot.id === 'pool' && fs.existsSync(dst)) {
                jsonOf(res, 400, {
                  error: 'exists-in-pool',
                  message: `池里已有同名技能：${name}（先把它移出或删掉，再搬进去）`,
                })
                return
              }
              if (fs.existsSync(dst) && body.overwrite !== true) {
                jsonOf(res, 409, { error: 'conflict', message: `目标已存在同名技能：${name}`, target: dst })
                return
              }
              // 进池要在原地留链接：挂不上就整个不做——不能把技能从工作区搬走却挂不回来
              const willMount = destRoot.id === 'pool' && located.root.group === 'workspace'
              let mountState: MountState | null = null
              if (willMount) {
                if (projectDirs === null) {
                  jsonOf(res, 400, { error: '没有会话工作区' })
                  return
                }
                mountState = await computeMountState(projectDirs)
                const pre = mountPrecondition(mountState)
                if (!pre.ok) {
                  jsonOf(res, 400, { error: 'not-prepared', message: pre.error ?? '载体根未就绪', mount: mountState })
                  return
                }
              }
              // 出池：先断掉所有挂载链接（含别的工作区的），再搬本体
              const unmounted =
                located.root.id === 'pool' || located.isLink ? detachPoolLinks(roots, defaultPoolDir(), srcReal) : []
              if (fs.existsSync(dst)) await rmSkillDir(dst)
              if (wrap) {
                // 平铺进池：包成目录（内容一字不动，只是换个入口文件名）
                fs.mkdirSync(dst, { recursive: true })
                fs.copyFileSync(srcReal, path.join(dst, 'SKILL.md'))
              } else {
                // 目标不在池里就不带版本记录：项目仓库里冒出嵌套仓库，git add 只会记一条 gitlink
                const skipRepo = destRoot.id !== 'pool'
                fs.cpSync(srcReal, dst, {
                  recursive: true,
                  ...(skipRepo ? { filter: (p: string) => !(path.basename(p) === '.git' && path.dirname(p) === srcReal) } : {}),
                })
              }
              // 移动语义的数据安全：确认目标入口文件真实存在后才撤源
              const marker = (srcIsDir || wrap) ? path.join(dst, 'SKILL.md') : dst
              if (!fs.existsSync(marker)) throw new Error('移动后校验失败：目标缺少技能入口文件')
              if (located.isLink) {
                try {
                  fs.unlinkSync(located.path)
                } catch {
                  // 已经不在就当删过了
                }
              } else {
                try {
                  await rmSkillDir(located.path)
                } catch (error) {
                  // 本体已经复制到新位置、挂载链接也断了，只剩池里这份删不掉（被占用的时间可能很长）
                  const code = (error as NodeJS.ErrnoException).code ?? '占用'
                  throw new Error(`池里那份删不掉（${code}）：技能已搬到 ${dst}，请手动删除 ${located.path}`)
                }
              }
              let mountedBack: string | null = null
              let warning: string | null = null
              if (destRoot.id === 'pool' && isDir(dst)) {
                // 进池即备好仓库与基线：之后的历史由人或 agent 有意识地提交（见 ./pool-git.ts）
                await ensurePoolBaseline(dst)
                if (willMount && projectDirs !== null) {
                  const state = mountState ?? (await computeMountState(projectDirs))
                  const back = mountLink(dst, state.carrierDir)
                  if (back.ok && typeof back.path === 'string') {
                    mountedBack = back.path
                    syncMounts(defaultPoolDir(), [{ poolSkillDir: dst, project: projectDirs.projectRoot, link: back.path }])
                  } else {
                    // 本体已经进池，只是没挂回来：说清楚，别让人以为技能凭空没了
                    warning = `已入池，但没能在这个工作区挂回来（${back.error ?? '未知原因'}）：请到池组里手动挂载`
                  }
                }
              }
              jsonOf(res, 200, { ok: true, op: 'move', dest: dst, unmounted, mounted: mountedBack, warning })
              return
            }

            if (body.op === 'delete') {
              const located = locateInside(roots, body.src)
              if (!located || !directChildOnly(located)) {
                jsonOf(res, 400, { error: '源不是白名单根下的技能条目' })
                return
              }
              if (located.isLink) {
                // 链接条目只断链：rmSync/回收站都可能顺着 reparse point 做事，不能交给它们
                jsonOf(res, 400, { error: LINK_DELETE_HINT })
                return
              }
              // 池本体删除：先把挂载链接断掉（含别的工作区的），否则那些工作区会留下悬空链接
              const srcReal = located.root.id === 'pool' ? safeRealpath(located.path) : null
              const unmounted = srcReal !== null ? detachPoolLinks(roots, defaultPoolDir(), srcReal) : []
              // Windows 移入回收站（全局约定；失败报错不静默转永久删），其它平台直接删
              if (process.platform === 'win32') {
                const gone = await recycleDelete(located.path)
                if (!gone) {
                  jsonOf(res, 500, { error: '移入回收站失败（文件可能被占用或路径过长）' })
                  return
                }
              } else {
                fs.rmSync(located.path, { recursive: true, force: true })
              }
              jsonOf(res, 200, { ok: true, op: 'delete', unmounted })
              return
            }

            if (body.op === 'disable') {
              const located = locateInside(roots, body.src)
              if (!located || !directChildOnly(located)) {
                jsonOf(res, 400, { error: '源不是白名单根下的技能条目' })
                return
              }
              const isSkillDir = isDir(located.path) && fs.existsSync(path.join(located.path, 'SKILL.md'))
              const isFlatMd = located.path.toLowerCase().endsWith('.md') && fs.statSync(located.path).isFile()
              if (!isSkillDir && !isFlatMd) {
                jsonOf(res, 400, { error: '该路径不是技能（目录需含 SKILL.md，或为根下 .md 文件）' })
                return
              }
              const file = isSkillDir ? path.join(located.path, 'SKILL.md') : located.path
              const before = fs.readFileSync(file, 'utf8')
              const after = setDisableFlags(before, body.disabled === true)
              if (after !== before) fs.writeFileSync(file, after, 'utf8')
              const fm = parseFrontmatter(after)
              const disableModel = boolFlag(fm['disable-model-invocation'])
              const userInvocable = fm['user-invocable'] === undefined ? true : boolFlag(fm['user-invocable']) === true
              jsonOf(res, 200, {
                ok: true,
                op: 'disable',
                file,
                disabled: disableModel === false || userInvocable === false,
                // 链接条目改的是池里的本体（所有挂载方同步生效），客户端据此提示
                link: located.isLink,
              })
              return
            }

            jsonOf(res, 400, { error: '未知操作' })
          } catch (error) {
            jsonOf(res, 500, { error: `操作失败：${error instanceof Error ? error.message : error}` })
          }
        },
      })

      return () => {
        disposeList()
        disposeOp()
      }
    }, 'dsh-kit: skill pool endpoints')
  })
}
