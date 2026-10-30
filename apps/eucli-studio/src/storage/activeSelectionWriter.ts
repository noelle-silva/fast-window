import type { ActiveChatCommandResult } from '../protocol/sessionSwitchProtocol'
import type { ProjectionScope } from './splitProjectionCache'
import { projectionScopeKey } from './splitProjectionCache'
import { beginSwitchSpan, type SwitchSpan } from '../domain/switchSpan'

// ActiveSelectionWriter（design-1 决策 1）：
//
//   activeChatId 是「用户选中了谁」，不是「索引变了」。
//   它必须从索引写路径里彻底剥离。
//
// 因此这里只发 {kind,targetId,chatId} 一个命令，而且：
//   1. 幂等：目标与已知一致时不发请求；
//   2. 按 scope 串行：同一 target 的连续点击严格有序，不会乱序覆盖；
//   3. 不写 meta/index、不写 chats/<folder>/index 的 chatIds/chatMetas；
//   4. 只推进 preferenceRevision，绝不触发业务数据重读；
//   5. 每次切换带一个 switchId，贯穿前端入口与后端 dispatch。
//
// 观测边界归属：
//   select / command   属于「发起」——由本模块上报；
//   bodyReady          属于「正文就绪」——由 ChatBodyLoader 上报；
//   painted / enhance* 属于「绘制」——由渲染侧上报；
//   settled            属于「可见页追平选中页」——由渲染侧在 painted 之后上报。
//
// 命令成功 ≠ 切换结束：如果在这里 settle，耗时统计会漏掉正文与绘制两段，
// 看到的永远是「命令往返」而不是用户实际等待的时间。

export type ActiveSelectionWriterDeps = {
  // 新接口：只推进偏好版本。
  setActiveChat: (scope: ProjectionScope, chatId: string, options?: { expectedRevision?: number; switchId?: string }) => Promise<ActiveChatCommandResult>
  // 迁移垫片：后端还没有 setActiveChat 时，写「只有 activeChatId」的最小索引。
  writeLegacySelection?: (scope: ProjectionScope, chatId: string) => Promise<void>
  hasCommand: () => boolean
  // 本地缓存同步：命令成功后只改偏好那一格，索引数据事实保持不变。
  applyLocalSelection: (scope: ProjectionScope, chatId: string) => void
  onError?: (message: string) => void
}

export type ActiveSelectionWriter = {
  select: (scope: ProjectionScope, chatId: string) => Promise<boolean>
  pendingCount: () => number
  flush: () => Promise<void>
  // 最近一次切换的观测句柄：上层在正文就绪时补 bodyReady。
  lastSpan: () => SwitchSpan | null
}

export function createActiveSelectionWriter(deps: ActiveSelectionWriterDeps): ActiveSelectionWriter {
  // 每个 scope 一条串行链：同 target 的命令严格 FIFO，不同 target 互不阻塞。
  const chains = new Map<string, Promise<void>>()
  const lastApplied = new Map<string, string>()
  let pending = 0
  let currentSpan: SwitchSpan | null = null

  function enqueue(key: string, work: () => Promise<void>): Promise<void> {
    const previous = chains.get(key) || Promise.resolve()
    const next = previous.then(work, work)
    const tracked = next.finally(() => {
      if (chains.get(key) === tracked) chains.delete(key)
    })
    chains.set(key, tracked)
    return tracked
  }

  async function select(scope: ProjectionScope, chatIdRaw: string): Promise<boolean> {
    const targetId = String(scope.targetId || '').trim()
    if (!targetId) return false
    const chatId = String(chatIdRaw || '').trim()
    const key = projectionScopeKey(scope)
    // 幂等：已知目标一致就不再发请求（连点同一项不该产生任何流量）。
    if (lastApplied.get(key) === chatId) return true

    const span = beginSwitchSpan(`${key}:${chatId}`)
    currentSpan = span
    span.mark('frontend.select')

    pending += 1
    try {
      await enqueue(key, async () => {
        if (lastApplied.get(key) === chatId) return
        if (deps.hasCommand()) {
          span.mark('frontend.command')
          await deps.setActiveChat(scope, chatId, { switchId: span.switchId })
        } else if (deps.writeLegacySelection) {
          span.mark('frontend.command')
          await deps.writeLegacySelection(scope, chatId)
        } else {
          throw new Error('当前后端不支持切换会话偏好')
        }
        lastApplied.set(key, chatId)
        deps.applyLocalSelection(scope, chatId)
      })
      // 这里绝不 settle：命令成功只代表偏好已写入，
      // 正文就绪与首屏绘制仍在后面，settled 由渲染侧在 painted 之后上报。
      return true
    } catch (error: any) {
      deps.onError?.(String(error?.message || error || '切换会话失败'))
      span.fail(String(error?.message || error || '切换会话失败'))
      return false
    } finally {
      pending -= 1
    }
  }

  async function flush() {
    await Promise.all([...chains.values()])
  }

  return {
    select,
    pendingCount: () => pending,
    flush,
    lastSpan: () => currentSpan,
  }
}
