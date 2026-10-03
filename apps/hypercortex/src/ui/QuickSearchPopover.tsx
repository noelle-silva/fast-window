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
import type {
  NoteSearchFaceKind,
  NoteSearchHit,
  SearchCatalog,
  SearchFieldOption,
  SearchKindOption,
} from '../gateway/types'
import type { HyperCortexGateway } from '../gateway'
import { unstyledButtonSurfaceSx } from './pluginUiStyles'
import { tagToneFromText, toneChipSx } from './uiTones'
import type { AllNotesLayout } from './AllNotesPage'
import { useSearchSession } from './quickSearchSession'
import {
  EMPTY_ASSET_FILTERS,
  EMPTY_NOTE_FILTERS,
  assetFiltersSignature,
  buildAssetSearchQuery,
  buildNoteSearchQuery,
  bytesToKbInput,
  dateInputToEndMs,
  dateInputToStartMs,
  hasAssetFilters,
  hasNoteFilters,
  kbInputToBytes,
  msToDateInput,
  noteFiltersSignature,
  toggleInList,
  type AssetSearchFilters,
  type NoteSearchFilters,
} from './quickSearchFilters'

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

function FilterChip(props: { label: string; active: boolean; onClick: () => void }): React.ReactNode {
  const { label, active, onClick } = props
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        ...unstyledButtonSurfaceSx,
        px: 1,
        py: 0.4,
        borderRadius: 999,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 900,
        color: active ? '#fff' : 'rgba(0,0,0,.6)',
        bgcolor: active ? 'var(--hc-primary)' : 'rgba(0,0,0,.05)',
        '&:hover': { bgcolor: active ? 'var(--hc-primary)' : 'rgba(0,0,0,.09)' },
      }}
    >
      {label}
    </Box>
  )
}

function FilterRow(props: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)', fontWeight: 900, flexShrink: 0 }}>{props.label}</Typography>
      {props.children}
    </Box>
  )
}

const filterInputSx = {
  appearance: 'auto',
  WebkitAppearance: 'auto',
  border: 0,
  margin: 0,
  font: 'inherit',
  fontFamily: 'inherit',
  outline: 'none',
  px: 0.75,
  py: 0.4,
  borderRadius: 1.5,
  fontSize: 11,
  color: 'rgba(0,0,0,.68)',
  bgcolor: 'rgba(0,0,0,.05)',
  boxShadow: 'inset 0 0 0 1px transparent',
  '&:focus': { boxShadow: 'inset 0 0 0 1px var(--hc-primary)', bgcolor: 'var(--hc-surface)' },
} as const

function DateRangeInputs(props: {
  from: number
  to: number
  onChange: (from: number, to: number) => void
}): React.ReactNode {
  const { from, to, onChange } = props
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box
        component="input"
        type="date"
        value={msToDateInput(from)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(dateInputToStartMs(e.target.value), to)}
        sx={filterInputSx}
      />
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.4)' }}>~</Typography>
      <Box
        component="input"
        type="date"
        value={msToDateInput(to)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(from, dateInputToEndMs(e.target.value))}
        sx={filterInputSx}
      />
    </Box>
  )
}

function SizeRangeInputs(props: {
  from: number
  to: number
  onChange: (from: number, to: number) => void
}): React.ReactNode {
  const { from, to, onChange } = props
  const numberSx = { ...filterInputSx, width: 68 }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box
        component="input"
        type="number"
        min={0}
        placeholder="最小"
        value={bytesToKbInput(from)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(kbInputToBytes(e.target.value), to)}
        sx={numberSx}
      />
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.4)' }}>~</Typography>
      <Box
        component="input"
        type="number"
        min={0}
        placeholder="最大"
        value={bytesToKbInput(to)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(from, kbInputToBytes(e.target.value))}
        sx={numberSx}
      />
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.4)' }}>KB</Typography>
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

function NoteFilterPanel(props: {
  catalog: SearchCatalog
  filters: NoteSearchFilters
  folders: { id: string; title: string }[]
  onChange: (next: NoteSearchFilters) => void
}): React.ReactNode {
  const { catalog, filters, folders, onChange } = props
  return (
    <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75, borderTop: '1px solid rgba(0,0,0,.06)' }}>
      <FilterRow label="维度">
        {catalog.noteFields.map((field: SearchFieldOption) => (
          <FilterChip
            key={field.key}
            label={field.label}
            active={filters.fields.includes(field.key)}
            onClick={() => onChange({ ...filters, fields: toggleInList(filters.fields, field.key) })}
          />
        ))}
      </FilterRow>
      {catalog.noteFaceKinds.length ? (
        <FilterRow label="面类型">
          {catalog.noteFaceKinds.map((face: NoteSearchFaceKind) => (
            <FilterChip
              key={face.kind}
              label={face.label}
              active={filters.faceKinds.includes(face.kind)}
              onClick={() => onChange({ ...filters, faceKinds: toggleInList(filters.faceKinds, face.kind) })}
            />
          ))}
        </FilterRow>
      ) : null}
      <FilterRow label="收藏夹">
        <Box
          component="select"
          value={filters.folderId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ ...filters, folderId: e.target.value })}
          sx={{ ...filterInputSx, minWidth: 120 }}
        >
          <option value="">全部</option>
          {folders.map(folder => (
            <option key={folder.id} value={folder.id}>
              {folder.title}
            </option>
          ))}
        </Box>
      </FilterRow>
      <FilterRow label="时间">
        <DateRangeInputs
          from={filters.updatedFromMs}
          to={filters.updatedToMs}
          onChange={(from, to) => onChange({ ...filters, updatedFromMs: from, updatedToMs: to })}
        />
      </FilterRow>
    </Box>
  )
}

function AssetFilterPanel(props: {
  catalog: SearchCatalog
  filters: AssetSearchFilters
  onChange: (next: AssetSearchFilters) => void
}): React.ReactNode {
  const { catalog, filters, onChange } = props
  return (
    <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75, borderTop: '1px solid rgba(0,0,0,.06)' }}>
      <FilterRow label="维度">
        {catalog.assetFields.map((field: SearchFieldOption) => (
          <FilterChip
            key={field.key}
            label={field.label}
            active={filters.fields.includes(field.key)}
            onClick={() => onChange({ ...filters, fields: toggleInList(filters.fields, field.key) })}
          />
        ))}
      </FilterRow>
      <FilterRow label="类型">
        <FilterChip label="全部" active={!filters.kind} onClick={() => onChange({ ...filters, kind: '' })} />
        {catalog.assetKinds.map((kind: SearchKindOption) => (
          <FilterChip
            key={kind.kind}
            label={kind.label}
            active={filters.kind === kind.kind}
            onClick={() => onChange({ ...filters, kind: filters.kind === kind.kind ? '' : kind.kind })}
          />
        ))}
      </FilterRow>
      <FilterRow label="大小">
        <SizeRangeInputs
          from={filters.sizeFrom}
          to={filters.sizeTo}
          onChange={(from, to) => onChange({ ...filters, sizeFrom: from, sizeTo: to })}
        />
      </FilterRow>
      <FilterRow label="时间">
        <DateRangeInputs
          from={filters.updatedFromMs}
          to={filters.updatedToMs}
          onChange={(from, to) => onChange({ ...filters, updatedFromMs: from, updatedToMs: to })}
        />
      </FilterRow>
    </Box>
  )
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
