import { forceStopApp, stopApp } from './appLauncher'
import type { AppStopResult, RegisteredApp } from './types'

export type AppStopMode = 'graceful' | 'force'

export type AppStopConfirmState = {
  app: RegisteredApp
  mode: AppStopMode
} | null

type AppStopCopy = {
  menuLabel: string
  title: string
  confirmLabel: string
  description: (appName: string) => string
}

const APP_STOP_COPY: Record<AppStopMode, AppStopCopy> = {
  graceful: {
    menuLabel: '停止',
    title: '停止 v5 应用',
    confirmLabel: '停止',
    description: appName => `确定要停止「${appName}」吗？应用会先收到退出指令，并自行关闭窗口和后台进程。`,
  },
  force: {
    menuLabel: '强制停止',
    title: '强制停止 v5 应用',
    confirmLabel: '强制停止',
    description: appName => `确定要强制停止「${appName}」吗？宿主会直接 kill 应用进程树，用于正常停止无响应的情况。`,
  },
}

export function appStopMenuLabel(mode: AppStopMode): string {
  return APP_STOP_COPY[mode].menuLabel
}

export function appStopDialogTitle(mode: AppStopMode): string {
  return APP_STOP_COPY[mode].title
}

export function appStopDialogDescription(mode: AppStopMode, appName: string): string {
  return APP_STOP_COPY[mode].description(appName)
}

export function appStopConfirmLabel(mode: AppStopMode): string {
  return APP_STOP_COPY[mode].confirmLabel
}

export async function stopRegisteredApp(app: RegisteredApp, mode: AppStopMode = 'graceful'): Promise<AppStopResult> {
  return mode === 'force' ? forceStopApp(app.id) : stopApp(app.id)
}

export function appStopToastMessage(appName: string, result: AppStopResult, mode: AppStopMode = 'graceful'): string {
  if (result.method === 'killed') return mode === 'force' ? `已强制 kill：${appName}` : `已兜底 kill：${appName}`
  if (result.method === 'alreadyStopped') return `应用已不在运行：${appName}`
  return `已停止：${appName}`
}
