// 子进程环境清洗（宿主半边公共件）。
//
// 宿主是拿 Electron 二进制当 node 跑起来的（启动时设 ELECTRON_RUN_AS_NODE=1），这个标记
// 一路继承到它拉起的每个子进程：Electron 系可执行文件因此以 node 身份运行——窗口不出现，
// 目录参数被当成脚本入口。凭证类与 DSH_* 变量同样不该交给用户配置的第三方程序。
//
// 只能清洗"我们起的"子进程：这个标记不能从宿主自己的环境里删——官方那些 node 子进程
// 正靠继承它以 node 身份跑（子进程 runner、目录选择器 worker 等）。
/** 摘掉 ELECTRON_RUN_AS_NODE、凭证类与 DSH_* 变量，其余原样保留 */
export function scrubbedChildEnv(base = process.env) {
    const env = {};
    for (const [key, value] of Object.entries(base)) {
        if (value === undefined)
            continue;
        const upper = key.toUpperCase();
        if (upper === 'ELECTRON_RUN_AS_NODE')
            continue;
        if (/KEY|PASSWORD|SECRET|TOKEN/.test(upper))
            continue;
        if (upper.startsWith('DSH_'))
            continue;
        env[key] = value;
    }
    return env;
}
