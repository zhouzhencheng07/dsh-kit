/** 取文本扩展名：`a.ini` → ini；点文件 `.gitignore` → gitignore；无点 → 全名小写 */
export declare function textExtOf(name: unknown): string;
/**
 * 把文件字节解码为可预览文本。
 * 返回 { binary, content }：binary=true 时 content=null。
 * 规则：⓪强制二进制扩展名直接判定；①UTF-8/UTF-16 系 BOM 命中 → 按对应编码解码（含 BOM 剥离）；
 * ②无 BOM 且首 4KB 无 NUL → UTF-8；③无 BOM 含 NUL 但扩展名属文本类 →
 *   LE/BE 双向评分取更像文本的一份（无控制字符、ASCII 可打印占比 ≥0.5）才认定文本；
 * ④其余 → 二进制。
 */
export declare function decodePreviewText(buf: unknown, name: unknown): {
    binary: boolean;
    content: string | null;
};
