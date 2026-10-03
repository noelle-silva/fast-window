// 「按住预览」的条目目标模型：左右两侧边栏共用同一套目标标识与 DOM 数据属性，
// 悬停上报、主区域解析与预览渲染都从这里取同一份定义，不各自拼接。

export type SidebarPreviewTarget =
  | { kind: 'note'; noteId: string }
  | { kind: 'asset'; assetRef: string }
  | { kind: 'folder'; folderId: string }

/** 边栏条目行上的悬停识别属性：条目统一标注，悬停委托据此解析目标。 */
export const SIDEBAR_PREVIEW_ENTRY_ATTR = 'data-hc-preview-entry'

export function encodeSidebarPreviewTarget(target: SidebarPreviewTarget): string {
  if (target.kind === 'note') return `note:${target.noteId}`
  if (target.kind === 'asset') return `asset:${target.assetRef}`
  return `folder:${target.folderId}`
}

export function decodeSidebarPreviewTarget(raw: unknown): SidebarPreviewTarget | null {
  const value = String(raw || '')
  const idx = value.indexOf(':')
  if (idx <= 0) return null
  const kind = value.slice(0, idx)
  const id = value.slice(idx + 1).trim()
  if (!id) return null
  if (kind === 'note') return { kind: 'note', noteId: id }
  if (kind === 'asset') return { kind: 'asset', assetRef: id }
  if (kind === 'folder') return { kind: 'folder', folderId: id }
  return null
}

/** 目标的稳定标识：用于悬停上报去重，避免同一目标反复触发重渲染。 */
export function sidebarPreviewTargetKey(target: SidebarPreviewTarget | null): string {
  return target ? encodeSidebarPreviewTarget(target) : ''
}
