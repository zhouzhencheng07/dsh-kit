// dsh-kit/vault 组件的测验半边——题目文件的解析/序列化、内容哈希 id、掌握度与阈值。
// 数据与桌面端应用共用同一份：题目在页面所在目录的 .quiz/<页名>.md（一页一文件），
// 掌握度在 .quiz/<页名>.progress.json（按**题目内容哈希**记，页面改名/移动不丢进度），
// 阈值在库根 .quiz-state/settings.json。.quiz 是点前缀目录，不进索引与树（scanner 同款
// 排除）；页面改名/移动/删除由 fs.ts 把两份伴生文件一起带走。
// md 形状、id 归一化是跨端契约（两端同一套），单端不得改动语义；云同步的按记录
// 合并不在这里——插件不做云同步。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { SKIP_DIRS } from './scanner.ts'

export const QUIZ_DIR = '.quiz'
/** 全局答题设置的目录（库根下） */
const STATE_DIR = '.quiz-state'
const PROGRESS_SUFFIX = '.progress.json'
/** 同步落下的冲突副本名里含这一段：不进题目范围，免得冒出一个"幽灵页" */
const CONFLICT_MARK = '.conflict-'
/** 连续答对多少次算掌握（界面可改，落 .quiz-state/settings.json） */
export const DEFAULT_THRESHOLD = 3
const MAX_QUESTIONS = 300
const MAX_STEM = 2000
const MAX_OPTION = 500
const MAX_EXPLAIN = 2000
const MAX_OPTIONS = 10
const MAX_BLANKS = 10
/** 页面 rel 的清洗口径：段数与单段长度上限 */
const MAX_REL_SEGS = 16
const MAX_REL_SEG_LEN = 200
/** id 归一化的空白集合：与桌面端同一份 White_Space 表，一字不差（差一个字符 id 就分家） */
const WS_RE = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu
const WS_CLASS = '\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const WS_LEAD_RE = new RegExp(`^[${WS_CLASS}]+`)
const WS_TRAIL_RE = new RegExp(`[${WS_CLASS}]+$`)
const WS_RUN_RE = new RegExp(`[${WS_CLASS}]+`, 'g')
/** 两端裁 White_Space（= Rust `str::trim`）。**不能用 JS 的 trim/\s**——它们把 U+FEFF
 *  当空白，而 White_Space 不含它：题干末尾一个 FEFF 会让写出去的形状读回来对不上
 *  （保存时误报"与标记同形"），判断题答案行也会把 `\uFEFFtrue` 误判成 true。 */
const wsTrim = (s: string): string => s.replace(WS_LEAD_RE, '').replace(WS_TRAIL_RE, '')
const wsTrimStart = (s: string): string => s.replace(WS_LEAD_RE, '')
const wsTrimEnd = (s: string): string => s.replace(WS_TRAIL_RE, '')

// ── 题目与回前端的形状 ──────────────────────────────────────────────────────

/** 一道题。**不存 id**：id 是内容哈希，读的时候现算（改题自然变成新题、进度归零，
 *  不会留下与被改内容对不上的旧 id） */
export interface QuizQuestion {
  /** single / multi / judge / blank */
  type: string
  stem: string
  options: string[]
  /** single/multi：字母串 "ACD"（存储顺序）；judge：true/false；blank：[["答案","别名"], …] */
  answer: QuizAnswer
  explain: string
}

export type QuizAnswer = string | boolean | string[][] | null

/** 回前端的题目：存储字段 + 现算的 id（options/explain 为空时不带字段，与桌面端同形） */
export interface QuizQuestionDto extends Omit<QuizQuestion, 'options' | 'explain'> {
  id: string
  options?: string[]
  explain?: string
}

export interface QuizPageDto {
  rel: string
  questions: QuizQuestionDto[]
}

/** 一个范围（目录，递归）下所有有题的页面 */
export interface QuizScopeDto {
  dir: string
  pages: QuizPageDto[]
}

export interface QuizRecord {
  /** 连续答对次数（答错归零） */
  streak: number
  mastered: boolean
  updatedMs: number
}

interface QuizProgress {
  version: number
  progress: Record<string, QuizRecord>
}

export interface QuizSettings {
  version: number
  threshold: number
  /** 写这份设置的时刻：另一端改了阈值这边要能看出先后 */
  updatedMs: number
}

/** 回前端的掌握度：范围内（一页 / 一个目录 / 全库）的记录 + 全局阈值 */
export interface QuizProgressDto {
  version: number
  threshold: number
  progress: Record<string, QuizRecord>
}

/** 一次作答的结果（前端据此显示连击与「新掌握」） */
export interface QuizOutcome {
  streak: number
  mastered: boolean
  newlyMastered: boolean
}

/** 题目与掌握度的指纹：范围内的文件数 + 最新 mtime */
export interface QuizRevision {
  files: number
  mtimeMs: number
}

/** 保存时对**界面正在编辑的那一道题**的掌握记录怎么办：index 指向 questions 里的位置，
 *  oldId 是它原本的 id，keep = 保存后是否接续原来的掌握进度。其余题目一律不动 */
export interface QuizSaveEdit {
  index: number
  oldId: string
  keep: boolean
}

const emptyProgress = (): QuizProgress => ({ version: 1, progress: {} })

// ── 页面 rel 清洗 ───────────────────────────────────────────────────────────

/** rel → 逐段（拒空段、`.`/`..`、控制字符与超长；不含分隔符因此拼不出库外路径） */
function splitRel(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null
  const rel = raw.trim().replace(/^[/\\]+|[/\\]+$/g, '')
  if (rel === '') return null
  // 盘符（C:）能拼出库根外的绝对路径，一律拒
  if (rel.includes(':')) return null
  const segs = rel.split(/[/\\]/)
  if (segs.length > MAX_REL_SEGS) return null
  for (const seg of segs) {
    if (seg === '' || seg === '.' || seg === '..') return null
    if (/[\u0000-\u001f]/.test(seg)) return null
    if (seg.length > MAX_REL_SEG_LEN) return null
  }
  return segs
}

/** 客户端来的页面 rel（也收目录 rel）：非法抛错，合法返回规范形（`/` 分隔） */
export function safeQuizRel(raw: unknown): string {
  const segs = splitRel(raw)
  if (segs === null) throw new Error('页面路径非法')
  return segs.join('/')
}

/** 读路径的守卫：非法回 null——读端点把坏入参当「没有」处理，写路径仍走 safeQuizRel 抛错 */
function trySafeQuizRel(raw: unknown): string | null {
  if (raw === '') return ''
  const segs = splitRel(raw)
  return segs === null ? null : segs.join('/')
}

// ── 路径映射 ────────────────────────────────────────────────────────────────

function dirAbsOf(root: string, rel: string): string {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return dir === '' ? root : path.join(root, ...dir.split('/'))
}

/** 页面 rel → 题目文件绝对路径 */
export function quizPath(root: string, rel: string): string {
  const name = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
  return path.join(dirAbsOf(root, rel), QUIZ_DIR, `${name}.md`)
}

/** 页面 rel → 掌握度文件绝对路径 */
export function progressPath(root: string, rel: string): string {
  const name = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
  return path.join(dirAbsOf(root, rel), QUIZ_DIR, `${name}${PROGRESS_SUFFIX}`)
}

function settingsPath(root: string): string {
  return path.join(root, STATE_DIR, 'settings.json')
}

/** 页面文件绝对路径 → 同目录的题目文件（改名 / 移动 / 删除都从页面文件推） */
export function siblingOf(pageFile: string): string | null {
  const stem = path.basename(pageFile, path.extname(pageFile))
  const parent = path.dirname(pageFile)
  if (stem === '' || stem === '.' || stem === '..') return null
  return path.join(parent, QUIZ_DIR, `${stem}.md`)
}

function progressSiblingOf(pageFile: string): string | null {
  const stem = path.basename(pageFile, path.extname(pageFile))
  const parent = path.dirname(pageFile)
  if (stem === '' || stem === '.' || stem === '..') return null
  return path.join(parent, QUIZ_DIR, `${stem}${PROGRESS_SUFFIX}`)
}

function moveFile(from: string, to: string): void {
  if (!fs.statSync(from, { throwIfNoEntry: false })?.isFile()) return
  const dir = path.dirname(to)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    // 目标已存在等搬不动的情形：保住现有文件比抛错打断改名/移动更合适
  }
}

/** 页面改名 / 移动后把题目与掌握度文件也搬过去（没有就什么都不做）。
 *  目录的改名 / 移动不用调它——.quiz/ 在目录体内，跟着目录一起走。 */
export function followPage(oldPage: string, newPage: string): void {
  const from = siblingOf(oldPage)
  const to = siblingOf(newPage)
  if (from === null || to === null) return
  moveFile(from, to)
  const pf = progressSiblingOf(oldPage)
  const pt = progressSiblingOf(newPage)
  if (pf !== null && pt !== null) moveFile(pf, pt)
  // 旧的点目录空了就顺手删掉（不空时 rmdir 自己会失败，无事发生）
  try {
    fs.rmdirSync(path.dirname(from))
  } catch {
    /* 非空或已不在 */
  }
}

/** 页面被删除时，它的题目与掌握度文件也要一起进回收站（存在几个回几个） */
export function siblingsForDelete(pageFile: string): string[] {
  const out: string[] = []
  for (const p of [siblingOf(pageFile), progressSiblingOf(pageFile)]) {
    if (p !== null && fs.statSync(p, { throwIfNoEntry: false })?.isFile()) out.push(p)
  }
  return out
}

/** 是不是题目文件：.md 结尾，且不是同步落下的冲突副本 */
function isQuestionFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md') && !name.includes(CONFLICT_MARK)
}

/** 是不是掌握度文件 */
function isProgressFile(name: string): boolean {
  return name.endsWith(PROGRESS_SUFFIX) && !name.includes(CONFLICT_MARK)
}

/** 范围走查要跳过的目录：约定目录（scanner 同款）+ 任意深度的 `library`（资料库子树里
 *  的 md 是文献不是页面；与桌面端 SKIP_DIRS 同口径） */
function skipDir(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name) || name === 'library'
}

// ── id（跨端契约）───────────────────────────────────────────────────────────

/** 归一化：去掉全部 Unicode 空白 + **只降 ASCII A-Z**（与桌面端 `to_ascii_lowercase`
 *  同口径——`Ä`、`K`(U+212A) 这类非 ASCII 大写必须原样留着，JS 的 `toLowerCase()` 会降它们，
 *  同一道题就算出两个 id）。不上 Unicode NFKC；全角/半角差异在 id 上算两道题，判题另有口径。 */
function norm(s: string): string {
  return s.replace(WS_RE, '').replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/** 只升 ASCII a-z（对应桌面端 `to_ascii_uppercase`），其余字符不动 */
function asciiUpper(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase())
}

/** 只降 ASCII A-Z（对应桌面端 `to_ascii_lowercase`），其余字符不动 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/** 答案里的字母集合：只认 A-Z，去重升序；一个都没有回空串。
 *  升大写走 ASCII-only（`ß` 在 JS `toUpperCase` 下会变 `SS`，桌面端只认 ASCII 后为空） */
function lettersOf(v: QuizAnswer): string {
  if (typeof v !== 'string') return ''
  const out: string[] = []
  for (const ch of asciiUpper(v)) {
    if (ch >= 'A' && ch <= 'Z' && !out.includes(ch)) out.push(ch)
  }
  return out.sort().join('')
}

/** 答案的规范串（参与 id）：选择 = 去重升序字母；判断 = true/false；填空 = 各空的可接受
 *  答案按原序用 \x02 连、空之间用 \x01 连 */
function answerCanonical(q: QuizQuestion): string {
  if (q.type === 'single' || q.type === 'multi') return lettersOf(q.answer)
  if (q.type === 'judge') return q.answer === true ? 'true' : 'false'
  if (q.type === 'blank' && Array.isArray(q.answer)) {
    return q.answer.map((vs) => (Array.isArray(vs) ? vs.join('\u0002') : '')).join('\u0001')
  }
  return ''
}

/** 题目 id：内容哈希，前 16 位小写十六进制（与附件命名同口径） */
export function questionId(q: QuizQuestion): string {
  const raw = [q.type, norm(q.stem), norm(q.options.join('\u0001')), norm(answerCanonical(q))].join('\u0001')
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16)
}

// ── 写盘前的一道关 ──────────────────────────────────────────────────────────

/** 非法回错误串（指出第几题由调用方拼）——作者写的东西不能被静默丢掉 */
export function validate(q: QuizQuestion): string | null {
  if (wsTrim(q.type) === '') return '缺少题型（<!--q type=single-->）'
  if (wsTrim(q.stem) === '') return '题干不能为空'
  if ([...q.stem].length > MAX_STEM) return `题干太长（上限 ${MAX_STEM} 字）`
  if ([...q.explain].length > MAX_EXPLAIN) return `解析太长（上限 ${MAX_EXPLAIN} 字）`
  if (q.type === 'single' || q.type === 'multi') {
    if (q.options.length < 2) return '选择题至少两个选项'
    if (q.options.length > MAX_OPTIONS) return `选项最多 ${MAX_OPTIONS} 个`
    for (const o of q.options) {
      if (wsTrim(o) === '') return '选项不能为空'
      if ([...o].length > MAX_OPTION) return `单个选项太长（上限 ${MAX_OPTION} 字）`
    }
    const letters = lettersOf(q.answer)
    if (letters === '') return '缺少正确答案'
    for (const ch of letters) {
      if (ch.charCodeAt(0) - 65 >= q.options.length) return '答案超出选项范围'
    }
    if (q.type === 'single' && letters.length !== 1) return '单选题只能有一个答案'
    if (q.type === 'multi' && letters.length < 2) return '多选题至少两个答案'
    return null
  }
  if (q.type === 'judge') {
    return typeof q.answer === 'boolean' ? null : '判断题答案必须是 true / false'
  }
  if (q.type === 'blank') {
    if (!Array.isArray(q.answer)) return '填空题答案要按空给'
    if (q.answer.length === 0) return '填空题至少要有一个空的答案'
    if (q.answer.length > MAX_BLANKS) return `填空题最多 ${MAX_BLANKS} 个空`
    for (const vs of q.answer) {
      if (!Array.isArray(vs) || !vs.some((v) => typeof v === 'string' && wsTrim(v) !== '')) {
        return '填空题每空的答案要是字符串数组'
      }
    }
    return null
  }
  return `不认识的题型：${q.type}`
}

// ── 题目文件的 md 形状（解析 / 序列化，跨端契约）────────────────────────────

const MARK_OPT = '<!--opt-->'
const MARK_ANSWER = '<!--answer-->'
const MARK_EXPLAIN = '<!--explain-->'

type Section = 'q' | 'stem' | 'opt' | 'answer' | 'explain'

/** 行首标记 → （段，题型）。**只看行首**：缩进过的当普通文本，这样题干里想写标记行
 *  也有一条出路（缩进一格）。`<!--q single-->` 与 `<!--q type=single-->` 都收 */
function markerOf(line: string): [Section, string] | null {
  if (!line.startsWith('<!--')) return null
  const t = wsTrimEnd(line)
  if (t.startsWith('<!--q')) {
    const end = t.indexOf('-->')
    if (end < 0) return null
    for (const tok of t.slice(5, end).split(WS_RUN_RE)) {
      if (tok === '') continue
      const v = tok.startsWith('type=') ? tok.slice(5) : tok
      if (v !== '') return ['q', asciiLower(v)]
    }
    return ['q', '']
  }
  if (t === MARK_OPT) return ['opt', '']
  if (t === MARK_ANSWER) return ['answer', '']
  if (t === MARK_EXPLAIN) return ['explain', '']
  return null
}

/** 开栏：三个以上反引号或波浪线（可带语言） */
function openFence(line: string): [string, number] | null {
  const t = wsTrimStart(line)
  for (const ch of ['`', '~']) {
    let n = 0
    while (n < t.length && t[n] === ch) n += 1
    if (n >= 3) return [ch, n]
  }
  return null
}

/** 闭栏：同字符、不少于开栏长度、行内没有别的东西 */
function isCloseFence(line: string, ch: string, n: number): boolean {
  const t = wsTrim(line)
  for (const c of t) if (c !== ch) return false
  return t.length >= n
}

interface Draft {
  kind: string
  stem: string[]
  opt: string[]
  answer: string[]
  explain: string[]
}

const newDraft = (kind: string): Draft => ({ kind, stem: [], opt: [], answer: [], explain: [] })

function draftPush(d: Draft, sec: Section, line: string): void {
  if (sec === 'opt') d.opt.push(line)
  else if (sec === 'answer') d.answer.push(line)
  else if (sec === 'explain') d.explain.push(line)
  else d.stem.push(line)
}

/** 解析题目文件：返回（题目，是否有标记外的内容被忽略） */
export function parseMd(text: string): [QuizQuestion[], boolean] {
  const out: QuizQuestion[] = []
  let cur: Draft | null = null
  let sec: Section = 'stem'
  let fence: [string, number] | null = null
  let junk = false

  const pushLine = (line: string): void => {
    if (cur !== null) draftPush(cur, sec, line)
    else if (wsTrim(line) !== '') junk = true
  }

  // 行切分对齐 Rust `str::lines()`：CRLF 的 `\r` 不算内容（孤立 `\r` 保留原样）
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (fence !== null) {
      if (isCloseFence(line, fence[0], fence[1])) fence = null
      pushLine(line)
      continue
    }
    const f = openFence(line)
    if (f !== null) {
      fence = f
      pushLine(line)
      continue
    }
    const m = markerOf(line)
    if (m !== null) {
      const [next, kind] = m
      if (next === 'q') {
        if (cur !== null) out.push(draftInto(cur))
        cur = newDraft(kind)
        sec = 'stem'
      } else if (cur !== null) {
        sec = next
      } else {
        junk = true
      }
      continue
    }
    pushLine(line)
  }
  if (cur !== null) out.push(draftInto(cur))
  return [out, junk]
}

function draftInto(d: Draft): QuizQuestion {
  return {
    type: d.kind,
    stem: joinBlock(d.stem),
    options: parseOptions(d.opt),
    answer: parseAnswer(d.kind, d.answer),
    explain: joinBlock(d.explain),
  }
}

/** 段落块：去掉首尾空行，保留内部换行（题干 / 解析的原文） */
function joinBlock(lines: string[]): string {
  let a = 0
  let b = lines.length
  while (a < b && wsTrim(lines[a] ?? '') === '') a += 1
  while (b > a && wsTrim(lines[b - 1] ?? '') === '') b -= 1
  let out = lines.slice(a, b).join('\n')
  while (out.endsWith(' ') || out.endsWith('\t')) out = out.slice(0, -1)
  return out
}

/** 选项：减号 / 星号 / 加号开一行；续行并进上一条（空行忽略） */
function parseOptions(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const t = wsTrimStart(line)
    const item = t.startsWith('- ') || t.startsWith('* ') || t.startsWith('+ ') ? t.slice(2) : null
    if (item !== null) {
      out.push(wsTrim(item))
    } else {
      const t2 = wsTrim(line)
      if (t2 !== '' && out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${t2}`
    }
  }
  return out
}

/** 用未转义的竖线切分别名，反斜杠加竖线当字面竖线（序列化时反向转义） */
function splitAlternatives(line: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '\\') {
      const next = line[i + 1]
      if (next === '|' || next === '\\') {
        cur += next
        i += 1
      } else {
        cur += '\\'
      }
      continue
    }
    if (c === '|') {
      out.push(wsTrim(cur))
      cur = ''
      continue
    }
    cur += c
  }
  out.push(wsTrim(cur))
  return out.filter((s) => s !== '')
}

function escapePipe(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

function parseAnswer(kind: string, lines: string[]): QuizAnswer {
  if (kind === 'single' || kind === 'multi') {
    const letters: string[] = []
    for (const ch of asciiUpper(lines.join(''))) {
      if (ch >= 'A' && ch <= 'Z' && !letters.includes(ch)) letters.push(ch)
    }
    return letters.sort().join('')
  }
  if (kind === 'judge') {
    for (const line of lines) {
      // 只降 ASCII 大写（与桌面端同口径：全角字母不参与判定）
      const t = wsTrim(line).replace(/[A-Z]/g, (c) => c.toLowerCase())
      if (t === '') continue
      if (t === 'true' || t === 't' || t === 'yes' || t === 'y' || t === '对' || t === '是') return true
      if (t === 'false' || t === 'f' || t === 'no' || t === 'n' || t === '错' || t === '否') return false
      return null
    }
    return null
  }
  if (kind === 'blank') {
    return lines.filter((l) => wsTrim(l) !== '').map((l) => splitAlternatives(l))
  }
  return null
}

/** 答案段的 md 文本 */
function answerMd(q: QuizQuestion): string {
  if (q.type === 'single' || q.type === 'multi') return lettersOf(q.answer)
  if (q.type === 'judge') return q.answer === true ? 'true' : 'false'
  if (q.type === 'blank' && Array.isArray(q.answer)) {
    return q.answer.map((vs) => (Array.isArray(vs) ? vs.map((v) => escapePipe(v)).join(' | ') : '')).join('\n')
  }
  return ''
}

/** 序列化：一题一段（形状与 parseMd 严格互逆，测试钉住） */
export function toMd(questions: QuizQuestion[]): string {
  let out = ''
  let first = true
  for (const q of questions) {
    if (first) first = false
    else out += '\n'
    out += `<!--q type=${q.type}-->\n`
    out += `${wsTrimEnd(q.stem)}\n`
    if (q.options.length > 0) {
      out += '\n<!--opt-->\n'
      for (const o of q.options) out += `- ${o.replace(/\n/g, ' ')}\n`
    }
    out += '\n<!--answer-->\n'
    out += `${answerMd(q)}\n`
    if (wsTrim(q.explain) !== '') {
      out += '\n<!--explain-->\n'
      out += `${wsTrimEnd(q.explain)}\n`
    }
  }
  return out
}

const normalizeBlock = (s: string): string => joinBlock(s.split('\n'))

const oneLine = (s: string): string => wsTrim(s.split('\n').map((l) => wsTrim(l)).join(' '))

/** 归一化：把内容整理成 md 能无损承载的形状（首尾空行、选项换行、答案空白） */
function normalizeQuestion(q: QuizQuestion): QuizQuestion {
  let answer: QuizAnswer = q.answer
  if (q.type === 'single' || q.type === 'multi') answer = lettersOf(q.answer)
  else if (q.type === 'blank' && Array.isArray(q.answer)) {
    answer = q.answer.map((b) => (Array.isArray(b) ? b.map((v) => wsTrim(String(v))).filter((v) => v !== '') : []))
  }
  return {
    type: q.type,
    stem: normalizeBlock(q.stem),
    options: q.options.map((o) => oneLine(o)),
    answer,
    explain: normalizeBlock(q.explain),
  }
}

const sameQuestion = (a: QuizQuestion, b: QuizQuestion): boolean =>
  a.type === b.type &&
  a.stem === b.stem &&
  a.explain === b.explain &&
  a.options.length === b.options.length &&
  a.options.every((o, i) => o === b.options[i]) &&
  JSON.stringify(a.answer) === JSON.stringify(b.answer)

// ── 落盘 ────────────────────────────────────────────────────────────────────

/** 原子写（tmp + rename）：同步与界面可能同时读到，别留半截文件 */
function writeAtomic(target: string, text: string): void {
  const dir = path.dirname(target)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  try {
    fs.renameSync(tmp, target)
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 尽力清理 */
    }
    throw error
  }
}

/** 记录表按键排序后重排——落盘字节确定（另一端 / 下一轮读回都对得上） */
function sortedProgress(p: QuizProgress): QuizProgress {
  const out: Record<string, QuizRecord> = {}
  for (const k of Object.keys(p.progress).sort()) {
    const rec = p.progress[k]
    if (rec !== undefined) out[k] = rec
  }
  return { version: 1, progress: out }
}

function toDto(rel: string, questions: QuizQuestion[]): QuizPageDto {
  return {
    rel,
    questions: questions.map((q) => {
      const dto: QuizQuestionDto = { type: q.type, stem: q.stem, answer: q.answer, id: questionId(q) }
      if (q.options.length > 0) dto.options = q.options
      if (q.explain !== '') dto.explain = q.explain
      return dto
    }),
  }
}

function readAt(file: string, rel: string): QuizPageDto {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { rel, questions: [] }
  }
  const [questions, junk] = parseMd(text)
  if (junk || (questions.length === 0 && wsTrim(text) !== '')) {
    // 坏一份只当这页没题，绝不挡住页面树（多半是漏了 <!--q type=…-->）
    kitWarn(`题目文件按 0 题处理（${junk ? '有标记外的内容' : '没解析出题目'}）：${file}`)
  }
  return toDto(rel, questions)
}

/** 读一页的题目（文件不在 / 坏了 = 0 题） */
export function readPage(root: string, rel: string): QuizPageDto {
  const r = trySafeQuizRel(rel)
  return r === null ? { rel: '', questions: [] } : readAt(quizPath(root, r), r)
}

function parseQuestionDrafts(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) throw new Error('缺少题目清单')
  return raw.map((item) => {
    if (item === null || typeof item !== 'object') throw new Error('题目形状不对')
    const q = item as { type?: unknown; stem?: unknown; options?: unknown; answer?: unknown; explain?: unknown }
    return {
      type: typeof q.type === 'string' ? q.type : '',
      stem: typeof q.stem === 'string' ? q.stem : '',
      options: Array.isArray(q.options) ? q.options.map((o) => String(o ?? '')) : [],
      answer: (q.answer ?? null) as QuizAnswer,
      explain: typeof q.explain === 'string' ? q.explain : '',
    }
  })
}

/** 同页同题去重（内容完全一致的两道题留一份，id 相同、进度也是同一个） */
function dedupe(questions: QuizQuestion[]): QuizQuestion[] {
  const seen = new Set<string>()
  const kept: QuizQuestion[] = []
  for (const q of questions) {
    // Set.has/add 分开写：add 的返回值是 set 本身，拿它判重永远为真
    const id = questionId(q)
    if (seen.has(id)) continue
    seen.add(id)
    kept.push(q)
  }
  return kept
}

/** 写一页的题目（空数组 = 删掉题目文件与掌握度，不留空壳）。
 *  edit 指出界面正在编辑的那道题与「是否保留掌握进度」——勾了把旧 id 的记录搬到新 id，
 *  没勾就把这道题的记录清零；不给就完全不动掌握记录。返回落盘后的形状（含现算的 id） */
export function savePage(root: string, rel: string, raw: unknown, edit: unknown): QuizPageDto {
  const r = safeQuizRel(rel)
  const questions = parseQuestionDrafts(raw)
  const file = quizPath(root, r)
  if (questions.length === 0) {
    fs.rmSync(file, { force: true })
    fs.rmSync(progressPath(root, r), { force: true })
    try {
      fs.rmdirSync(path.dirname(file))
    } catch {
      /* 还有别的页的题目，留着 */
    }
    return { rel: r, questions: [] }
  }
  if (questions.length > MAX_QUESTIONS) throw new Error(`一页最多 ${MAX_QUESTIONS} 道题`)
  // 归一化 → 校验 → 同页同题去重
  const kept: QuizQuestion[] = []
  for (const [i, item] of questions.entries()) {
    const q = normalizeQuestion(item)
    const bad = validate(q)
    if (bad !== null) throw new Error(`第 ${i + 1} 题：${bad}`)
    kept.push(q)
  }
  const finalQuestions = dedupe(kept)
  // 编辑目标的旧 / 新 id：`index` 是**交上来的数组**下标（不是去重后的下标——去重会并掉
  // 重复项，按下标索引去重结果会整体错位）。去重把它并掉了也没关系：id 是内容哈希，
  // 被并到的正是同一道题，算出来同一个 id
  let target: [string, string, boolean] | null = null
  if (edit !== null && typeof edit === 'object') {
    const e = edit as { index?: unknown; oldId?: unknown; keep?: unknown }
    const idx = typeof e.index === 'number' && Number.isInteger(e.index) ? e.index : -1
    const oldId = typeof e.oldId === 'string' ? e.oldId : ''
    const submitted = idx >= 0 && idx < questions.length ? questions[idx] : undefined
    if (submitted !== undefined && oldId !== '') {
      target = [oldId, questionId(normalizeQuestion(submitted)), e.keep === true]
    }
  }
  const text = toMd(finalQuestions)
  // 自检：写出去的形状读回来必须一模一样。对不上只有一个现实来源——内容里有和标记
  // 同形的行（<!--q / <!--opt / <!--answer / <!--explain 在行首）。宁可拒绝保存，
  // 也不能让它落盘成"读回来是另一道题"。
  const [roundtrip] = parseMd(text)
  if (roundtrip.length !== finalQuestions.length || roundtrip.some((q, i) => {
    const want = finalQuestions[i]
    return want === undefined || !sameQuestion(q, want)
  })) {
    throw new Error('题目里有和格式标记同形的行（<!--q / <!--opt / <!--answer / <!--explain 开头），缩进一格或改写即可')
  }
  writeAtomic(file, text)
  // 掌握记录：没答过的题没有记录，两种走法都是什么都不做
  if (target !== null) {
    const p = readProgressFile(root, r)
    if (applyEdit(p, target[0], target[1], target[2])) writeProgressFile(root, r, p)
  }
  return readPage(root, r)
}

// ── 范围汇总（递归收一个目录下所有有题的页面）──────────────────────────────

export function readScope(root: string, dir: string): QuizScopeDto {
  const d = trySafeQuizRel(dir)
  if (d === null) return { dir: '', pages: [] }
  const base = d === '' ? root : path.join(root, ...d.split('/'))
  const pages: QuizPageDto[] = []
  walkScope(base, d, root, pages)
  return { dir: d, pages }
}

function walkScope(dir: string, relDir: string, root: string, out: QuizPageDto[]): void {
  const quizDir = path.join(dir, QUIZ_DIR)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(quizDir, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const e of entries) {
    if (!e.isFile() || !isQuestionFile(e.name)) continue
    const stem = e.name.replace(/\.md$/i, '')
    const rel = relDir === '' ? stem : `${relDir}/${stem}`
    const page = readAt(path.join(quizDir, e.name), rel)
    if (page.questions.length > 0) out.push(page)
  }
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (skipDir(e.name)) continue
    walkScope(path.join(dir, e.name), relDir === '' ? e.name : `${relDir}/${e.name}`, root, out)
  }
}

// ── 题目指纹（外部改动的探测口）─────────────────────────────────────────────

/** 指纹：范围内的文件数 + 最新 mtime。**外部（agent 直接写 .quiz/*.md、同步下来的
 *  进度）改了才会变**——界面轮询它决定要不要重读，比每几秒把范围重读一遍便宜得多。
 *  全局阈值文件也算在内——另一端改了阈值，这边要跟着重读。 */
export function revision(root: string, rel: string | null, dir: string | null): QuizRevision {
  const rev: QuizRevision = { files: 0, mtimeMs: 0 }
  addRev(settingsPath(root), rev)
  if (rel !== null && wsTrim(rel) !== '') {
    const r = trySafeQuizRel(rel)
    if (r === null) return rev
    addRev(quizPath(root, r), rev)
    addRev(progressPath(root, r), rev)
    return rev
  }
  const d = dir === null ? '' : trySafeQuizRel(dir)
  if (d === null) return rev
  const base = d === '' ? root : path.join(root, ...d.split('/'))
  walkRevision(base, root, rev)
  return rev
}

function addRev(file: string, rev: QuizRevision): void {
  const st = fs.statSync(file, { throwIfNoEntry: false })
  if (st === undefined || !st.isFile()) return
  const ms = Math.round(st.mtimeMs)
  if (ms > 0) {
    rev.files += 1
    rev.mtimeMs = Math.max(rev.mtimeMs, ms)
  }
}

function walkRevision(dir: string, root: string, out: QuizRevision): void {
  const quizDir = path.join(dir, QUIZ_DIR)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(quizDir, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    if (isQuestionFile(e.name) || isProgressFile(e.name)) addRev(path.join(quizDir, e.name), out)
  }
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (skipDir(e.name)) continue
    walkRevision(path.join(dir, e.name), root, out)
  }
}

// ── 掌握度：跟页面走 ────────────────────────────────────────────────────────

/** 读一页的掌握度（文件不在 / 坏了都当空表：记不住掌握度不是错） */
function readProgressFile(root: string, rel: string): QuizProgress {
  const file = progressPath(root, rel)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return emptyProgress()
  }
  // 解析不动 = 整份挪 .bak 留证再当空表——直接当空表的话，下一次作答就把整页记录
  // 覆盖掉，坏在哪、丢了什么全查不出来
  const parsed = parseProgress(text)
  if (parsed === null) {
    try {
      fs.renameSync(file, `${file}.bak`)
    } catch {
      /* 收不走就留着原文件 */
    }
    kitWarn(`掌握度文件解析失败，已挪到 ${file}.bak`)
    return emptyProgress()
  }
  return parsed
}

/** 严格解析：缺字段给默认，类型不对整份算坏（与桌面端 serde 同口径，半份好记录不留） */
function parseProgress(text: string): QuizProgress | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as { version?: unknown; progress?: unknown }
  if (obj.version !== undefined && (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 0)) return null
  const out = emptyProgress()
  if (obj.progress === undefined) return out
  if (obj.progress === null || typeof obj.progress !== 'object' || Array.isArray(obj.progress)) return null
  for (const [id, rec] of Object.entries(obj.progress as Record<string, unknown>)) {
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return null
    const r = rec as { streak?: unknown; mastered?: unknown; updatedMs?: unknown }
    if (r.streak !== undefined && (typeof r.streak !== 'number' || !Number.isInteger(r.streak) || r.streak < 0)) return null
    if (r.mastered !== undefined && typeof r.mastered !== 'boolean') return null
    if (r.updatedMs !== undefined && (typeof r.updatedMs !== 'number' || !Number.isInteger(r.updatedMs) || r.updatedMs < 0)) return null
    out.progress[id] = {
      streak: typeof r.streak === 'number' ? r.streak : 0,
      mastered: r.mastered === true,
      updatedMs: typeof r.updatedMs === 'number' ? r.updatedMs : 0,
    }
  }
  return out
}

/** 写一页的掌握度；空表 = 把文件删掉（不留空壳） */
function writeProgressFile(root: string, rel: string, p: QuizProgress): void {
  const file = progressPath(root, rel)
  if (Object.keys(p.progress).length === 0) {
    fs.rmSync(file, { force: true })
    try {
      fs.rmdirSync(path.dirname(file))
    } catch {
      /* 还有别的页的题目，留着 */
    }
    return
  }
  writeAtomic(file, JSON.stringify(sortedProgress(p)))
}

/** 读全局答题设置。解析口径与桌面端 serde 一致：整份是对象、出现的字段类型对
 *  （version/threshold = u32、updatedMs = u64 整数）才认，任一处不合类型整份回默认；缺字段给
 *  默认、threshold=0 也回默认。**不在读取时夹 1..20**——非法大值照收，改了才夹（同桌面端）。 */
export function readSettings(root: string): QuizSettings {
  const fallback: QuizSettings = { version: 1, threshold: DEFAULT_THRESHOLD, updatedMs: 0 }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(root), 'utf8'))
  } catch {
    return fallback
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const obj = raw as { version?: unknown; threshold?: unknown; updatedMs?: unknown }
  const u32 = (v: unknown): boolean =>
    v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff)
  const u64 = (v: unknown): boolean =>
    v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER)
  if (!u32(obj.version) || !u32(obj.threshold) || !u64(obj.updatedMs)) return fallback
  return {
    version: 1,
    threshold: typeof obj.threshold === 'number' && obj.threshold > 0 ? obj.threshold : DEFAULT_THRESHOLD,
    updatedMs: typeof obj.updatedMs === 'number' ? obj.updatedMs : 0,
  }
}

/** 回前端的掌握度：rel 给一页，否则 dir（"" = 整库）递归汇总 + 全局阈值 */
export function readProgress(root: string, rel: string | null, dir: string | null): QuizProgressDto {
  const threshold = readSettings(root).threshold
  const progress: Record<string, QuizRecord> = {}
  if (rel !== null && wsTrim(rel) !== '') {
    const r = trySafeQuizRel(rel)
    if (r === null) return { version: 1, threshold, progress }
    Object.assign(progress, readProgressFile(root, r).progress)
  } else {
    const d = dir === null ? '' : trySafeQuizRel(dir)
    if (d === null) return { version: 1, threshold, progress }
    walkProgress(d === '' ? root : path.join(root, ...d.split('/')), root, progress)
  }
  return { version: 1, threshold, progress }
}

/** 递归收一个目录下的掌握度记录（同 id 跨页相遇时后到者覆盖——同 id 即同题，
 *  各页自己的进度本来就以最后作答的那份为准） */
function walkProgress(dir: string, root: string, out: Record<string, QuizRecord>): void {
  const quizDir = path.join(dir, QUIZ_DIR)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(quizDir, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const e of entries) {
    if (!e.isFile() || !isProgressFile(e.name)) continue
    const stem = e.name.slice(0, -PROGRESS_SUFFIX.length)
    Object.assign(out, readProgressFile(dir, stem).progress)
  }
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (skipDir(e.name)) continue
    walkProgress(path.join(dir, e.name), root, out)
  }
}

/** 全库的掌握度文件（rel + 内容）：改阈值时要把每页都过一遍 */
function allProgress(root: string): [string, QuizProgress][] {
  const out: [string, QuizProgress][] = []
  const walk = (dir: string, relDir: string): void => {
    const quizDir = path.join(dir, QUIZ_DIR)
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(quizDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const e of entries) {
      if (!e.isFile() || !isProgressFile(e.name)) continue
      const stem = e.name.slice(0, -PROGRESS_SUFFIX.length)
      out.push([relDir === '' ? stem : `${relDir}/${stem}`, readProgressFile(dir, stem)])
    }
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
      for (const e of entries) {
      if (!e.isDirectory()) continue
      if (skipDir(e.name)) continue
      walk(path.join(dir, e.name), relDir === '' ? e.name : `${relDir}/${e.name}`)
    }
  }
  walk(root, '')
  return out
}

const nowMs = (): number => Date.now()

/** 界面编辑过的那道题的掌握记录怎么办：keep = 把旧 id 的记录搬到新 id（旧条目删掉）；
 *  不 keep = 清零（新、旧 id 的记录都删）。有改动才回 true */
function applyEdit(p: QuizProgress, oldId: string, newId: string, keep: boolean): boolean {
  if (keep) {
    if (oldId === newId) return false
    const rec = p.progress[oldId]
    if (rec === undefined) return false
    delete p.progress[oldId]
    p.progress[newId] = rec
    return true
  }
  const hadOld = p.progress[oldId] !== undefined
  delete p.progress[oldId]
  const hadNew = newId !== oldId && p.progress[newId] !== undefined
  delete p.progress[newId]
  return hadOld || hadNew
}

/** 记一次作答：答对连击 +1（达阈值即掌握），答错连击归零并撤销掌握 */
export function record(root: string, rel: string, id: string, correct: boolean): QuizOutcome {
  const r = safeQuizRel(rel)
  const threshold = readSettings(root).threshold
  const p = readProgressFile(root, r)
  let newly = false
  const entry = p.progress[id] ?? { streak: 0, mastered: false, updatedMs: 0 }
  if (correct) {
    entry.streak = Math.min(entry.streak + 1, 0xffffffff)
    if (entry.streak >= threshold && !entry.mastered) {
      entry.mastered = true
      newly = true
    }
  } else {
    entry.streak = 0
    entry.mastered = false
  }
  entry.updatedMs = nowMs()
  p.progress[id] = entry
  writeProgressFile(root, r, p)
  return { streak: entry.streak, mastered: entry.mastered, newlyMastered: newly }
}

/** 手动标记掌握：连击直接设成阈值（一步跳满） */
export function markMastered(root: string, rel: string, id: string): QuizOutcome {
  const r = safeQuizRel(rel)
  const threshold = readSettings(root).threshold
  const p = readProgressFile(root, r)
  const entry = p.progress[id] ?? { streak: 0, mastered: false, updatedMs: 0 }
  const was = entry.mastered
  entry.streak = threshold
  entry.mastered = true
  entry.updatedMs = nowMs()
  p.progress[id] = entry
  writeProgressFile(root, r, p)
  return { streak: threshold, mastered: true, newlyMastered: !was }
}

/** 遗忘（答对后自觉没底也可用）：连击归零并撤销掌握 */
export function forget(root: string, rel: string, id: string): QuizOutcome {
  const r = safeQuizRel(rel)
  const p = readProgressFile(root, r)
  const entry = p.progress[id] ?? { streak: 0, mastered: false, updatedMs: 0 }
  entry.streak = 0
  entry.mastered = false
  entry.updatedMs = nowMs()
  p.progress[id] = entry
  writeProgressFile(root, r, p)
  return { streak: 0, mastered: false, newlyMastered: false }
}

/** 改阈值（1..20）：已经掌握但连击数低于新阈值的题刷回未掌握 */
export function setThreshold(root: string, value: number): number {
  const v = Math.min(Math.max(Math.floor(value) || 0, 1), 20)
  for (const [rel, p] of allProgress(root)) {
    let changed = false
    for (const entry of Object.values(p.progress)) {
      if (entry.mastered && entry.streak < v) {
        entry.mastered = false
        changed = true
      }
    }
    if (changed) writeProgressFile(root, rel, p)
  }
  writeAtomic(settingsPath(root), JSON.stringify({ version: 1, threshold: v, updatedMs: nowMs() }, null, 2))
  return v
}

// ── 日志 ────────────────────────────────────────────────────────────────────

let warnFn: ((msg: string) => void) | null = null

/** 组件装配时注入 logger（core/log 的 kitLogger）——本模块保持零宿主依赖可单测 */
export function setQuizWarn(fn: (msg: string) => void): void {
  warnFn = fn
}

function kitWarn(msg: string): void {
  if (warnFn !== null) warnFn(msg)
}
