export declare const stackExchangeEngine: {
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
