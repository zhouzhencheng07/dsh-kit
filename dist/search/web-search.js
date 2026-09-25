// dsh-kit 网页搜索：web seam 接线（引擎链见 ./engine-chain.ts，引擎在 ./engines/）
//
// 注册 id 为 'free-search' 的搜索 provider——Tavily 免 key 优先，Bing RSS / Sogou /
// GitHub / arXiv / StackExchange / HN 自动故障转移；原生引用卡片照常渲染（seam 直接
// 消费 sources[]）。
//
// provider 选择：seam 的 searchProviderId 在 base 层 config 里钉成 deepseek-official
// （付费模型调用，dsh-base/cordis.patch.yml）。本组件加载时才把它改指到 free-search——
// 若照旧在 bundle patch 里静态钉，关掉本组件行会把搜索一起弄坏：行禁用 = 本模块不
// 物化 = 没有 provider 顶 free-search 这个 id，seam 每次搜索抛
// WEB_PROVIDER_CONFIGURED_MISSING。现形态下关行 = 不接管 seam = base 钉的官方
// provider 原样服务，插件页「全部关掉 = DSH 原版形态」才成立。
//
// 宿主断言（0.1.7-alpha.2 / rc.2 代码级，见知识库「DSH 插件开发坑」）：WebRuntime 的
// searchProviderId 是实例公开字段（构造期取 config.searchProvider ??
// $DSH_WEB_SEARCH_PROVIDER，每次 search() 现读）。字段缺失或不可写 = 不钉不注册，
// 仅「免费链不生效」，官方搜索照常。
//
// 显式钉了别的 provider（profile 补丁层把 id 指回别的）就让路：只在当前值是 undefined
// 或 base 默认值时才接管。
import { searchChain } from "./engine-chain.js";
export const SEARCH_PROVIDER_ID = 'free-search';
/** base 层钉的官方 provider id（= 无人显式选择时的值，也是我们只在此值上接管的原因） */
const BASE_PROVIDER_ID = 'deepseek-official';
/** 条数上限的 schema 默认值（配置给不出合法值时兜底） */
const DEFAULT_MAX_RESULTS = 2;
function resultCapOf(getMaxResults) {
    const n = getMaxResults();
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_MAX_RESULTS;
}
/**
 * 把 seam 的选择改指到 free-search，返回还原函数。
 * 宿主没暴露可写字段、或已被显式钉在别的 provider 上 → null（调用方据此不注册）。
 */
function pinProvider(web) {
    if (!('searchProviderId' in web))
        return null;
    const prev = web.searchProviderId;
    if (prev !== undefined && prev !== BASE_PROVIDER_ID)
        return null;
    try {
        web.searchProviderId = SEARCH_PROVIDER_ID;
    }
    catch {
        return null; // 只读访问器：写不进去
    }
    if (web.searchProviderId !== SEARCH_PROVIDER_ID)
        return null; // 写了不生效（不可写属性）
    return () => {
        if (web.searchProviderId === SEARCH_PROVIDER_ID)
            web.searchProviderId = prev;
    };
}
/** 接管 web seam 的选择并注册免费链 provider。挂 ctx.effect：行卸载时两者一起还回去。 */
export function applyWebSearch(ctx, options = {}) {
    const { getMaxResults = () => DEFAULT_MAX_RESULTS, log } = options;
    const disposers = [];
    ctx.inject(['web'], (webCtx) => {
        const web = webCtx.web;
        const register = web ? web.registerSearchProvider : undefined;
        if (!web || typeof register !== 'function') {
            // developer-preview 面挪走了：降级为日志，不让整个插件消失
            log?.('web seam 没有 registerSearchProvider，免费搜索未启用');
            return;
        }
        if (web.searchProviders?.has(SEARCH_PROVIDER_ID)) {
            log?.(`"${SEARCH_PROVIDER_ID}" 已被注册（旧版独立插件未卸载？），免费搜索未启用`);
            return;
        }
        const unpin = pinProvider(web);
        if (!unpin) {
            log?.('web seam 不接受 free-search 的 provider 指定（字段不可写或已被显式钉在别家），免费搜索未启用');
            return;
        }
        let unregister = null;
        try {
            const result = register.call(web, {
                id: SEARCH_PROVIDER_ID,
                available: () => true,
                async search(request, signal) {
                    // 条数取「seam 请求量与设置上限的较小值」：seam 要得少就少给（省上下文），
                    // 要得多也不超过设置上限（条数多 = 无谓的 token 消耗）
                    const cap = resultCapOf(getMaxResults);
                    const maxResults = Math.min(request.maxResults ?? cap, cap);
                    const { items, summary } = await searchChain(request.query, { maxResults, signal });
                    return {
                        ...(summary ? { content: summary } : {}),
                        sources: items.map((item) => ({
                            url: item.url,
                            ...(item.title ? { title: item.title } : {}),
                            ...(item.snippet ? { snippet: item.snippet } : {}),
                            ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
                        })),
                        // seam 自己按 request.maxResults 截断 sources[]
                        truncated: false,
                    };
                },
            });
            unregister = typeof result === 'function' ? result : null;
        }
        catch (error) {
            log?.(`free-search provider 注册失败：${error instanceof Error ? error.message : String(error)}`);
            unpin();
            return;
        }
        log?.(`免费搜索已接管 web seam（${SEARCH_PROVIDER_ID}）`);
        // 注册挂在 web 服务自己的 fiber 上，不随本行卸载自动摘——和还原一起挂本插件 effect
        disposers.push(() => unregister?.(), unpin);
    });
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
            for (const dispose of disposers.splice(0)) {
                try {
                    dispose();
                }
                catch {
                    /* 已注销 */
                }
            }
        }, 'dsh-kit-search.teardown');
    }
}
