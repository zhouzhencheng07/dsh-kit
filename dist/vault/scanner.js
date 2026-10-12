// dsh-kit/vault 组件的知识库半边 —— 扫描索引 / wikilink 解析 / 标题提取 / 内容搜索。**只读**：
// 页面由 agent 的文件工具或外部编辑器写——「文件即接口」，插件只管把这棵目录读出来。
// 数据契约：vault 是配置页配置的一个绝对目录（vaultRoot，留空用默认根
// defaultVaultRoot()），其内 md 文件是页面（attachments/ 与点前缀目录除外），
// 根下 library/ 是**资料库**（任意格式文献：只列清单、
// 不读正文、不进检索）。插件不持有第二真源；索引由扫描派生、mtime 增量缓存，
// 进程内存态，重启重扫。
// 不建骨架目录、不碰 git：目录不存在就是未配置态，前端渲染引导。
// 生命周期：apply 级单实例（webServer 注入段重进时沿用同一实例与 mtime 缓存），
// 随插件卸载丢弃（无外部资源）。降级路径：
// 根不存在 → 索引端点回 { root: null }，前端渲染引导；扫描/搜索失败按空结果+错误字段回。
import fs from 'node:fs';
import path from 'node:path';
import { kitPath } from "../core/data-path.js";
import { REFS_FILE, readFolderRefs } from "./fs.js";
const MD_EXTS = new Set(['.md', '.markdown']);
/** 不进索引与树的目录名（attachments 约定放二进制，由外部工具维护；点前缀一律隐藏） */
export const SKIP_DIRS = new Set(['attachments', '.git', '.trash', 'node_modules']);
const SCAN_FILE_LIMIT = 5000;
/** 目录递归深度上限：人为的超深目录树不打爆栈，到限的子树当截断（与文件数到限同语义） */
const SCAN_MAX_DEPTH = 32;
/** 资料库目录名（根下这一层是约定：library/ 即资料库）；清单上限独立于页数上限 */
const LIBRARY_DIR = 'library';
const LIBRARY_LIMIT = 2000;
/** vault 默认根（vaultRoot 留空时即开即用）：数据目录下的 vault 子树（与模块同名），与
 *  browser-profile/screenshots 等运行产物不混居 */
export function defaultVaultRoot() {
    return kitPath('vault');
}
function isMdPath(p) {
    return MD_EXTS.has(path.extname(p).toLowerCase());
}
/** 查询词进正则前转义：搜索框里打的元字符不能当模式用 */
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** 正文 wikilink 提取：[[目标]] / [[目标|别名]]，目标剥 #锚点；去重保序 */
export function extractWikiLinks(content) {
    const out = [];
    const seen = new Set();
    const re = /\[\[([^\[\]#|]+)(?:#[^\[\]|]*)?(?:\|[^\[\]]*)?\]\]/g;
    for (const m of content.matchAll(re)) {
        const target = (m[1] ?? '').trim();
        if (target === '')
            continue;
        const key = target.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(target);
    }
    return out;
}
/** 正文标题提取（ATX，1~6 个 #，缩进 ≤3 空格）：跳过 frontmatter 与围栏代码块
 *  （``` 或 ~~~，闭合要求同字符且连数不短于开栏）；`#` 后必须跟空白（#标签 不是
 *  标题），闭合的 # 序列按 CommonMark 剥掉——编辑器解析标题同口径，`[[页#标题]]`
 *  的锚点靠标题文本比对，两处必须一致。去重（不分大小写）保序。 */
export function extractHeadings(content) {
    const out = [];
    const seen = new Set();
    let fence = null;
    let frontmatter = false;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        // 首行 --- 起 frontmatter：到闭合为止都不算正文
        if (i === 0 && line.trimEnd() === '---') {
            frontmatter = true;
            continue;
        }
        if (frontmatter) {
            if (line.trimEnd() === '---')
                frontmatter = false;
            continue;
        }
        // 围栏：开着的时候整段跳过（代码里的 # 不是标题）
        const fenceAt = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fenceAt !== null) {
            const ch = fenceAt[1][0];
            const run = fenceAt[1].length;
            if (fence === null)
                fence = { ch, run };
            else if (fence.ch === ch && run >= fence.run)
                fence = null;
            continue;
        }
        if (fence !== null)
            continue;
        // 缩进 >3 空格是缩进代码块
        const indent = line.length - line.replace(/^ +/, '').length;
        if (indent > 3)
            continue;
        const rest = line.slice(indent);
        const hashes = /^#+/.exec(rest)?.[0]?.length ?? 0;
        if (hashes === 0 || hashes > 6)
            continue;
        const after = rest.slice(hashes);
        if (!after.startsWith(' ') && !after.startsWith('\t'))
            continue;
        let text = after.trim();
        while (text.endsWith('#')) {
            const trimmed = text.replace(/#+$/, '');
            if (trimmed === '' || trimmed.endsWith(' ') || trimmed.endsWith('\t'))
                text = trimmed.trimEnd();
            else
                break;
        }
        if (text !== '' && !seen.has(text.toLowerCase())) {
            seen.add(text.toLowerCase());
            out.push(text);
        }
    }
    return out;
}
/** 单页正文缓存上限 */
const SEARCH_CACHE_CAP = 256 * 1024;
export class VaultScanner {
    rootProvider;
    /** mtime 增量缓存：重扫只重读变化文件，walk 本身每次全量（readdir 便宜） */
    cache = new Map();
    constructor(rootProvider) {
        this.rootProvider = rootProvider;
    }
    /** 读设置回调的容错包装：设置未就绪抛错时按未配置处理 */
    root() {
        let raw = '';
        try {
            raw = String(this.rootProvider() ?? '');
        }
        catch {
            return null;
        }
        const trimmed = raw.trim();
        if (trimmed === '')
            return null;
        try {
            const stat = fs.statSync(trimmed);
            if (!stat.isDirectory())
                return null;
            return fs.realpathSync(trimmed);
        }
        catch {
            return null;
        }
    }
    /** 全量 walk + mtime 增量读。root 不存在回 null（前端渲染未配置引导）。
     *  根下 library/ 与笔记分家：整棵子树进 library 清单（任意格式、不读正文、不进检索），
     *  页面索引与 folders 都不含它——资料库是文献不是页面。 */
    async scan() {
        const root = this.root();
        if (root === null)
            return null;
        const folders = new Set();
        const pages = [];
        const knowledgeSets = [];
        let truncated = false;
        // 资料库用持有对象收（闭包里赋值，标量会被 TS 的控制流分析窄化成 never）
        const lib = {
            root: null,
            items: [],
            truncated: false,
        };
        /** 资料库子树单趟清单：任意格式文件 + 目录，点前缀跳过；不 stat、不读正文 */
        const walkLibrary = async (dir, prefix) => {
            let dirents;
            try {
                dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const dirent of dirents) {
                if (lib.items.length >= LIBRARY_LIMIT) {
                    lib.truncated = true;
                    return;
                }
                if (dirent.name.startsWith('.'))
                    continue;
                const full = path.join(dir, dirent.name);
                const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
                if (dirent.isDirectory()) {
                    lib.items.push({ path: full, rel, dir: true });
                    await walkLibrary(full, rel);
                    continue;
                }
                if (dirent.isFile())
                    lib.items.push({ path: full, rel, dir: false });
            }
        };
        const walk = async (dir, depth) => {
            if (pages.length >= SCAN_FILE_LIMIT || depth >= SCAN_MAX_DEPTH) {
                truncated = true;
                return;
            }
            let dirents;
            try {
                dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            // 知识集标记（目录体内的隐藏文件）：存在即这个目录是知识集，清单一起读出来。
            // 只认子目录，库根本身不参与（树头没有可挂的「行」）
            if (dir !== root && dirents.some((d) => d.isFile() && d.name === REFS_FILE)) {
                knowledgeSets.push({ dir: path.relative(root, dir).split(path.sep).join('/'), refs: readFolderRefs(dir) });
            }
            for (const dirent of dirents) {
                if (pages.length >= SCAN_FILE_LIMIT) {
                    truncated = true;
                    return;
                }
                const full = path.join(dir, dirent.name);
                if (dirent.isDirectory()) {
                    if (dirent.name.startsWith('.') || SKIP_DIRS.has(dirent.name))
                        continue;
                    if (dirent.name === LIBRARY_DIR) {
                        // 根层 = 资料库（走资料池清单）；更深的同名目录一律跳过：资料库子树里的 md 是
                        // 文献不是页面（与 fs 的 REFS_SKIP_DIRS、quiz 的范围口径、桌面端 SKIP_DIRS 一致）
                        if (depth === 0) {
                            lib.root = full;
                            await walkLibrary(full, '');
                        }
                        continue;
                    }
                    folders.add(path.relative(root, full).split(path.sep).join('/'));
                    await walk(full, depth + 1);
                    continue;
                }
                if (!dirent.isFile() || !isMdPath(dirent.name))
                    continue;
                const space = depth === 0 ? '' : path.relative(root, dir).split(path.sep)[0] ?? '';
                const rel = path
                    .relative(root, full)
                    .split(path.sep)
                    .join('/')
                    .replace(/\.(md|markdown)$/i, '');
                let stat;
                try {
                    stat = await fs.promises.stat(full);
                }
                catch {
                    continue;
                }
                const cached = this.cache.get(full);
                if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
                    pages.push({ ...cached.page, path: full, mtimeMs: stat.mtimeMs, size: stat.size });
                    continue;
                }
                try {
                    const content = await fs.promises.readFile(full, 'utf8');
                    const page = {
                        rel,
                        space,
                        links: extractWikiLinks(content),
                        heads: extractHeadings(content),
                    };
                    this.cache.set(full, {
                        mtimeMs: stat.mtimeMs,
                        size: stat.size,
                        page,
                        // 存原文（搜索时再转小写）：snippet 要给人看，缓存里那份不能是被洗过的正文
                        content: content.length <= SEARCH_CACHE_CAP ? content : null,
                    });
                    pages.push({ ...page, path: full, mtimeMs: stat.mtimeMs, size: stat.size });
                }
                catch {
                    // 读失败（编码/权限）跳过该页，不阻断整体
                }
            }
        };
        await walk(root, 0);
        // 清缓存里已消失的文件，防长期驻留泄漏
        const alive = new Set(pages.map((p) => p.path));
        for (const key of this.cache.keys()) {
            if (!alive.has(key))
                this.cache.delete(key);
        }
        pages.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base', numeric: true }));
        lib.items.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base', numeric: true }));
        return {
            root,
            folders: [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
            pages,
            library: lib.root === null ? null : { root: lib.root, items: lib.items, truncated: lib.truncated },
            knowledgeSets: knowledgeSets.sort((a, b) => a.dir.toLowerCase().localeCompare(b.dir.toLowerCase())),
            truncated,
        };
    }
    /** 全文搜索覆盖根下全部索引页（attachments、点前缀目录与资料库子树本就不进索引）。
     *  打分 = 多词 AND + 词面加权：路径 +8 > 文件名 +5 > 正文 +2——路径权重最高
     *  意味着文件名就是检索键。小库逐文件读可接受，大库换索引是后续阶段。
     *  返回带 snippet 的前 limit 条（显示名客户端取 rel 末段，不单独回标题）。 */
    async search(query, limit) {
        const index = await this.scan();
        if (index === null)
            return null;
        const q = query.trim().toLowerCase();
        if (q === '')
            return { root: index.root, results: [] };
        const terms = q.split(/\s+/).filter((t) => t !== '');
        const results = [];
        for (const page of index.pages) {
            // 正文优先取 mtime 缓存（scan 刚刷新过，命中即免读盘）；超大页等未缓存者现读。
            // 缓存存的是原文，匹配用小写副本——snippet 回原文切片，不能给一段小写正文
            let raw = this.cache.get(page.path)?.content ?? null;
            if (raw === null) {
                try {
                    raw = await fs.promises.readFile(page.path, 'utf8');
                }
                catch {
                    continue;
                }
            }
            const content = raw.toLowerCase();
            let score = 0;
            const relLower = page.rel.toLowerCase();
            const baseLower = relLower.split('/').pop() ?? '';
            let missing = false;
            for (const term of terms) {
                const inRel = relLower.includes(term);
                const inBase = baseLower.includes(term);
                const inBody = content.includes(term);
                if (!inRel && !inBase && !inBody) {
                    missing = true;
                    break;
                }
                if (inRel)
                    score += 8;
                if (inBase)
                    score += 5;
                if (inBody)
                    score += 2;
            }
            if (missing)
                continue;
            // snippet：第一个词的首个出现位置附近 ±60 字符
            const first = terms[0];
            // 偏移必须在**原文**上求：小写副本一旦改变长度（İ 之类），拿它切原文就会错位
            const at = first === undefined ? -1 : (new RegExp(escapeRegExp(first), 'i').exec(raw)?.index ?? -1);
            const snippet = at < 0 ? '' : raw.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, ' ').trim();
            results.push({ path: page.path, rel: page.rel, snippet, score });
        }
        results.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
        return { root: index.root ?? '', results: results.slice(0, limit) };
    }
}
