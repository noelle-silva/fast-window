import { createDraftCache, useDraftCacheVersion } from '../core/draftCache'
import type { PromptEntry, PromptScope } from './promptLibrary'

// 提示词条目的未保存草稿：按「作用域 + 归属 + 条目」定位。
// 另开一条键给还没落库的新条目：写了一半的名字与正文不该因为关窗就没了。
const promptDraftCache = createDraftCache<PromptEntry>()

/** 新条目的占位 id：草稿缓存与列表黄点都认它。 */
export const NEW_PROMPT_DRAFT_ID = '__new__'

export function promptDraftKey(scope: PromptScope, ownerId: string, promptId: string): string {
  return `${scope}:${ownerId}:${promptId || NEW_PROMPT_DRAFT_ID}`
}

export function readPromptDraft(scope: PromptScope, ownerId: string, promptId: string): PromptEntry | null {
  return promptDraftCache.get(promptDraftKey(scope, ownerId, promptId))
}

export function writePromptDraft(scope: PromptScope, ownerId: string, draft: PromptEntry): void {
  promptDraftCache.set(promptDraftKey(scope, ownerId, draft.id), draft)
}

/** 还没落库的新条目只有一个草稿位：再点「新建」就是接着上一条继续写。 */
export function readNewPromptDraft(scope: PromptScope, ownerId: string): PromptEntry | null {
  return promptDraftCache.get(promptDraftKey(scope, ownerId, NEW_PROMPT_DRAFT_ID))
}

export function writeNewPromptDraft(scope: PromptScope, ownerId: string, draft: PromptEntry): void {
  promptDraftCache.set(promptDraftKey(scope, ownerId, NEW_PROMPT_DRAFT_ID), draft)
}

export function dropPromptDraft(scope: PromptScope, ownerId: string, promptId: string): void {
  promptDraftCache.remove(promptDraftKey(scope, ownerId, promptId))
}

/** 当前作用域与归属下，哪些条目还挂着没保存的草稿（含新条目）。 */
export function promptDraftIds(scope: PromptScope, ownerId: string): Set<string> {
  const prefix = `${scope}:${ownerId}:`
  const ids = new Set<string>()
  for (const key of promptDraftCache.keys()) {
    if (!key.startsWith(prefix)) continue
    ids.add(key.slice(prefix.length))
  }
  return ids
}

export function usePromptDraftVersion(): number {
  return useDraftCacheVersion(promptDraftCache)
}
