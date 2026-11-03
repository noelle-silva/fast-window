import { removeDraftImage as removeDraftImageFromList } from '../../domain/draftImageUtils'
import { COMPOSER_REFRESH_SCOPE, refreshScopes } from '../../domain/uiRefreshScope'
import {
  activateComposerDraftForCurrentSession,
  clearComposerDraftByKey,
  setActiveComposerImages,
  setActiveComposerInput,
} from '../../domain/sessionComposerDrafts'

// 草稿写入只有一个事实源：sessionComposerDrafts。
// 这里按“谁在写”拆成两个语义入口，避免同一个 setDraft('input') 既承担
// 输入区逐键写入（不能广播）又承担外部程序化写入（必须广播）两种相反要求。
export function createDraftActions(deps: {
  state: any
  emitScope: (scope: string) => void
}) {
  const { state, emitScope } = deps

  // 输入区逐键写入：本地输入状态已经即时显示，不能广播，
  // 否则每次按键都会触发外部刷新重置输入区与选择器。
  function setComposerInput(value: unknown) {
    setActiveComposerInput(state, value)
  }

  // 外部程序化写入：调用方不在输入区内，必须广播 composer 范围，
  // 让输入区按修订号对账到新的草稿值。
  function setComposerInputExternal(value: unknown) {
    setActiveComposerInput(state, value)
    notifyComposer()
  }

  // 输入区之外的草稿变更统一走这里，保证“广播 composer”只有一个定义。
  function notifyComposer() {
    emitScope(COMPOSER_REFRESH_SCOPE)
  }

  // 消费草稿是「清空 + 广播」的原子动作：调用方不得只做其中一半。
  function consumeComposerDraft(keyRaw: unknown) {
    clearComposerDraftByKey(state, keyRaw)
    notifyComposer()
  }

  function setDraft(key: unknown, value: unknown) {
    const k = String(key || '')
    if (!k) return
    if (k === 'input') {
      throw new Error("setDraft('input') 已废弃：输入区请用 setComposerInput，外部写入请用 setComposerInputExternal")
    }
    if ((k === 'workspaceName' || k === 'workspacePrompt') && state.modal === 'workspace') {
      ;(state.draft as any).workspaceActualPromptStale = true
      ;(state.draft as any).workspaceActualPromptError = ''
    }
    ;(state.draft as any)[k] = value
    emitScope(refreshScopes.uiShell())
  }

  function removeDraftImage(id: unknown) {
    const draft = activateComposerDraftForCurrentSession(state)
    setActiveComposerImages(state, removeDraftImageFromList(draft.images, String(id || '')))
    notifyComposer()
  }

  return {
    setComposerInput,
    setComposerInputExternal,
    setDraft,
    removeDraftImage,
    notifyComposer,
    consumeComposerDraft,
  }
}
