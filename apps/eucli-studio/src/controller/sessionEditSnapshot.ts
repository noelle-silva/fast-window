import { validateSessionWire } from '../protocol/sessionWireContract'
import type { SessionScope, SessionSwitchClient } from '../protocol/sessionSwitchProtocol'

// PATCH 前取快照：profile=edit 保证 parts 完整（含 raw / metadata）。
//
// 这是 profile 枚举存在的唯一理由：写路径绝不能建立在被裁剪过的视图上。
// view 只发 content（不发 text part），用它回写 PATCH 等于让历史 parts 缺一块。
//
// 业务端不支持 profile 时会忽略该参数并返回完整 parts，因此这里不需要额外开关：
// 拿到什么就合并什么，字段更全永远比更少安全。

export type SessionEditSnapshotDeps = {
  sessionSwitch?: Pick<SessionSwitchClient, 'hasFeature' | 'sessionGet'>
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export async function loadSessionEditSnapshot(
  deps: SessionEditSnapshotDeps,
  scope: SessionScope,
  chatId: string,
  options?: { switchId?: string },
): Promise<any | null> {
  const client = deps.sessionSwitch
  if (!client || !client.hasFeature('session.get')) return null
  const id = text(chatId)
  if (!id) return null
  // switchId 随写路径快照一起走：同一次切换的全部 box 请求共享同一个 trace。
  const readOptions: { profile: 'edit'; switchId?: string } = { profile: 'edit' }
  const switchId = text(options?.switchId)
  if (switchId) readOptions.switchId = switchId
  const raw = await client.sessionGet(scope, id, readOptions)
  return validateSessionWire(raw)
}

// applyEditSnapshotParts 只把「写路径依赖的字段」并回内存中的消息：
//   - parts：PATCH 序列化的唯一输入
//   - content：与 parts 保持同一份快照
// 其余字段（流式中态、本地 display 改动、运行卡片）一律保留本地值。
export function applyEditSnapshotParts(chat: any, snapshot: any) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  const snapshotMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  if (!messages.length || !snapshotMessages.length) return
  const byId = new Map<string, any>()
  for (const message of snapshotMessages) {
    const id = text(message?.id)
    if (!id) continue
    byId.set(id, message)
  }
  for (const message of messages) {
    const id = text(message?.id)
    if (!id) continue
    const source = byId.get(id)
    if (!source) continue
    if (Array.isArray(source.parts)) message.parts = source.parts.map((part: any) => ({ ...part }))
    if (typeof source.content === 'string') message.content = source.content
  }
}
