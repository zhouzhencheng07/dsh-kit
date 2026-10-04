import http from 'node:http';
/** content-disposition：预览 inline、下载 attachment。文件名走 RFC 5987 编码
 *  （中文名不乱码）；浏览器「另存为」的名字取这里——iOS 不认 `<a download>`，
 *  attachment 是唯一可靠的落盘触发方式。 */
export declare function rawDisposition(download: boolean, fileName: string): string;
/** 预览 / 下载共用的响应头。预览带 CSP sandbox：内容以文档形态打开（新标签 /
 *  iframe）时进不透明源、脚本不执行——svg 内嵌脚本是存储型 XSS 面。字节消费方
 *  （img / fetch / pdf.js）不受该指令影响。 */
export declare function rawReplyHeaders(type: string, download: boolean, fileName: string): Record<string, string>;
/**
 * 解析 Range 请求头（RFC 7233 单区间）。返回：
 * - {start, end}：含端 0 基字节区间（end 已收敛到 size-1）；
 * - null：请求本身有效但无法满足（start 越界 / 后缀 0 / 空文件），调用方回 416；
 * - undefined：无 Range 头或语法不认（多区间、单位错、乱写），调用方按无
 *   Range 处理回 200 全量——服务端允许忽略 Range，浏览器自会兜底。
 */
export declare function parseRangeHeader(header: unknown, size: number): {
    start: number;
    end: number;
} | null | undefined;
export interface RawSendFile {
    /** 已准入的绝对路径 */
    path: string;
    /** stat.size */
    size: number;
    /** content-type（调用方按自己的类型政策给） */
    type: string;
    /** 下载模式：disposition 换 attachment、缓存 no-store */
    download: boolean;
    /** 浏览器标题 / 另存名（basename） */
    fileName: string;
}
/**
 * 把一个文件按 Range / 全量流式发出去（完整发送不截断，支持 206）。
 * 失败一律经 `fail(code, msg)` 回包；头已发出后只能掐断连接。
 */
export declare function sendRawFile(req: http.IncomingMessage, res: http.ServerResponse, file: RawSendFile, fail: (code: number, msg: string) => void): void;
