/** 摘掉 ELECTRON_RUN_AS_NODE、凭证类与 DSH_* 变量，其余原样保留 */
export declare function scrubbedChildEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
