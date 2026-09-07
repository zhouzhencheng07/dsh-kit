// OpenCode Go 会话头一键写入（POST /dsh-kit/opencode-session，实现+端点同文件）
//
// 背景：OpenCode Go 网关要求出站推理请求携带 x-opencode-session（每会话稳定
// ID，网关用于路由亲和与 prompt 缓存），缺失时 400 MissingSessionID。pi-ai
// 0.84.4 不原生发该头、宿主 compat 白名单不放行亲和开关（证据链见
// .agents/docs/opencode-go-session-header.md）——最终口径是给 settings.yaml 的
// provider profile 配静态头（llm-pi-ai 对每个推理请求合并 profile.headers，
// 已解包证实）。本模块把那次手配变成设置卡里的一个按钮：读
// $DSH_HOME/settings.yaml → 文本级在 opencode-go 段插入 headers/
// x-opencode-session（随机 UUID；已存在则原样返回不动文件）→ 写回。
// settings-file 服务用 chokidar 监听该文件、变更即重读，所以写入后免重启生效。
//
// 为什么是文本级插入而不是 YAML 解析重写：包里零 dependencies，宿主侧运行时
// 解析 yaml 再整文件 dump 会重排用户手写内容；文本插入只动目标两行，其余
// 字节原样保留，风险最小。已存在判定幂等：点击多少次都只写一次。
//
// 已知边界：
// - 只识别块状写法（opencode-go: 下缩进子键）；headers 段带内联内容（如
//   `headers: {a: b}`）时拒绝插入（无法保证不丢内容），返回 error 由前端提示。
// - 与官方设置通道的整文件重写之间存在理论并发窗口（last-wins），仅在设置卡
//   里同时点「保存」和本按钮才可能触发，接受。
// - 端点与 webServer 同生命周期（effect 清理），无任何常驻状态。

import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { sameOrigin } from './web-guard.ts'

/** provider 段锚键：opencode-go:（允许行尾注释） */
const KEY_RE = /^([ \t]*)opencode-go:[ \t]*(.*)$/
/** headers 子键（允许行尾注释；内联值单独判断） */
const HEADERS_RE = /^([ \t]*)headers:[ \t]*(.*)$/
/** 目标头既有值（值后允许注释） */
const SESSION_RE = /^[ \t]*x-opencode-session:[ \t]*([^\s#]+)/

/** 行内值去掉行尾注释并裁空白；空串表示纯键（可挂子键） */
function inlineValue(raw: string): string {
  return raw.replace(/[ \t]+#.*$/, '').trim()
}

interface YamlLine {
  text: string
  /** 行尾换行符；最后一行可能为空串（文件不以换行结尾） */
  sep: string
}

function splitLines(text: string): YamlLine[] {
  const lines: YamlLine[] = []
  let i = 0
  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    if (nl === -1) {
      lines.push({ text: text.slice(i), sep: '' })
      break
    }
    const cr = nl > i && text[nl - 1] === '\r'
    lines.push({ text: text.slice(i, cr ? nl - 1 : nl), sep: cr ? '\r\n' : '\n' })
    i = nl + 1
  }
  return lines
}

function indentOf(text: string): number {
  return /^([ \t]*)/.exec(text)?.[1]?.length ?? 0
}

function indentUnit(text: string): string {
  return /^([ \t]*)/.exec(text)?.[1] ?? ''
}

/**
 * provider/headers 段的块结束下标（不含）：从 start 起扫到第一条缩进不深于
 * keyIndent 的非空内容行；纯注释行缩进不深于 keyIndent 也算块外，空行不算。
 */
function blockEnd(lines: YamlLine[], start: number, keyIndent: number): number {
  let j = start
  while (j < lines.length) {
    const text = lines[j]!.text
    const trimmed = text.trim()
    if (trimmed === '') {
      j += 1
      continue
    }
    if (indentOf(text) <= keyIndent) break
    j += 1
  }
  return j
}

function findProviderLine(lines: YamlLine[]): { index: number; indent: number; inline: string } | null {
  for (let i = 0; i < lines.length; i += 1) {
    const m = KEY_RE.exec(lines[i]!.text)
    if (m) {
      return { index: i, indent: indentOf(lines[i]!.text), inline: inlineValue(m[2] ?? '') }
    }
  }
  return null
}

function findHeadersLine(
  lines: YamlLine[],
  start: number,
  end: number,
  keyIndent: number,
): { index: number; indent: number; inline: string } | null {
  for (let i = start; i < end; i += 1) {
    const m = HEADERS_RE.exec(lines[i]!.text)
    if (m && indentOf(lines[i]!.text) > keyIndent) {
      return { index: i, indent: indentOf(lines[i]!.text), inline: inlineValue(m[2] ?? '') }
    }
  }
  return null
}

function findSessionValue(lines: YamlLine[], start: number, end: number, parentIndent: number): string | null {
  for (let i = start; i < end; i += 1) {
    if (indentOf(lines[i]!.text) <= parentIndent) continue
    const m = SESSION_RE.exec(lines[i]!.text)
    if (m) return m[1] ?? null
  }
  return null
}

/** settings.yaml 里 opencode-go 段已有的 x-opencode-session 值；没有返回 null */
export function findOpenCodeSessionValue(text: string): string | null {
  const lines = splitLines(text)
  const provider = findProviderLine(lines)
  if (!provider) return null
  const end = blockEnd(lines, provider.index + 1, provider.indent)
  const headers = findHeadersLine(lines, provider.index + 1, end, provider.indent)
  if (!headers) return null
  const headersEnd = blockEnd(lines, headers.index + 1, headers.indent)
  return findSessionValue(lines, headers.index + 1, headersEnd, headers.indent)
}

export type OcSessionEdit =
  | { action: 'created'; text: string; value: string }
  | { action: 'exists'; text: string; value: string }
  | { action: 'no-provider'; text: string; value: null }
  | { action: 'error'; text: string; value: null; message: string }

/**
 * 把 x-opencode-session: uuid 插进 opencode-go 段。幂等：已有值原样返回
 * （action 'exists'）；文本级插入只增改目标行，其余内容（含换行风格）原样保留。
 * 内联写法（`opencode-go: {…}` / `headers: {…}` 非空内联）拒绝插入返回 error。
 */
export function insertOpenCodeSessionHeader(text: string, uuid: string): OcSessionEdit {
  const existing = findOpenCodeSessionValue(text)
  if (existing) return { action: 'exists', text, value: existing }

  const lines = splitLines(text)
  const provider = findProviderLine(lines)
  if (!provider) return { action: 'no-provider', text, value: null }
  if (provider.inline !== '' && provider.inline !== '{}') {
    return { action: 'error', text, value: null, message: 'opencode-go 段是内联写法，无法自动插入，请手动编辑 settings.yaml' }
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  /** 在 anchor 行后插入 inserts；anchor 不以换行结尾（EOF）时补上文件风格换行 */
  const insertAfter = (anchorIndex: number, inserts: string[]) => {
    const anchor = lines[anchorIndex]!
    if (anchor.sep === '') {
      anchor.sep = eol
      lines.splice(anchorIndex + 1, 0, ...inserts.map((t, i) => ({ text: t, sep: i === inserts.length - 1 ? '' : eol })))
    } else {
      lines.splice(anchorIndex + 1, 0, ...inserts.map((t) => ({ text: t, sep: eol })))
    }
  }
  if (provider.inline === '{}') lines[provider.index]!.text = `${indentUnit(lines[provider.index]!.text)}opencode-go:`

  const end = blockEnd(lines, provider.index + 1, provider.indent)
  const headers = findHeadersLine(lines, provider.index + 1, end, provider.indent)
  if (headers) {
    if (headers.inline !== '' && headers.inline !== '{}') {
      return { action: 'error', text, value: null, message: 'headers 段是内联写法，无法自动插入，请手动编辑 settings.yaml' }
    }
    if (headers.inline === '{}') lines[headers.index]!.text = `${indentUnit(lines[headers.index]!.text)}headers:`
    const headersEnd = blockEnd(lines, headers.index + 1, headers.indent)
    // 子键缩进跟随已有子键（同一 map 的兄弟），没有则退 headers + 两空格
    let childIndent = `${indentUnit(lines[headers.index]!.text)}  `
    for (let i = headers.index + 1; i < headersEnd; i += 1) {
      const t = lines[i]!.text
      if (t.trim() !== '' && indentOf(t) > headers.indent) {
        childIndent = indentUnit(t)
        break
      }
    }
    insertAfter(headers.index, [`${childIndent}x-opencode-session: ${uuid}`])
    return { action: 'created', text: lines.map((l) => l.text + l.sep).join(''), value: uuid }
  }

  // 没有 headers 子键：headers 与 session 两行一起插到 provider 键行之后；
  // 缩进跟随段内第一个子键（models: 等），空段退 provider + 两空格
  let unit = `${indentUnit(lines[provider.index]!.text)}  `
  for (let i = provider.index + 1; i < end; i += 1) {
    const t = lines[i]!.text
    if (t.trim() !== '' && indentOf(t) > provider.indent) {
      unit = indentUnit(t)
      break
    }
  }
  insertAfter(provider.index, [`${unit}headers:`, `${unit}  x-opencode-session: ${uuid}`])
  return { action: 'created', text: lines.map((l) => l.text + l.sep).join(''), value: uuid }
}

/** settings.yaml 位置（DSH_HOME 未设回退 ~/.dsh，与 browser-tools 口径一致） */
export function settingsYamlFile(): string {
  const env = process.env.DSH_HOME
  const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh')
  return path.join(home, 'settings.yaml')
}

/** 按钮一次点击的完整动作：读文件 → 已存在即返回 → 生成 UUID 插入写回 */
export async function ensureOpenCodeSession(): Promise<{ file: string } & OcSessionEdit> {
  const file = settingsYamlFile()
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { file, action: 'error', text: '', value: null, message: `settings.yaml 读取失败：${reason}` }
  }
  const uuid = randomUUID()
  const edit = insertOpenCodeSessionHeader(text, uuid)
  if (edit.action !== 'created') return { file, ...edit }
  try {
    await fsp.writeFile(file, edit.text, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { file, action: 'error', text: edit.text, value: null, message: `settings.yaml 写入失败：${reason}` }
  }
  return { file, action: 'created', text: edit.text, value: uuid }
}

/** cordis ctx 里本层用到的最小面（同 skill-pool） */
interface KitCtx {
  inject(deps: string[], cb: (webCtx: {
    effect(fn: () => void | (() => void), label?: string): void
    webServer: {
      register(route: {
        kind: string
        path: string
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
      }): () => void
    }
  }) => void): void
}

/** 注册一键写入端点。POST /dsh-kit/opencode-session → {ok, action, value} */
export function applyOpenCodeSession(ctx: KitCtx): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-kit/opencode-session',
        handler: (req, res) => {
          const json = (code: number, obj: unknown) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') {
            json(405, { ok: false, error: 'method not allowed' })
            return
          }
          if (!sameOrigin(req)) {
            json(403, { ok: false, error: 'cross-origin denied' })
            return
          }
          void ensureOpenCodeSession().then(
            (result) => {
              if (result.action === 'error') json(500, { ok: false, error: result.message })
              else if (result.action === 'no-provider') {
                json(404, { ok: false, error: 'settings.yaml 里没有 llm-pi-ai.providers.opencode-go 配置段，无法写入' })
              } else json(200, { ok: true, action: result.action, value: result.value })
            },
            (error: unknown) => {
              json(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            },
          )
        },
      })
      return dispose
    })
  })
}
