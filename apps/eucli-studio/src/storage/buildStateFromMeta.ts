import { normalizeData } from '../domain/dataNormalizers'
import { VERSION, SESSION_FAVORITES_KEY } from '../domain/constants'
import { normalizeFavorites } from '../domain/favorites'
import { chatMetasFromBox } from '../domain/chatMeta'
import { readActiveChatSelection } from '../domain/activeChatSelection'
import { splitGroupKey, splitRoleKey } from '../domain/storageKeys'
import { overlayClientPreferences, preferencesOfRead, readClientPreferences } from './clientPreferences'
import { loadProvidersFromStorage } from './splitIndexes'
import { loadStickerSettingsFromStorage } from './stickerSettingsPersistence'

export type StateScopeKind = 'role' | 'group'

export type StateChatIndex = {
  activeChatId?: unknown
  chatMetas?: any
}

export type BuildStateFromMetaOptions = {
  meta: any
  storage: { get: (key: string) => Promise<any> }
  loadChatIndex: (scope: { kind: StateScopeKind; targetId: string }) => Promise<StateChatIndex | null>
}

// buildStateFromMeta 是 meta → 内存 state 的唯一组装入口。
//
// 两个调用者（外壳加载与旧的整体加载）曾经各写一份等价逻辑，
// 任何派生字段 / 深拷贝隔离的调整都必须同时改两处。现在统一在这里：
//   - 目录事实（order / folder 映射）与派生字段（providers / stickers）
//     仍然由 meta / 专用通道提供；
//   - 客户端偏好先读 meta 快照，再叠加 client-state/preferences（ui +
//     投影自有 settings），偏好通道永远不依赖业务连接；
//   - 叠加结果深拷贝成独立的两棵树，state 与 meta / 偏好快照互不共享引用；
//   - 会话列表只装索引事实（activeChatId + chatMetas），正文按需懒加载。
export async function buildStateFromMeta(options: BuildStateFromMetaOptions): Promise<any> {
  const { meta, storage, loadChatIndex } = options

  let stickers = null
  try {
    stickers = await loadStickerSettingsFromStorage(storage)
  } catch (_) {
    stickers = null
  }

  let favorites = null
  try {
    favorites = await storage.get(SESSION_FAVORITES_KEY)
  } catch (_) {
    favorites = null
  }

  const providers = await loadProvidersFromStorage(storage, meta)
  // 偏好通道是本地读：缺失 / 损坏 / 读取失败都只能回落到 meta 快照，
  // 不得在这里把失败结果补成默认偏好。
  const preferencesView = overlayClientPreferences(
    { ui: meta.ui, settings: meta.settings },
    preferencesOfRead(await readClientPreferences(storage)),
  )

  const d: any = {
    version: VERSION,
    settings: preferencesView.settings,
    favorites: normalizeFavorites(favorites),
    roles: [],
    chatsByRole: {},
    groups: [],
    chatsByGroup: {},
    ui: preferencesView.ui,
  }
  d.settings.stickers = stickers && typeof stickers === 'object' ? stickers : {}
  d.settings.providers = providers

  for (const rid of meta.roleOrder || []) {
    const folder = String(meta.roleFolders?.[rid] || '')
    if (!folder) throw new Error('存储索引损坏：roleFolders 缺失')
    const role = await storage.get(splitRoleKey(folder))
    if (!role || typeof role !== 'object') throw new Error('存储损坏：角色文件缺失或无效')
    d.roles.push(role)
    const index = await loadChatIndex({ kind: 'role', targetId: rid })
    d.chatsByRole[String(role.id || rid)] = {
      activeChatId: readActiveChatSelection(index),
      chatMetas: index?.chatMetas || chatMetasFromBox({}, '新聊天'),
      chats: [],
    }
  }

  for (const gid of meta.groupOrder || []) {
    const folder = String(meta.groupFolders?.[gid] || '')
    if (!folder) throw new Error('存储索引损坏：groupFolders 缺失')
    const group = await storage.get(splitGroupKey(folder))
    if (!group || typeof group !== 'object') throw new Error('存储损坏：群组文件缺失或无效')
    d.groups.push(group)
    const index = await loadChatIndex({ kind: 'group', targetId: gid })
    d.chatsByGroup[String(group.id || gid)] = {
      activeChatId: readActiveChatSelection(index),
      chatMetas: index?.chatMetas || chatMetasFromBox({}, '群聊'),
      chats: [],
    }
  }

  return normalizeData(d)
}
