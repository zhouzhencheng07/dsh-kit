// 子进程环境清洗：摘掉 Electron 标记、凭证类与 DSH_*，其余照留。
// 用法：node tests\test-child-env.mjs
import { scrubbedChildEnv } from '../src/core/subprocess-env.ts'

let failed = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}${!ok && detail ? ` :: ${detail}` : ''}`)
  if (!ok) failed++
}

const env = scrubbedChildEnv({
  ELECTRON_RUN_AS_NODE: '1',
  DEEPSEEK_API_KEY: 'sk-x',
  DSH_HOME: 'D:\\agent\\.dsh',
  MY_TOKEN: 't',
  my_password: 'p',
  PATH: 'C:\\bin',
  HTTP_PROXY: 'http://127.0.0.1:7890',
})
check(
  '摘掉标记 / 凭证类（不分大小写）/ DSH_*，保留 PATH 与代理',
  env.ELECTRON_RUN_AS_NODE === undefined &&
    env.DEEPSEEK_API_KEY === undefined &&
    env.DSH_HOME === undefined &&
    env.MY_TOKEN === undefined &&
    env.my_password === undefined &&
    env.PATH === 'C:\\bin' &&
    env.HTTP_PROXY === 'http://127.0.0.1:7890',
  JSON.stringify(env),
)
check('空环境不炸', JSON.stringify(scrubbedChildEnv({})) === '{}')
check('值为 undefined 的键不落进结果', !('EMPTY' in scrubbedChildEnv({ EMPTY: undefined })))

console.log(failed === 0 ? '\nALL PASS (child env)' : '\nFAILED: ' + failed)
process.exit(failed === 0 ? 0 : 1)
