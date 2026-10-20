import { type ScheduleStore } from './schedule.ts';
import type { StudyState } from './study.ts';
/** 保证这一页有一条未完成的复习待办，日期与记录一致；有就改，没有就建 */
export declare function ensureReviewEvent(store: ScheduleStore, rel: string, due: string): void;
/** 完成本次：先把下一次排出来，再把当前这条归档（时间条目跟着归档条目走） */
export declare function completeReviewEvent(store: ScheduleStore, rel: string, nextDue: string): void;
/** 完成这一轮：归档未完成待办，不建下一条 */
export declare function finishReviewEvents(store: ScheduleStore, rel: string): void;
/** 移出学习：删掉该 rel 的全部待办（含已归档的——记录都没了，留着只是脏条目） */
export declare function removeReviewEvents(store: ScheduleStore, rel: string): void;
/** 页面改名 / 移动 / 删除后同步复习待办的链接与标题（目录用前缀）。
 *  newRel = null 表示页面（或整棵目录）已删除：该 rel 与其下所有待办一并删掉。 */
export declare function moveReviewLinks(store: ScheduleStore, oldRel: string, newRel: string | null): void;
/** 启动 / 同步后对齐：在学页每页一条未完成待办；不再 active 的未完成待办清掉。
 *  返回本趟补建的条数（前端据此决定要不要刷新日程列表）。 */
export declare function syncReviewEvents(store: ScheduleStore, active: StudyState[]): number;
