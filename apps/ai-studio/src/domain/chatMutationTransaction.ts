import type { ChatSaveIntent } from './chatSaveIntent'

type ChatMutationTransactionInput = {
  chat: any
  mutate: () => void | Promise<void>
  save: (intent?: ChatSaveIntent) => Promise<void>
  verify?: () => void | Promise<void>
  intent?: ChatSaveIntent
  onCommit?: () => void
  afterCommit?: () => void | Promise<void>
  onRollback?: () => void
}

type LocalChatMutationInput = Omit<ChatMutationTransactionInput, 'save' | 'intent' | 'verify'>

type ChatMutationLifecycleInput = {
  chat: any
  mutate: () => void | Promise<void>
  commit?: () => void | Promise<void>
  verify?: () => void | Promise<void>
  onCommit?: () => void
  afterCommit?: () => void | Promise<void>
  onRollback?: () => void
}

function clonePlain<T>(value: T): T {
  const clone = (globalThis as any)?.structuredClone
  if (typeof clone === 'function') return clone(value)
  return JSON.parse(JSON.stringify(value))
}

function restoreObject(target: any, snapshot: any) {
  if (!target || typeof target !== 'object' || !snapshot || typeof snapshot !== 'object') return
  for (const key of Object.keys(target)) {
    try {
      delete target[key]
    } catch (_) {}
  }
  Object.assign(target, clonePlain(snapshot))
}

async function runChatMutationLifecycle(input: ChatMutationLifecycleInput) {
  const chat = input.chat && typeof input.chat === 'object' ? input.chat : null
  if (!chat) throw new Error('会话不存在')

  const snapshot = clonePlain(chat)
  try {
    await input.mutate()
    await input.commit?.()
    await input.verify?.()
  } catch (e) {
    restoreObject(chat, snapshot)
    input.onRollback?.()
    throw e
  }

  input.onCommit?.()
  // Post-commit work is outside rollback because the chat mutation has already been accepted.
  await input.afterCommit?.()
}

export async function runChatMutationTransaction(input: ChatMutationTransactionInput) {
  await runChatMutationLifecycle({
    chat: input.chat,
    mutate: input.mutate,
    commit: () => input.save(input.intent),
    verify: input.verify,
    onCommit: input.onCommit,
    afterCommit: input.afterCommit,
    onRollback: input.onRollback,
  })
}

export async function runLocalChatMutation(input: LocalChatMutationInput) {
  await runChatMutationLifecycle(input)
}
