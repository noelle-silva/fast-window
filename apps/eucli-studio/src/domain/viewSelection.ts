// 视图位置：客户端只保留一个值——现在显示到哪个节点。
//
// 这里没有任何模式：不记“要不要跟随”，不记“锚定在哪”，不记“在等哪次运行”，
// 也不比对任何编号。位置只由外部事件触发的一次性动作写入，规则只依据 Agent 端
// 的事实做一次比较。
//
// 两条早期版本都在这里收敛：
//   动作一（我发起的运行被受理）→ 位置移到这次运行的节点（由控制器给出运行身份，App 执行一次）。
//   动作二（事实里出现新节点，挂在我显示的这个末尾节点下面）→ 位置往下推进一格。
//     “先到先得”：一次长出多个子节点时，取最先产生的那一个；推过去之后我人已在那条上，
//     它的兄弟不挂在我脚下，不会再把位置带走。

export type ViewSelection = {
  mid: string
  // atEnd 记录的是「把位置放进来时，这个节点下面是空的」。
  // 它不是模式，只是那次放置的事实：只有当时是末尾，之后长出新节点才往下推。
  // 看着中间节点（下面早有内容）时，位置不动。
  atEnd: boolean
  // chain 是放进来时显示的那一串（近 → 远）。
  // 它只服务于一件事：节点被删掉之后，沿这一串退回最近一个还在的节点，绝不悬空。
  chain: string[]
}

export const EMPTY_SELECTION: ViewSelection = { mid: '', atEnd: false, chain: [] }

// sameSelection 是位置是否相同的唯一判定：UI 用它决定要不要把解析结果写回去。
export function sameSelection(left: ViewSelection, right: ViewSelection): boolean {
  if (left === right) return true
  if (left.mid !== right.mid || left.atEnd !== right.atEnd) return false
  if (left.chain.length !== right.chain.length) return false
  for (let i = 0; i < left.chain.length; i++) {
    if (left.chain[i] !== right.chain[i]) return false
  }
  return true
}

function text(value: unknown) {
  return String(value || '').trim()
}

// messageOrder 是消息先后顺序的唯一比较口径：创建时间优先，其次更新时间，最后编号。
function messageOrder(left: any, right: any) {
  const lc = Number(left?.createdAt || 0)
  const rc = Number(right?.createdAt || 0)
  if (lc !== rc) return lc - rc
  const lu = Number(left?.updatedAt || 0)
  const ru = Number(right?.updatedAt || 0)
  if (lu !== ru) return lu - ru
  return text(left?.id).localeCompare(text(right?.id))
}

type TreeIndex = {
  byId: Map<string, any>
  children: Map<string, string[]>
}

// buildTreeIndex 只做一次遍历：编号到消息、父节点到有序子节点。
function buildTreeIndex(chat: any): TreeIndex {
  const byId = new Map<string, any>()
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  for (const message of messages) {
    const id = text(message?.id)
    if (!id || byId.has(id)) continue
    byId.set(id, message)
  }
  const children = new Map<string, string[]>()
  for (const [id, message] of byId.entries()) {
    const parentMid = text((message as any)?.parentMid)
    if (!parentMid || !byId.has(parentMid)) continue
    const list = children.get(parentMid) || []
    list.push(id)
    children.set(parentMid, list)
  }
  for (const [parentMid, list] of children.entries()) {
    list.sort((left, right) => messageOrder(byId.get(left), byId.get(right)))
    children.set(parentMid, list)
  }
  return { byId, children }
}

function childrenOf(tree: TreeIndex, mid: string): string[] {
  return tree.children.get(mid) || []
}

// latestMessageMid 取这条会话里最靠后的一条消息；会话为空时返回空串。
export function latestMessageMid(chat: any): string {
  const { byId } = buildTreeIndex(chat)
  let pick = ''
  let pickMessage: any = null
  for (const [id, message] of byId.entries()) {
    if (!pickMessage || messageOrder(message, pickMessage) > 0) {
      pick = id
      pickMessage = message
    }
  }
  return pick
}

// ancestorChain 返回 mid 的上级链（近 → 远），只收录当前确实存在的节点。
function ancestorChain(tree: TreeIndex, mid: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([mid])
  let current = text((tree.byId.get(mid) as any)?.parentMid)
  while (current && !seen.has(current) && tree.byId.has(current)) {
    seen.add(current)
    out.push(current)
    current = text((tree.byId.get(current) as any)?.parentMid)
  }
  return out
}

// placeSelection 是「把位置放到某个节点」的唯一入口：
// 点节点、切会话落点、我这次发送的落点，全部走这里。
export function placeSelection(chat: any, midRaw: unknown): ViewSelection {
  const mid = text(midRaw)
  if (!mid) return EMPTY_SELECTION
  const tree = buildTreeIndex(chat)
  if (!tree.byId.has(mid)) return EMPTY_SELECTION
  return { mid, atEnd: childrenOf(tree, mid).length === 0, chain: ancestorChain(tree, mid) }
}

// selectionAtLatest 把位置放到这条会话最靠后的一条消息上（切入会话时的落点）。
export function selectionAtLatest(chat: any): ViewSelection {
  return placeSelection(chat, latestMessageMid(chat))
}

// resolveSelection 把存下来的位置解析成当前真正显示的位置。
//
// 只有一件事要做：当时放在末尾，现在下面长出节点了 → 沿最先产生的那个往下走，
// 一直走到没有子节点为止。看着中间节点时位置不动，历史才看得住。
export function resolveSelection(chat: any, selection: ViewSelection): ViewSelection {
  const mid = text(selection?.mid)
  if (!mid) return EMPTY_SELECTION
  const tree = buildTreeIndex(chat)

  // 节点没了：沿放进来时的那一串退回最近一个还在的节点，然后停在那儿。
  if (!tree.byId.has(mid)) {
    for (const candidate of Array.isArray(selection?.chain) ? selection.chain : []) {
      const ancestorMid = text(candidate)
      if (!ancestorMid || ancestorMid === mid || !tree.byId.has(ancestorMid)) continue
      return { mid: ancestorMid, atEnd: false, chain: ancestorChain(tree, ancestorMid) }
    }
    return EMPTY_SELECTION
  }

  if (!selection.atEnd) return { mid, atEnd: false, chain: ancestorChain(tree, mid) }

  // 当时放在末尾：每长出一层子节点就往下推进一格，取最先产生的那一个。
  let current = mid
  for (;;) {
    const kids = childrenOf(tree, current)
    if (!kids.length) break
    current = kids[0]
  }
  return { mid: current, atEnd: true, chain: ancestorChain(tree, current) }
}
