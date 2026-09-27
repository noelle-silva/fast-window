import { describe, expect, it } from 'vitest'
import { defaultRequestRecordViewOptions, isRequestRecordViewOptionKey, normalizeRequestRecordViewOptions, setRequestRecordViewOption } from './requestRecordViewOptions'

describe('requestRecordViewOptions', () => {
  it('defaults match the current viewing shape', () => {
    expect(defaultRequestRecordViewOptions()).toEqual({
      requestReasoningOpen: false,
      requestToolCallsOpen: false,
      requestToolResultsOpen: false,
      requestToolsOpen: true,
      responseReasoningOpen: false,
      responseToolCallsOpen: false,
    })
  })

  it('normalizes partial and invalid values', () => {
    expect(normalizeRequestRecordViewOptions(null)).toEqual(defaultRequestRecordViewOptions())
    expect(normalizeRequestRecordViewOptions({ responseReasoningOpen: true, bogus: 1 })).toEqual({ ...defaultRequestRecordViewOptions(), responseReasoningOpen: true })
    expect(normalizeRequestRecordViewOptions({ requestToolsOpen: 'yes' })).toEqual(defaultRequestRecordViewOptions())
  })

  it('sets a single option immutably', () => {
    const current = defaultRequestRecordViewOptions()
    const next = setRequestRecordViewOption(current, 'requestReasoningOpen', true)
    expect(next.requestReasoningOpen).toBe(true)
    expect(current.requestReasoningOpen).toBe(false)
  })

  it('validates keys', () => {
    expect(isRequestRecordViewOptionKey('requestToolsOpen')).toBe(true)
    expect(isRequestRecordViewOptionKey('nope')).toBe(false)
  })
})
