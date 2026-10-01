import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MIN_ROWS_DEFAULT,
  COMPOSER_MIN_ROWS_MAX,
  COMPOSER_MIN_ROWS_MIN,
  COMPOSER_RADIUS_DEFAULT,
  COMPOSER_RADIUS_MAX,
  COMPOSER_RADIUS_MIN,
  COMPOSER_WIDTH_PERCENT_DEFAULT,
  COMPOSER_WIDTH_PERCENT_MAX,
  COMPOSER_WIDTH_PERCENT_MIN,
  composerSideInsetPercent,
  normalizeComposerMinRows,
  normalizeComposerRadius,
  normalizeComposerWidthPercent,
} from './composerAppearance'

describe('normalizeComposerWidthPercent', () => {
  it('keeps in-range integer percents', () => {
    expect(normalizeComposerWidthPercent(80)).toBe(80)
    expect(normalizeComposerWidthPercent('60')).toBe(60)
    expect(normalizeComposerWidthPercent(79.6)).toBe(80)
  })

  it('clamps out-of-range percents', () => {
    expect(normalizeComposerWidthPercent(10)).toBe(COMPOSER_WIDTH_PERCENT_MIN)
    expect(normalizeComposerWidthPercent(999)).toBe(COMPOSER_WIDTH_PERCENT_MAX)
  })

  it('falls back to default for invalid values', () => {
    expect(normalizeComposerWidthPercent(undefined)).toBe(COMPOSER_WIDTH_PERCENT_DEFAULT)
    expect(normalizeComposerWidthPercent(null)).toBe(COMPOSER_WIDTH_PERCENT_DEFAULT)
    expect(normalizeComposerWidthPercent('')).toBe(COMPOSER_WIDTH_PERCENT_DEFAULT)
    expect(normalizeComposerWidthPercent('abc')).toBe(COMPOSER_WIDTH_PERCENT_DEFAULT)
  })
})

describe('normalizeComposerMinRows', () => {
  it('keeps in-range integer rows', () => {
    expect(normalizeComposerMinRows(3)).toBe(3)
    expect(normalizeComposerMinRows('5')).toBe(5)
  })

  it('clamps out-of-range rows', () => {
    expect(normalizeComposerMinRows(0)).toBe(COMPOSER_MIN_ROWS_MIN)
    expect(normalizeComposerMinRows(99)).toBe(COMPOSER_MIN_ROWS_MAX)
  })

  it('falls back to default for invalid values', () => {
    expect(normalizeComposerMinRows(undefined)).toBe(COMPOSER_MIN_ROWS_DEFAULT)
    expect(normalizeComposerMinRows('abc')).toBe(COMPOSER_MIN_ROWS_DEFAULT)
  })
})

describe('normalizeComposerRadius', () => {
  it('keeps in-range integer radii', () => {
    expect(normalizeComposerRadius(12)).toBe(12)
    expect(normalizeComposerRadius('0')).toBe(0)
  })

  it('clamps out-of-range radii', () => {
    expect(normalizeComposerRadius(-5)).toBe(COMPOSER_RADIUS_MIN)
    expect(normalizeComposerRadius(999)).toBe(COMPOSER_RADIUS_MAX)
  })

  it('falls back to default for invalid values', () => {
    expect(normalizeComposerRadius(undefined)).toBe(COMPOSER_RADIUS_DEFAULT)
    expect(normalizeComposerRadius('abc')).toBe(COMPOSER_RADIUS_DEFAULT)
  })
})

describe('composerSideInsetPercent', () => {
  it('splits the remaining space evenly on both sides', () => {
    expect(composerSideInsetPercent(80)).toBe(10)
    expect(composerSideInsetPercent(100)).toBe(0)
    expect(composerSideInsetPercent(40)).toBe(30)
  })

  it('normalizes the input before computing the inset', () => {
    expect(composerSideInsetPercent(undefined)).toBe((100 - COMPOSER_WIDTH_PERCENT_DEFAULT) / 2)
    expect(composerSideInsetPercent(999)).toBe(0)
  })
})
