import { describe, expect, it } from 'vitest'
import { preprocessAssistantContent, tokenizeFences } from './preprocess'

describe('streaming Mermaid fence handling', () => {
  it('keeps an unfinished Mermaid fence out of the render marker path', () => {
    const result = preprocessAssistantContent('```mermaid\ngraph TD\n  A --> B')

    expect(result.mermaid).toEqual([])
    expect(result.text).toContain('```mermaid')
    expect(tokenizeFences('```mermaid\ngraph TD\n  A --> B')[0]).toMatchObject({ closed: false, lang: 'mermaid' })
  })

  it('extracts only a closed Mermaid fence for the renderer', () => {
    const result = preprocessAssistantContent('```mermaid\ngraph TD\n  A --> B\n```')

    expect(result.mermaid).toEqual(['graph TD\n  A --> B'])
    expect(result.text).toContain('@@MERMAID_0@@')
    expect(result.text).not.toContain('```mermaid')
  })
})
