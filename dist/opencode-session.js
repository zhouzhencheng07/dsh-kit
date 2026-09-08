// OpenCode Go 会话头按会话注入（llm/stream 瀑布监听 + 全局 fetch 补丁，同文件实现）
//
// 背景：OpenCode Go 网关要求出站推理请求携带 x-opencode-session（每会话稳定
// ID，网关按它做路由亲和与 prompt 缓存），缺失时 400 MissingSessionID。pi-ai
// 0.84.x 不原生发该头、宿主 compat 白名单不放行亲和开关（证据链见
// .agents/docs/opencode-go-session-header.md）——本模块在插件侧补位：给发往
// opencode / opencode-go 路由、且带会话 id 的模型调用注入
// x-opencode-session: <DSH 会话 id>。值每会话唯一、跨轮次/压缩/重启稳定，
// 不同会话天然散在不同网关副本上，不像静态头那样全部流量共用一个 id 互相挤兑。
//
// 机制（三段，均挂在插件 fiber 上）：
// 1. ctx.on('llm/stream', …, { prepend: true }) 瀑布监听：provider 命中目标
//    集合且带 sessionId 的调用，next() 取到的下游惰性流被包进 withStore——
//    每次 pull 在 AsyncLocalStorage store 内执行，流内真正发起的 fetch 能
//    读到 store。next() 只准调一次（瀑布约定）。
// 2. globalThis.fetch 补丁（只打一次）：store 激活且请求未自带该头时合并注入
//    （init.headers 优先、其次 Request 自带头，同原生优先级）；其余请求原样
//    转发，响应体零接触。
// 3. 生命周期：fetch 补丁挂 ctx.effect，插件停用/卸载时还原；还原只在"当前
//    仍是自己打的补丁"时进行，不破坏后来者的包装。监听随 fiber 注销。
//
// 已知边界与降级：
// - 无 sessionId 的手搓辅助调用不带上下文放行，若打到 opencode-go 会被网关
//   400——实测当前宿主的辅助调用（标题/压缩）都带 sessionId，未触发。
// - settings.yaml 残留同名静态头时，适配层先合并、fetch 层见"已自带"即跳过，
//   静态值静默胜出——两套机制互斥，静态头必须删除。
// - ctx.on / ctx.effect 不可用的宿主形态：相关能力整体降级并告警，不影响其余。
import { AsyncLocalStorage } from 'node:async_hooks';
/** 默认门控的 provider 路由键（pi-ai catalog id；自定义路由键可在此扩展） */
const SESSION_PROVIDERS = new Set(['opencode', 'opencode-go']);
const SESSION_HEADER = 'x-opencode-session';
/** 该模型调用应注入的头值；不满足门控（provider 不命中 / 无会话 id）返回 null */
export function shouldAttach(options, providers) {
    if (typeof options !== 'object' || options === null)
        return null;
    const opts = options;
    if (!providers.has(String(opts.provider)))
        return null;
    if (opts.sessionId === undefined || opts.sessionId === null)
        return null;
    const raw = String(opts.sessionId);
    return raw === '' ? null : raw;
}
/** 出站请求是否已携带会话头（init.headers 优先，其次 Request 自带头） */
function hasSessionHeader(input, init) {
    const source = init?.headers ??
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    if (source === undefined)
        return false;
    try {
        return new Headers(source).has(SESSION_HEADER);
    }
    catch {
        return false;
    }
}
/**
 * 包一层补丁 fetch：store 激活且未自带会话头时注入，其余原样转发。
 * 头合并优先级对齐原生 fetch：init.headers 在前，Request 自带头作底。
 */
export function patchFetch(original, als) {
    return function patchedFetch(input, init) {
        const state = als.getStore();
        if (state && !hasSessionHeader(input, init)) {
            const headers = new Headers((init?.headers ??
                (typeof Request !== 'undefined' && input instanceof Request
                    ? input.headers
                    : undefined)));
            headers.set(SESSION_HEADER, state.value);
            return original.call(this, input, { ...init, headers });
        }
        return original.call(this, input, init);
    };
}
/**
 * 把惰性流的每次 pull 包进 store：next/throw 在 als.run 内驱动下游迭代器，
 * pull 链上发起的 fetch 都能看到 store。return（调用方提前断开）不进 store——
 * 断开路径没有请求要发，下游已销毁时吞异常按完结处理。
 */
export function withStore(iterable, store, als) {
    const iterator = iterable[Symbol.asyncIterator]();
    return {
        [Symbol.asyncIterator]() {
            return this;
        },
        next() {
            return als.run(store, () => iterator.next());
        },
        async return(value) {
            const ret = iterator.return;
            if (typeof ret === 'function') {
                try {
                    return await ret.call(iterator, value);
                }
                catch {
                    // 下游流可能已销毁；按完结处理
                }
            }
            return { done: true, value: undefined };
        },
        async throw(error) {
            const thr = iterator.throw;
            if (typeof thr === 'function') {
                return als.run(store, () => thr.call(iterator, error));
            }
            throw error;
        },
    };
}
/** 注册按会话注入。fetch 补丁即时生效，监听挂在 llm/stream 瀑布最前面 */
export function applyOpenCodeSessionHeader(ctx, log) {
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch !== 'function') {
        log?.('globalThis.fetch 不可用，x-opencode-session 注入未启用');
        return;
    }
    const als = new AsyncLocalStorage();
    const patched = patchFetch(originalFetch, als);
    const restoreFetch = () => {
        if (globalThis.fetch === patched)
            globalThis.fetch = originalFetch;
    };
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
            globalThis.fetch = patched;
            return restoreFetch;
        }, 'opencode-session.fetch-patch');
    }
    else {
        globalThis.fetch = patched;
        log?.('ctx.effect 不可用，fetch 补丁无法随插件卸载还原');
    }
    if (typeof ctx.on !== 'function') {
        restoreFetch();
        log?.('ctx.on 不可用，x-opencode-session 注入未启用');
        return;
    }
    ctx.on('llm/stream', (options, next) => {
        const value = shouldAttach(options, SESSION_PROVIDERS);
        if (!value)
            return next();
        // next() 只调一次；同步异常按原样抛给调用方（适配层派发失败走它自己的路）
        const downstream = next();
        if (typeof downstream !== 'object' ||
            downstream === null ||
            typeof downstream[Symbol.asyncIterator] !== 'function') {
            return downstream;
        }
        return withStore(downstream, { value }, als);
    }, { prepend: true });
}
