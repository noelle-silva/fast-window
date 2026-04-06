import * as React from 'react'
import { AppBar, Box, CssBaseline, GlobalStyles, IconButton, InputBase, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import { buildNoteHtmlDoc, ensureIndex, ensureVaultDirs, escapeHtml, getApi, noteRelPath, nowId, rebuildIndexFromFs, saveIndex, tryLoadIndex, type NoteMeta } from '../core'

type PageId = 'home' | 'new-note' | 'attachments' | 'all-notes' | 'index' | 'settings'

const theme = createTheme({
  palette: {
    mode: 'light',
    background: { default: '#ffffff', paper: '#ffffff' },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  },
})

function isInteractiveTarget(target: EventTarget | null): boolean {
  const t = target as any
  if (!t || typeof t.closest !== 'function') return false
  return !!t.closest('button, a, input, textarea, select, [role="button"]')
}

export function HyperCortexApp() {
  const api = React.useMemo(() => getApi(), [])
  const [page, setPage] = React.useState<PageId>('home')
  const [newNoteTitle, setNewNoteTitle] = React.useState('新建笔记')
  const [newNoteContent, setNewNoteContent] = React.useState('')
  const [newNoteSaving, setNewNoteSaving] = React.useState(false)
  const [savedNote, setSavedNote] = React.useState<{ id: string; file: string; createdAtMs: number } | null>(null)
  const [allNotesLayout, setAllNotesLayout] = React.useState<'list' | 'grid' | 'icon'>('list')
  const [allNotes, setAllNotes] = React.useState<NoteMeta[]>([])
  const [allNotesLoading, setAllNotesLoading] = React.useState(false)
  const [allNotesLoadError, setAllNotesLoadError] = React.useState<string | null>(null)

  const backToHost = React.useCallback(() => {
    try {
      if (typeof api.ui?.back === 'function') return void api.ui.back()
      if (typeof api.host?.back === 'function') return void api.host.back()
      return void api.ui?.showToast?.('无法返回')
    } catch (e: any) {
      api.ui?.showToast?.(String(e?.message || e))
    }
  }, [api])

  const onTopbarPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      if (isInteractiveTarget(e.target)) return
      api.ui?.startDragging?.()
    },
    [api],
  )

  const sortNotes = React.useCallback((list: NoteMeta[]) => {
    return list.slice().sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
  }, [])

  const toggleAllNotesLayout = React.useCallback(() => {
    setAllNotesLayout(prev => (prev === 'list' ? 'grid' : prev === 'grid' ? 'icon' : 'list'))
  }, [])

  const loadAllNotes = React.useCallback(async () => {
    setAllNotesLoading(true)
    setAllNotesLoadError(null)
    try {
      const scope = 'library' as const
      let idx = await tryLoadIndex(api, scope)
      if (!idx) {
        idx = await ensureIndex(api, scope)
        idx = await rebuildIndexFromFs(api, scope, idx)
      }
      const notes = sortNotes(Object.values(idx.notes || {}))
      setAllNotes(notes)
    } catch (e: any) {
      setAllNotesLoadError(String(e?.message || e || '加载全部笔记失败'))
    } finally {
      setAllNotesLoading(false)
    }
  }, [api, sortNotes])

  React.useEffect(() => {
    if (page !== 'all-notes') return
    void loadAllNotes()
  }, [loadAllNotes, page])

  const handleSaveNewNote = React.useCallback(async () => {
    if (newNoteSaving) return
    setNewNoteSaving(true)
    try {
      const scope = 'library' as const
      const title = String(newNoteTitle || '').trim() || '未命名'
      const contentHtml = newNoteContent
        .split(/\r?\n/)
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('')

      const existing = savedNote
      const id = existing?.id || nowId()
      const relPath = noteRelPath(id, title)
      const html = buildNoteHtmlDoc({ id, title, contentHtml })
      const nowMs = Date.now()

      await ensureVaultDirs(api, scope)
      await api.files.writeText({ scope, path: relPath, text: html, overwrite: true })

      const idx = await ensureIndex(api, scope)
      const next = {
        ...idx,
        notes: {
          ...idx.notes,
          [id]: {
            id,
            title,
            file: relPath,
            createdAtMs: existing?.createdAtMs ?? nowMs,
            updatedAtMs: nowMs,
          },
        },
      }
      await saveIndex(api, scope, next)
      setSavedNote({ id, file: relPath, createdAtMs: existing?.createdAtMs ?? nowMs })
      setAllNotes(prev =>
        sortNotes([
          {
            id,
            title,
            file: relPath,
            createdAtMs: existing?.createdAtMs ?? nowMs,
            updatedAtMs: nowMs,
          },
          ...prev.filter(item => item.id !== id),
        ]),
      )
      await api.ui.showToast('笔记已保存')
    } catch (e: any) {
      await api.ui.showToast(String(e?.message || e || '保存失败'))
    } finally {
      setNewNoteSaving(false)
    }
  }, [api, newNoteContent, newNoteSaving, newNoteTitle, savedNote])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%' },
          body: { height: '100%', margin: 0, backgroundColor: '#fff' },
          '#app': { height: '100%' },
          '*': {
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,.24) transparent',
          },
          '*::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '*::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '*::-webkit-scrollbar-button': {
            width: 0,
            height: 0,
            display: 'none',
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,.24)',
            borderRadius: 999,
            border: '2px solid transparent',
            backgroundClip: 'content-box',
          },
          '*::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'rgba(0,0,0,.34)',
          },
          '*::-webkit-scrollbar-corner': {
            background: 'transparent',
          },
        }}
      />

      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
        <AppBar position="static" elevation={0} sx={{ bgcolor: '#fff', color: 'text.primary' }}>
          <Toolbar
            variant="dense"
            data-tauri-drag-region="true"
            sx={{
              gap: 0.5,
              minHeight: 40,
              pl: 0,
              pr: 1,
              '&.MuiToolbar-root': { minHeight: 40, paddingLeft: 0, paddingRight: 8 },
              WebkitAppRegion: 'drag',
            }}
            onPointerDown={onTopbarPointerDown}
          >
            <IconButton
              onClick={backToHost}
              size="small"
              aria-label="返回主界面"
              data-tauri-drag-region="false"
              sx={{ WebkitAppRegion: 'no-drag', ml: 0.25 }}
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>

            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
              HyperCortex
            </Typography>

            <Box sx={{ flex: 1 }} />
          </Toolbar>
        </AppBar>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box
            sx={{
              width: 52,
              py: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Tooltip title="主页" placement="right">
              <IconButton
                size="small"
                aria-label="主页"
                onClick={() => setPage('home')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'home' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'home' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <HomeRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="新建笔记" placement="right">
              <IconButton
                size="small"
                aria-label="新建笔记"
                onClick={() => setPage('new-note')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'new-note' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'new-note' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="索引" placement="right">
              <IconButton
                size="small"
                aria-label="索引"
                onClick={() => setPage('index')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'index' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'index' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AccountTreeRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="附件" placement="right">
              <IconButton
                size="small"
                aria-label="附件"
                onClick={() => setPage('attachments')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'attachments' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'attachments' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AttachFileRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="全部笔记" placement="right">
              <IconButton
                size="small"
                aria-label="全部笔记"
                onClick={() => setPage('all-notes')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'all-notes' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'all-notes' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <NotesRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="设置" placement="right">
              <IconButton
                size="small"
                aria-label="设置"
                onClick={() => setPage('settings')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'settings' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'settings' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <SettingsRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Box sx={{ flex: 1 }} />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
            <Box sx={{ minHeight: '100%', p: 2 }}>
              {page === 'home' ? <Typography color="text.secondary">这是主页页面。</Typography> : null}
              {page === 'new-note' ? (
                <Box sx={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Box
                      sx={{
                        width: '100%',
                        maxWidth: 240,
                        pb: 0.5,
                        borderBottom: '1px solid',
                        borderColor: 'rgba(0,0,0,.16)',
                      }}
                    >
                      <InputBase
                        value={newNoteTitle}
                        onChange={e => setNewNoteTitle(e.target.value)}
                        placeholder="输入标题"
                        fullWidth
                        inputProps={{ 'aria-label': '笔记标题' }}
                        sx={{
                          fontSize: 28,
                          lineHeight: 1.2,
                          fontWeight: 900,
                          color: '#111',
                          '& input': {
                            p: 0,
                          },
                        }}
                      />
                    </Box>

                    <Tooltip title="保存" placement="right">
                      <IconButton
                        size="small"
                        aria-label="保存笔记"
                        onClick={() => void handleSaveNewNote()}
                        disabled={newNoteSaving}
                        sx={{
                          color: 'rgba(0,0,0,.58)',
                          bgcolor: 'transparent',
                          boxShadow: 'none',
                          border: 0,
                          transition: 'background-color .16s ease, color .16s ease',
                          '&:hover': {
                            bgcolor: 'rgba(0,0,0,.06)',
                            color: '#111',
                          },
                          '&.Mui-disabled': {
                            color: 'rgba(0,0,0,.28)',
                          },
                        }}
                      >
                        <SaveRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  <InputBase
                    value={newNoteContent}
                    onChange={e => setNewNoteContent(e.target.value)}
                    placeholder="开始输入正文..."
                    fullWidth
                    multiline
                    minRows={12}
                    inputProps={{ 'aria-label': '笔记正文' }}
                    sx={{
                      mt: 2,
                      width: '100%',
                      flex: 1,
                      alignItems: 'flex-start',
                      fontSize: 16,
                      lineHeight: 1.8,
                      color: '#222',
                      '& textarea': {
                        padding: 0,
                        resize: 'none',
                      },
                    }}
                  />
                </Box>
              ) : null}
              {page === 'attachments' ? <Typography color="text.secondary">这是附件页面。</Typography> : null}
              {page === 'all-notes' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>全部笔记</Typography>
                    <Tooltip
                      title={allNotesLayout === 'list' ? '切换到网格' : allNotesLayout === 'grid' ? '切换到紧凑' : '切换到列表'}
                      placement="left"
                    >
                      <IconButton
                        size="small"
                        aria-label={allNotesLayout === 'list' ? '切换到网格' : allNotesLayout === 'grid' ? '切换到紧凑' : '切换到列表'}
                        onClick={toggleAllNotesLayout}
                        sx={{
                          color: 'rgba(0,0,0,.58)',
                          bgcolor: 'transparent',
                          boxShadow: 'none',
                          border: 0,
                          '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                        }}
                      >
                        {allNotesLayout === 'list' ? (
                          <ViewModuleRoundedIcon fontSize="small" />
                        ) : allNotesLayout === 'grid' ? (
                          <AppsRoundedIcon fontSize="small" />
                        ) : (
                          <ViewListRoundedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {allNotesLoading ? <Typography color="text.secondary">正在加载笔记...</Typography> : null}
                  {!allNotesLoading && allNotesLoadError ? <Typography color="error">{allNotesLoadError}</Typography> : null}
                  {!allNotesLoading && !allNotesLoadError && allNotes.length === 0 ? (
                    <Typography color="text.secondary">还没有笔记。</Typography>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'grid' ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 1,
                      }}
                    >
                      {allNotes.map(note => (
                        <Box
                          key={note.id}
                          sx={{
                            minHeight: 72,
                            px: 1.5,
                            py: 1.25,
                            borderRadius: 3,
                            bgcolor: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                            transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
                            '&:hover': {
                              bgcolor: 'rgba(0,0,0,.02)',
                              boxShadow: '0 6px 16px rgba(0,0,0,.08)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: 14,
                              lineHeight: 1.5,
                              fontWeight: 600,
                              color: '#111',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {note.title}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'icon' ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
                        gap: 1,
                      }}
                    >
                      {allNotes.map(note => (
                        <Box
                          key={note.id}
                          sx={{
                            minHeight: 84,
                            px: 1.25,
                            py: 1.25,
                            borderRadius: 3,
                            bgcolor: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                            transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
                            '&:hover': {
                              bgcolor: 'rgba(0,0,0,.02)',
                              boxShadow: '0 6px 16px rgba(0,0,0,.08)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: 13,
                              lineHeight: 1.45,
                              fontWeight: 600,
                              color: '#111',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {note.title}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'list' ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {allNotes.map(note => (
                        <Box
                          key={note.id}
                          sx={{
                            px: 1.5,
                            py: 1.15,
                            borderRadius: 3,
                            bgcolor: '#fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                            transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
                            '&:hover': {
                              bgcolor: 'rgba(0,0,0,.02)',
                              boxShadow: '0 6px 16px rgba(0,0,0,.08)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: 14,
                              lineHeight: 1.5,
                              fontWeight: 600,
                              color: '#111',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {note.title}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  ) : null}
                </Box>
              ) : null}
              {page === 'index' ? <Typography color="text.secondary">这是索引页面。</Typography> : null}
              {page === 'settings' ? <Typography color="text.secondary">这是设置页面。</Typography> : null}
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
