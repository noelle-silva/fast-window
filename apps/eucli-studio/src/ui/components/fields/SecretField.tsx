import * as React from 'react'
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

export function SecretField(props: { label: string; value: string; onValueChange: (next: string) => void }) {
  const { label, value, onValueChange } = props
  const [visible, setVisible] = React.useState(false)

  const tip = visible ? `隐藏 ${label}` : `显示 ${label}`

  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete="off"
      value={String(value || '')}
      onChange={(e) => onValueChange(e.target.value)}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={tip}>
              <IconButton size="small" aria-label={tip} onMouseDown={(e) => e.preventDefault()} onClick={() => setVisible((v) => !v)}>
                {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
    />
  )
}

