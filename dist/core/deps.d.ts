/** 定位运行中 DSH 的 monorepo 根（含 pnpm-workspace.yaml 的目录）；非 DSH 环境返回 null */
export declare function findMonorepoRoot(): string | null;
/** 多锚点加载宿主运行时依赖；不可达返回 null */
export declare function loadDep(spec: string): any;
