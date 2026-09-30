// dsh-kit 网页搜索组件（宿主半边入口）
//
// 免费引擎链替换 base 层钉的付费 deepseek-official：seam 接管与 provider 注册见
// ./web-search.ts，引擎实现在 ./engines/。组件行关闭 = 本模块不物化 = 不接管 seam，
// base 钉的官方搜索原样生效——行开关就是这块能力的总开关，切行即时生效。
// 唯一配置项 searchMaxResults 是本组件自己的 Config，编辑面在插件页本组件行的
// 「配置」（client 半边同 bundle 内的 search 组件模块注册）。
import { applyWebSearch } from "./web-search.js";
import { loadDep } from "../core/index.js";
export const name = 'dsh-kit/search';
// ── 组件设置 schema（声明式模型）──
// **字段必须 .volatile()**（SettingsForms 只投影 volatile 字段进表单）；volatile
// 写入 = 热提交（fiber config 里的稳定 ref），readSettings 统一解引用后每次现读。
const schemastery = loadDep('@deepseek-ai/schemastery');
const z = (schemastery?.default ?? schemastery ?? null);
export const Config = z && typeof z.object === 'function'
    ? z.object({
        // 单次搜索返回的来源条数上限（1-8，默认 2）。provider 每次现读、改完即生效；
        // 条数越多上下文消耗越大。
        searchMaxResults: z.number().step(1).min(1).max(8).default(2).volatile(),
    })
    : undefined;
export async function apply(ctx, config = {}) {
    const defaults = Config ? Config({}) : { searchMaxResults: 2 };
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
    applyWebSearch(ctx, {
        getMaxResults: () => readSettings().searchMaxResults,
        log: (message) => console.warn(`dsh-kit: ${message}`),
    });
}
