import { describe, expect, it } from 'vitest'
import {
  BRANCH_TREE_DEFAULT_DIR,
  BRANCH_TREE_DEFAULT_FOLLOW_SELECTED,
  BRANCH_TREE_DEFAULT_MODAL_HOTKEY,
  BRANCH_TREE_DEFAULT_VIEW,
  normalizeBranchTreeDir,
  normalizeBranchTreeSettings,
  normalizeBranchTreeView,
} from './branchTree'

describe('分支树设置单一事实源', () => {
  it('默认值与后端 / dataNormalizers 的规范化结果一致（view=float）', () => {
    expect(BRANCH_TREE_DEFAULT_DIR).toBe('lr')
    expect(BRANCH_TREE_DEFAULT_VIEW).toBe('float')
    expect(BRANCH_TREE_DEFAULT_FOLLOW_SELECTED).toBe(true)
    expect(BRANCH_TREE_DEFAULT_MODAL_HOTKEY).toBe('')

    expect(normalizeBranchTreeSettings(undefined)).toEqual({
      dir: 'lr',
      view: 'float',
      followSelected: true,
      modalHotkey: '',
    })
  })

  it('保留合法的已存值，不因读取端兜底改变含义', () => {
    expect(normalizeBranchTreeSettings({ dir: 'tb', view: 'right', followSelected: false, modalHotkey: ' F2 ' })).toEqual({
      dir: 'tb',
      view: 'right',
      followSelected: false,
      modalHotkey: 'F2',
    })
  })

  it('非法值统一回落到同一默认值', () => {
    expect(normalizeBranchTreeDir('x')).toBe('lr')
    expect(normalizeBranchTreeView('x')).toBe('float')
    expect(normalizeBranchTreeView('right')).toBe('right')
    expect(normalizeBranchTreeView('float')).toBe('float')
  })
})
