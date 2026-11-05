import { describe, expect, it } from 'vitest'
import {
  normalizeWorkspaceIcon,
  parseWorkspaceIconBaseline,
  sameWorkspaceIcon,
  workspaceIconBaseline,
  workspaceIconFromDraft,
  workspaceIconImageSrc,
} from './workspaceIcon'

describe('工作区图标归一化', () => {
  it('图像载体只认 data URL，SVG 载体只认源码', () => {
    expect(normalizeWorkspaceIcon({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' })).toEqual({
      kind: 'image',
      svg: '',
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(normalizeWorkspaceIcon({ kind: 'svg', svg: '<svg/>' })).toEqual({ kind: 'svg', svg: '<svg/>', dataUrl: '' })
  })

  it('缺字段、未知载体与形态不符一律视为没有图标', () => {
    expect(normalizeWorkspaceIcon(null)).toBeNull()
    expect(normalizeWorkspaceIcon({})).toBeNull()
    expect(normalizeWorkspaceIcon({ kind: 'font', svg: '<svg/>' })).toBeNull()
    expect(normalizeWorkspaceIcon({ kind: 'image', dataUrl: 'https://example.com/a.png' })).toBeNull()
    expect(normalizeWorkspaceIcon({ kind: 'svg', svg: '   ' })).toBeNull()
  })
})

describe('工作区图标渲染地址', () => {
  it('两种载体都收成一个 <img src> 可用的地址', () => {
    expect(workspaceIconImageSrc({ kind: 'image', svg: '', dataUrl: 'data:image/png;base64,AAAA' })).toBe(
      'data:image/png;base64,AAAA',
    )
    const svgSrc = workspaceIconImageSrc({ kind: 'svg', svg: '<svg><path d="M0 0"/></svg>', dataUrl: '' })
    expect(svgSrc.startsWith('data:image/svg+xml')).toBe(true)
    expect(svgSrc).toContain(encodeURIComponent('<svg><path d="M0 0"/></svg>'))
    expect(workspaceIconImageSrc(null)).toBe('')
  })
})

describe('工作区图标草稿', () => {
  it('草稿三种载体字段收成一个图标事实', () => {
    expect(workspaceIconFromDraft('', '', '')).toBeNull()
    expect(workspaceIconFromDraft('svg', '<svg/>', '')).toEqual({ kind: 'svg', svg: '<svg/>', dataUrl: '' })
    expect(workspaceIconFromDraft('image', '', 'data:image/webp;base64,BBBB')).toEqual({
      kind: 'image',
      svg: '',
      dataUrl: 'data:image/webp;base64,BBBB',
    })
    // 载体切换后残留的另一半字段不参与判定。
    expect(workspaceIconFromDraft('image', '<svg/>', 'data:image/png;base64,AAAA')).toEqual({
      kind: 'image',
      svg: '',
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(workspaceIconFromDraft('svg', '  ', 'data:image/png;base64,AAAA')).toBeNull()
  })
})

describe('工作区图标基线', () => {
  it('序列化与反序列化对称，无图标为空基线', () => {
    const icon = { kind: 'svg' as const, svg: '<svg/>', dataUrl: '' }
    expect(parseWorkspaceIconBaseline(workspaceIconBaseline(icon))).toEqual(icon)
    expect(workspaceIconBaseline(null)).toBe('')
    expect(parseWorkspaceIconBaseline('')).toBeNull()
    expect(parseWorkspaceIconBaseline('not-json')).toBeNull()
  })

  it('同载体同内容视为相同，不同内容视为不同', () => {
    const icon = { kind: 'svg' as const, svg: '<svg/>', dataUrl: '' }
    expect(sameWorkspaceIcon(icon, { ...icon })).toBe(true)
    expect(sameWorkspaceIcon(icon, { kind: 'svg', svg: '<svg id="a"/>', dataUrl: '' })).toBe(false)
    expect(sameWorkspaceIcon(null, null)).toBe(true)
    expect(sameWorkspaceIcon(icon, null)).toBe(false)
  })
})
