// 宿主侧输出侧熔断器的直测（tests/test-loop-breaker.mjs）
//
// 熔断器本体是 TS，跑测试前需 pnpm build（本脚本读 dist 产物，与
// test-schedule / test-vault-git 同一口径）。覆盖：
//   ① 复读/绕圈/超长三种输入都会 cancel，且 cause 带我们写的 reason；
//   ② 正常长输出不 cancel；
//   ③ 开关关着不 cancel；配置读不到不 cancel；
//   ④ 一次 attempt 只熔断一次（不反复 cancel）；
//   ⑤ start 帧重置累积（新 attempt 不受上次影响）；
//   ⑥ 注销后不再监听。
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist', 'monitor', 'loop-breaker.js')
if (!existsSync(dist)) {
  console.error(`缺 ${dist}——先跑 pnpm build`)
  process.exit(1)
}

const { registerLoopGuard, LOOP_CANCEL_REASON } = await import(`file://${dist.replace(/\\/g, '/')}`)

let failed = 0
const check = (label, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label)
  if (!ok) failed++
}

/** 最小 ctx 桩：只实现 on 与派发 */
function makeCtx() {
  const listeners = new Map()
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
      return () => {
        const arr = listeners.get(event) || []
        const i = arr.indexOf(fn)
        if (i >= 0) arr.splice(i, 1)
      }
    },
    fire(event, payload) {
      for (const fn of listeners.get(event) || []) fn(payload)
    },
    count(event) {
      return (listeners.get(event) || []).length
    },
  }
}

function makeAgent() {
  const cancels = []
  return { cancels, cancel: (cause) => cancels.push(cause) }
}

/** 逐帧推文本（模拟 provider 的流式切片） */
function stream(ctx, agent, text, { chunkSize = 7, start = true } = {}) {
  if (start) ctx.fire('agent/assistant-stream', { agent, frame: { type: 'start', index: 0 } })
  let i = 0
  for (; i < text.length; i += chunkSize) {
    ctx.fire('agent/assistant-stream', {
      agent,
      frame: { type: 'chunk', index: i, chunk: { type: 'text-delta', index: 0, text: text.slice(i, i + chunkSize) } },
    })
  }
}

const CFG = { monitorEnabled: true, monitorRepeatThreshold: 3, monitorStepMaxChars: 60000 }
const withCfg = (over = {}) => () => ({ ...CFG, ...over })

// —— ① 三种形态都会熔断，且 cause 带 reason ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  stream(ctx, a, '换一种方式继续推进任务。'.repeat(30))
  check('绕圈复读触发熔断', a.cancels.length === 1)
  check('熔断 cause 带我们写的 reason', a.cancels[0]?.kind === 'hook' && a.cancels[0]?.reason === LOOP_CANCEL_REASON)
}
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  stream(ctx, a, '前文正常叙述。' + 'ABCDEFGH'.repeat(10))
  check('尾部整块重复触发熔断', a.cancels.length === 1)
}
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg({ monitorStepMaxChars: 20000 }) })
  const a = makeAgent()
  stream(ctx, a, '内容互不重复但一直吐字。'.repeat(2000), { chunkSize: 40 })
  check('单步输出过长触发熔断', a.cancels.length === 1)
}

// —— ② 正常长输出不熔断 ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  // 真实长回答：三段各不相同的分析，不含任何重复单元
  const normal =
    '我先看一下这个文件的结构，确认它把哪些能力挂在根 exports 上。' +
    '接着检查 package.json 的 exports 字段是否与文档一致，若不一致则需要同步更新。' +
    '最后跑一次类型检查确认没有引入新的错误，然后把结论写到活页里。'
  stream(ctx, a, normal)
  check('正常长输出不熔断', a.cancels.length === 0)
}
{
  // 「把刚才那段复述一遍」是正常输出，只走一个完整周期，不该判成循环
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  const para =
    '让我检查一下这个错误。\n第一步：定位文件。\n第二步：读取配置。\n第三步：修改代码。\n'
  stream(ctx, a, para + para)
  check('复述一遍完整段落不误伤（只走一个周期）', a.cancels.length === 0)
}
{
  // 但连着绕三圈就必须抓
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  const para =
    '让我检查一下这个错误。\n第一步：定位文件。\n第二步：读取配置。\n第三步：修改代码。\n'
  stream(ctx, a, para + para + para)
  check('连绕三圈被熔断（≥2 个周期）', a.cancels.length === 1)
}
{
  // 模板化排版句：句式固定但各项内容不同
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  stream(
    ctx,
    a,
    '让我检查一下这个错误。\n第一步：定位 bundle.js。\n第二步：读取配置。\n第三步：修改代码。\n' +
      '让我检查一下这个报错。\n第一步：定位 host.ts。\n第二步：读取 schema。\n第三步：修改注释。\n',
  )
  check('模板化排版句不误伤（各项内容不同）', a.cancels.length === 0)
}

// —— ③ 开关关着 / 配置读不到，都不熔断 ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg({ monitorEnabled: false }) })
  const a = makeAgent()
  stream(ctx, a, '换一种方式继续推进任务。'.repeat(30))
  check('总开关关着不熔断', a.cancels.length === 0)
}
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => { throw new Error('服务异常') } })
  const a = makeAgent()
  stream(ctx, a, '换一种方式继续推进任务。'.repeat(30))
  check('配置读不到不熔断（放行而非误杀）', a.cancels.length === 0)
}

// —— ④ 一次 attempt 只熔断一次 ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  ctx.fire('agent/assistant-stream', { agent: a, frame: { type: 'start', index: 0 } })
  for (let i = 0; i < 60; i++) {
    ctx.fire('agent/assistant-stream', {
      agent: a,
      frame: { type: 'chunk', index: i, chunk: { type: 'text-delta', index: 0, text: '换一种方式继续推进任务。' } },
    })
  }
  check('同一次 attempt 只熔断一次', a.cancels.length === 1)
}

// —— ⑤ start 帧重置累积：新 attempt 不受上次影响 ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  // 第一个 attempt 快到阈值但没到
  stream(ctx, a, '正在检查第一个方案的实现细节，看看它是否覆盖了全部入口。', { start: true })
  // 第二个 attempt 全新 start，文本完全不同
  stream(ctx, a, '换个方向：先读配置文件确认字段默认值，再决定是否要改。', { start: true })
  check('新 attempt 重置累积（不会跨 attempt 误判）', a.cancels.length === 0)
}

// —— ⑥ 非文本块不参与累积 ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  ctx.fire('agent/assistant-stream', { agent: a, frame: { type: 'start', index: 0 } })
  for (let i = 0; i < 200; i++) {
    ctx.fire('agent/assistant-stream', {
      agent: a,
      frame: { type: 'chunk', index: i, chunk: { type: 'tool-call-delta', index: 0, raw: 'x'.repeat(50) } },
    })
  }
  check('工具调用块不参与输出侧判据', a.cancels.length === 0)
}

// —— ⑦ 注销后不再监听 ——
{
  const ctx = makeCtx()
  const dispose = registerLoopGuard(ctx, { readSettings: withCfg() })
  dispose()
  const a = makeAgent()
  stream(ctx, a, '换一种方式继续推进任务。'.repeat(30))
  check('注销后不再熔断', a.cancels.length === 0)
  check('注销后监听器已摘除', ctx.count('agent/assistant-stream') === 0)
}

// —— ⑧ 多个 agent 各自独立记账 ——
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: withCfg() })
  const a = makeAgent()
  const b = makeAgent()
  stream(ctx, a, '换一种方式继续推进任务。'.repeat(30))
  stream(ctx, b, '另一段完全不同的内容，用于验证不同 agent 之间互不影响，各自独立记账。')
  check('每个 agent 独立记账（只有 loop 那个被熔断）', a.cancels.length === 1 && b.cancels.length === 0)
}

// 判据本身的直测（loop-guard.ts）——客户端那份是手抄的，这里钉住共同真源
{
  const guard = await import(`file://${join(here, '..', 'dist', 'monitor', 'loop-guard.js').replace(/\\/g, '/')}`)
  check('tailRepeatCount：逐字复读检出', guard.tailRepeatCount('我不能继续回答这个问题。'.repeat(5)) >= 3)
  check('cyclePeriod：绕圈复读检出', guard.cyclePeriod('让我再确认一下这个结论是否正确'.repeat(12)) > 0)
  check('cyclePeriod：正常长文不误报', guard.cyclePeriod('模型的正常回答句式变化丰富，用词与结构都不重复，句子长短也不一致。') === 0)
  check('looksLooped：正常文本不误报', guard.looksLooped('这是一次完全正常的回答，内容丰富且不重复。', 3, 60000) === false)
  check('looksLooped：空串安全', guard.looksLooped('', 3, 60000) === false)
  check('looksLooped：超长兜底生效', guard.looksLooped('不重复但很长'.repeat(3000), 3, 20000) === true)
}

console.log(failed === 0 ? '\nALL LOOP-BREAKER TESTS PASS' : `\nFAILED: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
