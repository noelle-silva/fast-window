import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { desktopWallpaperFrame } from '../src/desktopWallpaperSurface.ts'

describe('desktop wallpaper surface geometry', () => {
  it('covers the frame and centers the cropped overflow', () => {
    const frame = desktopWallpaperFrame(1600, 1200, 960, 540, { x: 50, y: 50, scale: 1 })
    assert.equal(frame.width, 960)
    assert.equal(frame.height, 720)
    assert.equal(frame.offsetX, 0)
    assert.equal(frame.offsetY, -90)
    assert.equal(frame.originX, 480)
    assert.equal(frame.originY, 270)
    assert.equal(frame.scale, 1)
  })

  it('moves the crop window with the view position', () => {
    const top = desktopWallpaperFrame(1600, 1200, 960, 540, { x: 50, y: 0, scale: 1 })
    assert.equal(top.offsetY, 0)
    const bottom = desktopWallpaperFrame(1600, 1200, 960, 540, { x: 50, y: 100, scale: 1 })
    assert.equal(bottom.offsetY, -180)
  })

  it('keeps the transform origin on the view position', () => {
    const frame = desktopWallpaperFrame(1600, 1200, 960, 540, { x: 25, y: 75, scale: 2 })
    assert.equal(frame.originX, 240)
    assert.equal(frame.originY, 405)
    assert.equal(frame.scale, 2)
  })

  it('has no crop when the image aspect matches the frame', () => {
    const frame = desktopWallpaperFrame(1920, 1080, 960, 540, { x: 0, y: 100, scale: 1 })
    assert.equal(frame.width, 960)
    assert.equal(frame.height, 540)
    assert.equal(frame.offsetX, 0)
    assert.equal(frame.offsetY, 0)
  })

  it('crops a portrait image vertically', () => {
    const frame = desktopWallpaperFrame(800, 1200, 960, 540, { x: 50, y: 50, scale: 1 })
    assert.equal(frame.width, 960)
    assert.equal(frame.height, 1440)
    assert.equal(frame.offsetX, 0)
    assert.equal(frame.offsetY, -450)
  })

  it('normalizes out of range view values', () => {
    const frame = desktopWallpaperFrame(1600, 1200, 960, 540, { x: -20, y: 140, scale: 9 })
    assert.equal(frame.offsetX, 0)
    assert.equal(frame.offsetY, -180)
    assert.equal(frame.originX, 0)
    assert.equal(frame.originY, 540)
    assert.equal(frame.scale, 4)
  })

  it('supports fractional view scales', () => {
    const frame = desktopWallpaperFrame(2000, 1000, 1000, 400, { x: 30, y: 70, scale: 1.5 })
    assert.equal(frame.width, 1000)
    assert.equal(frame.height, 500)
    assert.equal(frame.offsetY, -70)
    assert.equal(frame.originX, 300)
    assert.equal(frame.originY, 280)
    assert.equal(frame.scale, 1.5)
  })

  it('returns an empty frame for degenerate image sizes', () => {
    const frame = desktopWallpaperFrame(0, 1200, 960, 540, { x: 50, y: 50, scale: 1 })
    assert.equal(frame.width, 0)
    assert.equal(frame.height, 0)
  })

  it('returns an empty frame for degenerate frame sizes', () => {
    const frame = desktopWallpaperFrame(1600, 1200, 0, 0, { x: 50, y: 50, scale: 1 })
    assert.equal(frame.width, 0)
    assert.equal(frame.height, 0)
  })
})
