import { now } from '../core/utils'
import type { AiChatRuntimeStore } from './types'
import { lockPayload } from './keys'

export async function withRuntimeLock(opts: {
  store: AiChatRuntimeStore
  lockKey: string
  owner: string
  ttlMs?: number
  waitMs?: number
  deadlineMs?: number
  fn: () => Promise<any>
}) {
  const store = opts.store
  const lockKey = String(opts.lockKey || '').trim()
  const owner = String(opts.owner || '').trim()
  if (!lockKey) throw new Error('lockKey 不能为空')
  if (!owner) throw new Error('owner 不能为空')

  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : 1500
  const waitMs = typeof opts.waitMs === 'number' ? opts.waitMs : 40
  const deadline = now() + (typeof opts.deadlineMs === 'number' ? opts.deadlineMs : 5000)

  while (now() < deadline) {
    let cur: any = null
    try {
      cur = await store.get(lockKey)
    } catch (_) {}

    const exp = Number(cur?.expiresAt || 0)
    const curOwner = String(cur?.owner || '').trim()
    if (!cur || exp <= now() || curOwner === owner) {
      try {
        await store.set(lockKey, lockPayload(owner, ttlMs))
      } catch (_) {}
      try {
        const v: any = await store.get(lockKey)
        if (String(v?.owner || '').trim() === owner) break
      } catch (_) {}
    }

    await new Promise<void>((r) => setTimeout(r, Math.max(10, Math.floor(waitMs))))
  }

  try {
    return await opts.fn()
  } finally {
    try {
      const v: any = await store.get(lockKey)
      if (String(v?.owner || '').trim() === owner) await store.remove(lockKey)
    } catch (_) {}
  }
}

