export interface GitResult {
    ok: boolean;
    out: string;
    err: string;
}
/** 跑一条 git 命令；超时按失败处理（杀掉子进程） */
export declare function runGit(args: string[], cwd: string, timeoutMs?: number): Promise<GitResult>;
/** git 是否可用；探测结果按进程缓存（无 git 的机器上不必每次改动都试一遍） */
export declare function gitAvailable(): Promise<boolean>;
