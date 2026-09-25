import * as React from 'react'

import { createMarkdownRenderEngine } from '../../render/engine'
import { usePreviewController } from '../../ui/preview/usePreviewController'
import type { FaceViewContext } from '../protocol'

/**
 * markdown 面运行时：渲染引擎 + 预览控制器。
 * 阅读视窗与编辑视窗共用同一装配，避免两份初始化各自漂移。
 */
export function useMarkdownFaceRuntime(context: FaceViewContext) {
  const engineRef = React.useRef<ReturnType<typeof createMarkdownRenderEngine> | null>(null)
  if (!engineRef.current) {
    engineRef.current = createMarkdownRenderEngine({
      clipboard: context.gateway.clipboard,
      host: context.gateway.host,
      assets: context.gateway.assets,
      scope: context.scope,
    })
  }
  React.useEffect(() => {
    if (engineRef.current) engineRef.current.noteIndex = context.noteIndexMap
  }, [context.noteIndexMap])

  const sanitizeSvg = React.useCallback((svg: unknown) => engineRef.current?.sanitizeSvg(svg, 'baseline') ?? '', [])
  const preview = usePreviewController({ toast: context.gateway.host.toast, sanitizeSvg })
  return { engineRef, preview }
}
