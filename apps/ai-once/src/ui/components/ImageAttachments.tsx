import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { formatBytes } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'

type ImageAttachmentsProps = {
  controller: AiOnceController
  onPickImages(): void
}

export function ImageAttachments(props: ImageAttachmentsProps) {
  const { controller, onPickImages } = props
  const images = controller.state.images
  const settings = controller.state.data?.settings

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
        <Typography variant="caption" color="text.secondary">
          {images.length
            ? `已添加 ${images.length} 张（${formatBytes(controller.imageBytes)}）`
            : `可上传或粘贴图片，限制 ${settings?.imageMaxCount || 6} 张 / ${settings?.imageMaxMb || 8} MB`}
        </Typography>
        <Stack direction="row" spacing={0.75}>
          <Button startIcon={<AddPhotoAlternateRoundedIcon fontSize="small" />} onClick={onPickImages} disabled={controller.state.busy || controller.state.asking}>
            图片
          </Button>
          {images.length ? (
            <Button color="warning" startIcon={<DeleteSweepRoundedIcon fontSize="small" />} onClick={controller.clearImages} disabled={controller.state.busy || controller.state.asking}>
              清空图片
            </Button>
          ) : null}
        </Stack>
      </Stack>

      {images.length ? (
        <Box aria-label="已添加图片" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 1 }}>
          {images.map(image => (
            <Box key={image.id} sx={{ position: 'relative', height: 82, overflow: 'hidden', borderRadius: 2, bgcolor: 'action.hover', boxShadow: 'inset 0 0 0 1px rgba(100, 116, 139, 0.18)' }}>
              <Box component="img" src={image.previewUrl} alt={image.name} sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
              <IconButton
                aria-label={`移除 ${image.name}`}
                onClick={() => controller.removeImage(image.id)}
                disabled={controller.state.busy || controller.state.asking}
                sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(255,255,255,.88)', '&:hover': { bgcolor: 'rgba(255,255,255,.96)' } }}
              >
                <CloseRoundedIcon fontSize="inherit" />
              </IconButton>
            </Box>
          ))}
        </Box>
      ) : null}
    </Stack>
  )
}
