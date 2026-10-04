/** 解析 SKILL.md 等文本开头的 frontmatter，返回键值表（键小写）；无 frontmatter 返回空表 */
export declare function parseFrontmatter(text: string): Record<string, string>;
