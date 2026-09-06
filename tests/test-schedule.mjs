// 日程模块单测：对构建产物 dist/schedule.js 跑（先 pnpm build 再跑本文件）
//   node tests/test-schedule.mjs
// 覆盖：store CRUD/done、重复展开（daily/weekly/monthly × interval × days × end）、
//       统计口径、summary 文本、timer 全局单计时互斥、持久化往返、字段清洗。
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
} from '../dist/schedule.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dshkit-sched-'))

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

test('create：title 必填、无时刻待办缺省 due=今天', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  assert.throws(() => store.create({ description: 'no title' }), /title/)
  const task = store.create({ title: '写周报' })
  assert.equal(task.start, undefined)
  assert.equal(task.due, task.createdAt.slice(0, 10))
  assert.equal(store.list().length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('字段清洗：非法 recurrence 丢弃、days 过滤越界并去重', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  const ev = store.create({
    title: '例会',
    start: '2026-09-07T09:00',
    end: '2026-09-07T10:00',
    recurrence: { type: 'weekly', days: [1, 9, 1, -2], interval: 1 },
  })
  assert.deepEqual(ev.recurrence.days, [1])
  const bad = store.create({ title: 'x', start: '2026-09-07T09:00', recurrence: { type: 'yearly' } })
  assert.equal(bad.recurrence, null)
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
    [{ id: 'm1', title: '房租', start: '2026-01-01T00:00', allDay: true, recurrence: { type: 'monthly', interval: 1 } }],
    '2026-08-25',
    '2026-09-10',
  )
  assert.deepEqual(monthly.map((o) => o.date), ['2026-09-01'])
  assert.equal(monthly[0].allDay, true)
  assert.equal(monthly[0].startMins, 0)
  assert.equal(monthly[0].endMins, 1440)
  // 非重复且在区间外 → 无 occurrence
  assert.equal(expandOccurrences([{ id: 's1', title: 'x', start: '2026-10-01T09:00' }], '2026-09-01', '2026-09-30').length, 0)
})

test('stats：事件数/完成数/到期待办/计时口径', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  const ev = store.create({ title: '开会', start: '2026-09-08T09:00', end: '2026-09-08T10:00' })
  const t1 = store.create({ title: '甲', due: '2026-09-08' })
  store.create({ title: '乙', due: '2026-09-08' })
  store.setDone(t1.id, true)
  // setDone 盖的是真实"今天"，测试口径需要落在 9/8：手工校正完成时刻
  const doneTask = store.list().find((e) => e.id === t1.id)
  doneTask.completedAt = '2026-09-08T12:00'
  // 计时 30 分钟（挂在 ev 上，start 落在 9/8）
  store.timerStart(ev.id)
  const withEntry = store.list().find((e) => e.id === ev.id)
  withEntry.timeEntries[0].start = '2026-09-08T09:30:00'
  withEntry.timeEntries[0].end = '2026-09-08T10:00:00'
  const stats = store.stats('day', '2026-09-08')
  assert.equal(stats.eventCount, 1)
  assert.equal(stats.completedCount, 1)
  assert.equal(stats.openCount, 1)
  assert.equal(stats.timedMs, 30 * 60000)
  assert.equal(timedMsInRange(store.list(), '2026-09-09', '2026-09-09'), 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('summary：日汇总含事件行与待办行，空时段有兜底句', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
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

test('timer：全局单计时互斥、stop 闭合、runningTimer 带标题', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  const a = store.create({ title: '任务A', due: '2026-09-08' })
  const b = store.create({ title: '任务B', due: '2026-09-08' })
  store.timerStart(a.id)
  assert.equal(store.runningTimer().title, '任务A')
  store.timerStart(b.id) // 互斥：A 被自动闭合
  const aEntry = store.list().find((e) => e.id === a.id).timeEntries
  assert.equal(aEntry.length, 1)
  assert.ok(aEntry[0].end !== undefined)
  assert.equal(store.runningTimer().title, '任务B')
  store.timerStop()
  assert.equal(store.runningTimer(), null)
  const bEntry = store.list().find((e) => e.id === b.id).timeEntries
  assert.ok(bEntry[0].end !== undefined)
  // 独立计时：无挂载条目，runningTimer.title 为空串；停表落 orphans 不丢时段
  store.timerStart(undefined)
  assert.equal(store.runningTimer().title, '')
  store.timerStop()
  assert.equal(store.runningTimer(), null)
  assert.equal(store.listOrphans().length, 1)
  // 同秒起止时长为 0 属边界行为：拉成确定时段验证统计口径
  const orphan = store.listOrphans()[0]
  orphan.start = '2026-09-08T09:30:00'
  orphan.end = '2026-09-08T10:00:00'
  const dayStats = store.stats('day', '2026-09-08')
  assert.ok(dayStats.timedMs === 30 * 60000)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('持久化往返与损坏降级', () => {
  const dir = tmp()
  const file = path.join(dir, 'schedule.json')
  const s1 = new ScheduleStore(file)
  s1.create({ title: '跨实例', start: '2026-09-08T09:00' })
  const s2 = new ScheduleStore(file)
  assert.equal(s2.list().length, 1)
  assert.equal(s2.list()[0].title, '跨实例')
  // 损坏 → .bak + 空库
  fs.writeFileSync(file, '{broken json', 'utf8')
  const s3 = new ScheduleStore(file)
  assert.equal(s3.list().length, 0)
  assert.ok(fs.existsSync(`${file}.bak`))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('独立计时 orphans 持久化往返 + events 非数组也走 .bak', () => {
  const dir = tmp()
  const file = path.join(dir, 'schedule.json')
  const s1 = new ScheduleStore(file)
  s1.timerStart(undefined)
  s1.timerStop()
  // 拉成确定时段（同秒起止时长 0 是边界行为），重开实例验证落盘往返
  const orphan = s1.listOrphans()[0]
  orphan.start = '2026-09-08T08:00:00'
  orphan.end = '2026-09-08T08:20:00'
  s1.create({ title: '触发落盘', due: '2026-09-08' }) // mutate 才 persist（直改 orphan 字段不落盘）
  const s2 = new ScheduleStore(file)
  const stats = s2.stats('day', '2026-09-08')
  assert.equal(stats.timedMs, 20 * 60000)
  // events 键存在但不是数组：同样按损坏处理（挪 .bak），不能静默覆盖原文件
  fs.writeFileSync(file, '{"events":"nope"}', 'utf8')
  const s3 = new ScheduleStore(file)
  assert.equal(s3.list().length, 0)
  assert.ok(fs.existsSync(`${file}.bak`))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('update/delete：patch 白名单不产生脏字段', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
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
