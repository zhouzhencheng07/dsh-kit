// dsh-kit — DSH 页面能力套件（基础设施行宿主半边）
//
// 本行只有套件自己那点基础设施：vendor 静态资源（xterm / qrcode / 知识库编辑器的
// TipTap、KaTeX、mermaid 与 PDF 阅读器的 pdf.js）、OpenCode Go 会话头注入（./core/opencode-session.ts）。它没有页面
// 能力，所以 patch 里不给 id、不进插件页组件列表（宿主只把带 id 的行当组件）。
// 页面能力本身全部按组件行拆开（cordis.patch.yml 里 insert 八行，行 name = 包名 +
// exports 子路径，行序即插件页显示顺序）：dsh-kit/files（文件树 · 源代码管理）、
// dsh-kit/vault（知识库 · 日程）、dsh-kit/terminal（终端）、dsh-kit/browser（内置浏览器）、
// dsh-kit/skills（技能）、dsh-kit/phone（手机访问）、dsh-kit/monitor（用量与监视）、
// dsh-kit/search（网页搜索）——行关闭 = 该子模块不物化 = 它的端点与 agent 工具一起消失。
// 组件各有自己的 Config（src/<组件>/index.ts）；本行没有可调参数。
//
// 浏览器半边（client/bundle.js）：各功能入口注册在对话输入框工具行
// （conversation.input.left），面板本体挂 shell.overlay 与官方右栏签；组件各自的
// client 面住在 bundle 尾部的 xModule 隔离壳里，激活由根 apply 尾部循环触发。
//
// 本行端点（webserver 默认只绑 loopback）：
//   GET  /dsh-kit/vendor/*          —— xterm / qrcode / richeditor / katex / mermaid 静态资源
//   POST /dsh-kit/log               —— 浏览器半边日志回传（client 侧的异常只有这里能留痕）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOpenCodeSessionHeader } from "./core/index.js";
import { sameOrigin } from "./core/web-guard.js";
import { kitLogEmit, kitLogStartup } from "./core/log.js";
export const name = 'dsh-kit';
// vendor 静态资源：白名单文件名 → client/vendor/ 下同名文件
const VENDOR_DIR = fileURLToPath(new URL('../client/vendor/', import.meta.url));
const VENDOR_FILES = new Map([
    ['/dsh-kit/vendor/xterm.js', 'xterm.js'],
    ['/dsh-kit/vendor/addon-fit.js', 'addon-fit.js'],
    ['/dsh-kit/vendor/xterm.css', 'xterm.css'],
    ['/dsh-kit/vendor/qrcode.js', 'qrcode.js'],
    // vault 页面渲染器（TipTap 引擎只读态；懒加载）
    ['/dsh-kit/vendor/richeditor.bundle.js', 'richeditor.bundle.js'],
    // mermaid 流程图渲染（```mermaid 围栏出图；宿主与 app.asar 都不带这个库，
    // 编辑器只认 window.__dshkMermaidLoad，缺了图就退化成代码块。懒加载）
    ['/dsh-kit/vendor/mermaid.min.js', 'mermaid.min.js'],
    // KaTeX 数学公式（vault 阅读态渲染 $...$ / $$...$$；懒加载）
    ['/dsh-kit/vendor/katex.min.js', 'katex.min.js'],
    ['/dsh-kit/vendor/katex.min.css', 'katex.min.css'],
    // pdf.js（知识库自带 PDF 阅读器：解析库 + worker；只在 PDF 签内懒加载）
    ['/dsh-kit/vendor/pdf.min.mjs', 'pdf.min.mjs'],
    ['/dsh-kit/vendor/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
]);
const VENDOR_SUBDIRS = new Map([
    // KaTeX 字体：css 里以 fonts/ 相对路径引用，URL 段固定 fonts，磁盘上隔离在
    // katex_fonts/ 免得和未来其他字体混放
    ['fonts', 'katex_fonts'],
]);
const VENDOR_TYPES = new Map([
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.woff2', 'font/woff2'],
    ['.woff', 'font/woff'],
    ['.ttf', 'font/ttf'],
]);
// ── 浏览器半边日志回传（POST）与最近日志（GET）──
// 客户端文本是外部可写内容：级别按白名单取，组件名/作用域/消息限长净化，字段只收标量。
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const MAX_CLIENT_ENTRIES = 50;
const MAX_MSG = 1000;
const clean = (value, max, fallback) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '') || fallback;
function readJson(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            }
            catch {
                reject(new Error('invalid json'));
            }
        });
        req.on('error', reject);
    });
}
function clientFields(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(raw).slice(0, 8)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            out[clean(key, 24, 'f')] = typeof value === 'string' ? clean(value, 200, '') : value;
        }
    }
    return Object.keys(out).length ? out : undefined;
}
export async function apply(ctx) {
    kitLogStartup();
    // OpenCode Go 会话头按会话注入（实现见 src/core/opencode-session.ts）
    applyOpenCodeSessionHeader(ctx, (m) => kitLogEmit('warn', 'session-header', '', m));
    // webServer 可能在本插件 apply 之后才挂载，用动态注入等它就绪
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => {
            // ── vendor 静态资源 ──
            const disposeVendor = webCtx.webServer.register({
                kind: 'prefix',
                path: '/dsh-kit/vendor',
                handler: (req, res) => {
                    const pathname = new URL(req.url ?? '/', 'http://dsh-kit.local').pathname;
                    const notFound = () => {
                        res.writeHead(404);
                        res.end();
                    };
                    // 子目录资源（KaTeX 字体 fonts/*.woff2 等）：单段文件名白名单字符校验，
                    // 杜绝路径穿越
                    let file;
                    const sub = /^\/dsh-kit\/vendor\/(fonts)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname);
                    if (sub) {
                        file = path.join(VENDOR_SUBDIRS.get(sub[1] ?? '') ?? '', sub[2] ?? '');
                    }
                    else {
                        file = VENDOR_FILES.get(pathname) ?? null;
                    }
                    if (file === null || (req.method !== 'GET' && req.method !== 'HEAD')) {
                        notFound();
                        return;
                    }
                    fs.readFile(path.join(VENDOR_DIR, file), (error, body) => {
                        if (error) {
                            notFound();
                            return;
                        }
                        res.writeHead(200, {
                            'content-type': VENDOR_TYPES.get(path.extname(file)) ?? 'application/octet-stream',
                            'cache-control': 'no-cache',
                        });
                        res.end(req.method === 'HEAD' ? undefined : body);
                    });
                },
            });
            // ── 浏览器半边日志回传 ──
            // 收客户端上报：页面白屏、按钮没反应这类只在浏览器侧的现象，宿主日志一个字都留不下。
            // 查询日志用 pnpm logs / 直接看 kit.log，不另开读端点。
            const disposeLog = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/log',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (!sameOrigin(req)) {
                        json(403, { error: 'forbidden' });
                        return;
                    }
                    if (req.method !== 'POST') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    void readJson(req).then((body) => {
                        const list = Array.isArray(body?.entries) ? body.entries.slice(0, MAX_CLIENT_ENTRIES) : [];
                        for (const item of list) {
                            kitLogEmit(LOG_LEVELS.includes(item?.level ?? '') ? item.level : 'info', clean(item?.component, 24, 'client'), clean(item?.scope, 120, ''), clean(item?.msg, MAX_MSG, ''), clientFields(item?.fields));
                        }
                        json(200, { ok: true });
                    }).catch(() => {
                        json(400, { error: 'bad body' });
                    });
                },
            });
            return () => {
                disposeVendor();
                disposeLog();
            };
        }, 'dsh-kit: vendor endpoints + log endpoints');
    });
}
