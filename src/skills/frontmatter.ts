// 技能 frontmatter 解析（宿主半边共用）
//
// 宽容解析：只取平铺的 `key: value`（技能 frontmatter 的既有形态），但值的**块标量**
// 写法要认——`description: >-` / `|` 这类多行描述在技能里很常见，按 YAML 规则折叠
// 或保留换行再取值；不认就会把字面量「>−」当成描述本身，面板上只剩那两个字符。
// 嵌套映射、序列、多文档等不认：技能 frontmatter 不要求，遇到即当没有该键。

const KEY_RE = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/
/** 块标量头：`|` `>` 后可跟 chomping（+/-）与缩进指示（数字），两者顺序不限 */
const BLOCK_HEAD_RE = /^([|>])([0-9+-]*)$/

/** 头部扫描上限：块标量会让 frontmatter 变长，但仍只读文件开头一小段 */
const HEAD_MAX = 16384

interface BlockHead {
  /** true = 折叠（>），false = 保留换行（|） */
  folded: boolean
  /** '-' 去掉尾部换行、'+' 全留、空 = 保留一个 */
  chomp: '-' | '+' | ''
  /** 显式缩进指示（相对键的缩进量）；0 = 按首个内容行自动判定 */
  indent: number
}

function blockHead(value: string): BlockHead | null {
  const m = BLOCK_HEAD_RE.exec(value)
  if (!m) return null
  const flags = m[2] ?? ''
  const digits = flags.replace(/[+-]/g, '')
  return {
    folded: m[1] === '>',
    chomp: flags.includes('-') ? '-' : flags.includes('+') ? '+' : '',
    indent: digits === '' ? 0 : Number(digits),
  }
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function unquote(value: string): string {
  if (value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * 按 YAML 拼块标量：折叠样式把行间接行折成空格，空行成换行，比块缩进更深的行保留换行。
 * trailing 是内容之后的空行数（chomping 的三档只看它）。
 */
function joinBlock(body: string[], more: boolean[], folded: boolean): { text: string; trailing: number } {
  let out = ''
  let prev: string | null = null
  let prevMore = false
  let blanks = 0
  for (let i = 0; i < body.length; i++) {
    const line = body[i]!
    if (line === '') {
      blanks++
      continue
    }
    if (prev === null) out = line
    else if (!folded) out += '\n' + line
    else if (blanks > 0) out += '\n'.repeat(blanks) + line
    else if (more[i] === true || prevMore) out += '\n' + line
    else out += ' ' + line
    prev = line
    prevMore = more[i] === true
    blanks = 0
  }
  return { text: out, trailing: blanks }
}

/** 解析 SKILL.md 等文本开头的 frontmatter，返回键值表（键小写）；无 frontmatter 返回空表 */
export function parseFrontmatter(text: string): Record<string, string> {
  const head = text.slice(0, HEAD_MAX)
  if (!/^---[ \t]*\r?\n/.test(head)) return {}
  const close = head.slice(3).match(/^---[ \t]*(?:\r?\n|$)/m)
  if (!close) return {}
  const lines = head.slice(3, 3 + close.index!).split(/\r?\n/)
  const data: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = KEY_RE.exec(lines[i]!)
    if (!m) continue
    const value = m[2]!.trim()
    const block = value === '' ? null : blockHead(value)
    if (block === null) {
      data[m[1]!.toLowerCase()] = unquote(value)
      continue
    }
    // 块标量：吃掉后续所有「缩进比键更深或空」的行
    const parentIndent = indentOf(lines[i]!)
    let end = i + 1
    while (end < lines.length) {
      const line = lines[end]!
      if (line.trim() === '') { end++; continue }
      if (indentOf(line) <= parentIndent) break
      end++
    }
    const raw = lines.slice(i + 1, end)
    const firstContent = raw.find((line) => line.trim() !== '') ?? ''
    const indent = block.indent > 0 ? parentIndent + block.indent : indentOf(firstContent)
    const body = raw.map((line) => (line === '' ? '' : line.slice(Math.min(indent, line.length))))
    const more = raw.map((line) => line !== '' && indentOf(line) > indent)
    const joined = joinBlock(body, more, block.folded)
    const tail = block.chomp === '+' ? joined.trailing : block.chomp === '-' || joined.text === '' ? 0 : 1
    data[m[1]!.toLowerCase()] = joined.text + '\n'.repeat(tail)
    i = end - 1
  }
  return data
}
