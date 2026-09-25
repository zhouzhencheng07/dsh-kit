// dsh-kit 文件树与源代码管理组件（宿主半边入口）
//
// 端点家族（本组件自持，路径沿用 /dsh-kit/*——client 半边与官方右栏文件预览
// 已按此路径接线，搬迁不改路径）：GET /dsh-kit/tree 目录树、GET /dsh-kit/read
// 单文件文本（限长 + 二进制探测）、GET /dsh-kit/raw 原始字节（下载/附件预览）、
// POST /dsh-kit/fs/op 文件管理（create/rename/move/delete，子树校验见
// validate.ts）、git 联动端点（status/log/graph/branch/commit/diff）。
// 另有 GET /dsh-kit-files/config 只读配置快照（client 半边的入口门控与快捷键
// 真源），字段 = 本组件 Config schema。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { decodePreviewText, sameOrigin, recycleDelete, findProjectRoot } from "../core/index.js";
import { parseStatusBranch, parseLogRecords, parseBranchList, parseTrack } from "./git.js";
import { rawContentType, rawDownloadContentType, rawDisposition, parseRangeHeader } from "./raw-file.js";
import { validateCwd, validateFile, validateAny, validatePathShape, withinTree, invalidFsName } from "./validate.js";
/**
 * 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录），loadDep 的
 * 第三锚点用。非 DSH 环境返回 null。
 */
function findMonorepoRoot() {
    const anchor = process.argv[1];
    if (!anchor)
        return null;
    const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor);
    let dir = path.dirname(abs);
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/** 多锚点加载宿主运行时依赖（schemastery，不在本包 dependencies 里），同主包口径 */
function loadDep(spec) {
    try {
        return require(spec);
    }
    catch {
        // 落到后续锚点
    }
    const anchor = process.argv[1];
    if (anchor) {
        const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor);
        try {
            return createRequire(abs)(spec);
        }
        catch {
            // 落到 monorepo store
        }
    }
    const root = findMonorepoRoot();
    if (root) {
        const pnpm = path.join(root, 'node_modules', '.pnpm');
        if (fs.existsSync(pnpm)) {
            let entries = [];
            try {
                entries = fs.readdirSync(pnpm);
            }
            catch {
                /* ignore */
            }
            for (const e of entries) {
                if (!(e === spec + '@' || e.startsWith(spec + '@')))
                    continue;
                const pkgJson = path.join(pnpm, e, 'node_modules', spec, 'package.json');
                if (!fs.existsSync(pkgJson))
                    continue;
                try {
                    return createRequire(pkgJson)(spec);
                }
                catch {
                    // 试下一个候选版本
                }
            }
        }
    }
    return null;
}
// ── 组件设置 schema（0.1.7 声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用。默认值与
// client 半边 F_CFG_DEFAULTS 逐项同值（两处不同步会出现默认值漂移）。
const schemastery = loadDep('@deepseek-ai/schemastery');
const z = (schemastery?.default ?? schemastery ?? null);
export const Config = z && typeof z.object === 'function'
    ? z.object({
        // 文件树总开关（侧栏文件树与文件打开入口）。纯浏览器端消费，宿主不读
        fileTreeEnabled: z.boolean().default(true).volatile(),
        // 源代码管理签（状态/差异/提交图谱/分支）总开关
        sourceControlEnabled: z.boolean().default(true).volatile(),
        // 隐藏官方右栏「工作区文件」入口胶囊（纯浏览器端消费，宿主不读）：那只是个
        // 目录按钮，与文件树功能重复；隐藏后文件仍可从对话/文件树/搜索进入
        hideOfficialFilesEntry: z.boolean().default(false).volatile(),
        // 键位不在这里：文件树/源代码管理两条命令在 client 半边注册进宿主
        // shortcuts 服务（官方「快捷键」页录制与持久化）
    })
    : undefined;
export const name = 'dsh-kit-files';
export function apply(ctx, config = {}) {
    // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
    const defaults = Config
        ? Config({})
        : { fileTreeEnabled: true, sourceControlEnabled: true, hideOfficialFilesEntry: false };
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
        // client 半边拉它做入口门控与快捷键（同 root 的 /dsh-kit/config 口径）
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
                if (typeof req.headers.origin === 'string' && req.headers.origin !== '' && !sameOrigin(req)) {
                    json(403, { error: 'cross-origin denied' });
                    return;
                }
                json(200, readSettings());
            },
        }));
        webCtx.effect(() => {
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
                    // 同源校验：同源 fetch 的 GET 可能不带 Origin（浏览器行为），带了就必须匹配 Host；
                    // webserver 本身只绑 loopback，这里防的是其它本地页面跨源探测。
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('path') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
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
                            const first = await it.read();
                            await it.close();
                            return { path: e.path, empty: first === null };
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
            // ── 文件内容端点：GET /dsh-kit/read?path=<绝对文件> ──
            // 只读单文件文本内容（限长 + 二进制探测）。点击文件树中的文件后，
            // 浏览器端把内容展示进右侧 details 列（对话左移让位）。
            const READ_LIMIT = 512 * 1024;
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
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const file = validateFile(url.searchParams.get('path') ?? '');
                    if (!file.ok) {
                        json(400, { error: file.message });
                        return;
                    }
                    if (file.size > READ_LIMIT) {
                        // 大文件也回开头 512KB，让预览至少有内容可看
                        fs.open(file.path, 'r', (openError, fd) => {
                            if (openError) {
                                json(404, { error: `读取文件失败：${openError?.message ?? openError}` });
                                return;
                            }
                            const buf = Buffer.alloc(READ_LIMIT);
                            fs.read(fd, buf, 0, READ_LIMIT, 0, (readError, bytesRead) => {
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
                        // src/text-decode.ts（有单测）
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
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        fail(403, 'cross-origin denied');
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const file = validateFile(url.searchParams.get('path') ?? '');
                    if (!file.ok) {
                        fail(400, file.message);
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
                    const headers = {
                        'content-type': type,
                        'cache-control': download ? 'no-store' : 'no-cache',
                        'accept-ranges': 'bytes',
                        'x-content-type-options': 'nosniff',
                        // CSP sandbox：raw 内容以文档形态打开（新标签/iframe）时进不透明源、
                        // 脚本不执行——svg 内嵌脚本是存储型 XSS 面（img/fetch 取字节不受影响）
                        'content-security-policy': 'sandbox',
                        // 编码文件名：浏览器标题 / 另存名取这里，中文不乱码
                        'content-disposition': rawDisposition(download, path.basename(file.path)),
                    };
                    const range = parseRangeHeader(req.headers.range, file.size);
                    if (range === null) {
                        res.writeHead(416, { ...headers, 'content-range': `bytes */${file.size}` });
                        res.end();
                        return;
                    }
                    let stream;
                    try {
                        stream = fs.createReadStream(file.path, range !== undefined ? { start: range.start, end: range.end } : {});
                    }
                    catch (error) {
                        fail(404, `读取文件失败：${error instanceof Error ? error.message : error}`);
                        return;
                    }
                    stream.on('error', (error) => {
                        // 头已发出（流中途失败）只能掐断连接；否则还来得及回 404
                        if (res.headersSent) {
                            res.destroy();
                            return;
                        }
                        fail(404, `读取文件失败：${error?.message ?? error}`);
                    });
                    if (range !== undefined) {
                        res.writeHead(206, {
                            ...headers,
                            'content-range': `bytes ${range.start}-${range.end}/${file.size}`,
                            'content-length': String(range.end - range.start + 1),
                        });
                    }
                    else {
                        res.writeHead(200, { ...headers, 'content-length': String(file.size) });
                    }
                    stream.pipe(res);
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
                    req.on('data', (c) => {
                        raw += c;
                        if (raw.length > 65536)
                            req.destroy();
                    });
                    req.on('end', async () => {
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
                            let clash = false;
                            try {
                                fs.statSync(renamed);
                                clash = true;
                            }
                            catch { }
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
            // ── git 联动端点 ──
            // spawn git CLI（不引库）；无 git / 非仓库 / 超时统一回 {available:false}，
            // 前端据此隐藏入口。status 供文件树徽标与分支/领先信息，diff 供预览面板
            // 查看改动，log/show/branch 供提交图谱与分支管理，init/op 是写操作集。
            const GIT_TIMEOUT = 10000;
            /** 推送等网络操作允许更长的等待（默认 10s 会误杀慢推） */
            const PUSH_TIMEOUT = 60000;
            /** 跑一条 git 命令；任何失败（ENOENT/非零/超时）都 resolve {ok:false} */
            const runGit = (args, cwdDir, timeoutMs = GIT_TIMEOUT) => new Promise((resolve) => {
                let child;
                try {
                    child = spawn('git', args, { cwd: cwdDir, windowsHide: true });
                }
                catch {
                    resolve({ ok: false, out: '', err: '' });
                    return;
                }
                let out = '';
                let err = '';
                let settled = false;
                const timer = setTimeout(() => {
                    try {
                        child.kill();
                    }
                    catch { }
                    finish(false);
                }, timeoutMs);
                const finish = (ok) => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timer);
                    resolve({ ok, out, err });
                };
                child.stdout?.on('data', (d) => {
                    out += d;
                });
                child.stderr?.on('data', (d) => {
                    err += d;
                });
                child.on('error', () => finish(false));
                child.on('close', (code) => finish(code === 0));
            });
            /** cwd 的 git 项目根；非仓库返回 null */
            const gitRootFor = (realCwd) => {
                const root = findProjectRoot(realCwd);
                try {
                    return fs.existsSync(path.join(root, '.git')) ? root : null;
                }
                catch {
                    return null;
                }
            };
            // GET /dsh-kit/git/status?cwd=<绝对目录> →
            //   {available:true, root, entries:[{xy,path:<相对root>,abs}]} | {available:false}
            const disposeGitStatus = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/status',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('cwd') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
                        return;
                    }
                    const root = gitRootFor(dir.path);
                    if (!root) {
                        json(200, { available: false });
                        return;
                    }
                    ;
                    (async () => {
                        // core.quotePath=false：porcelain 对非 ASCII 路径默认输出带引号的八进制
                        // 转义（如 "\346\234\233..."），关掉后输出原始 UTF-8 路径
                        const r = await runGit(['-c', 'core.quotePath=false', 'status', '--porcelain', '-b'], root);
                        if (!r.ok) {
                            json(200, { available: false });
                            return;
                        }
                        const entries = [];
                        const untrackedDirs = [];
                        // -b 的首行是分支摘要（## main...origin/main [ahead 1]），单独解析；
                        // 其余行不会出现 "##" 前缀（条目 xy 至多两位），不干扰条目解析
                        const branchInfo = { branch: '', upstream: null, ahead: 0, behind: 0, gone: false, detached: false, unborn: false };
                        for (const line of r.out.split('\n')) {
                            if (line.startsWith('##')) {
                                Object.assign(branchInfo, parseStatusBranch(line));
                                continue;
                            }
                            if (line.length <= 3)
                                continue;
                            const xy = line.slice(0, 2);
                            let p = line.slice(3).trimEnd();
                            // 重命名行取 "old -> new" 的新路径
                            const arrow = p.indexOf(' -> ');
                            if (arrow >= 0)
                                p = p.slice(arrow + 4);
                            // 整个目录未跟踪时 porcelain 只给 '?? dir/'——展开为其中的具体文件，
                            // 否则前端会拿目录路径去当文件预览/diff（报"不是文件"）
                            if (xy === '??' && /[\\/]$/.test(p)) {
                                untrackedDirs.push(p.replace(/[\\/]+$/, ''));
                                continue;
                            }
                            entries.push({ xy, path: p, abs: path.join(root, p) });
                        }
                        if (untrackedDirs.length > 0) {
                            const u = await runGit(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '--', ...untrackedDirs], root);
                            if (u.ok) {
                                for (const f of u.out.split('\n')) {
                                    const relFile = f.trim();
                                    if (relFile === '')
                                        continue;
                                    entries.push({ xy: '??', path: relFile, abs: path.join(root, relFile) });
                                }
                            }
                        }
                        // ±N 行数统计：一次 numstat 相对 HEAD 合并进条目（未跟踪文件不在其中，
                        // 无统计；二进制行为 "- - path" 跳过；重命名路径格式特殊，允许缺失）
                        const n = await runGit(['-c', 'core.quotePath=false', 'diff', 'HEAD', '--numstat'], root);
                        if (n.ok) {
                            const statMap = new Map();
                            for (const line of n.out.split('\n')) {
                                const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
                                if (!m || m[1] === '-' || m[2] === '-')
                                    continue;
                                statMap.set(m[3], { a: Number(m[1]), d: Number(m[2]) });
                            }
                            for (const e of entries)
                                e.stats = statMap.get(e.path) ?? null;
                        }
                        json(200, { available: true, root, entries, ...branchInfo });
                    })();
                },
            });
            // GET /dsh-kit/git/diff?path=<绝对文件>&cwd=<工作目录>[&commit=<提交引用>] →
            //   {available:true, diff:<原文>}——基线为 git diff HEAD，即相对上次提交的
            //   全部未提交改动（含已暂存）；未跟踪 {available:true, untracked:true}；
            //   无变更 {available:true, clean:true}。path 不做存在性校验（validatePathShape）：
            //   已删除文件的删除 diff 是合法产物（git diff HEAD 支持），预览面板靠它
            //   展示"仅 diff"视图。
            //   带 commit 参数 = 提交钉定模式（图谱提交详情点文件）：基线是该提交的
            //   第一父（根提交由 --root 对空树，merge 默认无 patch），显示该提交对本
            //   文件的改动；返回 {available:true, commitMode:true, base:<父短哈希|"">,
            //   diff}。该提交里被列出的文件必然有 patch（清单与 diff 同源 diff-tree）。
            const disposeGitDiff = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/diff',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('cwd') ?? '');
                    const file = validatePathShape(url.searchParams.get('path') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
                        return;
                    }
                    if (!file.ok) {
                        json(400, { error: file.message });
                        return;
                    }
                    const root = gitRootFor(dir.path);
                    if (!root) {
                        json(200, { available: false });
                        return;
                    }
                    const rel = path.relative(root, file.path);
                    if (rel.startsWith('..') || path.isAbsolute(rel)) {
                        json(400, { error: '文件不在项目根内' });
                        return;
                    }
                    const commitRaw = String(url.searchParams.get('commit') ?? '').trim();
                    if (commitRaw !== '') {
                        if (commitRaw.length > 200 || /[\u0000-\u001f]/.test(commitRaw)) {
                            json(400, { error: '提交引用非法' });
                            return;
                        }
                        runGit(['rev-parse', '--verify', '--quiet', `${commitRaw}^{commit}`], root).then((rv) => {
                            const full = rv.ok ? rv.out.trim() : '';
                            if (!/^[0-9a-f]{40}$/.test(full)) {
                                json(400, { error: '提交不存在：' + commitRaw });
                                return;
                            }
                            // 父哈希只用于顶部基线说明；diff 本体走 diff-tree -p --root（对根提交
                            // 自动取空树、对 merge 默认无输出），与详情清单同源同语义
                            runGit(['rev-list', '--parents', '-n', '1', full], root).then((pl) => {
                                const parent = pl.ok && typeof pl.out === 'string' ? (pl.out.trim().split(' ')[1] ?? '') : '';
                                runGit(['-c', 'core.quotePath=false', 'diff-tree', '--root', '-p', '--no-commit-id', full, '--', rel], root).then((d) => {
                                    const patch = d.ok ? d.out : null;
                                    const base = parent !== '' ? parent.slice(0, 7) : '';
                                    // 二进制 patch 没有可叠着色的文本新像，直接不取 blob
                                    if (patch === null || /GIT binary patch|^Binary files /m.test(patch)) {
                                        json(200, { available: true, commitMode: true, base, diff: patch });
                                        return;
                                    }
                                    // 新像 = 该提交时刻的文件内容，供前端复用全文件着色视图；
                                    // 取不到（该提交删除了此文件）标 blobMissing 走纯红删除视图；
                                    // 超 1MB 不取（前端回落原始 patch，避免大内容白拉）
                                    runGit(['-c', 'core.quotePath=false', 'show', `${full}:${rel.replace(/\\/g, '/')}`], root).then((blob) => {
                                        const text = blob.ok && typeof blob.out === 'string' && blob.out.length > 0 && blob.out.length <= 1024 * 1024
                                            ? blob.out
                                            : null;
                                        if (text !== null) {
                                            json(200, { available: true, commitMode: true, base, diff: patch, content: text });
                                            return;
                                        }
                                        if (!blob.ok) {
                                            // blob 读不出来 = 该提交时刻不存在此文件（删除/路径变形）
                                            json(200, { available: true, commitMode: true, base, diff: patch, blobMissing: true });
                                            return;
                                        }
                                        json(200, { available: true, commitMode: true, base, diff: patch });
                                    });
                                });
                            });
                        });
                        return;
                    }
                    runGit(['status', '--porcelain', '--', rel], root).then((st) => {
                        if (!st.ok) {
                            json(200, { available: false });
                            return;
                        }
                        const line = st.out.split('\n').find((l) => l.length > 3);
                        if (!line) {
                            json(200, { available: true, clean: true });
                            return;
                        }
                        if (line.startsWith('?')) {
                            json(200, { available: true, untracked: true });
                            return;
                        }
                        runGit(['-c', 'core.quotePath=false', 'diff', 'HEAD', '--', rel], root).then((d) => {
                            json(200, { available: true, xy: line.slice(0, 2), diff: d.ok ? d.out : null });
                        });
                    });
                },
            });
            // POST /dsh-kit/git/init {cwd}：在目录初始化仓库（仅当尚无 .git 时执行；
            // 已是仓库则幂等返回 created:false）。供源代码管理视图的空态按钮使用。
            const disposeGitInit = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/init',
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
                    req.on('data', (c) => {
                        raw += c;
                        if (raw.length > 4096)
                            req.destroy();
                    });
                    req.on('end', async () => {
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
                        if (gitRootFor(dir.path)) {
                            json(200, { created: false, root: dir.path });
                            return;
                        }
                        const r = await runGit(['init'], dir.path);
                        if (!r.ok) {
                            json(500, { error: `git init 失败：${r.err || r.out || 'unknown'}` });
                            return;
                        }
                        json(200, { created: true, root: dir.path });
                    });
                },
            });
            // POST /dsh-kit/git/op {cwd, op, path?, message?, all?, ...}：源代码管理的写操作集
            //   stage(path)      = git add -- <rel>
            //   unstage(path)    = git restore --staged -- <rel>
            //   discard(path)    = git restore -- <rel>（放弃未暂存改动，破坏性；前端已二次确认）
            //   stageAll         = git add -A
            //   commit(message, all?) = 可选先 add -A（暂存区为空时的"提交全部"），再 commit -m
            //   push(upstream?, remote?, force?) = git push（upstream:true → push -u <remote> <当前分支>；
            //     force:true → --force，前端在 push 被 reject 询问「以本地为准」后重推用）
            //   pull = git pull（网络操作，PUSH_TIMEOUT 长超时）
            //   branchCreate(name, switch?) = git branch <name> 或 git switch -c <name>
            //   branchSwitch(name) = git switch <name>
            //   branchDelete(name, force?) = git branch -d|-D <name>（当前分支拒绝）
            // 分支名一律作为单个 argv 元素传入（无 shell 注入面）并经
            // git check-ref-format --branch 校验；push 网络操作走 PUSH_TIMEOUT 长超时。
            const disposeGitOp = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/op',
                handler: async (req, res) => {
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
                    req.on('data', (c) => {
                        raw += c;
                        if (raw.length > 65536)
                            req.destroy();
                    });
                    req.on('end', async () => {
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
                        const root = gitRootFor(dir.path);
                        if (!root) {
                            json(400, { error: '不是 git 仓库' });
                            return;
                        }
                        const op = String(body?.op ?? '');
                        const pathOp = op === 'stage' || op === 'unstage' || op === 'discard';
                        let rel = '';
                        if (pathOp) {
                            const file = validateFile(String(body?.path ?? ''));
                            if (!file.ok) {
                                json(400, { error: file.message });
                                return;
                            }
                            rel = path.relative(root, file.path);
                            if (rel.startsWith('..') || path.isAbsolute(rel)) {
                                json(400, { error: '文件不在项目根内' });
                                return;
                            }
                        }
                        let r;
                        if (op === 'stage')
                            r = await runGit(['add', '--', rel], root);
                        else if (op === 'unstage')
                            r = await runGit(['restore', '--staged', '--', rel], root);
                        else if (op === 'discard')
                            r = await runGit(['restore', '--', rel], root);
                        else if (op === 'stageAll')
                            r = await runGit(['add', '-A'], root);
                        else if (op === 'commit') {
                            const msg = String(body?.message ?? '').trim();
                            if (msg === '') {
                                json(400, { error: '缺少提交信息' });
                                return;
                            }
                            if (body.all === true)
                                await runGit(['add', '-A'], root);
                            r = await runGit(['commit', '-m', msg], root);
                            if (!r.ok && /nothing to commit/i.test(r.err + r.out)) {
                                json(200, { ok: true, empty: true });
                                return;
                            }
                        }
                        else if (op === 'push') {
                            // 默认沿用分支已有上游（git push）；upstream:true 显式设置上游，
                            // remote 缺省 origin 且必须在 git remote 列表内（防乱传参）；
                            // force:true → --force 无条件覆盖远程（只由前端冲突确认触发，接口本身不校验）
                            const force = body.force === true;
                            if (body.upstream === true) {
                                const remote = String(body?.remote ?? 'origin').trim();
                                if (remote === '' || /[/\\]/.test(remote) || remote.includes('..')) {
                                    json(400, { error: '远程名非法' });
                                    return;
                                }
                                const rem = await runGit(['remote'], root);
                                if (!rem.ok || !rem.out.split('\n').map((s) => s.trim()).includes(remote)) {
                                    json(400, { error: `没有远程 ${remote}（git remote -v 查看，git remote add 新建）` });
                                    return;
                                }
                                const cur = await runGit(['branch', '--show-current'], root);
                                const branch = cur.ok ? cur.out.trim() : '';
                                if (branch === '') {
                                    json(400, { error: '当前不在任何分支上（分离头无法设置上游）' });
                                    return;
                                }
                                r = await runGit(force ? ['push', '--force', '-u', remote, branch] : ['push', '-u', remote, branch], root, PUSH_TIMEOUT);
                            }
                            else {
                                r = await runGit(force ? ['push', '--force'] : ['push'], root, PUSH_TIMEOUT);
                            }
                        }
                        else if (op === 'pull') {
                            // 网络操作同 push 走长超时；缺上游等错误原文透出（前端 toast 展示）
                            r = await runGit(['pull'], root, PUSH_TIMEOUT);
                        }
                        else if (op === 'branchCreate' || op === 'branchSwitch' || op === 'branchDelete') {
                            const name = String(body?.name ?? '').trim();
                            if (name === '') {
                                json(400, { error: '缺少分支名' });
                                return;
                            }
                            const v = await runGit(['check-ref-format', '--branch', name], root);
                            if (!v.ok) {
                                json(400, { error: `分支名非法：${name}` });
                                return;
                            }
                            if (op === 'branchCreate') {
                                if (body.switch === true)
                                    r = await runGit(['switch', '-c', name], root);
                                else
                                    r = await runGit(['branch', name], root);
                            }
                            else if (op === 'branchSwitch') {
                                r = await runGit(['switch', name], root);
                            }
                            else {
                                const cur = await runGit(['branch', '--show-current'], root);
                                if (cur.ok && cur.out.trim() === name) {
                                    json(400, { error: '不能删除当前所在分支' });
                                    return;
                                }
                                r = await runGit(['branch', body.force === true ? '-D' : '-d', name], root);
                            }
                        }
                        else {
                            json(400, { error: 'unknown op' });
                            return;
                        }
                        if (!r.ok) {
                            json(500, { error: `git ${op} 失败：${(r.err || r.out || '').trim()}` });
                            return;
                        }
                        json(200, { ok: true });
                    });
                },
            });
            // GET /dsh-kit/git/log?cwd=<绝对目录>&n=<条数>&skip=<偏移> → 提交图谱
            //   {available:true, root, records:[{H,h,p,an,at,s,d}], hasMore} | {available:false}
            //   结构化提交记录（p=父哈希数组，图谱 lane 由前端从 p 计算，宿主不做几何）；
            //   refs 面=HEAD+分支+标签+远端（不含 stash，噪声线少）；--topo-order 保证
            //   子先于父（前端 lane 分配依赖该顺序）；n 默认 120、上限 500；skip 翻页；
            //   hasMore=max-count 取 n+1 条探得（截到 n 返回）。空库 → records:[]。
            const LOG_DEFAULT = 120;
            const LOG_MAX = 500;
            const disposeGitLog = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/log',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('cwd') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
                        return;
                    }
                    const root = gitRootFor(dir.path);
                    if (!root) {
                        json(200, { available: false });
                        return;
                    }
                    let n = Number(url.searchParams.get('n') ?? LOG_DEFAULT);
                    if (!Number.isInteger(n) || n < 1)
                        n = LOG_DEFAULT;
                    if (n > LOG_MAX)
                        n = LOG_MAX;
                    let skip = Number(url.searchParams.get('skip') ?? 0);
                    if (!Number.isInteger(skip) || skip < 0)
                        skip = 0;
                    if (skip > 100000)
                        skip = 100000;
                    runGit(['-c', 'core.quotePath=false', 'log', 'HEAD', '--branches', '--tags', '--remotes', '--topo-order',
                        `--skip=${skip}`, `--max-count=${n + 1}`,
                        '--pretty=format:%H%x1f%P%x1f%h%x1f%an%x1f%at%x1f%s%x1f%D%x1e'], root).then((r) => {
                        if (!r.ok) {
                            // 空库不是错误：git log 报 "does not have any commits yet"
                            if (/does not have any commits/i.test(r.err + r.out)) {
                                json(200, { available: true, root, records: [], hasMore: false });
                                return;
                            }
                            json(200, { available: false });
                            return;
                        }
                        const all = parseLogRecords(r.out);
                        const hasMore = all.length > n;
                        json(200, { available: true, root, records: all.slice(0, n), hasMore });
                    });
                },
            });
            // GET /dsh-kit/git/show?cwd=<绝对目录>&commit=<哈希/引用> → 单个提交详情
            //   {available:true, meta:{H,h,an,ae,ad,parents,s,b}, files:[{st,path,abs}]}
            //   files 来自 diff-tree --name-status（合并提交无文件清单）；commit 先经
            //   rev-parse 校验，伪造/不存在回 400。
            const disposeGitShow = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/show',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('cwd') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
                        return;
                    }
                    const root = gitRootFor(dir.path);
                    if (!root) {
                        json(200, { available: false });
                        return;
                    }
                    const commit = String(url.searchParams.get('commit') ?? '').trim();
                    if (commit === '' || commit.length > 200 || /[\u0000-\u001f]/.test(commit)) {
                        json(400, { error: '缺少合法的提交引用' });
                        return;
                    }
                    runGit(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], root).then((rv) => {
                        const full = rv.ok ? rv.out.trim() : '';
                        if (!/^[0-9a-f]{40}$/.test(full)) {
                            json(400, { error: '提交不存在：' + commit });
                            return;
                        }
                        Promise.all([
                            runGit(['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%P%x1f%s%x1f%b', full], root),
                            runGit(['-c', 'core.quotePath=false', 'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', full], root),
                        ]).then(([show, dt]) => {
                            if (!show.ok) {
                                json(200, { available: false });
                                return;
                            }
                            const f = show.out.split('\n')[0].split('\x1f');
                            const meta = {
                                H: f[0] || '',
                                h: f[1] || '',
                                an: f[2] || '',
                                ae: f[3] || '',
                                ad: f[4] || '',
                                parents: f[5] || '',
                                s: f[6] || '',
                                b: f.slice(7).join('\x1f').trim(),
                            };
                            const files = [];
                            if (dt.ok) {
                                for (const line of dt.out.split('\n')) {
                                    const tab = line.indexOf('\t');
                                    if (tab < 0)
                                        continue;
                                    const st = line.slice(0, tab)[0] || '';
                                    const rest = line.slice(tab + 1);
                                    let p = rest;
                                    if (st === 'R' || st === 'C') {
                                        const arrow = rest.indexOf('\t');
                                        if (arrow < 0)
                                            continue;
                                        p = rest.slice(arrow + 1); // 重命名/复制取新路径
                                    }
                                    if (p === '')
                                        continue;
                                    const abs = path.join(root, p);
                                    const rel = path.relative(root, abs);
                                    if (rel.startsWith('..') || path.isAbsolute(rel))
                                        continue;
                                    files.push({ st, path: p, abs });
                                }
                            }
                            json(200, { available: true, meta, files });
                        });
                    });
                },
            });
            // GET /dsh-kit/git/branch?cwd=<绝对目录> → 本地分支列表
            //   {available:true, current, branches:[{name,isHead,upstream,track,trackParsed}]}
            //   trackParsed 由 parseTrack 归一（{ahead,behind,gone}|null），前端直接展示；
            //   分离头时 current 为 "(HEAD detached at ...)" 伪条目。
            const disposeGitBranch = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/git/branch',
                handler: (req, res) => {
                    const json = (code, obj) => {
                        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                        res.end(JSON.stringify(obj));
                    };
                    if (req.method !== 'GET') {
                        json(405, { error: 'method not allowed' });
                        return;
                    }
                    const origin = req.headers.origin;
                    if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                        json(403, { error: 'cross-origin denied' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://dsh-kit.local');
                    const dir = validateCwd(url.searchParams.get('cwd') ?? '');
                    if (!dir.ok) {
                        json(400, { error: dir.message });
                        return;
                    }
                    const root = gitRootFor(dir.path);
                    if (!root) {
                        json(200, { available: false });
                        return;
                    }
                    // 注意：for-each-ref 的 --format 不做 %xx 转义（与 log --pretty 不同），
                    // 分隔符必须传真实字符（0x1F，与 parseBranchList 的 LOG_FS 一致）
                    const branchFormat = '%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)\x1f%(upstream:track)';
                    runGit(['branch', '--format=' + branchFormat], root).then((r) => {
                        if (!r.ok) {
                            json(200, { available: false });
                            return;
                        }
                        const parsed = parseBranchList(r.out);
                        json(200, {
                            available: true,
                            current: parsed.current ? parsed.current.name : null,
                            branches: parsed.branches.map((b) => ({
                                name: b.name,
                                isHead: b.isHead,
                                upstream: b.upstream === '' ? null : b.upstream,
                                track: b.track,
                                trackParsed: b.upstream === '' ? null : parseTrack(b.track),
                            })),
                        });
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
                disposeGitStatus();
                disposeGitDiff();
                disposeGitInit();
                disposeGitOp();
                disposeGitLog();
                disposeGitShow();
                disposeGitBranch();
            };
        });
    });
}
