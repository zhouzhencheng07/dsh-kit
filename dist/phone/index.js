// dsh-kit 手机访问组件（宿主半边入口）
//
// 能力本体在 ./gateway.ts（唯一对外监听口 0.0.0.0:<phonePort> + 令牌授权反代 + 远程视图
// 辅助脚本）；本文件是组件的装配面：网关启停/令牌/链接端点与组件配置。
// 组件行关闭 = 本模块不物化 = 网关起不来、端点全 404，client 半边探到 404 后整体不注册
// （设置页「手机访问」整块、组件配置页与设置导航图标全不出现）——行开关就是总开关。
// 配置：phonePort（对外端口）、phoneRemoteDomain（远程域名）、phoneKeepGatewayOn
// （重启后是否自动拉起）。网关启停本身走 /dsh-kit/phone/gateway + 状态文件，不经 settings
// （settings 读取器回填有时序滞后，实测开关写了但 reader 仍报旧值）。
//
// 端点（同源校验；主 webserver 只绑 loopback，本网关是唯一对外口）：
//   GET  /dsh-kit-phone/config      —— 生效配置快照（client 门控与可达性探针：404 = 行关闭）
//   GET  /dsh-kit/phone/info|link   —— 网关状态与带令牌链接
//   POST /dsh-kit/phone/rotate|gateway —— 轮换令牌 / 热启停网关
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { sameOrigin } from "../core/index.js";
import { startPhoneGateway, lanAddresses, defaultStateFile, loadGatewayState, saveGatewayState } from "./gateway.js";
/** 手机访问网关对外端口（0.0.0.0）的默认值，可在组件配置页改（phonePort，1-65535） */
const PHONE_PORT = 3090;
export const name = 'dsh-kit/phone';
const require = createRequire(import.meta.url);
/**
 * 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录），loadDep 的第三锚点用。
 * 非 DSH 环境返回 null。
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
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile 写入 =
// 热提交（fiber config 里的稳定 ref），readSettings 统一解引用后每次现读。
// 行开关 = 本组件的总开关，所以没有与行同粒度的「手机访问页入口」字段：关行即整块消失。
const schemastery = loadDep('@deepseek-ai/schemastery');
const z = (schemastery?.default ?? schemastery ?? null);
export const Config = z && typeof z.object === 'function'
    ? z.object({
        phoneRemoteDomain: z.string().default('').volatile(),
        phonePort: z.number().step(1).min(1).max(65535).default(3090).volatile(),
        phoneKeepGatewayOn: z.boolean().default(false).volatile(),
    })
    : undefined;
export async function apply(ctx, config = {}) {
    const defaults = Config ? Config({}) : { phoneRemoteDomain: '', phonePort: PHONE_PORT, phoneKeepGatewayOn: false };
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
    // webServer 可能在本组件 apply 之后才挂载，用动态注入等它就绪
    ctx.inject(['webServer', 'credentials'], (webCtx) => {
        webCtx.effect(() => {
            // ── 生效配置只读端点（client 门控与可达性探针）──
            // client 启动拉一次喂 cfgFromSnapshot；行关闭时本端点随模块不物化而 404，
            // client 探到 404 就整体不注册（设置页「手机访问」整块不出现）。
            webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit-phone/config',
                handler: (_req, res) => {
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
                    res.end(JSON.stringify(readSettings()));
                },
            });
            // ── 手机访问网关（./gateway.ts）──
            // 网关启用位以状态文件直管（loadGatewayState/enabled 字段）：settings 读取器
            // 回填有时序滞后（实测开关写了但 reader 仍报旧值，重进设置页"恢复未开启"），
            // 手机访问页的启停按钮走 /dsh-kit/phone/gateway 端点，不经过 settings。
            const stateFile = defaultStateFile();
            const phoneRemoteDomain = () => String(readSettings().phoneRemoteDomain ?? '').trim();
            /** 网关端口：设置里读，缺失/非法回落默认 3090 */
            const phonePort = () => {
                const n = readSettings().phonePort;
                return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : PHONE_PORT;
            };
            /** 重启后保留开启：勾选时启动才恢复上次启用位；不勾=每次启动网关都是关的 */
            const phoneKeepGatewayOn = () => readSettings().phoneKeepGatewayOn === true;
            const warnLog = (msg) => console.warn(`dsh-kit: ${msg}`);
            // 远程视图（走网关）下要不要连挑选入口一起锁：宿主 picker 是 browse（应用内列目录/
            // 建文件夹，远程客户端自己就能选）时不该锁；native 或未挂载（判据未知，按宿主的
            // hide the affordance 语义）则锁——native 的 pick 在宿主屏幕弹 OS 对话框，远程端点了
            // 对话框开在电脑上、自己这边零反馈。逐次读服务而不缓存对象：profile patch 换后端的
            // 热重载后立刻跟随。
            const lockPickerEntries = () => {
                try {
                    const picker = ctx.get('directoryPicker');
                    return picker?.capability?.()?.kind !== 'browse';
                }
                catch {
                    return true;
                }
            };
            // dsh web ≥ v0.1.2-alpha.5 的浏览器鉴权：网关反代须自带签名会话 cookie，
            // 否则手机端访问 index 一律 401。密钥即 credentials 服务的
            // client-connection/browser-session 记录（与 dsh web 共享），b64url 解码回
            // 32 字节原始密钥。读不到时按降级处理：网关其余功能不受影响，仅手机访问 401。
            let dshSessionSecret = null;
            const loadDshSessionSecret = () => {
                try {
                    const creds = webCtx.credentials;
                    if (!creds || typeof creds.readRecord !== 'function')
                        return;
                    creds.readRecord('client-connection/browser-session').then((record) => {
                        const payload = record?.payload;
                        if (record?.kind !== 'grant' || !payload || payload.version !== 1 || typeof payload.secret !== 'string' || payload.secret === '') {
                            warnLog('浏览器会话密钥记录不可用，手机访问将显示 401（网关其余功能正常）');
                            return;
                        }
                        const pad = '='.repeat((4 - (payload.secret.length % 4)) % 4);
                        const raw = Buffer.from(payload.secret.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64');
                        if (raw.length !== 32) {
                            warnLog('浏览器会话密钥长度异常（' + raw.length + 'B），手机访问将显示 401（网关其余功能正常）');
                            return;
                        }
                        dshSessionSecret = raw;
                    }, (error) => {
                        warnLog('读取浏览器会话密钥失败：' + String(error?.message ?? error) + '，手机访问将显示 401（网关其余功能正常）');
                    });
                }
                catch (error) {
                    warnLog('读取浏览器会话密钥失败：' + (error instanceof Error ? error.message : String(error)) + '，手机访问将显示 401（网关其余功能正常）');
                }
            };
            loadDshSessionSecret();
            let phoneGw = null;
            let phoneGwError = null;
            const bootGwState = loadGatewayState(stateFile, warnLog);
            // 启动评估：readSettings 自 apply 起就是完整值（声明式配置），注入段末尾
            // 直接评估网关启用位，无需等设置服务回调。
            let phoneGwWanted = false;
            const bootEvalGateway = () => {
                phoneGwWanted = phoneKeepGatewayOn() && bootGwState.enabled === true;
                if (bootGwState.enabled !== phoneGwWanted) {
                    saveGatewayState(stateFile, { token: bootGwState.token, enabled: phoneGwWanted }, warnLog);
                }
                syncPhoneGateway();
            };
            /** 现役实例监听的端口；null = 无实例。用于识别端口配置变更 */
            let gwPort = null;
            /** 按当前启用位同步网关启停 */
            const syncPhoneGateway = () => {
                // 端口配置变更：关掉旧端口的现役实例，走下方重启动路径按新端口起步
                if (phoneGw !== null && gwPort !== null && gwPort !== phonePort()) {
                    try {
                        phoneGw.close();
                    }
                    catch {
                        // 死实例 close 可能抛错，忽略
                    }
                    phoneGw = null;
                    phoneGwError = null;
                }
                // 启动失败（如端口被占）后 phoneGw 仍持有已死实例且 state().error 落定，
                // 若只判 phoneGw === null 会永远跳过重试——带 error 的实例视为死实例，
                // 先关掉清空再重新起步。
                if (phoneGwWanted && (phoneGw === null || phoneGw.state().error !== null)) {
                    if (phoneGw !== null) {
                        try {
                            phoneGw.close();
                        }
                        catch {
                            // 死实例 close 可能抛错，忽略
                        }
                        phoneGw = null;
                        phoneGwError = null;
                    }
                    try {
                        gwPort = phonePort();
                        phoneGw = startPhoneGateway({ port: gwPort, upstreamPort: webCtx.webServer.port, log: warnLog, sessionSecret: () => dshSessionSecret, lockPickerEntries });
                        phoneGwError = null;
                    }
                    catch (error) {
                        gwPort = null;
                        phoneGwError = String(error instanceof Error ? error.message : error);
                        warnLog('手机访问网关启动失败：' + phoneGwError);
                    }
                }
                else if (!phoneGwWanted && phoneGw !== null) {
                    phoneGw.close();
                    phoneGw = null;
                }
            };
            // 启动评估（配置在本 entry 加载时已解析，无时序差）
            bootEvalGateway();
            /** 改启用位（持久化到状态文件 + 热启停）；由 /dsh-kit/phone/gateway 端点调用。
             *  令牌轮换不再随启停自动发生——页内「刷新链接」按钮经 rotate 端点手动触发，
             *  重启/重开沿用同一令牌（已授权设备不掉线） */
            const setGatewayEnabled = (on) => {
                phoneGwWanted = on === true;
                const token = phoneGw ? phoneGw.token() : loadGatewayState(stateFile, warnLog).token;
                saveGatewayState(stateFile, { token, enabled: phoneGwWanted }, warnLog);
                syncPhoneGateway();
            };
            /** 带令牌的可扫码链接：局域网每个 IPv4 一条 + 远程域名（配置了才有） */
            const phoneLinks = () => {
                if (!phoneGw)
                    return [];
                const k = encodeURIComponent(phoneGw.token());
                const links = lanAddresses().map((ip) => ({ label: 'lan', url: `http://${ip}:${phonePort()}/?k=${k}` }));
                if (phoneRemoteDomain() !== '') {
                    links.push({ label: 'remote', url: `https://${phoneRemoteDomain()}/?k=${k}` });
                }
                return links;
            };
            const phoneJson = (res, code, obj) => {
                res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(obj));
            };
            /** GET 类守卫：同源 fetch 的 GET 可能不带 Origin，带了就必须匹配 Host */
            const phoneGuardGet = (req, res) => {
                const origin = req.headers.origin;
                if (typeof origin === 'string' && origin !== '' && !sameOrigin(req)) {
                    phoneJson(res, 403, { error: 'cross-origin denied' });
                    return false;
                }
                if (req.method !== 'GET') {
                    phoneJson(res, 405, { error: 'method not allowed' });
                    return false;
                }
                return true;
            };
            const disposePhoneInfo = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/phone/info',
                handler: (req, res) => {
                    if (!phoneGuardGet(req, res))
                        return;
                    phoneJson(res, 200, {
                        gatewayOn: phoneGwWanted,
                        running: phoneGw !== null && phoneGw.state().listening,
                        error: phoneGwError ?? phoneGw?.state().error ?? null,
                        port: phoneGw ? (phoneGw.port() ?? phonePort()) : phonePort(),
                        remoteDomain: phoneRemoteDomain(),
                        fingerprint: phoneGw ? phoneGw.fingerprint() : null,
                    });
                },
            });
            const disposePhoneLink = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/phone/link',
                handler: (req, res) => {
                    if (!phoneGuardGet(req, res))
                        return;
                    // 死实例（启动失败/端口被占）不出链接：扫了也是连不上
                    if (!phoneGw || !phoneGw.state().listening) {
                        phoneJson(res, 409, { error: phoneGwError ?? phoneGw?.state().error ?? 'gateway disabled' });
                        return;
                    }
                    phoneJson(res, 200, { links: phoneLinks(), fingerprint: phoneGw.fingerprint() });
                },
            });
            // 手动轮换端点：页内「刷新链接」按钮（+ 脚本/异常场景）作废旧链接用。
            // 启停不再自动轮换——见 setGatewayEnabled。
            const disposePhoneRotate = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/phone/rotate',
                handler: (req, res) => {
                    // POST 走 JSON content-type：跨源必触发 CORS 预检被拦，Origin 存在时
                    // 仍做同源校验（剥 Origin 的网关链路也能用）
                    if (req.method !== 'POST') {
                        phoneJson(res, 405, { error: 'method not allowed' });
                        return;
                    }
                    if (req.headers.origin !== undefined && !sameOrigin(req)) {
                        phoneJson(res, 403, { error: 'cross-origin denied' });
                        return;
                    }
                    if (!phoneGw || !phoneGw.state().listening) {
                        phoneJson(res, 409, { error: phoneGwError ?? phoneGw?.state().error ?? 'gateway disabled' });
                        return;
                    }
                    phoneGw.rotate();
                    phoneJson(res, 200, { links: phoneLinks(), fingerprint: phoneGw.fingerprint() });
                },
            });
            const disposePhoneGateway = webCtx.webServer.register({
                kind: 'exact',
                path: '/dsh-kit/phone/gateway',
                handler: (req, res) => {
                    if (req.method !== 'POST') {
                        phoneJson(res, 405, { error: 'method not allowed' });
                        return;
                    }
                    if (req.headers.origin !== undefined && !sameOrigin(req)) {
                        phoneJson(res, 403, { error: 'cross-origin denied' });
                        return;
                    }
                    let raw = '';
                    req.on('data', (c) => { raw += c.toString('utf8'); });
                    req.on('end', () => {
                        let on = null;
                        try {
                            on = JSON.parse(raw || '{}').on;
                        }
                        catch {
                            on = null;
                        }
                        if (typeof on !== 'boolean') {
                            phoneJson(res, 400, { error: 'body 需 {"on": true|false}' });
                            return;
                        }
                        setGatewayEnabled(on);
                        // server.listen/close 是异步的：listening/error 事件在下一轮事件
                        // 循环才触发，立即读 state() 会拿到旧值——实测启停回包恒报
                        // running:false + error:null（前端显示"网关未运行：unknown"）。
                        // 轮询到状态落定（目标达成 / 出错 / 500ms 超时）再回包。
                        const t0 = Date.now();
                        const settle = () => {
                            const gw = phoneGw;
                            const running = gw !== null && gw.state().listening;
                            const error = phoneGwError ?? gw?.state().error ?? null;
                            if (running === on || error !== null || Date.now() - t0 >= 500) {
                                phoneJson(res, 200, { gatewayOn: phoneGwWanted, running, error });
                                return;
                            }
                            setTimeout(settle, 30);
                        };
                        settle();
                    });
                },
            });
            return () => {
                disposePhoneInfo();
                disposePhoneLink();
                disposePhoneRotate();
                disposePhoneGateway();
                if (phoneGw)
                    phoneGw.close();
            };
        }, 'dsh-kit/phone: config/phone endpoints');
    });
}
