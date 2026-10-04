export declare const tavilyEngine: {
    id: string;
    available: () => boolean;
    search(query: string, { maxResults, signal }?: {
        maxResults?: number;
        signal?: AbortSignal;
    }): Promise<{
        summary?: any;
        items: any;
    }>;
};
