import * as React from 'react'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { ChatComposer } from '../composer/ChatComposer'

// 输入区表面：内部订阅 composer 范围，外层稳定 props 阻断父级无关重渲染。
export const ComposerSurface = React.memo(function ComposerSurface(
  props: React.ComponentProps<typeof ChatComposer>,
) {
  useRenderProbe('composer')
  return <ChatComposer {...props} />
})
