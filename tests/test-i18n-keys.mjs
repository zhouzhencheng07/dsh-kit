// i18n 词条哨兵：client 半边 t()/tf() 用到的字面量键，必须在词典里有定义。
// 多个模块词典（root + files/terminal/monitor 组件）共存于同一 bundle，
// 按全部词典区段 union 检查；漏词条 = 界面直接显示 key。用法：node tests\test-i18n-keys.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const bundles = [
  "client/bundle.js",
];

/** 收集文件里全部 zh/en 词典区段定义的键（多模块词典共存，union 后比对）；
 *  一个区段都找不到直接报错（别静默放行） */
function dictKeys(src, file) {
  const keys = new Set();
  for (const name of ["zh", "en"]) {
    let from = 0;
    let found = 0;
    for (;;) {
      const start = src.indexOf(`const ${name} = {`, from);
      if (start < 0) break;
      const end = src.indexOf("\n    };", start);
      if (end < 0) throw new Error(`${file}: ${name} 词典未闭合`);
      for (const m of src.slice(start, end).matchAll(/^\s{6}([A-Za-z][A-Za-z0-9_]*):\s*"/gm)) keys.add(m[1]);
      found++;
      from = end + 1;
    }
    if (found === 0) throw new Error(`${file}: 找不到 ${name} 词典`);
  }
  return keys;
}

let failed = 0;
for (const rel of bundles) {
  const raw = fs.readFileSync(path.join(here, "..", rel), "utf8");
  // 注释里举的用例（如 tf("x", { n: 1 })）不算真用到的键
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const defined = dictKeys(raw, rel);
  const used = new Set();
  for (const m of src.matchAll(/\b(?:t|tf)\("([A-Za-z][A-Za-z0-9_]*)"/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !defined.has(k)).sort();
  const ok = missing.length === 0;
  console.log(`${ok ? "PASS  " : "FAIL  "}${rel}：词典 ${defined.size} 键 / 用到 ${used.size} 键${ok ? "" : "，缺：" + missing.join(", ")}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "ALL PASS (i18n)" : `FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
