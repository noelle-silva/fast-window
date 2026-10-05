import { describe, expect, it } from 'vitest'
import {
  EMPTY_ASSET_FILTERS,
  EMPTY_NOTE_FILTERS,
  assetFiltersSignature,
  buildAssetSearchQuery,
  buildNoteSearchQuery,
  bytesToKbInput,
  dateInputToEndMs,
  dateInputToStartMs,
  hasAssetFilters,
  hasNoteFilters,
  kbInputToBytes,
  msToDateInput,
  noteFiltersSignature,
  toggleInList,
  type AssetSearchFilters,
  type NoteSearchFilters,
} from './quickSearchFilters'

function noteFilters(over: Partial<NoteSearchFilters> = {}): NoteSearchFilters {
  return { ...EMPTY_NOTE_FILTERS, ...over }
}

function assetFilters(over: Partial<AssetSearchFilters> = {}): AssetSearchFilters {
  return { ...EMPTY_ASSET_FILTERS, ...over }
}

describe('empty filter constants', () => {
  it('exposes the default empty note filters', () => {
    expect(EMPTY_NOTE_FILTERS).toEqual({ fields: [], faceKinds: [], folderId: '', updatedFromMs: 0, updatedToMs: 0 })
  })

  it('exposes the default empty asset filters', () => {
    expect(EMPTY_ASSET_FILTERS).toEqual({ fields: [], kind: '', sizeFrom: 0, sizeTo: 0, updatedFromMs: 0, updatedToMs: 0 })
  })
})

describe('hasNoteFilters', () => {
  it('is false for the empty set', () => {
    expect(hasNoteFilters(EMPTY_NOTE_FILTERS)).toBe(false)
  })

  it.each([
    [{ folderId: 'g' }],
    [{ fields: ['title'] }],
    [{ faceKinds: ['markdown'] }],
    [{ updatedFromMs: 1 }],
    [{ updatedToMs: 1 }],
  ])('is true when any note filter is set %o', over => {
    expect(hasNoteFilters(noteFilters(over))).toBe(true)
  })
})

describe('hasAssetFilters', () => {
  it('is false for the empty set', () => {
    expect(hasAssetFilters(EMPTY_ASSET_FILTERS)).toBe(false)
  })

  it.each([[{ kind: 'image' }], [{ sizeFrom: 1 }], [{ sizeTo: 1 }], [{ fields: ['name'] }]])(
    'is true when any asset filter is set %o',
    over => {
      expect(hasAssetFilters(assetFilters(over))).toBe(true)
    },
  )
})

describe('toggleInList', () => {
  it('removes a present value', () => {
    expect(toggleInList(['a', 'b'], 'b')).toEqual(['a'])
  })

  it('appends an absent value, preserving order', () => {
    expect(toggleInList(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })
})

describe('dateInputToStartMs / dateInputToEndMs', () => {
  it('returns 0 for blank or invalid input', () => {
    expect(dateInputToStartMs('')).toBe(0)
    expect(dateInputToStartMs('not-a-date')).toBe(0)
    expect(dateInputToEndMs('2024-13-45')).toBe(0)
  })

  it('spans one day minus one millisecond for the same date', () => {
    expect(dateInputToEndMs('2024-01-15') - dateInputToStartMs('2024-01-15')).toBe(86399999)
  })
})

describe('msToDateInput', () => {
  it('returns an empty string for zero, negative or non-finite values', () => {
    expect(msToDateInput(0)).toBe('')
    expect(msToDateInput(-5)).toBe('')
    expect(msToDateInput(NaN)).toBe('')
  })

  it('round-trips a start-of-day timestamp back to its date', () => {
    expect(msToDateInput(dateInputToStartMs('2024-01-15'))).toBe('2024-01-15')
  })
})

describe('kbInputToBytes', () => {
  it.each([
    ['2', 2048],
    ['0', 0],
    ['-3', 0],
    ['1.5', 1536],
    ['x', 0],
    ['', 0],
  ])('converts %s KB to %s bytes', (input, expected) => {
    expect(kbInputToBytes(input)).toBe(expected)
  })
})

describe('bytesToKbInput', () => {
  it.each([
    [2048, '2'],
    [0, ''],
    [1500, '1'],
  ])('converts %s bytes to %s KB input', (bytes, expected) => {
    expect(bytesToKbInput(bytes)).toBe(expected)
  })
})

describe('filter signatures', () => {
  it('produces a stable note signature', () => {
    expect(noteFiltersSignature('q', EMPTY_NOTE_FILTERS)).toBe(JSON.stringify(['q', [], [], '', 0, 0]))
  })

  it('produces a stable asset signature', () => {
    expect(assetFiltersSignature('q', EMPTY_ASSET_FILTERS)).toBe(JSON.stringify(['q', [], '', 0, 0, 0, 0]))
  })
})

describe('buildNoteSearchQuery', () => {
  it('trims the query and omits empty filters', () => {
    expect(buildNoteSearchQuery('  hi  ', noteFilters({ fields: ['title'] }), 5, 20)).toEqual({
      query: 'hi',
      fields: ['title'],
      limit: 20,
      offset: 5,
    })
  })

  it('omits every optional field for empty filters', () => {
    expect(buildNoteSearchQuery('', EMPTY_NOTE_FILTERS, 0, 10)).toEqual({ query: '', limit: 10, offset: 0 })
  })
})

describe('buildAssetSearchQuery', () => {
  it('trims the query and omits empty filters', () => {
    expect(buildAssetSearchQuery('', EMPTY_ASSET_FILTERS, 0, 10)).toEqual({ query: '', limit: 10, offset: 0 })
  })

  it('keeps populated filters', () => {
    expect(buildAssetSearchQuery('pic', assetFilters({ fields: ['name'], kind: 'image', sizeFrom: 1, sizeTo: 2, updatedFromMs: 3, updatedToMs: 4 }), 1, 2)).toEqual({
      query: 'pic',
      fields: ['name'],
      kind: 'image',
      sizeFrom: 1,
      sizeTo: 2,
      updatedFromMs: 3,
      updatedToMs: 4,
      limit: 2,
      offset: 1,
    })
  })
})
