import { now, uid } from '../core/utils'
import { UI_CHAT_UPDATED_NOTICE_KEY } from '../runtime/runtimeKeys'

export function createChatWriteLock(deps: {
  rtStorage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void>; remove: (k: string) => Promise<void> }
}) {
  const { rtStorage } = deps

  const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms || 0))))

  function chatWriteLockKey(kind: any, targetId: any, chatId: any) {
    const k = String(kind || '').trim() === 'g' ? 'g' : 'r'
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    return `lock.chat.${k}.${tid}.${cid}`
  }

  async function withChatWriteLock(kind: any, targetId: any, chatId: any, fn: any) {
    const k = String(kind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    if (!tid || !cid) return fn()

    const key = chatWriteLockKey(k, tid, cid)
    const owner = uid('lock')
    const deadline = now() + 8000

    while (now() < deadline) {
      let cur: any = null
      try {
        cur = await rtStorage.get(key)
      } catch (_) {}

      const exp = Number(cur?.expiresAt || 0)
      const curOwner = String(cur?.owner || '').trim()
      if (!cur || exp <= now() || curOwner === owner) {
        const nextExp = now() + 1800
        try {
          await rtStorage.set(key, { owner, expiresAt: nextExp })
        } catch (_) {}
        try {
          const v = await rtStorage.get(key)
          if (String(v?.owner || '').trim() === owner) break
        } catch (_) {}
      }

      await sleepMs(40 + Math.floor(Math.random() * 60))
    }

    try {
      return await fn()
    } finally {
      try {
        const v = await rtStorage.get(key)
        if (String(v?.owner || '').trim() === owner) await rtStorage.remove(key)
      } catch (_) {}
    }
  }

  async function writeChatUpdatedNotice(targetKind: any, targetId: any, chatId: any, updatedAt: any) {
    const kind = String(targetKind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    if (!tid || !cid) return
    const t = now()
    try {
      await rtStorage.set(UI_CHAT_UPDATED_NOTICE_KEY, {
        id: uid('n'),
        targetKind: kind,
        targetId: tid,
        chatId: cid,
        updatedAt: Number(updatedAt || 0),
        at: t,
      })
    } catch (_) {}
  }

  return { chatWriteLockKey, withChatWriteLock, writeChatUpdatedNotice }
}
