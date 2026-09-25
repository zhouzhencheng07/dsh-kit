// dsh-kit 组件间共享的宿主侧工具库：@deepseek-ai/dsh-tools 的类型契约与加载。
//
// 浏览器与日程两组工具各自装配（buildBrowserTools / buildScheduleTools），共用这一份
// defineTool 契约与模块加载。dsh-tools 是 ESM（type: module），加载走两锚点：裸
// import → dsh 本体锚点 resolve+import（profile/全局安装都命中）；monorepo 源码形态
// 跳过（dev 环境是 npm 全局布局，bin 锚点已覆盖）。

import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** 工具定义的结构契约（dsh-tools 的 defineTool 产物按名字注入注册表） */
export interface ToolDefinition {
  name: string
  [key: string]: unknown
}

export interface DefineToolOptions {
  name: string
  description: string
  parameters: Record<string, { type: string; required?: boolean; enum?: string[]; description?: string }>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: any) => Array<Record<string, unknown>>
  }
  timeoutMs?: number
  /** 原生呈现卡（宿主 dsh-tools 同名约定）：工具调用行的标题/类别，纯函数只读 args */
  presentCall?: (args: any) => { card: 'generic'; title: string; kind?: string; rawInput?: unknown } | undefined
  /** exec 的执行面由各工具的调用方具化（本契约按 unknown 收） */
  execute: (args: any, exec?: any) => Promise<unknown>
}

export type DefineTool = (options: DefineToolOptions) => ToolDefinition

/** 异步两锚点加载 @deepseek-ai/dsh-tools（ESM）。失败返回 null。 */
export async function loadToolsModule(log: (msg: string) => void = () => {}): Promise<any> {
  try {
    return await import('@deepseek-ai/dsh-tools')
  } catch {
    // 落到 dsh 本体锚点
  }
  const anchor = process.argv[1]
  if (anchor) {
    try {
      const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor)
      const resolved = createRequire(abs).resolve('@deepseek-ai/dsh-tools')
      if (resolved) return await import(pathToFileURL(resolved).href)
    } catch {
      // 都失败
    }
  }
  log('dsh-kit: @deepseek-ai/dsh-tools 不可达，工具未注册（其余功能不受影响）')
  return null
}
