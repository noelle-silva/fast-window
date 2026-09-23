import * as React from 'react'
import { Box, Button, Popover, Stack } from '@mui/material'
import ImageIcon from '@mui/icons-material/Image'

export function ComposerImagePickerPopover(props: {
  loading: boolean
  activeRole: any
  imagePickerEl: HTMLElement | null
  closeImagePicker: () => void
  onPickDraftImages: () => void
}) {
  const { loading, activeRole, imagePickerEl, closeImagePicker, onPickDraftImages } = props

  return (
    <Popover
      open={!!imagePickerEl}
      anchorEl={imagePickerEl}
      onClose={closeImagePicker}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Box data-area="composer-image-picker" sx={{ width: 248, p: 1 }}>
        <Stack spacing={0.5}>
          <Button startIcon={<ImageIcon fontSize="small" />} variant="text" onClick={onPickDraftImages} disabled={loading || !activeRole} sx={{ justifyContent: 'flex-start', borderRadius: 2 }}>
            图片
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
