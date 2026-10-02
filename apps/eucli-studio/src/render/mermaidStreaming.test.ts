import { describe, expect, it } from 'vitest'
import { tokenizeFences } from './fences'
import { shapeContent } from './shaper'
import { createMermaidCapability } from './capabilities/mermaid'
import type { RenderContext } from './contract'
import type { AiChatCapabilities } from '../gateway/capabilities'

function makeCtx(): RenderContext {
  return {
    host: {} as HTMLElement,
    version: 1,
    isCurrent: () => true,
    policy: 'original',
    stickersEnabled: false,
    getStickerPath: null,
    capabilities: {} as AiChatCapabilities,
  }
}

const capability = createMermaidCapability({
  mermaidInited: { value: false },
  mermaidSvgCache: new Map(),
  capabilities: {} as AiChatCapabilities,
})

describe('streaming Mermaid fence handling', () => {
  it('keeps an unfinished Mermaid fence in draft state', () => {
    const shaped = shapeContent('```mermaid\ngraph TD\n  A --> B', makeCtx(), [capability])

    expect(shaped.claims).toEqual([])
    expect(shaped.text).toContain('```mermaid')
    expect(tokenizeFences('```mermaid\ngraph TD\n  A --> B')[0]).toMatchObject({ closed: false, lang: 'mermaid' })
  })

  it('claims only a closed Mermaid fence for the renderer', () => {
    const shaped = shapeContent('```mermaid\ngraph TD\n  A --> B\n```', makeCtx(), [capability])

    expect(shaped.claims.length).toBe(1)
    expect(shaped.claims[0]).toMatchObject({ capabilityId: 'mermaid', data: 'graph TD\n  A --> B' })
    expect(shaped.text).toContain('@@FW_mermaid_0@@')
    expect(shaped.text).not.toContain('```mermaid')
  })
})
