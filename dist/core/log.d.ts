export type KitLogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface KitLogEntry {
    ts: number;
    level: KitLogLevel;
    component: string;
    /** op() 作用域路径，`a>b` 表示嵌在 a 里；空 = 不在作用域内 */
    scope: string;
    msg: string;
    fields?: Record<string, unknown>;
}
export interface KitLogger {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
    /** 在 op() 作用域内跑 fn：作用域内日志自动带作用域路径，fn 结束补一条结果行。
     *  fn 返回 Promise 时结果行在 settle 后补写，rejection 照原样抛给调用方。 */
    op<T>(name: string, fn: () => T, fields?: Record<string, unknown>): T;
}
/** 取组件自己的 logger。component 只用组件名（files/vault/…），作用域名另由 op 给 */
export declare function kitLogger(component: string): KitLogger;
