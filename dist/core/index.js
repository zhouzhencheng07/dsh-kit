// dsh-kit 组件间共享的宿主侧工具库。纯库（不是 entry，不进 profile bundles）：
// 各组件包经 dependencies 引用，运行时随组件在 profile node_modules 解析。
// 只放「两个以上组件要用」的纯函数；单组件私有的留在组件包里。
export * from "./tools.js";
export * from "./web-guard.js";
export * from "./project-root.js";
export * from "./recycle.js";
export * from "./text-decode.js";
export * from "./opencode-session.js";
