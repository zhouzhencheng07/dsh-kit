// dsh-kit 内置浏览器——BrowserService（宿主半边核心）
//
// 职责：vendored playwright-core（host-vendor/，钉 1.62.1）驱动系统 Edge（channel
// 方式，失败退 executablePath 探测链），管理持久化上下文（专用 profile，登录态跨
// 会话保留）、**按分区（scope）隔离的页面集**（每分区一套 agent 活动页 / 面板观察页
// 双指针，见 ScopeState 注释）、帧流中继；对工具层（browser-tools.ts）与面板 ws（index.ts）
// 提供同一套操作面。TS 源码（tsc 构建出 dist 运行）、零运行时依赖声明；ws 服务器与
// 多锚点解析在 index.ts 完成，这里不重复。
//
// 分区语义（scope = 调用方会话 id，见 normalizeScope）：
//   浏览器实例与 profile **全局共享**（cookie/localStorage/登录态就一份），页集与指针
//   按分区各一份——不同对话各用各的标签页，互不抢页。分区空闲（无观察者 + 10 分钟无
//   操作）只收该分区的页；全局无页无观察者且空闲才关整个实例（登录态在 profile 里，
//   重开无损）。
// 生命周期语义：
//   懒启动（首次工具调用/面板 watch 时 launchPersistentContext）；
//   引用计数 + 空闲 10 分钟自动 close；插件 dispose 兜底 close；启动时按 pidfile
//   清理上次异常退出的孤儿实例。
// 安全边界：
//   专用 profile 目录（$DSH_HOME/dsh-kit/browser-profile），绝不指向用户日常配置；
//   URL 白名单 http/https（file:// 拒绝）；snapshot 8KB / eval 64KB / 帧 1600px 限长。
// 观察面：ariaSnapshot({ mode: 'ai' })——紧凑树 + [ref=eN]（playwright 1.62 原生）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { kitPath } from '../core/data-path.ts'

// ── vendored playwright 的最小依赖面 ──
// playwright-core 经 createRequire 载入（CJS，类型不随 require 解析），这里只声明
// 我们实际触达的方法作为契约；未列到的能力视为不存在，运行时行为不受影响。
interface PwFrame {}

interface PwLocator {
  count(): Promise<number>
  first(): PwLocator
  click(options?: { timeout?: number }): Promise<void>
  fill(value: string, options?: { timeout?: number }): Promise<void>
  press(key: string, options?: { timeout?: number }): Promise<void>
  setChecked(checked: boolean, options?: { timeout?: number }): Promise<void>
  selectOption(value: string, options?: { timeout?: number }): Promise<void>
  hover(options?: { timeout?: number }): Promise<void>
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<void>
  scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>
  ariaSnapshot(options?: { mode?: string }): Promise<string>
}

/** JS 对话框（alert/confirm/prompt/beforeunload）——本服务只读 type/message 并
 *  统一 dismiss（取消）；挂了监听器后 playwright 不再自动关，必须显式处理 */
interface PwDialog {
  type(): string
  message(): string
  dismiss(): Promise<void>
}

/** 纳管页：__dshTabId 是本服务盖在 playwright Page 上的管理标记（幂等锚） */
type PwPage = {
  url(): string
  title(): Promise<string>
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  goBack(options?: { timeout?: number }): Promise<unknown>
  goForward(options?: { timeout?: number }): Promise<unknown>
  reload(options?: { timeout?: number }): Promise<unknown>
  locator(selector: string): PwLocator
  getByRole(role: string, options?: { name?: string }): PwLocator
  getByText(text: string): PwLocator
  evaluate(expression: string): Promise<unknown>
  screenshot(options?: { fullPage?: boolean; type?: string }): Promise<Buffer>
  close(): Promise<void>
  mainFrame(): PwFrame
  on(event: 'framenavigated', cb: (frame: PwFrame) => void): void
  on(event: 'crash', cb: () => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'dialog', cb: (dialog: PwDialog) => void): void
  setViewportSize(size: { width: number; height: number }): Promise<void>
  /** 弹出这页的打开者（target=_blank 弹窗有；newPage 建的页没有）——弹窗按打开者归
   *  分区。**客户端实现是 async 的**（coreBundle Page.opener），必须 await。 */
  opener?(): Promise<PwPage | null> | PwPage | null
  isClosed(): boolean
  keyboard: { press(key: string): Promise<void>; insertText(text: string): Promise<void> }
  mouse: {
    move(x: number, y: number): Promise<void>
    down(options?: { button?: string; clickCount?: number }): Promise<void>
    up(options?: { button?: string; clickCount?: number }): Promise<void>
    wheel(dx: number, dy: number): Promise<void>
  }
  __dshTabId?: number
  /** 归属分区（会话 id）：弹窗靠打开者这枚标记归到同一分区 */
  __dshScope?: string
}

interface PwCdpFramePayload {
  data: string
  sessionId?: string
  metadata?: unknown
}

interface PwCdpSession {
  on(event: string, cb: (payload: PwCdpFramePayload) => void): void
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  detach(): Promise<void>
}

interface PwBrowserProcess {
  pid?: number
}

interface PwContext {
  pages(): PwPage[]
  newPage(): Promise<PwPage>
  on(event: 'page', cb: (page: PwPage) => void): void
  on(event: 'close', cb: () => void): void
  newCDPSession(page: PwPage): Promise<PwCdpSession>
  close(): Promise<void>
  browser?(): { process?(): PwBrowserProcess | null } | null
}

interface PwModule {
  chromium: {
    launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<PwContext>
  }
}

/** 事件总线负载（index.ts 的 ws state/event 转发据此成型）。
 *  'state' = 全局（可用性/启动中）——每条连接据此刷新自己分区的 state；
 *  'scope' = 某分区的页集/指针变了——只发给该分区的连接；
 *  'closed' = 整个上下文收摊（所有分区）。 */
export type BrowserEvent =
  | { kind: 'state' }
  | { kind: 'scope'; scope: string }
  | { kind: 'closed' }
  | { kind: 'navigated'; scope: string; tabId: number; url: string; title: string }
  | { kind: 'crashed'; scope: string; tabId: number }

/** act 工具参数的宿主侧契约（browser-tools 校验后原样传入）。
 *  ref=快照 [ref=eN] 回填（aria-ref 引擎解析，可穿透 iframe）；dx/dy=scroll 无
 *  定位目标时的滚动增量（负值向上）。 */
export interface ActArgs {
  action?: string
  tabId?: number
  value?: string
  key?: string
  ref?: string
  dx?: number
  dy?: number
  timeoutMs?: number
  snapshot?: boolean
  role?: string
  name?: string
  text?: string
  selector?: string
}

/** 人机共驾输入消息（面板画布 → ws → 本服务；坐标已按帧原始尺寸换算）。
 *  kind:'key' = 面板 keydown 直转的组合键（英文逐键/快捷键）；kind:'text' =
 *  面板 IME 组合提交的整段文本（中文等组合输入无法用合成 keydown 表达，
 *  走 keyboard.insertText 在远程光标处整段插入）。 */
export type HumanInputMsg =
  | { kind: 'mousemove'; x: number; y: number }
  | { kind: 'mousedown'; x: number; y: number; button?: number; clicks?: number }
  | { kind: 'mouseup'; button?: number; clicks?: number }
  | { kind: 'wheel'; dx?: number; dy?: number }
  | { kind: 'key'; combo?: string }
  | { kind: 'text'; text?: string }

const IDLE_CLOSE_MS = 10 * 60 * 1000
const IDLE_TICK_MS = 30 * 1000
const GOTO_TIMEOUT = 15000
const ACT_TIMEOUT_DEFAULT = 5000
const ACT_TIMEOUT_MAX = 15000
const SNAPSHOT_CAP = 8 * 1024
/** 调用方自定义快照上限时的取值区间：下限保证还有可读内容，上限防一次调用把上下文灌爆 */
const SNAPSHOT_MIN = 200
const SNAPSHOT_MAX = 32 * 1024
const EVAL_CAP = 64 * 1024
const LAUNCH_TIMEOUT = 30000
/** 启动失败后的快速失败窗口：窗口内直接回上次那句错误（连续重试不打爆启动链），
 *  窗口过后允许再试——一次瞬时失败（Edge 自更新、profile 被占）不该砖死到重启 */
const LAUNCH_RETRY_MS = 10000

/** 认不出调用方会话时的分区（无 agent 的工具调用、面板还没拿到会话 id） */
export const DEFAULT_SCOPE = 'default'

/** 分区键归一：非空字符串原样，其它（undefined/null/空串）落 DEFAULT_SCOPE */
export function normalizeScope(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s === '' ? DEFAULT_SCOPE : s
}

/** 帧流的投递口：一个订阅者（= 一条面板连接）收自己订的那一页的帧 */
type FrameSink = (tabId: number, data: string, metadata: unknown) => void

/** 帧流画质。小字页面上 q60 的 JPEG 明显发糊（字口周围的振铃最刺眼），
 *  实测 q60→q85 只多约六成字节，而整条链实测不到 1.2MB/s——带宽从来不是约束。
 *  首帧兜底截图必须同档，否则首帧清晰度与后续帧跳变 */
const FRAME_JPEG_QUALITY = 85
/** 帧率上限交给页面自身的重绘率。everyNthFrame=2 实测只是白砍一半流畅度，
 *  没省下任何我们需要的带宽（帧率由重绘决定，不是由这一刀决定） */
const FRAME_EVERY_NTH = 1
/** 投给面板的帧率上限（毫秒间隔）。帧画得再快也只投这么多：面板是观察窗，
 *  30fps 足够，而带宽与主线程绘制都按帧数线性涨 */
const FRAME_MIN_INTERVAL_MS = 33

/** 帧封顶（设备像素）。CDP 在这个框内等比缩放，拿面板的像素尺寸当封顶，
 *  帧就是面板实际的像素密度——写死上限才会被面板放大发虚（高分屏尤其明显）。
 *  客户端报的是 CSS 尺寸乘过 DPR 的结果，宿主不碰 devicePixelRatio */
const FRAME_MIN_PX = 640
const FRAME_MAX_PX = 2560
/** 客户端没报尺寸时的兜底（与旧行为一致） */
const FRAME_FALLBACK_BOX = { maxWidth: 1600, maxHeight: 1200 }
/** 封顶变化小于这个量就不重开流：拖右栏是连续小变化，每次都重开只会抖 */
const FRAME_BOX_EPSILON_PX = 96

/** 面板显示尺寸 → 帧封顶。尺寸非法（没布局、隐藏、客户端没报）落兜底 */
function frameBox(size: { w?: unknown; h?: unknown } | null | undefined): { maxWidth: number; maxHeight: number } {
  const w = Number(size?.w)
  const h = Number(size?.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { ...FRAME_FALLBACK_BOX }
  const clamp = (v: number) => Math.min(FRAME_MAX_PX, Math.max(FRAME_MIN_PX, Math.round(v)))
  return { maxWidth: clamp(w), maxHeight: clamp(h) }
}

/** 两份封顶是否「算同一个」（差值小于 eps 视为没变） */
function sameFrameBox(a: { maxWidth: number; maxHeight: number }, b: { maxWidth: number; maxHeight: number }): boolean {
  return Math.abs(a.maxWidth - b.maxWidth) < FRAME_BOX_EPSILON_PX && Math.abs(a.maxHeight - b.maxHeight) < FRAME_BOX_EPSILON_PX
}

/** 一个分区的全部可变状态（浏览器实例与 profile 不在这里——那是全局共享的） */
interface ScopeState {
  pages: Map<number, PwPage>
  titles: Map<number, string>
  dialogs: Map<number, Array<{ type: string; message: string; at: number }>>
  /** agent 默认目标页 */
  activeId: number | null
  /** 面板默认落在哪一页：没带页 id 的调用（工具面调用、URL 栏裸调用）落它。
   *  帧流/输入/nav 这些带 tabId 的都不看它 */
  viewId: number | null
  /** 帧流订阅者，按页记（页 id → 订阅者 → 投递函数）。同页多张签各挂各的连接，
   *  不同页各投各的——投递槽必须按页分开，否则后开的签会顶掉先开那张的 */
  frames: Map<number, Map<object, FrameSink>>
  streams: Map<number, { cdp: PwCdpSession }>
  /** 面板报来的帧封顶，按页记。帧流拆了重挂时按它恢复（CDP 的封顶只在开流那一刻生效，
   *  不留着的话重挂会退回兜底值，把面板按清晰度调好的画面悄悄降级） */
  frameBoxes: Map<number, { maxWidth: number; maxHeight: number }>
  lastActivity: number
  /** 人手高频输入与 agent 工具动作共用一页，必须顺序派发 */
  inputQueue: Promise<void>
}

/** 载入 vendored playwright-core（CJS 入口 index.js）。失败返回 null（能力整体不可用）。 */
function loadPlaywright(): PwModule | null {
  let vendorDir: string
  try {
    vendorDir = fileURLToPath(new URL('../../host-vendor/playwright-core/', import.meta.url))
  } catch {
    return null
  }
  const entry = path.join(vendorDir, 'index.js')
  if (!fs.existsSync(entry)) return null
  try {
    return createRequire(import.meta.url)(entry) as PwModule
  } catch {
    return null
  }
}

/** 找系统 Chromium 系浏览器（channel 失败后的 executablePath 兜底链，按平台列常见路径）。 */
function browserExecutableCandidates(): string[] {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const localAppData = process.env.LOCALAPPDATA || ''
    return [
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter((p) => p && p !== path.sep)
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]
  }
  return ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

/** 快照文本限长（保尾部提示，让模型知道被截断） */
export function capText(text: string, cap: number = SNAPSHOT_CAP): string {
  if (typeof text !== 'string') return ''
  if (text.length <= cap) return text
  return text.slice(0, cap) + `\n…（快照超过 ${cap} 字符已截断：改用 browser_snapshot 的 selector 只看一个区域）`
}

/** 从 PNG 字节取宽高（IHDR 定长偏移，纯函数供单测） */
export function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** 校验 act 的定位参数：四选一（ref / role+name / text / selector），ref 最先——
 *  它是快照里的逐元素精确指针。返回归一化对象或错误 */
export function normalizeLocatorArgs(args?: ActArgs): { kind: 'ref'; ref: string } | { kind: 'selector'; selector: string } | { kind: 'role'; role: string; name: string } | { kind: 'text'; text: string } | { error: string } {
  const { role, name, text, selector, ref } = args ?? {}
  if (ref !== undefined && ref !== null && String(ref).trim() !== '') {
    // 宽容收各写法：e12 / f7e12 / ref=e12 / [ref=e12]。**帧内元素必须带 f<帧序>**：
    // playwright 的 ariaSnapshot 只给主帧元素印裸 e12，iframe 里的元素印 f7e12，而它的
    // aria-ref 引擎按 /^f(\d+)e\d+$/ 跳帧解析（coreBundle.js `_jumpToAriaRefFrameIfNeeded`）。
    // 只放行裸 eN 会把「快照能看见、却一个都点不动」变成常态——DSH 自己的 GUI 就跑在
    // iframe 里，整页 ref 全是 f 形态。
    const cleaned = String(ref).trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^ref=/, '').trim()
    if (/^(?:f\d+)?e\d+$/.test(cleaned)) return { kind: 'ref', ref: cleaned }
    return { error: `ref 形如 e12 或 f7e12（照抄快照里的 [ref=…]），收到：${String(ref).slice(0, 40)}` }
  }
  if (selector !== undefined && selector !== null && String(selector).trim() !== '') {
    return { kind: 'selector', selector: String(selector).trim() }
  }
  if (role !== undefined && role !== null && String(role).trim() !== '') {
    return { kind: 'role', role: String(role).trim(), name: name === undefined || name === null ? '' : String(name) }
  }
  if (text !== undefined && text !== null && String(text).trim() !== '') {
    return { kind: 'text', text: String(text) }
  }
  return { error: '缺少定位参数：ref（照抄快照 [ref=…]）/ role（+name）/ text / selector 四选一' }
}

const ACT_KINDS = new Set(['click', 'type', 'press', 'check', 'uncheck', 'select', 'hover', 'scroll', 'upload'])
/** 校验 act 的动作与参数配套（type/select/upload 需要 value，press 需要 key；
 *  scroll 的定位目标/dx dy 配套在 service 层校验——normalize 不知道有无定位） */
export function normalizeActArgs(args?: ActArgs): { action: string } | { error: string } {
  const action = String(args?.action ?? '').trim()
  if (!ACT_KINDS.has(action)) {
    return { error: `未知 action：${action || '(空)'}——可选 click/type/press/check/uncheck/select/hover/scroll/upload` }
  }
  if ((action === 'type' || action === 'select' || action === 'upload') && (args?.value === undefined || String(args.value) === '')) {
    return { error: `action=${action} 需要 value` }
  }
  if (action === 'press' && (args?.key === undefined || String(args.key).trim() === '')) {
    return { error: 'action=press 需要 key（如 Enter、Control+A）' }
  }
  return { action }
}

/** JS 对话框记录的文本投影：act/navigate 结果 warning 用。playwright 无监听器时
 *  会静默 auto-dismiss，agent 端看到的只是"点了没反应"——把弹出事实带回即可消除
 *  这一类神秘失效 */
function dialogWarning(dialogs: Array<{ type: string; message: string }>): string | null {
  if (dialogs.length === 0) return null
  return `页面弹出 ${dialogs.map((d) => `${d.type}「${d.message}」`).join('、')}，已自动关闭（confirm 默认按取消处理）`
}

export class BrowserService {
  private _log: (msg: string) => void
  private _pw: PwModule | null
  private _context: PwContext | null
  private _launchError: string | null
  /** 上次启动失败的时刻（0 = 没失败过）：与 _launchError 一起构成快速失败窗口 */
  private _launchFailedAt: number
  private _launching: Promise<{ ok: true } | { ok: false; error: string }> | null
  /** 分区表：会话 id → 页集与指针。空的（无页无观察者）分区随手删，不长期占位 */
  private _scopes: Map<string, ScopeState>
  /** 启动时上下文里已有的页：不预设分区，谁第一个要页谁认领（见 _claimIdlePage） */
  private _unclaimed: PwPage[]
  /** newPage 与 'page' 事件之间的分区交接（事件先于 resolve 到达时靠它认领归属）。
   *  按请求排队而非单值：两个分区同时开页时事件要按 FIFO 与请求对号，共用一枚
   *  单值会让页被后一个分区认领走（表现是「页跑进别的对话」） */
  private _pendingScopes: Array<{ scope: string }>
  private _nextId: number
  private _listeners: Set<(evt: BrowserEvent) => void>
  private _lastActivity: number
  private _idleTimer: NodeJS.Timeout | null
  private _disposed: boolean

  constructor({ log = () => {} }: { log?: (msg: string) => void } = {}) {
    this._log = log
    this._pw = loadPlaywright()
    this._context = null
    this._launchError = null
    this._launchFailedAt = 0
    this._launching = null
    this._scopes = new Map()
    this._unclaimed = []
    this._pendingScopes = []
    this._nextId = 1
    this._listeners = new Set()
    this._lastActivity = Date.now()
    this._idleTimer = null
    this._disposed = false
    if (this._pw) this._startIdleTimer()
  }

  /** 插件/宿主能力面是否可用（vendor 加载成功） */
  get available(): boolean {
    return this._pw !== null
  }

  get launchError(): string | null {
    return this._launchError
  }

  on(cb: (evt: BrowserEvent) => void): () => boolean {
    this._listeners.add(cb)
    return () => this._listeners.delete(cb)
  }

  private _emit(evt: BrowserEvent): void {
    for (const cb of this._listeners) {
      try {
        cb(evt)
      } catch {
        // 监听方异常不传染
      }
    }
  }

  /** 取（必要时建）分区状态。分区键由调用方给（工具 = 会话 id，面板 = 连接声明的会话）。 */
  private _s(scope: string): ScopeState {
    const key = normalizeScope(scope)
    let s = this._scopes.get(key)
    if (!s) {
      s = {
        pages: new Map(),
        titles: new Map(),
        dialogs: new Map(),
        activeId: null,
        viewId: null,
        frames: new Map(),
        streams: new Map(),
        frameBoxes: new Map(),
        lastActivity: Date.now(),
        inputQueue: Promise.resolve(),
      }
      this._scopes.set(key, s)
    }
    return s
  }

  /** 分区没页、没观察者、没帧流就删掉它的记录（分区表不长期堆空壳） */
  private _dropIdleScope(scope: string): void {
    const s = this._scopes.get(scope)
    if (s && s.pages.size === 0 && s.frames.size === 0 && s.streams.size === 0) this._scopes.delete(scope)
  }

  private _touch(scope?: string): void {
    const now = Date.now()
    this._lastActivity = now
    if (scope !== undefined) this._s(scope).lastActivity = now
  }

  private _watchersTotal(): number {
    let n = 0
    for (const s of this._scopes.values()) for (const sinks of s.frames.values()) n += sinks.size
    return n
  }

  private _pagesTotal(): number {
    let n = 0
    for (const s of this._scopes.values()) n += s.pages.size
    return n
  }

  private _startIdleTimer(): void {
    if (this._idleTimer) return
    this._idleTimer = setInterval(() => {
      if (this._disposed) return
      const now = Date.now()
      // 分区级回收：没人看且十分钟没动过的对话，只收它自己的页（别的对话不受影响）
      for (const [key, s] of [...this._scopes]) {
        if (now - s.lastActivity <= IDLE_CLOSE_MS) continue
        if (s.pages.size === 0) {
          // 空壳同样回收：_s() 对任意 scope 建条目、面板又接受任意 scope 串，
          // 只跳过的话用过的每个 scope 都是一条永不消失的记录
          this._dropIdleScope(key)
          continue
        }
        if (s.frames.size > 0) continue
        this._log(`分区空闲超时，收起该对话的 ${s.pages.size} 页`)
        void this._closeScopePages(key, s)
      }
      if (this._context && this._watchersTotal() === 0 && this._pagesTotal() === 0 && now - this._lastActivity > IDLE_CLOSE_MS) {
        this._log('空闲超时，自动关闭（登录态保留在专用 profile）')
        void this._closeContext()
      }
    }, IDLE_TICK_MS)
    this._idleTimer.unref?.()
  }

  /** 收掉一个分区的全部页（空闲回收；不碰其它分区，也不关实例——实例的关由空闲 tick 判） */
  private async _closeScopePages(scope: string, s: ScopeState): Promise<void> {
    for (const page of [...s.pages.values()]) {
      try {
        await page.close()
      } catch {
        // 已关/崩：后面的清理照走
      }
    }
    this._dropIdleScope(scope)
    this._emit({ kind: 'scope', scope })
  }

  /** 启动前清理上次异常留下的孤儿实例（pidfile 信任 + 进程名核验） */
  private async _cleanupOrphan(): Promise<void> {
    const pidFile = kitPath('browser-profile', '.pid')
    let pid = 0
    try {
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim())
    } catch {
      return
    }
    if (!Number.isInteger(pid) || pid <= 0) return
    const isBrowser = () =>
      new Promise<boolean>((resolve) => {
        let out = ''
        let child: import('node:child_process').ChildProcess
        try {
          child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
        } catch {
          resolve(false)
          return
        }
        child.stdout?.on('data', (d: Buffer) => {
          out += d
        })
        child.on('error', () => resolve(false))
        child.on('close', () => resolve(/msedge|chrome/i.test(out)))
      })
    const kill = () =>
      new Promise<boolean>((resolve) => {
        let child: import('node:child_process').ChildProcess
        try {
          child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
        } catch {
          resolve(false)
          return
        }
        child.on('error', () => resolve(false))
        child.on('close', () => resolve(true))
      })
    if (!(process.platform === 'win32' ? await isBrowser() : true)) {
      try {
        fs.unlinkSync(pidFile)
      } catch {}
      return
    }
    await kill()
    try {
      fs.unlinkSync(pidFile)
    } catch {}
    this._log(`清理上次残留的浏览器实例（pid ${pid}）`)
  }

  /** 懒启动持久化上下文（幂等；并发调用共享同一次启动） */
  async ensure(): Promise<{ ok: true } | { ok: false, error: string }> {
    this._touch()
    if (this._context) return { ok: true }
    if (this._launchError && Date.now() - this._launchFailedAt < LAUNCH_RETRY_MS) {
      return { ok: false, error: this._launchError }
    }
    if (!this._launching) {
      // 落定即清：context 事后关闭（关最后一页/空闲关闭/崩溃）后 _launching 若残留
      // 已落定的旧 promise，这里会误报 ok，调用方拿 null context 去 newPage 直接崩，
      // 服务从此砖死到重启——正式环境 0.4.3 实际踩中过
      this._launching = this._launch().finally(() => { this._launching = null })
    }
    return this._launching
  }

  private async _launch(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this._pw) {
      this._launchError = 'playwright-core vendor 不可用（host-vendor 缺失或损坏）'
      return { ok: false, error: this._launchError }
    }
    // 必须等：上次异常退出的实例还占着 profile 时，抢跑 launch 会失败并落进重试窗口
    await this._cleanupOrphan()
    // 启动即广播：面板拿到 launching 状态可提示「启动中」而不是空白等待
    this._emit({ kind: 'state' })
    const userDataDir = kitPath('browser-profile')
    fs.mkdirSync(userDataDir, { recursive: true })
    const common = {
      headless: true,
      viewport: { width: 1280, height: 800 },
      timeout: LAUNCH_TIMEOUT,
    }
    let context: PwContext | null = null
    let lastError: unknown = null
    const attempts: Array<{ channel?: string; executablePath?: string }> = [
      { channel: 'msedge' },
      { channel: 'chrome' },
      ...browserExecutableCandidates()
        .filter((p) => {
          try {
            return fs.existsSync(p)
          } catch {
            return false
          }
        })
        .map((executablePath) => ({ executablePath })),
    ]
    for (const attempt of attempts) {
      try {
        context = await this._pw.chromium.launchPersistentContext(userDataDir, { ...common, ...attempt })
        break
      } catch (error) {
        lastError = error
        this._log(`启动失败（${attempt.channel ?? attempt.executablePath}）：${error instanceof Error ? error.message : error}`)
      }
    }
    if (!context) {
      this._launchError = `无法启动系统浏览器（Edge/Chrome）：${lastError instanceof Error ? lastError.message : lastError}`
      this._launchFailedAt = Date.now()
      this._emit({ kind: 'state' })
      return { ok: false, error: this._launchError }
    }
    // 启动途中插件被卸载：这只 context 已无人接管（dispose 那一刻它还不存在），当场收掉
    if (this._disposed) {
      try {
        await context.close()
      } catch {}
      return { ok: false, error: '浏览器组件已卸载' }
    }
    this._context = context
    this._launchError = null
    this._launchFailedAt = 0
    context.on('close', () => {
      this._context = null
      this._scopes.clear()
      this._unclaimed = []
      this._pendingScopes = []
      this._emit({ kind: 'closed' })
    })
    // pidfile（孤儿防护，尽力而为）
    try {
      const browser = typeof context.browser === 'function' ? context.browser() : null
      const pid = browser && typeof browser.process === 'function' ? browser.process()?.pid : null
      if (pid) fs.writeFileSync(path.join(userDataDir, '.pid'), String(pid))
    } catch {}
    // 上下文自带的页（persistent context 起来就有一页 about:blank，硬杀残留还会带回旧页）
    // 不预设分区，谁第一个要页谁认领；不认领就一直挂着，实例收摊时一起没
    this._unclaimed = context.pages().slice()
    context.on('page', (page) => {
      // 弹窗（target=_blank）按打开者归分区；newPage 建的页靠 _pendingScopes 队列交接。
      // opener() 是 async（coreBundle 客户端实现），只能异步读——已被显式路径纳管的页
      // 直接跳过（_adopt 认 page 上的分区标记，晚到的异步分支不会把它搬到别处）
      const registered = page.__dshScope
      if (registered !== undefined) {
        this._adopt(page, registered)
        return
      }
      const token = this._pendingScopes[0]
      void (async () => {
        let openerScope: string | null = null
        try {
          const opener = page.opener ? await page.opener() : null
          openerScope = opener?.__dshScope ?? null
        } catch {
          // opener 读取失败按无打开者处理（落 pending/兜底分区）
        }
        if (page.__dshTabId !== undefined) return
        const scope = openerScope ?? token?.scope ?? DEFAULT_SCOPE
        // 认领掉最早那次 newPage 的交接（弹窗有打开者，不动这枚 token）
        if (openerScope === null && token !== undefined && this._pendingScopes[0] === token) this._pendingScopes.shift()
        this._adopt(page, scope)
      })()
    })
    this._log('已启动（headless，专用 profile）')
    return { ok: true }
  }

  /** 认领上下文自带的一页（首个要页的分区拿到它，省掉一个空白页签） */
  private _claimIdlePage(scope: string): PwPage | null {
    while (this._unclaimed.length > 0) {
      const page = this._unclaimed.shift()!
      if (page.isClosed?.() === true) continue
      this._adopt(page, scope)
      return page
    }
    return null
  }

  /** 给分区开一页（优先认领自带页，否则 newPage）——调用后该页是本分区活动页 */
  private async _openPage(scope: string): Promise<PwPage> {
    const claimed = this._claimIdlePage(scope)
    if (claimed) return claimed
    // 'page' 事件通常先于 newPage 的 resolve 到达并据此认领；没到就这里兜底。
    // token 按 FIFO 与事件对号——并发开页时不能共用一枚单值
    const token = { scope }
    this._pendingScopes.push(token)
    let page: PwPage | null = null
    try {
      page = await this._context!.newPage()
    } finally {
      const at = this._pendingScopes.indexOf(token)
      if (at >= 0) this._pendingScopes.splice(at, 1)
    }
    if (page === null) throw new Error('新建页失败')
    if (page.__dshTabId === undefined) this._adopt(page, scope)
    // 事件路径理论上不会认错 token；真错了也在这里搬回来，保住
    // 「_openPage 返回的页属于本分区」这条不变量
    this._rehome(page, scope)
    return page
  }

  /** 纳管一页（幂等）：归属分区、缓存标题、监听导航与崩溃；返回 tabId。
   *  分区以 page 上的标记为准（晚到的 'page' 事件分支带错 scope 也不会把页搬走）。 */
  private _adopt(page: PwPage, scope: string): number {
    const key = normalizeScope(page.__dshScope ?? scope)
    const s = this._s(key)
    page.__dshScope = key
    if (page.__dshTabId !== undefined) {
      // 已纳管（newPage 与 'page' 事件都会走到这里）：提升为本分区活动页，
      // 观察页恒跟随（浏览器与 agent 同步）
      s.activeId = page.__dshTabId
      this._setView(key, page.__dshTabId)
      return page.__dshTabId
    }
    const tabId = this._nextId++
    s.pages.set(tabId, page)
    s.activeId = tabId
    page.__dshTabId = tabId
    this._setView(key, tabId)
    page.title().then((t) => {
      s.titles.set(tabId, t)
      this._emit({ kind: 'navigated', scope: key, tabId, url: page.url(), title: t })
    }).catch(() => {})
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      const id = page.__dshTabId
      if (id === undefined) return
      page.title().then((t) => {
        s.titles.set(id, t)
      }).catch(() => {})
      this._touch(key)
      this._emit({ kind: 'navigated', scope: key, tabId: id, url: page.url(), title: s.titles.get(id) ?? '' })
      this._resyncStream(key, id)
    })
    page.on('dialog', (dialog) => {
      const id = page.__dshTabId
      if (id === undefined) return
      const list = s.dialogs.get(id) ?? []
      list.push({ type: dialog.type(), message: dialog.message().slice(0, 120), at: Date.now() })
      if (list.length > 5) list.shift()
      s.dialogs.set(id, list)
      // 挂了监听器后 playwright 不再自动关对话框，必须显式 dismiss（否则页面冻结
      // 等输入、后续动作全部超时）。dismiss=取消，与 playwright 无监听时的默认（自动关闭）一致，
      // 差别只在弹出事实被记录并回传
      void dialog.dismiss().catch(() => {})
    })
    page.on('crash', () => {
      const id = page.__dshTabId
      if (id === undefined) return
      this._emit({ kind: 'crashed', scope: key, tabId: id })
      s.pages.delete(id)
      s.titles.delete(id)
      this._pageGone(key, id)
    })
    page.on('close', () => {
      const id = page.__dshTabId
      if (id === undefined) return
      s.pages.delete(id)
      s.titles.delete(id)
      this._pageGone(key, id)
      this._emit({ kind: 'scope', scope: key })
    })
    this._emit({ kind: 'scope', scope: key })
    return tabId
  }

  /** 把已纳管的页搬到另一个分区（并发开页时事件路径认错 token 的兜底）。
   *  订阅与帧流属于旧分区，搬走前先摘掉——留着会把帧推给别的对话的画布 */
  private _rehome(page: PwPage, scope: string): void {
    const key = normalizeScope(scope)
    const id = page.__dshTabId
    if (id === undefined || page.__dshScope === key) return
    const from = page.__dshScope
    if (from !== undefined) {
      const old = this._scopes.get(from)
      if (old && old.pages.get(id) === page) {
        old.pages.delete(id)
        old.titles.delete(id)
        old.dialogs.delete(id)
        old.frames.delete(id)
        if (old.streams.has(id)) void this._detachStream(from, id)
        if (old.activeId === id) old.activeId = old.pages.keys().next().value ?? null
        if (old.viewId === id) old.viewId = old.activeId ?? null
        this._emit({ kind: 'scope', scope: from })
      }
    }
    const s = this._s(key)
    page.__dshScope = key
    s.pages.set(id, page)
    s.activeId = id
    this._setView(key, id)
    this._emit({ kind: 'scope', scope: key })
  }

  /** 记下本分区人最近动的那页（幂等，广播）：帧流按页各挂各的，观察指针只管
   *  「没带页 id 的调用落哪一页」（agent 工具与 HTTP 改投走它） */
  private _setView(scope: string, tabId: number): void {
    const s = this._s(scope)
    if (s.viewId === tabId) return
    s.viewId = tabId
    this._emit({ kind: 'scope', scope })
  }

  /** 页面消失（关闭/崩溃）后本分区两个指针的回退：活动页取剩余首页；观察页优先跟随活动页 */
  private _pageGone(scope: string, id: number): void {
    const s = this._s(scope)
    s.dialogs.delete(id)
    if (s.activeId === id) s.activeId = s.pages.keys().next().value ?? null
    if (s.viewId === id) s.viewId = s.activeId ?? s.pages.keys().next().value ?? null
    // 流的宿主页没了就拆掉：CDP 会话已死，留着会让面板把最后一帧当成活画面
    // （关最后一页后面板冻结在旧视图，看起来像还在直播，误导人以为页面还在）
    if (s.streams.has(id)) void this._detachStream(scope, id)
    s.frames.delete(id)
    if (s.pages.size === 0) this._dropIdleScope(scope)
  }

  /** 本分区无页则开一页（about:blank） */
  async ensurePage(scope: string = DEFAULT_SCOPE): Promise<{ ok: true; tabId?: number } | { ok: false; error: string }> {
    const ensureResult = await this.ensure()
    if (!ensureResult.ok) return ensureResult
    if (!this._context) return { ok: false, error: '浏览器未运行' }
    const s = this._s(scope)
    if (s.activeId === null || !s.pages.has(s.activeId)) {
      await this._openPage(scope)
      if (s.activeId === null) return { ok: false, error: '页面创建失败' }
    }
    return { ok: true, tabId: s.activeId }
  }

  private _page(scope: string, tabId?: number | null): PwPage | null {
    const s = this._s(scope)
    if (tabId === undefined || tabId === null) {
      if (s.activeId === null) return null
      return s.pages.get(s.activeId) ?? null
    }
    return s.pages.get(Number(tabId)) ?? null
  }

  /** 取走本分区 tabId 自 since 起弹出的对话框记录（取走即清，下一次动作不重复报告） */
  private _drainDialogs(scope: string, tabId: number, since: number): Array<{ type: string; message: string }> {
    const s = this._s(scope)
    const list = s.dialogs.get(tabId)
    if (!list || list.length === 0) return []
    const fresh = list.filter((d) => d.at >= since).map((d) => ({ type: d.type, message: d.message }))
    s.dialogs.set(tabId, [])
    return fresh
  }

  /** 列本分区页集。ensure:false = 只看现状，浏览器没跑就回空表——只读的工具面
   *  （browser_tabs list、关页后的回读）不该把浏览器拉起来，那是「被动动作不属于
   *  使用理由」这条面板口径的延伸。 */
  async listPages(scope: string = DEFAULT_SCOPE, { ensure = true }: { ensure?: boolean } = {}): Promise<{ ok: true; pages: Array<{ tabId: number; url: string; title: string; active: boolean; viewed: boolean }>; activeId: number | null; viewId: number | null } | { ok: false; error: string }> {
    if (ensure) {
      const ensureResult = await this.ensure()
      if (!ensureResult.ok) return { ok: false, error: ensureResult.error }
    }
    if (!this._context) return { ok: true, pages: [], activeId: null, viewId: null }
    const s = this._s(scope)
    const pages: Array<{ tabId: number; url: string; title: string; active: boolean; viewed: boolean }> = []
    for (const [tabId, page] of s.pages) {
      pages.push({ tabId, url: page.url(), title: s.titles.get(tabId) ?? '', active: tabId === s.activeId, viewed: tabId === s.viewId })
    }
    return { ok: true, pages, activeId: s.activeId, viewId: s.viewId }
  }

  async state(scope: string = DEFAULT_SCOPE): Promise<{ available: false; error: string } | { available: true; running: false; launching: boolean; error: string | null } | { available: true; running: true; launching: false; pages: Array<{ tabId: number; url: string; title: string; active: boolean; viewed: boolean }>; activeId: number | null; viewId: number | null }> {
    if (!this._pw) return { available: false, error: this._launchError ?? 'playwright-core vendor 不可用' }
    if (!this._context) return { available: true, running: false, launching: this._launching !== null, error: this._launchError }
    const listed = await this.listPages(scope)
    if (!listed.ok) return { available: true, running: true, launching: false, pages: [], activeId: null, viewId: null }
    return {
      available: true,
      running: true,
      launching: false,
      pages: listed.pages,
      activeId: listed.activeId,
      viewId: listed.viewId,
    }
  }

  /** 导航（工具与面板共用）：返回 { tabId, title, url, snapshot? }。
   *  agent 路径作用于本分区 agent 活动页；forHuman（面板 URL 栏）作用于本分区观察页、
   *  不动 agent 活动页；targetId 显式点名某页（面板一签一页时地址栏作用于自己那张签）。
   *  两者都只落在本分区，别的对话的页不受影响。 */
  async navigate(scope: string, url: string, { newTab = false, snapshot = true, forHuman = false, targetId = null }: { newTab?: boolean; snapshot?: boolean; forHuman?: boolean; targetId?: number | null } = {}): Promise<{ ok: true; tabId: number; url: string; title: string; snapshot?: string; warning?: string } | { ok: false; error: string }> {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return { ok: false, error: '仅支持 http/https URL' }
    }
    const ensured = await this.ensure()
    if (!ensured.ok) return ensured
    const s = this._s(scope)
    const anchorId = targetId !== null && s.pages.has(Number(targetId)) ? Number(targetId) : forHuman ? s.viewId : s.activeId
    let page: PwPage
    if (newTab || anchorId === null || !s.pages.has(anchorId)) {
      // 新页或本分区还没有页：开一页（认领自带页或 newPage）并纳管
      page = await this._openPage(scope)
    } else {
      page = s.pages.get(anchorId)!
    }
    const tabId = page.__dshTabId!
    const t0 = Date.now()
    try {
      await page.goto(url.trim(), { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT })
    } catch (error) {
      return { ok: false, error: `导航失败：${error instanceof Error ? error.message : error}（页面可能仍在加载，可重试或改用 snapshot 观察）` }
    }
    this._touch(scope)
    const title = await page.title().catch(() => '')
    s.titles.set(tabId, title)
    const result: { ok: true; tabId: number; url: string; title: string; snapshot?: string; warning?: string } = { ok: true, tabId, url: page.url(), title }
    if (snapshot) result.snapshot = capText(await this._snapshotOf(page))
    // 加载期弹出的对话框（部分页面 onload alert）随结果带回
    const dlgWarn = dialogWarning(this._drainDialogs(scope, tabId, t0))
    if (dlgWarn) result.warning = dlgWarn
    // 观察页跟随（恒定语义）：agent 导航与人的 URL 栏导航都作用于本分区观察页
    this._setView(scope, tabId)
    this._emit({ kind: 'navigated', scope: normalizeScope(scope), tabId, url: result.url, title })
    return result
  }

  /** 取某页快照（selector 给定时只看该子树） */
  private async _snapshotOf(page: PwPage, selector?: string): Promise<string> {
    try {
      return await (selector ? page.locator(selector) : page.locator('body')).ariaSnapshot({ mode: 'ai' })
    } catch (error) {
      return `（快照失败：${error instanceof Error ? error.message : error}）`
    }
  }

  /** 紧凑树观察。selector = 只看该选择器命中的子树（大页面按块看，省 token）；
   *  maxChars = 覆盖默认 8KB 上限（越界夹到 SNAPSHOT_MIN..SNAPSHOT_MAX） */
  async snapshot(scope: string, tabId?: number | null, opts: { selector?: string; maxChars?: number } = {}): Promise<{ ok: true; tabId: number; url: string; title: string; snapshot: string } | { ok: false; error: string }> {
    const ensured = await this.ensure()
    if (!ensured.ok) return { ok: false, error: ensured.error }
    const page = this._page(scope, tabId)
    if (!page) return { ok: false, error: `页不存在：${tabId ?? '(缺省)'}（用 browser_navigate 或先开一页）` }
    const selector = typeof opts.selector === 'string' ? opts.selector.trim() : ''
    if (selector !== '') {
      // 先数匹配数：ariaSnapshot 的定位等待是 30s 级，无匹配时不该让调用方干等
      const hit = await page.locator(selector).count().catch(() => 0)
      if (hit === 0) return { ok: false, error: `范围无匹配：selector=${selector}（先整页快照或 browser_eval 核对选择器，不要原样重试）` }
    }
    const cap =
      typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars)
        ? Math.min(Math.max(Math.trunc(opts.maxChars), SNAPSHOT_MIN), SNAPSHOT_MAX)
        : SNAPSHOT_CAP
    this._touch(scope)
    const id = page.__dshTabId!
    const scopeState = this._s(scope)
    return { ok: true, tabId: id, url: page.url(), title: scopeState.titles.get(id) ?? '', snapshot: capText(await this._snapshotOf(page, selector || undefined), cap) }
  }

  /** 统一动作：click/type/press/check/uncheck/select/hover/scroll/upload；默认返回
   *  新快照（动作即观察）。ref 定位走 aria-ref 引擎（可穿透 iframe）；scroll 有定位
   *  目标=滚动到元素可见，无定位=按 dx/dy 真实滚轮；upload 的 value 为本地绝对路径 */
  async act(scope: string, args: ActArgs): Promise<{ ok: true; tabId: number; url: string; title: string; matched: number | null; warning?: string; snapshot?: string } | { ok: false; error: string }> {
    const ensured = await this.ensure()
    if (!ensured.ok) return ensured
    const page = this._page(scope, args.tabId)
    if (!page) return { ok: false, error: `页不存在：${args.tabId}` }
    const act = normalizeActArgs(args)
    if ('error' in act) return { ok: false, error: act.error }
    const t0 = Date.now() // 对话框可见性窗口起点（动作派发前）
    const timeout = Math.min(Math.max(Number(args.timeoutMs) || ACT_TIMEOUT_DEFAULT, 1000), ACT_TIMEOUT_MAX)
    const hasLocator = [args?.ref, args?.role, args?.name, args?.text, args?.selector].some(
      (v) => v !== undefined && v !== null && String(v).trim() !== '',
    )
    const wheelDelta = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.max(-5000, Math.min(5000, Math.round(n))) : 0
    }
    const dx = wheelDelta(args.dx)
    const dy = wheelDelta(args.dy)
    if (act.action === 'scroll' && !hasLocator && dx === 0 && dy === 0) {
      return { ok: false, error: 'scroll 需要 dx/dy（滚动增量，负值向上）或定位目标（滚动到元素可见）' }
    }
    // upload 的 value=本地文件路径（多文件换行分隔），先验存在再交给 playwright
    let uploadFiles: string[] = []
    if (act.action === 'upload') {
      uploadFiles = String(args.value).split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
      const missing = uploadFiles.filter((f) => {
        try {
          return !fs.existsSync(f)
        } catch {
          return true
        }
      })
      if (uploadFiles.length === 0) return { ok: false, error: 'upload 的 value 未包含有效文件路径' }
      if (missing.length > 0) return { ok: false, error: `文件不存在：${missing.join('、')}` }
    }
    let locator: PwLocator | null = null
    let loc: ReturnType<typeof normalizeLocatorArgs> | null = null
    try {
      if (!hasLocator && (act.action === 'press' || act.action === 'scroll')) {
        // 无定位目标：press 直接发键盘、scroll 走真实滚轮事件
        if (act.action === 'press') await page.keyboard.press(args.key ?? '')
        else await page.mouse.wheel(dx, dy)
        locator = null
      } else {
        loc = normalizeLocatorArgs(args)
        if ('error' in loc) return { ok: false, error: loc.error }
        if (loc.kind === 'ref') locator = page.locator(`aria-ref=${loc.ref}`)
        else if (loc.kind === 'selector') locator = page.locator(loc.selector)
        else if (loc.kind === 'role') locator = page.getByRole(loc.role, loc.name ? { name: loc.name } : {})
        else locator = page.getByText(loc.text)
      }
    } catch (error) {
      return { ok: false, error: `定位失败：${error instanceof Error ? error.message : error}` }
    }
    let matched: number | null = null
    if (locator) {
      try {
        matched = await locator.count()
      } catch {
        matched = null
      }
      if (matched === 0) {
        const l = loc!
        if (l.kind === 'ref') {
          return {
            ok: false,
            error: `ref=${l.ref} 未找到——ref 在每次快照后可能重排（页面已变化），重取 browser_snapshot 用新 ref，不要原样重试`,
          }
        }
        return {
          ok: false,
          error: `目标未找到（${l.kind}${l.kind === 'role' ? `=${l.role}` : ''}${'name' in l && l.name ? ` name=${l.name}` : ''}${l.kind === 'text' ? ` text=${l.text}` : ''}${l.kind === 'selector' ? ` selector=${l.selector}` : ''}）——重取 browser_snapshot 再构造定位，不要原样重试`,
        }
      }
      const target = locator.first()
      try {
        this._touch(scope)
        switch (act.action) {
          case 'click':
            await target.click({ timeout })
            break
          case 'type':
            await target.fill(String(args.value), { timeout })
            break
          case 'press':
            await target.press(args.key ?? '', { timeout })
            break
          case 'check':
            await target.setChecked(true, { timeout })
            break
          case 'uncheck':
            await target.setChecked(false, { timeout })
            break
          case 'select':
            await target.selectOption(String(args.value), { timeout })
            break
          case 'hover':
            await target.hover({ timeout })
            break
          case 'scroll':
            await target.scrollIntoViewIfNeeded({ timeout })
            break
          case 'upload':
            await target.setInputFiles(uploadFiles, { timeout })
            break
        }
      } catch (error) {
        return { ok: false, error: `${act.action} 失败：${error instanceof Error ? error.message : error}——重取 browser_snapshot 后重建定位，不要原样重试` }
      }
    }
    const result: { ok: true; tabId: number; url: string; title: string; matched: number | null; warning?: string; snapshot?: string } = {
      ok: true,
      tabId: page.__dshTabId!,
      url: page.url(),
      title: await page.title().catch(() => ''),
      matched,
    }
    // act 是 agent 的状态改变操作：观察页恒跟随（与 navigate 同规则）
    this._setView(scope, page.__dshTabId!)
    if (matched !== null && matched > 1) result.warning = `目标不唯一（${matched} 个匹配），已作用于第一个——可加 name/text 收窄`
    // 动作期间弹出的对话框（如 confirm）带回——点击"没反应"多半是它
    const dlgWarn = dialogWarning(this._drainDialogs(scope, page.__dshTabId!, t0))
    if (dlgWarn) result.warning = result.warning ? `${result.warning}；${dlgWarn}` : dlgWarn
    if (args.snapshot !== false) result.snapshot = capText(await this._snapshotOf(page))
    return result
  }

  /** 页面内 JS（返回 JSON 值，限长） */
  async evaluate(scope: string, expression: string, tabId?: number | null): Promise<{ ok: true; tabId: number; value: string } | { ok: false; error: string }> {
    const ensured = await this.ensure()
    if (!ensured.ok) return ensured
    const page = this._page(scope, tabId)
    if (!page) return { ok: false, error: `页不存在：${tabId}` }
    if (typeof expression !== 'string' || expression.trim() === '') {
      return { ok: false, error: '缺少 expression（页面上下文中可执行的 JS 表达式）' }
    }
    this._touch(scope)
    try {
      const value = await page.evaluate(expression)
      let json: string
      try {
        json = JSON.stringify(value ?? null)
      } catch {
        json = String(value)
      }
      if (json.length > EVAL_CAP) json = json.slice(0, EVAL_CAP) + '…（结果超长已截断）'
      return { ok: true, tabId: page.__dshTabId!, value: json }
    } catch (error) {
      return { ok: false, error: `evaluate 失败：${error instanceof Error ? error.message : error}` }
    }
  }

  /** 截图：返回 buffer + 尺寸（image 附件化在 browser-tools 里做，需 exec/ctx） */
  async screenshot(scope: string, { fullPage = false, tabId }: { fullPage?: boolean; tabId?: number | null } = {}): Promise<{ ok: true; tabId: number; url: string; buffer: Buffer; size: { width: number; height: number } | null } | { ok: false; error: string }> {
    const ensured = await this.ensure()
    if (!ensured.ok) return ensured
    const page = this._page(scope, tabId)
    if (!page) return { ok: false, error: `页不存在：${tabId}` }
    this._touch(scope)
    try {
      const buffer = await page.screenshot({ fullPage: fullPage === true, type: 'png' })
      return { ok: true, tabId: page.__dshTabId!, url: page.url(), buffer, size: pngSize(buffer) }
    } catch (error) {
      return { ok: false, error: `截图失败：${error instanceof Error ? error.message : error}` }
    }
  }

  /** 视口切换（响应式/移动布局验证）：作用于指定页（默认 agent 活动页）。
   *  范围 320–3840 × 320–2160，越界报错不静默 clamp；新页签仍以启动默认 1280×800
   *  打开（launchPersistentContext 的 viewport 选项），面板帧流坐标按帧原始尺寸
   *  换算，视口变化天然跟随。 */
  async setViewport(scope: string, { width, height, tabId }: { width: number; height: number; tabId?: number | null } = { width: 1280, height: 800 }): Promise<{ ok: true; tabId: number; url: string; viewport: { width: number; height: number } } | { ok: false; error: string }> {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 320 || w > 3840 || h < 320 || h > 2160) {
      return { ok: false, error: `视口需整数且 320≤宽≤3840、320≤高≤2160，收到 ${width}×${height}` }
    }
    const ensured = await this.ensure()
    if (!ensured.ok) return ensured
    const page = this._page(scope, tabId)
    if (!page) return { ok: false, error: `页不存在：${tabId ?? '(缺省)'}` }
    this._touch(scope)
    try {
      await page.setViewportSize({ width: w, height: h })
    } catch (error) {
      return { ok: false, error: `视口设置失败：${error instanceof Error ? error.message : error}` }
    }
    return { ok: true, tabId: page.__dshTabId!, url: page.url(), viewport: { width: w, height: h } }
  }

  /** 关本分区一页 */
  async closePage(scope: string, tabId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const page = this._s(scope).pages.get(Number(tabId))
    if (!page) return { ok: false, error: `页不存在：${tabId}` }
    try {
      await page.close()
    } catch (error) {
      return { ok: false, error: `关闭失败：${error instanceof Error ? error.message : error}` }
    }
    // 关光所有分区的页 = 整个浏览器收摊（正常浏览器语义：0 页即关窗，不留空转
    // 实例）；优雅关闭落盘 cookie，agent 下次使用懒启动重来。别的分区还有页就只收本分区。
    // 崩溃路径不走这里（页面崩 ≠ 用户要停），空态交给面板提示兜底
    if (this._pagesTotal() === 0 && this._context !== null) await this.closeNow()
    return { ok: true }
  }

  /** agent 的 browser_act(action:'activate') 换观察页：只动观察指针，默认目标页不受影响 */
  async activatePage(scope: string, tabId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const id = Number(tabId)
    if (!this._s(scope).pages.has(id)) return { ok: false, error: `页不存在：${tabId}` }
    this._touch(scope)
    this._setView(scope, id)
    return { ok: true }
  }

  /** 面板工具栏「＋」新建页：新页即观察页（adopt 会把它提为本分区 agent 活动页，保持既有
   *  语义）；本分区无页时的首建走 ensurePage 兜底 */
  async humanNewTab(scope: string): Promise<{ ok: true; tabId?: number } | { ok: false; error: string }> {
    const ensureResult = await this.ensure()
    if (!ensureResult.ok) return ensureResult
    const s = this._s(scope)
    if (s.activeId === null || !s.pages.has(s.activeId)) return this.ensurePage(scope)
    this._touch(scope)
    await this._openPage(scope)
    return { ok: true, tabId: s.viewId ?? undefined }
  }

  /** 面板历史按钮（作用于本分区观察页）：back/forward/reload。无历史可退/超时不视为
   *  故障（页面维持原状），仍回报当前位置 */
  async history(scope: string, op: 'back' | 'forward' | 'reload', targetId: number | null = null): Promise<{ ok: true; tabId: number; url: string; title: string } | { ok: false; error: string }> {
    const s = this._s(scope)
    const page = targetId !== null ? s.pages.get(Number(targetId)) ?? null : s.viewId !== null ? s.pages.get(s.viewId) ?? null : null
    if (!page) return { ok: false, error: '无观察页（浏览器未运行或页签已关）' }
    this._touch(scope)
    try {
      if (op === 'back') await page.goBack({ timeout: GOTO_TIMEOUT })
      else if (op === 'forward') await page.goForward({ timeout: GOTO_TIMEOUT })
      else await page.reload({ timeout: GOTO_TIMEOUT })
    } catch (error) {
      this._log(`history ${op}：${error instanceof Error ? error.message : error}`)
    }
    const tabId = page.__dshTabId!
    const title = await page.title().catch(() => '')
    s.titles.set(tabId, title)
    this._emit({ kind: 'navigated', scope: normalizeScope(scope), tabId, url: page.url(), title })
    return { ok: true, tabId, url: page.url(), title }
  }

  // ── 面板帧流（每页一条 CDP 会话，页内多张签复路；页与页之间互不相干）──

  /** 面板订阅某页的帧流。subscriber 标识这一个订阅者（连接），退订时按它摘，
   *  免得同页多张签张冠李戴 */
  async watcherOpen(scope: string, tabId: number | null, subscriber: object, onFrame: FrameSink, size?: { w?: unknown; h?: unknown } | null): Promise<{ ok: true; tabId?: number } | { ok: false; error: string }> {
    const ensured = await this.ensure()
    if (!ensured.ok) return ensured
    const s = this._s(scope)
    const id = Number(tabId)
    if (!Number.isFinite(id) || !s.pages.has(id)) return { ok: false, error: `页不存在：${tabId}` }
    if (size !== undefined && size !== null) s.frameBoxes.set(id, frameBox(size))
    let sinks = s.frames.get(id)
    if (!sinks) {
      sinks = new Map()
      s.frames.set(id, sinks)
    }
    sinks.set(subscriber, onFrame)
    this._touch(scope)
    if (!s.streams.has(id)) await this._attachStream(scope, id)
    return { ok: true, tabId: id }
  }

  /** 退订某页帧流（该页无订阅者即拆 CDP 会话） */
  watcherClose(scope: string, tabId: number | null, subscriber: object): void {
    const s = this._s(scope)
    const id = Number(tabId)
    if (!Number.isFinite(id)) return
    const sinks = s.frames.get(id)
    if (!sinks) return
    sinks.delete(subscriber)
    const left = sinks.size
    if (left === 0) {
      s.frames.delete(id)
      if (s.streams.has(id)) void this._detachStream(scope, id)
    }
    if (s.frames.size === 0) this._dropIdleScope(normalizeScope(scope))
  }

  /** 面板尺寸变了：改封顶得重发 startScreencast（参数只在开流那一刻生效）。
   *  差得不多就不动——拖右栏是连续小变化，每次都重开只会抖。
   *  流还没挂时只记进 frameBoxes，_attachStream 会照它开 */
  async setFrameSize(scope: string, tabId: number, size?: { w?: unknown; h?: unknown } | null): Promise<void> {
    if (!size) return
    const s = this._s(scope)
    const id = Number(tabId)
    const next = frameBox(size)
    const cur = s.frameBoxes.get(id)
    if (cur !== undefined && sameFrameBox(cur, next)) return
    s.frameBoxes.set(id, next)
    const stream = s.streams.get(id)
    if (!stream) return
    try {
      // 必须先停：流已在跑时再发 startScreencast 不改参数（实测封顶纹丝不动），
      // 表现是面板拖大了画面仍按旧封顶投帧，越来越糊
      await stream.cdp.send('Page.stopScreencast').catch(() => {})
      await stream.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: FRAME_JPEG_QUALITY,
        maxWidth: next.maxWidth,
        maxHeight: next.maxHeight,
        everyNthFrame: FRAME_EVERY_NTH,
      })
    } catch (error) {
      this._log(`帧流改尺寸失败：${error instanceof Error ? error.message : error}`)
    }
  }

  /** 某页的一帧投给该页所有订阅者（一个订阅者抛错不拖累别的） */
  private _emitFrame(s: ScopeState, tabId: number, data: string, metadata: unknown): void {
    const sinks = s.frames.get(tabId)
    if (!sinks) return
    for (const sink of sinks.values()) {
      try {
        sink(tabId, data, metadata)
      } catch {}
    }
  }

  /** 挂某页的 CDP 帧流（一页一条；多张签看同一页复用它） */
  private async _attachStream(scope: string, tabId: number): Promise<void> {
    const s = this._s(scope)
    if (s.streams.has(tabId)) return
    const page = s.pages.get(tabId) ?? null
    if (!page || !this._context) return
    try {
      const cdp = await this._context.newCDPSession(page)
      // 并发进来（watcherOpen 与页就绪重挂）时只留先到的这条
      if (s.streams.has(tabId)) {
        await cdp.detach().catch(() => {})
        return
      }
      // ack 每帧都要给，漏一帧 Chrome 就停推。投给面板的按时刻封顶：CDP 的
      // everyNthFrame 是「砍一半」不是「封顶」——页面按 30fps 重绘就只剩 15，
      // 按 125fps 重绘就剩 62，两头都不是我们要的帧率
      let lastSent = 0
      cdp.on('Page.screencastFrame', (f) => {
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
        const now = Date.now()
        if (now - lastSent < FRAME_MIN_INTERVAL_MS) return
        lastSent = now
        try {
          this._emitFrame(s, tabId, f.data, f.metadata)
        } catch {}
      })
      // 封顶取面板报来的显示尺寸（frameBoxes），CDP 在框内等比缩放——帧就是面板
      // 实际的像素密度。写死上限在高分屏或宽面板上会被放大发虚。
      const box = s.frameBoxes.get(tabId) ?? { ...FRAME_FALLBACK_BOX }
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: FRAME_JPEG_QUALITY,
        maxWidth: box.maxWidth,
        maxHeight: box.maxHeight,
        everyNthFrame: FRAME_EVERY_NTH,
      })
      s.streams.set(tabId, { cdp })
      // 首帧兜底：screencast 只在重绘时推帧，静态页面可能长时间没有首帧（面板
      // 空白）。attach 后立即抓一帧推给面板，之后帧流自然接管。
      try {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: FRAME_JPEG_QUALITY })
        const data = (shot as { data?: string })?.data
        if (data) this._emitFrame(s, tabId, data, null)
      } catch {}
    } catch (error) {
      this._log(`帧流启动失败：${error instanceof Error ? error.message : error}`)
    }
  }

  private async _detachStream(scope: string, tabId: number): Promise<void> {
    const s = this._s(scope)
    const stream = s.streams.get(tabId)
    s.streams.delete(tabId)
    if (!stream) return
    try {
      await stream.cdp.send('Page.stopScreencast')
    } catch {}
    try {
      await stream.cdp.detach()
    } catch {}
  }

  /** 本分区有观察者却缺流时补挂（如 CDP 会话被别处拆了）。页还不存在时
   *  watcherOpen 会直接拒掉，那半边由客户端重开签补，不走这里 */
  private async _resyncStream(scope: string, tabId: number): Promise<void> {
    const s = this._s(scope)
    if (s.streams.has(tabId)) return
    if ((s.frames.get(tabId)?.size ?? 0) > 0) await this._attachStream(scope, tabId)
  }

  /** 面板 URL 栏手动导航（作用于指定页——面板一签一页时就是那张签自己的页；
   *  不给页则落本分区观察页；都不动 agent 活动页；不取快照）。
   *  newPage = 那张签还没有页（从入口开出来的那张）：另开一页，别动别的签正在看的页 */
  async humanOpen(scope: string, url: string, targetId: number | null = null, newPage = false): Promise<{ ok: true; tabId: number; url: string; title: string } | { ok: false; error: string }> {
    return this.navigate(scope, url, { snapshot: false, forHuman: true, targetId, newTab: newPage })
  }

  /** 优雅关闭（面板/协议可调）：context.close() 落盘 cookie 后再走，下次启动免登录 */
  async closeNow(): Promise<{ ok: true }> {
    this._touch()
    await this._closeContext()
    return { ok: true }
  }

  /**
   * 人机共驾输入派发：面板画布的鼠标/滚轮/键盘 → 本分区观察页。
   * 设计约束：不自动拉起浏览器（未运行即拒绝，避免悬停误启动）；事件进顺序队列
   * 串行派发（鼠标移动高频，乱序会拖拽断裂）；坐标由面板按帧原始尺寸换算好。
   */
  async humanInput(scope: string, msg: HumanInputMsg, targetId: number | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this._context) return { ok: false, error: '浏览器未运行' }
    const s = this._s(scope)
    const page = targetId !== null ? s.pages.get(Number(targetId)) ?? null : s.viewId !== null ? s.pages.get(s.viewId) ?? null : null
    if (!page) return { ok: false, error: '无观察页面' }
    const buttonName = (b: number | undefined) => (b === 1 ? 'middle' : b === 2 ? 'right' : 'left')
    const coord = (v: number) => {
      const n = Math.round(Number(v))
      return Number.isFinite(n) ? Math.min(20000, Math.max(0, n)) : 0
    }
    const dispatch = async (): Promise<void> => {
      switch (msg.kind) {
        case 'mousemove':
          await page.mouse.move(coord(msg.x), coord(msg.y))
          break
        case 'mousedown':
          await page.mouse.move(coord(msg.x), coord(msg.y))
          await page.mouse.down({ button: buttonName(msg.button), clickCount: Math.min(3, Math.max(1, Number(msg.clicks) || 1)) })
          break
        case 'mouseup':
          await page.mouse.up({ button: buttonName(msg.button), clickCount: Math.min(3, Math.max(1, Number(msg.clicks) || 1)) })
          break
        case 'wheel':
          await page.mouse.wheel(Math.max(-5000, Math.min(5000, Number(msg.dx) || 0)), Math.max(-5000, Math.min(5000, Number(msg.dy) || 0)))
          break
        case 'key':
          if (typeof msg.combo === 'string' && msg.combo.trim() !== '') {
            await page.keyboard.press(msg.combo.trim())
          }
          break
        case 'text':
          // IME 组合提交的整段文本：insertText 只派发文本输入（无 key 事件），
          // 在远程光标处插入；限长防面板侧异常把宿主当管道灌爆
          if (typeof msg.text === 'string' && msg.text !== '') {
            const text = msg.text.length > 2000 ? msg.text.slice(0, 2000) : msg.text
            await page.keyboard.insertText(text)
          }
          break
        default:
          return
      }
    }
    this._touch(scope)
    // 顺序队列：人手高频输入与 agent 工具动作都走同一 page，乱序会拖拽断裂
    s.inputQueue = s.inputQueue.then(dispatch).catch(() => {})
    return { ok: true }
  }

  /** 关闭浏览器上下文（保 profile）：所有分区一起收 */
  private async _closeContext(): Promise<void> {
    const context = this._context
    if (!context) return
    this._context = null
    // 先摘映射再拆流：_detachStream 开头会 _s(scope) 重建分区，清表在前会让它拿到
    // 一个空壳、s.streams 里根本没有那条流，于是 stopScreencast/detach 一次都不发，
    // 每关一次还留一条空分区。这里反过来——拿着捕获的 s 拆完，最后才清表
    const streams = [...this._scopes.entries()]
    this._unclaimed = []
    this._pendingScopes = []
    for (const [key, s] of streams) {
      for (const tabId of [...s.streams.keys()]) await this._detachStream(key, tabId)
    }
    this._scopes.clear()
    try {
      await context.close()
    } catch {}
    this._emit({ kind: 'closed' })
    this._touch()
  }

  /** 插件卸载：全量清理（幂等） */
  async dispose(): Promise<void> {
    this._disposed = true
    if (this._idleTimer) {
      clearInterval(this._idleTimer)
      this._idleTimer = null
    }
    await this._closeContext()
    try {
      fs.unlinkSync(kitPath('browser-profile', '.pid'))
    } catch {}
    this._listeners.clear()
  }
}
