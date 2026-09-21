import * as React from 'react'
import { Box, Button, Checkbox, Dialog, DialogContent, FormControlLabel, Stack, Typography } from '@mui/material'
import { URL_CATEGORY } from './categoryRegistry'
import { groupContainerCount, groupItemCount } from './groupMembership'
import type { ConfirmState, WorkspaceView } from './types'

export function ConfirmDialog(props: { busy: boolean; confirm: ConfirmState; doc: WorkspaceView; onClose(): void; onConfirm(deleteBrowserSpace: boolean): void }) {
  const singularLabel = URL_CATEGORY.singularLabel
  const [deleteBrowserSpace, setDeleteBrowserSpace] = React.useState(true)
  React.useEffect(() => { setDeleteBrowserSpace(true) }, [props.confirm])
  const matchingGroupItemCount = props.confirm?.kind === 'group' ? groupItemCount(props.doc, props.confirm.id) : 0
  const matchingGroupContainerCount = props.confirm?.kind === 'group' ? groupContainerCount(props.doc, props.confirm.id) : 0
  const remainingGroups = props.confirm?.kind === 'group' ? props.doc.groups.filter(group => group.id !== props.confirm?.id) : []
  const groupObjectCount = matchingGroupItemCount + matchingGroupContainerCount
  const groupCannotBeRemoved = props.confirm?.kind === 'group' && groupObjectCount > 0 && remainingGroups.length === 0
  const containerItemCount = props.confirm?.kind === 'container' ? props.doc.items.filter(item => item.containerId === props.confirm?.id).length : 0
  const identityItem = props.confirm?.kind === 'item'
    ? props.doc.items.find(item => item.id === props.confirm?.id && Boolean(item.browserSpaceId))
    : undefined
  const message = props.confirm?.kind === 'group'
    ? groupCannotBeRemoved
      ? `分组“${props.confirm.label}”是最后一个有内容的分组。请先创建另一个分组，或清空里面的 ${matchingGroupItemCount} 个${singularLabel}和 ${matchingGroupContainerCount} 个收纳夹。`
      : remainingGroups.length
        ? `删除分组“${props.confirm.label}”？其中 ${matchingGroupItemCount} 个${singularLabel}和 ${matchingGroupContainerCount} 个收纳夹会移动到“${remainingGroups[0].name}”。`
        : `删除空分组“${props.confirm.label}”？删除后桌面上暂时没有分组。`
    : props.confirm?.kind === 'container'
      ? `删除收纳夹“${props.confirm.label}”？夹内 ${containerItemCount} 个项目会移回桌面。`
      : identityItem
        ? `删除账号身份“${props.confirm?.label || ''}”？该身份的登录数据会一并清除。`
        : `删除${singularLabel}“${props.confirm?.label || ''}”？`
  return (
    <Dialog open={Boolean(props.confirm)} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">确认删除</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {message}
            </Typography>
          </Box>
          {identityItem ? (
            <FormControlLabel
              control={<Checkbox checked={deleteBrowserSpace} onChange={event => setDeleteBrowserSpace(event.target.checked)} />}
              label="同时清除该身份的登录数据（取消勾选则保留数据，可在设置里检测并清理）"
              sx={{ alignItems: 'flex-start', '& .MuiFormControlLabel-label': { fontSize: 14, color: 'text.secondary' } }}
            />
          ) : null}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button color="error" variant="contained" onClick={() => props.onConfirm(deleteBrowserSpace)} disabled={props.busy || groupCannotBeRemoved}>确认删除</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
