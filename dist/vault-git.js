// 知识库 git 存档（vault-git.ts）
//
// 职责：把 vaultRoot 做成"随时可整体回退"的存档库。三个自动提交时机：
//   1) 骨架建立时（vaultRoot 配置/变更）——已 init 的仓库跳过，新建仓库初始存档一次；
//   2) 人工保存后（vault/write 端点，Ctrl+S 与面板保存同路）——存下人工改动；
//   3) 删除后（delete 端点）——整体可撤回。
// 原第四时机「agent 编辑工具落盘前拦 fs/write-intent、fs/edit-intent 瀑布」已退役
// （2026-09-09 用户定稿 + 实测：该瀑布对 profile 插件不可达——fs/observed 的 emit
// 能到插件 ctx、intent waterfall 收不到；且拦截语义复杂、宿主升级难维护）。agent
// 的版本管理改由知识库技能教会的 git -C add/commit 承担（src/vault-skill.ts）。
//
// 降级语义：git 未安装/命令失败/超时一律静默跳过——存档是便利设施，绝不阻断
// 编辑主流程。附件目录不进存档（.gitignore：attachments/ 是图片 pdf 等二进制，
// *.tmp 是 vault/write 原子落盘的残件）。已有 .git 的 vault 不接管（不碰用户的
// 仓库与历史，也不改用户自己的 .gitignore）。
// 并发：提交经模块级 promise 链串行——人工保存与删除同时触发时避免
// git index.lock 撞车；可用性探测进程内缓存（运行期装 git 属罕见，不追）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const GIT_TIMEOUT_MS = 15000;
/** .gitignore 只在由本模块 init 仓库时写入；用户自己的仓库一字不改 */
const GITIGNORE = 'attachments/\n*.tmp\n';
let gitAvailable = null;
/** git 可用性探测（--version），进程内缓存；任何失败按不可用处理 */
export async function isGitAvailable() {
    if (gitAvailable !== null)
        return gitAvailable;
    gitAvailable = await new Promise((resolve) => {
        let child;
        try {
            child = spawn('git', ['--version'], { windowsHide: true });
        }
        catch {
            resolve(false);
            return;
        }
        let settled = false;
        const finish = (ok) => {
            if (!settled) {
                settled = true;
                resolve(ok);
            }
        };
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch { }
            finish(false);
        }, GIT_TIMEOUT_MS);
        child.on('exit', (code) => {
            clearTimeout(timer);
            finish(code === 0);
        });
        child.on('error', () => {
            clearTimeout(timer);
            finish(false);
        });
    });
    return gitAvailable;
}
/** 跑一条 git 命令：exit 0 → stdout，否则 null（无 git/非零/超时统一走这里） */
function runGit(root, args) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn('git', ['-C', root, ...args], { windowsHide: true });
        }
        catch {
            resolve(null);
            return;
        }
        let settled = false;
        let out = '';
        const finish = (result) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch { }
            finish(null);
        }, GIT_TIMEOUT_MS);
        child.stdout?.on('data', (chunk) => {
            out += chunk.toString('utf8');
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            finish(code === 0 ? out : null);
        });
        child.on('error', () => {
            clearTimeout(timer);
            finish(null);
        });
    });
}
/** 提交串行链：所有写仓库的操作都经这里排队 */
let chain = Promise.resolve();
function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => { });
    return run;
}
/**
 * 有变化才提交（porcelain 为空即跳过，attachments 已被忽略不计入）；
 * 返回是否真的提交了。身份用 -c 兜底，不依赖宿主机 git 全局配置。
 */
export async function commitVault(root, message) {
    return enqueue(async () => {
        if (!(await isGitAvailable()))
            return false;
        const status = await runGit(root, ['status', '--porcelain']);
        if (status === null || status.trim() === '')
            return false;
        if ((await runGit(root, ['add', '-A'])) === null)
            return false;
        return ((await runGit(root, ['-c', 'user.name=dsh-kit', '-c', 'user.email=dsh-kit@local', 'commit', '-m', message])) !== null);
    });
}
/**
 * 初始存档：vaultRoot 配置建立时调用。无 git / 已是仓库（.git 存在）跳过；
 * 否则 init + 写 .gitignore + 初始提交一次。幂等——重复调用无事发生。
 */
export async function ensureVaultGit(root) {
    await enqueue(async () => {
        if (!(await isGitAvailable()))
            return;
        if (fs.existsSync(path.join(root, '.git')))
            return;
        if ((await runGit(root, ['init'])) === null)
            return;
        try {
            fs.writeFileSync(path.join(root, '.gitignore'), GITIGNORE, 'utf8');
        }
        catch {
            return;
        }
        if ((await runGit(root, ['add', '-A'])) === null)
            return;
        await runGit(root, ['-c', 'user.name=dsh-kit', '-c', 'user.email=dsh-kit@local', 'commit', '-m', 'dsh-kit: 初始存档']);
    });
}
