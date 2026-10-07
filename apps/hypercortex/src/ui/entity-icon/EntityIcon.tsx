import * as React from 'react'
import { Box } from '@mui/material'
import type { VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import { type EntityIcon as EntityIconModel, type EntityIconTargetKind } from '../../entityIcon'
import { sanitizeSvg } from '../../htmlSanitizer'
import { getLucideIcon } from './lucideCatalog'

// 全应用统一的「实体图标」渲染组件：凡显示图标处都经由它，
// 依据图标种类渲染：默认回退、图标库（lucide）、图片、SVG。
// 图片按 (作用域 + 目标 + 路径) 惰性读取并缓存，避免每处各写各的异步逻辑。

type EntityIconRuntime = { gateway: HyperCortexGateway; scope: VaultScope }

const EntityIconRuntimeContext = React.createContext<EntityIconRuntime | null>(null)

export function EntityIconRuntimeProvider(props: {
  gateway: HyperCortexGateway
  scope: VaultScope
  children: React.ReactNode
}): React.ReactNode {
  const value = React.useMemo(() => ({ gateway: props.gateway, scope: props.scope }), [props.gateway, props.scope])
  return <EntityIconRuntimeContext.Provider value={value}>{props.children}</EntityIconRuntimeContext.Provider>
}

export function useEntityIconRuntime(): EntityIconRuntime | null {
  return React.useContext(EntityIconRuntimeContext)
}

const imageUrlCache = new Map<string, string>()

function imageCacheKey(scope: VaultScope, targetKind: EntityIconTargetKind, ref: string, path: string): string {
  return `${scope}|${targetKind}|${ref}|${path}`
}

export function useEntityIconImageUrl(
  targetKind: EntityIconTargetKind,
  ref: string,
  icon: EntityIconModel | undefined,
): string | undefined {
  const runtime = useEntityIconRuntime()
  const path = icon && icon.kind === 'image' ? icon.path : ''
  const key = runtime && path ? imageCacheKey(runtime.scope, targetKind, ref, path) : ''
  const [url, setUrl] = React.useState<string | undefined>(() => (key ? imageUrlCache.get(key) : undefined))

  React.useEffect(() => {
    if (!key || !runtime) {
      setUrl(undefined)
      return
    }
    const cached = imageUrlCache.get(key)
    if (cached) {
      setUrl(cached)
      return
    }
    let alive = true
    runtime.gateway.icons
      .readImage(runtime.scope, { targetKind, ref, path })
      .then(dataUrl => {
        if (!dataUrl) return
        imageUrlCache.set(key, dataUrl)
        if (alive) setUrl(dataUrl)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key, runtime, targetKind, ref, path])

  return url
}

// 清理某实体残留的图片缓存（替换/删除图标后调用，避免旧图复用）。
export function invalidateEntityIconImage(scope: VaultScope, targetKind: EntityIconTargetKind, ref: string): void {
  const prefix = `${scope}|${targetKind}|${ref}|`
  for (const key of Array.from(imageUrlCache.keys())) {
    if (key.startsWith(prefix)) imageUrlCache.delete(key)
  }
}

// 图标外框样式：只按图标自身尺寸占位（宽高固定为 size），不吞掉父级布局。
// 关键约束：不得使用 width/height:100%——否则在行内会挤压文字、把图标推到居中。
export function entityIconBoxSx(size: number, sx?: Record<string, unknown>): Record<string, unknown> {
  return { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: size, height: size, ...sx }
}

export type EntityIconProps = {
  icon?: EntityIconModel
  /** 默认图标：不设自定义图标时原样显示，由调用方按实体类型提供。 */
  fallback: React.ReactNode
  targetKind?: EntityIconTargetKind
  /** 实体引用：笔记传包目录、收藏夹传收藏夹标识、附件传 assetId（图片读取据此定位）。 */
  targetRef?: string
  size?: number
  sx?: Record<string, unknown>
}

export function EntityIcon(props: EntityIconProps): React.ReactNode {
  const { icon, fallback, targetKind = 'asset', targetRef = '', size = 20, sx } = props
  const imageUrl = useEntityIconImageUrl(targetKind, targetRef, icon)

  let content: React.ReactNode = fallback
  if (icon?.kind === 'library') {
    const Lucide = getLucideIcon(icon.name)
    if (Lucide) content = <Lucide size={size} />
  } else if (icon?.kind === 'image') {
    content = imageUrl ? (
      <Box component="img" src={imageUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    ) : (
      fallback
    )
  } else if (icon?.kind === 'svg') {
    const safe = sanitizeSvg(icon.svg, 'baseline')
    if (safe) {
      content = (
        <Box
          aria-hidden
          sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', '& svg': { width: '100%', height: '100%' } }}
          dangerouslySetInnerHTML={{ __html: safe }}
        />
      )
    }
  }

  return <Box sx={entityIconBoxSx(size, sx)}>{content}</Box>
}
