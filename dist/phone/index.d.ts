export declare const name = "dsh-kit/phone";
interface KitCtx {
    inject(deps: string[], cb: (svc: any) => void): void;
    effect?(fn: () => void | (() => void), label?: string): void;
    /** 宿主目录 picker 后端（未组合该后端时服务不存在） */
    get(name: string): unknown;
}
/** 插件设置的运行时形状（loader 按 Config schema 解析 profile 补丁里的 config 后传入 apply） */
type KitSettings = Record<string, unknown>;
export declare const Config: any;
export declare function apply(ctx: KitCtx, config?: KitSettings): Promise<void>;
export {};
