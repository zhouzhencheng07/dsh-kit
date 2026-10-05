// dsh-kit — 包根入口（没有 patch 行挂它）。
//
// 套件的宿主能力全部在组件行（cordis.patch.yml 的十行，各自独立开关），本文件不物化任何
// 端点：vendor 静态资源分给用它的组件行（见 src/core/vendor-route.ts），浏览器半边的日志
// 回传与 kit.log 写盘归 dsh-kit/logs 行。
//
// 它存在的原因只有一个：包根要有可解析的入口（package.json 的 main / exports["."]），
// 宿主据此解析这个包、决定它的客户端半边要不要挂上 client/bundle.js。删掉它 = 浏览器半边
// 整包不加载，而现象是「插件页十行都在、页面能力一个不出」——很难一眼看出是包根没了。

export const name = 'dsh-kit'

export function apply(): void {
  // 无事可做：组件行的开关与接线都在各自的模块里
}
