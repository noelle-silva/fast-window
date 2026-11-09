import * as React from 'react'
import { Box, Checkbox, Chip, IconButton, Stack, Typography } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { SortableList, type SortableListRenderArgs } from '../components/SortableList'
import { SettingsSection } from './SettingsSurfaces'
import {
  composerToolMeta,
  type ComposerToolArea,
  type ComposerToolId,
  type ComposerToolsLayout,
} from '../../domain/composerToolsLayout'

// 输入区按钮布局：勾选决定按钮直显还是收进更多菜单，两个区域各自一行一个、可拖拽排序。
// 勾选状态直接从布局派生，不另存一份；排序落盘走同一条动作。

function ToolRow(props: {
  id: string
  area: ComposerToolArea
  disabled: boolean
  drag: SortableListRenderArgs['drag']
  onPlacementChange: (id: ComposerToolId, onToolbar: boolean) => void
}) {
  const { id, area, disabled, drag, onPlacementChange } = props
  const meta = composerToolMeta(id as ComposerToolId)
  const onToolbar = area === 'inline'

  return (
    <Box
      ref={drag.setNodeRef}
      style={drag.style}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.75,
        py: 0.25,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'var(--studio-field)',
        opacity: drag.isDragging ? 0.6 : 1,
      }}
    >
      <Checkbox
        size="small"
        checked={onToolbar}
        disabled={disabled}
        onChange={(e) => {
          if (drag.shouldSuppressClick()) return
          onPlacementChange(meta.id, e.target.checked)
        }}
        inputProps={{ 'aria-label': `${meta.name} 显示在工具条` }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
          {meta.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {meta.description}
        </Typography>
      </Box>
      <IconButton
        ref={drag.setHandleRef}
        {...drag.handleProps}
        size="small"
        aria-label={`拖动 ${meta.name} 排序`}
        disabled={disabled}
        sx={{ cursor: drag.isDragging ? 'grabbing' : 'grab', touchAction: 'pan-y' }}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

function ToolArea(props: {
  area: ComposerToolArea
  title: string
  hint: string
  emptyHint: string
  ids: string[]
  disabled: boolean
  onMove: (activeId: string, overId: string) => void
  onPlacementChange: (id: ComposerToolId, onToolbar: boolean) => void
}) {
  const { area, title, hint, emptyHint, ids, disabled, onMove, onPlacementChange } = props

  return (
    <Stack spacing={0.75} sx={{ p: 1, borderRadius: 2.5, bgcolor: 'var(--studio-paper-muted)', minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 900 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={`${ids.length} 项`} />
      </Stack>

      {ids.length ? (
        <SortableList ids={ids} onMove={onMove} disabled={disabled}>
          {({ id, drag }) => (
            <ToolRow id={id} area={area} disabled={disabled} drag={drag} onPlacementChange={onPlacementChange} />
          )}
        </SortableList>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.75, py: 0.5 }}>
          {emptyHint}
        </Typography>
      )}
    </Stack>
  )
}

export function ComposerToolsLayoutSection(props: {
  controller: any
  loading: boolean
  layout: ComposerToolsLayout
}) {
  const { controller, loading, layout } = props

  const onPlacementChange = React.useCallback(
    (id: ComposerToolId, onToolbar: boolean) => controller.actions.setComposerToolOnToolbar?.(id, onToolbar),
    [controller],
  )
  const onMove = React.useCallback(
    (activeId: string, overId: string) => controller.actions.moveComposerToolWithinArea?.(activeId, overId),
    [controller],
  )

  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Box>
          <Typography sx={{ fontWeight: 900 }}>输入区按钮布局</Typography>
          <Typography variant="caption" color="text.secondary">
            勾选的按钮直显在输入栏工具条上，未勾选的收进「更多」菜单。两边都按一行一个排列，可拖拽调整顺序。
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gap: 1.25,
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            alignItems: 'start',
          }}
        >
          <ToolArea
            area="inline"
            title="工具条"
            hint="直接显示在输入框下方"
            emptyHint="工具条上没有按钮，全部收进了更多菜单。"
            ids={layout.inline}
            disabled={loading}
            onMove={onMove}
            onPlacementChange={onPlacementChange}
          />
          <ToolArea
            area="menu"
            title="更多菜单"
            hint="点开点点点后逐行显示"
            emptyHint="更多菜单为空，工具条上不会出现更多按钮。"
            ids={layout.menu}
            disabled={loading}
            onMove={onMove}
            onPlacementChange={onPlacementChange}
          />
        </Box>
      </Stack>
    </SettingsSection>
  )
}
