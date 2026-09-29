import { describe, expect, it } from 'vitest'
import { cloneConfigObject, isIndexSegment, normalizeConfigPath, removeConfigValueAtPath, setConfigValueAtPath } from './toolConfigDraft'

describe('setConfigValueAtPath', () => {
  it('sets object keys without touching the source draft', () => {
    const source = { maxOutputChars: 100 }
    const next = setConfigValueAtPath(source, ['repo'], 'notes')
    expect(next).toEqual({ maxOutputChars: 100, repo: 'notes' })
    expect(source).toEqual({ maxOutputChars: 100 })
  })

  it('creates nested objects along the path', () => {
    expect(setConfigValueAtPath({}, ['a', 'b', 'c'], 1)).toEqual({ a: { b: { c: 1 } } })
  })

  it('writes array rows by index and auto-creates arrays for index segments', () => {
    const draft = { repos: [{ id: 'a' }, { id: 'b' }] }
    expect(setConfigValueAtPath(draft, ['repos', '1', 'id'], 'b2')).toEqual({ repos: [{ id: 'a' }, { id: 'b2' }] })
    expect(setConfigValueAtPath({}, ['repos', '0', 'id'], 'a')).toEqual({ repos: [{ id: 'a' }] })
  })

  it('keeps arrays as arrays when editing a row field (regression)', () => {
    const next = setConfigValueAtPath({ repos: [{}] }, ['repos', '0', 'id'], 'm')
    expect(Array.isArray(next.repos)).toBe(true)
    expect(next).toEqual({ repos: [{ id: 'm' }] })
  })

  it('accepts dotted string paths', () => {
    expect(setConfigValueAtPath({}, 'repos.0.id', 'a')).toEqual({ repos: [{ id: 'a' }] })
  })

  it('replaces whole arrays', () => {
    const draft = { repos: [{ id: 'a' }] }
    expect(setConfigValueAtPath(draft, ['repos'], [{ id: 'x' }, { id: 'y' }])).toEqual({ repos: [{ id: 'x' }, { id: 'y' }] })
  })
})

describe('removeConfigValueAtPath', () => {
  it('deletes object keys', () => {
    expect(removeConfigValueAtPath({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
  })

  it('splices array rows and shifts the rest', () => {
    const draft = { repos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    expect(removeConfigValueAtPath(draft, ['repos', '1'])).toEqual({ repos: [{ id: 'a' }, { id: 'c' }] })
  })

  it('removes one field inside a row without touching the array (regression)', () => {
    const draft = { repos: [{ id: 'a', key: 'k' }] }
    expect(removeConfigValueAtPath(draft, ['repos', '0', 'key'])).toEqual({ repos: [{ id: 'a' }] })
  })

  it('ignores out-of-range indexes and broken paths', () => {
    const draft = { repos: [{ id: 'a' }], name: 'x' }
    expect(removeConfigValueAtPath(draft, ['repos', '9'])).toEqual(draft)
    expect(removeConfigValueAtPath(draft, ['name', 'deep'])).toEqual(draft)
  })
})

describe('cloneConfigObject and path helpers', () => {
  it('deep clones plain objects', () => {
    const source = { repos: [{ id: 'a' }] }
    const copy = cloneConfigObject(source)
    copy.repos[0].id = 'b'
    expect(source.repos[0].id).toBe('a')
  })

  it('treats only digit segments as indexes', () => {
    expect(isIndexSegment('0')).toBe(true)
    expect(isIndexSegment('12')).toBe(true)
    expect(isIndexSegment('-1')).toBe(false)
    expect(isIndexSegment('a')).toBe(false)
  })

  it('normalizes array and dotted string paths', () => {
    expect(normalizeConfigPath([' repos ', '0', ' id '])).toEqual(['repos', '0', 'id'])
    expect(normalizeConfigPath('repos.0.id')).toEqual(['repos', '0', 'id'])
  })
})
