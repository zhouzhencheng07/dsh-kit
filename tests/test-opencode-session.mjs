// test-opencode-session.mjs — src/opencode-session.ts 单测（按会话注入机制）
// 覆盖：门控判定、fetch 补丁（注入/放行/已带头跳过）、withStore 的 ALS 传播、
// applyOpenCodeSessionHeader 的接线（假 ctx 捕获监听 + fetch 补丁生命周期）。
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  shouldAttach,
  patchFetch,
  withStore,
  applyOpenCodeSessionHeader,
} from '../dist/opencode-session.js'

let passed = 0

function check(name, fn) {
  try {
    const r = fn()
    if (r instanceof Promise) {
      return r.then(
        () => {
          passed += 1
          console.log(`  ok ${name}`)
        },
        (error) => {
          console.error(`  FAIL ${name}`)
          console.error(error)
          process.exitCode = 1
        },
      )
    }
    passed += 1
    console.log(`  ok ${name}`)
  } catch (error) {
    console.error(`  FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
  return undefined
}

const PROVIDERS = new Set(['opencode', 'opencode-go'])

// ── shouldAttach 门控 ──
check('shouldAttach：provider 命中且带 sessionId → 返回会话 id', () => {
  assert.equal(shouldAttach({ provider: 'opencode-go', sessionId: 'session-abc' }, PROVIDERS), 'session-abc')
  assert.equal(shouldAttach({ provider: 'opencode', sessionId: 'session-x' }, PROVIDERS), 'session-x')
})
check('shouldAttach：provider 不命中 / 无 sessionId / 非对象 → null', () => {
  assert.equal(shouldAttach({ provider: 'sensenova', sessionId: 's' }, PROVIDERS), null)
  assert.equal(shouldAttach({ provider: 'opencode-go' }, PROVIDERS), null)
  assert.equal(shouldAttach({ provider: 'opencode-go', sessionId: null }, PROVIDERS), null)
  assert.equal(shouldAttach({ provider: 'opencode-go', sessionId: '' }, PROVIDERS), null)
  assert.equal(shouldAttach('oops', PROVIDERS), null)
  assert.equal(shouldAttach(null, PROVIDERS), null)
})

// ── patchFetch ──
const als = new AsyncLocalStorage()

function makeRecordingFetch() {
  const calls = []
  const fake = (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    calls.push(headers.get('x-opencode-session'))
    return Promise.resolve(new Response('ok'))
  }
  return { calls, fake }
}

check('patchFetch：store 激活 → 注入头值', () => {
  const { calls, fake } = makeRecordingFetch()
  const patched = patchFetch(fake, als)
  return als.run({ value: 'session-abc' }, async () => {
    await patched('https://gw.example/v1/chat')
    assert.deepEqual(calls, ['session-abc'])
  })
})
check('patchFetch：无 store → 原样转发（不带会话头）', async () => {
  const { calls, fake } = makeRecordingFetch()
  const patched = patchFetch(fake, als)
  await patched('https://gw.example/v1/chat')
  assert.deepEqual(calls, [null])
})
check('patchFetch：请求已自带会话头 → 不覆盖', () => {
  const { calls, fake } = makeRecordingFetch()
  const patched = patchFetch(fake, als)
  return als.run({ value: 'from-store' }, async () => {
    await patched('https://gw.example/v1/chat', { headers: { 'x-opencode-session': 'static-uuid' } })
    assert.deepEqual(calls, ['static-uuid'])
  })
})
check('patchFetch：init.headers 与原有头并存（不丢其他头）', () => {
  const seen = []
  const fake = (_input, init) => {
    seen.push(new Headers(init?.headers))
    return Promise.resolve(new Response('ok'))
  }
  const patched = patchFetch(fake, als)
  return als.run({ value: 'session-abc' }, async () => {
    await patched('https://gw.example/v1/chat', { headers: { authorization: 'Bearer x' } })
    assert.equal(seen[0].get('authorization'), 'Bearer x')
    assert.equal(seen[0].get('x-opencode-session'), 'session-abc')
  })
})

// ── withStore：ALS 跨惰性 pull 传播 ──
check('withStore：每次 pull 在 store 内执行，下游 fetch 能读到头值', async () => {
  const { calls, fake } = makeRecordingFetch()
  const patched = patchFetch(fake, als)
  async function* downstream() {
    await patched('https://gw.example/v1/chat')
    yield 1
    await patched('https://gw.example/v1/chat')
    yield 2
  }
  const wrapped = withStore(downstream(), { value: 'session-abc' }, als)
  // 在 store 外逐个 pull——传播靠 wrapper 的 als.run，不靠调用方上下文
  const out = [await wrapped.next(), await wrapped.next()]
  assert.deepEqual(calls, ['session-abc', 'session-abc'])
  assert.deepEqual(out.map((r) => r.value), [1, 2])
  assert.equal((await wrapped.return()).done, true)
})

// ── applyOpenCodeSessionHeader 接线（假 ctx）──
function fakeCtx() {
  const listeners = {}
  const effects = []
  return {
    listeners,
    effects,
    inject(_deps, _cb) {},
    effect(fn) {
      effects.push(fn)
    },
    on(event, listener, options) {
      ;(listeners[event] ??= []).push({ listener, options })
      return () => {}
    },
  }
}

check('接线：fetch 打了补丁、llm/stream 监听带 prepend', () => {
  const original = globalThis.fetch
  const ctx = fakeCtx()
  applyOpenCodeSessionHeader(ctx)
  // cordis effect 注册即执行：手动跑一遍 effect 体（装补丁），拿到清理函数
  const disposes = ctx.effects.map((fn) => fn()).filter((d) => typeof d === 'function')
  try {
    assert.notEqual(globalThis.fetch, original)
    const ls = ctx.listeners['llm/stream'] ?? []
    assert.equal(ls.length, 1)
    assert.deepEqual(ls[0].options, { prepend: true })
  } finally {
    for (const d of disposes) d()
  }
  assert.equal(globalThis.fetch, original)
})

check('端到端：监听命中 → 流内 fetch 带头；不命中 → 不带', async () => {
  const { calls, fake } = makeRecordingFetch()
  // 先把记录桩装上，让接线打出的补丁包住它——模块内监听与补丁共享同一 ALS
  const original = globalThis.fetch
  globalThis.fetch = fake
  const ctx = fakeCtx()
  applyOpenCodeSessionHeader(ctx)
  const disposes = ctx.effects.map((fn) => fn()).filter((d) => typeof d === 'function')
  const installedFetch = globalThis.fetch
  assert.notEqual(installedFetch, fake) // 已是补丁
  for (const d of disposes) d()
  assert.equal(globalThis.fetch, fake) // globalThis 还原；installedFetch 仍持有补丁
  const { listener } = ctx.listeners['llm/stream'][0]

  const downstreamFor = () => ({
    async *[Symbol.asyncIterator]() {
      await installedFetch('https://gw.example/v1/chat')
      yield 'chunk'
    },
  })

  // 命中：provider + sessionId，注入传播全靠监听给的 withStore 包装
  const wrapped = listener({ provider: 'opencode-go', sessionId: 'session-e2e' }, () => downstreamFor())
  for await (const _chunk of wrapped) break
  assert.deepEqual(calls, ['session-e2e'])

  // 不命中：别的 provider，next() 的下游原样返回（可迭代对象，无包装），请求照发但不带头
  const plain = listener({ provider: 'sensenova', sessionId: 'session-x' }, () => downstreamFor())
  assert.equal(typeof plain[Symbol.asyncIterator], 'function')
  await plain[Symbol.asyncIterator]().next()
  assert.deepEqual(calls, ['session-e2e', null])
  globalThis.fetch = original
})

check('降级：无 ctx.on 时 fetch 补丁回滚、不注册监听', () => {
  const original = globalThis.fetch
  const warns = []
  applyOpenCodeSessionHeader({ inject() {} }, (m) => warns.push(m))
  assert.equal(globalThis.fetch, original)
  assert.ok(warns.length > 0)
})

console.log(passed > 0 && process.exitCode !== 1 ? `ALL PASS (${passed} checks)` : 'DONE')
