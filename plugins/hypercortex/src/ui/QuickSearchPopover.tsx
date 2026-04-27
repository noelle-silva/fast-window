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
import { kindFromMime, mimeFromExt, type NoteMeta, type VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import type { AssetEntry } from '../assetTypes'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { AllNotesGridNoteCard, AllNotesIconNoteCard, AllNotesListNoteRow } from './AllNotesNoteCard'
import { startPrefetchNoteCardInfo } from './noteCardInfoLoader'
import type { HyperCortexGateway } from '../gateway'

type Mode = 'notes' | 'assets'

type Props = {
  gateway: HyperCortexGateway
  scope: VaultScope
  open: boolean
  triggerEl: HTMLElement | null
  notes: NoteMeta[]
  allNotesLayout: 'list' | 'grid' | 'icon'
  onToggleAllNotesLayout: () => void
  noteCardInfoById: Record<string, import('./noteCardInfo').NoteCardInfo>
  onEnsureNoteCardInfoLoaded: (note: NoteMeta) => Promise<void>
  onClose: () => void
  onOpenNote: (note: NoteMeta) => void
  onOpenAsset: (asset: AssetEntry) => void
}

function normalizeQuery(q: string): string[] {
  const s = String(q || '')
    .trim()
    .toLowerCase()
  if (!s) return []
  return s.split(/\s+/g).map(t => t.trim()).filter(Boolean)
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

function parseAssetFileName(name: string): { assetId: string; ext: string } {
  const s = String(name || '').trim()
  const dotIdx = s.lastIndexOf('.')
  if (dotIdx <= 0) return { assetId: s, ext: '' }
  return { assetId: s.slice(0, dotIdx), ext: s.slice(dotIdx + 1).toLowerCase() }
}

function buildAssetEntries(items: { relPath: string; name: string; displayName?: string; size: number; modifiedMs: number }[]): AssetEntry[] {
  return (Array.isArray(items) ? items : []).map(item => {
    const { assetId, ext } = parseAssetFileName(item.name)
    const mime = mimeFromExt(ext)
    const kind = mime ? kindFromMime(mime) : 'document'
    return {
      relPath: String(item.relPath || '').trim(),
      fileName: String(item.name || '').trim(),
      displayName: String(item.displayName || '').trim() || undefined,
      assetId,
      ext,
      kind,
      size: Number(item.size) || 0,
      modifiedMs: Number(item.modifiedMs) || 0,
      thumbnailUrl: undefined,
    }
  })
}

export function QuickSearchPopover(props: Props) {
  const {
    gateway,
    scope,
    open,
    triggerEl,
    notes,
    allNotesLayout,
    onToggleAllNotesLayout,
    noteCardInfoById,
    onEnsureNoteCardInfoLoaded,
    onClose,
    onOpenNote,
    onOpenAsset,
  } = props

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

  React.useEffect(() => {
    if (!open) return
    // Keep session state (query/mode/scroll) across open/close.
    // When opening, just focus the input to keep the interaction snappy.
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

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
  }, [gateway, assets.length, mode, open, scope])

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

  const noteMatches = React.useMemo(() => {
    const tokens = normalizeQuery(query)
    if (!tokens.length) return []
    const list = Array.isArray(notes) ? notes : []
    const ranked = list
      .map(n => {
        const id = String(n?.id || '')
        const title = String(n?.title || '')
        const score = Math.max(scoreText(title, tokens) * 10, scoreText(id, tokens) * 4)
        return { note: n, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.note.updatedAtMs || 0) - (a.note.updatedAtMs || 0))
      .slice(0, 48)
    return ranked.map(x => x.note)
  }, [notes, query])

  React.useEffect(() => {
    if (!open) return
    if (mode !== 'notes') return
    if (!noteMatches.length) return
    const ctl = startPrefetchNoteCardInfo({
      notes: noteMatches,
      getInfoById: id => noteCardInfoById[id],
      refresh: onEnsureNoteCardInfoLoaded,
      maxWorkers: 6,
    })
    return () => ctl.cancel()
  }, [mode, noteCardInfoById, noteMatches, onEnsureNoteCardInfoLoaded, open])

  const assetMatches = React.useMemo(() => {
    const tokens = normalizeQuery(query)
    if (!tokens.length) return []
    const list = Array.isArray(assets) ? assets : []
    const ranked = list
      .map(a => {
        const name = pickAssetDisplayName({ explicitName: a.displayName, ext: a.ext })
        const fallback = `${a.fileName} ${a.assetId}.${a.ext} ${a.assetId}`
        const score = Math.max(scoreText(name, tokens) * 10, scoreText(fallback, tokens))
        return { asset: a, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.asset.modifiedMs || 0) - (a.asset.modifiedMs || 0))
      .slice(0, 48)
    return ranked.map(x => x.asset)
  }, [assets, query])

  const showEmptyHint = !query.trim()
  const showNoMatch = !!query.trim() && ((mode === 'notes' && !noteMatches.length) || (mode === 'assets' && !assetMatches.length))

  return (
    <Popper
      open={open}
      keepMounted
      anchorEl={viewportAnchor as any}
      placement="bottom"
      disablePortal={false}
      sx={{ zIndex: 2000 }}
    >
      <Box ref={popperRootRef} sx={{ pt: 0.75, WebkitAppRegion: 'no-drag' }}>
        <ClickAwayListener
          onClickAway={(e: any) => {
            // When `keepMounted` is enabled, ClickAwayListener remains active even while hidden.
            // Ignore click-away events unless the popover is actually open.
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
              border: '1px solid rgba(0,0,0,.08)',
              boxShadow: '0 18px 48px rgba(0,0,0,.20)',
            }}
          >
            <Box sx={{ px: 1.25, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <SearchRoundedIcon sx={{ color: 'rgba(0,0,0,.46)', fontSize: 18 }} />
              <InputBase
                inputRef={inputRef}
                value={query}
                placeholder={mode === 'assets' ? '搜索附件（名称 / 扩展名 / ID）' : '搜索笔记（标题 / ID）'}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  if (mode === 'notes' && noteMatches[0]) {
                    e.preventDefault()
                    onOpenNote(noteMatches[0])
                    onClose()
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
                    border: 0,
                    bgcolor: 'rgba(0,0,0,.04)',
                    px: 1,
                    py: 0.6,
                    borderRadius: 2,
                    cursor: 'pointer',
                    color: 'rgba(0,0,0,.62)',
                    fontSize: 11,
                    fontWeight: 900,
                    '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' },
                  }}
                >
                  {allNotesLayout === 'list' ? '网格' : allNotesLayout === 'grid' ? '紧凑' : '列表'}
                </Box>
              ) : null}
              <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.38)' }}>{query.trim() ? 'Enter 打开第一条' : ''}</Typography>
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
                  <Typography sx={{ fontSize: 12, color: '#d32f2f', fontWeight: 900 }}>{assetsError}</Typography>
                </Box>
              ) : null}

              {showNoMatch ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>没有匹配结果</Typography>
                </Box>
              ) : null}

              {mode === 'notes' && noteMatches.length ? (
                allNotesLayout === 'grid' ? (
                  <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                    {noteMatches.map(n => (
                      <AllNotesGridNoteCard
                        key={n.id}
                        note={n}
                        info={noteCardInfoById[n.id]}
                        onOpen={note => {
                          onOpenNote(note)
                          onClose()
                        }}
                        onCopyRef={note => {
                          void gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                          void gateway.host.toast('已复制引用占位符')
                        }}
                        onMore={undefined}
                      />
                    ))}
                  </Box>
                ) : allNotesLayout === 'icon' ? (
                  <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 1 }}>
                    {noteMatches.map(n => (
                      <AllNotesIconNoteCard
                        key={n.id}
                        note={n}
                        info={noteCardInfoById[n.id]}
                        onOpen={note => {
                          onOpenNote(note)
                          onClose()
                        }}
                        onCopyRef={note => {
                          void gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                          void gateway.host.toast('已复制引用占位符')
                        }}
                        onMore={undefined}
                      />
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {noteMatches.map(n => (
                      <AllNotesListNoteRow
                        key={n.id}
                        note={n}
                        info={noteCardInfoById[n.id]}
                        onOpen={note => {
                          onOpenNote(note)
                          onClose()
                        }}
                        onCopyRef={note => {
                          void gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                          void gateway.host.toast('已复制引用占位符')
                        }}
                        onMore={undefined}
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
