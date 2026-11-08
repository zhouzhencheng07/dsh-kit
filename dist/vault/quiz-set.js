// 题集半边：把任意页面的题临时攒成一组，用来考前冲刺。
// 与页面掌握度完全独立——题集有自己的进度（存在题集文件里），删题集不影响页面里的题与
// 掌握度；题集里的掌握度按「连续答对」即时累计，不套页面那条「一天最多涨一次」的限制
// （短期刷题就是要连着刷）。
//
// 数据：<库根>/.quiz-state/sets/<id>.json（与桌面端同一份，跨端契约不得单端改语义）。
// 进度键 = "rel|题目 id"——不同页面可能有同内容的题（id 是内容哈希，会撞）。
// 题跟着页面走：页面删了 / 题改了，对应进度成为「失效」，摘要里报数、不静默丢。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readPage, readScope, readSettings } from "./quiz.js";
const STATE_DIR = '.quiz-state';
const SETS_DIR = 'sets';
/** 名字上限（按字符数，与桌面端 chars().count() 同口径） */
const MAX_NAME = 40;
const MAX_PAGES = 500;
/** id 直接当文件名：只认字母数字与 - _ */
const ID_RE = /^[A-Za-z0-9_-]+$/;
const nowMs = () => Date.now();
const isU32 = (v) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
const isU64 = (v) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER);
function setsDir(root) {
    return path.join(root, STATE_DIR, SETS_DIR);
}
/** 题集 id → 文件绝对路径（id 不合法回 null） */
function setPath(root, id) {
    const v = id.trim();
    if (v === '' || !ID_RE.test(v))
        return null;
    return path.join(setsDir(root), `${v}.json`);
}
/** 题集里一道题的键：页面 rel + 题目 id */
export function keyOf(rel, qid) {
    return `${rel}|${qid}`;
}
function relOfKey(key) {
    const at = key.lastIndexOf('|');
    return at < 0 ? '' : key.slice(0, at);
}
// ── 解析 / 落盘 ─────────────────────────────────────────────────────────────
/** 严格度与桌面端 serde 对齐：出现的字段类型不对整份算坏（题目自己坏只影响那一题）。 */
function parseSet(text) {
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
    if (!isU32(obj.version) || !isU64(obj.updatedMs))
        return null;
    if (obj.id !== undefined && typeof obj.id !== 'string')
        return null;
    if (obj.name !== undefined && typeof obj.name !== 'string')
        return null;
    if (obj.pages !== undefined && (!Array.isArray(obj.pages) || obj.pages.some((p) => typeof p !== 'string')))
        return null;
    const out = {
        version: typeof obj.version === 'number' ? obj.version : 1,
        id: typeof obj.id === 'string' ? obj.id : '',
        name: typeof obj.name === 'string' ? obj.name : '',
        pages: obj.pages === undefined ? [] : obj.pages,
        progress: {},
        updatedMs: typeof obj.updatedMs === 'number' ? obj.updatedMs : 0,
    };
    if (obj.progress !== undefined) {
        if (obj.progress === null || typeof obj.progress !== 'object' || Array.isArray(obj.progress))
            return null;
        for (const [key, rec] of Object.entries(obj.progress)) {
            if (rec === null || typeof rec !== 'object' || Array.isArray(rec))
                return null;
            const r = rec;
            if (!isU32(r.streak) || !isU64(r.updatedMs))
                return null;
            if (r.mastered !== undefined && typeof r.mastered !== 'boolean')
                return null;
            if (r.lastDay !== undefined && typeof r.lastDay !== 'string')
                return null;
            const item = {
                streak: typeof r.streak === 'number' ? r.streak : 0,
                mastered: r.mastered === true,
                updatedMs: typeof r.updatedMs === 'number' ? r.updatedMs : 0,
            };
            if (typeof r.lastDay === 'string' && r.lastDay !== '')
                item.lastDay = r.lastDay;
            out.progress[key] = item;
        }
    }
    return out;
}
/** 原子写（tmp + rename）：同步与界面可能同时读到，别留半截文件。tmp 名带 pid + 随机
 *  尾巴——固定名在两端 / 同步客户端同时写同一份文件时会互踩。 */
function writeAtomic(target, text) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
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
        throw error;
    }
}
/** 进度表按键排序后重排——落盘字节确定（另一端 / 下一轮读回都对得上） */
function sortedProgress(progress) {
    const out = {};
    for (const key of Object.keys(progress).sort()) {
        const rec = progress[key];
        if (rec !== undefined)
            out[key] = rec;
    }
    return out;
}
function readSetFile(root, id) {
    const file = setPath(root, id);
    if (file === null)
        return null;
    try {
        return parseSet(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function writeSet(root, f) {
    const file = setPath(root, f.id);
    if (file === null)
        throw new Error('题集 id 不合法');
    writeAtomic(file, JSON.stringify({ ...f, progress: sortedProgress(f.progress) }, null, 2));
}
// ── 摘要 / 列表 / 范围 ──────────────────────────────────────────────────────
/** 这道题界面答得了吗（与前端 isAnswerable 同口径） */
function answerable(q) {
    if (q.type === 'single' || q.type === 'multi') {
        return (q.options?.length ?? 0) > 0 && typeof q.answer === 'string' && q.answer.trim() !== '';
    }
    if (q.type === 'judge')
        return typeof q.answer === 'boolean';
    if (q.type === 'blank')
        return Array.isArray(q.answer) && q.answer.length > 0;
    return false;
}
/** 摘要：现读一遍集里的页（题数、已掌握、失效进度） */
function summarize(root, f) {
    let total = 0;
    let mastered = 0;
    const live = new Set();
    for (const rel of f.pages) {
        const page = readPage(root, rel);
        for (const q of page.questions) {
            if (!answerable(q))
                continue;
            total += 1;
            const key = keyOf(rel, q.id);
            live.add(key);
            if (f.progress[key]?.mastered === true)
                mastered += 1;
        }
    }
    let invalid = 0;
    for (const key of Object.keys(f.progress))
        if (!live.has(key))
            invalid += 1;
    return { id: f.id, name: f.name, pages: f.pages.slice(), total, mastered, invalid, updatedMs: f.updatedMs };
}
/** 全部题集（按最近改动倒序）：坏文件跳过，不挡住整张列表 */
export function listSets(root) {
    const out = [];
    let entries = [];
    try {
        entries = fs.readdirSync(setsDir(root), { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const e of entries) {
        if (!e.isFile() || path.extname(e.name) !== '.json')
            continue;
        let text;
        try {
            text = fs.readFileSync(path.join(setsDir(root), e.name), 'utf8');
        }
        catch {
            continue;
        }
        const f = parseSet(text);
        if (f === null || f.id === '')
            continue;
        out.push(summarize(root, f));
    }
    out.sort((a, b) => b.updatedMs - a.updatedMs);
    return out;
}
/** 开一个题集：集里的页 + 题目 + 这套进度 + 阈值 */
export function readSetScope(root, id) {
    const f = readSetFile(root, id);
    if (f === null)
        throw new Error('题集不存在');
    return {
        set: summarize(root, f),
        pages: f.pages.map((rel) => readPage(root, rel)),
        progress: f.progress,
        threshold: readSettings(root).threshold,
    };
}
// ── 写路径 ──────────────────────────────────────────────────────────────────
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
/** 新建（id 为空）或改名 / 换页（id 给了）。换页时把不在集里的页的进度清掉。 */
export function saveSet(root, id, name, pages) {
    const setName = trimmed(name);
    if (setName === '')
        throw new Error('题集要有名字');
    if (Array.from(setName).length > MAX_NAME)
        throw new Error(`名字最多 ${MAX_NAME} 个字`);
    if (!Array.isArray(pages) || pages.some((p) => typeof p !== 'string'))
        throw new Error('pages 必须是页面路径数组');
    const keep = pages.map((p) => p.trim()).filter((p) => p !== '');
    if (keep.length === 0)
        throw new Error('题集里至少要有一页');
    if (keep.length > MAX_PAGES)
        throw new Error(`一集最多 ${MAX_PAGES} 页`);
    const existing = id === null || id === '' ? null : readSetFile(root, id);
    const f = existing ?? { version: 1, id: String(nowMs()), name: '', pages: [], progress: {}, updatedMs: 0 };
    for (const key of Object.keys(f.progress)) {
        const rel = relOfKey(key);
        if (!keep.includes(rel))
            delete f.progress[key];
    }
    f.name = setName;
    f.pages = keep;
    f.updatedMs = nowMs();
    writeSet(root, f);
    return summarize(root, f);
}
export function deleteSet(root, id) {
    const file = setPath(root, id);
    if (file === null)
        throw new Error('题集 id 不合法');
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile())
        throw new Error('题集不存在');
    fs.rmSync(file, { force: true });
}
/** 清空掌握度（题集本身保留） */
export function clearSet(root, id) {
    const f = readSetFile(root, id);
    if (f === null)
        throw new Error('题集不存在');
    f.progress = {};
    f.updatedMs = nowMs();
    writeSet(root, f);
    return summarize(root, f);
}
/** 记一次作答（题集里没有「一天一次」的限制：短期刷题就是要连着刷） */
export function recordSetAnswer(root, id, rel, qid, correct) {
    const f = readSetFile(root, id);
    if (f === null)
        throw new Error('题集不存在');
    const threshold = readSettings(root).threshold;
    const pageRel = trimmed(rel);
    const questionId = trimmed(qid);
    if (pageRel === '' || questionId === '')
        throw new Error('缺少页面或题目');
    const key = keyOf(pageRel, questionId);
    let newly = false;
    const entry = f.progress[key] ?? { streak: 0, mastered: false, updatedMs: 0 };
    if (correct) {
        entry.streak = Math.min(entry.streak + 1, 0xffffffff);
        if (entry.streak >= threshold && !entry.mastered) {
            entry.mastered = true;
            newly = true;
        }
    }
    else {
        entry.streak = 0;
        entry.mastered = false;
    }
    entry.updatedMs = nowMs();
    f.progress[key] = entry;
    f.updatedMs = nowMs();
    writeSet(root, f);
    return { streak: entry.streak, mastered: entry.mastered, newlyMastered: newly, capped: false };
}
/** 有题的页面（新建题集时勾选用）：复用整库范围扫描，只回 rel + 答得了的题数 */
export function pagesWithQuestions(root) {
    return readScope(root, '')
        .pages.map((p) => ({ rel: p.rel, count: p.questions.filter(answerable).length }))
        .filter((p) => p.count > 0);
}
