import { AsyncLocalStorage } from 'node:async_hooks';
/** 该模型调用应注入的头值；不满足门控（provider 不命中 / 无会话 id）返回 null */
export declare function shouldAttach(options: unknown, providers: Set<string>): string | null;
/**
 * 包一层补丁 fetch：store 激活且未自带会话头时注入，其余原样转发。
 * 头合并优先级对齐原生 fetch：init.headers 在前，Request 自带头作底。
 */
export declare function patchFetch(original: typeof fetch, als: AsyncLocalStorage<{
    value: string;
}>): typeof fetch;
/** 迭代器终值类型（下游元素形状对本模块不关心） */
type Downstream = AsyncIterableIterator<unknown>;
/**
 * 把惰性流的每次 pull 包进 store：next/throw 在 als.run 内驱动下游迭代器，
 * pull 链上发起的 fetch 都能看到 store。return（调用方提前断开）不进 store——
 * 断开路径没有请求要发，下游已销毁时吞异常按完结处理。
 */
export declare function withStore(iterable: AsyncIterable<unknown>, store: {
    value: string;
}, als: AsyncLocalStorage<{
    value: string;
}>): Downstream;
/** cordis ctx 里本层用到的最小面（on/effect 均可选：缺失走降级） */
interface KitCtx {
    inject(deps: string[], cb: (svc: any) => void): void;
    effect?(fn: () => void | (() => void), label?: string): void;
    on?(event: string, listener: (...args: any[]) => any, options?: unknown): unknown;
}
/** 注册按会话注入。fetch 补丁即时生效，监听挂在 llm/stream 瀑布最前面 */
export declare function applyOpenCodeSessionHeader(ctx: KitCtx, log?: (message: string) => void): void;
export {};
