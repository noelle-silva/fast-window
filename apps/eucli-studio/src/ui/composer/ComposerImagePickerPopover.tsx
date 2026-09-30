import * as React from 'react'
import { Box, Button, Popover, Stack } from '@mui/material'
import ImageIcon from '@mui/icons-material/Image'
import { useUiDataVersion } from '../hooks/useScopedUiVersion'

// 独立刷新：用 memo 隔离，只有自身输入变化时才重绘，不被无关整页刷新牵连。
export const ComposerImagePickerPopover = React.memo(function ComposerImagePickerPopover(props: {
  controller: any
  loading: boolean
  activeRole: any
  imagePickerEl: HTMLElement | null
  closeImagePicker: () => void
  onPickDraftImages: () => void
}) {
  const { controller, loading, activeRole, imagePickerEl, closeImagePicker, onPickDraftImages } = props

  // 订阅全局数据版本：数据变化时本组件仍刷新；父级本地 UI 变化被 memo 挡在外面。
  useUiDataVersion(controller)

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
})
