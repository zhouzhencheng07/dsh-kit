// vendor 静态资源路由：白名单里的每个文件注册一条 exact 路由，资源归**用它的组件行**伺服。
//
// 归属跟着行走：终端行关 = 连 xterm 的 js / css 都没有，知识库行关 = pdf.js / katex /
// mermaid 都没有。URL 一律 /dsh-kit/vendor/<文件名>（KaTeX 字体走 fonts/ 前缀路由），
// 浏览器半边只按 URL 取，不因归属变化而改。
//
// 不做成一条 /dsh-kit/vendor 前缀路由的原因：前缀路由抢路径，先注册的那条会把不在自己
// 白名单里的请求打成 404（同宿主多行注册同一前缀 = 后面的组件拿不到资源）。逐文件 exact
// 互不覆盖，也就不依赖宿主对重复路径的处理方式。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// client/vendor/ 在本文件上两级（src/core 与 dist/core 同深度），不改相对层级
const VENDOR_DIR = fileURLToPath(new URL('../../client/vendor/', import.meta.url))

const VENDOR_TYPES = new Map<string, string>([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
])

export interface KitVendorWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
  }): () => void
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404)
  res.end()
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    notFound(res)
    return
  }
  fs.readFile(path.join(VENDOR_DIR, file), (error, body) => {
    if (error) {
      notFound(res)
      return
    }
    res.writeHead(200, {
      'content-type': VENDOR_TYPES.get(path.extname(file)) ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
}

/**
 * 逐文件 exact 路由。files = URL 路径 → client/vendor/ 下的文件名（如
 * '/dsh-kit/vendor/xterm.js' → 'xterm.js'）；URL 不在表里就 404，天然挡路径穿越。
 */
export function registerVendorFiles(
  webServer: KitVendorWebServer,
  files: ReadonlyMap<string, string>,
): () => void {
  const disposers: Array<() => void> = []
  for (const [url, file] of files) {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: url,
        handler: (req, res) => {
          serveFile(req, res, file)
        },
      }),
    )
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * 子目录资源的前缀路由（KaTeX 的 css 以 fonts/ 相对路径引用字体，URL 段固定）：
 * 前缀之外的段只认单段文件名与白名单字符，杜绝穿越。
 */
export function registerVendorSubdir(
  webServer: KitVendorWebServer,
  urlPrefix: string,
  diskDir: string,
): () => void {
  const one = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
  return webServer.register({
    kind: 'prefix',
    path: urlPrefix,
    handler: (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://dsh-kit.local').pathname
      const rest = pathname.slice(urlPrefix.length + 1)
      if (!one.test(rest)) {
        notFound(res)
        return
      }
      serveFile(req, res, path.join(diskDir, rest))
    },
  })
}
