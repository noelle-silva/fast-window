import { Avatar, Box, Button, Stack, Typography } from '@mui/material'
import { isDataImageUrl } from '../utils'
import type { IconImageSource } from '../iconImageInput'
import { hostButtonSx, hostSurfaceSx } from '../components/hostUiStyles'
import { useHostAppearance } from '../components/hostAppearance'

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
  const hostAppearance = useHostAppearance()
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
      sx={theme => ({
        ...hostSurfaceSx(hostAppearance.surfaceMode, { tone: 'item' })(theme),
        display: 'flex',
        alignItems: { xs: 'stretch', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1.25,
        '&:focus-visible': {
          boxShadow: `0 0 0 3px ${theme.palette.primary.main}33`,
        },
      })}
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
            支持选择图片、按钮粘贴，或聚焦此区域后按 Ctrl+V 粘贴图片；未设置独立图标的命令入口会跟随主页图标。
          </Typography>
        </Box>
      </Box>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
        <Button size="small" variant="text" sx={hostButtonSx} disabled={disabled} onClick={() => onChange('file')}>
          选择图片
        </Button>
        <Button size="small" variant="text" sx={hostButtonSx} disabled={disabled} onClick={() => onChange('clipboard')}>
          粘贴图片
        </Button>
        <Button size="small" variant="text" sx={hostButtonSx} disabled={disabled || !canReset} onClick={onResetDefault}>
          恢复默认
        </Button>
      </Stack>
    </Box>
  )
}
