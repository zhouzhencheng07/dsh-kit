// 插件数据根：宿主只保证 DSH_HOME，自家的东西一律落 <DSH_HOME>/dsh-kit/ 下——
// 技能池与技能挂载策略、浏览器 profile、手机网关状态都在那儿，备份与清理只看一个目录。
// （知识库与日程仍各自解 DSH_HOME，见 src/vault 的两个调用点。）

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