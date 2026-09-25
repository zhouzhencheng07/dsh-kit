// dsh-kit 用量与监视组件（宿主半边入口）
//
// 组件化切片：/dsh-kit/usage 聚合端点 + 用量芯片（client/bundle.js）+ 会话监视
// （429 续跑 / 死循环打断）+ 会话通知，从 dsh-kit 主包迁出，独立成 entry
// （bundle patch 插单，profile 里行 id: monitor）。provider 配置读取不依赖
// 主包：经宿主 configEditor 服务现读 llm-pi-ai entry 的合成配置（inherited+
// override 两层 providers 浅合并），凭证经宿主 credentials 按引用解析，key 不出
// 宿主进程。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { registerUsageRoutes } from "./usage.js";
import { sameOrigin } from "../core/index.js";
/**
 * 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录），loadDep 的
 * 第三锚点用。非 DSH 环境返回 null。
 */
function findMonorepoRoot() {
    const anchor = process.argv[1];
    if (!anchor)
        return null;
    const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor);
    let dir = path.dirname(abs);
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/** 多锚点加载宿主运行时依赖（schemastery，不在本包 dependencies 里），同主包口径 */
function loadDep(spec) {
    try {
        return require(spec);
    }
    catch {
        // 落到后续锚点
    }
    const anchor = process.argv[1];
    if (anchor) {
        const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor);
        try {
            return createRequire(abs)(spec);
        }
        catch {
            // 落到 monorepo store
        }
    }
    const root = findMonorepoRoot();
    if (root) {
        const pnpm = path.join(root, 'node_modules', '.pnpm');
        if (fs.existsSync(pnpm)) {
            let entries = [];
            try {
                entries = fs.readdirSync(pnpm);
            }
            catch {
                /* ignore */
            }
            for (const e of entries) {
                if (!(e === spec + '@' || e.startsWith(spec + '@')))
                    continue;
                const pkgJson = path.join(pnpm, e, 'node_modules', spec, 'package.json');
                if (!fs.existsSync(pkgJson))
                    continue;
                try {
                    return createRequire(pkgJson)(spec);
                }
                catch {
                    // 试下一个候选版本
                }
            }
        }
    }
    return null;
}
// ── 组件设置 schema（0.1.7 声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用。
const schemastery = loadDep('@deepseek-ai/schemastery');
const z = (schemastery?.default ?? schemastery ?? null);
export const Config = z && typeof z.object === 'function'
    ? z.object({
        // 用量与余额总开关。默认关——key 不在本组件配置里（复用模型配置
        // llm-pi-ai.providers 的凭证引用），开 = /dsh-kit/usage 端点放行 +
        // client 半边出余额/配额芯片。
        usageEnabled: z.boolean().default(false).volatile(),
        // 会话监视器（纯浏览器端消费，宿主不读）：
        // ① 全局 429 续跑：监视【所有】列表内会话（不要求会话页开着），turn 因 429
        //    限流失败（客户端镜像 lastAgentError 匹配限流措辞）结束后等 monitorWaitMs
        //    自动 prompt"继续"，连续自动续跑不超过 monitorMaxAuto 次（一轮正常收尾
        //    即清零）；
        // ② 死循环打断（仅当前打开的会话）：流式输出尾部自重叠达 monitorRepeatThreshold
        //    次时停止当前回合并发循环打断话术。
        monitorEnabled: z.boolean().default(true).volatile(),
        monitorWaitMs: z.number().step(1).min(5000).max(600000).default(15000).volatile(),
        monitorMaxAuto: z.number().step(1).min(1).max(10).default(5).volatile(),
        monitorRepeatThreshold: z.number().step(1).min(2).max(10).default(3).volatile(),
        // 会话通知（纯浏览器端消费，宿主不读）：回合收尾、上下文压缩完成或 agent 提问时，
        // 若页面不在前台（或事件不属于当前打开的会话）弹桌面通知——浏览器 Notification
        // API，未授权时退标题闪烁。一个总开关管全部提醒，不分类配置。
        notifyEnabled: z.boolean().default(true).volatile(),
    })
    : undefined;
export async function apply(ctx, config = {}) {
    const defaults = Config
        ? Config({})
        : { usageEnabled: false, monitorEnabled: true, monitorWaitMs: 15000, monitorMaxAuto: 5, monitorRepeatThreshold: 3, notifyEnabled: true };
    // volatile 字段在 fiber config 里是稳定 ref（{get}），统一解引用
    const readRef = (v) => v !== null && typeof v === 'object' && typeof v.get === 'function'
        ? v.get()
        : v;
    const readSettings = () => {
        const out = { ...defaults };
        for (const [key, value] of Object.entries(config ?? {}))
            out[key] = readRef(value);
        return out;
    };
    const disposers = [];
    ctx.inject(['webServer', 'credentials'], (webCtx) => {
        // 组件自己的只读配置快照：client 半边拉它做芯片门控（同 root 的 /dsh-kit/config 口径）
        disposers.push(webCtx.webServer.register({
            kind: 'exact',
            path: '/dsh-kit-monitor/config',
            handler: (req, res) => {
                const json = (code, obj) => {
                    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(obj));
                };
                if (req.method !== 'GET') {
                    json(405, { error: 'method not allowed' });
                    return;
                }
                if (typeof req.headers.origin === 'string' && req.headers.origin !== '' && !sameOrigin(req)) {
                    json(403, { error: 'cross-origin denied' });
                    return;
                }
                json(200, readSettings());
            },
        }));
        disposers.push(registerUsageRoutes({
            webServer: webCtx.webServer,
            credentials: webCtx.credentials,
            readSettings: () => readSettings(),
            readProviderConfig: () => {
                // 0.1.7 起 entry 配置由 configEditor 读：inherited = bundle 层合成值，
                // override = profile patch（cordis.patch.yml）层，providers 浅合并后者优先
                try {
                    const editor = ctx.get('configEditor');
                    const row = editor?.configuration?.().find((r) => r.entry?.options?.id === 'llm-pi-ai');
                    if (row) {
                        const providers = {};
                        for (const layer of [row.inherited, row.override]) {
                            if (layer !== null && typeof layer === 'object')
                                Object.assign(providers, layer.providers);
                        }
                        return { providers };
                    }
                }
                catch { /* 服务缺位/读取失败落老路径 */ }
                try {
                    const settings = ctx.get('settings');
                    const value = settings?.get?.('llm-pi-ai');
                    return value !== null && typeof value === 'object' ? value : null;
                }
                catch {
                    return null;
                }
            },
        }));
    });
    // entry 注销时撤路由（disposers 由注入回调在 apply 期间同步填充）
    ctx.effect(() => () => {
        for (const dispose of disposers)
            dispose();
    });
}
