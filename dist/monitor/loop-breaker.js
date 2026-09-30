// 输出侧死循环熔断器（宿主侧，覆盖全部会话，不依赖浏览器页面）
//
// 官方 agent-loop 的 turn 是无预算的 `while(true)`（`agent-loop/README.md:219`
// 明写 "No built-in turn budget"），官方也没有任何针对模型输出文本退化的保护
// ——官方讨论 #2848 确认这是缺口。本模块补这一层：
//
//   数据源 `agent/assistant-stream`（emit；宿主侧收**全部** agent 的流式帧，
//          与页面开没开、当前看哪个会话无关）：帧里的 `text-delta` /
//          `reasoning-delta` 带 {index, text}，正是判据所需原料。
//   判据   loop-guard.ts：①②（复读/绕圈）看尾部文本，③（单步过长）看本 attempt 的
//          累计字符数——累积文本有内存闸，长度不能当依据。
//   动作   `agent.cancel({kind:'hook', reason})` —— 唯一能把熔断原因带进
//          `turn/end` 的通道（`AgentCancelCause` 的 hook 分支带 reason 字符串），
//          前端据此选「检测到死循环已停止」这类可读文案。
//
// 为什么不用 `agent/pre-step` 返回 {kind:'reject'}：那条路让 turn 以 blocked 收口
// 但 reject 无载荷、带不了原因，通知只能说「卡住」。cancel 还更早生效（不必等
// 下一步开始），且不吞掉已 claim 的消息批次。
//
// 熔断后不自动续跑：自动续跑正是 429 机制退役前那套误报的来源，且熔断刚发生就
// 自动推一把可能开新循环。要不要继续由人决定。
//
// 粒度是「单 attempt」而非「整回合」：帧的 start 边界重置累积。跨 attempt 复读
// 由客户端侧那一层兜（它看的是整段流文本），两层互补。
import { repeatsLooped } from "./loop-guard.js";
/** 熔断原因写进 turn/end 的这个串，前端据此选文案 */
export const LOOP_CANCEL_REASON = 'dsh-kit:dead-loop';
/** 累积文本的内存上限：①② 只看尾部 CYCLE_WINDOW，留数倍余量即可；③ 走 chars
 *  计数，不受这里影响（上限压到阈值以下会让 ③ 永不成立） */
const ACCUM_MAX = 20000;
/**
 * 注册输出侧熔断器。返回注销函数。
 * @param ctx - 插件 ctx，只需其 `on`（事件注册）；用 inject 等到 `agent` 服务就位
 * @param options - 配置读取口
 */
export function registerLoopGuard(ctx, options) {
    const states = new WeakMap();
    const stateOf = (agent) => {
        let st = states.get(agent);
        if (st === undefined) {
            st = { text: '', chars: 0, tripped: false };
            states.set(agent, st);
        }
        return st;
    };
    const trip = (agent, st, cfg) => {
        if (st.tripped)
            return;
        const threshold = Number.isInteger(cfg.monitorRepeatThreshold) ? cfg.monitorRepeatThreshold : 3;
        const maxChars = Number.isInteger(cfg.monitorStepMaxChars) ? cfg.monitorStepMaxChars : 60000;
        if (st.chars <= maxChars && !repeatsLooped(st.text, threshold))
            return;
        st.tripped = true;
        st.text = '';
        try {
            agent.cancel({ kind: 'hook', reason: LOOP_CANCEL_REASON });
        }
        catch {
            // agent 已结束或不可取消：状态已清，本 attempt 不会再有输出
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
        if (frame?.type === 'start') {
            // 新 attempt：重置累积与熔断标记
            states.set(agent, { text: '', chars: 0, tripped: false });
            return;
        }
        if (frame?.type !== 'chunk')
            return;
        const chunk = frame.chunk;
        if (chunk?.type !== 'text-delta' && chunk?.type !== 'reasoning-delta')
            return;
        const piece = typeof chunk.text === 'string' ? chunk.text : '';
        if (piece === '')
            return;
        const st = stateOf(agent);
        if (st.tripped)
            return;
        st.chars += piece.length;
        if (st.text.length + piece.length > ACCUM_MAX) {
            // 超上限只保留尾部：①② 看的是尾部
            st.text = (st.text + piece).slice(-ACCUM_MAX);
        }
        else {
            st.text += piece;
        }
        trip(agent, st, cfg);
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
