import { now } from '../core/utils'
import { normalizeHookPromptSelection, HOOK_PROMPT_SESSION_METADATA_KEY, HOOK_PROMPT_SESSION_METADATA_MODE_KEY } from '../domain/hookPrompt'
import { updateGroupSessionSettings, updateRoleSessionSettings, updateWorkspaceSessionSettings, type SessionSettingsPatch } from './sessionSettingsClient'
import { updateGroupSessionHookPrompt, updateRoleSessionHookPrompt, updateWorkspaceSessionHookPrompt } from './hookPromptClient'
import { workspaceSessionToChat } from './workspaceBridge'
import { normalizeStoredChat } from '../storage/normalizeStoredChat'
import type { ChatSettingsAction } from './chatSettingsSaveQueue'
import type { ChatSettingsTarget } from './chatSessionTarget'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createChatSessionSettingsBridge(deps: {
  getState: () => any
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  emit: () => void
  showToast?: AiChatShowToast
  runChatSettingsSave: (target: ChatSettingsTarget, action: ChatSettingsAction, value: unknown, work: (isCurrent: () => boolean) => Promise<void>, failText: string) => Promise<'saved' | false>
  captureChatSettingsTarget: () => ChatSettingsTarget | null
  currentChatForSettingsTarget: (target: ChatSettingsTarget) => any
  isActiveChatSettingsTarget: (target: ChatSettingsTarget) => boolean
  upsertWorkspaceChat: (workspaceId: string, chat: any) => any
  upsertLoadedChat: (kind: 'role' | 'group', targetId: string, chat: any) => any
}) {
  const { getState, getNetRequest, emit, showToast, runChatSettingsSave, captureChatSettingsTarget, currentChatForSettingsTarget, isActiveChatSettingsTarget, upsertWorkspaceChat, upsertLoadedChat } = deps

  function writeHookPromptSelectionToChat(chat: any, modeRaw: any, presetIdRaw?: any) {
    if (!chat || typeof chat !== 'object') return
    const selection = normalizeHookPromptSelection({ hookPromptMode: modeRaw, hookPromptPresetId: presetIdRaw })
    const presetId = globalThis.String(presetIdRaw || '').trim()
    if (selection.mode === 'inherit') {
      delete (chat as any).hookPromptMode
      delete (chat as any).hookPromptPresetId
    } else if (selection.mode === 'none') {
      (chat as any).hookPromptMode = 'none'
      delete (chat as any).hookPromptPresetId
    } else {
      ;(chat as any).hookPromptMode = 'preset';
      (chat as any).hookPromptPresetId = selection.presetId || presetId
    }
    if (!(chat as any).metadata || typeof (chat as any).metadata !== 'object') (chat as any).metadata = {}
    if (selection.mode === 'inherit') {
      delete (chat as any).metadata[HOOK_PROMPT_SESSION_METADATA_MODE_KEY]
      delete (chat as any).metadata[HOOK_PROMPT_SESSION_METADATA_KEY]
    } else if (selection.mode === 'none') {
      (chat as any).metadata[HOOK_PROMPT_SESSION_METADATA_MODE_KEY] = 'none'
      delete (chat as any).metadata[HOOK_PROMPT_SESSION_METADATA_KEY]
    } else {
      ;(chat as any).metadata[HOOK_PROMPT_SESSION_METADATA_MODE_KEY] = 'preset';
      (chat as any).metadata[HOOK_PROMPT_SESSION_METADATA_KEY] = selection.presetId || presetId
    }
    chat.updatedAt = now()
  }

  function applyChatSettingsSessionResponse(target: ChatSettingsTarget, session: any) {
    if (!session || typeof session !== 'object' || String(session.id || '').trim() !== target.sessionId) throw new Error('业务端未返回有效会话')
    if (target.kind === 'workspace') {
      const chat = workspaceSessionToChat(session)
      if (!chat) throw new Error('业务端未返回有效会话')
      if (!upsertWorkspaceChat(target.workspaceId, chat)) throw new Error('当前会话视窗更新失败')
      return
    }
    const chat = normalizeStoredChat(session, target.kind)
    if (!chat) throw new Error('业务端未返回有效会话')
    if (!upsertLoadedChat(target.kind, target.targetId, chat)) throw new Error('当前会话视窗更新失败')
  }

  // 会话级设置只把业务端确认后的完整会话写回视窗。
  async function applyChatSettingsAction(target: ChatSettingsTarget, action: ChatSettingsAction, patch: SessionSettingsPatch, applyLocal: (chat: any) => void, failText: string): Promise<'saved' | 'draft' | false> {
    const state = getState()
    if (!state.data) return false
    const chat = currentChatForSettingsTarget(target)
    if (!chat) return false
    if (chat && (chat as any).clientDraft) {
      applyLocal(chat)
      ;(chat as any).updatedAt = now()
      emit()
      return 'draft'
    }
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') {
      showToast?.('业务端请求通道不可用', { kind: 'error' })
      return false
    }
    return runChatSettingsSave(target, action, patch, async (isCurrent) => {
      let session: any = null
      if (target.kind === 'group') {
        session = await updateGroupSessionSettings(netRequest, { groupId: target.groupId, sessionId: target.sessionId }, patch)
      } else if (target.kind === 'workspace') {
        session = await updateWorkspaceSessionSettings(netRequest, { workspaceId: target.workspaceId, roleId: target.roleId, sessionId: target.sessionId }, patch)
      } else {
        session = await updateRoleSessionSettings(netRequest, { roleId: target.roleId, sessionId: target.sessionId }, patch)
      }
      if (!isCurrent()) return
      applyChatSettingsSessionResponse(target, session)
      emit()
    }, failText)
  }

  async function selectHookPromptForActiveChat(modeRaw: any, presetIdRaw?: any) {
    const state = getState()
    if (!state.data) return
    const selection = normalizeHookPromptSelection({ hookPromptMode: modeRaw, hookPromptPresetId: presetIdRaw })
    const target = captureChatSettingsTarget()
    if (!target) return showToast?.('请先创建或选择会话', { kind: 'error' })
    const kind = target.kind
    const chat = currentChatForSettingsTarget(target)
    if (!chat) return
    if ((chat as any).clientDraft) {
      writeHookPromptSelectionToChat(chat, selection.mode, selection.presetId)
      emit()
      return
    }
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') return showToast?.('业务端请求通道不可用', { kind: 'error' })
    const ok = await runChatSettingsSave(target, 'hook', { mode: selection.mode, presetId: selection.presetId }, async (isCurrent) => {
      let session: any = null
      if (kind === 'group') {
        session = await updateGroupSessionHookPrompt(netRequest, { groupId: target.groupId, sessionId: target.sessionId, mode: selection.mode, presetId: selection.presetId })
      } else if (kind === 'workspace') {
        session = await updateWorkspaceSessionHookPrompt(netRequest, { workspaceId: target.workspaceId, roleId: target.roleId, sessionId: target.sessionId, mode: selection.mode, presetId: selection.presetId })
      } else {
        session = await updateRoleSessionHookPrompt(netRequest, { roleId: target.roleId, sessionId: target.sessionId, mode: selection.mode, presetId: selection.presetId })
      }
      if (!isCurrent()) return
      applyChatSettingsSessionResponse(target, session)
      emit()
    }, '当前会话 hook 提示词保存失败')
    if (ok && isActiveChatSettingsTarget(target)) {
      showToast?.(selection.mode === 'preset' ? '当前会话 hook 提示词已保存' : selection.mode === 'none' ? '已关闭当前会话 hook 提示词' : '已恢复跟随角色默认预设', { kind: 'success' })
    }
  }

  return { writeHookPromptSelectionToChat, applyChatSettingsSessionResponse, applyChatSettingsAction, selectHookPromptForActiveChat }
}
