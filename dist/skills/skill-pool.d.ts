import http from 'node:http';
import { type ProjectDirs } from './mount.ts';
/**
 * 物理根定义：group = 所属逻辑分组；rank = DSH 扫描优先级（数值越小越优先，
 * roots() 常量照官方那套；pool 不是扫描根，不参与排序）。
 */
interface PhysicalRoot {
    id: string;
    group: string;
    rank: number | null;
}
export interface SkillEntry {
    name: string;
    description: string;
    /** frontmatter version（自有约定，DSH 不读） */
    version?: string;
    path: string;
    file: string | null;
    kind: 'dir' | 'file';
    disabled: boolean;
    modelInvocable: boolean;
    userInvocable: boolean;
    root?: string;
    rank?: number | null;
    shadowed?: boolean;
    /** 条目本身是链接（池挂载点即指向池的目录链接） */
    link?: boolean;
    /** 链接目标 realpath；失效链接为 null（失效条目本身不进技能列表，见 brokenLinks） */
    linkTarget?: string | null;
    /** 链接目标落在技能池内 */
    linkInPool?: boolean;
    /** 池技能被几个工作区挂载（登记表；只有池组带） */
    mounts?: number;
}
/** 失效链接：链接指向的池技能已不在（改名/删除），宿主发现时会静默跳过 */
export interface BrokenLink {
    root: string;
    name: string;
    path: string;
    target: string | null;
}
interface PhysicalRootWithDir extends PhysicalRoot {
    dir: string;
}
/** 技能池目录（<DSH_HOME>/dsh-kit/skill-pool）：不是 DSH 扫描根，只作跨工作区共用的本体
 *  所在地。池路径真相只此一处（vault 的「知识库目录」等用户配置与它无关）。 */
export declare function defaultPoolDir(): string;
/** 项目级两根的物理位置；没有会话 cwd（或 cwd 非法）时返回 null */
export declare function resolveProjectDirs(cwd: unknown): ProjectDirs | null;
/** 解析全部白名单物理根（带逻辑分组与 rank） */
export declare function resolveRoots(cwd: unknown): PhysicalRootWithDir[];
/**
 * 行级改写 frontmatter 的两个弃用键（不重写其余内容，零 YAML 依赖）：
 * disabled=true → 两键置为 true/false（已有则原位改值，缺失则补在块尾）；
 * disabled=false → 删除这两行。无 frontmatter 且要禁用时新建一个最小块。
 */
export declare function setDisableFlags(text: string, disabled: boolean): string;
interface SkillWebCtx {
    effect(fn: () => void | (() => void), label?: string): void;
    webServer: {
        register(route: {
            kind: string;
            path: string;
            handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
        }): () => void;
    };
}
/** cordis ctx 里本层用到的最小面 */
interface KitCtx {
    inject(deps: string[], cb: (webCtx: SkillWebCtx) => void): void;
}
interface SkillPoolHooks {
    getRegistry?: () => unknown;
}
/**
 * 注册技能池端点。registryApi 由外部注入回调捕获（ctx.skills 服务可能晚于本模块就绪）。
 */
export declare function applySkillPool(ctx: KitCtx, hooks?: SkillPoolHooks): void;
export {};
