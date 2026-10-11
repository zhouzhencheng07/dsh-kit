export declare const QUIZ_DIR = ".quiz";
/** 连续答对多少次算掌握（界面可改，落 .quiz-state/settings.json） */
export declare const DEFAULT_THRESHOLD = 3;
/** 一道题。**不存 id**：id 是内容哈希，读的时候现算（改题自然变成新题、进度归零，
 *  不会留下与被改内容对不上的旧 id） */
export interface QuizQuestion {
    /** single / multi / judge / blank */
    type: string;
    stem: string;
    options: string[];
    /** single/multi：字母串 "ACD"（存储顺序）；judge：true/false；blank：[["答案","别名"], …] */
    answer: QuizAnswer;
    explain: string;
}
export type QuizAnswer = string | boolean | string[][] | null;
/** 回前端的题目：存储字段 + 现算的 id（options/explain 为空时不带字段，与桌面端同形） */
export interface QuizQuestionDto extends Omit<QuizQuestion, 'options' | 'explain'> {
    id: string;
    options?: string[];
    explain?: string;
}
export interface QuizPageDto {
    rel: string;
    questions: QuizQuestionDto[];
}
/** 一个范围（目录，递归）下所有有题的页面 */
export interface QuizScopeDto {
    dir: string;
    pages: QuizPageDto[];
}
export interface QuizRecord {
    /** 连续答对次数（答错归零） */
    streak: number;
    mastered: boolean;
    updatedMs: number;
}
export interface QuizSettings {
    version: number;
    threshold: number;
    /** 写这份设置的时刻：另一端改了阈值这边要能看出先后 */
    updatedMs: number;
}
/** 回前端的掌握度：范围内（一页 / 一个目录 / 全库）的记录 + 全局阈值 */
export interface QuizProgressDto {
    version: number;
    threshold: number;
    progress: Record<string, QuizRecord>;
}
/** 一次作答的结果（前端据此显示连击与「新掌握」） */
export interface QuizOutcome {
    streak: number;
    mastered: boolean;
    newlyMastered: boolean;
}
/** 题目与掌握度的指纹：范围内的文件数 + 最新 mtime */
export interface QuizRevision {
    files: number;
    mtimeMs: number;
}
/** 保存时对**界面正在编辑的那一道题**的掌握记录怎么办：index 指向 questions 里的位置，
 *  oldId 是它原本的 id，keep = 保存后是否接续原来的掌握进度。其余题目一律不动 */
export interface QuizSaveEdit {
    index: number;
    oldId: string;
    keep: boolean;
}
/** 客户端来的页面 rel（也收目录 rel）：非法抛错，合法返回规范形（`/` 分隔） */
export declare function safeQuizRel(raw: unknown): string;
/** 页面 rel → 题目文件绝对路径 */
export declare function quizPath(root: string, rel: string): string;
/** 页面 rel → 掌握度文件绝对路径 */
export declare function progressPath(root: string, rel: string): string;
/** 页面文件绝对路径 → 同目录的题目文件（改名 / 移动 / 删除都从页面文件推） */
export declare function siblingOf(pageFile: string): string | null;
/** 页面改名 / 移动后把题目与掌握度文件也搬过去（没有就什么都不做）。
 *  目录的改名 / 移动不用调它——.quiz/ 在目录体内，跟着目录一起走。 */
export declare function followPage(oldPage: string, newPage: string): void;
/** 页面被删除时，它的题目与掌握度文件也要一起进回收站（存在几个回几个） */
export declare function siblingsForDelete(pageFile: string): string[];
/** 题目 id：内容哈希，前 16 位小写十六进制（与附件命名同口径） */
export declare function questionId(q: QuizQuestion): string;
/** 非法回错误串（指出第几题由调用方拼）——作者写的东西不能被静默丢掉 */
export declare function validate(q: QuizQuestion): string | null;
/** 解析题目文件：返回（题目，是否有标记外的内容被忽略） */
export declare function parseMd(text: string): [QuizQuestion[], boolean];
/** 序列化：一题一段（形状与 parseMd 严格互逆，测试钉住） */
export declare function toMd(questions: QuizQuestion[]): string;
/** 读一页的题目（文件不在 / 坏了 = 0 题） */
export declare function readPage(root: string, rel: string): QuizPageDto;
/** 写一页的题目（空数组 = 删掉题目文件与掌握度，不留空壳）。
 *  edit 指出界面正在编辑的那道题与「是否保留掌握进度」——勾了把旧 id 的记录搬到新 id，
 *  没勾就把这道题的记录清零；不给就完全不动掌握记录。返回落盘后的形状（含现算的 id） */
export declare function savePage(root: string, rel: string, raw: unknown, edit: unknown): QuizPageDto;
export declare function readScope(root: string, dir: string): QuizScopeDto;
/** 指纹：范围内的文件数 + 最新 mtime。**外部（agent 直接写 .quiz/*.md、同步下来的
 *  进度）改了才会变**——界面轮询它决定要不要重读，比每几秒把范围重读一遍便宜得多。
 *  全局阈值文件也算在内——另一端改了阈值，这边要跟着重读。 */
export declare function revision(root: string, rel: string | null, dir: string | null): QuizRevision;
/** 读全局答题设置（文件不在 / 坏了回默认；阈值非法兜回默认） */
export declare function readSettings(root: string): QuizSettings;
/** 回前端的掌握度：rel 给一页，否则 dir（"" = 整库）递归汇总 + 全局阈值 */
export declare function readProgress(root: string, rel: string | null, dir: string | null): QuizProgressDto;
/** 记一次作答：答对连击 +1（达阈值即掌握），答错连击归零并撤销掌握 */
export declare function record(root: string, rel: string, id: string, correct: boolean): QuizOutcome;
/** 手动标记掌握：连击直接设成阈值（一步跳满） */
export declare function markMastered(root: string, rel: string, id: string): QuizOutcome;
/** 遗忘（答对后自觉没底也可用）：连击归零并撤销掌握 */
export declare function forget(root: string, rel: string, id: string): QuizOutcome;
/** 改阈值（1..20）：已经掌握但连击数低于新阈值的题刷回未掌握 */
export declare function setThreshold(root: string, value: number): number;
/** 组件装配时注入 logger（core/log 的 kitLogger）——本模块保持零宿主依赖可单测 */
export declare function setQuizWarn(fn: (msg: string) => void): void;
