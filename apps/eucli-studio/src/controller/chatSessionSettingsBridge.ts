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

  // 按动作捕获会话上对应的那一个字段，供乐观保存失败时精确回滚。
  // 只回滚本次改动涉及字段，不覆盖保存期间其它字段的变化。
  function captureChatSettingsField(chat: any, action: ChatSettingsAction): { value: unknown; existed: boolean } {
    const key = chatSettingsFieldKey(action)
    return { value: chat?.[key], existed: !!chat && Object.prototype.hasOwnProperty.call(chat, key) }
  }

  function restoreChatSettingsField(chat: any, action: ChatSettingsAction, snapshot: { value: unknown; existed: boolean }) {
    if (!chat || typeof chat !== 'object') return
    const key = chatSettingsFieldKey(action)
    if (snapshot.existed) (chat as any)[key] = snapshot.value
    else delete (chat as any)[key]
  }

  function chatSettingsFieldKey(action: ChatSettingsAction): string {
    if (action === 'model') return 'modelOverride'
    if (action === 'reasoning') return 'reasoningEffort'
    if (action === 'stream') return 'streamEnabled'
    return 'hookPromptMode'
  }

  // 会话级设置：先在视窗上乐观显示所选值，再以业务端确认的完整会话覆盖。
  // 乐观只是展示先行，事实源仍是业务端；失败时回滚到保存前状态。
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
    // 回滚只恢复本次改动涉及的那一个字段，不覆盖保存期间其它字段的变化。
    const rollback = captureChatSettingsField(chat, action)
    applyLocal(chat)
    ;(chat as any).updatedAt = now()
    emit()
    return runChatSettingsSave(target, action, patch, async (isCurrent) => {
      try {
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
      } catch (error) {
        // 乐观展示失败即回滚到保存前，绝不让未确认的值留在视窗上冒充事实。
        if (isCurrent()) {
          const current = currentChatForSettingsTarget(target)
          if (current) {
            restoreChatSettingsField(current, action, rollback)
            emit()
          }
        }
        throw error
      }
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
