// 日程模块单测：对构建产物 dist/schedule.js 跑（先 pnpm build 再跑本文件）
//   node tests/test-schedule.mjs
// 覆盖：store CRUD、重复展开（daily/weekly/monthly × interval × days × end）、
//       统计口径、summary 文本、计时段存量只读、持久化往返、字段清洗。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ScheduleStore,
  expandOccurrences,
  rangeOf,
  mondayOf,
  isDateStr,
  timedMsInRange,
  buildScheduleTools,
  toolArgsToCreateInput,
  resolveScheduleDir,
  addDays,
  todayStr,
} from '../dist/schedule.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dshkit-sched-'))

/** 直接写一条事件文件（构造存量数据：completedAt/timeEntries 这类不再有本端写入口的字段） */
const writeEvent = (dir, name, ev) => {
  const eventsDir = path.join(dir, name, 'events')
  fs.mkdirSync(eventsDir, { recursive: true })
  fs.writeFileSync(
    path.join(eventsDir, `${ev.id}.json`),
    JSON.stringify({ createdAt: '2026-09-01T00:00', updatedAt: '2026-09-01T00:00', rev: 1, ...ev }),
    'utf8',
  )
}

test('isDateStr 只认 YYYY-MM-DD', () => {
  assert.equal(isDateStr('2026-09-06'), true)
  assert.equal(isDateStr('2026-9-6'), false)
  assert.equal(isDateStr('2026-09-06T08:00'), false)
})

test('mondayOf 落到本周一（isoWeek）', () => {
  // 2026-09-06 是周日；本周一是 2026-08-31
  assert.equal(mondayOf('2026-09-06'), '2026-08-31')
  assert.equal(mondayOf('2026-09-07'), '2026-09-07')
})

test('rangeOf：day/week/month', () => {
  assert.deepEqual(rangeOf('day', '2026-09-06'), ['2026-09-06', '2026-09-06'])
  assert.deepEqual(rangeOf('week', '2026-09-06'), ['2026-08-31', '2026-09-06'])
  assert.deepEqual(rangeOf('month', '2026-09-06'), ['2026-09-01', '2026-09-30'])
  // 非法日期回落今天
  const [f] = rangeOf('day', 'bad')
  assert.match(f, /^\d{4}-\d{2}-\d{2}$/)
})

test('create：title 必填、无时刻待办不补 due（无期限就是无期限）', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  assert.throws(() => store.create({ description: 'no title' }), /title/)
  const task = store.create({ title: '写周报' })
  assert.equal(task.start, undefined)
  assert.equal(task.due, undefined)
  assert.equal(store.list().length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('字段清洗：非法 recurrence 丢弃、days 过滤越界并去重', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const ev = store.create({
    title: '例会',
    start: '2026-09-07T09:00',
    end: '2026-09-07T10:00',
    recurrence: { type: 'weekly', days: [1, 9, 1, -2], interval: 1 },
  })
  assert.deepEqual(ev.recurrence.days, [1])
  const bad = store.create({ title: 'x', start: '2026-09-07T09:00', end: '2026-09-07T10:00', recurrence: { type: 'yearly' } })
  assert.equal(bad.recurrence, null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('校验：start/end 成对且 end 晚于 start、待办不带 repeat、日程不写 due', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  assert.throws(() => store.create({ title: 'x', start: '2026-09-08T09:00' }), /结束时刻/)
  assert.throws(() => store.create({ title: 'x', start: '2026-09-08T09:00', end: '2026-09-08T09:00' }), /end 必须晚于 start/)
  assert.throws(() => store.create({ title: 'x', due: '2026-09-08', recurrence: { type: 'daily' } }), /repeat/)
  // 日程带 due：互斥静默互清（不报错）
  const ev = store.create({ title: 'x', start: '2026-09-08T09:00', end: '2026-09-08T10:00', due: '2026-09-09' })
  assert.equal(ev.due, undefined)
  // update 先推演合并结果再校验：拆走 end、把 end 改到 start 前都被拦下，且不做半截更新
  assert.throws(() => store.update(ev.id, { end: null }), /结束时刻/)
  assert.throws(() => store.update(ev.id, { end: '2026-09-08T08:00' }), /end 必须晚于 start/)
  const after = store.list().find((e) => e.id === ev.id)
  assert.equal(after.end, '2026-09-08T10:00')
  assert.equal(after.title, 'x')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('三态 patch：due/location/description null 清空、due 收日期时刻、skip 排序去重', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const task = store.create({ title: '交表', due: '2026-09-08T18:00', location: '实验楼', description: '纸版' })
  assert.equal(task.due, '2026-09-08T18:00') // 桌面写的"今天18:00 交表"不再丢时刻
  const sliced = store.create({ title: '秒', due: '2026-09-09T18:00:59' })
  assert.equal(sliced.due, '2026-09-09T18:00')
  const ev = store.list().find((e) => e.id === task.id)
  const updated = store.update(task.id, { due: null, location: null, description: '' })
  assert.equal(updated.rev, ev.rev + 1)
  const after = store.list().find((e) => e.id === task.id)
  assert.equal('due' in after, false)
  assert.equal('location' in after, false)
  assert.equal('description' in after, false)
  // skip：元素过日期校验、排序去重；空表 = 清空（不留字段）
  const rec = store.create({ title: '例会', start: '2026-09-07T09:00', end: '2026-09-07T10:00', recurrence: { type: 'weekly', days: [1] } })
  store.update(rec.id, { skip: ['2026-09-28', '坏日期', '2026-09-14', '2026-09-14'] })
  assert.deepEqual(store.list().find((e) => e.id === rec.id).skip, ['2026-09-14', '2026-09-28'])
  store.update(rec.id, { skip: [] })
  assert.equal('skip' in store.list().find((e) => e.id === rec.id), false)
  // completedAt：字符串落值 / null 清空
  store.update(task.id, { completedAt: '2026-09-08T12:00' })
  assert.equal(store.list().find((e) => e.id === task.id).completedAt, '2026-09-08T12:00')
  store.update(task.id, { completedAt: null })
  assert.equal('completedAt' in store.list().find((e) => e.id === task.id), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('expandOccurrences：weekly days + interval + end 边界', () => {
  const events = [
    {
      id: 'w1',
      title: '例会',
      start: '2026-09-07T09:00', // 周一（起始日之前的日期不产生实例）
      end: '2026-09-07T10:00',
      recurrence: { type: 'weekly', interval: 1, days: [1, 3] },
    },
  ]
  // 起始日 9/7 起 两周：周一×2 + 周三×2
  const occ = expandOccurrences(events, '2026-09-07', '2026-09-20')
  assert.deepEqual(
    occ.map((o) => o.date),
    ['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'],
  )
  assert.equal(occ[0].startMins, 540)
  assert.equal(occ[0].endMins, 600)
  assert.equal(occ[0].virtual, true)
  // interval=2：隔周出现（9/14 落在第二周被跳过，9/21 第三周命中）
  const biweekly = expandOccurrences(
    [{ ...events[0], recurrence: { type: 'weekly', interval: 2, days: [1] } }],
    '2026-09-07',
    '2026-09-21',
  )
  assert.deepEqual(biweekly.map((o) => o.date), ['2026-09-07', '2026-09-21'])
  // end 边界（含当天）
  const bounded = expandOccurrences(
    [{ ...events[0], recurrence: { type: 'weekly', interval: 1, days: [1, 3], end: '2026-09-09' } }],
    '2026-09-07',
    '2026-09-20',
  )
  assert.deepEqual(bounded.map((o) => o.date), ['2026-09-07', '2026-09-09'])
})

test('expandOccurrences：daily/monthly 与区间外排除', () => {
  const daily = expandOccurrences(
    [{ id: 'd1', title: '跑步', start: '2026-09-01T07:00', recurrence: { type: 'daily', interval: 2 } }],
    '2026-09-01',
    '2026-09-07',
  )
  assert.deepEqual(daily.map((o) => o.date), ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07'])
  const monthly = expandOccurrences(
    [{ id: 'm1', title: '房租', start: '2026-01-01T09:00', end: '2026-01-01T10:00', recurrence: { type: 'monthly', interval: 1 } }],
    '2026-08-25',
    '2026-09-10',
  )
  assert.deepEqual(monthly.map((o) => o.date), ['2026-09-01'])
  assert.equal(monthly[0].startMins, 540)
  assert.equal(monthly[0].endMins, 600)
  // 非重复且在区间外 → 无 occurrence
  assert.equal(expandOccurrences([{ id: 's1', title: 'x', start: '2026-10-01T09:00' }], '2026-09-01', '2026-09-30').length, 0)
})

test('expandOccurrences：skip 里的日子不产出（"删单次"往这里加一天）', () => {
  const ev = {
    id: 'w1',
    title: '例会',
    start: '2026-09-07T10:00',
    end: '2026-09-07T11:00',
    recurrence: { type: 'weekly', days: [1] },
    skip: ['2026-09-14', '2026-09-28'],
  }
  const occ = expandOccurrences([ev], '2026-09-01', '2026-09-30')
  assert.deepEqual(occ.map((o) => o.date), ['2026-09-07', '2026-09-21'])
  // 没有 skip 字段的老数据照常全展开
  const { skip, ...noSkip } = ev
  assert.equal(expandOccurrences([noSkip], '2026-09-01', '2026-09-30').length, 4)
  void skip
})

test('expandOccurrences：跨天块带 endDate 与 state 三值', () => {
  const ev = { id: 'n1', title: '夜班', start: '2026-09-19T22:00', end: '2026-09-20T02:00' }
  const at = (d) => expandOccurrences([ev], '2026-09-15', '2026-09-25', d)[0]
  const todo = at(new Date(2026, 8, 18, 12, 0))
  assert.equal(todo.state, 'todo')
  assert.equal(todo.endDate, '2026-09-20')
  assert.equal(at(new Date(2026, 8, 19, 23, 0)).state, 'doing') // 跨零点后仍在进行
  assert.equal(at(new Date(2026, 8, 20, 2, 0)).state, 'past') // end 一过即 past（比到分钟）
  assert.equal(at(new Date(2026, 8, 20, 1, 59)).state, 'doing')
  // 单日块同样带 state 与 endDate（= date）
  const day = expandOccurrences(
    [{ id: 'd1', title: '开会', start: '2026-09-08T09:00', end: '2026-09-08T10:00' }],
    '2026-09-08',
    '2026-09-08',
    new Date(2026, 8, 8, 9, 30),
  )[0]
  assert.equal(day.state, 'doing')
  assert.equal(day.endDate, '2026-09-08')
})

test('expandOccurrences：窗口前的跨天尾巴也产出（起始日在 from 前、endDate 伸进窗口）', () => {
  const ev = {
    id: 'w1',
    title: '夜班',
    start: '2026-09-07T23:00',
    end: '2026-09-08T01:00',
    recurrence: { type: 'daily' },
  }
  // 窗口从 9/8 起：9/7 那次的尾巴（9/8 00:00–01:00）不能丢
  const occ = expandOccurrences([ev], '2026-09-08', '2026-09-10')
  assert.deepEqual(occ.map((o) => o.date), ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'])
  assert.deepEqual(occ.map((o) => o.endDate), ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])
  // 非重复跨天事件同理：窗口只含尾巴日也产出
  const once = expandOccurrences(
    [{ id: 'o1', title: '晚会', start: '2026-09-06T22:00', end: '2026-09-07T00:00' }],
    '2026-09-07',
    '2026-09-07',
  )
  assert.equal(once.length, 1)
  assert.equal(once[0].date, '2026-09-06')
  assert.equal(once[0].endDate, '2026-09-07')
})

test('stats：事件数与已过/未到数 occurrence 口径、计时口径', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  // 计时段与完成时刻都属存量数据（本端无写入口），直接落文件
  writeEvent(dir, 'sched', { id: 'e1', title: '开会', start: '2026-09-08T09:00', end: '2026-09-08T10:00', timeEntries: [{ start: '2026-09-08T09:30:00', end: '2026-09-08T10:00:00' }] })
  writeEvent(dir, 'sched', { id: 't1', title: '甲', due: '2026-09-08', completedAt: '2026-09-08T12:00' })
  writeEvent(dir, 'sched', { id: 't2', title: '乙', due: '2026-09-08' })
  const store = new ScheduleStore(sched)
  const stats = store.stats('day', '2026-09-08', new Date(2026, 8, 8, 12, 0))
  assert.equal(stats.eventCount, 1)
  // completedCount/openCount 数 occurrence 的已过/未到，不是待办（待办口径在 summary）
  assert.equal(stats.completedCount, 1)
  assert.equal(stats.openCount, 0)
  assert.equal(stats.timedMs, 30 * 60000)
  assert.equal(timedMsInRange(store.list(), '2026-09-09', '2026-09-09'), 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('stats：总时长=已结束日程占位+计时段，未来不记、挂段不重复计', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  writeEvent(dir, 'sched', { id: 'p1', title: '已过', start: '2026-09-08T09:00', end: '2026-09-08T10:00' }) // +60min
  writeEvent(dir, 'sched', { id: 'p2', title: '未到', start: '2026-09-08T22:00', end: '2026-09-08T23:00' }) // now 12:00 不记
  // 挂段事件：占位 60min 不计，真实段 30min 计入
  writeEvent(dir, 'sched', { id: 'p3', title: '挂段', start: '2026-09-08T11:00', end: '2026-09-08T12:00', timeEntries: [{ start: '2026-09-08T10:30:00', end: '2026-09-08T11:00:00' }] })
  writeEvent(dir, 'sched', { id: 'p4', title: '无尾', start: '2026-09-08T10:00', end: '2026-09-08T11:00' }) // 已过 +60min
  const store = new ScheduleStore(sched)
  const stats = store.stats('day', '2026-09-08', new Date(2026, 8, 8, 12, 0))
  assert.equal(stats.timedMs, 30 * 60000)
  assert.equal(stats.totalMs, (60 + 30 + 60) * 60000)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('summary：逾期单独点名，due 带时刻不把条目挤出当日窗口', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const yest = addDays(todayStr(), -1)
  const late = store.create({ title: '晚交', due: `${yest}T18:00` })
  // 旧实现 due<=to 字符串比区间会把 "…T18:00" 判到日外；落窗按日期部分比
  assert.ok(store.items('day', yest).some((i) => i.id === late.id && i.kind === '待办'))
  const hit = store.items('week', todayStr()).find((i) => i.id === late.id)
  assert.equal(hit?.overdue, true)
  const sum = store.summary('day', yest)
  assert.match(sum, /逾期待办 1/)
  assert.match(sum, /\[ \] 到期：晚交/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('items：纯日期截止到当天结束前都不算逾期，带时刻比到分钟', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const today = todayStr()
  store.create({ title: '今天整日', due: today })
  store.create({ title: '今晚交', due: `${today}T23:59` })
  store.create({ title: '零点已过', due: `${today}T00:00` })
  const items = store.items('day', today)
  const byTitle = (t) => items.find((i) => i.title === t)
  assert.equal(byTitle('今天整日').overdue, undefined)
  assert.equal(byTitle('今晚交').overdue, undefined)
  assert.equal(byTitle('零点已过').overdue, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('summary：日汇总含事件行与待办行，空时段有兜底句', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  store.create({ title: '站会', start: '2026-09-08T09:00', end: '2026-09-08T09:30', location: '线上' })
  store.create({ title: '交周报', due: '2026-09-08' })
  const day = store.summary('day', '2026-09-08')
  assert.match(day, /2026-09-08/)
  assert.match(day, /09:00.*站会（线上）/)
  assert.match(day, /\[ \] 到期：交周报/)
  const empty = store.summary('day', '2030-01-01')
  assert.match(empty, /没有日程安排/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不做计时：望舒端的 timer.json 不读不写，条目删除不牵动它', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  const timerRaw = JSON.stringify({ id: 'e1', start: '2026-09-08T09:00:00' })
  fs.mkdirSync(path.join(sched, 'events'), { recursive: true })
  fs.writeFileSync(path.join(sched, 'timer.json'), timerRaw, 'utf8')
  writeEvent(dir, 'sched', { id: 'e1', title: '被计时的', due: '2026-09-08' })
  const store = new ScheduleStore(sched)
  assert.equal(store.list().length, 1)
  store.remove('e1')
  assert.equal(store.list().length, 0)
  assert.equal(fs.readFileSync(path.join(sched, 'timer.json'), 'utf8'), timerRaw)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('持久化往返、update 推进 rev、坏单条挪 .bak 不拖垮整库', () => {
  const dir = tmp()
  const s1 = new ScheduleStore(path.join(dir, 'sched'))
  const ev = s1.create({ title: '跨实例', start: '2026-09-08T09:00', end: '2026-09-08T10:00' })
  assert.equal(ev.rev, 1)
  const s2 = new ScheduleStore(path.join(dir, 'sched'))
  assert.equal(s2.list().length, 1)
  assert.equal(s2.list()[0].title, '跨实例')
  s2.update(ev.id, { title: '改名' })
  assert.equal(s2.list()[0].rev, 2)
  // 单条文件损坏 → 挪 .bak 后跳过，其余条目不受影响
  const file = path.join(dir, 'sched', 'events', `${ev.id}.json`)
  fs.writeFileSync(file, '{broken json', 'utf8')
  const s3 = new ScheduleStore(path.join(dir, 'sched'))
  assert.equal(s3.list().length, 0)
  assert.ok(fs.existsSync(`${file}.bak`))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('独立计时段持久化往返（entries/<id>.json，文件名即身份）+ 坏单条挪 .bak', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  const entriesDir = path.join(sched, 'entries')
  fs.mkdirSync(entriesDir, { recursive: true })
  // 独立段由望舒端计时产生，这里直接落文件构造存量
  fs.writeFileSync(
    path.join(entriesDir, 'o1.json'),
    JSON.stringify({ id: 'o1', start: '2026-09-08T08:00:00', end: '2026-09-08T08:20:00', note: '独立计时' }),
    'utf8',
  )
  const store = new ScheduleStore(sched)
  assert.equal(store.listOrphans().length, 1)
  assert.equal(store.stats('day', '2026-09-08').timedMs, 20 * 60000)
  // 单条文件损坏 → 挪 .bak（不静默覆盖），库照常打开
  fs.writeFileSync(path.join(entriesDir, 'o1.json'), 'not json', 'utf8')
  const s2 = new ScheduleStore(sched)
  assert.equal(s2.listOrphans().length, 0)
  assert.ok(fs.existsSync(path.join(entriesDir, 'o1.json.bak')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('update/delete：patch 白名单不产生脏字段', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const ev = store.create({ title: 'A', due: '2026-09-08' })
  store.update(ev.id, { title: 'B', hack: 'x', start: 'not-a-date' })
  const after = store.list()[0]
  assert.equal(after.title, 'B')
  assert.equal(after.hack, undefined)
  assert.equal(after.start, undefined)
  assert.equal(store.remove(ev.id), true)
  assert.equal(store.remove(ev.id), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('toolArgsToCreateInput：date+time→日程、仅 date→待办', () => {
  assert.deepEqual(
    toolArgsToCreateInput({ title: '开会', date: '2026-09-10', time: '15:00', endTime: '16:00' }),
    { title: '开会', start: '2026-09-10T15:00', end: '2026-09-10T16:00' },
  )
  assert.deepEqual(
    toolArgsToCreateInput({ title: '交报告', date: '2026-09-11' }),
    { title: '交报告', due: '2026-09-11' },
  )
})

test('toolArgsToCreateInput：跨天 endDate（22:00→次日 02:00；同 endDate 也接受）', () => {
  assert.deepEqual(
    toolArgsToCreateInput({ title: '夜班', date: '2026-09-19', time: '22:00', endDate: '2026-09-20', endTime: '02:00' }),
    { title: '夜班', start: '2026-09-19T22:00', end: '2026-09-20T02:00' },
  )
  // endDate 与 date 同日：等价于不写 endDate（显式写出不报错）
  const same = toolArgsToCreateInput({ title: 'x', date: '2026-09-19', time: '22:00', endDate: '2026-09-19', endTime: '23:30' })
  assert.equal(same.end, '2026-09-19T23:30')
  // 跨多天也照收（只校验 end > start）
  const multi = toolArgsToCreateInput({ title: 'x', date: '2026-09-19', time: '09:00', endDate: '2026-09-21', endTime: '18:00' })
  assert.equal(multi.end, '2026-09-21T18:00')
})

test('toolArgsToCreateInput：缺 endTime 默认 +1 小时（23:30 跨零点落次日 00:00）', () => {
  assert.deepEqual(
    toolArgsToCreateInput({ title: '评审', date: '2026-09-10', time: '15:00' }),
    { title: '评审', start: '2026-09-10T15:00', end: '2026-09-10T16:00' },
  )
  // 23:30 + 1 小时跨过零点 → end 落次日 00:00（并据此得出 endDate）
  assert.deepEqual(
    toolArgsToCreateInput({ title: '守夜', date: '2026-09-19', time: '23:30' }),
    { title: '守夜', start: '2026-09-19T23:30', end: '2026-09-20T00:00' },
  )
  // 23:00 + 1 小时 = 次日 00:00（正好跨零点的边界）
  assert.equal(toolArgsToCreateInput({ title: 'x', date: '2026-09-19', time: '23:00' }).end, '2026-09-20T00:00')
  // 跨天显式 endDate + 缺 endTime：按「开始 +1 小时」补出时刻，日期用给定的 endDate
  assert.equal(
    toolArgsToCreateInput({ title: 'x', date: '2026-09-19', time: '23:30', endDate: '2026-09-20' }).end,
    '2026-09-20T00:00',
  )
  // date 带时刻（datetime 形）同样走默认 +1 小时
  assert.equal(toolArgsToCreateInput({ title: 'x', date: '2026-09-10T15:00' }).end, '2026-09-10T16:00')
})

test('toolArgsToCreateInput：end 必填且必须晚于 start（不落"有 start 没 end"的条目）', () => {
  // 任何给了 time 的输入都必然带 end
  for (const args of [
    { title: 'x', date: '2026-09-10', time: '15:00' },
    { title: 'x', date: '2026-09-10', time: '15:00', endTime: '16:00' },
    { title: 'x', date: '2026-09-10', time: '23:30' },
    { title: 'x', date: '2026-09-10T15:00' },
    { title: 'x', date: '2026-09-19', time: '22:00', endDate: '2026-09-20', endTime: '02:00' },
  ]) {
    const out = toolArgsToCreateInput(args)
    assert.equal(typeof out.end, 'string', `缺 end：${JSON.stringify(args)}`)
    assert.ok(out.end > out.start, `end 未晚于 start：${JSON.stringify(out)}`)
  }
})

test('toolArgsToCreateInput：endDate 用法错误与 end<=start 显式抛错', () => {
  // 没给 time 却给了 endDate（只给 date 是待办，没有 end 可言）
  assert.throws(
    () => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', endDate: '2026-09-11' }),
    /endDate 仅对日程生效：请同时提供 time/,
  )
  // endDate 格式非法 → 抛错，不静默降级成 date
  assert.throws(
    () => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '15:00', endDate: '9月11日' }),
    /endDate 无法解析/,
  )
  assert.throws(
    () => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '15:00', endDate: '2026-09-11T02:00' }),
    /endDate 无法解析/,
  )
  // end <= start：同日倒挂、同刻零长、结束日期早于开始日期
  assert.throws(() => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '15:00', endTime: '14:00' }), /end 必须晚于 start/)
  assert.throws(() => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '15:00', endTime: '15:00' }), /end 必须晚于 start/)
  assert.throws(
    () => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '15:00', endDate: '2026-09-09', endTime: '16:00' }),
    /end 必须晚于 start/,
  )
})

test('toolArgsToCreateInput：宽松输入（datetime 形 date、一位小时）与显式错误', () => {
  assert.equal(toolArgsToCreateInput({ title: 'x', date: '2026-09-10T15:00' }).start, '2026-09-10T15:00')
  assert.equal(toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '9:05' }).start, '2026-09-10T09:05')
  assert.throws(() => toolArgsToCreateInput({ title: 'x', date: '9月10日' }), /date/)
  assert.throws(() => toolArgsToCreateInput({ title: 'x', date: '2026-09-10T99:99' }), /date/)
  assert.throws(() => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', time: '25:00' }), /time/)
  assert.throws(() => toolArgsToCreateInput({ title: 'x', date: '2026-09-10', endTime: 'abc' }), /endTime/)
})

test('toolArgsToCreateInput：repeat 系参数组装 recurrence、待办带 repeat 拒绝', () => {
  assert.deepEqual(
    toolArgsToCreateInput({ title: '例会', date: '2026-09-07', time: '09:00', repeat: 'weekly', repeatInterval: 2, repeatDays: '1,3', repeatEnd: '2026-12-31' }).recurrence,
    { type: 'weekly', interval: 2, days: [1, 3], end: '2026-12-31' },
  )
  assert.deepEqual(
    toolArgsToCreateInput({ title: '跑步', date: '2026-09-07', time: '07:00', repeat: 'daily', repeatInterval: 2 }).recurrence,
    { type: 'daily', interval: 2 },
  )
  // 垃圾字符过滤成空 days → 缺省开始日星期
  assert.deepEqual(
    toolArgsToCreateInput({ title: 'x', date: '2026-09-07', time: '08:00', repeat: 'weekly', repeatDays: '周一、周三' }).recurrence,
    { type: 'weekly' },
  )
  assert.equal(toolArgsToCreateInput({ title: 'x', date: '2026-09-07', time: '08:00', repeat: 'yearly' }).recurrence, undefined)
  assert.throws(
    () => toolArgsToCreateInput({ title: 'x', date: '2026-09-07', repeat: 'weekly' }),
    /repeat 仅对日程生效/,
  )
})

test('schedule_create 工具：date+time 建日程、date 建待办、重复透传与摘要', async () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const create = tools.find((t) => t.name === 'schedule_create')
  const r1 = await create.execute({ title: '评审', date: '2026-09-10', time: '15:00', endTime: '16:00' })
  assert.match(r1.summary, /已创建日程：评审（2026-09-10 15:00–16:00）/)
  const r2 = await create.execute({ title: '例会', date: '2026-09-07', time: '09:00', repeat: 'weekly', repeatInterval: 2, repeatDays: '1' })
  assert.match(r2.summary, /已创建日程：例会（2026-09-07 09:00–10:00，每2周\(1\)）/)
  const ev2 = store.list().find((e) => e.id === r2.id)
  assert.deepEqual(ev2.recurrence, { type: 'weekly', interval: 2, days: [1] })
  assert.equal(ev2.end, '2026-09-07T10:00') // 重复日程同样不落"有 start 没 end"
  // 展开对齐：9/7 起每两周周一 → 区间内落 9/7 与 9/21
  const occ = expandOccurrences([ev2], '2026-09-07', '2026-09-30')
  assert.deepEqual(occ.map((o) => o.date), ['2026-09-07', '2026-09-21'])
  const r3 = await create.execute({ title: '交表', date: '2026-09-11' })
  assert.match(r3.summary, /已创建待办：交表（截止 2026-09-11）/)
  // 缺 endTime → 摘要里带出补出的 +1 小时（不再是"有 start 没 end"）
  const r4 = await create.execute({ title: '外出', date: '2026-10-01', time: '09:00' })
  assert.match(r4.summary, /已创建日程：外出（2026-10-01 09:00–10:00）/)
  const ev4 = store.list().find((e) => e.id === r4.id)
  assert.equal(ev4.start, '2026-10-01T09:00')
  assert.equal(ev4.end, '2026-10-01T10:00')
  // 跨天日程：end 落在次日，摘要只显示结束时刻
  const r5 = await create.execute({ title: '夜班', date: '2026-09-19', time: '22:00', endDate: '2026-09-20', endTime: '02:00' })
  assert.match(r5.summary, /已创建日程：夜班（2026-09-19 22:00–02:00）/)
  assert.equal(store.list().find((e) => e.id === r5.id).end, '2026-09-20T02:00')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('外部文件带 allDay 键当没看见：不解析、不报损坏，写盘自然不再输出', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  const eventsDir = path.join(sched, 'events')
  fs.mkdirSync(eventsDir, { recursive: true })
  // 老数据：allDay + start/end。start 在 → 照常算日程；allDay 键不参与任何判定
  fs.writeFileSync(
    path.join(eventsDir, 'old1.json'),
    JSON.stringify({ id: 'old1', title: '老全天', start: '2026-09-08T00:00', end: '2026-09-08T01:00', allDay: true, createdAt: '2026-09-01T00:00', updatedAt: '2026-09-01T00:00', rev: 1 }),
    'utf8',
  )
  const store = new ScheduleStore(sched)
  assert.equal(store.list().length, 1) // 没被当成坏文件挪走
  assert.ok(!fs.existsSync(path.join(eventsDir, 'old1.json.bak')))
  const occ = store.occurrences('2026-09-08', '2026-09-08')
  assert.equal(occ.length, 1)
  assert.equal(occ[0].startMins, 0) // 不再被归置成全天
  assert.deepEqual(Object.keys(occ[0]).includes('allDay'), false)
  assert.match(store.summary('day', '2026-09-08'), /00:00.*老全天/)
  assert.equal(store.items('day', '2026-09-08')[0].when, '2026-09-08 00:00')
  // 改标题落盘：allDay 不因这次改动被解析/改写，读进来什么样还是什么样
  // （store 是 patch 语义，未触及的键原样保留——与其它未知键同一待遇）
  store.update('old1', { title: '改名' })
  const raw = JSON.parse(fs.readFileSync(path.join(eventsDir, 'old1.json'), 'utf8'))
  assert.equal(raw.title, '改名')
  // 新建条目从不写 allDay 键
  const fresh = store.create({ title: '新日程', start: '2026-09-08T09:00', end: '2026-09-08T10:00' })
  const freshRaw = JSON.parse(fs.readFileSync(path.join(eventsDir, `${fresh.id}.json`), 'utf8'))
  assert.equal('allDay' in freshRaw, false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('items：时段内条目结构化（id/kind/when），重复事件去重带 recurring', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  store.create({ title: '例会', start: '2026-09-07T09:00', end: '2026-09-07T10:00', recurrence: { type: 'weekly', days: [1] } })
  store.create({ title: '交报告', due: '2026-09-08' })
  const done = store.create({ title: '已办', due: '2026-09-08' })
  // completedAt 写死固定日，避免依赖机器时钟
  store.list().find((e) => e.id === done.id).completedAt = '2026-09-08T10:00'
  const items = store.items('week', '2026-09-08') // 本周 9/7–9/13
  assert.equal(items.length, 3)
  const ev = items.find((i) => i.kind === '日程')
  assert.equal(ev.title, '例会')
  assert.equal(ev.when, '2026-09-07 09:00')
  assert.equal(ev.recurring, true)
  assert.ok(items.some((i) => i.kind === '待办' && i.title === '交报告' && i.when === '2026-09-08'))
  assert.ok(items.some((i) => i.kind === '已完成待办' && i.title === '已办' && i.when === '2026-09-08'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('schedule_update 工具：三态 patch、改类型、跳过重复系列的一次', async () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const upd = tools.find((t) => t.name === 'schedule_update')
  const ev = store.create({ title: '例会', start: '2026-09-07T09:00', end: '2026-09-07T10:00', location: '301', recurrence: { type: 'weekly', days: [1] } })
  // 跳过一次：只往 skip 加一天（系列不动）
  const r0 = await upd.execute({ id: ev.id, skip: ['2026-09-14'] })
  assert.equal(r0.ok, true)
  assert.deepEqual(store.list().find((e) => e.id === ev.id).skip, ['2026-09-14'])
  // 日程→待办：start/end 清空、重复规则显式清、due 给截止（含时刻）
  const r1 = await upd.execute({ id: ev.id, start: null, end: null, recurrence: null, due: '2026-09-08T18:00', location: null })
  assert.match(r1.summary, /已更新待办：例会（截止 2026-09-08T18:00）/)
  const after = store.list().find((e) => e.id === ev.id)
  assert.equal(after.start, undefined)
  assert.equal(after.recurrence, null)
  assert.equal(after.location, undefined)
  // 待办→日程：start+end 成对给回、due 清成无期限
  const r2 = await upd.execute({ id: ev.id, start: '2026-09-09T15:00', end: '2026-09-09T16:00', due: null })
  assert.match(r2.summary, /已更新日程：例会（2026-09-09 15:00–16:00）/)
  const back = store.list().find((e) => e.id === ev.id)
  assert.equal(back.due, undefined)
  // 校验错误原样抛给模型重试；未找到回 ok:false
  await assert.rejects(() => upd.execute({ id: ev.id, end: '2026-09-09T14:00' }), /end 必须晚于 start/)
  const r3 = await upd.execute({ id: 'nope', title: 'x' })
  assert.equal(r3.ok, false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('schedule_delete 工具：按 id 删除、重复系列整体移除、未找到回 ok:false', async () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const del = tools.find((t) => t.name === 'schedule_delete')
  const ev = store.create({ title: '要删的', start: '2026-09-10T09:00', end: '2026-09-10T10:00', recurrence: { type: 'daily' } })
  const r = await del.execute({ id: ev.id })
  assert.equal(r.ok, true)
  assert.match(r.summary, /已删除：要删的（重复日程，整个系列已移除）/)
  assert.equal(store.list().length, 0)
  const r2 = await del.execute({ id: 'nope' })
  assert.equal(r2.ok, false)
  assert.match(r2.summary, /未找到/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('schedule_query 工具：返回 items 供删除定位', async () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const query = tools.find((t) => t.name === 'schedule_query')
  const ev = store.create({ title: '评审', start: '2026-09-10T15:00', end: '2026-09-10T16:00' })
  const r = await query.execute({ scope: 'day', date: '2026-09-10' })
  assert.equal(typeof r.summary, 'string')
  assert.ok(Array.isArray(r.items) && r.items.length === 1)
  assert.equal(r.items[0].id, ev.id)
  assert.equal(r.items[0].kind, '日程')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('标题统一上限 16 字（面板/agent 工具同一口径，细节让位备注）', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const long = '一'.repeat(30)
  const ev = store.create({ title: long })
  assert.equal(ev.title.length, 16)
  const up = store.create({ title: 'x' })
  store.update(up.id, { title: long })
  assert.equal(store.list().find((e) => e.id === up.id).title.length, 16)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('存储位置：固定 $DSH_HOME/dsh-kit/schedule/（一条一文件目录），与知识库无关', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.equal(resolveScheduleDir(), path.join(home, 'dsh-kit', 'schedule'))
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
