// ai-chat (iframe sandbox) — patch / insert operations extracted from createController
import { now, uid, isHttpBaseUrl } from '../core/utils'
import {
  executeToolCallsOnServer,
  formatToolResponseBlock,
  mapParsedCallsToServerCalls,
  parseToolRequestCalls,
} from '@noelle-silva/eucli-aitoolcall-sdk'
import type { AiChatInternalGateway } from '../gateway/types'
import { splitChatKey, splitGroupChatKey } from '../domain/storageKeys'

const CHAT_DEFAULT_BRANCH_ID = 'main'

function normalizeBranchId(input: any) {
  let s = String(input || '').trim()
  if (!s) return CHAT_DEFAULT_BRANCH_ID
  if (s.length > 60) s = s.slice(0, 60).trim()
  s = s.replace(/[^a-zA-Z0-9._-]/g, '_')
  return s || CHAT_DEFAULT_BRANCH_ID
}

export function createPatchOperations(deps: {
  getState: () => any
  storage: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void> }
  aiGateway: AiChatInternalGateway
  loadSplitMeta: () => Promise<any>
  loadToolCallServerConfig: () => Promise<{ baseUrl: string; token: string; streamEnabled: boolean }>
  netRequest: (options: any) => any
  withChatWriteLock: (kind: any, targetId: any, chatId: any, fn: () => Promise<any>) => Promise<any>
  touchChatUpdatedAt: (rid: string, cid: string, ua: number) => Promise<void>
  touchGroupChatUpdatedAt: (gid: string, cid: string, ua: number) => Promise<void>
  writeChatUpdatedNotice: (targetKind: any, targetId: any, chatId: any, updatedAt: any) => Promise<void>
  chatHasPendingAssistantInBranch: (chat: any, bid: string, ex?: string) => boolean
  repairChatLinearBranching: (chat: any) => void
  emit: () => void
  save: () => Promise<void>
  sendChat?: (opts?: any) => Promise<void>
}) {
  const {
    storage,
    aiGateway,
    loadSplitMeta,
    loadToolCallServerConfig,
    netRequest,
    withChatWriteLock,
    touchChatUpdatedAt,
    touchGroupChatUpdatedAt,
    writeChatUpdatedNotice,
    chatHasPendingAssistantInBranch,
    repairChatLinearBranching,
  } = deps

  async function submitChatCompletion(input: any) {
    const kind = String(input?.target?.kind || '').trim() === 'group' ? 'group' : 'role'
    if (kind === 'group') return aiGateway.submitGroupChatCompletion(input)
    return aiGateway.submitRoleChatCompletion(input)
  }

  async function patchAssistantMessage(job: any, content: string) {
    const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
    const roleId = String(job?.roleId || '')
    const groupId = String((job as any)?.groupId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(job?.assistantMid || '')
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

      if (m.pending !== true) return

      m.content = String(content || '')
      m.pending = false
      m.streaming = false
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

  async function insertMessagesAfterMessageId(job: any, afterMid: string, items: any[]) {
    const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
    const roleId = String(job?.roleId || '')
    const groupId = String((job as any)?.groupId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(afterMid || '').trim()
    if (!roleId || !chatId || !mid || (kind === 'group' && !groupId))
      return { ok: false as const, insertedAssistant: false as const }

    const list = Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : []
    if (!list.length) return { ok: false as const, insertedAssistant: false as const }

    const meta = await loadSplitMeta()
    if (!meta) return { ok: false as const, insertedAssistant: false as const }

    const folder =
      kind === 'group'
        ? String((meta as any).groupFolders?.[groupId] || '')
        : String((meta as any).roleFolders?.[roleId] || '')
    if (!folder) return { ok: false as const, insertedAssistant: false as const }
    const key = kind === 'group' ? splitGroupChatKey(folder, chatId) : splitChatKey(folder, chatId)

    const targetId = kind === 'group' ? groupId : roleId
    return withChatWriteLock(kind, targetId, chatId, async () => {
      const raw = await storage.get(key)
      const chat = raw && typeof raw === 'object' ? raw : null
      if (!chat) return { ok: false as const, insertedAssistant: false as const }

      const msgs = Array.isArray(chat.messages) ? chat.messages : []
      const idx = msgs.findIndex((x: any) => String(x?.id || '') === mid)
      if (idx < 0) return { ok: false as const, insertedAssistant: false as const }

      const afterMsg = msgs[idx] && typeof msgs[idx] === 'object' ? msgs[idx] : null
      const desiredBranchId = normalizeBranchId(
        (afterMsg as any)?.branchId || (job as any)?.branchId || CHAT_DEFAULT_BRANCH_ID,
      )

      const hasPendingAssistant = chatHasPendingAssistantInBranch(chat, desiredBranchId)
      const toInsert = hasPendingAssistant
        ? list.filter((m) => String(m?.role || '') !== 'assistant')
        : list
      if (!toInsert.length) return { ok: false as const, insertedAssistant: false as const }

      let parentMid = mid
      for (const m of toInsert) {
        if (!m || typeof m !== 'object') continue
        if (!String((m as any).id || '').trim()) (m as any).id = uid('m')
        if (!String((m as any).branchId || '').trim()) (m as any).branchId = desiredBranchId
        if (!String((m as any).parentMid || '').trim()) (m as any).parentMid = parentMid
        parentMid = String((m as any).id || '').trim()
      }

      const next = msgs.slice()
      next.splice(idx + 1, 0, ...toInsert)
      chat.messages = next
      chat.updatedAt = now()
      repairChatLinearBranching(chat)

      await storage.set(key, chat)

      try {
        if (kind === 'group') await touchGroupChatUpdatedAt(groupId, chatId, chat.updatedAt)
        else await touchChatUpdatedAt(roleId, chatId, chat.updatedAt)
      } catch (_) {}

      await writeChatUpdatedNotice(kind, kind === 'group' ? groupId : roleId, chatId, chat.updatedAt)

      return {
        ok: true as const,
        insertedAssistant:
          !hasPendingAssistant && toInsert.some((m) => String(m?.role || '') === 'assistant'),
      }
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
      cutoffMid: assistantMid,
      stream: !!run?.stream,
    }

    try {
      await patchAssistantMessage(jobLike, text)
    } catch (_) {}

    if (String(run?.status || '') === 'succeeded') {
      try {
        const parsed = parseToolRequestCalls(text)
        const calls = mapParsedCallsToServerCalls(parsed.calls)
        if (parsed.ok && Array.isArray(calls) && calls.length) {
          ;(async () => {
            const buildFailureResults = (items: any[], msg: any, status: any) => {
              const list = Array.isArray(items) ? items : []
              const error = String(msg || 'tool call failed')
              const s = String(status || 'failed') || 'failed'
              if (!list.length) return [{ tool_name: '', status: s, error }]
              return list.map((c) => ({
                tool_name: String((c as any)?.tool_name || ''),
                status: s,
                error,
              }))
            }

            let baseUrl = ''
            let token = ''
            let streamEnabled = !!run?.stream
            try {
              const cfg = await loadToolCallServerConfig()
              baseUrl = cfg.baseUrl
              token = cfg.token
              streamEnabled = !!cfg.streamEnabled
            } catch (_) {}

            let results: any[] = []
            if (!baseUrl || !isHttpBaseUrl(baseUrl)) {
              results = buildFailureResults(calls, '工具服务未配置或 Base URL 无效（需 http/https）', 'failed')
            } else {
              try {
                const resp = await executeToolCallsOnServer({
                  request: (x: any) => netRequest(x as any) as any,
                  server: { baseUrl, token },
                  body: { timeout_ms: 30000, calls },
                })
                const box = (resp as any)?.json
                results = Array.isArray(box?.results) ? box.results : []
              } catch (e) {
                const msg = String((e as any)?.message || e || 'tool server request failed')
                results = buildFailureResults(calls, msg, 'failed')
              }
            }

            if (!Array.isArray(results) || !results.length) {
              results = buildFailureResults(calls, '工具调用失败（未知原因）', 'failed')
            }

            const toolResponseText = formatToolResponseBlock(results as any)
            const toolMid = uid('m')

            const insertedTool = await insertMessagesAfterMessageId(jobLike, assistantMid, [
              { id: toolMid, role: 'user', content: toolResponseText, createdAt: now() },
            ])
            if (!insertedTool.ok) return

            const assistantMid2 = uid('m')
            const insertedAssistant = await insertMessagesAfterMessageId(jobLike, toolMid, [
              {
                id: assistantMid2,
                role: 'assistant',
                content: '（生成中…）',
                pending: true,
                streaming: !!streamEnabled,
                createdAt: now(),
                speakerRoleId: kind === 'group' ? roleId : undefined,
              },
            ])
            if (!insertedAssistant.ok || !insertedAssistant.insertedAssistant) return

            const jobStub2: any = {
              kind: 'openai.chat.completions',
              targetKind: kind === 'group' ? 'group' : undefined,
              groupId: kind === 'group' ? groupId : undefined,
              roleId,
              chatId,
              assistantMid: assistantMid2,
              cutoffMid: assistantMid2,
              branchId,
              stream: !!streamEnabled,
            }

            await submitChatCompletion({
              target: {
                kind: kind === 'group' ? 'group' : 'role',
                groupId: kind === 'group' ? groupId : undefined,
                roleId,
                chatId,
                branchId,
                assistantMid: assistantMid2,
              } as any,
              stream: !!streamEnabled,
              jobStub: jobStub2,
            })
          })().catch(() => {})
        }
      } catch (_) {}
    }
  }

  return {
    patchAssistantMessage,
    insertMessagesAfterMessageId,
    onAssistantRunFinal,
    submitChatCompletion,
  }
}
