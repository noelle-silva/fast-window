import * as React from 'react'
import { Box, Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, Typography } from '@mui/material'
import type { FolderGroup } from './types'
import { excludeGroupId, includeGroupId } from './groupMembership'

type Props = {
  allowEmpty?: boolean
  dense?: boolean
  disabled?: boolean
  groups: FolderGroup[]
  helperText?: string
  label: string
  value: string[]
  onChange(groupIds: string[]): void
}

export function GroupMembershipControl(props: Props): React.ReactNode {
  const selectedCount = props.value.length

  function toggleGroup(groupId: string, checked: boolean) {
    if (props.disabled) return
    if (!props.allowEmpty && !checked && selectedCount <= 1 && props.value.includes(groupId)) return
    props.onChange(checked ? includeGroupId(props.value, groupId) : excludeGroupId(props.value, groupId))
  }

  return (
    <FormControl fullWidth variant="standard" component="fieldset">
      <Typography component="legend" variant="caption" color="text.secondary" sx={{ mb: 0.75 }}>{props.label}</Typography>
      <FormGroup
        sx={{
          display: 'grid',
          gridTemplateColumns: props.dense ? '1fr' : { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: props.dense ? 0.25 : 0.5,
        }}
      >
        {props.groups.map(group => {
          const checked = props.value.includes(group.id)
          return (
            <Box key={group.id} sx={{ minWidth: 0 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={checked}
                    disabled={props.disabled}
                    onChange={event => toggleGroup(group.id, event.target.checked)}
                    size="small"
                  />
                }
                label={group.name}
                sx={{
                  mr: 0,
                  width: '100%',
                  borderRadius: 2,
                  px: 0.75,
                  bgcolor: checked ? theme => theme.palette.action.selected : 'transparent',
                  '& .MuiFormControlLabel-label': {
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
              />
            </Box>
          )
        })}
      </FormGroup>
      {props.helperText ? <FormHelperText>{props.helperText}</FormHelperText> : null}
    </FormControl>
  )
}
