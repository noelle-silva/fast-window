// 运行受理后的视线落点：一次运行只搬一次，用户一旦自己动过视线就彻底交还。
//
// 这里守着「事实」与「动作」的分界：
//   受理是一次动作 → 允许写位置，写一次
//   产出推进是事实  → 绝不写位置，跟随由 viewSelection 的 atEnd 承担
//   用户导航是动作  → 优先级最高，本次运行的落点直接作废
//
// 少了这条分界，回复开始产出的那一帧会把用户刚点开的历史节点顶掉。

export type ViewFollowState = {
  // 已经搬过落点的那次运行。同一次运行不再搬第二次。
  placedRunId: string
  // 用户已显式接管视线的那次运行。它的落点不再搬。
  handedOffRunId: string
}

export const NO_VIEW_FOLLOW: ViewFollowState = { placedRunId: '', handedOffRunId: '' }

function text(value: unknown) {
  return String(value || '').trim()
}

// handOffViewFollow 是「用户自己动了视线」的唯一入口。
//
// runId 为空时回落到已经搬过的那次运行：用户点的这一刻，正是它的落点需要作废。
export function handOffViewFollow(state: ViewFollowState, runIdRaw: unknown): ViewFollowState {
  const current = state && typeof state === 'object' ? state : NO_VIEW_FOLLOW
  const runId = text(runIdRaw) || text(current.placedRunId)
  if (!runId || runId === text(current.handedOffRunId)) return current
  return { placedRunId: text(current.placedRunId), handedOffRunId: runId }
}

// planViewFollow 回答一件事：这次运行的落点现在要不要搬，搬到哪。
//
// 返回 place 为空串表示不动。state 只在决定搬的那一刻前推，其余情况原样返回。
export function planViewFollow(
  state: ViewFollowState,
  input: { runId?: unknown; focusMid?: unknown },
): { place: string; state: ViewFollowState } {
  const current = state && typeof state === 'object' ? state : NO_VIEW_FOLLOW
  const runId = text(input?.runId)
  const focusMid = text(input?.focusMid)
  if (!runId || !focusMid) return { place: '', state: current }
  if (text(current.handedOffRunId) === runId) return { place: '', state: current }
  if (text(current.placedRunId) === runId) return { place: '', state: current }
  return { place: focusMid, state: { placedRunId: runId, handedOffRunId: text(current.handedOffRunId) } }
}
