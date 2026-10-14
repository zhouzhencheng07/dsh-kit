// 技能池的版本：每个池技能一个自己的 git 仓库。插件只做两件事——进池（或启动时发现
// 手工放进来的）建仓，并记一条**基线**（进池时的状态）；之后的提交、看改动、回滚都在
// 本机应用里做（池分组头的「在应用里打开」把池目录交给它），插件不重复一套界面。
//
// **不替用户提交**：被改一下就自动记一条，题目只可能是「同步技能内容」，看不出改了什么；
// 改技能本来是低频的有意动作，历史很快被同题目的提交淹掉，真要退的时候反而挑不出该退到哪。
// 插件只把仓库和起点备好，其余是用户的事。
//
// 为什么只给池里的技能备仓库：池是跨工作区共用的**本体**，一次坏改动（agent 或手滑）会同时
// 影响所有挂载它的工作区；工作区/用户级的技能归各自的仓库或用户自己管，本模块不碰。
//
// 边界与契约：
//   - 仓库必须是技能目录**自己**的仓库（rev-parse --show-toplevel 就等于该目录），否则
//     说明它落在某个外层仓库里，此时按"未初始化"新建嵌套仓库——插件绝不能替外层仓库
//     提交别人的代码。
//   - 身份与开关只写进该技能仓库自己的 .git/config（dsh-kit / dsh-kit@localhost、
//     关闭签名与自动 gc），绝不动用户全局 git 配置，也不要求用户配过 user.name——
//     用户直接 `git commit` 因此开箱可用。
//   - 出池（移动到工作区/用户级）时调用方负责不带上这个仓库：项目仓库里冒出嵌套仓库，
//     `git add` 只会记一条 gitlink，技能内容反而进不了项目仓库。
//   - 平铺 `.md` 建不了仓（单文件没有目录放 .git），跳过。

import fs from 'node:fs'
import path from 'node:path'

import { gitAvailable, runGit } from './git.ts'
import { kitLogger } from '../core/log.ts'

const log = kitLogger('skills')

const SUBJECT_BASELINE = 'auto: 初始记录'
const BODY_BASELINE = '进入技能池时的状态；之后的提交由人或 agent 有意为之'
/** 撞 index.lock 时的重试间隔（用户自己的 git 命令通常几百毫秒内就结束） */
const LOCK_RETRY_MS = [400, 1200, 2500]

interface CommitResult {
  ok: boolean
  committed: boolean
  error?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 只重试"索引被占用"这一类；其余失败（权限、磁盘、钩子）重试也没用 */
function isLockError(text: string): boolean {
  return /index\.lock|unable to create|another git process/i.test(text)
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
  return lines[lines.length - 1] ?? ''
}

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 目录型技能（池里的平铺 .md 不建仓——单文件没有目录可以放 .git） */
function isSkillDir(p: string): boolean {
  return isDir(p) && fs.existsSync(path.join(p, 'SKILL.md'))
}

function normalize(p: string): string {
  return p.split(path.sep).join('/').replace(/\/+$/, '')
}

/** 技能目录是不是"自己的"仓库根（落在外层仓库里的不算，见文件头边界） */
async function isOwnRepo(skillDir: string): Promise<boolean> {
  if (realOrNull(path.join(skillDir, '.git')) === null) return false
  const top = await runGit(['rev-parse', '--show-toplevel'], skillDir)
  if (!top.ok) return false
  const here = realOrNull(skillDir)
  return here !== null && realOrNull(top.out.trim()) === here
}

interface EnsureResult {
  ok: boolean
  error?: string
  reason?: string
}

/**
 * 本地配置补齐：缺什么补什么，已有值一律不动。身份缺失会让面板提交直接报
 * Author identity unknown（clone 进来、或从别处搬进池的仓库就没有本地身份），
 * 与文件头「不要求用户配过 user.name」冲突。一次 get-regexp 看清全部，够用就不再多起进程。
 */
async function ensureLocalConfig(skillDir: string): Promise<void> {
  const wanted: Array<[string, string]> = [
    ['user.name', 'dsh-kit'],
    ['user.email', 'dsh-kit@localhost'],
    ['commit.gpgsign', 'false'],
    ['gc.auto', '0'],
  ]
  const local = await runGit(['config', '--local', '--get-regexp', '^(user\.name|user\.email|commit\.gpgsign|gc\.auto)$'], skillDir)
  const have = new Set<string>()
  if (local.ok) {
    for (const line of local.out.split(/\r?\n/)) {
      const key = line.split(' ')[0]
      if (key !== undefined && key !== '') have.add(key)
    }
  }
  if (have.size === wanted.length) return
  for (const [key, value] of wanted) {
    if (have.has(key)) continue
    await runGit(['config', '--local', key, value], skillDir)
  }
}

async function ensureRepo(skillDir: string): Promise<EnsureResult> {
  if (!isDir(skillDir)) return { ok: false, reason: 'not-a-dir' }
  if (!(await gitAvailable())) return { ok: false, reason: 'no-git' }
  if (await isOwnRepo(skillDir)) {
    // 已有仓库（clone 进来 / 从别处搬来）同样要补齐缺失的本地配置
    await ensureLocalConfig(skillDir)
    return { ok: true }
  }
  const init = await runGit(['-c', 'init.defaultBranch=main', 'init', '-q'], skillDir)
  if (!init.ok) return { ok: false, reason: 'init-failed', error: init.err.trim() || 'git init 失败' }
  // 身份与签名开关只落本仓库（user.useConfigOnly 之类的全局策略也不影响）
  await ensureLocalConfig(skillDir)
  return { ok: true }
}

/** status --porcelain 解析：状态码两列 + 路径（重命名取新名，带引号则去引号） */
function parseStatus(out: string): string[] {
  const names: string[] = []
  for (const line of out.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let name = line.slice(3).trim()
    if (name.includes(' -> ')) name = name.slice(name.lastIndexOf(' -> ') + 4)
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = name.slice(1, -1)
    names.push(name)
  }
  return names
}

async function statusNames(skillDir: string): Promise<string[]> {
  const status = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain'], skillDir)
  return status.ok ? parseStatus(status.out) : []
}

// ── 每个技能一把锁：面板提交/回滚与基线补齐都会动同一个仓库 ──
const chains = new Map<string, Promise<unknown>>()

function withSkillLock<T>(skillDir: string, job: () => Promise<T>): Promise<T> {
  const key = normalize(skillDir)
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.then(job, job)
  chains.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

/**
 * 把当前内容提交掉。body 省略时自动用改动文件清单当正文。
 * 无改动则什么都不做（返回 committed:false），不产生空提交。
 */
async function commitLocked(skillDir: string, subject: string, body?: string): Promise<CommitResult> {
  const ready = await ensureRepo(skillDir)
  if (!ready.ok) return { ok: false, committed: false, error: ready.error ?? ready.reason ?? '仓库不可用' }
  let last = ''
  // add 与 commit 都要进重试：并发的 index.lock 会让 `git add` 先失败，
  // 此时索引里没有内容，再 commit 只会得到 "nothing to commit"
  for (let attempt = 0; attempt <= LOCK_RETRY_MS.length; attempt++) {
    if (attempt > 0) await sleep(LOCK_RETRY_MS[attempt - 1] ?? 2500)
    const add = await runGit(['add', '-A'], skillDir)
    if (!add.ok) {
      last = lastLine(add.err || add.out)
      if (!isLockError(add.err)) break
      continue
    }
    const names = await statusNames(skillDir)
    if (names.length === 0) return { ok: true, committed: false }
    const head = names.slice(0, 20).join('\n')
    const list = names.length > 20 ? `${head}\n…（共 ${names.length} 个文件）` : head
    const text = body === undefined || body.trim() === '' ? list : `${body.trim()}\n\n${list}`
    const commit = await runGit(['commit', '-q', '-m', subject, '-m', text], skillDir)
    if (commit.ok) return { ok: true, committed: true }
    last = lastLine(commit.err || commit.out)
    if (!isLockError(commit.err)) break
  }
  return { ok: false, committed: false, error: last || 'git commit 失败' }
}

/** 还没有历史就记一条基线（进池时的状态）；已有历史立刻返回，不做任何提交 */
export async function ensurePoolBaseline(skillDir: string): Promise<void> {
  if (!isSkillDir(skillDir)) return
  const name = path.basename(skillDir)
  const ready = await log.op('pool.baseline.repo', () => ensureRepo(skillDir), { skill: name })
  if (!ready.ok) {
    log.warn('技能池版本记录不可用', { skill: name, reason: ready.error ?? ready.reason })
    return
  }
  const result = await log.op('pool.baseline.commit', () => withSkillLock(skillDir, async () => {
    const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], skillDir)
    if (head.ok) return { ok: true, committed: false }
    return commitLocked(skillDir, SUBJECT_BASELINE, BODY_BASELINE)
  }), { skill: name })
  if (!result.ok) log.warn('技能池基线记录失败', { skill: name, reason: result.error ?? '未知原因' })
}

/** 池根下所有目录型技能（平铺 .md 不参与版本记录） */
function poolSkillDirs(poolDir: string): string[] {
  let dirents: fs.Dirent[] = []
  try {
    dirents = fs.readdirSync(poolDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const ent of dirents) {
    if (ent.name.startsWith('.')) continue
    const full = path.join(poolDir, ent.name)
    if (isSkillDir(full)) out.push(full)
  }
  return out
}

/** 同一时刻只跑一轮（启动补齐与面板都会触发），但每次调用都重新列一遍目录——
 *  排队而不是复用上一次的清单，否则这一轮跑起来之后才放进池的技能会被漏掉。 */
let chain: Promise<void> = Promise.resolve()

/**
 * 给池里还没有基线的技能补一遍（串行——同时起几十个 git 没必要）。
 * 启动时跑一次；经面板搬进池的技能由 move 分支当场补。
 *
 * 读技能**列表**不碰 git：那里每拉一次就为每个池技能起两个 git 进程，而 git 子进程的
 * CWD 正是技能目录——Windows 上会短暂锁住它，紧接着的出池/删除就会 EPERM（实测踩到）。
 */
export function ensurePoolBaselines(poolDir: string): Promise<void> {
  const run = chain.then(async () => {
    for (const skillDir of poolSkillDirs(poolDir)) await ensurePoolBaseline(skillDir)
  })
  chain = run.catch(() => undefined)
  return run
}
