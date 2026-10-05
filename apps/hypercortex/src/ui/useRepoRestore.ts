import * as React from 'react'
import type { HyperCortexGateway, HyperCortexRepo } from '../gateway'

// 仓库恢复：刷新仓库列表并提示恢复结果。
// 由中心编排的动作组合段在笔记信息更新之后接线。
export function useRepoRestore(opts: {
  gateway: HyperCortexGateway
  refreshRepos: () => Promise<void>
}) {
  const { gateway, refreshRepos } = opts

  return React.useCallback(
    async (repo: HyperCortexRepo) => {
      await refreshRepos()
      void gateway.host.toast(`已恢复仓库：${repo.title}`)
    },
    [gateway, refreshRepos],
  )
}
