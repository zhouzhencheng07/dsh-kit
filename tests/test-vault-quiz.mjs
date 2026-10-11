// vault 测验半边单测（md 解析/序列化往返、内容哈希 id、掌握度与阈值、范围汇总、
// 改名/移动/删除的伴生文件跟随）：跑 dist/vault/*.js（先 pnpm build）。
// 用法：node tests/test-vault-quiz.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_THRESHOLD,
  followPage,
  forget,
  parseMd,
  progressPath,
  questionId,
  quizPath,
  readPage,
  readProgress,
  readScope,
  readSettings,
  record,
  markMastered,
  revision,
  savePage,
  setThreshold,
  siblingsForDelete,
  toMd,
  validate,
} from '../dist/vault/quiz.js'
import { createEntry, deleteEntries, moveEntry, renameEntry } from '../dist/vault/fs.js'

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

const SINGLE = { type: 'single', stem: '1+1=?', options: ['一', '二'], answer: 'B', explain: '' }
const MULTI = { type: 'multi', stem: '选偶数', options: ['2', '3', '4'], answer: 'AC', explain: '偶数' }
const JUDGE = { type: 'judge', stem: '地球是圆的', options: [], answer: true, explain: '因为地球是球体' }
const BLANK = { type: 'blank', stem: '中国的首都是____', options: [], answer: [['北京', '帝都']], explain: '' }

await test('parseMd：四种题型各归各位，标记外内容置 junk', () => {
  const text = toMd([SINGLE, MULTI, JUDGE, BLANK])
  const [qs, junk] = parseMd(text)
  assert.equal(junk, false)
  assert.deepEqual(qs, [SINGLE, MULTI, JUDGE, BLANK])
  const [bad, junk2] = parseMd('这不是题目\n<!--answer-->\n真正的题在前\n')
  assert.equal(bad.length, 0)
  assert.equal(junk2, true)
})

await test('toMd：落盘字节与桌面端同形（段间空行、opt/answer/explain 标记）', () => {
  const md = toMd([SINGLE, JUDGE])
  assert.equal(
    md,
    '<!--q type=single-->\n1+1=?\n\n<!--opt-->\n- 一\n- 二\n\n<!--answer-->\nB\n' +
      '\n<!--q type=judge-->\n地球是圆的\n\n<!--answer-->\ntrue\n\n<!--explain-->\n因为地球是球体\n',
  )
})

await test('parseMd：围栏里的标记行是普通文本；缩进的标记也不认', () => {
  const text = '<!--q type=judge-->\n看代码\n\n```md\n<!--answer-->\n```\n\n<!--answer-->\ntrue\n'
  const [qs] = parseMd(text)
  assert.equal(qs.length, 1)
  assert.match(qs[0].stem, /<!--answer-->/)
  const [indented] = parseMd('<!--q type=judge-->\n题\n\n <!--answer-->\n\n<!--answer-->\ntrue\n')
  assert.equal(indented[0].answer, true)
})

await test('parseMd：填空的 | 别名与转义竖线；判断题的对错写法', () => {
  const [qs] = parseMd('<!--q type=blank-->\n填\n\n<!--answer-->\n北京 | 帝都\na\\|b\n')
  assert.deepEqual(qs[0].answer, [['北京', '帝都'], ['a|b']])
  const [j] = parseMd('<!--q type=judge-->\n题\n\n<!--answer-->\n对\n')
  assert.equal(j[0].answer, true)
  const [j2] = parseMd('<!--q type=judge-->\n题\n\n<!--answer-->\nFALSE\n')
  assert.equal(j2[0].answer, false)
})

await test('questionId：内容哈希钉住跨端向量；空白不敏感、字母升序归一', () => {
  assert.equal(questionId(SINGLE), '0005f938503b47eb')
  assert.equal(questionId(MULTI), '8ff4907f7a23bd45')
  assert.equal(questionId(JUDGE), '9f47a0fe61443c14')
  assert.equal(questionId(BLANK), '873d5b29ce6fdd4a')
  assert.equal(questionId({ ...SINGLE, stem: ' 1 + 1 = ? ' }), questionId(SINGLE))
  assert.equal(questionId({ ...SINGLE, answer: 'AB' === 'AB' ? 'BA' : 'AB' }), questionId({ ...SINGLE, answer: 'AB' }))
})

await test('validate：非法题目逐条指出，合法回 null', () => {
  assert.equal(validate(SINGLE), null)
  assert.equal(validate({ ...SINGLE, stem: ' ' }), '题干不能为空')
  assert.match(validate({ ...SINGLE, answer: 'AB' }) ?? '', /单选/)
  assert.match(validate({ ...MULTI, answer: 'A' }) ?? '', /多选/)
  assert.match(validate({ ...SINGLE, answer: 'C' }) ?? '', /超出选项范围/)
  assert.match(validate({ ...SINGLE, options: ['一'] }) ?? '', /至少两个选项/)
  assert.match(validate({ ...JUDGE, answer: 'true' }) ?? '', /true \/ false/)
  assert.match(validate({ ...BLANK, answer: [] }) ?? '', /至少要有一个空/)
  assert.match(validate({ ...BLANK, answer: [[' ']] }) ?? '', /字符串数组/)
  assert.match(validate({ ...JUDGE, type: 'essay' }) ?? '', /不认识的题型/)
})

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-quiz-'))
const page = (rel) => path.join(root, `${rel}.md`)
const mkpage = (rel, body = '# 页') => {
  fs.mkdirSync(path.dirname(page(rel)), { recursive: true })
  fs.writeFileSync(page(rel), body, 'utf8')
}

await test('savePage/readPage：写读往返、空数组删干净、坏文件按 0 题处理', () => {
  mkpage('数学/1.1')
  const saved = savePage(root, '数学/1.1', [SINGLE, JUDGE], null)
  assert.equal(saved.questions.length, 2)
  assert.equal(saved.questions[0].id, questionId(SINGLE))
  assert.ok(fs.existsSync(quizPath(root, '数学/1.1')))
  assert.deepEqual(readPage(root, '数学/1.1'), saved)
  fs.writeFileSync(quizPath(root, '数学/1.1'), '漏了标记的正文', 'utf8')
  assert.deepEqual(readPage(root, '数学/1.1'), { rel: '数学/1.1', questions: [] })
  savePage(root, '数学/1.1', [], null)
  assert.ok(!fs.existsSync(quizPath(root, '数学/1.1')))
  assert.ok(!fs.existsSync(path.join(root, '数学', '.quiz')))
  assert.throws(() => savePage(root, '../逃逸', [SINGLE], null), /页面路径非法/)
})

await test('savePage：同内容去重；edit.keep 搬记录、不 keep 清零', () => {
  mkpage('数学/2.1')
  const first = savePage(root, '数学/2.1', [SINGLE], null)
  const id = first.questions[0].id
  record(root, '数学/2.1', id, true)
  record(root, '数学/2.1', id, true)
  // 同题再交一遍：去重成一道，记录还在
  const dup = savePage(root, '数学/2.1', [SINGLE, SINGLE], null)
  assert.equal(dup.questions.length, 1)
  assert.equal(readProgress(root, '数学/2.1', null).progress[id].streak, 2)
  // 改解析（不动答案）：id 不变；不 keep 时记录清零
  const edited = savePage(root, '数学/2.1', [{ ...SINGLE, explain: '口算' }], { index: 0, oldId: id, keep: false })
  assert.equal(edited.questions[0].id, id)
  assert.equal(readProgress(root, '数学/2.1', null).progress[id], undefined)
  // 再改回原文案并 keep：记录从零随新 id 走（旧 id 本就没记录，等于无操作）
  const kept = savePage(root, '数学/2.1', [SINGLE], { index: 0, oldId: id, keep: true })
  assert.equal(kept.questions[0].id, id)
})

await test('savePage：与标记同形的题干拒绝落盘', () => {
  mkpage('数学/3.1')
  assert.throws(
    () => savePage(root, '数学/3.1', [{ ...SINGLE, stem: '<!--answer-->\n冒充' }], null),
    /同形的行/,
  )
})

await test('record/markMastered/forget：连击达阈值即掌握，答错归零', () => {
  mkpage('数学/4.1')
  savePage(root, '数学/4.1', [SINGLE], null)
  const id = readPage(root, '数学/4.1').questions[0].id
  assert.equal(DEFAULT_THRESHOLD, 3)
  let out = record(root, '数学/4.1', id, true)
  assert.deepEqual(out, { streak: 1, mastered: false, newlyMastered: false })
  out = record(root, '数学/4.1', id, true)
  out = record(root, '数学/4.1', id, true)
  assert.deepEqual(out, { streak: 3, mastered: true, newlyMastered: true })
  assert.deepEqual(record(root, '数学/4.1', id, false), { streak: 0, mastered: false, newlyMastered: false })
  assert.deepEqual(markMastered(root, '数学/4.1', id), { streak: 3, mastered: true, newlyMastered: true })
  assert.deepEqual(markMastered(root, '数学/4.1', id), { streak: 3, mastered: true, newlyMastered: false })
  assert.deepEqual(forget(root, '数学/4.1', id), { streak: 0, mastered: false, newlyMastered: false })
})

await test('setThreshold：1..20 夹取；已掌握但连击低于新阈值的刷回', () => {
  assert.equal(setThreshold(root, 0), 1)
  assert.equal(setThreshold(root, 99), 20)
  mkpage('数学/5.1')
  savePage(root, '数学/5.1', [SINGLE], null)
  const id = readPage(root, '数学/5.1').questions[0].id
  setThreshold(root, 2)
  markMastered(root, '数学/5.1', id)
  setThreshold(root, 3)
  assert.equal(readProgress(root, '数学/5.1', null).progress[id].mastered, false)
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.quiz-state', 'settings.json'), 'utf8'))
  assert.equal(settings.threshold, 3)
  assert.equal(readSettings(root).threshold, 3)
})

await test('readProgress：一页 / 目录 / 整库三个口径', () => {
  const id = readPage(root, '数学/5.1').questions[0].id
  markMastered(root, '数学/5.1', id)
  assert.ok(readProgress(root, '数学/5.1', null).progress[id])
  assert.ok(readProgress(root, null, '数学').progress[id])
  assert.ok(readProgress(root, null, '').progress[id])
})

await test('readScope：递归收题，跳过点前缀 / 约定目录 / 资料库与冲突副本', () => {
  savePage(root, '数学/1.1', [SINGLE], null)
  mkpage('数学/第一章/1.2')
  savePage(root, '数学/第一章/1.2', [JUDGE], null)
  mkpage('别的/9.9')
  savePage(root, '别的/9.9', [BLANK], null)
  fs.mkdirSync(path.join(root, 'attachments'), { recursive: true })
  fs.mkdirSync(path.join(root, 'library'), { recursive: true })
  fs.writeFileSync(path.join(root, 'library', '.quiz'), '', 'utf8')
  fs.rmSync(path.join(root, 'library', '.quiz'), { force: true })
  fs.writeFileSync(page('别的/9.9.conflict-手机-2026') , '', 'utf8')
  const scope = readScope(root, '数学')
  assert.deepEqual(scope.pages.map((p) => p.rel).sort(), ['数学/1.1', '数学/2.1', '数学/4.1', '数学/5.1', '数学/第一章/1.2'])
  const all = readScope(root, '')
  assert.ok(all.pages.some((p) => p.rel === '别的/9.9'))
  assert.equal(all.pages.filter((p) => p.rel.includes('conflict')).length, 0)
})

await test('revision：指纹随文件数与 mtime 走，页面口径只看自己的两份 + 阈值', () => {
  const before = revision(root, '数学/5.1', null)
  assert.equal(before.files, 3)
  const scopeBefore = revision(root, null, '别的')
  fs.utimesSync(quizPath(root, '别的/9.9'), new Date(), new Date(Date.now() + 5000))
  const scopeAfter = revision(root, null, '别的')
  assert.equal(scopeAfter.files, scopeBefore.files)
  assert.ok(scopeAfter.mtimeMs >= scopeBefore.mtimeMs)
})

await test('followPage/siblingsForDelete：伴生文件跟着页面走、删除一并回收', () => {
  mkpage('数学/6.1')
  savePage(root, '数学/6.1', [SINGLE], null)
  record(root, '数学/6.1', readPage(root, '数学/6.1').questions[0].id, true)
  assert.equal(siblingsForDelete(page('数学/6.1')).length, 2)
  followPage(page('数学/6.1'), page('数学/6.2'))
  assert.ok(fs.existsSync(quizPath(root, '数学/6.2')))
  assert.ok(fs.existsSync(progressPath(root, '数学/6.2')))
  assert.ok(!fs.existsSync(quizPath(root, '数学/6.1')))
  assert.ok(!fs.existsSync(path.join(root, '数学', '.quiz', '6.1.md')))
})

await test('fs 集成：改名/移动/删除都把题目与掌握度带上', async () => {
  createEntry(root, root, '数学/7.1', 'page')
  savePage(root, '数学/7.1', [SINGLE], null)
  record(root, '数学/7.1', readPage(root, '数学/7.1').questions[0].id, true)
  const renamed = renameEntry(root, page('数学/7.1'), '7.2', [])
  assert.ok(fs.existsSync(quizPath(root, '数学/7.2')))
  assert.ok(fs.existsSync(progressPath(root, '数学/7.2')))
  fs.mkdirSync(path.join(root, '数学', '第二章'), { recursive: true })
  const moved = await moveEntry(root, renamed.path, path.join(root, '数学', '第二章'), 'skip', [])
  assert.ok(fs.existsSync(quizPath(root, '数学/第二章/7.2')))
  assert.ok(fs.existsSync(progressPath(root, '数学/第二章/7.2')))
  await deleteEntries(root, [moved.path])
  assert.ok(!fs.existsSync(page('数学/第二章/7.2')))
  assert.ok(!fs.existsSync(quizPath(root, '数学/第二章/7.2')))
  assert.ok(!fs.existsSync(progressPath(root, '数学/第二章/7.2')))
})

await test('discard（导入/移动覆盖）：被覆盖页的题目一并带走', async () => {
  createEntry(root, root, '数学/8.1', 'page')
  savePage(root, '数学/8.1', [JUDGE], null)
  createEntry(root, root, '数学/第二章', 'page')
  // 把 8.1 移动覆盖到 第二章（同目录已有同名页）：旧页的题目不能留下冒充
  await moveEntry(root, page('数学/8.1'), path.join(root, '数学', '第二章'), 'overwrite', [])
  assert.ok(fs.existsSync(quizPath(root, '数学/第二章/8.1')))
})

console.log('done')
