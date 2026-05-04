import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import type { NoteMeta } from '../core'
import { HomeNetworkOrbBackground } from './HomeNetworkOrbBackground'

type HomePageStats = {
  noteCount: number
  assetCount: number
  openTabCount: number
  workspaceCount: number
}

type HomePageProps = {
  stats: HomePageStats
  recentNotes: NoteMeta[]
  activeWorkspaceTitle?: string
  onCreateNote: () => void
  onOpenIndex: () => void
  onOpenAttachments: () => void
  onOpenAllNotes: () => void
  onOpenSearch: () => void
  onOpenNote: (note: NoteMeta) => void
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '未知时间'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function StatTile(props: { label: string; value: number | string; hint: string }): React.ReactNode {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1.25,
        borderRadius: 3,
        bgcolor: 'rgba(255,255,255,.14)',
        border: '1px solid rgba(212,237,255,.22)',
        boxShadow: '0 14px 34px rgba(0,0,0,.18)',
        backdropFilter: 'blur(14px)',
        minWidth: 0,
      }}
    >
      <Typography sx={{ fontSize: 24, lineHeight: 1.1, fontWeight: 950, color: '#f7fbff' }}>{props.value}</Typography>
      <Typography sx={{ mt: 0.35, fontSize: 12, fontWeight: 850, color: 'rgba(230,244,255,.80)' }}>{props.label}</Typography>
      <Typography sx={{ mt: 0.15, fontSize: 11, color: 'rgba(230,244,255,.52)' }} noWrap>{props.hint}</Typography>
    </Box>
  )
}

function ActionCard(props: { title: string; body: string; icon: React.ReactNode; onClick: () => void }): React.ReactNode {
  return (
    <Box
      component="button"
      type="button"
      onClick={props.onClick}
      sx={{
        width: '100%',
        minHeight: 116,
        p: 1.5,
        textAlign: 'left',
        border: '1px solid rgba(0,0,0,.06)',
        borderRadius: 3,
        bgcolor: '#fff',
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 14px 34px rgba(37,51,91,.12)',
          borderColor: 'rgba(25,118,210,.18)',
        },
        '&:focus-visible': { outline: '2px solid rgba(25,118,210,.36)', outlineOffset: 2 },
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: 2.5, bgcolor: 'rgba(25,118,210,.09)', color: '#1976d2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {props.icon}
      </Box>
      <Box>
        <Typography sx={{ fontSize: 14, fontWeight: 950, color: '#111' }}>{props.title}</Typography>
        <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.55, color: 'rgba(0,0,0,.56)' }}>{props.body}</Typography>
      </Box>
    </Box>
  )
}

function RecentNoteRow(props: { note: NoteMeta; onOpen: (note: NoteMeta) => void }): React.ReactNode {
  const { note, onOpen } = props
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onOpen(note)}
      sx={{
        width: '100%',
        border: 0,
        bgcolor: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 1.25,
        px: 1.25,
        py: 1,
        borderRadius: 2.5,
        '&:hover': { bgcolor: 'rgba(0,0,0,.035)' },
        '&:focus-visible': { outline: '2px solid rgba(25,118,210,.32)', outlineOffset: 2 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 850, color: '#111' }} noWrap>{note.title || '未命名'}</Typography>
        <Typography sx={{ mt: 0.2, fontSize: 11.5, color: 'rgba(0,0,0,.46)' }} noWrap>{note.description || formatDate(note.updatedAtMs)}</Typography>
      </Box>
      <OpenInNewRoundedIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,.36)' }} />
    </Box>
  )
}

export function HomePage(props: HomePageProps): React.ReactNode {
  const { stats, recentNotes, onCreateNote, onOpenIndex, onOpenAttachments, onOpenAllNotes, onOpenSearch, onOpenNote } = props

  return (
    <Box sx={{ width: '100%', maxWidth: 1180, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2.25 }}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 5,
          px: { xs: 2, md: 3 },
          py: { xs: 2.25, md: 3 },
          bgcolor: '#07111f',
          border: '1px solid rgba(122,186,255,.22)',
          boxShadow: '0 24px 70px rgba(4,10,24,.28)',
        }}
      >
        <HomeNetworkOrbBackground />
        <Box sx={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.35fr) minmax(320px, .65fr)' }, gap: 2.5, alignItems: 'end' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 950, color: 'rgba(213,236,255,.62)' }}>HyperCortex Workspace</Typography>
            <Typography sx={{ mt: 0.75, fontSize: { xs: 30, md: 42 }, lineHeight: 1.05, fontWeight: 950, color: '#f7fbff', maxWidth: 720, textShadow: '0 10px 34px rgba(47,150,255,.35)' }}>
              hypercortex
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={onCreateNote} sx={{ borderRadius: 999, px: 2, fontWeight: 900, textTransform: 'none' }}>
                新建笔记
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
            <StatTile label="笔记" value={stats.noteCount} hint="知识库条目" />
            <StatTile label="附件" value={stats.assetCount} hint="素材池文件" />
            <StatTile label="打开" value={stats.openTabCount} hint="当前标签" />
            <StatTile label="工作区" value={stats.workspaceCount} hint="上下文切换" />
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, .9fr) minmax(360px, .55fr)' }, gap: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
          <ActionCard title="打开索引" body="进入可视化收藏夹，把笔记、附件和文件夹组织成你的知识地图。" icon={<AccountTreeRoundedIcon fontSize="small" />} onClick={onOpenIndex} />
          <ActionCard title="全部笔记" body="按更新时间浏览知识库，适合找最近写过但还没放进索引的内容。" icon={<NotesRoundedIcon fontSize="small" />} onClick={onOpenAllNotes} />
          <ActionCard title="附件池" body="管理图片、视频、PDF、Word 等素材，并复制可嵌入笔记的引用标记。" icon={<AttachFileRoundedIcon fontSize="small" />} onClick={onOpenAttachments} />
          <ActionCard title="快速搜索" body="用标题直达笔记或附件；当库变大时，这会比翻列表更稳定。" icon={<SearchRoundedIcon fontSize="small" />} onClick={onOpenSearch} />
        </Box>

        <Box sx={{ borderRadius: 4, bgcolor: '#fff', border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 1px 2px rgba(0,0,0,.04)', overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, borderBottom: '1px solid rgba(0,0,0,.06)' }}>
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 950, color: '#111' }}>最近更新</Typography>
              <Typography sx={{ mt: 0.15, fontSize: 11.5, color: 'rgba(0,0,0,.46)' }}>继续刚才的思路，不丢上下文</Typography>
            </Box>
            <Button size="small" onClick={onOpenAllNotes} sx={{ borderRadius: 999, fontSize: 12, fontWeight: 900, textTransform: 'none' }}>全部</Button>
          </Box>

          <Box sx={{ p: 0.75 }}>
            {recentNotes.length ? recentNotes.map(note => <RecentNoteRow key={note.id} note={note} onOpen={onOpenNote} />) : (
              <Box sx={{ px: 1.25, py: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 850, color: '#111' }}>还没有笔记</Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.52)' }}>先新建一条笔记，主页就会自动显示最近更新。</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export type { HomePageStats }
