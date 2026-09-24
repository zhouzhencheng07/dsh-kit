// dsh-kit-dock 宿主半边：纯 entry 载体，无宿主功能。
// 底座的价值在 client 半边；客户端模块系统只从活动 entry 的包收集 client bundle，
// 所以共享包必须是一个 entry（bundle patch 插单挂进运行树）才能被其它组件 require。
export async function apply() {}
