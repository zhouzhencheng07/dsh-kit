/** 工具定义的结构契约（dsh-tools 的 defineTool 产物按名字注入注册表） */
export interface ToolDefinition {
    name: string;
    [key: string]: unknown;
}
export interface DefineToolOptions {
    name: string;
    description: string;
    parameters: Record<string, {
        type: string;
        required?: boolean;
        enum?: string[];
        description?: string;
    }>;
    output: {
        schema: Record<string, unknown>;
        render: (args: unknown, value: any) => Array<Record<string, unknown>>;
    };
    timeoutMs?: number;
    /** 原生呈现卡（宿主 dsh-tools 同名约定）：工具调用行的标题/类别，纯函数只读 args */
    presentCall?: (args: any) => {
        card: 'generic';
        title: string;
        kind?: string;
        rawInput?: unknown;
    } | undefined;
    /** exec 的执行面由各工具的调用方具化（本契约按 unknown 收） */
    execute: (args: any, exec?: any) => Promise<unknown>;
}
export type DefineTool = (options: DefineToolOptions) => ToolDefinition;
/** 异步两锚点加载 @deepseek-ai/dsh-tools（ESM）。失败返回 null。 */
export declare function loadToolsModule(log?: (msg: string) => void): Promise<any>;
