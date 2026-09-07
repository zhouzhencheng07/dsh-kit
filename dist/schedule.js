// dsh-kit 日程模块——结构化存储与查询派生（schedule.ts）
//
// 职责：日程/待办/计时的唯一数据持有者（JSON 原子落盘，2026-09-08 起与知识库
// 同址：<vaultRoot>/schedule.json（vault 只索引 md，json 放根下不碍事）；不配置
// 知识库目录日程整体不可用——UI 引导配置、端点回 vault-not-configured、agent
// 工具拒绝），以及派生层：区间重复展开、统计、文本汇总。UI 组件在
// client/bundle.js，agent 工具定义与端点注册在 index.ts——本文件不感知两者形状。
//
// 设计要点（schedule-design.md）：
// - 日程是强结构数据（起止/重复/位置），不是笔记——不做 md 不进 vault；
//   记录形状照抄 wangshu schedule_events + timeEntries 内联，迁移可 1:1。
// - kind 派生：有 start=事件（上网格），无 start=待办（due 可选）——不存显式
//   kind 字段，避免两处真源。
// - 时间全部存本地朴素串（无时区后缀），同格式字符串比较即时间序；跨时区
//   迁移不在 v1 范围（个人单机使用）。
// - 重复展开只在宿主查询层做（expandOccurrences），客户端拿现成 occurrence
//   渲染；v1 支持 daily/weekly/monthly × interval × days(weekly) × end。
// - 计时全局单实例：timer/start 遇 running 先自动 stop（闭合已有条目再开新）。
// 生命周期：模块级单例懒构造（首次端点/工具触达）；文件缺失=空库；JSON 损坏
// → 坏文件改存 .bak 后降级空库，不让日程服务砖死。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// ── 时间工具（本地朴素时间，字符串即真源）────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const pad2 = (n) => String(n).padStart(2, '0');
export function dateStrOf(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function todayStr() {
    return dateStrOf(new Date());
}
/** 端点参数校验用（格式对不对，不校验真实日历日） */
export function isDateStr(s) {
    return DATE_RE.test(s);
}
/** "YYYY-MM-DD" → 本地零点 Date；非法返回 null */
export function parseDate(s) {
    if (!DATE_RE.test(s))
        return null;
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
}
/** "YYYY-MM-DDTHH:mm(:ss)" → 本地 Date；非法返回 null */
export function parseDT(s) {
    if (!DT_RE.test(s))
        return null;
    const [datePart, timePart] = s.split('T');
    const base = parseDate(datePart);
    if (!base)
        return null;
    const [hh, mm, ss] = timePart.split(':').map(Number);
    if (hh > 23 || mm > 59 || (ss ?? 0) > 59)
        return null;
    base.setHours(hh, mm, ss ?? 0, 0);
    return base;
}
export function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    if (!d)
        return dateStr;
    d.setDate(d.getDate() + n);
    return dateStrOf(d);
}
/** ISO 周一（wangshu 周视图同款 isoWeek） */
export function mondayOf(dateStr) {
    const d = parseDate(dateStr);
    if (!d)
        return dateStr;
    const offset = (d.getDay() + 6) % 7;
    return addDays(dateStr, -offset);
}
/** 1=周一 … 7=周日 */
function isoWeekday(dateStr) {
    const d = parseDate(dateStr);
    if (!d)
        return 1;
    const day = d.getDay();
    return day === 0 ? 7 : day;
}
function diffDays(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db)
        return 0;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function diffMonths(a, b) {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return (by - ay) * 12 + (bm - am);
}
function minutesOfTimePart(s) {
    const t = s.split('T')[1];
    if (!t)
        return null;
    const [hh, mm] = t.split(':').map(Number);
    return hh * 60 + mm;
}
function fmtDur(ms) {
    // 不足一分钟的段（快速起停的计时）显示秒，不然"0分"看不出时长
    if (ms < 60000)
        return `${Math.round(ms / 1000)}秒`;
    const mins = Math.round(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0)
        return `${h}小时${m}分`;
    return `${m}分钟`;
}
const WEEKDAY_ZH = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// ── 字段白名单与校验 ─────────────────────────────────────────────────────────
/** 标题统一上限（面板输入框 maxLength/计数器、agent 工具同一口径）：标题只放
 *  重要信息，细节写备注——周网格块内标题是识别主体，长标题展示必然截断 */
export const SCHED_TITLE_MAX = 16;
function sanitizeRecurrence(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const type = r.type;
    if (type !== 'daily' && type !== 'weekly' && type !== 'monthly')
        return null;
    const out = { type };
    if (typeof r.interval === 'number' && Number.isFinite(r.interval) && r.interval >= 1) {
        out.interval = Math.floor(r.interval);
    }
    if (type === 'weekly' && Array.isArray(r.days)) {
        const days = r.days.filter((n) => typeof n === 'number' && n >= 1 && n <= 7);
        if (days.length > 0)
            out.days = [...new Set(days)].sort((a, b) => a - b);
        else
            return null;
    }
    if (typeof r.end === 'string' && DATE_RE.test(r.end))
        out.end = r.end;
    return out;
}
/** 从任意输入里挑出合法的日程字段（create 用全量，update 用 patch 语义） */
function sanitizeFields(input, patch) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
    if (has('title')) {
        const t = input.title;
        if (typeof t === 'string' && t.trim() !== '')
            out.title = t.trim().slice(0, SCHED_TITLE_MAX);
    }
    if (has('description') && typeof input.description === 'string') {
        out.description = input.description.slice(0, 2000);
    }
    if (has('location') && typeof input.location === 'string') {
        out.location = input.location.slice(0, 200);
    }
    if (has('start') && typeof input.start === 'string' && DT_RE.test(input.start)) {
        out.start = input.start.slice(0, 16);
    }
    if (has('end') && typeof input.end === 'string' && DT_RE.test(input.end)) {
        out.end = input.end.slice(0, 16);
    }
    if (has('allDay'))
        out.allDay = input.allDay === true;
    if (has('recurrence'))
        out.recurrence = sanitizeRecurrence(input.recurrence);
    if (has('color') && typeof input.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(input.color)) {
        out.color = input.color;
    }
    if (has('due') && typeof input.due === 'string' && DATE_RE.test(input.due)) {
        out.due = input.due;
    }
    if (has('parentId') && typeof input.parentId === 'string')
        out.parentId = input.parentId;
    // patch 语义允许显式清空可选字段；create 语义只在给了合法值时带上
    if (patch)
        return out;
    if (out.title === undefined)
        return {};
    return out;
}
// ── Store ───────────────────────────────────────────────────────────────────
export function dshKitDataDir() {
    const env = process.env.DSH_HOME;
    const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh');
    return path.join(home, 'dsh-kit');
}
/**
 * 日程数据文件解析（2026-09-08 用户定稿：与知识库同址——vault 只索引 md，json
 * 放根下不碍事，直接 <vaultRoot>/schedule.json）。不配置知识库目录日程即不可用
 * （UI 引导配置、端点与 agent 工具拒绝），此回退路径仅作 store 的停泊位，不做
 * 任何数据迁移——测试期没有要搬的数据。
 */
export function resolveScheduleFile(vaultRoot) {
    const root = (vaultRoot ?? '').trim();
    if (root === '')
        return path.join(dshKitDataDir(), 'schedule.json');
    return path.join(root, 'schedule.json');
}
export class ScheduleStore {
    /** 当前数据文件（retarget 可换——vaultRoot 配置变化时整体换库，实例不变） */
    file;
    data = { events: [], runningTimer: null };
    constructor(file) {
        this.file = file ?? path.join(dshKitDataDir(), 'schedule.json');
        this.load();
    }
    /** 换数据文件并重读（同文件 no-op）。旧内存态丢弃；进行中的计时随旧库消失，
     * 换库后 runningTimer=null——切知识库位置是罕见操作，可接受 */
    retarget(file) {
        if (this.file === file)
            return;
        this.file = file;
        this.load();
    }
    load() {
        let raw;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        }
        catch {
            // 缺失 = 空库。必须清内存态：retarget 换库时旧库数据不能残留——
            // 否则下一次 mutate 会把旧库内容整体写进新文件
            this.data = { events: [], runningTimer: null, orphans: [] };
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.events))
                throw new Error('events 不是数组');
            this.data = {
                events: parsed.events,
                runningTimer: parsed.runningTimer ?? null,
                orphans: Array.isArray(parsed.orphans) ? parsed.orphans : [],
            };
        }
        catch {
            // 损坏（含 events 非数组这类半损坏）：坏文件挪 .bak，服务降级空库继续活
            try {
                fs.renameSync(this.file, `${this.file}.bak`);
            }
            catch {
                /* 改名失败就让它留在原地 */
            }
            this.data = { events: [], runningTimer: null, orphans: [] };
        }
    }
    persist() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
            fs.renameSync(tmp, this.file);
        }
        catch (error) {
            // 落盘失败不抛给调用方（内存态仍可用），下次变更会再试
            console.warn(`dsh-kit: schedule.json 写入失败：${error instanceof Error ? error.message : error}`);
        }
    }
    list() {
        return this.data.events;
    }
    /** 独立计时段（不进事件列表，统计用）；测试与后续「未分类时段」视图共用 */
    listOrphans() {
        return Array.isArray(this.data.orphans) ? this.data.orphans : [];
    }
    create(input) {
        const fields = sanitizeFields(input, false);
        if (!fields.title)
            throw new Error('title 必填');
        const now = new Date();
        const event = {
            id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            title: fields.title,
            createdAt: dtStrOf(now),
            updatedAt: dtStrOf(now),
        };
        if (fields.description !== undefined)
            event.description = fields.description;
        if (fields.location !== undefined)
            event.location = fields.location;
        if (fields.start !== undefined)
            event.start = fields.start;
        if (fields.end !== undefined)
            event.end = fields.end;
        if (fields.allDay !== undefined)
            event.allDay = fields.allDay;
        if (fields.recurrence !== undefined)
            event.recurrence = fields.recurrence;
        if (fields.color !== undefined)
            event.color = fields.color;
        if (fields.due !== undefined)
            event.due = fields.due;
        if (fields.parentId !== undefined)
            event.parentId = fields.parentId;
        if (event.start === undefined && event.due === undefined) {
            // 无时刻无截止的条目也允许（纯待办），due 缺省今天方便待办列表排序
            event.due = todayStr();
        }
        this.data.events.push(event);
        this.persist();
        return event;
    }
    update(id, patch) {
        const ev = this.data.events.find((e) => e.id === id);
        if (!ev)
            return null;
        const fields = sanitizeFields(patch, true);
        if (fields.title !== undefined)
            ev.title = fields.title;
        if (fields.description !== undefined)
            ev.description = fields.description;
        if (fields.location !== undefined)
            ev.location = fields.location;
        if (fields.start !== undefined)
            ev.start = fields.start;
        if (fields.end !== undefined)
            ev.end = fields.end;
        if (fields.allDay !== undefined)
            ev.allDay = fields.allDay;
        if (fields.recurrence !== undefined)
            ev.recurrence = fields.recurrence;
        if (fields.color !== undefined)
            ev.color = fields.color;
        if (fields.due !== undefined)
            ev.due = fields.due;
        if (fields.parentId !== undefined)
            ev.parentId = fields.parentId;
        ev.updatedAt = dtStrOf(new Date());
        this.persist();
        return ev;
    }
    remove(id) {
        const before = this.data.events.length;
        this.data.events = this.data.events.filter((e) => e.id !== id);
        if (this.data.events.length === before)
            return false;
        if (this.data.runningTimer?.id === id)
            this.data.runningTimer = null;
        this.persist();
        return true;
    }
    setDone(id, done) {
        const ev = this.data.events.find((e) => e.id === id);
        if (!ev)
            return null;
        ev.completedAt = done ? dtStrOf(new Date()) : null;
        ev.updatedAt = dtStrOf(new Date());
        this.persist();
        return ev;
    }
    // ── 计时（全局单实例）────────────────────────────────────────────────────
    timerStart(id, title) {
        // 已有进行中先闭合（礼貌性互斥：一边计时是人对自己时间的诚实）
        if (this.data.runningTimer)
            this.timerStop();
        const target = id ? this.data.events.find((e) => e.id === id) : undefined;
        // 独立计时必须有名目（用户定稿 2026-09-08：网格=时间分配视图，无名目的
        // 时段无从识别）；标题与日程/待办同口径限 16 字。挂条目时标题永远跟条目走
        const label = target ? undefined : title?.trim().slice(0, SCHED_TITLE_MAX) || undefined;
        if (!target && label === undefined)
            throw new Error('独立计时需要标题（也允许挂待办）');
        const start = dtStrOf(new Date(), true);
        if (target) {
            if (!Array.isArray(target.timeEntries))
                target.timeEntries = [];
            target.timeEntries.push({ start });
            target.updatedAt = start;
        }
        this.data.runningTimer = { id: target ? target.id : '', start, title: label };
        this.persist();
        return { runningTimer: { id: this.data.runningTimer.id, start, title: label } };
    }
    timerStop() {
        const running = this.data.runningTimer;
        if (!running)
            return { stopped: false };
        if (running.id) {
            const target = this.data.events.find((e) => e.id === running.id);
            if (target && Array.isArray(target.timeEntries)) {
                const open = target.timeEntries.find((t) => t.end === undefined);
                if (open)
                    open.end = dtStrOf(new Date(), true);
                target.updatedAt = dtStrOf(new Date(), true);
            }
        }
        else {
            // 独立计时（未挂条目）的时段落到 orphans：不挂列表但统计照计，
            // 否则停表即丢数据（timerStart 已强制独立计时必带标题，note 不会空）
            if (!Array.isArray(this.data.orphans))
                this.data.orphans = [];
            this.data.orphans.push({ start: running.start, end: dtStrOf(new Date(), true), note: running.title });
        }
        this.data.runningTimer = null;
        this.persist();
        return { stopped: true };
    }
    runningTimer() {
        const running = this.data.runningTimer;
        if (!running)
            return null;
        const title = running.id
            ? (this.data.events.find((e) => e.id === running.id)?.title ?? '')
            : (running.title ?? '');
        return { id: running.id, start: running.start, title };
    }
    // ── 计时段编辑（网格=时间分配视图：计时段真实计入，须可像日程一样改）──────
    /** owner=null → 独立计时段（orphans），否则事件 id → 其 timeEntries */
    entryListOf(owner) {
        if (owner === null) {
            if (!Array.isArray(this.data.orphans))
                this.data.orphans = [];
            return this.data.orphans;
        }
        const ev = this.data.events.find((e) => e.id === owner);
        if (!ev)
            return null;
        if (!Array.isArray(ev.timeEntries))
            ev.timeEntries = [];
        return ev.timeEntries;
    }
    /**
     * 修改计时段（时刻/备注）。只允许改已闭合段——进行中的段归停表动作管，直接
     * 改会造成 runningTimer 与数据错位。先整体验证再落字段：时刻非法或 end<=start
     * 拒绝（返回 null），不做半截更新。
     */
    entryUpdate(owner, index, patch) {
        const list = this.entryListOf(owner);
        if (!list)
            return null;
        const entry = list[index];
        if (!entry || entry.end === undefined)
            return null;
        const start = patch.start !== undefined ? patch.start : entry.start;
        const end = patch.end !== undefined ? patch.end : entry.end;
        if (!DT_RE.test(start) || !DT_RE.test(end))
            return null;
        const s = parseDT(start);
        const e = parseDT(end);
        // end<start 才拒（同秒零长段是快速停表的合法存量，允许只改备注）
        if (!s || !e || e.getTime() < s.getTime())
            return null;
        entry.start = start.slice(0, 16);
        entry.end = end.slice(0, 16);
        if (patch.note !== undefined) {
            // 独立段的 note 就是标题（16 字同口径）；挂条目段是备注
            const cap = owner === null ? SCHED_TITLE_MAX : 200;
            const note = patch.note.trim().slice(0, cap);
            if (note !== '')
                entry.note = note;
            else
                delete entry.note;
        }
        if (owner !== null) {
            const ev = this.data.events.find((e2) => e2.id === owner);
            if (ev)
                ev.updatedAt = dtStrOf(new Date());
        }
        this.persist();
        return entry;
    }
    /** 删除计时段（仅已闭合段；进行中的段先停表）。返回是否真的删了 */
    entryDelete(owner, index) {
        const list = this.entryListOf(owner);
        if (!list)
            return false;
        const entry = list[index];
        if (!entry || entry.end === undefined)
            return false;
        list.splice(index, 1);
        if (owner !== null) {
            const ev = this.data.events.find((e) => e.id === owner);
            if (ev)
                ev.updatedAt = dtStrOf(new Date());
        }
        this.persist();
        return true;
    }
    // ── 派生：展开 / 统计 / 汇总 ─────────────────────────────────────────────
    occurrences(from, to) {
        return expandOccurrences(this.data.events, from, to);
    }
    stats(scope, date, now) {
        const [from, to] = rangeOf(scope, date);
        const timedMs = timedMsInRange(this.data.events, from, to, this.data.orphans);
        const eventCount = expandOccurrences(this.data.events, from, to).length;
        // 总时长（时间分配口径，2026-09-08 定稿）：日程块就是时间分配，结束时刻一过
        // 即计入合计，不用再补计时段；未到来的不记。挂了计时段的事件不按占位时长
        // 重复计——真实用时已由段承载（timedMsInRange 按 start 日归属）。全天事件
        // 无固定时长，不参与。now 供测试注入。
        const nowD = now ?? new Date();
        const nowDate = dateStrOf(nowD);
        const nowMins = nowD.getHours() * 60 + nowD.getMinutes();
        const withEntries = new Set(this.data.events
            .filter((e) => Array.isArray(e.timeEntries) && e.timeEntries.length > 0)
            .map((e) => e.id));
        let elapsedMs = 0;
        for (const o of expandOccurrences(this.data.events, from, to)) {
            if (o.allDay || withEntries.has(o.baseId))
                continue;
            const end = o.endMins ?? o.startMins + 60;
            const passed = o.date < nowDate || (o.date === nowDate && end <= nowMins);
            if (passed)
                elapsedMs += Math.max(0, end - o.startMins) * 60000;
        }
        let completedCount = 0;
        let openCount = 0;
        for (const ev of this.data.events) {
            if (ev.start !== undefined)
                continue;
            if (ev.completedAt && ev.completedAt.slice(0, 10) >= from && ev.completedAt.slice(0, 10) <= to)
                completedCount++;
            else if (!ev.completedAt && ev.due && ev.due >= from && ev.due <= to)
                openCount++;
        }
        return { timedMs, totalMs: elapsedMs + timedMs, eventCount, completedCount, openCount };
    }
    /** agent 只看汇总（日/周/月）——schedule_query 工具的产物 */
    summary(scope, date) {
        const [from, to] = rangeOf(scope, date);
        const stats = this.stats(scope, date);
        const lines = [];
        if (scope === 'day') {
            const wd = WEEKDAY_ZH[isoWeekday(date)] ?? '';
            lines.push(`日程汇总 ${date}（${wd}）`);
        }
        else {
            lines.push(`日程汇总 ${scope === 'week' ? '本周' : '本月'} ${from} ~ ${to}`);
        }
        lines.push(`合计：事件 ${stats.eventCount} · 待办完成 ${stats.completedCount} · 到期待办 ${stats.openCount} · 总时长 ${fmtDur(stats.totalMs)}（内计时 ${fmtDur(stats.timedMs)}）`);
        const occ = expandOccurrences(this.data.events, from, to);
        const byDate = new Map();
        for (const o of occ) {
            const arr = byDate.get(o.date) ?? [];
            arr.push(o);
            byDate.set(o.date, arr);
        }
        const tasksWithDue = this.data.events.filter((e) => e.start === undefined && e.due);
        const dates = [];
        for (let d = from; d <= to; d = addDays(d, 1))
            dates.push(d);
        for (const d of dates) {
            const dayOcc = (byDate.get(d) ?? []).sort((a, b) => a.startMins - b.startMins);
            const dueTasks = tasksWithDue.filter((e) => e.due === d && !e.completedAt);
            const doneTasks = this.data.events.filter((e) => e.start === undefined && e.completedAt?.slice(0, 10) === d);
            if (dayOcc.length === 0 && dueTasks.length === 0 && doneTasks.length === 0)
                continue;
            lines.push('');
            lines.push(scope === 'day' ? '事件与待办：' : `${d}（${WEEKDAY_ZH[isoWeekday(d)] ?? ''}）：`);
            for (const o of dayOcc) {
                if (o.allDay)
                    lines.push(`- 全天：${o.title}${o.location ? `（${o.location}）` : ''}`);
                else {
                    const endTxt = o.endMins !== null ? `–${minsToHHmm(o.endMins)}` : '';
                    lines.push(`- ${minsToHHmm(o.startMins)}${endTxt} ${o.title}${o.location ? `（${o.location}）` : ''}`);
                }
            }
            for (const t of dueTasks)
                lines.push(`- [ ] 到期：${t.title}`);
            for (const t of doneTasks)
                lines.push(`- [x] 已完成：${t.title}`);
        }
        if (lines.length <= 2)
            lines.push('（该时段没有日程安排）');
        return lines.join('\n');
    }
    /** summary 的结构化并行视图：时段内条目 id/kind/标题/时间，供 agent 精确
     *  指向（删除）。重复事件按 baseId 去重，待办含已完成（completedAt 落在时段） */
    items(scope, date) {
        const [from, to] = rangeOf(scope, date);
        const out = [];
        const seenEvents = new Set();
        for (const o of expandOccurrences(this.data.events, from, to)) {
            if (seenEvents.has(o.baseId))
                continue;
            seenEvents.add(o.baseId);
            const ev = this.data.events.find((e) => e.id === o.baseId);
            if (!ev)
                continue;
            out.push({
                id: ev.id,
                kind: '日程',
                title: ev.title,
                when: o.allDay ? `${o.date} 全天` : `${o.date} ${minsToHHmm(o.startMins)}`,
                recurring: ev.recurrence != null ? true : undefined,
            });
        }
        for (const ev of this.data.events) {
            if (ev.start !== undefined)
                continue;
            if (ev.completedAt && ev.completedAt.slice(0, 10) >= from && ev.completedAt.slice(0, 10) <= to) {
                out.push({ id: ev.id, kind: '已完成待办', title: ev.title, when: ev.completedAt.slice(0, 10) });
            }
            else if (!ev.completedAt && ev.due !== undefined && ev.due >= from && ev.due <= to) {
                out.push({ id: ev.id, kind: '待办', title: ev.title, when: ev.due });
            }
        }
        return out;
    }
}
export function dtStrOf(d, withSeconds = false) {
    const base = `${dateStrOf(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return withSeconds ? `${base}:${pad2(d.getSeconds())}` : base;
}
export function rangeOf(scope, date) {
    const base = DATE_RE.test(date) ? date : todayStr();
    if (scope === 'day')
        return [base, base];
    if (scope === 'week') {
        const mon = mondayOf(base);
        return [mon, addDays(mon, 6)];
    }
    const [y, m] = base.split('-').map(Number);
    const first = `${y}-${pad2(m)}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    return [first, `${y}-${pad2(m)}-${pad2(lastDay)}`];
}
function minsToHHmm(mins) {
    return `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`;
}
/** 区间内计时合计（按计时段 start 归属日；进行中的不计入；orphans=独立计时段） */
export function timedMsInRange(events, from, to, orphans) {
    let total = 0;
    const addRange = (entries) => {
        if (!Array.isArray(entries))
            return;
        for (const t of entries) {
            if (t.end === undefined)
                continue;
            const day = t.start.slice(0, 10);
            if (day < from || day > to)
                continue;
            const s = parseDT(t.start);
            const e = parseDT(t.end);
            if (s && e && e > s)
                total += e.getTime() - s.getTime();
        }
    };
    for (const ev of events)
        addRange(ev.timeEntries);
    addRange(orphans);
    return total;
}
/**
 * 区间 [from, to]（含两端）展开成网格渲染单元。
 * - 非重复事件：落在起始日（跨天截止截到起始日 23:59，v1 不做跨天拆块）
 * - 全天事件：startMins=0 / endMins=1440
 * - 重复事件：按 type/interval/days/end 在区间内逐日匹配，时刻沿用 base
 */
export function expandOccurrences(events, from, to) {
    const out = [];
    for (const ev of events) {
        if (ev.start === undefined)
            continue;
        const startDate = ev.start.slice(0, 10);
        const startMins = minutesOfTimePart(ev.start) ?? 0;
        const endMins = ev.end !== undefined ? minutesOfTimePart(ev.end) : null;
        const allDay = ev.allDay === true;
        const base = {
            baseId: ev.id,
            startMins: allDay ? 0 : startMins,
            endMins: allDay ? 1440 : endMins,
            allDay,
            title: ev.title,
            color: ev.color,
            location: ev.location,
            description: ev.description,
            virtual: false,
        };
        if (!ev.recurrence) {
            if (startDate < from || startDate > to)
                continue;
            out.push({ ...base, date: startDate, virtual: false });
            continue;
        }
        const rec = ev.recurrence;
        const iterFrom = startDate > from ? startDate : from;
        const iterTo = rec.end !== undefined && rec.end < to ? rec.end : to;
        const interval = rec.interval ?? 1;
        for (let d = iterFrom; d <= iterTo; d = addDays(d, 1)) {
            if (d < startDate)
                continue;
            let hit = false;
            if (rec.type === 'daily')
                hit = diffDays(startDate, d) % interval === 0;
            else if (rec.type === 'weekly') {
                const days = rec.days ?? [isoWeekday(startDate)];
                hit = days.includes(isoWeekday(d)) && Math.floor(diffDays(mondayOf(startDate), mondayOf(d)) / 7) % interval === 0;
            }
            else {
                hit = d.slice(8, 10) === startDate.slice(8, 10) && diffMonths(startDate, d) % interval === 0;
            }
            if (hit)
                out.push({ ...base, date: d, virtual: true });
        }
    }
    return out.sort((a, b) => (a.date === b.date ? a.startMins - b.startMins : a.date < b.date ? -1 : 1));
}
/** 模块级单例：端点与 agent 工具共享同一份内存态。每次调用按当前 vaultRoot
 * 重解析目标文件，变了就原位 retarget（实例不变，捕获方无需重新取） */
let singleton = null;
export function syncScheduleStore(vaultRoot) {
    const file = resolveScheduleFile(vaultRoot);
    if (!singleton)
        singleton = new ScheduleStore(file);
    else
        singleton.retarget(file);
    return singleton;
}
// ── agent 工具（schedule_query / schedule_create / schedule_delete）─────────
// 边界即设计：agent 见汇总与创建/删除，不给 update 原子工具——编辑细节（改时刻/
// 重复规则/挪位置）在面板做，人主导；删除由人发起（对话里确认），agent 代执行，
// 所以 query 返回 items（id）+ delete 按 id 精确删，不提供按标题模糊删。
/** "H:mm"/"HH:mm" 归一成 "HH:mm"；缺位/越界返回 null */
function normHHmm(raw) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (m === null)
        return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59)
        return null;
    return `${pad2(hh)}:${pad2(mm)}`;
}
const REC_TYPE_ZH = { daily: '每天', weekly: '每周', monthly: '每月' };
function recurrenceLabel(rec) {
    // "每2周(1)" 形式：interval 与 days 直接拼接会有「每周×21」这类读法歧义
    const unit = rec.type === 'daily' ? '天' : rec.type === 'weekly' ? '周' : '月';
    const head = rec.interval !== undefined && rec.interval > 1 ? `每${rec.interval}${unit}` : REC_TYPE_ZH[rec.type];
    const bits = [head];
    if (rec.days !== undefined && rec.days.length > 0)
        bits.push(`(${rec.days.join(',')})`);
    if (rec.end !== undefined)
        bits.push(`至${rec.end}`);
    return bits.join('');
}
function createSummary(ev) {
    const kind = ev.start !== undefined ? '日程' : '待办';
    const bits = [];
    if (ev.allDay === true)
        bits.push(`${ev.start?.slice(0, 10) ?? ''} 全天`);
    else if (ev.start !== undefined) {
        bits.push(`${ev.start.replace('T', ' ')}${ev.end !== undefined ? `–${ev.end.split('T')[1] ?? ''}` : ''}`);
    }
    else if (ev.due !== undefined)
        bits.push(`截止 ${ev.due}`);
    if (ev.recurrence)
        bits.push(recurrenceLabel(ev.recurrence));
    return `已创建${kind}：${ev.title}${bits.length > 0 ? `（${bits.join('，')}）` : ''}`;
}
/**
 * schedule_create 扁平参数 → store.create 输入。纯函数（测试直接对表）：
 * date+time→start/end、仅 date→due（待办）、allDay→全天事件、repeat* 组装
 * recurrence（store 层 sanitizeRecurrence 再兜底一道）。date/time 写错是
 * 显式意图，解析失败抛错让模型重试，不静默降级成别的日子或别的种类。
 * 重复只对日程生效（expandOccurrences 跳过无 start 条目），待办带 repeat
 * 会变成永不展开的死配置，故直接拒绝。
 */
export function toolArgsToCreateInput(args) {
    const input = {};
    if (typeof args.title === 'string')
        input.title = args.title;
    if (typeof args.description === 'string')
        input.description = args.description;
    if (typeof args.location === 'string')
        input.location = args.location;
    const rawDate = typeof args.date === 'string' ? args.date.trim() : '';
    let date = isDateStr(rawDate) ? rawDate : '';
    let dtTime = null;
    if (date === '' && DT_RE.test(rawDate)) {
        dtTime = normHHmm(rawDate.slice(11, 16));
        if (dtTime === null)
            throw new Error(`date 无法解析：${args.date}`);
        date = rawDate.slice(0, 10);
    }
    if (date === '')
        throw new Error('date 必填，格式 YYYY-MM-DD');
    const timeArg = typeof args.time === 'string' && args.time.trim() !== '' ? args.time : null;
    const time = timeArg !== null ? normHHmm(timeArg) : dtTime;
    if (timeArg !== null && time === null)
        throw new Error(`time 无法解析：${timeArg}`);
    const endTimeArg = typeof args.endTime === 'string' && args.endTime.trim() !== '' ? args.endTime : null;
    const endTime = endTimeArg !== null ? normHHmm(endTimeArg) : null;
    if (endTimeArg !== null && endTime === null)
        throw new Error(`endTime 无法解析：${endTimeArg}`);
    if (args.allDay === true) {
        input.start = `${date}T00:00`;
        input.allDay = true;
    }
    else if (time !== null) {
        input.start = `${date}T${time}`;
        if (endTime !== null)
            input.end = `${date}T${endTime}`;
    }
    else {
        input.due = date;
    }
    const repeat = args.repeat;
    if (repeat === 'daily' || repeat === 'weekly' || repeat === 'monthly') {
        if (!('start' in input))
            throw new Error('repeat 仅对日程生效：请提供 time 或 allDay=true');
        const rec = { type: repeat };
        if (typeof args.repeatInterval === 'number' && Number.isFinite(args.repeatInterval) && args.repeatInterval >= 1) {
            rec.interval = Math.floor(args.repeatInterval);
        }
        if (repeat === 'weekly' && typeof args.repeatDays === 'string') {
            const days = [...new Set(args.repeatDays.split(/[^0-9]+/).map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
            if (days.length > 0)
                rec.days = days;
        }
        if (typeof args.repeatEnd === 'string' && isDateStr(args.repeatEnd))
            rec.end = args.repeatEnd;
        input.recurrence = rec;
    }
    return input;
}
export function buildScheduleTools({ defineTool, store, isConfigured, }) {
    /** 未配置时的引导文案：query 作为 summary 返回，create/delete 直接抛错 */
    const gate = () => isConfigured && !isConfigured()
        ? '日程尚未启用：日程与知识库共用存储目录，请先在 设置 → 插件 → dsh-kit 里填写「知识库目录」'
        : null;
    const query = defineTool({
        name: 'schedule_query',
        description: '查询用户的日程汇总（日/周/月粒度）：带时刻的事件、到期待办、已完成事项、累计计时。' +
            '用户问「今天/本周/本月有什么安排」「这周做了什么」，或安排新事项前想先看时间冲突时使用。' +
            '返回值 items 带条目 id，是 schedule_delete 的删除依据。',
        parameters: {
            scope: { type: 'string', required: true, enum: ['day', 'week', 'month'], description: '汇总粒度：日/周/月' },
            date: { type: 'string', description: '基准日期 YYYY-MM-DD，缺省今天' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        async execute(args) {
            const blocked = gate();
            if (blocked)
                return { summary: blocked, items: [] };
            const scope = args?.scope === 'week' || args?.scope === 'month' ? args.scope : 'day';
            const date = typeof args?.date === 'string' && DATE_RE.test(args.date) ? args.date : todayStr();
            return { summary: store.summary(scope, date), items: store.items(scope, date) };
        },
    });
    const create = defineTool({
        name: 'schedule_create',
        description: '在用户日程里创建条目。date+time 或 allDay 创建日程事件（周网格显示），只给 date 创建待办（待办列表显示）。' +
            '用户说「帮我记个日程」「周三下午3点开会」「周五全天评审」「加个待办/周五要交报告」时使用；' +
            '重复日程用 repeat 系参数（如每两周周一：repeat=weekly、repeatInterval=2、repeatDays="1"）。',
        parameters: {
            title: { type: 'string', required: true, description: `事项标题，最多 ${SCHED_TITLE_MAX} 字：重要信息做标题，其余写 description` },
            date: { type: 'string', required: true, description: '日期 YYYY-MM-DD（也容忍 YYYY-MM-DDTHH:mm）' },
            time: { type: 'string', description: '开始时刻 HH:mm（给了就是日程事件，不给且无 allDay 则创建为待办）' },
            endTime: { type: 'string', description: '结束时刻 HH:mm（仅与 time 同用）' },
            allDay: { type: 'boolean', description: '全天日程：给了就在该日建全天事件而非待办' },
            repeat: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: '重复类型，缺省不重复；仅日程（time/allDay）生效' },
            repeatInterval: { type: 'number', description: '重复间隔：每 N 天/周/月，缺省 1' },
            repeatDays: { type: 'string', description: 'weekly 专用：重复星期，1=周一…7=周日，如 "1,3,5"；缺省=开始日的星期' },
            repeatEnd: { type: 'string', description: '重复截止日 YYYY-MM-DD（含当天），缺省无限' },
            description: { type: 'string', description: '备注' },
            location: { type: 'string', description: '地点' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        async execute(args) {
            const blocked = gate();
            if (blocked)
                throw new Error(blocked);
            const ev = store.create(toolArgsToCreateInput(args));
            return { id: ev.id, summary: createSummary(ev) };
        },
    });
    const del = defineTool({
        name: 'schedule_delete',
        description: '删除用户日程里的条目（按 id，id 来自 schedule_query 返回的 items）。' +
            '用户说「把xx删了/取消周三的会」时：先 schedule_query 查时段拿 id，向用户确认后删除。' +
            '重复日程删除的是整个重复系列（v1 不支持只删单次实例）。',
        parameters: {
            id: { type: 'string', required: true, description: 'schedule_query 返回的条目 id' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        async execute(args) {
            const blocked = gate();
            if (blocked)
                throw new Error(blocked);
            const id = typeof args.id === 'string' ? args.id : '';
            const ev = store.list().find((e) => e.id === id);
            if (!ev)
                return { ok: false, summary: `未找到条目 ${id}（可能已删除），请用 schedule_query 重新查询` };
            store.remove(id);
            return { ok: true, summary: `已删除：${ev.title}${ev.recurrence != null ? '（重复日程，整个系列已移除）' : ''}` };
        },
    });
    return [query, create, del];
}
