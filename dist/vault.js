// vault 知识库宿主半边 —— 扫描索引 / wikilink 解析 / 内容搜索 / 建页与写回。
// 数据契约：vault 是设置卡配置的一个绝对目录（vaultRoot），其内一切皆 md 文件
// （attachments/ 与点前缀目录除外），插件不持有第二真源；索引由扫描派生、
// mtime 增量缓存，进程内存态，重启重扫。生命周期：跟随 webServer 注入段创建，
// 随插件卸载丢弃（无外部资源）。降级路径：vaultRoot 未配置或不存在 → 索引端点
// 回 { root: null }，前端渲染「未配置」引导；扫描/搜索失败按空结果+错误字段回。
import fs from 'node:fs';
import path from 'node:path';
const MD_EXTS = new Set(['.md', '.markdown']);
/** 不进索引与树的目录名（attachments 约定放二进制；点前缀一律隐藏） */
const SKIP_DIRS = new Set(['attachments', '.git', '.trash', 'node_modules']);
const SCAN_FILE_LIMIT = 5000;
export function isMdPath(p) {
    return MD_EXTS.has(path.extname(p).toLowerCase());
}
/** wikilink 目标 → 可用文件名（Windows 非法字符与首尾点空格清洗） */
export function sanitizePageTitle(raw) {
    const cleaned = String(raw ?? '')
        .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 120);
    return cleaned;
}
/** 建页相对路径净化：标题允许带 `/` 指子目录（建页时顺带递归建目录）。
 *  每段各自过 sanitizePageTitle（`..` 会被剥成空段，天然防穿越），空段丢弃，
 *  最多 8 段防路径爆炸；返回 `a/b/c` 形式，'' 表示无有效段 */
export function sanitizePageRel(raw) {
    const segs = String(raw ?? '')
        .split(/[\\/]+/)
        .map((seg) => sanitizePageTitle(seg))
        .filter((seg) => seg !== '')
        .slice(0, 8);
    return segs.join('/');
}
/** 首个 `# ` 标题行（前 60 行内找），找不到回退文件名 */
export function extractTitle(content, fallbackName) {
    const lines = content.split(/\r?\n/, 60);
    for (const line of lines) {
        const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
        if (m && m[1] !== undefined)
            return m[1].trim();
    }
    return fallbackName;
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
    /** 全量 walk + mtime 增量读。root 不存在回 null（前端渲染未配置引导） */
    async scan() {
        const root = this.root();
        if (root === null)
            return null;
        const spaces = new Set();
        const pages = [];
        let truncated = false;
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
                    if (depth === 0)
                        spaces.add(dirent.name);
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
                        title: extractTitle(content, rel.split('/').pop() ?? dirent.name),
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
        return { root, spaces: [...spaces].sort(), pages, truncated };
    }
    /** 全文搜索：文件名/标题命中权重高于正文次数；小库逐文件读可接受，
     *  大库换索引是后续阶段。返回带 snippet 的前 limit 条。 */
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
            const titleLower = page.title.toLowerCase();
            let missing = false;
            for (const term of terms) {
                const inRel = relLower.includes(term);
                const inTitle = titleLower.includes(term);
                const inBody = content.includes(term);
                if (!inRel && !inTitle && !inBody) {
                    missing = true;
                    break;
                }
                if (inRel)
                    score += 8;
                if (inTitle)
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
            results.push({ path: page.path, rel: page.rel, title: page.title, snippet, score });
        }
        results.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
        return { root: index.root ?? '', results: results.slice(0, limit) };
    }
    /** vault 根 AGENTS.md 引导（首次扫描时补种，已存在绝不覆盖） */
    async ensureAgentsMd() {
        const root = this.root();
        if (root === null)
            return;
        const target = path.join(root, 'AGENTS.md');
        try {
            await fs.promises.access(target);
            return;
        }
        catch {
            // 不存在 → 创建
        }
        const template = [
            '# vault 约定（人机共读）',
            '',
            '- 文件是唯一真源：一切内容都是本目录下的 md 文件，无第二存储。',
            '- 一题一页：一个主题一页；写前先搜索是否已有同类页，重叠则合并。',
            '- wikilink 用 `[[页面名]]` 引用其它页（按文件名解析，移动不破链）。',
            '- frontmatter 可省；需要时只写 `created`（日期）；`archived: true` 表示已归档。',
            '- 二进制（图片/PDF）放 `attachments/`，页面里用相对链接引用。',
            '- 单页超过约 16KB 考虑拆分或抽象出索引页。',
            '',
        ].join('\n');
        try {
            await fs.promises.writeFile(target, template, 'utf8');
        }
        catch {
            // 只读盘等场景静默失败，不阻断索引
        }
    }
}
