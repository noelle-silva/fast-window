import { Box, Typography } from '@mui/material'

function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString()
  }
}

export function NoteInfoSidebar(props: {
  noteId: string
  createdAtMs: number
  updatedAtMs: number
}) {
  const noteId = String(props.noteId || '').trim()
  return (
    <Box
      aria-label="笔记信息侧边栏"
      sx={{
        flex: '0 0 280px',
        width: 280,
        minWidth: 280,
      }}
    >
      <Box
        sx={{
          position: 'sticky',
          top: 12,
          p: 2,
          borderRadius: 2,
          bgcolor: 'rgba(0,0,0,.03)',
          border: '1px solid rgba(0,0,0,.08)',
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)', mb: 1 }}>
          笔记信息
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)' }}>创建时间</Typography>
            <Typography sx={{ fontSize: 13, color: '#111', fontWeight: 700 }}>{formatDateTime(props.createdAtMs)}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)' }}>最后修改</Typography>
            <Typography sx={{ fontSize: 13, color: '#111', fontWeight: 700 }}>{formatDateTime(props.updatedAtMs)}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)' }}>笔记 ID</Typography>
            <Typography
              component="code"
              sx={{
                display: 'block',
                fontSize: 12,
                color: '#111',
                fontWeight: 700,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
              }}
            >
              {noteId || '—'}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

