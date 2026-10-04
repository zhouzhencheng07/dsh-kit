export declare const name = "dsh-kit";
interface KitCtx {
    inject(deps: string[], cb: (svc: any) => void): void;
    effect?(fn: () => void | (() => void), label?: string): void;
    /** cordis 事件面（llm/stream 瀑布监听用）；缺失时按会话注入整体降级 */
    on?(event: string, listener: (...args: any[]) => any, options?: unknown): unknown;
}
export declare function apply(ctx: KitCtx): Promise<void>;
export {};
