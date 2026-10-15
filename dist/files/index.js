// dsh-kit 文件树组件（宿主半边入口）
//
// 端点家族（本组件自持，路径沿用 /dsh-kit/*——client 半边与官方右栏文件预览
// 已按此路径接线，搬迁不改路径）：GET /dsh-kit/tree 目录树、GET /dsh-kit/read
// 单文件文本（限长 + 二进制探测）、GET /dsh-kit/raw 原始字节（下载/附件预览）、
// POST /dsh-kit/fs/op 文件管理（create/rename/delete，子树校验见
// validate.ts）。
// 另有 GET /dsh-kit-files/config 只读配置快照（client 半边的入口门控与快捷键
// 真源），字段 = 本组件 Config schema。
//
// **读端点限根**（tree/read/raw）：同源调用方不得读根集合之外的文件。根 = 请求
// 带的 `cwd`（工作区，client 半边三个调用点都带）+ 各组件注册的根（知识库
// vaultRoot、技能池根，见 core/readable-roots.ts）。知识库在工作区之外、其图与
// 页读都走这三个端点，所以边界必须是「根集合」而不是「工作区子树」——写端点
// /fs/op 是另一个口径（只管工作区子树），别拿它当读端点的模板。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadDep, decodePreviewText, sameOrigin, recycleDelete, findProjectRoot, readableRoots, withinReadable, sendRawFile } from "../core/index.js";
import { rawContentType, rawDownloadContentType } from "./raw-file.js";
import { validateCwd, validateFile, validateAny, withinTree, invalidFsName } from "./validate.js";
// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用。默认值与
// client 半边 F_CFG_DEFAULTS 逐项同值（两处不同步会出现默认值漂移）。
const schemastery = loadDep('@deepseek-ai/schemastery');
const z = (schemastery?.default ?? schemastery ?? null);
export const Config = z && typeof z.object === 'function'
    ? z.object({
        // 文件树总开关（侧栏文件树与文件打开入口）。纯浏览器端消费，宿主不读
        fileTreeEnabled: z.boolean().default(true).volatile(),
        // 隐藏官方右栏「工作区文件」入口胶囊（纯浏览器端消费，宿主不读）：那只是个
        // 目录按钮，与文件树功能重复；隐藏后文件仍可从对话/文件树/搜索进入
        hideOfficialFilesEntry: z.boolean().default(false).volatile(),
        // 键位不在这里：文件树那条命令在 client 半边注册进宿主 shortcuts 服务
        // （官方「快捷键」页录制与持久化）
    })
    : undefined;
export const name = 'dsh-kit-files';
export function apply(ctx, config = {}) {
    // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
    const defaults = Config
        ? Config({})
        : { fileTreeEnabled: true, hideOfficialFilesEntry: false };
    const readRef = (v) => v !== null && typeof v === 'object' && typeof v.get === 'function'
        ? v.get()
        : v;
    const readSettings = () => {
        const out = { ...defaults };
        for (const [key, value] of Object.entries(config ?? {}))
            out[key] = readRef(value);
        return out;
    };
    const disposers = [];
    ctx.inject(['webServer'], (webCtx) => {
        // ── 组件配置快照端点：GET /dsh-kit-files/config ──
        // client 半边拉它做入口门控与快捷键（各组件行同一口径：200 = 行启用、404 = 行关闭）
        disposers.push(webCtx.webServer.register({
            kind: 'exact',
            path: '/dsh-kit-files/config',
            handler: (req, res) => {
                const json = (code, obj) => {
                    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(obj));
                };
                if (req.method !== 'GET') {
                    json(405, { error: 'method not allowed' });
                    return;
                }
                if (!sameOrigin(req)) {
                    json(403, { error: 'cross-origin denied' });
                    return;
                }
                json(200, readSettings());
            },
        }));
        webCtx.effect(() => {
            /** 读端点的根闸：null = 放行，字符串 = 拒绝理由（写进 403 的 error）。
             *  根集合现求值：cwd 来自请求参数，各组件注册的根随配置/挂载变化。
             *  列目录要 allowRoot——树根本身就是 cwd / 库根，列它才是入口 */
            const readGate = (url, target, allowRoot = false) => {
                const roots = readableRoots(url.searchParams.get('cwd') ?? '');
                return withinReadable(target, roots, allowRoot) ? null : `不在可读根内：${path.basename(target)}`;
            };
            // ── 文件树端点：GET /dsh-kit/tree?path=<绝对目录> ──
            // 只读单层列表（目录+文件，目录在前）。官方 browse RPC（ctx.workspaces
            // .listDirectory）只返回子目录不返回文件，文件树走这里。
            const TREE_LIMIT = 2000;
            const disposeTree = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/tree',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    // 同源校验（无条件）：Host 必须是回环名。GET 不带 Origin，把整条校验包进
                    // 「Origin 非空」里会连 Host 回环闸一起跳过——DNS rebinding 的 GET 正是无
                    // Origin（手机链路经网关重写 Host 为回环，不受影响）
                    if (!sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('path') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
                        return;
                    }
                    const denied = readGate(url, dir.path, true);
                    if (denied !== null) {
                        json(403, { error: denied });
                        return;
                    }
                    fs.readdir(dir.path, { withFileTypes: true }, (error, dirents) => {
                        if (error) {
                            json(404, { error: `读取目录失败：${error?.message ?? error}` });
                            return;
                        }
                        // Dirent 不追符号链接：链接项按文件呈现（点击复制路径不受影响）
                        const entries = dirents.map((d) => ({
                            name: d.name,
                            path: path.join(dir.path, d.name),
                            dir: d.isDirectory(),
                        }));
                        // 目录附 empty 标记（opendir 读一项即关，开销 O(1)）：前端据此对空
                        // 目录去掉展开钮——展开只会得到"（空）"，白点一下还占视觉
                        void Promise.all(entries
                            .filter((e) => e.dir)
                            .map((e) => fs.promises
                            .opendir(e.path)
                            .then(async (it) => {
                            // read 抛错也要关句柄（catch 在外层，漏了这句句柄只能等 GC）
                            try {
                                const first = await it.read();
                                return { path: e.path, empty: first === null };
                            }
                            finally {
                                await it.close().catch(() => { });
                            }
                        })
                            .catch(() => null))).then((probes) => {
                            const emptyMap = new Map(probes.filter((p) => p !== null).map((p) => [p.path, p.empty]));
                            for (const e of entries) {
                                if (e.dir && emptyMap.has(e.path))
                                    e.empty = emptyMap.get(e.path) === true;
                            }
                            entries.sort((a, b) => a.dir === b.dir
                                ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
                                : a.dir
                                    ? -1
                                    : 1);
                            const truncated = entries.length > TREE_LIMIT;
                            json(200, {
                                path: dir.path,
                                entries: truncated ? entries.slice(0, TREE_LIMIT) : entries,
                                truncated,
                            });
                        });
                    });
                },
            });
            // ── 文件内容端点：GET /dsh-kit/read?path=<绝对文件>[&maxBytes=<字节>] ──
            // 只读单文件文本内容（限长 + 二进制探测）。点击文件树中的文件后，
            // 浏览器端把内容展示进右侧 details 列（对话左移让位）。默认只回开头
            // 512KB 供预览；maxBytes 可要到上限——知识库单页编辑器要整篇正文，
            // 半截正文写回会把文件尾部截掉（见 client 的 vaultTooLargeHint）。
            const READ_LIMIT = 512 * 1024;
            const READ_LIMIT_MAX = 1024 * 1024;
            const disposeRead = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/read',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    if (!sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const asked = Number(url.searchParams.get('maxBytes'));
                    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, READ_LIMIT_MAX) : READ_LIMIT;
                    const file = validateFile(url.searchParams.get('path') ?? '');
                    if (!file.ok) {
                        json(400, { error: file.message });
                        return;
                    }
                    const denied = readGate(url, file.path);
                    if (denied !== null) {
                        json(403, { error: denied });
                        return;
                    }
                    if (file.size > limit) {
                        // 大文件也回开头 limit 字节，让预览至少有内容可看
                        fs.open(file.path, 'r', (openError, fd) => {
                            if (openError) {
                                json(404, { error: `读取文件失败：${openError?.message ?? openError}` });
                                return;
                            }
                            const buf = Buffer.alloc(limit);
                            fs.read(fd, buf, 0, limit, 0, (readError, bytesRead) => {
                                fs.close(fd, () => { });
                                if (readError) {
                                    json(404, { error: `读取文件失败：${readError?.message ?? readError}` });
                                    return;
                                }
                                const head = buf.subarray(0, bytesRead);
                                const decoded = decodePreviewText(head, file.path);
                                json(200, {
                                    path: file.path,
                                    size: file.size,
                                    mtimeMs: file.mtimeMs,
                                    truncated: true,
                                    binary: decoded.binary,
                                    content: decoded.content,
                                });
                            });
                        });
                        return;
                    }
                    fs.readFile(file.path, (error, body) => {
                        if (error) {
                            json(404, { error: `读取文件失败：${error?.message ?? error}` });
                            return;
                        }
                        // 文本/二进制判定与解码：BOM 优先（UTF-8/UTF-16 系），无 BOM 含 NUL
                        // 时文本类扩展名按 UTF-16LE 尝试恢复（Windows 常见存法），详见
                        // src/core/text-decode.ts（有单测）
                        const decoded = decodePreviewText(body, file.path);
                        json(200, { path: file.path, size: file.size, mtimeMs: file.mtimeMs, truncated: false, binary: decoded.binary, content: decoded.content });
                    });
                },
            });
            // ── 原始字节端点：GET /dsh-kit/raw?path=<绝对文件>[&dl=1] ──
            // 原始字节透传（官方文件预览头部的「下载到本机」按钮、vault 图片/附件）：
            // 扩展名白名单给 content-type，完整流式返回不截断，支持 Range/206。安全链
            // 与 /read 相同；手机网关是全路径反代，新路径无需单独登记。
            // &dl=1 = 下载模式：任意类型 + attachment，见下。
            const disposeRaw = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/raw',
                handler: (req, res) => {
                    const fail = (code, msg) => {
                        res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(msg);
                    };
                    if (req.method !== 'GET') {
                        fail(405, 'method not allowed');
                        return;
                    }
                    if (!sameOrigin(req)) {
                        fail(403, 'cross-origin denied');
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const file = validateFile(url.searchParams.get('path') ?? '');
                    if (!file.ok) {
                        fail(400, file.message);
                        return;
                    }
                    const denied = readGate(url, file.path);
                    if (denied !== null) {
                        fail(403, denied);
                        return;
                    }
                    // 白名单是给「能不能在浏览器里渲染」收的口，下载不适用：dl 模式下任意
                    // 类型都以 octet-stream 发 attachment 由浏览器落盘（iOS 不认 <a download>，
                    // 只有 Content-Disposition 可靠）
                    const download = url.searchParams.has('dl');
                    const type = download ? rawDownloadContentType(file.path) : rawContentType(file.path);
                    if (type === null) {
                        fail(415, `不支持的类型：${path.extname(file.path) || '(无扩展名)'}`);
                        return;
                    }
                    sendRawFile(req, res, { path: file.path, size: file.size, type, download, fileName: path.basename(file.path) }, fail);
                },
            });
            // ── 文件管理端点：POST /dsh-kit/fs/op ──
            // body {cwd, op, ...}，供文件树的新建/重命名/删除：
            //   create {dir, name, kind?:'dir'}  在 dir 下新建空文件/文件夹（已存在报错）
            //   rename {path, name}              同目录内重命名（目标已存在报错）
            //   delete {path}                    删除；Windows 移入回收站，其它平台直接递归删。
            //                                    破坏性操作，前端已二次确认。
            // 校验链：sameOrigin → 目标必须位于 realpath(cwd) 子树内
            // （工作区根本身不可改删）→ 名称过 invalidFsName 校验。
            const disposeFsOp = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/fs/op',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'POST') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    if (!sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    let raw = '';
                    let tooLarge = false;
                    req.on('data', (c) => {
                        if (tooLarge)
                            return;
                        raw += c;
                        if (raw.length > 65536) {
                            // 先回 413 再断流：只 destroy 的话客户端只看到连接重置，拿不到原因
                            tooLarge = true;
                            json(413, { error: 'body too large' });
                            res.on('finish', () => req.destroy());
                        }
                    });
                    req.on('end', async () => {
                        if (tooLarge)
                            return;
                        let body;
                        try {
                            body = JSON.parse(raw);
                        }
                        catch {
                            json(400, { error: 'bad json' });
                            return;
                        }
                        const dir = validateCwd(String(body?.cwd ?? ''));
                        if (!dir.ok) {
                            json(400, { error: dir.message });
                            return;
                        }
                        const op = String(body?.op ?? '');
                        if (op === 'create') {
                            const pdir = validateCwd(String(body?.dir ?? ''));
                            if (!pdir.ok) {
                                json(400, { error: pdir.message });
                                return;
                            }
                            // 新建的父目录允许就是工作区根本身（与改名/删除的 withinTree 不同）
                            const relDir = path.relative(dir.path, pdir.path);
                            if (relDir.startsWith('..') || path.isAbsolute(relDir)) {
                                json(400, { error: '目标目录不在当前工作区内' });
                                return;
                            }
                            if (invalidFsName(body?.name)) {
                                json(400, { error: '名称非法：不能为空、含路径分隔符/特殊字符或首尾空白' });
                                return;
                            }
                            const name = String(body.name).trim();
                            const target = path.join(pdir.path, name);
                            let existed = true;
                            try {
                                fs.statSync(target);
                            }
                            catch {
                                existed = false;
                            }
                            if (existed) {
                                json(400, { error: `已存在：${name}` });
                                return;
                            }
                            if (body.kind === 'dir') {
                                fs.mkdir(target, (mkError) => {
                                    if (mkError) {
                                        json(500, { error: `创建文件夹失败：${mkError?.message ?? mkError}` });
                                        return;
                                    }
                                    json(200, { ok: true, path: target });
                                });
                            }
                            else {
                                fs.writeFile(target, '', { flag: 'wx' }, (wError) => {
                                    if (wError) {
                                        json(500, { error: `创建文件失败：${wError?.message ?? wError}` });
                                        return;
                                    }
                                    json(200, { ok: true, path: target });
                                });
                            }
                            return;
                        }
                        const target = validateAny(String(body?.path ?? ''));
                        if (!target.ok) {
                            json(400, { error: target.message });
                            return;
                        }
                        if (!withinTree(dir.path, target.path)) {
                            json(400, { error: '目标不在当前工作区内' });
                            return;
                        }
                        if (op === 'rename') {
                            if (invalidFsName(body?.name)) {
                                json(400, { error: '名称非法：不能为空、含路径分隔符/特殊字符或首尾空白' });
                                return;
                            }
                            const name = String(body.name).trim();
                            const renamed = path.join(path.dirname(target.path), name);
                            // 只改大小写不算冲突：不敏感文件系统上 statSync(renamed) 命中的是源文件
                            // 自己（大小写敏感的系统本来也走不到这支，rename 照样成立）
                            const caseOnly = renamed.toLowerCase() === target.path.toLowerCase();
                            let clash = false;
                            if (!caseOnly) {
                                try {
                                    fs.statSync(renamed);
                                    clash = true;
                                }
                                catch { }
                            }
                            if (clash) {
                                json(400, { error: `目标已存在：${name}` });
                                return;
                            }
                            fs.rename(target.path, renamed, (rError) => {
                                if (rError) {
                                    json(500, { error: `重命名失败：${rError?.message ?? rError}` });
                                    return;
                                }
                                json(200, { ok: true, path: renamed });
                            });
                            return;
                        }
                        if (op === 'delete') {
                            const gone = await recycleDelete(target.path);
                            if (!gone) {
                                if (process.platform !== 'win32') {
                                    // 无回收站 API 的平台：退回直接删除
                                    try {
                                        await fs.promises.rm(target.path, { recursive: true });
                                    }
                                    catch (dError) {
                                        json(500, { error: `删除失败：${dError instanceof Error ? dError.message : dError}` });
                                        return;
                                    }
                                }
                                else {
                                    json(500, { error: '移入回收站失败（文件可能被占用或路径过长）' });
                                    return;
                                }
                            }
                            json(200, { ok: true });
                            return;
                        }
                        json(400, { error: 'unknown op' });
                    });
                },
            });
            return () => {
                for (const dispose of disposers)
                    dispose();
                disposeTree();
                disposeRead();
                disposeRaw();
                disposeFsOp();
            };
        });
    });
}
