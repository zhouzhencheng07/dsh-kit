// OpenCode Go 会话头镜像单测：对构建产物 dist/opencode-session.js 跑（先 pnpm build）
//   node tests/test-opencode-session.mjs
// 覆盖：域名门控（大小写/子域/仿冒域）、亲和值优先级、镜像幂等让位、
//       fetch 包装安装（镜像生效/无亲和放行/开关关闭/重复安装防抖）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  matchGatewayHost,
  resolveAffinityValue,
  mirrorSessionHeader,
  installOpenCodeSessionMirror,
} from '../dist/opencode-session.js'

test('matchGatewayHost：主域与子域命中，大小写不敏感，仿冒域不命中', () => {
  assert.equal(matchGatewayHost('opencode.ai'), true)
  assert.equal(matchGatewayHost('api.opencode.ai'), true)
  assert.equal(matchGatewayHost('OpenCode.AI'), true)
  assert.equal(matchGatewayHost('Api.OpenCode.AI'), true)
  assert.equal(matchGatewayHost('opencode.ai.evil.com'), false)
  assert.equal(matchGatewayHost('notopencode.ai'), false)
  assert.equal(matchGatewayHost('opencode.ai.com'), false)
  assert.equal(matchGatewayHost(''), false)
})

test('resolveAffinityValue：按亲和头优先级取值，大小写不敏感，空值跳过', () => {
  assert.equal(resolveAffinityValue(new Headers({ 'x-session-affinity': 's1' })), 's1')
  assert.equal(
    resolveAffinityValue(new Headers({ 'x-client-request-id': 's2', 'X-Session-Affinity': 's3' })),
    's3',
  )
  // 无 affinity 时依次退到 x-session-id / x-client-request-id
  assert.equal(resolveAffinityValue(new Headers({ 'x-session-id': 's4' })), 's4')
  assert.equal(resolveAffinityValue(new Headers({ 'x-client-request-id': 's5' })), 's5')
  assert.equal(resolveAffinityValue(new Headers({ 'x-session-affinity': '  ' })), null)
  assert.equal(resolveAffinityValue(new Headers()), null)
})

test('mirrorSessionHeader：补目标头、已有则让位、无亲和值不动、开关可关', () => {
  const h1 = new Headers({ 'x-session-affinity': 'sess-1' })
  assert.equal(mirrorSessionHeader(h1), true)
  assert.equal(h1.get('x-opencode-session'), 'sess-1')
  // 已有目标头（用户手配/宿主原生）→ 幂等让位
  const h2 = new Headers({ 'x-session-affinity': 'sess-2', 'x-opencode-session': 'manual' })
  assert.equal(mirrorSessionHeader(h2), false)
  assert.equal(h2.get('x-opencode-session'), 'manual')
  // 无亲和值 → 不造值
  const h3 = new Headers()
  assert.equal(mirrorSessionHeader(h3), false)
  assert.equal(h3.has('x-opencode-session'), false)
  // 开关关闭 → 不生效
  const h4 = new Headers({ 'x-session-affinity': 'sess-4' })
  assert.equal(mirrorSessionHeader(h4, () => true), false)
  assert.equal(h4.has('x-opencode-session'), false)
})

test('installOpenCodeSessionMirror：包装生效、放行与让位、重复安装防抖', async () => {
  const captured = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    captured.push({ input, init })
    return new Response('{}', { headers: { 'content-type': 'application/json' } })
  }
  try {
    assert.equal(installOpenCodeSessionMirror({ log: () => {} }), true)
    // 重复安装：直接返回 true，不再包一层
    const once = globalThis.fetch
    assert.equal(installOpenCodeSessionMirror({ log: () => {} }), true)
    assert.equal(globalThis.fetch, once)

    // opencode.ai + 亲和头 → 镜像
    await globalThis.fetch('https://api.opencode.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-affinity': 'sess-abc' },
    })
    const mirrored = new Headers(captured.at(-1).init.headers)
    assert.equal(mirrored.get('x-opencode-session'), 'sess-abc')
    assert.equal(mirrored.get('x-session-affinity'), 'sess-abc')

    // 已带目标头 → 让位（原始头原样透传）
    await globalThis.fetch('https://opencode.ai/v1/x', {
      headers: { 'x-session-affinity': 's9', 'x-opencode-session': 'manual' },
    })
    assert.equal(new Headers(captured.at(-1).init.headers).get('x-opencode-session'), 'manual')

    // 无亲和头 → 放行不造值
    await globalThis.fetch('https://opencode.ai/v1/x', { headers: { 'content-type': 'application/json' } })
    assert.equal(new Headers(captured.at(-1).init.headers).has('x-opencode-session'), false)

    // 非网关域名 → 原样
    await globalThis.fetch('https://api.deepseek.com/v1/x', { headers: { 'x-session-affinity': 'sx' } })
    assert.equal(new Headers(captured.at(-1).init.headers).has('x-opencode-session'), false)

    // 开关关闭 → 不镜像
    globalThis.fetch = async (input, init) => {
      captured.push({ input, init })
      return new Response('{}')
    }
    assert.equal(
      installOpenCodeSessionMirror({ isDisabled: () => true, log: () => {} }),
      true,
    )
    await globalThis.fetch('https://opencode.ai/v1/x', { headers: { 'x-session-affinity': 's7' } })
    assert.equal(new Headers(captured.at(-1).init.headers).has('x-opencode-session'), false)
  } finally {
    globalThis.fetch = realFetch
  }
})
