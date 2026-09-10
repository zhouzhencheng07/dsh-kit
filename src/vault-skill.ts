// 知识库使用技能（SKILL.md）生成 —— 写进用户级技能根（$DSH_HOME/skills/<name>/）。
// 为什么是技能而不是 vault 根的 AGENTS.md：AGENTS.md 只是躺在目录里的文件，agent
// 不会自动加载它，写在那里的约定等于不存在；技能由 DSH 技能扫描发现并进模型上下文
// （chokidar 热生效），规则才真正生效（用户定稿 2026-09-09，AGENTS.md 自动生成随之
// 退役）。为什么有格式手册：双链/提示卡/折叠块/公式是本库超出标准 markdown 的约定，
// 有 md 经验的 agent 不认识这些语法——手册逐条给写法示例，agent 照抄即可产出面板
// 可正确渲染的页面。检索用 vault_search 工具（保持工具形态，技能只教用法）；git 存
// 档靠技能教会的 git -C 命令，agent 拿到 add/commit 能力，插件不拦 fs 工具瀑布。
// 生命周期：vaultRoot 配置变化（含首次就绪）时整体重写，根路径随设置自动更新；插件
// 卸载/禁用时收走（removeVaultSkill，HMR 更新=卸载+重装，重装即重写）。文件由插件
// 托管，用户手改会被覆盖（头部已声明）。失败静默——技能是便利设施，绝不挡配置保存
// 或插件启动。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { recycleDelete } from './recycle.ts'

export const VAULT_SKILL_DIRNAME = 'dsh-kit-vault'

/** 用户级技能根（$DSH_HOME/skills，dsh-skill-filesystem 的扫描根之一） */
export function defaultSkillsDir(): string {
  const env = process.env.DSH_HOME
  const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh')
  return path.join(home, 'skills')
}

/** SKILL.md 正文（纯函数，测试直调）：root 必须出现在正文，agent 靠它拼 git -C */
export function vaultSkillMarkdown(root: string): string {
  return [
    '---',
    'name: dsh-kit-vault',
    'description:',
    '  知识库（vault）使用规则——记笔记/查知识/整理知识库前必读：库里既有用户笔记（学习、',
    '  本机记录），也有项目知识（项目总览、架构与可复用经验）。含一题一页与查重、目录分区、',
    '  双链/提示卡/折叠块/公式等本库扩展格式的写法手册、vault_search 检索工具用法、改完页面',
    '  后的 git add/commit 存档命令。',
    '---',
    '',
    '# 知识库（vault）使用规则',
    '',
    `知识库根目录：\`${root}\``,
    '',
    '> 本文件由 dsh-kit 插件生成并随「知识库目录」设置自动更新，不要手工编辑。',
    '',
    '## 什么时候做什么',
    '',
    '- 用户要「记一下 X」「写进知识库」「整理/合并笔记」→ 按下面规则直接写页。',
    '- 回答前想确认用户是否已有相关笔记，或开始/接手一个项目、改代码前想了解架构与既有做法 →',
    '  先用 `vault_search` 工具检索（只收 wiki/ 区，项目页在 `wiki/Project/<项目>/`），',
    '  拿到页面绝对路径后用文件读取工具打开。',
    '- 你新增/修改了页面之后 → 主动执行一次文末的 git 提交，让改动有版本可回退。',
    '',
    '## 目录约定',
    '',
    '- `wiki/` —— 策展层：维护中的理解资产（检索只收这里），新页默认写这里。',
    '- `library/` —— 参考层：原始资料、只读材料，不进检索，也不进 git 存档。',
    '- `attachments/` —— 图片/PDF 等二进制（git 已忽略），页面里用相对链接引用。',
    '',
    '## 页面规则',
    '',
    '- 一题一页：写前先 `vault_search` 查重，已有同类页就合并/追加，不另开新页。',
    '- 页面文件名即页面名（双链目标），建议与首行 `# 标题` 保持一致；frontmatter 可省。',
    '- 一页一个主题（能用一个名字说清）：长度随主题走，不设硬上限；超过约 300 行说明主题切得太粗。',
    '',
    '## 格式手册（本库超出标准 markdown 的部分，照抄语法即可）',
    '',
    '**双链**（页面互引；目标按文件名去 .md 解析，移动/改扩展名不破链）：',
    '',
    '    [[页面名]]              引用整页',
    '    [[页面名#小节标题]]      跳到该页对应小节',
    '    [[页面名|显示文字]]      改显示名',
    '',
    '指向不存在的页叫碎链：人在面板里点击即可建页，可放心先写链再补内容。',
    '',
    '**提示卡**（`>` 引用行紧跟 `[!类型]`，正文行同样以 `>` 开头）：',
    '',
    '    > [!warning] 标题文字',
    '    > 正文内容行',
    '',
    '类型：note / info / tip / success / question / warning / danger / example / quote。',
    '',
    '**折叠块**（默认收起；`<details open>` 即默认展开；summary 与正文间留空行可写任意 markdown）：',
    '',
    '    <details>',
    '    <summary>摘要标题</summary>',
    '',
    '    正文内容，支持普通 markdown。',
    '',
    '    </details>',
    '',
    '**数学公式**：行内 `$E=mc^2$`；行间公式用 `$$` 单独成行包裹：',
    '',
    '    $$',
    '    \\int_0^1 f(x)\\,dx',
    '    $$',
    '',
    '**任务列表**：`- [ ] 待办` / `- [x] 已完成`（面板里可点击勾选，落盘回源码）。',
    '',
    '**图片**：文件先放 `attachments/`，页面里 `![说明](attachments/文件名.png)`。',
    '',
    '**行内补充**（可选）：下划线 `<u>文字</u>`、高亮 `<mark>文字</mark>`、',
    '文字颜色 `<span style="color:#c00000">文字</span>`；粗体/斜体/删除线/行内代码',
    '与标准 markdown 相同。',
    '',
    '## git 存档（你有提交权限）',
    '',
    '知识库是 git 仓库。你改完页面后主动提交一次；人的 Ctrl+S 保存由插件自动提交，',
    '与你的提交互不冲突。只 add/commit，不要 push、不要改历史：',
    '',
    '```bash',
    `git -C "${root}" add -A`,
    `git -C "${root}" commit -m "vault: <一句话说明改了什么>"`,
    '```',
    '',
    '- `attachments/` 与 `*.tmp` 已被 .gitignore 忽略，无需处理。',
    '- 未装 git 时上述命令失败即可跳过，不要重试。',
    '',
  ].join('\n')
}

/** 幂等写技能文件（mkdir + 重写）；失败静默不抛 */
export function writeVaultSkill(skillsDir: string, root: string): void {
  const dir = path.join(skillsDir, VAULT_SKILL_DIRNAME)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), vaultSkillMarkdown(root), 'utf8')
  } catch {
    /* 只读盘等场景静默：技能是便利设施，不挡配置 */
  }
}

/** 插件卸载/禁用时收走生成的技能（HMR 更新=卸载+重装，重装即重写）；回收站删除 */
export async function removeVaultSkill(skillsDir: string): Promise<void> {
  const dir = path.join(skillsDir, VAULT_SKILL_DIRNAME)
  if (!fs.existsSync(dir)) return
  try {
    await recycleDelete(dir)
  } catch {
    /* 回收站不可用等场景静默 */
  }
}
