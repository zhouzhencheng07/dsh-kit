// 技能组件共用的 git 调用面：spawn 包装 + 可用性探测。
//
// 与 git 相关的模块（挂载体检、池技能版本记录）都走这里，只为两件事：任何失败
// （无 git / 非仓库 / 非零退出 / 超时）都 resolve ok:false 而不抛，调用方自己降级；
// 子进程不继承 GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE——宿主自己跑在某个 git
// 钩子或工具里时，这三个变量会把命令指向别的仓库。

import { spawn } from 'node:child_process'

export interface GitResult {
  ok: boolean
  out: string
  err: string
}

const GIT_TIMEOUT = 10_000

/** 跑一条 git 命令；超时按失败处理（杀掉子进程） */
export function runGit(args: string[], cwd: string, timeoutMs: number = GIT_TIMEOUT): Promise<GitResult> {
  return new Promise((resolve) => {
    const env = { ...process.env }
    delete env.GIT_DIR
    delete env.GIT_WORK_TREE
    delete env.GIT_INDEX_FILE
    let child: import('node:child_process').ChildProcess
    try {
      child = spawn('git', args, { cwd, windowsHide: true, env })
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

let probe: Promise<boolean> | null = null

/** git 是否可用；探测结果按进程缓存（无 git 的机器上不必每次改动都试一遍） */
export function gitAvailable(): Promise<boolean> {
  if (probe === null) probe = runGit(['--version'], process.cwd(), 5000).then((r) => r.ok)
  return probe
}
