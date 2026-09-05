// vault 宿主半边单测：跑 dist/vault.js（先 pnpm build）。
// 用法：node tests/test-vault.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  sanitizePageTitle,
  parseFrontmatterTags,
  extractTitle,
  extractWikiLinks,
  VaultScanner,
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

await test('parseFrontmatterTags 只认 tags 行，内联数组与逗号两可', () => {
  const a = parseFrontmatterTags('---\ntags: [python, 学习]\ncreated: x\n---\n正文')
  assert.deepEqual(a.tags, ['python', '学习'])
  const b = parseFrontmatterTags('---\ntags: python, git\n---\n正文')
  assert.deepEqual(b.tags, ['python', 'git'])
  const c = parseFrontmatterTags('没有 frontmatter')
  assert.deepEqual(c.tags, [])
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
fs.mkdirSync(path.join(root, 'attachments'), { recursive: true })
fs.mkdirSync(path.join(root, '.hidden'), { recursive: true })
fs.writeFileSync(
  path.join(root, 'wiki', 'Python', '基础.md'),
  '---\ntags: [python]\n---\n# Python 基础\n\n见 [[工具链]] 与 [[AGENTS 常见问题]]。',
)
fs.writeFileSync(path.join(root, 'wiki', 'Python', '工具链.md'), '# 工具链\n\n回到 [[基础]]。\n\n- uv：`uv add <pkg>`\n- ruff：lint + format 一体')
fs.writeFileSync(path.join(root, 'wiki', 'git.md'), '# git\n忽略 [[ disappeared ]]')
fs.writeFileSync(path.join(root, 'attachments', '忽略.md'), '# 不进索引')
fs.writeFileSync(path.join(root, '.hidden', 'x.md'), '# 不进索引')
let scanner = new VaultScanner(() => root)
let index

await test('scan：md 建页、跳过 attachments/点前缀、space 归属正确', async () => {
  index = await scanner.scan()
  assert.equal(index.root, fs.realpathSync(root))
  assert.deepEqual(index.spaces, ['wiki'])
  assert.equal(index.pages.length, 3)
  const base = index.pages.find((p) => p.rel === 'wiki/Python/基础')
  assert.equal(base.space, 'wiki')
  assert.equal(base.title, 'Python 基础')
  assert.deepEqual(base.links, ['工具链', 'AGENTS 常见问题'])
  assert.deepEqual(base.tags, ['python'])
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

await test('ensureAgentsMd：首次生成约定文件，再次不覆盖', async () => {
  await scanner.ensureAgentsMd()
  const file = path.join(root, 'AGENTS.md')
  const first = fs.readFileSync(file, 'utf8')
  assert.ok(first.includes('一题一页'))
  fs.writeFileSync(file, '自定义内容', 'utf8')
  await scanner.ensureAgentsMd()
  assert.equal(fs.readFileSync(file, 'utf8'), '自定义内容')
})

await test('root：未配置/不存在回 null', async () => {
  assert.equal(new VaultScanner(() => '').root(), null)
  assert.equal(new VaultScanner(() => 'D:/no/such/dir').root(), null)
  assert.equal(await new VaultScanner(() => '').scan(), null)
})

fs.rmSync(root, { recursive: true, force: true })
console.log(process.exitCode ? 'FAIL' : 'ALL VAULT TESTS OK')
