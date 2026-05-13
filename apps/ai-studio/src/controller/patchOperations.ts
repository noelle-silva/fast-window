// AI Studio patch / insert operations extracted from the controller.
import { now } from '../core/utils'
import { splitChatKey, splitGroupChatKey } from '../domain/storageKeys'
import {
  finishAssistantRun,
  isAssistantGenerating,
} from '../domain/assistantRunState'

export function createPatchOperations(deps: {
  getState: () => any
  storage: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void> }
  loadSplitMeta: () => Promise<any>
  withChatWriteLock: (kind: any, targetId: any, chatId: any, fn: () => Promise<any>) => Promise<any>
  touchChatUpdatedAt: (rid: string, cid: string, ua: number) => Promise<void>
  touchGroupChatUpdatedAt: (gid: string, cid: string, ua: number) => Promise<void>
  writeChatUpdatedNotice: (targetKind: any, targetId: any, chatId: any, updatedAt: any) => Promise<void>
  repairChatLinearBranching: (chat: any) => void
}) {
  const {
    storage,
    loadSplitMeta,
    withChatWriteLock,
    touchChatUpdatedAt,
    touchGroupChatUpdatedAt,
    writeChatUpdatedNotice,
    repairChatLinearBranching,
  } = deps

  async function patchAssistantMessage(job: any, content: string) {
    const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
    const roleId = String(job?.roleId || '')
    const groupId = String((job as any)?.groupId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(job?.assistantMid || '')
    const generationId = String(job?.generationId || '').trim()
    if (!roleId || !chatId || !mid || (kind === 'group' && !groupId)) return

    const meta = await loadSplitMeta()
    if (!meta) return

    const folder =
      kind === 'group'
        ? String((meta as any).groupFolders?.[groupId] || '')
        : String((meta as any).roleFolders?.[roleId] || '')
    if (!folder) return
    const key = kind === 'group' ? splitGroupChatKey(folder, chatId) : splitChatKey(folder, chatId)

    const targetId = kind === 'group' ? groupId : roleId
    await withChatWriteLock(kind, targetId, chatId, async () => {
      const raw = await storage.get(key)
      const chat = raw && typeof raw === 'object' ? raw : null
      if (!chat) return

      const msgs = Array.isArray(chat.messages) ? chat.messages : []
      const m = msgs.find((x: any) => String(x?.id) === mid)
      if (!m) return

      const messageGenerationId = String(m?.assistantRun?.generationId || '').trim()
      if (!isAssistantGenerating(m) || !generationId || messageGenerationId !== generationId) return

      finishAssistantRun(m, String(content || ''), String(job?.status || '') === 'failed' ? 'failed' : String(job?.status || '') === 'canceled' ? 'canceled' : 'succeeded', now())
      chat.updatedAt = now()
      repairChatLinearBranching(chat)

      await storage.set(key, chat)

      try {
        if (kind === 'group') await touchGroupChatUpdatedAt(groupId, chatId, chat.updatedAt)
        else await touchChatUpdatedAt(roleId, chatId, chat.updatedAt)
      } catch (_) {}

      await writeChatUpdatedNotice(kind, kind === 'group' ? groupId : roleId, chatId, chat.updatedAt)
    })
  }

  async function onAssistantRunFinal(run: any, finalText: string) {
    if (String(run?.target?.tag || '').trim() === 'service') return

    const kind = String(run?.target?.kind || '').trim() === 'group' ? 'group' : 'role'
    const roleId = String(run?.target?.roleId || '').trim()
    const groupId = String(run?.target?.groupId || '').trim()
    const chatId = String(run?.target?.chatId || '').trim()
    const branchId = String(run?.target?.branchId || '').trim()
    const assistantMid = String(run?.target?.assistantMid || '').trim()
    const generationId = String(run?.target?.generationId || '').trim()
    const text = String(finalText || '')
    if (!roleId || !chatId || !assistantMid || (kind === 'group' && !groupId)) return

    const jobLike: any = {
      kind: 'openai.chat.completions',
      targetKind: kind === 'group' ? 'group' : undefined,
      groupId: kind === 'group' ? groupId : undefined,
      roleId,
      chatId,
      branchId,
      assistantMid,
      generationId,
      cutoffMid: assistantMid,
      stream: !!run?.stream,
      status: String(run?.status || ''),
    }

    try {
      await patchAssistantMessage(jobLike, text)
    } catch (_) {}
  }

  return {
    onAssistantRunFinal,
  }
}
