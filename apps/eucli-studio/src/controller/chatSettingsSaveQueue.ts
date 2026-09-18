// 会话级设置保存队列：按目标（kind+targetId+sessionId）串行执行，
// 同目标同动作同值去重，不同目标互不干扰；状态只在业务端确认后的 work 回调里写回。
import type { ChatSettingsTarget } from './chatSessionTarget'
import { chatSettingsTargetKey } from './chatSessionTarget'

export type ChatSettingsAction = 'model' | 'reasoning' | 'stream' | 'hook'

export const chatSettingsActionLabels: Record<ChatSettingsAction, string> = {
  model: '临时模型',
  reasoning: '思考等级',
  stream: '流式输出',
  hook: 'hook 提示词',
}

export function createChatSettingsSaveQueue(deps: {
  getSavingByTarget: () => Record<string, unknown>
  resetSavingByTarget: () => void
  captureCurrentTarget: () => ChatSettingsTarget | null
  isActiveTarget: (target: ChatSettingsTarget) => boolean
  isDisposed: () => boolean
  onStateChanged: () => void
  onError: (message: string) => void
}) {
  const saveTails = new Map<string, Promise<boolean>>()
  const saveActions = new Map<string, symbol>()
  const waitTargets = new Set<string>()
  let generation = 0

  function actionKey(target: ChatSettingsTarget, action: ChatSettingsAction, value: unknown) {
    return JSON.stringify([chatSettingsTargetKey(target), action, value])
  }

  // 目标 key 与动作字符串序列化后必然完整出现在 real key 中（前缀+逗号），
  // 不会与其它目标/动作的 key 发生前缀碰撞。
  function isTargetActionPending(target: ChatSettingsTarget, action: ChatSettingsAction) {
    const prefix = JSON.stringify([chatSettingsTargetKey(target), action]).slice(0, -1) + ','
    for (const key of saveActions.keys()) {
      if (key.startsWith(prefix)) return true
    }
    return false
  }

  function enqueueSave(
    target: ChatSettingsTarget,
    action: ChatSettingsAction,
    isCurrent: () => boolean,
    work: (isCurrent: () => boolean) => Promise<void>,
  ) {
    const targetKey = chatSettingsTargetKey(target)
    const previous = saveTails.get(targetKey) || Promise.resolve(true)
    const status = Object.freeze({
      kind: target.kind,
      targetId: target.targetId,
      roleId: target.roleId,
      groupId: target.groupId,
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      action,
      actionLabel: chatSettingsActionLabels[action],
    })
    const run = previous.catch(() => false).then(async () => {
      if (!isCurrent()) return false
      const savingByTarget = deps.getSavingByTarget()
      savingByTarget[targetKey] = status
      deps.onStateChanged()
      try {
        await work(isCurrent)
        return isCurrent()
      } finally {
        if (savingByTarget[targetKey] === status && saveTails.get(targetKey) === run) {
          delete savingByTarget[targetKey]
          deps.onStateChanged()
        }
      }
    })
    saveTails.set(targetKey, run)
    run.finally(() => {
      if (saveTails.get(targetKey) === run) saveTails.delete(targetKey)
    }).catch(() => {})
    return run
  }

  async function runSave(
    target: ChatSettingsTarget,
    action: ChatSettingsAction,
    value: unknown,
    work: (isCurrent: () => boolean) => Promise<void>,
    failText: string,
  ): Promise<'saved' | false> {
    if (deps.isDisposed()) return false
    const generationSnapshot = generation
    const isCurrent = () => !deps.isDisposed() && generationSnapshot === generation
    const key = actionKey(target, action, value)
    if (saveActions.has(key)) return false
    const token = Symbol(key)
    saveActions.set(key, token)
    try {
      return (await enqueueSave(target, action, isCurrent, work)) ? 'saved' : false
    } catch (e) {
      if (isCurrent() && deps.isActiveTarget(target) && !waitTargets.has(chatSettingsTargetKey(target))) {
        deps.onError(String((e as any)?.message || e || failText))
      }
      return false
    } finally {
      if (saveActions.get(key) === token) saveActions.delete(key)
    }
  }

  async function waitCurrentTargetSave() {
    const target = deps.captureCurrentTarget()
    if (!target) return
    const targetKey = chatSettingsTargetKey(target)
    waitTargets.add(targetKey)
    try {
      while (true) {
        const tail = saveTails.get(targetKey)
        if (!tail) return
        try {
          await tail
        } catch (error) {
          if (deps.isDisposed() || !deps.isActiveTarget(target)) return
          throw error
        }
      }
    } finally {
      waitTargets.delete(targetKey)
    }
  }

  function abort() {
    generation++
    saveTails.clear()
    saveActions.clear()
    waitTargets.clear()
    deps.resetSavingByTarget()
  }

  return { runSave, waitCurrentTargetSave, isTargetActionPending, abort }
}
