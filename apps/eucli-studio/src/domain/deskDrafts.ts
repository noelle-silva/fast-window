// 工作桌面的「临时条目」：按住 Ctrl 新建会话时，先在这里挂一条内存记录。
// 它只活在当前客户端进程里——后端根本还没有这条会话，写不进去也不该写。
// 会话真实建立（发送后拿到 chatId）时，把它转成正式引用写进后端桌面数据，同时从这里摘掉；
// 客户端重启后这里自然是空的，临时条目随之消失，这是预期行为。

export type DeskDraftTargetKind = 'role' | 'group' | 'workspace'

export type DeskDraft = {
  /** 草稿会话的客户端 id（draft-chat-…），用于和真实会话对应。 */
  pendingChatId: string
  targetKind: DeskDraftTargetKind
  targetId: string
  roleId: string
  title: string
  addedAt: number
  /** 在桌面上占的位置（合并列表里的序号），转正时按它插回原位。 */
  order: number
}

let drafts: DeskDraft[] = []
let version = 0
const listeners = new Set<() => void>()

function bump() {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeDeskDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDeskDraftsVersion(): number {
  return version
}

export function getDeskDrafts(): DeskDraft[] {
  return drafts.map((draft) => ({ ...draft }))
}

export function findDeskDraftByPending(pendingChatId: unknown): DeskDraft | null {
  const id = String(pendingChatId || '').trim()
  if (!id) return null
  const found = drafts.find((draft) => draft.pendingChatId === id)
  return found ? { ...found } : null
}

export function addDeskDraft(input: {
  pendingChatId: string
  targetKind: DeskDraftTargetKind
  targetId: string
  roleId?: string
  title?: string
}): DeskDraft | null {
  const pendingChatId = String(input.pendingChatId || '').trim()
  const targetId = String(input.targetId || '').trim()
  if (!pendingChatId || !targetId) return null
  if (drafts.some((draft) => draft.pendingChatId === pendingChatId)) return findDeskDraftByPending(pendingChatId)

  const kind: DeskDraftTargetKind =
    input.targetKind === 'group' ? 'group' : input.targetKind === 'workspace' ? 'workspace' : 'role'
  const roleId = kind === 'workspace' ? String(input.roleId || '').trim() : ''
  if (kind === 'workspace' && !roleId) return null

  const draft: DeskDraft = {
    pendingChatId,
    targetKind: kind,
    targetId,
    roleId,
    title: String(input.title || '').trim() || '新聊天',
    addedAt: Date.now(),
    order: drafts.length,
  }
  drafts = drafts.concat([draft])
  bump()
  return { ...draft }
}

export function removeDeskDraft(pendingChatId: unknown): DeskDraft | null {
  const id = String(pendingChatId || '').trim()
  if (!id) return null
  const found = drafts.find((draft) => draft.pendingChatId === id) || null
  if (!found) return null
  drafts = drafts.filter((draft) => draft.pendingChatId !== id)
  bump()
  return { ...found }
}

export function resetDeskDrafts(): void {
  if (!drafts.length) return
  drafts = []
  bump()
}
