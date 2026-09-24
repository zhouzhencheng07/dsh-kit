// 项目根定位：自起点向上找 .git（目录或文件都算）。技能池分组与 git 端点共用。
import fs from 'node:fs'
import path from 'node:path'

/** 自 start 向上找 .git（目录或文件都算），找不到退回 start 本身（对齐 skill-filesystem 语义）。
 *  git 相关端点也用它定位项目根。 */
export function findProjectRoot(start: string): string {
  let current = start
  for (;;) {
    try {
      if (fs.existsSync(path.join(current, '.git'))) return current
    } catch {
      // 无权限探测就当没有，继续向上
    }
    const parent = path.dirname(current)
    if (parent === current) return start
    current = parent
  }
}
