import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import { Box, Button, Paper, Stack, Typography, alpha } from '@mui/material'
import {
  DefaultIconVisual,
  DesktopGridCanvas,
  DesktopGridItem,
  type DesktopGridLayoutPatch,
} from '../shared/desktop-grid'
import type { BookmarkGridEntry, BookmarkItem, Phase } from './types'
import { bookmarkDetail, bookmarkTitle } from './utils'

type Props = {
  allEntries: BookmarkGridEntry[]
  entries: BookmarkGridEntry[]
  phase: Phase
  search: string
  onAdd(): void
  onContextMenu(item: BookmarkItem, x: number, y: number): void
  onLayoutCommit(patches: DesktopGridLayoutPatch[]): void
  onOpen(item: BookmarkItem): void
}

export function BookmarkGridCanvas(props: Props): React.ReactNode {
  return (
    <DesktopGridCanvas
      ariaLabel="网站收藏图标布局"
      allEntries={props.allEntries}
      entries={props.entries}
      onLayoutCommit={props.onLayoutCommit}
      renderEmpty={() => <EmptyState phase={props.phase} search={props.search} onAdd={props.onAdd} />}
      renderItem={(entry, state) => (
        <DesktopGridItem
          detail={bookmarkDetail(entry.item)}
          dragging={state.dragging}
          icon={<BookmarkIcon item={entry.item} dragging={state.dragging} />}
          menuLabel={`打开 ${bookmarkTitle(entry.item)} 的更多操作`}
          name={bookmarkTitle(entry.item)}
          title={entry.item.url}
          onContextMenu={(x, y) => props.onContextMenu(entry.item, x, y)}
          onOpen={() => {
            if (!state.consumeClick()) props.onOpen(entry.item)
          }}
        />
      )}
    />
  )
}

function BookmarkIcon(props: { item: BookmarkItem; dragging?: boolean }) {
  if (props.item.iconUrl) {
    return (
      <DefaultIconVisual
        className="desktop-grid-icon-surface"
        dragging={props.dragging}
        icon={{ kind: 'image', src: props.item.iconUrl }}
        seed={props.item.id}
      />
    )
  }

  return (
    <DefaultIconVisual
      className="desktop-grid-icon-surface"
      dragging={props.dragging}
      seed={props.item.id || props.item.url}
    />
  )
}

function EmptyState(props: { phase: Phase; search: string; onAdd(): void }) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.5, sm: 2 }, pt: 1 }}>
      <Paper sx={{ minHeight: '100%', p: { xs: 3, sm: 5 }, borderRadius: 4, display: 'grid', placeItems: 'center', textAlign: 'center', bgcolor: 'background.paper' }}>
        <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 420 }}>
          <Box sx={{ width: 72, height: 72, borderRadius: 4, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.1) }}>
            {props.search ? <PublicRoundedIcon fontSize="large" /> : <LanguageRoundedIcon fontSize="large" />}
          </Box>
          <Typography variant="h2">{props.search ? '未找到匹配的网站收藏' : '暂无网站收藏'}</Typography>
          <Typography color="text.secondary">{props.search ? '换个关键词试试，或者把这个网站添加到收藏。' : '添加常用网站后，可以从这里一键打开、分组管理和快速搜索。'}</Typography>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={props.phase !== 'ready'}>添加收藏</Button>
        </Stack>
      </Paper>
    </Box>
  )
}
