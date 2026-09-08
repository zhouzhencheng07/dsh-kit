// 知识库 git 存档（vault-git.ts）
//
// 职责：把 vaultRoot 做成"随时可整体回退"的存档库。三个自动提交时机：
//   1) 骨架建立时（vaultRoot 配置/变更）——已 init 的仓库跳过，新建仓库初始存档一次；
//   2) 人工保存后（vault/write 端点，Ctrl+S 与工具栏保存同路）——存下人工改动；
//   3) agent 文件编辑工具落盘前（fs/write-intent、fs/edit-intent 瀑布监听）——
//      恢复点严格先于 AI 改动；检索类工具（read/search）无 intent 瀑布，天然不触发。
// 删除另有端点内提交（历史行为，同走 commitVault）。
//
// 降级语义：git 未安装/命令失败/超时一律静默跳过——存档是便利设施，绝不阻断
// 编辑主流程。附件目录不进存档（.gitignore：attachments/ 是图片 pdf 等二进制，
// *.tmp 是 vault/write 原子落盘的残件）。已有 .git 的 vault 不接管（不碰用户的
// 仓库与历史，也不改用户自己的 .gitignore）。
// 并发：提交经模块级 promise 链串行——agent 编辑与人工保存同时触发时避免
// git index.lock 撞车；可用性探测进程内缓存（运行期装 git 属罕见，不追）。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const GIT_TIMEOUT_MS = 15000

/** .gitignore 只在由本模块 init 仓库时写入；用户自己的仓库一字不改 */
const GITIGNORE = 'attachments/\n*.tmp\n'

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
 * 有变化才提交（porcelain 为空即跳过，attachments 已被忽略不计入）；
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
 * 初始存档：vaultRoot 配置建立时调用。无 git / 已是仓库（.git 存在）跳过；
 * 否则 init + 写 .gitignore + 初始提交一次。幂等——重复调用无事发生。
 */
export async function ensureVaultGit(root: string): Promise<void> {
  await enqueue(async () => {
    if (!(await isGitAvailable())) return
    if (fs.existsSync(path.join(root, '.git'))) return
    if ((await runGit(root, ['init'])) === null) return
    try {
      fs.writeFileSync(path.join(root, '.gitignore'), GITIGNORE, 'utf8')
    } catch {
      return
    }
    if ((await runGit(root, ['add', '-A'])) === null) return
    await runGit(root, ['-c', 'user.name=dsh-kit', '-c', 'user.email=dsh-kit@local', 'commit', '-m', 'dsh-kit: 初始存档'])
  })
}

/**
 * 路径是否落在 vault 内（fs/write-intent、fs/edit-intent 的目标过滤）。
 * 大小写不敏感比较（Windows 仓库），目标先尽力 realpath 对齐 vault 根的
 * realpath（vaultScanner.root() 返回 realpath；新建文件 realpath 失败按原样比）。
 */
export function isInsideVault(vaultRoot: string, targetPath: string): boolean {
  const probe = (a: string, b: string): boolean => {
    const rel = path.relative(a, b)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  }
  let real = targetPath
  try {
    real = fs.realpathSync(targetPath)
  } catch {
    /* 新建文件尚不存在：displayPath 已是绝对路径，直接比 */
  }
  return probe(vaultRoot, real) || probe(vaultRoot.toLowerCase(), real.toLowerCase())
}
