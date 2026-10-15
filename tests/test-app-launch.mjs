// 池目录启动面：应用表 / 环境清洗 / 注册表取值解析，以及真起进程的启动语义。
// 探针用系统的命令行解释器而不是 node：本测试可能跑在 Electron 二进制当 node 的进程里，
// 那种情况下去掉标记的 node 子进程会变成 GUI 进程。（pwsh 也不行：detached 起 pwsh 时它
// 不执行脚本就退出——那是 pwsh 自己的行为，与启动器无关。）
// 用法：node tests\test-app-launch.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  expandEnvRefs,
  launcherEnv,
  managedAppIds,
  parseRegStringValue,
  resolveAppLauncher,
  startApp,
} from '../src/skills/app-launch.ts'

let failed = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}${!ok && detail ? ` :: ${detail}` : ''}`)
  if (!ok) failed++
}

// ── 应用表：只接管 Electron 系，且只在 Windows 上接管 ──
{
  const ids = managedAppIds()
  check(
    'Windows 上接管 vscode（非 Windows 为空）',
    process.platform === 'win32' ? ids.includes('vscode') : ids.length === 0,
    JSON.stringify(ids),
  )
  check('未接管的应用一律返回 null', resolveAppLauncher('explorer') === null && resolveAppLauncher('sublimetext') === null)
  const vscode = resolveAppLauncher('vscode')
  check('vscode 解析结果要么没有、要么是真实文件', vscode === null || fs.existsSync(vscode), String(vscode))
  console.log('       （本机 vscode 启动器：' + String(vscode) + '）')
}

// ── %NAME% 展开：未定义就整体作废 ──
check(
  '展开 %NAME%',
  expandEnvRefs('%A%/x/%B%', { A: 'C:\\p', B: 'q' }) === 'C:\\p/x/q',
  String(expandEnvRefs('%A%/x/%B%', { A: 'C:\\p', B: 'q' })),
)
check('引用未定义的名字 → null', expandEnvRefs('%NOPE%/x', {}) === null)

// ── reg query 取值：值名列本地化，按 REG_* 类型列取 ──
{
  const zh = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe',
    '    (默认)    REG_SZ    D:\\zzc\\ProgramFiles\\Microsoft VS Code\\Code.exe',
    '',
  ].join('\r\n')
  const en = 'HKEY_LOCAL_MACHINE\\...\\App Paths\\Code.exe\r\n    (Default)    REG_EXPAND_SZ    "%ProgramFiles%\\Microsoft VS Code\\Code.exe"\r\n'
  check('中文默认值名', parseRegStringValue(zh) === 'D:\\zzc\\ProgramFiles\\Microsoft VS Code\\Code.exe', String(parseRegStringValue(zh)))
  check(
    '英文默认值名 + 引号 + %VAR% 展开',
    parseRegStringValue(en, { ProgramFiles: 'C:\\Program Files' }) === 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    String(parseRegStringValue(en, { ProgramFiles: 'C:\\Program Files' })),
  )
  check('没有值的输出 → null', parseRegStringValue('错误: 系统找不到指定的注册表项或值。') === null)
}

// ── 子进程环境：摘掉标记与凭证类变量，其余照留 ──
{
  const env = launcherEnv({
    ELECTRON_RUN_AS_NODE: '1',
    DEEPSEEK_API_KEY: 'sk-x',
    DSH_HOME: 'D:\\agent\\.dsh',
    MY_TOKEN: 't',
    PATH: 'C:\\bin',
  })
  check(
    '摘掉标记 / 凭证类 / DSH_*，保留其余',
    env.ELECTRON_RUN_AS_NODE === undefined &&
      env.DEEPSEEK_API_KEY === undefined &&
      env.DSH_HOME === undefined &&
      env.MY_TOKEN === undefined &&
      env.PATH === 'C:\\bin',
    JSON.stringify(env),
  )
}

// ── 真起进程：子进程自己报看到的环境 ──
const isWin = process.platform === 'win32'
const shell = isWin ? 'cmd.exe' : 'sh'
const shellArgs = (script) => (isWin ? ['/c', script] : [script])
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-open-app-'))
const seen = path.join(work, 'seen.txt')
const probeScript = path.join(work, isWin ? 'probe.bat' : 'probe.sh')
const exitScript = path.join(work, isWin ? 'exit3.bat' : 'exit3.sh')
const aliveScript = path.join(work, isWin ? 'alive.bat' : 'alive.sh')
if (isWin) {
  fs.writeFileSync(probeScript, `@echo [%ELECTRON_RUN_AS_NODE%][%PATH%]> "${seen}"\r\n`)
  fs.writeFileSync(exitScript, '@exit /b 3\r\n')
  fs.writeFileSync(aliveScript, '@ping -n 5 127.0.0.1 > nul\r\n')
} else {
  fs.writeFileSync(probeScript, `printf '%s|%s\\n' "$ELECTRON_RUN_AS_NODE" "$PATH" > "${seen}"\n`)
  fs.writeFileSync(exitScript, 'exit 3\n')
  fs.writeFileSync(aliveScript, 'sleep 10\n')
}
process.env.ELECTRON_RUN_AS_NODE = '1'
process.env.DEEPSEEK_API_KEY = 'sk-should-not-leak'
check('探针进程启动成功', await startApp(shell, shellArgs(probeScript), 30000) === true)
{
  let raw = null
  try {
    raw = fs.readFileSync(seen, 'utf8').trim()
  } catch {}
  const flag = raw === null ? 'no-file' : raw.replaceAll('][', '|').replaceAll('[', '').replaceAll(']', '').split('|')[0]
  check('子进程看不到 ELECTRON_RUN_AS_NODE', flag === '', JSON.stringify(raw))
}
check('程序不存在 → false', await startApp(path.join(work, 'no-such-app-xyz.exe'), [], 3000) === false)
check('观察窗内非零退出 → false', await startApp(shell, shellArgs(exitScript), 30000) === false)
check('观察窗内仍活着 → true', await startApp(shell, shellArgs(aliveScript), 400) === true)

fs.rmSync(work, { recursive: true, force: true })
console.log(failed === 0 ? '\nALL PASS (app launch)' : '\nFAILED: ' + failed)
process.exit(failed === 0 ? 0 : 1)
