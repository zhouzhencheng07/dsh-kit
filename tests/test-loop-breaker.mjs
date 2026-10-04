// 宿主侧复读守卫生测（tests/test-loop-breaker.mjs）
//
// 判据是 TS，跑测试前需 pnpm build（本脚本读 dist 产物）。
// 覆盖：① 句子级判据——正常长文/列表/表格/代码不误报，同句或连续几句重复命中，
//      与流式切片方式无关；② 分档动作——警告档只记日志不 cancel，停止档才 cancel；
//      ③ 开关、换回合清零、同回合跨 attempt 续接、熔断只 cancel 一次。
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = (f) => join(here, '..', 'dist', 'monitor', f)
for (const f of ['loop-guard.js', 'loop-breaker.js']) {
  if (!existsSync(dist(f))) {
    console.error(`缺 ${dist(f)}——先跑 pnpm build`)
    process.exit(1)
  }
}
const guardMod = await import(`file://${dist('loop-guard.js').replace(/\\/g, '/')}`)
const breakerMod = await import(`file://${dist('loop-breaker.js').replace(/\\/g, '/')}`)
const { detectLoop, segmentSentences, tailLoop } = guardMod
const { registerLoopGuard, LOOP_CANCEL_REASON } = breakerMod

let failed = 0
const check = (label, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label)
  if (!ok) failed++
}
const rep = (unit, n) => unit.repeat(n)

// ─────────── ① 句子级判据 ───────────

// 正常长文：几万字不重复（旧实现的「单步字符上限」正是在这里误杀）
let longText = ''
for (let i = 0; longText.length < 65000; i++) {
  longText += `第 ${i} 步：检查模块 m${i} 的边界条件，确认输入校验、错误分支与资源释放都已覆盖，然后记录结论。\n`
}
check('正常长文（6.5 万字符、不重复）不误报', detectLoop(longText) === null)

const numbered = Array.from({ length: 40 }, (_, i) => `${i + 1}. 检查第 ${i + 1} 项配置是否正确`).join('\n')
check('编号列表（结构相同、内容不同）不误报', detectLoop(numbered) === null)
const table = '| 项目 | 状态 |\n|---|---|\n' + Array.from({ length: 30 }, (_, i) => `| 模块${i} | 通过 |`).join('\n')
check('markdown 表格不误报', detectLoop(table) === null)
const code = '\u0060\u0060\u0060js\n' + Array.from({ length: 40 }, (_, i) => `  const v${i} = compute(${i});`).join('\n') + '\n\u0060\u0060\u0060'
check('代码块（缩进/分号重复）不误报', detectLoop(code) === null)
check('短噪声「好。」连说 5 遍不误报（块不足最小字符数）', detectLoop(rep('好。', 5)) === null)
check('重复之后说了别的（已自愈）不误报', detectLoop(rep('这段在复读。', 3) + '后面是完全不同的一句收尾。') === null)

const one = detectLoop(rep('这个方案需要再确认一下。', 3))
check('同一句话连说 3 遍命中（1 句块 × 3 遍）', one !== null && one.units === 1 && one.copies === 3)
const two = detectLoop(rep('先定位问题。再修复它。', 3))
check('两句话绕圈 3 遍命中（2 句块）', two !== null && two.units === 2 && two.copies === 3)
const three = detectLoop(rep('第一步定位文件。第二步读取内容。第三步修改配置。', 3))
check('三句话绕圈 3 遍命中（3 句块）', three !== null && three.units === 3 && three.copies === 3)
const five = detectLoop(rep('这个问题我需要再确认一下。', 5))
check('同句 5 遍时 copies 记账为 5（停止档判据）', five !== null && five.copies === 5)

// 流式：尾句未收束时不判，收束后才判
const partialTail = rep('这个方案需要再确认一下。', 3) + '这个方案'
check('尾部未完成的第 4 句不参与判定（仍是 3 遍命中）', detectLoop(partialTail)?.copies === 3)
const twoAndHalf = rep('这个方案需要再确认一下。', 2) + '这个方案'
check('只有 2 个完整重复句 + 半句：不命中', detectLoop(twoAndHalf) === null)

// 切句：英文句点、数字里的点不误断
const seg = segmentSentences('Version 1.2.3 is ready. Next sentence. 中文一句。')
check(
  '英文句点断句、版本号里的点不断',
  seg.length === 3 && seg[0].text === 'Version 1.2.3 is ready.' && seg[1].text === 'Next sentence.' && seg[2].text === '中文一句。',
)
check('尾部无标点标记为未完成', seg.every((u) => u.complete === true) && segmentSentences('没标点的残句')[0].complete === false)
check('tailLoop 可直接吃单元数组', tailLoop(segmentSentences(rep('复读单元测试句。', 4)))?.copies === 4)
check('空文本安全', detectLoop('') === null && segmentSentences('').length === 0)

// ─────────── ②③ 守卫装配 ───────────
function makeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(event, listener) {
      handlers.set(event, listener)
      return () => handlers.delete(event)
    },
  }
}
function makeAgent() {
  const cancels = []
  const cancelOptions = []
  const injected = []
  return {
    cancels,
    cancelOptions,
    injected,
    cancel(cause, options) { cancels.push(cause); cancelOptions.push(options) },
    inject(message) { injected.push(message) },
  }
}
const defaultCfg = { monitorEnabled: true, monitorWarnCopies: 3, monitorStopCopies: 5 }

function feed(ctx, agent, text, turn = 1, step = 1, chunkType = 'text-delta') {
  ctx.handlers.get('agent/assistant-stream')({ agent, frame: { type: 'chunk', turn, step, chunk: { type: chunkType, text } } })
}
function startTurn(ctx, agent, turn, step = 1) {
  ctx.handlers.get('agent/assistant-stream')({ agent, frame: { type: 'start', turn, step, attemptId: 'a' + turn + '-' + step, revision: 1 } })
}
const S = '这个方案需要再确认一下。'

// 警告档不 cancel，停止档才 cancel
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ ...defaultCfg }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 3))
  check('警告档（3 遍）不 cancel', agent.cancels.length === 0)
  feed(ctx, agent, S)
  check('4 遍仍不 cancel', agent.cancels.length === 0)
  feed(ctx, agent, S)
  check('5 遍到停止档 cancel 一次', agent.cancels.length === 1 && agent.cancels[0]?.kind === 'hook' && agent.cancels[0]?.reason === LOOP_CANCEL_REASON)
  feed(ctx, agent, S)
  check('同一回合继续重复不再重复 cancel', agent.cancels.length === 1)
}

// 警告档注入模型可见提醒（只一次）；停止档 cancel 带 keepInbox 让提醒不随取消丢
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, {
    readSettings: () => ({ ...defaultCfg }),
    buildWarning: (hit) => ({ kind: 'dshk-warning', copies: hit.copies, units: hit.units }),
  })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 3))
  check('警告档注入一条模型可见提醒（带命中信息）', agent.injected.length === 1 && agent.injected[0]?.copies === 3)
  feed(ctx, agent, S)
  check('4 遍不重复注入', agent.injected.length === 1)
  feed(ctx, agent, S)
  check('停止档 cancel，且带 keepInbox（提醒留给下一回合）', agent.cancels.length === 1 && agent.cancelOptions[0]?.keepInbox === true)
}
// 提醒构造不可用（宿主包拿不到 / 失败）时只记日志，不抛错、不影响停止档
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ ...defaultCfg }), buildWarning: () => null })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 3))
  check('无提醒可注入时警告档照常记账不抛错', agent.cancels.length === 0 && agent.injected.length === 0)
  feed(ctx, agent, rep(S, 2))
  check('无提醒可注入时停止档照常 cancel', agent.cancels.length === 1)
}

// 换 attempt 清零：每个模型请求独立判定——每步收尾说同一句不该被累计成复读
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ ...defaultCfg }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1, 1)
  feed(ctx, agent, rep(S, 4), 1, 1)
  check('第 1 个 attempt 4 遍不 cancel', agent.cancels.length === 0)
  startTurn(ctx, agent, 1, 2)
  feed(ctx, agent, rep(S, 4), 1, 2)
  check('换 attempt 后重新计数：再 4 遍仍不 cancel（不累计上一步的收尾句）', agent.cancels.length === 0)
  feed(ctx, agent, S, 1, 2)
  check('同一 attempt 内到 5 遍才 cancel', agent.cancels.length === 1)
}

// 换回合清零
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ ...defaultCfg }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 5))
  check('第 1 回合第 5 遍 cancel', agent.cancels.length === 1)
  startTurn(ctx, agent, 2)
  feed(ctx, agent, rep(S, 3), 2)
  check('换回合后重新计数：3 遍不再 cancel', agent.cancels.length === 1)
  feed(ctx, agent, rep(S, 2), 2)
  check('第 2 回合到 5 遍再 cancel', agent.cancels.length === 2)
}

// 配置：关开关 / 自定义档位 / 停止档不大于警告档时按警告档+1 / 配置读不到
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ monitorEnabled: false }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 10))
  check('monitorEnabled=false 完全不动作', agent.cancels.length === 0)
}
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ monitorEnabled: true, monitorWarnCopies: 3, monitorStopCopies: 4 }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 3))
  check('自定义警告档 3 不 cancel', agent.cancels.length === 0)
  feed(ctx, agent, S)
  check('自定义停止档 4 cancel', agent.cancels.length === 1)
}
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ monitorEnabled: true, monitorWarnCopies: 3, monitorStopCopies: 2 }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 3))
  check('停止档≤警告档时按警告档+1：3 遍不 cancel', agent.cancels.length === 0)
  feed(ctx, agent, S)
  check('到 4 遍才 cancel（3+1）', agent.cancels.length === 1)
}
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => { throw new Error('boom') } })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 10))
  check('配置读不到不动作（放行而非误杀）', agent.cancels.length === 0)
}

// reasoning 帧同样计入
{
  const ctx = makeCtx()
  registerLoopGuard(ctx, { readSettings: () => ({ ...defaultCfg }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  feed(ctx, agent, rep(S, 5), 1, 1, 'reasoning-delta')
  check('reasoning-delta 复读同样触发停止', agent.cancels.length === 1)
}

// 注销后不再动作
{
  const ctx = makeCtx()
  const off = registerLoopGuard(ctx, { readSettings: () => ({ ...defaultCfg }) })
  const agent = makeAgent()
  startTurn(ctx, agent, 1)
  off()
  check('注销后监听器已摘除', ctx.handlers.get('agent/assistant-stream') === undefined)
}

console.log(failed === 0 ? '\nALL PASS (test-loop-breaker)' : '\nFAILED: ' + failed)
process.exit(failed === 0 ? 0 : 1)
