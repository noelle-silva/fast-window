import * as React from 'react'
import { Box, Switch, Tab, Tabs, Typography } from '@mui/material'
import type { HyperCortexHtmlFaceDisplayModeV1, HyperCortexSidebarSortModeV1 } from '../core'
import type { DataDirStatus, LegacyDataImportResult } from '../gateway'
import type { HyperCortexShortcutBindingsV1 } from '../shortcuts'
import { DataDirSettingsPanel } from './DataDirSettingsPanel'
import { HtmlFaceDisplaySettingsPanel } from './HtmlFaceDisplaySettingsPanel'
import { ShortcutSettingsPanel } from './ShortcutSettingsPanel'
import { SidebarSortSettingsPanel } from './SidebarSortSettingsPanel'
import { TrashSettingsPanel } from './TrashSettingsPanel'

type SettingsCategoryId = 'data' | 'actions' | 'display'

const SETTINGS_CATEGORIES: { id: SettingsCategoryId; label: string }[] = [
  { id: 'data', label: '数据' },
  { id: 'actions', label: '操作' },
  { id: 'display', label: '显示' },
]

export type SettingsPageProps = {
  dataDirStatus: DataDirStatus | null
  onRefreshDataDirStatus: () => Promise<DataDirStatus | void> | DataDirStatus | void
  onPickDataDir: () => Promise<DataDirStatus | null>
  onImportLegacyData: () => Promise<LegacyDataImportResult | null>
  shortcutHintsEnabled: boolean
  onShortcutHintsEnabledChange: (enabled: boolean) => void
  shortcutBindings: HyperCortexShortcutBindingsV1
  onShortcutBindingsChange: (next: HyperCortexShortcutBindingsV1) => void
  onShortcutRecordingChange: (active: boolean) => void
  sidebarSortMode: HyperCortexSidebarSortModeV1
  onSidebarSortModeChange: (mode: HyperCortexSidebarSortModeV1) => void
  trashEnabled: boolean
  trashAutoDeleteDays: number
  onTrashEnabledChange: (enabled: boolean) => void
  onTrashAutoDeleteDaysChange: (days: number) => void
  onOpenTrash: () => void
  htmlFaceDisplayMode: HyperCortexHtmlFaceDisplayModeV1
  onHtmlFaceDisplayModeChange: (mode: HyperCortexHtmlFaceDisplayModeV1) => void
  htmlFaceFixedScaleDefault: number
  onHtmlFaceFixedScaleDefaultChange: (scale: number) => void
}

export function SettingsPage(props: SettingsPageProps) {
  const [category, setCategory] = React.useState<SettingsCategoryId>('data')

  const refreshDataDirStatus = React.useCallback(async () => {
    await props.onRefreshDataDirStatus()
  }, [props.onRefreshDataDirStatus])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 760 }}>
      <Tabs
        value={category}
        onChange={(_, nextCategory: SettingsCategoryId) => setCategory(nextCategory)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="HyperCortex 设置分类"
        sx={{
          minHeight: 42,
          bgcolor: 'rgba(15,23,42,.035)',
          borderRadius: 3,
          px: 0.5,
          '& .MuiTabs-indicator': { height: 0 },
          '& .MuiTab-root': { minHeight: 42, fontSize: 13, fontWeight: 800 },
          '& .MuiTab-root.Mui-selected': { bgcolor: '#fff', borderRadius: 2.5, boxShadow: '0 8px 20px rgba(15,23,42,.08)' },
        }}
      >
        {SETTINGS_CATEGORIES.map(item => (
          <Tab
            key={item.id}
            value={item.id}
            label={item.label}
            id={`hypercortex-settings-tab-${item.id}`}
            aria-controls={`hypercortex-settings-tabpanel-${item.id}`}
          />
        ))}
      </Tabs>

      <Box
        role="tabpanel"
        hidden={category !== 'data'}
        id="hypercortex-settings-tabpanel-data"
        aria-labelledby="hypercortex-settings-tab-data"
        sx={{ pt: 0.5 }}
      >
        {category === 'data' ? (
          <SettingsPanelStack>
            <DataDirSettingsPanel
              status={props.dataDirStatus}
              onRefresh={refreshDataDirStatus}
              onPick={props.onPickDataDir}
              onImportLegacy={props.onImportLegacyData}
            />
            <TrashSettingsPanel
              enabled={props.trashEnabled}
              autoDeleteDays={props.trashAutoDeleteDays}
              onEnabledChange={props.onTrashEnabledChange}
              onAutoDeleteDaysChange={props.onTrashAutoDeleteDaysChange}
              onOpenTrash={props.onOpenTrash}
            />
          </SettingsPanelStack>
        ) : null}
      </Box>

      <Box
        role="tabpanel"
        hidden={category !== 'actions'}
        id="hypercortex-settings-tabpanel-actions"
        aria-labelledby="hypercortex-settings-tab-actions"
        sx={{ pt: 0.5 }}
      >
        {category === 'actions' ? (
          <SettingsPanelStack>
            <ShortcutHintsSettingsPanel
              enabled={props.shortcutHintsEnabled}
              onEnabledChange={props.onShortcutHintsEnabledChange}
            />
            <ShortcutSettingsPanel
              bindings={props.shortcutBindings}
              onChange={props.onShortcutBindingsChange}
              onRecordingChange={props.onShortcutRecordingChange}
            />
          </SettingsPanelStack>
        ) : null}
      </Box>

      <Box
        role="tabpanel"
        hidden={category !== 'display'}
        id="hypercortex-settings-tabpanel-display"
        aria-labelledby="hypercortex-settings-tab-display"
        sx={{ pt: 0.5 }}
      >
        {category === 'display' ? (
          <SettingsPanelStack>
            <SidebarSortSettingsPanel
              mode={props.sidebarSortMode}
              onChange={props.onSidebarSortModeChange}
            />
            <HtmlFaceDisplaySettingsPanel
              mode={props.htmlFaceDisplayMode}
              onChange={props.onHtmlFaceDisplayModeChange}
              fixedScaleDefault={props.htmlFaceFixedScaleDefault}
              onFixedScaleDefaultChange={props.onHtmlFaceFixedScaleDefaultChange}
            />
          </SettingsPanelStack>
        ) : null}
      </Box>
    </Box>
  )
}

function SettingsPanelStack(props: { children: React.ReactNode }) {
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{props.children}</Box>
}

function ShortcutHintsSettingsPanel(props: { enabled: boolean; onEnabledChange: (enabled: boolean) => void }) {
  const { enabled, onEnabledChange } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>快捷键提示</Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
        启用后，顶部栏会出现一个问号按钮，点击即可查看当前已设置的快捷键。
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(0,0,0,.02)' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#111' }}>显示顶部栏问号</Typography>
        <Switch checked={enabled} onChange={(_, checked) => onEnabledChange(checked)} />
      </Box>
    </Box>
  )
}
