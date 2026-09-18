// vault 宿主半边单测（只读：扫描索引 / 搜索）：跑 dist/vault.js（先 pnpm build）。
// 用法：node tests/test-vault.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractWikiLinks, VaultScanner } from '../dist/vault.js'

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

await test('extractWikiLinks 提取目标/剥锚与别名/去重不分大小写', () => {
  const links = extractWikiLinks('[[A]] [[B|别名]] [[C#锚]] [[a]] [[D')
  assert.deepEqual(links, ['A', 'B', 'C'])
})

// VaultScanner：临时目录夹具（根即 wiki 本体，目录只是普通组织）
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-vault-'))
fs.mkdirSync(path.join(root, 'Python'), { recursive: true })
fs.mkdirSync(path.join(root, 'attachments'), { recursive: true })
fs.mkdirSync(path.join(root, '.hidden'), { recursive: true })
fs.writeFileSync(
  path.join(root, 'Python', '基础.md'),
  '---\ntags: [python]\n---\n# Python 基础\n\n见 [[工具链]] 与 [[AGENTS 常见问题]]。',
)
fs.writeFileSync(path.join(root, 'Python', '工具链.md'), '# 工具链\n\n回到 [[基础]]。\n\n- uv：`uv add <pkg>`\n- ruff：lint + format 一体')
fs.writeFileSync(path.join(root, 'git.md'), '# git\n忽略 [[ disappeared ]]')
fs.writeFileSync(path.join(root, '根级页.md'), '# 根级页\n\nuv 也在检索池里')
fs.writeFileSync(path.join(root, 'attachments', '忽略.md'), '# 不进索引')
fs.writeFileSync(path.join(root, '.hidden', 'x.md'), '# 不进索引')
let scanner = new VaultScanner(() => root)
let index

await test('scan：md 建页、跳过 attachments/点前缀、space 归属正确、无 title 字段', async () => {
  index = await scanner.scan()
  assert.equal(index.root, fs.realpathSync(root))
  // folders = 全部目录（含各级），选择器据此可挑任意层级；空目录也在
  assert.deepEqual(index.folders, ['Python'])
  assert.equal(index.pages.length, 4)
  const base = index.pages.find((p) => p.rel === 'Python/基础')
  assert.equal(base.space, 'Python')
  assert.equal(base.title, undefined)
  assert.deepEqual(base.links, ['工具链', 'AGENTS 常见问题'])
})

await test('scan：mtime 缓存命中不重读（改缓存时间戳探测）', async () => {
  await scanner.scan()
  const relPath = path.join(root, 'git.md')
  const before = scanner.cache.get(fs.realpathSync(relPath))
  assert.ok(before)
  // 第二次扫描内容未变 → 缓存条目引用不变
  await scanner.scan()
  const after = scanner.cache.get(fs.realpathSync(relPath))
  assert.equal(after, before)
})

await test('search：多词 AND，路径/文件名/正文三档加权', async () => {
  const hit = await scanner.search('uv ruff', 10)
  assert.equal(hit.results.length, 1)
  assert.equal(hit.results[0].rel, 'Python/工具链')
  assert.ok(!('title' in hit.results[0]), '结果不带 title（显示名客户端取 rel 末段）')
  const none = await scanner.search('不存在的词组xyz', 10)
  assert.equal(none.results.length, 0)
})

await test('search：文件名命中(+5)排在仅正文命中(+2)之前', async () => {
  const res = await scanner.search('工具链', 10)
  // 「Python/工具链」rel 含词（+8 + 文件名 +5）；「Python/基础」只在正文 [[工具链]] 含词（+2）
  assert.equal(res.results[0].rel, 'Python/工具链')
  assert.equal(res.results[1].rel, 'Python/基础')
  assert.ok(res.results[0].score > res.results[1].score)
})

await test('search：检索池 = 根下全部索引页（根级页可搜，attachments 不进）', async () => {
  const loose = await scanner.search('根级页', 10)
  assert.equal(loose.results.length, 1)
  assert.equal(loose.results[0].rel, '根级页')
  const att = await scanner.search('不进索引', 10)
  assert.equal(att.results.length, 0)
})

await test('root：未配置/不存在回 null', async () => {
  assert.equal(new VaultScanner(() => '').root(), null)
  assert.equal(new VaultScanner(() => 'D:/no/such/dir').root(), null)
  assert.equal(await new VaultScanner(() => '').scan(), null)
})

fs.rmSync(root, { recursive: true, force: true })
console.log(process.exitCode ? 'FAIL' : 'ALL VAULT TESTS OK')
