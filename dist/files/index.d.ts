import http from 'node:http';
interface KitWebRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
}
interface KitWebServer {
    register(route: KitWebRoute): () => void;
    port: number;
}
interface KitWebCtx {
    webServer: KitWebServer;
    effect(fn: () => void | (() => void), label?: string): void;
}
/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>;
export declare const Config: any;
export declare const name = "dsh-kit-files";
export declare function apply(ctx: {
    inject(deps: string[], cb: (svc: KitWebCtx) => void): void;
    effect(fn: () => void | (() => void), label?: string): void;
}, config?: KitSettings): void;
export {};
