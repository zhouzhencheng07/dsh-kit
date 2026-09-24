// 死代码哨兵（client/bundle.js + packages/*/client/bundle.js）：把"功能删了、
// 残件还留着"的东西拦在提交前。组件化后词条/函数/CSS 的消费者可能住在组件包
// （如 dock 包的 RB_FEATURES 引用根包词条 dockBrowser），扫描面 = 根包 + 全部组件包。
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
// 组件包 client 半边并入扫描面（词条/类名的消费方可能搬过去了）
const pkgDir = path.join(root, 'packages')
let pkgSrc = ''
if (fs.existsSync(pkgDir)) {
  for (const p of fs.readdirSync(pkgDir)) {
    const f = path.join(pkgDir, p, 'client', 'bundle.js')
    if (fs.existsSync(f)) pkgSrc += '\n' + fs.readFileSync(f, 'utf8')
  }
}
const src = rootSrc + pkgSrc
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
const zhStart = src.indexOf('const zh = {')
const zhEnd = src.indexOf('\n    };', zhStart)
if (zhStart < 0 || zhEnd < 0) die('找不到 zh 字典锚点（client/bundle.js 结构变了，哨兵要同步）')
const enStart = src.indexOf('const en = {')
if (enStart < 0) die('找不到 en 字典锚点')
const cssStart = src.indexOf('const UI_CSS = \`')
const cssEnd = src.indexOf('\`;', cssStart)
if (cssStart < 0 || cssEnd < 0) die('找不到 UI_CSS 锚点（client/bundle.js 结构变了，哨兵要同步）')
// render-check 用 body.replace("return module.exports;", "return {...};") 注入导出表，
// 里面列到的名字算"被测试引用"——否则测试专用的 getKitUi 这类会被误判成零调用。
// 锚点必须认准那一条（文件里还有别的 return {...}，比如 jsx 桩）
const renderPath = path.join(root, 'tests', 'render-check.cjs')
const renderSrc = fs.existsSync(renderPath) ? fs.readFileSync(renderPath, 'utf8') : ''
const EXPORT_ANCHOR = 'return { vaultSideSlot'
const exportAt = renderSrc.indexOf(EXPORT_ANCHOR)
if (renderSrc !== '' && exportAt < 0) die('找不到 render-check 导出表锚点（测试结构变了，哨兵要同步）')
const exportedNames = new Set(
  (exportAt < 0 ? '' : renderSrc.slice(exportAt + 'return {'.length, renderSrc.indexOf('};', exportAt)))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== ''),
)
if (exportAt >= 0 && exportedNames.size < 40) die('render-check 导出表只解析出 ' + exportedNames.size + ' 个名字，锚点可能失效')

// ── 1) i18n 词条 ──
// 动态拼的键（cfg 加字段名，插件设置卡时代）随设置卡退役清零；新前缀出现时
// 加回这张表
const dynamicKeyPrefixes = []
const TEMPLATE_START = '\`' + '$' + '{'
for (const p of dynamicKeyPrefixes) {
  if (!src.includes('\`' + p + '$' + '{')) notes.push('动态键前缀 ' + p + ' 在源码里已找不到拼接处，确认后从哨兵豁免表删掉')
}
{
  const zhBody = src.slice(zhStart, zhEnd)
  const enBody = src.slice(enStart, src.indexOf('\n    };', enStart))
  const keys = [...new Set([...zhBody.matchAll(/\n {6}([A-Za-z_$][\w$]*):/g)].map((m) => m[1]))]
  if (keys.length < 100) fail('i18n 字典只解析出 ' + keys.length + ' 个键，锚点可能失效')
  for (const key of keys) {
    if (dynamicKeyPrefixes.some((p) => key.startsWith(p))) continue
    if (count(src, key) <= 2) fail('i18n 死词条：' + key + '（只有字典定义处，无代码引用；zh/en 各一条）')
    if (!enBody.includes(key + ':')) fail('i18n 键缺 en 侧：' + key)
  }
  if (TEMPLATE_START === '') fail('哨兵内部常量失效')
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
  const css = src.slice(cssStart, cssEnd)
  const jsOnly = src.slice(0, cssStart) + src.slice(cssEnd)
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
