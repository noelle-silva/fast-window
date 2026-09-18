import * as React from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { SettingsListItem, SettingsSurface } from './SettingsSurfaces'

type WorkspacesSettingsPanelProps = {
  controller: any
  loading: boolean
  workspaces: any[]
  activeWorkspaceId: string
  activeTargetKind: string
}

function promptPreview(value: unknown) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return '未填写说明'
  return text.length > 48 ? `${text.slice(0, 48).trim()}...` : text
}

export function WorkspacesSettingsPanel(props: WorkspacesSettingsPanelProps) {
  const { controller, loading, workspaces, activeWorkspaceId, activeTargetKind } = props

  return (
    <SettingsSurface>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>工作区管理</Typography>
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<AddIcon />} onClick={() => controller.actions.openNewWorkspaceEditor?.()} disabled={loading}>
            新建工作区
          </Button>
        </Stack>

        {workspaces.length ? (
          <Stack spacing={1.25}>
            {workspaces.map((workspace: any) => {
              const workspaceId = String(workspace?.id || '')
              const isActive = workspaceId && activeTargetKind === 'workspace' && workspaceId === activeWorkspaceId
              const directories = Array.isArray(workspace?.directories) ? workspace.directories : []
              return (
                <SettingsListItem
                  key={workspaceId}
                  tone={isActive ? 'selected' : 'default'}
                  sx={{
                    bgcolor: isActive ? 'rgba(25,118,210,.08)' : undefined,
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ width: 32, height: 32, borderRadius: 2, bgcolor: 'rgba(59,130,246,.10)', color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <FolderOutlinedIcon fontSize="small" />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 900 }} noWrap>
                          {String(workspace?.name || '未命名工作区')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {directories.length ? `${directories.length} 个目录` : '暂未登记目录'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                          {promptPreview(workspace?.prompt)}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        variant={isActive ? 'contained' : 'text'}
                        onClick={() => controller.actions.setActiveWorkspace?.(workspaceId)}
                        disabled={!workspaceId}
                      >
                        {isActive ? '当前' : '进入工作区'}
                      </Button>
                      <Button size="small" onClick={() => controller.actions.openWorkspaceEditor?.(workspaceId)} disabled={!workspaceId}>
                        编辑
                      </Button>
                      <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteWorkspace?.(workspaceId)} disabled={!workspaceId}>
                        删除
                      </Button>
                    </Stack>
                  </Stack>
                </SettingsListItem>
              )
            })}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            暂无工作区
          </Typography>
        )}
      </Stack>
    </SettingsSurface>
  )
}
