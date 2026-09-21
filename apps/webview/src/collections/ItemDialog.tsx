import * as React from 'react'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { URL_CATEGORY } from './categoryRegistry'
import { IconAppearancePanel } from './DesktopDialogs'
import { identityDisplayName } from './identities'
import type { CollectionItem, CollectionItemFormState, DesktopIcon, IconAppearanceCandidate, IdentityInfo, WebIconDiscoveryProgress, WorkspaceView } from './types'

export function ItemDialog(props: {
  assetUrl?(assetId: string): string
  busy: boolean
  doc: WorkspaceView
  editing: CollectionItem | null
  form: CollectionItemFormState
  identityOptions: IdentityInfo[]
  identityValue: string
  independentSpace: boolean
  webIconDiscovery: WebIconDiscoveryProgress
  onChangeIconDraft(icon: DesktopIcon | null): void
  onChangeIdentity(spaceId: string): void
  onChangeIndependentSpace(value: boolean): void
  onChange(form: CollectionItemFormState): void
  onClose(): void
  onEditIdentity(spaceId: string): void
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
  const selectedIdentity = props.identityOptions.find(identity => identity.spaceId === props.identityValue)
  const canEditIdentity = Boolean(props.identityValue) && Boolean(selectedIdentity)

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
          {props.independentSpace ? (
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <FormControl variant="filled" fullWidth size="small">
                <InputLabel id="item-dialog-identity-label">登录信息</InputLabel>
                <Select
                  variant="filled"
                  labelId="item-dialog-identity-label"
                  label="登录信息"
                  value={props.identityValue}
                  onChange={event => props.onChangeIdentity(event.target.value)}
                >
                  <MenuItem value="">新建一份全新的登录数据</MenuItem>
                  {props.identityOptions.map(identity => (
                    <MenuItem key={identity.spaceId} value={identity.spaceId}>
                      {identity.usedBy.length ? identityDisplayName(identity) : `${identityDisplayName(identity)}（未使用）`}
                    </MenuItem>
                  ))}
                  {props.identityValue && !selectedIdentity ? <MenuItem value={props.identityValue}>当前独立空间</MenuItem> : null}
                </Select>
                <FormHelperText>选择该网址已有的登录信息，或新建一份全新的独立登录数据。</FormHelperText>
              </FormControl>
              <Tooltip title="编辑登录信息名称与描述">
                <span>
                  <IconButton
                    aria-label="编辑登录信息"
                    disabled={!canEditIdentity}
                    onClick={() => props.onEditIdentity(props.identityValue)}
                    sx={{ mt: 0.25 }}
                  >
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
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
