// dsh-kit 宿主半边日志：落 <DSH_HOME>/dsh-kit/logs/kit.log（按大小轮转，2MB × 5）。
// 组件半边一律经 kitLogger('<组件>') 打，代码里不再直接 console。
//
// 长日志要能读，靠两件事：一行一事（固定字段顺序，grep 得动），以及 op() 作用域
// ——作用域内每一行都自动带作用域路径，作用域结束补一条结果行；报错的那行自己就
// 说清了「当时在做什么」，不必人工往上翻上下文。
//
// 级别走环境变量 DSH_KIT_LOG（off/error/warn/info/debug，默认 info，改动要重启宿主）；
// DSH_KIT_LOG_CONSOLE=0 关掉 warn/error 的 console 镜像（默认镜像，dev 终端即时可见）。
// 落盘失败（目录只读等）只丢文件不抛：日志本身绝不能成为故障源。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { kitPath } from "./data-path.js";
const LEVELS = ['error', 'warn', 'info', 'debug'];
const RANK = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_FILES = 5;
const FIELD_MAX = 200;
const rawLevel = (process.env.DSH_KIT_LOG ?? '').trim().toLowerCase();
const LEVEL = rawLevel === 'off' || rawLevel === 'none' || rawLevel === 'silent'
    ? 'off'
    : LEVELS.includes(rawLevel) ? rawLevel : 'info';
const MIRROR_CONSOLE = (process.env.DSH_KIT_LOG_CONSOLE ?? '1').trim() !== '0';
const scopes = new AsyncLocalStorage();
const file = () => kitPath('logs', 'kit.log');
let pending = Promise.resolve();
let knownBytes = -1;
function stamp(ts) {
    const d = new Date(ts);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
        + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function quoted(text) {
    return /[\s"=]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}
/** 消息一律加引号：行内固定「组件 [作用域] "消息"」的形状，grep 与人读都不歧义 */
function msgText(text) {
    return `"${text.replace(/"/g, '\\"')}"`;
}
function fieldText(value) {
    if (value === null || value === undefined)
        return 'null';
    if (value instanceof Error)
        return quoted(`${value.name}: ${value.message}`);
    if (typeof value === 'string')
        return quoted(value);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
        return String(value);
    try {
        const json = JSON.stringify(value) ?? String(value);
        return quoted(json.length > FIELD_MAX ? json.slice(0, FIELD_MAX) + '…' : json);
    }
    catch {
        return quoted(String(value));
    }
}
/** 一行一事：时间 级别 组件 [作用域] "消息" key=value…；错误附带的 stack 缩进跟在后面 */
export function kitLogFormat(entry) {
    const head = [stamp(entry.ts), entry.level.toUpperCase().padEnd(5), entry.component];
    if (entry.scope)
        head.push(entry.scope);
    head.push(msgText(entry.msg));
    for (const [key, value] of Object.entries(entry.fields ?? {})) {
        head.push(`${key}=${fieldText(value)}`);
    }
    let text = head.join(' ');
    for (const value of Object.values(entry.fields ?? {})) {
        if (value instanceof Error && value.stack) {
            // stack 首行就是 err= 里已有的 "Error: msg"，只补后面的调用帧（帧自带缩进，先去掉再统一补）
            const frames = value.stack.split(/\r?\n/).slice(1);
            if (frames.length > 0)
                text += '\n' + frames.map(line => '    ' + line.trimStart()).join('\n');
        }
    }
    return text;
}
async function write(entry) {
    const target = file();
    const text = kitLogFormat(entry) + '\n';
    try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        if (knownBytes < 0) {
            // 首条日志时文件还不存在：按 0 字节起算，不能让 stat 的 ENOENT 吃掉这一条
            knownBytes = await fs.promises.stat(target).then((stat) => stat.size, () => 0);
        }
        if (knownBytes + Buffer.byteLength(text) > MAX_BYTES) {
            await rotate(target);
            knownBytes = 0;
        }
        await fs.promises.appendFile(target, text);
        knownBytes += Buffer.byteLength(text);
    }
    catch {
        // 目录只读 / 磁盘满等：丢这一条，不影响宿主与插件本身
        knownBytes = -1;
    }
}
async function rotate(target) {
    const move = async (from, to) => {
        try {
            await fs.promises.rename(from, to);
        }
        catch {
            // 没有旧文件就跳过
        }
    };
    for (let i = KEEP_FILES - 1; i >= 2; i--)
        await move(`${target}.${i - 1}`, `${target}.${i}`);
    await move(target, `${target}.1`);
    await fs.promises.rm(`${target}.${KEEP_FILES}`, { force: true }).catch(() => { });
}
function emit(level, component, scope, msg, fields) {
    if (LEVEL === 'off' || RANK[level] > RANK[LEVEL])
        return;
    const entry = { ts: Date.now(), level, component, scope, msg, fields };
    if (MIRROR_CONSOLE && (level === 'warn' || level === 'error')) {
        const line = kitLogFormat(entry);
        if (level === 'error')
            console.error(line);
        else
            console.warn(line);
    }
    // 串行化追加：并发写的行不交错；队列自身的失败由 write 内部吞掉
    pending = pending.then(() => write(entry));
}
/** 取组件自己的 logger。component 只用组件名（files/vault/…），作用域名另由 op 给 */
export function kitLogger(component) {
    const scope = () => scopes.getStore() ?? '';
    const call = (level) => (msg, fields) => {
        emit(level, component, scope(), msg, fields);
    };
    return {
        debug: call('debug'),
        info: call('info'),
        warn: call('warn'),
        error: call('error'),
        op(name, fn, fields) {
            const started = Date.now();
            const done = (ok, error) => {
                emit(ok ? 'info' : 'error', component, scope(), `${name} ${ok ? 'ok' : '失败'}`, { ...fields, dur: `${Date.now() - started}ms`, ...(ok ? {} : { err: error }) });
            };
            return scopes.run(scopes.getStore() ? `${scopes.getStore()}>${name}` : name, () => {
                try {
                    const out = fn();
                    if (out && typeof out.then === 'function') {
                        return out.then((value) => {
                            done(true);
                            return value;
                        }, (error) => {
                            done(false, error);
                            throw error;
                        });
                    }
                    done(true);
                    return out;
                }
                catch (error) {
                    done(false, error);
                    throw error;
                }
            });
        },
    };
}
/** 等队列里的待写落盘（单测与宿主退出前用；正常路径不等） */
export function kitLogFlush() {
    return pending;
}
/** 按给定作用域直接写一条（端点回传用：级别与作用域来自外部文本，由调用方净化） */
export function kitLogEmit(level, component, scope, msg, fields) {
    emit(level, component, scope, msg, fields);
}
/** 进程启动头：版本 / 平台 / pid / 日志路径，定位「这是哪一次启动」 */
export function kitLogStartup(extra) {
    emit('info', 'dsh-kit', '', '宿主半边启动', {
        version: kitVersion(),
        platform: `${os.platform()} ${os.arch()}`,
        pid: process.pid,
        node: process.versions.node,
        dshHome: kitPath(),
        log: file(),
        ...extra,
    });
}
function kitVersion() {
    try {
        const url = new URL('../../package.json', import.meta.url);
        const pkg = JSON.parse(fs.readFileSync(url, 'utf8'));
        return pkg.version ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
}
