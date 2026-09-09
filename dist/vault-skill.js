// 知识库使用技能（SKILL.md）生成 —— 写进用户级技能根（$DSH_HOME/skills/<name>/）。
// 为什么是技能而不是 vault 根的 AGENTS.md：AGENTS.md 只是躺在目录里的文件，agent
// 不会自动加载它，写在那里的约定等于不存在；技能由 DSH 技能扫描发现并进模型上下文
// （chokidar 热生效），规则才真正生效（用户定稿 2026-09-09，AGENTS.md 自动生成随之
// 退役）。检索用 vault_search 工具（保持工具形态，技能只教用法）；git 存档靠技能
// 教会的 git -C 命令，agent 拿到 add/commit 能力，插件不再拦 fs 工具瀑布。
// 生命周期：vaultRoot 配置变化（含首次就绪）时整体重写，根路径随设置自动更新；
// 文件由插件托管，用户手改会被覆盖（头部已声明）。失败静默——技能是便利设施，
// 绝不挡配置保存或插件启动。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const VAULT_SKILL_DIRNAME = 'dsh-kit-vault';
/** 用户级技能根（$DSH_HOME/skills，dsh-skill-filesystem 的扫描根之一） */
export function defaultSkillsDir() {
    const env = process.env.DSH_HOME;
    const home = env && env.trim() !== '' ? env.trim() : path.join(os.homedir(), '.dsh');
    return path.join(home, 'skills');
}
/** SKILL.md 正文（纯函数，测试直调）：root 必须出现在正文，agent 靠它拼 git -C */
export function vaultSkillMarkdown(root) {
    return [
        '---',
        'name: dsh-kit-vault',
        'description:',
        '  用户知识库（vault）使用规则——记笔记/查知识/整理知识库前必读：一题一页与查重、',
        '  [[wikilink]]/提示卡/公式/折叠块等页面格式、wiki 与 library 分区、vault_search',
        '  检索工具用法、改完页面后的 git add/commit 存档命令。',
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
        '- 回答前想确认用户是否已有相关笔记 → 先用 `vault_search` 工具检索（只收 wiki/ 区），',
        '  拿到页面绝对路径后用文件读取工具打开。',
        '- 你新增/修改了页面之后 → 主动执行一次文末的 git 提交，让改动有版本可回退。',
        '',
        '## 目录约定',
        '',
        '- `wiki/` —— 策展层：维护中的理解资产（检索只收这里）。',
        '- `library/` —— 参考层：原始资料、只读材料，不进检索。',
        '- `attachments/` —— 图片/PDF 等二进制（git 已忽略），页面里用相对链接引用。',
        '',
        '## 页面规则',
        '',
        '- 一题一页：写前先 `vault_search` 查重，已有同类页就合并/追加，不另开新页。',
        '- 页面首行一个 `# 标题`；frontmatter 可省，不要求任何字段。',
        '- 页面互引用 `[[页面名]]`（可带 `#标题` 定位、`|别名` 改显示名；碎链在面板里点击即建页）。',
        '- 提示卡：`> [!info] 标题`（另有 warning/tip/success/danger）。',
        '- 折叠块用原生 HTML：`<details><summary>标题</summary>正文</details>`。',
        '- 数学公式：行内 `$a^2+b^2$`，行间 `$$...$$`。',
        '- 单页超过约 16KB 就拆分或抽索引页。',
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
    ].join('\n');
}
/** 幂等写技能文件（mkdir + 重写）；失败静默不抛 */
export function writeVaultSkill(skillsDir, root) {
    const dir = path.join(skillsDir, VAULT_SKILL_DIRNAME);
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), vaultSkillMarkdown(root), 'utf8');
    }
    catch {
        /* 只读盘等场景静默：技能是便利设施，不挡配置 */
    }
}
