// 浏览器路径参数校验（tree/read/raw/fs-op/git 端点共用）：绝对路径、存在性、
// 类型门槛（文件/目录），一律 realpathSync 规范化后再放行——路径穿越与相对路径
// 在这里挡掉。

import fs from 'node:fs'
import path from 'node:path'

export type ValidateOk<T> = { ok: true } & T
export type ValidateFail = { ok: false; message: string }

/** 校验浏览器传来的 cwd：绝对路径 + 存在 + 是目录，返回规范化的真实路径 */
export function validateCwd(raw: unknown): ValidateOk<{ path: string }> | ValidateFail {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, message: '缺少工作目录（cwd）' }
  const resolved = path.resolve(raw.trim())
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    return { ok: false, message: `目录不存在：${resolved}` }
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(real)
  } catch {
    return { ok: false, message: `无法读取目录：${real}` }
  }
  if (!stat.isDirectory()) return { ok: false, message: `不是目录：${real}` }
  return { ok: true, path: real }
}

/** 校验浏览器传来的文件路径：绝对路径 + 存在 + 是文件，返回真实路径、大小与修改时间 */
export function validateFile(raw: unknown): ValidateOk<{ path: string; size: number; mtimeMs: number }> | ValidateFail {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, message: '缺少文件路径' }
  const resolved = path.resolve(raw.trim())
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    return { ok: false, message: `文件不存在：${resolved}` }
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(real)
  } catch {
    return { ok: false, message: `无法读取文件：${real}` }
  }
  if (!stat.isFile()) return { ok: false, message: `不是文件：${real}` }
  return { ok: true, path: real, size: stat.size, mtimeMs: stat.mtimeMs }
}

/** 仅校验路径形态（非空、规范化为绝对路径），不做存在性检查——供目标是 git 对象
 *  而非工作区文件的端点用（典型：已删除文件的 diff）；越界由调用方按 git root
 *  二次把关 */
export function validatePathShape(raw: unknown): ValidateOk<{ path: string }> | ValidateFail {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, message: '缺少文件路径' }
  return { ok: true, path: path.resolve(raw.trim()) }
}

/** 校验浏览器传来的路径：绝对路径 + 存在（文件或目录均可），返回真实路径与 stat */
export function validateAny(raw: unknown): ValidateOk<{ path: string; stat: fs.Stats }> | ValidateFail {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, message: '缺少路径' }
  const resolved = path.resolve(raw.trim())
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    return { ok: false, message: `路径不存在：${resolved}` }
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(real)
  } catch {
    return { ok: false, message: `无法读取路径：${real}` }
  }
  return { ok: true, path: real, stat }
}

/** target 是否位于 dir 子树内（dir 本身不算在内——根目录不可改删） */
export function withinTree(dirReal: string, targetReal: string): boolean {
  const rel = path.relative(dirReal, targetReal)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Windows 保留设备名（con.txt 这类同样保留，故只取第一个点之前的部分判） */
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i
/** 新建/重命名的名称合法性：禁空、首尾空白、路径分隔符、控制字符、Windows 特殊字符与相对段 */
export function invalidFsName(raw: unknown): boolean {
  if (typeof raw !== 'string') return true
  const name = raw.trim()
  if (name === '' || name !== raw) return true
  if (name === '.' || name === '..') return true
  if (/[/\\]/.test(name)) return true
  if (/[\u0000-\u001f<>:"|?*]/.test(name)) return true
  if (WIN_RESERVED_NAME.test(name.split('.')[0] ?? '')) return true
  return false
}
