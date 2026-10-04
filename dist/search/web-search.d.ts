export declare const SEARCH_PROVIDER_ID = "free-search";
/** web seam 的 provider 契约（我们注册的那一个） */
interface SeamSearchProvider {
    id: string;
    available?(): boolean;
    search(request: {
        query: string;
        maxResults?: number;
    }, signal?: AbortSignal): Promise<{
        content?: string;
        sources: Array<{
            url: string;
            title?: string;
            snippet?: string;
            publishedAt?: string;
        }>;
        truncated: boolean;
    }>;
}
/** web 服务里本层触达的最小面（其余成员不声明） */
interface SeamWebService {
    registerSearchProvider: (provider: SeamSearchProvider) => unknown;
    searchProviders?: Map<string, SeamSearchProvider>;
    /** provider 选择：seam 每次 search() 现读；未配置时为 undefined */
    searchProviderId?: string;
}
/** cordis ctx 里本层用到的最小面（effect 可缺：缺失时不做还原） */
interface KitCtx {
    inject(deps: string[], cb: (webCtx: {
        web: SeamWebService;
    }) => void): void;
    effect?(fn: () => void | (() => void), label?: string): void;
}
export interface ApplyWebSearchOptions {
    /** 单次搜索的条数上限，每次现读；给不出 1-8 整数时回落默认值 */
    getMaxResults?: () => unknown;
    log?: (message: string) => void;
}
/** 接管 web seam 的选择并注册免费链 provider。挂 ctx.effect：行卸载时两者一起还回去。 */
export declare function applyWebSearch(ctx: KitCtx, options?: ApplyWebSearchOptions): void;
export {};
