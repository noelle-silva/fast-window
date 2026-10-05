import { useRepoWorkspaceState } from './useRepoWorkspaceState'
import { useRepoWorkspaceActions } from './useRepoWorkspaceActions'

// 仓库现场编排：组合装配门面。
// 状态组合段见 useRepoWorkspaceState，动作组合段见 useRepoWorkspaceActions；
// 笔记信息更新、仓库恢复、删除分组并关标签三项领域动作各自成独立子钩子，由动作组合段按依赖顺序接线。
// 页面与模态体渲染见 RepoWorkspaceContent，工具栏接线见 RepoWorkspaceToolbarHost，
// 主文件 RepoWorkspace 保留工作区装配；模块间只经显式入参/回调连接，不引入隐式全局。

export function useRepoWorkspaceOrchestration(props: { repoId: string; visible: boolean }) {
  const state = useRepoWorkspaceState(props)
  const actions = useRepoWorkspaceActions(state)
  // settings 与 setActiveNoteId 仅由动作组合段内部消费，不进入对外契约。
  const { settings: _settings, setActiveNoteId: _setActiveNoteId, ...publicState } = state
  return { ...publicState, ...actions }
}

export type RepoWorkspaceOrchestration = ReturnType<typeof useRepoWorkspaceOrchestration>
