// 原始字节响应（/dsh-kit/raw 与 /dsh-kit/vault/file 共用）：响应头策略 + Range +
// 流式发送。路径准入由各自的调用方做（可读根集合 / 库内判定），本文件只管
// 「怎么把字节发出去」——安全响应头是一份契约，两处各写一遍必然漂。
//
// 单独成模块：core 纯库，tests/test-raw-file.mjs 单测。
import fs from 'node:fs';
import http from 'node:http';
/** content-disposition：预览 inline、下载 attachment。文件名走 RFC 5987 编码
 *  （中文名不乱码）；浏览器「另存为」的名字取这里——iOS 不认 `<a download>`，
 *  attachment 是唯一可靠的落盘触发方式。 */
export function rawDisposition(download, fileName) {
    return `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
/** 预览 / 下载共用的响应头。预览带 CSP sandbox：内容以文档形态打开（新标签 /
 *  iframe）时进不透明源、脚本不执行——svg 内嵌脚本是存储型 XSS 面。字节消费方
 *  （img / fetch / pdf.js）不受该指令影响。 */
export function rawReplyHeaders(type, download, fileName) {
    return {
        'content-type': type,
        'cache-control': download ? 'no-store' : 'no-cache',
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'content-disposition': rawDisposition(download, fileName),
    };
}
/**
 * 解析 Range 请求头（RFC 7233 单区间）。返回：
 * - {start, end}：含端 0 基字节区间（end 已收敛到 size-1）；
 * - null：请求本身有效但无法满足（start 越界 / 后缀 0 / 空文件），调用方回 416；
 * - undefined：无 Range 头或语法不认（多区间、单位错、乱写），调用方按无
 *   Range 处理回 200 全量——服务端允许忽略 Range，浏览器自会兜底。
 */
export function parseRangeHeader(header, size) {
    if (typeof header !== 'string' || header.trim() === '')
        return undefined;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === '' && m[2] === ''))
        return undefined;
    if (m[1] === '') {
        // 后缀形式 bytes=-N：最后 N 字节
        const n = Number(m[2]);
        if (n === 0 || size === 0)
            return null;
        return { start: Math.max(0, size - n), end: size - 1 };
    }
    const start = Number(m[1]);
    if (start >= size)
        return null;
    if (m[2] !== '') {
        const end = Number(m[2]);
        // last-byte-pos < first-byte-pos 语法无效，按未带 Range 处理
        if (end < start)
            return undefined;
        return { start, end: Math.min(end, size - 1) };
    }
    return { start, end: size - 1 };
}
/**
 * 把一个文件按 Range / 全量流式发出去（完整发送不截断，支持 206）。
 * 失败一律经 `fail(code, msg)` 回包；头已发出后只能掐断连接。
 */
export function sendRawFile(req, res, file, fail) {
    const headers = rawReplyHeaders(file.type, file.download, file.fileName);
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
}
