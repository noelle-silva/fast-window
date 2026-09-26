import * as React from 'react'

import { createMarkdownRenderEngine, type MarkdownRenderEngine } from './render/engine'
import { useMarkdownPreview } from './useMarkdownPreview'
import type { FaceViewContext } from '../protocol'

/**
 * markdown 面运行时：渲染引擎 + 预览控制器。
 * 阅读视窗与编辑视窗共用同一装配，避免两份初始化各自漂移。
 */
export function useMarkdownFaceRuntime(context: FaceViewContext): {
  engine: MarkdownRenderEngine
  engineRef: React.MutableRefObject<MarkdownRenderEngine | null>
  preview: ReturnType<typeof useMarkdownPreview>
} {
  const engineRef = React.useRef<MarkdownRenderEngine | null>(null)
  let engine = engineRef.current
  if (!engine) {
    engine = createMarkdownRenderEngine({
      clipboard: context.gateway.clipboard,
      host: context.gateway.host,
      assets: context.gateway.assets,
      scope: context.scope,
    })
    engineRef.current = engine
  }
  React.useEffect(() => {
    engine.noteIndex = context.noteIndexMap
  }, [engine, context.noteIndexMap])

  const sanitizeSvg = React.useCallback((svg: unknown) => engineRef.current?.sanitizeSvg(svg, 'baseline') ?? '', [])
  const preview = useMarkdownPreview({ toast: context.gateway.host.toast, sanitizeSvg })
  return { engine, engineRef, preview }
}
