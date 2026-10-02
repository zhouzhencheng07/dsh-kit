// 读端点的根边界：tree / read / raw 这三个只读端点过去只校验「绝对路径 + 存在」，
// 等于同源代码可读磁盘任意位置（知识库在工作区之外，图片/页读都走它们，限死在
// 工作区会当场打断功能）。这里给一份**根集合**：调用方把「我要读哪儿」的根报上来
// （工作区 cwd 由请求参数带），服务端只放行落在这个集合里的目标。
//
// 集合 = 请求带的 cwd（现求值，别缓存）+ 各组件注册的根（vault / skills…）。
// 组件自己注册（而不是 core 里硬编码路径）：根的归属方才知道自己的根是谁——
// 知识库的根是它配置页里的 vaultRoot，技能池的根在 skills 组件里，注册是它们的职责。
// 根一律 realpath 后再比包含（软链、8.3 短名、Windows 大小写都过这一道）。
import fs from 'node:fs'
import path from 'node:path'

/** 根的提供方：现求值（配置可热改，返回 null/'' = 这个根当前不可用）；入参是请求带的 cwd */
export type ReadableRootProvider = (cwd: string) => string | string[] | null

const providers = new Map<string, ReadableRootProvider>()

/** 注册一个根来源；返回注销函数（组件行关闭/热卸载时用） */
export function registerReadableRoot(id: string, provider: ReadableRootProvider): () => void {
  providers.set(id, provider)
  return () => {
    if (providers.get(id) === provider) providers.delete(id)
  }
}

/** 空串/空白必须先挡掉再 realpath——Windows 上 `realpathSync('')` 不报错，
 *  解析成**进程当前目录**，等于凭一个空参数把 cwd 放进了可读根 */
function realOrNull(p: string): string | null {
  const trimmed = p.trim()
  if (trimmed === '') return null
  try {
    return fs.realpathSync(trimmed)
  } catch {
    return null
  }
}

/** 当前生效的根集合（真实路径；不存在的、被注销的、空串一律剔除） */
export function readableRoots(cwd?: unknown): string[] {
  const out: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return
    const real = realOrNull(value.trim())
    if (real !== null && !out.includes(real)) out.push(real)
  }
  push(typeof cwd === 'string' ? cwd.trim() : '')
  for (const provider of providers.values()) {
    let value: string | string[] | null = null
    try {
      value = provider(typeof cwd === 'string' ? cwd.trim() : '')
    } catch {
      // 单个提供方抛错不拖垮整条链
      continue
    }
    if (Array.isArray(value)) for (const v of value) push(v)
    else push(value)
  }
  return out
}

/** target 是否落在任一根内。默认**根自身不算内**（读端点要的是根下的文件）；
 *  列目录端点把 allowRoot 打开——树根就是 cwd / 库根本身，列它才是入口 */
export function withinReadable(target: string, roots: string[], allowRoot = false): boolean {
  const real = realOrNull(target)
  if (real === null) return false
  for (const root of roots) {
    const rel = path.relative(root, real)
    if (rel === '') {
      if (allowRoot) return true
      continue
    }
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return true
  }
  return false
}