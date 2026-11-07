import * as React from 'react'
import { Button, Stack, TextField, Typography } from '@mui/material'
import { workspaceIconFromDraft, workspaceIconImageSrc } from '../../../domain/workspaceIcon'
import { EntityAvatar } from '../../components/avatar/EntityAvatar'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'

/**
 * 工作区身份信息：名称、描述备注与图标。
 * 描述只是备注，不参与提示词；图标是图片或 SVG 源码二选一，保存工作区时一起写入。
 */
export function WorkspaceIdentitySection(props: { controller: any; draft: any }) {
  const { controller, draft } = props

  const iconKind = String(draft?.workspaceIconKind || '')
  const iconSvg = String(draft?.workspaceIconSvg || '')
  const iconDataUrl = String(draft?.workspaceIconDataUrl || '')
  const icon = workspaceIconFromDraft(iconKind, iconSvg, iconDataUrl)
  const iconSrc = workspaceIconImageSrc(icon)

  return (
    <CategoryEditorSection title="工作区信息" description="名称用于入口与提示词；图标与描述可选。">
      <TextField
        label="工作区名称"
        value={String(draft?.workspaceName || '')}
        onChange={(event) => controller.actions.setDraft?.('workspaceName', event.target.value)}
        fullWidth
      />

      <TextField
        label="描述（备注）"
        value={String(draft?.workspaceDescription || '')}
        onChange={(event) => controller.actions.setDraft?.('workspaceDescription', event.target.value)}
        fullWidth
        multiline
        minRows={3}
        placeholder="这个工作区是干什么用的？写给自己看的备忘。"
        helperText="只是备注：不参与提示词，不会发给模型。想影响模型请写工作区提示词。"
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <EntityAvatar kind="workspace" image={iconSrc} size={44} />
          <Typography variant="body2" color="text.secondary">
            工作区图标（可选）
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ flex: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={() => controller.actions.pickWorkspaceIconImage?.()}>
            选择图片
          </Button>
          <Button size="small" variant="text" onClick={() => controller.actions.clearWorkspaceIcon?.()} disabled={!icon}>
            清除图片
          </Button>
        </Stack>
      </Stack>

      <TextField
        label="SVG 源码"
        value={iconSvg}
        onChange={(event) => controller.actions.setWorkspaceIconSvg?.(event.target.value)}
        fullWidth
        multiline
        minRows={4}
        placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…</svg>'}
        helperText={
          iconKind === 'image'
            ? '当前使用图片图标；输入 SVG 源码会切换为 SVG 图标。'
            : '粘贴 SVG 源码即用图标；清空源码会去掉图标。'
        }
      />
    </CategoryEditorSection>
  )
}
