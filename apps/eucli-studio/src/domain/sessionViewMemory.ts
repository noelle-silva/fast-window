import { createDraftCache } from '../core/draftCache'
import type { PromptScope } from './promptLibrary'
import type { TaskScope } from './taskTree'

// 会话级的界面记忆：模态窗关掉、组件重建，都不该忘记「刚才停在哪」。
// 键是会话标识，值是各作用域各自的一份位置；存的是纯数据，重启应用就重来。
export type PromptLibraryScopeMemory = {
  ownerId: string
  folderId: string
  /** 上次打开的那条提示词：重开窗口直接回到它的编辑位。 */
  selectedPromptId: string
}

export type TaskTreeScopeMemory = {
  ownerId: string
  /** 上次浏览到的那条路径（根层为空数组）。 */
  pathIds: string[]
}

const promptLibraryMemory = createDraftCache<Record<string, PromptLibraryScopeMemory>>()
const taskTreeMemory = createDraftCache<Record<string, TaskTreeScopeMemory>>()

export function readPromptLibraryMemory(sessionKey: string): Record<string, PromptLibraryScopeMemory> {
  return promptLibraryMemory.get(sessionKey) ?? {}
}

export function writePromptLibraryMemory(
  sessionKey: string,
  scope: PromptScope,
  value: PromptLibraryScopeMemory,
): void {
  promptLibraryMemory.set(sessionKey, { ...readPromptLibraryMemory(sessionKey), [scope]: value })
}

export function readTaskTreeMemory(sessionKey: string): Record<string, TaskTreeScopeMemory> {
  return taskTreeMemory.get(sessionKey) ?? {}
}

export function writeTaskTreeMemory(sessionKey: string, scope: TaskScope, value: TaskTreeScopeMemory): void {
  taskTreeMemory.set(sessionKey, { ...readTaskTreeMemory(sessionKey), [scope]: value })
}
