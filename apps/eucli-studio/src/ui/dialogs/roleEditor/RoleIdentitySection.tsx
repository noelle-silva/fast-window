import * as React from 'react'
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { NEW_ROLE_ID } from '../../../domain/constants'
import { EntityAvatar } from '../../components/avatar/EntityAvatar'
import { RoleAvatarCropper } from '../../components/avatar/RoleAvatarCropper'
import { RoleEditorSection } from './RoleEditorLayout'

/**
 * 角色身份：角色名 + 角色 ID + 头像。
 * 角色 ID 由主进程分配，这里只做展示与复制；新建角色保存后才有 ID。
 * 头像裁剪态也挂在这里，裁剪未完成时保存会被拦住。
 */
export function RoleIdentitySection(props: { controller: any; draft: any }) {
  const { controller, draft } = props
  const avatarImage = String(draft?.roleAvatarImage || '').trim()
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  const roleId = String(draft?.editRoleId || '').trim()
  const hasRoleId = !!roleId && roleId !== NEW_ROLE_ID

  const copyRoleId = () => {
    const capabilities = controller?.capabilities
    const writeText = capabilities?.clipboard?.writeText
    if (typeof writeText !== 'function') return capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(roleId))
      .then(() => capabilities?.ui?.showToast?.('已复制角色 ID', { kind: 'success' }))
      .catch(() => capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }))
  }

  return (
    <RoleEditorSection title="角色信息" description="角色名用于会话标题与依赖树根节点；头像可选。">
      <TextField
        label="角色名"
        value={String(draft?.roleName || '')}
        onChange={(event) => controller.actions.setDraft('roleName', event.target.value)}
        fullWidth
      />

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          角色 ID
        </Typography>
        <Typography
          title={hasRoleId ? roleId : undefined}
          sx={{
            minWidth: 0,
            flex: '0 1 auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12.5,
            fontWeight: 700,
            color: hasRoleId ? 'text.primary' : 'text.secondary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            userSelect: 'text',
          }}
        >
          {hasRoleId ? roleId : '保存角色后生成'}
        </Typography>
        <Tooltip title={hasRoleId ? '复制角色 ID' : '保存角色后才有 ID'}>
          <span>
            <IconButton size="small" aria-label="复制角色 ID" disabled={!hasRoleId} onClick={copyRoleId} sx={{ flexShrink: 0 }}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

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
