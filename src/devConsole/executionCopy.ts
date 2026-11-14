import type { AppStopMethod, HostActionResult, HostAppAction } from './devConsoleApi'

export type OutcomeTone = 'success' | 'warning' | 'error' | 'muted'

export type OutcomeCopy = {
  text: string
  tone: OutcomeTone
}

/// 结果文案的唯一来源。
///
/// 温和停止与强制停止都可能以 `killed` 收场，但含义不同：
/// 前者是超时兜底，后者是用户的明确意图。文案必须把这件事讲清楚。
export function describeResult(action: HostAppAction, result: HostActionResult): OutcomeCopy {
  if (result.state === 'failed') {
    return { text: `执行失败：${result.message}`, tone: 'error' }
  }
  return describeMethod(action, result.method)
}

function describeMethod(action: HostAppAction, method: AppStopMethod): OutcomeCopy {
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
