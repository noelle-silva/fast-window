import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { URL_CATEGORY } from './categoryRegistry'
import { IconAppearancePanel } from './DesktopDialogs'
import type { CollectionItem, CollectionItemFormState, DesktopIcon, IconAppearanceCandidate, SpaceCandidate, WebIconDiscoveryProgress, WorkspaceView } from './types'

export function ItemDialog(props: {
  assetUrl?(assetId: string): string
  busy: boolean
  doc: WorkspaceView
  editing: CollectionItem | null
  form: CollectionItemFormState
  independentSpace: boolean
  spaceCandidates: SpaceCandidate[]
  spaceValue: string
  webIconDiscovery: WebIconDiscoveryProgress
  onChangeIconDraft(icon: DesktopIcon | null): void
  onChangeIndependentSpace(value: boolean): void
  onChangeSpace(value: string): void
  onChange(form: CollectionItemFormState): void
  onClose(): void
  onFetchWebIcons(): void
  onPasteIconImage(): void
  onPickIconImage(): void
  onResetIcon(): void
  onSave(): void
  onSelectIconCandidate(candidate: IconAppearanceCandidate): void
}) {
  const category = URL_CATEGORY
  const open = Boolean(props.editing)
  const targetContainer = props.editing?.containerId ? props.doc.containers.find(container => container.id === props.editing?.containerId) : null
  const inheritableSpaces = props.spaceCandidates.filter(candidate => candidate.spaceId !== '')

  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing?.id ? `编辑${category.singularLabel}` : category.addLabel}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>保存常用{category.singularLabel}，之后可以一键打开。</Typography>
          </Box>
          <TextField
            label="名称"
            value={props.form.name}
            onChange={event => props.onChange({ ...props.form, name: event.target.value })}
            placeholder="例如：项目主页"
            fullWidth
          />
          <TextField
            label={category.targetLabel}
            value={props.form.target}
            onChange={event => props.onChange({ ...props.form, target: event.target.value })}
            placeholder={category.targetPlaceholder}
            autoFocus
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="flex-start">
            <FormControl variant="filled" fullWidth size="small" disabled={props.busy || Boolean(targetContainer)}>
              <InputLabel id="item-dialog-group-label">所属分组</InputLabel>
              <Select
                variant="filled"
                labelId="item-dialog-group-label"
                label="所属分组"
                value={props.form.groupId}
                onChange={event => props.onChange({ ...props.form, groupId: event.target.value })}
              >
                {props.doc.groups.length ? props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>) : <MenuItem value="" disabled>请先创建分组或填写新分组</MenuItem>}
              </Select>
              {targetContainer ? <FormHelperText>收纳夹内新建会跟随“{targetContainer.name}”所在分组</FormHelperText> : null}
            </FormControl>
            <TextField
              label="新分组（可选）"
              value={props.form.newGroupName}
              onChange={event => props.onChange({ ...props.form, newGroupName: event.target.value })}
              placeholder="输入新分组名"
              disabled={Boolean(targetContainer)}
              helperText={targetContainer ? '收纳夹内项目不能单独新建分组' : undefined}
              fullWidth
            />
          </Stack>
          {!props.editing?.id ? (
            <Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={props.independentSpace ? 'independent' : 'shared'}
                onChange={(_, value: 'shared' | 'independent' | null) => { if (value) props.onChangeIndependentSpace(value === 'independent') }}
                aria-label="登录空间"
              >
                <ToggleButton value="shared">共享空间</ToggleButton>
                <ToggleButton value="independent">独立空间</ToggleButton>
              </ToggleButtonGroup>
              <FormHelperText>
                共享空间：与其它收藏共用登录状态；独立空间：拥有独立登录状态，可与其它账号同时登录。
              </FormHelperText>
            </Box>
          ) : null}
          {inheritableSpaces.length ? (
            <FormControl variant="filled" fullWidth size="small">
              <InputLabel id="item-dialog-space-label">登录身份</InputLabel>
              <Select
                variant="filled"
                labelId="item-dialog-space-label"
                label="登录身份"
                value={props.spaceValue}
                onChange={event => props.onChangeSpace(event.target.value)}
              >
                {props.spaceCandidates.map(candidate => (
                  <MenuItem key={candidate.spaceId || 'default'} value={candidate.spaceId}>
                    {candidate.spaceId === ''
                      ? candidate.label
                      : `${candidate.label}${candidate.orphan ? '（未绑定的登录数据）' : ''}`}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>该网址存在可继承的登录状态，选择后此图标将使用对应身份的登录数据。</FormHelperText>
            </FormControl>
          ) : null}
          <IconAppearancePanel
            assetUrl={props.assetUrl}
            busy={props.busy}
            icon={props.form.icon}
            seed={props.editing?.id || props.form.target || props.form.name || 'item-icon'}
            webIconDiscovery={props.webIconDiscovery}
            onChangeDraft={props.onChangeIconDraft}
            onFetchWebIcons={props.onFetchWebIcons}
            onPasteImage={props.onPasteIconImage}
            onPickImage={props.onPickIconImage}
            onReset={props.onResetIcon}
            onSelectCandidate={props.onSelectIconCandidate}
          />
          <Typography variant="caption" color="text.secondary">每个{category.singularLabel}只属于一个分组；右键可打开、编辑、移动、复制或删除。</Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing?.id ? '保存' : '添加'}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
