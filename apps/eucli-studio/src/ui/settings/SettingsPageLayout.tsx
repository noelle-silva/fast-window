import * as React from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { moveListItemById } from '../../domain/listOrdering'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SortHandleButton, SortModeButton } from '../components/SortControls'
import { SortableItem, SortableRoot, SortableSection, resolveSortMovePosition } from '../components/SortableDnd'
import { mergeSettingsNavigationItems, type SettingsNavigationItem, type SettingsTabValue } from './settingsNavigation'

const SETTINGS_PAGE_GAP = 12
const SETTINGS_PAGE_VERTICAL_PADDING = 16
const SETTINGS_SIDEBAR_WIDTH = { xs: 132, sm: 184, md: 220 }

// 已挂载的分类面板：value 决定归属分类，content 是该分类的常驻内容。
// 面板一旦挂载便一直保留（切换分类只隐藏，不卸载），从而保住滚动位置与内部草稿。
export type SettingsPanelEntry = {
  value: SettingsTabValue
  content: React.ReactNode
}

function SettingsNavigationSidebar(props: {
  value: SettingsTabValue
  onChange: (value: SettingsTabValue) => void
  items: SettingsNavigationItem[]
  onReorder: (order: SettingsTabValue[]) => void
}) {
  const { value, onChange, items, onReorder } = props
  const [sortMode, setSortMode] = React.useState(false)
  const itemIds = React.useMemo(() => items.map((item) => item.value), [items])

  const handleMove = React.useCallback(
    (activeId: string, overId: string) => {
      const position = resolveSortMovePosition(itemIds, activeId, overId)
      if (!position) return
      onReorder(moveListItemById(itemIds, (id) => id, activeId, overId, position))
    },
    [itemIds, onReorder],
  )

  return (
    <Paper
      component="nav"
      aria-label="设置分区"
      elevation={0}
      sx={{
        width: SETTINGS_SIDEBAR_WIDTH,
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        p: 1,
        borderRadius: 3,
        color: 'var(--studio-text-primary)',
        bgcolor: 'var(--studio-field)',
        backgroundImage: 'none',
        boxShadow: 'var(--studio-shadow-strong)',
      }}
    >
      <Stack spacing={0.75} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 0.75 }}>
          <Typography variant="body2" sx={{ fontWeight: 900, whiteSpace: 'nowrap', flex: 1 }}>
            设置分区
          </Typography>
          <SortModeButton
            iconOnly
            enabled={sortMode}
            onClick={() => setSortMode((current) => !current)}
            disabled={items.length <= 1}
            idleLabel="进入拖拽排序"
            activeLabel="完成拖拽排序"
          />
        </Stack>
        <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
          <SortableRoot onMove={handleMove}>
            <SortableSection items={itemIds}>
              <Stack spacing={0.5}>
                {items.map((item) => (
                  <SortableItem key={item.value} id={item.value} disabled={!sortMode}>
                    {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                      <Box ref={setNodeRef} style={style} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, opacity: isDragging ? 0.5 : 1 }}>
                        <SortHandleButton
                          enabled={sortMode}
                          label={`拖拽排序 ${item.label}`}
                          handleRef={setHandleRef}
                          handleProps={handleProps}
                          isDragging={isDragging}
                          sx={{ ml: -0.5 }}
                        />
                        <Button
                          size="small"
                          variant={value === item.value ? 'contained' : 'text'}
                          onClick={() => onChange(item.value)}
                          sx={{ justifyContent: 'flex-start', minWidth: 0, flex: 1, px: 1, borderRadius: 1.5, whiteSpace: 'nowrap', textTransform: 'none' }}
                        >
                          {item.label}
                        </Button>
                      </Box>
                    )}
                  </SortableItem>
                ))}
              </Stack>
            </SortableSection>
          </SortableRoot>
        </Box>
      </Stack>
    </Paper>
  )
}

export function SettingsPageLayout(props: {
  topbarHeight: number
  value: SettingsTabValue
  onChange: (value: SettingsTabValue) => void
  navOrder: unknown
  onNavOrderChange: (order: SettingsTabValue[]) => void
  transparentBackground?: boolean
  panels: SettingsPanelEntry[]
}) {
  const items = React.useMemo(() => mergeSettingsNavigationItems(props.navOrder), [props.navOrder])

  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', px: 2, pt: `calc(${props.topbarHeight}px + ${SETTINGS_PAGE_VERTICAL_PADDING}px)`, pb: 2, bgcolor: props.transparentBackground ? 'transparent' : 'var(--studio-canvas)' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          gap: `${SETTINGS_PAGE_GAP}px`,
          minWidth: 0,
          height: `calc(100vh - ${props.topbarHeight}px - ${SETTINGS_PAGE_VERTICAL_PADDING * 2}px)`,
        }}
      >
        <SettingsNavigationSidebar value={props.value} onChange={props.onChange} items={items} onReorder={props.onNavOrderChange} />
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
          {props.panels.map((panel) => {
            const active = panel.value === props.value
            return (
              <Box
                key={panel.value}
                aria-hidden={active ? undefined : true}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  // 激活面板必须“继承”可见性，不能显式声明 visible：
                  // 否则当整个设置页被隐藏（visibility:hidden）时，子级显式 visible 会穿透父级重新显形，与聊天页重叠。
                  visibility: active ? 'inherit' : 'hidden',
                  pointerEvents: active ? 'auto' : 'none',
                  zIndex: active ? 1 : 0,
                }}
              >
                <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }} contentSx={{ height: '100%' }}>
                  {panel.content}
                </CustomScrollArea>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}
