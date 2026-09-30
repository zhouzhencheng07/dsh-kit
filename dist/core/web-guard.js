// dsh-kit HTTP/WS 守卫：同源校验 + Host 回环闸（index.ts 与 skill-pool.ts 共用）。
//
// 两道闸的分工：
//   Host 回环闸——主 webserver 只绑 loopback，但「只绑 loopback」防不了浏览器
//   自己连回来：DNS rebinding 让恶意页面把自身域名解析到 127.0.0.1 后，请求的
//   Origin 与 Host 同为攻击者域名，仅比对两者恒真。手机网关会把 Host 重写为
//   127.0.0.1:<upstream>，同样落在回环，不受影响。
//   Origin 比对——Host 过了之后再看 Origin：缺省放行（同源 GET fetch 不带
//   Origin；经网关剥离 Origin 的手机链路也要放行——浏览器对 POST/WS 恒带
//   Origin，缺 Origin 只剩非浏览器客户端，属本机信任范围）；存在时其 host 必须
//   与请求 Host 完全一致，跨站表单/CSRF 在这里被拒。
// 调用口径：端点一律**无条件**调本函数。别写成「Origin 非空才校验」——那等于把
// Host 闸也一起跳过，而 DNS rebinding 的 GET 恰好不带 Origin。
/** Host 头是否指向本机回环（127.0.0.1 / localhost / [::1]，含端口） */
export function isLoopbackHost(host) {
    const hostname = host
        .replace(/:\d+$/, '')
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}
/** 同源校验：Host 必须是回环名（防 rebinding），Origin 存在时必须与 Host 一致 */
export function sameOrigin(req) {
    const host = req.headers.host;
    if (typeof host !== 'string' || !isLoopbackHost(host))
        return false;
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin === '')
        return true;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}
