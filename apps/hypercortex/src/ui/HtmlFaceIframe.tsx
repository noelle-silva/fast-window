import * as React from 'react'
import { Box, Button, Collapse, IconButton, Slider, Tooltip, Typography } from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded'
import type { HyperCortexHtmlFaceDisplayModeV1 } from '../core'
import { HTML_FACE_FIXED_SCALE, HTML_FACE_FIXED_VIEWPORT, clampHtmlFaceFixedScale, normalizeHtmlFaceFixedScale } from '../htmlFaceDisplay'
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

function normalizeScale(value: unknown, fallback = HTML_FACE_FIXED_SCALE.default): number {
  return normalizeHtmlFaceFixedScale(value, fallback)
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
        boxShadow: '0 16px 36px rgba(15,23,42,.08)',
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
  const normalizedPreferredScale = normalizeScale(preferredScale)
  const [scale, setScale] = React.useState(normalizedPreferredScale)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setScale(normalizedPreferredScale)
  }, [html, normalizedPreferredScale])

  const fitScale = React.useMemo(() => {
    const sw = stageSize.width
    const sh = stageSize.height
    if (!(sw > 0) || !(sh > 0)) return 1
    return Math.min(sw / HTML_FACE_FIXED_VIEWPORT.width, sh / HTML_FACE_FIXED_VIEWPORT.height)
  }, [stageSize.height, stageSize.width])

  const effectiveScale = clampHtmlFaceFixedScale(fitScale * scale)
  const renderedWidth = HTML_FACE_FIXED_VIEWPORT.width * effectiveScale
  const renderedHeight = HTML_FACE_FIXED_VIEWPORT.height * effectiveScale
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
            bgcolor: 'rgba(15,23,42,.035)',
            boxShadow: '0 10px 24px rgba(15,23,42,.06)',
          }}
        >
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', whiteSpace: 'nowrap' }}>
            {Math.round(scale * 100)}%
            {hasNoteOverride ? ' · 笔记级' : ' · 全局默认'}
          </Typography>
          <Box sx={{ flex: 1, minWidth: 160, maxWidth: 280, px: 0.5 }}>
            <Slider
              size="small"
              min={HTML_FACE_FIXED_SCALE.min}
              max={HTML_FACE_FIXED_SCALE.max}
              step={HTML_FACE_FIXED_SCALE.step}
              value={scale}
              onChange={(_, next) => setScale(normalizeScale(Array.isArray(next) ? next[0] : next, normalizedPreferredScale))}
              aria-label="HTML 面缩放比例"
            />
          </Box>
          <Tooltip title="缩小比例">
            <span>
              <IconButton size="small" aria-label="缩小比例" onClick={() => setScale(prev => clampHtmlFaceFixedScale(prev / 1.1))}>
                <RemoveRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="放大比例">
            <span>
              <IconButton size="small" aria-label="放大比例" onClick={() => setScale(prev => clampHtmlFaceFixedScale(prev * 1.1))}>
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
          boxShadow: '0 16px 36px rgba(15,23,42,.08)',
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
                width: HTML_FACE_FIXED_VIEWPORT.width,
                height: HTML_FACE_FIXED_VIEWPORT.height,
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
    globalDefaultScale = HTML_FACE_FIXED_SCALE.default,
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
