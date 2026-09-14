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
// 窗口的寿命：随任务记录一起被回收（记录被宿主移除 → WeakMap 失联 → GC），或由面板
// 「关闭」显式 releaseJobWindow 丢掉——那是用户说"这份输出我不需要了"的唯一信号，
// 否则窗口会一直留到会话结束。
//
// 安装时机：teeRegistryJobs 包装 registry.start（创建即装，模型游标从零无重复
// 前缀）+ 面板首次读取兜底补装（晚装时模型此前已读走的前缀会在下次读取重复
// 出现，属极端边角——实际时序下插件 boot 远早于任何任务创建）。

export interface JobRecord {
  id: string
  status: string
  output?: string
  readOutput?: () => string
}

export interface JobOutputTee {
  buffer: string
  /** buffer[0] 的绝对偏移：裁剪后随之前移，读者据此判断自己是否落后于窗口 */
  base: number
  modelCursor: number
  orig?: () => string
  /** 已被 releaseJobWindow 释放：窗口不再收内容，任何读者都读到空 */
  released: boolean
}

/** 面板一次读取的结果：text = [max(offset, base), next) 这一段，next 是下次该带的偏移 */
export interface JobOutputWindow {
  text: string
  base: number
  next: number
  /** 请求的偏移已被裁掉（更早的输出丢了），调用方据此提示读者 */
  truncated: boolean
  /** 该任务的输出已被释放（面板「关闭」），不是"还没产出" */
  released: boolean
}

const isTerminal = (status: string): boolean =>
  status === 'completed' || status === 'killed' || status === 'failed'

const tees = new WeakMap<object, JobOutputTee>()

/** 保留窗口上限（导出供单测引用）。窗口是"面板随时能重读"的唯一来源，所以不按读者
 *  进度回收、只按上限丢最旧（面板「关闭」是另一条出口：显式释放整个窗口）。话多的
 *  长跑任务（dev server 日志）不设上限就是把整段历史常驻宿主内存，而读者要的只是
 *  "最近的进度与结果"。 */
export const JOB_TEE_BUFFER_CAP = 2 * 1024 * 1024

/** 追加新块并裁到窗口上限。裁剪后 base 与模型游标一起前移，切片起点保持指向同一
 *  逻辑位置——模型侧因此可能丢掉"很久以前没人读"的增量，属刻意取舍（两个读取方都是
 *  增量消费者，正常滚动读取时窗口足够覆盖）。 */
function appendOutput(st: JobOutputTee, inc: string): void {
  if (inc === '') return
  st.buffer += inc
  if (st.buffer.length > JOB_TEE_BUFFER_CAP) {
    const drop = st.buffer.length - JOB_TEE_BUFFER_CAP
    st.buffer = st.buffer.slice(drop)
    st.base += drop
    st.modelCursor = Math.max(0, st.modelCursor - drop)
  }
}

/** 给单个 job 装分身（幂等）：包住 readOutput，模型路径排水 + 按模型游标切片。 */
export function installJobTee(job: JobRecord): JobOutputTee {
  const existing = tees.get(job)
  if (existing) return existing
  const st: JobOutputTee = { buffer: '', base: 0, modelCursor: 0, released: false }
  if (typeof job.readOutput === 'function') {
    const orig = job.readOutput
    st.orig = orig
    job.readOutput = () => {
      // 释放后不再排水：模型侧的 job_output 读到空，属"用户已丢弃这份输出"的既定语义
      if (st.released) return ''
      appendOutput(st, orig())
      const text = st.buffer.slice(st.modelCursor)
      st.modelCursor = st.buffer.length
      return text
    }
  }
  tees.set(job, st)
  return st
}

/**
 * 释放某个任务的输出窗口（面板「关闭」用）：丢掉宿主替它保留的那份历史，内存随即归还。
 * 没有分身（从未被读过）的任务也装上并立刻置为已释放——否则之后第一次读取会重新攒出一份。
 * 释放**不可恢复**：此后任何读者（面板、模型侧 job_output）都读到空，刷新页面也一样；
 * 任务记录本身与官方终态 output 不归这里管，仍在宿主手里（那部分生命周期见知识库页）。
 * @returns 是否确实丢掉了已缓存的内容（无缓存时也置为已释放，返回 false）
 */
export function releaseJobWindow(job: JobRecord): boolean {
  const st = installJobTee(job)
  const had = st.buffer.length > 0
  st.released = true
  st.buffer = ''
  st.modelCursor = 0
  return had
}

/**
 * 面板侧读取：排水新块后按绝对偏移切片。offset 缺省/0 = 从窗口头看全量（新开面板、
 * 刷新后首读都走这条），此后每次带上一回的 next 取增量；offset 落在窗口之外（被裁）
 * 时从窗口头给起并置 truncated。
 * 无 readOutput 的任务维持官方语义（运行中无增量、终态回落 outcome.output）：把
 * outcome.output 当作 offset 0 起的窗口，重复带末尾偏移读即得空串，不会重复追加。
 */
export function panelReadJobOutput(job: JobRecord, offset = 0): JobOutputWindow {
  const st = installJobTee(job)
  const want = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  if (st.released) return { text: '', base: st.base, next: st.base, truncated: false, released: true }
  if (!st.orig) {
    const full = isTerminal(job.status) ? job.output ?? '' : ''
    return { text: full.slice(Math.min(want, full.length)), base: 0, next: full.length, truncated: false, released: false }
  }
  appendOutput(st, st.orig())
  const end = st.base + st.buffer.length
  const start = Math.max(want, st.base)
  return { text: st.buffer.slice(start - st.base), base: st.base, next: end, truncated: start > want, released: false }
}

/** 包装 registry.start：任务创建即装分身。registry 形状不符（宿主升级换实现）
 * 时静默不装——面板端点会兜底补装，只是模型游标可能带重复前缀。 */
export function teeRegistryJobs(registry: {
  start: (spec: unknown) => string
  store?: Map<string, JobRecord>
}): void {
  if (typeof registry.start !== 'function' || !(registry.store instanceof Map)) return
  const origStart = registry.start.bind(registry)
  registry.start = (spec: unknown) => {
    const id = origStart(spec)
    const job = registry.store?.get(id)
    if (job) installJobTee(job)
    return id
  }
}
