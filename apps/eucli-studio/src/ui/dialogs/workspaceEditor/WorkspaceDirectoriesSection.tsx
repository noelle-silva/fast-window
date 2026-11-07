import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { colorMixVar } from '../../colorThemeStyles'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'
import { MoreActionsMenu } from '../../components/MoreActionsMenu'
import {
  workspaceDirectoryHealthLabel,
  workspaceDirectoryNeedsRepair,
  workspaceUnavailableDirectoryCount,
} from '../../../domain/workspaceHealth'

/**
 * 工作区目录清单：每行一个目录，记录绝对路径、别名与用途说明。
 * 路径只校验格式；磁盘暂时失联不影响保存，会被标记成需要修复。
 */
export function WorkspaceDirectoriesSection(props: { controller: any; draft: any }) {
  const { controller, draft } = props
  const directories = Array.isArray(draft?.workspaceDirectories) ? draft.workspaceDirectories : []
  const unavailableDirectoryCount = workspaceUnavailableDirectoryCount({ directories })

  return (
    <CategoryEditorSection
      title="目录清单"
      description="路径只校验格式；磁盘暂时失联不会影响保存，会被标记为需要修复。"
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          {directories.length ? `已登记 ${directories.length} 个目录` : '暂未登记目录'}
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.addWorkspaceDirectory?.()}>
          添加目录
        </Button>
      </Stack>

      {unavailableDirectoryCount ? (
        <Alert severity="error">
          检测到 {unavailableDirectoryCount} 个目录当前不可用。登记信息会原样保留，请修复路径后重新保存；其他工作区不受影响。
        </Alert>
      ) : null}

      <Stack spacing={1.25}>
        {(directories.length ? directories : [{ path: '', alias: '', description: '' }]).map(
          (directory: any, index: number) => {
            const needsRepair = workspaceDirectoryNeedsRepair(directory)
            return (
              <Box
                key={`workspace-dir-${index}`}
                sx={{
                  border: '1px solid',
                  borderColor: needsRepair ? 'error.main' : 'divider',
                  borderRadius: 2,
                  p: 1.25,
                  bgcolor: needsRepair ? 'rgba(211, 47, 47, 0.04)' : 'background.paper',
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: 1.5,
                        bgcolor: colorMixVar('--studio-primary', 10),
                        color: 'primary.main',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <FolderOutlinedIcon fontSize="small" />
                    </Box>
                    <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>
                      目录 {index + 1}
                    </Typography>
                  </Stack>
                  <MoreActionsMenu
                    items={[
                      {
                        key: 'delete',
                        label: '删除',
                        icon: <DeleteOutlineIcon fontSize="small" />,
                        danger: true,
                        confirm: {
                          title: '确认删除目录？',
                          description: `将移除「${String(directory?.path || `目录 ${index + 1}`)}」，保存工作区后生效。`,
                        },
                        onSelect: () => controller.actions.removeWorkspaceDirectory?.(index),
                      },
                    ]}
                  />
                </Stack>

                <Stack spacing={1} sx={{ mt: 1 }}>
                  <TextField
                    label="绝对路径"
                    value={String(directory?.path || '')}
                    onChange={(event) => controller.actions.setWorkspaceDirectoryField?.(index, 'path', event.target.value)}
                    fullWidth
                    placeholder="例如：E:\\project"
                    error={needsRepair}
                    helperText={needsRepair ? workspaceDirectoryHealthLabel(directory?.health) : undefined}
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      label="别名"
                      value={String(directory?.alias || '')}
                      onChange={(event) => controller.actions.setWorkspaceDirectoryField?.(index, 'alias', event.target.value)}
                      fullWidth
                      placeholder="例如：主仓库"
                    />
                    <TextField
                      label="用途说明"
                      value={String(directory?.description || '')}
                      onChange={(event) =>
                        controller.actions.setWorkspaceDirectoryField?.(index, 'description', event.target.value)
                      }
                      fullWidth
                      placeholder="例如：前端主工程目录"
                    />
                  </Stack>
                </Stack>
              </Box>
            )
          },
        )}
      </Stack>
    </CategoryEditorSection>
  )
}
