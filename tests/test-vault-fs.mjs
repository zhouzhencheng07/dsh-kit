// vault 文件管理单测（改名/移动的 wikilink 改写 + 导入收图 + 路径安全 + 撞名策略）：
// 跑 dist/vault/fs.js（先 pnpm build）。用法：node tests/test-vault-fs.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VaultScanner } from '../dist/vault/scanner.js'
import {
  cleanRefs,
  createEntry,
  dedupeName,
  deleteEntries,
  importEntry,
  isKnowledgeSet,
  listKnowledgeSets,
  moveEntry,
  pullImages,
  readFolderRefs,
  renameEntry,
  resolveInside,
  rewriteLibraryRefs,
  rewriteWikiLinks,
  safeLeaf,
  safeRel,
  setFolderRefs,
  storeAttachment,
  unmarkFolder,
  writePage,
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

await test('renameEntry：.markdown 页改名沿用原扩展名（写死 .md 会造成同 rel 两份文件）', () => {
  write('wiki/旧写法.markdown', '正文')
  const res = renameEntry(root, path.join(root, 'wiki', '旧写法.markdown'), '新写法')
  assert.equal(res.path, path.join(fs.realpathSync(root), 'wiki', '新写法.markdown'))
  assert.equal(exists('wiki/新写法.markdown'), true)
  assert.equal(exists('wiki/新写法.md'), false)
  renameEntry(root, path.join(root, 'wiki', '新写法.markdown'), '旧写法')
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

await test('importEntry：上传字节落资料库原样保留扩展名；同内容按哈希复用，不落第二份', async () => {
  const up = await importEntry(root, {
    destAbs: path.join(root, 'library'),
    name: '统计.pdf',
    fileName: '统计.pdf',
    data: Buffer.from('%PDF-1.4 up'),
    conflict: 'skip',
  })
  assert.equal(up.name, '统计.pdf')
  assert.equal(read('library/统计.pdf'), '%PDF-1.4 up')
  // 同一份字节再导：按内容复用第一份（与桌面端同口径），不再落 统计 (2).pdf
  const up2 = await importEntry(root, {
    destAbs: path.join(root, 'library'),
    name: '统计.pdf',
    fileName: '统计.pdf',
    data: Buffer.from('%PDF-1.4 up'),
    conflict: 'skip',
  })
  assert.equal(up2.already, true)
  assert.equal(up2.path, up.path)
  assert.equal(exists('library/统计 (2).pdf'), false)
  // 不同内容仍按名字加序号
  const other = await importEntry(root, {
    destAbs: path.join(root, 'library'),
    name: '统计.pdf',
    fileName: '统计.pdf',
    data: Buffer.from('%PDF-1.4 other'),
    conflict: 'skip',
  })
  assert.equal(other.name, '统计 (2).pdf')
  await assert.rejects(
    importEntry(root, { destAbs: path.join(root, 'wiki'), name: 'x.pdf', fileName: 'x.pdf', data: Buffer.from('x'), conflict: 'skip' }),
    /笔记区只收 md/,
  )
  await assert.rejects(importEntry(root, { destAbs: path.join(root, 'wiki'), name: '外', srcPath: path.join(root, 'wiki', '基础.md'), conflict: 'skip' }), /源文件已在知识库内/)
})

await test('importEntry：library/ 不存在时按需建并落库（资料导入链路不因目录缺席而断）', async () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-lib-'))
  try {
    const r = await importEntry(fresh, { destAbs: path.join(fresh, 'library'), name: '首份.pdf', fileName: '首份.pdf', data: Buffer.from('%PDF first'), conflict: 'rename' })
    assert.equal(fs.existsSync(path.join(fresh, 'library')), true)
    assert.equal(fs.readFileSync(r.path, 'utf8'), '%PDF first')
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true })
  }
})

await test('renameEntry：资料库改名撞名自动加序号；笔记页仍报错', () => {
  write('library/论文.pdf', '%PDF a')
  write('library/另一篇.pdf', '%PDF b')
  const renamed = renameEntry(root, path.join(root, 'library', '另一篇.pdf'), '论文')
  assert.equal(path.basename(renamed.path), '论文 (2).pdf')
  write('笔记甲.md', '# 甲')
  write('笔记乙.md', '# 乙')
  assert.throws(() => renameEntry(root, path.join(root, '笔记乙.md'), '笔记甲'), /同名文件已存在/)
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

await test('writePage：mtime 对得上才落盘（原子写），对不上回 modified 且不写', () => {
  const abs = write('写回.md', '原')
  const mtime = fs.statSync(abs).mtimeMs
  const ok = writePage(root, abs, '改', mtime)
  assert.equal(read('写回.md'), '改')
  assert.ok(ok.mtimeMs > 0 && ok.modified === undefined)
  // 同一毫秒内的两次写 mtime 可能相等（时间戳精度），先把盘上时间顶到未来再试 CAS
  const future = new Date(Date.now() + 5000)
  fs.utimesSync(abs, future, future)
  const stale = writePage(root, abs, '抢写', mtime)
  assert.equal(stale.modified, true)
  assert.equal(stale.mtimeMs, fs.statSync(abs).mtimeMs)
  assert.equal(read('写回.md'), '改')
  assert.equal(exists('写回.md.tmp'), false)
})

await test('writePage：tmp 名唯一（两个页签同存一页不互踩）且不残留', () => {
  const abs = write('并发.md', '原')
  const before = new Set(fs.readdirSync(root).filter((n) => n.startsWith('并发.md')))
  // 两次写连着来：tmp 名必须不同，否则后一次覆盖前一次的 tmp，一次 rename 就吃掉两份
  const a = writePage(root, abs, 'A', fs.statSync(abs).mtimeMs)
  const b = writePage(root, abs, 'B', a.mtimeMs)
  assert.equal(read('并发.md'), 'B')
  const after = fs.readdirSync(root).filter((n) => n.startsWith('并发.md'))
  // 只剩正文一个（无 .tmp 残留），文件名与写前一致
  assert.deepEqual(after, [...before])
})

await test('writePage：文件已不在回 missing（丢弃这次写，不把旧页写活）；非 md / 库外 / 超限拒写', () => {
  const gone = write('改名后.md', 'x')
  fs.rmSync(gone)
  assert.deepEqual(writePage(root, gone, 'y', 1), { mtimeMs: 0, missing: true })
  assert.equal(exists('改名后.md'), false)
  write('非页.txt', 't')
  assert.throws(() => writePage(root, path.join(root, '非页.txt'), 'y', 1), /只允许写 md/)
  assert.throws(() => writePage(root, path.join(root, '..', '外.md'), 'y', 1), /上跳段|不在知识库内/)
  // 1MB 是编辑上限：库是编辑面，整篇读得回才允许写——600KB 现在能写，超 1MB 拒
  const big = write('大.md', 'a')
  assert.equal(writePage(root, big, 'x'.repeat(600 * 1024), fs.statSync(big).mtimeMs).mtimeMs > 0, true)
  assert.throws(() => writePage(root, big, 'x'.repeat(1024 * 1024 + 1), fs.statSync(big).mtimeMs), /超过 1MB/)
})

await test('storeAttachment：内容寻址落 attachments/，同内容复用不重写；非图片按 png 落', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const first = storeAttachment(root, png, 'paste.png')
  assert.equal(first.reused, false)
  assert.match(first.rel, /^attachments\/[0-9a-f]{2}\/[0-9a-f]{16}\.png$/)
  assert.equal(fs.readFileSync(path.join(root, first.rel)).length, png.length)
  const again = storeAttachment(root, png, 'paste.png')
  assert.equal(again.rel, first.rel)
  assert.equal(again.reused, true)
  const odd = storeAttachment(root, Buffer.from('gif89a'), 'clip.gif')
  assert.equal(odd.rel.endsWith('.gif'), true)
  assert.throws(() => storeAttachment(root, Buffer.alloc(0), 'x.png'), /空的/)
})

await test('知识集：cleanRefs 与桌面端同口径 + 标记写 .refs.json + 索引上报', async () => {
  // 与桌面端 clean_refs 一字不差：只裁空白 + 反斜杠归一 + 去空去重；不解 .. / 不折内部空段
  assert.deepEqual(cleanRefs([' 书.pdf ', '书.pdf', '../外.pdf', 'a\\b.pdf', '', 3]), ['书.pdf', '../外.pdf', 'a/b.pdf'])
  write('课/笔记.md', '# 课')
  write('library/书.pdf', '%PDF')
  const ke = path.join(root, '课')
  setFolderRefs(root, ke, ['书.pdf', ' 书.pdf ', '../外.pdf'])
  assert.equal(isKnowledgeSet(ke), true)
  assert.deepEqual(readFolderRefs(ke), ['书.pdf', '../外.pdf'])
  assert.equal(exists('课/.refs.json'), true)
  const index = await new VaultScanner(() => root).scan()
  const set = (index.knowledgeSets ?? []).find((s) => s.dir === '课')
  assert.deepEqual(set?.refs, ['书.pdf', '../外.pdf'])
  assert.equal(listKnowledgeSets(root).some((s) => s.dir === '课'), true)
})

await test('知识集：允许嵌套；空目录 / 库根都拒；unmark 删标记（资料实物不动）', () => {
  write('课2/子/页.md', '# 页')
  const ke2 = path.join(root, '课2')
  const zi = path.join(root, '课2', '子')
  setFolderRefs(root, zi, ['书.pdf'])
  // 嵌套：含知识集的父目录照样能自己标记，两层清单互不干扰
  setFolderRefs(root, ke2, ['别的.pdf'])
  assert.equal(isKnowledgeSet(zi), true)
  assert.deepEqual(readFolderRefs(zi), ['书.pdf'])
  assert.deepEqual(readFolderRefs(ke2), ['别的.pdf'])
  const dirs = listKnowledgeSets(root).map((s) => s.dir)
  assert.equal(dirs.includes('课2'), true)
  assert.equal(dirs.includes('课2/子'), true)
  unmarkFolder(root, zi)
  assert.equal(exists('课2/子/.refs.json'), false)
  assert.equal(exists('课2/子/页.md'), true)
  unmarkFolder(root, ke2)
  const empty = path.join(root, '空课')
  fs.mkdirSync(empty)
  assert.throws(() => setFolderRefs(root, empty, []), /空目录/)
  assert.throws(() => setFolderRefs(root, root, []), /知识库根/)
  unmarkFolder(root, path.join(root, '课'))
  assert.equal(exists('课/.refs.json'), false)
})

await test('知识集：库内文献 / 目录改名与移动改写挂载清单', async () => {
  write('library/手册/上.pdf', '%PDF')
  const ke = path.join(root, '课')
  setFolderRefs(root, ke, ['书.pdf', '手册/上.pdf', '别的.pdf'])
  renameEntry(root, path.join(root, 'library', '书.pdf'), '新书')
  assert.deepEqual(readFolderRefs(ke), ['新书.pdf', '手册/上.pdf', '别的.pdf'])
  renameEntry(root, path.join(root, 'library', '手册'), '手册2')
  assert.deepEqual(readFolderRefs(ke), ['新书.pdf', '手册2/上.pdf', '别的.pdf'])
  await moveEntry(root, path.join(root, 'library', '手册2', '上.pdf'), path.join(root, 'library'), 'skip')
  assert.deepEqual(readFolderRefs(ke), ['新书.pdf', '上.pdf', '别的.pdf'])
  // 库外改名不碰清单
  write('wiki/页.md', '# 页')
  rewriteLibraryRefs(root, '不存在的.pdf', 'x.pdf')
  assert.deepEqual(readFolderRefs(ke), ['新书.pdf', '上.pdf', '别的.pdf'])
})

await test('pullImages：判界按解码后的落点——源目录之外（含编码过的绝对路径）一律不收', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-pull-'))
  const secret = path.join(src, '..', 'secret.txt')
  fs.writeFileSync(secret, 'TOP-SECRET', 'utf8')
  fs.mkdirSync(path.join(src, 'img'), { recursive: true })
  fs.writeFileSync(path.join(src, 'img', 'a.png'), 'png-bytes', 'utf8')
  const encoded = encodeURIComponent(path.resolve(secret))
  const md = [
    `![a](img/a.png)`,
    `![b](../secret.txt)`,
    `![c](${encoded})`,
    `![d](https://x/y.png)`,
  ].join('\n')
  const [out, n] = pullImages(md, src, root)
  assert.equal(n, 1, `只该收源目录内的那张：${out}`)
  assert.match(out, /!\[a\]\(attachments\/[0-9a-f]{2}\/[0-9a-f]{16}\.png\)/)
  // 越界的引用原样留着（由用户自己补），一个字节都没读进来
  assert.match(out, /!\[b\]\(\.\.\/secret\.txt\)/)
  assert.ok(out.includes(`![c](${encoded})`), `编码过的越界引用必须原样留着：${out}`)
  assert.match(out, /!\[d\]\(https:\/\/x\/y\.png\)/)
  fs.rmSync(src, { recursive: true, force: true })
  fs.rmSync(secret, { force: true })
})

await test('renameEntry：跨 .md/.markdown 的同 rel 判撞名（不许悄悄落下第二份同 rel 页）', () => {
  write('dup/b.md', '# b')
  write('dup/a.markdown', '# a')
  assert.throws(() => renameEntry(root, path.join(root, 'dup', 'a.markdown'), 'b'), /同名文件已存在：b\.md/)
  // 反向：目标扩展名那份不存在、另一种存在，同样拦
  write('dup/c.md', '# c')
  write('dup/d.markdown', '# d')
  assert.throws(() => renameEntry(root, path.join(root, 'dup', 'c.md'), 'd'), /同名文件已存在：d\.markdown/)
  // 只有自己那一种扩展名时照常改名（纯大小写改名也不误判）
  renameEntry(root, path.join(root, 'dup', 'c.md'), 'c2')
  assert.equal(exists('dup/c2.md'), true)
  renameEntry(root, path.join(root, 'dup', 'a.markdown'), 'b2')
  assert.equal(exists('dup/b2.markdown'), true)
  fs.rmSync(path.join(root, 'dup'), { recursive: true, force: true })
})

await test('importEntry：库里残留的 *.tmp 不当同内容复用（中间件冒充文献会挂成永久悬挂）', async () => {
  const bytes = Buffer.from('%PDF tmp-dedupe')
  write('library/半截.pdf.8812.deadbeef.tmp', bytes.toString('utf8'))
  const res = await importEntry(root, { destAbs: path.join(root, 'library'), name: '正式.pdf', fileName: '正式.pdf', data: bytes, conflict: 'rename' })
  assert.equal(res.name, '正式.pdf')
  assert.equal(exists('library/正式.pdf'), true)
  fs.rmSync(path.join(root, 'library', '正式.pdf'), { force: true })
  fs.rmSync(path.join(root, 'library', '半截.pdf.8812.deadbeef.tmp'), { force: true })
})

fs.rmSync(root, { recursive: true, force: true })
