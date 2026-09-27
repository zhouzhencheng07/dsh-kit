// 技能池挂载：载体根选择 + git 体检/忽略 + 目录链接的建立与移除。
//
// 池（$DSH_HOME/skill-pool）不挂扫描根，要让某个工作区看见池里的技能，就得在该工作区
// 的一个项目级根里建一条指向池的目录链接（Windows 用 junction、POSIX 用目录 symlink）。
// 两个项目级根分工：用户习惯用的那个留给项目自己的技能（本模块不碰它的 git 归属），
// 空着的另一个当载体根并整目录忽略——技能不进项目仓库（junction 会被 git 当普通目录
// 收录、`git restore` 还会写穿回池里的本体）。
//
// 本模块只做机制，不做取舍：跨根同名的优先级由宿主 rank 决定，删链接还是删本体由用户
// 决定；这里只负责"判定载体根 / 写忽略 / 建链 / 断链"。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

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
  /** 载体根；null = 两个根都在用，等用户选 */
  carrierRoot: ProjectRootId | null
  carrierDir: string
  localRoot: ProjectRootId
  localDir: string
  inUse: { dsh: boolean; agents: boolean }
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

interface GitResult {
  ok: boolean
  out: string
  err: string
}

const GIT_TIMEOUT = 10_000

/** 跑一条 git 命令；任何失败（无 git / 非仓库 / 非零 / 超时）都 resolve ok:false */
function runGit(args: string[], cwd: string, timeoutMs: number = GIT_TIMEOUT): Promise<GitResult> {
  return new Promise((resolve) => {
    let child: import('node:child_process').ChildProcess
    try {
      child = spawn('git', args, { cwd, windowsHide: true })
    } catch {
      resolve({ ok: false, out: '', err: '' })
      return
    }
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(false)
    }, timeoutMs)
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, out, err })
    }
    child.stdout?.on('data', (d) => {
      out += String(d)
    })
    child.stderr?.on('data', (d) => {
      err += String(d)
    })
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

// ── 载体根选择（机器本地存储：链接与它的性质一致，都不随仓库走）──

interface Policy {
  projects: Record<string, { carrier?: ProjectRootId }>
}

function policyFile(): string {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME.trim() : path.join(os.homedir(), '.dsh')
  return path.join(home, 'data', 'dsh-kit-skills.json')
}

function readPolicy(): Policy {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(policyFile(), 'utf8'))
    const projects = (parsed as { projects?: unknown }).projects
    if (projects !== null && typeof projects === 'object') return { projects: projects as Policy['projects'] }
  } catch {
    // 无文件/坏文件都当空策略
  }
  return { projects: {} }
}

/** 记住用户为某个项目选定的载体根（两个项目级根都在用、必须二选一时才需要） */
export function setCarrier(projectRoot: string, carrier: ProjectRootId): void {
  const policy = readPolicy()
  policy.projects[projectRoot] = { carrier }
  const file = policyFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
}

// ── 载体根判定 ──

/** 一个根里的条目分角色统计：链接不算"用户在用"（否则首次挂载后就会误判两个根都在用） */
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

/** 读载体根当前状态（只读，不写盘）：载体根归属、忽略状态、已跟踪内容 */
export async function computeMountState(dirs: ProjectDirs): Promise<MountState> {
  const dsh = entryRoles(dirs.dshDir)
  const agents = entryRoles(dirs.agentsDir)
  const inUse = { dsh: dsh.own > 0, agents: agents.own > 0 }
  const pinnedCarrier = readPolicy().projects[dirs.projectRoot]?.carrier ?? null
  let carrier: ProjectRootId | null
  if (pinnedCarrier !== null) carrier = pinnedCarrier
  else if (inUse.dsh && !inUse.agents) carrier = 'project-agents'
  else if (inUse.agents && !inUse.dsh) carrier = 'project-dsh'
  else if (!inUse.dsh && !inUse.agents) carrier = 'project-agents'
  else carrier = null
  const effective: ProjectRootId = carrier ?? 'project-agents'
  const carrierRoles = effective === 'project-dsh' ? dsh : agents
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
    carrierDir: effective === 'project-dsh' ? dirs.dshDir : dirs.agentsDir,
    localRoot: effective === 'project-dsh' ? 'project-agents' : 'project-dsh',
    localDir: effective === 'project-dsh' ? dirs.agentsDir : dirs.dshDir,
    inUse,
    pinned: pinnedCarrier !== null,
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
 * 体检并准备载体根：处理已进仓库的内容（搬到本地根 / 仅从仓库移除）+ 写忽略规则。
 * 未忽略的载体根不能挂载——一挂，池里的内容就会被项目仓库当普通文件收进去。
 */
export async function prepareCarrier(dirs: ProjectDirs, state: MountState, resolve?: 'move' | 'untrack'): Promise<PrepareResult> {
  if (state.needsChoice) return { ok: false, error: '两个项目级根都在用：先选定哪个当载体根' }
  const tracked = state.repoRoot !== null ? state.tracked : []
  if (tracked.length > 0 && resolve === undefined) return { ok: false, needResolve: true, tracked }
  const moved: string[] = []
  const skipped: string[] = []
  if (resolve === 'move') {
    fs.mkdirSync(state.localDir, { recursive: true })
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
      const dst = path.join(state.localDir, ent.name)
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

/** 挂载前置条件：载体根已定且已被忽略（非仓库时看忽略行是否在 .gitignore 里） */
export function mountPrecondition(state: MountState): { ok: boolean; error?: string } {
  if (state.needsChoice) return { ok: false, error: '两个项目级根都在用：先选定哪个当载体根' }
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
