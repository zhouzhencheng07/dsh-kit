// job-tee 输出分流单测（src/job-tee.ts）。
// 场景：官方 job.readOutput 是单游标增量（每次调用返回"自上次调用以来"的新块），tee 后
// 模型侧（包装后的 readOutput）与面板侧（panelReadJobOutput + 调用方自持的绝对偏移）
// 各取各的：模型语义与原版逐位等价，面板从保留窗口里按偏移取——任何一方读取都不得让
// 对方丢量，且刷新页面 / 多开标签页 = 换一个偏移重读，读者之间零耦合。
// 用法（dsh-kit 根）：node tests\test-job-tee.mjs
import { installJobTee, panelReadJobOutput, teeRegistryJobs, JOB_TEE_BUFFER_CAP } from '../src/job-tee.ts'

let failed = 0
const check = (label, cond) => {
  console.log(`${cond ? "PASS  " : "FAIL  "}${label}`)
  if (!cond) failed++
}

/** 造一个带单游标 readOutput 的 job：producer 每产出一段，readOutput 就多吐一段。 */
function makeJob(producer) {
  return { id: 'pwsh-1', status: 'running', readOutput: () => producer.shift() ?? '' }
}

/** 造一个自持 pending 的 job（可以随时往里追加产出）。 */
function makeLiveJob() {
  let pending = ''
  const job = {
    id: 'pwsh-live',
    status: 'running',
    readOutput: () => {
      const text = pending
      pending = ''
      return text
    },
  }
  return { job, emit: (text) => { pending += text } }
}

// 1) 面板不参与时，模型路径与原版逐位一致：读一次拿一段
{
  const job = makeJob(['a', 'b', 'c'])
  installJobTee(job)
  check('仅模型读：第一段 a', job.readOutput() === 'a')
  check('仅模型读：第二段 b', job.readOutput() === 'b')
  check('仅模型读：第三段 c', job.readOutput() === 'c')
  check('仅模型读：读空后空串', job.readOutput() === '')
}

// 2) 面板按偏移取：首读（偏移 0）看窗口全量，之后带 next 取增量
{
  const job = makeJob(['a', 'b', 'c'])
  installJobTee(job)
  const first = panelReadJobOutput(job)
  check('面板首读从头拿全量 a', first.text === 'a')
  check('首读窗口坐标：base 0 / next 1 / 未截断', first.base === 0 && first.next === 1 && first.truncated === false)
  const second = panelReadJobOutput(job, first.next)
  check('面板带 next 取增量 b', second.text === 'b' && second.next === 2)
  const third = panelReadJobOutput(job, second.next)
  check('面板继续取增量 c', third.text === 'c' && third.next === 3)
  check('无新量时重复带末尾偏移读：空串（终态任务重复拉不会重复追加）', panelReadJobOutput(job, third.next).text === '')
}

// 3) 面板读取不抢模型的量：面板读走的，模型下次照样按"自上次读取以来"拿到
{
  const job = makeJob(['a', 'b', 'c'])
  installJobTee(job)
  check('模型读 a', job.readOutput() === 'a')
  check('面板首读仍从窗口头拿 ab（含模型已读前缀）', panelReadJobOutput(job).text === 'ab')
  check('模型再读 bc——面板读走的量不丢，增量完整', job.readOutput() === 'bc')
  check('模型无新量：空串', job.readOutput() === '')
}

// 4) 刷新页面：新页面偏移回到 0，从保留窗口头重读（不是只能看增量）
{
  const { job, emit } = makeLiveJob()
  installJobTee(job)
  emit('line1\nline2\n')
  const pageA = panelReadJobOutput(job)
  check('页面A 首读拿全量', pageA.text === 'line1\nline2\n')
  emit('line3\n')
  check('页面A 第 2 次轮询拿增量', panelReadJobOutput(job, pageA.next).text === 'line3\n')
  const pageB = panelReadJobOutput(job)
  check('刷新后的新页面（偏移 0）重读窗口全量', pageB.text === 'line1\nline2\nline3\n')
  check('刷新后继续取增量：无新量即空串', panelReadJobOutput(job, pageB.next).text === '')
}

// 5) 多标签页：两个读者各带各的偏移，谁也没被瓜分
{
  const { job, emit } = makeLiveJob()
  installJobTee(job)
  emit('x1\n')
  const tabA = panelReadJobOutput(job, 0)
  const tabB = panelReadJobOutput(job, 0)
  check('两个标签页首读都拿到同一份全量', tabA.text === 'x1\n' && tabB.text === 'x1\n')
  emit('x2\n')
  const tabA2 = panelReadJobOutput(job, tabA.next)
  const tabB2 = panelReadJobOutput(job, tabB.next)
  check('两个标签页各自取到完整增量', tabA2.text === 'x2\n' && tabB2.text === 'x2\n')
}

// 6) 安装幂等：重复 install 不会二次包装（模型游标不被双份切片）
{
  const job = makeJob(['x', 'y'])
  installJobTee(job)
  installJobTee(job)
  check('幂等：模型读 x', job.readOutput() === 'x')
  check('幂等：模型读 y（无重复消费）', job.readOutput() === 'y')
}

// 7) 无 readOutput 的任务：运行中空串，终态回落 outcome.output（官方语义）
{
  const job = { id: 'k-1', status: 'running', output: undefined }
  const running = panelReadJobOutput(job)
  check('无 readOutput 运行中：空窗口', running.text === '' && running.next === 0)
  job.status = 'completed'
  job.output = 'final output'
  const done = panelReadJobOutput(job)
  check('无 readOutput 终态：回落 output', done.text === 'final output')
  check('无 readOutput 终态：带末尾偏移重复读不重复追加', panelReadJobOutput(job, done.next).text === '')
}

// 8) teeRegistryJobs：创建即装分身——新 job 的 readOutput 已是包装版（走 buffer 切片）
{
  const store = new Map()
  let n = 0
  const registry = {
    store,
    start(spec) {
      n += 1
      const job = { id: `${spec.kind}-${n}`, status: 'running', readOutput: () => (spec.pull ?? (() => ''))() }
      store.set(job.id, job)
      return job.id
    },
  }
  teeRegistryJobs(registry)
  const pulled = []
  const id = registry.start({ kind: 'pwsh', pull: () => pulled.shift() ?? '' })
  const job = store.get(id)
  pulled.push('p1')
  check('start 包装：模型读经 tee（p1）', job.readOutput() === 'p1')
  pulled.push('p2')
  check('start 包装：面板首读全量 p1p2', panelReadJobOutput(job).text === 'p1p2')
  pulled.push('p3')
  check('start 包装：模型再读 p2p3（互不抢量）', job.readOutput() === 'p2p3')
}

// 9) registry 形状不符时静默不装（不抛错）
{
  teeRegistryJobs({})
  teeRegistryJobs({ start: () => 'x' })
  check('形状不符静默不装', true)
}

// 10) 保留窗口：按上限丢最旧，读者进度不回收缓冲（后来打开的读者仍能重读历史）
{
  // 10a) 双方都在读：窗口整体留着——面板随时能重读全量（代价是每任务最多占 CAP 内存）
  let pending = 0
  const job = { id: 'win-a', status: 'running', readOutput: () => (pending > 0 ? ((pending -= 1), 'z'.repeat(1024)) : '') }
  const st = installJobTee(job)
  pending = 30
  for (let i = 0; i < 30; i++) {
    job.readOutput()
    panelReadJobOutput(job)
  }
  check('双方都在读：窗口整体保留，不按读者进度回收', st.buffer.length === 30 * 1024)
  const late = panelReadJobOutput(job)
  check('后来才打开的读者首读仍拿到整段历史', late.text.length === 30 * 1024 && late.base === 0)

  // 10b) 一方长期不读：缓冲封顶在 CAP，保留最新尾巴；落后于窗口的偏移被判截断
  const CHUNK = 256 * 1024
  let n = 0
  const big = { id: 'win-b', status: 'running', readOutput: () => (n < 40 ? `${n++}|` + 'x'.repeat(CHUNK - 8) : '') }
  const st2 = installJobTee(big)
  for (let i = 0; i < 40; i++) panelReadJobOutput(big)
  check('缓冲封顶不超 CAP', st2.buffer.length <= JOB_TEE_BUFFER_CAP)
  check('保留的是最新尾巴（含最后一段标记）', st2.buffer.includes('39|'))
  check('最旧已丢弃（不含第一段标记）', !st2.buffer.includes('0|'))
  check('窗口起点前移（base > 0）', st2.base > 0)
  const behind = panelReadJobOutput(big, 16)
  check('落后于窗口的读者：从窗口头给起并标记截断', behind.truncated === true && behind.text.length === st2.buffer.length)
  const modelTail = big.readOutput()
  check('模型读：拿到保留尾巴且不超 CAP', modelTail.length > 0 && modelTail.length <= JOB_TEE_BUFFER_CAP && modelTail.includes('39|'))
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
