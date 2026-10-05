// core/vendor-route 单测：逐文件 exact 路由 + 子目录前缀路由（KaTeX 字体）。
// 判据是「谁能伺服什么」与路径穿越这两件事——路由归各组件行注册后，白名单就是唯一的闸。
// 用法（dsh-kit 根）：node tests\test-vendor-route.mjs
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE = pathToFileURL(path.resolve('src/core/vendor-route.ts')).href
const { registerVendorFiles, registerVendorSubdir } = await import(MODULE)

let failed = 0
const check = (label, cond) => {
  console.log(`${cond ? 'PASS  ' : 'FAIL  '}${label}`)
  if (!cond) failed++
}

// 假 webServer：把注册收进表里，handler 可直接调用
const routes = []
const removed = []
const webServer = {
  register: (route) => { routes.push(route); return () => { removed.push(route.path) } },
}

/** 造一个假请求/回应，调用 handler 后返回 { status, type, bytes } */
const call = async (route, url, method = 'GET') => {
  let status = 0
  let type = ''
  let bytes = 0
  await route.handler(
    { method, url, headers: {} },
    {
      writeHead: (code, headers = {}) => { status = code; type = String(headers['content-type'] ?? '') },
      end: (body) => { bytes = body === undefined ? 0 : Buffer.byteLength(String(body)) },
    },
  )
  // 静态资源是异步 fs 读：轮询到有回应为止（不靠猜睡几拍）
  for (let i = 0; i < 400 && status === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  return { status, type, bytes }
}

// 1) 逐文件 exact：表里的文件回 200 + 正确 content-type，表外的 URL 一律 404
const disposeFiles = registerVendorFiles(webServer, new Map([
  ['/dsh-kit/vendor/xterm.js', 'xterm.js'],
  ['/dsh-kit/vendor/pdf.min.mjs', 'pdf.min.mjs'],
]))
check('每个文件一条 exact 路由', routes.length === 2 && routes.every((r) => r.kind === 'exact'))
check('js 与 mjs 都是可执行脚本类型', (await call(routes[0], '/dsh-kit/vendor/xterm.js')).type.startsWith('text/javascript') && (await call(routes[1], '/dsh-kit/vendor/pdf.min.mjs')).type.startsWith('text/javascript'))
const hit = await call(routes[0], '/dsh-kit/vendor/xterm.js')
check('白名单里的文件真取到字节', hit.status === 200 && hit.bytes > 1000)
check('HEAD 也放行（不返体）', (await call(routes[0], '/dsh-kit/vendor/xterm.js', 'HEAD')).status === 200)
check('非 GET/HEAD 一律 404', (await call(routes[0], '/dsh-kit/vendor/xterm.js', 'POST')).status === 404)
check('撤路由后不再留在表里', (disposeFiles(), removed.length === 2))

// 2) 子目录前缀（KaTeX 字体）：单段白名单字符放行，穿越与多段一律 404
const disposeFonts = registerVendorSubdir(webServer, '/dsh-kit/vendor/fonts', 'katex_fonts')
const fonts = routes[routes.length - 1]
check('字体走一条前缀路由', fonts.kind === 'prefix' && fonts.path === '/dsh-kit/vendor/fonts')
const font = await call(fonts, '/dsh-kit/vendor/fonts/KaTeX_AMS-Regular.woff2')
check('字体文件取到且是 font/woff2', font.status === 200 && font.type === 'font/woff2' && font.bytes > 0)
check('目录穿越 404（.. 不放行）', (await call(fonts, '/dsh-kit/vendor/fonts/../xterm.js')).status === 404)
check('多段路径 404', (await call(fonts, '/dsh-kit/vendor/fonts/a/b.woff2')).status === 404)
check('缺文件名 404', (await call(fonts, '/dsh-kit/vendor/fonts/')).status === 404)
check('不存在的字体 404', (await call(fonts, '/dsh-kit/vendor/fonts/nope.woff2')).status === 404)
check('撤路由', (disposeFonts(), removed.length === 3))

// 3) 表里没有的资源不会被伺服（谁的资源归谁：表里没有 = 404）
check('表外的资源 URL 不会被这两条路由命中', routes.filter((r) => r.path === '/dsh-kit/vendor/qrcode.js').length === 0)

console.log(failed === 0 ? '全部通过' : failed + ' 项失败')
process.exit(failed === 0 ? 0 : 1)
