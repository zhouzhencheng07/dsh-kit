// dsh-kit 手机访问网关 —— 唯一对外监听口（默认 0.0.0.0:3090），把已授权的
// 手机浏览器请求透传给本机回环上的 dsh web 主端口。
//
// 为什么必须有这个进程：dsh web 有意只绑 127.0.0.1（CLI 显式拒绝
// --host 0.0.0.0，见 @deepseek-ai/dsh-web-app/lib/startup.js），而插件路由只能
// 叠加在主 webserver 上、拦不住别人的路由——「验链接」这件事没地方放，只能前置。
//
// 授权模型（授权内嵌在链接里）：
//   二维码 URL 携带一次性下发的高熵令牌 ?k=<token>；
//   首次校验通过后种长期 Cookie（dshk_phone），此后普通地址即可直达；
//   「刷新链接」= 轮换令牌，旧链接（含已种 Cookie 的旧令牌）立即全部失效。
//   未授权请求一律返回不起眼的 404 Not Found（不暴露这里跑着什么）。
//
// 转发策略（全功能模式）：Host 重写为 127.0.0.1:<upstream>、剥离 Origin 与本网关
// Cookie。这会让 dsh 的 browser-trust fence 把请求当回环同源放行（含特权 RPC——
// 上游把它们钉死 loopback）；kit 自有端点同语义（web-guard.ts sameOrigin 对缺
// Origin 放行 + Host 回环闸），kit 的 POST/WS 经网关同样可达。安全上自洽：令牌即
// 认证层，持有链接者本就能借 agent 对话执行任意命令，特权钉死对该威胁模型无增量；
// 而直连回环的本机访问不受影响，dsh 本体零改动。
//
// dsh web ≥ v0.1.2-alpha.5 起带浏览器会话鉴权：回环直连请求也必须携带
// client-connection 签名 cookie，否则 index 一律 401（手机端会看到
// "dsh web authentication required; reopen the URL printed by dsh web"）。
// 网关自铸该会话 cookie（与 dsh web 共享 credentials 的
// client-connection/browser-session 记录密钥，算法见 dshSessionCookie）
// 随每次反代上送，手机浏览器无需感知；密钥未就绪时网关其余功能照常，
// 仅手机访问 401。
//
// WebSocket：会话事件流 / 终端 / 客户端 HMR 全靠 WS 升级，upgrade 事件做同样的
// 鉴权后手动隧道（101 头回写 + 双向 pipe），流式响应一律不缓冲。
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
/** 网关下发的授权 Cookie 名 */
export const PHONE_COOKIE = 'dshk_phone';
/**
 * 「视图」Cookie 名：网关默认按**远程视图**注入辅助脚本（走这个口就是远程客户端，
 * 与 UA/触屏能力无关）。主机自己想在这个口上看到宿主原样时，用 `?dshk_view=desktop`
 * 落这个 Cookie 退出远程视图，`?dshk_view=remote` 复位。
 */
export const PHONE_VIEW_COOKIE = 'dshk_view';
/** 小于这个体积不值得压（压完头开销都不够，还多占一次 CPU） */
const COMPRESS_MIN_BYTES = 1024;
/**
 * 值得压的响应类型：文本类（JS/CSS/JSON/SVG/HTML…）。图片/字体/视频本身已压过，
 * 再压只是白烧宿主的 CPU。**text/event-stream 明确排除**：SSE 靠逐条 flush 保实时，
 * 过一遍压缩流会被攒成块，等于把实时性压没了。
 */
const COMPRESSIBLE_TYPE_RE = /^(?:text\/(?!event-stream)|application\/(?:json|javascript|xml|xhtml\+xml|wasm)|image\/svg\+xml)/i;
export function isCompressibleType(contentType) {
    return typeof contentType === 'string' && COMPRESSIBLE_TYPE_RE.test(contentType.trim());
}
/**
 * 客户端 accept-encoding 里我们能提供的编码，按偏好取最优（br > gzip > deflate）；
 * 缺失或不含任何可支持编码返回 null。q=0 视为明确拒绝。
 */
export function pickEncoding(acceptEncoding) {
    if (typeof acceptEncoding !== 'string' || acceptEncoding.trim() === '')
        return null;
    const raw = acceptEncoding.toLowerCase();
    for (const enc of ['br', 'gzip', 'deflate']) {
        const m = new RegExp('(?:^|,)\\s*' + enc + '\\s*(?:;\\s*q=([0-9.]+))?').exec(raw);
        if (m && (m[1] === undefined || Number(m[1]) > 0))
            return enc;
    }
    return null;
}
/** br 质量档：Node 默认走最高档 11，而网关最重的那个包（插件客户端合并包，
 *  实测 11.19MB）在 11 档要 ~14s CPU、5 档 0.32s 而体积只大 7%——压缩跑在
 *  libuv 线程池里，十几秒的档位会把远程首连那阵子的宿主 fs/网络一起拖住。
 *  两个 br 入口（流式 / 一次性）共用这一份，避免只改一处。 */
export const BROTLI_QUALITY = 5;
export function brotliOptions() {
    return { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } };
}
/** 按编码名取压缩流/一次性压缩器 */
function compressor(enc) {
    return enc === 'br' ? zlib.createBrotliCompress(brotliOptions()) : enc === 'gzip' ? zlib.createGzip() : zlib.createDeflate();
}
function compressBuffer(enc, buf) {
    return new Promise((resolve, reject) => {
        const cb = (err, out) => (err ? reject(err) : resolve(out));
        if (enc === 'br')
            zlib.brotliCompress(buf, brotliOptions(), cb);
        else if (enc === 'gzip')
            zlib.gzip(buf, cb);
        else
            zlib.deflate(buf, cb);
    });
}
/**
 * insecure-context 兜底：前端用 crypto.randomUUID 生成 rpcId，该 API 仅在
 * 安全上下文（HTTPS / localhost）存在，局域网明文 HTTP 访问会全站抛
 * "crypto.randomUUID is not a function"，官方 RPC 全灭而 kit 端点幸存。
 * 用不要求安全上下文的 getRandomValues 实现同形兜底，注入进代理的 HTML。
 */
const POLYFILL_SCRIPT = '<script>(function(){var c=window.crypto;if(!c||typeof c.randomUUID==="function")return;' +
    'try{Object.defineProperty(c,"randomUUID",{configurable:true,value:function(){' +
    'var b=c.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;' +
    'var h=[];for(var i=0;i<16;i++){h.push((b[i]+256).toString(16).slice(1));}' +
    'return h.join("").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,"$1-$2-$3-$4-$5");}})}catch(e){}})();</script>';
/**
 * 「远端点了也只会落到电脑上」的宿主专属入口：这些入口的作用对象是运行 dsh 的那台机器，
 * 从网关进来的客户端点了只会落到电脑上（或什么都不发生）。处置是**置灰 + 点击
 * 给一句提示**，不是隐藏——这些位置同时承担信息显示（比如"当前在哪个工作区"），
 * 删掉就是凭空少一块，而判据一旦变化还得靠人重新发现。选择器只用语义属性：
 * 「在应用中打开」（`dsh-client-ui-open-in-app`）的主键 aria-label 带应用名
 * （"在 VS Code 中打开工作目录"，出错时还会变成"打开失败"）故按前后缀匹配；
 * 下拉键（"选择打开方式"）标签固定。
 */
const HOST_ONLY_LOCKED = [
    'button[aria-label="选择打开方式"]',
    'button[aria-label="Choose an app to open in"]',
    'button[aria-label^="在 "][aria-label$=" 中打开工作目录"]',
    'button[aria-label^="Open workspace in "]',
    // 官方右侧边栏开始页的「工作区文件」胶囊（`dsh-client-ui-sidebar-files` 的 guide 条目，
    // id 固定为 files）。用户定（2026-09-12）：远程视图里一并置灰——kit 自己的文件树才是
    // 手机端要用的那个，官方这份只读列表留着就是两个文件入口打架
    'button[data-sidebar-right-guide-entry="files"]',
];
/**
 * 交付文件卡（`dsh-client-ui-deliverables` 的 PresentedFileCard）——**条件锁**：
 * 卡上的「打开」只是浏览器侧预览，**登录端能自己接管这次点击时不该锁**（kit 客户端
 * 的 capture 拦截器会把卡点击改投自己的文件签，先看后下，下载按钮长在文件签上）；
 * 接管关着时（chatOpenFilePreview 关，或文件树与源代码管理都关）才锁——否则点击
 * 落到"手机上看不了"的官方侧边栏预览。判据见 index.ts 的 lockPresentedCard。
 * 卡下拉里的宿主动作始终由 PRESENTED_HOST_ACTION_RE 按项文本拦（菜单走 portal）。
 * 历史更正：「本轮文件改动」chip 行的属性是 data-produced-files-row，与交付卡的
 * data-presented-file 不是同一属性的单复数形态，别按名字推关系。
 */
const PRESENTED_LOCKED = ['[data-presented-file]'];
/**
 * 「添加工作区」入口：只在宿主 picker 服务不了远程客户端时并入。browse 后端让远程
 * 浏览器自己在页面里列目录、建文件夹，锁掉是白丢功能；native 的 pick 会在宿主屏幕
 * 弹 OS 对话框（点击者与那块屏幕不在一处），且它没有 browse 的 list 能力（RPC 直接
 * directory-picker/unavailable），远程端拿不到等价交互。
 *
 * **「选择工作区」不能锁**（用户定稿 2026-09-12）：它是工作区切换 chip，`ui-conversation`
 * 的 hero chip 无论当前选没选工作区，aria-label 恒为「选择工作区」（选中的工作区名只在
 * 可见文本里），锁了就切不了工作区——而真正开 picker 的是它菜单里的「添加工作区…」。
 */
const PICKER_LOCKED = [
    'button[aria-label="添加工作区"]',
    'button[aria-label="Add workspace"]',
];
/** chip 菜单里的「添加工作区…」项只有文本可认（无稳定属性、hashed class 不用），按前缀匹配 */
const ADD_MENU_ITEM_RE = '^(?:添加工作区|Add workspace)';
/**
 * 设置页头的「打开配置文件」按钮同样只有文本可认（`dsh-client-ui-settings-general` 的
 * 无 aria-label 的 Button）：它直接编辑宿主的 settings.yaml，远程端一并锁住。
 */
const OPEN_DOCUMENT_RE = '^(?:打开配置文件|Open configuration file)$';
/**
 * 交付卡片下拉里的宿主动作——卡片本体已放行（预览改投 kit 文件签），这里锁的是
 * 那几个只在电脑上执行的动作；菜单走 portal 渲染在卡片之外，故按项文本命中。
 */
const PRESENTED_HOST_ACTION_RE = '^(?:用默认应用打开|打开所在文件夹|在文件资源管理器中显示|在 Finder 中显示|Open in default app|Open containing folder|Show in File Explorer|Show in Finder)$';
/** 锁住的提示只有一句：这些入口的性质一样（都在电脑那台机器上执行），不必一钮一文案 */
const LOCK_HINT = '请在电脑端操作';
/**
 * 网关注入的辅助脚本。锚点是宿主前端的 DOM 实现细节（hashed class 不用、只用语义
 * 属性/文本），宿主升级改版会静默失效——失效表现是"弹窗又出现/入口又能点"，无副作用；
 * 复核基线 dsh 0.1.5-rc.2。
 * ① 内测声明弹窗（welcome notice）：远程浏览器的 settings scope 是内存模式，已读状态
 *    存不住，每次加载都会弹——脚本轮询自动点「继续」。
 * ② 宿主专属入口置灰（见 HOST_ONLY_LOCKED / PICKER_LOCKED / PRESENTED_LOCKED / 两个
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
export function phoneAssistScript({ remoteView, pickerLocked, presentedLocked }) {
    const sels = [...HOST_ONLY_LOCKED, ...(pickerLocked ? PICKER_LOCKED : []), ...(presentedLocked ? PRESENTED_LOCKED : [])];
    const texts = [...(pickerLocked ? [ADD_MENU_ITEM_RE] : []), OPEN_DOCUMENT_RE, PRESENTED_HOST_ACTION_RE];
    const data = JSON.stringify({
        // 非远程视图时数据为空：脚本只剩内测弹窗那段
        sels: remoteView ? sels : [],
        texts: remoteView ? texts : [],
        hint: LOCK_HINT,
        diag: '/dsh-kit/phone/tapdiag',
    });
    return '<script>(function(){' +
        // 必须赶在宿主脚本之前（注入点在 <head> 开标签后），宿主前端启动时就把它读走了
        (remoteView ? 'globalThis.__DSH_TRANSPORT__=Object.assign({},globalThis.__DSH_TRANSPORT__,{ownsHost:true});' : '') +
        'var D=' + data + ';' +
        'var res=[];for(var i=0;i<D.texts.length;i++)res.push(new RegExp(D.texts[i]));' +
        'function applyLock(){if(!D.sels.length)return;' +
        'var css="";' +
        'for(var i=0;i<D.sels.length;i++)css+=D.sels[i]+"{opacity:.45!important;cursor:not-allowed!important}";' +
        'var s=document.createElement("style");s.textContent=css;document.head.appendChild(s);}' +
        // 文本命中：从点击目标向上找到第一个可交互祖先（按钮/菜单项），比它的整段文本
        'function textLocked(el){if(!res.length)return false;' +
        'for(var n=el;n&&n!==document.body;n=n.parentElement){' +
        'var role=n.getAttribute&&n.getAttribute("role");' +
        'if(n.tagName==="BUTTON"||role==="menuitem"||role==="button"){' +
        'var text=(n.textContent||"").trim();' +
        'for(var i=0;i<res.length;i++)if(res[i].test(text))return true;' +
        'return false;}}' +
        'return false;}' +
        // 文本命中只可能是「菜单项」和「设置页按钮」两类：dialog 里的按钮 + 弹出菜单项
        // （chip 菜单的「添加工作区…」是 div[role=menuitem]，故查询要带 role 选择器）
        'function grayTextTargets(root){var b=root.querySelectorAll(\'button,[role="menuitem"],[role="button"]\');' +
        'for(var i=0;i<b.length;i++)if(textLocked(b[i])){b[i].style.opacity=".45";b[i].style.cursor="not-allowed";}}' +
        'function graySurfaces(){var d=document.querySelectorAll(\'[role="dialog"],[role="menu"]\');for(var i=0;i<d.length;i++)grayTextTargets(d[i]);}' +
        'var hintEl=null,hintTimer=null;' +
        'function showHint(text){' +
        'if(!hintEl){hintEl=document.createElement("div");' +
        'hintEl.style.cssText="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483647;max-width:82vw;' +
        'padding:8px 14px;border-radius:8px;background:rgba(28,28,30,.92);color:#fff;font-size:13px;line-height:1.45;' +
        'text-align:center;pointer-events:none;opacity:0;transition:opacity .2s";document.body.appendChild(hintEl);}' +
        'hintEl.textContent=text;hintEl.style.opacity="1";' +
        'if(hintTimer)clearTimeout(hintTimer);' +
        'hintTimer=setTimeout(function(){hintEl.style.opacity="0";},2400);}' +
        'function locked(target){' +
        'for(var i=0;i<D.sels.length;i++)if(target.closest&&target.closest(D.sels[i]))return true;' +
        'return textLocked(target);}' +
        // 触屏 hover/focus 清理。三件事都得做对，少一件就是"偶尔漏了触发"：
        // ① 两族都补：宿主粘滞面多为 onPointerEnter/Leave（轮次导航预览、轨迹悬停卡、侧边栏
        //    滚动条…），React 不会用 mouse 事件合成 onPointerLeave，只补 mouseout 等于没做。
        // ② 落点要活：点按会让被点节点重渲染（侧栏收起就换节点），事件发给脱离文档的节点不会
        //    冒泡到 React 根——按坐标重新取一次命中元素，保证事件落在还在文档里的节点上。
        // ③ 焦点只在没有弹出层时补：宿主的模型选择器把 onBlur 当关闭信号且只放过 relatedTarget
        //    在根/菜单内的情形，合成事件没有 relatedTarget，点开就被收。"指针离开"与弹出层无关，
        //    照发（它不会关掉任何菜单）。
        'function leave(el){' +
        'if(!el||el.isConnected===false)return;' +
        'try{el.dispatchEvent(new PointerEvent("pointerout",{bubbles:true,relatedTarget:document.body}));}catch(e){}' +
        'try{el.dispatchEvent(new MouseEvent("mouseout",{bubbles:true,relatedTarget:document.body}));}catch(e){}}' +
        'function popupOpen(){' +
        'try{if(document.querySelector(\'[role="menu"],[role="listbox"],[role="dialog"]\'))return true;}catch(e){}' +
        'var a=document.activeElement;return !!(a&&a.getAttribute&&a.getAttribute("aria-expanded")==="true");}' +
        'function clearTouchState(el,x,y){' +
        // 落点要发**不止一处**：点按后浮上来的提示气泡可能正好压在按钮上，这时按坐标取到的是气泡，
        // 事件发给它不会经过按钮 —— 按钮的悬停态就留着，下一次点按又点在气泡上（实测到的"点了没反应"
        // 就是这个链）。所以原目标、坐标命中元素、以及后者的可交互祖先各发一次（各自还在文档里才发）。
        'var at=null;try{if(x!==undefined&&x!==null)at=document.elementFromPoint(x,y);}catch(e){}' +
        'leave(el);' +
        'if(at&&at!==el)leave(at);' +
        'try{var anc=at&&at.closest?at.closest(\'button,[role="button"],[role="menuitem"]\'):null;if(anc&&anc!==at&&anc!==el)leave(anc);}catch(e){}' +
        'if(popupOpen())return;' +
        'var a=document.activeElement;' +
        'if(a&&a!==document.body){' +
        'var t=a.tagName,ed=a.isContentEditable||t==="INPUT"||t==="TEXTAREA"||t==="SELECT";' +
        'if(!ed)try{a.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));}catch(e){}}}' +
        'function armTouchCleanup(){' +
        'if(!((navigator.maxTouchPoints||0)>0||"ontouchstart" in window))return;' +
        // 顺序是硬的：清理必须落在这次点按的 click **之后**。首连那阵子主线程卡，touchend 后挂的
        // 0ms 定时器可能抢在 click 前面跑——清理引发的重渲染会把手指底下那个节点换掉，随后到来的
        // click 落到脱离文档的节点上被吞，表现正是"刚连上那一会点了没反应，再点一下才好"（不只侧栏）。
        // 所以改成：touchstart 记账 → click/touchcancel 到了再排清理（0ms，排在 React 处理完 click
        // 之后）；700ms 没等到 click（点在非交互区、手势变滚动）也要清，不能让悬停留着。
        'var pend=null;' +
        'function flush(){if(!pend)return;clearTimeout(pend.timer);var p=pend;pend=null;' +
        'setTimeout(function(){clearTouchState(p.el,p.x,p.y);},0);}' +
        'document.addEventListener("touchstart",function(ev){var t=ev.touches&&ev.touches[0];' +
        'if(pend)clearTimeout(pend.timer);' +
        'var rec={el:ev.target,x:t?t.clientX:null,y:t?t.clientY:null,timer:null};' +
        'rec.timer=setTimeout(function(){if(pend===rec){pend=null;clearTouchState(rec.el,rec.x,rec.y);}},700);' +
        'pend=rec;},true);' +
        'document.addEventListener("click",flush,true);' +
        'document.addEventListener("touchcancel",flush,true);}' +
        // 点按诊断（**临时排障用，定位完连宿主端点一起删**）：记每条点按的 touchstart→click 生命周期。
        // click 没来就记 lost，并在 700ms 时记下"该坐标现在是谁"——用来分辨是"点击被吞"（DOM 在手指
        // 底下被换掉）还是"点到了但没人管"（locked / 组件没接线）。批量 POST 回宿主，电脑端读。
        'function tapDesc(el){if(!el)return "?";var s="";' +
        'try{s=(el.getAttribute&&(el.getAttribute("aria-label")||el.getAttribute("title")))||el.textContent||"";}catch(e){}' +
        'var cls="";try{var c=el.className;cls=String(c&&c.baseVal!==undefined?c.baseVal:c||"").split(" ")[0].slice(0,16);}catch(e){}' +
        'var btn="";try{var b=el.closest&&el.closest(\'button,[role="button"],[role="menuitem"]\');btn=b?String(b.getAttribute("aria-label")||(b.textContent||"").trim()).slice(0,14):"";}catch(e){}' +
        'var tip="";try{tip=el.closest&&el.closest(\'[role="tooltip"]\')?"TIP":"";}catch(e){}' +
        'return String(el.tagName||"?")+"|"+cls+"|"+tip+(btn?"|in:"+btn:"")+"|"+String(s).replace(/\\s+/g," ").trim().slice(0,18);}' +
        'function tapSend(list){try{fetch(D.diag,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(list),keepalive:true}).catch(function(){});}catch(e){}}' +
        'function armTapDiag(){' +
        'var t0=Date.now(),buf=[],pend=null;' +
        'function ms(){return Date.now()-t0;}' +
        'function push(rec){buf.push(rec);if(buf.length>=8)tapSend(buf.splice(0,buf.length));}' +
        'function atPoint(x,y){try{var el=document.elementFromPoint(x,y);return el?tapDesc(el):null;}catch(e){return null;}}' +
        'document.addEventListener("touchstart",function(ev){var t=ev.touches&&ev.touches[0];' +
        'pend={t:ms(),target:tapDesc(ev.target),locked:locked(ev.target),popup:popupOpen(),' +
        'x:t?Math.round(t.clientX):null,y:t?Math.round(t.clientY):null,el:ev.target};},true);' +
        'document.addEventListener("click",function(ev){' +
        'if(pend){pend.clicked=ms();pend.clickTarget=tapDesc(ev.target);pend.same=pend.target===pend.clickTarget;' +
        'pend.popupAfter=popupOpen();delete pend.el;push(pend);pend=null;}' +
        'else push({t:ms(),clickNoTouch:tapDesc(ev.target),locked:locked(ev.target),popup:popupOpen()});},true);' +
        'setInterval(function(){if(pend&&ms()-pend.t>700){pend.lost=ms();' +
        'try{pend.elConnected=pend.el.isConnected;}catch(e){}delete pend.el;' +
        'pend.atPoint=atPoint(pend.x,pend.y);pend.popupLater=popupOpen();push(pend);pend=null;}' +
        'if(buf.length)tapSend(buf.splice(0,buf.length));},400);}' +
        'function dismissNotice(){var d=document.querySelector(\'[role="dialog"]\');if(!d)return false;' +
        'var b=d.querySelectorAll("button");' +
        'for(var i=0;i<b.length;i++){if((b[i].textContent||"").indexOf("继续")!==-1){b[i].click();return true;}}' +
        'return false;}' +
        'function boot(){applyLock();' + (remoteView ? 'armTouchCleanup();armTapDiag();' : '') +
        'if(D.sels.length||res.length){' +
        'document.addEventListener("click",function(ev){' +
        // 每次点击后补两次置灰：弹出菜单/对话框是刚挂上来的，2s 轮询之外再抢一拍
        'setTimeout(graySurfaces,80);setTimeout(graySurfaces,400);' +
        'if(!locked(ev.target))return;' +
        'ev.preventDefault();ev.stopPropagation();showHint(D.hint);},true);' +
        'graySurfaces();setInterval(graySurfaces,2000);}' +
        'var n=0;var t=setInterval(function(){n++;if(dismissNotice()||n>40)clearInterval(t);},250);}' +
        'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();' +
        '})();</script>';
}
/** 在 HTML 的 <head> 开标签后插入脚本；找不到开标签就整体前置 */
export function injectHeadScript(html, script) {
    const match = /<head[^>]*>/i.exec(html);
    if (match === null)
        return script + html;
    const idx = match.index + match[0].length;
    return html.slice(0, idx) + script + html.slice(idx);
}
/** 生成一个高熵令牌（192-bit，URL 安全） */
export function newToken() {
    return crypto.randomBytes(24).toString('base64url');
}
/** base64url 编码（与 dsh client-connection 的 encodeBase64Url 一致） */
function encodeBase64Url(buf) {
    return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
/**
 * 铸造 dsh web 浏览器会话 cookie。算法对齐 @deepseek-ai/dsh-client-connection：
 * 名 = `dsh-auth-<b64url(sha256(authority))>`，值 = `v1.<b64url(payload)>.<b64url(hmac(secret, body))>`，
 * payload = {version:1, authority, issuedAt, expiresAt}。跨度取 1 天：dsh 校验要求
 * 跨度 ≤ 其 cookieMaxAgeDays 配置（默认 30），而网关每请求现铸（issuedAt≈now），
 * 跨度只影响上限兼容——取 1 天对任何 ≥1 天的配置都成立。
 */
export function dshSessionCookie({ secret, authority, issuedAt = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000 }) {
    const name = 'dsh-auth-' + encodeBase64Url(crypto.createHash('sha256').update(authority).digest());
    const payload = { version: 1, authority, issuedAt, expiresAt: issuedAt + maxAgeMs };
    const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const value = `v1.${body}.${encodeBase64Url(crypto.createHmac('sha256', secret).update(body).digest())}`;
    return `${name}=${value}`;
}
/** 定长无关的恒时字符串比较 */
function safeEq(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ab, bb);
}
/** 极简 Cookie 解析（只需要取一个名值对） */
export function parseCookies(header) {
    const out = {};
    if (typeof header !== 'string')
        return out;
    for (const pair of header.split(';')) {
        const idx = pair.indexOf('=');
        if (idx < 0)
            continue;
        out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    return out;
}
/**
 * 默认令牌持久化文件：<DSH_HOME>/data/dsh-kit-phone-gateway.json。
 * 重启 dsh 后令牌不变，手机端 Cookie 继续有效；文件损坏则重新生成
 * （等价于一次轮换，旧链接失效属预期）。
 */
export function defaultStateFile() {
    const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
        ? process.env.DSH_HOME
        : os.tmpdir();
    return path.join(home, 'data', 'dsh-kit-phone-gateway.json');
}
/**
 * 状态文件读写（令牌 + 网关启用位）。启用位独立于 settings 通道：
 * 设置读取器回填有时序滞后，网关开关用文件直管，见 index.ts 的
 * /dsh-kit/phone/gateway 端点。
 */
export function loadGatewayState(stateFile, log = () => { }) {
    try {
        const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (typeof raw?.token !== 'string' || raw.token.length < 20)
            throw new Error('token 缺失或过短');
        return {
            token: raw.token,
            enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
        };
    }
    catch (error) {
        const code = error?.code;
        if (code !== 'ENOENT')
            log(`状态文件读取失败，将重新生成：${error instanceof Error ? error.message : String(error)}`);
        return { token: newToken(), enabled: false };
    }
}
export function saveGatewayState(stateFile, { token, enabled }, log = () => { }) {
    try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        const body = JSON.stringify({ token, enabled, createdAt: new Date().toISOString() });
        const tmp = `${stateFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, stateFile);
    }
    catch (error) {
        log(`状态文件写入失败（重启后将回退默认）：${error instanceof Error ? error.message : String(error)}`);
    }
}
/** Windows 热点/Wi-Fi Direct 与常见虚拟交换机的网卡名——它们上的地址对局域网
 *  二维码是噪音：热点客户端经本机转发照样能访问实体网卡的地址（192.168.137.1
 *  那块「本地连接* N」实测冗余），VMware/Hyper-V/WSL 的 host-only 从不面向局域网 */
const VIRTUAL_IFACE_RE = /^(本地连接\*|Local Area Connection\*|vEthernet|VMware Network Adapter|VirtualBox Host-Only)/i;
/** 本机非回环 IPv4 地址列表（二维码里局域网链接的候选）；@param interfaces 测试注入用 */
export function lanAddresses(interfaces = os.networkInterfaces()) {
    return Object.entries(interfaces)
        .filter(([name]) => !VIRTUAL_IFACE_RE.test(name))
        .flatMap(([, iface]) => iface ?? [])
        .filter((iface) => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
        .map((iface) => iface.address);
}
export function startPhoneGateway({ port, upstreamPort, stateFile = defaultStateFile(), log = () => { }, sessionSecret = null, lockPickerEntries = () => true, lockPresentedCard = () => true }) {
    if (!Number.isInteger(port) || port < 0 || !Number.isInteger(upstreamPort) || upstreamPort <= 0) {
        throw new Error('startPhoneGateway: port 必须是非负整数（0=系统自选），upstreamPort 必须是正整数');
    }
    const boot = loadGatewayState(stateFile, log);
    let token = boot.token;
    // 首次运行立即落盘：否则重启会重新随机生成，手机 Cookie 活不过第一次重启
    saveGatewayState(stateFile, { token, enabled: boot.enabled }, log);
    /** 从请求里验令牌：query ?k= 或 Cookie，二者其一命中即可 */
    function authorized(req, urlObj) {
        const q = urlObj.searchParams.get('k');
        if (q !== null && q !== '' && safeEq(q, token))
            return true;
        const cookie = parseCookies(req.headers.cookie)[PHONE_COOKIE];
        return typeof cookie === 'string' && cookie !== '' && safeEq(cookie, token);
    }
    function notFound(res) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('Not Found');
    }
    /** 取当前挑选入口判定；判据抛错按"服务不了"处理（保守：宁可锁住，也不让点击落到宿主屏幕） */
    const pickerLocked = () => {
        try {
            return lockPickerEntries();
        }
        catch {
            return true;
        }
    };
    /** 取当前交付卡判定；抛错按"锁住"处理（同 pickerLocked 的保守方向） */
    const presentedLocked = () => {
        try {
            return lockPresentedCard();
        }
        catch {
            return true;
        }
    };
    /** 自铸的 dsh web 会话 cookie 头值；密钥未就绪时返回 null */
    const sessionCookieHeader = () => {
        if (sessionSecret === null)
            return null;
        const secret = typeof sessionSecret === 'function' ? sessionSecret() : sessionSecret;
        if (secret === null)
            return null;
        return dshSessionCookie({ secret, authority: `127.0.0.1:${upstreamPort}` });
    };
    /**
     * 组装转发头：Host 改写为回环上游、剥 Origin（fence 视作回环同源）、
     * 剥本网关 Cookie（不把网关令牌漏给上游）、注入 dsh web 会话 Cookie、滤逐跳头。
     */
    function proxyHeaders(src, upgrade) {
        const headers = { ...src };
        headers.host = `127.0.0.1:${upstreamPort}`;
        delete headers.origin;
        // 统一要未压缩响应：上游（dsh 自身）不做压缩，拿到原文才能注入 HTML；
        // 客户端要的压缩由本层按能力自己做（见 maybeCompress）
        delete headers['accept-encoding'];
        // 合并 Cookie：上游原值 + 自铸的 dsh web 会话 cookie（新版 dsh web 鉴权必需），
        // 再摘掉网关令牌，其余原样透传
        const cookies = parseCookies(headers.cookie);
        const session = sessionCookieHeader();
        if (session !== null) {
            const eq = session.indexOf('=');
            if (eq > 0)
                cookies[session.slice(0, eq)] = session.slice(eq + 1);
        }
        delete cookies[PHONE_COOKIE];
        delete cookies[PHONE_VIEW_COOKIE];
        const pairs = Object.entries(cookies);
        if (pairs.length > 0)
            headers.cookie = pairs.map(([name, value]) => `${name}=${value}`).join('; ');
        else
            delete headers.cookie;
        delete headers['proxy-authorization'];
        delete headers['proxy-connection'];
        if (upgrade) {
            headers.connection = 'Upgrade';
            headers.upgrade = String(src.upgrade ?? 'websocket');
        }
        else {
            delete headers.connection;
            delete headers['keep-alive'];
        }
        return headers;
    }
    const server = http.createServer((req, res) => {
        let urlObj;
        try {
            urlObj = new URL(req.url ?? '/', 'http://gateway.local');
        }
        catch {
            notFound(res);
            return;
        }
        // 链接里的明文令牌：验证即种长期 Cookie 并甩掉 query（地址栏不留令牌）
        const q = urlObj.searchParams.get('k');
        if (q !== null && q !== '') {
            if (!safeEq(q, token)) {
                notFound(res);
                return;
            }
            res.writeHead(302, {
                location: urlObj.pathname,
                'set-cookie': `${PHONE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
                'cache-control': 'no-store',
            });
            res.end();
            return;
        }
        if (!authorized(req, urlObj)) {
            notFound(res);
            return;
        }
        // 视图覆盖：?dshk_view=desktop|remote 落 Cookie 并甩掉 query（同 ?k= 的写法）
        const view = urlObj.searchParams.get('dshk_view');
        if (view === 'desktop' || view === 'remote') {
            res.writeHead(302, {
                location: urlObj.pathname,
                'set-cookie': view === 'desktop'
                    ? `${PHONE_VIEW_COOKIE}=desktop; Path=/; SameSite=Lax; Max-Age=31536000`
                    : `${PHONE_VIEW_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
                'cache-control': 'no-store',
            });
            res.end();
            return;
        }
        const remoteView = parseCookies(req.headers.cookie)[PHONE_VIEW_COOKIE] !== 'desktop';
        const headers = proxyHeaders(req.headers, false);
        const up = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, (upRes) => {
            const out = { ...upRes.headers };
            delete out.connection;
            delete out['keep-alive'];
            delete out['transfer-encoding'];
            const status = upRes.statusCode ?? 502;
            const enc = pickEncoding(req.headers['accept-encoding']);
            const bodyless = status === 204 || status === 304 || req.method === 'HEAD' || out['content-length'] === '0';
            const alreadyEncoded = out['content-encoding'] !== undefined;
            if (/text\/html/i.test(String(out['content-type'] ?? '')) && req.method !== 'HEAD') {
                // HTML 需注入兜底脚本：缓冲整个页面（dsh 首页仅十余 KB）再回写；
                // 压不压另说——Caddy 层还会再压一次，这里只按客户端能力做
                const chunks = [];
                upRes.on('data', (c) => chunks.push(c));
                upRes.on('end', () => {
                    const injected = Buffer.from(injectHeadScript(Buffer.concat(chunks).toString('utf8'), POLYFILL_SCRIPT + phoneAssistScript({ remoteView, pickerLocked: pickerLocked(), presentedLocked: presentedLocked() })), 'utf8');
                    delete out.etag;
                    if (enc !== null && !alreadyEncoded && injected.length >= COMPRESS_MIN_BYTES) {
                        compressBuffer(enc, injected).then((zipped) => {
                            res.writeHead(status, { ...out, 'content-encoding': enc, 'content-length': String(zipped.length), vary: 'accept-encoding' });
                            res.end(zipped);
                        }, () => {
                            // 压缩失败退回原文（可用性优先；此时头还没发出去）
                            res.writeHead(status, { ...out, 'content-length': String(injected.length) });
                            res.end(injected);
                        });
                        return;
                    }
                    res.writeHead(status, { ...out, 'content-length': String(injected.length) });
                    res.end(injected);
                });
                upRes.on('error', () => res.destroy());
                return;
            }
            // 静态资源（JS/CSS/JSON/SVG…）：本地局域网直连时手机拿到的是明文，
            // dsh 自己又不压——这里按客户端 accept-encoding 过一遍压缩流（不缓冲，边压边发）
            if (enc !== null && !bodyless && !alreadyEncoded && isCompressibleType(out['content-type'])) {
                const known = Number(out['content-length']);
                if (!Number.isFinite(known) || known >= COMPRESS_MIN_BYTES) {
                    delete out['content-length'];
                    res.writeHead(status, { ...out, 'content-encoding': enc, vary: 'accept-encoding' });
                    const gz = compressor(enc);
                    gz.on('error', () => res.destroy());
                    upRes.on('error', () => { gz.destroy(); res.destroy(); });
                    upRes.pipe(gz).pipe(res);
                    return;
                }
            }
            res.writeHead(status, out);
            upRes.pipe(res);
            upRes.on('error', () => res.destroy());
        });
        up.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
            }
            res.end('dsh-kit phone gateway: upstream unavailable');
        });
        res.on('close', () => up.destroy());
        req.pipe(up);
    });
    // WebSocket 升级：同样鉴权后手动隧道（101 回写 + 双向 pipe，不经过任何缓冲）
    server.on('upgrade', (req, rawSocket, head) => {
        const socket = rawSocket;
        let urlObj;
        try {
            urlObj = new URL(req.url ?? '/', 'http://gateway.local');
        }
        catch {
            socket.destroy();
            return;
        }
        if (!authorized(req, urlObj)) {
            socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            return;
        }
        const headers = proxyHeaders(req.headers, true);
        const up = http.request({
            host: '127.0.0.1',
            port: upstreamPort,
            path: req.url,
            headers,
        });
        up.on('upgrade', (upRes, upSocket, upHead) => {
            const upSock = upSocket;
            const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage ?? 'Switching Protocols'}`];
            for (const [name, value] of Object.entries(upRes.headers)) {
                if (value === undefined)
                    continue;
                lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
            }
            socket.write(lines.join('\r\n') + '\r\n\r\n');
            // 方向易错点：head 是客户端随升级请求早到的字节（发往上游）；upHead 是
            // 服务端 101 后立即推的字节——真实 dsh 会在此推初始事件帧（实测 436B），
            // 必须写给客户端。两者接反的表现是握手成功但零帧、随即 1002 断开。
            if (head !== undefined && head.length > 0)
                upSock.write(head);
            if (upHead !== undefined && upHead.length > 0)
                socket.write(upHead);
            upSock.setNoDelay(true);
            socket.setNoDelay(true);
            upSock.pipe(socket);
            socket.pipe(upSock);
            const die = () => {
                try {
                    socket.destroy();
                }
                catch { /* 已销毁 */ }
                try {
                    upSock.destroy();
                }
                catch { /* 已销毁 */ }
            };
            upSock.on('error', die);
            socket.on('error', die);
            upSock.on('close', die);
            socket.on('close', die);
        });
        up.on('error', () => socket.destroy());
        up.end();
    });
    const state = { listening: false, error: null };
    server.on('listening', () => {
        state.listening = true;
        state.error = null;
    });
    server.on('error', (error) => {
        state.listening = false;
        state.error = error.message;
        log(`网关监听异常：${state.error}`);
    });
    server.listen(port, '0.0.0.0');
    return {
        port: () => {
            const addr = server.address();
            return typeof addr === 'object' && addr !== null ? addr.port : null;
        },
        token: () => token,
        rotate() {
            // enabled 读状态文件现值而非启动快照：启停走 /dsh-kit/phone/gateway 端点直写
            // 文件，rotate 若回写 boot 值会把用户改过的启用位悄悄回退（重启后网关不自启）
            const enabled = loadGatewayState(stateFile, log).enabled;
            token = newToken();
            saveGatewayState(stateFile, { token, enabled }, log);
            return token;
        },
        fingerprint: () => token.slice(-4),
        state: () => ({ listening: state.listening, error: state.error }),
        close() {
            try {
                server.close();
            }
            catch { /* 已关闭 */ }
        },
    };
}
