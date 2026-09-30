// 技能池挂载：载体根选择 + git 体检/忽略 + 目录链接的建立与移除。
//
// 池（<DSH_HOME>/dsh-kit/skill-pool）不挂扫描根，要让某个工作区看见池里的技能，就得在该工作区
// 的一个项目级根里建一条指向池的目录链接（Windows 用 junction、POSIX 用目录 symlink）。
// 两个项目级根放什么由用户自己决定：插件不判断哪个根"在用"、也不默认哪一根。这个工作区
// 第一次挂池技能时面板给出两个根让用户选，选定后记进策略文件，之后所有池链接（含入池
// 自动回挂）都落在那儿。载体根整目录写进 .gitignore——技能不进项目仓库（junction 会被
// git 当普通目录收录、`git restore` 还会写穿回池里的本体）。
//
// 本模块只做机制，不做取舍：跨根同名的优先级由宿主 rank 决定，删链接还是删本体由用户
// 决定；这里只负责"判定载体根 / 写忽略 / 建链 / 断链"，外加一份挂载登记表——池技能被
// 哪些工作区挂了只存在于各项目的磁盘上，出池或删除本体时得靠这份账断链。

import fs from 'node:fs'
import path from 'node:path'

import { adoptLegacy, dshHome, kitPath } from '../core/data-path.ts'
import { runGit } from './git.ts'

/** 项目级两根（与 skill-pool 的物理根 id 同名） */
export type ProjectRootId = 'project-dsh' | 'project-agents'

export interface ProjectDirs {
  /** findProjectRoot 的结果：仓库根，或没有仓库时的会话 cwd */
  projectRoot: string
  dshDir: string
  agentsDir: string
}

export interface MountState {
  projectRoot: string
  /** 载体根所在仓库的根；null = 非仓库（或无 git），忽略只做预防性写入 */
  repoRoot: string | null
  /** 挂载点（载体根）；null = 这个工作区还没选过，第一次挂载时问用户 */
  carrierRoot: ProjectRootId | null
  carrierDir: string
  /** 另一个根：载体根里有用户自己的技能时，可把实体挪到那边去（插件不指定谁该放什么） */
  otherRoot: ProjectRootId
  otherDir: string
  /** 载体根来自用户选择（已持久化） */
  pinned: boolean
  needsChoice: boolean
  /** 载体根已被 git 忽略；非仓库为 null */
  ignored: boolean | null
  ignoreRule: string
  /** 载体根下已被仓库跟踪的路径（相对仓库根） */
  tracked: string[]
  /** 载体根里的实体条目数 / 链接条目数（实体 >0 说明用户在这个根里也放了自己的技能） */
  carrierOwn: number
  carrierLinks: number
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

// ── 载体根选择 / 挂载登记（机器本地存储：链接与它的性质一致，都不随仓库走）──

/** 一条池技能挂载点：链接不随仓库走，这份账也只存机器本地 */
export interface MountRecord {
  /** 池技能目录名（登记表的键） */
  pool: string
  /** 挂载方项目根 */
  project: string
  /** 载体根里的链接路径 */
  link: string
}

interface Policy {
  projects: Record<string, { carrier?: ProjectRootId }>
  mounts: Record<string, MountRecord[]>
}

function policyFile(): string {
  const next = kitPath('skills.json')
  const legacy = path.join(dshHome(), 'data', 'dsh-kit-skills.json')
  // 搬不动就继续读旧位置：读不到会被当成空策略，挂载记录与载体选择全丢
  if (!adoptLegacy(legacy, next) && fs.existsSync(legacy)) return legacy
  return next
}

function normalizeMounts(raw: unknown): Record<string, MountRecord[]> {
  const out: Record<string, MountRecord[]> = {}
  if (raw === null || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '' || !Array.isArray(value)) continue
    const list: MountRecord[] = []
    for (const item of value) {
      const rec = item as { pool?: unknown; project?: unknown; link?: unknown }
      if (typeof rec.pool !== 'string' || typeof rec.project !== 'string' || typeof rec.link !== 'string') continue
      if (rec.project === '' || rec.link === '') continue
      if (!list.some((r) => r.link === rec.link)) list.push({ pool: rec.pool, project: rec.project, link: rec.link })
    }
    if (list.length > 0) out[key] = list
  }
  return out
}

function readPolicy(): Policy {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(policyFile(), 'utf8'))
    const rawProjects = (parsed as { projects?: unknown }).projects
    const projects = rawProjects !== null && typeof rawProjects === 'object' ? (rawProjects as Policy['projects']) : {}
    return { projects, mounts: normalizeMounts((parsed as { mounts?: unknown }).mounts) }
  } catch {
    // 无文件/坏文件都当空策略
  }
  return { projects: {}, mounts: {} }
}

/** 整文件回写：projects 与 mounts 同住一个文件，谁都不能把对方抹掉 */
function writePolicy(policy: Policy): void {
  const file = policyFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
}

/** 记住用户为某个项目选定的载体根（工作区第一次挂池技能时选，之后一直用它） */
export function setCarrier(projectRoot: string, carrier: ProjectRootId): void {
  const policy = readPolicy()
  policy.projects[projectRoot] = { carrier }
  writePolicy(policy)
}

// ── 挂载登记表 ──
//
// 池技能会被**别的**工作区挂在载体根里，那些链接只存在于各自的磁盘上，插件无从枚举。
// 所以挂载/卸载时在这里记账：出池或删除本体前，据此把每一处链接断掉（否则那些工作区
// 会留下悬空链接），池组也能显示"被几个工作区挂载"。

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** 记录还有效吗：链接仍在，且仍指向这个池技能（池里的本体被改名/删除即失效） */
function mountAlive(poolDir: string, rec: MountRecord): boolean {
  try {
    if (!fs.lstatSync(rec.link).isSymbolicLink()) return false
  } catch {
    return false
  }
  const target = realOrNull(rec.link)
  const expect = realOrNull(path.join(poolDir, rec.pool))
  return target !== null && expect !== null && target === expect
}

/** 读登记表并剔除失效条目；dirty=true 表示需要回写 */
function readMounts(poolDir: string): { policy: Policy; mounts: Policy['mounts']; dirty: boolean } {
  const policy = readPolicy()
  const mounts = policy.mounts
  let dirty = false
  for (const [name, list] of Object.entries(mounts)) {
    const alive = list.filter((rec) => mountAlive(poolDir, rec))
    if (alive.length === list.length) continue
    dirty = true
    if (alive.length === 0) delete mounts[name]
    else mounts[name] = alive
  }
  return { policy, mounts, dirty }
}

function saveMounts(policy: Policy, mounts: Policy['mounts']): void {
  policy.mounts = mounts
  writePolicy(policy)
}

/**
 * 批量登记挂载点（按链接路径去重）并返回各池技能的挂载数。
 * 读技能列表时也调它：手工建的链接就此进账，失效条目同时被清掉。
 */
export function syncMounts(
  poolDir: string,
  items: Array<{ poolSkillDir: string; project: string; link: string }>,
): Record<string, number> {
  const { policy, mounts, dirty } = readMounts(poolDir)
  let changed = dirty
  for (const item of items) {
    const name = path.basename(item.poolSkillDir)
    const list = mounts[name] ?? []
    if (list.some((rec) => rec.link === item.link)) continue
    list.push({ pool: name, project: item.project, link: item.link })
    mounts[name] = list
    changed = true
  }
  if (changed) saveMounts(policy, mounts)
  const counts: Record<string, number> = {}
  for (const [name, list] of Object.entries(mounts)) counts[name] = list.length
  return counts
}

/** 删掉一条挂载记录（只记账，断链由调用方做） */
export function forgetMount(poolDir: string, link: string): void {
  const { policy, mounts } = readMounts(poolDir)
  let changed = false
  for (const [name, list] of Object.entries(mounts)) {
    const kept = list.filter((rec) => rec.link !== link)
    if (kept.length === list.length) continue
    changed = true
    if (kept.length === 0) delete mounts[name]
    else mounts[name] = kept
  }
  if (changed) saveMounts(policy, mounts)
}

/** 某个池技能当前有效的挂载点（读的时候顺带清理失效条目） */
export function liveMounts(poolDir: string, poolSkillDir: string): MountRecord[] {
  const { policy, mounts, dirty } = readMounts(poolDir)
  if (dirty) saveMounts(policy, mounts)
  return mounts[path.basename(poolSkillDir)] ?? []
}

/**
 * 池目录搬家后重指挂载链接：链接是指向池的绝对路径，池从 $DSH_HOME/skill-pool 搬到
 * dsh-kit/skill-pool 后旧链接全悬空——按登记表把悬空的重建到新池（本体不动）。
 * 返回重指了几条。
 */
export function relinkMounts(poolDir: string): number {
  // 读原始登记表而不是 readMounts：后者按「链接还指向池」剔除失效条目，而搬家这件事
  // 本身就让链接全悬空，剔完就没有可修的了
  const policy = readPolicy()
  const mounts = policy.mounts
  let fixed = 0
  let changed = false
  for (const [name, list] of Object.entries(mounts)) {
    const kept: MountRecord[] = []
    for (const rec of list) {
      // 载体根里那条路径已不是链接 = 别人的条目，不碰；指向新池的保持原样
      if (!isLinkAt(rec.link) || mountAlive(poolDir, rec)) {
        kept.push(rec)
        continue
      }
      unmountLink(rec.link)
      // 目标取记录自己的 rec.pool：它才是登记事实（mountAlive 也按它判），拿 map 键
      // 拼会在键与记录不一致时把链接指到另一个技能目录
      const rebuilt = mountLink(path.join(poolDir, rec.pool), path.dirname(rec.link))
      if (rebuilt.ok) fixed++
      else kept.push(rec)
    }
    // kept 只从 list 按序取，长度不变即内容不变；重指成功的条目不进 kept，长度必变
    if (kept.length !== list.length) changed = true
    if (kept.length === 0) delete mounts[name]
    else mounts[name] = kept
  }
  if (changed) saveMounts(policy, mounts)
  return fixed
}

// ── 载体根（挂载点）──
//
// 挂哪个根**只由用户选定**：这个工作区第一次挂池技能时面板给出两个根让用户选，选定后
// 记进策略文件，之后所有池链接（含入池自动回挂）都落在那儿。插件不替用户判断哪个根
// "在用"、也不默认哪一根——两个根放什么由用户自己决定。

/** 一个根里的条目分角色统计：链接不算"用户自己的技能"（报告载体根被占用时要分清） */
function entryRoles(dir: string): { own: number; links: number } {
  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { own: 0, links: 0 }
  }
  let own = 0
  let links = 0
  for (const ent of dirents) {
    if (ent.name.startsWith('.')) continue
    let isLink = false
    try {
      isLink = fs.lstatSync(path.join(dir, ent.name)).isSymbolicLink()
    } catch {
      continue
    }
    if (isLink) {
      links++
      continue
    }
    if (ent.isDirectory() || /\.md$/i.test(ent.name)) own++
  }
  return { own, links }
}

async function repoRootOf(dir: string): Promise<string | null> {
  const result = await runGit(['rev-parse', '--show-toplevel'], dir)
  if (!result.ok) return null
  const out = result.out.trim()
  return out !== '' ? out : null
}

/** 读载体根当前状态（只读，不写盘）：挂载点、忽略状态、已跟踪内容 */
export async function computeMountState(dirs: ProjectDirs): Promise<MountState> {
  const carrier = readPolicy().projects[dirs.projectRoot]?.carrier ?? null
  // 未选定时按 .agents 探一份只读状态给需要选择的面板用（needsChoice 为真时面板不显示这些）
  const effective: ProjectRootId = carrier ?? 'project-agents'
  const carrierDir = effective === 'project-dsh' ? dirs.dshDir : dirs.agentsDir
  const otherRoot: ProjectRootId = effective === 'project-dsh' ? 'project-agents' : 'project-dsh'
  const carrierRoles = entryRoles(carrierDir)
  const repoRoot = await repoRootOf(dirs.projectRoot)
  let ignored: boolean | null = null
  let ignoreRule = ''
  let tracked: string[] = []
  if (repoRoot !== null) {
    const rel = toPosix(path.relative(repoRoot, effective === 'project-dsh' ? dirs.dshDir : dirs.agentsDir))
    const check = await runGit(['check-ignore', '-v', '--', `${rel}/`], repoRoot)
    ignored = check.ok && check.out.trim() !== ''
    ignoreRule = check.out.trim().split('\n')[0]?.trim() ?? ''
    const ls = await runGit(['ls-files', '--', rel], repoRoot)
    tracked = ls.ok ? ls.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '') : []
  }
  return {
    projectRoot: dirs.projectRoot,
    repoRoot,
    carrierRoot: carrier,
    carrierDir,
    otherRoot,
    otherDir: otherRoot === 'project-dsh' ? dirs.dshDir : dirs.agentsDir,
    pinned: carrier !== null,
    needsChoice: carrier === null,
    ignored,
    ignoreRule,
    tracked,
    carrierOwn: carrierRoles.own,
    carrierLinks: carrierRoles.links,
  }
}

// ── git 体检与忽略 ──

/** 忽略文件里那行锚定模式（相对忽略文件所在目录 = 仓库根 / 项目根） */
function ignoreLineOf(state: MountState): { file: string; line: string } {
  const base = state.repoRoot ?? state.projectRoot
  return { file: path.join(base, '.gitignore'), line: `/${toPosix(path.relative(base, state.carrierDir))}/` }
}

/** 载体根的 pathspec：**带尾斜杠**。目录不存在时 git 不会把 .gitignore 里的目录型模式
 *  （`/x/y/`）匹配到 `x/y` 上，check-ignore 会误报"未忽略"。 */
function carrierSpec(state: MountState, base: string): string {
  const rel = toPosix(path.relative(base, state.carrierDir))
  return rel === '' ? '.' : `${rel}/`
}

function hasIgnoreLine(file: string, line: string): boolean {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .some((row) => row.trim() === line)
  } catch {
    return false
  }
}

/** 追加一行忽略（幂等；已有同款行就不动文件；文件本来为空时不写前导空行） */
function ensureIgnoreLine(file: string, line: string): boolean {
  if (hasIgnoreLine(file, line)) return false
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    // 文件不存在就新建
  }
  const sep = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  fs.writeFileSync(file, `${text}${sep}# dsh-kit 技能池挂载点\n${line}\n`, 'utf8')
  return true
}

export interface PrepareResult {
  ok: boolean
  error?: string
  /** 载体根里有已进仓库的内容，需要用户先选处理方式 */
  needResolve?: boolean
  tracked?: string[]
  moved?: string[]
  skipped?: string[]
  untracked?: string[]
  ignoreFile?: string
  wroteIgnore?: boolean
}

/**
 * 体检并准备载体根：处理已进仓库的内容（搬到另一个根 / 仅从仓库移除）+ 写忽略规则。
 * 未忽略的载体根不能挂载——一挂，池里的内容就会被项目仓库当普通文件收进去。
 */
export async function prepareCarrier(dirs: ProjectDirs, state: MountState, resolve?: 'move' | 'untrack'): Promise<PrepareResult> {
  if (state.needsChoice) return { ok: false, error: '还没选定挂载点：先选池技能挂哪个根（.dsh/skills 或 .agents/skills）' }
  const tracked = state.repoRoot !== null ? state.tracked : []
  if (tracked.length > 0 && resolve === undefined) return { ok: false, needResolve: true, tracked }
  const moved: string[] = []
  const skipped: string[] = []
  if (resolve === 'move') {
    fs.mkdirSync(state.otherDir, { recursive: true })
    let dirents: fs.Dirent[] = []
    try {
      dirents = fs.readdirSync(state.carrierDir, { withFileTypes: true })
    } catch {
      // 载体根还不存在，没有要搬的
    }
    for (const ent of dirents) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(state.carrierDir, ent.name)
      try {
        if (fs.lstatSync(full).isSymbolicLink()) continue // 已有的池链接不动
      } catch {
        continue
      }
      const dst = path.join(state.otherDir, ent.name)
      if (fs.existsSync(dst)) {
        skipped.push(ent.name)
        continue
      }
      try {
        fs.renameSync(full, dst)
        moved.push(ent.name)
      } catch {
        skipped.push(ent.name)
      }
    }
  }
  const untracked: string[] = []
  if (state.repoRoot !== null && tracked.length > 0) {
    const base = state.repoRoot
    const rel = toPosix(path.relative(base, state.carrierDir))
    const result = await runGit(['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', rel], base)
    if (result.ok) untracked.push(...tracked)
  }
  const { file, line } = ignoreLineOf(state)
  const wroteIgnore = ensureIgnoreLine(file, line)
  if (state.repoRoot !== null) {
    const check = await runGit(['check-ignore', '-v', '--', carrierSpec(state, state.repoRoot)], state.repoRoot)
    if (!(check.ok && check.out.trim() !== '')) {
      return { ok: false, error: `忽略规则未生效：${state.carrierDir} 仍会被仓库跟踪`, moved, skipped, untracked, ignoreFile: file, wroteIgnore }
    }
  } else if (!hasIgnoreLine(file, line)) {
    return { ok: false, error: '忽略规则写入失败', moved, skipped, untracked, ignoreFile: file, wroteIgnore }
  }
  return { ok: true, moved, skipped, untracked, ignoreFile: file, wroteIgnore }
}

/** 挂载前置条件：载体根已由用户选定且已被忽略（非仓库时看忽略行是否在 .gitignore 里） */
export function mountPrecondition(state: MountState): { ok: boolean; error?: string } {
  if (state.needsChoice) return { ok: false, error: '还没选定挂载点：先选池技能挂哪个根（.dsh/skills 或 .agents/skills）' }
  if (state.ignored === false) return { ok: false, error: '载体根还没被 git 忽略：先做体检（否则池里的技能会被项目仓库收进去）' }
  if (state.repoRoot === null) {
    const { file, line } = ignoreLineOf(state)
    if (!hasIgnoreLine(file, line)) return { ok: false, error: '载体根还没写忽略规则：先做体检' }
  }
  return { ok: true }
}

// ── 链接 ──

/** 建一条指向池技能的目录链接（Windows junction 免管理员；POSIX 目录 symlink） */
export function mountLink(poolSkillDir: string, carrierDir: string): { ok: boolean; path?: string; error?: string } {
  const dst = path.join(carrierDir, path.basename(poolSkillDir))
  try {
    fs.mkdirSync(carrierDir, { recursive: true })
  } catch {
    return { ok: false, error: '载体根不可用' }
  }
  if (fs.existsSync(dst) || isLinkAt(dst)) return { ok: false, error: `载体根里已有同名条目：${path.basename(poolSkillDir)}` }
  let target: string
  try {
    target = fs.realpathSync(poolSkillDir)
  } catch {
    return { ok: false, error: '池里这个技能不存在' }
  }
  try {
    fs.symlinkSync(target, dst, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    return { ok: false, error: `建链接失败：${error instanceof Error ? error.message : error}` }
  }
  if (!fs.existsSync(path.join(dst, 'SKILL.md'))) {
    try {
      fs.unlinkSync(dst)
    } catch {}
    return { ok: false, error: '链接校验失败（目标缺 SKILL.md）' }
  }
  return { ok: true, path: dst }
}

/** 断链：只删链接本身，绝不递归进目标（池里的本体不受影响） */
export function unmountLink(linkPath: string): { ok: boolean; error?: string } {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return { ok: false, error: '这不是链接（不是池挂载点）' }
  } catch {
    return { ok: false, error: '路径不存在' }
  }
  try {
    fs.unlinkSync(linkPath)
    return { ok: true }
  } catch (error) {
    // Windows 上个别 junction 只接受 rmdir
    try {
      fs.rmdirSync(linkPath)
      return { ok: true }
    } catch {
      return { ok: false, error: `断链失败：${error instanceof Error ? error.message : error}` }
    }
  }
}

function isLinkAt(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}
