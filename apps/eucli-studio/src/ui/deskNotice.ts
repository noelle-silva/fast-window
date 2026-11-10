import type { DeskEntry } from '../domain/desks'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { chatSessionRunNoticeKey, type ChatSessionRunNotice } from './chatSessionRunObservations'

// 工作桌面条目行尾的通知点：一枚点表达三种状态，按「需要人动手的程度」排优先级。
//   等待确认（黄） > 异常中断（红） > 已完成（绿）
// 黄点的事实来自运行卡状态，是实时的；红 / 绿来自会话运行通知，等价于「未读」。
// 两者都以「目标三段 + chatId」作键，口径与 useSessionRunObservations 完全一致，
// 因此这里不另立标识，只把桌面条目换算成同一把键。
export type DeskNoticeDotKind = 'waiting_confirmation' | 'error' | 'completed'

export function deskEntryNoticeKey(entry: DeskEntry): string {
  const targetId =
    entry.targetKind === 'workspace' ? workspaceRoleTargetId(entry.targetId, entry.roleId) : entry.targetId
  return chatSessionRunNoticeKey(entry.targetKind, targetId, entry.chatId)
}

export function resolveDeskNoticeDot(params: {
  notice: ChatSessionRunNotice | undefined
  waitingConfirmation: boolean
}): DeskNoticeDotKind | '' {
  if (params.waitingConfirmation) return 'waiting_confirmation'
  if (params.notice?.kind === 'interrupted') return 'error'
  if (params.notice?.kind === 'completed') return 'completed'
  return ''
}
