import { now } from '../core/utils'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from './types'
import { createAiChatRunStore } from './store'
import { newOwnerId, newRunId, runScopeKey, scopeLockKey } from './keys'
import { withRuntimeLock } from './lock'
import { createAiChatRunner } from './runner'
import { wrapRuntimeStoreWithTimeout } from './storeTimeout'

export function createAiChatEngine(opts: {
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  // 用于把“完成/失败/取消”映射到旧 UI/存档（转接层会实现）
  onProgress?: (run: AiChatRun, text: string) => Promise<void> | void
  onFinal?: (run: AiChatRun, finalText: string) => Promise<void> | void
}) {
  const store = wrapRuntimeStoreWithTimeout(opts.store, { readMs: 2500, writeMs: 2500, listDirMs: 8000 })
  const net = opts.net
  const owner = newOwnerId()
  const runs = createAiChatRunStore(store)
  const runner = createAiChatRunner({ store, net, owner, onProgress: opts.onProgress, onFinal: opts.onFinal })

  const running = new Set<string>()
  const scopeBusy = new Set<string>()
  let ticking = false
  let enqueueSeq = 0

  async function enqueue(spec: {
    target: AiChatRun['target']
    req: AiChatRun['req']
    stream: boolean
  }) {
    const runId = newRunId()
    const t = now()
    const target = spec.target
    const req = spec.req
    const stream = !!spec.stream
    const kind = target?.kind === 'group' ? 'group' : 'role'
    const targetId = kind === 'group' ? String(target?.groupId || '') : String(target?.roleId || '')
    const chatId = String(target?.chatId || '')
    const branchId = String(target?.branchId || '')
    const assistantMid = String(target?.assistantMid || '')
    if (!targetId || !chatId || !branchId || !assistantMid) throw new Error('enqueue: target 参数不完整')
    if (!req || typeof req !== 'object') throw new Error('enqueue: req 无效')

    const scopeKey = runScopeKey({ kind, targetId, chatId, branchId })
    const scopeLock = scopeLockKey(scopeKey)

    const run: AiChatRun = {
      id: runId,
      status: 'queued',
      createdAt: t,
      order: t * 1024 + ((enqueueSeq++ % 1024) | 0),
      updatedAt: t,
      owner: '',
      scopeKey,
      scopeLockKey: scopeLock,
      stream,
      req,
      target: {
        kind,
        roleId: kind === 'role' ? String(target.roleId || '') : undefined,
        groupId: kind === 'group' ? String((target as any).groupId || '') : undefined,
        chatId,
        branchId,
        assistantMid,
        tag: String((target as any)?.tag || '').trim() === 'service' ? 'service' : undefined,
        service: String((target as any)?.service || '').trim() || undefined,
      },
    }

    await runs.setRun(run)
    return runId
  }

  async function cancel(runId: string) {
    const id = String(runId || '').trim()
    if (!id) return
    await runs.patchRun(id, { cancelRequestedAt: now() })
  }

  async function finalizeQueuedCanceled(run: AiChatRun) {
    const runId = String(run?.id || '').trim()
    if (!runId) return
    if (run.status !== 'queued') return
    if (!(typeof run.cancelRequestedAt === 'number' && run.cancelRequestedAt > 0)) return

    const t = now()
    try {
      await runs.patchRun(runId, { status: 'canceled', finishedAt: t })
    } catch (_) {}
    let text = '（已停止）'
    try {
      const p = await runs.getProgress(runId)
      const s = String(p?.text || '').trim()
      if (s) text = s
    } catch (_) {}
    try {
      if (opts.onFinal) await opts.onFinal({ ...(run as any), status: 'canceled' } as any, text)
    } catch (_) {}
    try {
      await runs.removeRun(runId)
    } catch (_) {}
  }

  async function tryClaim(run: AiChatRun) {
    const runId = String(run?.id || '').trim()
    if (!runId) return false
    if (running.has(runId)) return false

    const scopeKey = String(run.scopeKey || '').trim()
    const lockKey = String(run.scopeLockKey || '').trim()
    if (!scopeKey || !lockKey) return false

    // 互斥域：同 chat+branch 只允许一个 running（由 scope lock 兜底）。
    try {
      return await withRuntimeLock({
        store,
        lockKey,
        owner: `claim:${owner}:${runId}`,
        ttlMs: 6000,
        deadlineMs: 6000,
        keepAlive: false,
        fn: async () => {
          const cur = await runs.getRun(runId)
          if (!cur || cur.status !== 'queued') return false
          cur.status = 'running'
          cur.owner = owner
          cur.startedAt = now()
          cur.updatedAt = now()
          await runs.setRun(cur)
          return true
        },
      })
    } catch (_) {
      return false
    }
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const ids = await runs.listRunIds(200).catch(() => [])
      if (!ids.length) return

      const all: AiChatRun[] = []
      for (const id of ids) {
        const r = await runs.getRun(id)
        if (!r) continue
        all.push(r)
        // 兜底：宿主重启/后台崩溃后，遗留的 running run 会卡死在“生成中”。
        // 若 owner 与当前实例不一致，重新入队，让新的后台实例接管并收尾。
        if (r.status === 'running') {
          const prevOwner = String((r as any).owner || '').trim()
          if (prevOwner && prevOwner !== owner && !(r as any).finishedAt) {
            try {
              r.status = 'queued'
              ;(r as any).owner = ''
              try {
                delete (r as any).startedAt
              } catch (_) {}
              r.updatedAt = now()
              await runs.setRun(r)
            } catch (_) {}
          }
        }
      }

      // queued + cancelRequested：直接收尾，避免永远排队挂起。
      for (const r of all) {
        if (r.status === 'queued' && typeof (r as any).cancelRequestedAt === 'number' && (r as any).cancelRequestedAt > 0) {
          await finalizeQueuedCanceled(r).catch(() => {})
        }
      }

      const scopeHasRunning = new Set<string>()
      for (const r of all) {
        const sk = String(r?.scopeKey || '').trim()
        if (!sk) continue
        if (r.status === 'running') scopeHasRunning.add(sk)
      }

      // FIFO：每个 scope 只挑一个最早 queued。
      const chosenByScope = new Map<string, AiChatRun>()
      for (const r of all) {
        if (!r || r.status !== 'queued') continue
        const sk = String(r.scopeKey || '').trim()
        if (!sk) continue
        if (scopeBusy.has(sk) || scopeHasRunning.has(sk)) continue
        const prev = chosenByScope.get(sk) || null
        if (!prev) {
          chosenByScope.set(sk, r)
          continue
        }
        const ao = typeof r.order === 'number' && isFinite(r.order) ? r.order : Number(r.createdAt || 0)
        const bo = typeof prev.order === 'number' && isFinite(prev.order) ? prev.order : Number(prev.createdAt || 0)
        if (ao !== bo) {
          if (ao < bo) chosenByScope.set(sk, r)
          continue
        }
        const ac = Number(r.createdAt || 0)
        const bc = Number(prev.createdAt || 0)
        if (ac !== bc) {
          if (ac < bc) chosenByScope.set(sk, r)
          continue
        }
        if (String(r.id || '') < String(prev.id || '')) chosenByScope.set(sk, r)
      }

      const picked = Array.from(chosenByScope.values())
      picked.sort((a, b) => {
        const ao = typeof a.order === 'number' && isFinite(a.order) ? a.order : Number(a.createdAt || 0)
        const bo = typeof b.order === 'number' && isFinite(b.order) ? b.order : Number(b.createdAt || 0)
        if (ao !== bo) return ao - bo
        const ac = Number(a.createdAt || 0)
        const bc = Number(b.createdAt || 0)
        if (ac !== bc) return ac - bc
        return String(a.id || '').localeCompare(String(b.id || ''))
      })

      for (const r of picked.slice(0, 50)) {
        const sk = String(r.scopeKey || '').trim()
        if (!sk) continue
        if (scopeBusy.has(sk) || scopeHasRunning.has(sk)) continue
        const ok = await tryClaim(r).catch(() => false)
        if (!ok) continue

        const runId = r.id
        running.add(runId)
        scopeBusy.add(sk)
        runner
          .runWithScopeLock(runId)
          .catch(() => {})
          .finally(() => {
            running.delete(runId)
            scopeBusy.delete(sk)
          })
      }
    } finally {
      ticking = false
    }
  }

  return { owner, enqueue, cancel, tick }
}
