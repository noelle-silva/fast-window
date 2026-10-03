import * as React from 'react'
import {
  SIDEBAR_PREVIEW_ENTRY_ATTR,
  decodeSidebarPreviewTarget,
  type SidebarPreviewTarget,
} from './previewTarget'

/**
 * 边栏条目的悬停上报：在列表容器上做一次事件委托，按条目标注的属性解析目标。
 * 是否消费悬停（如按住快捷键）由调用方决定；这里只负责忠实上报当前命中的目标。
 */

/** 读取当前指针下命中的条目标注（按住快捷键时补一次，支持“先悬停后按住”）。 */
export function readHoveredSidebarPreviewTarget(): SidebarPreviewTarget | null {
  const el = document.querySelector(`[${SIDEBAR_PREVIEW_ENTRY_ATTR}]:hover`)
  if (!el) return null
  return decodeSidebarPreviewTarget(el.getAttribute(SIDEBAR_PREVIEW_ENTRY_ATTR))
}

export function useSidebarPreviewHover(opts: {
  onHover: (target: SidebarPreviewTarget | null) => void
}): { onMouseOver: React.MouseEventHandler<HTMLElement> } {
  const { onHover } = opts
  const onMouseOver = React.useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = (e.target as Element | null)?.closest?.(`[${SIDEBAR_PREVIEW_ENTRY_ATTR}]`)
      onHover(el ? decodeSidebarPreviewTarget(el.getAttribute(SIDEBAR_PREVIEW_ENTRY_ATTR)) : null)
    },
    [onHover],
  )
  return { onMouseOver }
}
