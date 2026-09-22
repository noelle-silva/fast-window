import * as React from 'react'
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import type { PlaceholderItem } from '../../domain/placeholder'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { PlaceholderDetailDialog } from './PlaceholderDetailDialog'

const MAX_RESULTS = 60

function text(value: unknown) {
  return String(value ?? '').trim()
}

function placeholderToken(name: unknown) {
  return `{{${text(name)}}}`
}

export function PlaceholderSearchSection(props: { controller: any; placeholders?: any }) {
  const { controller, placeholders } = props
  const [query, setQuery] = React.useState('')
  const [detailName, setDetailName] = React.useState('')

  React.useEffect(() => {
    controller.actions.refreshPlaceholderLibrary?.(false)
  }, [controller])

  const items = React.useMemo<PlaceholderItem[]>(() => {
    const list = placeholders?.library?.placeholders
    return Array.isArray(list) ? list : []
  }, [placeholders?.library])

  const keyword = text(query).toLowerCase()
  const matches = React.useMemo(() => {
    if (!keyword) return [] as PlaceholderItem[]
    return items
      .filter((item) => [item.name, item.value, item.description].some((field) => String(field ?? '').toLowerCase().includes(keyword)))
      .slice(0, MAX_RESULTS)
  }, [items, keyword])

  const copyToken = (name: unknown) => {
    const capabilities = controller?.capabilities
    const writeText = capabilities?.clipboard?.writeText
    if (typeof writeText !== 'function') return capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(placeholderToken(name)))
      .then(() => capabilities?.ui?.showToast?.('已复制占位符', { kind: 'success' }))
      .catch(() => capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }))
  }

  return (
    <Stack spacing={1.25}>
      <TextField
        size="small"
        label="搜索占位符"
        placeholder="按名称、内容或描述搜索"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        fullWidth
      />

      {!keyword ? (
        <Typography variant="caption" color="text.secondary">输入关键词后显示匹配的占位符，点击条目可查看详情与依赖。</Typography>
      ) : !matches.length ? (
        <Typography variant="body2" color="text.secondary">没有匹配的占位符。</Typography>
      ) : (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <CustomScrollArea hostSx={{ maxHeight: 260 }} scrollSx={{ maxHeight: 260 }}>
            <Stack spacing={0}>
              {matches.map((item, index) => (
                <Box
                  key={`${item.name}:${index}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1,
                    py: 0.5,
                    borderTop: index ? '1px solid' : 0,
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Button
                    onClick={() => setDetailName(text(item.name))}
                    sx={{ justifyContent: 'flex-start', minWidth: 0, flex: 1, px: 0.5, textTransform: 'none', textAlign: 'left' }}
                  >
                    <Box sx={{ minWidth: 0, width: '100%' }}>
                      <Box component="span" sx={{ display: 'block', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {placeholderToken(item.name)}
                      </Box>
                      {text(item.description) ? (
                        <Box component="span" sx={{ display: 'block', fontSize: 12, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {text(item.description)}
                        </Box>
                      ) : null}
                    </Box>
                  </Button>
                  <Tooltip title={`复制 ${placeholderToken(item.name)}`}>
                    <span>
                      <IconButton size="small" aria-label={`复制 ${placeholderToken(item.name)}`} onClick={() => copyToken(item.name)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
            </Stack>
          </CustomScrollArea>
        </Box>
      )}

      <PlaceholderDetailDialog controller={controller} placeholders={placeholders} name={detailName} onClose={() => setDetailName('')} />
    </Stack>
  )
}
