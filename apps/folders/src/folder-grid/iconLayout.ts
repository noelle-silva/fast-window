import type { DesktopIconLayout } from '../types'
import {
  FOLDER_GRID_GAP,
  FOLDER_GRID_ITEM_HEIGHT,
  FOLDER_GRID_ITEM_WIDTH,
  FOLDER_GRID_MIN_HEIGHT,
  FOLDER_GRID_PADDING,
} from './constants'
import { DESKTOP_ICON_SURFACE_RADIUS, DESKTOP_ICON_SURFACE_SIZE } from './desktopIconTokens'

export const DESKTOP_ICON_GAP_MIN = 0
export const DESKTOP_ICON_GAP_MAX = 64
export const DESKTOP_ICON_GAP_STEP = 2
export const DESKTOP_ICON_SCALE_MIN = 0.75
export const DESKTOP_ICON_SCALE_MAX = 1.35
export const DESKTOP_ICON_SCALE_STEP = 0.05

export const DEFAULT_DESKTOP_ICON_LAYOUT: DesktopIconLayout = {
  rowGap: FOLDER_GRID_GAP,
  columnGap: FOLDER_GRID_GAP,
  iconScale: 1,
}

export type FolderGridMetrics = {
  cellHeight: number
  cellWidth: number
  containerPreviewGap: number
  containerPreviewPadding: number
  containerPreviewSize: number
  containerSurfaceRadius: number
  containerSurfaceSize: number
  contentWidth: number
  detailFontSize: number
  iconRadius: number
  iconScale: number
  iconSize: number
  itemHeight: number
  itemWidth: number
  columnGap: number
  menuRight: number
  menuSize: number
  menuTop: number
  minHeight: number
  padding: number
  removeRight: number
  rowGap: number
  signature: string
  titleFontSize: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 0): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function scaled(value: number, scale: number, min = 1): number {
  return Math.max(min, Math.round(value * scale))
}

export function normalizeDesktopIconLayout(layout: Partial<DesktopIconLayout> | null | undefined): DesktopIconLayout {
  const rawRowGap = Number(layout?.rowGap ?? DEFAULT_DESKTOP_ICON_LAYOUT.rowGap)
  const rawColumnGap = Number(layout?.columnGap ?? DEFAULT_DESKTOP_ICON_LAYOUT.columnGap)
  const rawScale = Number(layout?.iconScale ?? DEFAULT_DESKTOP_ICON_LAYOUT.iconScale)
  const rowGap = Number.isFinite(rawRowGap)
    ? clamp(Math.round(rawRowGap), DESKTOP_ICON_GAP_MIN, DESKTOP_ICON_GAP_MAX)
    : DEFAULT_DESKTOP_ICON_LAYOUT.rowGap
  const columnGap = Number.isFinite(rawColumnGap)
    ? clamp(Math.round(rawColumnGap), DESKTOP_ICON_GAP_MIN, DESKTOP_ICON_GAP_MAX)
    : DEFAULT_DESKTOP_ICON_LAYOUT.columnGap
  const iconScale = Number.isFinite(rawScale)
    ? round(clamp(rawScale, DESKTOP_ICON_SCALE_MIN, DESKTOP_ICON_SCALE_MAX), 2)
    : DEFAULT_DESKTOP_ICON_LAYOUT.iconScale
  return { rowGap, columnGap, iconScale }
}

export function createFolderGridMetrics(layout: Partial<DesktopIconLayout> | null | undefined): FolderGridMetrics {
  const normalized = normalizeDesktopIconLayout(layout)
  const scale = normalized.iconScale
  const padding = FOLDER_GRID_PADDING
  const itemWidth = scaled(FOLDER_GRID_ITEM_WIDTH, scale)
  const itemHeight = scaled(FOLDER_GRID_ITEM_HEIGHT, scale)
  const cellWidth = itemWidth + normalized.columnGap
  const cellHeight = itemHeight + normalized.rowGap
  const minHeight = Math.max(FOLDER_GRID_MIN_HEIGHT, padding * 2 + itemHeight)
  const menuSize = scaled(28, scale, 22)

  return {
    cellHeight,
    cellWidth,
    containerPreviewGap: scaled(10, scale, 6),
    containerPreviewPadding: scaled(12, scale, 8),
    containerPreviewSize: scaled(34, scale, 24),
    containerSurfaceRadius: scaled(30, scale, 20),
    containerSurfaceSize: scaled(108, scale, 76),
    contentWidth: scaled(132, scale, 96),
    detailFontSize: round(clamp(10.5 * scale, 9, 14), 1),
    iconRadius: scaled(DESKTOP_ICON_SURFACE_RADIUS, scale, 18),
    iconScale: scale,
    iconSize: scaled(DESKTOP_ICON_SURFACE_SIZE, scale, 62),
    itemHeight,
    itemWidth,
    columnGap: normalized.columnGap,
    menuRight: scaled(18, scale, 8),
    menuSize,
    menuTop: scaled(4, scale, 3),
    minHeight,
    padding,
    removeRight: scaled(18, scale, 8),
    rowGap: normalized.rowGap,
    signature: `${normalized.rowGap}:${normalized.columnGap}:${scale}:${itemWidth}:${itemHeight}:${cellWidth}:${cellHeight}:${minHeight}`,
    titleFontSize: round(clamp(13.5 * scale, 11, 18), 1),
  }
}

export const DEFAULT_FOLDER_GRID_METRICS = createFolderGridMetrics(DEFAULT_DESKTOP_ICON_LAYOUT)
