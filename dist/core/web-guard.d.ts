/** Host 头是否指向本机回环（127.0.0.1 / localhost / [::1]，含端口） */
export declare function isLoopbackHost(host: string): boolean;
/** 同源校验：Host 必须是回环名（防 rebinding），Origin 存在时必须与 Host 一致 */
export declare function sameOrigin(req: import('node:http').IncomingMessage): boolean;
