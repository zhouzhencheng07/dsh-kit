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
/** 一行一事：时间 级别 组件 [作用域] "消息" key=value…；错误附带的 stack 缩进跟在后面 */
export declare function kitLogFormat(entry: KitLogEntry): string;
/** 取组件自己的 logger。component 只用组件名（files/vault/…），作用域名另由 op 给 */
export declare function kitLogger(component: string): KitLogger;
/** 等队列里的待写落盘（单测与宿主退出前用；正常路径不等） */
export declare function kitLogFlush(): Promise<void>;
/** 按给定作用域直接写一条（端点回传用：级别与作用域来自外部文本，由调用方净化） */
export declare function kitLogEmit(level: KitLogLevel, component: string, scope: string, msg: string, fields?: Record<string, unknown>): void;
/** 进程启动头：版本 / 平台 / pid / 日志路径，定位「这是哪一次启动」 */
export declare function kitLogStartup(extra?: Record<string, unknown>): void;
