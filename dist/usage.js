// dsh-kit 用量与余额宿主半边
//
// 从模型配置发现 provider（settings 的 llm-pi-ai 命名空间，providers.<id>.apiKeyEnv
// 是凭证引用名），经 credentials 服务按引用解析 key（每请求现读，改配置即生效、
// key 不出宿主进程），聚合三家上游给浏览器芯片：
//   deepseek  GET {base|api.deepseek.com}/user/balance    Bearer        余额（币种/总额/赠送/充值）
//   opencode  GET {provider.baseURL}/usage                Bearer        rolling(5h)/weekly/monthly 百分比+重置
//   zai       GET {站}/api/monitor/usage/quota/limit      Authorization 原值   5小时/周窗口 credits 用量+重置
// 两家配额上游都是非官方承诺的契约（失效只挂对应卡，见知识库「dsh-kit 用量」页）。
//
// 端点（同源校验同 index.ts；webserver 默认只绑 loopback）：
//   GET /dsh-kit/usage[?fresh=1] → { providers:{deepseek?|opencode?|zai?}, at }
//   卡按配置出现：模型配置里没配对应 provider（且无 DEEPSEEK_API_KEY 引用）就不出卡。
//   usageEnabled 总开关关闭时 403 usage-disabled（前端入口同步隐藏）。
//
// 缓存：每家独立 60s（桌面 + 手机同看不重复打上游）；fresh=1 绕读仍回写。
// 单飞：同一家的并发请求共享一次上游调用。
import http from 'node:http';
import { sameOrigin } from "./web-guard.js";
/** 站点选择：provider id 以 -cn 结尾（如 zai-coding-cn）或名字含 bigmodel 走国内站 */
function zaiBase(id) {
    return /cn$/i.test(id) || /bigmodel/i.test(id) ? 'https://open.bigmodel.cn' : 'https://api.z.ai';
}
/** 上游请求超时 */
const UPSTREAM_TIMEOUT_MS = 15000;
/** 每家上游结果缓存时长：配额窗口变化慢，多客户端同看也不该反复打 */
const CACHE_TTL_MS = 60000;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
/**
 * 扫模型配置里的 providers，按 id / 凭证引用名归类到三种卡位（子串匹配）。
 * 官方内置 deepseek 不在 llm-pi-ai 里，另用标准引用名 DEEPSEEK_API_KEY 兜底探测
 * （resolve 不中即不出卡）。识别不出的一律忽略（如 sensenova 这类无关 provider）。
 */
async function discoverProviders(deps) {
    const found = new Map();
    const add = (d) => {
        if (!found.has(d.kind))
            found.set(d.kind, d);
    };
    const cfg = deps.readProviderConfig();
    const providers = cfg?.providers;
    if (providers !== null && typeof providers === 'object') {
        for (const [id, raw] of Object.entries(providers)) {
            const envRef = str(raw?.apiKeyEnv);
            if (envRef === '')
                continue;
            const base = str(raw?.baseURL);
            if (/deepseek/i.test(id) || /deepseek/i.test(envRef)) {
                add({ kind: 'deepseek', envRef, base: base !== '' ? base.replace(/\/+$/, '') : 'https://api.deepseek.com', bearer: true });
            }
            else if (/opencode/i.test(id) || /opencode/i.test(envRef)) {
                add({ kind: 'opencode', envRef, base: base !== '' ? base.replace(/\/+$/, '') : 'https://opencode.ai/zen/go/v1', bearer: true });
            }
            else if (/zai|glm|bigmodel/i.test(id) || /zai|glm|bigmodel/i.test(envRef)) {
                add({ kind: 'zai', envRef, base: zaiBase(id), bearer: false });
            }
        }
    }
    if (!found.has('deepseek')) {
        // 模型配置没写 deepseek provider 时探测标准引用名（官方内置适配器同款），有才出卡
        const hit = await deps.credentials.resolve?.('DEEPSEEK_API_KEY').catch(() => undefined);
        if (hit?.value)
            add({ kind: 'deepseek', envRef: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com', bearer: true });
    }
    return [...found.values()];
}
async function fetchUpstream(d, key) {
    const headers = { accept: 'application/json' };
    if (d.bearer)
        headers.authorization = `Bearer ${key}`;
    else
        headers.authorization = key;
    let url;
    try {
        url = new URL(d.base + pathOf(d)).href;
    }
    catch {
        return { ok: false, error: `baseURL 非法：${d.base}` };
    }
    let res;
    try {
        res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    }
    catch (error) {
        return { ok: false, error: `请求失败：${error instanceof Error ? error.message : error}` };
    }
    if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200);
        return { ok: false, error: `HTTP ${res.status}${text !== '' ? `：${text}` : ''}` };
    }
    let body;
    try {
        body = await res.json();
    }
    catch {
        return { ok: false, error: '响应不是 JSON' };
    }
    if (d.kind === 'deepseek') {
        const infos = Array.isArray(body?.balance_infos)
            ? body.balance_infos.map((i) => ({
                currency: str(i.currency),
                total: str(i.total_balance),
                granted: str(i.granted_balance),
                toppedUp: str(i.topped_up_balance),
            }))
            : [];
        return { ok: true, available: body?.is_available === true, infos };
    }
    if (d.kind === 'opencode') {
        const u = body?.usage;
        const win = (w) => w === null || typeof w !== 'object'
            ? null
            : { status: str(w.status) || null, percent: Number.isFinite(w.percent) ? w.percent : null, resetsAt: str(w.resetsAt) || null };
        return { ok: true, windows: { rolling: win(u?.rolling), weekly: win(u?.weekly), monthly: win(u?.monthly) } };
    }
    // z.ai：limits[] 里 unit=3 是小时窗（number=5 即 5 小时）、unit=6 是周窗；
    // 百分比/剩余 credits/重置时刻都是现成的
    const limits = Array.isArray(body?.data?.limits)
        ? body.data.limits.map((l) => ({
            kind: l.unit === 3 ? 'hours' : l.unit === 6 ? 'week' : `unit-${String(l.unit)}`,
            number: Number(l.number) || null,
            usage: Number(l.usage) || 0,
            currentValue: Number(l.currentValue) || 0,
            remaining: Number(l.remaining) || 0,
            percentage: Number(l.percentage) || 0,
            nextResetTime: Number(l.nextResetTime) || null,
        }))
        : [];
    return { ok: true, level: str(body?.data?.level) || null, limits };
}
function pathOf(d) {
    if (d.kind === 'deepseek')
        return '/user/balance';
    if (d.kind === 'opencode')
        return '/usage';
    return '/api/monitor/usage/quota/limit';
}
/** 注册 /dsh-kit/usage；返回注销函数（插件卸载时撤路由） */
export function registerUsageRoutes(deps) {
    const cache = new Map();
    const inflight = new Map();
    const getCard = async (d, fresh) => {
        const tag = `${d.envRef}@${d.base}`;
        const hit = cache.get(d.kind);
        if (hit?.tag === tag) {
            if (!fresh && Date.now() - hit.at < CACHE_TTL_MS)
                return hit.value;
            const running = inflight.get(d.kind);
            if (running)
                return running;
        }
        const run = (async () => {
            try {
                const resolved = await deps.credentials.resolve?.(d.envRef).catch(() => undefined);
                if (!resolved?.value)
                    return { ok: false, error: `未配置凭证引用 ${d.envRef}` };
                return await fetchUpstream(d, resolved.value);
            }
            finally {
                inflight.delete(d.kind);
            }
        })();
        inflight.set(d.kind, run);
        const value = await run;
        cache.set(d.kind, { tag, at: Date.now(), value });
        return value;
    };
    return deps.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/usage',
        handler: (req, res) => {
            const json = (code, obj) => {
                res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(obj));
            };
            if (req.method !== 'GET') {
                json(405, { error: 'method not allowed' });
                return;
            }
            if (typeof req.headers.origin === 'string' && req.headers.origin !== '' && !sameOrigin(req)) {
                json(403, { error: 'cross-origin denied' });
                return;
            }
            if (deps.readSettings().usageEnabled !== true) {
                json(403, { error: 'usage-disabled' });
                return;
            }
            const fresh = new URL(req.url ?? '/', 'http://dsh-kit.local').searchParams.has('fresh');
            void (async () => {
                const discovered = await discoverProviders(deps);
                const providers = {};
                await Promise.all(discovered.map(async (d) => {
                    providers[d.kind] = await getCard(d, fresh);
                }));
                json(200, { providers, at: Date.now() });
            })().catch((error) => json(500, { error: error instanceof Error ? error.message : String(error) }));
        },
    });
}
