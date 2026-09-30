// 插件数据根：宿主只保证 DSH_HOME，自家的东西一律落 <DSH_HOME>/dsh-kit/ 下——
// 技能池与技能挂载策略、浏览器 profile、手机网关状态都在那儿，备份与清理只看一个目录。
// （知识库与日程仍各自解 DSH_HOME，见 src/vault 的两个调用点。）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** DSH_HOME（没设或空白时回落用户目录下的 .dsh，与宿主同一口径） */
export function dshHome(): string {
  const env = process.env.DSH_HOME
  return env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh')
}

/** <DSH_HOME>/dsh-kit —— 自家数据的根（具体路径一律经 kitPath 拼） */
function kitDir(): string {
  return path.join(dshHome(), 'dsh-kit')
}

export function kitPath(...parts: string[]): string {
  return path.join(kitDir(), ...parts)
}

/**
 * 旧版把状态文件写在 <DSH_HOME>/data/、技能池写在 <DSH_HOME>/skill-pool/；统一到
 * dsh-kit/ 之后这些位置只作旧数据来源：新的还没有、旧的还在就搬过去（两边都在
 * = 搬过了，以新的为准）。返回是否搬了。
 */
export function adoptLegacy(legacy: string, next: string): boolean {
  if (fs.existsSync(next) || !fs.existsSync(legacy)) return false
  fs.mkdirSync(path.dirname(next), { recursive: true })
  try {
    fs.renameSync(legacy, next)
    return true
  } catch {
    return false
  }
}