// dsh-kit 宿主半边日志：只写控制台，不落盘。
// 组件半边一律经 kitLogger('<组件>') 打，代码里不再直接 console。
//
// 一行一事：时间 级别 组件 [作用域] "消息" key=value…；级别走环境变量 DSH_KIT_LOG
// （off/error/warn/info/debug，默认 warn——info/debug 只在排查时打开）。
// op() 作用域内的每一行自动带作用域路径，失败那行自己说清「当时在做什么」。

import { AsyncLocalStorage } from 'node:async_hooks'

export type KitLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface KitLogEntry {
  ts: number
  level: KitLogLevel
  component: string
  /** op() 作用域路径，`a>b` 表示嵌在 a 里；空 = 不在作用域内 */
  scope: string
  msg: string
  fields?: Record<string, unknown>
}

export interface KitLogger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  /** 在 op() 作用域内跑 fn：作用域内日志自动带作用域路径，fn 结束补一条结果行。
   *  fn 返回 Promise 时结果行在 settle 后补写，rejection 照原样抛给调用方。 */
  op<T>(name: string, fn: () => T, fields?: Record<string, unknown>): T
}

const LEVELS: readonly string[] = ['error', 'warn', 'info', 'debug']
const RANK: Record<KitLogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const FIELD_MAX = 200

const rawLevel = (process.env.DSH_KIT_LOG ?? '').trim().toLowerCase()
const LEVEL: KitLogLevel | 'off' = rawLevel === 'off' || rawLevel === 'none' || rawLevel === 'silent'
  ? 'off'
  : LEVELS.includes(rawLevel) ? (rawLevel as KitLogLevel) : 'warn'

const scopes = new AsyncLocalStorage<string>()

function stamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function quoted(text: string): string {
  return /[\s"=]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

/** 消息一律加引号：行内固定「组件 [作用域] "消息"」的形状，人读不歧义 */
function msgText(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Error) return quoted(`${value.name}: ${value.message}`)
  if (typeof value === 'string') return quoted(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    const json = JSON.stringify(value) ?? String(value)
    return quoted(json.length > FIELD_MAX ? json.slice(0, FIELD_MAX) + '…' : json)
  } catch {
    return quoted(String(value))
  }
}

/** 一行一事：时间 级别 组件 [作用域] "消息" key=value…；错误附带的 stack 缩进跟在后面 */
function kitLogFormat(entry: KitLogEntry): string {
  const head = [stamp(entry.ts), entry.level.toUpperCase().padEnd(5), entry.component]
  if (entry.scope) head.push(entry.scope)
  head.push(msgText(entry.msg))
  for (const [key, value] of Object.entries(entry.fields ?? {})) {
    head.push(`${key}=${fieldText(value)}`)
  }
  let text = head.join(' ')
  for (const value of Object.values(entry.fields ?? {})) {
    if (value instanceof Error && value.stack) {
      // stack 首行就是 err= 里已有的 "Error: msg"，只补后面的调用帧（帧自带缩进，先去掉再统一补）
      const frames = value.stack.split(/\r?\n/).slice(1)
      if (frames.length > 0) text += '\n' + frames.map(line => '    ' + line.trimStart()).join('\n')
    }
  }
  return text
}

function emit(level: KitLogLevel, component: string, scope: string, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL === 'off' || RANK[level] > RANK[LEVEL]) return
  const line = kitLogFormat({ ts: Date.now(), level, component, scope, msg, fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (level === 'info') console.info(line)
  else console.debug(line)
}

/** 取组件自己的 logger。component 只用组件名（files/vault/…），作用域名另由 op 给 */
export function kitLogger(component: string): KitLogger {
  const scope = (): string => scopes.getStore() ?? ''
  const call = (level: KitLogLevel) => (msg: string, fields?: Record<string, unknown>): void => {
    emit(level, component, scope(), msg, fields)
  }
  return {
    debug: call('debug'),
    info: call('info'),
    warn: call('warn'),
    error: call('error'),
    op<T>(name: string, fn: () => T, fields?: Record<string, unknown>): T {
      const started = Date.now()
      const done = (ok: boolean, error?: unknown): void => {
        emit(
          ok ? 'info' : 'error',
          component,
          scope(),
          `${name} ${ok ? 'ok' : '失败'}`,
          { ...fields, dur: `${Date.now() - started}ms`, ...(ok ? {} : { err: error }) },
        )
      }
      return scopes.run(scopes.getStore() ? `${scopes.getStore()}>${name}` : name, () => {
        try {
          const out = fn()
          if (out && typeof (out as { then?: unknown }).then === 'function') {
            return (out as unknown as Promise<unknown>).then(
              (value) => {
                done(true)
                return value
              },
              (error) => {
                done(false, error)
                throw error
              },
            ) as unknown as T
          }
          done(true)
          return out
        } catch (error) {
          done(false, error)
          throw error
        }
      })
    },
  }
}
