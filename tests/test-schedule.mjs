// 日程模块单测：对构建产物 dist/vault/schedule.js 跑（先 pnpm build 再跑本文件）
//   node tests/test-schedule.mjs
// 覆盖：store CRUD、重复展开（daily/weekly/monthly × interval × days × end）、
//       统计口径、计时段存量只读、持久化往返、字段清洗。
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
  resolveScheduleDir,
  addDays,
  todayStr,
} from '../dist/vault/schedule.js'

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

test('字段清洗：days 过滤越界并去重；非法 recurrence 抛错（静默清空等于抹掉系列）', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const ev = store.create({
    title: '例会',
    start: '2026-09-07T09:00',
    end: '2026-09-07T10:00',
    recurrence: { type: 'weekly', days: [1, 9, 1, -2], interval: 1 },
  })
  assert.deepEqual(ev.recurrence.days, [1])
  assert.throws(() => store.create({ title: 'x', start: '2026-09-07T09:00', end: '2026-09-07T10:00', recurrence: { type: 'yearly' } }), /recurrence 不合法/)
  assert.throws(() => store.update(ev.id, { recurrence: { type: 'yearly' } }), /recurrence 不合法/)
  // weekly 不带 days 合法：展开按起始日的星期（sanitize 补 days 的语义在展开层）
  assert.deepEqual(store.update(ev.id, { recurrence: { type: 'weekly' } }).recurrence, { type: 'weekly' })
  // 抛错不做半截更新：系列还在
  assert.equal(store.list()[0].recurrence.type, 'weekly')
  // 显式 null 才是清空
  assert.equal(store.update(ev.id, { recurrence: null }).recurrence, null)
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

test('expandOccurrences：每月 29/30/31 号在短月落到当月最后一天（系列不静默断）', () => {
  const evs = [
    { id: 'e31', title: '月末结算', start: '2026-01-31T09:00', end: '2026-01-31T10:00', recurrence: { type: 'monthly' } },
    { id: 'e30', title: '对账', start: '2026-01-30T09:00', end: '2026-01-30T10:00', recurrence: { type: 'monthly' } },
  ]
  const days = (id) => expandOccurrences(evs, '2026-02-01', '2026-04-30').filter((o) => o.baseId === id).map((o) => o.date)
  // 2 月只有 28 天：31 号落 28、30 号也落 28（不丢整月）
  assert.deepEqual(days('e31'), ['2026-02-28', '2026-03-31', '2026-04-30'])
  assert.deepEqual(days('e30'), ['2026-02-28', '2026-03-30', '2026-04-30'])
  // 4 月 30 天：31 号同样落 30；一个月里不会出两次
  const april = expandOccurrences(evs, '2026-04-01', '2026-04-30').filter((o) => o.baseId === 'e31')
  assert.equal(april.length, 1)
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
  // completedCount/openCount 数 occurrence 的已过/未到，不是待办
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

test('计时：timer.json 是真源（读它；删掉挂着的那条，表随之退场）', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  fs.mkdirSync(path.join(sched, 'events'), { recursive: true })
  fs.writeFileSync(path.join(sched, 'timer.json'), JSON.stringify({ id: 'e1', start: '2026-09-08T09:00:00' }), 'utf8')
  writeEvent(dir, 'sched', { id: 'e1', title: '被计时的', due: '2026-09-08' })
  const store = new ScheduleStore(sched)
  assert.equal(store.list().length, 1)
  assert.equal(store.getRunningTimer().title, '被计时的')
  store.remove('e1')
  assert.equal(store.list().length, 0)
  assert.equal(fs.existsSync(path.join(sched, 'timer.json')), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('共享目录：别处（同步/其它程序）写进来的条目立刻可见，update 不覆盖它改过的字段', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  const store = new ScheduleStore(sched)
  const mine = store.create({ title: '站会', start: '2026-09-07T09:00', end: '2026-09-07T10:00', location: 'A 会议室' })
  // 模拟别处直接改盘（同步拉取 / 另一个客户端）
  const file = path.join(sched, 'events', `${mine.id}.json`)
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
  onDisk.title = '站会（改名）'
  onDisk.location = 'B 会议室'
  onDisk.rev = 5
  fs.writeFileSync(file, JSON.stringify(onDisk), 'utf8')
  // 不重启、不新建实例：同一个 store 也要看得见
  assert.equal(store.list()[0].title, '站会（改名）')
  // agent 的更新按 id 合并：别处改的 location 保住，rev 继续往前推
  const merged = store.update(mine.id, { title: '站会（最终）' })
  assert.equal(merged.title, '站会（最终）')
  assert.equal(merged.location, 'B 会议室')
  assert.equal(merged.rev, 6)
  // 外部新增的条目同样进库
  writeEvent(dir, 'sched', { id: 'ext1', title: '外部建的', due: '2026-09-09' })
  assert.ok(store.list().some((e) => e.id === 'ext1'))
  assert.equal(store.list().find((e) => e.id === 'ext1')?.due, '2026-09-09')
  // 外部删掉的条目不再出现在面板数据里
  fs.rmSync(file)
  assert.equal(store.list().some((e) => e.id === mine.id), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('共享目录的合并口径：agent 的 update 按 id 合，别处改过的字段保住', () => {
  const dir = tmp()
  const sched = path.join(dir, 'sched')
  const store = new ScheduleStore(sched)
  const mine = store.create({ title: 'A', due: '2026-09-08' })
  // 模拟别处直接改盘（同步拉取 / 另一个客户端）：改了标题与地点，还推进了 rev
  const file = path.join(sched, 'events', `${mine.id}.json`)
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
  onDisk.title = '别处改的'
  onDisk.location = 'B 会议室'
  onDisk.rev = 5
  fs.writeFileSync(file, JSON.stringify(onDisk), 'utf8')
  store.update(mine.id, { title: 'agent 改的' })
  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(after.title, 'agent 改的')
  assert.equal(after.location, 'B 会议室')
  assert.equal(after.rev, 6)
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
  // 独立段由计时功能写入，这里直接落文件构造存量
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
  assert.equal(occ[0].title, '老全天')
  assert.equal(occ[0].date, '2026-09-08')
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

test('标题统一上限 16 字（面板与 store 同一口径，细节让位备注）', () => {
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

test('setDone：勾选写完成时刻、取消清掉，事件文件即真源', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const todo = store.create({ title: '交报告' })
  const done = store.setDone(todo.id, true)
  assert.equal(typeof done.completedAt, 'string')
  const reread = JSON.parse(fs.readFileSync(path.join(dir, 'sched', 'events', `${todo.id}.json`), 'utf8'))
  assert.equal(reread.completedAt, done.completedAt)
  const back = store.setDone(todo.id, false)
  assert.equal(back.completedAt, undefined)
  assert.equal(store.setDone('nope', true), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('计时：挂条目的段落进 timeEntries，timer.json 记进行中的表', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const todo = store.create({ title: '写方案' })
  const running = store.startTimer(todo.id, null)
  assert.equal(running.id, todo.id)
  assert.match(running.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  // 进行中的段 end 缺省；标题跟条目走，不进 timer.json（那里只有 id 与起表时刻）
  const ev = store.list().find((e) => e.id === todo.id)
  assert.equal(ev.timeEntries.length, 1)
  assert.equal(ev.timeEntries[0].end, undefined)
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'sched', 'timer.json'), 'utf8'))
  assert.deepEqual(Object.keys(onDisk).sort(), ['id', 'start'])
  assert.equal(store.getRunningTimer().title, '写方案')
  assert.equal(store.stopTimer(), true)
  const closed = store.list().find((e) => e.id === todo.id).timeEntries[0]
  assert.equal(typeof closed.end, 'string')
  assert.equal(fs.existsSync(path.join(dir, 'sched', 'timer.json')), false)
  assert.equal(store.getRunningTimer(), null)
  assert.equal(store.stopTimer(), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('计时：独立段落 entries/<id>.json（带标题），且必须有名目', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const running = store.startTimer(null, '  读论文  ')
  assert.equal(running.id, '')
  assert.equal(running.title, '读论文')
  // 标题上限与日程标题同口径（网格上它就是这段的标题）
  assert.equal(store.startTimer(null, 'x'.repeat(50)).title.length, 16)
  assert.equal(store.stopTimer(), true)
  const entries = store.listOrphans()
  assert.equal(entries.length, 2)
  assert.equal(entries[0].note, '读论文')
  const file = path.join(dir, 'sched', 'entries', `${entries[0].id}.json`)
  assert.equal(fs.existsSync(file), true)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).start, running.start)
  assert.throws(() => store.startTimer(null, '   '), /独立计时需要标题/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('计时：起新表先闭合在跑的那只（全局单实例）', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const a = store.create({ title: '甲' })
  const b = store.create({ title: '乙' })
  store.startTimer(a.id, null)
  store.startTimer(b.id, null)
  const first = store.list().find((e) => e.id === a.id).timeEntries[0]
  assert.equal(typeof first.end, 'string')
  assert.equal(store.getRunningTimer().id, b.id)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('计时状态从盘面读：别处（同步 / 另一个客户端）写下的 timer.json 本端立刻可见', () => {
  const dir = tmp()
  const schedDir = path.join(dir, 'sched')
  const store = new ScheduleStore(schedDir)
  const todo = store.create({ title: '跨端计时' })
  fs.writeFileSync(path.join(schedDir, 'timer.json'), JSON.stringify({ id: todo.id, start: '2026-10-02T09:00:00' }), 'utf8')
  assert.equal(store.getRunningTimer().id, todo.id)
  // 坏内容当空闲，但不挪走别人的活文件
  fs.writeFileSync(path.join(schedDir, 'timer.json'), '{ 坏内容', 'utf8')
  assert.equal(store.getRunningTimer(), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('删除挂着计时的条目：那只表随之退场（段不会挂在不存在的条目上）', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const todo = store.create({ title: '删掉' })
  store.startTimer(todo.id, null)
  assert.equal(store.remove(todo.id), true)
  assert.equal(store.getRunningTimer(), null)
  assert.equal(fs.existsSync(path.join(dir, 'sched', 'timer.json')), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('计时段编辑：改时刻与备注、非法时刻与进行中段一律拒绝、删除落盘', () => {
  const dir = tmp()
  const store = new ScheduleStore(path.join(dir, 'sched'))
  const todo = store.create({ title: '复习' })
  store.startTimer(todo.id, null)
  // 进行中的段改不动也删不掉（先停表）
  assert.equal(store.entryUpdate(todo.id, 0, { note: '偷跑' }), null)
  assert.equal(store.entryDelete(todo.id, 0), false)
  store.stopTimer()

  const ok = store.entryUpdate(todo.id, 0, { start: '2026-10-01T08:00', end: '2026-10-01T09:30', note: '  第一章  ' })
  assert.equal(ok.start, '2026-10-01T08:00')
  assert.equal(ok.end, '2026-10-01T09:30')
  assert.equal(ok.note, '第一章')
  // 给了非法时刻就是拒绝：静默忽略会让用户以为改掉了
  assert.equal(store.entryUpdate(todo.id, 0, { start: '2026-10-01 08:00' }), null)
  assert.equal(store.entryUpdate(todo.id, 0, { end: '2026-10-01T07:00' }), null)
  assert.equal(store.entryUpdate(todo.id, 9, { end: '2026-10-01T07:00' }), null)
  // 备注清空 = 删键
  assert.equal(store.entryUpdate(todo.id, 0, { note: '  ' }).note, undefined)
  assert.equal(store.entryDelete(todo.id, 0), true)
  assert.equal(store.list().find((e) => e.id === todo.id).timeEntries.length, 0)

  // 独立段：owner 空、note 上限 16 字、删除要删文件
  store.startTimer(null, '读文献')
  store.stopTimer()
  const entry = store.listOrphans()[0]
  const file = path.join(dir, 'sched', 'entries', `${entry.id}.json`)
  assert.equal(store.entryUpdate(null, 0, { note: 'y'.repeat(30) }).note.length, 16)
  assert.equal(store.entryDelete(null, 0), true)
  assert.equal(fs.existsSync(file), false)
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
