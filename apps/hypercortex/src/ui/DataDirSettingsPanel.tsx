import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import type { DataDirStatus, LegacyDataImportResult } from '../gateway/types'
import { softButtonSx } from './pluginUiStyles'

type Props = {
  status: DataDirStatus | null
  onRefresh: () => Promise<void> | void
  onPick: () => Promise<DataDirStatus | null>
  onImportLegacy: () => Promise<LegacyDataImportResult | null>
}

export function DataDirSettingsPanel(props: Props) {
  const { status, onRefresh, onPick, onImportLegacy } = props
  const [busy, setBusy] = React.useState(false)

  const handlePick = React.useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onPick()
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }, [busy, onPick, onRefresh])

  const handleImport = React.useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onImportLegacy()
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }, [busy, onImportLegacy, onRefresh])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.5, borderRadius: 2, bgcolor: 'rgba(0,0,0,.03)' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>数据目录</Typography>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
          当前数据会分成状态和知识库两层存放。你可以切换新的数据目录，也可以一次性导入旧目录。
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 0.5 }}>
        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.56)', lineHeight: 1.6 }}>
          当前目录：{status?.dataDir || '未就绪'}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.56)', lineHeight: 1.6 }}>
          默认目录：{status?.defaultDataDir || '未就绪'}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 12, color: status?.writable ? '#2e7d32' : '#d32f2f', lineHeight: 1.6 }}>
        {status?.writable ? '目录可写，后端已正常准备就绪。' : `目录不可用：${status?.error || '未知原因'}`}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="text" onClick={() => void handlePick()} disabled={busy} sx={softButtonSx}>切换数据目录</Button>
        <Button variant="text" onClick={() => void handleImport()} disabled={busy} sx={softButtonSx}>导入旧数据目录</Button>
      </Box>
    </Box>
  )
}
