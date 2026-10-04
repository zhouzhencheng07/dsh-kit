import { type LoopHit } from './loop-guard.ts';
/** 熔断原因写进 turn/end 的这个串，前端据此选文案 */
export declare const LOOP_CANCEL_REASON = "dsh-kit:dead-loop";
/** 一路监听所需的最小宿主面（便于直测注入） */
interface GuardCtx {
    on(event: string, listener: (payload: any) => unknown): () => void;
}
interface LoopGuardOptions {
    /** 读当前生效配置（volatile 已解引用） */
    readSettings: () => Record<string, any>;
    /** 造一条模型可见的提醒消息；缺省用宿主 createUserMessage，拿不到就不注入（测试注入用） */
    buildWarning?: (hit: LoopHit) => unknown | null;
}
/**
 * 注册输出侧复读守卫。返回注销函数。
 * @param ctx - 插件 ctx，只需其 `on`（事件注册）；用 inject 等到 `agent` 服务就位
 * @param options - 配置读取口与提醒构造口
 */
export declare function registerLoopGuard(ctx: GuardCtx, options: LoopGuardOptions): () => void;
export {};
