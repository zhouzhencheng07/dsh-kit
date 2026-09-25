// dsh-kit 组件间共享的宿主侧工具库。纯库（不是 entry，不进 profile bundles）：
// 各组件半边按相对路径 import（同包内）。只放「两个以上组件要用」的纯函数；
// 单组件私有的留在各自组件目录里。
export * from "./tools.js";
export * from "./web-guard.js";
export * from "./project-root.js";
export * from "./recycle.js";
export * from "./text-decode.js";
export * from "./opencode-session.js";
