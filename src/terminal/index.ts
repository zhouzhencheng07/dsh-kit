// dsh-kit 终端组件（宿主半边入口）
//
// 组件化切片：终端入口与底部多标签终端坞从 dsh-kit 主包迁出，独立成 entry
// （bundle patch 插单，profile 里行 id: terminal）。PTY 全归官方 webTerminals 服务
// （会话工作区绑定、刷新保活、后台清理都是宿主的），所以宿主半边只留一处职责：
// GET /dsh-kit-terminal/config 只读配置快照——client 半边的入口门控与快捷键真源。
// xterm 的静态资源仍走主包 /dsh-kit/vendor 白名单（静态口是套件共用的，不按组件拆）。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { sameOrigin } from '../core/index.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitWebCtx {
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => void | Promise<void> }): () => void }
}

/**
 * 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录），loadDep 的
 * 第三锚点用。非 DSH 环境返回 null。
 */
function findMonorepoRoot(): string | null {
  const anchor = process.argv[1]
  if (!anchor) return null
  const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor)
  let dir = path.dirname(abs)
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 多锚点加载宿主运行时依赖（schemastery，不在本包 dependencies 里），同主包口径 */
function loadDep(spec: string): any {
  try {
    return require(spec)
  } catch {
    // 落到后续锚点
  }
  const anchor = process.argv[1]
  if (anchor) {
    const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor)
    try {
      return createRequire(abs)(spec)
    } catch {
      // 落到 monorepo store
    }
  }
  const root = findMonorepoRoot()
  if (root) {
    const pnpm = path.join(root, 'node_modules', '.pnpm')
    if (fs.existsSync(pnpm)) {
      let entries: string[] = []
      try {
        entries = fs.readdirSync(pnpm)
      } catch {
        /* ignore */
      }
      for (const e of entries) {
        if (!(e === spec + '@' || e.startsWith(spec + '@'))) continue
        const pkgJson = path.join(pnpm, e, 'node_modules', spec, 'package.json')
        if (!fs.existsSync(pkgJson)) continue
        try {
          return createRequire(pkgJson)(spec)
        } catch {
          // 试下一个候选版本
        }
      }
    }
  }
  return null
}

// ── 组件设置 schema（0.1.7 声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用。默认值与
// client 半边 T_CFG_DEFAULTS 逐项同值（两处不同步会出现默认值漂移）。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // 终端总开关：关 = 输入行不出终端入口、已有会话全部结束（纯浏览器端消费，
        // 宿主不读）。键位不在这里——终端命令在 client 半边注册进宿主 shortcuts 服务。
        terminalEnabled: z.boolean().default(true).volatile(),
      })
    : undefined

export const name = 'dsh-kit-terminal'

export function apply(ctx: { inject(deps: string[], cb: (svc: KitWebCtx) => void): void; effect(fn: () => void | (() => void), label?: string): void }, config: KitSettings = {}): void {
  // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
  const defaults: KitSettings = Config ? Config({}) : { terminalEnabled: true }
  const readRef = (v: unknown): any =>
    v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function'
      ? (v as { get: () => unknown }).get()
      : v
  const readSettings = (): any => {
    const out: Record<string, unknown> = { ...defaults }
    for (const [key, value] of Object.entries(config ?? {})) out[key] = readRef(value)
    return out
  }

  const disposers: Array<() => void> = []
  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    // ── 组件配置快照端点：GET /dsh-kit-terminal/config ──
    // client 半边拉它做入口门控与快捷键（同 root 的 /dsh-kit/config 口径）
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
          json(200, readSettings())
        },
      }),
    )
  })

  // entry 注销时撤路由（disposers 由注入回调在 apply 期间同步填充）
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
