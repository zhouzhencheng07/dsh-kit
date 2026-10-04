export type ValidateOk<T> = {
    ok: true;
} & T;
export type ValidateFail = {
    ok: false;
    message: string;
};
/** 校验浏览器传来的 cwd：绝对路径 + 存在 + 是目录，返回规范化的真实路径 */
export declare function validateCwd(raw: unknown): ValidateOk<{
    path: string;
}> | ValidateFail;
/** 校验浏览器传来的文件路径：绝对路径 + 存在 + 是文件，返回真实路径、大小与修改时间 */
export declare function validateFile(raw: unknown): ValidateOk<{
    path: string;
    size: number;
    mtimeMs: number;
}> | ValidateFail;
/** 仅校验路径形态（非空、规范化为绝对路径），不做存在性检查——供目标是 git 对象
 *  而非工作区文件的端点用（典型：已删除文件的 diff）；越界由调用方按 git root
 *  二次把关 */
export declare function validatePathShape(raw: unknown): ValidateOk<{
    path: string;
}> | ValidateFail;
/** 校验浏览器传来的路径：绝对路径 + 存在（文件或目录均可），返回真实路径 */
export declare function validateAny(raw: unknown): ValidateOk<{
    path: string;
}> | ValidateFail;
/** target 是否位于 dir 子树内（dir 本身不算在内——根目录不可改删） */
export declare function withinTree(dirReal: string, targetReal: string): boolean;
/** 新建/重命名的名称合法性：禁空、首尾空白、路径分隔符、控制字符、Windows 特殊字符与相对段 */
export declare function invalidFsName(raw: unknown): boolean;
