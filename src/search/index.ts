// dsh-kit 网页搜索组件（宿主半边入口）
//
// 免费引擎链替换 base 层默认钉的官方搜索 provider：seam 接管与 provider 注册见
// ./web-search.ts，引擎实现在 ./engines/。组件行关闭 = 本模块不物化 = 不接管 seam，
// base 钉的官方搜索原样生效——行开关就是这块能力的总开关，切行即时生效。
// 本组件没有配置项：返回条数由宿主的 web_search 定（tool-web 的 searchMaxResults
// 作为 seam 请求的 maxResults 传下来），provider 只按请求给，不另设上限。

import { applyWebSearch } from './web-search.ts'
import { kitLogger } from '../core/log.ts'

const log = kitLogger('search')

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
}

export const name = 'dsh-kit/search'

export async function apply(ctx: KitCtx): Promise<void> {
  applyWebSearch(ctx, { log: (message) => log.warn(message) })
}
