import type { BrowserService } from './browser.ts';
import type { DefineTool, ToolDefinition } from '../core/tools.ts';
/** 工具执行上下文里本层用到的最小面（宿主对象运行时才挂载） */
interface ToolExec {
    signal?: AbortSignal;
    agent?: {
        /** 会话 id（分区键） */
        id?: string;
        session?: {
            requestHeader?: () => {
                config?: {
                    provider?: string;
                    model?: string;
                };
            } | null;
            /** durable 会话头（子代理归属上溯用 parentSession） */
            header?: {
                cwd?: string;
                parentSession?: string;
            };
        };
        options?: {
            provider?: string;
            model?: string;
        };
    } | null;
}
interface HostCtx {
    get(name: string): unknown;
}
/** 组装 7 个工具定义（defineTool 来自 dsh-tools，由调用方传入）。
 *  scopeOf = 调用方分区解析（宿主注入：会话 id，子代理上溯到所属主对话）；缺省只认
 *  exec.agent.id，认不出落 DEFAULT_SCOPE。行开关是这一层的唯一开关：关行 = 本模块
 *  不物化、工具不注册，所以工具内部没有第二道启用判断。 */
export declare function buildBrowserTools({ defineTool, service, ctx, scopeOf }: {
    defineTool: DefineTool;
    service: BrowserService;
    ctx: HostCtx;
    scopeOf?: (exec?: ToolExec) => string;
}): ToolDefinition[];
export {};
