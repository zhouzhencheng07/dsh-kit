// TipTap 富文本 vendor 构建脚本（一次性工程动作，产物提交入库）。
// 产出 client/vendor/richeditor.bundle.js：IIFE 单文件，暴露 window.DshRTE
// （vault 页面编辑器工厂：md ↔ 富文本往返 + schema + 节点视图）。
// 源码在 scripts/vendor-src/rte-entry.js，改完重跑：node scripts/build-rte-vendor.mjs
//
// 与 build-vendor.mjs 同模式：依赖临时安装到系统临时目录，不进项目 package.json
// （保持插件零 dependencies 声明）。版本对齐 wangshu（tiptap 3.30.2）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)))
const srcDir = path.join(root, 'scripts', 'vendor-src')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rte-vendor-'))
const TIP = '3.30.2'
const PKGS = [
  'esbuild@0.24.2',
  `@tiptap/core@${TIP}`,
  `@tiptap/pm@${TIP}`,
  `@tiptap/extensions@${TIP}`,
  `@tiptap/extension-document@${TIP}`,
  `@tiptap/extension-paragraph@${TIP}`,
  `@tiptap/extension-text@${TIP}`,
  `@tiptap/extension-bold@${TIP}`,
  `@tiptap/extension-italic@${TIP}`,
  `@tiptap/extension-strike@${TIP}`,
  `@tiptap/extension-code@${TIP}`,
  `@tiptap/extension-underline@${TIP}`,
  `@tiptap/extension-superscript@${TIP}`,
  `@tiptap/extension-subscript@${TIP}`,
  `@tiptap/extension-heading@${TIP}`,
  `@tiptap/extension-bullet-list@${TIP}`,
  `@tiptap/extension-ordered-list@${TIP}`,
  `@tiptap/extension-list-item@${TIP}`,
  `@tiptap/extension-blockquote@${TIP}`,
  `@tiptap/extension-horizontal-rule@${TIP}`,
  `@tiptap/extension-image@${TIP}`,
  `@tiptap/extension-link@${TIP}`,
  `@tiptap/extension-task-list@${TIP}`,
  `@tiptap/extension-task-item@${TIP}`,
  `@tiptap/extension-table@${TIP}`,
  `@tiptap/extension-table-row@${TIP}`,
  `@tiptap/extension-table-cell@${TIP}`,
  `@tiptap/extension-table-header@${TIP}`,
  `@tiptap/extension-code-block-lowlight@${TIP}`,
  `@tiptap/extension-highlight@${TIP}`,
  `@tiptap/extension-text-style@${TIP}`,
  `@tiptap/extension-color@${TIP}`,
  `@tiptap/extension-gapcursor@${TIP}`,
  `@tiptap/extension-dropcursor@${TIP}`,
  `@tiptap/extension-code-block@${TIP}`,
  `@tiptap/markdown@${TIP}`,
  'lowlight@3.3.0',
]

try {
  console.log('临时环境:', tmp)
  fs.writeFileSync(path.join(tmp, 'package.json'), '{}')
  fs.copyFileSync(path.join(srcDir, 'rte-entry.js'), path.join(tmp, 'rte-entry.js'))
  console.log('npm install 中…')
  execSync(`npm install --no-audit --no-fund --loglevel=error ${PKGS.join(' ')}`, { cwd: tmp, stdio: 'inherit' })
  console.log('esbuild 打包中…')
  const esbuild = createRequire(path.join(tmp, 'node_modules', 'esbuild', 'package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [path.join(tmp, 'rte-entry.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    outfile: path.join(root, 'client', 'vendor', 'richeditor.bundle.js'),
    legalComments: 'inline',
  })
  const size = fs.statSync(path.join(root, 'client', 'vendor', 'richeditor.bundle.js')).size
  console.log(`完成: richeditor.bundle.js ${(size / 1024).toFixed(0)} KB`)
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* esbuild 句柄释放有延迟，残留临时目录无害 */ }
}
