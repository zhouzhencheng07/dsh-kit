/** 批量移入回收站。返回与 targets 等长的逐项结果（true=已消失）。 */
export declare function recycleDeleteBatch(targets: string[]): Promise<boolean[]>;
/** 单目标移入回收站；true=已消失。目标类型（文件/目录）现场探测。 */
export declare function recycleDelete(target: string): Promise<boolean>;
