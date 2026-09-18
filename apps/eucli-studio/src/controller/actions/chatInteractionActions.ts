import { now } from '../../core/utils'
import { normalizeReasoningEffort } from '../../domain/reasoning'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createChatInteractionActions(deps: {
  state: any
  emit: () => void
  showToast?: AiChatShowToast
  sendChat: (opts?: any) => any
  stopSending: (runId?: any) => any
  regenerateAssistantMessage: (assistantMid: string, opts?: any) => any
  replyFromUserMessage: (userMid: string, opts?: any) => any
  createParallelBranchFromAssistantMessage: (assistantMid: string) => any
  switchBranchByAssistantSibling: (assistantMid: string, delta: number) => any
  setActiveBranch: (branchId: string) => any
  submitToolConfirmationDecision: (input: any) => any
  deleteMessage: (messageId: string) => any
  deleteMessageSubtree: (messageId: string) => any
  editMessage: (messageId: string, content: any) => any
  editMessageBlock: (messageId: string, blockRef: any, text: any) => any
  deleteMessageBlock: (messageId: string, blockRef: any) => any
  captureChatSettingsTarget: () => any
  currentChatForSettingsTarget: (target: any) => any
  isActiveChatSettingsTarget: (target: any) => boolean
  applyChatSettingsAction: (target: any, action: any, patch: any, applyLocal: (chat: any) => void, failText: string) => Promise<any>
  isChatModelActionPending: (target: any) => boolean
  aiGenerateChatTitle: (roleId: string, chatId: string) => Promise<any>
  aiGenerateGroupChatTitle: (groupId: string, chatId: string) => Promise<any>
  aiGenerateStickerName: (categoryName: string, stickerName: string) => Promise<any>
  reloadRoleSession: (roleId: string, chatId: string) => Promise<any>
  reloadWorkspaceSession: (workspaceId: string, chatId: string, roleId?: string) => Promise<any>
  ensureWorkspaceChatLoaded: (workspaceId: string, chatId: string) => Promise<any>
  loadStickersFromSource: () => Promise<any>
}) {
  const { state, emit, showToast, sendChat, stopSending, regenerateAssistantMessage, replyFromUserMessage, createParallelBranchFromAssistantMessage, switchBranchByAssistantSibling, setActiveBranch, submitToolConfirmationDecision, deleteMessage, deleteMessageSubtree, editMessage, editMessageBlock, deleteMessageBlock, captureChatSettingsTarget, currentChatForSettingsTarget, isActiveChatSettingsTarget, applyChatSettingsAction, isChatModelActionPending, aiGenerateChatTitle, aiGenerateGroupChatTitle, aiGenerateStickerName, reloadRoleSession, reloadWorkspaceSession, ensureWorkspaceChatLoaded, loadStickersFromSource } = deps

  return {
    send: () => sendChat(),
    sendFromMid: (forkFromMid: any, opts?: any) => sendChat({ ...(opts && typeof opts === 'object' ? opts : {}), forkFromMid: String(forkFromMid || '') }),
    stop: (runId?: any) => {
      stopSending(runId).catch(() => {})
    },
    regenerateAssistant: (assistantMid: any, opts?: any) => regenerateAssistantMessage(String(assistantMid || ''), opts && typeof opts === 'object' ? opts : undefined),
    replyFromUserMessage: (userMid: any, opts?: any) => replyFromUserMessage(String(userMid || ''), opts && typeof opts === 'object' ? opts : undefined),
    createBranchFromAssistant: (assistantMid: any) => createParallelBranchFromAssistantMessage(String(assistantMid || '')),
    switchBranchSibling: (assistantMid: any, delta: any) => switchBranchByAssistantSibling(String(assistantMid || ''), Number(delta || 0)).catch(() => {}),
    setActiveBranch: (branchId: any) => setActiveBranch(String(branchId || '')).catch(() => {}),
    submitToolConfirmation: (input: any) => submitToolConfirmationDecision(input),
    setChatModelOverride: async (providerId: any, modelId: any) => {
      if (!state.data) return
      const pid = String(providerId || '').trim()
      const mid = String(modelId || '').trim()
      if (!pid || !mid) return showToast?.('供应商/模型 不能为空', { kind: 'error' })
      const target = captureChatSettingsTarget()
      if (!target) return showToast?.('请先创建或选择会话', { kind: 'error' })
      const chat = target.chat
      const nextOverride = { kind: 'provider', providerId: pid, groupId: '', modelId: mid }
      const ok = await applyChatSettingsAction(
        target,
        'model',
        { modelOverride: nextOverride },
        (current) => {
          ;(current as any).modelOverride = nextOverride
        },
        '当前会话临时模型保存失败',
      )
      if (ok === 'saved' && isActiveChatSettingsTarget(target)) showToast?.('当前会话临时模型已保存', { kind: 'success' })
    },
    clearChatModelOverride: async () => {
      if (!state.data) return
      const target = captureChatSettingsTarget()
      if (!target) return showToast?.('请先创建或选择会话', { kind: 'error' })
      const chat = currentChatForSettingsTarget(target)
      if (!(chat as any)?.modelOverride && !isChatModelActionPending(target)) return
      const ok = await applyChatSettingsAction(
        target,
        'model',
        { modelOverride: null },
        (current) => {
          try {
            delete (current as any).modelOverride
          } catch (_e) {
            ;(current as any).modelOverride = null
          }
        },
        '当前会话临时模型清除失败',
      )
      if (ok === 'saved' && isActiveChatSettingsTarget(target)) showToast?.('已清除当前会话临时模型', { kind: 'success' })
    },
    setChatReasoningEffort: async (effort: any) => {
      if (!state.data) return
      const next = normalizeReasoningEffort(effort)
      const target = captureChatSettingsTarget()
      if (!target) return showToast?.('请先创建或选择会话', { kind: 'error' })
      const chat = target.chat
      const ok = await applyChatSettingsAction(
        target,
        'reasoning',
        { reasoningEffort: String(next || '') },
        (current) => {
          if (next) (current as any).reasoningEffort = next
          else delete (current as any).reasoningEffort
        },
        '当前会话思考等级保存失败',
      )
      if (ok === 'saved' && isActiveChatSettingsTarget(target)) showToast?.('当前会话思考等级已保存', { kind: 'success' })
    },
    toggleChatStreamEnabled: async () => {
      if (!state.data) return
      const target = captureChatSettingsTarget()
      if (!target) return showToast?.('请先创建或选择会话', { kind: 'error' })
      const chat = target.chat
      const nextOn = (chat as any).streamEnabled === false
      const ok = await applyChatSettingsAction(
        target,
        'stream',
        { streamEnabled: nextOn },
        (current) => {
          if (nextOn) delete (current as any).streamEnabled
          else (current as any).streamEnabled = false
        },
        '当前会话流式输出保存失败',
      )
    },
    deleteMessage: (messageId: any) => deleteMessage(String(messageId || '')),
    deleteMessageSubtree: (messageId: any) => deleteMessageSubtree(String(messageId || '')),
    editMessage: (messageId: any, content: any) => editMessage(String(messageId || ''), content),
    editMessageBlock: (messageId: any, blockRef: any, text: any) => editMessageBlock(String(messageId || ''), blockRef, text),
    deleteMessageBlock: (messageId: any, blockRef: any) => deleteMessageBlock(String(messageId || ''), blockRef),
    aiGenerateChatTitle: (roleId: any, chatId: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          showToast?.('AI 生成标题中…')
          return aiGenerateChatTitle(String(roleId || ''), String(chatId || ''))
        })
        .then((title: any) => {
	          const nextTitle = String((title as any)?.title || title || '').trim()
	          return reloadRoleSession(String(roleId || ''), String(chatId || ''))
	            .then(() => {
	              emit()
	              showToast?.(`已更新标题（${cost()}s）：${nextTitle || '（空）'}`, { kind: 'success' })
	              return title
	            })
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 生成标题失败')
          showToast?.(`AI 生成标题失败（${cost()}s）：${msg}`, { kind: 'error' })
          throw e
        })
    },
    aiGenerateGroupChatTitle: (groupId: any, chatId: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          showToast?.('AI 生成标题中…')
          return aiGenerateGroupChatTitle(String(groupId || ''), String(chatId || ''))
        })
        .then((title: any) => {
          showToast?.(`已更新标题（${cost()}s）：${globalThis.String(title || '').trim() || '（空）'}`, { kind: 'success' })
          return title
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 生成标题失败')
          showToast?.(`AI 生成标题失败（${cost()}s）：${msg}`, { kind: 'error' })
          throw e
        })
    },
    aiGenerateWorkspaceChatTitle: (workspaceId: any, chatId: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      let roleId = ''
      return Promise.resolve()
        .then(async () => {
          const workspaceChat = await ensureWorkspaceChatLoaded(String(workspaceId || ''), String(chatId || ''))
          roleId = String((workspaceChat as any)?.roleId || '').trim()
          if (!roleId) throw new Error('工作区会话缺少角色，暂时无法生成标题')
          t0 = now()
          showToast?.('AI 生成标题中…')
          return { roleId, title: await aiGenerateChatTitle(roleId, globalThis.String(chatId || '')) }
        })
        .then(async ({ title }: any) => {
          await reloadWorkspaceSession(String(workspaceId || ''), String(chatId || ''), roleId)
          const nextTitle = String((title as any)?.title || title || '').trim()
          emit()
          showToast?.(`已更新标题（${cost()}s）：${nextTitle || '（空）'}`, { kind: 'success' })
          return title
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 生成标题失败')
          showToast?.(`AI 生成标题失败（${cost()}s）：${msg}`, { kind: 'error' })
          throw e
        })
    },
    aiGenerateStickerName: (categoryName: any, stickerName: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          showToast?.('AI 取名中…')
          return aiGenerateStickerName(String(categoryName || ''), String(stickerName || ''))
        })
        .then((name: any) => {
          const nextName = String((name as any)?.name || name || '').trim()
          return loadStickersFromSource().then(() => {
            emit()
            showToast?.(`已更新表情名（${cost()}s）：${nextName || '（空）'}`, { kind: 'success' })
            return name
          })
        })
        .catch((e: any) => {
          let msg = String(e?.message || e || 'AI 取名失败')
          if (msg.includes('sticker naming is disabled')) msg = '请先在“设置 > AI 微服务”中启用表情包取名服务'
          else if (msg.includes('model coordinate is required')) msg = '请先在“设置 > AI 微服务”中配置表情包取名的供应商和模型'
          showToast?.(`AI 取名失败（${cost()}s）：${msg}`, { kind: 'error' })
          throw e
        })
    },
  }
}
