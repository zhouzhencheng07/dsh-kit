// dsh-kit 网页搜索组件（宿主半边入口）
//
// 免费引擎链替换 base 层钉的付费 deepseek-official：seam 接管与 provider 注册见
// ./web-search.ts，引擎实现在 ./engines/。组件行关闭 = 本模块不物化 = 不接管 seam，
// base 钉的官方搜索原样生效——行开关就是这块能力的总开关，切行即时生效。
// 唯一配置项 searchMaxResults 是本组件自己的 Config，编辑面在插件页本组件行的
// 「配置」（client 半边同 bundle 内的 search 组件模块注册）。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { applyWebSearch } from './web-search.ts'

/** 插件设置的运行时形状（loader 按 Config schema 解析后传入 apply 第二参） */
type KitSettings = Record<string, unknown>

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
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

const require = createRequire(import.meta.url)

export const name = 'dsh-kit/search'

// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用后每次现读。
const schemastery = loadDep('@deepseek-ai/schemastery')
const z = (schemastery?.default ?? schemastery ?? null) as any

export const Config =
  z && typeof z.object === 'function'
    ? z.object({
        // 单次搜索返回的来源条数上限（1-8，默认 2）。provider 每次现读、改完即生效；
        // 条数越多上下文消耗越大。
        searchMaxResults: z.number().step(1).min(1).max(8).default(2).volatile(),
      })
    : undefined

export async function apply(ctx: KitCtx, config: KitSettings = {}): Promise<void> {
  const defaults: KitSettings = Config ? Config({}) : { searchMaxResults: 2 }
  // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
  const readRef = (v: unknown): any =>
    v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function'
      ? (v as { get: () => unknown }).get()
      : v
  const readSettings = (): any => {
    const out: Record<string, unknown> = { ...defaults }
    for (const [key, value] of Object.entries(config ?? {})) out[key] = readRef(value)
    return out
  }
  applyWebSearch(ctx, {
    getMaxResults: () => readSettings().searchMaxResults,
    log: (message) => console.warn(`dsh-kit: ${message}`),
  })
}
