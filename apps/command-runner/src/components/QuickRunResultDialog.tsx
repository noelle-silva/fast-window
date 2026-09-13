import { Alert, Box, Button, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import type { QuickRunRunResult } from '../types'

type QuickRunResultDialogProps = {
  quickRunName: string
  result: QuickRunRunResult
  onClose: () => void
}

export function QuickRunResultDialog({ quickRunName, result, onClose }: QuickRunResultDialogProps) {
  const failureCount = result.failures.length

  return (
    <DialogShell
      title="快捷运行启动结果"
      subtitle={`「${quickRunName}」已完成启动尝试。`}
      onClose={onClose}
    >
      <Box className="cr-form">
        <Alert severity={failureCount > 0 ? 'warning' : 'success'}>
          {`成功启动 ${result.started.length} 条命令，${failureCount} 条启动失败。`}
        </Alert>
        {failureCount > 0 ? (
          <Box className="cr-quick-run-failure-list">
            {result.failures.map(failure => (
              <Box key={failure.commandId} className="cr-quick-run-failure-item">
                <Typography sx={{ fontSize: 13, fontWeight: 800 }} noWrap>{failure.commandName}</Typography>
                <Typography color="error.main" sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>{failure.error}</Typography>
              </Box>
            ))}
          </Box>
        ) : null}
        <Box className="cr-form-actions">
          <Button variant="contained" onClick={onClose}>知道了</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
