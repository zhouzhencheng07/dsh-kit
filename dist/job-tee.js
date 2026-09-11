// 后台任务输出 tee（分身）：官方 job.readOutput 是单游标增量（生产者闭包自持
// "自上次调用以来"的缓冲），面板与模型侧 job_output 谁调用谁拿走，天然互抢。
// 这里把底层 readOutput 降级为"取新块"：任何人读取时先把新块排水进公共 buffer，
// 再按各自游标切片——模型游标由包装后的 readOutput 服务（语义与原先等价：自
// 模型上次读取以来的增量），面板游标由 panelReadJobOutput 服务。两边独立且都
// 看到全量；面板不轮询时模型路径与原版逐位一致（读一次排一次、切自己游标）。
// 安装时机：teeRegistryJobs 包装 registry.start（创建即装，模型游标从零无重复
// 前缀）+ 面板首次读取兜底补装（晚装时模型此前已读走的前缀会在下次读取重复
// 出现，属极端边角——实际时序下插件 boot 远早于任何任务创建）。
const isTerminal = (status) => status === 'completed' || status === 'killed' || status === 'failed';
const tees = new WeakMap();
/** 公共缓冲上限（导出供单测引用）。长跑任务的输出会一直喂进来，而两个游标可能
 *  长期不读——不设上限就是把该任务的整段历史常驻内存。超限只丢最旧的已读前缀。 */
export const JOB_TEE_BUFFER_CAP = 2 * 1024 * 1024;
/**
 * 追加新块并裁剪缓冲：先丢掉两边游标都已消费的前缀（这是纯省内存，读取语义不变），
 * 再按上限兜底丢最旧——上限触发时未读的旧增量会丢，属刻意的取舍（runaway 日志
 *  不该撑爆宿主内存；两个读取方都按"自上次读取以来的增量"消费，丢的只会是很久
 * 以前没人读的部分）。裁剪后两个游标一起前移，切片起点保持指向同一逻辑位置。
 */
function appendOutput(st, inc) {
    if (inc === '')
        return;
    st.buffer += inc;
    const consumed = Math.min(st.modelCursor, st.panelCursor);
    if (consumed > 0) {
        st.buffer = st.buffer.slice(consumed);
        st.modelCursor -= consumed;
        st.panelCursor -= consumed;
    }
    if (st.buffer.length > JOB_TEE_BUFFER_CAP) {
        const drop = st.buffer.length - JOB_TEE_BUFFER_CAP;
        st.buffer = st.buffer.slice(drop);
        st.modelCursor = Math.max(0, st.modelCursor - drop);
        st.panelCursor = Math.max(0, st.panelCursor - drop);
    }
}
/** 给单个 job 装分身（幂等）：包住 readOutput，模型路径排水 + 按模型游标切片。 */
export function installJobTee(job) {
    const existing = tees.get(job);
    if (existing)
        return existing;
    const st = { buffer: '', modelCursor: 0, panelCursor: 0 };
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
/** 面板侧读取：排水新块后按面板游标切片（首次读即从头看全量）；无 readOutput
 * 的任务维持官方语义（运行中无增量、终态回落 outcome.output）。 */
export function panelReadJobOutput(job) {
    const st = installJobTee(job);
    if (!st.orig)
        return isTerminal(job.status) ? job.output ?? '' : '';
    appendOutput(st, st.orig());
    const text = st.buffer.slice(st.panelCursor);
    st.panelCursor = st.buffer.length;
    return text;
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
