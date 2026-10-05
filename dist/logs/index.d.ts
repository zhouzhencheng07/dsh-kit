import http from 'node:http';
export declare const name = "dsh-kit/logs";
interface KitWebCtx {
    webServer: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
        }): () => void;
    };
}
export declare function apply(ctx: {
    inject(deps: string[], cb: (svc: KitWebCtx) => void): void;
    effect(fn: () => void | (() => void), label?: string): void;
}): void;
export {};
