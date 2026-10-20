// 学习 / 复习单测：记录（.study/<页名>.json）的读写与动作、间隔表、范围与在学清单、
// 改名/移动/删除跟着页面走、复习待办（真实日程条目）的建/改/归档/清理/跟随、日程 studyRel 三态。
// 跑 dist 产物（先 pnpm build）：node tests/test-vault-study.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LADDER,
  MAX_INTERVAL,
  MAX_HISTORY,
  STUDY_DIR,
  adjust,
  complete,
  finish,
  first,
  followPage,
  get,
  listActive,
  nearestSet,
  nextLadder,
  remove,
  restart,
  scope,
  siblingsForDelete,
  studyPath,
} from '../dist/vault/study.js'
import {
  completeReviewEvent,
  ensureReviewEvent,
  finishReviewEvents,
  moveReviewLinks,
  removeReviewEvents,
  syncReviewEvents,
} from '../dist/vault/study-events.js'
import { ScheduleStore, addDays, todayStr } from '../dist/vault/schedule.js'
import { createEntry, deleteEntries, moveEntry, renameEntry } from '../dist/vault/fs.js'

const test = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => console.log('PASS  ' + name),
      (error) => {
        console.log('FAIL  ' + name + ': ' + error.message)
        process.exitCode = 1
      },
    )

const TODAY = todayStr()
const DAY1 = addDays(TODAY, 1)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-study-'))
/** 造页面文件（默认 .md；.markdown 也认） */
const mkpage = (rel, ext = '.md', body = '# 页\n') => {
  const file = path.join(root, rel + ext)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body, 'utf8')
  return file
}
const pageAbs = (rel, ext = '.md') => path.join(root, rel + ext)
const jsonOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
/** 直接落一条记录（构造存量 / 异常数据用） */
const writeRec = (rel, rec) => {
  const file = studyPath(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(rec), 'utf8')
  return file
}
const recOf = (rel, patch = {}) => ({
  version: 1,
  firstLearnedAt: '2026-10-01',
  dueAt: '2026-10-21',
  intervalDays: 1,
  reps: 0,
  status: 'active',
  history: [],
  updatedMs: 1,
  ...patch,
})
const schedDir = path.join(root, '__sched')
const store = () => new ScheduleStore(schedDir)
const stateOf = (rel, due, status = 'active') => ({
  rel,
  name: rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel,
  record: recOf(rel, { dueAt: due, status }),
})
const openEvents = (s, rel) => s.list().filter((ev) => ev.studyRel === rel && !ev.completedAt)
const allEvents = (s, rel) => s.list().filter((ev) => ev.studyRel === rel)

// ── 间隔表 ──────────────────────────────────────────────────────────────────

await test('nextLadder：默认表 [1,2,4,7,15,30,60,120]，自定义间隔按「第一个更大」走、封顶最后一档', () => {
  assert.deepEqual(LADDER, [1, 2, 4, 7, 15, 30, 60, 120])
  assert.equal(MAX_INTERVAL, 3650)
  assert.equal(nextLadder(1), 2)
  assert.equal(nextLadder(2), 4)
  assert.equal(nextLadder(7), 15)
  assert.equal(nextLadder(10), 15) // 自定义 10 天：不按下标、按数值
  assert.equal(nextLadder(120), 120) // 到顶不再涨
  assert.equal(nextLadder(3650), 120) // 超过最后一档也停在最后一档（与参照实现同口径）
  assert.equal(nextLadder(0), 1)
})

// ── 记录：first / complete / adjust / finish / restart / remove ─────────────

await test('first：记录落 .study/<页名>.json，明天第一次复习，history kind=first', () => {
  mkpage('学习/函数')
  const st = first(root, '学习/函数')
  assert.equal(st.rel, '学习/函数')
  assert.equal(st.name, '函数')
  assert.equal(st.record.version, 1)
  assert.equal(st.record.firstLearnedAt, TODAY)
  assert.equal(st.record.dueAt, DAY1)
  assert.equal(st.record.intervalDays, 1)
  assert.equal(st.record.reps, 0)
  assert.equal(st.record.status, 'active')
  assert.equal(st.record.lastReviewedAt, undefined)
  assert.ok(st.record.updatedMs > 0)
  assert.deepEqual(
    st.record.history.map((h) => h.kind),
    ['first'],
  )
  assert.equal(st.record.history[0].at, TODAY)
  assert.equal(st.record.history[0].dueAt, DAY1)
  assert.equal(st.record.history[0].intervalDays, 1)
  assert.equal(st.record.history[0].reps, 0)
  // 落盘形状（camelCase、字段齐）
  const file = studyPath(root, '学习/函数')
  assert.ok(fs.existsSync(file))
  assert.equal(path.basename(file), '函数.json')
  assert.equal(path.basename(path.dirname(file)), STUDY_DIR)
  const raw = jsonOf(file)
  for (const key of ['version', 'firstLearnedAt', 'dueAt', 'intervalDays', 'reps', 'status', 'history', 'updatedMs']) {
    assert.ok(key in raw, '缺字段 ' + key)
  }
  // 同页再标记学习：拒绝；页面不存在：拒绝
  assert.throws(() => first(root, '学习/函数'))
  assert.throws(() => first(root, '学习/没有这一页'))
})

await test('complete：次数 +1、间隔上一档、due 从今天重算、history kind=review；自定义间隔生效', () => {
  const st = complete(root, '学习/函数')
  assert.equal(st.record.reps, 1)
  assert.equal(st.record.intervalDays, 2)
  assert.equal(st.record.dueAt, addDays(TODAY, 2))
  assert.equal(st.record.lastReviewedAt, TODAY)
  assert.equal(st.record.status, 'active')
  const last = st.record.history.at(-1)
  assert.equal(last.kind, 'review')
  assert.equal(last.intervalDays, 2)
  assert.equal(last.dueAt, addDays(TODAY, 2))
  assert.equal(last.reps, 1)
  // 逾期完成也从今天算（不补旧账）：再过一次按当前间隔 2 → 4
  const again = complete(root, '学习/函数')
  assert.equal(again.record.reps, 2)
  assert.equal(again.record.intervalDays, 4)
  assert.equal(again.record.dueAt, addDays(TODAY, 4))
  // 自定义间隔这一页单独生效：不推进表、不算档位
  const custom = complete(root, '学习/函数', 10)
  assert.equal(custom.record.reps, 3)
  assert.equal(custom.record.intervalDays, 10)
  assert.equal(custom.record.dueAt, addDays(TODAY, 10))
  // 自定义越界夹取
  assert.equal(complete(root, '学习/函数', 99999).record.intervalDays, MAX_INTERVAL)
})

await test('complete/adjust：没标记过与已完成（done）都拒绝', () => {
  mkpage('学习/没标记')
  assert.throws(() => complete(root, '学习/没标记'))
  assert.throws(() => adjust(root, '学习/没标记', 10))
  mkpage('学习/已结束')
  first(root, '学习/已结束')
  finish(root, '学习/已结束')
  assert.throws(() => complete(root, '学习/已结束'))
  assert.throws(() => adjust(root, '学习/已结束', 10))
})

await test('adjust：只改间隔与 due、次数不变，history kind=adjust；1..3650 夹取', () => {
  const before = get(root, '学习/函数')
  assert.ok(before)
  const st = adjust(root, '学习/函数', 30)
  assert.equal(st.record.intervalDays, 30)
  assert.equal(st.record.dueAt, addDays(TODAY, 30))
  assert.equal(st.record.reps, before.record.reps) // 不算一次复习
  const last = st.record.history.at(-1)
  assert.equal(last.kind, 'adjust')
  assert.equal(last.intervalDays, 30)
  assert.equal(last.reps, before.record.reps)
  assert.equal(adjust(root, '学习/函数', 0).record.intervalDays, 1)
  assert.equal(adjust(root, '学习/函数', 3651).record.intervalDays, 3650)
})

await test('finish：status=done、due 清空、次数与历史保留；restart 两模式恢复', () => {
  const done = finish(root, '学习/函数')
  assert.equal(done.record.status, 'done')
  assert.equal(done.record.dueAt, undefined)
  assert.equal(done.record.reps, 4)
  assert.equal(done.record.history.at(-1).kind, 'done')
  // last：接着上次的间隔（3650 被夹取后的值）
  const last = restart(root, '学习/函数', 'last')
  assert.equal(last.record.status, 'active')
  assert.equal(last.record.intervalDays, 3650)
  assert.equal(last.record.dueAt, addDays(TODAY, 3650))
  assert.equal(last.record.reps, 4) // 次数继续累计、不清零
  assert.equal(last.record.history.at(-1).kind, 'restart')
  // 再完成一轮 → last 接着新间隔
  adjust(root, '学习/函数', 7)
  finish(root, '学习/函数')
  const last7 = restart(root, '学习/函数', 'last')
  assert.equal(last7.record.intervalDays, 7)
  // first：按第一次 1 天重来
  finish(root, '学习/函数')
  const firstMode = restart(root, '学习/函数', 'first')
  assert.equal(firstMode.record.intervalDays, 1)
  assert.equal(firstMode.record.dueAt, DAY1)
  assert.equal(firstMode.record.reps, 4)
  // 自定义 nextInterval 优先于模式
  finish(root, '学习/函数')
  const custom = restart(root, '学习/函数', 'first', 15)
  assert.equal(custom.record.intervalDays, 15)
  assert.equal(custom.record.dueAt, addDays(TODAY, 15))
})

await test('remove：删记录并收掉空 .study 目录；再删回 false', () => {
  mkpage('移出学习/临时页')
  first(root, '移出学习/临时页')
  const file = studyPath(root, '移出学习/临时页')
  assert.ok(fs.existsSync(file))
  assert.equal(remove(root, '移出学习/临时页'), true)
  assert.ok(!fs.existsSync(file))
  assert.ok(!fs.existsSync(path.dirname(file)))
  assert.equal(remove(root, '移出学习/临时页'), false)
})

await test('MAX_HISTORY：历史超 500 条从头截断（留最近 500）', () => {
  mkpage('学习/长历史')
  first(root, '学习/长历史')
  // 首学 1 条 + 505 次复习 = 506 条历史：超过上限后从头截断，留最近 500
  for (let i = 0; i < 505; i += 1) complete(root, '学习/长历史')
  const st = get(root, '学习/长历史')
  assert.ok(st)
  assert.equal(st.record.history.length, MAX_HISTORY)
  assert.equal(st.record.history.at(-1).kind, 'review')
  assert.equal(st.record.reps, 505)
  // 原子写不留临时文件
  const dir = path.dirname(studyPath(root, '学习/长历史'))
  assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0)
})

// ── 范围 / 在学清单 ─────────────────────────────────────────────────────────

await test('scope：递归收记录，只收页面仍存在的、跳过点前缀目录与嵌套 library，按 due→rel 排', () => {
  mkpage('数学/函数')
  fs.writeFileSync(path.join(root, '数学', '.refs.json'), '[]', 'utf8')
  mkpage('数学/第一章/极限')
  mkpage('物理/力学')
  // 页面已不在：记录不能算
  writeRec('数学/已删除页', recOf('数学/已删除页', { dueAt: '2026-10-20' }))
  // 点前缀目录 / 嵌套 library 不扫
  mkpage('.隐藏/页')
  writeRec('.隐藏/页', recOf('.隐藏/页', { dueAt: '2026-10-19' }))
  mkpage('数学/library/文献')
  writeRec('数学/library/文献', recOf('数学/library/文献', { dueAt: '2026-10-18' }))
  writeRec('数学/函数', recOf('数学/函数', { dueAt: '2026-10-25' }))
  writeRec('数学/第一章/极限', recOf('数学/第一章/极限', { dueAt: '2026-10-22' }))
  writeRec('物理/力学', recOf('物理/力学', { dueAt: '2026-10-23' }))
  const scoped = scope(root, '数学')
  assert.deepEqual(
    scoped.map((s) => s.rel),
    ['数学/第一章/极限', '数学/函数'],
  )
  // 最近知识集：祖先里最近含 .refs.json 的目录
  assert.equal(scoped[0].set, '数学')
  assert.equal(scoped[1].set, '数学')
  assert.equal(nearestSet(root, '数学/第一章/极限'), '数学')
  assert.equal(nearestSet(root, '物理/力学'), undefined)
  const all = scope(root, '')
  const mine = all.filter((s) => s.rel.startsWith('数学/') || s.rel.startsWith('物理/'))
  assert.deepEqual(
    mine.map((s) => s.rel),
    ['数学/第一章/极限', '物理/力学', '数学/函数'], // due 早的在前
  )
  assert.ok(!all.some((s) => s.rel.startsWith('.隐藏')) && !all.some((s) => s.rel.includes('library')))
  assert.ok(all.some((s) => s.rel === '学习/函数')) // 整库口径把别的目录也收进来
})

await test('listActive：只收 active 且 dueAt 有值的；done 不进；排序同 scope', () => {
  writeRec('数学/已完成', recOf('数学/已完成', { status: 'done', dueAt: undefined }))
  writeRec('数学/无下次', recOf('数学/无下次', { status: 'active', dueAt: undefined }))
  mkpage('数学/已完成')
  mkpage('数学/无下次')
  const active = listActive(root, '数学')
  assert.deepEqual(
    active.map((s) => s.rel),
    ['数学/第一章/极限', '数学/函数'],
  )
  assert.ok(active.every((s) => s.record.status === 'active' && typeof s.record.dueAt === 'string'))
})

await test('坏记录：整份挪 .json.bak 后当没记录，不拖垮整库', () => {
  mkpage('数学/坏记录')
  const file = studyPath(root, '数学/坏记录')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{not json', 'utf8')
  assert.equal(get(root, '数学/坏记录'), null)
  assert.ok(fs.existsSync(file + '.bak'))
  assert.ok(!fs.existsSync(file))
  assert.equal(
    scope(root, '数学').some((s) => s.rel === '数学/坏记录'),
    false,
  )
})

await test('记录解析与另一端 serde 同口径：缺省补默认、越界整份算坏、可选字段没值不落键', () => {
  // 可选字段没值就不带键（与 serde skip_serializing_if 同形：两端写出来的形状一致）
  mkpage('解析/一')
  first(root, '解析/一')
  const rawFirst = jsonOf(studyPath(root, '解析/一'))
  assert.equal('lastReviewedAt' in rawFirst, false)
  assert.equal(rawFirst.version, 1)
  complete(root, '解析/一')
  const rawReview = jsonOf(studyPath(root, '解析/一'))
  assert.equal(rawReview.lastReviewedAt, TODAY)
  assert.equal(rawReview.dueAt, addDays(TODAY, 2))
  // 缺字段给默认：status 不认识按 active、version 归 1、间隔 0 归 1、reps/updatedMs 缺省 0
  mkpage('解析/二')
  writeRec('解析/二', { firstLearnedAt: '2026-10-01', intervalDays: 0, status: 'weird' })
  const weird = get(root, '解析/二')
  assert.ok(weird)
  assert.equal(weird.record.version, 1)
  assert.equal(weird.record.status, 'active')
  assert.equal(weird.record.intervalDays, 1)
  assert.equal(weird.record.reps, 0)
  assert.equal(weird.record.updatedMs, 0)
  assert.deepEqual(weird.record.history, [])
  // 越界（u32 / u64）整份算坏：挪 .bak 当没记录（与 serde 拒绝同一判据）
  for (const bad of [{ version: 4294967296 }, { intervalDays: 4294967296 }, { updatedMs: 1e30 }]) {
    mkpage('解析/坏' + Object.keys(bad)[0])
    const rel = '解析/坏' + Object.keys(bad)[0]
    writeRec(rel, recOf(rel, bad))
    assert.equal(get(root, rel), null, JSON.stringify(bad))
    assert.ok(fs.existsSync(studyPath(root, rel) + '.bak'))
  }
  // 历史条目缺必填 at/kind：整份算坏（半份好记录不留）
  mkpage('解析/四')
  writeRec('解析/四', recOf('解析/四', { history: [{ kind: 'first' }] }))
  assert.equal(get(root, '解析/四'), null)
  assert.ok(fs.existsSync(studyPath(root, '解析/四') + '.bak'))
})

// ── 跟页面走 ────────────────────────────────────────────────────────────────

await test('followPage：页改名 / 移动后记录在新位置，旧空 .study 目录收掉（.markdown 也认）', () => {
  mkpage('跟着走/旧名')
  first(root, '跟着走/旧名')
  const oldFile = pageAbs('跟着走/旧名')
  fs.mkdirSync(path.join(root, '换目录'), { recursive: true })
  const newFile = pageAbs('换目录/新名')
  fs.renameSync(oldFile, newFile)
  followPage(oldFile, newFile)
  assert.ok(!fs.existsSync(studyPath(root, '跟着走/旧名')))
  assert.ok(fs.existsSync(studyPath(root, '换目录/新名')))
  assert.ok(!fs.existsSync(path.join(root, '跟着走', STUDY_DIR)))
  // .markdown 后缀同样认
  mkpage('跟着走/二', '.markdown')
  first(root, '跟着走/二')
  const mOld = pageAbs('跟着走/二', '.markdown')
  const mNew = pageAbs('换目录/二', '.markdown')
  fs.renameSync(mOld, mNew)
  followPage(mOld, mNew)
  assert.ok(fs.existsSync(studyPath(root, '换目录/二')))
  // 没有记录时静默无事
  followPage(pageAbs('不存在/甲'), pageAbs('不存在/乙'))
})

await test('siblingsForDelete：有记录才给 .study 文件，删除时连带进回收站', () => {
  mkpage('删除/带记录')
  first(root, '删除/带记录')
  const page = pageAbs('删除/带记录')
  const siblings = siblingsForDelete(page)
  assert.deepEqual(siblings, [studyPath(root, '删除/带记录')])
  // 没有记录的页面不给伴生文件
  mkpage('删除/没记录')
  assert.deepEqual(siblingsForDelete(pageAbs('删除/没记录')), [])
})

await test('fs 集成：改名 / 移动 / 删除都把学习记录带上（与 .quiz 同一条路）', async () => {
  createEntry(root, root, '集成/页', 'page')
  first(root, '集成/页')
  const renamed = renameEntry(root, pageAbs('集成/页'), '页2', [])
  assert.ok(fs.existsSync(studyPath(root, '集成/页2')))
  assert.ok(!fs.existsSync(studyPath(root, '集成/页')))
  fs.mkdirSync(path.join(root, '集成', '第二'), { recursive: true })
  const moved = await moveEntry(root, renamed.path, path.join(root, '集成', '第二'), 'skip', [])
  assert.ok(fs.existsSync(studyPath(root, '集成/第二/页2')))
  await deleteEntries(root, [moved.path])
  assert.ok(!fs.existsSync(pageAbs('集成/第二/页2')))
  assert.ok(!fs.existsSync(studyPath(root, '集成/第二/页2')))
})

await test('覆盖撞名：被覆盖页的学习记录一并清掉，不冒充新页的进度', async () => {
  createEntry(root, root, '覆盖/甲', 'page')
  createEntry(root, root, '覆盖/子/甲', 'page')
  first(root, '覆盖/子/甲')
  assert.ok(fs.existsSync(studyPath(root, '覆盖/子/甲')))
  // 把外面那页移进来覆盖同名页：被覆盖页的记录随页面走，新页没有记录
  await moveEntry(root, pageAbs('覆盖/甲'), path.join(root, '覆盖', '子'), 'overwrite', [])
  assert.ok(fs.existsSync(pageAbs('覆盖/子/甲')))
  assert.ok(!fs.existsSync(studyPath(root, '覆盖/子/甲')))
  assert.equal(get(root, '覆盖/子/甲'), null)
})

// ── rel 守卫（与 quiz.ts safeRel 同口径）────────────────────────────────────

await test('rel 守卫：盘符 / .. / 空段挡下，写路径抛错、范围查询当空', () => {
  mkpage('守卫/正常')
  first(root, '守卫/正常')
  for (const bad of ['../逃逸', 'a/../b', 'C:/x', 'a//b', 'a/./b', 'a\\..\\x', 'C:\\x']) {
    assert.throws(() => first(root, bad), undefined, 'first(' + bad + ')')
    assert.throws(() => complete(root, bad), undefined, 'complete(' + bad + ')')
    assert.throws(() => get(root, bad), undefined, 'get(' + bad + ')')
    assert.deepEqual(scope(root, bad), [], 'scope(' + bad + ')')
    assert.deepEqual(listActive(root, bad), [], 'listActive(' + bad + ')')
  }
  // 首尾斜杠与反斜杠分隔照旧
  assert.equal(get(root, '守卫\\正常')?.rel, '守卫/正常')
  assert.equal(get(root, '/守卫/正常/')?.rel, '守卫/正常')
})

// ── 复习待办（日程里的一条真实待办，studyRel 指回页面）──────────────────────

await test('ensureReviewEvent：按 rel 建一条 studyRel 待办；再调只改 due/title，重复的归档', () => {
  const s = store()
  const rel = '数学/函数'
  ensureReviewEvent(s, rel, '2026-10-21')
  let open = openEvents(s, rel)
  assert.equal(open.length, 1)
  assert.equal(open[0].title, '函数')
  assert.equal(open[0].due, '2026-10-21')
  assert.equal(open[0].studyRel, rel)
  // 同 due 再调：不重复建
  ensureReviewEvent(s, rel, '2026-10-21')
  assert.equal(openEvents(s, rel).length, 1)
  // 改 due：只改这一条
  ensureReviewEvent(s, rel, '2026-10-25')
  assert.equal(openEvents(s, rel).length, 1)
  assert.equal(openEvents(s, rel)[0].due, '2026-10-25')
  // 历史上重复建过：收成一条
  s.create({ title: '函数', due: '2026-10-26', studyRel: rel })
  s.create({ title: '函数', due: '2026-10-27', studyRel: rel })
  ensureReviewEvent(s, rel, '2026-10-28')
  open = openEvents(s, rel)
  assert.equal(open.length, 1)
  assert.equal(open[0].due, '2026-10-28')
  assert.equal(allEvents(s, rel).length, 3) // 另外两条归档、不删
  assert.equal(allEvents(s, rel).filter((e) => e.completedAt).length, 2)
  // 别的页不受影响
  assert.equal(openEvents(s, '数学/极限').length, 0)
})

await test('completeReviewEvent：先建下一条再归档旧条；归档条截止挪到实际完成日（提前完成不挂在原计划日）', () => {
  const s = store()
  const rel = '物理/力学'
  ensureReviewEvent(s, rel, DAY1) // 原计划日 = 明天
  const oldId = openEvents(s, rel)[0].id
  completeReviewEvent(s, rel, '2026-10-23')
  assert.equal(allEvents(s, rel).length, 2)
  assert.equal(openEvents(s, rel).length, 1)
  assert.equal(openEvents(s, rel)[0].due, '2026-10-23')
  const old = allEvents(s, rel).find((e) => e.id === oldId)
  assert.ok(old)
  assert.equal(old.due, TODAY) // 今天提前完成 → 归档条落今天，不是明天
  assert.ok(old.completedAt)
})

await test('finishReviewEvents：未完成的全归档（截止挪到实际完成日）、已完成的不动；removeReviewEvents：连历史一起删', () => {
  const s = store()
  const rel = '化学/原子'
  ensureReviewEvent(s, rel, DAY1)
  ensureReviewEvent(s, rel, DAY1) // 仍只有一条
  const archivedBefore = allEvents(s, '物理/力学').filter((e) => e.completedAt).length
  finishReviewEvents(s, rel)
  assert.equal(openEvents(s, rel).length, 0)
  const done = allEvents(s, rel)
  assert.equal(done.length, 1)
  assert.equal(done[0].due, TODAY)
  assert.ok(done[0].completedAt)
  // 已归档的既有条目不被 finish 再动（别的 rel）
  assert.equal(allEvents(s, '物理/力学').filter((e) => e.completedAt).length, archivedBefore)
  removeReviewEvents(s, rel)
  assert.equal(allEvents(s, rel).length, 0)
})

await test('syncReviewEvents：在学页补齐未完成待办、清掉不在学的未完成待办，返回补建数', () => {
  const s = store()
  const staleRel = '已经移出'
  ensureReviewEvent(s, staleRel, '2026-10-21')
  ensureReviewEvent(s, '保持', '2026-10-22') // 已有：不重建
  const active = [stateOf('保持', '2026-10-24'), stateOf('a', '2026-10-25'), stateOf('b', '2026-10-26')]
  const created = syncReviewEvents(s, active)
  assert.equal(created, 2)
  assert.equal(openEvents(s, staleRel).length, 0)
  assert.equal(openEvents(s, '保持').length, 1)
  assert.equal(openEvents(s, '保持')[0].due, '2026-10-24') // due 已对齐
  assert.equal(openEvents(s, 'a').length, 1)
  assert.equal(openEvents(s, 'b').length, 1)
  // 再对齐一次：无改动、返回 0
  assert.equal(syncReviewEvents(s, active), 0)
  // done 的页不进（即使传了也不建）
  assert.equal(syncReviewEvents(s, [stateOf('c', undefined, 'done')]), 0)
  assert.equal(openEvents(s, 'c').length, 0)
})

await test('moveReviewLinks：页改名 / 目录前缀改 studyRel+title；null = 删除该页（目录按前缀，含已完成）', () => {
  const s = store()
  ensureReviewEvent(s, '数学/第一章/函数', '2026-10-21')
  ensureReviewEvent(s, '数学/第二章/极限', '2026-10-22')
  ensureReviewEvent(s, '物理/力学', '2026-10-23')
  // 目录改名：前缀内两条跟着走，标题取新末段
  moveReviewLinks(s, '数学', '数学2')
  assert.equal(openEvents(s, '数学/第一章/函数').length, 0)
  assert.equal(openEvents(s, '数学2/第一章/函数').length, 1)
  assert.equal(openEvents(s, '数学2/第一章/函数')[0].title, '函数')
  assert.equal(openEvents(s, '数学2/第二章/极限').length, 1)
  assert.equal(openEvents(s, '物理/力学').length, 1) // 前缀外不动
  // 单页改名：只改这一条
  moveReviewLinks(s, '数学2/第一章/函数', '数学2/第一章/映射')
  assert.equal(openEvents(s, '数学2/第一章/映射').length, 1)
  assert.equal(openEvents(s, '数学2/第一章/映射')[0].title, '映射')
  assert.equal(openEvents(s, '数学2/第二章/极限').length, 1)
  // 删除目录（null）：连已完成的条目一起删
  completeReviewEvent(s, '数学2/第二章/极限', '2026-10-30')
  assert.equal(allEvents(s, '数学2/第二章/极限').length, 2)
  moveReviewLinks(s, '数学2', null)
  assert.equal(allEvents(s, '数学2/第二章/极限').length, 0)
  assert.equal(openEvents(s, '物理/力学').length, 1)
})

// ── 日程 studyRel：create / update 三态 ─────────────────────────────────────

await test('日程 studyRel：create 落值（trim，空串当不落），不带键不产字段', () => {
  const s = store()
  const plain = s.create({ title: '普通待办', due: '2026-10-25' })
  assert.equal('studyRel' in plain, false)
  const linked = s.create({ title: '函数', due: '2026-10-25', studyRel: '  数学/函数  ' })
  assert.equal(linked.studyRel, '数学/函数')
  const raw = jsonOf(path.join(schedDir, 'events', linked.id + '.json'))
  assert.equal(raw.studyRel, '数学/函数')
  const blank = s.create({ title: '空串', due: '2026-10-25', studyRel: '' })
  assert.equal('studyRel' in blank, false)
  const spaces = s.create({ title: '全空白', due: '2026-10-25', studyRel: '   ' })
  assert.equal('studyRel' in spaces, false)
})

await test('日程 studyRel：update 三态（字符串落值 / 空串与 null 清空 / 不带键不动），rev 照常递增', () => {
  const s = store()
  const ev = s.create({ title: '待办', due: '2026-10-25' })
  const rev0 = ev.rev
  // 不带键：其他字段更新时 studyRel 不动（这里还没有）
  const plain = s.update(ev.id, { title: '改名' })
  assert.equal('studyRel' in plain, false)
  // 字符串落值
  const set = s.update(ev.id, { studyRel: '数学/函数' })
  assert.equal(set.studyRel, '数学/函数')
  assert.equal(set.rev, rev0 + 2)
  // 不带键：原值保住
  const keep = s.update(ev.id, { location: '书桌' })
  assert.equal(keep.studyRel, '数学/函数')
  // 空串 = 清空（真把 '' 落盘的话两端都不当它是空）
  const cleared = s.update(ev.id, { studyRel: '' })
  assert.equal('studyRel' in cleared, false)
  const rawCleared = jsonOf(path.join(schedDir, 'events', ev.id + '.json'))
  assert.equal('studyRel' in rawCleared, false)
  // 再落值后用 null 清空
  s.update(ev.id, { studyRel: '数学/函数' })
  const cleared2 = s.update(ev.id, { studyRel: null })
  assert.equal('studyRel' in cleared2, false)
  // 改 title 与 studyRel 一起带
  const both = s.update(ev.id, { studyRel: '物理/力学', title: '力学' })
  assert.equal(both.studyRel, '物理/力学')
  assert.equal(both.title, '力学')
})

// ── 收尾 ────────────────────────────────────────────────────────────────────

console.log('done')
fs.rmSync(root, { recursive: true, force: true })
