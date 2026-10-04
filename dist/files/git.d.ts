export interface GitBranchStatus {
    branch: string;
    upstream: string | null;
    ahead: number;
    behind: number;
    gone: boolean;
    detached: boolean;
    unborn: boolean;
}
/**
 * 解析 `git status --porcelain -b` 的分支头行（以 "## " 开头）。
 *
 * 输入形态（git 实际输出）：
 *   ## main
 *   ## main...origin/main
 *   ## main...origin/main [ahead 1]
 *   ## main...origin/main [ahead 1, behind 2]
 *   ## main...origin/main [gone]
 *   ## HEAD (no branch)               ← 分离头
 *   ## No commits yet on main         ← 无提交的新分支
 *
 * 返回 {branch, upstream, ahead, behind, gone, detached, unborn}；解析不出分支名时
 * branch 为 ''（端点侧当 "无分支" 处理）。
 */
export declare function parseStatusBranch(line: unknown): GitBranchStatus;
/** 记录/字段分隔符（0x1E / 0x1F）：与 ./index.ts 的 git log --pretty=format 约定一致 */
export declare const LOG_RS: string;
export declare const LOG_FS: string;
export interface LogRecord {
    H: string;
    h: string;
    /** 父提交哈希（merge 提交多个；根提交为空数组）——图谱 lane 由前端从它计算 */
    p: string[];
    an: string;
    /** 作者时间 unix 秒（%at，前端做相对时间/绝对时间展示） */
    at: number;
    s: string;
    d: string;
}
/**
 * 解析 `git log --pretty=format:%H%x1f%P%x1f%h%x1f%an%x1f%at%x1f%s%x1f%D%x1e` 输出
 * → 结构化提交记录。记录按 %x1e 分隔、字段按 %x1f 分隔（git 在记录间还会补 \n，
 * 这里一并剥掉）；解析失败一律返回安全默认值而非抛错。宿主不做任何图谱几何，
 * lane 分配在浏览器半边（bundle.js computeCommitGraph）从 p 计算。
 */
export declare function parseLogRecords(out: unknown): LogRecord[];
export interface GitBranchInfo {
    name: string;
    isHead: boolean;
    upstream: string;
    track: string;
}
/**
 * 解析 `git branch --format=%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)\x1f%(upstream:track)` 输出
 * → {current, branches:[{name, isHead, upstream, track}]}。分离头时 git 会给一行
 * refname:short="(HEAD detached at <hash>)" 且 HEAD="*"，current 即该行；空库（无
 * 分支）返回空数组。
 */
export declare function parseBranchList(out: unknown): {
    current: GitBranchInfo | null;
    branches: GitBranchInfo[];
};
/**
 * 解析 `%(upstream:track)` 的方括号段：'[ahead 1, behind 2]' / '[ahead 1]' /
 * '[gone]' / ''。解析不出数字返回 null（调用方视为无上游信息）。
 */
export declare function parseTrack(text: unknown): {
    ahead: number;
    behind: number;
    gone: boolean;
} | null;
export type GitDecoration = {
    kind: 'head';
    name: string;
    pointsTo: string | null;
} | {
    kind: 'tag' | 'remote' | 'branch';
    name: string;
};
/**
 * 解析 git log %D（引用装饰）→ 有序装饰列表。
 * 元素：HEAD -> main / main / origin/main / tag: v0.3.0 / HEAD（分离头）。
 * kind: 'head' | 'branch' | 'remote' | 'tag'；'head' 的 pointsTo 为指向的分支名
 * （HEAD 单独出现时为 null = 分离头）。
 */
export declare function parseDecoration(text: unknown): GitDecoration[];
