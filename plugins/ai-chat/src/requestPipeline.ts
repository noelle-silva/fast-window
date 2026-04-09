import type { AiChatRuntimeStore } from './engine'

export type AiChatRunKind = 'role' | 'group'

export type AiChatRunTarget = {
  kind: AiChatRunKind
  roleId: string
  groupId?: string
  chatId: string
  branchId: string
  assistantMid: string
}

export type AiChatRunSpec = {
  target: AiChatRunTarget
  stream: boolean
  jobStub: any
}

export function createAiChatRequestPipeline(opts: {
  store: AiChatRuntimeStore
  streamKey: (assistantMid: string) => string
  finalKey: (assistantMid: string) => string
  bridge: {
    enqueue: (spec: { target: any; req: any; stream: boolean }) => Promise<string>
  }
  buildRoleReqFromStorage: (jobStub: any) => Promise<any>
  buildGroupReqFromStorage: (jobStub: any) => Promise<any>
}) {
  const store = opts.store

  async function resetAssistantRuntime(assistantMid: string) {
    const mid = String(assistantMid || '').trim()
    if (!mid) return
    try {
      await store.remove(opts.streamKey(mid))
    } catch (_) {}
    try {
      await store.remove(opts.finalKey(mid))
    } catch (_) {}
  }

  async function enqueueOne(spec: AiChatRunSpec) {
    const target = spec && typeof spec === 'object' ? spec.target : null
    const mid = String(target?.assistantMid || '').trim()
    if (!target) throw new Error('enqueueOne: target 缺失')
    if (!mid) throw new Error('enqueueOne: assistantMid 不能为空')

    await resetAssistantRuntime(mid)

    const kind: AiChatRunKind = target.kind === 'group' ? 'group' : 'role'
    const jobStub = spec.jobStub
    const req =
      kind === 'group' ? await opts.buildGroupReqFromStorage(jobStub) : await opts.buildRoleReqFromStorage(jobStub)

    await opts.bridge.enqueue({
      target: {
        kind,
        groupId: kind === 'group' ? String(target.groupId || '') : undefined,
        roleId: String(target.roleId || ''),
        chatId: String(target.chatId || ''),
        branchId: String(target.branchId || ''),
        assistantMid: mid,
      } as any,
      req,
      stream: !!spec.stream,
    })
  }

  async function enqueueMany(specs: AiChatRunSpec[]) {
    const list = Array.isArray(specs) ? specs.filter((x) => x && typeof x === 'object') : []
    for (const s of list) await enqueueOne(s)
  }

  return { resetAssistantRuntime, enqueueOne, enqueueMany }
}

