// dsh-kit 组件间共享的宿主侧工具库。纯库（不是 entry，不进 profile bundles）：
// 各组件包经 dependencies 引用，运行时随组件在 profile node_modules 解析。
// 只放「两个以上组件要用」的纯函数；单组件私有的留在组件包里。
export * from './tools.ts'
export * from './web-guard.ts'
export * from './project-root.ts'
export * from './recycle.ts'
export * from './text-decode.ts'
export * from './opencode-session.ts'
