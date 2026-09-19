// vault 知识库宿主半边 —— 扫描索引 / wikilink 解析 / 内容搜索。**只读**：
// 插件面板不提供任何写入（建页/写回/改名/删除/上传全退役），页面由 agent 的
// 文件工具或外部编辑器写——「文件即接口」，插件只管把这棵目录读出来。
// 数据契约：vault 是设置卡配置的一个绝对目录（vaultRoot，留空用默认根
// defaultVaultRoot()），其内 md 文件是页面（attachments/ 与点前缀目录除外），
// 根下 library/ 是**资料库**（任意格式文献：只列清单、
// 不读正文、不进检索）。插件不持有第二真源；索引由扫描派生、mtime 增量缓存，
// 进程内存态，重启重扫。
// 不建骨架目录、不碰 git：目录不存在就是未配置态，前端渲染引导。
// 生命周期：跟随 webServer 注入段创建，随插件卸载丢弃（无外部资源）。降级路径：
// 根不存在 → 索引端点回 { root: null }，前端渲染引导；扫描/搜索失败按空结果+错误字段回。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const MD_EXTS = new Set(['.md', '.markdown']);
/** 不进索引与树的目录名（attachments 约定放二进制，由外部工具维护；点前缀一律隐藏） */
const SKIP_DIRS = new Set(['attachments', '.git', '.trash', 'node_modules']);
const SCAN_FILE_LIMIT = 5000;
/** 资料库目录名（根下这一层是约定：library/ 即资料库）；清单上限独立于页数上限 */
const LIBRARY_DIR = 'library';
const LIBRARY_LIMIT = 2000;
/** 插件数据目录（$DSH_HOME/dsh-kit；与 schedule.ts 同式，各自轻量持有） */
function dshKitDataDir() {
    const env = process.env.DSH_HOME;
    const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh');
    return path.join(home, 'dsh-kit');
}
/** vault 默认根（vaultRoot 留空时即开即用）：数据目录下的 vault 子树（与模块同名），与
 *  browser-profile/screenshots 等运行产物不混居 */
export function defaultVaultRoot() {
    return path.join(dshKitDataDir(), 'vault');
}
export function isMdPath(p) {
    return MD_EXTS.has(path.extname(p).toLowerCase());
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
            if (pages.length >= SCAN_FILE_LIMIT) {
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
            for (const dirent of dirents) {
                if (pages.length >= SCAN_FILE_LIMIT) {
                    truncated = true;
                    return;
                }
                const full = path.join(dir, dirent.name);
                if (dirent.isDirectory()) {
                    if (dirent.name.startsWith('.') || SKIP_DIRS.has(dirent.name))
                        continue;
                    if (depth === 0 && dirent.name === LIBRARY_DIR) {
                        lib.root = full;
                        await walkLibrary(full, '');
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
                    };
                    this.cache.set(full, {
                        mtimeMs: stat.mtimeMs,
                        size: stat.size,
                        page,
                        content: content.length <= SEARCH_CACHE_CAP ? content.toLowerCase() : null,
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
            // 正文优先取 mtime 缓存（scan 刚刷新过，命中即免读盘）；超大页等未缓存者现读
            let content = this.cache.get(page.path)?.content ?? null;
            if (content === null) {
                try {
                    content = (await fs.promises.readFile(page.path, 'utf8')).toLowerCase();
                }
                catch {
                    continue;
                }
            }
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
            const at = first === undefined ? -1 : content.indexOf(first);
            const snippet = at < 0 ? '' : content.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, ' ').trim();
            results.push({ path: page.path, rel: page.rel, snippet, score });
        }
        results.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
        return { root: index.root ?? '', results: results.slice(0, limit) };
    }
}
