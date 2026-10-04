/** 取小写扩展名：`a.PDF` → pdf；无点/点文件 → '' */
export declare function rawExtOf(name: unknown): string;
/** 命中白名单返回 content-type，否则 null */
export declare function rawContentType(name: unknown): string | null;
/**
 * 下载模式（`?dl=1`）的 content-type：白名单是给「浏览器能不能渲染」收的口，
 * 下载不适用——未知类型按 octet-stream 发出去由浏览器落盘即可（官方文件预览
 * 头部的「下载到本机」按钮对任意类型都要能用）。
 */
export declare function rawDownloadContentType(name: unknown): string;
