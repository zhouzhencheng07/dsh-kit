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
  buildScheduleTools,
  toolArgsToCreateInput,
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
  // 带标题的独立计时（wangshu 对齐）：标题随 runningTimer 走，停表落 orphan.note
  store.timerStart(undefined, '  整理周报  ')
  assert.equal(store.runningTimer().title, '整理周报')
  store.timerStop()
  const titled = store.listOrphans().at(-1)
  assert.equal(titled.note, '整理周报')
  // 挂条目计时不收 title（标题永远跟条目走）
  store.timerStart(b.id, '无视这个')
  assert.equal(store.runningTimer().title, '任务B')
  store.timerStop()
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

test('toolArgsToCreateInput：date+time→事件、仅 date→待办、allDay→全天', () => {
  assert.deepEqual(
    toolArgsToCreateInput({ title: '开会', date: '2026-09-10', time: '15:00', endTime: '16:00' }),
    { title: '开会', start: '2026-09-10T15:00', end: '2026-09-10T16:00' },
  )
  assert.deepEqual(
    toolArgsToCreateInput({ title: '交报告', date: '2026-09-11' }),
    { title: '交报告', due: '2026-09-11' },
  )
  assert.deepEqual(
    toolArgsToCreateInput({ title: '休假', date: '2026-10-01', allDay: true }),
    { title: '休假', start: '2026-10-01T00:00', allDay: true },
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
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const create = tools.find((t) => t.name === 'schedule_create')
  const r1 = await create.execute({ title: '评审', date: '2026-09-10', time: '15:00', endTime: '16:00' })
  assert.match(r1.summary, /已创建日程：评审（2026-09-10 15:00–16:00）/)
  const r2 = await create.execute({ title: '例会', date: '2026-09-07', time: '09:00', repeat: 'weekly', repeatInterval: 2, repeatDays: '1' })
  assert.match(r2.summary, /已创建日程：例会（2026-09-07 09:00，每2周\(1\)）/)
  const ev2 = store.list().find((e) => e.id === r2.id)
  assert.deepEqual(ev2.recurrence, { type: 'weekly', interval: 2, days: [1] })
  // 展开对齐：9/7 起每两周周一 → 区间内落 9/7 与 9/21
  const occ = expandOccurrences([ev2], '2026-09-07', '2026-09-30')
  assert.deepEqual(occ.map((o) => o.date), ['2026-09-07', '2026-09-21'])
  const r3 = await create.execute({ title: '交表', date: '2026-09-11' })
  assert.match(r3.summary, /已创建待办：交表（截止 2026-09-11）/)
  const r4 = await create.execute({ title: '外出', date: '2026-10-01', allDay: true })
  assert.match(r4.summary, /已创建日程：外出（2026-10-01 全天）/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('items：时段内条目结构化（id/kind/when），重复事件去重带 recurring', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  store.create({ title: '例会', start: '2026-09-07T09:00', recurrence: { type: 'weekly', days: [1] } })
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

test('schedule_delete 工具：按 id 删除、重复系列整体移除、未找到回 ok:false', async () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const del = tools.find((t) => t.name === 'schedule_delete')
  const ev = store.create({ title: '要删的', start: '2026-09-10T09:00', recurrence: { type: 'daily' } })
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
  const store = new ScheduleStore(path.join(dir, 'schedule.json'))
  const defineTool = (opts) => opts
  const tools = buildScheduleTools({ defineTool, store })
  const query = tools.find((t) => t.name === 'schedule_query')
  const ev = store.create({ title: '评审', start: '2026-09-10T15:00' })
  const r = await query.execute({ scope: 'day', date: '2026-09-10' })
  assert.equal(typeof r.summary, 'string')
  assert.ok(Array.isArray(r.items) && r.items.length === 1)
  assert.equal(r.items[0].id, ev.id)
  assert.equal(r.items[0].kind, '日程')
  fs.rmSync(dir, { recursive: true, force: true })
})
