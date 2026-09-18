import * as React from 'react'
import {
  Avatar,
  Box,
  Button,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { hotkeyFromKeyEvent, normalizeHotkeyString } from '../utils/hotkeys'
import { clampNum } from '../utils/numbers'
import { TOPBAR_H } from '../appConstants'
import { SettingsPageLayout, type SettingsTabValue } from './SettingsPageLayout'
import { SettingsListItem, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { ColorThemeSettingsSection } from './ColorThemeSettingsSection'
import { DataSettingsPanel, type AiChatDataDirectory } from './DataSettingsPanel'
import { StickersSettingsPanel } from './StickersSettingsPanel'
import { WorkspacesSettingsPanel } from './WorkspacesSettingsPanel'
import { RolesSettingsPanel } from './RolesSettingsPanel'
import { ModelGroupsSettingsPanel } from './ModelGroupsSettingsPanel'
import { AiToolsSettingsPanel } from './AiToolsSettingsPanel'
import { HookPromptsSettingsPanel } from './HookPromptsSettingsPanel'
import { PlaceholderSettingsPanel } from './PlaceholderSettingsPanel'
import { SystemPluginSettingsPanel } from './SystemPluginSettingsPanel'
import { EbSettingsPanel } from './EbSettingsPanel'
import { AccessSettingsPanel } from './AccessSettingsPanel'
import { ProviderConfigEditor } from '../components/ProviderConfigEditor'
import { aiServiceModelSelection, aiServiceSourceSelectItems, aiServiceSourceValue, providerProtocolLabel } from './modelItemSelectors'
import {
  DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
} from '../../domain/constants'
import type { AiChatToastOptions } from '../../gateway/capabilities'
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
  releaseBusy: boolean
  releaseView: ReleaseCandidatesView | null
  onReleaseRead: (kind?: string) => Promise<void> | void
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
}) {
  const { controller, loading, data, roles, groups, workspaces, providers, modelGroups, models, tools, modelRequestConfig, bootstrap, releaseBusy, releaseView, onReleaseRead, onReleaseRefresh, accessSettings, hookPrompts, placeholders, systemPlugins, draft, activeRoleId, activeWorkspaceId, activeTargetKind, tab, onTabChange, dataDirectory } = props
  const [treeHotkeyRecording, setTreeHotkeyRecording] = React.useState(false)

  React.useEffect(() => {
    if (!treeHotkeyRecording) return
    const toast = (s: string, options?: AiChatToastOptions) => controller?.capabilities?.ui?.showToast?.(s, options)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return

      const key = String(e.key || '')
      if (key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setTreeHotkeyRecording(false)
        toast('已取消录制', { kind: 'success' })
        return
      }

      const hk = hotkeyFromKeyEvent(e)
      if (!hk) return

      const hasMainMod = !!(e.ctrlKey || e.altKey || e.metaKey)
      if (!hasMainMod) {
        e.preventDefault()
        e.stopPropagation()
        toast('请使用 Ctrl / Alt / Meta + 任意键', { kind: 'error' })
        return
      }

      e.preventDefault()
      e.stopPropagation()
      setTreeHotkeyRecording(false)
      controller.actions.setBranchTreeModalHotkey?.(hk)
      toast(`快捷键已设置：${hk}`, { kind: 'success' })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [treeHotkeyRecording, controller])

  const wrapSettingsPanel = (children: React.ReactNode) => (
    <SettingsPageLayout topbarHeight={TOPBAR_H} value={tab} onChange={onTabChange}>
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

  const transparentChatBg = !!data?.settings?.transparentChatBg
  const chatBgOpacity = clampNum(Number(data?.settings?.chatBgOpacity ?? 0), 0, 100)
  const chatBgBlur = clampNum(Number(data?.settings?.chatBgBlur ?? 0), 0, 24)
  const topbarOpacity = clampNum(Number(data?.settings?.topbarOpacity ?? 100), 0, 100)
  const topbarBlur = clampNum(Number(data?.settings?.topbarBlur ?? 0), 0, 24)
  const composerOpacity = clampNum(Number(data?.settings?.composerOpacity ?? 86), 40, 100)
  const composerBlur = clampNum(Number(data?.settings?.composerBlur ?? 10), 0, 24)
  const renderSafetyPolicy = (() => {
    const v = String((data?.settings as any)?.renderSafetyPolicy || 'original').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  })()
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)
  const attachSendLimitChars = clampNum(Number(data?.settings?.attachments?.sendLimitChars ?? 80000), 1000, 2000000)
  const attachMaxFileSizeMbByKind0 = (data?.settings?.attachments as any)?.maxFileSizeMbByKind
  const attachMaxFileSizeMbByKind = attachMaxFileSizeMbByKind0 && typeof attachMaxFileSizeMbByKind0 === 'object' ? attachMaxFileSizeMbByKind0 : {}
  const attachMaxFileSizeMbTxt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.txt ?? 10), 0, 2048)
  const attachMaxFileSizeMbMd = clampNum(Number((attachMaxFileSizeMbByKind as any)?.md ?? 10), 0, 2048)
  const attachMaxFileSizeMbPdf = clampNum(Number((attachMaxFileSizeMbByKind as any)?.pdf ?? 10), 0, 2048)
  const attachMaxFileSizeMbDocx = clampNum(Number((attachMaxFileSizeMbByKind as any)?.docx ?? 10), 0, 2048)
  const attachMaxFileSizeMbPpt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.ppt ?? 10), 0, 2048)
  const branchTreeView = (() => {
    const raw = String(((data?.settings as any)?.branchTree?.view ?? '') as any).trim()
    return raw === 'right' || raw === 'float' ? raw : 'right'
  })()
  const branchTreeFollowSelected = (() => {
    const raw = (data?.settings as any)?.branchTree?.followSelected
    return typeof raw === 'boolean' ? raw : true
  })()
  const branchTreeModalHotkey = (() => {
    const raw = String(((data?.settings as any)?.branchTree?.modalHotkey ?? '') as any).trim()
    return normalizeHotkeyString(raw)
  })()

  const appearancePanel = (
    <SettingsSurface>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>外观</Typography>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={1}>
            <Switch size="small" checked={transparentChatBg} onChange={() => controller.actions.toggleTransparentChatBg?.()} />
            <Typography variant="body2" color="text.secondary">
              聊天背景透明
            </Typography>
          </Stack>
        </Stack>

        <ColorThemeSettingsSection controller={controller} loading={loading} settings={data.settings} />

        <Typography variant="body2" sx={{ fontWeight: 900 }} color="text.secondary">
          组件调节
        </Typography>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              聊天背景透明度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(chatBgOpacity)}%
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={chatBgOpacity}
            min={0}
            max={100}
            step={1}
            onChange={(_e, v) => controller.actions.setChatBgOpacity?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setChatBgOpacity?.(v, true)}
            disabled={loading || !transparentChatBg}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              聊天背景磨砂度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(chatBgBlur)}px
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={chatBgBlur}
            min={0}
            max={24}
            step={1}
            onChange={(_e, v) => controller.actions.setChatBgBlur?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setChatBgBlur?.(v, true)}
            disabled={loading || !transparentChatBg}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              顶部栏透明度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(topbarOpacity)}%
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={topbarOpacity}
            min={0}
            max={100}
            step={1}
            onChange={(_e, v) => controller.actions.setTopbarOpacity?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setTopbarOpacity?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              顶部栏磨砂度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(topbarBlur)}px
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={topbarBlur}
            min={0}
            max={24}
            step={1}
            onChange={(_e, v) => controller.actions.setTopbarBlur?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setTopbarBlur?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              输入栏透明度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(composerOpacity)}%
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={composerOpacity}
            min={40}
            max={100}
            step={1}
            onChange={(_e, v) => controller.actions.setComposerOpacity?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setComposerOpacity?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              输入栏磨砂度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(composerBlur)}px
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={composerBlur}
            min={0}
            max={24}
            step={1}
            onChange={(_e, v) => controller.actions.setComposerBlur?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setComposerBlur?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>用户消息折叠</Typography>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={1}>
            <Switch size="small" checked={userMessageCollapseEnabled} onChange={() => controller.actions.toggleUserMessageCollapse?.()} />
            <Typography variant="body2" color="text.secondary">
              启用
            </Typography>
          </Stack>
        </Stack>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              折叠行数
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(userMessageCollapseLines)} 行
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={userMessageCollapseLines}
            min={1}
            max={50}
            step={1}
            onChange={(_e, v) => controller.actions.setUserMessageCollapseLines?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setUserMessageCollapseLines?.(v, true)}
            disabled={loading || !userMessageCollapseEnabled}
          />
          <Typography variant="caption" color="text.secondary">
            用户消息超过该行数时默认折叠，可在消息中展开/收起。
          </Typography>
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              分支树面板
            </Typography>
            <Box sx={{ flex: 1 }} />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="fw-branch-tree-view">显示方式</InputLabel>
              <Select
                labelId="fw-branch-tree-view"
                label="显示方式"
                value={branchTreeView}
                onChange={(e) => controller.actions.setBranchTreeView?.(String(e.target.value || ''))}
                disabled={loading}
              >
                <MenuItem value="right">右侧面板</MenuItem>
                <MenuItem value="float">悬浮模态窗</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Switch
              size="small"
              checked={!!branchTreeFollowSelected}
              onChange={(e) => controller.actions.setBranchTreeFollowSelected?.(!!e.target.checked)}
              disabled={loading}
            />
            <Typography variant="body2" color="text.secondary">
              选中节点自动居中
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="快捷键（打开模态窗）"
              value={branchTreeModalHotkey || ''}
              placeholder="未设置"
              disabled={loading}
              sx={{ flex: 1, minWidth: 0 }}
              InputProps={{ readOnly: true }}
            />
            <Button
              size="small"
              variant={treeHotkeyRecording ? 'contained' : 'text'}
              color={treeHotkeyRecording ? 'success' : 'inherit'}
              onClick={() => setTreeHotkeyRecording((v) => !v)}
              disabled={loading}
            >
              {treeHotkeyRecording ? '录制中…' : '录制'}
            </Button>
            <Button
              size="small"
              variant="text"
              color="inherit"
              onClick={() => controller.actions.setBranchTreeModalHotkey?.('')}
              disabled={loading || !branchTreeModalHotkey}
            >
              清除
            </Button>
          </Stack>
          {treeHotkeyRecording ? (
            <Typography variant="caption" color="text.secondary">
              按下组合键完成录制（建议 Ctrl/Alt/Meta + 任意键），按 Esc 取消。
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            “右侧面板”会挤压聊天内容；“悬浮模态窗”会覆盖在当前界面上方。
          </Typography>
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              回复渲染安全
            </Typography>
          </Stack>
          <FormControl size="small" fullWidth>
            <InputLabel id="render-safety-policy">策略</InputLabel>
            <Select
              labelId="render-safety-policy"
              label="策略"
              value={renderSafetyPolicy}
              onChange={(e) => controller.actions.requestSetRenderSafetyPolicy?.(String(e.target.value || 'original'))}
              disabled={loading}
            >
              <MenuItem value="original">默认模式</MenuItem>
              <MenuItem value="baseline">保留底线</MenuItem>
              <MenuItem value="unsafe">完全裸奔（极高风险）</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            影响 AI 回复中的 HTML、SVG、Mermaid 等富渲染限制。
          </Typography>
          <Typography variant="caption" color={renderSafetyPolicy === 'unsafe' ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
            {renderSafetyPolicy === 'unsafe'
              ? '当前是完全裸奔模式：不会再额外加这层 HTML / SVG / Mermaid 安全限制。'
              : renderSafetyPolicy === 'baseline'
                ? '当前是保留底线模式：会放宽表现，但仍保留脚本、事件属性、javascript: 链接等最小限制。'
                : '当前是默认模式：回到添加这次策略分级前的原始渲染行为。'}
          </Typography>
        </Box>
      </Stack>
    </SettingsSurface>
  )

  if (tab === 'appearance') {
    return wrapSettingsPanel(appearancePanel)
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

  if (tab === 'data') {
    return wrapSettingsPanel(<DataSettingsPanel dataDirectory={dataDirectory} loading={loading} />)
  }

  if (tab === 'groups') {
    const activeGroupId = String((draft as any)?.activeGroupId || '')
    return wrapSettingsPanel(
        <SettingsSurface>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 900 }}>群组管理</Typography>
            <Box sx={{ flex: 1 }} />
            <Button startIcon={<AddIcon />} onClick={() => controller.actions.createGroup?.()} disabled={loading}>
              新建群组
            </Button>
          </Stack>
          <Stack spacing={1.25}>
            {groups.length ? (
              groups.map((g: any) => {
                const gid = String(g?.id || '')
                const isActive = gid && gid === activeGroupId
                const memberCount = Array.isArray(g?.memberRoleIds) ? g.memberRoleIds.length : 0
                return (
                  <SettingsListItem
                    key={gid}
                    tone={isActive ? 'selected' : 'default'}
                    sx={{
                      bgcolor: isActive ? 'rgba(25,118,210,.08)' : undefined,
                    }}
                  >
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                        <Avatar src={String(g?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                          {String(g?.avatar || '👥')}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 900 }} noWrap>
                            {String(g?.name || '')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {memberCount ? `${memberCount} 个成员` : '未选择成员'}
                          </Typography>
                        </Box>
                      </Stack>

                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          variant={isActive ? 'contained' : 'text'}
                          onClick={() => controller.actions.setActiveGroup?.(gid)}
                          disabled={!gid}
                        >
                          {isActive ? '当前' : '进入群聊'}
                        </Button>
                        <Button size="small" onClick={() => controller.actions.openGroupEditor?.(gid)} disabled={!gid}>
                          编辑
                        </Button>
                        <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteGroup?.(gid)} disabled={!gid}>
                          删除
                        </Button>
                      </Stack>
                    </Stack>
                  </SettingsListItem>
                )
              })
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无群组
              </Typography>
            )}
          </Stack>
        </SettingsSurface>,
    )
  }

  if (tab === 'workspaces') {
    return wrapSettingsPanel(
      <WorkspacesSettingsPanel
        controller={controller}
        loading={loading}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeTargetKind={activeTargetKind}
      />,
    )
  }

  if (tab === 'roles') {
    return wrapSettingsPanel(<RolesSettingsPanel controller={controller} loading={loading} roles={roles} providers={providers} modelGroups={Array.isArray(modelGroups?.items) ? modelGroups.items : []} activeRoleId={activeRoleId} />)
  }

  if (tab === 'modelGroups') {
    return wrapSettingsPanel(<ModelGroupsSettingsPanel controller={controller} loading={loading} modelGroups={modelGroups} providers={providers} />)
  }

  if (tab === 'tools') {
    return wrapSettingsPanel(<AiToolsSettingsPanel controller={controller} loading={loading} tools={tools} releaseView={releaseView} releaseBusy={releaseBusy} onReleaseRead={onReleaseRead} onReleaseRefresh={onReleaseRefresh} />)
  }

  if (tab === 'hookPrompts') {
    return wrapSettingsPanel(<HookPromptsSettingsPanel controller={controller} loading={loading} hookPrompts={hookPrompts} />)
  }

  if (tab === 'placeholders') {
    return wrapSettingsPanel(<PlaceholderSettingsPanel controller={controller} loading={loading} placeholders={placeholders} systemPlugins={systemPlugins} />)
  }

  if (tab === 'systemPlugins') {
    return wrapSettingsPanel(<SystemPluginSettingsPanel controller={controller} loading={loading} systemPlugins={systemPlugins} releaseView={releaseView} releaseBusy={releaseBusy} onReleaseRead={onReleaseRead} onReleaseRefresh={onReleaseRefresh} />)
  }

  if (tab === 'eb') {
    return wrapSettingsPanel(<EbSettingsPanel controller={controller} loading={loading} modelRequestConfig={modelRequestConfig} bootstrap={bootstrap} releaseBusy={releaseBusy} onReleaseRefresh={onReleaseRefresh} />)
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
    const modelGroupList = Array.isArray(modelGroups?.items) ? modelGroups.items : []
    const ccCfg = (data?.settings?.aiServices?.contextCompression && typeof (data.settings.aiServices as any).contextCompression === 'object') ? (data.settings.aiServices as any).contextCompression : {}
    const ccSelection = aiServiceModelSelection(ccCfg, providers, modelGroupList)
    const ccRetainRecentMessages = Math.round(
      clampNum(
        Number(ccCfg.retainRecentMessages ?? DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES),
        CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
        CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
      ),
    )

    const mmCfg = (data?.settings?.aiServices?.mermaidFix && typeof data.settings.aiServices.mermaidFix === 'object') ? data.settings.aiServices.mermaidFix : {}
    const mmEnabled = !!mmCfg.enabled
    const mmSelection = aiServiceModelSelection(mmCfg, providers, modelGroupList)
    const mmSystemPrompt = typeof mmCfg.systemPrompt === 'string' ? mmCfg.systemPrompt : ''
    const mmDefaultPrompt = String(controller?.defaults?.mermaidFixSystemPrompt || '')
    const mmPromptChanged = !!mmDefaultPrompt && mmSystemPrompt.trim() !== mmDefaultPrompt.trim()

    const ctnCfg = (data?.settings?.aiServices?.chatTitleNaming && typeof (data.settings.aiServices as any).chatTitleNaming === 'object') ? (data.settings.aiServices as any).chatTitleNaming : {}
    const ctnEnabled = !!ctnCfg.enabled
    const ctnSelection = aiServiceModelSelection(ctnCfg, providers, modelGroupList)
    const ctnSystemPrompt = typeof ctnCfg.systemPrompt === 'string' ? ctnCfg.systemPrompt : ''
    const ctnDefaultPrompt = String(controller?.defaults?.chatTitleNamingSystemPrompt || '')
    const ctnPromptChanged = !!ctnDefaultPrompt && ctnSystemPrompt.trim() !== ctnDefaultPrompt.trim()

    const snCfg = (data?.settings?.aiServices?.stickerNaming && typeof (data.settings.aiServices as any).stickerNaming === 'object') ? (data.settings.aiServices as any).stickerNaming : {}
    const snEnabled = !!snCfg.enabled
    const snSelection = aiServiceModelSelection(snCfg, providers, modelGroupList)
    const snSystemPrompt = typeof snCfg.systemPrompt === 'string' ? snCfg.systemPrompt : ''
    const snDefaultPrompt = String(controller?.defaults?.stickerNamingSystemPrompt || '')
    const snPromptChanged = !!snDefaultPrompt && snSystemPrompt.trim() !== snDefaultPrompt.trim()

    const sourceSelectDisabled = loading || (!providers.length && !modelGroupList.length)

    return wrapSettingsPanel(
        <SettingsSurface>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 900 }}>AI 微服务</Typography>
              <Box sx={{ flex: 1 }} />
            </Stack>
            <Stack spacing={1.25}>
              <SettingsSection>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>上下文压缩</Typography>
                  <Box sx={{ flex: 1 }} />
                  <SettingsPill>/compact</SettingsPill>
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  手动输入 /compact 时，用这里选择的模型把较早聊天整理成摘要；原始消息仍保留，只影响后续发给模型的上下文。
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="context-compression-source">模型来源</InputLabel>
                    <Select
                      labelId="context-compression-source"
                      value={aiServiceSourceValue(ccSelection.sourceKind, ccSelection.sourceId)}
                      label="模型来源"
                      onChange={(e) => controller.actions.setContextCompressionModelSource?.(e.target.value)}
                      disabled={sourceSelectDisabled}
                    >
                      {aiServiceSourceSelectItems(providers, modelGroupList)}
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel id="context-compression-model">登记模型</InputLabel>
                    <Select
                      labelId="context-compression-model"
                      value={ccSelection.hasPickInList ? ccSelection.modelPick : ''}
                      label="登记模型"
                      onChange={(e) => controller.actions.setContextCompressionModelId?.(e.target.value)}
                      disabled={loading || !ccSelection.sourceId}
                    >
                      <MenuItem value="">
                        <em>请选择…</em>
                      </MenuItem>
                      {ccSelection.modelItems.map((item: any) => (
                        <MenuItem key={item.id} value={item.id}>
                          {item.hint ? `${item.label} / ${item.hint}` : item.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>
                        压缩后保留最近原文
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {Math.round(ccRetainRecentMessages)} 条
                      </Typography>
                    </Stack>
                    <Slider
                      size="small"
                      value={ccRetainRecentMessages}
                      min={CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN}
                      max={CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX}
                      step={1}
                      onChange={(_e, v) => controller.actions.setContextCompressionRetainRecentMessages?.(Array.isArray(v) ? v[0] : v)}
                      disabled={loading}
                    />
                  </Box>

                  <TextField
                    size="small"
                    type="number"
                    label="保留条数"
                    value={Math.round(ccRetainRecentMessages)}
                    onChange={(e) => controller.actions.setContextCompressionRetainRecentMessages?.(e.target.value)}
                    inputProps={{
                      min: CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
                      max: CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
                      step: 1,
                    }}
                    disabled={loading}
                    sx={{ width: { xs: '100%', sm: 150 } }}
                  />
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  可选择供应商设置中已登记的模型，也可选择模型组中的对外模型。
                </Typography>
              </SettingsSection>

              <SettingsSection>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.25 }}>
                <Typography sx={{ fontWeight: 900 }}>Mermaid AI 修复</Typography>
                <Box sx={{ flex: 1 }} />
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Switch size="small" checked={mmEnabled} onChange={(e) => controller.actions.setMermaidFixEnabled?.(e.target.checked)} />
                  <Typography variant="body2" color="text.secondary">
                    启用
                  </Typography>
                </Stack>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                Mermaid 渲染失败时，可在错误块中点击“AI 修复”，用选定供应商的模型按系统提示词修复源码并替换到消息里。
              </Typography>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="mmfix-source">模型来源</InputLabel>
                  <Select
                    labelId="mmfix-source"
                    value={aiServiceSourceValue(mmSelection.sourceKind, mmSelection.sourceId)}
                    label="模型来源"
                    onChange={(e) => controller.actions.setMermaidFixModelSource?.(e.target.value)}
                    disabled={sourceSelectDisabled}
                  >
                    {aiServiceSourceSelectItems(providers, modelGroupList)}
                  </Select>
                </FormControl>

              </Stack>

              <FormControl size="small" fullWidth>
                <InputLabel id="mmfix-model">登记模型</InputLabel>
                <Select
                  labelId="mmfix-model"
                  value={mmSelection.hasPickInList ? mmSelection.modelPick : ''}
                  label="登记模型"
                  onChange={(e) => controller.actions.setMermaidFixModelId?.(e.target.value)}
                  disabled={loading || !mmSelection.sourceId}
                >
                  <MenuItem value="">
                    <em>请选择…</em>
                  </MenuItem>
                  {mmSelection.modelItems.map((item: any) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.hint ? `${item.label} / ${item.hint}` : item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Typography variant="caption" color="text.secondary">
                可选择供应商设置中已登记的模型，也可选择模型组中的对外模型。
              </Typography>

              <TextField
                size="small"
                label="系统提示词"
                value={mmSystemPrompt}
                onChange={(e) => controller.actions.setMermaidFixSystemPrompt?.(e.target.value)}
                placeholder="写入系统提示词…"
                fullWidth
                multiline
                minRows={8}
              />

              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color={mmPromptChanged ? 'warning.main' : 'text.secondary'}>
                  {mmPromptChanged ? '已自定义系统提示词' : '当前为默认系统提示词'}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="text"
                  onClick={() => controller.actions.resetMermaidFixSystemPromptDefault?.()}
                  disabled={!mmDefaultPrompt || !mmPromptChanged}
                >
                  恢复默认
                </Button>
              </Stack>

              </SettingsSection>

              <SettingsSection>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>AI 聊天记录取名</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Switch size="small" checked={ctnEnabled} onChange={(e) => controller.actions.setChatTitleNamingEnabled?.(e.target.checked)} />
                    <Typography variant="body2" color="text.secondary">
                      启用
                    </Typography>
                  </Stack>
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  在“聊天记录”的会话菜单里，可点击“AI 生成标题”，用选定供应商/模型按系统提示词为当前会话生成新标题。
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="ctn-source">模型来源</InputLabel>
                    <Select
                      labelId="ctn-source"
                      value={aiServiceSourceValue(ctnSelection.sourceKind, ctnSelection.sourceId)}
                      label="模型来源"
                      onChange={(e) => controller.actions.setChatTitleNamingModelSource?.(e.target.value)}
                      disabled={sourceSelectDisabled}
                    >
                      {aiServiceSourceSelectItems(providers, modelGroupList)}
                    </Select>
                  </FormControl>

                </Stack>

                <FormControl size="small" fullWidth>
                  <InputLabel id="ctn-model">登记模型</InputLabel>
                  <Select
                    labelId="ctn-model"
                    value={ctnSelection.hasPickInList ? ctnSelection.modelPick : ''}
                    label="登记模型"
                    onChange={(e) => controller.actions.setChatTitleNamingModelId?.(e.target.value)}
                    disabled={loading || !ctnSelection.sourceId}
                  >
                    <MenuItem value="">
                      <em>请选择…</em>
                    </MenuItem>
                    {ctnSelection.modelItems.map((item: any) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.hint ? `${item.label} / ${item.hint}` : item.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Typography variant="caption" color="text.secondary">
                  可选择供应商设置中已登记的模型，也可选择模型组中的对外模型。
                </Typography>

                <TextField
                  size="small"
                  label="系统提示词"
                  value={ctnSystemPrompt}
                  onChange={(e) => controller.actions.setChatTitleNamingSystemPrompt?.(e.target.value)}
                  placeholder="写入系统提示词…"
                  fullWidth
                  multiline
                  minRows={6}
                />

                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color={ctnPromptChanged ? 'warning.main' : 'text.secondary'}>
                    {ctnPromptChanged ? '已自定义系统提示词' : '当前为默认系统提示词'}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => controller.actions.resetChatTitleNamingSystemPromptDefault?.()}
                    disabled={!ctnDefaultPrompt || !ctnPromptChanged}
                  >
                    恢复默认
                  </Button>
                </Stack>
              </Stack>
              </SettingsSection>

              <SettingsSection>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>表情包取名服务</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Switch size="small" checked={snEnabled} onChange={(e) => controller.actions.setStickerNamingEnabled?.(e.target.checked)} />
                    <Typography variant="body2" color="text.secondary">
                      启用
                    </Typography>
                  </Stack>
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  在“表情包”设置页，每个表情条目里可点击“AI 取名”，将图片按系统提示词交给模型生成新名称并自动改名。
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="sn-source">模型来源</InputLabel>
                    <Select
                      labelId="sn-source"
                      value={aiServiceSourceValue(snSelection.sourceKind, snSelection.sourceId)}
                      label="模型来源"
                      onChange={(e) => controller.actions.setStickerNamingModelSource?.(e.target.value)}
                      disabled={sourceSelectDisabled}
                    >
                      {aiServiceSourceSelectItems(providers, modelGroupList)}
                    </Select>
                  </FormControl>

                </Stack>

                <FormControl size="small" fullWidth>
                  <InputLabel id="sn-model">登记模型</InputLabel>
                  <Select
                    labelId="sn-model"
                    value={snSelection.hasPickInList ? snSelection.modelPick : ''}
                    label="登记模型"
                    onChange={(e) => controller.actions.setStickerNamingModelId?.(e.target.value)}
                    disabled={loading || !snSelection.sourceId}
                  >
                    <MenuItem value="">
                      <em>请选择…</em>
                    </MenuItem>
                    {snSelection.modelItems.map((item: any) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.hint ? `${item.label} / ${item.hint}` : item.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Typography variant="caption" color="text.secondary">
                  可选择供应商设置中已登记的模型，也可选择模型组中的对外模型。
                </Typography>

                <TextField
                  size="small"
                  label="系统提示词"
                  value={snSystemPrompt}
                  onChange={(e) => controller.actions.setStickerNamingSystemPrompt?.(e.target.value)}
                  placeholder="写入系统提示词…"
                  fullWidth
                  multiline
                  minRows={6}
                />

                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color={snPromptChanged ? 'warning.main' : 'text.secondary'}>
                    {snPromptChanged ? '已自定义系统提示词' : '当前为默认系统提示词'}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => controller.actions.resetStickerNamingSystemPromptDefault?.()}
                    disabled={!snDefaultPrompt || !snPromptChanged}
                  >
                    恢复默认
                  </Button>
                </Stack>
              </Stack>
              </SettingsSection>
            </Stack>
          </Stack>
        </SettingsSurface>,
    )
  }

  const editingId = String(draft?.editProviderId || '')

  return wrapSettingsPanel(
      <SettingsSurface>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>供应商管理</Typography>
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<AddIcon />} onClick={() => controller.actions.createProvider()} disabled={loading}>
            新建供应商
          </Button>
        </Stack>
        <Stack spacing={1.5}>
          {providers.map((p: any) => {
            const pid = String(p?.id || '')
            const isEditing = pid && pid === editingId
            return (
              <SettingsListItem key={pid} tone={isEditing ? 'selected' : 'default'} sx={{ p: 1.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 900 }} noWrap>
                      {String(p?.name || '')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {providerProtocolLabel(p?.protocol)} · {String(p?.baseUrl || '')}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => (isEditing ? controller.actions.closeProviderEditor() : controller.actions.openProviderEditor(pid))}
                      disabled={!pid}
                    >
                      {isEditing ? '收起' : '编辑'}
                    </Button>
                    <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteProvider(pid)} disabled={!pid}>
                      删除
                    </Button>
                  </Stack>
                </Stack>

                {isEditing ? (
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    <ProviderConfigEditor controller={controller} draft={draft} provider={p} loading={loading} models={models} />
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button variant="contained" onClick={() => controller.actions.saveProvider()}>
                        保存
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </SettingsListItem>
            )
          })}
        </Stack>
      </SettingsSurface>,
  )
}
