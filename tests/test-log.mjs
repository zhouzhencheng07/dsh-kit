// core/log 单测：行格式 / 级别过滤（子进程跑不同 DSH_KIT_LOG）/ op 作用域 / 轮转 /
// 落盘失败不抛。用法（dsh-kit 根）：node tests\test-log.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-kit-log-'))
process.env.DSH_HOME = home
const LOG_FILE = path.join(home, 'dsh-kit', 'logs', 'kit.log')
const MODULE = pathToFileURL(path.resolve('src/core/log.ts')).href

const { kitLogger, kitLogFlush, kitLogFormat } = await import(MODULE)

let failed = 0
const check = (label, cond) => {
  console.log(`${cond ? 'PASS  ' : 'FAIL  '}${label}`)
  if (!cond) failed++
}
const read = () => (fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '')
// op() 的结果行在 Promise 落定后才补写：先让微任务跑完，再等写队列排空
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await kitLogFlush()
}

// 1) 默认 info：debug 不落盘，info/warn/error 落盘；行格式为
//    「时间 级别 组件 [作用域] "消息" key=value」
const log = kitLogger('files')
log.debug('不该出现的调试行')
log.info('树已展开', { path: 'D:\\My Projects\\dsh-kit', entries: 142 })
log.warn('目录读取慢', { ms: 812 })
await settle()
let text = read()
check('默认级别过滤掉 debug', !text.includes('不该出现的调试行'))
check('info 行带时间/级别/组件', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} INFO {2}files "树已展开" path=/m.test(text))
check('字段按 key=value 落盘', text.includes('entries=142'))
check('含空格的字段值加引号', text.includes('path="D:\\My Projects\\dsh-kit"'))
check('warn 行级别正确', / WARN {2}files "目录读取慢"/.test(text))

// 2) op 作用域：作用域内的日志自动带路径，结束时补一条结果行
log.op('git.status', () => {
  log.info('读仓库状态')
  return log.op('runGit', () => Promise.resolve('ok'))
})
try {
  log.op('git.commit', () => {
    throw new Error('nothing to commit')
  })
} catch {
  // 调用方自己处理；日志负责留痕
}
await settle()
text = read()
check('作用域内日志带作用域路径', text.includes('INFO  files git.status "读仓库状态"'))
check('嵌套作用域路径拼接', text.includes('git.status>runGit'))
check('成功补结果行且带耗时', /INFO {2}files git\.status "git\.status ok" dur=\d+ms/.test(text))
check('失败补结果行且带 err', text.includes('git.commit 失败') && text.includes('err="Error: nothing to commit"'))
check('Error 的 stack 调用帧缩进跟行', text.includes('\n    at '))

// 3) kitLogFormat 是纯排版函数：错误字段出 stack 续行
const formatted = kitLogFormat({
  ts: 0,
  level: 'error',
  component: 'vault',
  scope: '',
  msg: '写入失败',
  fields: { err: new Error('EACCES') },
})
check('排版：首行含级别与组件', formatted.startsWith('1970-01-01 08:00:00.000 ERROR vault '))
check('排版：stack 逐行缩进', formatted.split('\n').slice(1).every(line => line.startsWith('    ')))

// 4) 轮转：超过 2MB 后 kit.log.1 出现，kit.log 只剩尾部
for (let i = 0; i < 3; i++) log.info('x'.repeat(900 * 1024), { i })
await settle()
check('超 2MB 触发轮转', fs.existsSync(LOG_FILE + '.1'))
check('轮转后当前文件回到 2MB 以内', fs.statSync(LOG_FILE).size < 2 * 1024 * 1024)

// 5) 落盘失败不抛：把 logs 目录换成只读文件占位，写不进去也只丢这条
const readOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-kit-ro-'))
process.env.DSH_HOME = readOnly
const blocked = path.join(readOnly, 'dsh-kit', 'logs')
fs.mkdirSync(path.dirname(blocked), { recursive: true })
fs.writeFileSync(blocked, 'not a dir')
let threw = false
try {
  log.error('写不进去也要照常返回')
  await settle()
} catch {
  threw = true
}
check('落盘失败不抛错', !threw)

// 6) 级别由 DSH_KIT_LOG 决定：子进程分别跑 error / off
const runWith = (level, line) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-kit-lvl-'))
  const code = `const m = await import(${JSON.stringify(MODULE)});`
    + `m.kitLogger('x').info('${line}');`
    + `m.kitLogger('x').error('${line}2');`
    + `await m.kitLogFlush();`
  spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, DSH_HOME: dir, DSH_KIT_LOG: level, DSH_KIT_LOG_CONSOLE: '0' },
    encoding: 'utf8',
  })
  const file = path.join(dir, 'dsh-kit', 'logs', 'kit.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}
const atError = runWith('error', 'L')
check('DSH_KIT_LOG=error 只留 error', !atError.includes('"L"') && atError.includes('"L2"'))
check('DSH_KIT_LOG=off 一条不写', runWith('off', 'L') === '')

// 7) DSH_KIT_LOG_CONSOLE=0 关掉 warn/error 的 console 镜像（文件照写）
const silentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-kit-quiet-'))
const noise = []
const realWarn = console.warn
const realError = console.error
console.warn = (...args) => noise.push(args)
console.error = (...args) => noise.push(args)
process.env.DSH_KIT_LOG_CONSOLE = '0'
process.env.DSH_HOME = silentDir
const quietMod = await import(MODULE + '?quiet')
quietMod.kitLogger('x').error('静默目录的报错')
await quietMod.kitLogFlush()
console.warn = realWarn
console.error = realError
check('关镜像后 console 干净', noise.length === 0)
check('关镜像后文件照写', fs.readFileSync(path.join(silentDir, 'dsh-kit', 'logs', 'kit.log'), 'utf8').includes('静默目录的报错'))

fs.rmSync(home, { recursive: true, force: true })
fs.rmSync(readOnly, { recursive: true, force: true })
fs.rmSync(silentDir, { recursive: true, force: true })
console.log(failed === 0 ? '全部通过' : failed + ' 项失败')
process.exit(failed === 0 ? 0 : 1)
