/** 事件总线负载（index.ts 的 ws state/event 转发据此成型）。
 *  'state' = 全局（可用性/启动中）——每条连接据此刷新自己分区的 state；
 *  'scope' = 某分区的页集/指针变了——只发给该分区的连接；
 *  'closed' = 整个上下文收摊（所有分区）。 */
export type BrowserEvent = {
    kind: 'state';
} | {
    kind: 'scope';
    scope: string;
} | {
    kind: 'closed';
} | {
    kind: 'navigated';
    scope: string;
    tabId: number;
    url: string;
    title: string;
} | {
    kind: 'crashed';
    scope: string;
    tabId: number;
};
/** act 工具参数的宿主侧契约（browser-tools 校验后原样传入）。
 *  ref=快照 [ref=eN] 回填（aria-ref 引擎解析，可穿透 iframe）；dx/dy=scroll 无
 *  定位目标时的滚动增量（负值向上）。 */
export interface ActArgs {
    action?: string;
    tabId?: number;
    value?: string;
    key?: string;
    ref?: string;
    dx?: number;
    dy?: number;
    timeoutMs?: number;
    snapshot?: boolean;
    role?: string;
    name?: string;
    text?: string;
    selector?: string;
}
/** 人机共驾输入消息（面板画布 → ws → 本服务；坐标已按帧原始尺寸换算）。
 *  kind:'key' = 面板 keydown 直转的组合键（英文逐键/快捷键）；kind:'text' =
 *  面板 IME 组合提交的整段文本（中文等组合输入无法用合成 keydown 表达，
 *  走 keyboard.insertText 在远程光标处整段插入）。 */
export type HumanInputMsg = {
    kind: 'mousemove';
    x: number;
    y: number;
} | {
    kind: 'mousedown';
    x: number;
    y: number;
    button?: number;
    clicks?: number;
} | {
    kind: 'mouseup';
    button?: number;
    clicks?: number;
} | {
    kind: 'wheel';
    dx?: number;
    dy?: number;
} | {
    kind: 'key';
    combo?: string;
} | {
    kind: 'text';
    text?: string;
};
/** 认不出调用方会话时的分区（无 agent 的工具调用、面板还没拿到会话 id） */
export declare const DEFAULT_SCOPE = "default";
/** 分区键归一：非空字符串原样，其它（undefined/null/空串）落 DEFAULT_SCOPE */
export declare function normalizeScope(raw: unknown): string;
/** 帧流的投递口：一个订阅者（= 一条面板连接）收自己订的那一页的帧 */
type FrameSink = (tabId: number, data: string, metadata: unknown) => void;
/** 快照文本限长（保尾部提示，让模型知道被截断） */
export declare function capText(text: string, cap?: number): string;
/** 从 PNG 字节取宽高（IHDR 定长偏移，纯函数供单测） */
export declare function pngSize(buffer: Buffer): {
    width: number;
    height: number;
} | null;
/** 校验 act 的定位参数：四选一（ref / role+name / text / selector），ref 最先——
 *  它是快照里的逐元素精确指针。返回归一化对象或错误 */
export declare function normalizeLocatorArgs(args?: ActArgs): {
    kind: 'ref';
    ref: string;
} | {
    kind: 'selector';
    selector: string;
} | {
    kind: 'role';
    role: string;
    name: string;
} | {
    kind: 'text';
    text: string;
} | {
    error: string;
};
/** 校验 act 的动作与参数配套（type/select/upload 需要 value，press 需要 key；
 *  scroll 的定位目标/dx dy 配套在 service 层校验——normalize 不知道有无定位） */
export declare function normalizeActArgs(args?: ActArgs): {
    action: string;
} | {
    error: string;
};
export declare class BrowserService {
    private _log;
    private _pw;
    private _context;
    private _launchError;
    /** 上次启动失败的时刻（0 = 没失败过）：与 _launchError 一起构成快速失败窗口 */
    private _launchFailedAt;
    private _launching;
    /** 分区表：会话 id → 页集与指针。空的（无页无观察者）分区随手删，不长期占位 */
    private _scopes;
    /** 启动时上下文里已有的页：不预设分区，谁第一个要页谁认领（见 _claimIdlePage） */
    private _unclaimed;
    /** newPage 与 'page' 事件之间的分区交接（事件先于 resolve 到达时靠它认领归属）。
     *  按请求排队而非单值：两个分区同时开页时事件要按 FIFO 与请求对号，共用一枚
     *  单值会让页被后一个分区认领走（表现是「页跑进别的对话」） */
    private _pendingScopes;
    private _nextId;
    private _listeners;
    private _lastActivity;
    private _idleTimer;
    private _disposed;
    constructor({ log }?: {
        log?: (msg: string) => void;
    });
    /** 插件/宿主能力面是否可用（vendor 加载成功） */
    get available(): boolean;
    get launchError(): string | null;
    on(cb: (evt: BrowserEvent) => void): () => boolean;
    private _emit;
    /** 取（必要时建）分区状态。分区键由调用方给（工具 = 会话 id，面板 = 连接声明的会话）。 */
    private _s;
    /** 分区没页、没观察者、没帧流就删掉它的记录（分区表不长期堆空壳） */
    private _dropIdleScope;
    private _touch;
    private _watchersTotal;
    private _pagesTotal;
    private _startIdleTimer;
    /** 收掉一个分区的全部页（空闲回收；不碰其它分区，也不关实例——实例的关由空闲 tick 判） */
    private _closeScopePages;
    /** 启动前清理上次异常留下的孤儿实例（pidfile 信任 + 进程名核验） */
    private _cleanupOrphan;
    /** 懒启动持久化上下文（幂等；并发调用共享同一次启动） */
    ensure(): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    private _launch;
    /** 认领上下文自带的一页（首个要页的分区拿到它，省掉一个空白页签） */
    private _claimIdlePage;
    /** 给分区开一页（优先认领自带页，否则 newPage）——调用后该页是本分区活动页 */
    private _openPage;
    /** 纳管一页（幂等）：归属分区、缓存标题、监听导航与崩溃；返回 tabId。
     *  分区以 page 上的标记为准（晚到的 'page' 事件分支带错 scope 也不会把页搬走）。 */
    private _adopt;
    /** 把已纳管的页搬到另一个分区（并发开页时事件路径认错 token 的兜底）。
     *  订阅与帧流属于旧分区，搬走前先摘掉——留着会把帧推给别的对话的画布 */
    private _rehome;
    /** 记下本分区人最近动的那页（幂等，广播）：帧流按页各挂各的，观察指针只管
     *  「没带页 id 的调用落哪一页」（agent 工具与 HTTP 改投走它） */
    private _setView;
    /** 页面消失（关闭/崩溃）后本分区两个指针的回退：活动页取剩余首页；观察页优先跟随活动页 */
    private _pageGone;
    /** 本分区无页则开一页（about:blank） */
    ensurePage(scope?: string): Promise<{
        ok: true;
        tabId?: number;
    } | {
        ok: false;
        error: string;
    }>;
    private _page;
    /** 取走本分区 tabId 自 since 起弹出的对话框记录（取走即清，下一次动作不重复报告） */
    private _drainDialogs;
    /** 列本分区页集。ensure:false = 只看现状，浏览器没跑就回空表——只读的工具面
     *  （browser_tabs list、关页后的回读）不该把浏览器拉起来，那是「被动动作不属于
     *  使用理由」这条面板口径的延伸。 */
    listPages(scope?: string, { ensure }?: {
        ensure?: boolean;
    }): Promise<{
        ok: true;
        pages: Array<{
            tabId: number;
            url: string;
            title: string;
            active: boolean;
            viewed: boolean;
        }>;
        activeId: number | null;
        viewId: number | null;
    } | {
        ok: false;
        error: string;
    }>;
    state(scope?: string): Promise<{
        available: false;
        error: string;
    } | {
        available: true;
        running: false;
        launching: boolean;
        error: string | null;
    } | {
        available: true;
        running: true;
        launching: false;
        pages: Array<{
            tabId: number;
            url: string;
            title: string;
            active: boolean;
            viewed: boolean;
        }>;
        activeId: number | null;
        viewId: number | null;
    }>;
    /** 导航（工具与面板共用）：返回 { tabId, title, url, snapshot? }。
     *  agent 路径作用于本分区 agent 活动页；forHuman（面板 URL 栏）作用于本分区观察页、
     *  不动 agent 活动页；targetId 显式点名某页（面板一签一页时地址栏作用于自己那张签）。
     *  两者都只落在本分区，别的对话的页不受影响。 */
    navigate(scope: string, url: string, { newTab, snapshot, forHuman, targetId }?: {
        newTab?: boolean;
        snapshot?: boolean;
        forHuman?: boolean;
        targetId?: number | null;
    }): Promise<{
        ok: true;
        tabId: number;
        url: string;
        title: string;
        snapshot?: string;
        warning?: string;
    } | {
        ok: false;
        error: string;
    }>;
    /** 取某页快照（selector 给定时只看该子树） */
    private _snapshotOf;
    /** 紧凑树观察。selector = 只看该选择器命中的子树（大页面按块看，省 token）；
     *  maxChars = 覆盖默认 8KB 上限（越界夹到 SNAPSHOT_MIN..SNAPSHOT_MAX） */
    snapshot(scope: string, tabId?: number | null, opts?: {
        selector?: string;
        maxChars?: number;
    }): Promise<{
        ok: true;
        tabId: number;
        url: string;
        title: string;
        snapshot: string;
    } | {
        ok: false;
        error: string;
    }>;
    /** 统一动作：click/type/press/check/uncheck/select/hover/scroll/upload；默认返回
     *  新快照（动作即观察）。ref 定位走 aria-ref 引擎（可穿透 iframe）；scroll 有定位
     *  目标=滚动到元素可见，无定位=按 dx/dy 真实滚轮；upload 的 value 为本地绝对路径 */
    act(scope: string, args: ActArgs): Promise<{
        ok: true;
        tabId: number;
        url: string;
        title: string;
        matched: number | null;
        warning?: string;
        snapshot?: string;
    } | {
        ok: false;
        error: string;
    }>;
    /** 页面内 JS（返回 JSON 值，限长） */
    evaluate(scope: string, expression: string, tabId?: number | null): Promise<{
        ok: true;
        tabId: number;
        value: string;
    } | {
        ok: false;
        error: string;
    }>;
    /** 截图：返回 buffer + 尺寸（image 附件化在 browser-tools 里做，需 exec/ctx） */
    screenshot(scope: string, { fullPage, tabId }?: {
        fullPage?: boolean;
        tabId?: number | null;
    }): Promise<{
        ok: true;
        tabId: number;
        url: string;
        buffer: Buffer;
        size: {
            width: number;
            height: number;
        } | null;
    } | {
        ok: false;
        error: string;
    }>;
    /** 视口切换（响应式/移动布局验证）：作用于指定页（默认 agent 活动页）。
     *  范围 320–3840 × 320–2160，越界报错不静默 clamp；新页签仍以启动默认 1280×800
     *  打开（launchPersistentContext 的 viewport 选项），面板帧流坐标按帧原始尺寸
     *  换算，视口变化天然跟随。 */
    setViewport(scope: string, { width, height, tabId }?: {
        width: number;
        height: number;
        tabId?: number | null;
    }): Promise<{
        ok: true;
        tabId: number;
        url: string;
        viewport: {
            width: number;
            height: number;
        };
    } | {
        ok: false;
        error: string;
    }>;
    /** 关本分区一页 */
    closePage(scope: string, tabId: number): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** agent 的 browser_act(action:'activate') 换观察页：只动观察指针，默认目标页不受影响 */
    activatePage(scope: string, tabId: number): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** 面板工具栏「＋」新建页：新页即观察页（adopt 会把它提为本分区 agent 活动页，保持既有
     *  语义）；本分区无页时的首建走 ensurePage 兜底 */
    humanNewTab(scope: string): Promise<{
        ok: true;
        tabId?: number;
    } | {
        ok: false;
        error: string;
    }>;
    /** 面板历史按钮（作用于本分区观察页）：back/forward/reload。无历史可退/超时不视为
     *  故障（页面维持原状），仍回报当前位置 */
    history(scope: string, op: 'back' | 'forward' | 'reload', targetId?: number | null): Promise<{
        ok: true;
        tabId: number;
        url: string;
        title: string;
    } | {
        ok: false;
        error: string;
    }>;
    /** 面板订阅某页的帧流。subscriber 标识这一个订阅者（连接），退订时按它摘，
     *  免得同页多张签张冠李戴 */
    watcherOpen(scope: string, tabId: number | null, subscriber: object, onFrame: FrameSink, size?: {
        w?: unknown;
        h?: unknown;
    } | null): Promise<{
        ok: true;
        tabId?: number;
    } | {
        ok: false;
        error: string;
    }>;
    /** 退订某页帧流（该页无订阅者即拆 CDP 会话） */
    watcherClose(scope: string, tabId: number | null, subscriber: object): void;
    /** 面板尺寸变了：改封顶得重发 startScreencast（参数只在开流那一刻生效）。
     *  差得不多就不动——拖右栏是连续小变化，每次都重开只会抖。
     *  流还没挂时只记进 frameBoxes，_attachStream 会照它开 */
    setFrameSize(scope: string, tabId: number, size?: {
        w?: unknown;
        h?: unknown;
    } | null): Promise<void>;
    /** 某页的一帧投给该页所有订阅者（一个订阅者抛错不拖累别的） */
    private _emitFrame;
    /** 挂某页的 CDP 帧流（一页一条；多张签看同一页复用它） */
    private _attachStream;
    private _detachStream;
    /** 本分区有观察者却缺流时补挂（如 CDP 会话被别处拆了）。页还不存在时
     *  watcherOpen 会直接拒掉，那半边由客户端重开签补，不走这里 */
    private _resyncStream;
    /** 面板 URL 栏手动导航（作用于指定页——面板一签一页时就是那张签自己的页；
     *  不给页则落本分区观察页；都不动 agent 活动页；不取快照）。
     *  newPage = 那张签还没有页（从入口开出来的那张）：另开一页，别动别的签正在看的页 */
    humanOpen(scope: string, url: string, targetId?: number | null, newPage?: boolean): Promise<{
        ok: true;
        tabId: number;
        url: string;
        title: string;
    } | {
        ok: false;
        error: string;
    }>;
    /** 优雅关闭（面板/协议可调）：context.close() 落盘 cookie 后再走，下次启动免登录 */
    closeNow(): Promise<{
        ok: true;
    }>;
    /**
     * 人机共驾输入派发：面板画布的鼠标/滚轮/键盘 → 本分区观察页。
     * 设计约束：不自动拉起浏览器（未运行即拒绝，避免悬停误启动）；事件进顺序队列
     * 串行派发（鼠标移动高频，乱序会拖拽断裂）；坐标由面板按帧原始尺寸换算好。
     */
    humanInput(scope: string, msg: HumanInputMsg, targetId?: number | null): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** 关闭浏览器上下文（保 profile）：所有分区一起收 */
    private _closeContext;
    /** 插件卸载：全量清理（幂等） */
    dispose(): Promise<void>;
}
export {};
