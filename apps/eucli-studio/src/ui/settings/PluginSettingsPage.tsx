import * as React from 'react'
import { Typography } from '@mui/material'
import { TOPBAR_H } from '../appConstants'
import { SettingsPageLayout } from './SettingsPageLayout'
import type { SettingsTabValue } from './settingsNavigation'
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
import type { ReleaseCandidatesView, StudioBootstrap } from '../../domain/release'

type SettingsTab = SettingsTabValue

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
  requestRecords?: any
  bootstrap?: StudioBootstrap
  releaseView: ReleaseCandidatesView | null
  onReleaseRefresh: (kind?: string) => Promise<void> | void
  accessSettings?: any
  hookPrompts: any
  placeholders: any
  systemPlugins: any
  draft: any
  activeRoleId: string
  activeWorkspaceId: string
  activeTargetKind: string
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  dataDirectory?: AiChatDataDirectory
  eucliBoxConnection?: AiChatEucliBoxConnection
}) {
  const { controller, loading, data, roles, groups, workspaces, providers, modelGroups, models, tools, toolWorkDirectory, modelRequestConfig, requestRecords, bootstrap, releaseView, onReleaseRefresh, accessSettings, hookPrompts, placeholders, systemPlugins, draft, activeRoleId, activeWorkspaceId, activeTargetKind, tab, onTabChange, dataDirectory, eucliBoxConnection } = props

  const settingsNavOrder = (data?.settings as any)?.settingsNavOrder
  const transparentChatBg = !!data?.settings?.transparentChatBg

  const wrapSettingsPanel = (children: React.ReactNode) => (
    <SettingsPageLayout
      topbarHeight={TOPBAR_H}
      value={tab}
      onChange={onTabChange}
      navOrder={settingsNavOrder}
      onNavOrderChange={(order) => controller.actions.setSettingsNavOrder?.(order)}
      transparentBackground={transparentChatBg}
    >
      {children}
    </SettingsPageLayout>
  )

  if (!data) {
    return wrapSettingsPanel(
        <Typography variant="body2" color="text.secondary">
          {loading ? '加载中…' : '未加载到数据'}
        </Typography>,
    )
  }

  if (tab === 'appearance') {
    return wrapSettingsPanel(
      <AppearanceSettingsPanel controller={controller} loading={loading} data={data} />,
    )
  }

  if (tab === 'session') {
    return wrapSettingsPanel(<SessionSettingsPanel controller={controller} loading={loading} modelRequestConfig={modelRequestConfig} />)
  }

  if (tab === 'data') {
    return wrapSettingsPanel(<DataSettingsPanel dataDirectory={dataDirectory} loading={loading} />)
  }

  if (tab === 'groups') {
    return wrapSettingsPanel(
      <GroupsSettingsPanel
        controller={controller}
        loading={loading}
        groups={groups}
        roles={roles}
        draft={draft}
        activeGroupId={String((draft as any)?.activeGroupId || '')}
        activeTargetKind={activeTargetKind}
      />,
    )
  }

  if (tab === 'workspaces') {
    return wrapSettingsPanel(
      <WorkspacesSettingsPanel
        controller={controller}
        loading={loading}
        workspaces={workspaces}
        draft={draft}
        activeWorkspaceId={activeWorkspaceId}
        activeTargetKind={activeTargetKind}
      />,
    )
  }

  if (tab === 'roles') {
    return wrapSettingsPanel(<RolesSettingsPanel controller={controller} loading={loading} roles={roles} providers={providers} modelGroups={Array.isArray(modelGroups?.items) ? modelGroups.items : []} models={models} tools={tools} hookPrompts={hookPrompts} placeholders={placeholders} draft={draft} activeRoleId={activeRoleId} />)
  }

  if (tab === 'modelGroups') {
    return wrapSettingsPanel(<ModelGroupsSettingsPanel controller={controller} loading={loading} modelGroups={modelGroups} providers={providers} />)
  }

  if (tab === 'tools') {
    return wrapSettingsPanel(<AiToolsSettingsPanel controller={controller} loading={loading} tools={tools} toolWorkDirectory={toolWorkDirectory} releaseView={releaseView} onReleaseRefresh={onReleaseRefresh} />)
  }

  if (tab === 'hookPrompts') {
    return wrapSettingsPanel(<HookPromptsSettingsPanel controller={controller} loading={loading} hookPrompts={hookPrompts} />)
  }

  if (tab === 'placeholders') {
    return wrapSettingsPanel(<PlaceholderSettingsPanel controller={controller} loading={loading} placeholders={placeholders} systemPlugins={systemPlugins} />)
  }

  if (tab === 'systemPlugins') {
    return wrapSettingsPanel(<SystemPluginSettingsPanel controller={controller} loading={loading} systemPlugins={systemPlugins} releaseView={releaseView} onReleaseRefresh={onReleaseRefresh} />)
  }

  if (tab === 'commandSystem') {
    return wrapSettingsPanel(null)
  }

  if (tab === 'eb') {
    return wrapSettingsPanel(<EbSettingsPanel bootstrap={bootstrap} connection={eucliBoxConnection} />)
  }

  if (tab === 'access') {
    return wrapSettingsPanel(
      <AccessSettingsPanel
        controller={controller}
        section={accessSettings}
      />,
    )
  }

  if (tab === 'requestRecords') {
    return wrapSettingsPanel(<RequestRecordsSettingsPanel controller={controller} loading={loading} requestRecords={requestRecords} />)
  }

  if (tab === 'stickers') {
    return wrapSettingsPanel(<StickersSettingsPanel controller={controller} loading={loading} data={data} />)
  }

  if (tab === 'services') {
    return wrapSettingsPanel(
      <AiServicesSettingsPanel controller={controller} loading={loading} data={data} providers={providers} modelGroups={modelGroups} />,
    )
  }

  return wrapSettingsPanel(
    <ProvidersSettingsPanel controller={controller} loading={loading} providers={providers} draft={draft} models={models} />,
  )
}
