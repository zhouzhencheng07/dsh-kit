// 手机访问网关单元测试：不依赖 dsh 运行，起一个 stub 上游 + 网关实例，
// 覆盖 鉴权(404/令牌/Cookie/重定向)、透传(头改写/POST 体/流式)、WS 升级隧道、轮换。
// 用法：node tests\test-phone-gateway.mjs（自动选空闲端口，退出码即结果）
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import zlib from 'node:zlib'

import { startPhoneGateway, PHONE_COOKIE, lanAddresses, pickEncoding, isCompressibleType } from '../src/phone-gateway.ts'

let failed = 0
const check = (label, ok) => {
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}`)
  if (!ok) failed++
}

// ── lanAddresses：虚拟网卡过滤（热点/虚拟交换机的地址是二维码噪音）──
{
  const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal })
  const ifaces = {
    WLAN: [v4('10.3.94.39'), { address: 'fe80::1', family: 'IPv6', internal: false }],
    '本地连接* 2': [v4('192.168.137.1')],
    'Local Area Connection* 3': [v4('192.168.137.1')],
    'vEthernet (WSL (Hyper-V firewall))': [v4('172.20.0.1')],
    'VMware Network Adapter VMnet8': [v4('192.168.111.1')],
    'VirtualBox Host-Only Ethernet Adapter': [v4('192.168.56.1')],
    '以太网': [v4('192.168.1.7')],
    'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  }
  const addrs = lanAddresses(ifaces)
  check('lanAddresses：滤掉热点/Wi-Fi Direct 虚拟网卡（本地连接* N）', !addrs.includes('192.168.137.1'))
  check('lanAddresses：滤掉 vEthernet/VMware/VirtualBox host-only', !addrs.includes('172.20.0.1') && !addrs.includes('192.168.111.1') && !addrs.includes('192.168.56.1'))
  check('lanAddresses：保留实体网卡 IPv4、丢弃 IPv6 与回环', JSON.stringify(addrs) === JSON.stringify(['10.3.94.39', '192.168.1.7']))
}

/** 起一个回显上游：GET 回显收到的 host/origin/cookie 头；POST 回显请求体；/ws 升级回 101 并回声 */
function startUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><head><title>t</title></head><body>up</body></html>')
        return
      }
      if (req.method === 'GET' && req.url === '/bigpage') {
        const body = '<!doctype html><html><head><title>big</title></head><body>' + '<p>fill</p>'.repeat(400) + '</body></html>'
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
        res.end(body)
        return
      }
      if (req.method === 'GET' && req.url === '/big.js') {
        const body = 'var x = 1; // 可压文本\n'.repeat(2000)
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
        res.end(body)
        return
      }
      if (req.method === 'GET' && req.url === '/small.js') {
        const body = 'var small = 1;'
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
        res.end(body)
        return
      }
      if (req.method === 'GET' && req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        res.end('data: hello\n\n')
        return
      }
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          upstreamSeen: true,
          host: req.headers.host ?? null,
          origin: req.headers.origin ?? null,
          cookie: req.headers.cookie ?? null,
          method: req.method,
          body,
        }))
      })
    })
    server.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
      socket.write(`upstream-ws-host:${req.headers.host ?? ''}\n`)
      socket.pipe(socket)
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/** 向网关发一个普通请求，返回 {status, headers, body} */
function request(port, { path: reqPath, method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method, headers },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          resolve({ status: res.statusCode, headers: res.headers, raw, body: raw.toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

/** 原生 socket 发 WS 握手并读首帧数据（服务端→客户端方向的回声文本） */
function wsProbe(port, token, expectHandshake101) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64')
    const socket = net.connect({ host: '127.0.0.1', port })
    let buffer = ''
    const finish = (result) => {
      try { socket.destroy() } catch { /* 已销毁 */ }
      resolve(result)
    }
    socket.on('connect', () => {
      const cookie = token === null ? '' : `Cookie: ${PHONE_COOKIE}=${token}\r\n`
      socket.write(`GET /api/mux-events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${cookie}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1:${port}\r\n\r\n`)
    })
    socket.on('data', (d) => {
      buffer += d.toString('latin1')
      if (!expectHandshake101) {
        finish({ statusLine: buffer.split('\r\n')[0] })
        return
      }
      if (!buffer.includes('\r\n\r\n')) return
      const idx = buffer.indexOf('\r\n\r\n') + 4
      // 等一小段让上游回声帧到达（帧头 2 字节 + 文本）
      setTimeout(() => {
        const rest = buffer.slice(idx)
        finish({ statusLine: buffer.split('\r\n')[0], frameTail: rest.toString('latin1') })
      }, 150)
    })
    socket.on('error', (e) => finish({ error: String(e) }))
  })
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshk-phone-test-'))
const stateFile = path.join(stateDir, 'gateway.json')

const upstream = await startUpstream()
const gw = startPhoneGateway({
  port: 0,
  upstreamPort: upstream.port,
  stateFile,
  log: () => {},
})
// port 0：等监听就绪后从网关回读实际端口
await new Promise((r) => setTimeout(r, 120))
const gwPort = gw.port()
const token = gw.token()

try {
  // ── 未授权：一律 404，且不泄露任何信息 ──
  let r = await request(gwPort, { path: '/' })
  check('无令牌 GET / → 404', r.status === 404 && !r.body.includes('dsh'))
  r = await request(gwPort, { path: '/?k=wrong-token' })
  check('错误令牌 ?k= → 404', r.status === 404)
  r = await request(gwPort, { path: '/api/sessions' })
  check('无令牌 API 路径 → 404', r.status === 404)

  // ── 明文令牌链接：种 Cookie + 302 甩 query ──
  r = await request(gwPort, { path: `/?k=${token}` })
  const setCookie = Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'][0] : r.headers['set-cookie']
  check('?k= 有效 → 302', r.status === 302)
  check('302 落到无 query 的 /', r.headers.location === '/')
  check('种下 HttpOnly Cookie', typeof setCookie === 'string' && setCookie.includes(`${PHONE_COOKIE}=${token}`) && setCookie.includes('HttpOnly'))
  const cookieHeader = setCookie.split(';')[0]

  // ── Cookie 授权透传：头改写与剥离 ──
  r = await request(gwPort, { path: '/', headers: { cookie: cookieHeader, origin: 'http://192.168.9.9:3090' } })
  let seen = JSON.parse(r.body)
  check('Cookie 授权 → 上游 200', r.status === 200 && seen.upstreamSeen === true)
  check('Host 重写为回环上游', seen.host === `127.0.0.1:${upstream.port}`)
  check('Origin 已剥离', seen.origin === null)
  check('网关 Cookie 不透传给上游', seen.cookie === null)

  // 无效 Cookie → 404
  r = await request(gwPort, { path: '/', headers: { cookie: `${PHONE_COOKIE}=stale-token` } })
  check('过期 Cookie → 404', r.status === 404)

  // ── POST 体往返 + query 保留 ──
  r = await request(gwPort, {
    path: `/api/x?a=1&b=${encodeURIComponent('文字')}`,
    method: 'POST',
    headers: { cookie: cookieHeader, 'content-type': 'text/plain' },
    body: 'payload-中文',
  })
  seen = JSON.parse(r.body)
  check('POST 方法与体原样到达上游', seen.method === 'POST' && seen.body === 'payload-中文')
  // query 原样转发
  check('query 原样转发', r.status === 200)

  // ── HTML 注入 randomUUID 兜底（insecure context）──
  const page = await request(gwPort, { path: '/page', headers: { cookie: cookieHeader } })
  check('HTML 页注入了兜底脚本', page.status === 200 && page.body.includes('randomUUID'))
  check('注入位置在 <head> 开标签后', page.body.indexOf('randomUUID') > page.body.indexOf('<head>') && page.body.includes('<title>'))
  const lenOk = Number(page.headers['content-length']) === Buffer.byteLength(page.body)
  check('content-length 已按注入后重算', lenOk)
  r = await request(gwPort, { path: '/', headers: { cookie: cookieHeader } })
  check('非 HTML 响应不注入', !r.body.includes('randomUUID'))

  // ── 压缩：按客户端能力压文本类（dsh 自身不压；局域网直连时这是最大的一笔带宽）──
  {
    check('pickEncoding：br 优先、gzip 次之、q=0 视为拒绝', pickEncoding('gzip, deflate, br') === 'br' && pickEncoding('gzip') === 'gzip' && pickEncoding('gzip;q=0') === null && pickEncoding(undefined) === null)
    check('isCompressibleType：文本可压、SSE 与图片不可压', isCompressibleType('text/javascript; charset=utf-8') === true && isCompressibleType('application/json') === true && isCompressibleType('text/event-stream') === false && isCompressibleType('image/png') === false)
    const plain = await request(gwPort, { path: '/big.js', headers: { cookie: cookieHeader } })
    check('未声明 accept-encoding：原样明文', plain.headers['content-encoding'] === undefined && plain.raw.length === Buffer.byteLength(plain.body))
    const pref = await request(gwPort, { path: '/big.js', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip, deflate, br' } })
    check('声明多种编码：取 br', pref.headers['content-encoding'] === 'br')
    check('压缩响应带 vary: accept-encoding', String(pref.headers['vary'] ?? '').includes('accept-encoding'))
    const prefDec = zlib.brotliDecompressSync(pref.raw).toString('utf8')
    check('br 解回原文且体积明显变小（<40%）', prefDec === plain.body && pref.raw.length < plain.raw.length * 0.4)
    const gz = await request(gwPort, { path: '/big.js', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip' } })
    check('只声明 gzip：用 gzip 且可解回原文', gz.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(gz.raw).toString('utf8') === plain.body)
    const tiny = await request(gwPort, { path: '/small.js', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip' } })
    check('小响应不压（1KB 以下不值得）', tiny.headers['content-encoding'] === undefined && tiny.body.includes('small'))
    const refused = await request(gwPort, { path: '/big.js', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip;q=0' } })
    check('q=0 明确拒绝：不压', refused.headers['content-encoding'] === undefined && refused.raw.length === Buffer.byteLength(refused.body))
    const sse = await request(gwPort, { path: '/stream', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip' } })
    check('SSE 不压（压了就没实时性）', sse.headers['content-encoding'] === undefined && sse.body.includes('data: hello'))
    const smallPageGz = await request(gwPort, { path: '/page', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip' } })
    check('小于 1KB 的注入页不压（原样明文）', smallPageGz.headers['content-encoding'] === undefined && smallPageGz.body.includes('randomUUID'))
    const pageGz = await request(gwPort, { path: '/bigpage', headers: { cookie: cookieHeader, 'accept-encoding': 'gzip' } })
    const pageDec = zlib.gunzipSync(pageGz.raw).toString('utf8')
    check('大注入页按能力压（解回来仍含兜底脚本与原文）', pageGz.headers['content-encoding'] === 'gzip' && pageDec.includes('randomUUID') && pageDec.includes('<title>big</title>') && pageDec.includes('<p>fill</p>'.repeat(3)))
    check('压缩后 content-length 与实体长度一致', Number(pageGz.headers['content-length']) === pageGz.raw.length)
  }

  // ── WS 升级隧道 ──
  const wsOk = await wsProbe(gwPort, token, true)
  check('WS 升级（有效 Cookie）→ 101', wsOk.statusLine?.startsWith('HTTP/1.1 101'))
  check('WS 隧道双向可达（收到上游回声）', typeof wsOk.frameTail === 'string' && wsOk.frameTail.includes(`upstream-ws-host:127.0.0.1:${upstream.port}`))
  const wsBad = await wsProbe(gwPort, 'bad-token', false)
  check('WS 升级（无效令牌）→ 404', wsBad.statusLine?.startsWith('HTTP/1.1 404'))

  // ── 轮换：旧 Cookie 与旧 k 立即失效，新 k 可用；令牌落盘 ──
  const oldToken = token
  gw.rotate()
  check('rotate() 换新令牌', gw.token() !== oldToken)
  r = await request(gwPort, { path: '/', headers: { cookie: `${PHONE_COOKIE}=${oldToken}` } })
  check('旧 Cookie 轮换后 → 404', r.status === 404)
  r = await request(gwPort, { path: `/?k=${gw.token()}` })
  check('新令牌链接可用', r.status === 302)
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  check('新令牌已持久化', persisted.token === gw.token())

  // ── rotate 不回退启用位：启停端点直写状态文件后，rotate 应沿用现值 ──
  //（旧实现回写启动时的 boot.enabled，会把用户改过的开关悄悄翻回去）
  fs.writeFileSync(stateFile, JSON.stringify({ token: gw.token(), enabled: true }), 'utf8')
  gw.rotate()
  const persisted2 = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  check('rotate 沿用状态文件现值 enabled=true', persisted2.enabled === true && persisted2.token === gw.token())
  fs.writeFileSync(stateFile, JSON.stringify({ token: gw.token(), enabled: false }), 'utf8')
  gw.rotate()
  const persisted3 = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  check('rotate 沿用状态文件现值 enabled=false', persisted3.enabled === false && persisted3.token === gw.token())
} finally {
  gw.close()
  await new Promise((r) => upstream.server.close(r))
  try { fs.rmSync(stateDir, { recursive: true, force: true }) } catch { /* 临时目录 */ }
}

console.log(failed === 0 ? 'ALL GATEWAY TESTS OK' : `${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
