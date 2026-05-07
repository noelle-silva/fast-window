import * as React from 'react'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box, Button, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import { CLIPBOARD_PAGE_SIZE } from '../../shared/constants'
import type { ClipboardHistoryItem } from '../../shared/types'
import { EmptyState } from '../components/EmptyState'
import { formatTime, historyKey, shouldShowFoldButton } from '../clipboardUiUtils'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

const LIST_PRELOAD_ROOT_MARGIN = '1400px 0px'
const IMAGE_PRELOAD_ROOT_MARGIN = '1800px 0px'

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
        <Paper sx={{ borderRadius: 1.5, overflow: 'hidden', boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)' }}>
          <Stack spacing={0.25}>
            {visible.map(item => (
              <ClipboardCard key={historyKey(item)} item={item} controller={controller} />
            ))}
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

function ClipboardCard(props: { item: ClipboardHistoryItem; controller: ClipboardHistoryController }) {
  const { item, controller } = props
  const key = historyKey(item)
  const isImage = item.type === 'image'
  const expanded = !!controller.state.clipboardExpanded[key]
  const armed = controller.isDeleteArmed(key)

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => void controller.copyHistoryItem(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void controller.copyHistoryItem(item)
        }
      }}
      sx={{
        p: 1.25,
        cursor: 'pointer',
        ...(isImage ? null : { contentVisibility: 'auto', containIntrinsicSize: '80px' }),
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {isImage ? (
        <ImageClipboardContent item={item} controller={controller} armed={armed} />
      ) : (
        <TextClipboardContent item={item} controller={controller} expanded={expanded} armed={armed} />
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

function TextClipboardContent(props: { item: ClipboardHistoryItem; controller: ClipboardHistoryController; expanded: boolean; armed: boolean }) {
  const { item, controller, expanded, armed } = props
  const key = historyKey(item)
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
            controller.toggleClipboardExpanded(key)
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
  const key = historyKey(item)
  const directSrc = React.useMemo(() => controller.clipboardImageUrl(item), [controller, item])
  const [src, setSrc] = React.useState('')
  const [error, setError] = React.useState('')
  const imgRef = React.useRef<HTMLImageElement | null>(null)

  React.useEffect(() => {
    setSrc('')
    setError('')
  }, [key, directSrc])

  React.useEffect(() => {
    if (!directSrc) {
      setError('图片不可用')
      return
    }
    const img = imgRef.current
    if (!img) return
    const root = document.querySelector('[data-area="content"]')
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        setSrc(directSrc)
      },
      { root: root instanceof HTMLElement ? root : null, rootMargin: IMAGE_PRELOAD_ROOT_MARGIN, threshold: 0 },
    )
    observer.observe(img)
    return () => observer.disconnect()
  }, [directSrc])

  return (
    <Stack alignItems="center" spacing={1} sx={{ position: 'relative', minHeight: src ? 0 : 120 }}>
      <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
        <ClipboardTools item={item} controller={controller} armed={armed} />
      </Box>
      {!src ? (
        <Box
          ref={imgRef}
          sx={{
            width: '100%',
            minHeight: 120,
            borderRadius: 1.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            bgcolor: 'action.hover',
          }}
        >
          {error || '加载中...'}
        </Box>
      ) : (
        <Box
          component="img"
          ref={imgRef}
          src={src}
          alt="剪贴板图片"
          decoding="async"
          loading="eager"
          onError={() => {
            setSrc('')
            setError('图片加载失败')
          }}
          sx={{ display: 'block', maxWidth: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 1.25 }}
        />
      )}
      <Chip size="small" icon={<ImageRoundedIcon fontSize="small" />} label="图片" />
    </Stack>
  )
}
