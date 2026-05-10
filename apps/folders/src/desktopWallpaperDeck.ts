import { CATEGORY_DEFINITIONS } from './categoryRegistry'
import type { CategoryWorkspaceView, DesktopWallpaperDeck } from './types'

export function wallpaperDeckWithWorkspace(current: DesktopWallpaperDeck | null, workspace: CategoryWorkspaceView): DesktopWallpaperDeck {
  const categories = (current?.categories.length ? current.categories : CATEGORY_DEFINITIONS.map(category => ({ categoryId: category.id })))
    .map(category => category.categoryId === workspace.id ? { ...category, wallpaper: workspace.desktop.wallpaper } : category)
  return {
    schemaVersion: current?.schemaVersion ?? workspace.schemaVersion,
    dataVersion: current?.dataVersion ?? workspace.dataVersion,
    categories,
  }
}

export function wallpaperDeckFromWorkspace(workspace: CategoryWorkspaceView): DesktopWallpaperDeck {
  return wallpaperDeckWithWorkspace(null, workspace)
}
