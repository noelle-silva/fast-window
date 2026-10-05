import { describe, expect, it } from 'vitest'
import {
  createFavoritesNav,
  favoritesNavTrail,
  goBackFavoritesNav,
  goForwardFavoritesNav,
  navigateFavoritesNav,
  normalizeFavoritesNav,
  reconcileFavoritesNav,
  FAVORITES_NAV_ROOT,
} from './favoritesNavigator'
import type { HyperCortexFavoritesNavV1 } from '../core'

function nav(over: Partial<HyperCortexFavoritesNavV1> = {}): HyperCortexFavoritesNavV1 {
  return { currentFolderId: 'root', back: [], forward: [], ...over }
}

describe('createFavoritesNav', () => {
  it('starts at the root with empty history', () => {
    expect(createFavoritesNav()).toEqual({ currentFolderId: 'root', back: [], forward: [] })
    expect(FAVORITES_NAV_ROOT).toBe('root')
  })
})

describe('normalizeFavoritesNav', () => {
  it.each([null, undefined, 42, 'x', []])('falls back to a fresh nav for non-object input %s', input => {
    expect(normalizeFavoritesNav(input)).toEqual({ currentFolderId: 'root', back: [], forward: [] })
  })

  it('defaults a blank current folder to root', () => {
    expect(normalizeFavoritesNav({ currentFolderId: '  ' })).toEqual({ currentFolderId: 'root', back: [], forward: [] })
  })

  it('trims, dedupes and drops blank history entries', () => {
    const raw = { currentFolderId: 'g1', back: ['root', 'root', 'g0', '', '  ', 7, 'g0'], forward: 'bad' }
    expect(normalizeFavoritesNav(raw)).toEqual({ currentFolderId: 'g1', back: ['root', 'g0', '7'], forward: [] })
  })

  it('drops non-string stack entries', () => {
    expect(normalizeFavoritesNav({ currentFolderId: 'g2', back: null, forward: [null, 'x'] })).toEqual({
      currentFolderId: 'g2',
      back: [],
      forward: ['x'],
    })
  })

  it('caps each stack at 128 entries', () => {
    const back = Array.from({ length: 200 }, (_, i) => `f${i}`)
    expect(normalizeFavoritesNav({ currentFolderId: 'c', back }).back.length).toBe(128)
  })
})

describe('favoritesNavTrail', () => {
  it.each([
    [nav({ currentFolderId: 'root' }), ['root']],
    [nav({ currentFolderId: 'g2', back: ['root', 'g1'] }), ['root', 'g1', 'g2']],
    [nav({ currentFolderId: 'g1', back: ['root', 'g1', 'g2'] }), ['root', 'g1']],
    [nav({ currentFolderId: 'gX', back: ['g1', 'g2'] }), ['root', 'g1', 'g2', 'gX']],
    [nav({ currentFolderId: 'g2', back: ['g1', 'g2', 'g1'] }), ['root', 'g1', 'g2']],
  ])('builds the ancestor chain for %o', (state, expected) => {
    expect(favoritesNavTrail(state)).toEqual(expected)
  })
})

describe('navigateFavoritesNav', () => {
  it('returns the same state for a blank or identical target', () => {
    const state = nav({ currentFolderId: 'g1', back: ['root'], forward: ['g3'] })
    expect(navigateFavoritesNav(state, 'g1')).toBe(state)
    expect(navigateFavoritesNav(state, '  ')).toBe(state)
  })

  it('pushes the current folder onto back and clears forward', () => {
    const state = nav({ currentFolderId: 'g1', back: ['root'], forward: ['g3'] })
    expect(navigateFavoritesNav(state, ' g2 ')).toEqual({ currentFolderId: 'g2', back: ['root', 'g1'], forward: [] })
  })

  it('caps the back stack at 128 entries', () => {
    const back = Array.from({ length: 128 }, (_, i) => `f${i}`)
    expect(navigateFavoritesNav(nav({ currentFolderId: 'c', back }), 'next').back.length).toBe(128)
  })
})

describe('goBackFavoritesNav', () => {
  it('returns the same state when there is no back history', () => {
    const state = nav({ currentFolderId: 'root' })
    expect(goBackFavoritesNav(state)).toBe(state)
  })

  it('pops back into current and pushes current onto forward', () => {
    expect(goBackFavoritesNav(nav({ currentFolderId: 'g2', back: ['root', 'g1'] }))).toEqual({
      currentFolderId: 'g1',
      back: ['root'],
      forward: ['g2'],
    })
  })
})

describe('goForwardFavoritesNav', () => {
  it('returns the same state when there is no forward history', () => {
    const state = nav({ currentFolderId: 'root' })
    expect(goForwardFavoritesNav(state)).toBe(state)
  })

  it('pops forward into current and pushes current onto back', () => {
    expect(goForwardFavoritesNav(nav({ currentFolderId: 'g1', back: ['root'], forward: ['g3', 'g4'] }))).toEqual({
      currentFolderId: 'g4',
      back: ['root', 'g1'],
      forward: ['g3'],
    })
  })
})

describe('reconcileFavoritesNav', () => {
  const existing = new Set(['g1', 'g2'])

  it('returns the same state when nothing is stale', () => {
    const state = nav({ currentFolderId: 'g1', back: ['root', 'g1'], forward: ['g2'] })
    expect(reconcileFavoritesNav(state, existing)).toBe(state)
  })

  it('resets to root when the current folder is gone, keeping surviving history', () => {
    const state = nav({ currentFolderId: 'gX', back: ['root', 'g1', 'gX'], forward: ['g2', 'gY'] })
    expect(reconcileFavoritesNav(state, existing)).toEqual({
      currentFolderId: 'root',
      back: ['root', 'g1'],
      forward: ['g2'],
    })
  })

  it('filters stale history entries while keeping the current folder', () => {
    const state = nav({ currentFolderId: 'g1', back: ['root', 'gX'], forward: ['gY', 'g2'] })
    expect(reconcileFavoritesNav(state, existing)).toEqual({
      currentFolderId: 'g1',
      back: ['root'],
      forward: ['g2'],
    })
  })
})
