import { now } from '../core/utils'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from './types'
import { createAiChatRunStore } from './store'
import { newOwnerId, newRunId, runScopeKey, scopeLockKey } from './keys'
import { withRuntimeLock } from './lock'
import { createAiChatRunner } from './runner'

export function createAiChatEngine(opts: {
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  // 用于把“完成/失败/取消”映射到旧 UI/存档（转接层会实现）
  onProgress?: (run: AiChatRun, text: string) => Promise<void> | void
  onFinal?: (run: AiChatRun, finalText: string) => Promise<void> | void
}) {
  const store = opts.store
  const net = opts.net
  const owner = newOwnerId()
  const runs = createAiChatRunStore(store)
  const runner = createAiChatRunner({ store, net, owner, onProgress: opts.onProgress, onFinal: opts.onFinal })

  const running = new Set<string>()
  let ticking = false

  function targetScope(run: AiChatRun) {
    const kind = run.target?.kind === 'group' ? 'group' : 'role'
    const targetId = kind === 'group' ? String(run.target?.groupId || '') : String(run.target?.roleId || '')
    const chatId = String(run.target?.chatId || '')
    const branchId = String(run.target?.branchId || '')
    return runScopeKey({ kind, targetId, chatId, branchId })
  }

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

  async function tryClaim(run: AiChatRun) {
    const runId = String(run?.id || '').trim()
    if (!runId) return false
    if (running.has(runId)) return false

    const scopeKey = String(run.scopeKey || '').trim()
    const lockKey = String(run.scopeLockKey || '').trim()
    if (!scopeKey || !lockKey) return false

    // 互斥域：同 chat+branch 只允许一个 running（由 scope lock 兜底）。
    return withRuntimeLock({
      store,
      lockKey,
      owner,
      ttlMs: 2500,
      deadlineMs: 1200,
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
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const ids = await runs.listRunIds(200).catch(() => [])
      if (!ids.length) return

      // 简单策略：按 createdAt 升序跑（先到先服务）。
      const candidates: AiChatRun[] = []
      for (const id of ids) {
        const r = await runs.getRun(id)
        if (!r) continue
        if (r.status !== 'queued') continue
        candidates.push(r)
        if (candidates.length >= 50) break
      }
      candidates.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))

      for (const r of candidates) {
        const ok = await tryClaim(r).catch(() => false)
        if (!ok) continue

        const runId = r.id
        running.add(runId)
        runner
          .runWithScopeLock(runId)
          .catch(() => {})
          .finally(() => {
            running.delete(runId)
          })
      }
    } finally {
      ticking = false
    }
  }

  return { owner, enqueue, cancel, tick, targetScope }
}
