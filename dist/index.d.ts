export declare const name = "dsh-kit";
interface KitCtx {
    inject(deps: string[], cb: (svc: any) => void): void;
}
export declare function apply(ctx: KitCtx): Promise<void>;
export {};
