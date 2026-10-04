interface KitCtx {
    inject(deps: string[], cb: (svc: any) => void): void;
    effect(fn: () => void | (() => void), label?: string): void;
}
export declare const name = "dsh-kit/skills";
export declare function apply(ctx: KitCtx): void;
export {};
