// vault 富文本编辑器往返测试（node，无 DOM）：直接 eval RTE vendor 产物，
// 用 makeTestRig（MarkdownManager + schema）做 md → JSON →（schema 校验）→ md
// 断言与二次稳定性检查。跑法：node tests/test-vault-rte.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const bundlePath = path.join(root, "client", "vendor", "richeditor.bundle.js");

let pass = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

// IIFE 需要 window 落点；模块顶层不碰 DOM（文件头注释的约束）
global.window = {};
new Function(fs.readFileSync(bundlePath, "utf8"))();
const rig = window.DshRTE.makeTestRig();

/** md →（schema 校验）→ md，返回 [输出, 校验错误] */
function rt(md) {
  const json = rig.parse(md);
  let err = null;
  try {
    rig.validate(json);
  } catch (e) {
    err = e.message;
  }
  return [rig.serialize(json), err];
}
/** 稳定性：parse(serialize(parse(md))) 的序列化与首次序列化一致 */
function stable(md) {
  const json = rig.parse(md);
  const once = rig.serialize(json);
  const twice = rig.serialize(rig.parse(once));
  return once === twice;
}
/** 结构等价：两次 parse 的 JSON 相同（输出格式差异如表格补白不算差异） */
const structEq = (a, b) => JSON.stringify(rig.parse(a)) === JSON.stringify(rig.parse(b));

console.log("== 基础块级 ==");
{
  const [out, err] = rt("# 一级\n\n段落文字。\n\n## 二级\n\n正文");
  check("标题/段落", err === null && out === "# 一级\n\n段落文字。\n\n## 二级\n\n正文", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("上\n\n---\n\n下");
  check("分割线", err === null && out === "上\n\n---\n\n下", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("- a\n- b\n\n1. x\n2. y");
  check("无序/有序列表", err === null && out === "- a\n- b\n\n1. x\n2. y", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("- [ ] 待办\n- [x] 完成");
  check("任务列表", err === null && out === "- [ ] 待办\n- [x] 完成", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("> 引用一行\n>\n> 引用二行");
  check("引用块", err === null && out === "> 引用一行\n>\n> 引用二行", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("```js\nconst a = 1;\n```\n\n```\n无语言\n```");
  check("代码块（带语言/无语言）", err === null && out === "```js\nconst a = 1;\n```\n\n```\n无语言\n```", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const src = "| A | B |\n| --- | :---: |\n| 1 | 2 |";
  const [out, err] = rt(src);
  check("表格（含居中对齐，结构等价）", err === null && structEq(out, src), `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("前 ![描述](attachments/截图.png) 后");
  check("行内图片", err === null && out === "前 ![描述](attachments/截图.png) 后", `err=${err} out=${JSON.stringify(out)}`);
}

console.log("== 行内样式 ==");
{
  const [out, err] = rt("**粗** 与 *斜* 与 ~~删~~ 与 `码` 与 [链](https://x.y)");
  check("粗斜删码链", err === null && out === "**粗** 与 *斜* 与 ~~删~~ 与 `码` 与 [链](https://x.y)", `err=${err} out=${JSON.stringify(out)}`);
}
{
  // node 无 DOMParser，行内 HTML token 回退字面文本（浏览器端走 generateJSON
  // 转成 mark，渲染断言在 GUI 实测）；这里只断言往返稳定
  const html = "<u>下划线</u> 和 <sup>上</sup> 与 <sub>下</sub>";
  const [, err] = rt(html);
  check("u/sup/sub（node 降级稳定）", err === null && stable(html), `err=${err}`);
  const [, err2] = rt('<span style="color: #1971c2">蓝字</span>');
  check("文字颜色 span（node 降级稳定）", err2 === null && stable('<span style="color: #1971c2">蓝字</span>'), `err=${err2}`);
  const [, err3] = rt('<mark style="background-color: #fff3bf">高亮</mark>');
  check("高亮 mark 带色（node 降级稳定）", err3 === null && stable('<mark style="background-color: #fff3bf">高亮</mark>'), `err=${err3}`);
}
{
  const [out, err] = rt("==素高亮==");
  check("高亮 == 无色", err === null && out === "==素高亮==", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("行一\n行二");
  check("软换行→硬换行（breaks:true）", err === null && out === "行一  \n行二", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("**粗中*斜*字** 嵌套");
  check("标记嵌套", err === null && /\*\*粗中\*斜\*字\*\*/.test(out), `err=${err} out=${JSON.stringify(out)}`);
}

console.log("== vault 自定义语法 ==");
{
  const [out, err] = rt("见 [[Python 基础]] 与 [[git|版本控制]] 与 [[页#小节]]");
  check("wikilink 三形态", err === null && out === "见 [[Python 基础]] 与 [[git|版本控制]] 与 [[页#小节]]", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("行内 $x^2+1$ 公式");
  check("行内公式", err === null && out === "行内 $x^2+1$ 公式", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("前\n\n$$\na_1 + b^2\n$$\n\n后");
  check("行间公式", err === null && out === "前\n\n$$\na_1 + b^2\n$$\n\n后", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("$5 美元和 $6 元");
  // 文本里的字面 $ 转义成 \$（防二次 parse 误判成公式），是预期行为
  check("价签不算公式", err === null && out === "\\$5 美元和 \\$6 元" && stable(out), `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("围栏里 $x$ 不是公式：\n\n```js\nconst s = `$x$`;\n```\n\n行内码 `$y$` 也一样");
  // 文本段 "$x$" 本身满足公式定界（与旧阅读变换同语义），保持为公式即可；
  // 不变量是：围栏与行内码内的 $ 原样保留、整段往返稳定
  check(
    "围栏/行内码内 $ 原样保留",
    err === null && out.includes("```js\nconst s = `$x$`;") && out.includes("`$y$` 也一样") && stable(out),
    `err=${err} out=${JSON.stringify(out)}`,
  );
}
{
  // 提示框卡片能力已移除：[!类型] 降级为普通引用块，标记行转义保留为文字
  // （"\[" 不再触发 callout tokenizer，二次稳定；内容无损）
  const [out, err] = rt("> [!info] 注意\n> 这里是内容");
  check("callout info 降级普通引用", err === null && out === "> \\[!info\\] 注意\n>\n> 这里是内容" && stable(out), `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("> [!warning]- 默认收起\n> 收起内容");
  check("callout 折叠旗标降级", err === null && out === "> \\[!warning\\]- 默认收起\n>\n> 收起内容" && stable(out), `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("> 普通引用保持");
  check("普通引用不被 callout 吞", err === null && out === "> 普通引用保持", `err=${err} out=${JSON.stringify(out)}`);
}
{
  // [!fold] 解析即迁移到 dshkDetails 双槽（wangshu 同款），存盘落 <details> 格式；
  // 无 `-` 旗标=展开
  const [out, err] = rt("> [!fold] 折叠块\n> - a\n> - b");
  check("fold 迁移双槽", err === null && out === "<details open>\n<summary>\n折叠块\n</summary>\n\n- a\n- b\n</details>", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const [out, err] = rt("> [!fold]- 收起标题\n> 收起正文");
  check("fold 收起旗标迁移", err === null && out === "<details>\n<summary>\n收起标题\n</summary>\n\n收起正文\n</details>", `err=${err} out=${JSON.stringify(out)}`);
}
{
  const src = "<details>\n<summary>\n折叠的 HTML\n</summary>\n\n内容\n</details>";
  const [out, err] = rt(src);
  check("details 富折叠块往返", err === null && out === src && stable(src), `err=${err} out=${JSON.stringify(out)}`);
}
{
  // 标题槽是 block*：多段 + 行内格式照常（存 summary 里）；空行分段
  const src = "<details open>\n<summary>\n**加粗** 与 $x^2$\n\n第二行\n</summary>\n\n正文第一段\n\n- 列表\n</details>";
  const [out, err] = rt(src);
  check("details 标题槽多段+格式", err === null && out === src && stable(src), `err=${err} out=${JSON.stringify(out)}`);
}
{
  // 单换行按全文 breaks 语义是硬换行（"  \n"），与正文一致
  const src = "<details open>\n<summary>\n标题甲  \n标题乙\n</summary>\n\n正文\n</details>";
  const [out, err] = rt(src);
  check("details 标题槽硬换行", err === null && out === src && stable(src), `err=${err} out=${JSON.stringify(out)}`);
}
{
  // 收起态：无 open 属性；正文里的围栏/公式/双链照常
  const src = "<details>\n<summary>\n收起标题\n</summary>\n\n```js\nconst a = 1;\n```\n\n见 [[索引]] 与 $E=mc^2$\n</details>";
  const [out, err] = rt(src);
  check("details 收起态+代码/双链/公式", err === null && out === src && stable(src), `err=${err} out=${JSON.stringify(out)}`);
}
{
  const src = "<details class=\"extra\">\n<summary>纯单行 summary</summary>\n\n正文\n</details>";
  const [out, err] = rt(src);
  // 非规范形态（attrs/单行 summary）照样认领，序列化落规范形态；二次稳定
  check("details 非规范形态规范落盘", err === null && out === "<details>\n<summary>\n纯单行 summary\n</summary>\n\n正文\n</details>" && stable(src), `err=${err} out=${JSON.stringify(out)}`);
}
{
  // 闭合不全/无 summary 的 <details> 不认领，走 RawBlock 原样保留
  const broken = "<details>\n没有闭合标签的残留";
  const [out, err] = rt(broken);
  check("闭合不全的 details 原样保留", err === null && out === broken, `err=${err} out=${JSON.stringify(out)}`);
}

console.log("== 整页样例 + 稳定性 ==");
const SAMPLE = [
  "---",
  "tags: []",
  "created: 2026-09-06",
  "---",
  "",
  "# 测试页",
  "",
  "开头一段 **加粗** 与 [链接](https://example.com)。",
  "",
  "> [!tip] 小贴士",
  "> 记得 [[保存]] 页面，公式 $E=mc^2$ 也能渲染。",
  "",
  "## 表格",
  "",
  "| 工具 | 用途 |",
  "| :--- | --- |",
  "| git | 版本 |",
  "| vault | 知识 |",
  "",
  "- [x] 已完成项",
  "- [ ] 待办项",
  "",
  "```python",
  "print('hi')",
  "```",
].join("\n");
{
  const body = SAMPLE.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
  check("frontmatter 剥离", body.startsWith("# 测试页"), JSON.stringify(body.slice(0, 30)));
  const [out, err] = rt(body);
  check("整页 schema 校验", err === null, `err=${err}`);
  check("整页往返结构等价", structEq(out, body), `out=${JSON.stringify(out)}`);
  check("整页二次稳定", stable(body));
}
{
  const [out] = rt("> [!info] 标题\n>\n> 内\n>\n> $$\n> x^2\n> $$");
  const [back] = rt(out);
  check("callout 套公式二次稳定", back === out, `once=${JSON.stringify(out)} twice=${JSON.stringify(back)}`);
}
{
  const json = rig.parse("- a\n- b");
  const first = json.content?.[0];
  check("parse 产 JSON 结构", first?.type === "bulletList", JSON.stringify(first));
}

console.log(`\n${pass} PASS, ${fails.length} FAIL`);
if (fails.length > 0) {
  console.log(fails.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
