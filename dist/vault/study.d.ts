/** 页面旁挂目录（点前缀：扫描跳过，不进索引与目录树） */
export declare const STUDY_DIR = ".study";
/** 默认复习表（天）：完成时取「第一个比当前间隔大的档」，到顶停在最后一档 */
export declare const LADDER: readonly number[];
/** 单次间隔上限（天）：改写到离谱大值时夹在这个范围里（下限 1） */
export declare const MAX_INTERVAL = 3650;
/** 历史保留条数：超出丢最旧的（记录本身很小，但别让它无界增长） */
export declare const MAX_HISTORY = 500;
/** 一条历史：首次学习 / 完成一次复习 / 调整 / 完成这一轮 / 重启 */
export interface StudyHistoryEntry {
    /** 本地日期 YYYY-MM-DD */
    at: string;
    /** first / review / adjust / done / restart（跨端只认字符串，不枚举拒收） */
    kind: string;
    intervalDays?: number;
    dueAt?: string;
    reps?: number;
}
export interface StudyRecord {
    /** 恒为 1（读到的其它值按 1 归一） */
    version: number;
    /** 首次学习日 */
    firstLearnedAt: string;
    /** 最近一次完成复习日（还没复习过就没有） */
    lastReviewedAt?: string;
    /** 下次复习日；done 时为空 */
    dueAt?: string;
    /** 当前间隔（天，1..MAX_INTERVAL） */
    intervalDays: number;
    /** 已复习次数（首次学习不算） */
    reps: number;
    status: 'active' | 'done';
    history: StudyHistoryEntry[];
    updatedMs: number;
}
/** 回前端 / 同步层的记录：页面身份 + 最近知识集 + 记录 */
export interface StudyState {
    rel: string;
    name: string;
    /** 最近的祖先知识集（相对库根的目录 rel）；没有就不带这个字段 */
    set?: string;
    record: StudyRecord;
}
/** 页面 rel → 记录文件绝对路径 */
export declare function studyPath(root: string, rel: string): string;
/** rel / dir 入参守卫：口径与 quiz 的 safeQuizRel 同一套（只裁两端分隔符、拒盘符、
 *  拒空段与 . / ..；不额外 trim 空白、不设段数 / 段长上限）。空串合法（= 库根 / 整库）。 */
export declare function safeStudyRel(raw: unknown): string;
/** 页面还在不在（.md / .markdown 任一即算） */
export declare function pageExists(root: string, rel: string): boolean;
/** 页面文件 → 同目录的记录文件（改名 / 移动 / 删除都从页面文件推） */
export declare function siblingOf(pageFile: string): string | null;
/** 页面改名 / 移动后把记录搬过去（没有就什么都不做）。
 *  目录的改名 / 移动不用调它——.study/ 在目录体内，跟着目录一起走。 */
export declare function followPage(oldPage: string, newPage: string): void;
/** 页面被删除时，它的记录文件也要一起进回收站（存在才返回） */
export declare function siblingsForDelete(pageFile: string): string[];
/** 严格解析：缺字段给默认，类型不对整份算坏（半份好记录不留） */
export declare function parseRecord(text: string): StudyRecord | null;
/** 序列化：字段顺序与可选字段的落盘形态固定（两端写出来的字节尽量一致）；
 *  可选字段没值就不带键（与 serde 的 skip_serializing_if 同形） */
export declare function serializeRecord(rec: StudyRecord): string;
/** 默认下一档：表里第一个比当前间隔大的值；到顶就停在最后一档。
 *  当前间隔可以是自定义值（比如 10），所以不能按数组下标算。 */
export declare function nextLadder(current: number): number;
/** 页面最近的祖先知识集（逐级向上找含 .refs.json 的目录；库根不给设知识集） */
export declare function nearestSet(root: string, rel: string): string | undefined;
/** 一页的记录；没标记过 / 坏文件 = null。rel 非法抛错（读端点回 400） */
export declare function get(root: string, rel: string): StudyState | null;
/** 范围内（dir 递归；空 = 整库）的全部记录：学习集面板用 */
export declare function scope(root: string, dir: string): StudyState[];
/** 在学记录（dir 递归；空 = 整库）：启动时对齐复习待办、学习集面板用。
 *  排序按到期日、再按路径。 */
export declare function listActive(root: string, dir: string): StudyState[];
/** 首次学习：建记录，明天开始第一次复习 */
export declare function first(root: string, rel: string): StudyState;
/** 完成本次复习。nextInterval 为空 = 按默认表往上一档；给了就按给的值（自定义）。
 *  只重置间隔，次数继续累计。 */
export declare function complete(root: string, rel: string, nextInterval?: number): StudyState;
/** 只改下一次间隔（不算一次复习，次数不变） */
export declare function adjust(root: string, rel: string, nextInterval: number): StudyState;
/** 完成这一轮：不再排下一次，记录保留，可重启 */
export declare function finish(root: string, rel: string): StudyState;
/** 重启已完成的复习。mode = first（按第一次，1 天）/ last（接着上次的间隔）；
 *  nextInterval 给了就优先用（自定义）。次数与历史继续累计。 */
export declare function restart(root: string, rel: string, mode: string, nextInterval?: number): StudyState;
/** 移出学习：删记录（正常不用；停复习走 finish） */
export declare function remove(root: string, rel: string): boolean;
/** 组件装配时注入 logger（core/log 的 kitLogger）——本模块保持零宿主依赖可单测 */
export declare function setStudyWarn(fn: (msg: string) => void): void;
