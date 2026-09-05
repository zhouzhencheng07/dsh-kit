// Live Preview 装饰引擎（Obsidian 式：光标不在的构造隐语法现排版，光标进线
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
// callout 类型 → 调色键（亮色兜底；暗色由宿主 CSS 变量接管）
const CALLOUT_TYPES = {
  note: "blue", info: "blue", todo: "blue", abstract: "blue", summary: "blue", tldr: "blue",
  tip: "teal", hint: "teal", important: "teal",
  success: "green", check: "green", done: "green",
  question: "orange", help: "orange", faq: "orange", warning: "orange",
  caution: "orange", attention: "orange",
  danger: "red", error: "red", failure: "red", fail: "red", missing: "red", bug: "red",
  example: "purple", quote: "gray", cite: "gray",
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

class BadgeWidget extends WidgetType {
  constructor(colorKey, label) {
    super();
    this.colorKey = colorKey;
    this.label = label;
  }
  eq(other) { return other.label === this.label; }
  toDOM() {
    const b = document.createElement("span");
    b.className = `dshk-lp-badge dshk-lp-bc-${this.colorKey}`;
    b.textContent = this.label;
    return b;
  }
}

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

  // frontmatter：文档以 --- 开头时整块淡显。lezer（本版本）不解析 frontmatter，
  // 会把 tags 段当成段落+setext 下划线——树遍历时整个区间跳过，只认手动扫描
  let fmLimit = -1;
  if (doc.lines > 1 && /^---\s*$/.test(doc.line(1).text)) {
    for (let n = 2; n <= Math.min(doc.lines, 60); n++) {
      const line = doc.line(n);
      if (/^(---|\.\.\.)\s*$/.test(line.text)) {
        for (let k = 1; k <= n; k++) addLine(doc.line(k).from, "dshk-lp-frontmatter");
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
        stack.push({ name, hideMarks: name === "FencedCode" && !selHit(sel, node.from, node.to) });
        return;
      }
      if (name === "CodeMark") {
        if (parent?.name === "InlineCode" && parent.hideMarks) {
          repl.push({ from: node.from, to: node.to, deco: replace({}) });
        } else if (parent?.name === "FencedCode" && parent.hideMarks) {
          hideLine(node.from); // 围栏整行连换行一起消（同行的 CodeInfo 一并消失）
        }
        stack.push({ name });
        return;
      }
      if (name === "Blockquote") {
        // callout 探测：首行 `[!类型] 标题`（折叠 +/- 标记认但不做折叠语义）
        const firstLine = doc.lineAt(node.from);
        const probe = doc.sliceString(firstLine.from, Math.min(firstLine.to, firstLine.from + 120));
        const cm = /^\s*>\s*\[!([A-Za-z][\w-]*)\][+-]?\s?/.exec(probe);
        const typeName = cm ? cm[1].toLowerCase() : null;
        const colorKey = typeName ? CALLOUT_TYPES[typeName] ?? "blue" : null;
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) addLine(doc.line(n).from, colorKey ? "dshk-lp-callout" : "dshk-lp-quote");
        if (colorKey) addLine(firstLine.from, `dshk-lp-co-${colorKey}`);
        if (cm && !selHit(sel, firstLine.from, firstLine.to)) {
          const markStart = firstLine.from + cm.index + cm[0].indexOf("[!");
          const markEnd = markStart + cm[1].length + 2;
          repl.push({ from: markStart, to: markEnd, deco: replace({ widget: new BadgeWidget(colorKey, typeName) }) });
          if (markEnd < firstLine.to) {
            marks.push({ from: markEnd, to: firstLine.to, deco: mark("dshk-lp-co-title") });
          }
        }
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

  // ── wikilink 补充扫描（语法树不认识 [[..]]；代码/链接区已入禁区）──
  const inSuppressed = (pos) => suppressed.some(([a, b]) => pos >= a && pos < b);
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
  // 同起点长者优先：callout 徽章等整体替换要压过语法树里 `[!x]` 被当成引用
  // 链接解析出的 1 字符 LinkMark 隐藏 ──
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
const CALLOUT_RGB = {
  blue: ["#0969da", "rgba(9,105,218,0.10)"],
  teal: ["#0e8a8a", "rgba(14,138,138,0.10)"],
  green: ["#1a7f37", "rgba(26,127,55,0.10)"],
  orange: ["#bc4c00", "rgba(188,76,0,0.10)"],
  red: ["#cf222e", "rgba(207,34,46,0.10)"],
  purple: ["#8250df", "rgba(130,80,223,0.10)"],
  gray: ["#6e7781", "rgba(110,119,129,0.12)"],
};
const calloutTheme = {};
for (const key of Object.keys(CALLOUT_RGB)) {
  const [fg, bg] = CALLOUT_RGB[key];
  calloutTheme[`.dshk-lp-co-${key}`] = {
    borderLeftColor: `var(--dshk-lp-co-${key}, ${fg})`,
    backgroundColor: `var(--dshk-lp-co-${key}-bg, ${bg})`,
  };
  calloutTheme[`.dshk-lp-bc-${key}`] = {
    backgroundColor: `var(--dshk-lp-co-${key}, ${fg})`,
  };
}
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
  ".dshk-lp-callout": {
    borderLeft: "3px solid var(--dshk-lp-bar, #d0d7de)",
    paddingLeft: "8px",
  },
  ...calloutTheme,
  ".dshk-lp-co-title": { fontWeight: "700" },
  ".dshk-lp-badge": {
    fontSize: "0.78em",
    fontWeight: "700",
    padding: "1px 8px",
    borderRadius: "999px",
    color: "#fff",
    marginRight: "6px",
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
