// StackExchange 引擎：走公开 API 搜编程问答（无需密钥）。
// 只在查询明确指向 StackOverflow（stackoverflow / stack exchange 等字样）时参与。
const SE_API = 'https://api.stackexchange.com/2.3/search/advanced';
export const stackExchangeEngine = {
    id: 'stackexchange',
    available: () => true,
    match(query) {
        return /stackoverflow|stack exchange|stackexchange|程序员问答/i.test(query);
    },
    async search(query, { maxResults = 5, signal } = {}) {
        const url = `${SE_API}?site=stackoverflow&q=${encodeURIComponent(query)}&pagesize=${Math.min(maxResults, 10)}&order=desc&sort=relevance`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'dsh-free-search/0.2' },
            signal,
        });
        if (!resp.ok) {
            throw new Error(`stackexchange: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const items = (data.items ?? [])
            .map((r) => ({
            url: r.link ?? '',
            title: r.title ?? '',
            snippet: Array.isArray(r.tags) ? r.tags.join(', ') : '',
            publishedAt: r.creation_date
                ? new Date(r.creation_date * 1000).toISOString().slice(0, 10)
                : undefined,
        }))
            .filter((it) => it.url);
        return { items };
    },
};
