// dsh-kit/vault 组件的日程半边——结构化存储与查询派生（schedule.ts）
//
// 职责：日程/待办的结构化数据持有者（一条一文件、单文件原子落盘，固定
// $DSH_HOME/dsh-kit/schedule/，与知识库 vaultRoot 互不相干），以及派生层：
// 区间重复展开、统计、文本汇总。UI 组件（只读面板）在 client/bundle.js 的
// vaultModule；agent 工具（buildScheduleTools）在本文件定义、经 src/vault/index.ts
// 用宿主 defineTool 注册；HTTP 端点（只读）同在该文件。
//
// 设计要点：
// - 日程是强结构数据（起止/重复/位置），不是笔记——不做 md 不进 vault；
// - kind 派生：有 start=事件（上网格），无 start=待办（due 可选）——不存显式
//   kind 字段，避免两处真源。
// - 时间全部存本地朴素串（无时区后缀），同格式字符串比较即时间序。
// - 重复展开只在宿主查询层做（expandOccurrences，带 endDate/state），客户端拿
//   现成 occurrence 渲染；支持 daily/weekly/monthly × interval × days(weekly) × end。
// - 不做计时（起停与计时段编辑归望舒端）：数据里的 timeEntries/entries 只读——
//   独立计时段照常载入并计入统计，目录里望舒端的 timer.json 不读不写。
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
/** ISO 周一 */
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
/** 待办截止：纯日期或日期时刻都收（桌面端会写"今天18:00 交表"），统一截到分钟 */
function sanitizeDue(raw) {
    if (typeof raw !== 'string')
        return undefined;
    if (DATE_RE.test(raw) || DT_RE.test(raw))
        return raw.slice(0, 16);
    return undefined;
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
    // 三态语义（与桌面端 patch 语义同一口径）：字符串落值、null/空串显式清空、其他类型不动
    const clearableText = (key, cap) => {
        if (!has(key))
            return;
        const v = input[key];
        if (typeof v === 'string')
            out[key] = v === '' ? null : v.slice(0, cap);
        else if (v === null && patch)
            out[key] = null;
    };
    clearableText('description', 2000);
    clearableText('location', 200);
    const clearableDT = (key) => {
        if (!has(key))
            return;
        const v = input[key];
        if (typeof v === 'string' && DT_RE.test(v))
            out[key] = v.slice(0, 16);
        else if (v === null && patch)
            out[key] = null;
    };
    clearableDT('start');
    clearableDT('end');
    if (has('recurrence'))
        out.recurrence = sanitizeRecurrence(input.recurrence);
    if (has('color') && typeof input.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(input.color)) {
        out.color = input.color;
    }
    if (has('due')) {
        const d = sanitizeDue(input.due);
        if (d !== undefined)
            out.due = d;
        else if (input.due === null && patch)
            out.due = null;
    }
    // skip："跳过这一次"写的那些天。元素逐个过日期校验、排序去重；
    // 空表 / null = 清空（契约：空表不留字段）
    if (has('skip')) {
        const v = input.skip;
        if (Array.isArray(v)) {
            const days = [...new Set(v.filter((s) => typeof s === 'string' && DATE_RE.test(s)))].sort();
            out.skip = days.length > 0 ? days : null;
        }
        else if (patch) {
            out.skip = null;
        }
    }
    if (has('completedAt')) {
        const v = input.completedAt;
        if (typeof v === 'string' && (DATE_RE.test(v) || DT_RE.test(v)))
            out.completedAt = v.slice(0, 16);
        else if (v === null && patch)
            out.completedAt = null;
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
/** 把 sanitize 产物落到条目上：null = 清空该字段（键一并删掉，不落 null 进盘） */
function applyFields(ev, f) {
    const setOrClear = (key, value) => {
        if (value === undefined)
            return;
        if (value === null)
            delete ev[key];
        else
            ev[key] = value;
    };
    if (f.title !== undefined)
        ev.title = f.title;
    setOrClear('description', f.description);
    setOrClear('location', f.location);
    setOrClear('start', f.start);
    setOrClear('end', f.end);
    if (f.recurrence !== undefined)
        ev.recurrence = f.recurrence;
    if (f.color !== undefined)
        ev.color = f.color;
    setOrClear('due', f.due);
    setOrClear('skip', f.skip);
    setOrClear('completedAt', f.completedAt);
    if (f.parentId !== undefined)
        ev.parentId = f.parentId;
}
/** 待办是否已逾期：纯日期到**当天结束前**都不算逾期（只比"今天"），带时刻比到分钟 */
function dueOverdue(ev, now) {
    if (ev.start !== undefined || ev.completedAt != null || ev.due === undefined)
        return false;
    if (ev.due.includes('T'))
        return ev.due.slice(0, 16) <= dtStrOf(now);
    return ev.due.slice(0, 10) < dateStrOf(now);
}
/**
 * 合并结果的整体校验（create 与 update 都先推演成完整条目再校验，不做半截更新）：
 * 日程 start/end 成对且 end 严格晚于 start；待办（无 start）不能带重复规则——
 * 那会变成永不展开的死配置。互斥字段静默互清（日程不写 due）。
 */
function validateScheduleEvent(ev) {
    if (ev.start !== undefined) {
        if (ev.end === undefined)
            throw new Error('日程必须有结束时刻（end 与 start 成对）');
        const s = parseDT(ev.start);
        const e = parseDT(ev.end);
        if (!s || !e)
            throw new Error('start/end 无法解析');
        if (e.getTime() <= s.getTime())
            throw new Error('end 必须晚于 start');
        delete ev.due;
    }
    else if (ev.recurrence != null) {
        throw new Error('重复仅对日程生效：待办不能带 repeat');
    }
}
// ── Store ───────────────────────────────────────────────────────────────────
export function dshKitDataDir() {
    const env = process.env.DSH_HOME;
    const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh');
    return path.join(home, 'dsh-kit');
}
/** 日程数据目录：固定 $DSH_HOME/dsh-kit/schedule/（一条一文件），与知识库（vaultRoot）
 *  无关——日程是独立能力，知识库未配置也照常可用 */
export function resolveScheduleDir() {
    return path.join(dshKitDataDir(), 'schedule');
}
// 一条一文件（与桌面端、鸿蒙端同一份契约）：
//   events/<id>.json    一条事件或待办（含 recurrence / timeEntries / rev）
//   entries/<id>.json   一条独立计时段（原 orphans，自带 id）
//   timer.json          进行中的计时（望舒端专用状态，本端不读不写）
// 为什么：同步（git 底座）按文件合并——整库单文件时两端各改一次必冲突，拆开后冲突面
// 只剩"同一条"；文件名 = id，改期只改内容不移动文件、删除 = 删文件（不需要墓碑）。
export class ScheduleStore {
    /** 当前数据目录（构造可注入别的路径供测试；默认 resolveScheduleDir()） */
    dir;
    data = { events: [] };
    constructor(dir) {
        this.dir = dir ?? resolveScheduleDir();
        this.load();
    }
    eventsDir() {
        return path.join(this.dir, 'events');
    }
    entriesDir() {
        return path.join(this.dir, 'entries');
    }
    /** 原子写单个 JSON（tmp + rename）；失败只告警（内存态仍可用，下次变更会再试） */
    writeJson(file, value) {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
            fs.renameSync(tmp, file);
        }
        catch (error) {
            console.warn(`dsh-kit: 日程写入失败（${file}）：${error instanceof Error ? error.message : error}`);
        }
    }
    /** 读目录里的 `*.json`；坏单条挪 `.bak` 后跳过，不拖垮整库 */
    readJsonDir(dir) {
        const out = [];
        let names;
        try {
            names = fs.readdirSync(dir);
        }
        catch {
            return out; // 目录不存在 = 空库
        }
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const file = path.join(dir, name);
            try {
                out.push({ file, value: JSON.parse(fs.readFileSync(file, 'utf8')) });
            }
            catch {
                try {
                    fs.renameSync(file, `${file}.bak`);
                }
                catch {
                    /* 改名失败就让它留在原地 */
                }
            }
        }
        return out;
    }
    load() {
        const events = [];
        for (const { file, value } of this.readJsonDir(this.eventsDir())) {
            if (!value || typeof value !== 'object' || typeof value.id !== 'string' || value.id === '')
                continue;
            // 文件名即身份：不符就迁到 <id>.json 并删旧文件，否则同一份内容会被读成两条
            const want = path.join(this.eventsDir(), `${value.id}.json`);
            if (path.resolve(file) !== path.resolve(want)) {
                this.writeJson(want, value);
                try {
                    fs.unlinkSync(file);
                }
                catch {
                    /* 忽略 */
                }
            }
            events.push(value);
        }
        events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const orphans = [];
        for (const { file, value } of this.readJsonDir(this.entriesDir())) {
            if (!value || typeof value !== 'object')
                continue;
            // 缺 id 的独立段补一个身份（文件名就是它）
            const id = typeof value.id === 'string' && value.id !== ''
                ? value.id
                : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            value.id = id;
            const want = path.join(this.entriesDir(), `${id}.json`);
            if (path.resolve(file) !== path.resolve(want)) {
                this.writeJson(want, value);
                try {
                    fs.unlinkSync(file);
                }
                catch {
                    /* 忽略 */
                }
            }
            orphans.push(value);
        }
        orphans.sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0));
        this.data = { events, orphans };
    }
    writeEvent(id) {
        const ev = this.data.events.find((e) => e.id === id);
        if (ev)
            this.writeJson(path.join(this.eventsDir(), `${id}.json`), ev);
    }
    removeEventFile(id) {
        try {
            fs.unlinkSync(path.join(this.eventsDir(), `${id}.json`));
        }
        catch {
            /* 不存在也算成功 */
        }
    }
    /** 内容变了就推进版本号（同步用它判断"这条被改过几次"，不依赖时钟） */
    touch(ev) {
        ev.rev = (ev.rev ?? 0) + 1;
        ev.updatedAt = dtStrOf(new Date());
    }
    list() {
        return this.data.events;
    }
    /** 独立计时段（不进事件列表，统计与网格展示用）；段由望舒端计时产生，本端只读 */
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
        applyFields(event, fields);
        // 不做"缺省今天"兜底：无期限待办就该是无期限（due:null / 不带 due 都一样）
        validateScheduleEvent(event);
        event.rev = 1;
        this.data.events.push(event);
        this.writeEvent(event.id);
        return event;
    }
    update(id, patch) {
        const idx = this.data.events.findIndex((e) => e.id === id);
        const current = this.data.events[idx];
        if (idx < 0 || !current)
            return null;
        // 先在副本上推演合并结果并整体校验，再落回原位——校验失败不做半截更新
        const draft = { ...current };
        applyFields(draft, sanitizeFields(patch, true));
        validateScheduleEvent(draft);
        this.data.events[idx] = draft;
        this.touch(draft);
        this.writeEvent(id);
        return draft;
    }
    remove(id) {
        const before = this.data.events.length;
        this.data.events = this.data.events.filter((e) => e.id !== id);
        if (this.data.events.length === before)
            return false;
        this.removeEventFile(id);
        return true;
    }
    // ── 派生：展开 / 统计 / 汇总 ─────────────────────────────────────────────
    occurrences(from, to) {
        return expandOccurrences(this.data.events, from, to);
    }
    stats(scope, date, now) {
        const [from, to] = rangeOf(scope, date);
        const nowD = now ?? new Date();
        const timedMs = timedMsInRange(this.data.events, from, to, this.data.orphans);
        const occ = expandOccurrences(this.data.events, from, to, nowD);
        const eventCount = occ.length;
        // completedCount/openCount 是 occurrence 口径：数已过/未到，不是待办
        // （agent 侧的待办口径见 summary——逾期/即将到期/完成在那里单独数）
        let completedCount = 0;
        let openCount = 0;
        for (const o of occ) {
            if (o.state === 'past')
                completedCount++;
            else
                openCount++;
        }
        // 总时长（时间分配口径）：日程块就是时间分配，结束时刻一过
        // 即计入合计，不用再补计时段；未到来的不记。挂了计时段的事件不按占位时长
        // 重复计——真实用时已由段承载（timedMsInRange 按 start 日归属）。now 供测试注入。
        const withEntries = new Set(this.data.events
            .filter((e) => Array.isArray(e.timeEntries) && e.timeEntries.length > 0)
            .map((e) => e.id));
        let elapsedMs = 0;
        for (const o of occ) {
            if (o.state !== 'past')
                continue;
            if (withEntries.has(o.baseId))
                continue;
            elapsedMs += occDurationMins(o) * 60000;
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
        // 待办口径（与统计卡的 occurrence 已过/未到是两回事）：逾期单独点名（纯日期
        // 到当天结束前不算逾期，带时刻比到分钟）
        const now = new Date();
        const isOverdue = (ev) => dueOverdue(ev, now);
        const dueDayOf = (ev) => ev.due?.slice(0, 10) ?? '';
        const todos = this.data.events.filter((e) => e.start === undefined && !e.completedAt && e.due !== undefined);
        const overdueCount = todos.filter(isOverdue).length;
        const upcomingCount = todos.filter((e) => !isOverdue(e) && dueDayOf(e) >= from && dueDayOf(e) <= to).length;
        const doneCount = this.data.events.filter((e) => e.start === undefined && e.completedAt != null && e.completedAt.slice(0, 10) >= from && e.completedAt.slice(0, 10) <= to).length;
        lines.push(`合计：事件 ${stats.eventCount} · 逾期待办 ${overdueCount} · 即将到期 ${upcomingCount} · 待办完成 ${doneCount} · 总时长 ${fmtDur(stats.totalMs)}（内计时 ${fmtDur(stats.timedMs)}）`);
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
            const dueTasks = tasksWithDue.filter((e) => e.due?.slice(0, 10) === d && !e.completedAt);
            const doneTasks = this.data.events.filter((e) => e.start === undefined && e.completedAt?.slice(0, 10) === d);
            if (dayOcc.length === 0 && dueTasks.length === 0 && doneTasks.length === 0)
                continue;
            lines.push('');
            lines.push(scope === 'day' ? '事件与待办：' : `${d}（${WEEKDAY_ZH[isoWeekday(d)] ?? ''}）：`);
            for (const o of dayOcc) {
                // 跨天块带上日期（只写时刻会读成同一天倒挂）
                const when = o.endDate > o.date
                    ? `${o.date.slice(5)} ${minsToHHmm(o.startMins)}–${o.endDate.slice(5)}${o.endMins !== null ? ` ${minsToHHmm(o.endMins)}` : ''}`
                    : `${minsToHHmm(o.startMins)}${o.endMins !== null ? `–${minsToHHmm(o.endMins)}` : ''}`;
                lines.push(`- ${when} ${o.title}${o.location ? `（${o.location}）` : ''}`);
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
     *  指向（删除/修改）。重复事件按 baseId 去重，待办含已完成（completedAt 落在时段） */
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
                when: `${o.date} ${minsToHHmm(o.startMins)}`,
                recurring: ev.recurrence != null ? true : undefined,
            });
        }
        const now = new Date();
        for (const ev of this.data.events) {
            if (ev.start !== undefined)
                continue;
            if (ev.completedAt && ev.completedAt.slice(0, 10) >= from && ev.completedAt.slice(0, 10) <= to) {
                out.push({ id: ev.id, kind: '已完成待办', title: ev.title, when: ev.completedAt.slice(0, 10) });
            }
            else if (!ev.completedAt && ev.due !== undefined) {
                // due 兼容日期与日期时刻：落窗按日期部分比，时刻不把条目挤到窗外
                const dueDate = ev.due.slice(0, 10);
                if (dueDate >= from && dueDate <= to) {
                    out.push({ id: ev.id, kind: '待办', title: ev.title, when: ev.due, ...(dueOverdue(ev, now) ? { overdue: true } : {}) });
                }
            }
        }
        return out;
    }
}
export function dtStrOf(d) {
    return `${dateStrOf(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
/** 实例的已占位时长（分钟，跨天块把中间整天算上；无 end 按 60 分钟兜底） */
function occDurationMins(o) {
    const endMins = o.endMins ?? o.startMins + 60;
    const days = Math.max(0, diffDays(o.date, o.endDate));
    return Math.max(0, days * 1440 + endMins - o.startMins);
}
/** 实例三态（比到分钟）：end 一过即 past、start 未到即 todo、中间 doing——
 *  跨天块从昨天延续过来的部分也按 doing（nowDate 落在 date 与 endDate 之间） */
function occurrenceState(date, endDate, startMins, endMins, now) {
    const nowDate = dateStrOf(now);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const endDay = endMins === null ? date : endDate;
    const end = endMins ?? startMins + 60;
    if (nowDate > endDay || (nowDate === endDay && nowMins >= end))
        return 'past';
    if (nowDate < date || (nowDate === date && nowMins < startMins))
        return 'todo';
    return 'doing';
}
/**
 * 区间 [from, to]（含两端）展开成网格渲染单元，每个实例带 endDate 与 state。
 * - 非重复事件：落在起始日；跨天块按 endDate 判纳入——起始日在窗口前、尾巴
 *   伸进窗口的也产出（客户端按日切片渲染，丢了这条尾巴那几天就空了）
 * - 重复事件：按 type/interval/days/end 在区间内逐日匹配，时刻沿用 base；
 *   候选日同样往前多看 spanDays 天，接住从窗口前一天延续进来的跨天尾巴
 */
export function expandOccurrences(events, from, to, now = new Date()) {
    const out = [];
    for (const ev of events) {
        if (ev.start === undefined)
            continue;
        const startDate = ev.start.slice(0, 10);
        const startMins = minutesOfTimePart(ev.start) ?? 0;
        const endMins = ev.end !== undefined ? minutesOfTimePart(ev.end) : null;
        const endDate = ev.end !== undefined ? ev.end.slice(0, 10) : startDate;
        const spanDays = Math.max(0, diffDays(startDate, endDate));
        const mk = (date, virtual) => {
            const occEndDate = spanDays > 0 ? addDays(date, spanDays) : date;
            return {
                baseId: ev.id,
                date,
                endDate: occEndDate,
                startMins,
                endMins,
                state: occurrenceState(date, occEndDate, startMins, endMins, now),
                title: ev.title,
                ...(ev.color !== undefined ? { color: ev.color } : {}),
                ...(ev.location !== undefined ? { location: ev.location } : {}),
                ...(ev.description !== undefined ? { description: ev.description } : {}),
                virtual,
            };
        };
        if (!ev.recurrence) {
            if (endDate < from || startDate > to)
                continue;
            out.push(mk(startDate, false));
            continue;
        }
        const rec = ev.recurrence;
        const iterFrom = addDays(startDate > from ? startDate : from, -spanDays);
        const iterTo = rec.end !== undefined && rec.end < to ? rec.end : to;
        const interval = rec.interval ?? 1;
        // skip："删掉重复日程的某一次"写的那些天（一条系列里被跳过的日期），
        // 展开时直接不产出；不认识的实现会忽略这个字段，读进来也不会丢
        const skip = ev.skip ?? [];
        for (let d = iterFrom; d <= iterTo; d = addDays(d, 1)) {
            if (d < startDate || skip.includes(d))
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
            if (!hit)
                continue;
            const occ = mk(d, true);
            if (occ.date > to || occ.endDate < from)
                continue;
            out.push(occ);
        }
    }
    return out.sort((a, b) => (a.date === b.date ? a.startMins - b.startMins : a.date < b.date ? -1 : 1));
}
/** 模块级单例：端点与 agent 工具共享同一份内存态。文件位置固定，惰性构造一次 */
let singleton = null;
export function syncScheduleStore() {
    if (!singleton)
        singleton = new ScheduleStore();
    return singleton;
}
// ── agent 工具（schedule_query / schedule_create / schedule_update / schedule_delete）─
// agent 能查、能建、也能改（update 走 store 的三态 patch：null = 清空，改类型 =
// start/end 与 due 二选一给）；删除仍由人发起（对话里确认）、agent 代执行，所以
// query 返回 items（id）+ delete/update 按 id 精确指向，不提供按标题模糊改删。
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
/** 条目一句话摘要：`日程：例会（2026-09-07 09:00–10:00，每周(1)）`——create/update 工具共用 */
function eventDigest(ev) {
    const kind = ev.start !== undefined ? '日程' : '待办';
    const bits = [];
    if (ev.start !== undefined) {
        bits.push(`${ev.start.replace('T', ' ')}${ev.end !== undefined ? `–${ev.end.split('T')[1] ?? ''}` : ''}`);
    }
    else if (ev.due !== undefined)
        bits.push(`截止 ${ev.due}`);
    if (ev.recurrence)
        bits.push(recurrenceLabel(ev.recurrence));
    return `${kind}：${ev.title}${bits.length > 0 ? `（${bits.join('，')}）` : ''}`;
}
/**
 * schedule_create 扁平参数 → store.create 输入。纯函数（测试直接对表）：
 * date+time→start/end（缺 endTime 缺省 +1 小时）、endDate→跨天 end、仅
 * date→due（待办）、repeat* 组装 recurrence（store 层 sanitizeRecurrence 再
 * 兜底一道）。date/time 写错是显式意图，解析失败抛错让模型重试，不静默降级
 * 成别的日子或别的种类。
 * 日程 start/end 都必填（"有 start 就必须有 end"，缺 end 的条目在
 * 应用里判非法改不动），所以这里绝不落"有 start 没 end"的条目：endTime 缺省
 * 由 time+1 小时补出，跨零点则 end 落到次日 00:00。
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
    const endDateArg = typeof args.endDate === 'string' && args.endDate.trim() !== '' ? args.endDate.trim() : null;
    // endDate 是"跨天日程"的日期部分：没有时刻就无从谈起（只给日期是待办，没有 end）
    if (endDateArg !== null && time === null)
        throw new Error('endDate 仅对日程生效：请同时提供 time');
    if (endDateArg !== null && !isDateStr(endDateArg))
        throw new Error(`endDate 无法解析：${endDateArg}`);
    if (time !== null) {
        const startMins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
        let end = endTime;
        let endDate = endDateArg;
        if (end === null) {
            // 缺 endTime：开始 +1 小时；跨零点（如 23:30）落到次日 00:00，并据此得出 endDate
            const plusHour = startMins + 60;
            if (plusHour >= 1440) {
                end = '00:00';
                if (endDate === null)
                    endDate = addDays(date, 1);
            }
            else {
                end = minsToHHmm(plusHour);
                if (endDate === null)
                    endDate = date;
            }
        }
        else if (endDate === null) {
            endDate = date;
        }
        // 两端格式统一 "YYYY-MM-DDTHH:mm"，字符串比较即时间序；end 必须严格晚于
        // start（相等=零长块，非法），抛错让模型重试
        const start = `${date}T${time}`;
        const endDT = `${endDate}T${end}`;
        if (endDT <= start)
            throw new Error(`end 必须晚于 start：start=${start}、end=${endDT}`);
        input.start = start;
        input.end = endDT;
    }
    else {
        input.due = date;
    }
    const repeat = args.repeat;
    if (repeat === 'daily' || repeat === 'weekly' || repeat === 'monthly') {
        if (!('start' in input))
            throw new Error('repeat 仅对日程生效：请提供 time');
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
export function buildScheduleTools({ defineTool, store, }) {
    const query = defineTool({
        name: 'schedule_query',
        description: '查询用户的日程汇总（日/周/月粒度）：带时刻的事件、逾期待办、即将到期与已完成的待办、累计计时。' +
            '用户问「今天/本周/本月有什么安排」「这周做了什么」，或安排新事项前想先看时间冲突时使用。' +
            '返回值 items 带条目 id（逾期待办带 overdue 标记），是 schedule_delete / schedule_update 的定位依据。',
        parameters: {
            scope: { type: 'string', required: true, enum: ['day', 'week', 'month'], description: '汇总粒度：日/周/月' },
            date: { type: 'string', description: '基准日期 YYYY-MM-DD，缺省今天' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        presentCall: () => ({ card: 'generic', title: '查询日程', kind: 'read' }),
        async execute(args) {
            const scope = args?.scope === 'week' || args?.scope === 'month' ? args.scope : 'day';
            const date = typeof args?.date === 'string' && DATE_RE.test(args.date) ? args.date : todayStr();
            return { summary: store.summary(scope, date), items: store.items(scope, date) };
        },
    });
    const create = defineTool({
        name: 'schedule_create',
        description: '在用户日程里创建条目。三种用法：① 只给 date（YYYY-MM-DD）= 待办（待办列表显示）；' +
            '② date + time（+ 可选 endTime）= 当天日程（周网格显示），缺 endTime 时默认「开始 +1 小时」；' +
            '③ 再加 endDate = 跨天日程（结束落在次日及以后），' +
            '如 date=2026-09-19, time=22:00, endDate=2026-09-20, endTime=02:00。' +
            '用户说「帮我记个日程」「周三下午3点开会」「加个待办/周五要交报告」时使用；' +
            '重复日程用 repeat 系参数（如每两周周一：repeat=weekly、repeatInterval=2、repeatDays="1"）。',
        parameters: {
            title: { type: 'string', required: true, description: `事项标题，最多 ${SCHED_TITLE_MAX} 字：重要信息做标题，其余写 description` },
            date: { type: 'string', required: true, description: '开始日期 YYYY-MM-DD（只给日期=待办；也容忍 YYYY-MM-DDTHH:mm）' },
            time: { type: 'string', description: '开始时刻 HH:mm（给了就是日程，不给则创建为待办）' },
            endTime: { type: 'string', description: '结束时刻 HH:mm（仅与 time 同用；缺省 = 开始 +1 小时）' },
            endDate: { type: 'string', description: '结束日期 YYYY-MM-DD（仅与 time 同用）：结束落在次日及以后时提供；缺省 = date' },
            repeat: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: '重复类型，缺省不重复；仅日程（给了 time）生效' },
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
        presentCall: (args) => ({
            card: 'generic',
            title: '创建日程',
            kind: 'other',
            ...(typeof args.title === 'string' && args.title !== '' ? { rawInput: args.title } : {}),
        }),
        async execute(args) {
            const ev = store.create(toolArgsToCreateInput(args));
            return { id: ev.id, summary: `已创建${eventDigest(ev)}` };
        },
    });
    const upd = defineTool({
        name: 'schedule_update',
        description: '修改已有日程条目（部分更新：只给要改的字段，其余不动；id 来自 schedule_query）。' +
            '清空语义（传 null 生效，不带键 = 不动）：due:null = 改成无期限、location/description:null = 清空、' +
            'completedAt:null = 取消完成、skip:["YYYY-MM-DD"] = 跳过重复系列的某一次（skip:[] = 清空全部跳过）。' +
            '改类型二选一：日程→待办给 start:null+end:null（重复系列再加 recurrence:null）；待办→日程给 start+end（成对，end 必须晚于 start）+ due:null。' +
            'due 兼容 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm。',
        parameters: {
            id: { type: 'string', required: true, description: 'schedule_query 返回的条目 id' },
            title: { type: 'string', description: `新标题，最多 ${SCHED_TITLE_MAX} 字` },
            description: { type: 'string', description: '备注；null/空串 = 清空' },
            location: { type: 'string', description: '地点；null/空串 = 清空' },
            start: { type: 'string', description: '开始时刻 YYYY-MM-DDTHH:mm；null = 清空（改待办，与 end 一起给）' },
            end: { type: 'string', description: '结束时刻 YYYY-MM-DDTHH:mm（日程必填，须晚于 start）；null = 清空' },
            due: { type: 'string', description: '待办截止 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm；null = 无期限' },
            completedAt: { type: 'string', description: '完成时刻 YYYY-MM-DDTHH:mm；null = 取消完成' },
            skip: { type: 'array', description: '重复系列要跳过的日期（YYYY-MM-DD）数组；[] = 清空全部跳过' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        presentCall: (args) => ({
            card: 'generic',
            title: '修改日程',
            kind: 'edit',
            ...(typeof args.title === 'string' && args.title !== ''
                ? { rawInput: args.title }
                : typeof args.id === 'string'
                    ? { rawInput: args.id }
                    : {}),
        }),
        async execute(args) {
            const id = typeof args.id === 'string' ? args.id : '';
            if (id === '')
                throw new Error('id 必填');
            const { id: _omit, ...patch } = args;
            const ev = store.update(id, patch);
            if (!ev)
                return { ok: false, summary: `未找到条目 ${id}（可能已删除），请用 schedule_query 重新查询` };
            return { ok: true, id: ev.id, summary: `已更新${eventDigest(ev)}` };
        },
    });
    const del = defineTool({
        name: 'schedule_delete',
        description: '删除用户日程里的条目（按 id，id 来自 schedule_query 返回的 items）。' +
            '用户说「把xx删了/取消周三的会」时：先 schedule_query 查时段拿 id，向用户确认后删除。' +
            '重复日程删除的是整个重复系列；只想去掉某一次请改用 schedule_update 传 skip。',
        parameters: {
            id: { type: 'string', required: true, description: 'schedule_query 返回的条目 id' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        presentCall: (args) => ({
            card: 'generic',
            title: '删除日程',
            kind: 'delete',
            ...(typeof args.id === 'string' ? { rawInput: args.id } : {}),
        }),
        async execute(args) {
            const id = typeof args.id === 'string' ? args.id : '';
            const ev = store.list().find((e) => e.id === id);
            if (!ev)
                return { ok: false, summary: `未找到条目 ${id}（可能已删除），请用 schedule_query 重新查询` };
            store.remove(id);
            return { ok: true, summary: `已删除：${ev.title}${ev.recurrence != null ? '（重复日程，整个系列已移除）' : ''}` };
        },
    });
    return [query, create, upd, del];
}
