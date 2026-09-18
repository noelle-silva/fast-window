import * as React from 'react'
import { Box, Typography } from '@mui/material'

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

export function RefImageThumb(props: { controller: any; path: string }) {
  const { controller, path } = props
  const [src, setSrc] = React.useState('')

  React.useEffect(() => {
    let alive = true
    const api = controller?.capabilities
    if (!api?.files?.images?.read) return
    api.files.images
      .read({ scope: 'data', path })
      .then((url: string) => {
        if (!alive) return
        setSrc(String(url || ''))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [controller, path])

  return (
    <Box
      component="img"
      data-fw-img="1"
      src={src || undefined}
      alt="image"
      sx={{
        width: 160,
        height: 110,
        objectFit: 'cover',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        cursor: 'zoom-in',
      }}
    />
  )
}

const stickerSrcCache = new Map<string, string>()

export function StickerInlineImage(props: { controller: any; path: string; label: string; size?: number }) {
  const { controller, path, label, size } = props
  const [src, setSrc] = React.useState('')

  React.useEffect(() => {
    const p = String(path || '').trim()
    if (!p) return

    const cached = stickerSrcCache.get(p)
    if (typeof cached === 'string' && cached) {
      setSrc(cached)
      return
    }

    let alive = true
    const api = controller?.capabilities
    if (!api?.files?.images?.read) return

    api.files.images
      .read({ scope: 'data', path: p })
      .then((url: string) => {
        if (!alive) return
        const u = String(url || '')
        if (u.startsWith('data:')) stickerSrcCache.set(p, u)
        setSrc(u)
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [controller, path])

  const s = clampNum(Number(size || 90), 32, 240)

  return (
    <Box
      component="img"
      data-fw-img="1"
      src={src || undefined}
      alt={label || 'sticker'}
      sx={{
        width: s,
        height: s,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: 'middle',
        borderRadius: 12,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        cursor: 'zoom-in',
      }}
    />
  )
}

type StickerSeg =
  | { kind: 'text'; text: string }
  | { kind: 'sticker'; raw: string; category: string; name: string }

function splitStickerSegments(input: string): StickerSeg[] {
  const s = String(input || '')
  if (!s) return [{ kind: 'text', text: '' }]

  const out: StickerSeg[] = []
  const re = /\[\[\s*(?:sticker|表情包)\s*:\s*([^\]\n]{1,220}?)\s*\]\]/g
  let last = 0
  let m: RegExpExecArray | null = null

  while ((m = re.exec(s))) {
    const idx = m.index
    const full = String(m[0] || '')
    const inner = String(m[1] || '').trim().replace(/\\/g, '/')

    if (idx > last) out.push({ kind: 'text', text: s.slice(last, idx) })

    const parts = inner
      .split('/')
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    if (parts.length === 2) {
      out.push({ kind: 'sticker', raw: full, category: parts[0], name: parts[1] })
    } else {
      out.push({ kind: 'text', text: full })
    }

    last = idx + full.length
  }

  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out.length ? out : [{ kind: 'text', text: s }]
}

export function StickerText(props: { controller: any; text: string; stickerMap: any }) {
  const { controller, text, stickerMap } = props
  const segs = React.useMemo(() => splitStickerSegments(String(text || '')), [text])

  return (
    <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
      {segs.map((seg, i) => {
        if (seg.kind === 'text') return <React.Fragment key={i}>{seg.text}</React.Fragment>
        const cat = String(seg.category || '').trim()
        const name = String(seg.name || '').trim()
        const relPath = stickerMap && typeof stickerMap === 'object' ? String(stickerMap?.[cat]?.[name]?.relPath || '') : ''
        if (!relPath) return <React.Fragment key={i}>{seg.raw}</React.Fragment>
        return <StickerInlineImage key={i} controller={controller} path={relPath} label={`${cat}/${name}`} />
      })}
    </Typography>
  )
}
