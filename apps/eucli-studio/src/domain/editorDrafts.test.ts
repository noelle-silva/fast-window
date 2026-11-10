import { describe, expect, it } from 'vitest'
import { dropTaskDraft, readTaskDraft, writeTaskDraft } from './taskTreeDrafts'
import { NEW_PROMPT_DRAFT_ID, dropPromptDraft, promptDraftIds, readNewPromptDraft, writeNewPromptDraft, writePromptDraft } from './promptDrafts'
import type { PromptEntry } from './promptLibrary'
import type { TaskDraft } from './taskTree'

// 缓存是模块级的：每个用例用互不相同的归属，彼此不串。
let seq = 0
const uniqueOwner = () => `owner-${++seq}`

function taskDraft(id: string, name: string): TaskDraft {
  return { id, name, description: '', content: '' }
}

function promptEntry(id: string, name: string): PromptEntry {
  return { id, name, description: '', content: '', createdAt: '', updatedAt: '' }
}

describe('任务的未保存草稿', () => {
  it('写进去的草稿按原样读回来', () => {
    const owner = uniqueOwner()
    writeTaskDraft('role', owner, 'n1', taskDraft('n1', '改了一半'))
    expect(readTaskDraft('role', owner, 'n1')?.name).toBe('改了一半')
  })

  it('不同作用域 / 归属之间互不干扰', () => {
    const ownerA = uniqueOwner()
    const ownerB = uniqueOwner()
    writeTaskDraft('role', ownerA, 'n1', taskDraft('n1', '甲'))
    writeTaskDraft('role', ownerB, 'n1', taskDraft('n1', '乙'))
    writeTaskDraft('workspace', ownerA, 'n1', taskDraft('n1', '丙'))

    expect(readTaskDraft('role', ownerA, 'n1')?.name).toBe('甲')
    expect(readTaskDraft('role', ownerB, 'n1')?.name).toBe('乙')
    expect(readTaskDraft('workspace', ownerA, 'n1')?.name).toBe('丙')
  })

  it('保存后清掉的草稿不再存在：回到这一层看到的是服务端那份', () => {
    const owner = uniqueOwner()
    writeTaskDraft('role', owner, 'n1', taskDraft('n1', '临时'))
    dropTaskDraft('role', owner, 'n1')
    expect(readTaskDraft('role', owner, 'n1')).toBeNull()
  })
})

describe('提示词的未保存草稿', () => {
  it('条目草稿按 id 读回', () => {
    const owner = uniqueOwner()
    writePromptDraft('role', owner, promptEntry('p1', '改了一半'))
    expect(promptDraftIds('role', owner).has('p1')).toBe(true)
  })

  it('黄点只认当前作用域与归属', () => {
    const ownerA = uniqueOwner()
    const ownerB = uniqueOwner()
    writePromptDraft('role', ownerA, promptEntry('p1', '甲'))
    writePromptDraft('role', ownerB, promptEntry('p2', '乙'))

    const ids = promptDraftIds('role', ownerA)
    expect(ids.has('p1')).toBe(true)
    expect(ids.has('p2')).toBe(false)
    expect(promptDraftIds('workspace', ownerA).size).toBe(0)
  })

  it('还没落库的新条目只有一个草稿位', () => {
    const owner = uniqueOwner()
    writeNewPromptDraft('role', owner, promptEntry('draft-1', '新提示词'))
    expect(readNewPromptDraft('role', owner)?.id).toBe('draft-1')
    expect(promptDraftIds('role', owner).has(NEW_PROMPT_DRAFT_ID)).toBe(true)

    dropPromptDraft('role', owner, NEW_PROMPT_DRAFT_ID)
    expect(readNewPromptDraft('role', owner)).toBeNull()
  })
})
