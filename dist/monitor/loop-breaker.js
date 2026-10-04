// 输出侧复读守卫（宿主侧，覆盖全部会话，不依赖浏览器页面）
//
// 判据见 loop-guard.ts：切句后看尾部有没有「同一句/连续几句」在连续重复。动作分两档
// （先警告、继续才停）：
//   警告档（默认连续 3 遍）—— 记一条 warn 日志，并 `agent.inject()` 一条**模型可见**的
//       提醒（叫它停止重复、换方式推进）。当前会话另由客户端那层把提示画在输入框上方。
//   停止档（默认连续 5 遍）—— `agent.cancel({kind:'hook', reason})`，唯一能把原因带进
//       `turn/end` 的通道，前端据此出「检测到死循环已停止」文案。cancel 带 keepInbox：
//       提醒若还没被 claim，留给下一回合，不随取消一起丢。
//
// 数据源 `agent/assistant-stream`（emit；宿主侧收全部 agent 的流式帧）：`text-delta` /
// `reasoning-delta` 带 {text}，正是切句所需原料。累积按**单次 attempt** 记账：每个模型
// 请求的 `start` 帧清零——跨 attempt 的相同收尾句（每步收尾都说同一句）通常是正常输出，
// 不该累计成复读。
//
// 注入的送达时机：`agent.inject` 不唤醒 driver，消息在下一个被 admit 的 pre-step 被
// claim（同一回合里模型再次请求时就到）。纯文本的复读若一步走完整个回合、没有下一个
// pre-step，提醒会停在 inbox，等下一次唤醒（如用户再发消息）才被看到——这也是不自动
// 续跑的前提下的最接近「提醒到模型」的形态。
//
// 为什么不自动续跑：熔断刚发生就自动推一把可能开新循环，要不要继续由人决定。
// 为什么不再看「单步字符数」：长度与复读无关，正常长推理被它误杀——已删除。
import { detectLoop } from "./loop-guard.js";
import { kitLogger } from "../core/log.js";
import { loadDep } from "../core/deps.js";
/** 熔断原因写进 turn/end 的这个串，前端据此选文案 */
export const LOOP_CANCEL_REASON = 'dsh-kit:dead-loop';
/** 累积文本的内存上限：判据只看尾部若干句，留足余量即可 */
const ACCUM_MAX = 12000;
const log = kitLogger('monitor');
/** 模型可见提醒的 source 标记（宿主按 producer kind 归类，未知型按普通 user 消息落） */
const WARNING_SOURCE = { kind: 'dsh-kit-loop-guard' };
/** 模型可见提醒正文：说清是什么、要它做什么 */
function warningText(hit) {
    return ('(dsh-kit loop guard) Detected output repetition: the same content has now repeated ' +
        `${hit.copies} times in a row at the end of your output. Stop repeating immediately, ` +
        'briefly state the current status, and continue the task a different way.');
}
// 宿主 createUserMessage（消息 id/冻结由它生成）；拿不到就只记日志，不注入。
const llmDep = loadDep('@deepseek-ai/dsh-llm');
const hostCreateUserMessage = llmDep && typeof llmDep.createUserMessage === 'function' ? llmDep.createUserMessage : null;
function defaultBuildWarning(hit) {
    if (hostCreateUserMessage === null)
        return null;
    try {
        return hostCreateUserMessage({ content: [{ type: 'text', text: warningText(hit) }], source: WARNING_SOURCE });
    }
    catch {
        return null;
    }
}
function intOr(value, fallback) {
    return Number.isInteger(value) ? value : fallback;
}
/**
 * 注册输出侧复读守卫。返回注销函数。
 * @param ctx - 插件 ctx，只需其 `on`（事件注册）；用 inject 等到 `agent` 服务就位
 * @param options - 配置读取口与提醒构造口
 */
export function registerLoopGuard(ctx, options) {
    const states = new WeakMap();
    const buildWarning = options.buildWarning ?? defaultBuildWarning;
    const stateOf = (agent) => {
        let st = states.get(agent);
        if (st === undefined) {
            st = { text: '', warned: false, stopped: false };
            states.set(agent, st);
        }
        return st;
    };
    const injectWarning = (agent, hit) => {
        const message = buildWarning(hit);
        if (message === null || message === undefined)
            return;
        try {
            if (typeof agent.inject === 'function')
                agent.inject(message);
        }
        catch {
            // 注入失败不影响分档：继续重复仍会走到停止档
        }
    };
    const off = ctx.on('agent/assistant-stream', (payload) => {
        const agent = payload?.agent;
        if (!agent)
            return;
        let cfg;
        try {
            cfg = options.readSettings();
        }
        catch {
            return; // 配置不可读：本帧放行
        }
        if (cfg.monitorEnabled === false)
            return;
        const frame = payload.frame;
        if (!frame)
            return;
        const st = stateOf(agent);
        if (frame.type === 'start') {
            // 新 attempt：重置累积与分档标记
            st.text = '';
            st.warned = false;
            st.stopped = false;
            return;
        }
        if (frame.type !== 'chunk')
            return;
        const chunk = frame.chunk;
        if (chunk?.type !== 'text-delta' && chunk?.type !== 'reasoning-delta')
            return;
        const piece = typeof chunk.text === 'string' ? chunk.text : '';
        if (piece === '' || st.stopped)
            return;
        st.text = st.text.length + piece.length > ACCUM_MAX ? (st.text + piece).slice(-ACCUM_MAX) : st.text + piece;
        const hit = detectLoop(st.text);
        if (hit === null)
            return;
        const warnCopies = intOr(cfg.monitorWarnCopies, 3);
        const stopCopies = Math.max(intOr(cfg.monitorStopCopies, 5), warnCopies + 1);
        if (hit.copies < warnCopies)
            return;
        if (!st.warned) {
            st.warned = true;
            log.warn('检测到输出复读（警告档：提醒模型，先不停）', { units: hit.units, copies: hit.copies, chars: hit.chars });
            injectWarning(agent, hit);
        }
        if (hit.copies < stopCopies)
            return;
        st.stopped = true;
        log.warn('复读持续，停止当前回合', { units: hit.units, copies: hit.copies, chars: hit.chars });
        try {
            agent.cancel({ kind: 'hook', reason: LOOP_CANCEL_REASON }, { keepInbox: true });
        }
        catch {
            // agent 已结束或不可取消：状态已清，本 attempt 不会再有输出
        }
    });
    return () => {
        try {
            off();
        }
        catch {
            /* 已注销 */
        }
    };
}
