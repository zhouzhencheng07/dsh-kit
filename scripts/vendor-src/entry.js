// CodeMirror 6 vendor 入口（由 scripts/build-vendor.mjs 拷进临时目录后 esbuild
// 打包成 IIFE，暴露 window.CM6.create 工厂）。
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { HighlightStyle, syntaxHighlighting, StreamLanguage, LanguageSupport, LanguageDescription } from "@codemirror/language";
import { tags as tg } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { livePreview } from "./live-preview.js";

const kitHighlight = HighlightStyle.define([
  { tag: tg.keyword, color: "var(--dshk-tok-keyword)" },
  { tag: [tg.string, tg.special(tg.string)], color: "var(--dshk-tok-string)" },
  { tag: [tg.comment, tg.quote], color: "var(--dshk-tok-comment)", fontStyle: "italic" },
  { tag: [tg.number, tg.bool, tg.null], color: "var(--dshk-tok-number)" },
  { tag: [tg.function(tg.variableName), tg.function(tg.propertyName)], color: "var(--dshk-tok-fn)" },
  { tag: [tg.typeName, tg.className, tg.namespace], color: "var(--dshk-tok-type)" },
  { tag: [tg.operator], color: "var(--dshk-tok-operator)" },
  { tag: [tg.meta, tg.processingInstruction], color: "var(--dshk-tok-meta)" },
  { tag: tg.link, color: "var(--dshk-tok-link)", textDecoration: "underline" },
  { tag: tg.heading, color: "var(--dshk-tok-heading)", fontWeight: "600" },
  { tag: tg.invalid, color: "#f85149" },
]);

const js = () => javascript();
const jsx = () => javascript({ jsx: true });
const ts = () => javascript({ typescript: true });
const tsx = () => javascript({ typescript: true, jsx: true });

const EXT_LANGS = {
  js: js, mjs: js, cjs: js, jsx,
  ts: ts, tsx,
  py: () => python(), pyw: () => python(),
  css: () => css(),
  html: () => html(), htm: () => html(),
  json: () => json(),
  md: () => markdown(), markdown: () => markdown(),
  xml: () => xml(), svg: () => xml(),
  sql: () => sql(),
  yml: () => StreamLanguage.define(yaml), yaml: () => StreamLanguage.define(yaml),
  toml: () => StreamLanguage.define(toml),
  sh: () => StreamLanguage.define(shell), bash: () => StreamLanguage.define(shell), zsh: () => StreamLanguage.define(shell),
  lua: () => StreamLanguage.define(lua),
  ruby: () => StreamLanguage.define(ruby), rb: () => StreamLanguage.define(ruby),
  go: () => StreamLanguage.define(go),
  rs: () => StreamLanguage.define(rust),
};

function resolveLang(ext) {
  const factory = EXT_LANGS[String(ext || "").toLowerCase()];
  if (!factory) return [];
  try { return [factory()]; } catch { return []; }
}

// md 围栏代码块内层高亮：与 EXT_LANGS 同源的语言描述表（load 即时可用，
// 首个对应围栏出现时按需挂载）
const stream = (make) => () => Promise.resolve(new LanguageSupport(make()));
const CODE_LANGS = [
  LanguageDescription.of({ name: "javascript", alias: ["js", "mjs", "cjs", "node"], load: () => Promise.resolve(js()) }),
  LanguageDescription.of({ name: "jsx", load: () => Promise.resolve(jsx()) }),
  LanguageDescription.of({ name: "typescript", alias: ["ts"], load: () => Promise.resolve(ts()) }),
  LanguageDescription.of({ name: "tsx", load: () => Promise.resolve(tsx()) }),
  LanguageDescription.of({ name: "python", alias: ["py", "py3"], load: () => Promise.resolve(python()) }),
  LanguageDescription.of({ name: "css", load: () => Promise.resolve(css()) }),
  LanguageDescription.of({ name: "html", alias: ["htm"], load: () => Promise.resolve(html()) }),
  LanguageDescription.of({ name: "json", alias: ["jsonc"], load: () => Promise.resolve(json()) }),
  LanguageDescription.of({ name: "xml", alias: ["svg"], load: () => Promise.resolve(xml()) }),
  LanguageDescription.of({ name: "sql", load: () => Promise.resolve(sql()) }),
  LanguageDescription.of({ name: "yaml", alias: ["yml"], load: stream(() => StreamLanguage.define(yaml)) }),
  LanguageDescription.of({ name: "toml", load: stream(() => StreamLanguage.define(toml)) }),
  LanguageDescription.of({ name: "shell", alias: ["sh", "bash", "zsh", "console", "shell-session"], load: stream(() => StreamLanguage.define(shell)) }),
  LanguageDescription.of({ name: "lua", load: stream(() => StreamLanguage.define(lua)) }),
  LanguageDescription.of({ name: "ruby", alias: ["rb"], load: stream(() => StreamLanguage.define(ruby)) }),
  LanguageDescription.of({ name: "go", alias: ["golang"], load: stream(() => StreamLanguage.define(go)) }),
  LanguageDescription.of({ name: "rust", alias: ["rs"], load: stream(() => StreamLanguage.define(rust)) }),
];

// base 必须显式给 GFM 版：markdown() 默认 base 是严格 CommonMark（任务列表/
// 删除线/表格全没有），且 `[x]`、`[[..]]` 会被当引用链接解析，和 Live Preview
// 的隐藏装饰打架
const md = () => markdown({ base: markdownLanguage, codeLanguages: CODE_LANGS });
EXT_LANGS.md = md;
EXT_LANGS.markdown = md;

/** 创建编辑器实例。返回句柄供宿主薄层调用。未知扩展名（txt/ini/log 等）
 *  自动换行——不产生横向滚动条，观感与旧纯文本预览一致；带语言的代码文件
 *  保持不换行（横向滚动条由宿主 CSS 钉底）。
 *  opts.live：Live Preview 处理器（仅 md 编辑场景传）——
 *    { onWikiLink(target, anchor), onOpenLink(href), resolveSrc(src) → URL|null } */
function create(container, opts) {
  const o = opts || {};
  const langComp = new Compartment();
  const roComp = new Compartment();
  let onChangeCb = null;
  const langs = resolveLang(o.language);
  const view = new EditorView({
    state: EditorState.create({
      doc: String(o.doc ?? ""),
      extensions: [
        basicSetup,
        syntaxHighlighting(kitHighlight),
        langComp.of(langs.length > 0 ? langs : [EditorView.lineWrapping]),
        roComp.of(o.readOnly ? EditorView.editable.of(false) : []),
        ...(o.live ? livePreview(o.live) : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && typeof onChangeCb === "function") onChangeCb(view.state.doc.toString());
        }),
      ],
    }),
    parent: container,
  });
  view.dom.classList.add("dshk-cm", "dshk-cm-scope");
  return {
    view,
    setEditable(next) { view.dispatch({ effects: roComp.reconfigure(next ? [] : EditorView.editable.of(false)) }); },
    getDoc() { return view.state.doc.toString(); },
    setDoc(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text) } }); },
    onDocChanged(fn) { onChangeCb = fn; },
    destroy() { view.destroy(); },
  };
}

window.CM6 = { create };
