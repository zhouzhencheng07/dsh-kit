export interface PoolGitCommit {
    sha: string;
    short: string;
    /** 提交时间（epoch 秒） */
    time: number;
    subject: string;
    files: number;
    insertions: number;
    deletions: number;
    /** 这次提交涉及的文件（相对技能目录），可点开看该文件的改动 */
    names: string[];
}
export interface PoolGitState {
    available: boolean;
    init: boolean;
    /** init=false 的原因：no-git | not-a-dir | init-failed */
    reason?: string;
    /** 未提交的文件数（插件不会自己提交，等一次有意提交） */
    dirty: number;
    last: {
        sha: string;
        short: string;
        time: number;
        subject: string;
    } | null;
    commits: PoolGitCommit[];
}
interface CommitResult {
    ok: boolean;
    committed: boolean;
    error?: string;
}
/**
 * 把面板/agent 给的提交信息整理成 subject + body：第一行当主题（截到 200 字），其余当正文。
 * 空信息直接判非法——提交信息是这套版本记录唯一的信息来源，不能又变成机器生成的空话。
 */
export declare function splitCommitMessage(raw: string): {
    ok: boolean;
    subject?: string;
    body?: string;
    error?: string;
};
/** 还没有历史就记一条基线（进池时的状态）；已有历史立刻返回，不做任何提交 */
export declare function ensurePoolBaseline(skillDir: string): Promise<void>;
/**
 * 给池里还没有基线的技能补一遍（串行——同时起几十个 git 没必要）。
 * 启动时跑一次；面板打开某个技能的版本面板时，那个技能自己补（见 poolGitState）。
 *
 * 读技能**列表**不碰 git：那里每拉一次就为每个池技能起两个 git 进程，而 git 子进程的
 * CWD 正是技能目录——Windows 上会短暂锁住它，紧接着的出池/删除就会 EPERM（实测踩到）。
 */
export declare function ensurePoolBaselines(poolDir: string): Promise<void>;
/** 读版本状态：顺带把基线补上（打开面板这个动作本身就是"要看历史"的表示） */
export declare function poolGitState(skillDir: string): Promise<PoolGitState>;
/** 记一版：提交信息由人或 agent 给（空信息拒绝，见 splitCommitMessage） */
export declare function poolGitCommit(skillDir: string, message: string): Promise<CommitResult>;
/**
 * 回滚到某次提交：整树恢复成那次提交的样子，再记一条新提交（历史不重写）。
 * 未提交的改动会被恢复动作覆盖，所以没带 discard 时先拒绝，让调用方明确"就是不要了"。
 */
export declare function poolGitRollback(skillDir: string, sha: string, discard: boolean): Promise<{
    ok: boolean;
    changed: boolean;
    dirty: number;
    error?: string;
}>;
export {};
