/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>;
export declare const Config: any;
export declare function apply(ctx: any, config?: KitSettings): Promise<void>;
export {};
