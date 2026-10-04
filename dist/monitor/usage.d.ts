import http from 'node:http';
/** 宿主对象最小依赖面（与其它模块同约定：只声明实际触达的成员） */
interface UsageWebServer {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
    }): () => void;
}
export interface UsageDeps {
    webServer: UsageWebServer;
    /** dsh-credentials 服务：resolve 解析凭证引用；readRecord 只是占位共享（弱类型检查要求至少一个同名成员） */
    credentials: {
        resolve?: (ref: string) => Promise<{
            value: string;
            source: string;
        } | undefined>;
        readRecord?: (name: string) => Promise<unknown>;
    };
    /** 总开关（usageEnabled），关 = 端点 403、前端入口同步隐藏 */
    readSettings: () => {
        usageEnabled?: boolean;
    };
    /** llm-pi-ai entry 配置现读（configEditor 现读），缺服务时回 null */
    readProviderConfig: () => unknown;
}
/** 注册 /dsh-kit/usage；返回注销函数（插件卸载时撤路由） */
export declare function registerUsageRoutes(deps: UsageDeps): () => void;
export {};
