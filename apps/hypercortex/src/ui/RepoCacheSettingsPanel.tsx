import * as React from 'react'
import { Box, TextField, Typography } from '@mui/material'
import { MAX_REPO_CACHE_LIMIT, MIN_REPO_CACHE_LIMIT, normalizeRepoCacheLimit } from '../repoCacheLimit'

export function RepoCacheSettingsPanel(props: { limit: number; onLimitChange: (limit: number) => void }) {
  const { limit, onLimitChange } = props
  const [text, setText] = React.useState(String(limit))

  React.useEffect(() => {
    setText(String(limit))
  }, [limit])

  const commit = React.useCallback(() => {
    const next = normalizeRepoCacheLimit(text)
    setText(String(next))
    if (next !== limit) onLimitChange(next)
  }, [limit, onLimitChange, text])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>仓库缓存</Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
        打开过的仓库会各自保留一份常驻现场，切换仓库时标签页、未保存的编辑与浏览位置自然延续；超过上限时回收最久未使用的现场，当前使用的仓库永不回收。
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.75, borderRadius: 2, bgcolor: 'var(--hc-surface-soft)' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>
          常驻上限（{MIN_REPO_CACHE_LIMIT}~{MAX_REPO_CACHE_LIMIT}）
        </Typography>
        <TextField
          size="small"
          type="number"
          value={text}
          onChange={event => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commit()
          }}
          inputProps={{ min: MIN_REPO_CACHE_LIMIT, max: MAX_REPO_CACHE_LIMIT, step: 1, style: { width: 64, textAlign: 'right' } }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
        />
      </Box>
    </Box>
  )
}
