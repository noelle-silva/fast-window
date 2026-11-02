// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 架构约定守卫：App 级弹层必须位于「聊天层冻结子树」之外。
//
// 背景：Freeze 冻结时复用旧 children，会吞掉「关闭弹层 + 切页」同批次的更新，
// 使弹层 open 卡在 true、遮罩残留并拦截整页交互。
// 因此弹层（Portal 浮层，不属于页面内容）必须与页面冻结解耦。
const APP_SOURCE = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const SESSION_VIEWPORT_SOURCE = readFileSync(new URL('./surfaces/SessionViewport.tsx', import.meta.url), 'utf8')
const OVERLAY_SOURCE = readFileSync(new URL('./surfaces/OverlaySurface.tsx', import.meta.url), 'utf8')

const OVERLAY_COMPONENTS = [
  'ComposerImagePickerPopover',
  'MessageMenusDialogs',
  'ComposerControlsPopovers',
  'RolePickerPopover',
  'ChatPickerPopover',
  'ChatContextMenus',
  'FavoriteFoldersDialogs',
  'ChatSessionDialogs',
] as const

function frozenRegion(source: string): string {
  const anchor = source.indexOf('frozen={frozen}')
  expect(anchor).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('</Freeze>', anchor)
  expect(end).toBeGreaterThan(anchor)
  return source.slice(anchor, end)
}

describe('App 弹层与页面冻结解耦', () => {
  it('聊天冻结子树内不包含任何全局弹层', () => {
    const region = frozenRegion(SESSION_VIEWPORT_SOURCE)
    for (const name of OVERLAY_COMPONENTS) {
      expect(region).not.toContain('<' + name)
    }
  })

  it('全局弹层由 OverlaySurface 承载且自身不冻结', () => {
    for (const name of OVERLAY_COMPONENTS) {
      expect(OVERLAY_SOURCE).toContain('<' + name)
    }
    expect(OVERLAY_SOURCE).not.toContain('<Freeze')
  })

  it('OverlaySurface 渲染在 SessionViewport 之后', () => {
    expect(APP_SOURCE.indexOf('<OverlaySurface')).toBeGreaterThan(APP_SOURCE.indexOf('<SessionViewport'))
  })
})
