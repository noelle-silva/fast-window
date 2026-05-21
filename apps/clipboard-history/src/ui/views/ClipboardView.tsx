import * as React from 'react'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box, Button, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { CLIPBOARD_PAGE_SIZE } from '../../shared/constants'
import type { ClipboardHistoryItem } from '../../shared/types'
import { EmptyState } from '../components/EmptyState'
import { LazyImagePreview } from '../components/LazyImagePreview'
import { formatTime, historyKey, shouldShowFoldButton } from '../clipboardUiUtils'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

const LIST_PRELOAD_ROOT_MARGIN = '1400px 0px'
const CLIPBOARD_ITEM_ID_PREFIX = 'clipboard-item-'

type ClipboardViewProps = {
  controller: ClipboardHistoryController
}

function clipboardItemId(key: string): string {
  return `${CLIPBOARD_ITEM_ID_PREFIX}${key}`
}

function isKeyboardInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]')
}

function nextClipboardLimitForIndex(index: number, limit: number, total: number, maxHistory: number): number {
  if (index < limit) return limit
  return Math.min(maxHistory, Math.max(index + 1, limit + CLIPBOARD_PAGE_SIZE), total)
}

function useClipboardKeyboardSelection(params: {
  items: ClipboardHistoryItem[]
  limit: number
  total: number
  maxHistory: number
  bootStatus: ClipboardHistoryController['bootStatus']
  blocked: boolean
  setClipboardLimit(limit: number): void
  copyHistoryItem(item: ClipboardHistoryItem): Promise<void>
}) {
  const { items, limit, total, maxHistory, bootStatus, blocked, setClipboardLimit, copyHistoryItem } = params
  const [selectedKey, setSelectedKey] = React.useState('')
  const itemKeys = React.useMemo(() => items.map(historyKey), [items])
  const selectedIndex = selectedKey ? itemKeys.indexOf(selectedKey) : -1

  const ensureLimitForIndex = React.useCallback((index: number) => {
    const next = nextClipboardLimitForIndex(index, limit, total, maxHistory)
    if (next > limit) setClipboardLimit(next)
  }, [limit, maxHistory, setClipboardLimit, total])

  React.useEffect(() => {
    if (!itemKeys.length) {
      if (selectedKey) setSelectedKey('')
      return
    }
    const currentIndex = selectedKey ? itemKeys.indexOf(selectedKey) : -1
    if (currentIndex >= 0) {
      ensureLimitForIndex(currentIndex)
      return
    }
    setSelectedKey(itemKeys[0])
  }, [ensureLimitForIndex, itemKeys, selectedKey])

  React.useEffect(() => {
    if (!selectedKey) return
    document.getElementById(clipboardItemId(selectedKey))?.scrollIntoView({ block: 'nearest' })
  }, [selectedKey, limit])

  const selectByOffset = React.useCallback((offset: number) => {
    if (!itemKeys.length) return
    const fallbackIndex = offset > 0 ? -1 : itemKeys.length
    const currentIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex
    const nextIndex = Math.min(itemKeys.length - 1, Math.max(0, currentIndex + offset))
    ensureLimitForIndex(nextIndex)
    setSelectedKey(itemKeys[nextIndex])
  }, [ensureLimitForIndex, itemKeys, selectedIndex])

  const copySelected = React.useCallback(() => {
    if (!items.length) return
    const item = items[selectedIndex >= 0 ? selectedIndex : 0]
    if (!item) return
    setSelectedKey(historyKey(item))
    void copyHistoryItem(item)
  }, [copyHistoryItem, items, selectedIndex])

  React.useEffect(() => {
    if (bootStatus !== 'ready' || blocked) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (isKeyboardInputTarget(event.target)) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectByOffset(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectByOffset(-1)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.repeat) return
        event.preventDefault()
        copySelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blocked, bootStatus, copySelected, selectByOffset])

  return { selectedKey, selectKey: setSelectedKey }
}

export function ClipboardView(props: ClipboardViewProps) {
  const { controller } = props
  const { state, bootStatus, bootError } = controller

  const filtered = React.useMemo(() => {
    const q = state.clipboardSearchQuery.trim().toLowerCase()
    if (!q) return state.history
    return state.history.filter((it) => it.type !== 'image' && String(it.content).toLowerCase().includes(q))
  }, [state.clipboardSearchQuery, state.history])

  const total = filtered.length
  const limit = Math.min(total, Math.max(1, Number(state.clipboardLimit) || CLIPBOARD_PAGE_SIZE))
  const visible = filtered.slice(0, limit)
  const emptyMessage = bootStatus !== 'ready'
    ? bootStatus === 'error'
      ? bootError || '剪贴板历史启动失败'
      : '剪贴板历史正在启动...'
    : state.clipboardSearchQuery.trim()
      ? '没有匹配的内容'
      : '剪贴板历史为空'
  const keyboardSelectionBlocked = state.showSettings || state.showRecentMenu || state.ctxMenu.open || state.movePicker.open || state.editDialog.open
  const { selectedKey, selectKey } = useClipboardKeyboardSelection({
    items: filtered,
    limit,
    total,
    maxHistory: state.settings.maxHistory,
    bootStatus,
    blocked: keyboardSelectionBlocked,
    setClipboardLimit: controller.setClipboardLimit,
    copyHistoryItem: controller.copyHistoryItem,
  })

  React.useEffect(() => {
    if (bootStatus !== 'ready') return
    if (limit >= total) return
    const root = document.querySelector('[data-area="content"]')
    const sentinel = document.querySelector('[data-role="clipboardSentinel"]')
    if (!(sentinel instanceof HTMLElement)) return
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        const next = Math.min(state.settings.maxHistory, limit + CLIPBOARD_PAGE_SIZE, total)
        if (next <= limit) return
        controller.setClipboardLimit(next)
      },
      { root: root instanceof HTMLElement ? root : null, rootMargin: LIST_PRELOAD_ROOT_MARGIN, threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [bootStatus, controller, limit, state.settings.maxHistory, total])

  const loadMore = React.useCallback(() => {
    const next = Math.min(state.settings.maxHistory, limit + CLIPBOARD_PAGE_SIZE, total)
    if (next <= limit) return
    controller.setClipboardLimit(next)
  }, [controller, limit, state.settings.maxHistory, total])

  return (
    <Box>
      {bootStatus !== 'ready' || !total ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <Paper
          role="list"
          aria-label="剪贴板历史，按上下键选择，按回车或空格复制当前项"
          tabIndex={0}
          sx={{
            borderRadius: 1.5,
            overflow: 'hidden',
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)',
            outline: 0,
            '&:focus-visible': {
              boxShadow: theme => `0 10px 28px rgba(15, 23, 42, 0.06), 0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`,
            },
          }}
        >
          <Stack component="div" role="presentation" spacing={0.25}>
            {visible.map(item => {
              const itemKey = historyKey(item)
              return (
                <ClipboardCard
                  key={itemKey}
                  itemKey={itemKey}
                  item={item}
                  controller={controller}
                  selected={selectedKey === itemKey}
                  onSelect={() => selectKey(itemKey)}
                />
              )
            })}
            {limit < total ? (
              <Box data-role="clipboardSentinel" sx={{ p: 1.25, display: 'flex', justifyContent: 'center' }}>
                <Button onClick={loadMore}>继续加载更多（{limit}/{total}）</Button>
              </Box>
            ) : null}
          </Stack>
        </Paper>
      )}
    </Box>
  )
}

function ClipboardCard(props: { itemKey: string; item: ClipboardHistoryItem; controller: ClipboardHistoryController; selected: boolean; onSelect(): void }) {
  const { itemKey, item, controller, selected, onSelect } = props
  const isImage = item.type === 'image'
  const expanded = !!controller.state.clipboardExpanded[itemKey]
  const armed = controller.isDeleteArmed(itemKey)

  const copyItem = React.useCallback(() => {
    onSelect()
    void controller.copyHistoryItem(item)
  }, [controller, item, onSelect])

  return (
    <Box
      id={clipboardItemId(itemKey)}
      role="listitem"
      aria-current={selected ? 'true' : undefined}
      tabIndex={-1}
      onClick={copyItem}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      sx={{
        p: 1.25,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background-color 120ms ease, box-shadow 120ms ease',
        ...(isImage ? null : { contentVisibility: 'auto', containIntrinsicSize: '80px' }),
        bgcolor: selected ? theme => alpha(theme.palette.primary.main, 0.04) : 'transparent',
        boxShadow: selected ? theme => `inset 2px 0 0 ${alpha(theme.palette.primary.main, 0.2)}` : 'none',
        '&:hover': {
          bgcolor: selected ? theme => alpha(theme.palette.primary.main, 0.06) : 'action.hover',
        },
      }}
    >
      {isImage ? (
        <ImageClipboardContent item={item} controller={controller} armed={armed} />
      ) : (
        <TextClipboardContent item={item} itemKey={itemKey} controller={controller} expanded={expanded} armed={armed} />
      )}
    </Box>
  )
}

function ClipboardTools(props: { item: ClipboardHistoryItem; controller: ClipboardHistoryController; armed: boolean }) {
  const { item, controller, armed } = props
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" onClick={(event) => event.stopPropagation()}>
      <Typography variant="caption" color="text.secondary">{item.type === 'image' ? '图片' : '文本'}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{item.time ? formatTime(item.time) : ''}</Typography>
      <IconButton size="small" title={armed ? '再点一次确认删除' : '删除'} onClick={() => void controller.deleteHistoryItem(item)}>
        {armed ? <WarningAmberRoundedIcon color="warning" fontSize="small" /> : <DeleteOutlineRoundedIcon fontSize="small" />}
      </IconButton>
    </Stack>
  )
}

function TextClipboardContent(props: { item: ClipboardHistoryItem; itemKey: string; controller: ClipboardHistoryController; expanded: boolean; armed: boolean }) {
  const { item, itemKey, controller, expanded, armed } = props
  const showFold = expanded || shouldShowFoldButton(item.content, controller.state.settings)

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.25, rowGap: 0.75, alignItems: 'start' }}>
      <Typography
        component="div"
        variant="body2"
        sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.55,
          minWidth: 0,
          ...(expanded
            ? null
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: controller.state.settings.collapseLines,
                overflow: 'hidden',
              }),
        }}
      >
        {item.content || ''}
      </Typography>
      <ClipboardTools item={item} controller={controller} armed={armed} />
      {showFold ? (
        <Button
          size="small"
          variant="text"
          startIcon={expanded ? <KeyboardArrowUpRoundedIcon fontSize="small" /> : <KeyboardArrowDownRoundedIcon fontSize="small" />}
          onClick={(event) => {
            event.stopPropagation()
            controller.toggleClipboardExpanded(itemKey)
          }}
          sx={{ gridColumn: '1 / -1', justifySelf: 'flex-start' }}
        >
          {expanded ? '收起' : '展开'}
        </Button>
      ) : null}
    </Box>
  )
}

function ImageClipboardContent(props: { item: ClipboardHistoryItem; controller: ClipboardHistoryController; armed: boolean }) {
  const { item, controller, armed } = props
  const directSrc = React.useMemo(() => controller.clipboardImageUrl(item), [controller, item])

  return (
    <Stack alignItems="center" spacing={1} sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
        <ClipboardTools item={item} controller={controller} armed={armed} />
      </Box>
      <LazyImagePreview src={directSrc} alt="剪贴板图片" minHeight={120} maxHeight={220} />
      <Chip size="small" icon={<ImageRoundedIcon fontSize="small" />} label="图片" />
    </Stack>
  )
}
