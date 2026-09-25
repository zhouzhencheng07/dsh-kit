// dsh-kit 终端组件（宿主半边入口）
//
// 组件化切片：终端入口与底部多标签终端坞的 client 半边在根包 client/bundle.js 的
// terminalModule；宿主半边只留一处职责：GET /dsh-kit-terminal/config 可达性探针——
// 终端没有独立配置字段（行开关 = 唯一开关），client 拉它 200 = 行启用、404（行禁用
// 子模块不物化）= 隐藏入口并收场。xterm 静态资源走主包 /dsh-kit/vendor 白名单。

import http from 'node:http'

import { sameOrigin } from '../core/index.ts'

interface KitWebCtx {
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void> }): () => void }
}

export const name = 'dsh-kit/terminal'

export function apply(ctx: { inject(deps: string[], cb: (svc: KitWebCtx) => void): void; effect(fn: () => void | (() => void), label?: string): void }): void {
  const disposers: Array<() => void> = []
  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    // ── 行启用探针：GET /dsh-kit-terminal/config，恒回空对象 ──
    // 行禁用 → 本子模块不物化 → 端点 404，client 据此隐藏入口并结束会话
    disposers.push(
      webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit-terminal/config',
        handler: (req, res) => {
          const json = (code: number, obj: unknown) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'GET') {
            json(405, { error: 'method not allowed' })
            return
          }
          if (typeof req.headers.origin === 'string' && req.headers.origin !== '' && !sameOrigin(req)) {
            json(403, { error: 'cross-origin denied' })
            return
          }
          json(200, {})
        },
      }),
    )
  })

  // entry 注销时撤路由（disposers 由注入回调在 apply 期间同步填充）
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
