// vault-skill 单测：对构建产物 dist/vault-skill.js 跑（先 pnpm build 再跑本文件）
//   node tests/test-vault-skill.mjs
// 覆盖：SKILL.md 正文含根路径/格式手册/检索工具/git 命令，幂等落盘与随根更新，卸载清理。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VAULT_SKILL_DIRNAME, defaultSkillsDir, vaultSkillMarkdown, writeVaultSkill, removeVaultSkill } from '../dist/vault-skill.js'

const test = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS  ${name}`),
      (error) => {
        console.log(`FAIL  ${name}: ${error.message}`)
        process.exitCode = 1
      },
    )

await test('vaultSkillMarkdown：frontmatter/根路径/格式手册/git 命令齐备', () => {
  const root = 'D:\\data\\myvault'
  const md = vaultSkillMarkdown(root)
  assert.ok(md.startsWith('---\nname: dsh-kit-vault\n'), 'frontmatter name')
  assert.ok(md.includes('description:'), 'frontmatter description')
  assert.ok(md.includes(`\`${root}\``), '根目录路径进正文')
  assert.ok(md.includes('vault_search'), '检索工具用法')
  assert.ok(md.includes('[[页面名]]'), '双链语法')
  assert.ok(md.includes('[[页面名#小节标题]]') && md.includes('[[页面名|显示文字]]'), '锚点与别名变体')
  assert.ok(md.includes('> [!warning] 标题文字'), '提示卡带正文示例')
  assert.ok(md.includes('<details>') && md.includes('<summary>摘要标题</summary>'), '折叠块语法')
  assert.ok(md.includes('$$') && md.includes('\\int_0^1'), '行间公式示例')
  // 写页规则（用户定）：只记唯一事实、不写流水账——描述与正文都要说清（agent 未必读到正文）
  assert.ok(md.includes('唯一事实') && md.includes('不写流水账'), '写页规则进正文')
  assert.ok(md.includes('不写日期') && md.includes('不写谁定的'), '流水账判据说清')
  assert.ok(md.split('---')[1].includes('唯一事实'), '写页规则进 description')
  // 格式手册只收渲染效果超出标准 md 的约定（用户定稿 2026-09-11）：标准 md/GFM 不教
  assert.ok(!md.includes('- [ ] 待办'), '任务列表已砍')
  assert.ok(!md.includes('<mark>'), '行内高亮已砍')
  assert.ok(md.includes(`git -C "${root}" add -A`), 'git add 命令带根路径')
  assert.ok(md.includes('commit -m'), 'git commit 命令')
  assert.ok(md.includes('wiki/'), '分区约定')
})

await test('defaultSkillsDir：DSH_HOME 优先，缺省回 home/.dsh', () => {
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = 'D:\\tmp\\dsh-home-x'
  assert.equal(defaultSkillsDir(), path.join('D:\\tmp\\dsh-home-x', 'skills'))
  delete process.env.DSH_HOME
  assert.equal(defaultSkillsDir(), path.join(os.homedir(), '.dsh', 'skills'))
  process.env.DSH_HOME = old
})

await test('writeVaultSkill：幂等落盘，内容随根更新', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshkit-skill-'))
  writeVaultSkill(dir, 'D:\\v1')
  const file = path.join(dir, VAULT_SKILL_DIRNAME, 'SKILL.md')
  assert.ok(fs.readFileSync(file, 'utf8').includes('D:\\v1'))
  writeVaultSkill(dir, 'D:\\v2')
  assert.ok(fs.readFileSync(file, 'utf8').includes('D:\\v2'))
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('removeVaultSkill：目录在则收走，不在则无事发生', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshkit-skill-rm-'))
  writeVaultSkill(dir, 'D:\\v1')
  const skillDir = path.join(dir, VAULT_SKILL_DIRNAME)
  await removeVaultSkill(dir)
  assert.equal(fs.existsSync(skillDir), false, '技能目录应已删除')
  await removeVaultSkill(dir) // 不存在时不抛
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(process.exitCode ? 'FAIL' : 'ALL VAULT-SKILL TESTS OK')
