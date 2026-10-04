export declare const hnEngine: {
    id: string;
    available: () => boolean;
    match(query: string): boolean;
    search(query: string, { maxResults, signal }?: {
        maxResults?: number;
        signal?: AbortSignal;
    }): Promise<{
        items: any;
    }>;
};
