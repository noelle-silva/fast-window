import * as React from 'react'
import { Checkbox, FormControlLabel, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import { colorMixVar } from '../../colorThemeStyles'
import { EntityAvatar } from '../../components/avatar/EntityAvatar'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'

/**
 * 工作区角色注册：勾选哪些角色属于这个工作区。
 * 注册关系是工作区文档的一部分，保存工作区后生效。
 */
export function WorkspaceRolesSection(props: { controller: any; draft: any; roles: any[] }) {
  const { controller, draft, roles } = props
  const [searchText, setSearchText] = React.useState('')

  const registeredRoleIds = new Set(
    (Array.isArray(draft?.workspaceRegisteredRoleIds) ? draft.workspaceRegisteredRoleIds : [])
      .map((roleId: any) => String(roleId || '').trim())
      .filter(Boolean),
  )
  const query = searchText.trim().toLowerCase()
  const filteredRoles = React.useMemo(
    () => roles.filter((role: any) => !query || String(role?.name || '').toLowerCase().includes(query)),
    [roles, query],
  )

  return (
    <CategoryEditorSection title="角色注册" description="勾选要加入当前工作区的角色，保存工作区后生效。">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="搜索角色…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: searchText ? (
              <InputAdornment position="end">
                <IconButton size="small" edge="end" aria-label="清空角色搜索" onClick={() => setSearchText('')}>
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, flexShrink: 0 }}>
          已注册 {registeredRoleIds.size} / {roles.length}
        </Typography>
      </Stack>

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
                control={
                  <Checkbox
                    size="small"
                    checked={registered}
                    onChange={(event) => controller.actions.setWorkspaceRoleRegistered?.(roleId, event.target.checked)}
                  />
                }
                label={
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <EntityAvatar kind="role" image={String(role?.avatarImage || '')} size={26} />
                    <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>
                      {String(role?.name || '未命名角色')}
                    </Typography>
                  </Stack>
                }
              />
            )
          })}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
          {roles.length ? '没有匹配的角色。' : '暂无角色。'}
        </Typography>
      )}
    </CategoryEditorSection>
  )
}
