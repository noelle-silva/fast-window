import * as React from 'react'
import { Alert, Box, Button, Checkbox, Divider, FormControlLabel, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SearchIcon from '@mui/icons-material/Search'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { colorMixVar } from '../colorThemeStyles'

export function WorkspaceEditorForm(props: { controller: any; draft: any; roles: any[] }) {
  const { controller, draft, roles } = props
  const [roleSearchText, setRoleSearchText] = React.useState('')

  const directories = Array.isArray((draft as any)?.workspaceDirectories) ? (draft as any).workspaceDirectories : []
  const registeredRoleIds = new Set(
    (Array.isArray((draft as any)?.workspaceRegisteredRoleIds) ? (draft as any).workspaceRegisteredRoleIds : [])
      .map((roleId: any) => String(roleId || '').trim())
      .filter(Boolean),
  )
  const roleQuery = roleSearchText.trim().toLowerCase()
  const filteredRoles = React.useMemo(
    () => roles.filter((role: any) => !roleQuery || String(role?.name || '').toLowerCase().includes(roleQuery)),
    [roles, roleQuery],
  )
  const actualPrompt = String((draft as any)?.workspaceActualPrompt || '')
  const actualPromptLoading = Boolean((draft as any)?.workspaceActualPromptLoading)
  const actualPromptStale = Boolean((draft as any)?.workspaceActualPromptStale)
  const actualPromptError = String((draft as any)?.workspaceActualPromptError || '')

  return (
    <Stack spacing={2}>
      <TextField
        label="工作区名称"
        value={String((draft as any)?.workspaceName || '')}
        onChange={(e) => controller.actions.setDraft?.('workspaceName', e.target.value)}
        fullWidth
      />

      <TextField
        label="工作区提示词"
        value={String((draft as any)?.workspacePrompt || '')}
        onChange={(e) => controller.actions.setDraft?.('workspacePrompt', e.target.value)}
        fullWidth
        multiline
        minRows={6}
        placeholder="这里写入项目约定、工作规范、额外上下文说明。"
      />

      <Box sx={{ border: '1px solid', borderColor: actualPromptStale ? 'warning.light' : 'divider', borderRadius: 2, p: 1.5, bgcolor: actualPromptStale ? 'rgba(245,158,11,.06)' : 'background.paper' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>实际提示词</Typography>
            <Typography variant="caption" color="text.secondary">
              后台按当前工作区资料生成，设置页只展示结果，不在界面里拼装。
            </Typography>
          </Box>
          <Button size="small" variant={actualPromptStale ? 'contained' : 'outlined'} onClick={() => controller.actions.refreshWorkspacePromptPreview?.()} disabled={actualPromptLoading}>
            {actualPromptLoading ? '生成中…' : '刷新实际提示词'}
          </Button>
        </Stack>
        {actualPromptStale ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            当前填写内容已变化，请刷新后查看最新实际提示词。
          </Alert>
        ) : null}
        {actualPromptError ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {actualPromptError}
          </Alert>
        ) : null}
        <TextField
          value={actualPrompt || '（当前没有额外工作区提示词会进入对话）'}
          fullWidth
          multiline
          minRows={5}
          InputProps={{ readOnly: true }}
        />
      </Box>

      <Divider />

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, bgcolor: colorMixVar('--studio-primary', 4) }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>角色注册</Typography>
            <Typography variant="caption" color="text.secondary">
              勾选要加入当前工作区的角色，保存工作区后生效。
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, flexShrink: 0 }}>
            已注册 {registeredRoleIds.size} / {roles.length}
          </Typography>
        </Stack>

        <TextField
          size="small"
          fullWidth
          placeholder="搜索角色…"
          value={roleSearchText}
          onChange={(event) => setRoleSearchText(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: roleSearchText ? (
              <InputAdornment position="end">
                <IconButton size="small" edge="end" aria-label="清空角色搜索" onClick={() => setRoleSearchText('')}>
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />

        <CustomScrollArea hostSx={{ maxHeight: 240, mt: 1 }} scrollSx={{ maxHeight: 240 }} contentSx={{ pr: 0.5 }}>
          {filteredRoles.length ? (
            <Stack spacing={0.75}>
              {filteredRoles.map((role: any) => {
                const roleId = String(role?.id || '').trim()
                if (!roleId) return null
                const registered = registeredRoleIds.has(roleId)
                return (
                  <FormControlLabel
                    key={roleId}
                    labelPlacement="start"
                    sx={{
                      m: 0,
                      width: '100%',
                      justifyContent: 'space-between',
                      border: '1px solid',
                      borderColor: registered ? colorMixVar('--studio-primary', 28) : 'divider',
                      borderRadius: 1.5,
                      px: 1,
                      py: 0.25,
                      bgcolor: registered ? colorMixVar('--studio-primary', 8) : 'background.paper',
                      '& .MuiFormControlLabel-label': { minWidth: 0, flex: 1 },
                    }}
                    control={(
                      <Checkbox
                        size="small"
                        checked={registered}
                        onChange={(event) => controller.actions.setWorkspaceRoleRegistered?.(roleId, event.target.checked)}
                      />
                    )}
                    label={(
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <EntityAvatar kind="role" image={String(role?.avatarImage || '')} size={26} />
                        <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>
                          {String(role?.name || '未命名角色')}
                        </Typography>
                      </Stack>
                    )}
                  />
                )
              })}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
              {roles.length ? '没有匹配的角色。' : '暂无角色。'}
            </Typography>
          )}
        </CustomScrollArea>
      </Box>

      <Divider />

      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ fontWeight: 900 }}>目录清单</Typography>
        <Typography variant="caption" color="text.secondary">
          路径需要填写绝对路径，保存时会由后端做真实校验。
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.addWorkspaceDirectory?.()}>
          添加目录
        </Button>
      </Stack>

      <Divider />

      <Stack spacing={1.25}>
        {(directories.length ? directories : [{ path: '', alias: '', description: '' }]).map((directory: any, index: number) => (
          <Box key={`workspace-dir-${index}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: colorMixVar('--studio-primary', 10), color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <FolderOutlinedIcon fontSize="small" />
                </Box>
                <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>
                  目录 {index + 1}
                </Typography>
              </Stack>
              <MoreActionsMenu
                items={[{
                  key: 'delete',
                  label: '删除',
                  icon: <DeleteOutlineIcon fontSize="small" />,
                  danger: true,
                  confirm: {
                    title: '确认删除目录？',
                    description: `将移除「${String(directory?.path || `目录 ${index + 1}`)}」，保存工作区后生效。`,
                  },
                  onSelect: () => controller.actions.removeWorkspaceDirectory?.(index),
                }]}
              />
            </Stack>

            <Stack spacing={1} sx={{ mt: 1 }}>
              <TextField
                label="绝对路径"
                value={String(directory?.path || '')}
                onChange={(e) => controller.actions.setWorkspaceDirectoryField?.(index, 'path', e.target.value)}
                fullWidth
                placeholder="例如：E:\\project"
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  label="别名"
                  value={String(directory?.alias || '')}
                  onChange={(e) => controller.actions.setWorkspaceDirectoryField?.(index, 'alias', e.target.value)}
                  fullWidth
                  placeholder="例如：主仓库"
                />
                <TextField
                  label="用途说明"
                  value={String(directory?.description || '')}
                  onChange={(e) => controller.actions.setWorkspaceDirectoryField?.(index, 'description', e.target.value)}
                  fullWidth
                  placeholder="例如：前端主工程目录"
                />
              </Stack>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Stack>
  )
}
