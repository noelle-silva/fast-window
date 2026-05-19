import * as React from 'react'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { SvgIconProps } from '@mui/material/SvgIcon'
import type { AssetEntry } from '../../assetTypes'
import type { PreviewController } from '../preview/usePreviewController'
import { ImageAssetReader } from './ImageAssetReader'
import { VideoAssetReader } from './VideoAssetReader'
import { PdfAssetReader } from './PdfAssetReader'
import { WordAssetReader } from './WordAssetReader'
import { EpubAssetReader } from './EpubAssetReader'
import type { AssetPreviewToolbarHost } from './assetPreviewToolbar'

export type AssetPreviewKind = 'image' | 'video' | 'pdf' | 'word' | 'epub' | 'unsupported'
export type AssetPreviewToolbarSlot = 'none' | 'header'

export type AssetPreviewContext = {
  asset: AssetEntry
  blobUrl: string
  title: string
  previewController: PreviewController
  onPlayingChange?: (playing: boolean) => void
  toolbarHost?: AssetPreviewToolbarHost
}

export type AssetPreviewDescriptor = {
  kind: AssetPreviewKind
  label: string
  color: string
  canOpenInTab: boolean
  toolbarSlot: AssetPreviewToolbarSlot
  icon: React.ComponentType<SvgIconProps>
  Reader?: React.ComponentType<AssetPreviewContext>
}

type AssetPreviewRule = {
  kind: AssetPreviewKind
  label: string
  color: string
  toolbarSlot?: AssetPreviewToolbarSlot
  icon: React.ComponentType<SvgIconProps>
  match: (asset: AssetEntry) => boolean
  Reader: React.ComponentType<AssetPreviewContext>
}

function normalizeExt(ext: unknown): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '')
}

const ASSET_PREVIEW_RULES: AssetPreviewRule[] = [
  {
    kind: 'image',
    label: '图片',
    color: 'var(--hc-asset-image)',
    icon: ImageRoundedIcon,
    Reader: ImageAssetReader,
    match: asset => asset.kind === 'image',
  },
  {
    kind: 'video',
    label: '视频',
    color: 'var(--hc-asset-video)',
    icon: VideoFileRoundedIcon,
    Reader: VideoAssetReader,
    match: asset => asset.kind === 'video',
  },
  {
    kind: 'pdf',
    label: 'PDF',
    color: 'var(--hc-asset-pdf)',
    toolbarSlot: 'header',
    icon: PictureAsPdfRoundedIcon,
    Reader: PdfAssetReader,
    match: asset => normalizeExt(asset.ext) === 'pdf',
  },
  {
    kind: 'word',
    label: 'Word',
    color: 'var(--hc-asset-word)',
    icon: ArticleRoundedIcon,
    Reader: WordAssetReader,
    match: asset => normalizeExt(asset.ext) === 'docx',
  },
  {
    kind: 'epub',
    label: 'EPUB',
    color: 'var(--hc-asset-epub)',
    toolbarSlot: 'header',
    icon: MenuBookRoundedIcon,
    Reader: EpubAssetReader,
    match: asset => normalizeExt(asset.ext) === 'epub',
  },
]

export function getAssetPreviewDescriptor(asset: AssetEntry): AssetPreviewDescriptor {
  const rule = ASSET_PREVIEW_RULES.find(item => item.match(asset))
  if (rule) {
    return {
      kind: rule.kind,
      label: rule.label,
      color: rule.color,
      icon: rule.icon,
      Reader: rule.Reader,
      canOpenInTab: true,
      toolbarSlot: rule.toolbarSlot || 'none',
    }
  }

  return {
    kind: 'unsupported',
    label: '文件',
    color: 'var(--hc-asset-file)',
    icon: InsertDriveFileRoundedIcon,
    canOpenInTab: false,
    toolbarSlot: 'none',
  }
}

export function isAssetOpenableInTab(asset: AssetEntry): boolean {
  return getAssetPreviewDescriptor(asset).canOpenInTab
}
