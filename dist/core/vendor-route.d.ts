import http from 'node:http';
export interface KitVendorWebServer {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
    }): () => void;
}
/**
 * 逐文件 exact 路由。files = URL 路径 → client/vendor/ 下的文件名（如
 * '/dsh-kit/vendor/xterm.js' → 'xterm.js'）；URL 不在表里就 404，天然挡路径穿越。
 */
export declare function registerVendorFiles(webServer: KitVendorWebServer, files: ReadonlyMap<string, string>): () => void;
/**
 * 子目录资源的前缀路由（KaTeX 的 css 以 fonts/ 相对路径引用字体，URL 段固定）：
 * 前缀之外的段只认单段文件名与白名单字符，杜绝穿越。
 */
export declare function registerVendorSubdir(webServer: KitVendorWebServer, urlPrefix: string, diskDir: string): () => void;
