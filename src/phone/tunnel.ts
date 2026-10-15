// dsh-kit 手机访问的远程隧道进程：按配置的命令拉起本机隧道客户端（如内网穿透的客户端），
// 进程生命周期完全跟着插件里的「远程访问」开关走——远程没开就不启动，不依赖开机任务。
//
// 命令是一整行字符串（如 `D:\tools\tunnel.exe -c D:\tools\tunnel.toml`）；含空格的路径用
// 双引号包住。插件按这行命令直接 spawn（不经 shell），所以拿到的是客户端本身的 pid，
// 关闭时能干净地杀掉它，也不会多出一层 shell 进程。

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 把一整行命令拆成可执行文件 + 参数；双引号包住的部分不拆（路径里有空格时用） */
export function parseCommandLine(command: string): { exe: string; args: string[] } | null {
  const parts: string[] = []
  let cur = ''
  let quoted = false
  let started = false
  for (const ch of command) {
    if (ch === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/.test(ch)) {
      if (started) {
        parts.push(cur)
        cur = ''
        started = false
      }
      continue
    }
    cur += ch
    started = true
  }
  if (started) parts.push(cur)
  const exe = parts[0]
  if (parts.length === 0 || exe === undefined || exe === '') return null
  return { exe, args: parts.slice(1) }
}

/** 进程镜像名（Windows 走 tasklist；POSIX 读 /proc）；取不到返回 null */
function imageNameOf(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' })
      const line = String(out.stdout ?? '').trim().split(/\r?\n/)[0] ?? ''
      const m = /^"([^"]+)"/.exec(line)
      return m === null ? null : (m[1] ?? null)
    }
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * 收掉上次插件进程遗留的隧道客户端：插件进程被强杀时子进程会变孤儿，而孤儿还占着
 * 隧道连接——下次启动再拉一个会互相抢。pid 与程序名都对上才动，避免误杀别的进程。
 */
export function killStaleTunnel(pid: number, exePath: string, log: (msg: string) => void = () => {}): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  const actual = imageNameOf(pid)
  if (actual === null || actual.toLowerCase() !== path.basename(exePath).toLowerCase()) return false
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(pid, 'SIGTERM')
    log(`收掉上次遗留的隧道进程 pid=${pid}`)
    return true
  } catch {
    return false
  }
}

export interface TunnelHandle {
  /** 进程 pid；已退出或拿不到时为 null */
  pid(): number | null
  state(): { running: boolean; error: string | null }
  stop(): void
}

export interface StartTunnelOptions {
  /** 一整行启动命令 */
  command: string
  log?: (msg: string) => void
}

/** 按命令拉起隧道客户端；命令为空 / 程序不存在 / 启动失败都直接抛错（调用方据此报状态） */
export function startTunnel({ command, log = () => {} }: StartTunnelOptions): TunnelHandle {
  const parsed = parseCommandLine(command)
  if (parsed === null) throw new Error('隧道命令为空')
  const exe = path.resolve(parsed.exe)
  if (!fs.existsSync(exe)) throw new Error(`隧道程序不存在：${exe}`)
  const child = spawn(exe, parsed.args, {
    cwd: path.dirname(exe),
    windowsHide: true,
    stdio: 'ignore',
  })
  const state: { running: boolean; error: string | null } = { running: true, error: null }
  let stopping = false
  child.on('error', (error) => {
    state.running = false
    state.error = error.message
    log(`远程隧道进程异常：${error.message}`)
  })
  child.on('exit', (code, signal) => {
    state.running = false
    if (!stopping && code !== null && code !== 0) state.error = `隧道进程退出（code ${code}${signal === null ? '' : ', ' + signal}）`
    log(`远程隧道进程退出：code=${code} signal=${signal}`)
  })
  return {
    pid: () => child.pid ?? null,
    state: () => ({ running: state.running, error: state.error }),
    stop() {
      stopping = true
      try {
        child.kill()
      } catch {
        // 已经不在就当关过了
      }
    },
  }
}
