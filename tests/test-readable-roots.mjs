// readable-roots 单测：根集合（请求 cwd + 组件注册的根）与包含判定。
// 用法（dsh-kit 根）：node tests\test-readable-roots.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerReadableRoot, readableRoots, withinReadable } from '../src/core/readable-roots.ts'

let failed = 0
const check = (label, cond) => {
  console.log(`${cond ? 'PASS  ' : 'FAIL  '}${label}`)
  if (!cond) failed++
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-roots-'))
const ws = path.join(base, 'ws')
const vault = path.join(base, 'vault')
const elsewhere = path.join(base, 'elsewhere')
for (const dir of [ws, vault, elsewhere, path.join(vault, 'attachments', 'aa'), path.join(ws, 'sub')]) {
  fs.mkdirSync(dir, { recursive: true })
}
const file = (dir, name) => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, 'x')
  return p
}

// ── withinReadable：根本身不算内、越界不算内 ──
check('根内的文件 → 内', withinReadable(file(ws, 'a.md'), readableRoots(ws)) === true)
check('根内的子目录文件 → 内', withinReadable(file(ws, 'sub/a.md'), readableRoots(ws)) === true)
check('根本身 → 不算内（根不是文件）', withinReadable(ws, readableRoots(ws)) === false)
check('根外的同级目录 → 外', withinReadable(file(elsewhere, 'a.md'), readableRoots(ws)) === false)
check('根集合为空 → 一律外', withinReadable(file(ws, 'a.md'), []) === false)
check('不存在的目标 → 外', withinReadable(path.join(ws, 'nope.md'), readableRoots(ws)) === false)

// ── 根集合：请求 cwd 计入，不存在的 cwd 被剔除 ──
check('cwd 计入根集合', readableRoots(ws).length === 1)
check('不存在的 cwd 被剔除', readableRoots(path.join(base, 'nope')).length === 0)
check('空串 cwd 不计入', readableRoots('').length === 0 && readableRoots('   ').length === 0)

// ── 组件注册的根：注册后可读、注销后立刻不可读 ──
const dispose = registerReadableRoot('vault', () => vault)
check('注册后库内文件可读', withinReadable(file(vault, 'p.md'), readableRoots('')) === true)
check('注册后库内插图可读', withinReadable(file(vault, 'attachments/aa/x.png'), readableRoots('')) === true)
check('注册根之外仍不可读', withinReadable(file(elsewhere, 'a.md'), readableRoots('')) === false)
dispose()
check('注销后立刻不可读', withinReadable(file(vault, 'p.md'), readableRoots('')) === false)

// ── 提供方：返回数组 / 返回空串 / 返回 null / 抛错都不该放行或打断整条链 ──
const dispose2 = registerReadableRoot('multi', () => [vault, path.join(base, 'nope'), ''])
check('数组根逐个计入（不存在的被剔除）', readableRoots('').length === 1)
dispose2()
const dispose3 = registerReadableRoot('nullish', () => null)
check('返回 null 的提供方不贡献根', readableRoots('').length === 0)
dispose3()
const dispose4 = registerReadableRoot('boom', () => {
  throw new Error('provider exploded')
})
const dispose5 = registerReadableRoot('ok', () => vault)
check('提供方抛错不拖垮整条链（后来的根照常放行）', withinReadable(file(vault, 'p.md'), readableRoots('')) === true)
dispose4()
dispose5()

// ── 同名注册覆盖：后注册的顶掉前一个 ──
const disposeOld = registerReadableRoot('dup', () => vault)
const disposeNew = registerReadableRoot('dup', () => elsewhere)
check('同名再注册：旧根失效、新根生效', withinReadable(file(vault, 'p.md'), readableRoots('')) === false && withinReadable(file(elsewhere, 'a.md'), readableRoots('')) === true)
disposeNew()
check('注销只撤当前那个（旧的已解绑，不复活）', withinReadable(file(vault, 'p.md'), readableRoots('')) === false)
disposeOld()

fs.rmSync(base, { recursive: true, force: true })

console.log(failed === 0 ? '\nALL PASS（readable-roots）' : `\n${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)