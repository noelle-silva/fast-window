import * as React from 'react'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { SvgIconProps } from '@mui/material/SvgIcon'
import type { Api, VaultScope } from '../../core'
import { createMarkdownRenderEngine } from '../../render/engine'
import type { AssetEntry } from '../../assetTypes'

export type AssetPreviewKind = 'image' | 'video' | 'pdf' | 'word' | 'unsupported'

export type AssetPreviewContext = {
  api: Api
  scope: VaultScope
  asset: AssetEntry
  blobUrl: string
  title: string
}

export type AssetPreviewDescriptor = {
  kind: AssetPreviewKind
  label: string
  color: string
  canOpenInTab: boolean
  icon: React.ComponentType<SvgIconProps>
  Reader?: React.ComponentType<AssetPreviewContext>
}

type AssetPreviewRule = {
  kind: AssetPreviewKind
  label: string
  color: string
  icon: React.ComponentType<SvgIconProps>
  match: (asset: AssetEntry) => boolean
  Reader?: React.ComponentType<AssetPreviewContext>
}

function normalizeExt(ext: unknown): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '')
}

function ImageAssetReader({ blobUrl, title }: AssetPreviewContext) {
  return (
    <img
      src={blobUrl}
      alt={title}
      style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
    />
  )
}

let assetPreviewRenderEngine: ReturnType<typeof createMarkdownRenderEngine> | null = null

export function sanitizeAssetPreviewHtml(html: unknown): string {
  if (!assetPreviewRenderEngine) {
    assetPreviewRenderEngine = createMarkdownRenderEngine({ scope: 'library' })
  }
  return assetPreviewRenderEngine.sanitizeHtml(html, 'baseline')
}

const ASSET_PREVIEW_RULES: AssetPreviewRule[] = [
  {
    kind: 'image',
    label: '图片',
    color: '#1976d2',
    icon: ImageRoundedIcon,
    match: asset => asset.kind === 'image',
    Reader: ImageAssetReader,
  },
  {
    kind: 'video',
    label: '视频',
    color: '#7b1fa2',
    icon: VideoFileRoundedIcon,
    match: asset => asset.kind === 'video',
  },
  {
    kind: 'pdf',
    label: 'PDF',
    color: '#d32f2f',
    icon: PictureAsPdfRoundedIcon,
    match: asset => normalizeExt(asset.ext) === 'pdf',
  },
  {
    kind: 'word',
    label: 'Word',
    color: '#1565c0',
    icon: ArticleRoundedIcon,
    match: asset => normalizeExt(asset.ext) === 'docx',
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
    }
  }

  return {
    kind: 'unsupported',
    label: '文件',
    color: '#546e7a',
    icon: InsertDriveFileRoundedIcon,
    canOpenInTab: false,
  }
}

export function isAssetOpenableInTab(asset: AssetEntry): boolean {
  return getAssetPreviewDescriptor(asset).canOpenInTab
}
