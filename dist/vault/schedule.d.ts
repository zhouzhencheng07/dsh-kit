import type { DefineTool, ToolDefinition } from '../core/tools.ts';
export interface ScheduleRecurrence {
    type: 'daily' | 'weekly' | 'monthly';
    interval?: number;
    /** weekly 专用：1=周一 … 7=周日 */
    days?: number[];
    /** 结束日期（含当天），缺省无限 */
    end?: string;
}
export interface ScheduleTimeEntry {
    /** 独立计时段（`entries/<id>.json`）的身份；挂在条目里的段不带（随事件文件走） */
    id?: string;
    start: string;
    end?: string;
    note?: string;
}
export interface ScheduleEvent {
    id: string;
    title: string;
    description?: string;
    location?: string;
    /** 有 = 日程；无 = 待办。"YYYY-MM-DDTHH:mm"。日程 start/end 都必填
     *  （end 可落在次日 = 跨天条目）；待办只有 due */
    start?: string;
    end?: string;
    recurrence?: ScheduleRecurrence | null;
    color?: string;
    /** 待办截止 "YYYY-MM-DD" */
    due?: string;
    /** 重复日程里被跳过的那些天（"YYYY-MM-DD"）："删单次"只往这里加一天，
     *  系列本身不动；展开时跳过（见 expandOccurrences） */
    skip?: string[];
    completedAt?: string | null;
    parentId?: string;
    timeEntries?: ScheduleTimeEntry[];
    createdAt: string;
    updatedAt: string;
    /** 单调递增的本地修改序号（对位 CalDAV 的 SEQUENCE）：同步时判断"这条被改过几次"，
     *  不依赖时钟；新建即 1 */
    rev?: number;
}
/** 进行中的计时（`timer.json`）：id 空 = 独立计时（title 是它的自由标题），
 *  否则 id = 挂着计时的那条事件/待办，标题跟条目走 */
export interface ScheduleRunningTimer {
    id: string;
    /** 起表时刻（本地朴素串，带秒：`YYYY-MM-DDTHH:mm:ss`） */
    start: string;
    title?: string;
}
export interface ScheduleData {
    events: ScheduleEvent[];
    /** 独立计时段（未挂条目）闭合后的时段：不进事件/待办列表，统计照计——
     *  没有它，停表即意味着这段时间凭空消失；note=独立计时的自由标题 */
    orphans?: ScheduleTimeEntry[];
    /** 进行中的计时（无 = 空闲） */
    runningTimer?: ScheduleRunningTimer | null;
}
/** 展开后的网格渲染单元（虚拟实例，不落盘） */
export interface Occurrence {
    baseId: string;
    /** "YYYY-MM-DD"（虚拟实例所在日） */
    date: string;
    /** 结束日（含当天）：单日 = date；跨天块按它判"已过去"，客户端按日切片渲染 */
    endDate: string;
    startMins: number;
    /** 缺省 = 无确定结束（渲染按 60 分钟兜底） */
    endMins: number | null;
    /** 后端派生的三态（界面只取用不自己算）：todo 未到 / doing 进行中 / past 已过去 */
    state: 'todo' | 'doing' | 'past';
    title: string;
    color?: string;
    location?: string;
    description?: string;
    /** 重复实例与 base 事件的对应关系（编辑时定位） */
    virtual: boolean;
}
/** schedule_query 返回的结构化条目（agent 拿 id 走 schedule_delete/schedule_update；不进渲染摘要） */
export interface ScheduleItemRef {
    id: string;
    kind: '日程' | '待办' | '已完成待办';
    title: string;
    when: string;
    /** 重复日程：删除的是整个系列 */
    recurring?: boolean;
    /** 待办已逾期（截止时刻一过即算，比到分钟） */
    overdue?: true;
}
export declare function dateStrOf(d: Date): string;
export declare function todayStr(): string;
/** 端点参数校验用（格式对不对，不校验真实日历日） */
export declare function isDateStr(s: string): boolean;
/** 严格日期：格式对 + 真实存在的日历日（2026-02-30 不算）——参数校验用 */
export declare function isRealDateStr(s: string): boolean;
/** "YYYY-MM-DD" → 本地零点 Date；非法返回 null */
export declare function parseDate(s: string): Date | null;
/** "YYYY-MM-DDTHH:mm(:ss)" → 本地 Date；非法返回 null */
export declare function parseDT(s: string): Date | null;
export declare function addDays(dateStr: string, n: number): string;
/** ISO 周一 */
export declare function mondayOf(dateStr: string): string;
/** 标题统一上限（面板输入框 maxLength/计数器、agent 工具同一口径）：标题只放
 *  重要信息，细节写备注——周网格块内标题是识别主体，长标题展示必然截断 */
export declare const SCHED_TITLE_MAX = 16;
/** 日程数据目录：固定 $DSH_HOME/dsh-kit/schedule/（一条一文件），与知识库（vaultRoot）
 *  无关——日程是独立能力，知识库未配置也照常可用 */
export declare function resolveScheduleDir(): string;
export declare class ScheduleStore {
    /** 当前数据目录（构造可注入别的路径供测试；默认 resolveScheduleDir()） */
    dir: string;
    private data;
    /** 盘上签名（每个 json 的 名:体积:mtime + 目录项数）：变了才整库重读。
     *  null = 还没记过 */
    private stamp;
    constructor(dir?: string);
    private eventsDir;
    private entriesDir;
    /** 进行中的计时（单文件；没有文件 = 空闲） */
    private timerFile;
    /** 读进行中的计时。文件缺失 / 坏内容 / 形状不对都当空闲：不挪 .bak——
     *  这是共享目录里别的程序随时在改的活文件，为一次坏读丢掉别人的计时没有意义
     *  （下一次起表就会重写它） */
    private readTimer;
    /** 落 / 撤进行中的计时（空闲 = 删文件，与「目录里没有进行中的表」同义） */
    private writeTimer;
    /** 原子写单个 JSON（tmp + rename）；失败只告警并回 false（内存态仍可用，下次变更
     *  会再试）。调用方删旧文件前必须看这个返回值——没写成还删，条目就从盘上消失了 */
    private writeJson;
    /** 读目录里的 `*.json`；坏单条挪 `.bak` 后跳过，不拖垮整库 */
    private readJsonDir;
    /** 盘上签名：只 stat 不读正文（轮询 30s 一次，这样才便宜）。目录项增删改都
     *  会改到任一文件的体积/mtime 或目录本身的 mtime */
    private diskStamp;
    /** 与盘面对齐后再答：库是共享目录，别的程序与同步随时在写，
     *  启动时读一次就永远看不见那些改动，而且 agent 的更新会把别处改过的版本整条
     *  覆盖掉。签名变了才重读，读写在同一个同步调用里完成。 */
    private sync;
    private load;
    private writeEvent;
    private removeEventFile;
    private writeEntry;
    private removeEntryFile;
    /** 内容变了就推进版本号（同步用它判断"这条被改过几次"，不依赖时钟） */
    private touch;
    list(): ScheduleEvent[];
    /** 独立计时段（不进事件列表，统计与网格展示用）；由计时功能写入，本访问器只读 */
    listOrphans(): ScheduleTimeEntry[];
    create(input: Record<string, unknown>): ScheduleEvent;
    update(id: string, patch: Record<string, unknown>): ScheduleEvent | null;
    remove(id: string): boolean;
    /** 勾选完成 / 取消完成（日程与待办同一动作；completedAt = 完成时刻） */
    setDone(id: string, done: boolean): ScheduleEvent | null;
    /**
     * 起表：`id` 命中条目就挂它计时，否则按 `title` 起一段独立计时。
     * 已有进行中先闭合——两段同时在跑等于这段时间凭空多出一份，谁也说不清自己在干什么。
     * 独立计时必须有名目（网格是时间分配视图，无名目的时段无从识别）。
     */
    startTimer(id: string | null, title: string | null): ScheduleRunningTimer;
    /** 停表：挂条目的段补上 end 留在 timeEntries；独立的段落 entries/<id>.json
     *  （不进列表但统计照计）。无进行中时返回 false */
    stopTimer(): boolean;
    /** 进行中的计时（挂条目的标题现查条目——条目可能在别处被改了名） */
    getRunningTimer(): ScheduleRunningTimer | null;
    /** owner 空 = 独立段（entries/），否则 = 该条目的 timeEntries。返回的是**活数组**
     *  本身（就地改完由调用方触发落盘），空列表就地补上 */
    private entryListOf;
    /** 改一段已闭合的计时（时刻 / 备注）。时刻非法或 end 早于 start 一律拒绝，
     *  不做半截更新；同秒零长段是快速起停的合法存量，只改备注也放行 */
    entryUpdate(owner: string | null, index: number, patch: {
        start?: string | null;
        end?: string | null;
        note?: string | null;
    }): ScheduleTimeEntry | null;
    /** 删一段已闭合的计时（进行中的段先停表）；返回是否真删了 */
    entryDelete(owner: string | null, index: number): boolean;
    occurrences(from: string, to: string): Occurrence[];
    stats(scope: 'day' | 'week' | 'month', date: string, now?: Date): {
        timedMs: number;
        totalMs: number;
        eventCount: number;
        completedCount: number;
        openCount: number;
    };
    /** agent 只看汇总（日/周/月）——schedule_query 工具的产物 */
    summary(scope: 'day' | 'week' | 'month', date: string): string;
    /** summary 的结构化并行视图：时段内条目 id/kind/标题/时间，供 agent 精确
     *  指向（删除/修改）。重复事件按 baseId 去重，待办含已完成（completedAt 落在时段） */
    items(scope: 'day' | 'week' | 'month', date: string): ScheduleItemRef[];
}
export declare function dtStrOf(d: Date, withSeconds?: boolean): string;
export declare function rangeOf(scope: 'day' | 'week' | 'month', date: string): [string, string];
/** 区间内计时合计（按计时段 start 归属日；进行中的不计入；orphans=独立计时段） */
export declare function timedMsInRange(events: ScheduleEvent[], from: string, to: string, orphans?: ScheduleTimeEntry[]): number;
/**
 * 区间 [from, to]（含两端）展开成网格渲染单元，每个实例带 endDate 与 state。
 * - 非重复事件：落在起始日；跨天块按 endDate 判纳入——起始日在窗口前、尾巴
 *   伸进窗口的也产出（客户端按日切片渲染，丢了这条尾巴那几天就空了）
 * - 重复事件：按 type/interval/days/end 在区间内逐日匹配，时刻沿用 base；
 *   候选日同样往前多看 spanDays 天，接住从窗口前一天延续进来的跨天尾巴
 */
export declare function expandOccurrences(events: ScheduleEvent[], from: string, to: string, now?: Date): Occurrence[];
export declare function syncScheduleStore(): ScheduleStore;
/**
 * schedule_create 扁平参数 → store.create 输入。纯函数（测试直接对表）：
 * date+time→start/end（缺 endTime 缺省 +1 小时）、endDate→跨天 end、仅
 * date→due（待办）、repeat* 组装 recurrence（store 层 sanitizeRecurrence 再
 * 兜底一道）。date/time 写错是显式意图，解析失败抛错让模型重试，不静默降级
 * 成别的日子或别的种类。
 * 日程 start/end 都必填（"有 start 就必须有 end"，缺 end 的条目在
 * 应用里判非法改不动），所以这里绝不落"有 start 没 end"的条目：endTime 缺省
 * 由 time+1 小时补出，跨零点则 end 落到次日 00:00。
 * 重复只对日程生效（expandOccurrences 跳过无 start 条目），待办带 repeat
 * 会变成永不展开的死配置，故直接拒绝。
 */
export declare function toolArgsToCreateInput(args: Record<string, unknown>): Record<string, unknown>;
export declare function buildScheduleTools({ defineTool, store, }: {
    defineTool: DefineTool;
    store: ScheduleStore;
}): ToolDefinition[];
