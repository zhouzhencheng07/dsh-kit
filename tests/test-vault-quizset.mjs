// 题集单测（dist/vault/quiz-set.js）：生命周期、换页剪进度、失效进度、输入守卫、
// 「题集里不套一天一次」与落盘形状（前端 / 另一端读得下去）。先 pnpm build。
// 用法：node tests/test-vault-quizset.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearSet,
  deleteSet,
  keyOf,
  listSets,
  pagesWithQuestions,
  readSetScope,
  recordSetAnswer,
  saveSet,
} from '../dist/vault/quiz-set.js'
import { readPage, savePage, setThreshold } from '../dist/vault/quiz.js'

const test = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS  ${name}`),
      (error) => {
        console.log(`FAIL  ${name}: ${error.message}`)
        process.exitCode = 1
      },
    )

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-quizset-'))
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }))

const SINGLE = { type: 'single', stem: '题一', options: ['甲', '乙'], answer: 'A', explain: '' }
const page = (rel, qs) => savePage(root, rel, qs, null)

page('python/一', [SINGLE, { ...SINGLE, stem: '题二' }])
page('python/二', [{ ...SINGLE, stem: '题三' }])
page('python/空', [])

await test('pagesWithQuestions：只列有答得了的题的页，计数不含答不了的题', () => {
  const list = pagesWithQuestions(root)
  assert.deepEqual(list.map((p) => p.rel).sort(), ['python/一', 'python/二'])
  assert.deepEqual(Object.fromEntries(list.map((p) => [p.rel, p.count])), { 'python/一': 2, 'python/二': 1 })
})

await test('生命周期：新建 / 列表 / 范围 / 清空 / 删除，页面里的题不受影响', async () => {
  setThreshold(root, 2)
  const saved = saveSet(root, null, '期中考', ['python/一', 'python/二'])
  assert.equal(saved.total, 3)
  assert.equal(saved.mastered, 0)
  assert.equal(saved.invalid, 0)
  assert.match(saved.id, /^\d+$/)
  assert.ok(fs.existsSync(path.join(root, '.quiz-state', 'sets', `${saved.id}.json`)))
  assert.equal(listSets(root).length, 1)
  assert.equal(listSets(root)[0].id, saved.id)

  const id = saved.id
  const qid = readPage(root, 'python/一').questions[0].id
  // 题集里同一天连答两次就达阈值：短期刷题不套「一天一次」
  assert.equal(recordSetAnswer(root, id, 'python/一', qid, true).streak, 1)
  const second = recordSetAnswer(root, id, 'python/一', qid, true)
  assert.equal(second.streak, 2)
  assert.equal(second.mastered, true)
  assert.equal(second.newlyMastered, true)
  assert.equal(second.capped, false)
  assert.equal(listSets(root)[0].mastered, 1)

  const scope = readSetScope(root, id)
  assert.equal(scope.threshold, 2)
  assert.equal(scope.set.total, 3)
  assert.equal(scope.pages.length, 2)
  assert.equal(scope.progress[keyOf('python/一', qid)].mastered, true)

  // 清空进度：题集还在，掌握归零
  const cleared = clearSet(root, id)
  assert.equal(cleared.mastered, 0)
  assert.equal(cleared.total, 3)
  assert.ok(listSets(root).length === 1)

  // 删除：文件没了，页面里的题还在
  deleteSet(root, id)
  assert.deepEqual(listSets(root), [])
  assert.equal(readPage(root, 'python/一').questions.length, 2)
})

await test('换页：不在集里的页的进度被剪掉；题改了算失效', async () => {
  setThreshold(root, 3)
  const saved = saveSet(root, null, '单元', ['python/一', 'python/二'])
  const id = saved.id
  const q1 = readPage(root, 'python/一').questions[0].id
  const q2 = readPage(root, 'python/二').questions[0].id
  recordSetAnswer(root, id, 'python/一', q1, true)
  recordSetAnswer(root, id, 'python/二', q2, true)
  const kept = saveSet(root, id, '单元', ['python/一'])
  assert.deepEqual(kept.pages, ['python/一'])
  assert.equal(kept.total, 2)
  const disk = JSON.parse(fs.readFileSync(path.join(root, '.quiz-state', 'sets', `${id}.json`), 'utf8'))
  assert.deepEqual(Object.keys(disk.progress), [keyOf('python/一', q1)])

  // 题被改了：进度对不上新 id，算失效（报数、不静默丢）
  page('python/一', [{ ...SINGLE, stem: '改过的题' }])
  const after = listSets(root).find((s) => s.id === id)
  assert.equal(after.total, 1)
  assert.equal(after.invalid, 1)
  assert.equal(after.mastered, 0)
  deleteSet(root, id)
})

await test('输入守卫：空名字 / 空页 / 超长名字 / 坏 id / 非字符串页', () => {
  assert.throws(() => saveSet(root, null, '  ', ['python/一']), /题集要有名字/)
  assert.throws(() => saveSet(root, null, '名', []), /至少要有一页/)
  assert.throws(() => saveSet(root, null, '名', 'python/一'), /页面路径数组/)
  assert.throws(() => saveSet(root, null, '名', [1]), /页面路径数组/)
  assert.throws(() => saveSet(root, null, '长'.repeat(41), ['python/一']), /名字最多 40/)
  assert.throws(() => readSetScope(root, '../etc'), /题集不存在/)
  assert.throws(() => readSetScope(root, 'nope'), /题集不存在/)
  assert.throws(() => deleteSet(root, '不存在'), /题集 id 不合法/)
  assert.throws(() => deleteSet(root, 'nope'), /题集不存在/)
  assert.throws(() => recordSetAnswer(root, '不存在', 'python/一', 'x', true), /题集不存在/)
})

await test('落盘形状：id 即文件名、进度键 rel|id、键排序（另一端读得下去）', () => {
  const saved = saveSet(root, null, '形状', ['python/一'])
  const file = path.join(root, '.quiz-state', 'sets', `${saved.id}.json`)
  const q1 = readPage(root, 'python/一').questions[0].id
  recordSetAnswer(root, saved.id, 'python/一', q1, true)
  const text = fs.readFileSync(file, 'utf8')
  const disk = JSON.parse(text)
  assert.equal(disk.id, saved.id)
  assert.equal(disk.name, '形状')
  assert.equal(disk.pages[0], 'python/一')
  assert.ok(disk.progress[keyOf('python/一', q1)])
  const keys = Object.keys(disk.progress)
  assert.deepEqual(keys, keys.slice().sort())
  assert.ok(text.includes('"updatedMs"'))
  deleteSet(root, saved.id)
})

console.log('done')
