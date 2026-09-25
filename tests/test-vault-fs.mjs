// vault 文件管理单测（改名/移动的 wikilink 改写 + 导入收图 + 路径安全 + 撞名策略）：
// 跑 dist/vault/fs.js（先 pnpm build）。用法：node tests/test-vault-fs.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VaultScanner } from '../dist/vault/scanner.js'
import {
  createEntry,
  dedupeName,
  deleteEntries,
  importEntry,
  moveEntry,
  renameEntry,
  resolveInside,
  rewriteWikiLinks,
  safeLeaf,
  safeRel,
} from '../dist/vault/fs.js'

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-vaultfs-'))
const write = (rel, text) => {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text, 'utf8')
  return abs
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

write('wiki/基础.md', '# 基础\n\n见 [[工具链]] 与 [[wiki/工具链|链]]。\n\n```\n[[工具链]]\n```\n\n行内 `[[工具链]]` 不动')
write('wiki/工具链.md', '# 工具链\n\n回到 [[基础]]。')
write('wiki/索引.md', '# 索引\n\n深页在 [[wiki/子目录/深页]]，另一个写法 [[深页]]。')
write('wiki/子目录/深页.md', '# 深页\n\n指向 [[wiki/子目录/深页2]]。')
write('wiki/子目录/深页2.md', '# 深页2')
write('attachments/keep.md', '# 附件目录不进索引')

await test('safeLeaf：拒分隔符/上跳/保留名/首尾空白，收中文与点号名', () => {
  assert.equal(safeLeaf('新页'), '新页')
  assert.equal(safeLeaf('a.b.md'), 'a.b.md')
  assert.equal(safeLeaf(' a'), null)
  assert.equal(safeLeaf('a/b'), null)
  assert.equal(safeLeaf('..'), null)
  assert.equal(safeLeaf('con.txt'), null)
  assert.equal(safeLeaf('a?b'), null)
})

await test('safeRel：多级逐段清洗，空段丢弃，非法整条作废', () => {
  assert.equal(safeRel('a/b/c'), 'a/b/c')
  assert.equal(safeRel('/a//b/'), 'a/b')
  assert.equal(safeRel('a/../b'), '')
})

await test('dedupeName：撞名从「(2)」起、序号插在扩展名前', () => {
  const dir = path.join(root, 'wiki')
  assert.equal(dedupeName(dir, '不存在.md'), '不存在.md')
  assert.equal(dedupeName(dir, '基础.md'), '基础 (2).md')
  fs.writeFileSync(path.join(dir, '基础 (2).md'), '')
  assert.equal(dedupeName(dir, '基础.md'), '基础 (3).md')
  fs.rmSync(path.join(dir, '基础 (2).md'))
})

await test('resolveInside：拒库外路径与 `..` 段，库内路径归一', () => {
  assert.equal(resolveInside(root, path.join(root, 'wiki', '基础.md')), path.join(fs.realpathSync(root), 'wiki', '基础.md'))
  assert.throws(() => resolveInside(root, `${root}${path.sep}..${path.sep}x.md`), /上跳段/)
  assert.throws(() => resolveInside(root, `${root}/../x.md`), /上跳段/)
  assert.throws(() => resolveInside(root, path.dirname(root)), /不在知识库内/)
  assert.throws(() => resolveInside(root, root), /根目录本身/)
})

await test('createEntry：页补 .md、目录可多级、已存在回 exists 不覆盖', () => {
  // 库根本身可以作为落点（新建在根下），但改名/删除的目标不能是根
  const atRoot = createEntry(root, root, '根级新页', 'page')
  assert.equal(atRoot.path, path.join(fs.realpathSync(root), '根级新页.md'))
  fs.rmSync(path.join(root, '根级新页.md'))
  const page = createEntry(root, path.join(root, 'wiki'), '新页', 'page')
  assert.equal(page.path, path.join(fs.realpathSync(root), 'wiki', '新页.md'))
  assert.equal(read('wiki/新页.md'), '')
  assert.equal(createEntry(root, path.join(root, 'wiki'), '新页.md', 'page').exists, true)
  const nested = createEntry(root, path.join(root, 'wiki'), '甲/乙/丙', 'page')
  assert.equal(nested.path, path.join(fs.realpathSync(root), 'wiki', '甲', '乙', '丙.md'))
  const dir = createEntry(root, path.join(root, 'wiki'), '空目录', 'dir')
  assert.equal(fs.statSync(dir.path).isDirectory(), true)
  assert.equal(createEntry(root, path.join(root, 'wiki'), '空目录', 'dir').exists, true)
  fs.rmSync(path.join(root, 'wiki', '甲'), { recursive: true })
  fs.rmdirSync(path.join(root, 'wiki', '空目录'))
})

await test('renameEntry：页改名按解析改写双链（锚/别名/路径形态/代码块）', async () => {
  const scanner = new VaultScanner(() => root)
  const before = await scanner.scan()
  const res = renameEntry(root, path.join(root, 'wiki', '工具链.md'), '工具链2', before.pages)
  assert.equal(res.path, path.join(fs.realpathSync(root), 'wiki', '工具链2.md'))
  assert.equal(res.links, 1)
  const text = read('wiki/基础.md')
  // 改名 = 整段换成新裸名（路径形态也收成裸名，与解析口径一致）
  assert.match(text, /\[\[工具链2\]\]/)
  assert.match(text, /\[\[工具链2\|链\]\]/)
  assert.match(text, /```\n\[\[工具链\]\]\n```/) // 围栏里不动
  assert.match(text, /行内 `\[\[工具链\]\]` 不动/)
  renameEntry(root, path.join(root, 'wiki', '工具链2.md'), '工具链', await scanner.scan().then((i) => i.pages))
})

await test('renameEntry：目录改名整棵搬走且不改双链；资料库文件保留扩展名', async () => {
  write('library/论文.pdf', '%PDF-1.4')
  const scanner = new VaultScanner(() => root)
  const pages = (await scanner.scan()).pages
  const dir = renameEntry(root, path.join(root, 'wiki', '子目录'), '子目录2', pages)
  assert.equal(exists('wiki/子目录2/深页.md'), true)
  assert.match(read('wiki/子目录2/深页.md'), /\[\[wiki\/子目录\/深页2\]\]/) // 目录改名不碰双链
  renameEntry(root, path.join(root, 'wiki', '子目录2'), '子目录')
  const file = renameEntry(root, path.join(root, 'library', '论文.pdf'), '论文v2')
  assert.equal(file.path, path.join(fs.realpathSync(root), 'library', '论文v2.pdf'))
})

await test('moveEntry：页移动只改写路径形态的引用，短名引用原样', async () => {
  const scanner = new VaultScanner(() => root)
  const pages = (await scanner.scan()).pages
  fs.mkdirSync(path.join(root, '归档'), { recursive: true })
  const res = await moveEntry(root, path.join(root, 'wiki', '子目录', '深页.md'), path.join(root, '归档'), 'skip', pages)
  assert.equal(res.skipped, false)
  assert.equal(res.rel, '归档/深页')
  assert.equal(res.links, 1) // 只有「写成路径」的那条被改写
  const idx = read('wiki/索引.md')
  assert.match(idx, /\[\[归档\/深页\]\]/) // 路径形态换新路径
  assert.match(idx, /\[\[深页\]\]/) // 短名照旧（移动后照样解析得到）
  const same = await moveEntry(root, path.join(root, '归档', '深页.md'), path.join(root, '归档'), 'skip', [])
  assert.equal(same.skipped, true)
  await assert.rejects(
    moveEntry(root, path.join(root, 'wiki'), path.join(root, 'wiki', '子目录'), 'skip', []),
    /不能移动到自己的子目录里/,
  )
  await moveEntry(root, path.join(root, '归档', '深页.md'), path.join(root, 'wiki', '子目录'), 'skip', [])
  fs.rmdirSync(path.join(root, '归档'))
})

await test('moveEntry：撞名按策略走（跳过 / 覆盖进回收站 / 自动加序号）', async () => {
  write('target.md', '# 新')
  write('wiki/target.md', '# 旧')
  const skip = await moveEntry(root, path.join(root, 'target.md'), path.join(root, 'wiki'), 'skip', [])
  assert.equal(skip.skipped, true)
  assert.equal(read('wiki/target.md'), '# 旧')
  const over = await moveEntry(root, path.join(root, 'target.md'), path.join(root, 'wiki'), 'overwrite', [])
  assert.equal(over.skipped, false)
  assert.equal(read('wiki/target.md'), '# 新')
  write('dest2/x.md', '# x')
  fs.mkdirSync(path.join(root, 'dest2'), { recursive: true })
  write('dest2/x.md', '# 新 x')
  write('wiki2/x.md', '# 旧 x')
  const renamed = await moveEntry(root, path.join(root, 'wiki2', 'x.md'), path.join(root, 'dest2'), 'rename', [])
  assert.equal(renamed.name, 'x (2).md')
  assert.equal(read('dest2/x (2).md'), '# 旧 x')
  fs.rmSync(path.join(root, 'dest2'), { recursive: true })
  fs.rmSync(path.join(root, 'wiki2'), { recursive: true })
  fs.rmSync(path.join(root, 'wiki', 'target.md'))
})

await test('importEntry：本机路径直拷 md 页，页内引用的图片进 attachments/ 并改写引用', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-import-'))
  fs.writeFileSync(path.join(outside, '图.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  fs.writeFileSync(path.join(outside, '外部.md'), '# 外部\n\n![图](图.png)\n\n外链 ![网](https://x/y.png) 不动\n', 'utf8')
  const res = await importEntry(root, { destAbs: path.join(root, 'wiki'), name: '外部', srcPath: path.join(outside, '外部.md'), conflict: 'skip' })
  assert.equal(res.images, 1)
  assert.equal(res.name, '外部.md')
  const text = read('wiki/外部.md')
  const m = /!\[图\]\((attachments\/[0-9a-f]{2}\/[0-9a-f]{16}\.png)\)/.exec(text)
  assert.ok(m, `引用应改写成内容寻址路径：${text}`)
  assert.equal(exists(m[1]), true)
  assert.match(text, /!\[网\]\(https:\/\/x\/y\.png\)/)
  // 同内容二次导入：同名页按策略 skip，图片按内容去重（不重复落盘、也不重写）
  const again = await importEntry(root, { destAbs: path.join(root, 'wiki'), name: '外部', srcPath: path.join(outside, '外部.md'), conflict: 'skip' })
  assert.equal(again.skipped, true)
  const renamed = await importEntry(root, { destAbs: path.join(root, 'wiki'), name: '外部', srcPath: path.join(outside, '外部.md'), conflict: 'rename' })
  assert.equal(renamed.name, '外部 (2).md')
  fs.rmSync(path.join(outside), { recursive: true })
  fs.rmSync(path.join(root, 'wiki', '外部 (2).md'))
})

await test('importEntry：上传字节落资料库原样保留扩展名，撞名加序号；笔记区拒非 md', async () => {
  const up = await importEntry(root, {
    destAbs: path.join(root, 'library'),
    name: '统计.pdf',
    fileName: '统计.pdf',
    data: Buffer.from('%PDF-1.4 up'),
    conflict: 'skip',
  })
  assert.equal(up.name, '统计.pdf')
  assert.equal(read('library/统计.pdf'), '%PDF-1.4 up')
  const up2 = await importEntry(root, {
    destAbs: path.join(root, 'library'),
    name: '统计.pdf',
    fileName: '统计.pdf',
    data: Buffer.from('%PDF-1.4 up'),
    conflict: 'skip',
  })
  assert.equal(up2.name, '统计 (2).pdf')
  await assert.rejects(
    importEntry(root, { destAbs: path.join(root, 'wiki'), name: 'x.pdf', fileName: 'x.pdf', data: Buffer.from('x'), conflict: 'skip' }),
    /笔记区只收 md/,
  )
  await assert.rejects(importEntry(root, { destAbs: path.join(root, 'wiki'), name: '外', srcPath: path.join(root, 'wiki', '基础.md'), conflict: 'skip' }), /源文件已在知识库内/)
})

await test('deleteEntries：删页与目录；库外非 md 拒删、资料库根拒删', async () => {  write('deleteme.md', '# x')
  write('delme/sub.md', '# y')
  const res = await deleteEntries(root, [path.join(root, 'deleteme.md'), path.join(root, 'delme')])
  assert.equal(res.deleted, 2)
  assert.equal(exists('deleteme.md'), false)
  assert.equal(exists('delme'), false)
  await assert.rejects(deleteEntries(root, [path.join(root, 'library')]), /资料库根目录不能删除/)
  await assert.rejects(deleteEntries(root, ['']), /缺少路径/)
})

await test('资料库根只做容器：不能改名、不能移动、不能删（宿主硬拦）', async () => {
  const lib = path.join(root, 'library')
  assert.throws(() => renameEntry(root, lib, '资料库2'), /资料库根目录不能改名/)
  await assert.rejects(moveEntry(root, lib, path.join(root, 'wiki'), 'skip', []), /资料库根目录不能移动/)
  await assert.rejects(deleteEntries(root, [lib]), /资料库根目录不能删除/)
  // 库内目录则照常可改名/可移动
  fs.mkdirSync(path.join(lib, '甲'), { recursive: true })
  fs.mkdirSync(path.join(lib, '大学'), { recursive: true })
  const renamed = renameEntry(root, path.join(lib, '甲'), '乙')
  assert.equal(renamed.path, path.join(fs.realpathSync(lib), '乙'))
  const moved = await moveEntry(root, path.join(lib, '乙'), path.join(lib, '大学'), 'skip', [])
  assert.equal(moved.path, path.join(fs.realpathSync(lib), '大学', '乙'))
  fs.rmdirSync(path.join(lib, '大学', '乙'))
  fs.rmdirSync(path.join(lib, '大学'))
})

await test('rewriteWikiLinks：解析判据而非字面比名（大小写 / .md / 空格写法一并覆盖）', () => {
  const pages = [
    { rel: 'wiki/基础', space: 'wiki' },
    { rel: 'wiki/基础2', space: 'wiki' },
  ]
  const out = rewriteWikiLinks('[[基础]] [[基础.md]] [[ 基础 ]] [[基础2]]', pages, 'wiki/基础', { kind: 'name', name: '基础X' })
  assert.equal(out, '[[基础X]] [[基础X]] [[ 基础X ]] [[基础2]]')
})

fs.rmSync(root, { recursive: true, force: true })
