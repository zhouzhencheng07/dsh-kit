// 死代码哨兵（client/bundle.js）：把"功能删了、残件还留着"的东西拦在提交前。
// 扫描面 = 根 bundle（组件半边都在同一个文件里）。
// 三类发现，全部按引用计数判死，判据随每条注释：
//   1) i18n 词条：zh/en 字典里定义了、全文件却只有定义处那两处（动态拼的键前缀除外）
//   2) 顶层函数：全文件只出现一次（定义行），且不在 render-check 的导出表里
//   3) CSS 类：UI_CSS 里定了规则，但 JS 侧与所有 vendor 产物里都没有这个类名
//     （模板串拼出来的类名按前缀豁免，前缀从源码里现扫）
// 判据是启发式而非编译器级——宁可漏报也不误报；任何一段找不到扫描锚点都直接报错
// 退出，避免"扫描失效但静默通过"。
// 用法（dsh-kit 根）：node tests/dead-code-check.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rootSrc = fs.readFileSync(path.join(root, 'client', 'bundle.js'), 'utf8')
const src = rootSrc
const problems = []
const notes = []
const fail = (msg) => problems.push(msg)
const die = (msg) => {
  console.error('FATAL: ' + msg)
  process.exit(2)
}

/** 词边界计数：后面不许跟 [\w-]，否则 dshk-branch 会命中 dshk-branch-row */
const count = (hay, word) => (hay.match(new RegExp('\\b' + word + '(?![\\w-])', 'g')) ?? []).length
/** 模板串前缀：形如 dshk-diff- 加插值的类名按前缀豁免 */
const DYNAMIC_CLASS_RE = new RegExp('(dshk-[a-z0-9-]*-)' + '\\$' + '\\{', 'g')
const dynamicPrefixes = (hay) => [...new Set([...hay.matchAll(DYNAMIC_CLASS_RE)].map((m) => m[1]))]

// ── 锚点 ──
// 字典成对出现（根包一份 + 各组件模块各自的私有字典）：逐对校验。只锚第一对
// 会把组件词条漏出扫描面——组件化后根包字典本来就只剩主行那几十条
const dictPairs = []
{
  const zhRe = /const zh = \{/g
  let m
  while ((m = zhRe.exec(src)) !== null) {
    const zhS = m.index
    const zhE = src.indexOf('\n    };', zhS)
    if (zhE < 0) die('zh 字典未闭合（client/bundle.js 结构变了，哨兵要同步）')
    const enS = src.indexOf('const en = {', zhE)
    if (enS < 0) die('找不到 en 字典锚点（client/bundle.js 结构变了，哨兵要同步）')
    const enE = src.indexOf('\n    };', enS)
    if (enE < 0) die('en 字典未闭合（client/bundle.js 结构变了，哨兵要同步）')
    dictPairs.push([zhS, zhE, enS, enE])
  }
  if (dictPairs.length < 3) die('只找到 ' + dictPairs.length + ' 对 zh/en 字典，锚点可能失效')
}
const cssStart = src.indexOf('const UI_CSS = \`')
if (cssStart < 0) die('找不到 UI_CSS 锚点（client/bundle.js 结构变了，哨兵要同步）')
// CSS 扫描面 = 所有 `<名字>CSS = \`...\`` 模板块（根 UI_CSS + 各组件自己的 XXX_CSS）：
// 类名消费者住在别的模板块，只扫根包会把它们当成"有定义无引用"
const cssRegions = []
{
  const re = /const [A-Za-z_$][\w$]*CSS = \`/g
  let m
  while ((m = re.exec(src)) !== null) {
    const end = src.indexOf('\`;', m.index)
    if (end < 0) die('CSS 模板块未闭合（结构变了，哨兵要同步）')
    cssRegions.push([m.index, end + 2])
  }
  if (cssRegions.length < 2) die('只找到 ' + cssRegions.length + ' 个 CSS 模板块，锚点可能失效')
}
// render-check 用 body.replace("return module.exports;", "return {...};") 注入导出表，
// 里面列到的名字算"被测试引用"——否则测试专用的 getKitUi 这类会被误判成零调用。
// 锚点必须认准那一条（文件里还有别的 return {...}，比如 jsx 桩）
const renderPath = path.join(root, 'tests', 'render-check.cjs')
const renderSrc = fs.existsSync(renderPath) ? fs.readFileSync(renderPath, 'utf8') : ''
const EXPORT_ANCHOR = 'return Object.assign({ KitSurfaces'
const exportAt = renderSrc.indexOf(EXPORT_ANCHOR)
if (renderSrc !== '' && exportAt < 0) die('找不到 render-check 导出表锚点（测试结构变了，哨兵要同步）')
const exportedNames = new Set(
  (exportAt < 0 ? '' : renderSrc.slice(exportAt + 'return Object.assign({'.length, renderSrc.indexOf('}, kitBase,', exportAt)))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== ''),
)
if (exportAt >= 0 && exportedNames.size < 15) die('render-check 导出表只解析出 ' + exportedNames.size + ' 个名字，锚点可能失效')

// ── 1) i18n 词条 ──
// 动态拼的键按前缀豁免（cfg 加字段名之类）；有新的拼接前缀时加进这张表
const dynamicKeyPrefixes = []
for (const p of dynamicKeyPrefixes) {
  if (!src.includes('\`' + p + '$' + '{')) notes.push('动态键前缀 ' + p + ' 在源码里已找不到拼接处，确认后从哨兵豁免表删掉')
}
{
  let totalKeys = 0
  for (const [zhS, zhE, enS, enE] of dictPairs) {
    const zhBody = src.slice(zhS, zhE)
    const enBody = src.slice(enS, enE)
    const keys = [...new Set([...zhBody.matchAll(/\n {6}([A-Za-z_$][\w$]*):/g)].map((m) => m[1]))]
    totalKeys += keys.length
    for (const key of keys) {
      if (dynamicKeyPrefixes.some((p) => key.startsWith(p))) continue
      if (count(src, key) <= 2) fail('i18n 死词条：' + key + '（只有字典定义处，无代码引用；zh/en 各一条）')
      if (!enBody.includes(key + ':')) fail('i18n 键缺 en 侧：' + key)
    }
  }
  if (totalKeys < 100) fail('i18n 字典合计只解析出 ' + totalKeys + ' 个键，锚点可能失效')
}

// ── 2) 顶层函数 ──
{
  const names = new Set()
  for (const m of src.matchAll(/\n\s{0,6}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1])
  for (const m of src.matchAll(/\n\s{0,6}(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1])
  if (names.size < 200) fail('只解析出 ' + names.size + ' 个函数声明，锚点可能失效')
  for (const name of names) {
    if (exportedNames.has(name)) continue
    if (count(src, name) <= 1) fail('零调用函数：' + name + '（全文件仅定义处出现）')
  }
}

// ── 3) CSS 类 ──
{
  const css = cssRegions.map(([s, e]) => src.slice(s, e)).join('\n')
  let jsOnly = ''
  {
    let pos = 0
    for (const [s, e] of cssRegions) {
      jsOnly += src.slice(pos, s)
      pos = e
    }
    jsOnly += src.slice(pos)
  }
  const vendorDir = path.join(root, 'client', 'vendor')
  let vendor = ''
  if (fs.existsSync(vendorDir)) {
    for (const f of fs.readdirSync(vendorDir)) {
      if (f.endsWith('.js')) vendor += fs.readFileSync(path.join(vendorDir, f), 'utf8')
    }
  }
  const classes = [...new Set([...css.matchAll(/\.(dshk-[a-z0-9-]+)(?![\w-])/g)].map((m) => m[1]))]
  if (classes.length < 100) fail('只解析出 ' + classes.length + ' 个 CSS 类，锚点可能失效')
  const prefixes = dynamicPrefixes(jsOnly)
  for (const cls of classes) {
    if (prefixes.some((p) => cls.startsWith(p))) continue
    if (count(jsOnly, cls) === 0 && count(vendor, cls) === 0) fail('死 CSS 类：.' + cls + '（JS 与 vendor 都没有这个类名）')
  }
  notes.push('动态类前缀豁免：' + (prefixes.join(' ') || '(无)'))
}

// ── 输出 ──
for (const n of notes) console.log('NOTE  ' + n)
if (problems.length === 0) {
  console.log('PASS  死代码哨兵：词条 / 函数 / CSS 三类均无发现')
  process.exit(0)
}
console.log('FAIL  死代码哨兵发现 ' + problems.length + ' 项：')
for (const p of problems) console.log('  - ' + p)
process.exit(1)
