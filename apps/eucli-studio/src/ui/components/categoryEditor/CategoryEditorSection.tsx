import * as React from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'

/**
 * 分类编辑器里的区块卡片：标题 + 可选说明 + 内容。
 * fill 时卡片吃掉整块可用高度，把剩下的高度交给内部内容自己分配（例如撑满的文本域）。
 */
export function CategoryEditorSection(props: {
  title: string
  description?: string
  fill?: boolean
  children: React.ReactNode
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        borderRadius: 2.5,
        bgcolor: 'var(--studio-paper-muted)',
        boxShadow: 'var(--studio-shadow-soft)',
        ...(props.fill ? { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <Stack spacing={1.25} sx={props.fill ? { flex: '1 1 auto', minHeight: 0 } : undefined}>
        <Box sx={{ flexShrink: 0 }}>
          <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
          {props.description ? (
            <Typography variant="caption" color="text.secondary">
              {props.description}
            </Typography>
          ) : null}
        </Box>
        {props.children}
      </Stack>
    </Paper>
  )
}
