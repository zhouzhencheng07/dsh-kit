// dsh-kit 技能组件（宿主半边入口）
//
// 组件化切片：技能管理页的 client 半边在根包 client/bundle.js 的 skillsModule。
// 宿主半边 = 技能池数据端点（实现见 ./skill-pool.ts）+ 行可达性探针（行开关 =
// 唯一开关，GET /dsh-kit-skills/config 恒回空对象）——
// client 拉 200 = 行启用、404（行禁用 → 本子模块不物化）= 不注册设置页。

import http from 'node:http'

import { sameOrigin } from '../core/index.ts'
import { applySkillPool } from './skill-pool.ts'

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect(fn: () => void | (() => void), label?: string): void
}

interface KitWebCtx {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
    }): () => void
  }
}

export const name = 'dsh-kit/skills'

export function apply(ctx: KitCtx): void {
  // skills 注册表是可选增强（归属展示），服务晚于本行就绪也无碍——注入回调捕获引用
  let skillsRegistry: unknown = null
  ctx.inject(['skills'], (skillsCtx: { skills: unknown }) => {
    skillsRegistry = skillsCtx.skills
  })
  applySkillPool(ctx, { getRegistry: () => skillsRegistry })

  const disposers: Array<() => void> = []
  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    // ── 行启用探针：GET /dsh-kit-skills/config，恒回空对象 ──
    // 行禁用 → 本子模块不物化 → 端点 404，client 据此不注册技能设置页
    disposers.push(
      webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit-skills/config',
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
