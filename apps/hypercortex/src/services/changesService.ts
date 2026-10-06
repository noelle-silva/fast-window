import type { BackgroundClient } from '../gateway/backgroundClient'
import type { ChangesService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

// 外部改动订阅：把后台常驻连线的推送事件收敛为界面可消费的两类通知——
// 具体仓库的数据变更，以及常驻连线重建（用于重连后重新对账）。
export function createChangesService(background: BackgroundClient): ChangesService {
  return {
    revision: scope => background.invoke<{ revision: number }>(HyperCortexRpc.changes.revision, { scope }).then(result => Number(result?.revision) || 0),
    subscribeChanges: handler =>
      background.subscribe(event => {
        if (event.type === 'changed') handler({ repoId: event.repoId, kinds: event.kinds, revision: event.revision })
      }),
    subscribeReconnect: handler =>
      background.subscribe(event => {
        if (event.type === 'reconnect') handler()
      }),
  }
}
