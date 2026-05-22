import { Avatar, Box, Button, Stack, Typography } from '@mui/material'
import { isDataImageUrl } from '../utils'
import type { IconImageSource } from '../iconImageInput'

interface AppIconEditorProps {
  name: string
  icon: string
  saving: boolean
  changing: boolean
  canReset: boolean
  onChange: (source: IconImageSource) => void
  onResetDefault: () => void
}

export default function AppIconEditor({
  name,
  icon,
  saving,
  changing,
  canReset,
  onChange,
  onResetDefault,
}: AppIconEditorProps) {
  const iconAsImage = isDataImageUrl(icon) ? icon : undefined
  const disabled = saving || changing

  const handlePaste = (event: React.ClipboardEvent) => {
    event.preventDefault()
    onChange('clipboard')
  }

  return (
    <Box
      role="group"
      tabIndex={0}
      aria-label="主页图标编辑区"
      onPaste={handlePaste}
      sx={{
        display: 'flex',
        alignItems: { xs: 'stretch', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1.25,
        p: 1.25,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'action.hover',
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', minWidth: 0, flex: 1 }}>
        <Avatar
          variant="rounded"
          src={iconAsImage}
          imgProps={{ alt: name ? `${name} 图标预览` : '应用图标预览' }}
          sx={{ width: 48, height: 48, fontSize: 22, bgcolor: 'background.paper', color: 'text.primary', flexShrink: 0 }}
        >
          {iconAsImage ? null : icon || name[0] || 'A'}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            主页图标
          </Typography>
          <Typography variant="caption" color="text.secondary">
            支持选择图片、按钮粘贴，或聚焦此区域后按 Ctrl+V 粘贴图片；保存后会显示在主页入口和命令入口。
          </Typography>
        </Box>
      </Box>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => onChange('file')}>
          选择图片
        </Button>
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => onChange('clipboard')}>
          粘贴图片
        </Button>
        <Button size="small" variant="text" disabled={disabled || !canReset} onClick={onResetDefault}>
          恢复默认
        </Button>
      </Stack>
    </Box>
  )
}
