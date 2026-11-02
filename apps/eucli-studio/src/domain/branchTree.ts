// 分支树外观设置的单一事实源。
//
// 默认值以现有归一化结果（backend-go projection_uimap + dataNormalizers）为准：
// dir=lr、view=float、followSelected=true、modalHotkey=''。
// 动作层、设置面板与树视图只允许消费这里的常量 / 归一化函数，禁止各自兜底。

export type BranchTreeDir = 'lr' | 'tb' | 'bt' | 'rl'
export type BranchTreeView = 'right' | 'float'

export type BranchTreeSettings = {
  dir: BranchTreeDir
  view: BranchTreeView
  followSelected: boolean
  modalHotkey: string
}

export const BRANCH_TREE_DIR_OPTIONS = ['lr', 'tb', 'bt', 'rl'] as const satisfies readonly BranchTreeDir[]
export const BRANCH_TREE_VIEW_OPTIONS = ['right', 'float'] as const satisfies readonly BranchTreeView[]

export const BRANCH_TREE_DEFAULT_DIR: BranchTreeDir = 'lr'
export const BRANCH_TREE_DEFAULT_VIEW: BranchTreeView = 'float'
export const BRANCH_TREE_DEFAULT_FOLLOW_SELECTED = true
export const BRANCH_TREE_DEFAULT_MODAL_HOTKEY = ''
export const BRANCH_TREE_MODAL_HOTKEY_MAX_LENGTH = 80

export function normalizeBranchTreeDir(value: unknown): BranchTreeDir {
  const raw = String(value || '').trim()
  return (BRANCH_TREE_DIR_OPTIONS as readonly string[]).includes(raw) ? (raw as BranchTreeDir) : BRANCH_TREE_DEFAULT_DIR
}

export function normalizeBranchTreeView(value: unknown): BranchTreeView {
  const raw = String(value || '').trim()
  return (BRANCH_TREE_VIEW_OPTIONS as readonly string[]).includes(raw) ? (raw as BranchTreeView) : BRANCH_TREE_DEFAULT_VIEW
}

export function createDefaultBranchTreeSettings(): BranchTreeSettings {
  return {
    dir: BRANCH_TREE_DEFAULT_DIR,
    view: BRANCH_TREE_DEFAULT_VIEW,
    followSelected: BRANCH_TREE_DEFAULT_FOLLOW_SELECTED,
    modalHotkey: BRANCH_TREE_DEFAULT_MODAL_HOTKEY,
  }
}

export function normalizeBranchTreeSettings(raw: unknown): BranchTreeSettings {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    dir: normalizeBranchTreeDir(box.dir),
    view: normalizeBranchTreeView(box.view),
    followSelected: typeof box.followSelected === 'boolean' ? box.followSelected : BRANCH_TREE_DEFAULT_FOLLOW_SELECTED,
    modalHotkey: String(box.modalHotkey || '').trim().slice(0, BRANCH_TREE_MODAL_HOTKEY_MAX_LENGTH),
  }
}
