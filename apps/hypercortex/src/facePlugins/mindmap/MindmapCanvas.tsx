import * as React from 'react'

import { parseMindmapForRender, serializeMindmap } from './mindmapContent'
import { MindMap } from './mindmapEngine'
import { buildMindmapNodeContent } from './mindmapNodeRefs'
import { mindmapThemeConfig } from './mindmapTheme'
import { MindmapFloatingToolbar } from './toolbar'

export type MindmapCanvasProps = {
  content: string
  readonly: boolean
  layout: string
  theme: string
  scale: number
  visible?: boolean
  onContentChange?: (next: string) => void
  onOpenRef?: (noteId: string, faceId?: string) => void
  resolveRefTitle?: (noteId: string) => string
  onSelectLayout?: (layout: string) => void
  onSelectTheme?: (theme: string) => void
}

type MindMapNodeLike = { getData: (key: string) => unknown }

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const CANVAS_MIN_HEIGHT = 520

/**
 * 思维导图面画布：内嵌导图库实例，并在画布内提供悬浮工具条。
 * 编辑态双向同步内容；阅读态只读渲染，并把节点文本里的引用渲染为可点击链接。
 * 导图库要求容器有非零尺寸才能初始化，因此先等容器就绪再实例化。
 */
export function MindmapCanvas(props: MindmapCanvasProps): React.ReactNode {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mindRef = React.useRef<MindMap | null>(null)
  const lastSentRef = React.useRef('')
  const propsRef = React.useRef(props)
  propsRef.current = props
  const [viewScale, setViewScale] = React.useState(props.scale)
  // 当前选中节点数（导图库节点激活态）：决定悬浮工具条「添加子节点」是否可用。
  const [activeNodeCount, setActiveNodeCount] = React.useState(0)
  // 最近一次选中的节点标识：空白单击会先清空选中，双击空白新增时据此定位父节点。
  const lastActiveUidRef = React.useRef('')

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let mind: MindMap | null = null
    let frame = 0
    let observer: ResizeObserver | null = null

    // 双击空白处：在最近选中的节点（缺省根节点）下新增子节点；节点双击由导图库自行阻止冒泡。
    const handleBlankDblclick = () => {
      const current = mindRef.current
      if (!current || propsRef.current.readonly) return
      const uid = lastActiveUidRef.current
      const anchor = (uid ? current.renderer?.findNodeByUid?.(uid) : null) || current.renderer?.root || null
      if (!anchor) return
      current.execCommand('INSERT_CHILD_NODE', true, [anchor])
    }

    const init = () => {
      if (mind || el.clientWidth <= 0 || el.clientHeight <= 0) return
      const initial = propsRef.current
      const readonly = initial.readonly
      try {
        mind = new MindMap({
          el,
          data: parseMindmapForRender(initial.content),
          readonly,
          layout: initial.layout,
          theme: 'default',
          themeConfig: mindmapThemeConfig(initial.theme),
          mousewheelAction: 'zoom',
          mousewheelZoomActionReverse: true,
          // 左键：拖拽节点 / 空白处框选多选；右键：拖动画布。
          useLeftKeySelectionRightKeyDrag: true,
          isUseCustomNodeContent: readonly,
          customCreateNodeContent: readonly
            ? (node: MindMapNodeLike) =>
                buildMindmapNodeContent(
                  String(node.getData('text') ?? ''),
                  noteId => propsRef.current.resolveRefTitle?.(noteId) || noteId,
                )
            : undefined,
        })
      } catch {
        mind = null
        return
      }
      mindRef.current = mind
      lastSentRef.current = initial.content

      mind.on('data_change', (data: unknown) => {
        if (propsRef.current.readonly) return
        const next = serializeMindmap(data)
        lastSentRef.current = next
        propsRef.current.onContentChange?.(next)
      })
      mind.on('scale', () => {
        const current = (mindRef.current as unknown as { view?: { scale?: number } })?.view?.scale
        if (typeof current === 'number' && Number.isFinite(current)) setViewScale(current)
      })
      mind.on('node_active', (_node: unknown, activeNodeList: unknown) => {
        const list = Array.isArray(activeNodeList) ? activeNodeList : []
        setActiveNodeCount(list.length)
        const first = list[0] as MindMapNodeLike | undefined
        const uid = String(first?.getData?.('uid') ?? '')
        if (uid) lastActiveUidRef.current = uid
      })

      if (readonly) {
        bindRefLinkClicks(el, propsRef)
        mind.on('node_tree_render_end', () => {
          bindRefLinkClicks(el, propsRef)
        })
      } else {
        el.addEventListener('dblclick', handleBlankDblclick)
      }

      frame = window.requestAnimationFrame(() => {
        try {
          mind?.view.setScale(initial.scale)
        } catch {
          /* 缩放失败不影响渲染 */
        }
        setViewScale(initial.scale)
      })

      observer?.disconnect()
      observer = null
    }

    init()
    if (!mind) {
      observer = new ResizeObserver(() => init())
      observer.observe(el)
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      el.removeEventListener('dblclick', handleBlankDblclick)
      mind?.destroy?.()
      mindRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const mind = mindRef.current
    if (!mind) return
    if (props.content === lastSentRef.current) return
    lastSentRef.current = props.content
    mind.setData(parseMindmapForRender(props.content))
  }, [props.content])

  React.useEffect(() => {
    mindRef.current?.setLayout(props.layout)
  }, [props.layout])

  React.useEffect(() => {
    mindRef.current?.setThemeConfig(mindmapThemeConfig(props.theme))
  }, [props.theme])

  React.useEffect(() => {
    try {
      mindRef.current?.view.setScale(props.scale)
    } catch {
      /* 缩放失败不影响渲染 */
    }
    setViewScale(props.scale)
  }, [props.scale])

  React.useEffect(() => {
    if (!props.visible) return
    const mind = mindRef.current
    if (!mind) return
    const frame = window.requestAnimationFrame(() => {
      try {
        mind.render?.()
      } catch {
        /* 重渲染失败忽略 */
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [props.visible])

  const applyScale = React.useCallback((next: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 10) / 10))
    try {
      mindRef.current?.view.setScale(clamped)
    } catch {
      /* 缩放失败不影响渲染 */
    }
    setViewScale(clamped)
  }, [])

  // 悬浮工具条「添加子节点」：作用于当前选中节点，未选中时按钮置灰不可用。
  const handleAddChild = React.useCallback(() => {
    mindRef.current?.execCommand('INSERT_CHILD_NODE')
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: CANVAS_MIN_HEIGHT }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
        <MindmapFloatingToolbar
          scale={viewScale}
          onZoomIn={() => applyScale(viewScale + 0.1)}
          onZoomOut={() => applyScale(viewScale - 0.1)}
          onResetZoom={() => applyScale(1)}
          onAddChild={props.readonly ? undefined : handleAddChild}
          addChildDisabled={activeNodeCount === 0}
          layout={props.layout}
          theme={props.theme}
          onSelectLayout={props.onSelectLayout}
          onSelectTheme={props.onSelectTheme}
        />
      </div>
    </div>
  )
}

function bindRefLinkClicks(el: HTMLElement, propsRef: React.MutableRefObject<MindmapCanvasProps>): void {
  if (el.dataset.mindmapRefClickBound === '1') return
  el.dataset.mindmapRefClickBound = '1'
  el.addEventListener(
    'click',
    event => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a[data-mindmap-ref-note]') as HTMLElement | null
      if (!anchor) return
      event.preventDefault()
      event.stopPropagation()
      const noteId = anchor.getAttribute('data-mindmap-ref-note') || ''
      const faceId = anchor.getAttribute('data-mindmap-ref-face') || undefined
      if (noteId) propsRef.current.onOpenRef?.(noteId, faceId)
    },
    true,
  )
}
