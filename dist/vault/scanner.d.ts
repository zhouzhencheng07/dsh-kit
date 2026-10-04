export interface VaultPage {
    /** 绝对路径（realpath 归一后） */
    path: string;
    /** 相对 vault 根的正斜杠路径，去 .md 扩展名（wikilink 解析键；页面名 = 文件名） */
    rel: string;
    /** 顶层目录（空间；根下单文件页 space 为 ''） */
    space: string;
    /** 正文 wikilink 原始目标（未解析） */
    links: string[];
    mtimeMs: number;
    size: number;
}
/** 资料库条目（library/ 子树里的任意文件与目录；不进页面索引、不读正文——
 *  面板给的只是「有什么」，打开与预览归官方文件面） */
export interface VaultLibraryEntry {
    /** 绝对路径 */
    path: string;
    /** 库内相对路径（`/` 分隔、含扩展名；目录不带尾斜杠） */
    rel: string;
    dir: boolean;
}
export interface VaultLibrary {
    /** library/ 的绝对路径（realpath 后） */
    root: string;
    /** 库内全部条目（目录 + 任意格式文件） */
    items: VaultLibraryEntry[];
    /** 超过单次清单上限被截断（只影响清单，树仍可逐层展开） */
    truncated?: boolean;
}
export interface VaultIndex {
    /** 非 null：scan() 未配置/不存在时整体返回 null，走到这里必已配置 */
    root: string;
    /** 笔记目录（相对 root、`/` 分隔、含各级；不含资料库子树） */
    folders: string[];
    pages: VaultPage[];
    /** 根下 library/ 的清单；目录不存在为 null（前端据此决定资料库那一行在不在） */
    library: VaultLibrary | null;
    /** 超过单次扫描上限被截断 */
    truncated?: boolean;
}
/** vault 默认根（vaultRoot 留空时即开即用）：数据目录下的 vault 子树（与模块同名），与
 *  browser-profile/screenshots 等运行产物不混居 */
export declare function defaultVaultRoot(): string;
/** 正文 wikilink 提取：[[目标]] / [[目标|别名]]，目标剥 #锚点；去重保序 */
export declare function extractWikiLinks(content: string): string[];
export declare class VaultScanner {
    private rootProvider;
    /** mtime 增量缓存：重扫只重读变化文件，walk 本身每次全量（readdir 便宜） */
    private cache;
    constructor(rootProvider: () => string);
    /** 读设置回调的容错包装：设置未就绪抛错时按未配置处理 */
    root(): string | null;
    /** 全量 walk + mtime 增量读。root 不存在回 null（前端渲染未配置引导）。
     *  根下 library/ 与笔记分家：整棵子树进 library 清单（任意格式、不读正文、不进检索），
     *  页面索引与 folders 都不含它——资料库是文献不是页面。 */
    scan(): Promise<VaultIndex | null>;
    /** 全文搜索覆盖根下全部索引页（attachments、点前缀目录与资料库子树本就不进索引）。
     *  打分 = 多词 AND + 词面加权：路径 +8 > 文件名 +5 > 正文 +2——路径权重最高
     *  意味着文件名就是检索键。小库逐文件读可接受，大库换索引是后续阶段。
     *  返回带 snippet 的前 limit 条（显示名客户端取 rel 末段，不单独回标题）。 */
    search(query: string, limit: number): Promise<{
        root: string;
        results: Array<{
            path: string;
            rel: string;
            snippet: string;
            score: number;
        }>;
    } | null>;
}
