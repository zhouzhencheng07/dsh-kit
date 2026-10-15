// 远程隧道进程单元测试：命令拆解 + 进程生命周期（起/停/错误），不依赖 dsh 运行。
// 用法：node tests\test-phone-tunnel.mjs
import os from 'node:os'
import path from 'node:path'

import { parseCommandLine, startTunnel } from '../src/phone/tunnel.ts'

let failed = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}${!ok && detail ? ` :: ${detail}` : ''}`)
  if (!ok) failed++
}

// ── 命令拆解：双引号包住的路径不被空格拆开 ──
check('空命令 → null', parseCommandLine('') === null && parseCommandLine('   ') === null)
{
  const p = parseCommandLine('frpc.exe -c frpc.toml')
  check('基本拆解：exe + 参数', p?.exe === 'frpc.exe' && JSON.stringify(p.args) === '["-c","frpc.toml"]', JSON.stringify(p))
  const q = parseCommandLine('"C:\\Program Files\\frp\\frpc.exe" -c "D:\\my dir\\frpc.toml"')
  check('引号包住含空格的路径', q?.exe === 'C:\\Program Files\\frp\\frpc.exe' && q.args[1] === 'D:\\my dir\\frpc.toml', JSON.stringify(q))
}

// ── 进程生命周期：拿 node 自己当「隧道客户端」 ──
{
  const code = 'setTimeout(function(){}, 30000)'
  const t = startTunnel({ command: `"${process.execPath}" -e "${code}"` })
  check('启动后 running，且拿到 pid', t.state().running === true && typeof t.pid() === 'number', JSON.stringify(t.state()))
  t.stop()
  await new Promise((resolve) => setTimeout(resolve, 400))
  check('stop 后不再 running', t.state().running === false, JSON.stringify(t.state()))
}
check('空命令启动 → 抛错', (() => { try { startTunnel({ command: '' }); return false } catch { return true } })())
check('程序不存在 → 抛错', (() => { try { startTunnel({ command: path.join(os.tmpdir(), 'no-such-tunnel-xyz.exe') }); return false } catch { return true } })())

console.log(failed === 0 ? '\nALL PASS (phone tunnel)' : '\nFAILED: ' + failed)
process.exit(failed === 0 ? 0 : 1)
