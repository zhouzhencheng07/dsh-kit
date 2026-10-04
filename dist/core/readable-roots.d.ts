/** 根的提供方：现求值（配置可热改，返回 null/'' = 这个根当前不可用）；入参是请求带的 cwd */
export type ReadableRootProvider = (cwd: string) => string | string[] | null;
/** 注册一个根来源；返回注销函数（组件行关闭/热卸载时用） */
export declare function registerReadableRoot(id: string, provider: ReadableRootProvider): () => void;
/** 当前生效的根集合（真实路径；不存在的、被注销的、空串一律剔除） */
export declare function readableRoots(cwd?: unknown): string[];
/** target 是否落在任一根内。默认**根自身不算内**（读端点要的是根下的文件）；
 *  列目录端点把 allowRoot 打开——树根就是 cwd / 库根本身，列它才是入口 */
export declare function withinReadable(target: string, roots: string[], allowRoot?: boolean): boolean;
