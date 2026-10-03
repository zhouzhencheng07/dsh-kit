// 原始字节端点（/dsh-kit/raw）的 content-type 白名单。
// 白名单按扩展名收口——只放行明确支持的 inline 渲染类型（现仅 vault 图片），
// 避免把任意二进制按 octet-stream 喂给浏览器（触发下载）；新增 inline 渲染
// 格式时在此扩表。
//
// 单独成模块：宿主侧 index.ts 消费，tests/test-raw-file.mjs 单测。

/** 可 inline 渲染的类型：扩展名 → content-type（pdf/office 不在表内，
 *  下载模式不受此表限制） */
const RAW_TYPES = new Map([
  // 图片（vault 笔记粘贴截图/插图走 /dsh-kit/raw 渲染）
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
  ['bmp', 'image/bmp'],
])

/** 取小写扩展名：`a.PDF` → pdf；无点/点文件 → '' */
export function rawExtOf(name: unknown): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 命中白名单返回 content-type，否则 null */
export function rawContentType(name: unknown): string | null {
  return RAW_TYPES.get(rawExtOf(name)) ?? null
}

/**
 * 下载模式（`?dl=1`）的 content-type：白名单是给「浏览器能不能渲染」收的口，
 * 下载不适用——未知类型按 octet-stream 发出去由浏览器落盘即可（官方文件预览
 * 头部的「下载到本机」按钮对任意类型都要能用）。
 */
export function rawDownloadContentType(name: unknown): string {
  return rawContentType(name) ?? 'application/octet-stream'
}
