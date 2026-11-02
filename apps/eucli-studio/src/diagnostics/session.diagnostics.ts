// 客户端内置诊断入口（session 域）。
//
// 命名约定：
//   - 目录：src/diagnostics/
//   - 文件：<domain>.diagnostics.ts
//   - 安装：install<Domain>Diagnostics
//   - 全局：__eucliStudioDiagnostics.<domain>.<command>
//   - 随包发布，不做构建排除；安装后无副作用，只有显式调用才工作。
//
// 目的：在真实运行实例里制造可控的竞态，例如挂起一次会话正文响应，
// 在响应落地前删除会话，再放行，验证旧响应不会把已删除的会话写回来。
//
// 用法（浏览器控制台）：
//   __eucliStudioDiagnostics.session.heldCount()
//   await __eucliStudioDiagnostics.session.runDeleteRace({ chatId, roleId? })

import { EUCLI_STUDIO_DIAGNOSTICS_KEY } from '../runtime/eucliStudioGlobals'

export type SessionDiagnosticsDeps = {
  controller: any
  directClient: {
    invoke: (method: string, params?: unknown, options?: { timeoutMs?: number }) => Promise<any>
  }
}

type HeldResponse = {
  active: boolean
  held: number
  markHeld: () => void
  heldPromise: Promise<void>
  releases: Array<() => void>
}

export type DeleteRaceResult = {
  ok: boolean
  chatId: string
  activeChatId: string
  stillInChats: boolean
  stillInMetas: boolean
  heldReleased: number
  reason: string
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), Math.max(1, ms))
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function isSessionBodyMethod(methodRaw: unknown) {
  const method = text(methodRaw)
  return method.endsWith('session.window') || (method.endsWith('session.get') && !method.endsWith('sessionIndex.get'))
}

// 后端可能走 session.window，也可能走迁移期的 storage.get。
// 统一按「返回值像不像一份会话正文」识别，避免诊断依赖具体传输路径。
function looksLikeSessionBody(result: unknown) {
  const value = result as any
  return !!value && typeof value === 'object' && (
    Array.isArray(value.messages)
    || Array.isArray(value?.page?.messages)
    || Array.isArray(value?.value?.messages)
  )
}

export function installSessionDiagnostics(deps: SessionDiagnosticsDeps) {
  const { controller, directClient } = deps
  const holds: HeldResponse[] = []

  function armHold(): HeldResponse {
    let markHeld!: () => void
    const heldPromise = new Promise<void>((resolve) => {
      markHeld = resolve
    })
    const hold: HeldResponse = {
      active: true,
      held: 0,
      markHeld,
      heldPromise,
      releases: [],
    }
    holds.push(hold)
    return hold
  }

  function releaseHold(hold: HeldResponse | null | undefined) {
    if (!hold) return 0
    const releases = hold.releases.splice(0)
    for (const release of releases) release()
    return releases.length
  }

  function releaseAll() {
    return holds.reduce((sum, hold) => sum + releaseHold(hold), 0)
  }

  function heldCount() {
    return holds.reduce((sum, hold) => sum + hold.releases.length, 0)
  }

  const originalInvoke = directClient.invoke.bind(directClient)
  directClient.invoke = async (method, params, options) => {
    const result = await originalInvoke(method, params, options)
    const hold = holds.find((item) => item.active && (isSessionBodyMethod(method) || looksLikeSessionBody(result)))
    if (!hold) return result
    // 一次挂起只拦第一份正文：后续切换/删除请求照常通过。
    hold.active = false
    hold.held += 1
    hold.markHeld()
    await new Promise<void>((resolve) => {
      hold.releases.push(resolve)
    })
    return result
  }

  function readBox(roleId: string) {
    const state = controller.getState?.() || {}
    return state?.data?.chatsByRole?.[roleId] || null
  }

  // runDeleteRace 在真实实例里执行：
  //   1. 挂起目标会话的下一次正文响应；
  //   2. 切到目标会话，让正文请求真正发出并停在半路；
  //   3. 删除该会话；
  //   4. 放行旧响应；
  //   5. 检查会话没有被写回、选中也没有复活。
  async function runDeleteRace(input: { chatId?: unknown; roleId?: unknown; timeoutMs?: unknown } = {}): Promise<DeleteRaceResult> {
    const roleId = text(input.roleId) || text(controller.activeRole?.()?.id)
    const chatId = text(input.chatId)
    const timeoutMs = Math.max(500, Math.min(15000, Number(input.timeoutMs) || 5000))
    const base: DeleteRaceResult = {
      ok: false,
      chatId,
      activeChatId: '',
      stillInChats: false,
      stillInMetas: false,
      heldReleased: 0,
      reason: '',
    }
    if (!roleId || !chatId) return { ...base, reason: '需要 roleId 与 chatId' }
    const boxBefore = readBox(roleId)
    if (!boxBefore) return { ...base, reason: '角色数据盒不存在' }
    const exists = (box: any) => {
      const chats = Array.isArray(box?.chats) ? box.chats : []
      const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
      return {
        chats: chats.some((chat: any) => text(chat?.id) === chatId),
        metas: metas.some((meta: any) => text(meta?.id) === chatId),
      }
    }
    const before = exists(boxBefore)
    if (!before.chats && !before.metas) return { ...base, reason: '目标会话不在当前角色下' }

    const hold = armHold()
    controller.actions?.setActiveChat?.(chatId)
    try {
      await withTimeout(hold.heldPromise, timeoutMs, '等待正文响应挂起超时')
    } catch (error) {
      const released = releaseHold(hold)
      return { ...base, heldReleased: released, reason: String((error as any)?.message || error || '未挂起') }
    }

    controller.actions?.deleteChat?.(roleId, chatId)
    const released = releaseHold(hold)
    await delay(250)
    const boxAfter = readBox(roleId)
    const after = exists(boxAfter)
    const activeChatId = text(boxAfter?.activeChatId)
    const ok = !after.chats && !after.metas && activeChatId !== chatId
    return {
      ok,
      chatId,
      activeChatId,
      stillInChats: after.chats,
      stillInMetas: after.metas,
      heldReleased: released,
      reason: ok ? '旧正文未回填，会话未复活' : '检测到旧正文回填或选中复活',
    }
  }

  const diagnostics = {
    heldCount,
    releaseAll,
    armHold,
    runDeleteRace,
  }
  const root = ((window as any)[EUCLI_STUDIO_DIAGNOSTICS_KEY] ||= {}) as Record<string, any>
  root.session = diagnostics
  return diagnostics
}
