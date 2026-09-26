import * as React from 'react'
import { createPortal } from 'react-dom'
import { Box, ClickAwayListener, IconButton, Paper, Popper, Tooltip, Typography } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import type { NoteMeta } from '../core'
import type { VaultScope } from '../core'
import type { AssetEntry } from '../assetTypes'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexShortcutBindingsV1, HyperCortexShortcutId } from '../shortcuts'
import { formatChordForDisplay } from '../shortcuts'
import type { AllNotesLayout } from '../appSettingsModel'
import type { HyperCortexToolbarSlots } from './shellContext'
import type { PageId } from './workspacePages'
import { QuickSearchPopover } from './QuickSearchPopover'

const SHORTCUT_HINT_ITEMS: { id: HyperCortexShortcutId; title: string }[] = [
  { id: 'goBackPage', title: '返回上一个页面' },
  { id: 'goHomePage', title: '切换到主页' },
  { id: 'goFavoritesPage', title: '切换到收藏夹页面' },
  { id: 'goAttachmentsPage', title: '切换到附件页面' },
  { id: 'goAllNotesPage', title: '切换到全部笔记页面' },
  { id: 'goSettingsPage', title: '切换到设置页面' },
  { id: 'closeActiveTab', title: '关闭当前标签页' },
  { id: 'selectPrevTab', title: '切换到上一个标签页（向上）' },
  { id: 'selectNextTab', title: '切换到下一个标签页（向下）' },
  { id: 'newNote', title: '新建笔记' },
  { id: 'saveNote', title: '保存笔记' },
  { id: 'toggleQuickSearch', title: '快速搜索（显示/隐藏）' },
  { id: 'toggleMode', title: '切换阅读/编辑' },
  { id: 'cycleFace', title: '切换笔记面（文本/HTML）' },
  { id: 'toggleSidebar', title: '侧边栏展开/收起' },
]

function getShortcutChord(bindings: HyperCortexShortcutBindingsV1, id: HyperCortexShortcutId): string {
  return String(bindings?.[id] || '')
}

function NavIconButton(props: {
  title: string
  ariaLabel: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  label?: string
}) {
  const { title, ariaLabel, active, disabled, onClick, children, label } = props
  return (
    <Tooltip title={title} placement="bottom">
      <IconButton
        size="small"
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        sx={{
          gap: 0.5,
          px: label ? 1.5 : undefined,
          borderRadius: 2,
          color: active ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
          bgcolor: active ? 'var(--hc-primary-soft)' : 'transparent',
          '&:hover': { bgcolor: active ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
          '&.Mui-disabled': { color: 'var(--hc-text-subtle)', bgcolor: 'transparent' },
        }}
      >
        {children}
        {label ? (
          <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            {label}
          </Typography>
        ) : null}
      </IconButton>
    </Tooltip>
  )
}

export type RepoWorkspaceToolbarNavigation = {
  backCount: number
  forwardCount: number
  modalOpen: boolean
  page: PageId
  onBack: () => void
  onForward: () => void
  onGoTo: (page: PageId) => void
}

export type RepoWorkspaceToolbarQuickSearch = {
  gateway: HyperCortexGateway
  scope: VaultScope
  open: boolean
  allNotesLayout: AllNotesLayout
  onToggle: () => void
  onToggleAllNotesLayout: () => void
  onClose: () => void
  onOpenNote: (note: NoteMeta, faceId?: string) => void
  onOpenAsset: (asset: AssetEntry) => void
}

export type RepoWorkspaceToolbarShortcutHints = {
  enabled: boolean
  open: boolean
  bindings: HyperCortexShortcutBindingsV1
  onToggle: () => void
  onClose: () => void
}

export type RepoWorkspaceToolbarProps = {
  slots: HyperCortexToolbarSlots
  navigation: RepoWorkspaceToolbarNavigation
  quickSearch: RepoWorkspaceToolbarQuickSearch
  shortcutHints: RepoWorkspaceToolbarShortcutHints
}

// 现场工具栏：物理渲染位置在外壳顶部栏槽位，状态与行为属于当前活动现场。
export function RepoWorkspaceToolbar(props: RepoWorkspaceToolbarProps) {
  const { slots, navigation, quickSearch, shortcutHints } = props
  const quickSearchAnchorRef = React.useRef<HTMLButtonElement | null>(null)
  const shortcutHintsAnchorRef = React.useRef<HTMLButtonElement | null>(null)

  const goBackDisabled = navigation.backCount <= 0 || navigation.modalOpen
  const goForwardDisabled = navigation.forwardCount <= 0 || navigation.modalOpen

  const leftNode = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <NavIconButton title="后退" ariaLabel="后退" disabled={goBackDisabled} onClick={navigation.onBack}>
        <ArrowBackRoundedIcon fontSize="small" />
      </NavIconButton>
      <NavIconButton title="前进" ariaLabel="前进" disabled={goForwardDisabled} onClick={navigation.onForward}>
        <ArrowForwardRoundedIcon fontSize="small" />
      </NavIconButton>
      <NavIconButton
        title="收藏夹"
        ariaLabel="收藏夹"
        label="收藏夹"
        active={navigation.page === 'index'}
        onClick={() => navigation.onGoTo('index')}
      >
        <StarRoundedIcon fontSize="small" />
      </NavIconButton>
    </Box>
  )

  const rightNode = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      <NavIconButton title="主页" ariaLabel="主页" active={navigation.page === 'home'} onClick={() => navigation.onGoTo('home')}>
        <HomeRoundedIcon fontSize="small" />
      </NavIconButton>
      <NavIconButton title="附件" ariaLabel="附件" active={navigation.page === 'attachments'} onClick={() => navigation.onGoTo('attachments')}>
        <AttachFileRoundedIcon fontSize="small" />
      </NavIconButton>
      <NavIconButton title="全部笔记" ariaLabel="全部笔记" active={navigation.page === 'all-notes'} onClick={() => navigation.onGoTo('all-notes')}>
        <NotesRoundedIcon fontSize="small" />
      </NavIconButton>

      <Tooltip title="搜索" placement="bottom">
        <IconButton
          ref={quickSearchAnchorRef}
          onClick={quickSearch.onToggle}
          size="small"
          aria-label="搜索"
          sx={{
            borderRadius: 2,
            color: quickSearch.open ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
            bgcolor: quickSearch.open ? 'var(--hc-primary-soft)' : 'transparent',
            '&:hover': { bgcolor: quickSearch.open ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
          }}
        >
          <SearchRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {shortcutHints.enabled ? (
        <Tooltip title={shortcutHints.open ? '关闭快捷键提示' : '快捷键提示'} placement="bottom">
          <IconButton
            ref={shortcutHintsAnchorRef}
            size="small"
            aria-label="快捷键提示"
            onClick={shortcutHints.onToggle}
            sx={{
              borderRadius: 2,
              color: shortcutHints.open ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
              bgcolor: shortcutHints.open ? 'var(--hc-primary-soft)' : 'transparent',
              '&:hover': { bgcolor: shortcutHints.open ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
            }}
          >
            <HelpOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}

      <NavIconButton title="设置" ariaLabel="设置" active={navigation.page === 'settings'} onClick={() => navigation.onGoTo('settings')}>
        <SettingsRoundedIcon fontSize="small" />
      </NavIconButton>

      <QuickSearchPopover
        gateway={quickSearch.gateway}
        scope={quickSearch.scope}
        open={quickSearch.open}
        triggerEl={quickSearchAnchorRef.current}
        allNotesLayout={quickSearch.allNotesLayout}
        onToggleAllNotesLayout={quickSearch.onToggleAllNotesLayout}
        onClose={quickSearch.onClose}
        onOpenNote={quickSearch.onOpenNote}
        onOpenAsset={quickSearch.onOpenAsset}
      />

      <Popper open={shortcutHints.open} anchorEl={shortcutHintsAnchorRef.current} placement="bottom-end" disablePortal={false} sx={{ zIndex: 2000 }}>
        <Box sx={{ pt: 0.75 }}>
          <ClickAwayListener
            onClickAway={(e: any) => {
              const anchor = shortcutHintsAnchorRef.current
              if (anchor && e?.target && (anchor === e.target || anchor.contains(e.target))) return
              shortcutHints.onClose()
            }}
          >
            <Paper
              elevation={10}
              sx={{
                width: 360,
                maxWidth: 'min(440px, calc(100vw - 24px))',
                borderRadius: 3,
                overflow: 'hidden',
                boxShadow: '0 18px 48px rgba(0,0,0,.20)',
              }}
            >
              <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 900, color: '#111' }}>已设置的快捷键</Typography>
                <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)' }}>
                  只展示你已设置的快捷键
                </Typography>
              </Box>

              <Box sx={{ px: 0.75, pb: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {(() => {
                  const rows = SHORTCUT_HINT_ITEMS.map(item => ({
                    id: item.id,
                    title: item.title,
                    chord: getShortcutChord(shortcutHints.bindings, item.id),
                  })).filter(item => !!String(item.chord || '').trim())

                  if (!rows.length) {
                    return (
                      <Box sx={{ px: 1, py: 1.25 }}>
                        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>还没有已设置的快捷键</Typography>
                        <Typography sx={{ mt: 0.25, fontSize: 11, color: 'rgba(0,0,0,.42)' }}>
                          去设置页录制后，这里会自动显示
                        </Typography>
                      </Box>
                    )
                  }

                  return rows.map(item => (
                    <Box
                      key={item.id}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        gap: 1,
                        px: 1,
                        py: 0.75,
                        borderRadius: 2,
                        bgcolor: 'rgba(0,0,0,.02)',
                      }}
                    >
                      <Typography sx={{ fontSize: 12.5, fontWeight: 900, color: '#111' }} noWrap>
                        {item.title}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 12,
                          color: 'rgba(0,0,0,.72)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          whiteSpace: 'nowrap',
                        }}
                        title={formatChordForDisplay(item.chord)}
                      >
                        {formatChordForDisplay(item.chord)}
                      </Typography>
                    </Box>
                  ))
                })()}
              </Box>
            </Paper>
          </ClickAwayListener>
        </Box>
      </Popper>
    </Box>
  )

  return (
    <>
      {slots.left ? createPortal(leftNode, slots.left) : null}
      {slots.right ? createPortal(rightNode, slots.right) : null}
    </>
  )
}
