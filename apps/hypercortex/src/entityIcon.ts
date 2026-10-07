// 实体图标统一描述：种类 + 取值。三类实体（笔记 / 收藏夹 / 附件）共用同一套模型。
// 「默认」表示不设自定义图标，显示实体类型本来的默认图标，因此不存在 default 取值态。
export type EntityIcon =
  | { kind: 'library'; name: string }
  | { kind: 'image'; path: string }
  | { kind: 'svg'; svg: string }

// 编辑器草稿：图片在未落盘前携带 dataUrl，落盘后由后端回填 path。
export type EntityIconDraft =
  | { kind: 'default' }
  | { kind: 'library'; name: string }
  | { kind: 'image'; path?: string; dataUrl?: string }
  | { kind: 'svg'; svg: string }

export type EntityIconTargetKind = 'note' | 'folder' | 'asset'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

// 宽松解析：非法图标按「无自定义图标」处理，保证旧数据与脏数据可加载。
export function normalizeEntityIcon(raw: unknown): EntityIcon | undefined {
  const rec = asRecord(raw)
  if (!rec) return undefined
  const kind = String(rec.kind || '').trim()
  if (kind === 'library') {
    const name = String(rec.name || '').trim()
    return name ? { kind: 'library', name } : undefined
  }
  if (kind === 'image') {
    const path = String(rec.path || '').trim()
    return path ? { kind: 'image', path } : undefined
  }
  if (kind === 'svg') {
    const svg = String(rec.svg || '').trim()
    return svg ? { kind: 'svg', svg } : undefined
  }
  return undefined
}

export function entityIconDraftFrom(icon: EntityIcon | undefined): EntityIconDraft {
  if (!icon) return { kind: 'default' }
  if (icon.kind === 'library') return { kind: 'library', name: icon.name }
  if (icon.kind === 'image') return { kind: 'image', path: icon.path }
  return { kind: 'svg', svg: icon.svg }
}

export function entityIconFromDraft(draft: EntityIconDraft): EntityIcon | undefined {
  if (draft.kind === 'library') return draft.name.trim() ? { kind: 'library', name: draft.name.trim() } : undefined
  if (draft.kind === 'image') {
    if (draft.dataUrl) return undefined
    return draft.path ? { kind: 'image', path: draft.path } : undefined
  }
  if (draft.kind === 'svg') return draft.svg.trim() ? { kind: 'svg', svg: draft.svg } : undefined
  return undefined
}

export function entityIconEqual(a: EntityIcon | undefined, b: EntityIcon | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.kind !== b.kind) return false
  if (a.kind === 'library' && b.kind === 'library') return a.name === b.name
  if (a.kind === 'image' && b.kind === 'image') return a.path === b.path
  if (a.kind === 'svg' && b.kind === 'svg') return a.svg === b.svg
  return false
}

// 图标是否处于「有自定义」状态（用于界面判断是否显示恢复默认）。
export function hasCustomEntityIcon(icon: EntityIcon | undefined): boolean {
  return Boolean(icon)
}
