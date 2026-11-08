import { type QuizOutcome, type QuizPageDto, type QuizRecord } from './quiz.ts';
/** 题集里一道题的键：页面 rel + 题目 id */
export declare function keyOf(rel: string, qid: string): string;
export interface QuizSetFile {
    version: number;
    id: string;
    name: string;
    /** 集里的页面 rel（题跟着页面走） */
    pages: string[];
    /** 键 = "rel|题目 id" */
    progress: Record<string, QuizRecord>;
    updatedMs: number;
}
export interface QuizSetSummary {
    id: string;
    name: string;
    pages: string[];
    /** 答得了的题数（选择要有选项与答案、填空要有空） */
    total: number;
    mastered: number;
    /** 进度里有、但题已经不在（页删了 / 题改了）的条数 */
    invalid: number;
    updatedMs: number;
}
export interface QuizSetScope {
    set: QuizSetSummary;
    pages: QuizPageDto[];
    progress: Record<string, QuizRecord>;
    threshold: number;
}
/** 有题的页面（新建题集时勾选用）：rel + 答得了的题数 */
export interface QuizPageCount {
    rel: string;
    count: number;
}
/** 全部题集（按最近改动倒序）：坏文件跳过，不挡住整张列表 */
export declare function listSets(root: string): QuizSetSummary[];
/** 开一个题集：集里的页 + 题目 + 这套进度 + 阈值 */
export declare function readSetScope(root: string, id: string): QuizSetScope;
/** 新建（id 为空）或改名 / 换页（id 给了）。换页时把不在集里的页的进度清掉。 */
export declare function saveSet(root: string, id: string | null, name: unknown, pages: unknown): QuizSetSummary;
export declare function deleteSet(root: string, id: string): void;
/** 清空掌握度（题集本身保留） */
export declare function clearSet(root: string, id: string): QuizSetSummary;
/** 记一次作答（题集里没有「一天一次」的限制：短期刷题就是要连着刷） */
export declare function recordSetAnswer(root: string, id: string, rel: unknown, qid: unknown, correct: boolean): QuizOutcome;
/** 有题的页面（新建题集时勾选用）：复用整库范围扫描，只回 rel + 答得了的题数 */
export declare function pagesWithQuestions(root: string): QuizPageCount[];
