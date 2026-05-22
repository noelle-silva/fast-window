import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, InputBase, Typography } from '@mui/material'

import type { VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import type { HyperCortexNoteVersionSnapshot, HyperCortexNoteVersionSummary } from '../../noteVersions'
import { isHtmlFace, labelForFaceKind } from '../../noteFaces'
import { HtmlFaceIframe } from '../HtmlFaceIframe'

type Props = {
  open: boolean
  gateway: HyperCortexGateway
  scope: VaultScope
  packageDir: string
  dirty: boolean
  onClose: () => void
  onSaveCurrent: () => Promise<void>
  onRestoreVersion: (versionId: string) => Promise<void>
}

function formatVersionTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toLocaleString()
}

function faceTitle(snapshot: HyperCortexNoteVersionSnapshot | null, faceId: string): string {
  const face = snapshot?.faces?.[faceId]?.manifest
  if (!face) return faceId
  return String(face.title || '').trim() || labelForFaceKind(face.kind)
}

function orderedFaceIds(snapshot: HyperCortexNoteVersionSnapshot | null): string[] {
  if (!snapshot) return []
  const out: string[] = []
  const push = (id: string) => {
    const faceId = String(id || '').trim()
    if (!faceId || out.includes(faceId) || !snapshot.faces?.[faceId]) return
    out.push(faceId)
  }
  snapshot.manifest.faceOrder.forEach(push)
  Object.keys(snapshot.faces || {}).forEach(push)
  return out
}

export function NoteVersionHistoryDialog(props: Props): React.ReactNode {
  const { open, gateway, scope, packageDir, dirty, onClose, onSaveCurrent, onRestoreVersion } = props
  const [versions, setVersions] = React.useState<HyperCortexNoteVersionSummary[]>([])
  const [selectedVersionId, setSelectedVersionId] = React.useState('')
  const [snapshot, setSnapshot] = React.useState<HyperCortexNoteVersionSnapshot | null>(null)
  const [selectedFaceId, setSelectedFaceId] = React.useState('')
  const [commitName, setCommitName] = React.useState('')
  const [loadingList, setLoadingList] = React.useState(false)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)
  const [error, setError] = React.useState('')

  const refreshVersions = React.useCallback(async () => {
    const dir = String(packageDir || '').trim()
    if (!dir) return
    setLoadingList(true)
    setError('')
    try {
      const next = await gateway.notes.listNoteVersions(scope, dir)
      setVersions(next)
      setSelectedVersionId(prev => next.some(item => item.versionId === prev) ? prev : next[0]?.versionId || '')
    } catch (err: any) {
      setError(String(err?.message || err || '加载版本历史失败'))
    } finally {
      setLoadingList(false)
    }
  }, [gateway, packageDir, scope])

  React.useEffect(() => {
    if (!open) return
    void refreshVersions()
  }, [open, refreshVersions])

  React.useEffect(() => {
    if (!open || !selectedVersionId || !String(packageDir || '').trim()) {
      setSnapshot(null)
      setSelectedFaceId('')
      return
    }
    setLoadingSnapshot(true)
    setError('')
    gateway.notes.loadNoteVersion(scope, packageDir, selectedVersionId)
      .then(next => {
        setSnapshot(next)
        setSelectedFaceId(prev => orderedFaceIds(next).includes(prev) ? prev : orderedFaceIds(next)[0] || '')
      })
      .catch((err: any) => setError(String(err?.message || err || '加载版本快照失败')))
      .finally(() => setLoadingSnapshot(false))
  }, [gateway, open, packageDir, scope, selectedVersionId])

  const publish = React.useCallback(async () => {
    const name = String(commitName || '').trim()
    if (!name || publishing) return
    setPublishing(true)
    setError('')
    try {
      if (dirty) await onSaveCurrent()
      const published = await gateway.notes.publishNoteVersion(scope, packageDir, name)
      setCommitName('')
      await refreshVersions()
      setSelectedVersionId(published.versionId)
      await gateway.host.toast('版本已发布')
    } catch (err: any) {
      const message = String(err?.message || err || '发布版本失败')
      setError(message)
      await gateway.host.toast(message)
    } finally {
      setPublishing(false)
    }
  }, [commitName, dirty, gateway, onSaveCurrent, packageDir, publishing, refreshVersions, scope])

  const restore = React.useCallback(async () => {
    if (!selectedVersionId || restoring) return
    setRestoring(true)
    setError('')
    try {
      await onRestoreVersion(selectedVersionId)
      await gateway.host.toast('已恢复到所选版本')
      onClose()
    } catch (err: any) {
      const message = String(err?.message || err || '恢复版本失败')
      setError(message)
      await gateway.host.toast(message)
    } finally {
      setRestoring(false)
    }
  }, [gateway, onClose, onRestoreVersion, restoring, selectedVersionId])

  const selectedFace = selectedFaceId ? snapshot?.faces?.[selectedFaceId] : null
  const selectedFaceIsHtml = !!selectedFace && isHtmlFace(selectedFace.manifest)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: 4, minHeight: 620 } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: 22, lineHeight: 1.2, fontWeight: 900 }}>版本历史</Typography>
        <Typography sx={{ mt: 0.75, fontSize: 13, color: 'rgba(0,0,0,.55)' }}>发布当前笔记的正式版本，并浏览过去版本。</Typography>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1, borderRadius: 3, bgcolor: 'rgba(17,24,39,.04)' }}>
          <InputBase
            value={commitName}
            onChange={event => setCommitName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void publish()
              }
            }}
            placeholder={dirty ? '输入提交名，发布前会先保存当前改动' : '输入提交名，例如：第一版发布'}
            inputProps={{ 'aria-label': '版本提交名' }}
            sx={{ flex: 1, minWidth: 0, px: 1.25, py: 0.75, borderRadius: 2, bgcolor: '#fff', fontSize: 14 }}
          />
          <Button variant="contained" onClick={() => void publish()} disabled={!String(commitName || '').trim() || publishing || !String(packageDir || '').trim()} sx={{ borderRadius: 999, px: 2.25, fontWeight: 800 }}>
            {publishing ? '发布中…' : dirty ? '保存并发布' : '发布版本'}
          </Button>
        </Box>

        {error ? <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography> : null}

        <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '280px minmax(0,1fr)' }, gridTemplateRows: { xs: '220px minmax(0,1fr)', md: '1fr' }, gap: 2 }}>
          <Box sx={{ minHeight: 0, overflow: 'auto', border: '1px solid rgba(0,0,0,.08)', borderRadius: 3, bgcolor: '#fff' }}>
            <Box sx={{ px: 1.5, py: 1.25, fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.52)', letterSpacing: '.08em' }}>VERSIONS</Box>
            <Divider />
            {loadingList ? <Typography sx={{ p: 2, fontSize: 13, color: 'rgba(0,0,0,.55)' }}>正在加载版本...</Typography> : null}
            {!loadingList && versions.length === 0 ? <Typography sx={{ p: 2, fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂无发布版本</Typography> : null}
            {versions.map(item => {
              const selected = item.versionId === selectedVersionId
              return (
                <Box
                  key={item.versionId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedVersionId(item.versionId)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedVersionId(item.versionId)
                    }
                  }}
                  sx={{ p: 1.5, cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,.06)', bgcolor: selected ? 'rgba(17,24,39,.06)' : '#fff', '&:hover': { bgcolor: 'rgba(17,24,39,.04)' } }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 900, color: '#111827' }}>{item.commitName}</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 12, color: 'rgba(0,0,0,.52)' }}>{formatVersionTime(item.createdAtMs)}</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 12, color: 'rgba(0,0,0,.48)' }} noWrap>{item.title}</Typography>
                </Box>
              )
            })}
          </Box>

          <Box sx={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid rgba(0,0,0,.08)', borderRadius: 3, bgcolor: '#fff', overflow: 'hidden' }}>
            {loadingSnapshot ? <Typography sx={{ p: 2, fontSize: 13, color: 'rgba(0,0,0,.55)' }}>正在加载快照...</Typography> : null}
            {!loadingSnapshot && snapshot ? (
              <>
                <Box sx={{ p: 2, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 20, lineHeight: 1.2, fontWeight: 900 }}>{snapshot.manifest.title || '未命名'}</Typography>
                    <Typography sx={{ mt: 0.75, fontSize: 13, color: 'rgba(0,0,0,.56)' }}>{snapshot.commitName} · {formatVersionTime(snapshot.createdAtMs)}</Typography>
                    {snapshot.manifest.description ? <Typography sx={{ mt: 1, fontSize: 13, color: 'rgba(0,0,0,.66)' }}>{snapshot.manifest.description}</Typography> : null}
                  </Box>
                  <Button variant="outlined" color="warning" onClick={() => void restore()} disabled={restoring} sx={{ borderRadius: 999, flex: '0 0 auto', fontWeight: 800 }}>
                    {restoring ? '恢复中…' : '恢复此版本'}
                  </Button>
                </Box>
                <Divider />
                <Box sx={{ p: 1, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {orderedFaceIds(snapshot).map(id => (
                    <Box
                      key={id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedFaceId(id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedFaceId(id)
                        }
                      }}
                      sx={{ px: 1.5, py: 0.75, borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer', color: selectedFaceId === id ? '#fff' : '#374151', bgcolor: selectedFaceId === id ? '#111827' : 'rgba(17,24,39,.06)' }}
                    >
                      {faceTitle(snapshot, id)}
                    </Box>
                  ))}
                </Box>
                <Divider />
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: selectedFaceIsHtml ? '#f8fafc' : '#0f172a' }}>
                  {selectedFace ? selectedFaceIsHtml ? (
                    <Box sx={{ p: 2 }}>
                      <HtmlFaceIframe html={selectedFace.content} mode="natural" minHeightPx={360} />
                    </Box>
                  ) : (
                    <Box component="pre" sx={{ m: 0, p: 2, color: '#e5e7eb', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.75, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                      {selectedFace.content}
                    </Box>
                  ) : <Typography sx={{ p: 2, fontSize: 13, color: 'rgba(0,0,0,.55)' }}>这个版本没有可预览内容</Typography>}
                </Box>
              </>
            ) : null}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
