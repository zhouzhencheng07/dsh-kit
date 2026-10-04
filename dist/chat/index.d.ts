/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>;
interface KitCtx {
    inject(deps: string[], cb: (svc: any) => void): void;
    effect(fn: () => void | (() => void), label?: string): void;
}
export declare const name = "dsh-kit/chat";
export declare const Config: any;
export declare function apply(ctx: KitCtx, config?: KitSettings): Promise<void>;
export {};
