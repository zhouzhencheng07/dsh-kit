/** 把一整行命令拆成可执行文件 + 参数；双引号包住的部分不拆（路径里有空格时用） */
export declare function parseCommandLine(command: string): {
    exe: string;
    args: string[];
} | null;
/**
 * 收掉上次插件进程遗留的隧道客户端：插件进程被强杀时子进程会变孤儿，而孤儿还占着
 * 隧道连接——下次启动再拉一个会互相抢。pid 与程序名都对上才动，避免误杀别的进程。
 */
export declare function killStaleTunnel(pid: number, exePath: string, log?: (msg: string) => void): boolean;
export interface TunnelHandle {
    /** 进程 pid；已退出或拿不到时为 null */
    pid(): number | null;
    state(): {
        running: boolean;
        error: string | null;
    };
    stop(): void;
}
export interface StartTunnelOptions {
    /** 一整行启动命令 */
    command: string;
    log?: (msg: string) => void;
}
/** 按命令拉起隧道客户端；命令为空 / 程序不存在 / 启动失败都直接抛错（调用方据此报状态） */
export declare function startTunnel({ command, log }: StartTunnelOptions): TunnelHandle;
