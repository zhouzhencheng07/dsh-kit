// dsh-kit-logs 渲染级检查：日志组件行的行形状（行序末位 / exports / locale）、
// 宿主半边的探针与上报端点契约 + 写盘闸的开关行为、以及浏览器半边 logsModule 的
// 门控（探针 404 = 不装钩子、不上报）。vendor 静态资源的归属由终端 / 手机访问 /
// 知识库三份检查各自钉。
// 用法（dsh-kit 根）：node tests\render-check-logs.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let failed = 0;
const check = (label, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const read = (rel) => fs.readFileSync(__dirname + "/../" + rel, "utf8");

// 1) 行形状：行序末位、exports 子路径、卡片文案
{
  const patchSrc = read("cordis.patch.yml");
  const pkg = JSON.parse(read("package.json"));
  const ids = [...patchSrc.matchAll(/^ {4}- id: (.+)$/gm)].map((m) => m[1].trim());
  check(
    "日志行是最后一个组件行（排障用的能力不抢页面能力的视线）；行数 = 载体行 + 十个组件行",
    ids[ids.length - 1] === "logs" && ids.length === 11 && ids[0] === "core" &&
      patchSrc.includes("      name: dsh-kit/logs"),
  );
  check("exports 子路径与 locale 子路径齐备", !!pkg.exports["./logs"] && !!pkg.exports["./logs/locale/*.json"]);
  const zh = JSON.parse(read("locale/logs/zh.json")).meta;
  const en = JSON.parse(read("locale/logs/en.json")).meta;
  check(
    "卡片文案说清关行的后果（zh/en 各提「不写日志文件 / no log file」）",
    typeof zh.title === "string" && zh.title.length > 0 && typeof zh.description === "string" &&
      zh.description.includes("不写日志文件") && en.description.includes("no log file"),
  );
}

// 2) 源哨兵：端点契约、净化、闸的开关、client 门控
{
  const hostSrc = read("src/logs/index.ts");
  const bundleSrc = read("client/bundle.js");
  check(
    "行开关 = 唯一开关：本行不导出 Config（级别仍走 DSH_KIT_LOG 环境变量）",
    !/export const Config/.test(hostSrc) && !hostSrc.includes("volatile"),
  );
  check(
    "宿主半边自持两个 exact 端点：探针 /dsh-kit-logs/config + 上报 /dsh-kit/logs",
    (hostSrc.match(/kind: 'exact',/g) || []).length === 2 &&
      hostSrc.includes("path: '/dsh-kit-logs/config'") && hostSrc.includes("path: '/dsh-kit/logs'") &&
      hostSrc.includes("sameOrigin(req)"),
  );
  check(
    "上报文本按外部可写内容净化（级别白名单 + 长度上限 + 字段只收标量）",
    hostSrc.includes("const LOG_LEVELS") && hostSrc.includes("MAX_CLIENT_ENTRIES") &&
      hostSrc.includes("function clientFields"),
  );
  check(
    "写盘闸：apply 时开、注销时关（默认关，没有这一行就没有写盘）",
    hostSrc.includes("setKitLogFileSink(true)") && hostSrc.includes("setKitLogFileSink(false)") &&
      read("src/core/log.ts").includes("let fileSink = false"),
  );
  check("浏览器半边有 logsModule 且接进组装（行关时整体不注册）", bundleSrc.includes("const logsModule =") && bundleSrc.includes("exports.logs = logsModule(exports, require);"));
  check(
    "上报口改名 /dsh-kit/logs：旧口不再出现",
bundleSrc.includes('"/dsh-kit/logs"') && !/["'`]\/dsh-kit\/log["'`]/.test(bundleSrc),
  );
  check(
    "攒批闸在底座：关行时条目只走控制台镜像（不发请求）",
    bundleSrc.includes("let kitLogSinkOn = false;") && bundleSrc.includes("if (!kitLogSinkOn) return;") &&
      bundleSrc.includes("exports.kitLogSink = kitLogSink;"),
  );
  const hooksAt = bundleSrc.indexOf('hookGlobal(window, "kitLogError"');
  check(
    "全局钩子随本行走（装在 logsModule 里，不在底座无条件装）",
    hooksAt > bundleSrc.indexOf("const logsModule =") && bundleSrc.includes('fetch("/dsh-kit-logs/config"'),
  );
}

// 3) 行为：apply 开闸 + 端点契约 + 注销收场（真起一个临时 DSH_HOME 看落盘）
async function checkRuntime() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-kit-logs-"));
  process.env.DSH_HOME = home;
  const logFile = path.join(home, "dsh-kit", "logs", "kit.log");
  const mod = await import(pathToFileURL(path.resolve(__dirname, "../src/logs/index.ts")).href);
  const logCore = await import(pathToFileURL(path.resolve(__dirname, "../src/core/log.ts")).href);

  check("导入即默认不写盘（没有日志行就没有文件）", logCore.kitLogFileSinkOn() === false);

  const routes = [];
  const disposals = [];
  const cleanups = [];
  const webCtx = {
    webServer: {
      register: (route) => { routes.push(route); return () => { disposals.push(route.path); }; },
    },
  };
  mod.apply({
    inject: (deps, cb) => cb(webCtx),
    effect: (fn) => { const d = fn(); if (typeof d === "function") cleanups.push(d); },
  });

  check("apply 后写盘闸开、启动头已落一行", logCore.kitLogFileSinkOn() === true);
  await logCore.kitLogFlush();
  check("启动头进 kit.log（版本 / 平台 / pid / 日志路径）", fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes("宿主半边启动"));

  const probe = routes.find((r) => r.path === "/dsh-kit-logs/config");
  const ingest = routes.find((r) => r.path === "/dsh-kit/logs");
  check("两条路由都是 exact 且各自可撤", !!probe && !!ingest && probe.kind === "exact" && ingest.kind === "exact");

  const call = async (route, { method = "GET", host = "127.0.0.1:3081", origin = "", body = null } = {}) => {
    const req = {
      method,
      url: "/",
      headers: { host, ...(origin === "" ? {} : { origin }) },
      on: (ev, cb) => { if (ev === "data") cb(Buffer.from(String(body ?? ""))); if (ev === "end") cb(); },
    };
    let status = 0;
    let payload = "";
    await route.handler(req, {
      writeHead: (code) => { status = code; },
      end: (text) => { payload = String(text ?? ""); },
    });
    // 上报端点是 readJson(...).then(...) 异步落的，等一拍再读回应
    await new Promise((resolve) => setImmediate(resolve));
    return { status, payload };
  };

  check("探针：同源 GET 回 200 空对象", (await call(probe)).status === 200);
  check("探针：非 GET 405、跨域 Host 403", (await call(probe, { method: "POST" })).status === 405 && (await call(probe, { host: "evil.example" })).status === 403);
  check("上报：跨域 403、GET 405", (await call(ingest, { method: "POST", host: "evil.example", body: "{}" })).status === 403 && (await call(ingest)).status === 405);

  const before = fs.readFileSync(logFile, "utf8").length;
  const posted = await call(ingest, {
    method: "POST",
    origin: "http://127.0.0.1:3081",
    body: JSON.stringify({ entries: [{ level: "error", component: "vault", msg: "页面白屏了", fields: { a: 1, b: { nested: true } } }, { level: "panic", msg: "级别不认识" }] }),
  });
  await logCore.kitLogFlush();
  const after = fs.readFileSync(logFile, "utf8").slice(before);
  check("上报：同源 POST 受理并落盘（净化后：非白名单级别降 info、嵌套字段丢掉）", posted.status === 200 && after.includes('ERROR vault "页面白屏了" a=1') && after.includes('INFO  client "级别不认识"'));

  for (const dispose of cleanups) dispose();
  check(
    "注销收场：闸关掉、两条路由都撤了（此后不再写盘）",
    logCore.kitLogFileSinkOn() === false && disposals.length === 2 && disposals.includes("/dsh-kit-logs/config") && disposals.includes("/dsh-kit/logs"),
  );
  const sizeAtClose = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").length : 0;
  logCore.kitLogger("logs").error("关闸之后这一行不该落盘");
  await logCore.kitLogFlush();
  check("关闸后写日志不落文件（行开关真的管住文件）", fs.readFileSync(logFile, "utf8").length === sizeAtClose);

  fs.rmSync(home, { recursive: true, force: true });
}

checkRuntime().then(() => {
  console.log(failed === 0 ? "\nALL PASS (render-check logs)" : `\nFAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
});
