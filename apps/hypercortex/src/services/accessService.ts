import type { BackgroundClient } from '../gateway/backgroundClient'
import type { AccessService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createAccessService(background: BackgroundClient): AccessService {
  return {
    loadAccess: () => background.invoke(HyperCortexRpc.access.load, {}),
    createAccessKey: input => background.invoke(HyperCortexRpc.access.createKey, input),
    updateAccessKey: (key, input) => background.invoke(HyperCortexRpc.access.updateKey, { key, ...input }),
    deleteAccessKey: key => background.invoke(HyperCortexRpc.access.deleteKey, { key }),
    saveAccessPort: port => background.invoke(HyperCortexRpc.access.savePort, { port }),
  }
}
