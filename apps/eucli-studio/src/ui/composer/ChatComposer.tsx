import * as React from 'react'
import { Box, Button, IconButton, Stack, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import CloseIcon from '@mui/icons-material/Close'
import { HookPromptSelector } from '../components/HookPromptSelector'
import { FitTextLabel } from '../components/FitTextLabel'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { ReasoningCleanDialog } from '../components/ReasoningCleanDialog'
import { composerSideInsetPercent } from '../../domain/composerAppearance'
import { COMPOSER_REFRESH_SCOPE } from '../../domain/uiRefreshScope'
import { useScopedUiVersion } from '../hooks/useScopedUiVersion'
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

// 模型切换组：一个固定宽度的整体按钮，内部按左中右三段划分。
// 宽度固定，不随模型标识长短伸缩；三段各自承担自己的悬停反馈。
const composerModelGroupSx = {
  display: 'flex',
  alignItems: 'stretch',
  width: 220,
  flexShrink: 0,
  height: 34,
  borderRadius: '999px',
  overflow: 'hidden',
  bgcolor: 'transparent',
  '& > span': { display: 'flex', alignItems: 'stretch' },
}

// 组内单块：没有自己的圆角，悬停只作用于自己这一段。
const composerModelStepButtonSx = {
  minWidth: 24,
  width: 24,
  height: 34,
  px: 0,
  borderRadius: 0,
  bgcolor: 'transparent',
  color: 'text.secondary',
  border: 0,
  '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: 'text.primary', border: 0 },
  '&.Mui-disabled': { bgcolor: 'transparent', border: 0 },
}

// 中间段承载模型标识，占据剩余宽度。
const composerModelLabelButtonSx = {
  ...composerToolTextButtonSx,
  borderRadius: 0,
  height: 34,
  maxWidth: 'none',
  justifyContent: 'center',
  '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: 'text.primary', border: 0 },
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
  composerWidthPercent: number
  composerMinRows: number
  composerRadius: number
  composerModelShowProvider: boolean
  draft: any
  activeSessionComposerDraftKey: string
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeChatTargetId: string
  activeChatId: string
  activeRole: any
  activeGroup: any
  roles: any[]
  activeStopRunId: string
  formatModelRefText: (modelRef: any) => string
  openImagePicker: (e: React.MouseEvent<HTMLElement>) => void
  hookPrompts: any
  activeHookPromptMode: 'none' | 'preset' | 'inherit'
  activeHookPromptPresetId: string
  roleDefaultHookPromptPresetId: string
  hookPromptSelectorDisabled: boolean
  chatSettingsHookSaving: boolean
  hookPromptSelectorDisabledReason: string
  roleSessionControlsEnabled: boolean
  hasChatOverride: boolean
  effectiveModelId: string
  effectiveModelRef: any
  openTempModelPicker: (e: React.MouseEvent<HTMLElement>) => void
  roleModelStepPrevEnabled: boolean
  roleModelStepNextEnabled: boolean
  stepRoleModelCandidate: (delta: number) => void
  providers: any[]
  modelGroups: any[]
  reasoningProfile: any
  activeReasoningLabel: string
  chatSettingsReasoningSaving: boolean
  openReasoningPicker: (e: React.MouseEvent<HTMLElement>) => void
  hasChatReasoningOverride: boolean
  activeContextTokenUsageText: string
  activeContextTokenUsageShortText: string
  activeCacheRateText: string
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
    composerWidthPercent,
    composerMinRows,
    composerRadius,
    composerModelShowProvider,
    draft,
    activeSessionComposerDraftKey,
    composerInputRef,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
    activeRole,
    activeGroup,
    roles,
    activeStopRunId,
    formatModelRefText,
    openImagePicker,
    hookPrompts,
    activeHookPromptMode,
    activeHookPromptPresetId,
    roleDefaultHookPromptPresetId,
    hookPromptSelectorDisabled,
    chatSettingsHookSaving,
    hookPromptSelectorDisabledReason,
    roleSessionControlsEnabled,
    hasChatOverride,
    effectiveModelId,
    effectiveModelRef,
    openTempModelPicker,
    roleModelStepPrevEnabled,
    roleModelStepNextEnabled,
    stepRoleModelCandidate,
    providers,
    modelGroups,
    reasoningProfile,
    activeReasoningLabel,
    chatSettingsReasoningSaving,
    openReasoningPicker,
    hasChatReasoningOverride,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeCacheRateText,
    activeAsyncToolTaskRunningCount,
    openAsyncToolTasks,
    activeStreamOn,
    chatSettingsStreamSaving,
    activeChat,
    onSend,
    onStop,
    onPaste,
  } = props

  // 输入区独立更新：草稿图片变化走 composer 范围，只有本组件重渲染。
  useScopedUiVersion(controller, COMPOSER_REFRESH_SCOPE)
  const liveDraft = (controller?.getComposerDraft?.() as any) || draft
  const draftImages = Array.isArray(liveDraft?.images) ? liveDraft.images : []
  const sideInset = `${composerSideInsetPercent(composerWidthPercent)}%`

  // 模型按钮文案：只显示模型标识；开关开启时带上供应商（模型组则带模型组名）。
  const effectiveModelLabel = (() => {
    const modelId = String(effectiveModelId || '').trim()
    if (!modelId) return ''
    if (!composerModelShowProvider) return modelId
    const ref = effectiveModelRef && typeof effectiveModelRef === 'object' ? effectiveModelRef : null
    if (!ref) return modelId
    const sourceName = ref.kind === 'model_group'
      ? String((Array.isArray(modelGroups) ? modelGroups : []).find((item: any) => String(item?.id || '') === String(ref.groupId || ''))?.name || '').trim()
      : String((providers.find((item: any) => String(item?.id || '') === String(ref.providerId || ''))?.name) || '').trim()
    return sourceName ? `${sourceName} / ${modelId}` : modelId
  })()

  const [cleanOpen, setCleanOpen] = React.useState(false)
  const [cleaning, setCleaning] = React.useState(false)

  const confirmClean = async (keywordsText: string) => {
    const action = controller?.actions?.cleanSessionReasoning
    if (typeof action !== 'function') return
    setCleaning(true)
    try {
      const ok = await Promise.resolve(action(keywordsText))
      if (ok === true) setCleanOpen(false)
    } finally {
      setCleaning(false)
    }
  }

  return (
    <Box
      ref={composerRef}
      onClick={onClickOpenImageViewer}
      sx={{
        position: 'absolute',
        left: sideInset,
        right: treeOpen && effectiveTreeView === 'right' ? `calc(${sideInset} + ${Math.round(treePanelW)}px)` : sideInset,
        bottom: 16,
        zIndex: 1299,
        p: 1.5,
        borderRadius: `${composerRadius}px`,
        bgcolor: `rgba(255,255,255,${composerOpacity / 100})`,
        boxShadow: '0 12px 28px rgba(0,0,0,.18)',
        backdropFilter: composerBlur > 0 ? `blur(${composerBlur}px)` : 'none',
        WebkitBackdropFilter: composerBlur > 0 ? `blur(${composerBlur}px)` : 'none',
      }}
    >
      <Stack spacing={1}>
        {draftImages.length ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {draftImages.map((img: any) => (
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

        <ComposerInputControls
          controller={controller}
          draftKey={String(activeSessionComposerDraftKey || `${activeTargetKind}:${activeChatTargetId}:${activeChatId || '__new__'}`)}
          initialValue={String(draft?.input || '')}
          inputRef={composerInputRef}
          disabled={loading || !activeRole}
          hasDraftNonText={!!(draft?.images || []).length}
          activeTargetKind={activeTargetKind}
          activeGroup={activeGroup}
          roles={roles}
          activeStopRunId={activeStopRunId}
          formatModelRefText={formatModelRefText}
          minRows={composerMinRows}
          radius={composerRadius}
          toolbarStart={(
            <>
              <Tooltip title="添加图片">
                <span>
                  <IconButton
                    aria-label="添加图片"
                    onClick={openImagePicker}
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
                // 模型切换组：一个整体按钮，内部左中右三段各自可点。
                // 三段都不做悬停提示，避免遮挡输入区；保存中也不禁用，避免出现灰色过渡。
                <Box sx={composerModelGroupSx}>
                  <Box component="span">
                    <Button
                      aria-label="上一个候选模型"
                      onClick={() => stepRoleModelCandidate(-1)}
                      disabled={loading || !roleModelStepPrevEnabled}
                      size="small"
                      variant="text"
                      sx={composerModelStepButtonSx}
                    >
                      <ChevronLeftIcon fontSize="small" />
                    </Button>
                  </Box>

                  <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch' }}>
                    <Button
                      aria-label="临时切换模型"
                      onClick={openTempModelPicker}
                      disabled={loading || !activeRole || !providers.length}
                      size="small"
                      variant="text"
                      sx={{ ...composerModelLabelButtonSx, flex: 1, minWidth: 0, color: hasChatOverride ? 'primary.main' : 'text.secondary' }}
                    >
                      <FitTextLabel
                        text={effectiveModelLabel || '未配置模型'}
                        maxFontSize={12}
                        minFontSize={8}
                      />
                    </Button>
                  </Box>

                  <Box component="span">
                    <Button
                      aria-label="下一个候选模型"
                      onClick={() => stepRoleModelCandidate(1)}
                      disabled={loading || !roleModelStepNextEnabled}
                      size="small"
                      variant="text"
                      sx={composerModelStepButtonSx}
                    >
                      <ChevronRightIcon fontSize="small" />
                    </Button>
                  </Box>
                </Box>
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

              <Tooltip title={`缓存率 ${activeCacheRateText}`}>
                <span>
                  <Button aria-label={`缓存率 ${activeCacheRateText}`} size="small" variant="text" sx={composerContextButtonSx}>
                    {activeCacheRateText}
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

              <MoreActionsMenu
                ariaLabel="更多"
                tooltip="更多"
                disabled={loading || !activeChat}
                items={[
                  {
                    key: 'clean-reasoning',
                    label: '清洗思维链',
                    icon: <CleaningServicesIcon fontSize="small" />,
                    disabled: loading || !activeChat,
                    onSelect: () => setCleanOpen(true),
                  },
                ]}
              />
            </>
          )}
          onSend={onSend}
          onStop={onStop}
          onPaste={onPaste}
        />
      </Stack>

      <ReasoningCleanDialog open={cleanOpen} busy={cleaning} onClose={() => setCleanOpen(false)} onConfirm={confirmClean} />
    </Box>
  )
}
