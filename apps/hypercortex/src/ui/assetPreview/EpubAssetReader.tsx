import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, MenuItem, TextField, Typography } from '@mui/material'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import FormatSizeRoundedIcon from '@mui/icons-material/FormatSizeRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import ePub, { type Book, type Location, type NavItem, type Rendition } from 'epubjs'
import type { AssetPreviewContext } from './registry'
import { AssetPreviewToolbarPortal } from './assetPreviewToolbar'
import { softButtonSx } from '../pluginUiStyles'

const EPUB_FONT_SCALE_MIN = 82
const EPUB_FONT_SCALE_MAX = 148
const EPUB_FONT_SCALE_STEP = 6
const DEFAULT_EPUB_FONT_SCALE = 104

type EpubTocItem = {
  href: string
  label: string
  level: number
}

function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EPUB_FONT_SCALE
  if (value < EPUB_FONT_SCALE_MIN) return EPUB_FONT_SCALE_MIN
  if (value > EPUB_FONT_SCALE_MAX) return EPUB_FONT_SCALE_MAX
  return Math.round(value)
}

function flattenToc(items: NavItem[], level = 0, acc: EpubTocItem[] = []): EpubTocItem[] {
  for (const item of items) {
    const href = String(item.href || '').trim()
    const label = String(item.label || '').trim()
    if (href) acc.push({ href, label: label || '未命名章节', level })
    if (item.subitems?.length) flattenToc(item.subitems, level + 1, acc)
  }
  return acc
}

function normalizeEpubHref(value: unknown): string {
  return String(value || '').split('#')[0].trim()
}

function pickCurrentTocHref(toc: EpubTocItem[], href: unknown): string {
  const normalized = normalizeEpubHref(href)
  if (!normalized) return ''
  return toc.find(item => normalizeEpubHref(item.href) === normalized)?.href || ''
}

function progressPercent(location: Location | null): number {
  const value = location?.start?.percentage
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(Number(value) * 100)))
}

function applyEpubReaderTheme(rendition: Rendition, fontScale: number): void {
  rendition.themes.register('hypercortex', {
    body: {
      margin: '0',
      padding: '0 2.2rem',
      color: '#211b14',
      background: '#fffaf2',
      'font-family': "Georgia, 'Times New Roman', serif",
      'line-height': '1.78',
    },
    p: { 'margin-bottom': '1em' },
    img: { 'max-width': '100%', height: 'auto' },
    a: { color: '#6f8f72' },
    'h1, h2, h3, h4, h5, h6': {
      color: '#19140f',
      'line-height': '1.28',
      'margin-top': '1.4em',
      'margin-bottom': '.55em',
    },
    'blockquote': {
      'border-left': '4px solid rgba(111,143,114,.34)',
      margin: '1.2em 0',
      padding: '.2em 0 .2em 1em',
      color: '#4f4638',
    },
  })
  rendition.themes.select('hypercortex')
  rendition.themes.fontSize(`${fontScale}%`)
}

async function blobUrlToArrayBuffer(blobUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(blobUrl)
  if (!response.ok) throw new Error(`读取 EPUB 文件失败：${response.status}`)
  return response.arrayBuffer()
}

async function openEpubBook(arrayBuffer: ArrayBuffer): Promise<Book> {
  const book = ePub()
  try {
    await book.open(arrayBuffer, 'binary')
    await book.opened
    return book
  } catch (e) {
    book.destroy()
    throw e
  }
}

function EpubReaderToolbar({
  toc,
  activeHref,
  progress,
  fontScale,
  atStart,
  atEnd,
  onSectionChange,
  onPrev,
  onNext,
  onDecreaseFont,
  onResetFont,
  onIncreaseFont,
}: {
  toc: EpubTocItem[]
  activeHref: string
  progress: number
  fontScale: number
  atStart: boolean
  atEnd: boolean
  onSectionChange: (href: string) => void
  onPrev: () => void
  onNext: () => void
  onDecreaseFont: () => void
  onResetFont: () => void
  onIncreaseFont: () => void
}) {
  const selectValue = toc.some(item => item.href === activeHref) ? activeHref : ''

  return (
    <Box aria-label="EPUB 阅读控制" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.62)', whiteSpace: 'nowrap' }}>
        {progress}% · {fontScale}%
      </Typography>
      <TextField
        select
        size="small"
        value={selectValue}
        disabled={!toc.length}
        aria-label="跳转到 EPUB 章节"
        onChange={event => onSectionChange(String(event.target.value))}
        sx={{
          width: { xs: 180, sm: 260 },
          '& .MuiInputBase-root': { height: 32, fontSize: 12, fontWeight: 800, bgcolor: 'rgba(255,255,255,.72)' },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
          '& .Mui-focused': { bgcolor: 'rgba(255,255,255,.95)', boxShadow: '0 10px 24px rgba(0,0,0,.08)' },
        }}
      >
        <MenuItem value="" disabled sx={{ fontSize: 13 }}>
          目录
        </MenuItem>
        {toc.map(item => (
          <MenuItem key={item.href} value={item.href} sx={{ pl: 1.5 + item.level * 2, fontSize: 13 }}>
            {item.label}
          </MenuItem>
        ))}
      </TextField>
      <IconButton size="small" aria-label="上一页 EPUB" onClick={onPrev} disabled={atStart} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
        <KeyboardArrowLeftRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" aria-label="下一页 EPUB" onClick={onNext} disabled={atEnd} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
        <KeyboardArrowRightRoundedIcon fontSize="small" />
      </IconButton>
      <Button size="small" variant="text" onClick={onDecreaseFont} disabled={fontScale <= EPUB_FONT_SCALE_MIN} startIcon={<FormatSizeRoundedIcon sx={{ fontSize: 16 }} />} sx={{ ...softButtonSx, minWidth: 44, height: 28, px: 1, fontSize: 12 }}>
        A-
      </Button>
      <IconButton size="small" aria-label="重置 EPUB 字号" onClick={onResetFont} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
        <RestartAltRoundedIcon fontSize="small" />
      </IconButton>
      <Button size="small" variant="text" onClick={onIncreaseFont} disabled={fontScale >= EPUB_FONT_SCALE_MAX} startIcon={<FormatSizeRoundedIcon sx={{ fontSize: 18 }} />} sx={{ ...softButtonSx, minWidth: 44, height: 28, px: 1, fontSize: 12 }}>
        A+
      </Button>
    </Box>
  )
}

export function EpubAssetReader({ blobUrl, toolbarHost }: AssetPreviewContext) {
  const readerRef = React.useRef<HTMLDivElement | null>(null)
  const renditionRef = React.useRef<Rendition | null>(null)
  const tocRef = React.useRef<EpubTocItem[]>([])
  const fontScaleRef = React.useRef(DEFAULT_EPUB_FONT_SCALE)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [toc, setToc] = React.useState<EpubTocItem[]>([])
  const [activeHref, setActiveHref] = React.useState('')
  const [progress, setProgress] = React.useState(0)
  const [fontScale, setFontScale] = React.useState(DEFAULT_EPUB_FONT_SCALE)
  const [atStart, setAtStart] = React.useState(true)
  const [atEnd, setAtEnd] = React.useState(false)

  React.useEffect(() => {
    fontScaleRef.current = fontScale
    renditionRef.current?.themes.fontSize(`${fontScale}%`)
  }, [fontScale])

  React.useEffect(() => {
    let cancelled = false
    let book: Book | null = null
    let rendition: Rendition | null = null
    let resizeObserver: ResizeObserver | null = null
    const cleanupListeners: Array<() => void> = []

    setLoading(true)
    setError(null)
    setToc([])
    tocRef.current = []
    setActiveHref('')
    setProgress(0)
    setAtStart(true)
    setAtEnd(false)

    ;(async () => {
      try {
        const arrayBuffer = await blobUrlToArrayBuffer(blobUrl)
        if (cancelled) return
        const nextBook = await openEpubBook(arrayBuffer)
        if (cancelled) {
          nextBook.destroy()
          return
        }
        book = nextBook
        if (cancelled) return

        const navigation = await book.loaded.navigation
        const nextToc = flattenToc(navigation.toc || [])
        tocRef.current = nextToc
        setToc(nextToc)

        const reader = readerRef.current
        if (!reader) throw new Error('EPUB 阅读容器未挂载')
        reader.replaceChildren()

        rendition = book.renderTo(reader, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'none',
          allowScriptedContent: false,
        })
        renditionRef.current = rendition
        applyEpubReaderTheme(rendition, fontScaleRef.current)

        const onRelocated = (location: Location) => {
          setProgress(progressPercent(location))
          setAtStart(Boolean(location.atStart))
          setAtEnd(Boolean(location.atEnd))
          setActiveHref(pickCurrentTocHref(tocRef.current, location.start?.href))
        }
        rendition.on('relocated', onRelocated)
        const activeRendition = rendition
        cleanupListeners.push(() => activeRendition.off('relocated', onRelocated))

        resizeObserver = new ResizeObserver(entries => {
          const rect = entries[0]?.contentRect
          if (!rect || !rendition) return
          rendition.resize(Math.floor(rect.width), Math.floor(rect.height))
        })
        resizeObserver.observe(reader)

        await rendition.display()
        if (!cancelled) setLoading(false)
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message || e || 'EPUB 文档读取失败'))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      cleanupListeners.forEach(cleanup => cleanup())
      resizeObserver?.disconnect()
      rendition?.destroy()
      book?.destroy()
      if (renditionRef.current === rendition) renditionRef.current = null
      readerRef.current?.replaceChildren()
    }
  }, [blobUrl])

  const displayTarget = React.useCallback((target: string) => {
    const rendition = renditionRef.current
    if (!rendition || !target) return
    rendition.display(target).catch((e: any) => setError(String(e?.message || e || 'EPUB 章节跳转失败')))
  }, [])

  const prev = React.useCallback(() => {
    renditionRef.current?.prev().catch((e: any) => setError(String(e?.message || e || 'EPUB 上一页失败')))
  }, [])

  const next = React.useCallback(() => {
    renditionRef.current?.next().catch((e: any) => setError(String(e?.message || e || 'EPUB 下一页失败')))
  }, [])

  const decreaseFont = React.useCallback(() => setFontScale(value => clampFontScale(value - EPUB_FONT_SCALE_STEP)), [])
  const resetFont = React.useCallback(() => setFontScale(DEFAULT_EPUB_FONT_SCALE), [])
  const increaseFont = React.useCallback(() => setFontScale(value => clampFontScale(value + EPUB_FONT_SCALE_STEP)), [])

  if (error) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography>
      </Box>
    )
  }

  return (
    <>
      <AssetPreviewToolbarPortal host={toolbarHost}>
        <EpubReaderToolbar
          toc={toc}
          activeHref={activeHref}
          progress={progress}
          fontScale={fontScale}
          atStart={atStart}
          atEnd={atEnd}
          onSectionChange={displayTarget}
          onPrev={prev}
          onNext={next}
          onDecreaseFont={decreaseFont}
          onResetFont={resetFont}
          onIncreaseFont={increaseFont}
        />
      </AssetPreviewToolbarPortal>
      <Box sx={{ position: 'relative', width: '100%', height: '100%', bgcolor: '#f5f1e8', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: { xs: 10, sm: 18 }, borderRadius: 3, overflow: 'hidden', bgcolor: '#fffaf2', boxShadow: '0 18px 54px rgba(57,45,26,.16)' }}>
          <Box ref={readerRef} sx={{ width: '100%', height: '100%' }} />
        </Box>
        {loading ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(245,241,232,.72)' }}>
            <CircularProgress size={20} />
          </Box>
        ) : null}
      </Box>
    </>
  )
}
