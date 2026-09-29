// frontmatter 解析直测（tests/test-skill-frontmatter.mjs）
//
// 解析器是 TS，跑测试前需 pnpm build（本脚本读 dist 产物，与 test-loop-breaker /
// test-schedule 同一口径）。覆盖：行级平铺值、块标量（折叠/保留换行、三种 chomping、
// 缩进指示、块内更深缩进的行）、CRLF、无 frontmatter、块后仍有键。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist', 'skills', 'frontmatter.js')
if (!existsSync(dist)) {
  console.error(`缺 ${dist}——先跑 pnpm build`)
  process.exit(1)
}

const { parseFrontmatter } = await import(`file://${dist.replace(/\\/g, '/')}`)

let failed = 0
const check = (label, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label)
  if (!ok) failed++
}
const eq = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) console.log(`      实际 ${JSON.stringify(actual)}\n      期望 ${JSON.stringify(expected)}`)
  check(label, ok)
}

const fm = (...lines) => parseFrontmatter(['---', ...lines, '---', ''].join('\n'))

/** 用户真机上的写法：折叠 + 去尾换行，面板曾只显示字面量 ">-" */
eq(
  '折叠块（>-）两行折成一行',
  fm('name: wangshu-vault', 'description: >-', '  第一句；', '  第二句。').description,
  '第一句； 第二句。',
)
eq('保留换行块（|）默认留一个尾换行', fm('description: |', '  甲', '  乙').description, '甲\n乙\n')
eq('保留换行块（|-）去尾换行', fm('description: |-', '  甲', '  乙').description, '甲\n乙')
eq('折叠块（>）默认留一个尾换行', fm('description: >', '  甲', '  乙').description, '甲 乙\n')
// 尾部换行三档：内容之后每一条空行都算一次换行（闭合围栏前那个换行也算一条）
eq('保留换行块（|+）留全部尾空行', fm('description: |+', '  甲', '', '').description, '甲\n\n\n')
eq('默认 chomping 只留一个尾换行', fm('description: |', '  甲', '', '').description, '甲\n')
eq('去尾 chomping 削到零', fm('description: |-', '  甲', '', '').description, '甲')
eq('块内空行仍是段落分隔', fm('description: >-', '  甲', '', '  乙').description, '甲\n乙')
eq('折叠块里更深缩进的行保留换行', fm('description: >-', '  甲', '    乙', '  丙').description, '甲\n  乙\n丙')
eq('显式缩进指示按它剥缩进', fm('description: |2-', '    甲').description, '  甲')
eq('块后仍有键（块在下一个键处收尾）', fm('description: >-', '  甲', 'name: x').name, 'x')
eq('空块取空串', fm('description: |', 'name: x').description, '')
eq('平铺单行值照旧', fm('description: 共享技能').description, '共享技能')
eq('成对引号照旧剥掉', fm('description: "引号内"').description, '引号内')
eq('开关值照旧', fm('disable-model-invocation: true', 'user-invocable: false')['user-invocable'], 'false')
eq('键名小写化', fm('Description: 甲').description, '甲')
eq('CRLF 一样认', parseFrontmatter('---\r\ndescription: >-\r\n  甲\r\n  乙\r\n---\r\n\r\n# 正文\r\n').description, '甲 乙')
eq('无 frontmatter 得空表', parseFrontmatter('# 标题\n\n正文\n').description, undefined)
eq('未闭合的块当没有 frontmatter', parseFrontmatter('---\ndescription: >-\n  甲\n').description, undefined)
eq('正文里的 --- 不影响已解析的值', fm('description: >-', '  甲').description, '甲')

// 真机样本回归：面板上 wangshu-vault 描述只剩 ">-" 的那份文件
const real = parseFrontmatter([
  '---',
  'name: wangshu-vault',
  'description: >-',
  '  知识库（vault）使用规则——往知识库里记笔记、写项目知识页、查已有知识、整理或合并页面；',
  '  写库前必读。库里既有用户笔记（学习、本机记录），也有项目知识（总览与功能活页）。',
  '---',
  '',
  '# 知识库（vault）使用规则',
].join('\n'))
assert.ok(real.description.startsWith('知识库（vault）使用规则——'), '真实样本的描述应完整')
eq('真实样本：描述完整且不含 ">-"', real.description.includes('>-'), false)
eq('真实样本：name 不被块吞掉', real.name, 'wangshu-vault')
check('真实样本：描述长度合理', real.description.length > 40)

console.log(failed === 0 ? '\nALL PASS (test-skill-frontmatter)' : 'FAILED: ' + failed)
process.exit(failed === 0 ? 0 : 1)
