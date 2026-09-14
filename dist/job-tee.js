// 后台任务输出分流（tee）：官方 job.readOutput 是单游标增量（生产者闭包自持
// "自上次调用以来"的缓冲），模型侧 job_output（registry.read → 同一个 readOutput）
// 与面板读取谁调用谁拿走，天然互抢。
// 这里把底层 readOutput 降级为"取新块"：任何人读取时先把新块排水进公共 buffer，
// 模型路径按模型游标切片（语义与原先等价：自模型上次读取以来的增量），面板路径按
// 调用方给的**绝对偏移**切片（src/index.ts 的 /dsh-kit/jobs/output?offset=）。
//
// 面板进度不记在宿主是刻意的：宿主存一份面板游标时，刷新页面/重开标签页的新面板只能
// 拿到"自上次读取以来"的增量，之前看过的内容即使还在缓冲里也再没有入口；两个标签页
// 同开还会互相瓜分增量，两边都不完整。改成"绝对偏移 + 保留窗口"后，任何新读者都能从
// 窗口头重读全量，读者之间零耦合（模型游标不受影响）。
//
// 安装时机：teeRegistryJobs 包装 registry.start（创建即装，模型游标从零无重复
// 前缀）+ 面板首次读取兜底补装（晚装时模型此前已读走的前缀会在下次读取重复
// 出现，属极端边角——实际时序下插件 boot 远早于任何任务创建）。
const isTerminal = (status) => status === 'completed' || status === 'killed' || status === 'failed';
const tees = new WeakMap();
/** 保留窗口上限（导出供单测引用）。窗口是"面板随时能重读"的唯一来源，所以不按读者
 *  进度回收、只按上限丢最旧：话多的长跑任务（dev server 日志）不设上限就是把整段
 *  历史常驻宿主内存，而读者要的只是"最近的进度与结果"。 */
export const JOB_TEE_BUFFER_CAP = 2 * 1024 * 1024;
/** 追加新块并裁到窗口上限。裁剪后 base 与模型游标一起前移，切片起点保持指向同一
 *  逻辑位置——模型侧因此可能丢掉"很久以前没人读"的增量，属刻意取舍（两个读取方都是
 *  增量消费者，正常滚动读取时窗口足够覆盖）。 */
function appendOutput(st, inc) {
    if (inc === '')
        return;
    st.buffer += inc;
    if (st.buffer.length > JOB_TEE_BUFFER_CAP) {
        const drop = st.buffer.length - JOB_TEE_BUFFER_CAP;
        st.buffer = st.buffer.slice(drop);
        st.base += drop;
        st.modelCursor = Math.max(0, st.modelCursor - drop);
    }
}
/** 给单个 job 装分身（幂等）：包住 readOutput，模型路径排水 + 按模型游标切片。 */
export function installJobTee(job) {
    const existing = tees.get(job);
    if (existing)
        return existing;
    const st = { buffer: '', base: 0, modelCursor: 0 };
    if (typeof job.readOutput === 'function') {
        const orig = job.readOutput;
        st.orig = orig;
        job.readOutput = () => {
            appendOutput(st, orig());
            const text = st.buffer.slice(st.modelCursor);
            st.modelCursor = st.buffer.length;
            return text;
        };
    }
    tees.set(job, st);
    return st;
}
/**
 * 面板侧读取：排水新块后按绝对偏移切片。offset 缺省/0 = 从窗口头看全量（新开面板、
 * 刷新后首读都走这条），此后每次带上一回的 next 取增量；offset 落在窗口之外（被裁）
 * 时从窗口头给起并置 truncated。
 * 无 readOutput 的任务维持官方语义（运行中无增量、终态回落 outcome.output）：把
 * outcome.output 当作 offset 0 起的窗口，重复带末尾偏移读即得空串，不会重复追加。
 */
export function panelReadJobOutput(job, offset = 0) {
    const st = installJobTee(job);
    const want = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    if (!st.orig) {
        const full = isTerminal(job.status) ? job.output ?? '' : '';
        return { text: full.slice(Math.min(want, full.length)), base: 0, next: full.length, truncated: false };
    }
    appendOutput(st, st.orig());
    const end = st.base + st.buffer.length;
    const start = Math.max(want, st.base);
    return { text: st.buffer.slice(start - st.base), base: st.base, next: end, truncated: start > want };
}
/** 包装 registry.start：任务创建即装分身。registry 形状不符（宿主升级换实现）
 * 时静默不装——面板端点会兜底补装，只是模型游标可能带重复前缀。 */
export function teeRegistryJobs(registry) {
    if (typeof registry.start !== 'function' || !(registry.store instanceof Map))
        return;
    const origStart = registry.start.bind(registry);
    registry.start = (spec) => {
        const id = origStart(spec);
        const job = registry.store?.get(id);
        if (job)
            installJobTee(job);
        return id;
    };
}
