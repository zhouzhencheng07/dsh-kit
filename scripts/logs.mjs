// 查 dsh-kit 日志：日志只有一条路径（<DSH_HOME>/dsh-kit/logs/kit.log，按大小轮转），
// 排查全靠这个脚本，不另开读端点。
//
//   node scripts/logs.mjs               最近 80 行（默认）
//   node scripts/logs.mjs --tail 300    最近 N 行
//   node scripts/logs.mjs --err         只看失败：每条 warn/error 连同它前面 20 行
//                                     （前面那几行就是「出错前在做什么」）
//   node scripts/logs.mjs --component files   按组件过滤
//   node scripts/logs.mjs --since 2026-10-01 按日期过滤（行首时间戳的前 10 位）
//   node scripts/logs.mjs --grep watcher   按文本过滤

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes('--' + name)

const home = (process.env.DSH_HOME ?? '').trim() || path.join(os.homedir(), '.dsh')
const dir = path.join(home, 'dsh-kit', 'logs')
const current = path.join(dir, 'kit.log')

/** 轮转文件从旧到新：kit.log.4 → … → kit.log.1 → kit.log */
function files() {
  const out = []
  const keep = 5
  for (let i = keep - 1; i >= 1; i--) {
    const f = path.join(dir, 'kit.log.' + i)
    if (fs.existsSync(f)) out.push(f)
  }
  if (fs.existsSync(current)) out.push(current)
  return out
}

if (!fs.existsSync(current)) {
  console.log('没有日志文件：' + current)
  console.log('（宿主半边启动后才会写；DSH_HOME 当前为 ' + home + '）')
  process.exit(0)
}

const lines = files().flatMap((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/)).filter(Boolean)

const component = argOf('component')
const since = argOf('since')
const grep = argOf('grep')
const matches = (line) => (
  (!component || line.includes(' ' + component + ' '))
  && (!since || line.slice(0, 10) >= since)
  && (!grep || line.includes(grep))
)

if (has('err')) {
  const CONTEXT = 20
  let shown = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/ (WARN|ERROR) /.test(line)) continue
    for (let k = Math.max(0, i - CONTEXT); k <= i; k++) {
      if (matches(lines[k])) console.log(lines[k])
    }
    console.log('---')
    shown++
  }
  if (shown === 0) console.log('（日志里没有 warn/error）')
} else {
  const tail = Math.max(1, Number(argOf('tail', '80')) || 80)
  const picked = lines.filter(matches).slice(-tail)
  for (const line of picked) console.log(line)
  console.log('— 共 ' + lines.length + ' 行，显示 ' + picked.length + ' 行（' + current + '）')
}
