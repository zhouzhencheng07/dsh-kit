// dsh-kit 组件间共享的宿主侧工具库：@deepseek-ai/dsh-tools 的类型契约与加载。
//
// 浏览器与日程两组工具各自装配（buildBrowserTools / buildScheduleTools），共用这一份
// defineTool 契约与模块加载。dsh-tools 是 ESM（type: module），加载走两锚点：裸
// import → dsh 本体锚点 resolve+import（profile/全局安装都命中）；monorepo 源码形态
// 跳过（dev 环境是 npm 全局布局，bin 锚点已覆盖）。
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
/** 异步两锚点加载 @deepseek-ai/dsh-tools（ESM）。失败返回 null。 */
export async function loadToolsModule(log = () => { }) {
    try {
        return await import('@deepseek-ai/dsh-tools');
    }
    catch {
        // 落到 dsh 本体锚点
    }
    const anchor = process.argv[1];
    if (anchor) {
        try {
            const abs = path.isAbsolute(anchor) ? anchor : path.resolve(process.cwd(), anchor);
            const resolved = createRequire(abs).resolve('@deepseek-ai/dsh-tools');
            if (resolved)
                return await import(__rewriteRelativeImportExtension(pathToFileURL(resolved).href));
        }
        catch {
            // 都失败
        }
    }
    log('dsh-kit: @deepseek-ai/dsh-tools 不可达，工具未注册（其余功能不受影响）');
    return null;
}
