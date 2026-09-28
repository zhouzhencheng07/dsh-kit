// 技能池的版本记录：每个池技能一个独立 git 仓库 + 变更 watcher 自动提交 + 回滚。
//
// 为什么只给池里的技能做：池是跨工作区共用的**本体**，一次坏改动（agent 或手滑）会同时
// 影响所有挂载它的工作区，必须能看清"改了什么、什么时候"并退回去；工作区/用户级的技能
// 归各自的仓库或用户自己管，本模块不碰。
//
// 边界与契约：
//   - 仓库必须是技能目录**自己**的仓库（rev-parse --show-toplevel 就等于该目录），否则
//     说明它落在某个外层仓库里，此时按"未初始化"新建嵌套仓库——自动提交绝不能
//     替外层仓库提交别人的代码。
//   - 身份与开关只写进该技能仓库自己的 .git/config（dsh-kit / dsh-kit@localhost、
//     关闭签名与自动 gc），绝不动用户全局 git 配置，也不要求用户配过 user.name。
//   - 只有内容真变了才提交（status --porcelain 判空）；提交撞上并发的 index.lock 时
//     重试几次——用户自己的 git 命令不会因此丢失内容。
//   - 回滚 = 把工作树恢复成某次提交的样子**再记一条新提交**：历史不重写，回滚本身
//     也因此可回滚。回滚前先把未提交的改动落盘（不然那部分改动就白改了）。
//   - watcher 只在池根存在时挂得上；池根不存在时不做实时提交，池内的写入类操作
//     （复制/移动进池、禁用）会主动提交一次兜底。
import fs from 'node:fs';
import path from 'node:path';
import { gitAvailable, runGit } from "./git.js";
const LOG_LIMIT = 30;
const DEBOUNCE_MS = 1200;
const SUBJECT_SYNC = 'auto: 同步技能内容';
const SUBJECT_INIT = 'auto: 初始记录';
/** 撞 index.lock 时的重试间隔（用户自己的 git 命令通常几百毫秒内就结束） */
const LOCK_RETRY_MS = [400, 1200, 2500];
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 只重试"索引被占用"这一类；其余失败（权限、磁盘、钩子）重试也没用 */
function isLockError(text) {
    return /index\.lock|unable to create|another git process/i.test(text);
}
function lastLine(text) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '');
    return lines[lines.length - 1] ?? '';
}
function realOrNull(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return null;
    }
}
function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
/** 目录型技能（池里的平铺 .md 不建仓——单文件没有目录可以放 .git） */
function isSkillDir(p) {
    return isDir(p) && fs.existsSync(path.join(p, 'SKILL.md'));
}
function normalize(p) {
    return p.split(path.sep).join('/').replace(/\/+$/, '');
}
/** 技能目录是不是"自己的"仓库根（落在外层仓库里的不算，见文件头边界） */
async function isOwnRepo(skillDir) {
    if (realOrNull(path.join(skillDir, '.git')) === null)
        return false;
    const top = await runGit(['rev-parse', '--show-toplevel'], skillDir);
    if (!top.ok)
        return false;
    const here = realOrNull(skillDir);
    return here !== null && realOrNull(top.out.trim()) === here;
}
async function ensureRepo(skillDir) {
    if (!isDir(skillDir))
        return { ok: false, reason: 'not-a-dir' };
    if (!(await gitAvailable()))
        return { ok: false, reason: 'no-git' };
    if (await isOwnRepo(skillDir))
        return { ok: true };
    const init = await runGit(['-c', 'init.defaultBranch=main', 'init', '-q'], skillDir);
    if (!init.ok)
        return { ok: false, reason: 'init-failed', error: init.err.trim() || 'git init 失败' };
    // 身份与签名开关只落本仓库（user.useConfigOnly 之类的全局策略也不影响）
    for (const [key, value] of [
        ['user.name', 'dsh-kit'],
        ['user.email', 'dsh-kit@localhost'],
        ['commit.gpgsign', 'false'],
        ['gc.auto', '0'],
    ]) {
        await runGit(['config', '--local', key, value], skillDir);
    }
    return { ok: true };
}
/** status --porcelain 解析：状态码两列 + 路径（重命名取新名，带引号则去引号） */
function parseStatus(out) {
    const names = [];
    for (const line of out.split(/\r?\n/)) {
        if (line.trim() === '')
            continue;
        let name = line.slice(3).trim();
        if (name.includes(' -> '))
            name = name.slice(name.lastIndexOf(' -> ') + 4);
        if (name.startsWith('"') && name.endsWith('"') && name.length >= 2)
            name = name.slice(1, -1);
        names.push(name);
    }
    return names;
}
/** log 解析：\x01 起一条记录，首行 sha/时间/主题，随后是 numstat */
function parseLog(out) {
    const commits = [];
    for (const chunk of out.split('\u0001')) {
        const text = chunk.replace(/^\s+/, '');
        if (text === '')
            continue;
        const lines = text.split(/\r?\n/);
        const head = lines[0].split('\u001f');
        const sha = head[0] ?? '';
        if (!/^[0-9a-f]{7,40}$/i.test(sha))
            continue;
        let files = 0;
        let insertions = 0;
        let deletions = 0;
        const names = [];
        for (const row of lines.slice(1)) {
            const cols = row.split('\t');
            if (cols.length < 3)
                continue;
            files++;
            if (cols[0] !== '-')
                insertions += Number(cols[0]) || 0;
            if (cols[1] !== '-')
                deletions += Number(cols[1]) || 0;
            names.push(cols.slice(2).join('\t').trim());
        }
        commits.push({
            sha,
            short: sha.slice(0, 7),
            time: Number(head[1]) || 0,
            subject: (head[2] ?? '').trim(),
            files,
            insertions,
            deletions,
            names,
        });
    }
    return commits;
}
async function readLog(skillDir) {
    const log = await runGit(['-c', 'core.quotepath=false', 'log', `-n${LOG_LIMIT}`, '--numstat', '--pretty=format:\u0001%H\u001f%at\u001f%s'], skillDir);
    return log.ok ? parseLog(log.out) : [];
}
// ── 每个技能一把锁：watcher、面板操作、池内写入兜底三条路都可能同时要提交 ──
const chains = new Map();
function withSkillLock(skillDir, job) {
    const key = normalize(skillDir);
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    chains.set(key, next.catch(() => undefined));
    return next;
}
/** 提交当前内容；无改动则什么都不做（返回 committed:false） */
async function commitLocked(skillDir, subject) {
    const ready = await ensureRepo(skillDir);
    if (!ready.ok)
        return { ok: false, committed: false, error: ready.error ?? ready.reason ?? '仓库不可用' };
    let last = '';
    // add 与 commit 都要进重试：并发的 index.lock 会让 `git add` 先失败，
    // 此时索引里没有内容，再 commit 只会得到"nothing to commit"
    for (let attempt = 0; attempt <= LOCK_RETRY_MS.length; attempt++) {
        if (attempt > 0)
            await sleep(LOCK_RETRY_MS[attempt - 1] ?? 2500);
        const add = await runGit(['add', '-A'], skillDir);
        if (!add.ok) {
            last = lastLine(add.err || add.out);
            if (!isLockError(add.err))
                break;
            continue;
        }
        const status = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain'], skillDir);
        if (!status.ok)
            return { ok: false, committed: false, error: lastLine(status.err) || 'git status 失败' };
        const names = parseStatus(status.out);
        if (names.length === 0)
            return { ok: true, committed: false };
        const head = names.slice(0, 20).join('\n');
        const body = names.length > 20 ? `${head}\n…（共 ${names.length} 个文件）` : head;
        const commit = await runGit(['commit', '-q', '-m', subject, '-m', body], skillDir);
        if (commit.ok)
            return { ok: true, committed: true };
        last = lastLine(commit.err || commit.out);
        if (!isLockError(commit.err))
            break;
    }
    return { ok: false, committed: false, error: last || 'git commit 失败' };
}
/** 外部编辑那条路（watcher）上次提交失败的说明 */
const watchErrors = new Map();
function recordWatch(dir, error) {
    if (error === null)
        watchErrors.delete(normalize(dir));
    else
        watchErrors.set(normalize(dir), error);
}
function watchErrorOf(dir) {
    return watchErrors.get(normalize(dir));
}
/** 还没有 HEAD 就是第一次记录，主题用「初始记录」 */
async function subjectFor(skillDir) {
    const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], skillDir);
    return head.ok ? SUBJECT_SYNC : SUBJECT_INIT;
}
/** 立刻提交（面板「立即提交」与池内写入类操作的兜底；无改动返回 committed:false） */
export function poolGitCommitNow(skillDir) {
    return withSkillLock(skillDir, async () => commitLocked(skillDir, await subjectFor(skillDir)));
}
/**
 * 读版本状态：只建仓（不建仓就永远看不到历史），**不顺手提交**——读路径不产生提交，
 * 面板上的"未提交改动"才是真的事实。提交由 watcher 与池内写入类操作负责。
 */
export async function poolGitState(skillDir) {
    const empty = { available: true, init: false, dirty: 0, dirtyNames: [], last: null, commits: [] };
    if (!isDir(skillDir))
        return { ...empty, reason: 'not-a-dir' };
    if (!(await gitAvailable()))
        return { ...empty, available: false, reason: 'no-git' };
    const ready = await withSkillLock(skillDir, () => ensureRepo(skillDir));
    if (!ready.ok) {
        return { ...empty, reason: ready.reason ?? 'init-failed', ...(ready.error !== undefined ? { error: ready.error } : {}) };
    }
    const commits = await readLog(skillDir);
    const status = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain'], skillDir);
    const dirtyNames = status.ok ? parseStatus(status.out) : [];
    const head = commits[0];
    const watchError = watchErrorOf(skillDir);
    return {
        available: true,
        init: true,
        dirty: dirtyNames.length,
        dirtyNames,
        last: head ? { sha: head.sha, short: head.short, time: head.time, subject: head.subject } : null,
        commits,
        ...(watchError !== undefined ? { watchError } : {}),
    };
}
/** 回滚到某次提交：先把未提交改动落盘，再整树恢复，最后记一条新提交 */
export async function poolGitRollback(skillDir, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha))
        return { ok: false, changed: false, error: '提交号非法' };
    if (!isDir(skillDir))
        return { ok: false, changed: false, error: '技能目录不存在' };
    return withSkillLock(skillDir, async () => {
        const ready = await ensureRepo(skillDir);
        if (!ready.ok)
            return { ok: false, changed: false, error: ready.error ?? '仓库不可用' };
        const flush = await commitLocked(skillDir, SUBJECT_SYNC);
        if (!flush.ok)
            return { ok: false, changed: false, error: flush.error ?? '先把当前改动落盘失败' };
        const head = await runGit(['rev-parse', 'HEAD'], skillDir);
        const target = await runGit(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], skillDir);
        if (!target.ok)
            return { ok: false, changed: false, error: '找不到这次提交' };
        if (head.ok && head.out.trim() === target.out.trim())
            return { ok: true, changed: false };
        // read-tree --reset -u：索引与工作树一起恢复成目标树（多出来的文件会被删掉）
        const tree = await runGit(['read-tree', '--reset', '-u', target.out.trim()], skillDir);
        if (!tree.ok)
            return { ok: false, changed: false, error: tree.err.trim() || 'git read-tree 失败' };
        const commit = await commitLocked(skillDir, `auto: 回滚到 ${target.out.trim().slice(0, 7)}`);
        if (!commit.ok)
            return { ok: false, changed: true, error: commit.error ?? '回滚后的提交失败' };
        return { ok: true, changed: commit.committed };
    });
}
// ── watcher：池技能的外部改动（agent 经链接写、外部编辑器）自动提交 ──
export function startPoolGitWatcher(poolDir) {
    let stopped = false;
    const timers = new Map();
    /** 把一个池技能当前内容记一版（建仓 + 无改动则跳过）；失败只记下来给面板看 */
    const flush = (skillDir) => withSkillLock(skillDir, async () => {
        const ready = await ensureRepo(skillDir);
        if (!ready.ok) {
            if (ready.reason !== 'not-a-dir')
                recordWatch(skillDir, ready.error ?? '仓库不可用');
            return;
        }
        const result = await commitLocked(skillDir, await subjectFor(skillDir));
        recordWatch(skillDir, result.ok ? null : (result.error ?? '提交失败'));
    });
    const soon = (skillDir, delay) => {
        const prev = timers.get(skillDir);
        if (prev !== undefined)
            clearTimeout(prev);
        const timer = setTimeout(() => {
            timers.delete(skillDir);
            if (stopped)
                return;
            void flush(skillDir);
        }, delay);
        timers.set(skillDir, timer);
    };
    const poolSkills = () => {
        let dirents = [];
        try {
            dirents = fs.readdirSync(poolDir, { withFileTypes: true });
        }
        catch {
            return [];
        }
        const out = [];
        for (const ent of dirents) {
            if (ent.name.startsWith('.'))
                continue;
            const full = path.join(poolDir, ent.name);
            if (isSkillDir(full))
                out.push(full);
        }
        return out;
    };
    let watcher = null;
    try {
        // recursive 在 win32/darwin 与 Node 20+ 的 linux 上可用
        watcher = fs.watch(poolDir, { recursive: true }, (_event, filename) => {
            const rel = typeof filename === 'string' ? filename : '';
            const segments = rel.split(/[\\/]/);
            const name = segments[0];
            // 自己的 .git 写入也会触发事件：必须忽略，否则提交动作会自我循环
            if (name === undefined || name === '' || name.startsWith('.') || segments.includes('.git'))
                return;
            const skillDir = path.join(poolDir, name);
            if (!isSkillDir(skillDir))
                return;
            soon(skillDir, DEBOUNCE_MS);
        });
        watcher.on('error', (error) => {
            console.warn('[dsh-kit] 技能池版本 watcher 出错：' + (error instanceof Error ? error.message : error));
        });
    }
    catch {
        // 池根不存在（或平台不支持 recursive）：只做下面那次启动补齐，之后靠写入类操作兜底
    }
    // 启动补齐：已有池技能建仓 + 记下当前内容。逐个来——开机同时起几十个 git 没必要
    void (async () => {
        for (const skillDir of poolSkills()) {
            if (stopped)
                return;
            await flush(skillDir);
        }
    })();
    return () => {
        stopped = true;
        for (const timer of timers.values())
            clearTimeout(timer);
        timers.clear();
        try {
            watcher?.close();
        }
        catch { }
    };
}
