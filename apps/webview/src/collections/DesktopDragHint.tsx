import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import { Box, Chip, Paper, Stack, Typography, alpha } from '@mui/material'
import type { ContainerExtractDragState } from './containerExtractDragState'
import type { DesktopDragState } from './desktopDragState'

type Props = {
  containerExtractDrag?: ContainerExtractDragState
  drag: DesktopDragState
}

export function DesktopDragHint(props: Props): React.ReactNode {
  if (props.containerExtractDrag?.mode === 'container') return <ContainerExtractDragHint drag={props.containerExtractDrag} />
  const drag = props.drag
  if (!drag) return null

  const intent = drag.dropIntent
  const isOverlayMode = drag.mode === 'overlay'
  const isContainerDrop = intent?.kind === 'container'
  const isCreateDrop = intent?.kind === 'new-container'
  const title = isContainerDrop ? '松手放入收纳夹' : isCreateDrop ? '松手创建新收纳夹' : isOverlayMode ? 'Ctrl 收纳模式' : '按住 Ctrl 收纳'
  const description = isContainerDrop
    ? '收纳夹已展开，松手后这个图标会进入当前收纳夹。'
    : isCreateDrop
      ? `松手后会把“${drag.item.name}”和目标图标合并为新收纳夹。`
      : isOverlayMode
        ? '拖到收纳夹或另一个图标上方松手，即可完成收纳。'
        : '普通拖拽只调整位置；按住 Ctrl 拖到收纳夹或图标上才会收纳。'
  const Icon = isCreateDrop ? CreateNewFolderRoundedIcon : Inventory2RoundedIcon
  const color = isOverlayMode ? 'primary' : 'warning'

  return <DragHintShell chip="Ctrl" color={color} description={description} icon={<Icon fontSize="small" />} title={title} />
}

function ContainerExtractDragHint(props: { drag: NonNullable<ContainerExtractDragState> }) {
  return (
    <DragHintShell
      color="info"
      icon={<Inventory2RoundedIcon fontSize="small" />}
      title="拖出收纳夹"
      chip="Move"
      description="拖出收纳夹面板后，会切换成普通桌面图标拖拽。"
    />
  )
}

function DragHintShell(props: { chip: string; color: 'info' | 'primary' | 'success' | 'warning'; description: string; icon: React.ReactNode; title: string }) {
  return (
    <Box
      sx={{
        position: 'fixed',
        left: '50%',
        bottom: { xs: 18, sm: 26 },
        zIndex: theme => theme.zIndex.modal + 4,
        pointerEvents: 'none',
        transform: 'translateX(-50%)',
        width: 'min(92vw, 460px)',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.35,
          px: 1.6,
          py: 1.25,
          borderRadius: 5,
          color: '#0f172a',
          bgcolor: 'rgba(255, 255, 255, 0.9)',
          border: theme => `1px solid ${alpha(theme.palette[props.color].main, 0.24)}`,
          boxShadow: theme => `0 18px 44px ${alpha(theme.palette[props.color].main, 0.2)}`,
          backdropFilter: 'blur(18px) saturate(1.12)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.12)',
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 3.2,
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            color: '#FFFFFF',
            bgcolor: `${props.color}.main`,
            boxShadow: theme => `0 12px 24px ${alpha(theme.palette[props.color].main, 0.24)}`,
          }}
        >
          {props.icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={0.85} sx={{ minWidth: 0 }}>
            <Typography fontWeight={950} noWrap>{props.title}</Typography>
            <Chip size="small" label={props.chip} color={props.color} sx={{ height: 22, fontWeight: 950 }} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{props.description}</Typography>
        </Box>
      </Paper>
    </Box>
  )
}
