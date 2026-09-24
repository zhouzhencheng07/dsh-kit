/** 自 start 向上找 .git（目录或文件都算），找不到退回 start 本身（对齐 skill-filesystem 语义）。
 *  git 相关端点也用它定位项目根。 */
export declare function findProjectRoot(start: string): string;
