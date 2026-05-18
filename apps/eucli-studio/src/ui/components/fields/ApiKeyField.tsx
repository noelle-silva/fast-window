import * as React from 'react'
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

export function ApiKeyField(props: { value: string; onValueChange: (next: string) => void }) {
  const { value, onValueChange } = props
  const [visible, setVisible] = React.useState(false)

  const label = visible ? '隐藏 API Key' : '显示 API Key'

  return (
    <TextField
      label="API Key"
      type={visible ? 'text' : 'password'}
      autoComplete="off"
      value={String(value || '')}
      onChange={(e) => onValueChange(e.target.value)}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={label}>
              <IconButton
                size="small"
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
    />
  )
}

