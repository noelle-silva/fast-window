import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { NoteSearchHit } from '../gateway/types'
import { unstyledButtonSurfaceSx } from './pluginUiStyles'
import { tagToneFromText, toneChipSx } from './uiTones'
import type { AllNotesLayout } from './AllNotesPage'

export function HighlightText(props: { text: string; tokens: string[] }): React.ReactNode {
  const { text, tokens } = props
  const toks = tokens.map(t => t.toLowerCase()).filter(Boolean)
  if (!text || !toks.length) return <>{text}</>
  const lower = text.toLowerCase()
  const nodes: React.ReactNode[] = []
  let i = 0
  const markAt = (start: number, end: number, key: number) => (
    <mark
      key={key}
      style={{
        background: 'var(--hc-primary-soft)',
        color: 'var(--hc-primary)',
        borderRadius: 3,
        padding: '0 1px',
        fontWeight: 700,
      }}
    >
      {text.slice(start, end)}
    </mark>
  )
  while (i < text.length) {
    let matched = 0
    for (const t of toks) {
      if (lower.startsWith(t, i)) {
        matched = Math.max(matched, t.length)
      }
    }
    if (matched > 0) {
      nodes.push(markAt(i, i + matched, i))
      i += matched
      continue
    }
    let j = i + 1
    while (j < text.length) {
      let hit = false
      for (const t of toks) {
        if (lower.startsWith(t, j)) {
          hit = true
          break
        }
      }
      if (hit) break
      j++
    }
    nodes.push(<span key={`s-${i}`}>{text.slice(i, j)}</span>)
    i = j
  }
  return <>{nodes}</>
}

function FieldHitChip(props: { label: string }): React.ReactNode {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.9,
        py: 0.25,
        borderRadius: 999,
        fontSize: 10.5,
        ...toneChipSx(tagToneFromText(props.label)),
        whiteSpace: 'nowrap',
      }}
    >
      {props.label}
    </Box>
  )
}

export function SearchNoteResultRow(props: {
  hit: NoteSearchHit
  tokens: string[]
  layout: AllNotesLayout
  onOpen: (hit: NoteSearchHit) => void
  onCopyRef: (hit: NoteSearchHit) => void
}): React.ReactNode {
  const { hit, tokens, layout, onOpen, onCopyRef } = props
  const fieldLabels: { key: string; label: string }[] = []
  for (const field of hit.noteFields || []) {
    if (field === 'title') continue
    if (field === 'description') fieldLabels.push({ key: field, label: '简介命中' })
    else if (field === 'tags') fieldLabels.push({ key: field, label: '标签命中' })
    else if (field === 'id') fieldLabels.push({ key: field, label: 'ID 命中' })
  }
  const open = () => onOpen(hit)

  const titleNode = (
    <Typography
      sx={{
        fontSize: layout === 'icon' ? 12.5 : 13.5,
        fontWeight: 900,
        color: '#111',
        lineHeight: 1.4,
        display: '-webkit-box',
        WebkitLineClamp: layout === 'grid' ? 2 : 1,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        minWidth: 0,
      }}
      title={hit.title}
    >
      <HighlightText text={hit.title || '未命名'} tokens={tokens} />
    </Typography>
  )

  const faceHitsNode =
    layout !== 'icon' && (hit.faceHits || []).length ? (
      <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.4, minWidth: 0 }}>
        {hit.faceHits.map(face => (
          <Box key={face.faceId} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
            <Box
              component="span"
              sx={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                px: 0.9,
                py: 0.3,
                borderRadius: 999,
                fontSize: 10.5,
                fontWeight: 700,
                ...toneChipSx(tagToneFromText(face.title || face.kind)),
                whiteSpace: 'nowrap',
              }}
            >
              {face.title || face.kind}
            </Box>
            <Typography
              sx={{ fontSize: 11.5, lineHeight: 1.55, color: 'rgba(0,0,0,.6)', minWidth: 0, flex: 1 }}
              noWrap
              title={face.snippet}
            >
              <HighlightText text={face.snippet || ''} tokens={tokens} />
            </Typography>
          </Box>
        ))}
      </Box>
    ) : null

  const fieldChipsNode =
    layout !== 'icon' && fieldLabels.length ? (
      <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {fieldLabels.map(item => (
          <FieldHitChip key={item.key} label={item.label} />
        ))}
      </Box>
    ) : null

  const copyButton = (
    <Box
      component="button"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation()
        onCopyRef(hit)
      }}
      sx={{
        ...unstyledButtonSurfaceSx,
        background: 'rgba(0,0,0,.05)',
        borderRadius: 1.5,
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: 11,
        color: 'rgba(0,0,0,.45)',
        '&:hover': { background: 'rgba(0,0,0,.1)' },
      }}
      aria-label="复制引用占位符"
      title="复制引用占位符"
    >
      🔗
    </Box>
  )

  if (layout === 'grid') {
    return (
      <Box
        onClick={open}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        sx={{
          position: 'relative',
          px: 1.25,
          py: 1.1,
          borderRadius: 2,
          bgcolor: 'var(--hc-surface)',
          boxShadow: '0 1px 2px rgba(0,0,0,.04)',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
          '&:focus-visible': { bgcolor: 'var(--hc-surface-soft)', outline: 'none' },
        }}
      >
        <Box sx={{ position: 'absolute', top: 6, right: 6 }}>{copyButton}</Box>
        {titleNode}
        {faceHitsNode}
        {fieldChipsNode}
      </Box>
    )
  }

  if (layout === 'icon') {
    return (
      <Box
        onClick={open}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        sx={{
          position: 'relative',
          minHeight: 72,
          px: 1,
          py: 1,
          borderRadius: 2,
          bgcolor: 'var(--hc-surface)',
          boxShadow: '0 1px 2px rgba(0,0,0,.04)',
          display: 'flex',
          alignItems: 'center',
          textAlign: 'center',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
          '&:focus-visible': { bgcolor: 'var(--hc-surface-soft)', outline: 'none' },
        }}
      >
        <Box sx={{ position: 'absolute', top: 4, right: 4 }}>{copyButton}</Box>
        {titleNode}
      </Box>
    )
  }

  return (
    <Box
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      sx={{
        px: 1.25,
        py: 0.95,
        borderRadius: 2,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'rgba(0,0,0,.03)' },
        '&:focus-visible': { bgcolor: 'rgba(0,0,0,.04)', outline: 'none' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{titleNode}</Box>
        <Box sx={{ flexShrink: 0 }}>{copyButton}</Box>
      </Box>
      {faceHitsNode}
      {fieldChipsNode}
    </Box>
  )
}
