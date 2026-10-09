import { describe, expect, it } from 'vitest'

import { isExternalHref } from './externalLinkGuard'

const BASE = 'http://tauri.localhost/index.html'

describe('isExternalHref', () => {
  it('同源 http 视为内部', () => {
    expect(isExternalHref('http://tauri.localhost/settings', BASE)).toBe(false)
  })

  it('同源相对路径视为内部', () => {
    expect(isExternalHref('/note/1', BASE)).toBe(false)
  })

  it('锚点视为内部', () => {
    expect(isExternalHref('#section', BASE)).toBe(false)
  })

  it('跨源 http 视为外部', () => {
    expect(isExternalHref('https://example.com/a', BASE)).toBe(true)
  })

  it('同主机不同端口视为外部', () => {
    expect(isExternalHref('http://tauri.localhost:8080/a', BASE)).toBe(true)
  })

  it('mailto 与 tel 视为外部', () => {
    expect(isExternalHref('mailto:someone@example.com', BASE)).toBe(true)
    expect(isExternalHref('tel:+8613800000000', BASE)).toBe(true)
  })

  it('内部协议视为内部', () => {
    expect(isExternalHref('tauri://localhost/a', BASE)).toBe(false)
    expect(isExternalHref('asset://localhost/b.png', BASE)).toBe(false)
  })

  it('空值与不可解析值视为内部', () => {
    expect(isExternalHref('', BASE)).toBe(false)
    expect(isExternalHref('   ', BASE)).toBe(false)
  })
})
