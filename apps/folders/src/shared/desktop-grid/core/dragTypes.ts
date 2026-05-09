export type DesktopGridDragMode = 'reflow' | 'overlay'

export type DesktopGridDragModifiers = {
  ctrlKey: boolean
}

export type DesktopGridDragEndResult = boolean | { handled: boolean; clearReleaseLayouts?: boolean }
