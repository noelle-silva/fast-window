import * as React from 'react'
import {
  Box,
  InputAdornment,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { clampNum } from '../utils/numbers'
import { TOPBAR_H } from '../appConstants'
import { SettingsPageLayout } from './SettingsPageLayout'
import type { SettingsTabValue } from './settingsNavigation'
import { SettingsSurface } from './SettingsSurfaces'
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
  modelRequestConfig: any
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
  const { controller, loading, data, roles, groups, workspaces, providers, modelGroups, models, tools, modelRequestConfig, bootstrap, releaseView, onReleaseRefresh, accessSettings, hookPrompts, placeholders, systemPlugins, draft, activeRoleId, activeWorkspaceId, activeTargetKind, tab, onTabChange, dataDirectory, eucliBoxConnection } = props

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

  const attachSendLimitChars = clampNum(Number(data?.settings?.attachments?.sendLimitChars ?? 80000), 1000, 2000000)
  const attachMaxFileSizeMbByKind0 = (data?.settings?.attachments as any)?.maxFileSizeMbByKind
  const attachMaxFileSizeMbByKind = attachMaxFileSizeMbByKind0 && typeof attachMaxFileSizeMbByKind0 === 'object' ? attachMaxFileSizeMbByKind0 : {}
  const attachMaxFileSizeMbTxt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.txt ?? 10), 0, 2048)
  const attachMaxFileSizeMbMd = clampNum(Number((attachMaxFileSizeMbByKind as any)?.md ?? 10), 0, 2048)
  const attachMaxFileSizeMbPdf = clampNum(Number((attachMaxFileSizeMbByKind as any)?.pdf ?? 10), 0, 2048)
  const attachMaxFileSizeMbDocx = clampNum(Number((attachMaxFileSizeMbByKind as any)?.docx ?? 10), 0, 2048)
  const attachMaxFileSizeMbPpt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.ppt ?? 10), 0, 2048)

  if (tab === 'appearance') {
    return wrapSettingsPanel(
      <AppearanceSettingsPanel controller={controller} loading={loading} data={data} />,
    )
  }

  if (tab === 'attachments') {
    return wrapSettingsPanel(
        <SettingsSurface>
          <Stack spacing={1.25}>
            <Typography sx={{ fontWeight: 900 }}>附件</Typography>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  单文件长度阈值
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(attachSendLimitChars)} 字符
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={attachSendLimitChars}
                min={1000}
                max={2000000}
                step={5000}
                onChange={(_e, v) => controller.actions.setAttachmentsSendLimitChars?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setAttachmentsSendLimitChars?.(v, true)}
                disabled={loading}
              />
              <Typography variant="caption" color="text.secondary">
                当任一附件“实际发送长度”超过该阈值，点击发送会弹出确认提醒；可在输入栏的附件条目里单独调节“发送百分比”。
              </Typography>
            </Box>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  单文件大小上限
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  MB（0 表示不限制）
                </Typography>
              </Stack>

              <Stack spacing={1} sx={{ mt: 1 }}>
                <TextField
                  size="small"
                  label="TXT"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbTxt))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('txt', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('txt', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="MD"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbMd))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('md', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('md', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="PDF"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbPdf))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('pdf', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('pdf', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="DOCX"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbDocx))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('docx', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('docx', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="PPT/PPTX"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbPpt))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('ppt', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('ppt', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                超过上限会在解析前直接拒绝；0 表示不限制。
              </Typography>
            </Box>
          </Stack>
        </SettingsSurface>,
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
    return wrapSettingsPanel(<AiToolsSettingsPanel controller={controller} loading={loading} tools={tools} releaseView={releaseView} onReleaseRefresh={onReleaseRefresh} />)
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
