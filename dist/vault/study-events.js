// dsh-kit/vault 组件的复习待办同步层——复习不是虚拟行：每个在学页在日程里有一条
// 真实待办（events/<id>.json，studyRel 指回页面 rel）。记录（.study/<页名>.json）仍是
// 间隔与历史的真源，本层只负责把「记录的状态」落成日程条目：
//   * 首次学习 / 调整 / 重启 → 保证有且只有一条未完成待办，due 与记录一致
//   * 完成本次复习 → 先建下一条（新 due），再把旧条归档（时间条目跟着归档条走）
//   * 完成这一轮 → 归档未完成待办（不建下一条）
//   * 移出学习 → 删掉该 rel 的全部待办（含已完成）
//   * 改名 / 移动 → 按 rel 或目录前缀改写 studyRel + 标题；删除 → 删条目
//   * 启动 / 同步后对齐 → 在学页补未完成待办、清掉不在学的未完成待办
// 归档 = 勾完成（completedAt）并把截止挪到**实际完成日**，不删条目——历史与计时留在
// 日程里可查；网格 / 清单按 due 落位，留在原计划日会让「提前完成」看起来发生在未来。
import { SCHED_TITLE_MAX, dtStrOf, todayStr } from "./schedule.js";
/** 页面 rel → 日程标题（页名，与日程标题同一条截断规则） */
function titleOf(rel) {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    return name.trim().slice(0, SCHED_TITLE_MAX);
}
/** 该页未完成的复习待办 id 列表（理论上只有一条；历史上重复建过就收成一条） */
function openIds(store, rel) {
    return store
        .list()
        .filter((e) => e.studyRel === rel && e.completedAt === undefined)
        .map((e) => e.id);
}
function openEventOf(store, rel) {
    return store.list().find((e) => e.studyRel === rel && e.completedAt === undefined);
}
/** 保证这一页有一条未完成的复习待办，日期与记录一致；有就改，没有就建 */
export function ensureReviewEvent(store, rel, due) {
    if (due === '')
        throw new Error('复习日期为空');
    const ids = openIds(store, rel);
    const title = titleOf(rel);
    const first = ids[0];
    if (first !== undefined) {
        const ev = openEventOf(store, rel);
        if (ev === undefined)
            throw new Error('复习待办不存在');
        if (ev.due !== due || ev.title !== title || ev.studyRel !== rel) {
            const updated = store.update(first, { due, title, studyRel: rel });
            if (updated === null)
                throw new Error('复习待办更新失败');
        }
        // 历史上重复建过就收成一条
        for (const extra of ids.slice(1))
            store.setDone(extra, true);
        return;
    }
    store.create({ title, due, studyRel: rel });
}
/** 归档一条复习待办：勾完成，并把截止挪到实际完成日（completedAt 仍记完成时刻）。
 *  提前完成的复习若留在原计划日，网格要等到未来那一天才显示它「已完成」——完成日
 *  才是它真正发生的那天，历史也按那天算。 */
function archiveReviewEvent(store, id) {
    store.update(id, { due: todayStr(), completedAt: dtStrOf(new Date()) });
}
/** 完成本次：先把下一次排出来，再把当前这条归档（时间条目跟着归档条目走） */
export function completeReviewEvent(store, rel, nextDue) {
    if (nextDue === '')
        throw new Error('复习日期为空');
    const olds = openIds(store, rel);
    store.create({ title: titleOf(rel), due: nextDue, studyRel: rel });
    for (const id of olds)
        archiveReviewEvent(store, id);
}
/** 完成这一轮：归档未完成待办，不建下一条 */
export function finishReviewEvents(store, rel) {
    for (const id of openIds(store, rel))
        archiveReviewEvent(store, id);
}
/** 移出学习：删掉该 rel 的全部待办（含已归档的——记录都没了，留着只是脏条目） */
export function removeReviewEvents(store, rel) {
    const ids = store
        .list()
        .filter((e) => e.studyRel === rel)
        .map((e) => e.id);
    for (const id of ids)
        store.remove(id);
}
/** 页面改名 / 移动 / 删除后同步复习待办的链接与标题（目录用前缀）。
 *  newRel = null 表示页面（或整棵目录）已删除：该 rel 与其下所有待办一并删掉。 */
export function moveReviewLinks(store, oldRel, newRel) {
    if (oldRel === '')
        return;
    const prefix = oldRel + '/';
    const hits = store
        .list()
        .filter((e) => {
        const link = e.studyRel;
        return link !== undefined && (link === oldRel || link.startsWith(prefix));
    });
    for (const ev of hits) {
        const link = ev.studyRel;
        if (link === undefined)
            continue;
        if (newRel === null) {
            store.remove(ev.id);
            continue;
        }
        const next = newRel + link.slice(oldRel.length);
        store.update(ev.id, { studyRel: next, title: titleOf(next) });
    }
}
/** 启动 / 同步后对齐：在学页每页一条未完成待办；不再 active 的未完成待办清掉。
 *  返回本趟补建的条数（前端据此决定要不要刷新日程列表）。 */
export function syncReviewEvents(store, active) {
    let created = 0;
    for (const s of active) {
        const due = s.record.dueAt;
        if (due === undefined)
            continue;
        if (openEventOf(store, s.rel) === undefined)
            created += 1;
        ensureReviewEvent(store, s.rel, due);
    }
    const rels = new Set(active.map((s) => s.rel));
    const stale = store
        .list()
        .filter((e) => e.completedAt === undefined && e.studyRel !== undefined && !rels.has(e.studyRel))
        .map((e) => e.id);
    for (const id of stale)
        store.remove(id);
    return created;
}
