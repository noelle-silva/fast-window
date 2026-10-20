// @vitest-environment happy-dom
//
// 流式 Mermaid 围栏行为：未闭合围栏保持草稿态，只有闭合后才进入成品渲染。
import { beforeAll, describe, expect, it } from 'vitest'
import { installRenderGlobals } from './testing/globals'
import { createRenderTestCapabilities } from './testing/capabilities'
import { renderInto, waitForAsyncSettle } from './testing/dom'
import { createUnifiedAssistantRenderEngine } from './unified/engine'

const OPTIONS = {
  stickersEnabled: false,
  getStickerPath: undefined,
  renderSafetyPolicy: 'unsafe' as const,
}

function makeEngine() {
  return createUnifiedAssistantRenderEngine(createRenderTestCapabilities())
}

describe('streaming Mermaid fence handling', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('未闭合的 Mermaid 围栏保持草稿态，不产出成品', async () => {
    const host = renderInto(makeEngine(), '```mermaid\ngraph TD\n  A --> B', OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('.mermaid-block[data-mermaid="1"]').length).toBe(0)
    host.remove()
  })

  it('闭合的 Mermaid 围栏进入成品渲染', async () => {
    const host = renderInto(makeEngine(), '```mermaid\ngraph TD\n  A --> B\n```', OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('.mermaid-block[data-mermaid="1"]').length).toBe(1)
    host.remove()
  })
})
