import * as React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'

const DEFAULT_ROOT_MARGIN = '1800px 0px'

type ImagePreviewStatus = 'empty' | 'idle' | 'loading' | 'loaded' | 'error'

type ImagePreviewState = {
  source: string
  activeSource: string
  status: ImagePreviewStatus
}

type LazyImagePreviewProps = {
  src: string
  alt: string
  rootMargin?: string
  minHeight?: number
  maxHeight?: number
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  align?: 'center' | 'start'
  sx?: SxProps<Theme>
  imageSx?: SxProps<Theme>
}

function createImagePreviewState(source: string): ImagePreviewState {
  return {
    source,
    activeSource: '',
    status: source ? 'idle' : 'empty',
  }
}

function appendSx(base: SxProps<Theme>, extra?: SxProps<Theme>): SxProps<Theme> {
  if (!extra) return base
  return [base, ...(Array.isArray(extra) ? extra : [extra])]
}

function contentScrollRoot(): Element | null {
  const root = document.querySelector('[data-area="content"]')
  return root instanceof HTMLElement ? root : null
}

export function LazyImagePreview(props: LazyImagePreviewProps) {
  const {
    src,
    alt,
    rootMargin = DEFAULT_ROOT_MARGIN,
    minHeight = 120,
    maxHeight = 220,
    emptyMessage = '图片不可用',
    loadingMessage = '加载中...',
    errorMessage = '图片加载失败',
    align = 'center',
    sx,
    imageSx,
  } = props
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const [imageState, setImageState] = React.useState<ImagePreviewState>(() => createImagePreviewState(src))
  const isCurrentSource = imageState.source === src
  const status = isCurrentSource ? imageState.status : src ? 'idle' : 'empty'
  const activeSource = isCurrentSource ? imageState.activeSource : ''
  const isLoaded = status === 'loaded'
  const message = status === 'empty' ? emptyMessage : status === 'error' ? errorMessage : loadingMessage

  React.useEffect(() => {
    setImageState(createImagePreviewState(src))
  }, [src])

  React.useEffect(() => {
    if (!src) return
    const node = rootRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        setImageState(prev => prev.source === src ? { source: src, activeSource: src, status: 'loading' } : prev)
      },
      { root: contentScrollRoot(), rootMargin, threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin, src])

  return (
    <Box
      ref={rootRef}
      sx={appendSx({
        width: '100%',
        minHeight: isLoaded ? 0 : minHeight,
        borderRadius: 1.25,
        display: 'grid',
        placeItems: align === 'start' ? 'center start' : 'center',
        color: 'text.secondary',
        bgcolor: isLoaded ? 'transparent' : 'action.hover',
        overflow: 'hidden',
      }, sx)}
    >
      {activeSource ? (
        <Box
          component="img"
          src={activeSource}
          alt={alt}
          aria-hidden={isLoaded ? undefined : true}
          decoding="async"
          loading="eager"
          onLoad={() => {
            setImageState(prev => prev.source === src && prev.activeSource === activeSource ? { ...prev, status: 'loaded' } : prev)
          }}
          onError={() => {
            setImageState(prev => prev.source === src && prev.activeSource === activeSource ? { source: src, activeSource: '', status: 'error' } : prev)
          }}
          sx={appendSx({
            gridArea: '1 / 1',
            display: 'block',
            maxWidth: '100%',
            maxHeight,
            objectFit: 'contain',
            borderRadius: 1.25,
            opacity: isLoaded ? 1 : 0,
          }, imageSx)}
        />
      ) : null}
      {!isLoaded ? (
        <Box
          role={status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          sx={{ gridArea: '1 / 1', px: 1.5, py: 1, textAlign: 'center' }}
        >
          {message}
        </Box>
      ) : null}
    </Box>
  )
}
