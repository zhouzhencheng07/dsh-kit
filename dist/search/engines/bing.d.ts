export declare const bingEngine: {
    id: string;
    available: () => boolean;
    search(query: string, { maxResults, signal }?: {
        maxResults?: number;
        signal?: AbortSignal;
    }): Promise<{
        items: {
            url: string;
            title?: string;
            snippet?: string;
        }[];
    }>;
};
/** RSS 2.0 文本 → 规范 items。导出仅为单元测试（正则解析是唯一脆弱点） */
export declare function parseBingRss(xml: string): Array<{
    url: string;
    title?: string;
    snippet?: string;
}>;
