// vault 文件管理（宿主半边）——树上的新建 / 重命名 / 移动 / 导入 / 删除，正文写入与
// 编辑不在此列（页面内容仍归 agent 文件工具与外部编辑器，文件即接口）。
// 契约：所有路径都是**绝对路径**，必须落在 vault 根内（根自身只允许作为容器）；
// 名字只收单段叶子（拒分隔符、控制字符、Windows 保留名与首尾空白），多级交给
// 各层的父目录参数表达。撞名策略：页与目录三选一（跳过 / 覆盖 / 自动加序号），
// 资料库那一支一律自动加序号（文献没有"覆盖"语义）——序号格式统一 `名字 (2)`，从 2 起。
// 双链改写只发生在**笔记页**（改名换名字、移动换路径），目录整体搬移不改——文件名
// 没变、wikilink 解析结果就不变。删除走回收站（非 Windows 无回收站 API 时直接删）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { recycleDeleteBatch } from "./recycle.js";
export function parseConflict(raw) {
    return raw === 'overwrite' || raw === 'rename' ? raw : 'skip';
}
/** Windows 保留设备名（con.txt 这类同样保留，故只取第一个点之前的部分判） */
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
/** 单段叶子名清洗：返 null 表示非法（不静默改名——面板输入框里改错要看得见）。
 *  拒空、首尾空白、分隔符、控制字符、Windows 非法字符、`.`/`..`、保留设备名 */
export function safeLeaf(raw) {
    if (typeof raw !== 'string')
        return null;
    const name = raw.trim();
    if (name === '' || name !== raw)
        return null;
    if (name === '.' || name === '..')
        return null;
    if (/[/\\]/.test(name))
        return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(name))
        return null;
    if (WIN_RESERVED_NAME.test(name.split('.')[0] ?? ''))
        return null;
    if (name.length > 120)
        return null;
    return name;
}
/** 多级名字（新建用）：逐段过 safeLeaf，空段丢弃；全空返 '' */
export function safeRel(raw, maxSegs = 8) {
    if (typeof raw !== 'string')
        return '';
    const out = [];
    for (const seg of raw.split('/')) {
        if (seg === '')
            continue;
        const clean = safeLeaf(seg);
        if (clean === null)
            return '';
        out.push(clean);
        if (out.length >= maxSegs)
            break;
    }
    return out.join('/');
}
/** 去掉 md 扩展名（页面名的规范形态；.markdown 一并按 md 收） */
export function stripMd(name) {
    return name.replace(/\.(md|markdown)$/i, '');
}
function existsSync(p) {
    try {
        fs.statSync(p);
        return true;
    }
    catch {
        return false;
    }
}
/** 撞名顺序名：`名字 (2)` 起、上限 999；全占返 null。页带扩展名时序号插在扩展名前 */
export function dedupeName(dir, name, exists = existsSync) {
    if (!exists(path.join(dir, name)))
        return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; n < 1000; n++) {
        const cand = `${stem} (${n})${ext}`;
        if (!exists(path.join(dir, cand)))
            return cand;
    }
    return null;
}
/** 绝对路径归一：拒空与任何 `..` 段（只做前缀比较的话 `root\..\x` 能蒙混过关），
 *  再把两端 realpath 后比包含关系——软链与 Windows 8.3 短名会让单头比较落空。
 *  支持「多级下钻」的路径必须从**已存在**的目录里 join（create/move 的落点），
 *  因此父目录 realpath 后拼叶子即可。 */
export function resolveInside(root, raw, opts = {}) {
    const trimmed = String(raw ?? '').trim();
    if (trimmed === '')
        throw new Error('缺少路径');
    // `..` 段必须在**归一前**判：path.resolve 会把它解掉，之后再看已无从发现
    for (const seg of trimmed.split(/[/\\]+/)) {
        if (seg === '..')
            throw new Error(`路径含上跳段：${trimmed}`);
    }
    const resolved = path.resolve(trimmed);
    const rootReal = fs.realpathSync(root);
    let targetReal;
    try {
        targetReal = fs.realpathSync(resolved);
    }
    catch {
        // 不存在：父目录必须存在（创建/移动的落点都要求父目录已在），用 realpath(父) 拼名
        const parentReal = fs.realpathSync(path.dirname(resolved));
        targetReal = path.join(parentReal, path.basename(resolved));
    }
    const rel = path.relative(rootReal, targetReal);
    if (rel === '') {
        if (opts.allowRoot === true)
            return targetReal;
        throw new Error('指向知识库根目录本身');
    }
    if (rel.startsWith('..') || path.isAbsolute(rel))
        throw new Error(`不在知识库内：${trimmed}`);
    return targetReal;
}
/** 路径相对 root 的 `/` 分隔形式（不在 root 内返 null） */
export function relUnderRoot(root, target) {
    const rel = path.relative(root, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel))
        return null;
    return rel.split(path.sep).join('/');
}
/** 资料库根（根下 library/）：不存在返 null */
export function libraryRoot(root) {
    const dir = path.join(root, 'library');
    return existsSync(dir) ? dir : null;
}
/** target 是否落在资料库子树内（含库根自身） */
export function inLibrary(root, target) {
    const lib = libraryRoot(root);
    if (lib === null)
        return false;
    return target === lib || relUnderRoot(lib, target) !== null;
}
/** 路径是不是资料库根本身（改名/移动/删除都要挡住它） */
export function isLibraryRoot(root, target) {
    return libraryRoot(root) === target;
}
/** 链接目标 → 页 rel：rel 全等 > rel 尾段 > 文件名（均不分大小写）；同层并列优先同空间 */
export function resolveWikiRel(pages, target, hostSpace) {
    const t = stripMd(String(target ?? '').trim().replace(/\\/g, '/')).toLowerCase();
    if (t === '')
        return null;
    const base = t.split('/').pop() ?? t;
    const pref = hostSpace === '' ? null : `${hostSpace.toLowerCase()}/`;
    const better = (cand, cur) => {
        if (cur === null)
            return true;
        if (pref === null)
            return false;
        return cand.rel.toLowerCase().startsWith(pref) && !cur.rel.toLowerCase().startsWith(pref);
    };
    let exact = null;
    let suffix = null;
    let byName = null;
    for (const p of pages) {
        const relLower = p.rel.toLowerCase();
        if (relLower === t && better(p, exact))
            exact = p;
        if (t.includes('/') && relLower.endsWith(`/${t}`) && better(p, suffix))
            suffix = p;
        if ((relLower.split('/').pop() ?? relLower) === base && better(p, byName))
            byName = p;
    }
    return (exact ?? suffix ?? byName)?.rel ?? null;
}
/** rel 的最后 n 段（n 超过段数就整段）——移动改写保持原写法的"段数形状" */
export function tailSegments(rel, n) {
    const segs = rel.split('/');
    const take = Math.min(Math.max(1, n), segs.length);
    return segs.slice(segs.length - take).join('/');
}
/** `s` 以 `[[` 开头：解析到 oldRel 才改写，返回（消费的字符数, 改写后的整段）。
 *  锚点 `#锚` 与别名 `|别名`、目标两侧空白原样保留 */
function rewriteOneLink(s, hostSpace, pages, oldRel, mode) {
    const lineEnd = s.indexOf('\n') === -1 ? s.length : s.indexOf('\n');
    let end = -1;
    for (let j = 2; j + 1 < lineEnd; j++) {
        if (s[j] === '[')
            return null; // 链接内部不允许 `[`
        if (s[j] === ']' && s[j + 1] === ']') {
            end = j;
            break;
        }
    }
    if (end === -1)
        return null;
    const inner = s.slice(2, end);
    const cutAt = inner.search(/[#|]/);
    const cut = cutAt === -1 ? inner.length : cutAt;
    const raw = inner.slice(0, cut);
    const lead = raw.length - raw.replace(/^[ \t]+/, '').length;
    const target = raw.trim();
    if (target === '')
        return null;
    if (resolveWikiRel(pages, target, hostSpace) !== oldRel)
        return null;
    let next;
    if (mode.kind === 'name')
        next = mode.name;
    else {
        // 按文件名写的链接：移动后照样解析得到，别把短名改长
        if (!target.includes('/'))
            return null;
        next = tailSegments(mode.rel, target.split('/').length);
    }
    const tail = raw.slice(lead + target.length);
    return { consumed: end + 2, text: `[[${raw.slice(0, lead)}${next}${tail}${inner.slice(cut)}]]` };
}
/** 逐码点扫正文改写引用（围栏代码块与行内代码里的 `[[]]` 不动）；无改写原样返回。
 *  hostSpace = 这份正文所属页的空间（同名页并列时的解析偏好） */
export function rewriteWikiLinks(content, pages, oldRel, mode, hostSpace = '') {
    if (mode.kind === 'name' && mode.name === '')
        return content;
    let out = '';
    let fence = null;
    let inline = null; // 行内代码的反引号长度（null = 不在代码里）
    let atLineStart = true;
    let i = 0;
    while (i < content.length) {
        if (atLineStart) {
            atLineStart = false;
            inline = null;
            const nl = content.indexOf('\n', i);
            const lineEnd = nl === -1 ? content.length : nl;
            const line = content.slice(i, lineEnd);
            const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
            if (marker) {
                const ch = marker[1]?.[0] ?? '`';
                fence = fence === ch ? null : fence === null ? ch : fence;
                out += line;
                i = lineEnd;
                continue;
            }
            if (fence !== null) {
                out += line;
                i = lineEnd;
                continue;
            }
        }
        const codePoint = content.codePointAt(i);
        if (codePoint === undefined)
            break;
        const ch = String.fromCodePoint(codePoint);
        if (ch === '\n') {
            atLineStart = true;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === '`') {
            let run = 0;
            while (content[i + run] === '`')
                run += 1;
            inline = inline === run ? null : inline === null ? run : inline;
            out += '`'.repeat(run);
            i += run;
            continue;
        }
        if (inline === null && content.startsWith('[[', i)) {
            const hit = rewriteOneLink(content.slice(i), hostSpace, pages, oldRel, mode);
            if (hit) {
                out += hit.text;
                i += hit.consumed;
                continue;
            }
        }
        out += ch;
        i += ch.length;
    }
    return out;
}
// ── 文件操作 ────────────────────────────────────────────────────────────────
/** 目录内的落点撞名按策略处理，返回最终 name。覆盖 = 目标先送回收站
 *  （回收站不可用才直删）；跳过 = 什么都不做（调用方据 skipped 回执） */
async function settleConflict(dir, name, conflict) {
    if (!existsSync(path.join(dir, name)))
        return { name, skipped: false };
    if (conflict === 'skip')
        return { name, skipped: true };
    if (conflict === 'overwrite') {
        await discard(path.join(dir, name));
        return { name, skipped: false };
    }
    const next = dedupeName(dir, name);
    if (next === null)
        throw new Error('同名文件太多，无法自动编号');
    return { name: next, skipped: false };
}
/** 覆盖前丢掉目标：优先回收站，失败退回直删 */
async function discard(target) {
    const [gone] = await recycleDeleteBatch([target]);
    if (gone === true)
        return;
    await fs.promises.rm(target, { recursive: true, force: true });
}
/** 新建：kind='dir' 建目录（已存在=幂等成功），否则建空 md 页（已存在回 exists，
 *  不覆盖——名字重了要看得见）。rawName 可带 `/` 多级（中间目录递归建）。 */
export function createEntry(root, dirAbs, rawName, kind) {
    const dir = resolveInside(root, dirAbs, { allowRoot: true });
    if (!fs.statSync(dir).isDirectory())
        throw new Error('落点不是文件夹');
    const rel = safeRel(rawName);
    if (rel === '')
        throw new Error('名称非法或为空');
    const segs = rel.split('/');
    const leaf = segs[segs.length - 1] ?? '';
    const parent = path.join(dir, ...segs.slice(0, -1));
    if (kind === 'dir') {
        fs.mkdirSync(parent, { recursive: true });
        const target = path.join(parent, leaf);
        if (existsSync(target))
            return { path: target, exists: true };
        fs.mkdirSync(target);
        return { path: target };
    }
    fs.mkdirSync(parent, { recursive: true });
    // 页面名去 md 后统一补 .md（`x.md` 与 `x` 落到同一个文件）
    const target = path.join(parent, `${stripMd(leaf)}.md`);
    if (existsSync(target))
        return { path: target, exists: true };
    fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' });
    return { path: target };
}
/** 重命名（只换名字、留原位置）。页统一收成 .md；资料库文件保留原扩展名
 *  （新名自带扩展名则按新名走）。撞名报错（纯大小写改名不算撞名）。
 *  pages = 改名**前**的页面集合：笔记页改名要改写指向它的双链。 */
export function renameEntry(root, targetAbs, rawName, pages = []) {
    const target = resolveInside(root, targetAbs);
    if (isLibraryRoot(root, target))
        throw new Error('资料库根目录不能改名');
    const leaf = safeLeaf(rawName);
    if (leaf === null)
        throw new Error('名称非法或为空');
    const stat = fs.statSync(target);
    const dir = path.dirname(target);
    const before = path.basename(target);
    if (stat.isDirectory()) {
        const next = path.join(dir, leaf);
        if (next === target)
            return { path: target, links: 0 };
        if (existsSync(next) && next.toLowerCase() !== target.toLowerCase())
            throw new Error(`同名文件夹已存在：${leaf}`);
        fs.renameSync(target, next);
        return { path: next, links: 0 };
    }
    if (!inLibrary(root, target) && !/\.(md|markdown)$/i.test(target))
        throw new Error('只允许重命名笔记页、资料或文件夹');
    const finalLeaf = inLibrary(root, target)
        ? leaf.includes('.')
            ? leaf
            : `${leaf}${path.extname(target)}`
        : `${stripMd(leaf)}.md`;
    const next = path.join(dir, finalLeaf);
    if (next === target)
        return { path: target, links: 0 };
    if (existsSync(next) && next.toLowerCase() !== target.toLowerCase())
        throw new Error(`同名文件已存在：${finalLeaf}`);
    const oldRel = relUnderRoot(root, target);
    fs.renameSync(target, next);
    // 资料库里的 md 是文献不是页面，不参与双链
    if (inLibrary(root, target) || oldRel === null)
        return { path: next, links: 0 };
    return { path: next, links: rewriteRefs(pages, stripMd(oldRel), { kind: 'name', name: stripMd(finalLeaf) }, next) };
}
/** 移动（destAbs = 目标目录，必须已存在且落在库内；目录不能进自己的子树）。
 *  已在该目录 = skipped 空操作；页移动按移动**前**的集合改写路径形态的引用。 */
export async function moveEntry(root, targetAbs, destAbs, conflict, pages = []) {
    const target = resolveInside(root, targetAbs);
    const dest = resolveInside(root, destAbs, { allowRoot: true });
    if (isLibraryRoot(root, target))
        throw new Error('资料库根目录不能移动');
    if (!fs.statSync(dest).isDirectory())
        throw new Error('目标不是文件夹');
    const stat = fs.statSync(target);
    if (stat.isDirectory() && (dest === target || relUnderRoot(target, dest) !== null)) {
        throw new Error('不能移动到自己的子目录里');
    }
    const name = path.basename(target);
    if (path.dirname(target) === dest) {
        const rel = relUnderRoot(root, target) ?? name;
        return { path: target, rel: stripMd(rel), name, links: 0, skipped: true };
    }
    const settled = await settleConflict(dest, name, conflict);
    if (settled.skipped) {
        const rel = relUnderRoot(root, target) ?? name;
        return { path: target, rel: stripMd(rel), name, links: 0, skipped: true };
    }
    const next = path.join(dest, settled.name);
    const oldRel = relUnderRoot(root, target);
    fs.renameSync(target, next);
    const newRel = relUnderRoot(root, next);
    const skipLinks = stat.isDirectory() || oldRel === null || newRel === null || inLibrary(root, next);
    const links = skipLinks ? 0 : rewriteRefs(pages, stripMd(oldRel), { kind: 'move', rel: stripMd(newRel) }, next);
    return { path: next, rel: stripMd(newRel ?? settled.name), name: settled.name, links, skipped: false };
}
/** 逐页改写指向 oldRel 的引用（跳过这一页自己、跳过纯判定用无 path 的条目）；
 *  单页读/写失败只跳过——改名/移动本身已成立。返回改写成功的页数 */
function rewriteRefs(pages, oldRel, mode, selfPath) {
    let changed = 0;
    for (const page of pages) {
        const abs = page.path;
        if (typeof abs !== 'string' || abs === selfPath)
            continue;
        if (!page.links?.some((l) => resolveWikiRel(pages, l, page.space) === oldRel))
            continue;
        let text;
        try {
            text = fs.readFileSync(abs, 'utf8');
        }
        catch {
            continue;
        }
        const next = rewriteWikiLinks(text, pages, oldRel, mode, page.space);
        if (next === text)
            continue;
        try {
            fs.writeFileSync(abs, next, 'utf8');
            changed += 1;
        }
        catch {
            // 写不了就跳过这一页
        }
    }
    return changed;
}
// ── 导入 ────────────────────────────────────────────────────────────────────
/** 单个图片引用的落地：内容寻址 attachments/<sha256 前两位>/<前 16 位>.<ext> */
function attachmentPath(root, bytes, ext) {
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    return path.join(root, 'attachments', hash.slice(0, 2), `${hash.slice(0, 16)}${ext}`);
}
/** 正文里的本地图片引用（相对路径才收）：`![](src "title")` 与 `<img src="...">` */
function scanImageSrcs(text) {
    const out = [];
    const md = /!\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
    for (const m of text.matchAll(md)) {
        const rawSrc = m[1] ?? '';
        const src = rawSrc.startsWith('<') ? rawSrc.slice(1, -1) : rawSrc;
        const at = (m.index ?? 0) + m[0].indexOf(rawSrc);
        out.push({ start: at, end: at + rawSrc.length, src });
    }
    const html = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
    for (const m of text.matchAll(html)) {
        const src = m[2] ?? m[3] ?? '';
        const at = (m.index ?? 0) + m[0].indexOf(src);
        out.push({ start: at, end: at + src.length, src });
    }
    return out.sort((a, b) => a.start - b.start);
}
/** 只认库外的相对路径：绝对路径、`//`、`data:`、已在 attachments/ 下的一律不动 */
function isLocalImageRef(src) {
    const s = src.trim();
    if (s === '')
        return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s))
        return false;
    if (s.startsWith('/') || s.startsWith('\\') || s.startsWith('//'))
        return false;
    if (/^attachments[\\/]/i.test(s))
        return false;
    return true;
}
/** 收页面引用的本地图片进 attachments/ 并改写引用；返回 [新正文, 新落盘张数] */
export function pullImages(text, srcDir, root) {
    const refs = scanImageSrcs(text);
    if (refs.length === 0)
        return [text, 0];
    let out = text;
    let fresh = 0;
    for (const ref of refs.reverse()) {
        if (!isLocalImageRef(ref.src))
            continue;
        let decoded = ref.src;
        try {
            decoded = decodeURIComponent(ref.src);
        }
        catch {
            /* 百分号编码坏掉就按原样找 */
        }
        const abs = path.resolve(srcDir, decoded.replace(/\\/g, '/'));
        let bytes;
        try {
            bytes = fs.readFileSync(abs);
        }
        catch {
            continue; // 源文件不在：引用原样留着，由用户自己补
        }
        const ext = (path.extname(abs) || '.bin').toLowerCase();
        const dest = attachmentPath(root, bytes, ext);
        if (!existsSync(dest)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, bytes);
            fresh += 1;
        }
        const rel = path.relative(root, dest).split(path.sep).join('/');
        out = `${out.slice(0, ref.start)}${rel}${out.slice(ref.end)}`;
    }
    return [out, fresh];
}
/** 导入一个文件到库内目录。资料（资料库那一支、或上传的任意文件）按字节原样落盘，
 *  一律自动加序号不覆盖；笔记页收正文并把页内引用的本地图片收进 attachments/。 */
export async function importEntry(root, opts) {
    const dest = resolveInside(root, opts.destAbs, { allowRoot: true });
    if (!fs.statSync(dest).isDirectory())
        throw new Error('目标不是文件夹');
    const library = inLibrary(root, dest);
    let bytes = null;
    let srcDir = null;
    let sourceName = typeof opts.fileName === 'string' && opts.fileName !== '' ? path.basename(opts.fileName) : '';
    if (typeof opts.srcPath === 'string' && opts.srcPath.trim() !== '') {
        const raw = opts.srcPath.trim();
        let srcReal;
        try {
            srcReal = fs.realpathSync(path.resolve(raw));
        }
        catch {
            throw new Error(`源文件不可达：${raw}`);
        }
        if (!fs.statSync(srcReal).isFile())
            throw new Error('只能导入文件（文件夹请逐个导入）');
        const rootReal = fs.realpathSync(root);
        if (srcReal === rootReal || relUnderRoot(rootReal, srcReal) !== null)
            throw new Error('源文件已在知识库内');
        bytes = fs.readFileSync(srcReal);
        srcDir = path.dirname(srcReal);
        sourceName = path.basename(srcReal);
    }
    else if (opts.data !== undefined) {
        bytes = opts.data;
    }
    if (bytes === null)
        throw new Error('缺少导入内容');
    if (bytes.length === 0)
        throw new Error('文件是空的');
    const asPage = !library && /\.(md|markdown)$/i.test(sourceName);
    const rawName = typeof opts.name === 'string' && opts.name.trim() !== '' ? opts.name.trim() : stripMd(sourceName);
    const leaf = safeLeaf(rawName);
    if (leaf === null)
        throw new Error('名称非法或为空');
    if (asPage) {
        // md 页：正文读成文本，引用到的本地图片一并收进 attachments/（上传来源没有同目录，跳过）
        const [text, images] = srcDir === null ? [bytes.toString('utf8'), 0] : pullImages(bytes.toString('utf8'), srcDir, root);
        const want = `${stripMd(leaf)}.md`;
        let final = want;
        if (existsSync(path.join(dest, want))) {
            if (opts.conflict === 'skip') {
                const target = path.join(dest, want);
                return { path: target, rel: stripMd(relUnderRoot(root, target) ?? want), name: want, images: 0, skipped: true, renamed: false };
            }
            if (opts.conflict === 'overwrite')
                await discard(path.join(dest, want));
            else {
                const deduped = dedupeName(dest, want);
                if (deduped === null)
                    throw new Error('同名文件太多，无法自动编号');
                final = deduped;
            }
        }
        const target = path.join(dest, final);
        fs.writeFileSync(target, text, 'utf8');
        return {
            path: target,
            rel: stripMd(relUnderRoot(root, target) ?? final),
            name: final,
            images,
            skipped: false,
            renamed: final !== want,
        };
    }
    // 资料：文件名原样（扩展名缺失时取来源的），撞名一律加序号
    const srcExt = path.extname(sourceName);
    const fileLeaf = leaf.includes('.') || srcExt === '' ? leaf : `${leaf}${srcExt}`;
    if (!library && !/\.(md|markdown)$/i.test(fileLeaf))
        throw new Error('笔记区只收 md 文件（文献请导进资料库）');
    const deduped = dedupeName(dest, fileLeaf);
    if (deduped === null)
        throw new Error('同名文件太多，无法自动编号');
    const target = path.join(dest, deduped);
    fs.writeFileSync(target, bytes);
    return {
        path: target,
        rel: relUnderRoot(root, target) ?? deduped,
        name: deduped,
        images: 0,
        skipped: false,
        renamed: deduped !== fileLeaf,
    };
}
/** 删除（整单批量）：Windows 走回收站，非 Windows 直删；返回成功数与失败项名字 */
export async function deleteEntries(root, paths) {
    if (!Array.isArray(paths) || paths.length === 0)
        throw new Error('缺少要删除的路径');
    const targets = [];
    const seen = new Set();
    for (const raw of paths) {
        const target = resolveInside(root, String(raw ?? ''));
        if (isLibraryRoot(root, target))
            throw new Error('资料库根目录不能删除');
        if (!existsSync(target))
            continue;
        const stat = fs.statSync(target);
        if (!stat.isDirectory() && !inLibrary(root, target) && !/\.(md|markdown)$/i.test(target)) {
            throw new Error(`只允许删除笔记页、资料或文件夹：${path.basename(target)}`);
        }
        if (seen.has(target))
            continue;
        seen.add(target);
        targets.push(target);
    }
    let deleted = 0;
    const failed = [];
    if (process.platform === 'win32') {
        const results = await recycleDeleteBatch(targets);
        targets.forEach((p, i) => {
            if (results[i] === true)
                deleted += 1;
            else
                failed.push(path.basename(p));
        });
    }
    else {
        for (const p of targets) {
            try {
                await fs.promises.rm(p, { recursive: true, force: true });
                deleted += 1;
            }
            catch {
                failed.push(path.basename(p));
            }
        }
    }
    return failed.length > 0 ? { deleted, failed } : { deleted };
}
