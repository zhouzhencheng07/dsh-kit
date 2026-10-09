// 手机访问兼容兜底单测：旧引擎缺 upsert（Map/WeakMap 的 getOrInsert / getOrInsertComputed）
// 时，注入的兜底要能在「页面」与「pdf.js 的 Blob 模块 Worker」两个 realm 里生效——官方
// PDF 预览两侧都调它（本体与理由见 src/phone/gateway.ts 的 UPSERT_POLYFILL 注释）。
// 用法：node tests\test-phone-compat.mjs（退出码即结果）
import vm from 'node:vm'

import { phoneCompatScript } from '../src/phone/gateway.ts'

let failed = 0
const check = (label, ok) => {
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}`)
  if (!ok) failed++
}

const tag = phoneCompatScript()
const body = tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('</script>'))

check('注入的是 <script> 包裹的脚本体', tag.startsWith('<script>(') && tag.endsWith('</script>'))

/** 干净 realm：模拟缺 upsert 的旧引擎；Blob 用最小实现（worker 源码能在测试里读回来） */
function freshRealm() {
  const sandbox = vm.createContext({})
  vm.runInContext(
    'globalThis.Blob = function(parts, opts){ this.parts = parts; this.type = (opts && opts.type) || ""; };' +
      'globalThis.Blob.prototype.text = function(){ return this.parts.map(function(p){ return typeof p === "string" ? p : String(p); }).join(""); };',
    sandbox,
  )
  return sandbox
}
const evalIn = (ctx, code) => vm.runInContext(code, ctx)
const run = (ctx) => vm.runInContext(body, ctx)

// ── 页面 realm：upsert 补齐 ──
{
  const ctx = freshRealm()
  check('vm 干净 realm 自身没有 upsert（等价旧引擎现场）', evalIn(ctx, 'typeof Map.prototype.getOrInsertComputed + "/" + typeof Map.prototype.getOrInsert') === 'undefined/undefined')
  run(ctx)
  const got = JSON.parse(evalIn(ctx, `(() => {
    const m = new Map(), w = new WeakMap(), k = {};
    const a = m.getOrInsertComputed('x', (key) => key + '!');
    const b = m.getOrInsertComputed('x', () => 'recomputed');
    const c = m.getOrInsert('y', 7);
    const d = m.getOrInsert('y', 9);
    const e = w.getOrInsertComputed(k, () => 42);
    const f = w.getOrInsert(k, 43);
    return JSON.stringify({ a, b, c, d, e, f });
  })()`))
  check('getOrInsertComputed：回调收到 key，命中不再算', got.a === 'x!' && got.b === 'x!')
  check('getOrInsert：未命中写入、命中返回旧值', got.c === 7 && got.d === 7)
  check('WeakMap 两个方法同样补齐', got.e === 42 && got.f === 42)
  check(
    '补齐的方法可写可配置（不冻住原型）',
    evalIn(
      ctx,
      'const d = Object.getOwnPropertyDescriptor(Map.prototype, "getOrInsertComputed"); d.writable === true && d.configurable === true',
    ) === true,
  )
}

// ── 引擎自带时不覆盖 ──
{
  const ctx = freshRealm()
  evalIn(ctx, 'Map.prototype.getOrInsertComputed = function(){ return "native" };')
  run(ctx)
  check('原生已有 upsert 时不覆盖，缺的那个才补', evalIn(ctx, 'new Map().getOrInsertComputed("a", () => 1)') === 'native' && evalIn(ctx, 'typeof Map.prototype.getOrInsert') === 'function')
}

// ── pdf.js 的 Worker Blob：兜底被前置进源码 ──
{
  const ctx = freshRealm()
  run(ctx)
  const src = '/*pdf.worker*/' + 'x'.repeat(1.1e5) + ';m.getOrInsertComputed("k", () => 1);'
  const got = JSON.parse(evalIn(ctx, `(() => {
    const src = ${JSON.stringify(src)};
    const big = new Blob([src], { type: 'text/javascript' });
    const text = big.text();
    const plain = new Blob([src], { type: 'text/plain' });
    const noMarker = new Blob(['y'.repeat(180000)], { type: 'text/javascript' });
    const small = new Blob([src.slice(0, 200)], { type: 'text/javascript' });
    const typed = [new Uint8Array(8)];
    const typedParts = new Blob(typed, { type: 'text/javascript' }).parts;
    return JSON.stringify({
      prepended: text.startsWith('var up=') && text.endsWith(src),
      oneCopy: text.split('var up=').length === 2,
      isBlob: big instanceof Blob,
      plainUntouched: plain.text() === src,
      noMarkerUntouched: noMarker.text().length === 180000,
      smallUntouched: small.text() === src.slice(0, 200),
      typedUntouched: typedParts === typed,
    });
  })()`))
  check('带特征串的大 JS Blob：兜底前置在 worker 源码之前', got.prepended === true)
  check('只前置一份（单次注入不叠加）', got.oneCopy === true)
  check('Blob 身份与原型不变（instanceof 仍成立）', got.isBlob === true)
  check('非 JS 类型不动', got.plainUntouched === true)
  check('JS 但没有特征串的长串不动', got.noMarkerUntouched === true)
  check('够小不动（不误伤普通脚本 Blob）', got.smallUntouched === true)
  check('首段不是字符串时参数原样透传', got.typedUntouched === true)
}

// ── 重复注入幂等：Blob 只包一层 ──
{
  const ctx = freshRealm()
  run(ctx)
  run(ctx)
  const text = evalIn(ctx, `new Blob([${JSON.stringify('z'.repeat(1.1e5) + 'getOrInsertComputed')}], { type: 'text/javascript' }).text()`)
  check('重复注入后仍只前置一份', text.split('var up=').length === 2 && text.endsWith('getOrInsertComputed'))
}

// ── crypto.randomUUID：局域网明文 HTTP 不是安全上下文才要补 ──
{
  const ctx = freshRealm()
  evalIn(ctx, 'globalThis.crypto = { getRandomValues: function(a){ for(var i=0;i<a.length;i++) a[i]=i; return a; } };')
  run(ctx)
  const id = evalIn(ctx, 'crypto.randomUUID()')
  check('无 randomUUID 时补上（形如 UUID，版本/变体位正确）', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
  const ctx2 = freshRealm()
  evalIn(ctx2, 'globalThis.crypto = { getRandomValues: function(a){ return a; }, randomUUID: function(){ return "native"; } };')
  run(ctx2)
  check('已有 randomUUID 时不覆盖', evalIn(ctx2, 'crypto.randomUUID()') === 'native')
}

console.log(failed === 0 ? 'ALL PHONE COMPAT TESTS OK' : `${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
