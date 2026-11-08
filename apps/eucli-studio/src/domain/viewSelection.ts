// 视图位置：客户端只保留一个值——现在显示到哪个节点。
//
// 没有意图，没有锚定，没有等待，也不比对任何编号。位置只由外部事件触发的一次性动作写入：
//   点节点 → 位置放到被点的节点
//   切会话 / 会话首次进入 → 位置放到这条会话最晚创建的那条
//   我发起的运行被受理 → 位置放到这次运行的输入消息
//   我删掉自己正在看的那一支 → 位置退回它的上一条
//
// 解析只做一件事：位置当时放在末尾，就顺着最先产生的子节点一路走到新的末尾。

export type ViewSelection = {
  mid: string
  // atEnd 是「把位置放进来时，这个节点下面是空的」这次放置的事实。
  // 它让「看中间节点」与「看着末尾」区分开：前者下面早有内容，位置不动。
  atEnd: boolean
}

export const EMPTY_SELECTION: ViewSelection = { mid: '', atEnd: false }

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

function latestMidOf(tree: TreeIndex): string {
  let pick = ''
  let pickMessage: any = null
  for (const [id, message] of tree.byId.entries()) {
    if (!pickMessage || messageOrder(message, pickMessage) > 0) {
      pick = id
      pickMessage = message
    }
  }
  return pick
}

// latestMessageMid 取这条会话里最晚创建的一条消息；会话为空时返回空串。
export function latestMessageMid(chat: any): string {
  return latestMidOf(buildTreeIndex(chat))
}

// placeSelection 是「把位置放到某个节点」的唯一入口。
export function placeSelection(chat: any, midRaw: unknown): ViewSelection {
  const mid = text(midRaw)
  if (!mid) return EMPTY_SELECTION
  const tree = buildTreeIndex(chat)
  if (!tree.byId.has(mid)) return EMPTY_SELECTION
  return { mid, atEnd: (tree.children.get(mid) || []).length === 0 }
}

// followFrom 是「跟到这个节点」的唯一入口：后续它下面长出子节点就一直往下走。
//
// 与 placeSelection 的区别只有一条：是否跟随由**动作**决定，绝不看“当时下面有没有孩子”。
// 回复比运行卡先到的那一瞬，用 placeSelection 会算出“有孩子 → 不跟随”，于是永久停住。
export function followFrom(midRaw: unknown): ViewSelection {
  const mid = text(midRaw)
  return mid ? { mid, atEnd: true } : EMPTY_SELECTION
}

// selectionAtLatest 把位置放到这条会话最晚创建的一条消息上。
export function selectionAtLatest(chat: any): ViewSelection {
  const mid = latestMessageMid(chat)
  return mid ? { mid, atEnd: true } : EMPTY_SELECTION
}

// resolveSelection 是唯一的解析函数。
//
//   位置有效且当时在末尾 → 顺着最先产生的子节点一路走到新的末尾（长一层走一格）；
//   位置有效但当时不在末尾 → 原样，看历史就看历史；
//   位置为空或已经失效 → 这条会话最晚创建的那条，绝不留悬空、也不按数组顺序猜。
export function resolveSelection(chat: any, selection: ViewSelection): ViewSelection {
  const tree = buildTreeIndex(chat)
  if (!tree.byId.size) return EMPTY_SELECTION

  const mid = text(selection?.mid)
  if (!mid || !tree.byId.has(mid)) return { mid: latestMidOf(tree), atEnd: true }
  if (!selection.atEnd) return { mid, atEnd: false }

  let current = mid
  for (;;) {
    const kids = tree.children.get(current) || []
    if (!kids.length) break
    current = kids[0]
  }
  return { mid: current, atEnd: true }
}
