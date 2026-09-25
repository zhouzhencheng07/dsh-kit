// dsh-kit — DSH 页面能力套件（基础设施行宿主半边）
//
// 本行只有套件自己那点基础设施：vendor 静态资源（xterm / qrcode / 知识库阅读器的
// TipTap 与 KaTeX）、OpenCode Go 会话头注入（./core/opencode-session.ts）。它没有页面
// 能力，所以 patch 里不给 id、不进插件页组件列表（宿主只把带 id 的行当组件）。
// 页面能力本身全部按组件行拆开（cordis.patch.yml 里 insert 八行，行 name = 包名 +
// exports 子路径，行序即插件页显示顺序）：dsh-kit/files（文件树 · 源代码管理）、
// dsh-kit/vault（知识库 · 日程）、dsh-kit/terminal（终端）、dsh-kit/browser（内置浏览器）、
// dsh-kit/skills（技能）、dsh-kit/phone（手机访问）、dsh-kit/monitor（用量与监视）、
// dsh-kit/search（网页搜索）——行关闭 = 该子模块不物化 = 它的端点与 agent 工具一起消失。
// 组件各有自己的 Config（src/<组件>/index.ts）；本行没有可调参数。
//
// 浏览器半边（client/bundle.js）：各功能入口注册在对话输入框工具行
// （conversation.input.left），面板本体挂 shell.overlay 与官方右栏签；组件各自的
// client 面住在 bundle 尾部的 xModule 隔离壳里，激活由根 apply 尾部循环触发。
//
// 本行端点（webserver 默认只绑 loopback）：
//   GET  /dsh-kit/vendor/*          —— xterm / qrcode / richeditor / katex 静态资源

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyOpenCodeSessionHeader } from './core/index.ts'

export const name = 'dsh-kit'

// ── 宿主对象最小依赖面 ──
// cordis ctx / webServer 都是运行时才挂载的宿主组合对象，类型不随插件分发；这里只声明
// 本插件实际触达的成员（与各组件同一约定）。inject 回调的 services 袋按 any 传入。

interface KitCtx {
  inject(deps: string[], cb: (svc: any) => void): void
  effect?(fn: () => void | (() => void), label?: string): void
  /** cordis 事件面（llm/stream 瀑布监听用）；缺失时按会话注入整体降级 */
  on?(event: string, listener: (...args: any[]) => any, options?: unknown): unknown
}

interface KitWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
}

interface KitWebServer {
  register(route: KitWebRoute): () => void
  port: number
}

interface KitWebCtx {
  webServer: KitWebServer
  effect(fn: () => void | (() => void), label?: string): void
}

// vendor 静态资源：白名单文件名 → client/vendor/ 下同名文件
const VENDOR_DIR = fileURLToPath(new URL('../client/vendor/', import.meta.url))
const VENDOR_FILES = new Map([
  ['/dsh-kit/vendor/xterm.js', 'xterm.js'],
  ['/dsh-kit/vendor/addon-fit.js', 'addon-fit.js'],
  ['/dsh-kit/vendor/xterm.css', 'xterm.css'],
  ['/dsh-kit/vendor/qrcode.js', 'qrcode.js'],
  // vault 页面渲染器（TipTap 引擎只读态；懒加载）
  ['/dsh-kit/vendor/richeditor.bundle.js', 'richeditor.bundle.js'],
  // KaTeX 数学公式（vault 阅读态渲染 $...$ / $$...$$；懒加载）
  ['/dsh-kit/vendor/katex.min.js', 'katex.min.js'],
  ['/dsh-kit/vendor/katex.min.css', 'katex.min.css'],
])
const VENDOR_SUBDIRS = new Map([
  // KaTeX 字体：css 里以 fonts/ 相对路径引用，URL 段固定 fonts，磁盘上隔离在
  // katex_fonts/ 免得和未来其他字体混放
  ['fonts', 'katex_fonts'],
])
const VENDOR_TYPES = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
])

export async function apply(ctx: KitCtx): Promise<void> {
  // OpenCode Go 会话头按会话注入（实现见 src/core/opencode-session.ts）
  applyOpenCodeSessionHeader(ctx, (m) => console.warn('dsh-kit: ' + m))

  // webServer 可能在本插件 apply 之后才挂载，用动态注入等它就绪
  ctx.inject(['webServer'], (webCtx: KitWebCtx) => {
    webCtx.effect(() => {
      // ── vendor 静态资源 ──
      const disposeVendor = webCtx.webServer.register({
        kind: 'prefix',
        path: '/dsh-kit/vendor',
        handler: (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://dsh-kit.local').pathname
          const notFound = () => {
            res.writeHead(404)
            res.end()
          }
          // 子目录资源（KaTeX 字体 fonts/*.woff2 等）：单段文件名白名单字符校验，
          // 杜绝路径穿越
          let file: string | null
          const sub = /^\/dsh-kit\/vendor\/(fonts)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname)
          if (sub) {
            file = path.join(VENDOR_SUBDIRS.get(sub[1] ?? '') ?? '', sub[2] ?? '')
          } else {
            file = VENDOR_FILES.get(pathname) ?? null
          }
          if (file === null || (req.method !== 'GET' && req.method !== 'HEAD')) {
            notFound()
            return
          }
          fs.readFile(path.join(VENDOR_DIR, file), (error, body) => {
            if (error) {
              notFound()
              return
            }
            res.writeHead(200, {
              'content-type': VENDOR_TYPES.get(path.extname(file)) ?? 'application/octet-stream',
              'cache-control': 'no-cache',
            })
            res.end(req.method === 'HEAD' ? undefined : body)
          })
        },
      })

      return () => {
        disposeVendor()
      }
    }, 'dsh-kit: vendor endpoints')
  })
}
