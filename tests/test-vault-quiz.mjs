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
  setQuizWarn,
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

await test('questionId：桌面端定值向量（含非 ASCII 大小写只降 ASCII）', () => {
  // 与桌面端 quiz.rs 的 test_id_contract_fixtures / test_id_contract_edge_cases 同一组定值：
  // 改归一化口径会让这几条立刻红
  assert.equal(questionId({ type: 'single', stem: '极限的定义 Define', options: ['甲', '乙', '丙'], answer: 'C', explain: '' }), 'c685fe9997d63509')
  assert.equal(questionId({ type: 'multi', stem: '设 $f(x)=\\frac{1}{x}$，下列正确的是：', options: ['甲 $a^2$', '乙', '丙'], answer: 'AC', explain: '' }), 'a4f610c3dd656da4')
  assert.equal(questionId({ type: 'judge', stem: '$0$ 是自然数。', options: [], answer: true, explain: '' }), '1e20314bdddf3cdb')
  assert.equal(questionId({ type: 'blank', stem: '向上取整（），向下取整（），去小数（）。', options: [], answer: [['ceiling'], ['floor'], ['trunc', '哈哈哈']], explain: '' }), '9945ac0dc57c6847')
  // 非 ASCII 大写只当原样：Ä 与 ä 是不同的题（JS toLowerCase 会把它们折成同一 id）
  assert.equal(questionId({ type: 'single', stem: 'Ärger', options: ['一', '二'], answer: 'A', explain: '' }), 'e5f66739c0b3303c')
  assert.notEqual(questionId({ ...SINGLE, stem: 'Ä' }), questionId({ ...SINGLE, stem: 'ä' }))
  // 答案字母也只认 ASCII：ß 在桌面端不算字母（JS toUpperCase 会变 SS）
  assert.equal(questionId({ ...SINGLE, answer: 'ß' }), questionId({ ...SINGLE, answer: '' }))
})

await test('parseMd/toMd：FEFF 不是空白、CRLF 行尾归一（与桌面端 str::trim / lines 同口径）', () => {
  // U+FEFF 不是 White_Space：不能像 JS trim/\\s 那样被裁掉或当空行
  const [feff] = parseMd('<!--q type=judge-->\n题\n\n<!--answer-->\n\uFEFFtrue\n')
  assert.equal(feff[0].answer, null)
  // 题干末尾的 FEFF 必须原样往返：JS 的 /\\s+$/ 会截掉它，读回就对不上而误报「标记同形」
  const [fq] = parseMd(toMd([{ type: 'judge', stem: '题\uFEFF', options: [], answer: true, explain: '' }]))
  assert.equal(fq[0].stem, '题\uFEFF')
  // CRLF 的 \\r 不是内容（Rust str::lines 会去掉）
  const [crlf] = parseMd('<!--q type=judge-->\r\n题\r\n<!--answer-->\r\ntrue\r\n')
  assert.equal(crlf[0].stem, '题')
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

await test('savePage：入参严格（非字符串选项 / 题干整份拒），长路径不设额外上限', () => {
  mkpage('数学/12.1')
  assert.throws(() => savePage(root, '数学/12.1', [{ ...SINGLE, options: [1, 2] }], null), /选项必须是字符串数组/)
  assert.throws(() => savePage(root, '数学/12.1', [{ ...SINGLE, stem: 3 }], null), /缺少题型或题干/)
  // 桌面端 safe_rel 不设段数 / 段长上限，这边也不该多一道
  const long = 'L'.repeat(201)
  const saved = savePage(root, long, [SINGLE], null)
  assert.equal(saved.rel, long)
  assert.equal(readPage(root, long).questions.length, 1)
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
  // 嵌套的 library/ 不算页面来源（任意深度都跳，与桌面端 SKIP_DIRS 同口径）
  mkpage('别的/library/藏')
  savePage(root, '别的/library/藏', [JUDGE], null)
  const scope = readScope(root, '数学')
  assert.deepEqual(scope.pages.map((p) => p.rel).sort(), ['数学/1.1', '数学/2.1', '数学/4.1', '数学/5.1', '数学/第一章/1.2'])
  const all = readScope(root, '')
  assert.ok(all.pages.some((p) => p.rel === '别的/9.9'))
  assert.equal(all.pages.some((p) => p.rel.startsWith('别的/library/')), false)
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

await test('id 契约边界：判断无答案段归 false、BOM 不算空白、NEL 算空白（与桌面端定值一字不差）', () => {
  const judgeEmpty = { type: 'judge', stem: '地球是圆的', options: [], answer: null, explain: '' }
  const feff = { type: 'single', stem: '极限\u{feff}存在', options: ['甲', '乙'], answer: 'A', explain: '' }
  const nel = { type: 'single', stem: '极限\u{85}存在', options: ['甲', '乙'], answer: 'A', explain: '' }
  assert.equal(questionId(judgeEmpty), '55f85e8a4e6ecc48')
  assert.equal(questionId(feff), '9ae3258ceefc3761')
  assert.equal(questionId(nel), 'fbab6723def5ab2f')
})

await test('路径守卫：盘符 / .. / 空段挡下，写抛错读当空；反斜杠当分隔符', () => {
  mkpage('数学/9.1')
  savePage(root, '数学/9.1', [SINGLE], null)
  for (const bad of ['../x', 'a/../b', 'C:/x', 'a//b', 'a/./b', 'a\\..\\x', 'C:\\x']) {
    assert.throws(() => savePage(root, bad, [SINGLE], null), /页面路径非法/, `savePage(${bad})`)
    assert.throws(() => record(root, bad, 'id', true), /页面路径非法/, `record(${bad})`)
    assert.deepEqual(readPage(root, bad), { rel: '', questions: [] }, `readPage(${bad})`)
    assert.deepEqual(readScope(root, bad), { dir: '', pages: [] }, `readScope(${bad})`)
    // 坏 rel 的指纹 = 只有阈值文件那一份（与「页面不存在」同形）
    assert.deepEqual(
      revision(root, bad, null),
      revision(root, '不存在/不存在的页', null),
      `revision(${bad})`,
    )
    assert.deepEqual(readProgress(root, bad, null).progress, {}, `readProgress(${bad})`)
  }
  // 正常 rel 与首尾斜杠、反斜杠分隔照旧
  assert.equal(readPage(root, '数学\\9.1').questions.length, 1)
  assert.equal(readPage(root, '/数学/9.1/').questions.length, 1)
})

await test('坏掌握度文件：整份挪 .bak 留证再当空表（半份好记录不留）', () => {
  mkpage('数学/10.1')
  savePage(root, '数学/10.1', [SINGLE], null)
  const id = readPage(root, '数学/10.1').questions[0].id
  record(root, '数学/10.1', id, true)
  const file = progressPath(root, '数学/10.1')
  const warns = []
  setQuizWarn((m) => warns.push(m))
  // 半好半坏：好记录也不能救回来（与桌面端 serde 同口径）
  fs.writeFileSync(file, JSON.stringify({ version: 1, progress: { ok: { streak: 1, mastered: false, updatedMs: 1 }, bad: { streak: 'x' } } }), 'utf8')
  assert.deepEqual(readProgress(root, '数学/10.1', null).progress, {})
  assert.ok(!fs.existsSync(file))
  assert.ok(fs.existsSync(`${file}.bak`))
  assert.equal(warns.length, 1)
  // 缺字段给默认（serde default），这类不算坏
  fs.rmSync(`${file}.bak`, { force: true })
  fs.writeFileSync(file, JSON.stringify({ progress: { x: { streak: 2 } } }), 'utf8')
  const partial = readProgress(root, '数学/10.1', null).progress.x
  assert.equal(partial.streak, 2)
  assert.equal(partial.mastered, false)
  assert.equal(partial.updatedMs, 0)
  setQuizWarn(() => {})
})

await test('edit.index 按交上来的数组算：去重并掉中间项时不再错位', () => {
  mkpage('数学/11.1')
  const third = { ...SINGLE, stem: '第三题' }
  const first = savePage(root, '数学/11.1', [SINGLE, third], null)
  const idThird = first.questions[1].id
  record(root, '数学/11.1', idThird, true)
  // 交上来 [A, A(重复), 第三题]：index=2 指的是交上来数组里的第三题，
  // 去重后的数组里它已错位——按去重后取就是 undefined，清记录会被跳过
  savePage(root, '数学/11.1', [SINGLE, SINGLE, third], { index: 2, oldId: idThird, keep: false })
  assert.equal(readProgress(root, '数学/11.1', null).progress[idThird], undefined)
})

await test('题干/解析尾部非半角空白（全角空格 / NBSP）不再误报「与标记同形」，落盘即归一', () => {
  mkpage('数学/13.1')
  const full = { ...SINGLE, stem: '题干\u3000', explain: '解析\u00a0' }
  const saved = savePage(root, '数学/13.1', [full], null)
  assert.equal(saved.questions[0].stem, '题干')
  assert.equal(saved.questions[0].explain, '解析')
  // 读回来与交上去的归一形状一致（二次保存不再抛错）
  const again = savePage(root, '数学/13.1', saved.questions, null)
  assert.equal(again.questions[0].stem, '题干')
  // 内部行尾空白照旧保留（只收整块尾部）
  const inner = { ...SINGLE, stem: '第一行 \n第二行' }
  assert.equal(savePage(root, '数学/13.1', [inner], null).questions[0].stem, '第一行 \n第二行')
})

await test('坏掌握度上界：version/streak 超 u32、updatedMs 超 u64 与桌面端同判据（挪 .bak 当空表）', () => {
  mkpage('数学/14.1')
  savePage(root, '数学/14.1', [SINGLE], null)
  const id = readPage(root, '数学/14.1').questions[0].id
  record(root, '数学/14.1', id, true)
  const file = progressPath(root, '数学/14.1')
  setQuizWarn(() => {})
  for (const bad of [
    { version: 4294967296, progress: {} },
    { version: 1, progress: { [id]: { streak: 4294967296, mastered: true, updatedMs: 1 } } },
    { version: 1, progress: { [id]: { streak: 1, mastered: true, updatedMs: 1e30 } } },
  ]) {
    fs.writeFileSync(file, JSON.stringify(bad), 'utf8')
    assert.deepEqual(readProgress(root, '数学/14.1', null).progress, {}, JSON.stringify(bad))
    assert.ok(fs.existsSync(`${file}.bak`))
    fs.rmSync(`${file}.bak`, { force: true })
  }
  setQuizWarn(() => {})
})

await test('范围汇总：.quiz/.md（空 stem）不收——它的 rel 带尾斜杠，掌握度会落到两个文件', () => {
  mkpage('数学/15.1')
  savePage(root, '数学/15.1', [SINGLE], null)
  const dir = path.join(root, '数学', '.quiz')
  fs.writeFileSync(path.join(dir, '.md'), toMd([SINGLE]), 'utf8')
  const rels = readScope(root, '数学').pages.map((p) => p.rel)
  assert.ok(rels.includes('数学/15.1'))
  assert.equal(rels.some((r) => r.endsWith('/')), false, `空 stem 的 rel 必须不收：${rels.join(' ')}`)
  fs.rmSync(path.join(dir, '.md'), { force: true })
})

await test('改阈值：某一页掌握度写不回去也不中断，阈值照落盘（逐页 best-effort）', () => {
  mkpage('数学/16.1')
  mkpage('数学/16.2')
  savePage(root, '数学/16.1', [SINGLE], null)
  savePage(root, '数学/16.2', [{ ...SINGLE, stem: '另一题' }], null)
  const id1 = readPage(root, '数学/16.1').questions[0].id
  record(root, '数学/16.1', id1, true)
  record(root, '数学/16.1', id1, true)
  record(root, '数学/16.1', id1, true)
  const id2 = readPage(root, '数学/16.2').questions[0].id
  record(root, '数学/16.2', id2, true)
  record(root, '数学/16.2', id2, true)
  record(root, '数学/16.2', id2, true)
  assert.equal(readProgress(root, '数学/16.1', null).progress[id1].mastered, true)
  // 让 16.1 的掌握度写不回去：把目标文件锁成只读（rename 覆盖只读文件在 Windows 上失败）
  const locked = progressPath(root, '数学/16.1')
  fs.chmodSync(locked, 0o444)
  const warns = []
  setQuizWarn((m) => warns.push(m))
  try {
    const v = setThreshold(root, 5)
    assert.equal(v, 5)
    assert.equal(readSettings(root).threshold, 5, '阈值必须落盘（中断在这里就是「阈值弹回旧值」）')
    assert.equal(readProgress(root, '数学/16.2', null).progress[id2].mastered, false)
    // 注入的失败必须真的发生，否则这条用例是空转（warn 由 kitWarn 收走）
    assert.ok(warns.length >= 1, '那一页的写失败没有发生，用例空转')
  } finally {
    fs.chmodSync(locked, 0o666)
    setQuizWarn(() => {})
  }
})

console.log('done')
