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
import { clipboardItemDomId, useClipboardKeyboardSelection } from '../hooks/useClipboardKeyboardSelection'

const LIST_PRELOAD_ROOT_MARGIN = '1400px 0px'

type ClipboardViewProps = {
  controller: ClipboardHistoryController
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
          aria-label="剪贴板历史，按上下键或 Ctrl 加上下键选择，按回车或空格复制当前项"
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
      id={clipboardItemDomId(itemKey)}
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
