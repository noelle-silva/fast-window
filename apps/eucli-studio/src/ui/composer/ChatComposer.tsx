import * as React from 'react'
import { Box, IconButton, Stack } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { HookPromptPopover } from '../components/HookPromptPopover'
import { ReasoningCleanDialog } from '../components/ReasoningCleanDialog'
import { composerSideInsetPercent } from '../../domain/composerAppearance'
import { normalizeComposerToolsLayout, type ComposerToolsLayout } from '../../domain/composerToolsLayout'
import type { PromptScope } from '../../domain/promptLibrary'
import type { BranchTreeView } from '../../domain/branchTree'
import { COMPOSER_REFRESH_SCOPE } from '../../domain/uiRefreshScope'
import { useScopedUiVersion } from '../hooks/useScopedUiVersion'
import { ComposerInputControls } from './ComposerInputControls'
import { ComposerPromptLibraryDialog } from './ComposerPromptLibraryDialog'
import { ComposerTaskTreeDialog } from './ComposerTaskTreeDialog'
import type { TaskTreeBrowseState } from '../settings/TaskTreePanel'
import type { TaskScope } from '../../domain/taskTree'
import { useEvent } from '../hooks/useEvent'
import type { PromptLibraryBrowseState } from '../settings/PromptLibrarySettingsPanel'
import {
  buildComposerToolEntries,
  composerToolInlineNodes,
  composerToolMenuItems,
} from './composerToolEntries'

export function ChatComposer(props: {
  controller: any
  loading: boolean
  composerRef: React.MutableRefObject<HTMLDivElement | null>
  onClickOpenImageViewer: (e: React.MouseEvent) => void
  treeOpen: boolean
  effectiveTreeView: BranchTreeView
  treePanelW: number
  composerOpacity: number
  composerBlur: number
  composerWidthPercent: number
  composerMinRows: number
  composerRadius: number
  composerModelShowProvider: boolean
  /** 工具条按钮布局：哪一项直显、哪一项收进更多菜单，以及各自顺序。 */
  composerToolsLayout: ComposerToolsLayout
  activeSessionComposerDraftKey: string
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeWorkspaceId: string
  activeChatTargetId: string
  activeChatId: string
  activeRole: any
  activeGroup: any
  roles: any[]
  workspaces: any[]
  activeStopRunId: string
  formatModelRefText: (modelRef: any) => string
  openImagePicker: (anchor: HTMLElement | null) => void
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
  openTempModelPicker: (anchor: HTMLElement | null) => void
  roleModelStepPrevEnabled: boolean
  roleModelStepNextEnabled: boolean
  stepRoleModelCandidate: (delta: number) => void
  providers: any[]
  modelGroups: any[]
  reasoningProfile: any
  activeReasoningLabel: string
  chatSettingsReasoningSaving: boolean
  openReasoningPicker: (anchor: HTMLElement | null) => void
  hasChatReasoningOverride: boolean
  activeContextTokenUsageText: string
  activeContextTokenUsageShortText: string
  activeCacheRateText: string
  activeAsyncToolTaskRunningCount: number
  openAsyncToolTasks: (anchor: HTMLElement | null) => void
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
    composerToolsLayout,
    activeSessionComposerDraftKey,
    composerInputRef,
    activeTargetKind,
    activeWorkspaceId,
    activeChatTargetId,
    activeChatId,
    activeRole,
    activeGroup,
    roles,
    workspaces,
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
  const composerRevision = useScopedUiVersion(controller, COMPOSER_REFRESH_SCOPE)
  const liveDraft = controller.getComposerDraft()
  const draftImages = Array.isArray(liveDraft?.images) ? liveDraft.images : []
  const sideInset = `${composerSideInsetPercent(composerWidthPercent)}%`

  // 模型按钮文案：只显示模型标识；开关开启时带上供应商（模型组则带模型组名）。
  const effectiveModelLabel = React.useMemo(() => {
    const modelId = String(effectiveModelId || '').trim()
    if (!modelId) return ''
    if (!composerModelShowProvider) return modelId
    const ref = effectiveModelRef && typeof effectiveModelRef === 'object' ? effectiveModelRef : null
    if (!ref) return modelId
    const sourceName = ref.kind === 'model_group'
      ? String((Array.isArray(modelGroups) ? modelGroups : []).find((item: any) => String(item?.id || '') === String(ref.groupId || ''))?.name || '').trim()
      : String((providers.find((item: any) => String(item?.id || '') === String(ref.providerId || ''))?.name) || '').trim()
    return sourceName ? `${sourceName} / ${modelId}` : modelId
  }, [effectiveModelId, effectiveModelRef, composerModelShowProvider, modelGroups, providers])

  const [cleanOpen, setCleanOpen] = React.useState(false)
  const [cleaning, setCleaning] = React.useState(false)
  // 更多菜单里的 hook 提示词入口：菜单关闭后以「更多」按钮为锚点打开同一份弹层。
  const [hookPromptMenuAnchor, setHookPromptMenuAnchor] = React.useState<HTMLElement | null>(null)
  // 提示词库模态窗：null 表示关闭；否则是当前作用域（global / role / workspace）。
  const [promptLibraryScope, setPromptLibraryScope] = React.useState<PromptScope | null>(null)
  // 每个会话一份提示词库浏览位置：作用域 → 归属 + 收藏夹层级。
  // 存在 ref 里：上报不触发渲染，重新打开模态窗时读最新值即可。
  const promptLibraryBrowseRef = React.useRef<Map<string, Partial<Record<PromptScope, PromptLibraryBrowseState>>>>(new Map())
  const promptLibraryBrowseKey = String(activeChatId || activeSessionComposerDraftKey || '__default__')
  const promptLibraryBrowse = promptLibraryBrowseRef.current.get(promptLibraryBrowseKey) || {}
  const rememberPromptLibraryBrowse = useEvent((scope: PromptScope, state: Required<PromptLibraryBrowseState>) => {
    const current = promptLibraryBrowseRef.current.get(promptLibraryBrowseKey) || {}
    promptLibraryBrowseRef.current.set(promptLibraryBrowseKey, { ...current, [scope]: state })
  })

  // 任务清单模态窗：null 表示关闭；否则是当前作用域（role / workspace）。
  const [taskTreeScope, setTaskTreeScope] = React.useState<TaskScope | null>(null)
  // 每个会话一份任务浏览位置：作用域 → 归属 + 层级路径。
  const taskTreeBrowseRef = React.useRef<Map<string, Partial<Record<TaskScope, TaskTreeBrowseState>>>>(new Map())
  const taskTreeBrowse = taskTreeBrowseRef.current.get(promptLibraryBrowseKey) || {}
  const rememberTaskTreeBrowse = useEvent((scope: TaskScope, state: Required<TaskTreeBrowseState>) => {
    const current = taskTreeBrowseRef.current.get(promptLibraryBrowseKey) || {}
    taskTreeBrowseRef.current.set(promptLibraryBrowseKey, { ...current, [scope]: state })
  })

  const toolLayout = React.useMemo(() => normalizeComposerToolsLayout(composerToolsLayout), [composerToolsLayout])

  const toolEntries = React.useMemo(
    () =>
      buildComposerToolEntries({
        loading: !!loading,
        activeRole,
        activeChat,
        activeTargetKind,
        roleSessionControlsEnabled,
        openImagePicker,
        hookPrompts,
        activeHookPromptMode,
        activeHookPromptPresetId,
        roleDefaultHookPromptPresetId,
        hookPromptSelectorDisabled,
        chatSettingsHookSaving,
        hookPromptSelectorDisabledReason,
        onSelectHookPrompt: (mode, presetId) => controller.actions.selectHookPromptForActiveChat?.(mode, presetId),
        onOpenHookPromptMenu: setHookPromptMenuAnchor,
        effectiveModelLabel,
        hasChatOverride,
        providers,
        openTempModelPicker,
        roleModelStepPrevEnabled,
        roleModelStepNextEnabled,
        stepRoleModelCandidate,
        reasoningProfile,
        activeReasoningLabel,
        chatSettingsReasoningSaving,
        hasChatReasoningOverride,
        openReasoningPicker,
        activeContextTokenUsageText,
        activeContextTokenUsageShortText,
        activeCacheRateText,
        activeAsyncToolTaskRunningCount,
        openAsyncToolTasks,
        activeStreamOn,
        chatSettingsStreamSaving,
        onToggleStream: () => controller.actions.toggleChatStreamEnabled?.(),
        onCleanReasoning: () => setCleanOpen(true),
        onOpenPromptLibrary: (scope) => setPromptLibraryScope(scope),
        onOpenTaskTree: (scope) => setTaskTreeScope(scope),
      }),
    [
      controller,
      loading,
      activeRole,
      activeChat,
      activeTargetKind,
      roleSessionControlsEnabled,
      openImagePicker,
      hookPrompts,
      activeHookPromptMode,
      activeHookPromptPresetId,
      roleDefaultHookPromptPresetId,
      hookPromptSelectorDisabled,
      chatSettingsHookSaving,
      hookPromptSelectorDisabledReason,
      effectiveModelLabel,
      hasChatOverride,
      providers,
      openTempModelPicker,
      roleModelStepPrevEnabled,
      roleModelStepNextEnabled,
      stepRoleModelCandidate,
      reasoningProfile,
      activeReasoningLabel,
      chatSettingsReasoningSaving,
      hasChatReasoningOverride,
      openReasoningPicker,
      activeContextTokenUsageText,
      activeContextTokenUsageShortText,
      activeCacheRateText,
      activeAsyncToolTaskRunningCount,
      openAsyncToolTasks,
      activeStreamOn,
      chatSettingsStreamSaving,
    ],
  )

  const inlineToolNodes = React.useMemo(() => composerToolInlineNodes(toolLayout, toolEntries), [toolLayout, toolEntries])
  const menuToolItems = React.useMemo(() => composerToolMenuItems(toolLayout, toolEntries), [toolLayout, toolEntries])

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
          draftRevision={composerRevision}
          initialValue={String(liveDraft?.input || '')}
          inputRef={composerInputRef}
          disabled={loading || !activeRole}
          hasDraftNonText={draftImages.length > 0}
          activeTargetKind={activeTargetKind}
          activeGroup={activeGroup}
          roles={roles}
          activeStopRunId={activeStopRunId}
          formatModelRefText={formatModelRefText}
          minRows={composerMinRows}
          radius={composerRadius}
          toolbarStart={(
            <>
              {inlineToolNodes}
              {menuToolItems.length ? (
                <MoreActionsMenu
                  ariaLabel="更多"
                  tooltip="更多"
                  // 菜单里现在也有与会话无关的入口（提示词库），开关只跟加载态走；
                  // 需要会话的单项由各自的 disabled 判断。
                  disabled={!!loading}
                  items={menuToolItems}
                />
              ) : null}
            </>
          )}
          onSend={onSend}
          onStop={onStop}
          onPaste={onPaste}
        />
      </Stack>

      <HookPromptPopover
        anchorEl={hookPromptMenuAnchor}
        onClose={() => setHookPromptMenuAnchor(null)}
        library={hookPrompts?.library || { presets: [] }}
        selectedMode={activeHookPromptMode}
        selectedPresetId={activeHookPromptPresetId}
        roleDefaultPresetId={roleDefaultHookPromptPresetId}
        disabled={hookPromptSelectorDisabled || chatSettingsHookSaving}
        onSelect={(mode, presetId) => controller.actions.selectHookPromptForActiveChat?.(mode, presetId)}
      />

      <ReasoningCleanDialog open={cleanOpen} busy={cleaning} onClose={() => setCleanOpen(false)} onConfirm={confirmClean} />

      <ComposerPromptLibraryDialog
        controller={controller}
        scope={promptLibraryScope}
        onClose={() => setPromptLibraryScope(null)}
        roles={roles}
        workspaces={workspaces}
        activeRoleId={String(activeRole?.id || '')}
        activeWorkspaceId={String(activeWorkspaceId || '')}
        browseState={promptLibraryBrowse}
        onBrowseStateChange={rememberPromptLibraryBrowse}
      />

      <ComposerTaskTreeDialog
        controller={controller}
        scope={taskTreeScope}
        onClose={() => setTaskTreeScope(null)}
        roles={roles}
        workspaces={workspaces}
        activeRoleId={String(activeRole?.id || '')}
        activeWorkspaceId={String(activeWorkspaceId || '')}
        browseState={taskTreeBrowse}
        onBrowseStateChange={rememberTaskTreeBrowse}
      />
    </Box>
  )
}
