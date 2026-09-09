// vault 宿主半边单测：跑 dist/vault.js（先 pnpm build）。
// 用法：node tests/test-vault.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  sanitizePageTitle,
  sanitizePageRel,
  extractTitle,
  extractWikiLinks,
  VaultScanner,
  ensureVaultSkeleton,
  vaultSearchSummary,
  buildVaultTools,
} from '../dist/vault.js'

const test = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS  ${name}`),
      (error) => {
        console.log(`FAIL  ${name}: ${error.message}`)
        process.exitCode = 1
      },
    )

// 纯函数
await test('sanitizePageTitle 清洗 Windows 非法字符与首尾点空格', () => {
  assert.equal(sanitizePageTitle(' a/b*c?d '), 'a-b-c-d')
  assert.equal(sanitizePageTitle('..隐藏.'), '隐藏')
  assert.equal(sanitizePageTitle(''), '')
})

await test('sanitizePageRel 分段净化，支持子目录且防穿越', () => {
  assert.equal(sanitizePageRel('Python/基础 笔记'), 'Python/基础 笔记')
  assert.equal(sanitizePageRel('日记\\2026\\九月'), '日记/2026/九月') // 反斜杠也当分隔
  assert.equal(sanitizePageRel('a/../b'), 'a/b') // .. 段剥成空被丢弃，防穿越
  assert.equal(sanitizePageRel('/头部斜杠//压缩/'), '头部斜杠/压缩')
  assert.equal(sanitizePageRel('///..//'), '') // 无有效段 → 空（端点报缺标题）
  assert.equal(sanitizePageRel('1/2/3/4/5/6/7/8/9/10').split('/').length <= 8, true) // 最多 8 段
})

await test('extractTitle 首个 # 标题，缺省回退文件名', () => {
  assert.equal(extractTitle('前言\n# 标题一\n## 子题', 'fallback'), '标题一')
  assert.equal(extractTitle('没有标题', 'page'), 'page')
})

await test('extractWikiLinks 提取目标/剥锚与别名/去重不分大小写', () => {
  const links = extractWikiLinks('[[A]] [[B|别名]] [[C#锚]] [[a]] [[D')
  assert.deepEqual(links, ['A', 'B', 'C'])
})

// VaultScanner：临时目录夹具
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-vault-'))
fs.mkdirSync(path.join(root, 'wiki', 'Python'), { recursive: true })
fs.mkdirSync(path.join(root, 'library'), { recursive: true })
fs.mkdirSync(path.join(root, 'attachments'), { recursive: true })
fs.mkdirSync(path.join(root, '.hidden'), { recursive: true })
fs.writeFileSync(
  path.join(root, 'wiki', 'Python', '基础.md'),
  '---\ntags: [python]\n---\n# Python 基础\n\n见 [[工具链]] 与 [[AGENTS 常见问题]]。',
)
fs.writeFileSync(path.join(root, 'wiki', 'Python', '工具链.md'), '# 工具链\n\n回到 [[基础]]。\n\n- uv：`uv add <pkg>`\n- ruff：lint + format 一体')
fs.writeFileSync(path.join(root, 'wiki', 'git.md'), '# git\n忽略 [[ disappeared ]]')
fs.writeFileSync(path.join(root, 'library', '原始资料.md'), '# 原始资料\n\nuv 是 python 包管理器，不进检索池')
fs.writeFileSync(path.join(root, '根级散页.md'), '# 根级散页\n\nuv 也不该被搜到')
fs.writeFileSync(path.join(root, 'attachments', '忽略.md'), '# 不进索引')
fs.writeFileSync(path.join(root, '.hidden', 'x.md'), '# 不进索引')
let scanner = new VaultScanner(() => root)
let index

await test('scan：md 建页、跳过 attachments/点前缀、space 归属正确', async () => {
  index = await scanner.scan()
  assert.equal(index.root, fs.realpathSync(root))
  assert.deepEqual(index.spaces, ['library', 'wiki'])
  assert.equal(index.pages.length, 5)
  const base = index.pages.find((p) => p.rel === 'wiki/Python/基础')
  assert.equal(base.space, 'wiki')
  assert.equal(base.title, 'Python 基础')
  assert.deepEqual(base.links, ['工具链', 'AGENTS 常见问题'])
})

await test('scan：mtime 缓存命中不重读（改缓存时间戳探测）', async () => {
  await scanner.scan()
  const relPath = path.join(root, 'wiki', 'git.md')
  const before = scanner.cache.get(fs.realpathSync(relPath))
  assert.ok(before)
  // 第二次扫描内容未变 → 缓存条目引用不变
  await scanner.scan()
  const after = scanner.cache.get(fs.realpathSync(relPath))
  assert.equal(after, before)
})

await test('search：多词 AND，文件名/标题加权，正文计次', async () => {
  const hit = await scanner.search('uv ruff', 10)
  assert.equal(hit.results.length, 1)
  assert.equal(hit.results[0].rel, 'wiki/Python/工具链')
  const none = await scanner.search('不存在的词组xyz', 10)
  assert.equal(none.results.length, 0)
})

await test('search：仅 wiki 区——library 与根级散页不进检索池', async () => {
  const lib = await scanner.search('uv 包管理器', 10)
  assert.equal(lib.results.length, 0)
  const loose = await scanner.search('根级散页', 10)
  assert.equal(loose.results.length, 0)
})

await test('vault_search 工具：命中摘要带绝对路径，未配置优雅降级', async () => {
  const defs = buildVaultTools({ defineTool: (d) => d, scanner })
  assert.equal(defs.length, 1)
  assert.equal(defs[0].name, 'vault_search')
  const value = await defs[0].execute({ query: 'uv ruff' })
  assert.equal(value.results.length, 1)
  assert.ok(value.summary.includes(path.join('wiki', 'Python', '工具链.md')))
  assert.equal(value.summary, vaultSearchSummary('uv ruff', value.results))
  const miss = await defs[0].execute({ query: '原始资料' })
  assert.ok(miss.summary.includes('未找到匹配'))
  const unconfigured = await buildVaultTools({
    defineTool: (d) => d,
    scanner: new VaultScanner(() => ''),
  })[0].execute({ query: 'x' })
  assert.ok(unconfigured.summary.includes('未配置'))
  assert.deepEqual(unconfigured.results, [])
})

await test('vaultSearchSummary：空结果提示', () => {
  assert.ok(vaultSearchSummary('xx', []).includes('未找到'))
})

await test('root：未配置/不存在回 null', async () => {
  assert.equal(new VaultScanner(() => '').root(), null)
  assert.equal(new VaultScanner(() => 'D:/no/such/dir').root(), null)
  assert.equal(await new VaultScanner(() => '').scan(), null)
})

fs.rmSync(root, { recursive: true, force: true })
console.log(process.exitCode ? 'FAIL' : 'ALL VAULT TESTS OK')

await test('ensureVaultSkeleton 补种骨架目录且幂等', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshkit-vault-sk-'))
  const root = path.join(dir, '新建库')
  await ensureVaultSkeleton(root)
  assert.ok(fs.statSync(path.join(root, 'wiki')).isDirectory())
  assert.ok(fs.statSync(path.join(root, 'library')).isDirectory())
  assert.ok(fs.statSync(path.join(root, 'attachments')).isDirectory())
  // 已有内容不被覆盖
  fs.writeFileSync(path.join(root, 'wiki', '已有.md'), '# x', 'utf8')
  await ensureVaultSkeleton(root)
  assert.ok(fs.existsSync(path.join(root, 'wiki', '已有.md')))
  fs.rmSync(dir, { recursive: true, force: true })
})
