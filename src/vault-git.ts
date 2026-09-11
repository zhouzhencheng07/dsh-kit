// 知识库 git 存档（vault-git.ts）
//
// 职责：把 vaultRoot 做成"随时可整体回退"的存档库。三个自动提交时机：
//   1) 骨架建立时（vaultRoot 配置/变更）——已 init 的仓库跳过，新建仓库初始存档一次；
//   2) 人工保存后（vault/write 端点，Ctrl+S 与面板保存同路）——存下人工改动；
//   3) 删除后（delete 端点）——整体可撤回。
// 原第四时机「agent 编辑工具落盘前拦 fs/write-intent、fs/edit-intent 瀑布」已退役
// （2026-09-09 用户定稿 + 实测：该瀑布对 profile 插件不可达——fs/observed 的 emit
// 能到插件 ctx、intent waterfall 收不到；且拦截语义复杂、宿主升级难维护）。agent
// 的版本管理改由知识库使用技能教会的 git -C add/commit 承担（技能由用户自备，
// 插件不随包分发）。
//
// 降级语义：git 未安装/命令失败/超时一律静默跳过——存档是便利设施，绝不阻断
// 编辑主流程。附件与原始资料不进存档（.gitignore：attachments/ 是图片 pdf 等
// 二进制，library/ 是外部导入的原始资料——两者都只增不减、进存档只会把仓库
// 撑爆；*.tmp 是 vault/write 原子落盘的残件）。已有 .git 的 vault 不接管历史，
// 只对「内容确为本模块所写」的 .gitignore 做增量补齐（见 ownsGitignore）。
// 并发：提交经模块级 promise 链串行——人工保存与删除同时触发时避免
// git index.lock 撞车；可用性探测进程内缓存（运行期装 git 属罕见，不追）。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const GIT_TIMEOUT_MS = 15000

/** 不进存档的三类内容；.gitignore 由本模块写（用户自己的仓库一字不改） */
const IGNORE_ENTRIES = ['attachments/', 'library/', '*.tmp']
const GITIGNORE = IGNORE_ENTRIES.join('\n') + '\n'

/** .gitignore 是否可判定为「本模块生成的」：只剩忽略项与注释行即算——
 *  用户自己加过任何一条别的规则就整体让路，绝不越权改写 */
function ownsGitignore(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return true
  return lines.every((l) => l.startsWith('#') || IGNORE_ENTRIES.includes(l))
}

/** 补齐缺失的忽略项；返回是否改写了文件。用户自己的 .gitignore 不动 */
function ensureOwnGitignore(root: string): boolean {
  const file = path.join(root, '.gitignore')
  let text = ''
  try {
    text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  } catch {
    return false
  }
  if (!ownsGitignore(text)) return false
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()))
  const missing = IGNORE_ENTRIES.filter((e) => !have.has(e))
  if (missing.length === 0) return false
  try {
    fs.writeFileSync(file, text.replace(/\r?\n?$/, '\n') + missing.join('\n') + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

let gitAvailable: boolean | null = null

/** git 可用性探测（--version），进程内缓存；任何失败按不可用处理 */
export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable
  gitAvailable = await new Promise<boolean>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', ['--version'], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(false)
    }, GIT_TIMEOUT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      finish(code === 0)
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(false)
    })
  })
  return gitAvailable
}

/** 跑一条 git 命令：exit 0 → stdout，否则 null（无 git/非零/超时统一走这里） */
function runGit(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', ['-C', root, ...args], { windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    let settled = false
    let out = ''
    const finish = (result: string | null) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(null)
    }, GIT_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      finish(code === 0 ? out : null)
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
  })
}

/** 提交串行链：所有写仓库的操作都经这里排队 */
let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}

/**
 * 有变化才提交（porcelain 为空即跳过，attachments/library 已被忽略不计入）；
 * 返回是否真的提交了。身份用 -c 兜底，不依赖宿主机 git 全局配置。
 */
export async function commitVault(root: string, message: string): Promise<boolean> {
  return enqueue(async () => {
    if (!(await isGitAvailable())) return false
    const status = await runGit(root, ['status', '--porcelain'])
    if (status === null || status.trim() === '') return false
    if ((await runGit(root, ['add', '-A'])) === null) return false
    return (
      (await runGit(root, ['-c', 'user.name=dsh-kit', '-c', 'user.email=dsh-kit@local', 'commit', '-m', message])) !== null
    )
  })
}

/**
 * 骨架建立/vaultRoot 变更时调用（插件启动与设置变更都会走到）：无仓库则
 * init + 写 .gitignore + 初始提交一次；已有仓库只做「补齐忽略项 + 把误入
 * 索引的 library/ 移出索引」一次（工作区文件不动，历史保留）。幂等——没有
 * 需要补的东西时一条 git 命令都不发。
 */
export async function ensureVaultGit(root: string): Promise<void> {
  await enqueue(async () => {
    if (!(await isGitAvailable())) return
    if (!fs.existsSync(path.join(root, '.git'))) {
      if ((await runGit(root, ['init'])) === null) return
      try {
        fs.writeFileSync(path.join(root, '.gitignore'), GITIGNORE, 'utf8')
      } catch {
        return
      }
      if ((await runGit(root, ['add', '-A'])) === null) return
      await runGit(root, ['-c', 'user.name=dsh-kit', '-c', 'user.email=dsh-kit@local', 'commit', '-m', 'dsh-kit: 初始存档'])
      return
    }
    // 已有仓库：.gitignore 补齐 + library 出索引。`.gitignore` 只对未跟踪文件
    // 生效，早先版本已把 library/ 提交进索引的库，得显式 --cached 摘掉——
    // 只动索引，磁盘上的原始资料一个字节都不碰。
    const wrote = ensureOwnGitignore(root)
    const tracked = await runGit(root, ['ls-files', '--', 'library'])
    const untrack = tracked !== null && tracked.trim() !== ''
    if (untrack) await runGit(root, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', 'library'])
    if (!wrote && !untrack) return
    if ((await runGit(root, ['add', '-A'])) === null) return
    await runGit(root, [
      '-c',
      'user.name=dsh-kit',
      '-c',
      'user.email=dsh-kit@local',
      'commit',
      '-m',
      'dsh-kit: library 移出存档（原始资料不进版本控制）',
    ])
  })
}
