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
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { type NoteMeta, type VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import { buildAssetEntry } from '../assetEntryModel'
import type { AssetEntry } from '../assetTypes'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { getAllFolders } from '../favorites'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import { folderDisplayTitle } from './favoritesTree'
import type { NoteSearchHit, SearchCatalog } from '../gateway/types'
import type { HyperCortexGateway } from '../gateway'
import { unstyledButtonSurfaceSx } from './pluginUiStyles'
import type { AllNotesLayout } from './AllNotesPage'
import { useSearchSession } from './quickSearchSession'
import {
  EMPTY_ASSET_FILTERS,
  EMPTY_NOTE_FILTERS,
  assetFiltersSignature,
  buildAssetSearchQuery,
  buildNoteSearchQuery,
  hasAssetFilters,
  hasNoteFilters,
  noteFiltersSignature,
  type AssetSearchFilters,
  type NoteSearchFilters,
} from './quickSearchFilters'
import { HighlightText, SearchNoteResultRow } from './QuickSearchResultRow'
import { NoteFilterPanel } from './QuickSearchNoteFilterPanel'
import { AssetFilterPanel } from './QuickSearchAssetFilterPanel'

type Mode = 'notes' | 'assets'

// SEARCH_PAGE_SIZE 是搜索每次请求的条数：首次加载与下滑懒加载共用。
const SEARCH_PAGE_SIZE = 48

type Props = {
  gateway: HyperCortexGateway
  scope: VaultScope
  open: boolean
  triggerEl: HTMLElement | null
  allNotesLayout: AllNotesLayout
  favoritesDoc: HyperCortexFavoritesDocV1 | null
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

export function QuickSearchPopover(props: Props) {
  const { gateway, scope, open, triggerEl, allNotesLayout, favoritesDoc, onToggleAllNotesLayout, onClose, onOpenNote, onOpenAsset } = props

  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const popperRootRef = React.useRef<HTMLDivElement | null>(null)

  const [mode, setMode] = React.useState<Mode>('notes')
  const [query, setQuery] = React.useState('')
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  const [catalog, setCatalog] = React.useState<SearchCatalog | null>(null)
  const [noteFilters, setNoteFilters] = React.useState<NoteSearchFilters>(EMPTY_NOTE_FILTERS)
  const [assetFilters, setAssetFilters] = React.useState<AssetSearchFilters>(EMPTY_ASSET_FILTERS)

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

  React.useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  // 过滤项事实源：可搜维度、面类型、附件类型全部由后端出口动态给出。
  React.useEffect(() => {
    if (!open || catalog) return
    let alive = true
    gateway.search
      .loadOptions()
      .then(next => {
        if (alive && next) setCatalog(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [catalog, gateway, open])

  const folders = React.useMemo(
    () => (favoritesDoc ? getAllFolders(favoritesDoc).map(folder => ({ id: folder.id, title: folderDisplayTitle(folder.id, folder.title) })) : []),
    [favoritesDoc],
  )

  const tokens = React.useMemo(() => normalizeQuery(query), [query])

  const notesEnabled = open && mode === 'notes' && (!!query.trim() || hasNoteFilters(noteFilters))
  const assetsEnabled = open && mode === 'assets' && (!!query.trim() || hasAssetFilters(assetFilters))

  const noteSession = useSearchSession<NoteSearchHit>({
    enabled: notesEnabled,
    signature: noteFiltersSignature(query, noteFilters),
    pageSize: SEARCH_PAGE_SIZE,
    fetchPage: (offset, limit) => gateway.search.queryNotes(scope, buildNoteSearchQuery(query, noteFilters, offset, limit)),
  })

  const assetSession = useSearchSession<AssetEntry>({
    enabled: assetsEnabled,
    signature: assetFiltersSignature(query, assetFilters),
    pageSize: SEARCH_PAGE_SIZE,
    fetchPage: async (offset, limit) => {
      const result = await gateway.search.queryAssets(scope, buildAssetSearchQuery(query, assetFilters, offset, limit))
      return { items: (result?.items || []).map(buildAssetEntry), total: Number(result?.total || 0) }
    },
  })

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 120) return
      if (mode === 'notes') noteSession.loadMore()
      else assetSession.loadMore()
    },
    [assetSession, mode, noteSession],
  )

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

  const openFirstNote = () => {
    const hit = noteSession.items[0]
    if (!hit) return
    const meta = searchHitToMeta(hit)
    const faceId = hit.faceHits?.length ? hit.faceHits[0].faceId : undefined
    onOpenNote(meta, faceId)
    onClose()
  }

  const activeFilterCount = mode === 'notes'
    ? noteFilters.fields.length + noteFilters.faceKinds.length + (noteFilters.folderId ? 1 : 0) + (noteFilters.updatedFromMs || noteFilters.updatedToMs ? 1 : 0)
    : assetFilters.fields.length + (assetFilters.kind ? 1 : 0) + (assetFilters.sizeFrom || assetFilters.sizeTo ? 1 : 0) + (assetFilters.updatedFromMs || assetFilters.updatedToMs ? 1 : 0)

  const session = mode === 'notes' ? noteSession : assetSession
  const hasQuery = !!query.trim()
  const showEmptyHint = !hasQuery && activeFilterCount === 0
  const showNoMatch = !session.loading && !session.error && !session.items.length && !showEmptyHint

  const openAsset = (asset: AssetEntry) => {
    onOpenAsset(asset)
    onClose()
  }

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
                placeholder={mode === 'assets' ? '搜索附件（名称 / 备注 / 标签）' : '搜索笔记（标题 / 简介 / 标签 / 正文）'}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  if (mode === 'notes') {
                    if (noteSession.items[0]) {
                      e.preventDefault()
                      openFirstNote()
                    }
                    return
                  }
                  if (mode === 'assets' && assetSession.items[0]) {
                    e.preventDefault()
                    openAsset(assetSession.items[0])
                  }
                }}
                sx={{ flex: 1, fontSize: 13 }}
              />
              <Box
                component="button"
                onClick={() => setFiltersOpen(v => !v)}
                aria-label="筛选"
                title="筛选"
                sx={{
                  ...unstyledButtonSurfaceSx,
                  position: 'relative',
                  bgcolor: filtersOpen ? 'var(--hc-primary-soft)' : 'rgba(0,0,0,.04)',
                  color: filtersOpen ? 'var(--hc-primary)' : 'rgba(0,0,0,.62)',
                  px: 1,
                  py: 0.6,
                  borderRadius: 2,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 900,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  '&:hover': { bgcolor: filtersOpen ? 'var(--hc-primary-hover)' : 'rgba(0,0,0,.08)' },
                }}
              >
                <TuneRoundedIcon sx={{ fontSize: 16 }} />
                筛选
                {activeFilterCount ? (
                  <Box
                    component="span"
                    sx={{
                      minWidth: 15,
                      height: 15,
                      px: 0.3,
                      borderRadius: 999,
                      bgcolor: 'var(--hc-primary)',
                      color: '#fff',
                      fontSize: 9.5,
                      lineHeight: '15px',
                      textAlign: 'center',
                    }}
                  >
                    {activeFilterCount}
                  </Box>
                ) : null}
              </Box>
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
                {session.total ? `命中 ${session.total}` : hasQuery ? 'Enter 打开第一条' : ''}
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

            {filtersOpen && catalog ? (
              mode === 'notes' ? (
                <NoteFilterPanel catalog={catalog} filters={noteFilters} folders={folders} onChange={setNoteFilters} />
              ) : (
                <AssetFilterPanel catalog={catalog} filters={assetFilters} onChange={setAssetFilters} />
              )
            ) : null}

            <Box onScroll={handleScroll} sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {showEmptyHint ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>输入关键词或设置过滤条件开始匹配</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 11, color: 'rgba(0,0,0,.42)' }}>
                    小贴士：支持空格分词；按 <Box component="span" sx={{ fontFamily: 'monospace' }}>Esc</Box> 关闭
                  </Typography>
                </Box>
              ) : null}

              {session.loading ? (
                <Box sx={{ px: 1.5, py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }}>正在搜索…</Typography>
                </Box>
              ) : null}

              {session.error ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'var(--hc-danger)', fontWeight: 900 }}>{session.error}</Typography>
                </Box>
              ) : null}

              {showNoMatch ? (
                <Box sx={{ px: 1.5, py: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>没有匹配结果</Typography>
                </Box>
              ) : null}

              {mode === 'notes' && !noteSession.loading && noteSession.items.length ? (
                allNotesLayout === 'grid' ? (
                  <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                    {noteSession.items.map(hit => (
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
                    {noteSession.items.map(hit => (
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
                    {noteSession.items.map(hit => (
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

              {mode === 'assets' && !assetSession.loading && assetSession.items.length ? (
                <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                  {assetSession.items.map(a => {
                    const title = pickAssetDisplayName({ explicitName: a.displayName, indexName: a.sourceName || a.fileName, ext: a.ext })
                    const extLabel = a.ext ? `.${a.ext}` : ''
                    return (
                      <Box
                        component="li"
                        key={`${a.assetId}.${a.ext}`}
                        onClick={() => openAsset(a)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openAsset(a)
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
                          <HighlightText text={title} tokens={tokens} />
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)', fontFamily: 'monospace' }} noWrap>
                          {extLabel} {a.assetId.slice(0, 12)}…
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              ) : null}

              {session.loadingMore ? (
                <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <CircularProgress size={14} />
                  <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>正在加载更多…</Typography>
                </Box>
              ) : null}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Box>
    </Popper>
  )
}
