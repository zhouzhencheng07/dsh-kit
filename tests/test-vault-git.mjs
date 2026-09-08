// vault-git 单测：对构建产物 dist/vault-git.js 跑（先 pnpm build 再跑本文件）
//   node tests/test-vault-git.mjs
// 覆盖：git 可用性探测、初始存档（init/.gitignore/首提交/幂等/不接管已有仓库）、
//       commitVault 无变化跳过、改动提交、attachments 与 *.tmp 忽略、路径归属。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { isGitAvailable, ensureVaultGit, commitVault, isInsideVault } from '../dist/vault-git.js'

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
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'attachments/\n*.tmp\n')
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

test('不接管已有仓库：已有 .git 则跳过 init 且不动 .gitignore', async () => {
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

test('commitVault：无变化跳过，有改动提交，attachments 与 *.tmp 忽略', async () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'a.md'), '# A\n', 'utf8')
  await ensureVaultGit(root)
  // 无变化 → false 且不加提交
  assert.equal(await commitVault(root, 'dsh-kit: 空'), false)
  assert.equal(commitCount(root), 1)
  // attachments / *.tmp 变化不计入
  fs.mkdirSync(path.join(root, 'attachments'))
  fs.writeFileSync(path.join(root, 'attachments', 'pic.png'), 'x', 'utf8')
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

test('isInsideVault：内/外/新建文件/根自身/大小写（win32）', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'wiki'), { recursive: true })
  const realRoot = fs.realpathSync(root)
  assert.equal(isInsideVault(realRoot, path.join(realRoot, 'a.md')), true)
  assert.equal(isInsideVault(realRoot, path.join(realRoot, 'wiki', 'b.md')), true)
  assert.equal(isInsideVault(realRoot, path.join(realRoot, '不存在的页.md')), true, '新建文件按原路径比')
  assert.equal(isInsideVault(realRoot, realRoot), false, '根自身不算在内')
  assert.equal(isInsideVault(realRoot, path.join(path.dirname(realRoot), 'outside.md')), false)
  assert.equal(isInsideVault(realRoot, os.tmpdir()), false)
  if (process.platform === 'win32') {
    assert.equal(isInsideVault(realRoot, path.join(realRoot.toUpperCase(), 'A.MD')), true, 'win32 大小写不敏感')
  }
  fs.rmSync(root, { recursive: true, force: true })
})
