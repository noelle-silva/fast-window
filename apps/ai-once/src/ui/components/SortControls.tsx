import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import { Button } from '@mui/material'

type SortModeButtonProps = {
  enabled: boolean
  onClick: () => void
  disabled?: boolean
  idleLabel?: string
  activeLabel?: string
}

export function SortModeButton(props: SortModeButtonProps) {
  const { enabled, onClick, disabled = false, idleLabel = '拖拽排序', activeLabel = '完成排序' } = props
  return (
    <Button
      size="small"
      variant={enabled ? 'contained' : 'outlined'}
      onClick={onClick}
      disabled={disabled}
      startIcon={enabled ? <DoneRoundedIcon fontSize="small" /> : <DragIndicatorRoundedIcon fontSize="small" />}
    >
      {enabled ? activeLabel : idleLabel}
    </Button>
  )
}
