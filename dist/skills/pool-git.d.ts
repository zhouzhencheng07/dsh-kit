/** 还没有历史就记一条基线（进池时的状态）；已有历史立刻返回，不做任何提交 */
export declare function ensurePoolBaseline(skillDir: string): Promise<void>;
/**
 * 给池里还没有基线的技能补一遍（串行——同时起几十个 git 没必要）。
 * 启动时跑一次；经面板搬进池的技能由 move 分支当场补。
 *
 * 读技能**列表**不碰 git：那里每拉一次就为每个池技能起两个 git 进程，而 git 子进程的
 * CWD 正是技能目录——Windows 上会短暂锁住它，紧接着的出池/删除就会 EPERM（实测踩到）。
 */
export declare function ensurePoolBaselines(poolDir: string): Promise<void>;
