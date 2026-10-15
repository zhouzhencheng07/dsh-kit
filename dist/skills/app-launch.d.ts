/** 本平台由本模块启动的应用 id。非 Windows 没有这个标记问题，一律走官方路由 */
export declare function managedAppIds(): string[];
/** 展开 %NAME% 引用；有未定义的名字就返回 null（与官方候选路径的展开同语义） */
export declare function expandEnvRefs(text: string, env?: NodeJS.ProcessEnv): string | null;
/** 取 reg query 输出里第一个字符串值（默认值那一列）：值名会本地化（(默认) / (Default)），
 *  所以按 REG_* 类型列取——与官方解析卸载记录同一条判据。 */
export declare function parseRegStringValue(dump: string, env?: NodeJS.ProcessEnv): string | null;
/** 应用的启动器绝对路径：App Paths 优先，再退默认安装位置；两者都没有返回 null */
export declare function resolveAppLauncher(app: string, env?: NodeJS.ProcessEnv): string | null;
/** 起一个不随宿主退出的启动器进程；启动成功（含窗口内退 0、窗口结束仍在跑）返回 true */
export declare function startApp(exe: string, args: string[], watchMs?: number): Promise<boolean>;
