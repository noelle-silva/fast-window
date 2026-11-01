// 索引版本门：决定「这次对账要不要真的执行」。
//
// 只比较 (epoch, revision) 这一对事实，别的什么都不看：
//   - revision 是服务端索引内容指纹；
//   - epoch 是连接 / 索引重建的代际。
//
// epoch 必须参与比较：服务端重建之后 revision 可能从 0 重新算起，
// 与上一代恰好相等；只记 revision 会让这条 scope 被永久跳过。
// 记录本身也带 epoch —— 换代即视为「未应用」。

export type IndexRevisionGate = {
  // shouldApply 返回 true 表示必须对账。revision 非正表示服务端还没有版本语义。
  shouldApply: (scopeKey: string, epoch: number, revision: number) => boolean
  markApplied: (scopeKey: string, epoch: number, revision: number) => void
}

type AppliedRevision = {
  epoch: number
  revision: number
}

export function createIndexRevisionGate(): IndexRevisionGate {
  const applied = new Map<string, AppliedRevision>()

  function shouldApply(scopeKey: string, epoch: number, revision: number): boolean {
    const current = Number(revision || 0)
    if (!(current > 0)) return true
    const recorded = applied.get(scopeKey)
    if (!recorded) return true
    return recorded.epoch !== Number(epoch || 0) || recorded.revision !== current
  }

  function markApplied(scopeKey: string, epoch: number, revision: number): void {
    const current = Number(revision || 0)
    if (!(current > 0)) return
    applied.set(scopeKey, { epoch: Number(epoch || 0), revision: current })
  }

  return { shouldApply, markApplied }
}
