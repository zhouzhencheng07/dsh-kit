// 网页搜索组件（宿主半边）单元测试：不联网，桩 ctx/web 驱动 seam 接管与注册语义。
// 覆盖：接管 base 默认 provider / 尊重显式钉的 provider / 配置引用缺失或不可写时不钉不注册 /
// 卸载还原 / provider 契约与条数上限。用法：node tests\test-search-provider.mjs
import assert from 'node:assert/strict'
import { applyWebSearch, SEARCH_PROVIDER_ID } from '../src/search/web-search.ts'

const OFFICIAL = 'deepseek-official'
/** cosmokit 的 volatile 写协议（宿主配置引用上的写入口） */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** volatile 配置引用桩：{get} + 写符号；writable=false 模拟只读引用 */
function makeRef(value, { writable = true } = {}) {
  let current = value
  const ref = { get: () => current }
  if (writable) ref[VOLATILE_WRITE] = (next) => { current = next }
  return Object.freeze(ref)
}

/** web seam 桩：注册表 + 配置引用（hasConfig=false 时没有 config.searchProvider） */
function makeWeb({ provider = OFFICIAL, hasConfig = true, writable = true, unset = false } = {}) {
  const searchProviders = new Map()
  const web = {
    searchProviders,
    registerSearchProvider(provider) {
      if (searchProviders.has(provider.id)) throw new Error('duplicate')
      searchProviders.set(provider.id, provider)
      return () => searchProviders.delete(provider.id)
    },
  }
  if (hasConfig) web.config = { searchProvider: makeRef(unset ? undefined : provider, { writable }) }
  return web
}

/** ctx 桩：inject 同步给 web，effect 记下清理函数（模拟 fiber 卸载） */
function makeCtx(web) {
  const cleanups = []
  const ctx = {
    inject(deps, cb) {
      assert.deepEqual(deps, ['web'])
      cb({ web })
    },
    effect(fn) {
      cleanups.push(fn())
    },
  }
  return { ctx, unload: () => { for (const fn of cleanups.splice(0)) fn() } }
}

const silent = () => {}

// 1) base 默认（deepseek-official）→ 接管：配置引用改指 + provider 注册
{
  const web = makeWeb()
  const { ctx, unload } = makeCtx(web)
  const logs = []
  applyWebSearch(ctx, { getMaxResults: () => 3, log: (m) => logs.push(m) })
  assert.equal(web.config.searchProvider.get(), SEARCH_PROVIDER_ID)
  assert.ok(web.searchProviders.has(SEARCH_PROVIDER_ID))
  assert.equal(web.searchProviders.get(SEARCH_PROVIDER_ID).available(), true)
  assert.ok(logs.some((m) => m.includes('已接管')), '接管应有日志：' + logs.join(' | '))
  // 卸载：provider 注销 + 配置还原（切行后 base 的官方 provider 继续服务）
  unload()
  assert.equal(web.searchProviders.has(SEARCH_PROVIDER_ID), false)
  assert.equal(web.config.searchProvider.get(), OFFICIAL)
  console.log('PASS  默认钉在官方 provider → 接管 seam 并注册，卸载后还原')
}

// 2) 没人钉（引用存在但 undefined）→ 同样接管，卸载还原成 undefined
{
  const web = makeWeb({ unset: true })
  const { ctx, unload } = makeCtx(web)
  applyWebSearch(ctx, { getMaxResults: () => 3, log: silent })
  assert.equal(web.config.searchProvider.get(), SEARCH_PROVIDER_ID)
  assert.ok(web.searchProviders.has(SEARCH_PROVIDER_ID))
  unload()
  assert.equal(web.config.searchProvider.get(), undefined)
  console.log('PASS  未配置 provider → 接管，卸载后回 undefined')
}

// 3) 显式钉了别家（profile 补丁）→ 让路：不接管也不注册
{
  const web = makeWeb({ provider: 'my-search' })
  const { ctx } = makeCtx(web)
  applyWebSearch(ctx, { getMaxResults: () => 3, log: silent })
  assert.equal(web.config.searchProvider.get(), 'my-search')
  assert.equal(web.searchProviders.size, 0)
  console.log('PASS  显式钉别家 → 不接管不注册（用户选择优先）')
}

// 4) 宿主没暴露配置引用 → 不钉不注册（官方搜索照常，仅免费链不生效）
{
  const web = makeWeb({ hasConfig: false })
  const { ctx } = makeCtx(web)
  const logs = []
  applyWebSearch(ctx, { getMaxResults: () => 3, log: (m) => logs.push(m) })
  assert.equal(web.searchProviders.size, 0)
  assert.ok(logs.some((m) => m.includes('不接受')), '应告警：' + logs.join(' | '))
  console.log('PASS  宿主无 config.searchProvider → 不钉不注册 + 告警（降级为官方搜索）')
}

// 5) 引用只读（没有写符号）→ 同样不注册
{
  const web = makeWeb({ writable: false })
  const { ctx } = makeCtx(web)
  applyWebSearch(ctx, { getMaxResults: () => 3, log: silent })
  assert.equal(web.config.searchProvider.get(), OFFICIAL)
  assert.equal(web.searchProviders.size, 0)
  console.log('PASS  只读配置引用 → 不注册（不留下无人选择的 provider）')
}

// 6) 写了读不回（写入口存在但值不变）→ 不注册，配置保持原值
{
  const searchProviders = new Map()
  const ref = Object.freeze({
    get: () => OFFICIAL,
    [VOLATILE_WRITE]: () => {},
  })
  const web = {
    searchProviders,
    config: { searchProvider: ref },
    registerSearchProvider(provider) {
      searchProviders.set(provider.id, provider)
      return () => searchProviders.delete(provider.id)
    },
  }
  const { ctx } = makeCtx(web)
  applyWebSearch(ctx, { getMaxResults: () => 3, log: silent })
  assert.equal(ref.get(), OFFICIAL)
  assert.equal(searchProviders.size, 0)
  console.log('PASS  写入不生效 → 不注册（配置保持原值）')
}

// 7) provider 契约与条数上限：桩 fetch 喂 Tavily 结果，条数取「请求量与设置上限的较小值」
{
  const originalFetch = globalThis.fetch
  const results = Array.from({ length: 6 }, (_, i) => ({ url: `https://example.com/${i}`, title: `t${i}`, content: `c${i}` }))
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results, answer: '摘要' }) })
  try {
    const web = makeWeb()
    const { ctx } = makeCtx(web)
    applyWebSearch(ctx, { getMaxResults: () => 3, log: silent })
    const provider = web.searchProviders.get(SEARCH_PROVIDER_ID)
    const wide = await provider.search({ query: 'zzz ordinary phrase qqq', maxResults: 8 })
    assert.equal(wide.sources.length, 3, '设置上限 3：请求 8 也只给 3')
    assert.equal(wide.content, '摘要')
    assert.equal(wide.truncated, false)
    assert.deepEqual(Object.keys(wide.sources[0]).sort(), ['snippet', 'title', 'url'])
    const narrow = await provider.search({ query: 'zzz ordinary phrase qqq', maxResults: 1 })
    assert.equal(narrow.sources.length, 1, 'seam 要得少就少给')
    // 配置给不出合法值 → 回落默认 2
    const web2 = makeWeb()
    const ctx2 = makeCtx(web2)
    applyWebSearch(ctx2.ctx, { getMaxResults: () => 'oops', log: silent })
    const provider2 = web2.searchProviders.get(SEARCH_PROVIDER_ID)
    const fallback = await provider2.search({ query: 'zzz ordinary phrase qqq' })
    assert.equal(fallback.sources.length, 2, '非法配置回落默认 2')
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log('PASS  provider 契约与条数上限（设置上限 / seam 请求量 / 非法值回落）')
}

console.log('ALL PASS (search provider)')
