export declare const sogouEngine: {
    id: string;
    available: () => boolean;
    search(query: string, { maxResults, signal }?: {
        maxResults?: number;
        signal?: AbortSignal;
    }): Promise<{
        items: {
            url: string;
            title: string;
            snippet: string;
            redirect: string;
        }[];
    }>;
};
