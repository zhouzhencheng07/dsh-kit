// vault-git 单测：对构建产物 dist/vault-git.js 跑（先 pnpm build 再跑本文件）
//   node tests/test-vault-git.mjs
// 覆盖：git 可用性探测、初始存档（init/.gitignore/首提交/幂等/不接管已有仓库）、
//       commitVault 无变化跳过、改动提交、attachments / library 与 *.tmp 忽略、
//       已有仓库的忽略项补齐与 library 出索引（存量库升级路径）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { isGitAvailable, ensureVaultGit, commitVault } from '../dist/vault-git.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dshkit-vaultgit-'))
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const commitCount = (root) => Number(git(root, 'rev-list', '--count', 'HEAD').trim())

test('git 可用性探测：本环境应为 true 且缓存稳定', async () => {
  const first = await isGitAvailable()
  const second = await isGitAvailable()
  assert.equal(first, true, '测试环境必须装有 git')
  assert.equal(second, first)
})

test('初始存档：新目录 init + .gitignore + 首提交，重复调用幂等', async () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'a.md'), '# A\n', 'utf8')
  await ensureVaultGit(root)
  assert.ok(fs.existsSync(path.join(root, '.git')), '应已 init')
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'attachments/\nlibrary/\n*.tmp\n')
  assert.equal(commitCount(root), 1)
  // 首提交包含已有 md（attachments 目录不存在则无可忽略项）
  const logged = git(root, 'log', '--format=%s').trim()
  assert.equal(logged, 'dsh-kit: 初始存档')
  assert.match(git(root, 'show', '--name-only', '--format='), /a\.md/)
  // 幂等：再跑不加提交、不改 .gitignore
  await ensureVaultGit(root)
  assert.equal(commitCount(root), 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('不接管已有仓库：已有 .git 则跳过 init 且不动用户自己的 .gitignore', async () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, '.gitignore'), 'custom\n', 'utf8')
  git(root, 'init')
  fs.writeFileSync(path.join(root, 'a.md'), '# A\n', 'utf8')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'mine')
  await ensureVaultGit(root)
  assert.equal(commitCount(root), 1, '不应产生新提交')
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'custom\n', '不应覆盖用户 .gitignore')
  fs.rmSync(root, { recursive: true, force: true })
})

test('存量库升级：本模块写的 .gitignore 补 library/，误入索引的 library 摘出（文件不动）', async () => {
  const root = tmp()
  // 复刻存量库形态：.gitignore（无 library）+ library 已在索引里
  fs.writeFileSync(path.join(root, '.gitignore'), 'attachments/\n*.tmp\n', 'utf8')
  fs.mkdirSync(path.join(root, 'library'))
  fs.writeFileSync(path.join(root, 'library', 'raw.md'), '原文\n', 'utf8')
  fs.writeFileSync(path.join(root, 'a.md'), '# A\n', 'utf8')
  git(root, 'init')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'mine')
  assert.match(git(root, 'ls-files', 'library'), /raw\.md/, '前置：library 已在索引里')
  await ensureVaultGit(root)
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'attachments/\n*.tmp\nlibrary/\n')
  assert.equal(git(root, 'ls-files', 'library').trim(), '', 'library 应已摘出索引')
  assert.ok(fs.existsSync(path.join(root, 'library', 'raw.md')), '工作区原始资料一个字节都不动')
  // 幂等：第二次无事发生（不产生新提交）
  const after = commitCount(root)
  await ensureVaultGit(root)
  assert.equal(commitCount(root), after)
  fs.rmSync(root, { recursive: true, force: true })
})

test('commitVault：无变化跳过，有改动提交，attachments / library / *.tmp 忽略', async () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'a.md'), '# A\n', 'utf8')
  await ensureVaultGit(root)
  // 无变化 → false 且不加提交
  assert.equal(await commitVault(root, 'dsh-kit: 空'), false)
  assert.equal(commitCount(root), 1)
  // attachments / library / *.tmp 变化不计入
  fs.mkdirSync(path.join(root, 'attachments'))
  fs.writeFileSync(path.join(root, 'attachments', 'pic.png'), 'x', 'utf8')
  fs.mkdirSync(path.join(root, 'library'))
  fs.writeFileSync(path.join(root, 'library', 'raw.md'), '原文\n', 'utf8')
  fs.writeFileSync(path.join(root, 'a.md.tmp'), 'junk', 'utf8')
  assert.equal(await commitVault(root, 'dsh-kit: 忽略项'), false)
  assert.equal(commitCount(root), 1)
  // md 改动 → true，消息落史
  fs.writeFileSync(path.join(root, 'a.md'), '# A2\n', 'utf8')
  assert.equal(await commitVault(root, 'dsh-kit: 保存 a.md'), true)
  assert.equal(commitCount(root), 2)
  assert.match(git(root, 'log', '--format=%s').trim(), /dsh-kit: 保存 a\.md/)
  fs.rmSync(root, { recursive: true, force: true })
})
