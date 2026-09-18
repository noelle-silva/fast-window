import * as React from 'react'
import { Box, Button, Chip, CircularProgress, IconButton, Stack, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import CloseIcon from '@mui/icons-material/Close'
import { HookPromptSelector } from '../components/HookPromptSelector'
import { clampNum } from '../utils/numbers'
import { ComposerInputControls } from './ComposerInputControls'

const composerToolIconButtonSx = {
  width: 36,
  height: 36,
  borderRadius: '999px',
  bgcolor: 'transparent',
  color: 'text.secondary',
  '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: 'text.primary' },
  '&.Mui-disabled': { bgcolor: 'transparent' },
}

const composerToolTextButtonSx = {
  minWidth: 0,
  maxWidth: 220,
  height: 34,
  px: 1.25,
  borderRadius: '999px',
  bgcolor: 'transparent',
  color: 'text.secondary',
  border: 0,
  textTransform: 'none',
  fontWeight: 800,
  fontSize: 12,
  '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: 'text.primary', border: 0 },
  '&.Mui-disabled': { bgcolor: 'transparent', border: 0 },
}

const composerContextButtonSx = {
  ...composerToolTextButtonSx,
  borderRadius: 2,
  maxWidth: 120,
}

export function ChatComposer(props: {
  controller: any
  loading: boolean
  composerRef: React.MutableRefObject<HTMLDivElement | null>
  onClickOpenImageViewer: (e: React.MouseEvent) => void
  treeOpen: boolean
  effectiveTreeView: 'right' | 'float'
  treePanelW: number
  composerOpacity: number
  composerBlur: number
  draft: any
  activeSessionComposerDraftKey: string
  attachSendLimitChars: number
  draftFilePickerInputRef: React.MutableRefObject<HTMLInputElement | null>
  onPickFilesChanged: (e: React.ChangeEvent<HTMLInputElement>) => void
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeChatTargetId: string
  activeChatId: string
  activeRole: any
  activeGroup: any
  roles: any[]
  activeStopRunId: string
  draftFilesPending: boolean
  draftFilesWarn: boolean
  hasDraftFiles: boolean
  formatModelRefText: (modelRef: any) => string
  openFileAdjust: (e: React.MouseEvent<HTMLElement>, fileId: string) => void
  openAttachmentPicker: (e: React.MouseEvent<HTMLElement>) => void
  hookPrompts: any
  activeHookPromptMode: 'none' | 'preset' | 'inherit'
  activeHookPromptPresetId: string
  roleDefaultHookPromptPresetId: string
  hookPromptSelectorDisabled: boolean
  chatSettingsHookSaving: boolean
  hookPromptSelectorDisabledReason: string
  roleSessionControlsEnabled: boolean
  chatSettingsModelSaving: boolean
  hasChatOverride: boolean
  chatOverride: any
  effectiveModelId: string
  openTempModelPicker: (e: React.MouseEvent<HTMLElement>) => void
  providers: any[]
  reasoningProfile: any
  activeReasoningLabel: string
  chatSettingsReasoningSaving: boolean
  openReasoningPicker: (e: React.MouseEvent<HTMLElement>) => void
  hasChatReasoningOverride: boolean
  activeContextTokenUsageText: string
  activeContextTokenUsageShortText: string
  activeAsyncToolTaskRunningCount: number
  openAsyncToolTasks: (e: React.MouseEvent<HTMLElement>) => void
  activeStreamOn: boolean
  chatSettingsStreamSaving: boolean
  activeChat: any
  onSend: () => void
  onStop: () => void
  onPaste: (e: React.ClipboardEvent) => void
}) {
  const {
    controller,
    loading,
    composerRef,
    onClickOpenImageViewer,
    treeOpen,
    effectiveTreeView,
    treePanelW,
    composerOpacity,
    composerBlur,
    draft,
    activeSessionComposerDraftKey,
    attachSendLimitChars,
    draftFilePickerInputRef,
    onPickFilesChanged,
    composerInputRef,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
    activeRole,
    activeGroup,
    roles,
    activeStopRunId,
    draftFilesPending,
    draftFilesWarn,
    hasDraftFiles,
    formatModelRefText,
    openFileAdjust,
    openAttachmentPicker,
    hookPrompts,
    activeHookPromptMode,
    activeHookPromptPresetId,
    roleDefaultHookPromptPresetId,
    hookPromptSelectorDisabled,
    chatSettingsHookSaving,
    hookPromptSelectorDisabledReason,
    roleSessionControlsEnabled,
    chatSettingsModelSaving,
    hasChatOverride,
    chatOverride,
    effectiveModelId,
    openTempModelPicker,
    providers,
    reasoningProfile,
    activeReasoningLabel,
    chatSettingsReasoningSaving,
    openReasoningPicker,
    hasChatReasoningOverride,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeAsyncToolTaskRunningCount,
    openAsyncToolTasks,
    activeStreamOn,
    chatSettingsStreamSaving,
    activeChat,
    onSend,
    onStop,
    onPaste,
  } = props

  return (
    <Box
      ref={composerRef}
      onClick={onClickOpenImageViewer}
      sx={{
        position: 'absolute',
        left: 16,
        right: treeOpen && effectiveTreeView === 'right' ? 16 + Math.round(treePanelW) : 16,
        bottom: 16,
        zIndex: 1299,
        p: 1.5,
        borderRadius: 18,
        bgcolor: `rgba(255,255,255,${composerOpacity / 100})`,
        boxShadow: '0 12px 28px rgba(0,0,0,.18)',
        backdropFilter: composerBlur > 0 ? `blur(${composerBlur}px)` : 'none',
        WebkitBackdropFilter: composerBlur > 0 ? `blur(${composerBlur}px)` : 'none',
      }}
    >
      <Stack spacing={1}>
        {Array.isArray(draft?.images) && draft.images.length ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {draft.images.map((img: any) => (
              <Box key={String(img?.id || '')} sx={{ position: 'relative' }}>
                <Box
                  component="img"
                  data-fw-img="1"
                  src={String(img?.dataUrl || '')}
                  alt={String(img?.name || '图片')}
                  sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'zoom-in' }}
                />
                <IconButton
                  size="small"
                  onClick={() => controller.actions.removeDraftImage(String(img?.id || ''))}
                  sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(255,255,255,.85)', border: '1px solid', borderColor: 'divider' }}
                >
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        ) : null}

        {Array.isArray((draft as any)?.files) && (draft as any).files.length ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {(draft as any).files.map((f: any) => {
              const id = String(f?.id || '')
              const name = String(f?.name || '文件')
              const pending = !!f?.pending
              const err = String(f?.error || '').trim()
              const pct0 = Math.round(Number(f?.sendPct ?? 100))
              const pct = clampNum(pct0, 0, 100)
              const rawLen = String(f?.text || '').trim().length
              const sendLen = Math.max(0, Math.ceil((rawLen * pct) / 100))
              const warn = !pending && !err && rawLen > 0 && sendLen > attachSendLimitChars
              const label = pending
                ? `${name}（解析中…）`
                : err
                  ? `${name}（失败）`
                  : warn
                    ? `${name}（超长提醒）`
                    : pct < 100
                      ? `${name}（${pct}%）`
                      : name
              return (
                <Chip
                  key={id || name}
                  size="small"
                  label={label}
                  variant="outlined"
                  color={err ? 'error' : warn ? 'warning' : 'default'}
                  onClick={id ? (e) => openFileAdjust(e as any, id) : undefined}
                  onDelete={id ? () => controller.actions.removeDraftFile?.(id) : undefined}
                  sx={{ maxWidth: 320 }}
                />
              )
            })}
          </Stack>
        ) : null}

        <input
          ref={draftFilePickerInputRef}
          hidden
          type="file"
          multiple
          accept=".txt,.md,.pdf,.docx,.ppt,.pptx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={onPickFilesChanged}
        />

        <ComposerInputControls
          controller={controller}
          draftKey={String(activeSessionComposerDraftKey || `${activeTargetKind}:${activeChatTargetId}:${activeChatId || '__new__'}`)}
          initialValue={String(draft?.input || '')}
          inputRef={composerInputRef}
          disabled={loading || !activeRole}
          draftFilesPending={draftFilesPending}
          draftFilesWarn={draftFilesWarn}
          hasDraftNonText={!!((draft?.images || []).length || hasDraftFiles)}
          activeTargetKind={activeTargetKind}
          activeGroup={activeGroup}
          roles={roles}
          activeStopRunId={activeStopRunId}
          formatModelRefText={formatModelRefText}
          toolbarStart={(
            <>
              <Tooltip title="添加图片或文件">
                <span>
                  <IconButton
                    aria-label="添加图片或文件"
                    onClick={openAttachmentPicker}
                    disabled={loading || !activeRole}
                    size="small"
                    sx={composerToolIconButtonSx}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <HookPromptSelector
                library={hookPrompts.library || { presets: [] }}
                selectedMode={activeHookPromptMode as any}
                selectedPresetId={activeHookPromptPresetId}
                roleDefaultPresetId={roleDefaultHookPromptPresetId}
                disabled={hookPromptSelectorDisabled || chatSettingsHookSaving}
                saving={chatSettingsHookSaving}
                disabledReason={hookPromptSelectorDisabledReason}
                onSelect={(mode, presetId) => controller.actions.selectHookPromptForActiveChat?.(mode, presetId)}
              />

              {roleSessionControlsEnabled ? (
                <Tooltip title={chatSettingsModelSaving ? '临时模型保存中…' : hasChatOverride ? `临时模型：${formatModelRefText(chatOverride)}` : `角色模型：${effectiveModelId || '未配置模型'}`}>
                  <span>
                    <Button
                      aria-label="临时切换模型"
                      onClick={openTempModelPicker}
                      disabled={loading || chatSettingsModelSaving || !activeRole || !providers.length}
                      size="small"
                      variant="text"
                      sx={{ ...composerToolTextButtonSx, color: hasChatOverride ? 'primary.main' : 'text.secondary' }}
                    >
                      {chatSettingsModelSaving ? <CircularProgress size={14} thickness={5} color="inherit" sx={{ mr: 0.5 }} /> : null}
                      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {chatSettingsModelSaving ? '保存中…' : effectiveModelId || '未配置模型'}
                      </Box>
                    </Button>
                  </span>
                </Tooltip>
              ) : null}

              {roleSessionControlsEnabled && reasoningProfile.supportsReasoning ? (
                <Tooltip title={chatSettingsReasoningSaving ? '思考等级保存中…' : `思考等级：${activeReasoningLabel || '默认'}`}>
                  <span>
                    <Button
                      aria-label="选择思考等级"
                      onClick={openReasoningPicker}
                      disabled={loading || chatSettingsReasoningSaving || !activeRole}
                      size="small"
                      variant="text"
                      sx={{ ...composerToolTextButtonSx, color: hasChatReasoningOverride ? 'primary.main' : 'text.secondary' }}
                    >
                      {activeReasoningLabel || '默认'}
                    </Button>
                  </span>
                </Tooltip>
              ) : null}

              <Tooltip title={`上下文约 ${activeContextTokenUsageText}`}>
                <span>
                  <Button aria-label={`上下文约 ${activeContextTokenUsageText}`} size="small" variant="text" sx={composerContextButtonSx}>
                    {activeContextTokenUsageShortText}
                  </Button>
                </span>
              </Tooltip>

              <Tooltip title="异步工具任务">
                <span>
                  <Button
                    aria-label="异步工具任务"
                    onClick={openAsyncToolTasks}
                    disabled={!activeRole || !activeChatId}
                    size="small"
                    variant="text"
                    startIcon={<AutorenewIcon fontSize="small" />}
                    sx={composerToolTextButtonSx}
                  >
                    异步 {activeAsyncToolTaskRunningCount}
                  </Button>
                </span>
              </Tooltip>

              <Tooltip title={activeStreamOn ? '流式输出：已开启（本会话）' : '非流式：已关闭（本会话）'}>
                <span>
                  <Button
                    aria-label="切换会话流式输出"
                    onClick={() => controller.actions.toggleChatStreamEnabled?.()}
                    disabled={loading || chatSettingsStreamSaving || !roleSessionControlsEnabled || !activeChat}
                    size="small"
                    variant="text"
                    sx={{ ...composerToolTextButtonSx, width: 88, justifyContent: 'center', color: activeStreamOn ? 'primary.main' : 'text.secondary' }}
                  >
                    {activeStreamOn ? '流' : '非流'}
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
          onSend={onSend}
          onStop={onStop}
          onPaste={onPaste}
        />
      </Stack>
    </Box>
  )
}
