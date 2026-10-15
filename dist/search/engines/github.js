// GitHub 引擎：走公开 REST API 搜代码/仓库（无需密钥，匿名有限频）。
// 只在查询像找仓库时参与。
const GITHUB_SEARCH = 'https://api.github.com/search/repositories';
const UA = 'dsh-free-search/0.2';
export const githubEngine = {
    id: 'github',
    available: () => true,
    // 像找仓库：github.com 链接、明确的代码词、或 owner/repo 形态。
    match(query) {
        return (/github\.com\/[\w.-]+\/[\w.-]+/i.test(query) ||
            /(^|\s)(repo|repository|代码库|仓库|开源项目)(\s|$)/i.test(query) ||
            /^[\w.-]+\/[\w.-]+$/.test(query));
    },
    async search(query, { maxResults = 5, signal } = {}) {
        const url = `${GITHUB_SEARCH}?q=${encodeURIComponent(query)}&per_page=${Math.min(maxResults, 10)}`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
            signal,
        });
        if (!resp.ok) {
            throw new Error(`github: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const items = (data.items ?? [])
            .map((r) => ({
            url: r.html_url ?? '',
            title: r.full_name ?? r.name ?? '',
            snippet: [r.description, r.stargazers_count ? `⭐ ${r.stargazers_count}` : '']
                .filter(Boolean)
                .join(' · '),
            publishedAt: r.updated_at ? r.updated_at.slice(0, 10) : undefined,
        }))
            .filter((it) => it.url);
        return { items };
    },
};
