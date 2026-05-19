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
import { unstyledButtonSurfaceSx } from './pluginUiStyles'
import { FEATURE_TONES, type HyperCortexToneId, toneFgVar, toneFocusVisibleSx } from './uiTones'

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

function StatTile(props: { label: string; value: number | string; hint: string; tone: HyperCortexToneId }): React.ReactNode {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1.25,
        borderRadius: 3,
        bgcolor: 'var(--hc-surface)',
        boxShadow: '0 12px 28px var(--hc-shadow)',
        minWidth: 0,
      }}
    >
      <Typography sx={{ fontSize: 24, lineHeight: 1.1, fontWeight: 950, color: toneFgVar(props.tone) }}>{props.value}</Typography>
      <Typography sx={{ mt: 0.35, fontSize: 12, fontWeight: 850, color: 'var(--hc-text)' }}>{props.label}</Typography>
      <Typography sx={{ mt: 0.15, fontSize: 11, color: 'var(--hc-text-muted)' }} noWrap>{props.hint}</Typography>
    </Box>
  )
}

function ActionCard(props: { title: string; body: string; icon: React.ReactNode; tone: HyperCortexToneId; onClick: () => void }): React.ReactNode {
  return (
    <Box
      component="button"
      type="button"
      onClick={props.onClick}
      sx={{
        ...unstyledButtonSurfaceSx,
        width: '100%',
        minHeight: 116,
        p: 1.5,
        textAlign: 'left',
        borderRadius: 3,
        bgcolor: 'var(--hc-surface)',
        cursor: 'pointer',
        boxShadow: '0 10px 26px var(--hc-shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        transition: 'transform .16s ease, box-shadow .16s ease, background-color .16s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 14px 34px var(--hc-shadow-strong)',
          bgcolor: 'var(--hc-surface-soft)',
        },
        '&:focus-visible': toneFocusVisibleSx(props.tone, '0 14px 34px var(--hc-shadow-strong)'),
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: 2.5, bgcolor: 'var(--hc-surface)', color: toneFgVar(props.tone), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 18px var(--hc-shadow)' }}>
        {props.icon}
      </Box>
      <Box>
        <Typography sx={{ fontSize: 14, fontWeight: 950, color: 'var(--hc-text)' }}>{props.title}</Typography>
        <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.55, color: 'var(--hc-text-muted)' }}>{props.body}</Typography>
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
        ...unstyledButtonSurfaceSx,
        width: '100%',
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
        '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
        '&:focus-visible': { bgcolor: 'var(--hc-primary-soft)', boxShadow: '0 10px 24px var(--hc-shadow)' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 850, color: 'var(--hc-text)' }} noWrap>{note.title || '未命名'}</Typography>
        <Typography sx={{ mt: 0.2, fontSize: 11.5, color: 'var(--hc-text-subtle)' }} noWrap>{note.description || formatDate(note.updatedAtMs)}</Typography>
      </Box>
      <OpenInNewRoundedIcon sx={{ fontSize: 16, color: 'var(--hc-text-subtle)' }} />
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
          bgcolor: 'var(--hc-surface-soft)',
          boxShadow: '0 18px 44px var(--hc-shadow-strong)',
        }}
      >
        <HomeNetworkOrbBackground />
        <Box sx={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.35fr) minmax(320px, .65fr)' }, gap: 2.5, alignItems: 'end' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 950, color: 'var(--hc-text-subtle)' }}>HyperCortex Workspace</Typography>
            <Typography sx={{ mt: 0.75, fontSize: { xs: 30, md: 42 }, lineHeight: 1.05, fontWeight: 950, color: 'var(--hc-text)', maxWidth: 720 }}>
              hypercortex
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={onCreateNote} sx={{ borderRadius: 999, px: 2, fontWeight: 900, textTransform: 'none' }}>
                新建笔记
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
            <StatTile label="笔记" value={stats.noteCount} hint="知识库条目" tone={FEATURE_TONES.notes} />
            <StatTile label="附件" value={stats.assetCount} hint="素材池文件" tone={FEATURE_TONES.assets} />
            <StatTile label="打开" value={stats.openTabCount} hint="当前标签" tone={FEATURE_TONES.search} />
            <StatTile label="工作区" value={stats.workspaceCount} hint="上下文切换" tone={FEATURE_TONES.index} />
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, .9fr) minmax(360px, .55fr)' }, gap: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
          <ActionCard title="打开索引" body="进入可视化收藏夹，把笔记、附件和文件夹组织成你的知识地图。" icon={<AccountTreeRoundedIcon fontSize="small" />} tone={FEATURE_TONES.index} onClick={onOpenIndex} />
          <ActionCard title="全部笔记" body="按更新时间浏览知识库，适合找最近写过但还没放进索引的内容。" icon={<NotesRoundedIcon fontSize="small" />} tone={FEATURE_TONES.notes} onClick={onOpenAllNotes} />
          <ActionCard title="附件池" body="管理图片、视频、PDF、Word 等素材，并复制可嵌入笔记的引用标记。" icon={<AttachFileRoundedIcon fontSize="small" />} tone={FEATURE_TONES.assets} onClick={onOpenAttachments} />
          <ActionCard title="快速搜索" body="用标题直达笔记或附件；当库变大时，这会比翻列表更稳定。" icon={<SearchRoundedIcon fontSize="small" />} tone={FEATURE_TONES.search} onClick={onOpenSearch} />
        </Box>

        <Box sx={{ borderRadius: 4, bgcolor: 'var(--hc-surface)', boxShadow: '0 10px 26px var(--hc-shadow)', overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 950, color: 'var(--hc-text)' }}>最近更新</Typography>
              <Typography sx={{ mt: 0.15, fontSize: 11.5, color: 'var(--hc-text-subtle)' }}>继续刚才的思路，不丢上下文</Typography>
            </Box>
            <Button size="small" onClick={onOpenAllNotes} sx={{ borderRadius: 999, fontSize: 12, fontWeight: 900, textTransform: 'none' }}>全部</Button>
          </Box>

          <Box sx={{ p: 0.75 }}>
            {recentNotes.length ? recentNotes.map(note => <RecentNoteRow key={note.id} note={note} onOpen={onOpenNote} />) : (
              <Box sx={{ px: 1.25, py: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 850, color: 'var(--hc-text)' }}>还没有笔记</Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>先新建一条笔记，主页就会自动显示最近更新。</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export type { HomePageStats }
