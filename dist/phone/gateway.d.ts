import zlib from 'node:zlib';
/** 网关下发的授权 Cookie 名 */
export declare const PHONE_COOKIE = "dshk_phone";
/**
 * 「视图」Cookie 名：网关默认按**远程视图**注入辅助脚本（走这个口就是远程客户端，
 * 与 UA/触屏能力无关）。主机自己想在这个口上看到宿主原样时，用 `?dshk_view=desktop`
 * 落这个 Cookie 退出远程视图，`?dshk_view=remote` 复位。
 */
export declare const PHONE_VIEW_COOKIE = "dshk_view";
export declare function isCompressibleType(contentType: unknown): boolean;
/**
 * 客户端 accept-encoding 里我们能提供的编码，按偏好取最优（br > gzip > deflate）；
 * 缺失或不含任何可支持编码返回 null。q=0 视为明确拒绝。
 */
export declare function pickEncoding(acceptEncoding: unknown): 'br' | 'gzip' | 'deflate' | null;
/** br 质量档：Node 默认走最高档 11，而网关最重的那个包（插件客户端合并包，
 *  实测 11.19MB）在 11 档要 ~14s CPU、5 档 0.32s 而体积只大 7%——压缩跑在
 *  libuv 线程池里，十几秒的档位会把远程首连那阵子的宿主 fs/网络一起拖住。
 *  两个 br 入口（流式 / 一次性）共用这一份，避免只改一处。 */
export declare const BROTLI_QUALITY = 5;
export declare function brotliOptions(): zlib.BrotliOptions;
export interface PhoneAssistOptions {
    /**
     * 是否远程视图：由调用方判定（**网关本身就是远程口**——走网关监听的那个端口（可配置，
     * 默认 3090）即远程，主机自己的回环页面根本不经这里）。判为假时只剩内测弹窗那段，
     * 页面等于宿主原样。
     */
    remoteView: boolean;
    /** 宿主 picker 服务不了远程客户端（不是 browse）时，把挑选入口一并锁住 */
    pickerLocked: boolean;
}
/**
 * 网关注入的辅助脚本。锚点是宿主前端的 DOM 实现细节（hashed class 不用、只用语义
 * 属性/文本），宿主升级改版会静默失效——失效表现是"弹窗又出现/入口又能点"，无副作用；
 * 复核基线 dsh 0.2.0-rc.2（置灰判据是 data-open-target 语义属性）。
 * ① 内测声明弹窗（welcome notice）：远程浏览器的 settings scope 是内存模式，已读状态
 *    存不住，每次加载都会弹——脚本轮询自动点「继续」。
 * ② 宿主专属入口置灰（见 HOST_ONLY_LOCKED / PICKER_LOCKED / 两个
 *    文本正则）：捕获阶段拦掉点击并弹同一句提示，既不把对话框/编辑器弹到电脑上，
 *    也不在手机上留一块空白。
 *    选择器能命中的用 CSS 置灰（重渲染安全）；只有文本可认的（菜单项、设置页按钮）
 *    靠点击拦截，另配 2s 扫描 + 每次点击后补两拍，把弹出菜单/对话框里的文本命中项也置灰。
 * ③ 远程页面宣告"自己就是宿主"：宿主前端的设置通道按 `isLoopback` 选持久化模式
 *    （`dsh-client-ui-settings`：isLoopback → "host"，否则 "memory"），而它只认
 *    `location.hostname` 回环或 `__DSH_TRANSPORT__.ownsHost`（`dsh-client-connection`）。
 *    手机永远不是回环地址，于是内存模式下镜像直接短路，设置里的「模型」「插件配置」
 *    报 'settings are unavailable in this browser'。网关口本就是令牌授权的全权入口
 *    （持链接者已能借 agent 在宿主上执行任意命令），补这个标记让远程端的设置读写与
 *    宿主一致；随之出现的还有「打开配置文件」这类本地面板（已在 ② 里锁掉）。
 * ④ 触屏 hover/focus 清理（见 clearTouchState）：手机点一下之后，浏览器把那处当作"鼠标
 *    停在那"、焦点也留在按钮上，宿主的悬停提示/预览会粘到下次点按为止。补发的是**真实的
 *    反向事实**（"指针离开了"），只是在替手机补齐浏览器不会自己发的那条；焦点那一半是
 *    合成事件，会关掉宿主"失焦即收"的弹出层，所以弹出层在场时跳过。
 *    时序与漏触发：清理必须**晚于这次点按的 click**——首连那阵子主线程卡，挂在 touchend 上的
 *    0ms 定时器会抢在 click 前面跑，清理引发的重渲染换掉手指底下那个节点，随后到来的 click
 *    就落到脱离文档的节点上被吞（表现是"刚连上那一会点了没反应，再点一下才好"，不只某一处）。
 *    所以按 touchstart 记账、click/touchcancel 到了再清、700ms 兜底；落点按坐标 `elementFromPoint`
 *    重取（事件发给脱离文档的节点不会冒泡到 React 根）；手势被判成滚动时浏览器只发 touchcancel，
 *    故两个都挂。
 */
export declare function phoneAssistScript({ remoteView, pickerLocked }: PhoneAssistOptions): string;
/** 在 HTML 的 <head> 开标签后插入脚本；找不到开标签就整体前置 */
export declare function injectHeadScript(html: string, script: string): string;
/** 生成一个高熵令牌（192-bit，URL 安全） */
export declare function newToken(): string;
export interface DshSessionCookieOptions {
    /** 32 字节 HMAC 原始密钥 */
    secret: Buffer;
    /** 校验 authority（= 转发时重写后的 Host，即 127.0.0.1:<upstream>） */
    authority: string;
    issuedAt?: number;
    maxAgeMs?: number;
}
/**
 * 铸造 dsh web 浏览器会话 cookie。算法对齐 @deepseek-ai/dsh-client-connection：
 * 名 = `dsh-auth-<b64url(sha256(authority))>`，值 = `v1.<b64url(payload)>.<b64url(hmac(secret, body))>`，
 * payload = {version:1, authority, issuedAt, expiresAt}。跨度取 1 天：dsh 校验要求
 * 跨度 ≤ 其 cookieMaxAgeDays 配置（默认 30），而网关每请求现铸（issuedAt≈now），
 * 跨度只影响上限兼容——取 1 天对任何 ≥1 天的配置都成立。
 */
export declare function dshSessionCookie({ secret, authority, issuedAt, maxAgeMs }: DshSessionCookieOptions): string;
/** 极简 Cookie 解析（只需要取一个名值对） */
export declare function parseCookies(header: unknown): Record<string, string>;
/**
 * 默认令牌持久化文件：<DSH_HOME>/dsh-kit/phone-gateway.json。
 * 重启 dsh 后令牌不变，手机端 Cookie 继续有效；文件损坏则重新生成
 * （等价于一次轮换，旧链接失效属预期）。
 */
export declare function defaultStateFile(): string;
export interface GatewayState {
    token: string;
    enabled: boolean;
}
/**
 * 状态文件读写（令牌 + 网关启用位）。启用位独立于 settings 通道：
 * 设置读取器回填有时序滞后，网关开关用文件直管，见 index.ts 的
 * /dsh-kit/phone/gateway 端点。
 */
export declare function loadGatewayState(stateFile: string, log?: (msg: string) => void): GatewayState;
export declare function saveGatewayState(stateFile: string, { token, enabled }: GatewayState, log?: (msg: string) => void): void;
/** 本机非回环 IPv4 地址列表（二维码里局域网链接的候选）；@param interfaces 测试注入用 */
export declare function lanAddresses(interfaces?: NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>): string[];
export interface PhoneGatewayOptions {
    /** 对外端口（默认 3090） */
    port: number;
    /** dsh web 主端口（回环） */
    upstreamPort: number;
    /** 令牌持久化路径 */
    stateFile?: string;
    log?: (msg: string) => void;
    /**
     * dsh web 浏览器会话密钥（32 字节原始密钥）；可传取值函数以便读好后自动生效。
     * null/未就绪时不注入会话 cookie（手机访问显示 401，网关其余功能不受影响）。
     */
    sessionSecret?: Buffer | (() => Buffer | null) | null;
    /**
     * 宿主 picker 是否服务不了远程客户端（不是 browse）。为真时连挑选入口一起锁住。
     * 逐次注入 HTML 时求值，因此宿主组合的热重载（profile patch 把 auto 换成 -browse）
     * 无需重启网关即可跟随。
     */
    lockPickerEntries?: () => boolean;
}
export interface PhoneGatewayHandle {
    /** 实际监听端口（支持 port 0 由系统自选后回读） */
    port(): number | null;
    /** 当前令牌（轮换后变化） */
    token(): string;
    /** 轮换令牌并持久化；旧链接与旧 Cookie 立即失效 */
    rotate(): string;
    /** 运行状态快照 */
    state(): {
        listening: boolean;
        error: string | null;
    };
    close(): void;
}
export declare function startPhoneGateway({ port, upstreamPort, stateFile, log, sessionSecret, lockPickerEntries }: PhoneGatewayOptions): PhoneGatewayHandle;
