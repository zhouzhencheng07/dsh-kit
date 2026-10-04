// 输出侧复读判据（宿主与客户端共用一份，避免两处漂移）
//
// 单位是**句子**而不是字符：模型陷入复读时的真实形态是「一句话或连续几句话绕着圈
// 说」——「重复一句话」在字符层面只是尾部一小段自重叠，还夹着换行/标点噪声，用字符
// 周期去猜周期既贵又容易误伤正常长文（旧实现正是这么误杀的）。切句之后，「同一句
// （或同一组连续句）连续出现 N 遍」就是直接判据，与流式切片方式无关。
//
// 三类误报在这一层被排除：
//   ① 长但不重复的正常输出——不构成连续重复块，永不命中（旧实现的「单步字符上限」
//      把几万字的正常推理直接当失控，已删除）；
//   ② 列表 / 表格 / 代码里结构相同但内容不同的行——句子文本不同，不构成重复；
//   ③ 正常的强调性复述（「说三遍」）——到警告档只提示，继续重复到停止档才动。
//
// 客户端 bundle 是零构建的手写 bundle、import 不了本包，那里手抄一份
// （tests/render-check-monitor.cjs 用同一语料比对两份判据，防漂移）。

/** 判定为复读所需的最少连续重复遍数（低档=警告，只提示不停） */
export const WARN_COPIES = 3
/** 停止档：重复继续到这么多遍才停止回合（先警告、继续才停的分档策略） */
export const STOP_COPIES = 5
/** 重复块（一句或连续几句）的最小字符数：放过「好。」这类短噪声 */
export const MIN_BLOCK_CHARS = 6
/** 重复块最多由几句组成：循环单元通常是「一句话或几句话」 */
export const MAX_BLOCK_UNITS = 8

/** 句末标点：这些字符处断句（连续出现时并入同一句） */
const SENTENCE_END = new Set(['。', '！', '？', '；', '…', '!', '?', ';'])

/** 一句话：归一化文本 + 是否已收束（流式尾部未完成的句子不参与判定） */
export interface SentenceUnit {
  /** 归一化后的句子文本（压缩空白后 trim） */
  text: string
  /** 是否以句末标点/换行收尾 */
  complete: boolean
}

/** 一次复读命中：尾部由 units 句组成的块连续重复了 copies 遍 */
export interface LoopHit {
  /** 重复块由几句组成 */
  units: number
  /** 连续重复了几遍 */
  copies: number
  /** 重复块（一遍）的字符数 */
  chars: number
}

function normalizeUnit(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * 把文本切成句子。断句点：句末标点（。！？；…!?;）、换行、以及不夹在数字中间的
 * 英文句点（跟随空白或行尾）。尾部没有断句点的内容标记为未完成。
 */
export function segmentSentences(text: string): SentenceUnit[] {
  const out: SentenceUnit[] = []
  if (typeof text !== 'string' || text === '') return out
  const n = text.length
  let start = 0
  const push = (end: number, complete: boolean): void => {
    const norm = normalizeUnit(text.slice(start, end))
    if (norm !== '') out.push({ text: norm, complete })
    start = end
  }
  for (let i = 0; i < n; i++) {
    const ch = text[i]!
    if (ch === '\n') {
      push(i + 1, true)
      continue
    }
    if (SENTENCE_END.has(ch)) {
      let j = i + 1
      while (j < n && SENTENCE_END.has(text[j]!)) j++
      push(j, true)
      i = j - 1
      continue
    }
    if (ch === '.') {
      const prev = text[i - 1]
      const next = text[i + 1]
      const digitPrev = prev !== undefined && prev >= '0' && prev <= '9'
      const digitNext = next !== undefined && next >= '0' && next <= '9'
      if (!digitPrev && !digitNext && (next === undefined || /\s/.test(next))) push(i + 1, true)
    }
  }
  if (start < n) push(n, false)
  return out
}

/**
 * 尾部连续重复块扫描：从尾部往回看，找最小的块（1..MAX_BLOCK_UNITS 句），要求它
 * 连续完整地重复至少 WARN_COPIES 遍（块字符数不足 MIN_BLOCK_CHARS 的短句跳过）。
 * 只认尾部——重复之后已经说了别的，就是自愈了，不该再动它。
 */
export function tailLoop(units: readonly SentenceUnit[]): LoopHit | null {
  let end = units.length
  while (end > 0 && units[end - 1]!.complete !== true) end--
  const n = end
  if (n < WARN_COPIES) return null
  for (let p = 1; p <= MAX_BLOCK_UNITS && p * WARN_COPIES <= n; p++) {
    let chars = 0
    for (let k = n - p; k < n; k++) chars += units[k]!.text.length
    if (chars < MIN_BLOCK_CHARS) continue
    let copies = 1
    while ((copies + 1) * p <= n) {
      let same = true
      for (let k = 0; k < p; k++) {
        if (units[n - (copies + 1) * p + k]!.text !== units[n - p + k]!.text) {
          same = false
          break
        }
      }
      if (!same) break
      copies++
    }
    if (copies >= WARN_COPIES) return { units: p, copies, chars }
  }
  return null
}

/** 判据总入口：切句 + 尾部连续重复扫描。命中返回重复块信息，否则 null。 */
export function detectLoop(text: string): LoopHit | null {
  if (typeof text !== 'string' || text === '') return null
  return tailLoop(segmentSentences(text))
}
