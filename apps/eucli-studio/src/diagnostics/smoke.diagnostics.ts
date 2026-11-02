// 客户端内置核心冒烟（smoke）诊断。
//
// 命名约定与 session 域一致：
//   - 文件：src/diagnostics/smoke.diagnostics.ts
//   - 安装：installSmokeDiagnostics
//   - 全局：__eucliStudioDiagnostics.smoke.run()
//   - 随包发布，不做构建排除；安装后无副作用。
//
// 它驱动真实控制器执行核心链路：新建发送、连续多轮、切换会话、
// 重新回答分叉、从旧节点继续、删除会话；群聊与断线重连按当前环境
// 是否存在可操作目标决定执行或明确跳过。

import { EUCLI_STUDIO_DIAGNOSTICS_KEY } from '../runtime/eucliStudioGlobals'

export type SmokeDiagnosticsDeps = {
  controller: any
  directClient: {
    invoke: (method: string, params?: unknown, options?: { timeoutMs?: number }) => Promise<any>
  }
}

type StepResult = {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  detail: string
}

export type SmokeRunResult = {
  ok: boolean
  marker: string
  startedAt: number
  finishedAt: number
  steps: StepResult[]
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check: () => boolean, timeoutMs: number, reason: string): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutMs)
  while (Date.now() < deadline) {
    if (check()) return
    await delay(50)
  }
  throw new Error(reason)
}

export function installSmokeDiagnostics(deps: SmokeDiagnosticsDeps) {
  const { controller, directClient } = deps

  function state() {
    return controller.getState?.() || {}
  }

  function box() {
    const s = state()
    const kind = text(s.draft?.activeTargetKind || s.data?.ui?.activeTargetKind || 'role')
    const roleId = text(s.draft?.activeRoleId || s.data?.ui?.activeRoleId)
    const groupId = text(s.draft?.activeGroupId || s.data?.ui?.activeGroupId)
    if (kind === 'group') return { box: s.data?.chatsByGroup?.[groupId] || null, roleId, groupId, kind }
    return { box: s.data?.chatsByRole?.[roleId] || null, roleId, groupId: '', kind: 'role' }
  }

  function activeChat() {
    const { box: current } = box()
    const chatId = text(current?.activeChatId)
    const chats = Array.isArray(current?.chats) ? current.chats : []
    return chats.find((chat: any) => text(chat?.id) === chatId) || null
  }

  function branchCount(chat: any) {
    return Array.isArray(chat?.branching?.branches) ? chat.branching.branches.length : 0
  }

  function messageCount(chat: any) {
    return Array.isArray(chat?.messages) ? chat.messages.length : 0
  }

  function findLastAssistantMid(chat: any) {
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (text(messages[i]?.role) === 'assistant') return text(messages[i]?.id)
    }
    return ''
  }

  function findFirstUserMid(chat: any) {
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    const first = messages.find((message: any) => text(message?.role) === 'user')
    return text(first?.id)
  }

  async function run(): Promise<SmokeRunResult> {
    const startedAt = Date.now()
    const marker = `smoke-${startedAt}`
    const steps: StepResult[] = []
    let createdChatId = ''

    await waitFor(() => {
      const s = state()
      return !!s?.data && !!text(s?.draft?.activeRoleId || s?.data?.ui?.activeRoleId)
    }, 10000, '应用尚未就绪：没有可用角色')

    const record = (name: string, status: StepResult['status'], detail: string) => {
      steps.push({ name, status, detail })
    }
    const runStep = async (name: string, work: () => Promise<string>) => {
      try {
        const detail = await work()
        record(name, 'passed', detail)
      } catch (error) {
        record(name, 'failed', String((error as any)?.message || error || '失败'))
      }
    }

    await runStep('新建会话并发送', async () => {
      controller.actions?.createChat?.()
      await delay(100)
      controller.actions?.setDraft?.('input', `${marker} 第一条，只回复 OK`)
      await controller.actions?.send?.()
      let matched: any = null
      await waitFor(() => {
        const chats = Array.isArray(box().box?.chats) ? box().box.chats : []
        matched = chats.find((chat: any) => {
          if (text(chat?.title).includes(marker)) return true
          const messages = Array.isArray(chat?.messages) ? chat.messages : []
          return messages.some((message: any) => text(message?.content).includes(marker))
        }) || null
        return !!matched
      }, 5000, '发送后找不到带标记的新会话')
      createdChatId = text(matched?.id)
      controller.actions?.setActiveChat?.(createdChatId)
      await waitFor(() => text(box().box?.activeChatId) === createdChatId, 5000, '新会话没有成为当前选中')
      return `chatId=${createdChatId}`
    })

    await runStep('连续多轮', async () => {
      const chatBefore = activeChat()
      const beforeCount = messageCount(chatBefore)
      controller.actions?.setDraft?.('input', `${marker} 第二条，只回复 OK`)
      await controller.actions?.send?.()
      const after = activeChat()
      const afterCount = messageCount(after)
      if (afterCount <= beforeCount) throw new Error(`消息数未增长：${beforeCount} -> ${afterCount}`)
      return `messages=${beforeCount} -> ${afterCount}`
    })

    await runStep('切换会话', async () => {
      const { box: current, roleId } = box()
      const currentId = text(current?.activeChatId)
      const other = (Array.isArray(current?.chatMetas) ? current.chatMetas : [])
        .map((meta: any) => text(meta?.id))
        .find((id: string) => id && id !== currentId) || ''
      if (!other) throw new Error('没有第二条会话可切换')
      controller.actions?.setActiveChat?.(other)
      await waitFor(() => text(box().box?.activeChatId) === other, 5000, '切换会话未生效')
      controller.actions?.setActiveChat?.(currentId)
      await waitFor(() => text(box().box?.activeChatId) === currentId, 5000, '切回原会话未生效')
      return `${currentId} -> ${other} -> ${currentId}`
    })

    await runStep('重新回答（分叉）', async () => {
      const chat = activeChat()
      const mid = findLastAssistantMid(chat)
      if (!mid) throw new Error('找不到可重新回答的 AI 消息')
      const before = messageCount(chat)
      const beforeBranches = branchCount(chat)
      await controller.actions?.regenerateAssistant?.(mid)
      const after = activeChat()
      const afterCount = messageCount(after)
      if (afterCount <= before) throw new Error(`消息数未增长：${before} -> ${afterCount}`)
      return `messages=${before} -> ${afterCount}, branches=${beforeBranches} -> ${branchCount(after)}`
    })

    await runStep('从旧节点继续', async () => {
      const chat = activeChat()
      const mid = findFirstUserMid(chat)
      if (!mid) throw new Error('找不到可继续的用户消息')
      const before = messageCount(chat)
      await controller.actions?.replyFromUserMessage?.(mid)
      const after = activeChat()
      const afterCount = messageCount(after)
      if (afterCount <= before) throw new Error(`消息数未增长：${before} -> ${afterCount}`)
      return `messages=${before} -> ${afterCount}`
    })

    await runStep('删除会话', async () => {
      const { roleId } = box()
      if (!createdChatId) throw new Error('没有可删除的测试会话')
      controller.actions?.deleteChat?.(roleId, createdChatId)
      await waitFor(() => {
        const current = box().box
        const chats = Array.isArray(current?.chats) ? current.chats : []
        const metas = Array.isArray(current?.chatMetas) ? current.chatMetas : []
        return !chats.some((chat: any) => text(chat?.id) === createdChatId)
          && !metas.some((meta: any) => text(meta?.id) === createdChatId)
      }, 5000, '测试会话没有从列表移除')
      return `deleted=${createdChatId}`
    })

    await runStep('断线重连', async () => {
      const client = directClient as any
      const before = client.ws
      if (!before) throw new Error('当前没有可断开的 WebSocket 连接')
      if (typeof client.markDisconnected === 'function') client.markDisconnected(before, '诊断强制重连')
      else before.close()
      await waitFor(() => !!client.ws && client.ws !== before && client.ws.readyState === 1, 10000, '重连超时')
      await directClient.invoke('aiChat.healthCheck', {})
      return 'WebSocket 已断开并重连，握手成功'
    })

    record('群聊', 'skipped', '该功能后续退役，不再纳入冒烟')

    const ok = steps.every((step) => step.status !== 'failed')
    return { ok, marker, startedAt, finishedAt: Date.now(), steps }
  }

  const diagnostics = { run }
  const root = ((window as any)[EUCLI_STUDIO_DIAGNOSTICS_KEY] ||= {}) as Record<string, any>
  root.smoke = diagnostics
  return diagnostics
}
