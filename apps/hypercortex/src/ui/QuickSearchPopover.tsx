import * as React from 'react'
import {
  Box,
  CircularProgress,
  ClickAwayListener,
  InputBase,
  Paper,
  Popper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import { type NoteMeta, type VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import type { AssetEntry } from '../assetTypes'
import { buildAssetEntries } from '../assetEntryModel'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import type { NoteSearchFaceKind, NoteSearchHit } from '../gateway/types'
import type { HyperCortexGateway } from '../gateway'
import { unstyledButtonSurfaceSx } from './pluginUiStyles'
import { tagToneFromText, toneChipSx } from './uiTones'
import type { AllNotesLayout } from './AllNotesPage'

type Mode = 'notes' | 'assets'

type Props = {
  gateway: HyperCortexGateway
  scope: VaultScope
  open: boolean
  triggerEl: HTMLElement | null
  allNotesLayout: AllNotesLayout
  onToggleAllNotesLayout: () => void
  onClose: () => void
  onOpenNote: (note: NoteMeta, faceId?: string) => void
  onOpenAsset: (asset: AssetEntry) => void
}

function normalizeQuery(q: string): string[] {
  const s = String(q || '')
    .trim()
    .toLowerCase()
  if (!s) return []
  return s.split(/\s+/g).map(t => t.trim()).filter(Boolean)
}

function searchHitToMeta(hit: NoteSearchHit): NoteMeta {
  return {
    id: String(hit.noteId || ''),
    title: String(hit.title || '') || '未命名',
    description: String(hit.description || ''),
    dir: String(hit.dir || ''),
    createdAtMs: Number(hit.createdAtMs || 0),
    updatedAtMs: Number(hit.updatedAtMs || 0),
  }
}

function HighlightText(props: { text: string; tokens: string[] }): React.ReactNode {
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

function SearchNoteResultRow(props: {
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

export function QuickSearchPopover(props: Props) {
  const { gateway, scope, open, triggerEl, allNotesLayout, onToggleAllNotesLayout, onClose, onOpenNote, onOpenAsset } = props

  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const popperRootRef = React.useRef<HTMLDivElement | null>(null)

  const [mode, setMode] = React.useState<Mode>('notes')
  const [query, setQuery] = React.useState('')

  const [viewportTick, setViewportTick] = React.useState(0)
  React.useEffect(() => {
    if (!open) return
    const onResize = () => setViewportTick(t => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  const viewportAnchor = React.useMemo(() => {
    return {
      getBoundingClientRect: () => {
        const x = Math.round(window.innerWidth / 2)
        const y = Math.round(window.innerHeight / 4)
        return new DOMRect(x, y, 0, 0)
      },
    }
  }, [viewportTick])

  const [assets, setAssets] = React.useState<AssetEntry[]>([])
  const [assetsLoading, setAssetsLoading] = React.useState(false)
  const [assetsError, setAssetsError] = React.useState<string | null>(null)
  const assetsLoadSeqRef = React.useRef(0)

  const [faceKinds, setFaceKinds] = React.useState<NoteSearchFaceKind[]>([])
  const [faceKindFilter, setFaceKindFilter] = React.useState('')
  const [searchItems, setSearchItems] = React.useState<NoteSearchHit[]>([])
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const searchSeqRef = React.useRef(0)

  React.useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  React.useEffect(() => {
    if (!open || mode !== 'notes' || faceKinds.length) return
    let alive = true
    gateway.search
      .listFaceKinds()
      .then(kinds => {
        if (alive && Array.isArray(kinds)) setFaceKinds(kinds)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [faceKinds.length, gateway, mode, open])

  React.useEffect(() => {
    if (!open || mode !== 'notes') return
    const q = query.trim()
    if (!q) {
      setSearchItems([])
      setSearchError(null)
      return
    }
    const timer = window.setTimeout(() => {
      const seq = ++searchSeqRef.current
      setSearchLoading(true)
      setSearchError(null)
      gateway.search
        .queryNotes(scope, q, faceKindFilter ? [faceKindFilter] : [])
        .then(result => {
          if (searchSeqRef.current !== seq) return
          setSearchItems(Array.isArray(result?.items) ? result.items : [])
        })
        .catch((e: any) => {
          if (searchSeqRef.current !== seq) return
          setSearchError(String(e?.message || e || '搜索失败'))
          setSearchItems([])
        })
        .finally(() => {
          if (searchSeqRef.current === seq) setSearchLoading(false)
        })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [faceKindFilter, gateway, mode, open, query, scope])

  React.useEffect(() => {
    if (!open) return
    if (mode !== 'assets') return
    if (assets.length) return

    const seq = ++assetsLoadSeqRef.current
    setAssetsLoading(true)
    setAssetsError(null)
    ;(async () => {
      try {
        const items = await gateway.assets.listAssets(scope)
        if (assetsLoadSeqRef.current !== seq) return
        const entries = buildAssetEntries(items)
        entries.sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0))
        setAssets(entries)
      } catch (e: any) {
        if (assetsLoadSeqRef.current !== seq) return
        setAssetsError(String(e?.message || e || '附件加载失败'))
      } finally {
        if (assetsLoadSeqRef.current === seq) setAssetsLoading(false)
      }
    })()

    return () => {
      if (assetsLoadSeqRef.current === seq) assetsLoadSeqRef.current++
      setAssetsLoading(false)
    }
  }, [assets.length, gateway, mode, open, scope])

  React.useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, open])

  React.useEffect(() => {
    if (!open) return

    const anchor = triggerEl
    const root = popperRootRef.current
    if (!root) return

    const closeIfFocusOutside = () => {
      const active = document.activeElement
      if (!active) return
      if (anchor && (anchor === active || anchor.contains(active))) return
      if (root.contains(active)) return
      onClose()
    }

    const timer = setTimeout(closeIfFocusOutside, 0)
    const onFocusIn = () => closeIfFocusOutside()
    window.addEventListener('focusin', onFocusIn, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focusin', onFocusIn, true)
    }
  }, [onClose, open, triggerEl])

  const tokens = React.useMemo(() => normalizeQuery(query), [query])

  const assetMatches = React.useMemo(() => {
    const toks = tokens
    if (!toks.length) return []
    const list = Array.isArray(assets) ? assets : []
    const ranked = list
      .map(a => {
        const name = pickAssetDisplayName({ explicitName: a.displayName, indexName: a.sourceName || a.fileName, ext: a.ext })
        const metadata = `${a.remark || ''} ${(a.tags || []).join(' ')}`
        const fallback = `${a.fileName} ${a.sourceName || ''} ${a.assetId}.${a.ext} ${a.assetId} ${metadata}`
        const score = Math.max(scoreText(name, toks) * 10, scoreText(fallback, toks))
        return { asset: a, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.asset.modifiedMs || 0) - (a.asset.modifiedMs || 0))
      .slice(0, 48)
    return ranked.map(x => x.asset)
  }, [assets, tokens])

  const openFirstNote = () => {
    const hit = searchItems[0]
    if (!hit) return
    const meta = searchHitToMeta(hit)
    const faceId = hit.faceHits?.length ? hit.faceHits[0].faceId : undefined
    onOpenNote(meta, faceId)
    onClose()
  }

  const showEmptyHint = !query.trim()
  const showNoMatch = !!query.trim() && ((mode === 'notes' && !searchLoading && !searchError && !searchItems.length) || (mode === 'assets' && !assetMatches.length))

  return (
    <Popper
      open={open}
      keepMounted
      anchorEl={viewportAnchor as any}
      placement="bottom"
      disablePortal={false}
      sx={{ zIndex: 2000 }}
    >
      <Box ref={popperRootRef} sx={{ pt: 0.75 }}>
        <ClickAwayListener
          onClickAway={(e: any) => {
            if (!open) return
            const anchor = triggerEl
            if (anchor && e?.target && (anchor === e.target || anchor.contains(e.target))) return
            onClose()
          }}
        >
          <Paper
            elevation={10}
            sx={{
              width: 630,
              maxWidth: 'min(780px, calc(100vw - 24px))',
              borderRadius: 3,
              overflow: 'hidden',
              boxShadow: '0 22px 56px rgba(15,23,42,.22)',
            }}
          >
            <Box sx={{ px: 1.25, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <SearchRoundedIcon sx={{ color: 'rgba(0,0,0,.46)', fontSize: 18 }} />
              <InputBase
                inputRef={inputRef}
                value={query}
                placeholder={mode === 'assets' ? '搜索附件（名称 / 扩展名 / ID）' : '搜索笔记（标题 / 正文 / 标签 / ID）'}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  if (mode === 'notes') {
                    if (searchItems[0]) {
                      e.preventDefault()
                      openFirstNote()
                    }
                    return
                  }
                  if (mode === 'assets' && assetMatches[0]) {
                    e.preventDefault()
                    onOpenAsset(assetMatches[0])
                    onClose()
                  }
                }}
                sx={{ flex: 1, fontSize: 13 }}
              />
              {mode === 'notes' ? (
                <Box
                  component="button"
                  onClick={onToggleAllNotesLayout}
                  aria-label={allNotesLayout === 'list' ? '切换到网格' : allNotesLayout === 'grid' ? '切换到紧凑' : '切换到列表'}
                  title={allNotesLayout === 'list' ? '切换到网格' : allNotesLayout === 'grid' ? '切换到紧凑' : '切换到列表'}
                  sx={{
                    ...unstyledButtonSurfaceSx,
                    bgcolor: 'rgba(0,0,0,.04)',
                    px: 1,
                    py: 0.6,
                    borderRadius: 2,
                    cursor: 'pointer',
                    color: 'rgba(0,0,0,.62)',
                    fontSize: 11,
                    fontWeight: 900,
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' },
                  }}
                >
                  {allNotesLayout === 'list' ? '网格' : allNotesLayout === 'grid' ? '紧凑' : '列表'}
                </Box>
              ) : null}
              <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.38)', whiteSpace: 'nowrap' }}>
                {query.trim() ? 'Enter 打开第一条' : ''}
              </Typography>
            </Box>

            <Tabs
              value={mode}
              onChange={(_, v) => setMode(v as Mode)}
              variant="fullWidth"
              sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, fontSize: 12, fontWeight: 900 } }}
            >
              <Tab icon={<DescriptionRoundedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="笔记" value="notes" />
              <Tab icon={<AttachFileRoundedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="附件" value="assets" />
            </Tabs>

            {mode === 'notes' && faceKinds.length ? (
              <Box sx={{ px: 1.25, pt: 0.75, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)', fontWeight: 900 }}>范围</Typography>
                {[{ kind: '', label: '全部' }, ...faceKinds].map(item => {
                  const active = (item.kind || '') === (faceKindFilter || '')
                  return (
                    <Box
                      component="button"
                      key={item.kind || '__all__'}
                      onClick={() => setFaceKindFilter(item.kind)}
                      sx={{
                        ...unstyledButtonSurfaceSx,
                        px: 1,
                        py: 0.45,
                        borderRadius: 999,
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 900,
                        color: active ? '#fff' : 'rgba(0,0,0,.6)',
                        bgcolor: active ? 'var(--hc-primary)' : 'rgba(0,0,0,.05)',
                        '&:hover': { bgcolor: active ? 'var(--hc-primary)' : 'rgba(0,0,0,.09)' },
                      }}
                    >
                      {item.label}
                    </Box>
                  )
                })}
              </Box>
            ) : null}

            <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {showEmptyHint ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>输入关键词开始匹配</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 11, color: 'rgba(0,0,0,.42)' }}>
                    小贴士：支持空格分词；按 <Box component="span" sx={{ fontFamily: 'monospace' }}>Esc</Box> 关闭
                  </Typography>
                </Box>
              ) : null}

              {mode === 'assets' && assetsLoading ? (
                <Box sx={{ px: 1.5, py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }}>正在加载附件索引…</Typography>
                </Box>
              ) : null}

              {mode === 'assets' && assetsError ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'var(--hc-danger)', fontWeight: 900 }}>{assetsError}</Typography>
                </Box>
              ) : null}

              {mode === 'notes' && searchLoading ? (
                <Box sx={{ px: 1.5, py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }}>正在搜索…</Typography>
                </Box>
              ) : null}

              {mode === 'notes' && searchError ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'var(--hc-danger)', fontWeight: 900 }}>{searchError}</Typography>
                </Box>
              ) : null}

              {showNoMatch ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>没有匹配结果</Typography>
                </Box>
              ) : null}

              {mode === 'notes' && !searchLoading && searchItems.length ? (
                allNotesLayout === 'grid' ? (
                  <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                    {searchItems.map(hit => (
                      <SearchNoteResultRow
                        key={hit.noteId}
                        hit={hit}
                        tokens={tokens}
                        layout="grid"
                        onOpen={openHit => {
                          const meta = searchHitToMeta(openHit)
                          const faceId = openHit.faceHits?.length ? openHit.faceHits[0].faceId : undefined
                          onOpenNote(meta, faceId)
                          onClose()
                        }}
                        onCopyRef={openHit => {
                          void gateway.clipboard.writeText(buildNotePlaceholderForCopy(openHit.noteId, openHit.title))
                          void gateway.host.toast('已复制引用占位符')
                        }}
                      />
                    ))}
                  </Box>
                ) : allNotesLayout === 'icon' ? (
                  <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 1 }}>
                    {searchItems.map(hit => (
                      <SearchNoteResultRow
                        key={hit.noteId}
                        hit={hit}
                        tokens={tokens}
                        layout="icon"
                        onOpen={openHit => {
                          const meta = searchHitToMeta(openHit)
                          const faceId = openHit.faceHits?.length ? openHit.faceHits[0].faceId : undefined
                          onOpenNote(meta, faceId)
                          onClose()
                        }}
                        onCopyRef={openHit => {
                          void gateway.clipboard.writeText(buildNotePlaceholderForCopy(openHit.noteId, openHit.title))
                          void gateway.host.toast('已复制引用占位符')
                        }}
                      />
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ p: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {searchItems.map(hit => (
                      <SearchNoteResultRow
                        key={hit.noteId}
                        hit={hit}
                        tokens={tokens}
                        layout="list"
                        onOpen={openHit => {
                          const meta = searchHitToMeta(openHit)
                          const faceId = openHit.faceHits?.length ? openHit.faceHits[0].faceId : undefined
                          onOpenNote(meta, faceId)
                          onClose()
                        }}
                        onCopyRef={openHit => {
                          void gateway.clipboard.writeText(buildNotePlaceholderForCopy(openHit.noteId, openHit.title))
                          void gateway.host.toast('已复制引用占位符')
                        }}
                      />
                    ))}
                  </Box>
                )
              ) : null}

              {mode === 'assets' && !assetsLoading && assetMatches.length ? (
                <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                  {assetMatches.map(a => {
                    const title = pickAssetDisplayName({ explicitName: a.displayName, ext: a.ext })
                    const extLabel = a.ext ? `.${a.ext}` : ''
                    return (
                      <Box
                        component="li"
                        key={`${a.assetId}.${a.ext}`}
                        onClick={() => {
                          onOpenAsset(a)
                          onClose()
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onOpenAsset(a)
                            onClose()
                          }
                        }}
                        sx={{
                          px: 1.25,
                          py: 0.85,
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'rgba(0,0,0,.03)' },
                        }}
                      >
                        <Typography sx={{ fontSize: 12.5, fontWeight: 900, color: '#111' }} noWrap title={title}>
                          {title}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)', fontFamily: 'monospace' }} noWrap>
                          {extLabel} {a.assetId.slice(0, 12)}…
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              ) : null}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Box>
    </Popper>
  )
}

function scoreText(haystack: string, tokens: string[]): number {
  const h = String(haystack || '').toLowerCase()
  if (!h) return 0
  let score = 0
  for (const t of tokens) {
    const idx = h.indexOf(t)
    if (idx < 0) return 0
    score += idx === 0 ? 4 : 1
  }
  return score
}
