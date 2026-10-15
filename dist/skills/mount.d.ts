/** 项目级两根（与 skill-pool 的物理根 id 同名） */
export type ProjectRootId = 'project-dsh' | 'project-agents';
export interface ProjectDirs {
    /** findProjectRoot 的结果：仓库根，或没有仓库时的会话 cwd */
    projectRoot: string;
    dshDir: string;
    agentsDir: string;
}
export interface MountState {
    projectRoot: string;
    /** 载体根所在仓库的根；null = 非仓库（或无 git），忽略只做预防性写入 */
    repoRoot: string | null;
    /** 挂载点（载体根）；null = 这个工作区还没选过，第一次挂载时问用户 */
    carrierRoot: ProjectRootId | null;
    carrierDir: string;
    /** 载体根来自用户选择（已持久化）；false = 还没选过，等用户选 */
    pinned: boolean;
    needsChoice: boolean;
    /** 载体根已被 git 忽略；非仓库为 null */
    ignored: boolean | null;
    /** 载体根下已被仓库跟踪的路径（相对仓库根） */
    tracked: string[];
    /** 载体根里的实体条目数（>0 说明用户在这个根里也放了自己的技能） */
    carrierOwn: number;
}
/** 一条池技能挂载点：链接不随仓库走，这份账也只存机器本地 */
export interface MountRecord {
    /** 池技能目录名（登记表的键） */
    pool: string;
    /** 挂载方项目根 */
    project: string;
    /** 载体根里的链接路径 */
    link: string;
}
/** 记住用户为某个项目选定的载体根（工作区第一次挂池技能时选，之后一直用它） */
export declare function setCarrier(projectRoot: string, carrier: ProjectRootId): void;
/**
 * 批量登记挂载点（按链接路径去重）并返回各池技能的挂载数。
 * 读技能列表时也调它：手工建的链接就此进账，失效条目同时被清掉。
 */
export declare function syncMounts(poolDir: string, items: Array<{
    poolSkillDir: string;
    project: string;
    link: string;
}>): Record<string, number>;
/** 删掉一条挂载记录（只记账，断链由调用方做） */
export declare function forgetMount(poolDir: string, link: string): void;
/** 某个池技能当前有效的挂载点（读的时候顺带清理失效条目） */
export declare function liveMounts(poolDir: string, poolSkillDir: string): MountRecord[];
/** 读某个载体根的当前状态（只读，不写盘）：忽略状态、已跟踪内容；carrier=null 表示还没选过 */
export declare function mountStateFor(dirs: ProjectDirs, carrier: ProjectRootId | null): Promise<MountState>;
/** 本工作区已选定的载体根状态（没选过时 carrierRoot=null、needsChoice=true） */
export declare function computeMountState(dirs: ProjectDirs): Promise<MountState>;
export interface PrepareResult {
    ok: boolean;
    error?: string;
    /** 从仓库索引移除的路径（相对仓库根；文件都还在） */
    untracked?: string[];
    ignoreFile?: string;
    wroteIgnore?: boolean;
}
/**
 * 把载体根一次处理到可挂载：写忽略规则并自检生效 + 从仓库索引移除（文件保留）。
 * 未忽略的载体根不能挂载——一挂，池里的内容就会被项目仓库当普通文件收进去。
 * **忽略在前、索引在后**：索引改动没法回退，忽略那一步失败时索引还没动过。
 */
export declare function prepareCarrier(state: MountState): Promise<PrepareResult>;
/** 建一条指向池技能的目录链接（Windows junction 免管理员；POSIX 目录 symlink） */
export declare function mountLink(poolSkillDir: string, carrierDir: string): {
    ok: boolean;
    path?: string;
    error?: string;
};
/** 断链：只删链接本身，绝不递归进目标（池里的本体不受影响） */
export declare function unmountLink(linkPath: string): {
    ok: boolean;
    error?: string;
};
