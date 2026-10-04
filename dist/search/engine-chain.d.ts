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
 * Run one search through the chain. Returns the first successful engine's
 * normalized result; throws with a per-engine attempt trail when all fail.
 */
export declare function searchChain(query: string, { maxResults, signal }?: {
    maxResults?: number;
    signal?: AbortSignal;
}): Promise<{
    items: SearchResultItem[];
    summary?: string;
}>;
