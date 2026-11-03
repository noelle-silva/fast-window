import * as React from 'react'
import { Typography } from '@mui/material'
import { TOPBAR_H } from '../appConstants'
import { SETTINGS_PAGE_CHROME_REFRESH_SCOPES } from '../../domain/settingsRefreshScopes'
import { useScopedUiVersions } from '../hooks/useScopedUiVersion'
import { SettingsPageLayout, type SettingsPanelEntry } from './SettingsPageLayout'
import { SettingsPanelHost } from './SettingsPanelHost'
import { readSettingsPanelState, type SettingsPanelState } from './settingsPanelState'
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
import { isTransparentChatBg } from '../../domain/wallpaper'
import type { ReleaseCandidatesViews, StudioBootstrap } from '../../domain/release'

// tab 为 'auto' 时表示尚未由用户点选，按导航排序解析出当前分类；其余情况为用户显式指定。
export type SettingsTabSelection = SettingsTabValue | 'auto'

type PluginSettingsPageProps = {
  controller: any
  bootstrap?: StudioBootstrap
  releaseViews: ReleaseCandidatesViews
  onReleaseRefresh: (kind?: string) => Promise<void> | void
  tab: SettingsTabSelection
  onTabChange: (tab: SettingsTabValue) => void
  dataDirectory?: AiChatDataDirectory
  eucliBoxConnection?: AiChatEucliBoxConnection
}

export function PluginSettingsPage(props: PluginSettingsPageProps) {
  const { controller, bootstrap, releaseViews, onReleaseRefresh, tab, onTabChange, dataDirectory, eucliBoxConnection } = props

  // 壳层只订阅导航排序与透明背景这类全局设置；实体数据由各面板宿主自行订阅。
  useScopedUiVersions(controller, SETTINGS_PAGE_CHROME_REFRESH_SCOPES)
  const chrome = readSettingsPanelState(controller)

  const settingsNavOrder = (chrome.data?.settings as any)?.settingsNavOrder
  const transparentChatBg = isTransparentChatBg(chrome.data?.settings)

  const navItems = React.useMemo(() => mergeSettingsNavigationItems(settingsNavOrder), [settingsNavOrder])
  const activeTab = React.useMemo(() => resolveSettingsTab(tab, navItems), [tab, navItems])

  // 全量在场：设置页打开时所有分类面板一次挂载、常驻保留（切换只隐藏不卸载），滚动位置与内部草稿不丢。
  // 每个面板包一层 SettingsPanelHost：只有该分类声明的地址变化时，对应面板才会重渲染。
  const renderPanel = (value: SettingsTabValue, state: SettingsPanelState): React.ReactNode => {
    if (!state.data) {
      return (
        <Typography variant="body2" color="text.secondary">
          {state.loading ? '加载中…' : '未加载到数据'}
        </Typography>
      )
    }

    if (value === 'appearance') return <AppearanceSettingsPanel controller={controller} loading={state.loading} data={state.data} draft={state.draft} />
    if (value === 'session') return <SessionSettingsPanel controller={controller} loading={state.loading} modelRequestConfig={state.modelRequestConfig} conversationImageConfig={state.conversationImageConfig} />
    if (value === 'data') return <DataSettingsPanel dataDirectory={dataDirectory} loading={state.loading} />
    if (value === 'groups') return (
      <GroupsSettingsPanel
        controller={controller}
        loading={state.loading}
        groups={state.groups}
        roles={state.roles}
        draft={state.draft}
        activeGroupId={state.activeGroupId}
        activeTargetKind={state.activeTargetKind}
      />
    )
    if (value === 'workspaces') return (
      <WorkspacesSettingsPanel
        controller={controller}
        loading={state.loading}
        workspaces={state.workspaces}
        roles={state.roles}
        draft={state.draft}
        activeWorkspaceId={state.activeWorkspaceId}
        activeTargetKind={state.activeTargetKind}
      />
    )
    if (value === 'roles') return <RolesSettingsPanel controller={controller} loading={state.loading} roles={state.roles} providers={state.providers} modelGroups={state.modelGroupItems} models={state.models} tools={state.tools} hookPrompts={state.hookPrompts} placeholders={state.placeholders} draft={state.draft} activeRoleId={state.activeRoleId} />
    if (value === 'modelGroups') return <ModelGroupsSettingsPanel controller={controller} loading={state.loading} modelGroups={state.modelGroups} providers={state.providers} />
    if (value === 'tools') return <AiToolsSettingsPanel controller={controller} loading={state.loading} tools={state.tools} toolWorkDirectory={state.toolWorkDirectory} releaseView={releaseViews.tool} onReleaseRefresh={onReleaseRefresh} />
    if (value === 'hookPrompts') return <HookPromptsSettingsPanel controller={controller} loading={state.loading} hookPrompts={state.hookPrompts} />
    if (value === 'placeholders') return <PlaceholderSettingsPanel controller={controller} loading={state.loading} placeholders={state.placeholders} systemPlugins={state.systemPlugins} />
    if (value === 'systemPlugins') return <SystemPluginSettingsPanel controller={controller} loading={state.loading} systemPlugins={state.systemPlugins} releaseView={releaseViews.plugin} onReleaseRefresh={onReleaseRefresh} />
    if (value === 'commandSystem') return null
    if (value === 'eb') return <EbSettingsPanel bootstrap={bootstrap} connection={eucliBoxConnection} />
    if (value === 'access') return <AccessSettingsPanel controller={controller} section={state.accessSettings} />
    if (value === 'requestRecords') return <RequestRecordsSettingsPanel controller={controller} active={activeTab === 'requestRecords'} loading={state.loading} requestRecords={state.requestRecords} requestRecordViewOptions={state.requestRecordViewOptions} />
    if (value === 'stickers') return <StickersSettingsPanel controller={controller} loading={state.loading} data={state.data} />
    if (value === 'services') return <AiServicesSettingsPanel controller={controller} loading={state.loading} data={state.data} providers={state.providers} modelGroups={state.modelGroups} />
    return <ProvidersSettingsPanel controller={controller} loading={state.loading} providers={state.providers} draft={state.draft} models={state.models} />
  }

  const panels: SettingsPanelEntry[] = navItems.map((item) => ({
    value: item.value,
    content: (
      <SettingsPanelHost
        controller={controller}
        tab={item.value}
        render={(state) => renderPanel(item.value, state)}
      />
    ),
  }))

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
