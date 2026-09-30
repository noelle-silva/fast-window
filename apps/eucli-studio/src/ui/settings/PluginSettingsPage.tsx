import * as React from 'react'
import { Typography } from '@mui/material'
import { TOPBAR_H } from '../appConstants'
import { SettingsPageLayout, type SettingsPanelEntry } from './SettingsPageLayout'
import { mergeSettingsNavigationItems, resolveSettingsTab, type SettingsTabValue } from './settingsNavigation'
import { AiServicesSettingsPanel } from './AiServicesSettingsPanel'
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'
import { DataSettingsPanel, type AiChatDataDirectory } from './DataSettingsPanel'
import { SessionSettingsPanel } from './SessionSettingsPanel'
import { StickersSettingsPanel } from './StickersSettingsPanel'
import { WorkspacesSettingsPanel } from './WorkspacesSettingsPanel'
import { RolesSettingsPanel } from './RolesSettingsPanel'
import { GroupsSettingsPanel } from './GroupsSettingsPanel'
import { ModelGroupsSettingsPanel } from './ModelGroupsSettingsPanel'
import { AiToolsSettingsPanel } from './AiToolsSettingsPanel'
import { HookPromptsSettingsPanel } from './HookPromptsSettingsPanel'
import { PlaceholderSettingsPanel } from './PlaceholderSettingsPanel'
import { SystemPluginSettingsPanel } from './SystemPluginSettingsPanel'
import { EbSettingsPanel, type AiChatEucliBoxConnection } from './EbSettingsPanel'
import { AccessSettingsPanel } from './AccessSettingsPanel'
import { ProvidersSettingsPanel } from './ProvidersSettingsPanel'
import { RequestRecordsSettingsPanel } from './RequestRecordsSettingsPanel'
import { normalizeRequestRecordViewOptions } from '../../domain/requestRecordViewOptions'
import type { ReleaseCandidatesViews, StudioBootstrap } from '../../domain/release'

// tab 为 'auto' 时表示尚未由用户点选，按导航排序解析出当前分类；其余情况为用户显式指定。
export type SettingsTabSelection = SettingsTabValue | 'auto'

export function PluginSettingsPage(props: {
  controller: any
  loading: boolean
  data: any
  roles: any[]
  groups: any[]
  workspaces: any[]
  providers: any[]
  modelGroups: any
  models: any
  tools: any
  toolWorkDirectory?: any
  modelRequestConfig: any
  conversationImageConfig?: any
  requestRecords?: any
  bootstrap?: StudioBootstrap
  releaseViews: ReleaseCandidatesViews
  onReleaseRefresh: (kind?: string) => Promise<void> | void
  accessSettings?: any
  hookPrompts: any
  placeholders: any
  systemPlugins: any
  draft: any
  activeRoleId: string
  activeWorkspaceId: string
  activeTargetKind: string
  tab: SettingsTabSelection
  onTabChange: (tab: SettingsTabValue) => void
  dataDirectory?: AiChatDataDirectory
  eucliBoxConnection?: AiChatEucliBoxConnection
}) {
  const { controller, loading, data, roles, groups, workspaces, providers, modelGroups, models, tools, toolWorkDirectory, modelRequestConfig, conversationImageConfig, requestRecords, bootstrap, releaseViews, onReleaseRefresh, accessSettings, hookPrompts, placeholders, systemPlugins, draft, activeRoleId, activeWorkspaceId, activeTargetKind, tab, onTabChange, dataDirectory, eucliBoxConnection } = props

  const settingsNavOrder = (data?.settings as any)?.settingsNavOrder
  const transparentChatBg = !!data?.settings?.transparentChatBg
  const requestRecordViewOptions = normalizeRequestRecordViewOptions((data?.settings as any)?.requestRecordViewOptions)

  const navItems = React.useMemo(() => mergeSettingsNavigationItems(settingsNavOrder), [settingsNavOrder])
  const activeTab = React.useMemo(() => resolveSettingsTab(tab, navItems), [tab, navItems])

  // 懒挂载 + 常驻：第一次访问某分类才挂载它，之后一直保留（切换只隐藏），滚动位置与内部草稿不丢。
  const [mountedTabs, setMountedTabs] = React.useState<SettingsTabValue[]>(() => [activeTab])
  React.useEffect(() => {
    setMountedTabs((current) => (current.includes(activeTab) ? current : current.concat(activeTab)))
  }, [activeTab])

  const renderPanel = (value: SettingsTabValue): React.ReactNode => {
    if (!data) {
      return (
        <Typography variant="body2" color="text.secondary">
          {loading ? '加载中…' : '未加载到数据'}
        </Typography>
      )
    }

    if (value === 'appearance') return <AppearanceSettingsPanel controller={controller} loading={loading} data={data} />
    if (value === 'session') return <SessionSettingsPanel controller={controller} loading={loading} modelRequestConfig={modelRequestConfig} conversationImageConfig={conversationImageConfig} />
    if (value === 'data') return <DataSettingsPanel dataDirectory={dataDirectory} loading={loading} />
    if (value === 'groups') return (
      <GroupsSettingsPanel
        controller={controller}
        loading={loading}
        groups={groups}
        roles={roles}
        draft={draft}
        activeGroupId={String((draft as any)?.activeGroupId || '')}
        activeTargetKind={activeTargetKind}
      />
    )
    if (value === 'workspaces') return (
      <WorkspacesSettingsPanel
        controller={controller}
        loading={loading}
        workspaces={workspaces}
        draft={draft}
        activeWorkspaceId={activeWorkspaceId}
        activeTargetKind={activeTargetKind}
      />
    )
    if (value === 'roles') return <RolesSettingsPanel controller={controller} loading={loading} roles={roles} providers={providers} modelGroups={Array.isArray(modelGroups?.items) ? modelGroups.items : []} models={models} tools={tools} hookPrompts={hookPrompts} placeholders={placeholders} draft={draft} activeRoleId={activeRoleId} />
    if (value === 'modelGroups') return <ModelGroupsSettingsPanel controller={controller} loading={loading} modelGroups={modelGroups} providers={providers} />
    if (value === 'tools') return <AiToolsSettingsPanel controller={controller} loading={loading} tools={tools} toolWorkDirectory={toolWorkDirectory} releaseView={releaseViews.tool} onReleaseRefresh={onReleaseRefresh} />
    if (value === 'hookPrompts') return <HookPromptsSettingsPanel controller={controller} loading={loading} hookPrompts={hookPrompts} />
    if (value === 'placeholders') return <PlaceholderSettingsPanel controller={controller} loading={loading} placeholders={placeholders} systemPlugins={systemPlugins} />
    if (value === 'systemPlugins') return <SystemPluginSettingsPanel controller={controller} loading={loading} systemPlugins={systemPlugins} releaseView={releaseViews.plugin} onReleaseRefresh={onReleaseRefresh} />
    if (value === 'commandSystem') return null
    if (value === 'eb') return <EbSettingsPanel bootstrap={bootstrap} connection={eucliBoxConnection} />
    if (value === 'access') return <AccessSettingsPanel controller={controller} section={accessSettings} />
    if (value === 'requestRecords') return <RequestRecordsSettingsPanel controller={controller} loading={loading} requestRecords={requestRecords} requestRecordViewOptions={requestRecordViewOptions} />
    if (value === 'stickers') return <StickersSettingsPanel controller={controller} loading={loading} data={data} />
    if (value === 'services') return <AiServicesSettingsPanel controller={controller} loading={loading} data={data} providers={providers} modelGroups={modelGroups} />
    return <ProvidersSettingsPanel controller={controller} loading={loading} providers={providers} draft={draft} models={models} />
  }

  const panels: SettingsPanelEntry[] = mountedTabs.map((value) => ({ value, content: renderPanel(value) }))

  return (
    <SettingsPageLayout
      topbarHeight={TOPBAR_H}
      value={activeTab}
      onChange={onTabChange}
      navOrder={settingsNavOrder}
      onNavOrderChange={(order) => controller.actions.setSettingsNavOrder?.(order)}
      transparentBackground={transparentChatBg}
      panels={panels}
    />
  )
}
