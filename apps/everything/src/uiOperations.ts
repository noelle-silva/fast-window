export type UiOperationKey = 'globalSetup' | 'runtimeStart' | 'runtimeRestart'

export type UiOperation = {
  key: UiOperationKey
  title: string
  detail: string
}

export const UI_OPERATIONS: Record<UiOperationKey, UiOperation> = {
  globalSetup: {
    key: 'globalSetup',
    title: '正在启用全局索引',
    detail: '正在确认 Everything 全局服务授权并启动专属搜索实例；如果 Windows 弹出权限确认，请完成确认后等待这里结束。',
  },
  runtimeStart: {
    key: 'runtimeStart',
    title: '正在启动 Everything runtime',
    detail: '后台控制面已经可用，正在同步运行副本、启动 Everything 并探测搜索进程就绪状态。',
  },
  runtimeRestart: {
    key: 'runtimeRestart',
    title: '正在重启 Everything runtime',
    detail: '正在停止旧实例、同步运行副本并重新探测就绪状态。',
  },
}
