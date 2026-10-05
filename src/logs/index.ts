// dsh-kit 日志组件（宿主半边入口）
//
// 组件行 logs：日志落盘与浏览器半边回传的开关就是这一行的行开关——关行 = 不写
// kit.log、/dsh-kit/logs 端点不物化（404），浏览器半边探针 404 后不装全局钩子、
// 不再上报（页面白屏这类只在浏览器侧的现象就没人收，这是关行的代价）。
// 级别仍由环境变量 DSH_KIT_LOG 裁剪，与行开关不同粒度，不进配置字段。
//
// 写盘闸在 core/log.ts：默认关，本行 apply 时开、注销时关，所以「有没有写盘」
// 与「有没有这一行」是同一件事，不依赖任何组件自己记得判断。

import http from 'node:http'

import { sameOrigin } from '../core/web-guard.ts'
import { kitLogEmit, kitLogStartup, setKitLogFileSink, type KitLogLevel } from '../core/log.ts'

export const name = 'dsh-kit/logs'

interface KitWebCtx {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
    }): () => void
  }
}

// ── 浏览器半边日志回传（POST）──
// 客户端文本是外部可写内容：级别按白名单取，组件名/作用域/消息限长净化，字段只收标量。
const LOG_LEVELS: readonly string[] = ['debug', 'info', 'warn', 'error']
const MAX_CLIENT_ENTRIES = 50
const MAX_MSG = 1000

const clean = (value: unknown, max: number, fallback: string): string =>
  (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '') || fallback

interface ClientLogEntry {
  level?: string
  component?: string
  scope?: string
  msg?: string
  fields?: unknown
}

function readJson(req: http.IncomingMessage, limit = 64 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function clientFields(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 8)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[clean(key, 24, 'f')] = typeof value === 'string' ? clean(value, 200, '') : value
    }
  }
  return Object.keys(out).length ? out : undefined
}

export function apply(ctx: { inject(deps: string[], cb: (svc: KitWebCtx) => void): void; effect(fn: () => void | (() => void), label?: string): void }): void {
  // 闸先开再记启动头：顺序反了这条「宿主半边启动」就永远进不了文件
  setKitLogFileSink(true)
  kitLogStartup()

  const disposers: Array<() => void> = []
  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    // ── 行启用探针：GET /dsh-kit-logs/config，恒回空对象 ──
    // 行禁用 → 本子模块不物化 → 端点 404，client 据此不装钩子、不上报
    disposers.push(
      webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit-logs/config',
        handler: (req, res) => {
          const reply = (code: number, obj: unknown) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'GET') {
            reply(405, { error: 'method not allowed' })
            return
          }
          if (!sameOrigin(req)) {
            reply(403, { error: 'cross-origin denied' })
            return
          }
          reply(200, {})
        },
      }),
    )

    // ── 浏览器半边日志回传：POST /dsh-kit/logs ──
    // 收客户端上报：页面白屏、按钮没反应这类只在浏览器侧的现象，宿主日志一个字都留不下。
    // 查询日志用 pnpm logs / 直接看 kit.log，不另开读端点。
    disposers.push(
      webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/logs',
        handler: (req, res) => {
          const reply = (code: number, obj: unknown): void => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(JSON.stringify(obj))
          }
          if (!sameOrigin(req)) {
            reply(403, { error: 'forbidden' })
            return
          }
          if (req.method !== 'POST') {
            reply(405, { error: 'method not allowed' })
            return
          }
          void readJson(req).then((body) => {
            const list = Array.isArray(body?.entries) ? (body.entries as ClientLogEntry[]).slice(0, MAX_CLIENT_ENTRIES) : []
            for (const item of list) {
              kitLogEmit(
                LOG_LEVELS.includes(item?.level ?? '') ? (item.level as KitLogLevel) : 'info',
                clean(item?.component, 24, 'client'),
                clean(item?.scope, 120, ''),
                clean(item?.msg, MAX_MSG, ''),
                clientFields(item?.fields),
              )
            }
            reply(200, { ok: true })
          }).catch(() => {
            reply(400, { error: 'bad body' })
          })
        },
      }),
    )
  })

  // 行注销 = 撤路由 + 关写盘闸（否则行关了文件还在长）
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    setKitLogFileSink(false)
  })
}
