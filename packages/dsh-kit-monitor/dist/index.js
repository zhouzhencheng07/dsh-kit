// dsh-kit 用量与监视组件（宿主半边入口）
//
// 首个组件化的切片：/dsh-kit/usage 聚合端点 + usageEnabled 总开关从 dsh-kit 主包
// 迁出，独立成 entry（bundle patch 插单，profile 里 id: dsh-kit-monitor）。
// provider 配置读取不依赖主包：经宿主 configEditor 服务现读 llm-pi-ai entry 的
// 合成配置（inherited+override 两层 providers 浅合并），凭证经宿主 credentials
// 按引用解析，key 不出宿主进程。
//
// 客户端芯片（UsageLine）仍在主包 client 半边，按 URL 消费本组件端点；组件
// 开关关闭 = 端点 403 usage-disabled，芯片自然隐藏。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { registerUsageRoutes } from "./usage.js";
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
        // 主包 client 半边出余额/配额芯片。
        usageEnabled: z.boolean().default(false).volatile(),
    })
    : undefined;
export async function apply(ctx, config = {}) {
    const defaults = Config ? Config({}) : { usageEnabled: false };
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
