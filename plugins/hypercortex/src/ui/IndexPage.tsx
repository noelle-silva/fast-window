import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'

import type { AssetEntry } from '../assetTypes'
import type { Api, NoteMeta, VaultScope } from '../core'
import {
  addRef,
  createFolder,
  getFolderById,
  getRefsByFolderId,
  removeRef,
  type FavoriteItemRef,
  type HyperCortexFavoritesDocV1,
} from '../favorites'
import { AssetCard } from './index-cards/AssetCard'
import { FolderCard } from './index-cards/FolderCard'
import { NoteCard } from './index-cards/NoteCard'
import { StaleRefCard } from './index-cards/StaleRefCard'

type Props = {
  api: Api
  scope: VaultScope
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  editMode: boolean
  noteIndex?: Record<string, NoteMeta>
  assetIndex?: Record<string, any>
  onNavigateFolder: (folderId: string) => void
  onOpenNote: (note: NoteMeta) => void
  onOpenAsset: (asset: AssetEntry) => void
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
  onEditModeChange: (editMode: boolean) => void
}

type AddKind = 'folder' | 'note' | 'asset'

function folderTitle(doc: HyperCortexFavoritesDocV1, folderId: string): string {
  const id = String(folderId || '').trim() || 'root'
  if (id === 'root') return '收藏夹'
  return getFolderById(doc, id)?.title || '未命名文件夹'
}

function overlayCard(content: React.ReactNode, options: { showRemove: boolean; onRemove?: () => void }): React.ReactNode {
  const { showRemove, onRemove } = options

  return (
    <Box sx={{ position: 'relative', minHeight: 100, display: 'flex' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>{content}</Box>
      {showRemove ? (
        <Tooltip title="移除">
          <IconButton
            size="small"
            aria-label="移除"
            onClick={e => {
              e.stopPropagation()
              onRemove?.()
            }}
            sx={{
              position: 'absolute',
              right: 6,
              bottom: 6,
              bgcolor: 'rgba(255,255,255,.92)',
              boxShadow: '0 1px 2px rgba(0,0,0,.10)',
              color: 'rgba(0,0,0,.55)',
              '&:hover': { bgcolor: 'rgba(211,47,47,.10)', color: '#d32f2f' },
            }}
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  )
}

function buildAssetLookup(assetIndex?: Record<string, any>): {
  byKey: Record<string, AssetEntry>
  byAssetId: Record<string, AssetEntry>
} {
  const byKey: Record<string, AssetEntry> = {}
  const byAssetId: Record<string, AssetEntry> = {}
  if (!assetIndex) return { byKey, byAssetId }

  for (const [k, v] of Object.entries(assetIndex)) {
    const asset = v as AssetEntry
    if (!asset || typeof asset !== 'object') continue
    if (typeof (asset as any).relPath !== 'string') continue
    if (typeof (asset as any).assetId !== 'string') continue
    if (typeof (asset as any).ext !== 'string') continue
    byKey[String(k)] = asset
    byAssetId[String(asset.assetId)] = asset
    const key2 = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
    byKey[key2] = asset
  }
  return { byKey, byAssetId }
}

export function IndexPage(props: Props): React.ReactNode {
  const {
    doc,
    currentFolderId,
    editMode,
    noteIndex,
    assetIndex,
    onNavigateFolder,
    onOpenNote,
    onOpenAsset,
    onDocChange,
    onEditModeChange,
  } = props

  const [breadcrumb, setBreadcrumb] = React.useState<string[]>(['root'])
  const [addAnchorEl, setAddAnchorEl] = React.useState<HTMLElement | null>(null)
  const [addKind, setAddKind] = React.useState<AddKind | null>(null)
  const [folderTitleDraft, setFolderTitleDraft] = React.useState('')
  const [noteIdDraft, setNoteIdDraft] = React.useState('')
  const [assetIdDraft, setAssetIdDraft] = React.useState('')
  const [noteSearch, setNoteSearch] = React.useState('')
  const [assetSearch, setAssetSearch] = React.useState('')

  const refs = React.useMemo(() => getRefsByFolderId(doc, currentFolderId), [doc, currentFolderId])
  const currentTitle = React.useMemo(() => folderTitle(doc, currentFolderId), [doc, currentFolderId])
  const assetLookup = React.useMemo(() => buildAssetLookup(assetIndex), [assetIndex])

  React.useEffect(() => {
    const nextId = String(currentFolderId || '').trim() || 'root'
    setBreadcrumb(prev => {
      const base = prev?.length ? prev : ['root']
      if (nextId === 'root') return ['root']
      if (base[base.length - 1] === nextId) return base
      const existingIdx = base.indexOf(nextId)
      if (existingIdx >= 0) return base.slice(0, existingIdx + 1)
      if (base[0] !== 'root') return ['root', ...base, nextId]
      return [...base, nextId]
    })
  }, [currentFolderId])

  const closeAddMenu = () => setAddAnchorEl(null)
  const openAddMenu = (el: HTMLElement) => setAddAnchorEl(el)

  const openAddDialog = (kind: AddKind) => {
    closeAddMenu()
    setAddKind(kind)
    setFolderTitleDraft('')
    setNoteIdDraft('')
    setAssetIdDraft('')
    setNoteSearch('')
    setAssetSearch('')
  }

  const closeAddDialog = () => setAddKind(null)

  const removeOneRef = (refId: string) => {
    const next = removeRef(doc, refId)
    if (next !== doc) onDocChange(next)
  }

  const confirmAddFolder = () => {
    const created = createFolder(doc, folderTitleDraft)
    const added = addRef(created.doc, currentFolderId, 'folder', created.folder.id)
    onDocChange(added?.doc || created.doc)
    closeAddDialog()
  }

  const confirmAddNote = (id?: string) => {
    const targetId = String(id ?? noteIdDraft ?? '').trim()
    if (!targetId) return
    const added = addRef(doc, currentFolderId, 'note', targetId)
    if (added) onDocChange(added.doc)
    closeAddDialog()
  }

  const confirmAddAsset = (id?: string) => {
    const targetId = String(id ?? assetIdDraft ?? '').trim()
    if (!targetId) return
    const added = addRef(doc, currentFolderId, 'asset', targetId)
    if (added) onDocChange(added.doc)
    closeAddDialog()
  }

  const folderSuggestions = React.useMemo(() => {
    // 仅用于显示“已有文件夹可引用”；创建新文件夹则走 confirmAddFolder
    // （避免首版做“移动/归属”概念，保持 YAGNI）
    const all = Object.values(doc.folders || {})
      .filter(f => f && f.id && f.id !== 'root')
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
    return all.slice(0, 12)
  }, [doc])

  const noteSuggestions = React.useMemo(() => {
    if (!noteIndex) return []
    const q = String(noteSearch || '').trim().toLowerCase()
    const all = Object.values(noteIndex || {}).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
    const filtered = q
      ? all.filter(n => String(n.title || '').toLowerCase().includes(q) || String(n.id || '').toLowerCase().includes(q))
      : all
    return filtered.slice(0, 20)
  }, [noteIndex, noteSearch])

  const assetSuggestions = React.useMemo(() => {
    const values = Object.values(assetLookup.byKey || {})
    const uniq: AssetEntry[] = []
    const seen = new Set<string>()
    for (const a of values) {
      const key = a.ext ? `${a.assetId}.${a.ext}` : a.assetId
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(a)
    }
    uniq.sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0))
    const q = String(assetSearch || '').trim().toLowerCase()
    const filtered = q
      ? uniq.filter(a => {
          const key = `${a.assetId}.${a.ext}`.toLowerCase()
          const name = String(a.displayName || a.fileName || '').toLowerCase()
          return key.includes(q) || name.includes(q)
        })
      : uniq
    return filtered.slice(0, 20)
  }, [assetLookup, assetSearch])

  const renderRef = (ref: FavoriteItemRef): React.ReactNode => {
    if (ref.kind === 'folder') {
      const folder = getFolderById(doc, ref.targetId)
      if (!folder) return overlayCard(<StaleRefCard ref={ref} onClickRemove={removeOneRef} />, { showRemove: false })
      const refCount = getRefsByFolderId(doc, folder.id).length
      return overlayCard(
        <FolderCard
          folderId={folder.id}
          title={folder.title}
          refCount={refCount}
          onClick={fid => onNavigateFolder(fid)}
        />,
        { showRemove: editMode, onRemove: () => removeOneRef(ref.id) },
      )
    }

    if (ref.kind === 'note') {
      const note = noteIndex?.[ref.targetId]
      if (!note) return overlayCard(<StaleRefCard ref={ref} onClickRemove={removeOneRef} />, { showRemove: false })
      return overlayCard(<NoteCard ref={ref} note={note} onClick={onOpenNote} />, { showRemove: editMode, onRemove: () => removeOneRef(ref.id) })
    }

    if (ref.kind === 'asset') {
      const asset = assetLookup.byKey[ref.targetId] || assetLookup.byAssetId[ref.targetId]
      if (!asset) return overlayCard(<StaleRefCard ref={ref} onClickRemove={removeOneRef} />, { showRemove: false })
      return overlayCard(<AssetCard ref={ref} asset={asset} onClick={onOpenAsset} />, { showRemove: editMode, onRemove: () => removeOneRef(ref.id) })
    }

    return overlayCard(<StaleRefCard ref={ref} onClickRemove={removeOneRef} />, { showRemove: false })
  }

  return (
    <Box sx={{ px: 1.5, py: 1.5 }}>
      {/* 面包屑 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', pb: 1.25 }}>
        {breadcrumb.map((id, idx) => {
          const isLast = idx === breadcrumb.length - 1
          const title = folderTitle(doc, id)
          return (
            <React.Fragment key={`${id}_${idx}`}>
              <Box
                onClick={() => {
                  if (isLast) return
                  onNavigateFolder(id)
                }}
                role={isLast ? undefined : 'button'}
                tabIndex={isLast ? -1 : 0}
                onKeyDown={e => {
                  if (isLast) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNavigateFolder(id)
                  }
                }}
                sx={{
                  cursor: isLast ? 'default' : 'pointer',
                  userSelect: 'none',
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 2,
                  '&:hover': isLast ? undefined : { bgcolor: 'rgba(0,0,0,.03)' },
                }}
              >
                <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.70)', fontWeight: isLast ? 800 : 700 }}>
                  {title}
                </Typography>
              </Box>
              {!isLast ? <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.38)' }}>›</Typography> : null}
            </React.Fragment>
          )
        })}
      </Box>

      {/* 标题栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pb: 1.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 900, color: '#111', lineHeight: 1.2 }}>
            {currentTitle}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.50)', pt: 0.25 }}>
            {refs.length} 条
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {editMode ? (
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={e => openAddMenu(e.currentTarget)}
              sx={{ borderRadius: 999 }}
            >
              添加
            </Button>
          ) : null}

          <Button
            variant={editMode ? 'outlined' : 'contained'}
            onClick={() => onEditModeChange(!editMode)}
            sx={{ borderRadius: 999, whiteSpace: 'nowrap' }}
          >
            {editMode ? '完成' : '编辑'}
          </Button>
        </Box>
      </Box>

      {/* 内容区 */}
      {refs.length === 0 ? (
        <Box sx={{ px: 1, py: 4, borderRadius: 4, bgcolor: 'rgba(0,0,0,.02)', textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'rgba(0,0,0,.70)' }}>
            这个收藏夹还是空的
          </Typography>
          {editMode ? (
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 0.75 }}>
              点击右上角添加卡片
            </Typography>
          ) : null}
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 1,
          }}
        >
          {refs.map(ref => (
            <Box key={ref.id}>{renderRef(ref)}</Box>
          ))}
        </Box>
      )}

      {/* 添加菜单 */}
      <Menu
        open={!!addAnchorEl}
        onClose={closeAddMenu}
        anchorEl={addAnchorEl}
        PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}
      >
        <MenuItem onClick={() => openAddDialog('folder')}>收藏夹</MenuItem>
        <MenuItem onClick={() => openAddDialog('note')}>笔记</MenuItem>
        <MenuItem onClick={() => openAddDialog('asset')}>附件</MenuItem>
      </Menu>

      {/* 添加：收藏夹 */}
      <Dialog open={addKind === 'folder'} onClose={closeAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加收藏夹</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>
            会先创建一个新收藏夹，再把它放进当前收藏夹里（像“抽屉里放一个小抽屉”）。
          </Typography>
          <TextField
            fullWidth
            autoFocus
            label="收藏夹标题"
            value={folderTitleDraft}
            onChange={e => setFolderTitleDraft(e.target.value)}
            placeholder="例如：项目灵感 / 临时收纳"
          />

          {folderSuggestions.length ? (
            <Box sx={{ pt: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.55)', pb: 1 }}>
                最近的收藏夹（可直接引用）
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1 }}>
                {folderSuggestions.map(f => {
                  const cnt = getRefsByFolderId(doc, f.id).length
                  const addThis = () => {
                    const added = addRef(doc, currentFolderId, 'folder', f.id)
                    if (added) onDocChange(added.doc)
                    closeAddDialog()
                  }
                  return (
                    <Box key={f.id}>
                      {overlayCard(
                        <FolderCard folderId={f.id} title={f.title} refCount={cnt} onClick={addThis} />,
                        {
                          showRemove: false,
                        },
                      )}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddDialog}>取消</Button>
          <Button variant="contained" onClick={confirmAddFolder}>
            创建并添加
          </Button>
        </DialogActions>
      </Dialog>

      {/* 添加：笔记 */}
      <Dialog open={addKind === 'note'} onClose={closeAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加笔记</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>
            你可以输入笔记 ID；如果已经传入笔记索引，也可以在下面搜索并点选。
          </Typography>
          <TextField
            fullWidth
            autoFocus
            label="笔记 ID"
            value={noteIdDraft}
            onChange={e => setNoteIdDraft(e.target.value)}
            placeholder="例如：n_abc123..."
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmAddNote()
              }
            }}
          />

          {noteIndex ? (
            <Box sx={{ pt: 2 }}>
              <TextField
                fullWidth
                label="搜索笔记"
                value={noteSearch}
                onChange={e => setNoteSearch(e.target.value)}
                placeholder="按标题或 ID"
              />
              <Box sx={{ pt: 1.5 }}>
                {noteSuggestions.map(n => (
                  <Box key={n.id} sx={{ pb: 1 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      sx={{ justifyContent: 'space-between', borderRadius: 4, textTransform: 'none' }}
                      onClick={() => confirmAddNote(n.id)}
                    >
                      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {n.title || '未命名'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                          {n.id}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.45)' }}>添加</Typography>
                    </Button>
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddDialog}>取消</Button>
          <Button variant="contained" onClick={() => confirmAddNote()}>
            添加
          </Button>
        </DialogActions>
      </Dialog>

      {/* 添加：附件 */}
      <Dialog open={addKind === 'asset'} onClose={closeAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加附件</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>
            你可以输入资源 key（例如：assetId 或 assetId.ext）；如果已经传入附件索引，也可以在下面搜索并点选。
          </Typography>
          <TextField
            fullWidth
            autoFocus
            label="附件 key"
            value={assetIdDraft}
            onChange={e => setAssetIdDraft(e.target.value)}
            placeholder="例如：a_abc123.png"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmAddAsset()
              }
            }}
          />

          {Object.keys(assetLookup.byKey).length ? (
            <Box sx={{ pt: 2 }}>
              <TextField
                fullWidth
                label="搜索附件"
                value={assetSearch}
                onChange={e => setAssetSearch(e.target.value)}
                placeholder="按文件名或 key"
              />
              <Box sx={{ pt: 1.25 }}>
                {assetSuggestions.map(a => {
                  const key = a.ext ? `${a.assetId}.${a.ext}` : a.assetId
                  const title = String(a.displayName || a.fileName || key)
                  return (
                    <Box key={key} sx={{ pb: 1 }}>
                      <Button
                        fullWidth
                        variant="outlined"
                        sx={{ justifyContent: 'space-between', borderRadius: 4, textTransform: 'none' }}
                        onClick={() => confirmAddAsset(key)}
                      >
                        <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                          <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {title}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                            {key}
                          </Typography>
                        </Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.45)' }}>添加</Typography>
                      </Button>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddDialog}>取消</Button>
          <Button variant="contained" onClick={() => confirmAddAsset()}>
            添加
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}
