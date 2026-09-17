import * as React from 'react'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { ScrollArea } from './shared/scroll-area'
import { SortHandleButton, SortModeButton } from './sortable/SortControls'
import { SortableItem, SortableRoot, SortableSection, moveSortableId } from './sortable/SortableDnd'
import { groupContainerCount, groupItemCount } from './groupMembership'
import type { CollectionGroup, GroupFormState, WorkspaceView } from './types'

export function GroupDialog(props: {
  busy: boolean
  doc: WorkspaceView
  editableGroups: CollectionGroup[]
  open: boolean
  form: GroupFormState
  onChange(form: GroupFormState): void
  onClose(): void
  onDelete(group: CollectionGroup): void
  onMoveGroup(groupOrder: string[]): void
  onNew(): void
  onSave(): void
}) {
  const selected = props.editableGroups.find(group => group.id === props.form.id)
  const [groupSortMode, setGroupSortMode] = React.useState(false)
  const groupIds = props.editableGroups.map(group => group.id)
  const moveGroup = (activeId: string, overId: string) => props.onMoveGroup(moveSortableId(groupIds, activeId, overId))

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.form.id ? '编辑分组' : '创建分组'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>用分组把常用网址按场景收纳。</Typography>
          </Box>
          <TextField
            label="分组名称"
            value={props.form.name}
            onChange={event => props.onChange({ ...props.form, name: event.target.value })}
            placeholder="例如：工作"
            autoFocus
            fullWidth
          />
          {props.editableGroups.length ? (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>已有分组</Typography>
                <SortModeButton enabled={groupSortMode} onClick={() => setGroupSortMode(current => !current)} disabled={props.busy || groupIds.length <= 1} />
              </Stack>
              <ScrollArea sx={{ maxHeight: 240 }} viewportSx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <SortableRoot onMove={moveGroup}>
                  <SortableSection items={groupIds}>
                    {props.editableGroups.map(group => {
                      const active = group.id === props.form.id
                      return (
                        <SortableItem key={group.id} id={group.id} disabled={!groupSortMode || props.busy}>
                          {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                            <Paper
                              ref={setNodeRef}
                              elevation={active ? 1 : 0}
                              sx={{
                                borderRadius: 2,
                                bgcolor: active ? 'primary.main' : theme => alpha(theme.palette.primary.main, 0.06),
                                color: active ? 'primary.contrastText' : 'text.primary',
                                opacity: isDragging ? 0.55 : 1,
                                overflow: 'hidden',
                              }}
                              style={style}
                            >
                              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minHeight: 42, px: 0.75 }}>
                                <SortHandleButton
                                  enabled={groupSortMode}
                                  label={`拖拽排序分组 ${group.name}`}
                                  handleRef={setHandleRef}
                                  handleProps={handleProps}
                                  isDragging={isDragging}
                                />
                                <ButtonBase
                                  onClick={() => props.onChange({ id: group.id, name: group.name })}
                                  sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 1,
                                    py: 0.75,
                                    textAlign: 'left',
                                  }}
                                >
                                  <Typography noWrap fontWeight={900}>{group.name}</Typography>
                                  <Chip size="small" label={`${groupItemCount(props.doc, group.id)} 个项目 · ${groupContainerCount(props.doc, group.id)} 个收纳夹`} />
                                </ButtonBase>
                              </Stack>
                            </Paper>
                          )}
                        </SortableItem>
                      )
                    })}
                  </SortableSection>
                </SortableRoot>
              </ScrollArea>
            </Stack>
          ) : null}
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
            {selected ? <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => props.onDelete(selected)} disabled={props.busy}>删除分组</Button> : null}
            <Box sx={{ flex: 1 }} />
            <Button onClick={props.onNew}>新建</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>保存</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
