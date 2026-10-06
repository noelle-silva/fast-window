import * as React from 'react'
import type { HyperCortexGateway } from '../gateway'

// 外部改动同步：订阅后台推送的外部改动与常驻连线重建。
// - 收到变更：只让对应仓库现场反应，按变更类别就地重载（由 onChange 决定具体数据块）。
// - 重连对账：用仓库变更修订号比对上次已知值，不一致说明断线期间漏掉了通知，按全类别重载。

export const ALL_CHANGE_KINDS: readonly string[] = ['notes', 'favorites', 'assets', 'trash']

export function useExternalChangeSync(opts: {
  gateway: HyperCortexGateway
  repoId: string
  enabled: boolean
  onChange: (kinds: string[]) => void
}): void {
  const { gateway, repoId, enabled } = opts
  const onChangeRef = React.useRef(opts.onChange)
  React.useEffect(() => {
    onChangeRef.current = opts.onChange
  }, [opts.onChange])

  const lastRevisionRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    let disposed = false

    const remember = (revision: number) => {
      lastRevisionRef.current = revision
    }

    const offChange = gateway.changes.subscribeChanges(event => {
      if (disposed || event.repoId !== repoId) return
      if (Number.isFinite(event.revision)) remember(Math.max(lastRevisionRef.current ?? 0, event.revision))
      if (event.kinds.length) onChangeRef.current(event.kinds)
    })

    const offReconnect = gateway.changes.subscribeReconnect(() => {
      if (disposed) return
      void gateway.changes
        .revision('library')
        .then(revision => {
          if (disposed) return
          const last = lastRevisionRef.current
          if (last === null) {
            remember(revision)
            return
          }
          if (revision !== last) {
            remember(revision)
            onChangeRef.current([...ALL_CHANGE_KINDS])
          }
        })
        .catch(() => {})
    })

    // 建立当前修订基线：首次装载由初始化流程覆盖，无需触发刷新；
    // 若基线建立前已收到变更（修订号更大），保留变更推进后的值。
    void gateway.changes
      .revision('library')
      .then(revision => {
        if (!disposed && lastRevisionRef.current === null) remember(revision)
      })
      .catch(() => {})

    return () => {
      disposed = true
      offChange()
      offReconnect()
    }
  }, [enabled, gateway, repoId])
}
