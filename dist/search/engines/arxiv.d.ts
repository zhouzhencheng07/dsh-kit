export declare const arxivEngine: {
    id: string;
    available: () => boolean;
    match(query: string): boolean;
    search(query: string, { maxResults, signal }?: {
        maxResults?: number;
        signal?: AbortSignal;
    }): Promise<{
        items: {
            url: string;
            title: string;
            snippet: string;
            publishedAt: string | undefined;
        }[];
    }>;
};
