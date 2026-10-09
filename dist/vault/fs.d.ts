/** 撞名策略（未知取值按 skip 处理，与前端选项一一对应） */
export type Conflict = 'skip' | 'overwrite' | 'rename';
export declare function parseConflict(raw: unknown): Conflict;
/** 单段叶子名清洗：返 null 表示非法（不静默改名——面板输入框里改错要看得见）。
 *  拒空、首尾空白、分隔符、控制字符、Windows 非法字符、`.`/`..`、保留设备名 */
export declare function safeLeaf(raw: unknown): string | null;
/** 多级名字（新建用）：逐段过 safeLeaf，空段丢弃；全空返 '' */
export declare function safeRel(raw: unknown, maxSegs?: number): string;
/** 去掉 md 扩展名（页面名的规范形态；.markdown 一并按 md 收） */
export declare function stripMd(name: string): string;
/** 撞名顺序名：`名字 (2)` 起、上限 999；全占返 null。页带扩展名时序号插在扩展名前 */
export declare function dedupeName(dir: string, name: string, exists?: (p: string) => boolean): string | null;
/** 绝对路径归一：拒空与任何 `..` 段（只做前缀比较的话 `root\..\x` 能蒙混过关），
 *  再把两端 realpath 后比包含关系——软链与 Windows 8.3 短名会让单头比较落空。
 *  支持「多级下钻」的路径必须从**已存在**的目录里 join（create/move 的落点），
 *  因此父目录 realpath 后拼叶子即可。 */
export declare function resolveInside(root: string, raw: string, opts?: {
    allowRoot?: boolean;
}): string;
/** 路径相对 root 的 `/` 分隔形式（不在 root 内返 null） */
export declare function relUnderRoot(root: string, target: string): string | null;
/** 资料库根（根下 library/）：不存在返 null */
export declare function libraryRoot(root: string): string | null;
/** target 是否落在资料库子树内（含库根自身） */
export declare function inLibrary(root: string, target: string): boolean;
/** 路径是不是资料库根本身（改名/移动/删除都要挡住它） */
export declare function isLibraryRoot(root: string, target: string): boolean;
/** 知识集标记文件名 */
export declare const REFS_FILE = ".refs.json";
export interface KnowledgeSetRefs {
    /** 目录相对 vault 根的 `/` 分隔路径 */
    dir: string;
    /** 挂载的库内 rel 列表 */
    refs: string[];
}
/** 挂载项清洗：统一正斜杠、解 `.`/`..`、去空段、去重保序。**不校验存在**——
 *  库里那一份被删 / 改名后清单可以悬挂（前端显示「不在库里」），这里只保证不越界。 */
export declare function cleanRefs(raw: unknown): string[];
/** 读一个知识集的挂载清单（没标记 / 清单坏了都当空——坏清单不该挡住整个功能） */
export declare function readFolderRefs(dirAbs: string): string[];
/** 一个目录是不是知识集（标记文件存在即算） */
export declare function isKnowledgeSet(dirAbs: string): boolean;
/** 写一个知识集的挂载清单（**全量写回**——挂载 / 移除都由调用方拼好整张清单）。
 *  嵌套冲突时报错；refs 为空也照写（「标记了但还没挂资料」是合法状态），取消标记走
 *  unmarkFolder。**标记**动作要求目录非空（已标记的只更新清单，内容删光也还是知识集）。
 *  tmp + rename 原子落盘。 */
export declare function setFolderRefs(root: string, dirAbs: string, refs: unknown): void;
/** 取消知识集：删标记文件（清单随之消失，资料实物不动） */
export declare function unmarkFolder(root: string, dirAbs: string): void;
/** 全部知识集：从根往下找标记文件（点前缀与约定目录跳过）；坏清单按空清单收 */
export declare function listKnowledgeSets(root: string): KnowledgeSetRefs[];
/** target 在库内的 rel（相对 library/）；不在库里返 null */
export declare function libraryRel(root: string, target: string): string | null;
/** 库内 rel 改名 / 移动后改写全部挂载清单：旧 rel（或旧目录前缀）整段换新名。
 *  改写失败静默——清单留旧名只是显示成「不在库里」，不该让改名这个主动作报错。 */
export declare function rewriteLibraryRefs(root: string, oldRel: string, newRel: string): void;
export interface WikiRef {
    rel: string;
    space: string;
    /** 盘上绝对路径（有才参与改写；纯判定用的引用可以不带） */
    path?: string;
    links?: string[];
}
/** 链接目标 → 页 rel：rel 全等 > rel 尾段 > 文件名（均不分大小写）；同层并列优先同空间 */
export declare function resolveWikiRel(pages: WikiRef[], target: string, hostSpace: string): string | null;
/** rel 的最后 n 段（n 超过段数就整段）——移动改写保持原写法的"段数形状" */
export declare function tailSegments(rel: string, n: number): string;
/** 改写模式：改名 = 整段换新名；移动 = 只动"写成路径"的写法，按原段数取新 rel 尾段 */
export type RewriteMode = {
    kind: 'name';
    name: string;
} | {
    kind: 'move';
    rel: string;
};
/** 逐码点扫正文改写引用（围栏代码块与行内代码里的 `[[]]` 不动）；无改写原样返回。
 *  hostSpace = 这份正文所属页的空间（同名页并列时的解析偏好） */
export declare function rewriteWikiLinks(content: string, pages: WikiRef[], oldRel: string, mode: RewriteMode, hostSpace?: string): string;
/** 新建：kind='dir' 建目录（已存在=幂等成功），否则建空 md 页（已存在回 exists，
 *  不覆盖——名字重了要看得见）。rawName 可带 `/` 多级（中间目录递归建）。 */
export declare function createEntry(root: string, dirAbs: string, rawName: unknown, kind: 'page' | 'dir'): {
    path: string;
    exists?: boolean;
};
/** 重命名（只换名字、留原位置）。页统一收成 .md；资料库文件保留原扩展名
 *  （新名自带扩展名则按新名走）。撞名报错（纯大小写改名不算撞名）。
 *  pages = 改名**前**的页面集合：笔记页改名要改写指向它的双链。 */
export declare function renameEntry(root: string, targetAbs: string, rawName: unknown, pages?: WikiRef[]): {
    path: string;
    links: number;
};
/** 移动（destAbs = 目标目录，必须已存在且落在库内；目录不能进自己的子树）。
 *  已在该目录 = skipped 空操作；页移动按移动**前**的集合改写路径形态的引用。 */
export declare function moveEntry(root: string, targetAbs: string, destAbs: string, conflict: Conflict, pages?: WikiRef[]): Promise<{
    path: string;
    rel: string;
    name: string;
    links: number;
    skipped: boolean;
}>;
/** 正文写回：mtime CAS + tmp/rename 原子落盘。
 *  盘上不是前端读过的那一版（baseMtime 不符）就回 `modified` 让前端出冲突条，
 *  **不静默覆盖**——库是共享的（agent / 外部编辑器随时在改），覆盖掉的那份没人
 *  找得回来（插件不碰 git，没有存档兜底）。文件已不在（改名 / 删除后编辑器的
 *  卸载兜底保存）回 `missing`，那次写直接丢弃，否则会把旧路径的页写活回来。 */
export declare function writePage(root: string, targetAbs: string, content: unknown, baseMtime: unknown): {
    mtimeMs: number;
    modified?: true;
    missing?: true;
};
/** 编辑面粘贴 / 拖入的图片：内容寻址落 attachments/<前两位>/<前 16 位>.<ext>
 *  （与导入 md 时收本地图片同一条落盘规则，同内容复用不重写）。扩展名按来源名取，
 *  不合白名单的一律按 png 落（剪贴板图绝大多数就是 png） */
export declare function storeAttachment(root: string, bytes: Buffer, fileName: unknown): {
    rel: string;
    reused: boolean;
};
/** 收页面引用的本地图片进 attachments/ 并改写引用；返回 [新正文, 新落盘张数] */
export declare function pullImages(text: string, srcDir: string, root: string): [string, number];
export interface ImportOptions {
    /** 目标目录（绝对路径，必须已存在且在库内） */
    destAbs: string;
    /** 落地名：页 = 主名（自动补 .md）；资料 = 文件名（缺扩展名时取来源的扩展名） */
    name: unknown;
    /** 浏览器上传的字节（与 srcPath 二选一） */
    data?: Buffer;
    /** 上传时的原始文件名（决定扩展名与默认名） */
    fileName?: string;
    /** 本机绝对路径直拷（库内文件不给导） */
    srcPath?: string;
    conflict: Conflict;
}
/** 导入一个文件到库内目录。资料（资料库那一支、或上传的任意文件）按字节原样落盘，
 *  一律自动加序号不覆盖；笔记页收正文并把页内引用的本地图片收进 attachments/。 */
export declare function importEntry(root: string, opts: ImportOptions): Promise<{
    path: string;
    rel: string;
    name: string;
    images: number;
    skipped: boolean;
    renamed: boolean;
}>;
/** 删除（整单批量）：Windows 走回收站，非 Windows 直删；返回成功数与失败项名字 */
export declare function deleteEntries(root: string, paths: unknown[]): Promise<{
    deleted: number;
    failed?: string[];
}>;
