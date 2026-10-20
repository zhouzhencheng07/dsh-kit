// dsh-kit/vault 组件的学习/复习半边——页面旁挂记录 <页目录>/.study/<页名>.json 的
// 读写与动作。记录**不写进页面正文**：每复习一次都会改页面文件，会把 mtime 顶到
// 「最近更新」，也会和 agent 改文 / 云同步互相覆盖。
//
// 与 .quiz/ 同一套「跟页面走」：页面改名 / 移动 / 删除由 fs.ts 把记录一起带走；
// .study 是点前缀目录，不进索引与目录树，但进存档与同步（记录要跨端）。
//
// 跨端契约（另一端的桌面实现照做；任一处不一致，同一页在两端就是两份进度）：
//   * 目录名 .study，文件名 <页名>.json（页名 = 页面 rel 末段，不带扩展名）
//   * 日期只到日（YYYY-MM-DD），updatedMs 用 epoch 毫秒
//   * version=1；status = active / done；done = 不再排下一次，但记录保留，可重启
//   * 历史按时间追加，超过 MAX_HISTORY 条丢最旧的
//   * 间隔不是死档位：存当前间隔（天），完成时默认往默认表上一档走，也可单次改写
// 复习待办不是虚拟行：每页当前一次复习在日程 events/ 里有一条真实待办（studyRel
// 指回本页），同步层在 study-events.ts；本记录仍是间隔与历史的真源。
//
// 读写都是同步 IO：插件侧没有线程池，Node 事件循环天然串行，不需要进程锁
// （另一端是线程池才要锁）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addDays, todayStr } from "./schedule.js";
import { SKIP_DIRS } from "./scanner.js";
/** 页面旁挂目录（点前缀：扫描跳过，不进索引与目录树） */
export const STUDY_DIR = '.study';
/** 默认复习表（天）：完成时取「第一个比当前间隔大的档」，到顶停在最后一档 */
export const LADDER = [1, 2, 4, 7, 15, 30, 60, 120];
/** 单次间隔上限（天）：改写到离谱大值时夹在这个范围里（下限 1） */
export const MAX_INTERVAL = 3650;
/** 历史保留条数：超出丢最旧的（记录本身很小，但别让它无界增长） */
export const MAX_HISTORY = 500;
const RECORD_SUFFIX = '.json';
/** 同步落下的冲突副本名里含这一段：不当记录读 */
const CONFLICT_MARK = '.conflict-';
// ── 路径 ────────────────────────────────────────────────────────────────────
function dirOf(rel) {
    const i = rel.lastIndexOf('/');
    return i < 0 ? '' : rel.slice(0, i);
}
function nameOf(rel) {
    const i = rel.lastIndexOf('/');
    return i < 0 ? rel : rel.slice(i + 1);
}
function dirAbsOf(root, rel) {
    const dir = dirOf(rel);
    return dir === '' ? root : path.join(root, ...dir.split('/'));
}
function scopeAbs(root, dir) {
    return dir === '' ? root : path.join(root, ...dir.split('/'));
}
/** 页面 rel → 记录文件绝对路径 */
export function studyPath(root, rel) {
    return path.join(dirAbsOf(root, rel), STUDY_DIR, nameOf(rel) + RECORD_SUFFIX);
}
/** rel / dir 入参守卫：口径与 quiz 的 safeQuizRel 同一套（只裁两端分隔符、拒盘符、
 *  拒空段与 . / ..；不额外 trim 空白、不设段数 / 段长上限）。空串合法（= 库根 / 整库）。 */
export function safeStudyRel(raw) {
    if (typeof raw !== 'string')
        throw new Error('页面路径非法');
    const rel = raw.replace(/^[/\\]+|[/\\]+$/g, '');
    if (rel === '')
        return '';
    if (rel.includes(':'))
        throw new Error('页面路径非法');
    const segs = rel.split(/[/\\]/);
    for (const seg of segs) {
        if (seg === '' || seg === '.' || seg === '..')
            throw new Error('页面路径非法');
    }
    return segs.join('/');
}
function requirePageRel(raw) {
    const rel = safeStudyRel(raw);
    if (rel === '')
        throw new Error('缺少页面');
    return rel;
}
/** 页面还在不在（.md / .markdown 任一即算） */
export function pageExists(root, rel) {
    if (rel === '')
        return false;
    const base = path.join(root, ...rel.split('/'));
    for (const ext of ['.md', '.markdown']) {
        if (fs.statSync(base + ext, { throwIfNoEntry: false })?.isFile() === true)
            return true;
    }
    return false;
}
/** 页面文件 → 同目录的记录文件（改名 / 移动 / 删除都从页面文件推） */
export function siblingOf(pageFile) {
    const stem = path.basename(pageFile, path.extname(pageFile));
    const parent = path.dirname(pageFile);
    if (stem === '' || stem === '.' || stem === '..')
        return null;
    return path.join(parent, STUDY_DIR, stem + RECORD_SUFFIX);
}
function moveFile(from, to) {
    if (fs.statSync(from, { throwIfNoEntry: false })?.isFile() !== true)
        return;
    const dir = path.dirname(to);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    try {
        fs.renameSync(from, to);
    }
    catch {
        // 目标已存在等搬不动的情形：保住现有文件比抛错打断改名/移动更合适
    }
}
/** 页面改名 / 移动后把记录搬过去（没有就什么都不做）。
 *  目录的改名 / 移动不用调它——.study/ 在目录体内，跟着目录一起走。 */
export function followPage(oldPage, newPage) {
    const from = siblingOf(oldPage);
    const to = siblingOf(newPage);
    if (from === null || to === null)
        return;
    moveFile(from, to);
    // 旧的点目录空了就顺手删掉（不空时 rmdir 自己会失败，无事发生）
    try {
        fs.rmdirSync(path.dirname(from));
    }
    catch {
        /* 非空或已不在 */
    }
}
/** 页面被删除时，它的记录文件也要一起进回收站（存在才返回） */
export function siblingsForDelete(pageFile) {
    const file = siblingOf(pageFile);
    return file !== null && fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true ? [file] : [];
}
// ── 写盘 ────────────────────────────────────────────────────────────────────
/** 原子写（tmp + rename）：同步与界面可能同时读到，别留半截文件。tmp 名带 pid + 随机
 *  尾巴——固定名在两端（或同步客户端）同时读写同一份文件时会互踩。 */
function writeAtomic(target, text) {
    const dir = path.dirname(target);
    try {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    }
    catch (error) {
        throw new Error('创建目录失败：' + messageOf(error));
    }
    const tmp = target + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
        fs.writeFileSync(tmp, text, 'utf8');
    }
    catch (error) {
        throw new Error('写入失败：' + messageOf(error));
    }
    try {
        fs.renameSync(tmp, target);
    }
    catch (error) {
        try {
            fs.rmSync(tmp, { force: true });
        }
        catch {
            /* 尽力清理 */
        }
        throw new Error('落盘失败：' + messageOf(error));
    }
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
const nowMs = () => Date.now();
// ── 解析 / 序列化（严格度与另一端 serde 对齐）────────────────────────────────
/** 整数上界（serde 的 u32 / u64）：越界一律当坏文件，两端判据要一致——
 *  这边放宽的话，同一份坏记录两端一个照收一个整份挪 .bak */
const isU32 = (v) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
const isU64 = (v) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER);
function parseHistoryEntry(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const obj = raw;
    // at / kind 在 serde 里是必填 String：缺了或类型不对整份算坏
    if (typeof obj.at !== 'string' || typeof obj.kind !== 'string')
        return null;
    if (!isU32(obj.intervalDays) || !isU32(obj.reps))
        return null;
    if (obj.dueAt !== undefined && typeof obj.dueAt !== 'string')
        return null;
    const entry = { at: obj.at, kind: obj.kind };
    if (typeof obj.intervalDays === 'number')
        entry.intervalDays = obj.intervalDays;
    if (typeof obj.dueAt === 'string')
        entry.dueAt = obj.dueAt;
    if (typeof obj.reps === 'number')
        entry.reps = obj.reps;
    return entry;
}
/** 严格解析：缺字段给默认，类型不对整份算坏（半份好记录不留） */
export function parseRecord(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const obj = raw;
    if (!isU32(obj.version) || !isU32(obj.intervalDays) || !isU32(obj.reps) || !isU64(obj.updatedMs))
        return null;
    if (typeof obj.firstLearnedAt !== 'string')
        return null;
    if (obj.lastReviewedAt !== undefined && typeof obj.lastReviewedAt !== 'string')
        return null;
    if (obj.dueAt !== undefined && typeof obj.dueAt !== 'string')
        return null;
    if (obj.status !== undefined && typeof obj.status !== 'string')
        return null;
    const history = [];
    if (obj.history !== undefined) {
        if (!Array.isArray(obj.history))
            return null;
        for (const item of obj.history) {
            const entry = parseHistoryEntry(item);
            if (entry === null)
                return null;
            history.push(entry);
        }
    }
    const rec = {
        // 与另一端 read_record_file 同口径：version 归 1、间隔 0 归 1、非 done 归 active
        version: 1,
        firstLearnedAt: obj.firstLearnedAt,
        intervalDays: typeof obj.intervalDays === 'number' && obj.intervalDays > 0 ? obj.intervalDays : 1,
        reps: typeof obj.reps === 'number' ? obj.reps : 0,
        status: obj.status === 'done' ? 'done' : 'active',
        history,
        updatedMs: typeof obj.updatedMs === 'number' ? obj.updatedMs : 0,
    };
    if (typeof obj.lastReviewedAt === 'string')
        rec.lastReviewedAt = obj.lastReviewedAt;
    if (typeof obj.dueAt === 'string')
        rec.dueAt = obj.dueAt;
    return rec;
}
/** 序列化：字段顺序与可选字段的落盘形态固定（两端写出来的字节尽量一致）；
 *  可选字段没值就不带键（与 serde 的 skip_serializing_if 同形） */
export function serializeRecord(rec) {
    const out = { version: 1, firstLearnedAt: rec.firstLearnedAt };
    if (rec.lastReviewedAt !== undefined)
        out.lastReviewedAt = rec.lastReviewedAt;
    if (rec.dueAt !== undefined)
        out.dueAt = rec.dueAt;
    out.intervalDays = rec.intervalDays;
    out.reps = rec.reps;
    out.status = rec.status;
    out.history = rec.history.map((h) => {
        const entry = { at: h.at, kind: h.kind };
        if (h.intervalDays !== undefined)
            entry.intervalDays = h.intervalDays;
        if (h.dueAt !== undefined)
            entry.dueAt = h.dueAt;
        if (h.reps !== undefined)
            entry.reps = h.reps;
        return entry;
    });
    out.updatedMs = rec.updatedMs;
    return JSON.stringify(out, null, 2);
}
function readRecordFile(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    const rec = parseRecord(text);
    if (rec === null) {
        // 解析不动 = 整份挪 .bak 留证再当无记录——直接当无记录的话，下一次学习就把
        // 整条进度覆盖掉，坏在哪、丢了什么全查不出来
        try {
            fs.renameSync(file, file + '.bak');
        }
        catch {
            /* 收不走就留着原文件 */
        }
        kitWarn('学习记录解析失败，已挪到 ' + file + '.bak');
        return null;
    }
    return rec;
}
function readRecord(root, rel) {
    return readRecordFile(studyPath(root, rel));
}
function writeRecord(root, rel, rec) {
    writeAtomic(studyPath(root, rel), serializeRecord(rec));
}
function pushHistory(rec, entry) {
    rec.history.push(entry);
    if (rec.history.length > MAX_HISTORY)
        rec.history.splice(0, rec.history.length - MAX_HISTORY);
}
// ── 间隔 ────────────────────────────────────────────────────────────────────
/** 默认下一档：表里第一个比当前间隔大的值；到顶就停在最后一档。
 *  当前间隔可以是自定义值（比如 10），所以不能按数组下标算。 */
export function nextLadder(current) {
    for (const d of LADDER) {
        if (d > current)
            return d;
    }
    return LADDER[LADDER.length - 1] ?? 120;
}
function clampInterval(v) {
    return Math.min(Math.max(Math.trunc(v), 1), MAX_INTERVAL);
}
// ── 集合 / 最近知识集 ───────────────────────────────────────────────────────
/** 页面最近的祖先知识集（逐级向上找含 .refs.json 的目录；库根不给设知识集） */
export function nearestSet(root, rel) {
    let dir = dirOf(rel);
    for (;;) {
        if (dir !== '' && fs.statSync(path.join(root, ...dir.split('/'), '.refs.json'), { throwIfNoEntry: false })?.isFile() === true) {
            return dir;
        }
        if (dir === '')
            return undefined;
        dir = dirOf(dir);
    }
}
function stateFor(root, rel, rec) {
    const state = { rel, name: nameOf(rel), record: rec };
    const set = nearestSet(root, rel);
    if (set !== undefined)
        state.set = set;
    return state;
}
/** 记录文件名是不是一条记录：.json 结尾，且不是冲突副本 / 备份 / 写盘中间件 */
function isRecordFile(name) {
    return name.endsWith(RECORD_SUFFIX) && !name.includes(CONFLICT_MARK) && !name.endsWith('.json.bak') && !name.endsWith('.json.tmp');
}
/** 范围走查要跳过的目录：约定目录（scanner 同款）+ 任意深度的 library（资料库子树里的
 *  md 是文献不是页面；与 quiz 的范围汇总同口径） */
function skipDir(name) {
    return name.startsWith('.') || SKIP_DIRS.has(name) || name === 'library';
}
function collect(root, dir, prefix, out) {
    const studyDir = path.join(dir, STUDY_DIR);
    let entries = [];
    try {
        entries = fs.readdirSync(studyDir, { withFileTypes: true });
    }
    catch {
        entries = [];
    }
    for (const e of entries) {
        if (!e.isFile() || !isRecordFile(e.name))
            continue;
        const stem = e.name.slice(0, -RECORD_SUFFIX.length);
        // 空 stem（.study/.json）的 rel 会带尾斜杠，写路径的守卫又把尾斜杠裁掉——
        // 同一页的记录会落到两个文件。异常产物，不收
        if (stem === '')
            continue;
        const rel = prefix === '' ? stem : prefix + '/' + stem;
        // 页面已被外部删掉 / 移走的记录不收（记录跟页面走，页面不在就没有意义）
        if (!pageExists(root, rel))
            continue;
        const rec = readRecordFile(path.join(studyDir, e.name));
        if (rec !== null)
            out.push(stateFor(root, rel, rec));
    }
    let dirs = [];
    try {
        dirs = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of dirs) {
        if (!e.isDirectory())
            continue;
        if (skipDir(e.name))
            continue;
        collect(root, path.join(dir, e.name), prefix === '' ? e.name : prefix + '/' + e.name, out);
    }
}
/** 排序：到期日在前（没有 due 的排最后），同一天按 rel */
function sortStates(items) {
    return items.sort((a, b) => {
        const ad = a.record.dueAt ?? '9999-99-99';
        const bd = b.record.dueAt ?? '9999-99-99';
        return ad === bd ? (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0) : ad < bd ? -1 : 1;
    });
}
// ── 读 ──────────────────────────────────────────────────────────────────────
/** 一页的记录；没标记过 / 坏文件 = null。rel 非法抛错（读端点回 400） */
export function get(root, rel) {
    const r = requirePageRel(rel);
    const rec = readRecord(root, r);
    return rec === null ? null : stateFor(root, r, rec);
}
/** 范围内（dir 递归；空 = 整库）的全部记录：学习集面板用 */
export function scope(root, dir) {
    let d;
    try {
        d = safeStudyRel(dir);
    }
    catch {
        return [];
    }
    const out = [];
    collect(root, scopeAbs(root, d), d, out);
    return sortStates(out);
}
/** 在学记录（dir 递归；空 = 整库）：启动时对齐复习待办、学习集面板用。
 *  排序按到期日、再按路径。 */
export function listActive(root, dir) {
    const items = scope(root, dir);
    return items.filter((s) => s.record.status === 'active' && s.record.dueAt !== undefined);
}
// ── 动作 ────────────────────────────────────────────────────────────────────
/** 首次学习：建记录，明天开始第一次复习 */
export function first(root, rel) {
    const r = requirePageRel(rel);
    if (!pageExists(root, r))
        throw new Error('页面不存在');
    if (readRecord(root, r) !== null)
        throw new Error('这一页已经在学习');
    const today = todayStr();
    const due = addDays(today, 1);
    const rec = {
        version: 1,
        firstLearnedAt: today,
        dueAt: due,
        intervalDays: 1,
        reps: 0,
        status: 'active',
        history: [{ at: today, kind: 'first', intervalDays: 1, dueAt: due, reps: 0 }],
        updatedMs: nowMs(),
    };
    writeRecord(root, r, rec);
    return stateFor(root, r, rec);
}
/** 完成本次复习。nextInterval 为空 = 按默认表往上一档；给了就按给的值（自定义）。
 *  只重置间隔，次数继续累计。 */
export function complete(root, rel, nextInterval) {
    const r = requirePageRel(rel);
    const rec = readRecord(root, r);
    if (rec === null)
        throw new Error('还没有标记学习');
    if (rec.status === 'done')
        throw new Error('这一页已完成，先重启复习');
    const today = todayStr();
    const next = nextInterval === undefined ? nextLadder(rec.intervalDays) : clampInterval(nextInterval);
    const due = addDays(today, next);
    rec.reps = Math.min(rec.reps + 1, 0xffffffff);
    rec.lastReviewedAt = today;
    rec.intervalDays = next;
    rec.dueAt = due;
    rec.status = 'active';
    rec.updatedMs = nowMs();
    pushHistory(rec, { at: today, kind: 'review', intervalDays: next, dueAt: due, reps: rec.reps });
    writeRecord(root, r, rec);
    return stateFor(root, r, rec);
}
/** 只改下一次间隔（不算一次复习，次数不变） */
export function adjust(root, rel, nextInterval) {
    const r = requirePageRel(rel);
    const rec = readRecord(root, r);
    if (rec === null)
        throw new Error('还没有标记学习');
    if (rec.status === 'done')
        throw new Error('这一页已完成，先重启复习');
    const today = todayStr();
    const next = clampInterval(nextInterval);
    const due = addDays(today, next);
    rec.intervalDays = next;
    rec.dueAt = due;
    rec.updatedMs = nowMs();
    pushHistory(rec, { at: today, kind: 'adjust', intervalDays: next, dueAt: due, reps: rec.reps });
    writeRecord(root, r, rec);
    return stateFor(root, r, rec);
}
/** 完成这一轮：不再排下一次，记录保留，可重启 */
export function finish(root, rel) {
    const r = requirePageRel(rel);
    const rec = readRecord(root, r);
    if (rec === null)
        throw new Error('还没有标记学习');
    const today = todayStr();
    rec.status = 'done';
    delete rec.dueAt;
    rec.updatedMs = nowMs();
    pushHistory(rec, { at: today, kind: 'done', reps: rec.reps });
    writeRecord(root, r, rec);
    return stateFor(root, r, rec);
}
/** 重启已完成的复习。mode = first（按第一次，1 天）/ last（接着上次的间隔）；
 *  nextInterval 给了就优先用（自定义）。次数与历史继续累计。 */
export function restart(root, rel, mode, nextInterval) {
    const r = requirePageRel(rel);
    const rec = readRecord(root, r);
    if (rec === null)
        throw new Error('还没有标记学习');
    const today = todayStr();
    const next = nextInterval !== undefined
        ? clampInterval(nextInterval)
        : mode === 'last'
            ? clampInterval(rec.intervalDays)
            : 1;
    const due = addDays(today, next);
    rec.status = 'active';
    rec.dueAt = due;
    rec.intervalDays = next;
    rec.updatedMs = nowMs();
    pushHistory(rec, { at: today, kind: 'restart', intervalDays: next, dueAt: due, reps: rec.reps });
    writeRecord(root, r, rec);
    return stateFor(root, r, rec);
}
/** 移出学习：删记录（正常不用；停复习走 finish） */
export function remove(root, rel) {
    const r = requirePageRel(rel);
    const file = studyPath(root, r);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile() !== true)
        return false;
    try {
        fs.rmSync(file);
    }
    catch (error) {
        throw new Error('删除学习记录失败：' + messageOf(error));
    }
    try {
        fs.rmdirSync(path.dirname(file));
    }
    catch {
        /* 还有别的页的记录，留着 */
    }
    return true;
}
// ── 日志 ────────────────────────────────────────────────────────────────────
let warnFn = null;
/** 组件装配时注入 logger（core/log 的 kitLogger）——本模块保持零宿主依赖可单测 */
export function setStudyWarn(fn) {
    warnFn = fn;
}
function kitWarn(msg) {
    if (warnFn !== null)
        warnFn(msg);
}
