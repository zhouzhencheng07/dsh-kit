// dsh-kit OpenCode Go 会话头兼容（fetch 层镜像，x-opencode-session）
//
// 背景：OpenCode Go 网关（opencode.ai）要求出站推理请求携带 x-opencode-session
// （每会话稳定 ID，用于路由亲和与 prompt 缓存），缺失时 400 MissingSessionID。
// dsh/pi-ai 原生不发该头。方案（v2，范围收敛：只适配 openai-completions 协议）：
//   1. 用户在 OpenCode Go 的 provider profile 里配
//      compat.sendSessionAffinityHeaders=true（+ sessionAffinityFormat:
//      "openai-nosession"）→ pi-ai 每请求自带 x-session-affinity，
//      值 = harness sessionId（每会话稳定，语义正是网关要的）；
//   2. 本模块包装 globalThis.fetch，对 opencode.ai 域名的请求把该头
//      镜像为 x-opencode-session。
//
// 对其他模型/其他域名的对话零影响：域名门控快路径直通（非本网关只付一次
// 子串查找），compat 配置也只加在 OpenCode 那条 profile 上。
// 为什么不包装 pi-ai 导出（v1 方案，已作废）：pi-ai 是纯 ESM（命名空间冻结
// 不可写），且适配层推理走构造期的 provider 实例.stream 而非模块级导出——
// 详见 .agents/docs/opencode-go-session-header.md 的 Plan A 作废记录。
// fetch 是 Web 标准签名，升级鲁棒；失效模式是网关 400 自然暴露而非静默无效。
//
// 让位语义：请求已带 x-opencode-session（用户手配静态头 / dsh 原生支持）→
// 完全不插手；dsh 原生支持落地当天本镜像自动变 no-op，择版删除。
// 生命周期：插件启动时装一次（函数上打标记防重复包装）；开关只作 kill switch
// （每次镜像前实时读设置），默认开——域名门控下对非 OpenCode Go 用户零开销。
// 缓存：镜像只加 HTTP 头，请求体零改动；会话头正是网关做路由亲和/prompt
// 缓存优化的键，值稳定（每会话恒定）只会提升命中，不会破坏。

/** 镜像的目标头（OpenCode Go 网关要求） */
const TARGET_HEADER = 'x-opencode-session'
/** 亲和头（openai-completions 协议 openai-nosession 格式所发，值=harness sessionId） */
const AFFINITY_HEADER = 'x-session-affinity'
/** 快路径预筛子串：进程内绝大多数 fetch 一次 includes 即放行 */
const HOST_SUBSTRING = 'opencode.ai'

/** opencode.ai 及其子域（大小写不敏感；其余域名一律不插手） */
export function matchGatewayHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === HOST_SUBSTRING || host.endsWith(`.${HOST_SUBSTRING}`)
}

/** 从请求头取会话亲和值；没有返回 null */
export function resolveAffinityValue(headers: Headers): string | null {
  const value = headers.get(AFFINITY_HEADER)
  return value !== null && value.trim() !== '' ? value : null
}

/**
 * 往一组请求头里补 x-opencode-session。返回是否真的补了（测试与包装层共用）。
 * 幂等让位：目标头已存在 → false；无亲和值 → false（让 400 自然暴露，
 * 不静默造值——造值会破坏按会话路由的语义）。
 */
export function mirrorSessionHeader(headers: Headers, isDisabled?: () => boolean): boolean {
  if (isDisabled?.() === true) return false
  if (headers.has(TARGET_HEADER)) return false
  const value = resolveAffinityValue(headers)
  if (value === null) return false
  headers.set(TARGET_HEADER, value)
  return true
}

export interface MirrorInstallOptions {
  /** kill switch：返回 true 时镜像整体不生效（每次请求实时读） */
  isDisabled?: () => boolean
  /** 安装/首次镜像的痕迹日志 */
  log?: (msg: string) => void
}

/** 给包装函数打的标记：插件重载时防止二次包装 */
const MIRROR_MARK = '__dshKitOpenCodeSessionMirror'

/**
 * 包装 globalThis.fetch，对 opencode.ai 请求镜像会话头。已安装过直接返回 true。
 * 永不抛错：URL 解析失败、头构造异常等一律放行原请求——绝不弄崩宿主推理。
 */
export function installOpenCodeSessionMirror(options: MirrorInstallOptions = {}): boolean {
  const log = options.log ?? (() => {})
  const real = (globalThis as { fetch?: unknown }).fetch
  if (typeof real !== 'function') {
    log('全局 fetch 不可用，x-opencode-session 镜像未安装')
    return false
  }
  const realFetch = real as typeof globalThis.fetch & { [MIRROR_MARK]?: boolean }
  if (realFetch[MIRROR_MARK] === true) return true

  const wrapped = async (input: unknown, init?: unknown): Promise<unknown> => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : typeof (input as Request | undefined)?.url === 'string'
              ? (input as Request).url
              : null
      // 快路径：非本网关的请求（进程内绝大多数 fetch）一次子串查找即放行
      if (url === null || !url.includes(HOST_SUBSTRING)) {
        return realFetch(input as string | URL | Request, init as RequestInit | undefined)
      }
      if (matchGatewayHost(new URL(url).hostname)) {
        const headers = new Headers(
          (init as RequestInit | undefined)?.headers ?? (typeof input === 'object' && input !== null && 'headers' in (input as object) ? (input as Request).headers : undefined),
        )
        if (mirrorSessionHeader(headers, options.isDisabled)) {
          log(`已镜像 ${TARGET_HEADER}（${headers.get(TARGET_HEADER)?.slice(0, 8)}…）`)
          const nextInit: RequestInit = { ...(init as RequestInit | undefined), headers }
          return await realFetch(input instanceof Request ? new Request(input as Request, nextInit) : (input as string | URL), nextInit)
        }
      }
    } catch {
      // 镜像路径的任何异常都放行原请求
    }
    return realFetch(input as string | URL | Request, init as RequestInit | undefined)
  }
  ;(wrapped as { [MIRROR_MARK]?: boolean })[MIRROR_MARK] = true
  ;(globalThis as { fetch: unknown }).fetch = wrapped
  log('已安装 x-opencode-session fetch 镜像（opencode.ai 域名门控，幂等让位）')
  return true
}
