// dsh-kit/vault 组件（宿主半边入口）——知识库 · 日程
//
// 能力本体在 ./scanner.ts（VaultScanner：md 目录扫描索引 / wikilink 提取 / 全文
// 搜索，只读）、./fs.ts（树上的新建 / 重命名 / 移动 / 导入 / 删除，删除走回收站）
// 与 ./schedule.ts（日程结构化存储与查询派生）；本文件是组件的装配面：端点、
// 配置与 client 可达性探针。agent 侧不注册工具——日程编辑走技能池的技能。
// 组件行关闭 = 本模块不物化 = 端点全 404，client 半边探到 404 后整体不注册（侧栏
// 索引、右栏知识库/日程签、左栏底部入口钮、对话路径改投全不出现）——行开关就是
// 这块能力的总开关。
// 配置：vaultRoot（知识库根目录绝对路径，留空用默认根）、builtinPdf（库内 PDF
// 走自带阅读器，默认关）；编辑面在插件页本组件行的
// 「配置」。日程存储固定 $DSH_HOME/dsh-kit/schedule/（一条一文件），与知识库根无关，
// 无配置门槛。
//
// 端点（同源校验；webserver 默认只绑 loopback）：
//   GET  /dsh-kit-vault/config      —— 生效配置快照（client 门控与可达性探针：404 = 行关闭）
//   GET  /dsh-kit/vault/index       —— 索引（root / folders / pages / library）
//   GET  /dsh-kit/vault/stat        —— 单文件 mtime/size（外部修改轮询；PDF 阅读器
//                                     拿它当内容身份的一部分）
//   GET  /dsh-kit/vault/search      —— 全文搜索
//   GET  /dsh-kit/vault/file?path=  —— 库内 PDF 原始字节（自带阅读器取数）
//   POST /dsh-kit/vault/create|rename|move|import|delete —— 目录级文件管理
//   POST /dsh-kit/vault/refs    —— 知识集标记与挂载清单（op=set|unmark）
//   POST /dsh-kit/vault/write  —— 正文写回（mtime CAS，不符回 modified）
//   POST /dsh-kit/vault/attach —— 编辑面粘贴的图片进 attachments/（内容寻址）
//   GET  /dsh-kit/schedule/data     —— 事件 + 区间展开 + 独立计时段 + 进行中的计时
//   GET  /dsh-kit/schedule/stats    —— 统计
//   GET  /dsh-kit/schedule/timer    —— 进行中的计时（悬浮球轮询用）
//   POST /dsh-kit/schedule/op       —— 面板写路径（建/改/删/完成/起停表/计时段增改删）
//   GET  /dsh-kit/vendor/{richeditor.bundle,mermaid.min,katex.min,katex.min.css,
//                          pdf.min.mjs,pdf.worker.min.mjs}.js|.mjs|.css
//                                —— 阅读面懒加载的第三方库（pdf.js / TipTap / mermaid /
//                                   KaTeX）与 fonts/ 字体，随本行伺服
// 知识库端点未配置 / 根不存在时回 400 vault-not-configured（前端渲染引导）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadDep, sameOrigin, registerReadableRoot, sendRawFile } from "../core/index.js";
import { registerVendorFiles, registerVendorSubdir } from "../core/vendor-route.js";
import { VaultScanner, defaultVaultRoot } from "./scanner.js";
import { createEntry, renameEntry, moveEntry, importEntry, deleteEntries, parseConflict, setFolderRefs, unmarkFolder, writePage, storeAttachment, resolveInside, } from "./fs.js";
import { syncScheduleStore, isRealDateStr, todayStr } from "./schedule.js";
export const name = 'dsh-kit/vault';
// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用后每次现读。
const schemastery = loadDep('@deepseek-ai/schemastery');
const z = (schemastery?.default ?? schemastery ?? null);
export const Config = z && typeof z.object === 'function'
    ? z.object({
        // vaultRoot = 知识库根目录（绝对路径；schema 默认值 = defaultVaultRoot()，
        // 字段恒有值）。宿主据此提供只读索引 / 搜索端点与文件管理端点，数据契约见
        // ./scanner.ts 头注释；用户显式清空保存为 '' 时由读取侧兜回默认根。
        vaultRoot: z.string().default(defaultVaultRoot()).volatile(),
        // builtinPdf = 库内 PDF 走自带阅读器（client/vendor 的 pdf.js），不走官方
        // 文件右栏：换来页码跳转、阅读位置记忆、且不吃官方 readBytes 的整文件
        // 字节上限。关 = 资料库 PDF 与从前一样开官方预览。
        builtinPdf: z.boolean().default(false).volatile(),
    })
    : undefined;
export async function apply(ctx, config = {}) {
    const defaults = Config ? Config({}) : { vaultRoot: '' };
    // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
    const readRef = (v) => v !== null && typeof v === 'object' && typeof v.get === 'function'
        ? v.get()
        : v;
    const readSettings = () => {
        const out = { ...defaults };
        for (const [key, value] of Object.entries(config ?? {}))
            out[key] = readRef(value);
        return out;
    };
    // ── 日程模块（./schedule.ts）：结构化日程 / 待办 ──
    //   agent 侧不注册工具——日程编辑走技能池的技能（直接改 events/<id>.json）；
    //   面板在 client/bundle.js 的 vaultModule，读写经下面的 /dsh-kit/schedule/* 端点。
    const scheduleStore = syncScheduleStore();
    // ── 知识库扫描器（./scanner.ts）：提到 apply 级——webServer 注入可能重进，
    //   知识库端点块共享同一实例（mtime 缓存也就不用重建）。
    //   vaultRoot 留空用默认根（即开即用）；只读
    const vaultScanner = new VaultScanner(() => {
        try {
            const configured = String(readSettings().vaultRoot ?? '').trim();
            return configured === '' ? defaultVaultRoot() : configured;
        }
        catch {
            return '';
        }
    });
    // 知识库根进「可读根」集合：它在工作区之外，页读与插图都走 files 的 /read 与
    // /raw，端点限根后靠这条放行（根随配置热改，所以提供方现求值不缓存）
    ctx.effect?.(() => registerReadableRoot('vault', () => vaultScanner.root()), 'dsh-kit/vault: readable root');
    // webServer 可能在本组件 apply 之后才挂载，用动态注入等它就绪
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => {
            // ── 阅读面的第三方库：pdf.js / TipTap / mermaid / KaTeX 与字体，跟本行走 ──
            const disposeVendor = registerVendorFiles(webCtx.webServer, new Map([
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
            ]));
            // KaTeX 字体：css 里以 fonts/ 相对路径引用，磁盘上隔离在 katex_fonts/ 免得和
            // 未来其他字体混放
            const disposeVendorFonts = registerVendorSubdir(webCtx.webServer, '/dsh-kit/vendor/fonts', 'katex_fonts');
            // ── 生效配置快照（client 门控与可达性探针）──
            // client 启动拉一次；行关闭时本端点随模块不物化而 404，client 据此整体不注册。
            const disposeConfig = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit-vault/config',
                handler: (req, res) => {
                    if (!sameOrigin(req)) {
                        json(res, 403, { error: 'cross-origin denied' });
                        return;
                    }
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                    res.end(JSON.stringify({
                        vaultRoot: String(readSettings().vaultRoot ?? ''),
                        builtinPdf: readSettings().builtinPdf === true,
                    }));
                },
            });
            const json = (res, code, obj) => {
                res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                res.end(JSON.stringify(obj));
            };
            // 同源校验统一在这一层（Host 回环闸 + Origin 比对，见 core/web-guard.ts）：
            // 本组件的 GET 端点全在这里注册，逐个查必漏；handler 内不再重复校验
            const route = (path, handler) => webCtx.webServer.register({
                kind: 'exact',
                path,
                handler: (req, res) => {
                    if (!sameOrigin(req)) {
                        json(res, 403, { error: 'cross-origin denied' });
                        return;
                    }
                    handler(req, res, new URL(req.url ?? '/', 'http://dsh-kit.local'));
                },
            });
            /** 读请求体（超限回 null = 413）。**超限必须让 promise 落地**：只 destroy
             *  不 resolve 的话 end/error 都不来，这个挂起的 promise 会让请求既不回包
             *  也不释放，调用方只能等客户端超时 */
            const readBody = (req, limit) => new Promise((resolve) => {
                let raw = '';
                let settled = false;
                const done = (value) => {
                    if (settled)
                        return;
                    settled = true;
                    resolve(value);
                };
                req.on('data', (c) => {
                    if (settled)
                        return;
                    raw += c;
                    // 超限：立刻落地（不再攒），由回包那边发 413 后再断流——
                    // 这里就 destroy 的话响应根本发不出去，客户端只看到一个连接重置
                    if (raw.length > limit)
                        done(null);
                });
                req.on('end', () => {
                    if (settled)
                        return;
                    try {
                        const body = JSON.parse(raw === '' ? '{}' : raw);
                        done(body !== null && typeof body === 'object' ? body : {});
                    }
                    catch {
                        done({});
                    }
                });
                req.on('error', () => done({}));
                req.on('aborted', () => done({}));
            });
            // ── 日程端点：/dsh-kit/schedule/*（./schedule.ts 单例 store）──
            //   GET data?from&to → { events(raw 全量), occurrences(区间展开,带 endDate/state),
            //   orphans, runningTimer }；GET stats?scope&date → 统计；GET timer → 进行中的表；
            //   POST op → 面板写路径（同一份 store，agent 工具也走它，规则不分叉）。store 每次
            //   调用都与盘面重新对齐，别处（同步 / 另一个客户端）写进来的条目面板立刻可见、agent 的更新
            //   也不会盖掉别处改过的版本；重复展开只在宿主做（客户端只渲染 occurrence）；
            //   个人规模 raw 全量直发。
            const schedDateParam = (url, key) => {
                const raw = url.searchParams.get(key) ?? '';
                return isRealDateStr(raw) ? raw : todayStr();
            };
            /** 区间跨度上限：重复日程是按天展开的，from=0000-01-01&to=9999-12-31 能把
             *  宿主事件循环占死（手机网关是全路径反代，链接持有人能自己拼这个 URL） */
            const SCHED_MAX_SPAN_DAYS = 400;
            /** 日程写请求体上限：一条事件（含描述 2000 字 + 重复规则）远用不满 */
            const SCHED_BODY_LIMIT = 256 * 1024;
            const schedSpanOk = (from, to) => {
                const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
                return Number.isFinite(span) && span >= 0 && span <= SCHED_MAX_SPAN_DAYS;
            };
            const disposeSchedule = [];
            disposeSchedule.push(route('/dsh-kit/schedule/data', (req, res, url) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                const from = schedDateParam(url, 'from');
                const to = schedDateParam(url, 'to');
                if (!schedSpanOk(from, to))
                    return json(res, 400, { error: `date range too large (max ${SCHED_MAX_SPAN_DAYS} days)` });
                json(res, 200, {
                    events: scheduleStore.list(),
                    occurrences: scheduleStore.occurrences(from, to),
                    orphans: scheduleStore.listOrphans(),
                    runningTimer: scheduleStore.getRunningTimer(),
                });
            }));
            disposeSchedule.push(route('/dsh-kit/schedule/timer', (req, res) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                json(res, 200, { runningTimer: scheduleStore.getRunningTimer() });
            }));
            disposeSchedule.push(route('/dsh-kit/schedule/stats', (req, res, url) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                const rawScope = url.searchParams.get('scope') ?? 'day';
                const scope = rawScope === 'week' || rawScope === 'month' ? rawScope : 'day';
                json(res, 200, scheduleStore.stats(scope, schedDateParam(url, 'date')));
            }));
            // 写端点：面板的建/改/删/完成/计时/计时段编辑都走这一个 op 分发（与 files/
            // git 的 op 端点同款）。字段口径、校验与原子写全在 store 里，与 agent 工具
            // 走的是同一份实现——两边不会长出两套规则。
            // 错误语义：参数/规则不合法（store 抛错）回 400，按 id 定位不到回 404。
            disposeSchedule.push(route('/dsh-kit/schedule/op', (req, res) => {
                if (req.method !== 'POST')
                    return json(res, 405, { error: 'method not allowed' });
                void readBody(req, SCHED_BODY_LIMIT).then((body) => {
                    if (body === null) {
                        json(res, 413, { error: 'body too large' });
                        res.on('finish', () => req.destroy());
                        return;
                    }
                    const str = (v) => (typeof v === 'string' ? v : '');
                    const input = (body.input !== null && typeof body.input === 'object' ? body.input : {});
                    const patch = (body.patch !== null && typeof body.patch === 'object' ? body.patch : {});
                    try {
                        switch (str(body.op)) {
                            case 'create':
                                return json(res, 200, { event: scheduleStore.create(input) });
                            case 'update': {
                                const event = scheduleStore.update(str(body.id), patch);
                                return event ? json(res, 200, { event }) : json(res, 404, { error: '条目不存在' });
                            }
                            case 'delete':
                                return scheduleStore.remove(str(body.id))
                                    ? json(res, 200, { deleted: true })
                                    : json(res, 404, { error: '条目不存在' });
                            case 'done': {
                                const event = scheduleStore.setDone(str(body.id), body.done !== false);
                                return event ? json(res, 200, { event }) : json(res, 404, { error: '条目不存在' });
                            }
                            case 'timer-start':
                                // 挂条目（id 命中）否则按 title 起独立计时；起新表先闭合在跑的那只
                                return json(res, 200, { runningTimer: scheduleStore.startTimer(str(body.id) || null, typeof body.title === 'string' ? body.title : null) });
                            case 'timer-stop':
                                return json(res, 200, { stopped: scheduleStore.stopTimer() });
                            case 'entry-update': {
                                const index = Number(body.index);
                                const entry = Number.isInteger(index) && index >= 0
                                    ? scheduleStore.entryUpdate(str(body.owner) || null, index, {
                                        ...(typeof patch.start === 'string' ? { start: patch.start } : {}),
                                        ...(typeof patch.end === 'string' ? { end: patch.end } : {}),
                                        ...(typeof patch.note === 'string' ? { note: patch.note } : {}),
                                    })
                                    : null;
                                return entry ? json(res, 200, { entry }) : json(res, 400, { error: '计时段不存在、仍在进行中或时刻不合法' });
                            }
                            case 'entry-delete': {
                                const index = Number(body.index);
                                const ok = Number.isInteger(index) && index >= 0 && scheduleStore.entryDelete(str(body.owner) || null, index);
                                return ok ? json(res, 200, { deleted: true }) : json(res, 400, { error: '计时段不存在或仍在进行中' });
                            }
                            default:
                                return json(res, 400, { error: '未知 op' });
                        }
                    }
                    catch (error) {
                        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
                    }
                });
            }));
            // ── 知识库（./scanner.ts + ./fs.ts）──
            // vaultRoot 是配置页配置的绝对目录，在工作区外；读端点出索引 / 单页 mtime /
            // 全文搜索，写端点是目录级文件管理 + 编辑面的正文写回（见下）。根未配置 /
            // 不存在时回 400 vault-not-configured。
            const disposeVault = [];
            const vaultRoute = (path, handler) => {
                disposeVault.push(route(path, handler));
            };
            const vaultGuard = (res) => {
                const root = vaultScanner.root();
                if (root === null) {
                    json(res, 400, { error: 'vault-not-configured' });
                    return null;
                }
                return root;
            };
            vaultRoute('/dsh-kit/vault/index', (req, res) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                const root = vaultGuard(res);
                if (root === null)
                    return;
                void vaultScanner
                    .scan()
                    .then((index) => json(res, 200, index ?? { root: null, folders: [], pages: [] }))
                    .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }));
            });
            // 外部修改实时刷新：只回打开页的 mtime，不读正文——前端轮询发现 mtime 变化
            // 且本地无脏改即自动重读整页（AI / 编辑器改文件零手动刷新）
            vaultRoute('/dsh-kit/vault/stat', (req, res, url) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                const root = vaultGuard(res);
                if (root === null)
                    return;
                const resolved = path.resolve(String(url.searchParams.get('path') ?? ''));
                const rel = path.relative(root, resolved);
                if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '')
                    return json(res, 400, { error: '页面不在 vault 内' });
                try {
                    const stat = fs.statSync(resolved);
                    return json(res, 200, { mtimeMs: stat.mtimeMs, size: stat.size });
                }
                catch {
                    // 文件已被外部删除：回 gone，前端按需重读（页签显示已消失）
                    return json(res, 200, { gone: true });
                }
            });
            // 库内 PDF 原始字节：自带阅读器取数用（builtinPdf 开）。库外一律 400——
            // 准入判据是 resolveInside 的库内判定，不是可读根集合（那是 /dsh-kit/raw 的口径）。
            // 字节上限由 pdf.js 那边兜（见 client 的 PDF_MAX_BYTES），端点不截断。
            vaultRoute('/dsh-kit/vault/file', (req, res, url) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                const root = vaultGuard(res);
                if (root === null)
                    return;
                const fail = (code, msg) => {
                    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
                    res.end(msg);
                };
                let target;
                try {
                    target = resolveInside(root, String(url.searchParams.get('path') ?? ''));
                }
                catch (error) {
                    fail(400, error instanceof Error ? error.message : String(error));
                    return;
                }
                if (path.extname(target).toLowerCase() !== '.pdf') {
                    fail(415, '只发 pdf');
                    return;
                }
                let stat;
                try {
                    stat = fs.statSync(target);
                    if (!stat.isFile()) {
                        fail(404, '不是文件');
                        return;
                    }
                }
                catch {
                    fail(404, '文件不存在');
                    return;
                }
                sendRawFile(req, res, { path: target, size: stat.size, type: 'application/pdf', download: false, fileName: path.basename(target) }, fail);
            });
            vaultRoute('/dsh-kit/vault/search', (req, res, url) => {
                if (req.method !== 'GET')
                    return json(res, 405, { error: 'method not allowed' });
                const root = vaultGuard(res);
                if (root === null)
                    return;
                const q = (url.searchParams.get('q') ?? '').slice(0, 200);
                void vaultScanner
                    .search(q, 20)
                    .then((result) => json(res, 200, result ?? { root, results: [] }))
                    .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }));
            });
            // ── 文件管理端点（./fs.ts）──
            // 面板树上的目录级管理：create / rename / move / import / delete。路径一律
            // 绝对路径且必须落在 vault 根内（resolveInside 拒上跳段并 realpath 比包含，
            // 挡软链与短名绕行）；撞名策略由前端选（skip/overwrite/rename），资料库那一支
            // 固定自动加序号。笔记页改名 / 移动会顺带改写指向它的双链（目录整体搬移不改，
            // 文件名没变解析结果就不变）；删除走回收站。导入两条来源：本机绝对路径直拷
            // （md 页连带把页内引用的本地图片收进 attachments/）与浏览器上传的字节。
            const VAULT_BODY_LIMIT = 1024 * 1024;
            /** 导入上限：base64 文本长度（≈32MB 原始字节），PDF 这类文献够用 */
            const VAULT_IMPORT_LIMIT = 48 * 1024 * 1024;
            const vaultPost = (path, action, limit = VAULT_BODY_LIMIT) => {
                vaultRoute(path, (req, res) => {
                    if (req.method !== 'POST')
                        return json(res, 405, { error: 'method not allowed' });
                    const root = vaultGuard(res);
                    if (root === null)
                        return;
                    void readBody(req, limit).then((body) => {
                        if (body === null) {
                            // 413 先回、再断流：body 没收完，socket 得由回包收尾，否则客户端
                            // 永远等不到响应
                            json(res, 413, { error: 'body too large' });
                            res.on('finish', () => req.destroy());
                            return;
                        }
                        void Promise.resolve()
                            .then(() => action(body, root))
                            .then((result) => json(res, 200, { ok: true, ...result }))
                            .catch((error) => json(res, 400, { error: error instanceof Error ? error.message : String(error) }));
                    });
                });
            };
            vaultPost('/dsh-kit/vault/create', (body, root) => createEntry(root, String(body.dir ?? ''), body.name, body.kind === 'dir' ? 'dir' : 'page'));
            vaultPost('/dsh-kit/vault/rename', async (body, root) => {
                // 双链改写要用**操作前**的页面集合（改完名字旧页已不在索引里，判重名会走偏）
                const index = await vaultScanner.scan();
                return renameEntry(root, String(body.path ?? ''), body.name, index?.pages ?? []);
            });
            vaultPost('/dsh-kit/vault/move', async (body, root) => {
                const index = await vaultScanner.scan();
                return moveEntry(root, String(body.path ?? ''), String(body.dest ?? ''), parseConflict(body.conflict), index?.pages ?? []);
            });
            vaultPost('/dsh-kit/vault/import', async (body, root) => {
                const data = typeof body.dataBase64 === 'string' && body.dataBase64 !== '' ? Buffer.from(body.dataBase64, 'base64') : undefined;
                return importEntry(root, {
                    destAbs: String(body.dest ?? ''),
                    name: body.name,
                    fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
                    srcPath: typeof body.src === 'string' ? body.src : undefined,
                    data,
                    conflict: parseConflict(body.conflict),
                });
            }, VAULT_IMPORT_LIMIT);
            vaultPost('/dsh-kit/vault/delete', async (body, root) => {
                const paths = Array.isArray(body.paths) ? body.paths : [];
                return deleteEntries(root, paths);
            });
            // 知识集：目录体内的 .refs.json 是标记 + 挂载清单（见 fs.ts）。set 全量写回
            // 清单、unmark 删标记；嵌套 / 空目录 / 库根都在 fs.ts 里拦，前端只发动作。
            vaultPost('/dsh-kit/vault/refs', (body, root) => {
                const dir = String(body.dir ?? '');
                if (body.op === 'unmark') {
                    unmarkFolder(root, dir);
                    return { unmarked: true };
                }
                setFolderRefs(root, dir, body.refs);
                return { ok: true };
            });
            // ── 编辑面写端点（./fs.ts）──
            //   write：mtime CAS——盘上不是前端读过的那一版就回 modified，前端出冲突条由人
            //   裁决（覆盖 / 读盘上），插件不静默覆盖也不存档（不碰 git，见知识库页）；
            //   文件已不在回 missing，那次写丢弃（改名 / 删除后卸载兜底不写活旧页）。
            //   attach：粘贴图片内容寻址落 attachments/，同内容复用不重写。
            vaultPost('/dsh-kit/vault/write', (body, root) => writePage(root, String(body.path ?? ''), body.content, body.baseMtime), 
            // 正文上限 1MB + frontmatter 与 JSON 转义余量
            4 * 1024 * 1024);
            vaultPost('/dsh-kit/vault/attach', (body, root) => {
                const data = typeof body.dataBase64 === 'string' && body.dataBase64 !== '' ? Buffer.from(body.dataBase64, 'base64') : null;
                if (data === null)
                    throw new Error('缺少图片内容');
                return storeAttachment(root, data, typeof body.fileName === 'string' ? body.fileName : '');
            }, 32 * 1024 * 1024);
            return () => {
                disposeVendor();
                disposeVendorFonts();
                disposeConfig();
                for (const dispose of disposeSchedule)
                    dispose();
                for (const dispose of disposeVault)
                    dispose();
            };
        }, 'dsh-kit/vault: config/vault/schedule endpoints');
    });
}
