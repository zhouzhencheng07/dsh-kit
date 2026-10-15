// 池目录「在应用里打开」的启动面（宿主半边）。
//
// 为什么不让官方的 /open-in-app/open 启动：DSH 桌面外壳用 Electron 二进制当 node 跑宿主
// （启动宿主时设 ELECTRON_RUN_AS_NODE=1），这个标记经「清洗后的父环境」进入宿主 fork 的每个
// 子进程；官方启动器不清它，Electron 系应用（编辑器 / IDE）于是以 node 身份启动——窗口不出现，
// 目录参数被当成脚本入口，现象就是点了没反应（官方会话头那枚按钮同样如此）。
//
// 也不能从宿主进程的环境里摘掉这个标记：官方自己的 node 子进程正靠继承它以 node 身份跑
// （子进程 runner 的环境就是 scrubbedParentEnv()，见 dsh-subprocess-local 的 runnerEnvironment；
// 目录选择器 worker、office 技能同理），摘掉等于把它们换成 GUI 进程。
//
// 所以只有受影响的那几个应用由本模块启动（自己找启动器、自己清子进程环境），其余应用仍走
// 官方路由——非 Electron 的启动器不吃这个标记，没必要自己接管（客户端见 openDirInApp）。

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'

import { scrubbedChildEnv } from '../core/subprocess-env.ts'

/** 启动器的观察窗：窗口内退出非零算失败，窗口结束仍在跑算启动成功（常驻前台的启动器不会被误杀） */
const LAUNCH_WATCH_MS = 1500

interface ManagedApp {
  /** 启动器可执行文件名（Windows 按 App Paths / PATH 认这个名字） */
  exe: string
  /** 默认安装位置，按 %NAME% 展开；App Paths 没登记时用它兜 */
  files: string[]
}

/** 官方目录里以 Electron 启动器打开目录、因此吃宿主那个标记的应用 */
const MANAGED_APPS: Record<string, ManagedApp> = {
  vscode: {
    exe: 'Code.exe',
    files: ['%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe', '%ProgramFiles%/Microsoft VS Code/Code.exe'],
  },
  vscodeinsiders: {
    exe: 'Code - Insiders.exe',
    files: ['%LOCALAPPDATA%/Programs/Microsoft VS Code Insiders/Code - Insiders.exe'],
  },
  cursor: { exe: 'Cursor.exe', files: ['%LOCALAPPDATA%/Programs/cursor/Cursor.exe'] },
  windsurf: { exe: 'Windsurf.exe', files: ['%LOCALAPPDATA%/Programs/Windsurf/Windsurf.exe'] },
}

/** 本平台由本模块启动的应用 id。非 Windows 没有这个标记问题，一律走官方路由 */
export function managedAppIds(): string[] {
  return process.platform === 'win32' ? Object.keys(MANAGED_APPS) : []
}

/** Windows App Paths 根：用户 hive 在前（按用户装的那份盖住机器级的） */
const APP_PATHS_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
]

/** 展开 %NAME% 引用；有未定义的名字就返回 null（与官方候选路径的展开同语义） */
export function expandEnvRefs(text: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let missing = false
  const out = text.replace(/%([^%]+)%/g, (token, name: string) => {
    const value = env[name]
    if (value === undefined) {
      missing = true
      return token
    }
    return value
  })
  return missing ? null : out
}

/** 取 reg query 输出里第一个字符串值（默认值那一列）：值名会本地化（(默认) / (Default)），
 *  所以按 REG_* 类型列取——与官方解析卸载记录同一条判据。 */
export function parseRegStringValue(dump: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const line of dump.split(/\r?\n/)) {
    const matched = /^\s+\S.*?\s+(REG_SZ|REG_EXPAND_SZ)\s+(.+?)\s*$/.exec(line)
    if (matched?.[2] === undefined) continue
    const raw = matched[2].replace(/^"|"$/g, '').trim()
    if (raw === '') continue
    return expandEnvRefs(raw, env)
  }
  return null
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

/** 应用的启动器绝对路径：App Paths 优先，再退默认安装位置；两者都没有返回 null */
export function resolveAppLauncher(app: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const spec = MANAGED_APPS[app]
  if (spec === undefined || process.platform !== 'win32') return null
  for (const root of APP_PATHS_ROOTS) {
    const queried = spawnSync('reg.exe', ['query', `${root}\\${spec.exe}`, '/ve'], { encoding: 'utf8', windowsHide: true })
    if (queried.status !== 0 || typeof queried.stdout !== 'string') continue
    const target = parseRegStringValue(queried.stdout, env)
    if (target !== null && isFile(target)) return target
  }
  for (const template of spec.files) {
    const candidate = expandEnvRefs(template, env)
    if (candidate !== null && isFile(candidate)) return candidate
  }
  return null
}

/** 起一个不随宿主退出的启动器进程；启动成功（含窗口内退 0、窗口结束仍在跑）返回 true */
export function startApp(exe: string, args: string[], watchMs: number = LAUNCH_WATCH_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(exe, [...args], { detached: true, stdio: 'ignore', env: scrubbedChildEnv() })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const settle = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(watch)
      child.unref()
      resolve(ok)
    }
    const watch = setTimeout(() => settle(true), watchMs)
    child.on('error', () => settle(false))
    child.on('exit', (code) => settle(code === 0))
  })
}
