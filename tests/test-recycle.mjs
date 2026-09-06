// 回收站删除单测：跑 src/recycle.ts（node 22+ 直接吃 TS，无需先 build）。
// 用法：node tests/test-recycle.mjs
// Windows 上做真删除（进回收站、逐项对账）；其它平台只验证「返回全 false」契约。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { recycleDelete, recycleDeleteBatch } from '../src/recycle.ts'

let failed = 0
const check = (label, ok) => {
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}`)
  if (!ok) failed++
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-recycle-'))

if (process.platform === 'win32') {
  // 单文件
  const f1 = path.join(dir, 'a.txt')
  fs.writeFileSync(f1, 'x')
  check('单文件进回收站', (await recycleDelete(f1)) === true && !fs.existsSync(f1))
  // 单目录
  const d1 = path.join(dir, 'sub')
  fs.mkdirSync(d1)
  fs.writeFileSync(path.join(d1, 'inner.txt'), 'y')
  check('单目录进回收站', (await recycleDelete(d1)) === true && !fs.existsSync(d1))
  // 批量：文件+目录混合，逐项对账
  const f2 = path.join(dir, 'b.txt')
  const d2 = path.join(dir, 'sub2')
  fs.writeFileSync(f2, 'x')
  fs.mkdirSync(d2)
  const results = await recycleDeleteBatch([f2, d2, path.join(dir, '不存在.txt')])
  check('批量：真实目标逐项成功', results[0] === true && results[1] === true)
  check('批量：不存在的目标按幂等成功计（目标已消失即达成）', results[2] === true)
  check('批量：目标确实消失', !fs.existsSync(f2) && !fs.existsSync(d2))
  // 空批量
  check('空批量返回空数组', JSON.stringify(await recycleDeleteBatch([])) === '[]')
  // 单引号路径（PS 转义面）
  const f3 = path.join(dir, "it's.txt")
  fs.writeFileSync(f3, 'z')
  check('含单引号的路径可删', (await recycleDelete(f3)) === true && !fs.existsSync(f3))
} else {
  const f1 = path.join(dir, 'a.txt')
  fs.writeFileSync(f1, 'x')
  check('非 Windows：返回 false（回退由调用方决定）', (await recycleDelete(f1)) === false)
  check('非 Windows：文件原样保留', fs.existsSync(f1))
  check('非 Windows：批量全 false', JSON.stringify(await recycleDeleteBatch([f1])) === '[false]')
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? 'ALL RECYCLE TESTS OK' : `${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
