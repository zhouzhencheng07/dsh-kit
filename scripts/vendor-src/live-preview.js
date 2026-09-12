// Live Preview 装饰引擎（光标不在的构造隐语法现排版，光标进线
// 语法现形可编辑）。lezer-markdown 语法树驱动 + wikilink 正则补充扫描。
// 关键约束：replace 装饰跨行时必须经 StateField 提供（ViewPlugin 路径会抛
// 「replace line breaks may not be specified via plugins」）——所以全文档重算，
// vault 页面都是小文档，每次 doc/selection 事务全量重建成本可忽略；超 200KB
// 整体降级不装饰（结构还在，只是无所见即所得）。
import { StateField, RangeSet, Range } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";

// 强调类节点 → 内容样式类（装饰打在节点整体上，标记隐藏后视觉留在正文）
const EMPH_CLASS = {
  Emphasis: "dshk-lp-em",
  StrongEmphasis: "dshk-lp-strong",
  Strikethrough: "dshk-lp-strike",
};
const replace = (spec) => Decoration.replace(spec);
const mark = (cls, attrs) => Decoration.mark(attrs ? { class: cls, ...attrs } : { class: cls });

class TaskWidget extends WidgetType {
  constructor(checked, pos) {
    super();
    this.checked = checked;
    this.pos = pos;
  }
  eq(other) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "dshk-lp-task";
    box.checked = this.checked;
    // preventDefault 防止 CM 把点击当光标定位（定位会让勾选框现形回源码）
    box.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    box.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvents() { return false; }
}

class BulletWidget extends WidgetType {
  eq(other) { return true; }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "dshk-lp-bullet";
    dot.textContent = "•";
    return dot;
  }
}
const BULLET = new BulletWidget();

class HrWidget extends WidgetType {
  eq(other) { return true; }
  toDOM() {
    const line = document.createElement("span");
    line.className = "dshk-lp-hrline";
    return line;
  }
}
const HR = new HrWidget();

class ImgWidget extends WidgetType {
  constructor(src, title) {
    super();
    this.src = src;
    this.title = title;
  }
  eq(other) { return other.src === this.src && other.title === this.title; }
  toDOM() {
    const img = document.createElement("img");
    img.className = "dshk-lp-img";
    img.src = this.src;
    img.draggable = false;
    if (this.title) img.title = this.title;
    img.addEventListener("error", () => { img.style.display = "none"; });
    return img;
  }
}

// 数学公式 widget：katex 由宿主懒加载（window.katex），没就绪时回退显示原文
class MathWidget extends WidgetType {
  constructor(tex, display) {
    super();
    this.tex = tex;
    this.display = display;
  }
  eq(other) { return other.tex === this.tex && other.display === this.display; }
  toDOM() {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "dshk-lp-mathblock" : "dshk-lp-math";
    const katex = typeof window !== "undefined" ? window.katex : null;
    if (katex) {
      try {
        katex.render(this.tex, el, { displayMode: this.display, throwOnError: false });
      } catch {
        el.textContent = this.tex;
      }
    } else el.textContent = this.tex;
    return el;
  }
}

// 围栏代码块头（阅读态代码盒语言条同款）：语言名 + 复制钮，替换 ``` 开栏行。
// 标签文案由宿主经 handlers.codebarLabels 传入（vendor 侧不碰 i18n）
class CodebarWidget extends WidgetType {
  constructor(lang, code, labels) {
    super();
    this.lang = lang;
    this.code = code;
    this.labels = labels ?? {};
  }
  eq(other) { return other.lang === this.lang && other.code === this.code; }
  toDOM() {
    const bar = document.createElement("div");
    bar.className = "dshk-lp-codebar";
    const lang = document.createElement("span");
    lang.className = "dshk-lp-codelang";
    lang.textContent = this.lang;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "dshk-lp-codecopy";
    copy.textContent = this.labels.copy ?? "copy";
    copy.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    copy.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { void navigator.clipboard?.writeText(this.code); } catch { /* 剪贴板不可用静默 */ }
      copy.textContent = this.labels.copied ?? "copied";
      setTimeout(() => { copy.textContent = this.labels.copy ?? "copy"; }, 1200);
    });
    bar.appendChild(lang);
    bar.appendChild(copy);
    return bar;
  }
}

// 表格 widget（阅读态真表格同款渲染）：光标不在表内时整块替换成 table。
// 单元格点击 → 光标落到该单元格源码文本起点（表格现形管道行可编辑），与
// 全引擎「光标现形」语义一致。单元格文本走 textContent（不注 HTML）。
// head = 表头 cells 数组、body = cells 数组的数组（parsePipeRow 直出数组）
class TableWidget extends WidgetType {
  constructor(srcText, aligns, head, body) {
    super();
    this.srcText = srcText;
    this.aligns = aligns;
    this.head = head;
    this.body = body;
  }
  eq(other) { return other.srcText === this.srcText; }
  mkCell(tag, cell, i, view) {
    const el = document.createElement(tag);
    const align = this.aligns[i];
    if (align === "center") el.style.textAlign = "center";
    else if (align === "right") el.style.textAlign = "right";
    el.textContent = cell.text;
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      // 与 TaskWidget 同款：toDOM(view) 拿到的实例直接派发，光标落该单元格
      // 源码文本起点 → 表格现形管道行可编辑
      view.dispatch({ selection: { anchor: cell.from }, scrollIntoView: true });
    });
    return el;
  }
  toDOM(view) {
    const wrapEl = document.createElement("div");
    wrapEl.className = "dshk-lp-tablewrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    (this.head ?? []).forEach((c, i) => trh.appendChild(this.mkCell("th", c, i, view)));
    thead.appendChild(trh);
    const tbody = document.createElement("tbody");
    for (const cells of this.body ?? []) {
      const tr = document.createElement("tr");
      (cells ?? []).forEach((c, i) => tr.appendChild(this.mkCell("td", c, i, view)));
      tbody.appendChild(tr);
    }
    table.appendChild(thead);
    table.appendChild(tbody);
    wrapEl.appendChild(table);
    return wrapEl;
  }
  ignoreEvents() { return false; }
}

/** 拆一行管道行为 cells：{text(去空白), from(doc 偏移)}；\| 转义不分割 */
function parsePipeRow(doc, line) {
  const raw = line.text;
  const cells = [];
  let seg = null;
  const flush = (end) => {
    if (seg === null) return;
    let a = seg;
    let b = end;
    while (a < b && (raw[a] === " " || raw[a] === "\t")) a++;
    while (b > a && (raw[b - 1] === " " || raw[b - 1] === "\t")) b--;
    cells.push({ text: raw.slice(a, b), from: line.from + a });
    seg = null;
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && raw[i + 1] === "|") { i++; continue; }
    if (ch === "|") {
      flush(i);
      seg = i + 1;
    }
  }
  // 尾管道后没有内容就不再出空单元格（| a | b | 的闭管道不是一列）
  if (seg !== null && seg < raw.length) flush(raw.length);
  return cells;
}

/** 光标语义：任选区与 [from,to] 相交即「光标在内」→ 该构造现形源码 */
const selHit = (sel, from, to) => sel.ranges.some((r) => r.from <= to && r.to >= from);

function buildDeco(state, handlers) {
  const doc = state.doc;
  const len = doc.length;
  if (len > 200000) return { deco: Decoration.none, atomic: Decoration.none };
  const sel = state.selection;
  const repl = []; // replace 候选：贪心去重叠后入集
  const marks = []; // mark 装饰：允许任意重叠
  const atomic = [];
  const lineCls = new Map(); // line.from → Set<类名>
  const suppressed = []; // wikilink 扫描禁区 [from,to]
  const addLine = (pos, cls) => {
    const from = doc.lineAt(pos).from;
    let set = lineCls.get(from);
    if (!set) { set = new Set(); lineCls.set(from, set); }
    set.add(cls);
  };
  // 隐掉一行（含换行符整行消失）；fence 围栏/HR 在用
  const hideLine = (pos) => {
    const line = doc.lineAt(pos);
    repl.push({ from: line.from, to: Math.min(line.to + 1, len), deco: replace({}) });
  };
  // 标记后缀空格一并吞掉（`# 标` 的空格、`> 引` 的空格、`- 项` 的空格）
  const swallowSpace = (to) => {
    while (to < len && doc.sliceString(to, to + 1) === " ") to++;
    return to;
  };

  // frontmatter：文档以 --- 开头时整块处理。lezer（本版本）不解析 frontmatter，
  // 会把 tags 段当成段落+setext 下划线——树遍历时整个区间跳过，只认手动扫描。
  // 光标不在块内时整块隐藏（阅读态直接裁掉 frontmatter，两边一致）；进块现形淡显
  let fmLimit = -1;
  if (doc.lines > 1 && /^---\s*$/.test(doc.line(1).text)) {
    for (let n = 2; n <= Math.min(doc.lines, 60); n++) {
      const line = doc.line(n);
      if (/^(---|\.\.\.)\s*$/.test(line.text)) {
        if (!selHit(sel, doc.line(1).from, line.to)) {
          for (let k = 1; k <= n; k++) hideLine(doc.line(k).from);
        } else {
          for (let k = 1; k <= n; k++) addLine(doc.line(k).from, "dshk-lp-frontmatter");
        }
        fmLimit = line.to + 1;
        break;
      }
    }
  }

  // 语法树主遍历。树是视口懒解析的：field 建立时往往只有开头一段，必须
  // ensureSyntaxTree 强制同步全量（100ms 预算对 vault 级文档绰绰有余），
  // 否则视口外构造永远拿不到装饰
  const tree = ensureSyntaxTree(state, len, 100) ?? syntaxTree(state);
  const stack = []; // 祖先帧 {name, hideMarks, url, done, markerEnd}：enter 压、leave 弹
  tree.iterate({
    from: 0,
    to: len,
    enter: (node) => {
      const parent = stack[stack.length - 1];
      const { name } = node;

      if (fmLimit >= 0 && node.to <= fmLimit) {
        stack.push({ name });
        return;
      }
      const head = /^(ATXHeading([1-6])|SetextHeading([12]))$/.exec(name);
      if (head) {
        addLine(node.from, `dshk-lp-h${head[2] ?? head[3]}`);
        stack.push({ name });
        return;
      }
      if (EMPH_CLASS[name]) {
        // 内容样式始终在（光标进内也保持粗斜体），只切标记的隐/现
        marks.push({ from: node.from, to: node.to, deco: mark(EMPH_CLASS[name]) });
        stack.push({ name, hideMarks: !selHit(sel, node.from, node.to) });
        return;
      }
      if (name === "HeaderMark") {
        // ATX：`#` 连同后随空格藏掉；Setext：下划线整行藏。光标进标题现形
        const p = parent;
        if (/^SetextHeading/.test(p?.name ?? "")) {
          if (p.hideMarks !== false) hideLine(node.from);
        } else if (/^ATXHeading/.test(p?.name ?? "")) {
          if (!selHit(sel, p.from, p.to)) {
            repl.push({ from: node.from, to: swallowSpace(node.to), deco: replace({}) });
          } else {
            marks.push({ from: node.from, to: node.to, deco: mark("dshk-lp-faint") });
          }
        }
        stack.push({ name });
        return;
      }
      if (name === "EmphasisMark" || name === "StrikethroughMark") {
        if (parent?.hideMarks) repl.push({ from: node.from, to: node.to, deco: replace({}) });
        stack.push({ name });
        return;
      }
      if (name === "InlineCode") {
        marks.push({ from: node.from, to: node.to, deco: mark("dshk-lp-code") });
        suppressed.push([node.from, node.to]);
        stack.push({ name, hideMarks: !selHit(sel, node.from, node.to) });
        return;
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) addLine(doc.line(n).from, "dshk-lp-codeblock");
        suppressed.push([node.from, node.to]);
        const hide = name === "FencedCode" && !selHit(sel, node.from, node.to);
        if (hide) {
          // 开栏行换成语言条+复制钮（阅读态代码盒同款）；闭栏行由 CodeMark 分支藏
          const firstLine = doc.lineAt(node.from);
          const lastLine = doc.lineAt(node.to);
          const openm = /^\s*(?:`{3,}|~{3,})\s*([\w+#.-]*)/.exec(firstLine.text);
          const closed = last > first && /^\s*(`{3,}|~{3,})\s*$/.test(lastLine.text);
          const innerFrom = firstLine.to + 1;
          const innerTo = closed ? lastLine.from : node.to;
          const code = innerTo > innerFrom ? doc.sliceString(innerFrom, innerTo) : "";
          repl.push({
            from: firstLine.from,
            to: Math.min(firstLine.to + 1, len),
            deco: replace({ widget: new CodebarWidget(openm ? openm[1] : "", code, handlers.codebarLabels) }),
          });
        }
        stack.push({ name, hideMarks: hide, firstFrom: node.from });
        return;
      }
      if (name === "CodeMark") {
        if (parent?.name === "InlineCode" && parent.hideMarks) {
          repl.push({ from: node.from, to: node.to, deco: replace({}) });
        } else if (parent?.name === "FencedCode" && parent.hideMarks && node.from !== parent.firstFrom) {
          hideLine(node.from); // 闭栏整行连换行一起消（开栏行已换成语言条）
        }
        stack.push({ name });
        return;
      }
      if (name === "Blockquote") {
        // 引用整块逐行铺左条灰样式
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) addLine(doc.line(n).from, "dshk-lp-quote");
        stack.push({ name });
        return;
      }
      if (name === "QuoteMark") {
        const line = doc.lineAt(node.from);
        if (!selHit(sel, line.from, line.to)) {
          repl.push({ from: node.from, to: swallowSpace(node.to), deco: replace({}) });
        }
        stack.push({ name });
        return;
      }
      if (name === "ListMark") {
        const txt = doc.sliceString(node.from, node.to);
        if (/^[-*+]$/.test(txt)) {
          const line = doc.lineAt(node.from);
          if (!selHit(sel, line.from, line.to)) {
            // 只换符号不吞空格：• 和文本之间靠原有空格隔开
            repl.push({ from: node.from, to: node.to, deco: replace({ widget: BULLET }) });
          }
        }
        stack.push({ name });
        return;
      }
      if (name === "Task") {
        stack.push({ name, done: /\[[xX]\]/.test(doc.sliceString(node.from, Math.min(node.from + 6, node.to))), markerEnd: null });
        return;
      }
      if (name === "TaskMarker") {
        const line = doc.lineAt(node.from);
        if (!selHit(sel, line.from, line.to)) {
          const end = swallowSpace(node.to);
          repl.push({
            from: node.from,
            to: end,
            deco: replace({ widget: new TaskWidget(/[xX]/.test(doc.sliceString(node.from, node.to)), node.from + 1) }),
          });
          if (parent?.name === "Task") parent.markerEnd = end;
        }
        stack.push({ name });
        return;
      }
      if (name === "HorizontalRule") {
        const line = doc.lineAt(node.from);
        addLine(line.from, "dshk-lp-hr");
        if (!selHit(sel, line.from, line.to)) {
          repl.push({ from: line.from, to: Math.min(line.to + 1, len), deco: replace({ widget: HR }) });
        }
        stack.push({ name });
        return;
      }
      if (name === "TableDelimiter") {
        marks.push({ from: node.from, to: node.to, deco: mark("dshk-lp-faint") });
        stack.push({ name });
        return;
      }
      if (name === "Link") {
        suppressed.push([node.from, node.to]);
        stack.push({ name, hideMarks: !selHit(sel, node.from, node.to), url: null });
        return;
      }
      if (name === "Image") {
        suppressed.push([node.from, node.to]);
        const raw = doc.sliceString(node.from, Math.min(node.to, node.from + 500));
        const im = /^!\[([^\]]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/.exec(raw);
        const hide = !selHit(sel, node.from, node.to);
        const src = hide && im ? (handlers.resolveSrc ? handlers.resolveSrc(im[2]) : null) : null;
        if (src) {
          // 整体换图片组件且不下钻——子标记替换与整体重叠，免得贪心滤一遍
          repl.push({ from: node.from, to: node.to, deco: replace({ widget: new ImgWidget(src, im[1]) }) });
          stack.push({ name, skip: true });
          return false;
        }
        stack.push({ name, hideMarks: hide });
        return;
      }
      if (name === "LinkMark") {
        if (parent?.hideMarks && (parent.name === "Link" || parent.name === "Image")) {
          repl.push({ from: node.from, to: node.to, deco: replace({}) });
        }
        stack.push({ name });
        return;
      }
      if (name === "URL" || name === "LinkTitle") {
        const p = parent;
        if (p?.hideMarks && (p.name === "Link" || p.name === "Image")) {
          if (name === "URL") p.url = doc.sliceString(node.from, node.to);
          repl.push({ from: node.from, to: node.to, deco: replace({}) });
        }
        stack.push({ name });
        return;
      }
      stack.push({ name });
    },
    leave: (node) => {
      const frame = stack.pop();
      if (!frame) return;
      // Link 收尾：整体打链样式 + data-href（隐掉的部分不可见，视觉即正文上链）
      if (frame.name === "Link") {
        marks.push({
          from: node.from,
          to: node.to,
          deco: mark("dshk-lp-link", { attributes: { "data-href": frame.url ?? "", title: frame.url ?? "" } }),
        });
      }
      // Task 收尾：已完成 → 标记之后的正文划线淡化
      if (frame.name === "Task" && frame.done && frame.markerEnd != null && frame.markerEnd < node.to) {
        marks.push({ from: frame.markerEnd, to: node.to, deco: mark("dshk-lp-done") });
      }
    },
  });

  // ── 数学扫描（语法树不认识 $..$；先于 wikilink 扫描并把公式区入禁区，
  // 防公式内的 [[、* 等被其他正则误配）。块级 $$..$$ 可跨行 ──
  const inSuppressed = (pos) => suppressed.some(([a, b]) => pos >= a && pos < b);
  const mathSpans = [];
  {
    const text = doc.sliceString(0, len);
    const bm = /\$\$([^$]+?)\$\$/g;
    let m;
    while ((m = bm.exec(text))) {
      const from = m.index;
      const to = from + m[0].length;
      if (inSuppressed(from)) continue;
      suppressed.push([from, to]);
      mathSpans.push({ from, to, tex: m[1].trim(), display: true });
    }
    const im = /(?<!\$)\$(?!\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\$|\w)/g;
    while ((m = im.exec(text))) {
      const from = m.index;
      const to = from + m[0].length;
      if (inSuppressed(from)) continue;
      mathSpans.push({ from, to, tex: m[1], display: false });
    }
  }
  for (const span of mathSpans) {
    if (selHit(sel, span.from, span.to) || typeof window === "undefined" || !window.katex) {
      // 光标进公式现形源码；katex 未就绪时淡显原文（可读性优于裸替换）
      marks.push({ from: span.from, to: span.to, deco: mark("dshk-lp-mathraw") });
      continue;
    }
    repl.push({ from: span.from, to: span.to, deco: replace({ widget: new MathWidget(span.tex, span.display) }) });
  }

  // ── 行内 HTML 扫描（u/sup/sub/mark/span：泡泡菜单插入的富文本格式，阅读态
  // marked+DOMPurify 照常渲染——编辑态同款渲染才是所见即所得）。标签隐掉、内容
  // 按 style/class 上样式；光标进区现形源码。同名标签嵌套用栈配对，跨名嵌套
  // 各自独立扫描后内容区间自然重叠合成 ──
  {
    const text = doc.sliceString(0, len);
    const tokenRe = /<(\/)?(u|sup|sub|mark|span)((?:\s+[^<>]*?)?)>/gi;
    const tagStack = []; // {tag, from, innerFrom, style}
    const htmlRegions = [];
    let hm;
    while ((hm = tokenRe.exec(text))) {
      const from = hm.index;
      const to = from + hm[0].length;
      if (inSuppressed(from)) continue;
      const tag = hm[2].toLowerCase();
      if (hm[1]) {
        let i = tagStack.length - 1;
        while (i >= 0 && tagStack[i].tag !== tag) i--;
        if (i >= 0) {
          const open = tagStack[i];
          htmlRegions.push({ tag, from: open.from, to, innerFrom: open.innerFrom, innerTo: from, style: open.style });
          tagStack.length = i;
        }
      } else {
        const styleAttr = /\bstyle\s*=\s*"([^"]*)"/i.exec(hm[3] ?? "") ?? /\bstyle\s*=\s*'([^']*)'/i.exec(hm[3] ?? "");
        tagStack.push({ tag, from, innerFrom: to, style: styleAttr ? styleAttr[1] : null });
      }
    }
    for (const rg of htmlRegions) {
      const cls = rg.tag === "u" ? "dshk-lp-u"
        : rg.tag === "sup" ? "dshk-lp-sup"
        : rg.tag === "sub" ? "dshk-lp-sub"
        : rg.tag === "mark" ? "dshk-lp-mark"
        : "dshk-lp-span";
      const attrs = rg.style ? { attributes: { style: rg.style } } : undefined;
      if (selHit(sel, rg.from, rg.to)) {
        // 现形：标签可见（淡显），内容样式保持，方便对照改
        marks.push({ from: rg.from, to: rg.to, deco: mark("dshk-lp-faint") });
        marks.push({ from: rg.innerFrom, to: rg.innerTo, deco: mark(cls, attrs) });
      } else {
        marks.push({ from: rg.innerFrom, to: rg.innerTo, deco: mark(cls, attrs) });
        repl.push({ from: rg.from, to: rg.innerFrom, deco: replace({}) });
        repl.push({ from: rg.innerTo, to: rg.to, deco: replace({}) });
      }
    }
  }

  // ── 表格扫描：顶层级管道表（表头+分隔行+行体）整块换成真表格 widget（阅读态
  // 同款），点击单元格光标落入对应源码位置（表格现形管道行可编辑）；光标在表
  // 内时显示源码。引号前缀行（引用内表格）不匹配，保持源码 ──
  {
    let n = 1;
    while (n <= doc.lines) {
      const l1 = doc.line(n);
      if (inSuppressed(l1.from) || !/^\s*\|.*\|\s*$/.test(l1.text)) { n++; continue; }
      if (n + 1 > doc.lines) break;
      const l2 = doc.line(n + 1);
      if (
        inSuppressed(l2.from)
        || !l2.text.includes("|")
        || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l2.text)
      ) { n++; continue; }
      let last = n + 1;
      while (last < doc.lines && !inSuppressed(doc.line(last + 1).from) && /^\s*\|/.test(doc.line(last + 1).text)) last++;
      const from = l1.from;
      const to = Math.min(doc.line(last).to + 1, len);
      if (!selHit(sel, from, to)) {
        const rows = [];
        for (let k = n; k <= last; k++) rows.push(parsePipeRow(doc, doc.line(k)));
        if (rows.length >= 2 && rows[1].length > 0) {
          const aligns = rows[1].map((c) => (/^:-+:$/.test(c.text) ? "center" : /-+:$/.test(c.text) ? "right" : "left"));
          const body = rows.filter((_, i) => i !== 1);
          repl.push({
            from,
            to,
            deco: replace({ widget: new TableWidget(doc.sliceString(from, to), aligns, body[0], body.slice(1)), block: true }),
          });
          suppressed.push([from, to]);
        }
      }
      n = last + 1;
    }
  }

  // ── wikilink 补充扫描（语法树不认识 [[..]]；代码/链接区已入禁区）──
  const wlRe = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;
  for (let pos = 0; pos < len; ) {
    const line = doc.lineAt(pos);
    const text = line.text;
    wlRe.lastIndex = 0;
    let m;
    while ((m = wlRe.exec(text))) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (inSuppressed(from)) continue;
      const inner = m[1];
      const alias = m[2] != null && m[2] !== "" ? m[2] : null;
      const hash = inner.indexOf("#");
      const target = hash >= 0 ? inner.slice(0, hash) : inner;
      if (selHit(sel, from, to)) {
        marks.push({ from, to, deco: mark("dshk-lp-wikilink", { attributes: { "data-wl": inner } }) });
        continue;
      }
      const bodyFrom = from + 2;
      const bodyTo = to - 2;
      repl.push({ from, to: bodyFrom, deco: replace({}) });
      repl.push({ from: bodyTo, to, deco: replace({}) });
      let visibleTo = bodyTo;
      if (alias != null) {
        visibleTo = bodyFrom + target.length;
        if (visibleTo < bodyTo) repl.push({ from: visibleTo, to: bodyTo, deco: replace({}) }); // |别名 → 只显示别名
      }
      marks.push({
        from: bodyFrom,
        to: Math.max(visibleTo, bodyFrom + 1),
        deco: mark("dshk-lp-wikilink", { attributes: { "data-wl": inner, title: alias ?? inner } }),
      });
    }
    pos = line.to + 1;
  }

  // ── 出集：replace 贪心去重叠（RangeSet 只禁 replace 相互重叠，mark/line 随意）。
  // 同起点长者优先：整块替换要压过同位置更短的隐藏装饰 ──
  repl.sort((a, b) => a.from - b.from || b.to - a.to);
  const acc = [];
  let lastEnd = -1;
  for (const r of repl) {
    if (r.from < lastEnd) continue;
    acc.push(r);
    atomic.push(r);
    lastEnd = r.to;
  }
  for (const entry of lineCls) {
    acc.push({ from: entry[0], to: entry[0], deco: Decoration.line({ class: [...entry[1]].join(" ") }) });
  }
  for (const mk of marks) acc.push(mk);
  if (typeof window !== "undefined" && window.__LP_DEBUG) {
    window.__LP_DEBUG.push(acc.filter((r) => r.to - r.from > 20).map((r) => [r.from, r.to, doc.sliceString(r.from, Math.min(r.to, r.from + 30))]));
  }
  // RangeSet.of 只收 Range 实例（.value 取装饰），{from,to,deco} 裸对象会炸渲染
  const wrap = (list) => RangeSet.of(list.map((r) => new Range(r.from, r.to, r.deco)), true);
  return {
    deco: wrap(acc), // sort=true：内部按 (from, startSide) 排好
    atomic: wrap(atomic),
  };
}

// 主题随扩展走（EditorView.theme 生成编辑器私有作用域类，不污染全局）。
// 颜色一律 var(--dshk-lp-*, 亮色兜底)：暗色由宿主在 body[data-ds-dark-theme]
// 下覆盖同名变量，vendor 侧不用关心主题切换。
const mono = "var(--dshk-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)";
const lpTheme = EditorView.theme({
  ".dshk-lp-h1": { fontSize: "1.55em", fontWeight: "700", lineHeight: "1.45", paddingTop: "7px" },
  ".dshk-lp-h2": { fontSize: "1.32em", fontWeight: "700", lineHeight: "1.45", paddingTop: "6px" },
  ".dshk-lp-h3": { fontSize: "1.17em", fontWeight: "650", lineHeight: "1.4", paddingTop: "5px" },
  ".dshk-lp-h4": { fontSize: "1.07em", fontWeight: "600", paddingTop: "4px" },
  ".dshk-lp-h5": { fontSize: "1em", fontWeight: "600", paddingTop: "3px" },
  ".dshk-lp-h6": { fontSize: "0.94em", fontWeight: "600", opacity: "0.85", paddingTop: "3px" },
  ".dshk-lp-em": { fontStyle: "italic" },
  ".dshk-lp-strong": { fontWeight: "700" },
  ".dshk-lp-strike": { textDecoration: "line-through" },
  ".dshk-lp-code": {
    background: "rgba(135,131,120,0.16)",
    borderRadius: "4px",
    padding: "1px 4px",
    fontFamily: mono,
    fontSize: "0.92em",
  },
  ".dshk-lp-codeblock": { background: "rgba(135,131,120,0.12)", fontFamily: mono, fontSize: "0.92em" },
  ".dshk-lp-frontmatter": { opacity: "0.6", fontSize: "0.92em", fontFamily: mono },
  ".dshk-lp-quote": {
    borderLeft: "3px solid var(--dshk-lp-bar, #d0d7de)",
    paddingLeft: "8px",
  },
  ".dshk-lp-link": {
    color: "var(--dshk-tok-link, #0969da)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".dshk-lp-wikilink": {
    color: "var(--dshk-tok-link, #0969da)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".dshk-lp-faint": { opacity: "0.45" },
  ".dshk-lp-done": { textDecoration: "line-through", opacity: "0.55" },
  ".dshk-lp-math": { color: "inherit" },
  ".dshk-lp-mathblock": { display: "block", width: "100%", textAlign: "center", margin: "2px 0", color: "inherit" },
  ".dshk-lp-mathraw": { fontFamily: mono, fontSize: "0.92em", color: "var(--dshk-tok-meta, #6639ba)" },
  // 行内 HTML 富文本（阅读态同款语义）
  ".dshk-lp-u": { textDecoration: "underline" },
  ".dshk-lp-sup": { verticalAlign: "super", fontSize: "0.8em" },
  ".dshk-lp-sub": { verticalAlign: "sub", fontSize: "0.8em" },
  ".dshk-lp-mark": { background: "#fff3bf", borderRadius: "2px", padding: "0 1px" },
  // 表格（镜像阅读态 .dshk-md table）
  ".dshk-lp-tablewrap": { margin: "2px 0" },
  ".dshk-lp-tablewrap table": {
    borderCollapse: "collapse",
    fontSize: "12px",
    margin: "0.6em 0",
    cursor: "pointer",
  },
  ".dshk-lp-tablewrap th, .dshk-lp-tablewrap td": {
    border: "1px solid var(--dshk-lp-tborder, #d0d7de)",
    padding: "4px 10px",
    textAlign: "left",
  },
  ".dshk-lp-tablewrap th": { fontWeight: "600", background: "rgba(135,131,120,0.08)" },
  // 代码块语言条（镜像阅读态 .dshk-codebar）
  ".dshk-lp-codebar": {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(135,131,120,0.12)",
    fontSize: "11px",
    padding: "2px 10px",
    borderRadius: "6px 6px 0 0",
  },
  ".dshk-lp-codelang": {
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    opacity: "0.7",
    fontFamily: mono,
  },
  ".dshk-lp-codecopy": {
    border: "0",
    background: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: "11px",
    padding: "2px 6px",
    borderRadius: "5px",
    color: "inherit",
    opacity: "0.75",
  },
  ".dshk-lp-bullet": { opacity: "0.5" },
  ".dshk-lp-task": { verticalAlign: "middle", margin: "0 3px 0 0", accentColor: "var(--dshk-tok-link, #0969da)" },
  ".dshk-lp-hrline": { display: "inline-block", width: "100%", borderTop: "1px solid var(--dshk-lp-bar, #d0d7de)" },
  ".dshk-lp-img": { maxWidth: "100%", borderRadius: "6px", margin: "4px 0" },
});

// Ctrl/Cmd+点击链路与宿主对接：data-wl=wikilink 内文（目标#锚），data-href=md 链接
const clickExt = (handlers) =>
  EditorView.domEventHandlers({
    mousedown(event) {
      if (!(event.ctrlKey || event.metaKey)) return false;
      const t = event.target;
      const el = t && typeof t.closest === "function" ? t.closest(".dshk-lp-link, .dshk-lp-wikilink") : null;
      if (!el) return false;
      event.preventDefault();
      const wl = el.getAttribute("data-wl");
      if (wl != null && handlers.onWikiLink) {
        const hash = wl.indexOf("#");
        handlers.onWikiLink(hash >= 0 ? wl.slice(0, hash).trim() : wl.trim(), hash >= 0 ? wl.slice(hash + 1).trim() : "");
        return true;
      }
      const href = el.getAttribute("data-href");
      if (href && handlers.onOpenLink) handlers.onOpenLink(href);
      return true;
    },
  });

export function livePreview(handlers) {
  const field = StateField.define({
    create: (state) => buildDeco(state, handlers),
    update: (value, tr) => (tr.docChanged || tr.selection ? buildDeco(tr.state, handlers) : value),
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.deco),
      EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atomic ?? Decoration.none),
    ],
  });
  return [field, lpTheme, clickExt(handlers)];
}
