import type { BackgroundClient } from '../gateway/backgroundClient'
import type { RepoStateService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createRepoStateService(background: BackgroundClient): RepoStateService {
  return {
    tryLoadRepoState: scope => background.invoke(HyperCortexRpc.repoState.tryLoad, { scope }),
    ensureRepoState: scope => background.invoke(HyperCortexRpc.repoState.ensure, { scope }),
    saveRepoState: (scope, state) => background.invoke(HyperCortexRpc.repoState.save, { scope, state }),
  }
}
