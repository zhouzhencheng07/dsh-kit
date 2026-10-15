// 免费引擎链（接管宿主 web seam 的网页搜索）。
//
// 按优先级逐个尝试，失败自动换下一家。专用引擎（GitHub / arXiv / StackExchange /
// HN）只在查询强烈指向各自领域时参与；通用引擎（Tavily 免钥、Bing RSS、搜狗 HTML）
// 始终参与。全部免费：Tavily 没设 TAVILY_API_KEY 时走免钥模式，其余一律无需密钥。
import { tavilyEngine } from "./engines/tavily.js";
import { bingEngine } from "./engines/bing.js";
import { sogouEngine } from "./engines/sogou.js";
import { githubEngine } from "./engines/github.js";
import { arxivEngine } from "./engines/arxiv.js";
import { stackExchangeEngine } from "./engines/stackexchange.js";
import { hnEngine } from "./engines/hn.js";
// 优先级：命中的专用引擎最前（各领域它们最对口），其后通用引擎按结果质量排。
const ENGINES = [
    githubEngine,
    arxivEngine,
    stackExchangeEngine,
    hnEngine,
    tavilyEngine,
    bingEngine,
    sogouEngine,
];
const ENGINE_TIMEOUT_MS = 12_000;
/**
 * 跑一次链式搜索：返回第一个成功引擎的规范化结果；全部失败时抛错，
 * 错误信息带各引擎的逐家尝试记录。
 */
export async function searchChain(query, { maxResults = 5, signal } = {}) {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) {
        throw new Error('free-search: query is empty');
    }
    const attempts = [];
    for (const engine of ENGINES) {
        if (!engine.available())
            continue;
        if (typeof engine.match === 'function' && !engine.match(q))
            continue;
        try {
            const result = await runWithTimeout(engine, q, maxResults, signal);
            return {
                items: capItems(result.items, maxResults),
                ...(result.summary ? { summary: result.summary } : {}),
            };
        }
        catch (error) {
            attempts.push(`${engine.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`free-search: no usable engine answered (${attempts.join('; ') || 'no engine available'})`);
}
function runWithTimeout(engine, query, maxResults, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted)
            controller.abort();
        else
            signal.addEventListener('abort', onAbort, { once: true });
    }
    return engine
        .search(query, { maxResults, signal: controller.signal })
        .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    });
}
function capItems(items, maxResults) {
    if (!Array.isArray(items))
        return [];
    return maxResults > 0 ? items.slice(0, maxResults) : items;
}
