/** 规范化的单条结果（seam 与工具返回共用这个形状） */
export interface SearchResultItem {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}
export interface SearchResult {
    items: SearchResultItem[];
    summary?: string;
}
/** 引擎契约：available 廉价离线；match 仅专用引擎有 */
export interface SearchEngine {
    id: string;
    available(): boolean;
    match?(query: string): boolean;
    search(query: string, opts: {
        maxResults?: number;
        signal?: AbortSignal;
    }): Promise<SearchResult>;
}
/**
 * 跑一次链式搜索：返回第一个成功引擎的规范化结果；全部失败时抛错，
 * 错误信息带各引擎的逐家尝试记录。
 */
export declare function searchChain(query: string, { maxResults, signal }?: {
    maxResults?: number;
    signal?: AbortSignal;
}): Promise<{
    items: SearchResultItem[];
    summary?: string;
}>;
