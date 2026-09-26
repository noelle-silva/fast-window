import type { BackgroundClient } from '../gateway/backgroundClient'
import type { ReposService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createReposService(background: BackgroundClient): ReposService {
  return {
    listRepos: () => background.invoke(HyperCortexRpc.repos.list, {}),
    createRepo: title => background.invoke(HyperCortexRpc.repos.create, { title }),
    activateRepo: repoId => background.invoke(HyperCortexRpc.repos.activate, { repoId }),
    renameRepo: (repoId, title) => background.invoke(HyperCortexRpc.repos.rename, { repoId, title }),
    deleteRepo: repoId => background.invoke(HyperCortexRpc.repos.delete, { repoId }),
    listDeletedRepos: () => background.invoke(HyperCortexRpc.repos.listDeleted, {}),
    restoreRepo: repoId => background.invoke(HyperCortexRpc.repos.restore, { repoId }),
  }
}
