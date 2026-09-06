// TipTap 富文本编辑器 vendor 入口（scripts/build-rte-vendor.mjs 拷进临时目录后
// esbuild 打包成 IIFE，暴露 window.DshRTE 工厂）。vault 页面编辑器的引擎半边：
// md ↔ 富文本往返、schema、节点视图、命令句柄。UI 半边（菜单/保存循环/页面条）
// 在 client/bundle.js，两边只经 create(host, opts) 句柄接口相连。
//
// 往返选型：@tiptap/markdown（官方，内建 marked lexer + 各扩展 parseMarkdown/
// renderMarkdown 规格）。标准 md（标题/列表/表格/代码块/引用/行内样式）全部用
// 官方规格；本文件只补 vault 约定的自定义语法（wikilink / 数学 / 折叠块，> [!] 仅剩旧语法迁移）
// 的 tokenizer + 双向规格，以及旧约定行内 HTML（<u>/<sup>/<sub>/<mark>/
// <span style>) 的序列化覆写。未知块级 HTML 整块原样保留（rawBlock），绝不丢弃。
//
// DOM 约束：本文件不得在模块顶层触碰 document/window（node 测试直接 eval 产物
// 做 md⇄doc 往返断言）；运行时库（window.katex）只在节点视图内部懒检查。
import { Editor, Node, mergeAttributes, getSchema } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { UndoRedo, Placeholder } from "@tiptap/extensions";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Code from "@tiptap/extension-code";
import Underline from "@tiptap/extension-underline";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Blockquote from "@tiptap/extension-blockquote";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Image from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Gapcursor from "@tiptap/extension-gapcursor";
import Dropcursor from "@tiptap/extension-dropcursor";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

// ─── vault md 约定的共享小工具 ─────────────────────────────────────────────
/** 拆 [[目标#锚|别名]]：返回 {target, anchor, alias}；无别名 alias=null */
function parseWikiInner(inner) {
  const text = String(inner ?? "");
  const bar = text.indexOf("|");
  const head = bar >= 0 ? text.slice(0, bar) : text;
  const alias = bar >= 0 ? text.slice(bar + 1).trim() : "";
  const hashAt = head.indexOf("#");
  const target = (hashAt >= 0 ? head.slice(0, hashAt) : head).trim();
  const anchor = hashAt >= 0 ? head.slice(hashAt + 1).trim() : "";
  return { target, anchor, alias: alias === "" ? null : alias };
}

/** 行内数学/围栏共享的 $ 定界识别（与旧 vaultTransformMath 同语义）：
 *  开 $ 后非空白、闭 $ 前非空白、闭 $ 后非 $ 非词字符（排 "$5 和 $6" 误配） */
const INLINE_MATH_RE = /^\$(?!\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\$|\w)/;

// ─── WikiLink（[[页面#锚|别名]] 行内原子） ─────────────────────────────────
// 视图回调（跳页/碎链建页/解析态着色）由工厂经 ctx 注入；broken 判定是纯视觉，
// 索引更新后走 handle.wikiRefresh() 重刷。
const wikiViews = new Set(); // {editor, refresh} — destroy 时按 editor 剔除

const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { ctx: null };
  },
  addAttributes() {
    return {
      target: { default: "" },
      anchor: { default: null },
      alias: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-vault]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        {
          "data-vault": node.attrs.target ?? "",
          "data-anchor": node.attrs.anchor ?? "",
          "data-alias": node.attrs.alias ?? "",
        },
        HTMLAttributes,
      ),
    ];
  },
  // marked 自定义 inline tokenizer：[[..]] 优先于一切内建规则；围栏/行内码已
  // 被内建规则整块消费，token 到不了这里——旧变换需要的“围栏内不算”天然成立
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start(src) {
      const index = src.indexOf("[[");
      return index >= 0 ? index : -1;
    },
    tokenize(src) {
      const m = /^\[\[([^\[\]]+)\]\]/.exec(src);
      if (!m) return undefined;
      const { target, anchor, alias } = parseWikiInner(m[1]);
      if (target === "" && anchor === "") return undefined;
      return { type: "wikiLink", raw: m[0], target, anchor, alias };
    },
  },
  parseMarkdown(token) {
    return {
      type: "wikiLink",
      attrs: { target: token.target ?? "", anchor: token.anchor || null, alias: token.alias || null },
    };
  },
  renderMarkdown(node) {
    const target = node.attrs?.target || "";
    const anchor = node.attrs?.anchor || "";
    const alias = node.attrs?.alias || "";
    let inner = target;
    if (anchor) inner += `#${anchor}`;
    if (alias && alias !== anchor && alias !== target) inner += `|${alias}`;
    return `[[${inner}]]`;
  },
  addCommands() {
    return {
      insertWikiLink:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { target: "", anchor: null, alias: null, ...attrs } }).run(),
    };
  },
  addNodeView() {
    const ctx = this.options.ctx ?? {};
    return (props) => {
      const span = document.createElement("span");
      span.className = "dshk-vault-wl";
      span.contentEditable = "false";
      const refresh = () => {
        const { target, anchor, alias } = props.node.attrs;
        const label = alias || anchor || target || "[[?]]";
        span.textContent = label;
        span.title = `[[${target}${anchor ? `#${anchor}` : ""}${alias ? `|${alias}` : ""}]]`;
      const resolved = target === "" || (ctx.resolveWiki ? ctx.resolveWiki(target) : true);
      span.classList.toggle("dshk-vault-wl-broken", !resolved);
      };
      refresh();
      span.addEventListener("click", (e) => {
        e.preventDefault();
        const { target, anchor } = props.node.attrs;
        if (ctx.onWikiLink) ctx.onWikiLink(String(target ?? ""), String(anchor ?? ""));
      });
      const entry = { editor: props.editor, refresh };
      wikiViews.add(entry);
      return {
        dom: span,
        update(node) {
          if (node.type.name !== "wikiLink") return false;
          props.node = node;
          refresh();
          return true;
        },
        destroy() {
          wikiViews.delete(entry);
        },
      };
    };
  },
});

// ─── 数学（行内 $..$ / 行间 $$..$$，KaTeX 渲染、点击改 tex） ────────────────
function mathNodeView(props, display) {
  const wrap = document.createElement(display ? "div" : "span");
  wrap.className = display ? "dshk-rte-mathblock" : "dshk-rte-math";
  wrap.contentEditable = "false";
  const render = (tex) => {
    wrap.classList.remove("is-editing", "is-empty");
    wrap.textContent = "";
    if (window.katex) {
      try {
        wrap.innerHTML = window.katex.renderToString(tex, {
          throwOnError: false,
          displayMode: display,
        });
        return;
      } catch {
        /* 渲染失败回退原文 */
      }
    }
    wrap.textContent = tex;
  };
  const openEditor = () => {
    if (wrap.classList.contains("is-editing")) return;
    wrap.classList.add("is-editing");
    wrap.textContent = "";
    const input = document.createElement("input");
    input.className = "dshk-rte-math-input";
    input.type = "text";
    input.value = props.node.attrs.tex ?? "";
    input.placeholder = display ? "\\frac{a}{b}" : "E=mc^2";
    const commit = () => {
      if (!wrap.contains(input)) return;
      const tex = input.value;
      // 先摘输入框退编辑态、本地先渲一次再提交：同值提交不会产生 doc 变化、
      // update() 不来，不本地渲的话节点视图会停留在摘掉输入框的空白态
      wrap.classList.remove("is-editing");
      input.remove();
      render(tex);
      props.editor.view.dispatch(
        props.editor.view.state.tr.setNodeMarkup(props.getPos(), undefined, { tex }),
      );
      props.editor.view.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.stopPropagation();
        render(props.node.attrs.tex ?? "");
        props.editor.view.focus();
      }
    });
    input.addEventListener("blur", commit);
    wrap.appendChild(input);
    input.focus();
    input.select();
  };
  render(props.node.attrs.tex ?? "");
  if ((props.node.attrs.tex ?? "") === "") {
    // 斜杠菜单插入的空公式：直接进编辑态（tex 空 KaTeX 无从渲染）
    queueMicrotask(() => openEditor());
  }
  wrap.addEventListener("click", openEditor);
  return {
    dom: wrap,
    ignoreMutation: () => true,
    update(node) {
      if (node.type.name !== (display ? "mathBlock" : "mathInline")) return false;
      props.node = node;
      if (!wrap.classList.contains("is-editing")) render(node.attrs.tex ?? "");
      return true;
    },
    stopEvent() {
      return true;
    },
  };
}

const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { tex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span.dshk-math[data-tex]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "dshk-math", "data-tex": node.attrs.tex ?? "" }, HTMLAttributes)];
  },
  markdownTokenizer: {
    name: "mathInline",
    level: "inline",
    start(src) {
      const index = src.indexOf("$");
      return index >= 0 ? index : -1;
    },
    tokenize(src) {
      const m = INLINE_MATH_RE.exec(src);
      if (!m) return undefined;
      return { type: "mathInline", raw: m[0], tex: m[1] ?? "" };
    },
  },
  parseMarkdown(token) {
    return { type: "mathInline", attrs: { tex: String(token.tex ?? "") } };
  },
  renderMarkdown(node) {
    return `$${node.attrs?.tex ?? ""}$`;
  },
  addCommands() {
    return {
      insertMathInline:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { tex: "" } }).run(),
    };
  },
  addNodeView() {
    return (props) => mathNodeView(props, false);
  },
});

const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { tex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div.dshk-math[data-display][data-tex]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ class: "dshk-math", "data-display": "1", "data-tex": node.attrs.tex ?? "" }, HTMLAttributes),
    ];
  },
  markdownTokenizer: {
    name: "mathBlock",
    level: "block",
    start(src) {
      const m = /^[ \t]*\$\$/m.exec(src);
      return m ? m.index : -1;
    },
    tokenize(src) {
      const m = /^[ \t]*\$\$([\s\S]+?)\$\$/.exec(src);
      if (!m) return undefined;
      return { type: "mathBlock", raw: m[0], tex: (m[1] ?? "").trim() };
    },
  },
  parseMarkdown(token) {
    return { type: "mathBlock", attrs: { tex: String(token.tex ?? "") } };
  },
  renderMarkdown(node) {
    return `$$\n${node.attrs?.tex ?? ""}\n$$`;
  },
  addCommands() {
    return {
      insertMathBlock:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { tex: "" } }).run(),
    };
  },
  addNodeView() {
    return (props) => mathNodeView(props, true);
  },
});

// ─── Callout 遗留迁移（> [!类型] 行；[!fold] = 折叠块，`-` 旗标 = 收起） ──
// 提示框卡片能力已移除（/ 菜单不再提供）。本扩展只剩解析职责：历史折叠页的
// [!fold] 语法解析即迁移 dshkDetails 双槽（存盘落 <details> 新格式）；其余类型
// 降级为普通引用块，标记行原样保留为文字（无内容损失，二次解析稳定）
const CalloutLegacy = Node.create({
  name: "dshkCalloutLegacy",
  group: "block",
  markdownTokenName: "dshkCallout",
  addOptions() {
    return { ctx: null };
  },
  markdownTokenizer: {
    name: "dshkCallout",
    level: "block",
    start(src) {
      const m = /^[ \t]*>[ \t]*\[!/m.exec(src);
      return m ? m.index : -1;
    },
    tokenize(src, _tokens, helper) {
      const lines = src.split("\n");
      const consumed = [];
      const stripped = [];
      for (const line of lines) {
        const bm = /^[ \t]*>[ ]?(.*)$/.exec(line);
        if (!bm) break;
        consumed.push(line);
        stripped.push(bm[1] ?? "");
      }
      if (consumed.length === 0) return undefined;
      const first = stripped[0] ?? "";
      const mm = /^\[!([\w-]+)\]([+-])?[ \t]?(.*)$/.exec(first);
      if (!mm) return undefined;
      const body = stripped
        .slice(1)
        .join("\n")
        .replace(/^\n+/, "")
        .replace(/[ \t]+$/, "");
      const tokens = body === "" ? [] : helper.blockTokens(`${body}\n`);
      return {
        type: "dshkCallout",
        raw: consumed.join("\n"),
        cotype: String(mm[1] ?? "info").toLowerCase(),
        flag: mm[2] ?? "",
        title: String(mm[3] ?? "").trim(),
        tokens,
      };
    },
  },
  parseMarkdown(token, helpers) {
    // [!fold] → dshkDetails 双槽（标题/正文都是任意块内容）。标记行标题只有一行
    // 纯文本 → 标题槽首段，下次保存落新格式
    if (String(token.cotype ?? "") === "fold") {
      const kids = (token.tokens ?? []).length > 0 ? helpers.parseBlockChildren(token.tokens) : [{ type: "paragraph", content: [] }];
      const titleText = String(token.title ?? "").trim();
      return {
        type: "dshkDetails",
        attrs: { open: token.flag !== "-" },
        content: [
          {
            type: "dshkDetailsTitle",
            content: [titleText === ""
              ? { type: "paragraph", content: [] }
              : { type: "paragraph", content: [{ type: "text", text: titleText }] }],
          },
          { type: "dshkDetailsBody", content: kids },
        ],
      };
    }
    // 其余类型：普通引用块，标记行保留为文字段（内容无损，往返稳定）
    const marker = `[!${token.cotype ?? "info"}]${token.flag === "-" ? "-" : ""}${token.title !== "" ? ` ${token.title}` : ""}`;
    const kids = (token.tokens ?? []).length > 0 ? helpers.parseBlockChildren(token.tokens) : [];
    return {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: marker }] }, ...kids],
    };
  },
});

// ─── 折叠块（wangshu 同款：标题/正文两个 block* 富内容槽，存盘 <details>） ──
// 标题区可多行、可任意块级/行内格式，与正文同级编辑。md 载体用原生
// <details><summary> HTML（wangshu 导出同款），tokenizer 先于内建 html 规则整块
// 认领；闭合不全时放行给内建链路 → RawBlock 原样保留（解析容错公理）。
// 已知边界：summary/正文内的代码围栏若含有 </summary>/</details> 字面行会被
// 误切开（wangshu 导出同款限制）
const Details = Node.create({
  name: "dshkDetails",
  group: "block",
  content: "dshkDetailsTitle dshkDetailsBody",
  defining: true,
  isolating: true,
  markdownTokenName: "dshkDetails",
  addAttributes() {
    return { open: { default: true } };
  },
  parseHTML() {
    return [{ tag: "div[data-type='dshk-details']" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "dshk-details", "data-open": node.attrs.open ? "true" : "false" }, HTMLAttributes),
    ];
  },
  markdownTokenizer: {
    name: "dshkDetails",
    level: "block",
    start(src) {
      const m = /^[ \t]*<details\b/m.exec(src);
      return m ? m.index : -1;
    },
    tokenize(src, _tokens, helper) {
      const lines = src.split("\n");
      if (!/^[ \t]*<details\b[^>]*>[ \t]*$/.test(lines[0] ?? "")) return undefined;
      const open = /\sopen(\s|>|$|=)/.test(lines[0] ?? "");
      const consumed = [];
      let depth = 0;
      let summaryStart = -1;
      let summaryEnd = -1;
      let detailsEnd = -1;
      let summaryInline = "";
      for (const line of lines) {
        const idx = consumed.length;
        consumed.push(line);
        if (idx === 0) {
          depth = 1;
          continue;
        }
        if (summaryEnd < 0 && depth === 1 && /^[ \t]*<summary\b[^>]*>/i.test(line)) {
          // 两种形态都认：<summary> 单行包死 / <summary> 换行多行内容
          const oneLine = /^[ \t]*<summary\b[^>]*>([\s\S]*?)<\/summary>[ \t]*$/i.exec(line);
          if (oneLine) {
            summaryInline = oneLine[1] ?? "";
            summaryEnd = idx;
          } else {
            summaryStart = idx;
          }
          continue;
        }
        if (summaryEnd < 0 && /^[ \t]*<\/summary>/i.test(line)) summaryEnd = idx;
        if (/^[ \t]*<details\b/.test(line)) depth++;
        else if (/^[ \t]*<\/details>/i.test(line)) {
          depth--;
          if (depth === 0) {
            detailsEnd = idx;
            break;
          }
        }
      }
      if (detailsEnd < 0 || summaryEnd < 0) return undefined;
      const clean = (s) => String(s ?? "").replace(/^\n+/, "").replace(/[ \t]*\n+$/, "");
      const summaryMd = summaryInline !== ""
        ? summaryInline
        : clean(consumed.slice(summaryStart >= 0 ? summaryStart + 1 : 1, summaryEnd).join("\n"));
      const bodyMd = clean(consumed.slice(summaryEnd + 1, detailsEnd).join("\n"));
      return {
        type: "dshkDetails",
        raw: consumed.slice(0, detailsEnd + 1).join("\n"),
        open,
        summaryTokens: summaryMd === "" ? [] : helper.blockTokens(`${summaryMd}\n`),
        bodyTokens: bodyMd === "" ? [] : helper.blockTokens(`${bodyMd}\n`),
      };
    },
  },
  parseMarkdown(token, helpers) {
    const kids = (toks) => ((toks ?? []).length > 0 ? helpers.parseBlockChildren(toks) : [{ type: "paragraph", content: [] }]);
    return {
      type: "dshkDetails",
      attrs: { open: token.open === true },
      content: [
        { type: "dshkDetailsTitle", content: kids(token.summaryTokens) },
        { type: "dshkDetailsBody", content: kids(token.bodyTokens) },
      ],
    };
  },
  renderMarkdown(node, helpers) {
    const slot = (wrapper) => (wrapper?.content ?? []).length > 0
      ? String(helpers.renderChildren(wrapper.content, "\n\n") || "").replace(/\n+$/, "")
      : "";
    return `<details${node.attrs?.open ? " open" : ""}>\n<summary>\n${slot(node.content?.[0])}\n</summary>\n\n${slot(node.content?.[1])}\n</details>`;
  },
  addCommands() {
    return {
      insertDetails:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { open: true },
              content: [
                { type: "dshkDetailsTitle", content: [{ type: "paragraph" }] },
                { type: "dshkDetailsBody", content: [{ type: "paragraph" }] },
              ],
            })
            .run(),
    };
  },
  // wangshu 同款快捷键：Ctrl+Enter 跳出折叠块在块后起段；标题槽首空段退格=删整块；
  // 正文槽首空段退格=光标退到标题槽末尾
  addKeyboardShortcuts() {
    return {
      "Ctrl-Enter": () => {
        const { $from } = this.editor.state.selection;
        let depth = $from.depth;
        while (depth > 0 && $from.node(depth).type.name !== "dshkDetails") depth--;
        if (depth === 0) return false;
        return this.editor.chain().focus().insertContentAt($from.after(depth), { type: "paragraph" }).run();
      },
      Backspace: () => {
        const { $from } = this.editor.state.selection;
        let depth = $from.depth;
        while (depth > 0 && $from.node(depth).type.name !== "dshkDetails") depth--;
        if (depth === 0) return false;
        const isFirstSlot = $from.index(depth) === 0;
        const isFirstChild = $from.depth > depth && $from.index(depth + 1) === 0;
        const isAtStart = $from.parentOffset === 0;
        const isEmpty = $from.parent.textContent.length === 0;
        if (isFirstSlot && isFirstChild && isAtStart && isEmpty) {
          return this.editor
            .chain()
            .focus()
            .insertContentAt({ from: $from.before(depth), to: $from.after(depth) }, { type: "paragraph" })
            .run();
        }
        if (!isFirstSlot && isFirstChild && isAtStart && isEmpty) {
          const titleEnd = $from.start(depth) + $from.node(depth).child(0).nodeSize;
          return this.editor.chain().focus().setTextSelection(titleEnd - 1).run();
        }
        return false;
      },
    };
  },
  addNodeView() {
    return (props) => {
      const card = document.createElement("div");
      card.className = "dshk-vault-details";
      const chev = document.createElement("button");
      chev.type = "button";
      chev.className = "dshk-details-chev";
      chev.textContent = "▸";
      const flow = document.createElement("div");
      flow.className = "dshk-details-flow";
      card.appendChild(chev);
      card.appendChild(flow);
      const sync = () => {
        const open = props.node.attrs.open !== false;
        card.classList.toggle("is-closed", !open);
        chev.style.transform = open ? "rotate(90deg)" : "rotate(0deg)";
      };
      sync();
      // 收起态点卡片任意处 = 展开 + 光标进标题槽：正文 display:none 时 PM 会把
      // 光标解析进隐藏正文，打字全落进看不见的位置。capture 先于 PM 的 mousedown
      card.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || props.node.attrs.open !== false) return;
        if (e.target.closest?.(".dshk-details-chev")) return;
        e.preventDefault();
        e.stopPropagation();
        const pos = props.getPos();
        if (typeof pos !== "number") return;
        const view = props.editor.view;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...props.node.attrs, open: true });
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1), 1));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      }, true);
      // 收起时若光标在正文槽里必须挪出（挪到标题槽末尾），否则收起后接着打字
      // 全是隐形编辑
      chev.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = props.getPos();
        if (typeof pos !== "number") return;
        const view = props.editor.view;
        const closing = props.node.attrs.open !== false;
        const $from = view.state.selection.$from;
        let depth = $from.depth;
        while (depth > 0 && $from.node(depth).type.name !== "dshkDetails") depth--;
        const inBody = depth > 0 && $from.index(depth) === 1;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...props.node.attrs, open: !closing });
        if (closing && inBody) {
          const titleSize = tr.doc.resolve(pos + 1).node(1).firstChild?.nodeSize ?? 0;
          if (titleSize > 0) tr.setSelection(TextSelection.near(tr.doc.resolve(pos + titleSize), -1));
        }
        view.dispatch(tr);
      });
      return {
        dom: card,
        contentDOM: flow,
        update(node) {
          if (node.type.name !== "dshkDetails") return false;
          props.node = node;
          sync();
          return true;
        },
      };
    };
  },
});

const DetailsTitle = Node.create({
  name: "dshkDetailsTitle",
  content: "block*",
  defining: true,
  isolating: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "div[data-type='dshk-details-title']" }];
  },
  renderHTML() {
    return ["div", { "data-type": "dshk-details-title", class: "dshk-details-title" }, 0];
  },
});

const DetailsBody = Node.create({
  name: "dshkDetailsBody",
  content: "block*",
  defining: true,
  isolating: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "div[data-type='dshk-details-body']" }];
  },
  renderHTML() {
    return ["div", { "data-type": "dshk-details-body", class: "dshk-details-body" }, 0];
  },
});

// ─── RawBlock（未知块级 HTML 整块原样保留，code 盒式显示） ──────────────────
// vault 公理「解析容错——不认识的行原样保留，绝不丢弃」：marked 的块级 html
// token（如 <details>…）整块收进来，序列化时原样写回。行内 HTML 走默认
// generateJSON 链路（schema parseDOM 认识的就转 mark，不认识回退字面文本）。
const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "pre[data-dshk-raw]" }];
  },
  renderHTML({ node }) {
    return ["pre", { "data-dshk-raw": "", class: "dshk-rte-rawbox" }, node.attrs.html ?? ""];
  },
  markdownTokenName: "html",
  parseMarkdown(token) {
    if (token && token.block === false) return null; // 行内合并 token → 走默认链路
    const raw = String(token.text ?? token.raw ?? "");
    if (!raw.includes("\n")) return null; // 单行块级 html（<br> 等）走默认链路
    if (/^[ \t]*<(br|hr|img)\b/i.test(raw.trimStart())) return null;
    return { type: "rawBlock", attrs: { html: raw } };
  },
  renderMarkdown(node) {
    return String(node.attrs?.html ?? "");
  },
  addNodeView() {
    return (props) => {
      const pre = document.createElement("pre");
      pre.className = "dshk-rte-rawbox";
      pre.title = "HTML 原样保留（编辑源文件可改）";
      const sync = () => {
        pre.textContent = props.node.attrs.html ?? "";
      };
      sync();
      return {
        dom: pre,
        ignoreMutation: () => true,
        update(node) {
          if (node.type.name !== "rawBlock") return false;
          props.node = node;
          sync();
          return true;
        },
      };
    };
  },
});

// ─── 官方规格的 vault 约定覆写（旧文件行内 HTML 语法保持不变） ───────────────
// 官方 underline 序列化是 ++..++（非通用约定），覆写成旧约定 <u>；高亮带色时
// 覆写成 <mark style>（旧约定），无色保持官方 ==；上下标官方无规格，补 <sup>/
// <sub>；textStyle 补 color → <span style="color:">。
const VaultUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
});
const VaultSuperscript = Superscript.extend({
  renderMarkdown(node, helpers) {
    return `<sup>${helpers.renderChildren(node)}</sup>`;
  },
});
const VaultSubscript = Subscript.extend({
  renderMarkdown(node, helpers) {
    return `<sub>${helpers.renderChildren(node)}</sub>`;
  },
});
const VaultHighlight = Highlight.extend({
  renderMarkdown(node, helpers) {
    const color = node.attrs?.color;
    return color
      ? `<mark style="background-color: ${color}">${helpers.renderChildren(node)}</mark>`
      : `==${helpers.renderChildren(node)}==`;
  },
});
const VaultTextStyle = TextStyle.extend({
  renderMarkdown(node, helpers) {
    const color = node.attrs?.color;
    return color
      ? `<span style="color: ${color}">${helpers.renderChildren(node)}</span>`
      : helpers.renderChildren(node);
  },
});

// ─── 代码盒（语言条 + 复制钮，官方 CodeBlockLowlight 的装饰高亮不变） ───────
const CODE_LANGS = [
  ["", "text"], "js", "ts", "jsx", "tsx", "json", "python", "rust", "go", "java",
  "c", "cpp", "csharp", "php", "ruby", "sql", "bash", "shell", "yaml", "toml",
  "css", "html", "xml", "markdown", "latex", "diff", "mermaid",
];
const VaultCodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    return { ...this.parent?.(), ctx: null };
  },
  addNodeView() {
    const ctx = this.options.ctx ?? {};
    return (props) => {
      const box = document.createElement("div");
      box.className = "dshk-codebox";
      const bar = document.createElement("div");
      bar.className = "dshk-codebar";
      const select = document.createElement("select");
      select.className = "dshk-rte-langsel";
      for (const item of CODE_LANGS) {
        const [value, label] = Array.isArray(item) ? item : [item, item];
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
      }
      select.value = props.node.attrs.language ?? "";
      select.addEventListener("change", () => {
        const pos = props.getPos();
        if (typeof pos !== "number") return;
        props.editor.view.dispatch(
          props.editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...props.node.attrs,
            language: select.value || null,
          }),
        );
        props.editor.view.focus();
      });
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "dshk-codecopy";
      copy.textContent = ctx.codeCopy ?? "复制";
      copy.addEventListener("click", (e) => {
        e.preventDefault();
        const text = props.node.textContent;
        const done = () => {
          copy.textContent = ctx.codeCopied ?? "已复制";
          setTimeout(() => {
            copy.textContent = ctx.codeCopy ?? "复制";
          }, 1200);
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
        else done();
      });
      bar.appendChild(select);
      bar.appendChild(copy);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (props.node.attrs.language) code.className = `language-${props.node.attrs.language}`;
      pre.appendChild(code);
      box.appendChild(bar);
      box.appendChild(pre);
      return {
        dom: box,
        contentDOM: code,
        update(node) {
          if (node.type.name !== "codeBlock") return false;
          props.node = node;
          code.className = node.attrs.language ? `language-${node.attrs.language}` : "";
          select.value = node.attrs.language ?? "";
          return true;
        },
      };
    };
  },
});

// ─── MarkdownManager 子类：扩大文本转义面 ───────────────────────────────────
// 官方只转义 [\ ` * _ [ ] ~。我们的自定义 tokenizer 多了 $ 与 [[..]] 两种起步
// 语法，正文里的字面 $、] 不转义的话，序列化产物重新 parse 会被误判成公式/
// wikilink（“围栏里 $x$” 一存一取就变成公式节点）。代码块/行内码内的文本走
// isInsideCode 通道不经这里，不受影响。
class VaultMarkdownManager extends MarkdownManager {
  escapeMarkdownSyntax(text) {
    return String(text ?? "").replace(/([\\`*_\[\]$~])/g, "\\$1");
  }
}

// ─── 扩展组装（node 测试与工厂共用同一份列表） ──────────────────────────────
// 硬换行（breaks:true 下段落内单换行 → <br>）；序列化 = 官方硬换行写法
// 「行尾两空格+换行」。tiptap 单包存在但为免版本漂移本地定义。
const HardBreakPonyfill = Node.create({
  name: "hardBreak",
  group: "inline",
  inline: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "br" }];
  },
  renderHTML() {
    return ["br"];
  },
  renderMarkdown() {
    return "  \n";
  },
  parseMarkdown() {
    return { type: "hardBreak" };
  },
  markdownTokenName: "br",
});

// 图片：src 是 vault 内相对路径（attachments/…），显示端经 ctx.resolveSrc 换
// raw 直链；加载失败降级占位（alt 文本可见，不静默吞图）
const VaultImage = Image.extend({
  addOptions() {
    return { ...this.parent?.(), ctx: null };
  },
  addNodeView() {
    const ctx = this.options.ctx ?? {};
    return (props) => {
      const box = document.createElement("span");
      box.className = "dshk-rte-img";
      box.contentEditable = "false";
      const img = document.createElement("img");
      const fallback = document.createElement("span");
      fallback.className = "dshk-rte-imgmiss";
      const sync = () => {
        const src = props.node.attrs.src ?? "";
        img.src = ctx.resolveSrc ? ctx.resolveSrc(src) : src;
        img.alt = props.node.attrs.alt ?? "";
        img.title = src;
      };
      sync();
      img.addEventListener("error", () => box.classList.add("is-broken"));
      img.addEventListener("load", () => box.classList.remove("is-broken"));
      fallback.textContent = props.node.attrs.alt || props.node.attrs.src || "图片";
      box.appendChild(img);
      box.appendChild(fallback);
      return {
        dom: box,
        ignoreMutation: () => true,
        update(node) {
          if (node.type.name !== "image") return false;
          props.node = node;
          sync();
          return true;
        },
        stopEvent() {
          return true;
        },
      };
    };
  },
});

function buildExtensions(ctx = {}) {
  return [
    Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
    Document,
    Paragraph,
    Text,
    UndoRedo,
    Placeholder.configure({ placeholder: ctx.placeholder ?? "" }),
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Bold, Italic, Strike, Code,
    VaultUnderline, VaultSuperscript, VaultSubscript,
    VaultTextStyle, Color,
    VaultHighlight.configure({ multicolor: true }),
    LinkExtension.configure({ openOnClick: false }),
    BulletList, OrderedList, ListItem,
    TaskList, TaskItem.configure({ nested: true }),
    Blockquote, HorizontalRule,
    VaultCodeBlock.configure({ lowlight, ctx }),
    Table.configure({ resizable: false }),
    TableRow, TableCell, TableHeader,
    VaultImage.configure({ inline: true, allowBase64: false }),
    HardBreakPonyfill,
    Gapcursor, Dropcursor,
    WikiLink.configure({ ctx }),
    MathInline, MathBlock,
    CalloutLegacy,
    Details, DetailsTitle, DetailsBody,
    RawBlock,
  ];
}

// ─── 工厂（浏览器入口；node 测试用 buildExtensions + MarkdownManager） ──────
function create(host, opts = {}) {
  const editor = new Editor({
    element: host,
    extensions: buildExtensions({
      placeholder: opts.placeholder ?? "",
      codeCopy: opts.labels?.codeCopy,
      codeCopied: opts.labels?.codeCopied,
      onWikiLink: opts.onWikiLink,
      resolveWiki: opts.resolveWiki,
      resolveSrc: opts.resolveSrc,
    }),
    content: opts.md ?? "",
    contentType: "markdown",
    autofocus: false,
    editorProps: {
      attributes: { class: "dshk-rte-doc", spellcheck: "false" },
    },
  });
  // Markdown 扩展内部自建了官方 manager；换成 VaultMarkdownManager（扩转义面）
  // 并重接 getMarkdown —— parse 用谁的都一样，serialize 必须走扩面版
  const vaultManager = new VaultMarkdownManager({
    indentation: { style: "space", size: 2 },
    markedOptions: { breaks: true, gfm: true },
    extensions: editor.extensionManager.baseExtensions,
  });
  editor.storage.markdown.manager = vaultManager;
  editor.markdown = vaultManager;
  editor.getMarkdown = () => vaultManager.serialize(editor.getJSON());

  const handle = {
    editor,
    getMd: () => editor.getMarkdown(),
    focus() {
      editor.commands.focus();
    },
    undo() {
      editor.chain().focus().undo().run();
    },
    redo() {
      editor.chain().focus().redo().run();
    },
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),
    onUpdate(fn) {
      editor.on("update", fn);
      return () => editor.off("update", fn);
    },
    onSelectionUpdate(fn) {
      editor.on("selectionUpdate", fn);
      return () => editor.off("selectionUpdate", fn);
    },
    isActive: (name, attrs) => editor.isActive(name, attrs),
    setHeading: (level) => editor.chain().focus().toggleHeading({ level }).run(),
    setParagraph: () => editor.chain().focus().setParagraph().run(),
    toggleBullet: () => editor.chain().focus().toggleBulletList().run(),
    toggleOrdered: () => editor.chain().focus().toggleOrderedList().run(),
    toggleTask: () => editor.chain().focus().toggleTaskList().run(),
    toggleQuote: () => editor.chain().focus().toggleBlockquote().run(),
    insertHr: () => editor.chain().focus().setHorizontalRule().run(),
    insertCodeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
    insertMathInline: () => editor.chain().focus().insertMathInline().run(),
    insertMathBlock: () => editor.chain().focus().insertMathBlock().run(),
    insertDetails: () => editor.chain().focus().insertDetails().run(),
    insertTable: (rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(),
    insertImage: (src, alt) => editor.chain().focus().setImage({ src, alt }).run(),
    setLink: (href) => editor.chain().focus().setLink({ href }).run(),
    unsetLink: () => editor.chain().focus().unsetLink().run(),
    setColor: (color) => editor.chain().focus().setColor(color).run(),
    unsetColor: () => editor.chain().focus().unsetColor().run(),
    setHighlight: (color) => editor.chain().focus().setHighlight({ color }).run(),
    unsetHighlight: () => editor.chain().focus().unsetHighlight().run(),
    clearFormat: () => editor.chain().focus().unsetAllMarks().run(),
    insertWikiLink: (attrs) => editor.chain().focus().insertWikiLink(attrs).run(),
    // 表格内编辑（浮条用）：判定 + 增删行列
    inTable: () => editor.isActive("table") || editor.isActive("tableCell") || editor.isActive("tableHeader"),
    tableAddRow: (after = true) =>
      after ? editor.chain().focus().addRowAfter().run() : editor.chain().focus().addRowBefore().run(),
    tableAddCol: (after = true) =>
      after ? editor.chain().focus().addColumnAfter().run() : editor.chain().focus().addColumnBefore().run(),
    tableDeleteRow: () => editor.chain().focus().deleteRow().run(),
    tableDeleteCol: () => editor.chain().focus().deleteColumn().run(),
    tableDelete: () => editor.chain().focus().deleteTable().run(),
    wikiRefresh() {
      for (const entry of wikiViews) {
        if (entry.editor === editor) entry.refresh();
      }
    },
    /** [[页#锚]] 落点：按标题文本 slug 匹配，滚动 + 光标落标题行 */
    scrollToHeading(anchorRaw, slugify) {
      const want = String(slugify(anchorRaw ?? "")).toLowerCase();
      if (want === "") return false;
      let found = null;
      editor.state.doc.descendants((node, pos) => {
        if (found || node.type.name !== "heading") return;
        if (String(slugify(node.textContent)).toLowerCase() === want) found = pos;
      });
      if (found === null) return false;
      const view = editor.view;
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.near(view.state.doc.resolve(found + 1)))
          .scrollIntoView(),
      );
      const dom = view.domAtPos(found + 1);
      const el = dom.node instanceof Element ? (dom.node.childNodes[dom.offset] ?? dom.node) : dom.node;
      if (el instanceof Element) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("dshk-rte-anchorflash");
        setTimeout(() => el.classList.remove("dshk-rte-anchorflash"), 1600);
      }
      return true;
    },
    destroy() {
      for (const entry of [...wikiViews]) {
        if (entry.editor === editor) wikiViews.delete(entry);
      }
      editor.destroy();
    },
  };
  return handle;
}

// node 测试入口：纯 JS 往返（无 DOM）——parse 出 JSON、schema 校验、serialize 回 md
function makeTestRig(markedOptions = { breaks: true, gfm: true }) {
  const extensions = buildExtensions({});
  const manager = new VaultMarkdownManager({ extensions, markedOptions });
  const schema = getSchema(extensions);
  return {
    parse: (md) => manager.parse(md),
    serialize: (json) => manager.serialize(json),
    /** JSON 合法性（schema 校验），非法抛错原样上抛 */
    validate: (json) => schema.nodeFromJSON(json),
    schema,
    manager,
  };
}

window.DshRTE = { create, buildExtensions, makeTestRig, VaultMarkdownManager, version: "1" };
