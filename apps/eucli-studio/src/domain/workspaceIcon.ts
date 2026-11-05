// 工作区身份图标：后端把图标存成独立资源（工作区目录下的 icon.json + 图像文件），
// 接口只交「可渲染形态」——图像是 data URL，SVG 是内联源码。
// 本模块只做三件事：归一化回执、给出统一可渲染地址、判定两份图标是否相同。

export type UiWorkspaceIconKind = 'image' | 'svg'

export type UiWorkspaceIcon = {
  kind: UiWorkspaceIconKind
  /** SVG 载体的源码；图像载体为空串。 */
  svg: string
  /** 图像载体的 data URL；SVG 载体为空串。 */
  dataUrl: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null
}

// normalizeWorkspaceIcon 只认两种载体；字段缺失或形态不符一律视为「没有图标」。
// 后端已经做过安全校验，这里按接口契约收口，不再重复做 SVG 清洗。
export function normalizeWorkspaceIcon(raw: unknown): UiWorkspaceIcon | null {
  const box = object(raw)
  if (!box) return null
  const kind = text(box.kind)
  if (kind === 'image') {
    const dataUrl = text(box.dataUrl)
    return dataUrl.startsWith('data:image/') ? { kind: 'image', svg: '', dataUrl } : null
  }
  if (kind === 'svg') {
    const svg = text(box.svg)
    return svg ? { kind: 'svg', svg, dataUrl: '' } : null
  }
  return null
}

// workspaceIconFromDraft 把编辑器草稿里的载体字段收成一个图标事实。
// 空载体（kind 为空，或所选载体缺内容）就是「没有图标」。
export function workspaceIconFromDraft(kind: unknown, svg: unknown, dataUrl: unknown): UiWorkspaceIcon | null {
  const draftKind = text(kind)
  if (draftKind === 'image') {
    const url = text(dataUrl)
    return url.startsWith('data:image/') ? { kind: 'image', svg: '', dataUrl: url } : null
  }
  if (draftKind === 'svg') {
    const markup = String(svg ?? '').trim()
    return markup ? { kind: 'svg', svg: markup, dataUrl: '' } : null
  }
  return null
}

// 图标统一以 <img src> 呈现：SVG 源码在出口处转成 data URL，
// 渲染方不必为两种载体写两套分支。
export function workspaceIconImageSrc(icon: UiWorkspaceIcon | null | undefined): string {
  if (!icon) return ''
  if (icon.kind === 'image') return icon.dataUrl
  return icon.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}` : ''
}

export function sameWorkspaceIcon(
  left: UiWorkspaceIcon | null | undefined,
  right: UiWorkspaceIcon | null | undefined,
): boolean {
  const a = left || null
  const b = right || null
  if (!a || !b) return a === b
  return a.kind === b.kind && a.svg === b.svg && a.dataUrl === b.dataUrl
}

// 草稿基线用同一份序列化结果表示：保存时拿当前草稿与基线比较，
// 决定「不写」「写入」还是「删除」，不需要第三个脏标记。
export function workspaceIconBaseline(icon: UiWorkspaceIcon | null | undefined): string {
  const value = icon || null
  return value ? JSON.stringify(value) : ''
}

export function parseWorkspaceIconBaseline(raw: unknown): UiWorkspaceIcon | null {
  const value = text(raw)
  if (!value) return null
  try {
    return normalizeWorkspaceIcon(JSON.parse(value))
  } catch {
    return null
  }
}
