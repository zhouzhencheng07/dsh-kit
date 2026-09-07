// test-opencode-session.mjs — src/opencode-session.ts 单测（文本级 YAML 插入 + 端点数据面）
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { insertOpenCodeSessionHeader, findOpenCodeSessionValue, ensureOpenCodeSession } from '../dist/opencode-session.js'

let passed = 0
const U1 = '11111111-2222-3333-4444-555555555555'
const U2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok ${name}`)
  } catch (error) {
    console.error(`  FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

// dev 环境 settings.yaml 的真实形状（opencode-go 在 providers 下，带 models 列表）
const DEV_SHAPE = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'llm-pi-ai:',
  '  providers:',
  '    opencode-go:',
  '      models:',
  '        - id: hy3',
  '          name: Hy3',
  '        - id: mimo-v2.5',
  '          name: MiMo V2.5',
  '      apiKeyEnv: OPENCODE_GO_API_KEY',
  'agent-default-model:',
  '  provider: opencode-go',
  '  model: mimo-v2.5',
  '',
].join('\n')

check('真实形状：headers+session 两行插在 opencode-go: 之后、models: 之前', () => {
  const r = insertOpenCodeSessionHeader(DEV_SHAPE, U1)
  assert.equal(r.action, 'created')
  assert.equal(r.value, U1)
  const expected = [
    '    opencode-go:',
    '      headers:',
    `        x-opencode-session: ${U1}`,
    '      models:',
  ].join('\n')
  assert.ok(r.text.includes(expected), `插入位置/缩进不对：\n${r.text}`)
  // 其余内容原样保留
  assert.ok(r.text.includes('  providers:\n') && r.text.endsWith('  model: mimo-v2.5\n'))
})

check('幂等：已有 session 再插入 → exists 原文返回', () => {
  const once = insertOpenCodeSessionHeader(DEV_SHAPE, U1)
  const twice = insertOpenCodeSessionHeader(once.text, U2)
  assert.equal(twice.action, 'exists')
  assert.equal(twice.value, U1)
  assert.equal(twice.text, once.text)
})

check('findOpenCodeSessionValue：插入前 null，插入后取到值', () => {
  assert.equal(findOpenCodeSessionValue(DEV_SHAPE), null)
  const r = insertOpenCodeSessionHeader(DEV_SHAPE, U1)
  assert.equal(findOpenCodeSessionValue(r.text), U1)
})

check('headers 已存在但缺 session：作为兄弟子键插进 headers 下，缩进对齐', () => {
  const input = [
    'llm-pi-ai:',
    '  providers:',
    '    opencode-go:',
    '      headers:',
    '        authorization: Bearer x',
    '      apiKeyEnv: OPENCODE_GO_API_KEY',
    '',
  ].join('\n')
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'created')
  const expected = `        x-opencode-session: ${U1}`
  assert.ok(r.text.includes(expected), `session 行缩进不对：\n${r.text}`)
  // authorization 仍在，且 session 是 headers 的直接子键（同缩进）
  assert.ok(r.text.includes('        authorization: Bearer x'))
  const lines = r.text.split('\n')
  const iSession = lines.findIndex((l) => l.startsWith('        x-opencode-session:'))
  const iAuth = lines.findIndex((l) => l === '        authorization: Bearer x')
  const iHeaders = lines.findIndex((l) => l === '      headers:')
  assert.ok(iHeaders !== -1 && iSession === iHeaders + 1 && iAuth === iSession + 1)
})

check('headers: {} 内联空 map：改写为裸键并挂子键', () => {
  const input = 'llm-pi-ai:\n  providers:\n    opencode-go:\n      headers: {}\n      apiKeyEnv: K\n'
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'created')
  assert.ok(r.text.includes('      headers:\n'))
  assert.ok(!r.text.includes('headers: {}'))
  assert.ok(r.text.includes(`        x-opencode-session: ${U1}`))
})

check('headers 非空内联：拒绝插入返回 error', () => {
  const input = 'llm-pi-ai:\n  providers:\n    opencode-go:\n      headers: {a: b}\n'
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'error')
  assert.equal(r.text, input)
})

check('没有 opencode-go 段：no-provider 原文返回', () => {
  const r = insertOpenCodeSessionHeader('foo:\n  bar: 1\n', U1)
  assert.equal(r.action, 'no-provider')
  assert.equal(r.text, 'foo:\n  bar: 1\n')
})

check('CRLF 文件：插入行沿用 \\r\\n，已有行原样', () => {
  const input = DEV_SHAPE.replace(/\n/g, '\r\n')
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'created')
  assert.ok(r.text.includes(`    opencode-go:\r\n      headers:\r\n        x-opencode-session: ${U1}\r\n`))
  assert.equal(r.text.split('\r\n').length, input.split('\r\n').length + 2)
})

check('文件不以换行结尾（EOF 在 provider 段内）：补换行后插入，尾部无多余空行', () => {
  const input = 'llm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: K'
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'created')
  assert.equal(r.text, `llm-pi-ai:\n  providers:\n    opencode-go:\n      headers:\n        x-opencode-session: ${U1}\n      apiKeyEnv: K`)
})

check('块内深层注释不打断扫描；低缩进注释正确结束块', () => {
  const input = [
    'llm-pi-ai:',
    '  providers:',
    '    opencode-go:',
    '      # 模型列表',
    '      models:',
    '        - id: hy3',
    '# 顶层注释',
    'other: 1',
    '',
  ].join('\n')
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'created')
  assert.ok(r.text.includes('    opencode-go:\n      headers:'))
  // 顶层注释与后续内容仍原样
  assert.ok(r.text.includes('# 顶层注释\nother: 1\n'))
})

check('provider 内联空 map `opencode-go: {}`：改写裸键并插入', () => {
  const input = 'llm-pi-ai:\n  providers:\n    opencode-go: {}\n'
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'created')
  assert.ok(r.text.includes('    opencode-go:\n      headers:\n'))
  assert.ok(!r.text.includes('opencode-go: {}'))
})

check('provider 非空内联：拒绝插入返回 error', () => {
  const input = 'llm-pi-ai:\n  providers:\n    opencode-go: {models: []}\n'
  const r = insertOpenCodeSessionHeader(input, U1)
  assert.equal(r.action, 'error')
  assert.equal(r.text, input)
})

check('session 值带行尾注释也能读回', () => {
  const input = `llm-pi-ai:\n  providers:\n    opencode-go:\n      headers:\n        x-opencode-session: ${U1} # 个人机\n`
  assert.equal(findOpenCodeSessionValue(input), U1)
  const r = insertOpenCodeSessionHeader(input, U2)
  assert.equal(r.action, 'exists')
})

// 端点数据面：临时 DSH_HOME 全流程 created → exists，文件不再变化
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dshk-oc-'))
process.env.DSH_HOME = tmp
await fsp.writeFile(path.join(tmp, 'settings.yaml'), DEV_SHAPE, 'utf8')

try {
  const first = await ensureOpenCodeSession()
  if (first.action !== 'created' || !/^[0-9a-f-]{36}$/.test(first.value ?? '')) {
    console.error('  FAIL ensureOpenCodeSession 首次应 created 且值是 UUID', first)
    process.exitCode = 1
  } else {
    console.log('  ok ensureOpenCodeSession 首次 created（随机 UUID）')
    passed += 1
  }
  const afterWrite = await fsp.readFile(path.join(tmp, 'settings.yaml'), 'utf8')
  if (!afterWrite.includes(`        x-opencode-session: ${first.value}`)) {
    console.error('  FAIL 落盘内容缺少 session 行')
    process.exitCode = 1
  } else {
    console.log('  ok settings.yaml 落盘含 session 行')
    passed += 1
  }
  const second = await ensureOpenCodeSession()
  if (second.action !== 'exists' || second.value !== first.value) {
    console.error('  FAIL 第二次应 exists 且值不变', second)
    process.exitCode = 1
  } else {
    console.log('  ok 第二次 exists 且值不变（幂等）')
    passed += 1
  }
  const afterSecond = await fsp.readFile(path.join(tmp, 'settings.yaml'), 'utf8')
  if (afterSecond !== afterWrite) {
    console.error('  FAIL exists 分支不应改写文件')
    process.exitCode = 1
  } else {
    console.log('  ok exists 分支不改写文件')
    passed += 1
  }
} catch (error) {
  console.error('  FAIL ensureOpenCodeSession 异常', error)
  process.exitCode = 1
}

console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`)
