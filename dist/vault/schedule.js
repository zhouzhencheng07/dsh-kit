// dsh-kit/vault 组件的日程半边——结构化存储与查询派生（schedule.ts）
//
// 职责：日程/待办的结构化数据持有者（一条一文件、单文件原子落盘，固定
// $DSH_HOME/dsh-kit/schedule/，与知识库 vaultRoot 互不相干），以及派生层：
// 区间重复展开、统计。UI 组件（可编辑面板）在 client/bundle.js 的 vaultModule；
// HTTP 端点（读写，UI 的写路径）在 src/vault/index.ts。agent 侧不注册工具——
// 日程编辑走技能池的技能，直接改 events/<id>.json（格式与校验见该技能）。
//
// 设计要点：
// - 日程是强结构数据（起止/重复/位置），以 JSON 存 $DSH_HOME，不进知识库目录；
// - kind 派生：有 start=事件（上网格），无 start=待办（due 可选）——不存显式
//   kind 字段，避免两处真源。
// - 时间全部存本地朴素串（无时区后缀），同格式字符串比较即时间序。
// - 重复展开只在宿主查询层做（expandOccurrences，带 endDate/state），客户端拿
//   现成 occurrence 渲染；支持 daily/weekly/monthly × interval × days(weekly) × end。
// - 计时是全局单实例（timer.json）：起新表先把在跑的那段闭合；挂条目的段落进
//   该条目的 timeEntries（进行中的段 end 缺省），独立段落成 entries/<id>.json。
// 生命周期：模块级单例懒构造（首次端点触达）；文件缺失=空库；JSON 损坏
// → 坏文件改存 .bak 后降级空库，不让日程服务砖死。
import fs from 'node:fs';
import path from 'node:path';
import { kitPath } from "../core/data-path.js";
import { kitLogger } from "../core/log.js";
const log = kitLogger('vault');
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
/** 严格日期：格式对 + 真实存在的日历日（2026-02-30 不算）——参数校验用 */
export function isRealDateStr(s) {
    return isDateStr(s) && parseDate(s) !== null;
}
/** "YYYY-MM-DD" → 本地零点 Date；非法返回 null */
export function parseDate(s) {
    if (!DATE_RE.test(s))
        return null;
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime()))
        return null;
    // Date 会把不存在的日子往后滚（02-30 → 03-02）：那样存的是字面串、派生层算的是
    // 另一天，必须按原样回读三个字段确认它真实存在
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d)
        return null;
    return date;
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
// ── 字段白名单与校验 ─────────────────────────────────────────────────────────
/** 标题统一上限（面板输入框 maxLength/计数器与写入同一口径）：标题只放
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
/** 待办截止：纯日期或日期时刻都收（"今天18:00 交表"这类带时刻的写法），统一截到分钟 */
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
    // 三态语义：字符串落值、null/空串显式清空、其他类型不动
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
    // recurrence：null 才是「显式清空」，非 null 但不合法一律抛错——静默当成清空等于
    // 一个拼错的 repeat 把整条系列抹掉（patch 里 out.recurrence=null 会被照单落盘）
    if (has('recurrence')) {
        if (input.recurrence === null) {
            if (patch)
                out.recurrence = null;
        }
        else {
            const rec = sanitizeRecurrence(input.recurrence);
            if (rec === null)
                throw new Error('recurrence 不合法：type 需为 daily/weekly/monthly（weekly 还需 days）');
            out.recurrence = rec;
        }
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
    setOrClear('due', f.due);
    setOrClear('skip', f.skip);
    setOrClear('completedAt', f.completedAt);
    if (f.parentId !== undefined)
        ev.parentId = f.parentId;
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
/** 日程数据目录：固定 $DSH_HOME/dsh-kit/schedule/（一条一文件），与知识库（vaultRoot）
 *  无关——日程是独立能力，知识库未配置也照常可用 */
export function resolveScheduleDir() {
    return kitPath('schedule');
}
// 一条一文件（同步底座按文件合并的契约）：
//   events/<id>.json    一条事件或待办（含 recurrence / timeEntries / rev）
//   entries/<id>.json   一条独立计时段（原 orphans，自带 id）
//   timer.json          进行中的计时（本端读写：起停表与快照都经它）
// 为什么：同步（git 底座）按文件合并——整库单文件时两端各改一次必冲突，拆开后冲突面
// 只剩"同一条"；文件名 = id，改期只改内容不移动文件、删除 = 删文件（不需要墓碑）。
/** 新身份：时间戳 36 进制 + 4 位随机（同 36 进制） */
function newId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export class ScheduleStore {
    /** 当前数据目录（构造可注入别的路径供测试；默认 resolveScheduleDir()） */
    dir;
    data = { events: [] };
    /** 盘上签名（每个 json 的 名:体积:mtime + 目录项数）：变了才整库重读。
     *  null = 还没记过 */
    stamp = null;
    constructor(dir) {
        this.dir = dir ?? resolveScheduleDir();
        this.sync();
    }
    eventsDir() {
        return path.join(this.dir, 'events');
    }
    entriesDir() {
        return path.join(this.dir, 'entries');
    }
    /** 进行中的计时（单文件；没有文件 = 空闲） */
    timerFile() {
        return path.join(this.dir, 'timer.json');
    }
    /** 读进行中的计时。文件缺失 / 坏内容 / 形状不对都当空闲：不挪 .bak——
     *  这是共享目录里别的程序随时在改的活文件，为一次坏读丢掉别人的计时没有意义
     *  （下一次起表就会重写它） */
    readTimer() {
        let raw;
        try {
            raw = fs.readFileSync(this.timerFile(), 'utf8');
        }
        catch {
            return null;
        }
        let value;
        try {
            value = JSON.parse(raw);
        }
        catch {
            return null;
        }
        if (value === null || typeof value !== 'object')
            return null;
        const v = value;
        if (typeof v.id !== 'string' || typeof v.start !== 'string' || !DT_RE.test(v.start))
            return null;
        return typeof v.title === 'string' && v.title !== '' ? { id: v.id, start: v.start, title: v.title } : { id: v.id, start: v.start };
    }
    /** 落 / 撤进行中的计时（空闲 = 删文件，与「目录里没有进行中的表」同义） */
    writeTimer(timer) {
        if (!timer) {
            try {
                fs.unlinkSync(this.timerFile());
            }
            catch {
                /* 文件本来就不在 = 已是目标状态 */
            }
        }
        else if (!this.writeJson(this.timerFile(), timer)) {
            return; // 没写成就别改签名，下一轮 sync 会把内存态拉回盘面
        }
        this.stamp = this.diskStamp();
    }
    /** 原子写单个 JSON（tmp + rename）；失败只告警并回 false（内存态仍可用，下次变更
     *  会再试）。调用方删旧文件前必须看这个返回值——没写成还删，条目就从盘上消失了 */
    writeJson(file, value) {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
            fs.renameSync(tmp, file);
            return true;
        }
        catch (error) {
            log.error('日程写入失败', { file, err: error });
            return false;
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
    /** 盘上签名：只 stat 不读正文（轮询 30s 一次，这样才便宜）。目录项增删改都
     *  会改到任一文件的体积/mtime 或目录本身的 mtime */
    diskStamp() {
        const parts = [];
        for (const dir of [this.eventsDir(), this.entriesDir()]) {
            let names;
            try {
                names = fs.readdirSync(dir);
            }
            catch {
                continue;
            }
            for (const name of names.sort()) {
                if (!name.endsWith('.json'))
                    continue;
                try {
                    const st = fs.statSync(path.join(dir, name));
                    parts.push(`${dir}/${name}:${st.size}:${st.mtimeMs}`);
                }
                catch {
                    parts.push(`${dir}/${name}:gone`);
                }
            }
        }
        // timer.json 也在签名里：别处起停表，本端要立刻看见同一只表
        try {
            const st = fs.statSync(this.timerFile());
            parts.push(`timer.json:${st.size}:${st.mtimeMs}`);
        }
        catch {
            parts.push('timer.json:none');
        }
        return parts.join('|');
    }
    /** 与盘面对齐后再答：库是共享目录，别的程序与同步随时在写，
     *  启动时读一次就永远看不见那些改动，而且 agent 的更新会把别处改过的版本整条
     *  覆盖掉。签名变了才重读，读写在同一个同步调用里完成。 */
    sync() {
        const next = this.diskStamp();
        if (next === this.stamp)
            return;
        this.load();
        this.stamp = this.diskStamp(); // load 自己会改盘（文件名归一/补 id），重取一次
    }
    load() {
        const events = [];
        for (const { file, value } of this.readJsonDir(this.eventsDir())) {
            if (!value || typeof value !== 'object' || typeof value.id !== 'string' || value.id === '')
                continue;
            // 文件名即身份：不符就迁到 <id>.json 并删旧文件，否则同一份内容会被读成两条
            const want = path.join(this.eventsDir(), `${value.id}.json`);
            if (path.resolve(file) !== path.resolve(want)) {
                // 写成功才删旧文件（writeJson 失败只告警不抛，照删等于把这条从盘上抹掉）
                if (this.writeJson(want, value)) {
                    try {
                        fs.unlinkSync(file);
                    }
                    catch {
                        /* 忽略 */
                    }
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
                : newId();
            value.id = id;
            const want = path.join(this.entriesDir(), `${id}.json`);
            if (path.resolve(file) !== path.resolve(want)) {
                // 写成功才删旧文件（writeJson 失败只告警不抛，照删等于把这条从盘上抹掉）
                if (this.writeJson(want, value)) {
                    try {
                        fs.unlinkSync(file);
                    }
                    catch {
                        /* 忽略 */
                    }
                }
            }
            orphans.push(value);
        }
        orphans.sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0));
        this.data = { events, orphans, runningTimer: this.readTimer() };
    }
    writeEvent(id) {
        const ev = this.data.events.find((e) => e.id === id);
        if (!ev)
            return;
        if (this.writeJson(path.join(this.eventsDir(), `${id}.json`), ev))
            this.stamp = this.diskStamp();
    }
    removeEventFile(id) {
        try {
            fs.unlinkSync(path.join(this.eventsDir(), `${id}.json`));
        }
        catch {
            /* 不存在也算成功 */
        }
        this.stamp = this.diskStamp();
    }
    writeEntry(id) {
        const entry = (this.data.orphans ?? []).find((o) => o.id === id);
        if (!entry)
            return;
        if (this.writeJson(path.join(this.entriesDir(), `${id}.json`), entry))
            this.stamp = this.diskStamp();
    }
    removeEntryFile(id) {
        try {
            fs.unlinkSync(path.join(this.entriesDir(), `${id}.json`));
        }
        catch {
            /* 不存在也算成功 */
        }
        this.stamp = this.diskStamp();
    }
    /** 内容变了就推进版本号（同步用它判断"这条被改过几次"，不依赖时钟） */
    touch(ev) {
        ev.rev = (ev.rev ?? 0) + 1;
        ev.updatedAt = dtStrOf(new Date());
    }
    list() {
        this.sync();
        return this.data.events;
    }
    /** 独立计时段（不进事件列表，统计与网格展示用）；由计时功能写入，本访问器只读 */
    listOrphans() {
        this.sync();
        return Array.isArray(this.data.orphans) ? this.data.orphans : [];
    }
    create(input) {
        const fields = sanitizeFields(input, false);
        if (!fields.title)
            throw new Error('title 必填');
        this.sync(); // 落盘前先与盘面对齐：新 id 不冲突，但内存里不能是旧快照
        const now = new Date();
        const event = {
            id: newId(),
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
        this.sync(); // 不先重读就会拿旧快照整条盖掉别处刚改过的内容
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
        this.sync();
        const before = this.data.events.length;
        this.data.events = this.data.events.filter((e) => e.id !== id);
        if (this.data.events.length === before)
            return false;
        this.removeEventFile(id);
        // 挂着的那只表随条目退场：段会挂在一个已不存在的条目上，之后再也停不下来
        if (this.data.runningTimer?.id === id) {
            this.data.runningTimer = null;
            this.writeTimer(null);
        }
        return true;
    }
    /** 勾选完成 / 取消完成（日程与待办同一动作；completedAt = 完成时刻） */
    setDone(id, done) {
        this.sync();
        const ev = this.data.events.find((e) => e.id === id);
        if (!ev)
            return null;
        if (done)
            ev.completedAt = dtStrOf(new Date());
        else
            delete ev.completedAt;
        this.touch(ev);
        this.writeEvent(id);
        return ev;
    }
    // ── 计时（全局单实例）────────────────────────────────────────────────────
    /**
     * 起表：`id` 命中条目就挂它计时，否则按 `title` 起一段独立计时。
     * 已有进行中先闭合——两段同时在跑等于这段时间凭空多出一份，谁也说不清自己在干什么。
     * 独立计时必须有名目（网格是时间分配视图，无名目的时段无从识别）。
     */
    startTimer(id, title) {
        this.sync();
        if (this.data.runningTimer)
            this.stopTimer();
        const start = dtStrOf(new Date(), true);
        const ev = id ? this.data.events.find((e) => e.id === id) : undefined;
        if (ev) {
            // 挂条目计时：进行中的段落进该条目的 timeEntries（end 缺省 = 还没停），
            // 标题永远跟条目走（timer.json 只记 id 与起表时刻）
            const entries = ev.timeEntries ?? [];
            entries.push({ start });
            ev.timeEntries = entries;
            this.touch(ev);
            const running = { id: ev.id, start };
            this.writeEvent(ev.id);
            this.data.runningTimer = running;
            this.writeTimer(running);
            return running;
        }
        const label = (title ?? '').trim().slice(0, SCHED_TITLE_MAX);
        if (label === '')
            throw new Error('独立计时需要标题（也可挂一条待办）');
        const running = { id: '', start, title: label };
        this.data.runningTimer = running;
        this.writeTimer(running);
        return running;
    }
    /** 停表：挂条目的段补上 end 留在 timeEntries；独立的段落 entries/<id>.json
     *  （不进列表但统计照计）。无进行中时返回 false */
    stopTimer() {
        this.sync();
        const running = this.data.runningTimer;
        if (!running)
            return false;
        const now = dtStrOf(new Date(), true);
        if (running.id !== '') {
            const ev = this.data.events.find((e) => e.id === running.id);
            const open = (ev?.timeEntries ?? []).find((t) => t.end === undefined);
            if (ev && open) {
                open.end = now;
                this.touch(ev);
                this.writeEvent(ev.id);
            }
            this.data.runningTimer = null;
            this.writeTimer(null);
            return true;
        }
        const entry = { id: newId(), start: running.start, end: now, note: running.title };
        this.data.orphans = [...(this.data.orphans ?? []), entry];
        this.data.runningTimer = null;
        this.writeEntry(entry.id);
        this.writeTimer(null);
        return true;
    }
    /** 进行中的计时（挂条目的标题现查条目——条目可能在别处被改了名） */
    getRunningTimer() {
        this.sync();
        const running = this.data.runningTimer;
        if (!running)
            return null;
        if (running.id === '')
            return running;
        const title = this.data.events.find((e) => e.id === running.id)?.title ?? '';
        return title === '' ? running : { ...running, title };
    }
    // ── 计时段编辑（网格是时间分配视图：段真实计入，须可像日程一样改）──────
    /** owner 空 = 独立段（entries/），否则 = 该条目的 timeEntries。返回的是**活数组**
     *  本身（就地改完由调用方触发落盘），空列表就地补上 */
    entryListOf(owner) {
        if (!owner) {
            this.data.orphans ??= [];
            return this.data.orphans;
        }
        const ev = this.data.events.find((e) => e.id === owner);
        if (!ev)
            return null;
        ev.timeEntries ??= [];
        return ev.timeEntries;
    }
    /** 改一段已闭合的计时（时刻 / 备注）。时刻非法或 end 早于 start 一律拒绝，
     *  不做半截更新；同秒零长段是快速起停的合法存量，只改备注也放行 */
    entryUpdate(owner, index, patch) {
        this.sync();
        const list = this.entryListOf(owner);
        const entry = list?.[index];
        if (!list || !entry || entry.end === undefined)
            return null;
        // 给了就必须是合法时刻：错的静默忽略等于用户以为改掉了、其实没改
        const badDt = (v) => v !== undefined && v !== null && !DT_RE.test(String(v));
        if (badDt(patch.start) || badDt(patch.end))
            return null;
        // 校验按原精度比（起止都带秒时，先截 end 会凭空造出 end < start）
        const start = typeof patch.start === 'string' ? patch.start : entry.start;
        const end = typeof patch.end === 'string' ? patch.end : entry.end;
        const from = parseDT(start);
        const to = parseDT(end);
        if (from === null || to === null || to.getTime() < from.getTime())
            return null;
        // 落盘统一截到分钟（网格按分钟画，秒级差异没有显示意义）
        entry.start = start.slice(0, 16);
        entry.end = end.slice(0, 16);
        // 备注上限跟归属走：独立段的 note 就是它在网格上的标题（与日程标题同口径），
        // 挂在条目下的段只是备注位（与 description 同口径）
        if (patch.note !== undefined && patch.note !== null) {
            const cap = owner ? 200 : SCHED_TITLE_MAX;
            const note = String(patch.note).trim().slice(0, cap);
            if (note === '')
                delete entry.note;
            else
                entry.note = note;
        }
        if (owner) {
            const ev = this.data.events.find((e) => e.id === owner);
            if (ev)
                this.touch(ev);
            this.writeEvent(owner);
        }
        else if (entry.id) {
            this.writeEntry(entry.id);
        }
        return entry;
    }
    /** 删一段已闭合的计时（进行中的段先停表）；返回是否真删了 */
    entryDelete(owner, index) {
        this.sync();
        const list = this.entryListOf(owner);
        if (!list || list[index] === undefined || list[index]?.end === undefined)
            return false;
        const removed = list.splice(index, 1)[0];
        if (owner) {
            const ev = this.data.events.find((e) => e.id === owner);
            if (ev)
                this.touch(ev);
            this.writeEvent(owner);
        }
        else if (removed?.id) {
            this.removeEntryFile(removed.id);
        }
        return true;
    }
    // ── 派生：展开 / 统计 / 汇总 ─────────────────────────────────────────────
    occurrences(from, to) {
        this.sync();
        return expandOccurrences(this.data.events, from, to);
    }
    stats(scope, date, now) {
        this.sync();
        const [from, to] = rangeOf(scope, date);
        const nowD = now ?? new Date();
        const timedMs = timedMsInRange(this.data.events, from, to, this.data.orphans);
        const occ = expandOccurrences(this.data.events, from, to, nowD);
        const eventCount = occ.length;
        // completedCount/openCount 是 occurrence 口径：数已过/未到，不是待办
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
        // 同上：以天数封顶推进，非法日期不会把宿主事件循环转死
        const iterDays = diffDays(iterFrom, iterTo);
        for (let i = 0; i <= iterDays; i++) {
            const d = addDays(iterFrom, i);
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
                // 每月：同一天号；29/30/31 号在短月落到该月最后一天（"每月31号"不该
                // 整个二月都不出现——静默跳过等于系列悄悄断了）
                const startDom = Number(startDate.slice(8, 10));
                const dom = Number(d.slice(8, 10));
                const lastDom = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();
                hit = (dom === startDom || (startDom > lastDom && dom === lastDom)) && diffMonths(startDate, d) % interval === 0;
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
/** 模块级单例：各端点共享同一份内存态。文件位置固定，惰性构造一次 */
let singleton = null;
export function syncScheduleStore() {
    if (!singleton)
        singleton = new ScheduleStore();
    return singleton;
}
