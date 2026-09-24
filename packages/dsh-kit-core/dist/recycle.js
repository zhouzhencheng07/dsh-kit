// 回收站删除（Windows）——全局约定「删除优先进回收站」的宿主实现。
//
// 批量版把 N 个目标合成一个 PowerShell 进程：vault 整页删除（含孤儿级联）可能
// 一次几十个文件，逐目标 spawn 的进程开销线性放大；单进程内逐项执行并输出
// `R<n>=0|1` 结果行，宿主逐项对账（哪些真进了回收站、哪些失败）。失败语义：
// 文件被占用/路径过长等 VB FileSystem 会弹原生错误对话框（UIOption 无真正
// 无 UI 档），本进程 15s+3s/项（上限 120s）超时兜底，未完成项按失败计。
// 非 Windows 无回收站 API：返回全 false，由调用方决定回退（fs/op 报错、
// vault delete 直接 rm）。
import { spawn } from 'node:child_process';
const PS_TIMEOUT_BASE = 15_000;
const PS_TIMEOUT_PER_ITEM = 3_000;
const PS_TIMEOUT_MAX = 120_000;
/** PS 单引号字面量转义（'' 表示一个单引号）；路径只进单引号串，无其它插值面 */
function psQuoteSingle(s) {
    return `'${String(s).replace(/'/g, "''")}'`;
}
/** 批量移入回收站。返回与 targets 等长的逐项结果（true=已消失）。 */
export function recycleDeleteBatch(targets) {
    return new Promise((resolve) => {
        if (process.platform !== 'win32' || targets.length === 0) {
            resolve(targets.map(() => false));
            return;
        }
        const timeout = Math.min(PS_TIMEOUT_MAX, PS_TIMEOUT_BASE + PS_TIMEOUT_PER_ITEM * targets.length);
        const list = targets.map(psQuoteSingle).join(',');
        // Test-Path 现场判文件/目录选对应方法；删除后复查存在性作为成功判据
        const script = `try{Add-Type -AssemblyName Microsoft.VisualBasic}catch{exit 1};` +
            `$i=0;` +
            `foreach($p in @(${list})){` +
            `try{` +
            `if(Test-Path -LiteralPath $p -PathType Leaf){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin')}` +
            `elseif(Test-Path -LiteralPath $p -PathType Container){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin')}` +
            `}catch{}` +
            `if(-not(Test-Path -LiteralPath $p)){Write-Output ("R$i=1")}else{Write-Output ("R$i=0")};` +
            `$i++}`;
        let child;
        try {
            child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
        }
        catch {
            resolve(targets.map(() => false));
            return;
        }
        let out = '';
        let settled = false;
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch { }
            finish();
        }, timeout);
        const finish = (results) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(results ?? targets.map(() => false));
        };
        child.stdout?.on('data', (d) => {
            out += String(d);
        });
        child.on('error', () => finish());
        child.on('close', () => {
            const results = targets.map(() => false);
            for (const m of out.matchAll(/R(\d+)=(1|0)/g)) {
                const idx = Number(m[1]);
                if (idx >= 0 && idx < results.length)
                    results[idx] = m[2] === '1';
            }
            finish(results);
        });
    });
}
/** 单目标移入回收站；true=已消失。目标类型（文件/目录）现场探测。 */
export function recycleDelete(target) {
    return recycleDeleteBatch([target]).then((r) => r[0] ?? false);
}
