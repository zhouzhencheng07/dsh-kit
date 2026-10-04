/** 判定为复读所需的最少连续重复遍数（低档=警告，只提示不停） */
export declare const WARN_COPIES = 3;
/** 停止档：重复继续到这么多遍才停止回合（先警告、继续才停的分档策略） */
export declare const STOP_COPIES = 5;
/** 重复块（一句或连续几句）的最小字符数：放过「好。」这类短噪声 */
export declare const MIN_BLOCK_CHARS = 6;
/** 重复块最多由几句组成：循环单元通常是「一句话或几句话」 */
export declare const MAX_BLOCK_UNITS = 8;
/** 一句话：归一化文本 + 是否已收束（流式尾部未完成的句子不参与判定） */
export interface SentenceUnit {
    /** 归一化后的句子文本（压缩空白后 trim） */
    text: string;
    /** 是否以句末标点/换行收尾 */
    complete: boolean;
}
/** 一次复读命中：尾部由 units 句组成的块连续重复了 copies 遍 */
export interface LoopHit {
    /** 重复块由几句组成 */
    units: number;
    /** 连续重复了几遍 */
    copies: number;
    /** 重复块（一遍）的字符数 */
    chars: number;
}
/**
 * 把文本切成句子。断句点：句末标点（。！？；…!?;）、换行、以及不夹在数字中间的
 * 英文句点（跟随空白或行尾）。尾部没有断句点的内容标记为未完成。
 */
export declare function segmentSentences(text: string): SentenceUnit[];
/**
 * 尾部连续重复块扫描：从尾部往回看，找最小的块（1..MAX_BLOCK_UNITS 句），要求它
 * 连续完整地重复至少 WARN_COPIES 遍（块字符数不足 MIN_BLOCK_CHARS 的短句跳过）。
 * 只认尾部——重复之后已经说了别的，就是自愈了，不该再动它。
 */
export declare function tailLoop(units: readonly SentenceUnit[]): LoopHit | null;
/** 判据总入口：切句 + 尾部连续重复扫描。命中返回重复块信息，否则 null。 */
export declare function detectLoop(text: string): LoopHit | null;
