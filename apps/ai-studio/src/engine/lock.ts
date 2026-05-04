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
  // 是否自动续租（默认 true）。
  keepAlive?: boolean
  // 续租间隔（默认 ttlMs*0.4）。
  keepAliveEveryMs?: number
  fn: () => Promise<any>
}) {
  const store = opts.store
  const lockKey = String(opts.lockKey || '').trim()
  const owner = String(opts.owner || '').trim()
  if (!lockKey) throw new Error('lockKey 不能为空')
  if (!owner) throw new Error('owner 不能为空')

  const ttlMsRaw = typeof opts.ttlMs === 'number' ? opts.ttlMs : 8000
  const ttlMs = Math.max(800, Math.min(60_000, Math.floor(ttlMsRaw || 0)))
  const waitMs = typeof opts.waitMs === 'number' ? opts.waitMs : 40
  const deadline = now() + (typeof opts.deadlineMs === 'number' ? opts.deadlineMs : 10_000)

  let acquired = false

  while (now() < deadline) {
    let cur: any = null
    try {
      cur = await store.get(lockKey)
    } catch (_) {}

    const exp = Number(cur?.expiresAt || 0)
    // 非重入锁：同 owner 不允许“再次占用”。需要并发，请用不同 owner。
    if (!cur || exp <= now()) {
      try {
        await store.set(lockKey, lockPayload(owner, ttlMs))
      } catch (_) {}
      try {
        const v: any = await store.get(lockKey)
        if (String(v?.owner || '').trim() === owner) {
          acquired = true
          break
        }
      } catch (_) {}
    }

    await new Promise<void>((r) => setTimeout(r, Math.max(10, Math.floor(waitMs))))
  }

  if (!acquired) throw new Error(`获取锁超时: ${lockKey}`)

  const keepAliveEnabled = opts.keepAlive !== false
  const keepAliveEveryMsRaw = typeof opts.keepAliveEveryMs === 'number' ? opts.keepAliveEveryMs : Math.floor(ttlMs * 0.4)
  const keepAliveEveryMs = Math.max(200, Math.min(ttlMs - 100, Math.floor(keepAliveEveryMsRaw || 0)))

  let timer: any = null
  let keepAliveBusy = false
  if (keepAliveEnabled && keepAliveEveryMs > 0) {
    timer = setInterval(() => {
      if (keepAliveBusy) return
      keepAliveBusy = true
      ;(async () => {
        try {
          const v: any = await store.get(lockKey)
          if (String(v?.owner || '').trim() !== owner) return
          await store.set(lockKey, lockPayload(owner, ttlMs))
        } catch (_) {
        } finally {
          keepAliveBusy = false
        }
      })().catch(() => {
        keepAliveBusy = false
      })
    }, keepAliveEveryMs)
  }

  try {
    return await opts.fn()
  } finally {
    try {
      if (timer) clearInterval(timer)
    } catch (_) {}
    try {
      const v: any = await store.get(lockKey)
      if (String(v?.owner || '').trim() === owner) await store.remove(lockKey)
    } catch (_) {}
  }
}

