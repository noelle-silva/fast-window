import type {
  AppLaunchOutcome,
  AppStopMethod,
  HostActionResult,
  HostAppAction,
} from './devConsoleApi'

export type OutcomeTone = 'success' | 'warning' | 'error' | 'muted'

export type OutcomeCopy = {
  text: string
  detail?: string
  tone: OutcomeTone
}

/// 结果文案的唯一来源。
///
/// 温和停止与强制停止都可能以 `killed` 收场，但含义不同：
/// 前者是超时兜底，后者是用户的明确意图。文案必须把这件事讲清楚。
export function describeResult(action: HostAppAction, result: HostActionResult): OutcomeCopy {
  switch (result.state) {
    case 'failed':
      return { text: `执行失败：${result.message}`, tone: 'error' }
    case 'stopped':
      return describeStop(action, result.method)
    case 'restarted':
      return {
        text: '已重启',
        detail: `停止阶段：${describeMethod(result.method)}`,
        tone: 'success',
      }
    case 'started':
      return describeLaunch(result.launch)
    case 'status':
      return describeStatus(result.running, result.pid, result.startedAt)
    case 'folder':
      return { text: '已打开文件夹', detail: result.path, tone: 'success' }
    case 'info':
      return {
        text:
          [result.version ? `v${result.version}` : null, describeKind(result.appKind)]
            .filter(Boolean)
            .join(' · ') || '注册信息',
        detail: result.path,
        tone: 'muted',
      }
  }
}

function describeStop(action: HostAppAction, method: AppStopMethod): OutcomeCopy {
  switch (method) {
    case 'graceful':
      return { text: '已正常退出', tone: 'success' }
    case 'killed':
      return action === 'forceStop'
        ? { text: '已强制 kill', tone: 'warning' }
        : { text: '超时未退出，已兜底强杀', tone: 'warning' }
    case 'terminated':
      return { text: '服务类应用已终止', tone: 'success' }
    case 'alreadyStopped':
      return { text: '本就没在运行', tone: 'muted' }
  }
}

function describeLaunch(launch: AppLaunchOutcome): OutcomeCopy {
  switch (launch) {
    case 'activated':
      return { text: '已启动', tone: 'success' }
    case 'skippedColdStart':
      return { text: '已在运行，只做唤醒', tone: 'muted' }
  }
}

function describeStatus(running: boolean, pid?: number, startedAt?: number): OutcomeCopy {
  if (!running) {
    return { text: '未运行', tone: 'muted' }
  }
  const detail = [pid ? `PID ${pid}` : null, startedAt ? `启动于 ${formatTime(startedAt)}` : null]
    .filter(Boolean)
    .join(' · ')
  return { text: '运行中', detail: detail || undefined, tone: 'success' }
}

function describeKind(appKind?: string): string | null {
  if (appKind === 'service-app') return '服务类'
  if (appKind === 'desktop-app') return '桌面类'
  return null
}

function describeMethod(method: AppStopMethod): string {
  switch (method) {
    case 'graceful':
      return '正常退出'
    case 'killed':
      return '强制结束'
    case 'terminated':
      return '服务已终止'
    case 'alreadyStopped':
      return '本就没在运行'
  }
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}
