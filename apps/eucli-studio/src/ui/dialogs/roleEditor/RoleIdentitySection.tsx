import * as React from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { EntityAvatar } from '../../components/avatar/EntityAvatar'
import { RoleAvatarCropper } from '../../components/avatar/RoleAvatarCropper'
import { RoleEditorSection } from './RoleEditorLayout'

/** 角色身份：角色名 + 头像。头像裁剪态挂在这里，裁剪未完成时保存会被拦住。 */
export function RoleIdentitySection(props: { controller: any; draft: any }) {
  const { controller, draft } = props
  const avatarImage = String(draft?.roleAvatarImage || '').trim()
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  return (
    <RoleEditorSection title="角色信息" description="角色名用于会话标题与依赖树根节点；头像可选。">
      <TextField
        label="角色名"
        value={String(draft?.roleName || '')}
        onChange={(event) => controller.actions.setDraft('roleName', event.target.value)}
        fullWidth
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <EntityAvatar kind="role" image={avatarImage} size={44} />
          <Typography variant="body2" color="text.secondary">
            头像图片（可选）
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => controller.actions.pickRoleAvatarImage()} disabled={!!avatarCropSrc}>
            选择图片
          </Button>
          <Button variant="text" onClick={() => controller.actions.clearRoleAvatarImage()} disabled={!avatarImage && !avatarCropSrc}>
            清除图片
          </Button>
        </Stack>
      </Stack>

      {avatarCropSrc ? <RoleAvatarCropper controller={controller} src={avatarCropSrc} /> : null}
    </RoleEditorSection>
  )
}
