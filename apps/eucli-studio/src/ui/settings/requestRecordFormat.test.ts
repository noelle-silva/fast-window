import { describe, expect, it } from 'vitest'
import { formatJsonText } from './requestRecordFormat'

describe('formatJsonText', () => {
  it('expands a compact json object with indentation', () => {
    const formatted = formatJsonText('{"model":"x","messages":[{"role":"user","content":"hi"}]}')
    expect(formatted).toBe(
      ['{', '  "model": "x",', '  "messages": [', '    {', '      "role": "user",', '      "content": "hi"', '    }', '  ]', '}'].join('\n'),
    )
  })

  it('expands a compact json array', () => {
    expect(formatJsonText('[1,2,3]')).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('tolerates leading and trailing whitespace', () => {
    expect(formatJsonText('  {"a":1}\n')).toBe('{\n  "a": 1\n}')
  })

  it('returns null for non-json text', () => {
    expect(formatJsonText('data: {"ok":true}')).toBeNull()
    expect(formatJsonText('plain text')).toBeNull()
  })

  it('returns null for invalid json', () => {
    expect(formatJsonText('{"a":}')).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(formatJsonText('')).toBeNull()
    expect(formatJsonText('   \n  ')).toBeNull()
  })

  it('returns null for json primitives', () => {
    expect(formatJsonText('123')).toBeNull()
    expect(formatJsonText('"quoted"')).toBeNull()
    expect(formatJsonText('true')).toBeNull()
  })
})
