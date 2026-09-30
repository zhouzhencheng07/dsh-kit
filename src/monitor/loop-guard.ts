// 输出侧死循环判据（宿主与客户端共用一份，避免两处漂移）
//
// 判三类形态，都是纯函数、无宿主依赖。客户端 bundle 侧是零构建的手写 bundle、
// import 不了本包，那里手抄一份（改判据时两边都要动，见知识库
// [[dsh-kit 会话监视]] 的「判据」一节）：
//   ① 尾部整块重复——逐字复读同一整段；
//   ② 周期性复读——绕圈说同一件事，重复单元边界随流式切片漂移，① 抓不到；
//   ③ 单步输出过长——不重复但一直吐字的退化。
// ②③ 的必要性见官方讨论 #2848（"no circuit breaker — only a manual abort
// stops it"）。

/** 重复块最短长度：放过短分隔符/标点（--- 、换行噪声） */
export const MIN_BLOCK = 8
/** 重复块最长扫描长度：兜住长句循环，扫描成本封顶 */
export const MAX_BLOCK = 128
/** 周期检测的尾部窗口：够放下几个循环单元 */
export const CYCLE_WINDOW = 4000
/** 周期下限：放过「好/是」这类短词偶然重复 */
export const CYCLE_MIN = 12
/** 周期上限：长句绕圈也抓，扫描成本 O(窗口×周期) */
export const CYCLE_MAX = 400

/**
 * 尾部自重叠扫描：累计文本末尾连续重复块的最大次数（块长在 MIN_BLOCK..MAX_BLOCK
 * 内穷举对齐，与流式分块方式无关）。文本不足两个最短块时返回 1。
 */
export function tailRepeatCount(text: string): number {
  const len = text.length
  let best = 1
  for (let p = MIN_BLOCK; p <= MAX_BLOCK && p * 2 <= len; p++) {
    const block = text.slice(len - p)
    let m = 1
    while (len - (m + 1) * p >= 0 && text.slice(len - (m + 1) * p, len - m * p) === block) m++
    if (m > best) best = m
  }
  return best
}

/**
 * 周期性重复检测（跨块边界）：取尾部窗口，对每种周期 p 检查「p 位移上连续相同
 * 的位置」，即 tail[i] === tail[i-p] 的最长连续长度；该长度 ≥2p 说明这段至少
 * 连着走了两个完整周期，才判为复读。与分块方式无关，也不依赖重复起点对齐。
 * 返回命中的最大周期（0 = 无）。
 *
 * 阈值取 2p 而非 p：只重复一个完整周期（如「把刚才那段结论复述一遍」）是正常
 * 输出，判成循环会误伤；真正的复读会持续绕圈，连着两个周期以上。
 */
export function cyclePeriod(text: string): number {
  const tail = text.length > CYCLE_WINDOW ? text.slice(-CYCLE_WINDOW) : text
  const n = tail.length
  let best = 0
  for (let p = CYCLE_MIN; p * 2 <= n && p <= CYCLE_MAX; p++) {
    let run = 0
    for (let i = p; i < n; i++) {
      run = tail[i] === tail[i - p] ? run + 1 : 0
      if (run >= p * 2) {
        if (p > best) best = p
        break
      }
    }
  }
  return best
}

/** 复读两条判据（① 尾部整块重复 ② 周期复读）的合成。与 looksLooped 拆开是因为宿主
 *  侧的累积文本有内存闸（loop-breaker 的 ACCUM_MAX），那边「单步过长」得自己记账
 *  字符数——拿被截断后的 text.length 判会让这条判据永远不成立。 */
export function repeatsLooped(text: string, threshold: number): boolean {
  if (typeof text !== 'string' || text === '') return false
  if (tailRepeatCount(text) >= threshold) return true
  return cyclePeriod(text) > 0
}

/** 死循环判定的总入口：三条判据合成一个布尔。maxChars 按 text.length 判——只有
 *  传进来的 text 未被截断时这条才成立（客户端那份手抄副本正是如此）。 */
export function looksLooped(text: string, threshold: number, maxChars: number): boolean {
  if (typeof text !== 'string' || text === '') return false
  if (text.length > maxChars) return true
  return repeatsLooped(text, threshold)
}
