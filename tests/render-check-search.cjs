// dsh-kit/search 检查：网页搜索只有宿主半边（web seam 接管 + 引擎链），没有浏览器半边
// 与配置页；返回条数由宿主 web_search 的 searchMaxResults 决定，插件不设上限。
// 用法（dsh-kit 根）：node tests\render-check-search.cjs
const fs = require("node:fs");

let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");

const bundle = read("client/bundle.js");
const comp = read("src/search/index.ts");
const seam = read("src/search/web-search.ts");
const patch = read("cordis.patch.yml");
const pkg = JSON.parse(read("package.json"));

// 1) 浏览器半边：整个组件模块已摘掉，激活清单里也没有它
check(
  "client 没有 search 组件半边（无模块 / 无配置页 / 不在激活清单）",
  !bundle.includes("searchModule") && !bundle.includes("dsh-kit#search") &&
    !bundle.includes("kcfgSearchMaxResults") && !bundle.includes("SearchConfigPage"),
);

// 2) 宿主入口：没有插件侧配置（Config / volatile 字段全无），只装配 seam 接管
check(
  "宿主入口没有插件侧条数配置，只装配 seam 接管",
  !comp.includes("export const Config") && !comp.includes("volatile()") && !comp.includes("z.object") &&
    comp.includes("applyWebSearch") && comp.includes("name = 'dsh-kit/search'"),
);

// 3) provider：条数只认 seam 请求（宿主 web_search 的 searchMaxResults）
check(
  "provider 只按 seam 请求的 maxResults 给条数（没有插件侧上限）",
  seam.includes("request.maxResults") && !seam.includes("getMaxResults") && !seam.includes("resultCapOf") &&
    !seam.includes("SEARCH_MAX_RESULTS"),
);

// 4) 接管与降级：配置引用不可写 / 别家钉住就不注册；宿主换默认 id 仍按家族接管
check(
  "seam 接管带降级（引用缺失或不可写、别家钉住 → 不钉不注册）",
  seam.includes("config?.searchProvider") && !seam.includes("searchProviderId") &&
    seam.includes("function pinProvider") && seam.includes("WEB_PROVIDER_CONFIGURED_MISSING"),
);
check(
  "按宿主 provider 家族识别默认选择（base 改默认 id 仍能接管）",
  seam.includes("isHostSearchProvider") && seam.includes("startsWith('deepseek-')"),
);

// 5) 行树与包：不在 patch 里静态钉 provider，行 / 子路径 / locale 齐备
check("patch 不静态钉 web 行的 searchProvider（关行 = 不接管 seam）", !/^\s*searchProvider:/m.test(patch) && !/^\s*- id: web\s*$/m.test(patch));
check("组件行声明 + exports 子路径 + locale 齐备", patch.includes("name: dsh-kit/search") && !!pkg.exports["./search"] && !!pkg.exports["./search/locale/*.json"]);

console.log(failed === 0 ? "ALL RENDER OK (search)" : `FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
