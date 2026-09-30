// dsh-kit 组件入口共用的宿主运行时依赖加载（schemastery / ws 这类不在本包
// dependencies 里，按宿主 profile 的 node_modules 解析）。
//
// 三锚点：本模块 require（dev 目录直装时命中工作区）→ dsh 本体锚点（process.argv[1]，
// profile / 全局安装都命中）→ monorepo 的 .pnpm 目录扫描（源码形态兜底）。
// 六个组件入口原本各抄一份，其中两份漏了模块级 require 绑定——ESM 里裸 require 是
// ReferenceError，被 catch 吞掉后第一锚点等于不存在；这里只留一份。
//
// 认不出就回 null，由各组件按「宿主依赖不可达」降级。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录）；非 DSH 环境返回 null */
export function findMonorepoRoot(): string | null {
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

/** 多锚点加载宿主运行时依赖；不可达返回 null */
export function loadDep(spec: string): any {
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
      // .pnpm 目录名把 scope 的 / 编码成 +（@scope+name@ver）：不换算 scoped 包永不命中
      const flat = spec.startsWith('@') ? spec.replace('/', '+') : spec
      for (const e of entries) {
        if (e !== flat + '@' && !e.startsWith(flat + '@')) continue
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
