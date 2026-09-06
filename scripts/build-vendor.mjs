// CodeMirror 6 vendor 构建脚本（一次性工程动作，产物提交入库）。
// 产出 client/vendor/codemirror.bundle.js：IIFE 单文件，暴露 window.CM6 工厂。
// 源码在 scripts/vendor-src/（entry.js + live-preview.js），改完重跑：
// node scripts/build-vendor.mjs
//
// 依赖临时安装到系统临时目录，不进项目 package.json（保持插件零 dependencies 声明）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)))
const srcDir = path.join(root, 'scripts', 'vendor-src')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm6-vendor-'))
const PKGS = [
  'esbuild@0.24.2',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@lezer/highlight',
  'codemirror',
  '@codemirror/lang-javascript',
  '@codemirror/lang-python',
  '@codemirror/lang-css',
  '@codemirror/lang-html',
  '@codemirror/lang-json',
  '@codemirror/lang-markdown',
  '@codemirror/lang-xml',
  '@codemirror/lang-sql',
  '@codemirror/legacy-modes',
  '@codemirror/search',
]

try {
  console.log('临时环境:', tmp)
  fs.writeFileSync(path.join(tmp, 'package.json'), '{}')
  // 源码拷进临时目录再打包（esbuild 解析相对 import 需要同目录）
  for (const name of fs.readdirSync(srcDir)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(srcDir, name), path.join(tmp, name))
  }
  console.log('npm install 中…')
  execSync(`npm install --no-audit --no-fund --loglevel=error ${PKGS.join(' ')}`, { cwd: tmp, stdio: 'inherit' })
  console.log('esbuild 打包中…')
  const esbuild = createRequire(path.join(tmp, 'node_modules', 'esbuild', 'package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [path.join(tmp, 'entry.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    outfile: path.join(root, 'client', 'vendor', 'codemirror.bundle.js'),
    legalComments: 'inline',
  })
  const size = fs.statSync(path.join(root, 'client', 'vendor', 'codemirror.bundle.js')).size
  console.log(`完成: codemirror.bundle.js ${(size / 1024).toFixed(0)} KB`)
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* esbuild 句柄释放有延迟，残留临时目录无害 */ }
}
