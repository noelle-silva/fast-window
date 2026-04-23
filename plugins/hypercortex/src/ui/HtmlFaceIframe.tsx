import * as React from 'react'
import { Box, Button, Collapse, IconButton, Slider, Tooltip, Typography } from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded'
import type { HyperCortexHtmlFaceDisplayModeV1 } from '../core'
import { AutoHeightHtmlIframe } from './AutoHeightHtmlIframe'

type Props = {
  html: string
  mode: HyperCortexHtmlFaceDisplayModeV1
  minHeightPx?: number
  globalDefaultScale?: number
  noteFixedScale?: number | null
  onSaveNoteFixedScale?: (scale: number | null) => Promise<void> | void
  scaleControlsVisible?: boolean
}

const FIXED_VIEWPORT_WIDTH = 1280
const FIXED_VIEWPORT_HEIGHT = 900
const FIXED_FIT_SCALE_MIN = 0.25
const FIXED_FIT_SCALE_MAX = 2
const FIXED_FIT_SCALE_STEP = 0.01
const FALLBACK_FIXED_SCALE_DEFAULT = 0.95

function createToken(): string {
  try {
    const a = new Uint32Array(4)
    crypto.getRandomValues(a)
    return Array.from(a).join('-')
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function normalizeHtmlDocument(src: string): string {
  const raw = String(src || '')
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function normalizeScale(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return clampNum(fallback, FIXED_FIT_SCALE_MIN, FIXED_FIT_SCALE_MAX)
  return clampNum(n, FIXED_FIT_SCALE_MIN, FIXED_FIT_SCALE_MAX)
}

function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    const apply = () => {
      const rect = el.getBoundingClientRect()
      setSize({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) })
    }

    apply()

    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}

function FitWindowHtmlIframe(props: { html: string; minHeightPx: number }) {
  const { html, minHeightPx } = props
  const tokenRef = React.useRef('')
  if (!tokenRef.current) tokenRef.current = createToken()
  const srcDoc = React.useMemo(() => normalizeHtmlDocument(html), [html])

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: minHeightPx,
        height: 'clamp(360px, calc(100vh - 260px), 960px)',
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.10)',
        bgcolor: '#fff',
      }}
    >
      <iframe
        key={tokenRef.current}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        scrolling="auto"
        style={{ display: 'block', width: '100%', height: '100%', border: 'none', background: '#fff' }}
      />
    </Box>
  )
}

function FixedFitHtmlIframe(props: {
  html: string
  minHeightPx: number
  globalDefaultScale: number
  noteFixedScale?: number | null
  onSaveNoteFixedScale?: (scale: number | null) => Promise<void> | void
  scaleControlsVisible?: boolean
}) {
  const { html, minHeightPx, globalDefaultScale, noteFixedScale, onSaveNoteFixedScale, scaleControlsVisible } = props
  const tokenRef = React.useRef('')
  if (!tokenRef.current) tokenRef.current = createToken()

  const srcDoc = React.useMemo(() => normalizeHtmlDocument(html), [html])
  const { ref: stageRef, size: stageSize } = useElementSize<HTMLDivElement>()
  const preferredScale = noteFixedScale ?? globalDefaultScale
  const normalizedPreferredScale = normalizeScale(preferredScale, FALLBACK_FIXED_SCALE_DEFAULT)
  const [scale, setScale] = React.useState(normalizedPreferredScale)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setScale(normalizedPreferredScale)
  }, [html, normalizedPreferredScale])

  const fitScale = React.useMemo(() => {
    const sw = stageSize.width
    const sh = stageSize.height
    if (!(sw > 0) || !(sh > 0)) return 1
    return Math.min(sw / FIXED_VIEWPORT_WIDTH, sh / FIXED_VIEWPORT_HEIGHT)
  }, [stageSize.height, stageSize.width])

  const effectiveScale = clampNum(fitScale * scale, FIXED_FIT_SCALE_MIN, FIXED_FIT_SCALE_MAX)
  const renderedWidth = FIXED_VIEWPORT_WIDTH * effectiveScale
  const renderedHeight = FIXED_VIEWPORT_HEIGHT * effectiveScale
  const isDirty = Math.abs(scale - normalizedPreferredScale) > 0.0001
  const hasNoteOverride = noteFixedScale != null && Number.isFinite(noteFixedScale)

  const handleSave = async () => {
    if (!onSaveNoteFixedScale || saving) return
    setSaving(true)
    try {
      await onSaveNoteFixedScale(scale)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* 可折叠的缩放控制区：由外部 scaleControlsVisible 控制 */}
      <Collapse in={!!scaleControlsVisible} unmountOnExit={false}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            px: 1.25,
            py: 0.75,
            borderRadius: 2,
            border: '1px solid rgba(0,0,0,.07)',
            bgcolor: '#fff',
          }}
        >
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', whiteSpace: 'nowrap' }}>
            {Math.round(scale * 100)}%
            {hasNoteOverride ? ' · 笔记级' : ' · 全局默认'}
          </Typography>
          <Box sx={{ flex: 1, minWidth: 160, maxWidth: 280, px: 0.5 }}>
            <Slider
              size="small"
              min={FIXED_FIT_SCALE_MIN}
              max={FIXED_FIT_SCALE_MAX}
              step={FIXED_FIT_SCALE_STEP}
              value={scale}
              onChange={(_, next) => setScale(normalizeScale(Array.isArray(next) ? next[0] : next, normalizedPreferredScale))}
              aria-label="HTML 面缩放比例"
            />
          </Box>
          <Tooltip title="缩小比例">
            <span>
              <IconButton size="small" aria-label="缩小比例" onClick={() => setScale(prev => clampNum(prev / 1.1, FIXED_FIT_SCALE_MIN, FIXED_FIT_SCALE_MAX))}>
                <RemoveRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="放大比例">
            <span>
              <IconButton size="small" aria-label="放大比例" onClick={() => setScale(prev => clampNum(prev * 1.1, FIXED_FIT_SCALE_MIN, FIXED_FIT_SCALE_MAX))}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="恢复为初始比例">
            <span>
              <IconButton size="small" aria-label="恢复为初始比例" onClick={() => setScale(normalizedPreferredScale)}>
                <FitScreenRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {isDirty && onSaveNoteFixedScale ? (
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveRoundedIcon fontSize="small" />}
              disabled={saving}
              onClick={() => void handleSave()}
              sx={{ flexShrink: 0 }}
            >
              {saving ? '保存中…' : '保存到笔记'}
            </Button>
          ) : null}
        </Box>
      </Collapse>

      <Box
        ref={stageRef}
        sx={{
          width: '100%',
          minHeight: minHeightPx,
          height: 'clamp(360px, calc(100vh - 260px), 960px)',
          borderRadius: 2,
          overflow: 'auto',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.10)',
          bgcolor: '#f8fafc',
          p: 1.5,
        }}
      >
        <Box
          sx={{
            width: Math.max(renderedWidth, stageSize.width > 0 ? stageSize.width - 24 : renderedWidth),
            minHeight: Math.max(renderedHeight, stageSize.height > 0 ? stageSize.height - 24 : renderedHeight),
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <Box
            sx={{
              width: renderedWidth,
              height: renderedHeight,
              transformOrigin: 'top center',
            }}
          >
            <iframe
              key={tokenRef.current}
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              scrolling="auto"
              style={{
                display: 'block',
                width: FIXED_VIEWPORT_WIDTH,
                height: FIXED_VIEWPORT_HEIGHT,
                border: 'none',
                background: '#fff',
                transform: `scale(${effectiveScale})`,
                transformOrigin: 'top left',
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function HtmlFaceIframe(props: Props) {
  const {
    html,
    mode,
    minHeightPx = 240,
    globalDefaultScale = FALLBACK_FIXED_SCALE_DEFAULT,
    noteFixedScale,
    onSaveNoteFixedScale,
    scaleControlsVisible,
  } = props

  if (mode === 'fit-window') {
    return <FitWindowHtmlIframe html={html} minHeightPx={minHeightPx} />
  }

  if (mode === 'fixed-fit') {
    return (
      <FixedFitHtmlIframe
        html={html}
        minHeightPx={minHeightPx}
        globalDefaultScale={globalDefaultScale}
        noteFixedScale={noteFixedScale}
        onSaveNoteFixedScale={onSaveNoteFixedScale}
        scaleControlsVisible={scaleControlsVisible}
      />
    )
  }

  return <AutoHeightHtmlIframe html={html} minHeightPx={minHeightPx} />
}
