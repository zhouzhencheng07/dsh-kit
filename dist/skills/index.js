// dsh-kit 技能组件（宿主半边入口）
//
// 组件化切片：技能管理页的 client 半边在根包 client/bundle.js 的 skillsModule。
// 宿主半边 = 技能池数据端点（实现见 ./skill-pool.ts）+ 行可达性探针（行开关 =
// 唯一开关，GET /dsh-kit-skills/config 恒回空对象）——
// client 拉 200 = 行启用、404（行禁用 → 本子模块不物化）= 不注册设置页。
import http from 'node:http';
import { sameOrigin } from "../core/index.js";
import { ensurePoolBaselines } from "./pool-git.js";
import { applySkillPool, defaultPoolDir } from "./skill-pool.js";
export const name = 'dsh-kit/skills';
export function apply(ctx) {
    // skills 注册表是可选增强（归属展示），服务晚于本行就绪也无碍——注入回调捕获引用
    let skillsRegistry = null;
    ctx.inject(['skills'], (skillsCtx) => {
        skillsRegistry = skillsCtx.skills;
    });
    applySkillPool(ctx, { getRegistry: () => skillsRegistry });
    // 池技能的版本记录：只备仓库与基线首版（**不做自动提交**，提交由人或 agent 有意识
    // 地做）。这里先把启动时已有的池技能补齐；之后手工放进池的技能，由面板拉列表时补。
    void ensurePoolBaselines(defaultPoolDir());
    const disposers = [];
    ctx.inject(['webServer'], (webCtx) => {
        // ── 行启用探针：GET /dsh-kit-skills/config，恒回空对象 ──
        // 行禁用 → 本子模块不物化 → 端点 404，client 据此不注册技能设置页
        disposers.push(webCtx.webServer.register({
            kind: 'exact',
            path: '/dsh-kit-skills/config',
            handler: (req, res) => {
                const json = (code, obj) => {
                    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(obj));
                };
                if (req.method !== 'GET') {
                    json(405, { error: 'method not allowed' });
                    return;
                }
                if (!sameOrigin(req)) {
                    json(403, { error: 'cross-origin denied' });
                    return;
                }
                json(200, {});
            },
        }));
    });
    // entry 注销时撤路由（disposers 由注入回调在 apply 期间同步填充）
    ctx.effect(() => () => {
        for (const dispose of disposers)
            dispose();
    });
}
