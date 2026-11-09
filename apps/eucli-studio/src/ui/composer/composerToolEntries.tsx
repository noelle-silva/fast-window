import * as React from 'react'
import { Box, Button, IconButton, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined'
import { HookPromptSelector } from '../components/HookPromptSelector'
import { FitTextLabel } from '../components/FitTextLabel'
import type { MoreActionsMenuItem } from '../components/MoreActionsMenu'
import { hookPromptSelectionLabel, type HookPromptLibrary, type HookPromptSelectionMode } from '../../domain/hookPrompt'
import { PROMPT_SCOPE_LABELS, promptScopeLibraryTitle, type PromptScope } from '../../domain/promptLibrary'
import type { ComposerToolId, ComposerToolsLayout } from '../../domain/composerToolsLayout'

// 输入区工具条按钮的两种形态：直显（inline）与更多菜单里的一行（menuItem）。
// 布局只决定顺序与位置；每种形态与它的可用性判断都归条目自己，
// 两种形态共用同一份条件，避免「放在外面能用、收进菜单就不能用」。

export type ComposerToolMenuItem = MoreActionsMenuItem & {
  /** 当前场景不适用（例如模型不支持推理）：整行不出现，但布局配置仍然保留。 */
  hidden?: boolean
}

export type ComposerToolEntry = {
  inline: React.ReactNode
  menuItem: ComposerToolMenuItem
}

export type ComposerToolEntriesContext = {
  loading: boolean
  activeRole: any
  activeChat: any
  roleSessionControlsEnabled: boolean

  openImagePicker: (anchor: HTMLElement | null) => void

  hookPrompts: { library?: HookPromptLibrary } & Record<string, any>
  activeHookPromptMode: HookPromptSelectionMode
  activeHookPromptPresetId: string
  roleDefaultHookPromptPresetId: string
  hookPromptSelectorDisabled: boolean
  chatSettingsHookSaving: boolean
  hookPromptSelectorDisabledReason: string
  onSelectHookPrompt: (mode: HookPromptSelectionMode, presetId: string) => void
  onOpenHookPromptMenu: (anchor: HTMLElement | null) => void

  effectiveModelLabel: string
  hasChatOverride: boolean
  providers: any[]
  openTempModelPicker: (anchor: HTMLElement | null) => void
  roleModelStepPrevEnabled: boolean
  roleModelStepNextEnabled: boolean
  stepRoleModelCandidate: (delta: number) => void

  reasoningProfile: any
  activeReasoningLabel: string
  chatSettingsReasoningSaving: boolean
  hasChatReasoningOverride: boolean
  openReasoningPicker: (anchor: HTMLElement | null) => void

  activeContextTokenUsageText: string
  activeContextTokenUsageShortText: string
  activeCacheRateText: string

  activeAsyncToolTaskRunningCount: number
  openAsyncToolTasks: (anchor: HTMLElement | null) => void

  activeStreamOn: boolean
  chatSettingsStreamSaving: boolean
  onToggleStream: () => void

  onCleanReasoning: () => void
  /** 打开对应作用域的提示词库模态窗。 */
  onOpenPromptLibrary: (scope: PromptScope) => void
}

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

export function buildComposerToolEntries(ctx: ComposerToolEntriesContext): Record<ComposerToolId, ComposerToolEntry> {
  const {
    loading,
    activeRole,
    activeChat,
    roleSessionControlsEnabled,
    openImagePicker,
    hookPrompts,
    activeHookPromptMode,
    activeHookPromptPresetId,
    roleDefaultHookPromptPresetId,
    hookPromptSelectorDisabled,
    chatSettingsHookSaving,
    hookPromptSelectorDisabledReason,
    onSelectHookPrompt,
    onOpenHookPromptMenu,
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
    onToggleStream,
    onCleanReasoning,
    onOpenPromptLibrary,
  } = ctx

  const hookLibrary: HookPromptLibrary = hookPrompts.library || { presets: [] }
  const hookLabel = hookPromptSelectionLabel(hookLibrary, activeHookPromptMode, activeHookPromptPresetId, roleDefaultHookPromptPresetId)
  const modelButtonDisabled = loading || !activeRole || !providers.length
  const streamButtonDisabled = loading || chatSettingsStreamSaving || !roleSessionControlsEnabled || !activeChat

  // 三个提示词库入口结构一致：直显是短文字按钮，菜单里是一行「xx 提示词库」。
  const promptLibraryEntry = (id: ComposerToolId, scope: PromptScope, shortLabel: string): ComposerToolEntry => ({
    inline: (
      <Button
        aria-label={PROMPT_SCOPE_LABELS[scope]}
        onClick={() => onOpenPromptLibrary(scope)}
        size="small"
        variant="text"
        sx={{ ...composerToolTextButtonSx, px: 1 }}
      >
        {shortLabel}
      </Button>
    ),
    menuItem: {
      key: id,
      label: promptScopeLibraryTitle(scope),
      icon: <LibraryBooksOutlinedIcon fontSize="small" />,
      onSelect: () => onOpenPromptLibrary(scope),
    },
  })

  return {
    'image-picker': {
      inline: (
        <Tooltip title="添加图片">
          <span>
            <IconButton
              aria-label="添加图片"
              onClick={(e) => openImagePicker(e.currentTarget)}
              disabled={loading || !activeRole}
              size="small"
              sx={composerToolIconButtonSx}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ),
      menuItem: {
        key: 'image-picker',
        label: '添加图片',
        icon: <AddIcon fontSize="small" />,
        disabled: loading || !activeRole,
        onSelect: (anchor) => openImagePicker(anchor),
      },
    },

    'hook-prompt': {
      inline: (
        <HookPromptSelector
          library={hookLibrary}
          selectedMode={activeHookPromptMode}
          selectedPresetId={activeHookPromptPresetId}
          roleDefaultPresetId={roleDefaultHookPromptPresetId}
          disabled={hookPromptSelectorDisabled || chatSettingsHookSaving}
          saving={chatSettingsHookSaving}
          disabledReason={hookPromptSelectorDisabledReason}
          onSelect={onSelectHookPrompt}
        />
      ),
      menuItem: {
        key: 'hook-prompt',
        label: `hook 提示词：${hookLabel}`,
        disabled: hookPromptSelectorDisabled || chatSettingsHookSaving,
        onSelect: (anchor) => onOpenHookPromptMenu(anchor),
      },
    },

    'model-switch': {
      // 模型切换组：一个整体按钮，内部左中右三段各自可点。
      // 三段都不做悬停提示，避免遮挡输入区；保存中也不禁用，避免出现灰色过渡。
      inline: roleSessionControlsEnabled ? (
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
              onClick={(e) => openTempModelPicker(e.currentTarget)}
              disabled={modelButtonDisabled}
              size="small"
              variant="text"
              sx={{ ...composerModelLabelButtonSx, flex: 1, minWidth: 0, color: hasChatOverride ? 'primary.main' : 'text.secondary' }}
            >
              <FitTextLabel text={effectiveModelLabel || '未配置模型'} maxFontSize={12} minFontSize={8} />
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
      ) : null,
      menuItem: {
        key: 'model-switch',
        label: `模型：${effectiveModelLabel || '未配置模型'}`,
        // 非角色会话没有「角色候选模型」这层语义，工具条与菜单一起不出现。
        hidden: !roleSessionControlsEnabled,
        disabled: modelButtonDisabled,
        onSelect: (anchor) => openTempModelPicker(anchor),
      },
    },

    'reasoning-effort': {
      inline: roleSessionControlsEnabled && reasoningProfile.supportsReasoning ? (
        <Tooltip title={chatSettingsReasoningSaving ? '思考等级保存中…' : `思考等级：${activeReasoningLabel || '默认'}`}>
          <span>
            <Button
              aria-label="选择思考等级"
              onClick={(e) => openReasoningPicker(e.currentTarget)}
              disabled={loading || chatSettingsReasoningSaving || !activeRole}
              size="small"
              variant="text"
              sx={{ ...composerToolTextButtonSx, color: hasChatReasoningOverride ? 'primary.main' : 'text.secondary' }}
            >
              {activeReasoningLabel || '默认'}
            </Button>
          </span>
        </Tooltip>
      ) : null,
      menuItem: {
        key: 'reasoning-effort',
        label: `思考等级：${activeReasoningLabel || '默认'}`,
        // 模型不支持推理时这一项不适用，菜单里直接不出现，和工具条保持一致。
        hidden: !(roleSessionControlsEnabled && reasoningProfile.supportsReasoning),
        disabled: loading || chatSettingsReasoningSaving || !activeRole,
        onSelect: (anchor) => openReasoningPicker(anchor),
      },
    },

    'context-usage': {
      inline: (
        <Tooltip title={`上下文约 ${activeContextTokenUsageText}`}>
          <span>
            <Button aria-label={`上下文约 ${activeContextTokenUsageText}`} size="small" variant="text" sx={composerContextButtonSx}>
              {activeContextTokenUsageShortText}
            </Button>
          </span>
        </Tooltip>
      ),
      menuItem: {
        key: 'context-usage',
        label: `上下文约 ${activeContextTokenUsageText}`,
        // 只读信息行：留在菜单里仍然一行一个，但不充当操作。
        readOnly: true,
        onSelect: () => {},
      },
    },

    'cache-rate': {
      inline: (
        <Tooltip title={`缓存率 ${activeCacheRateText}`}>
          <span>
            <Button aria-label={`缓存率 ${activeCacheRateText}`} size="small" variant="text" sx={composerContextButtonSx}>
              {activeCacheRateText}
            </Button>
          </span>
        </Tooltip>
      ),
      menuItem: {
        key: 'cache-rate',
        label: `缓存率 ${activeCacheRateText}`,
        readOnly: true,
        onSelect: () => {},
      },
    },

    'async-tasks': {
      inline: (
        <Tooltip title="异步工具任务">
          <span>
            <Button
              aria-label="异步工具任务"
              onClick={(e) => openAsyncToolTasks(e.currentTarget)}
              disabled={!activeRole || !activeChat}
              size="small"
              variant="text"
              startIcon={<AutorenewIcon fontSize="small" />}
              sx={composerToolTextButtonSx}
            >
              异步 {activeAsyncToolTaskRunningCount}
            </Button>
          </span>
        </Tooltip>
      ),
      menuItem: {
        key: 'async-tasks',
        label: `异步工具任务：${activeAsyncToolTaskRunningCount}`,
        icon: <AutorenewIcon fontSize="small" />,
        disabled: !activeRole || !activeChat,
        onSelect: (anchor) => openAsyncToolTasks(anchor),
      },
    },

    'stream-toggle': {
      inline: (
        <Tooltip title={activeStreamOn ? '流式输出：已开启（本会话）' : '非流式：已关闭（本会话）'}>
          <span>
            <Button
              aria-label="切换会话流式输出"
              onClick={onToggleStream}
              disabled={streamButtonDisabled}
              size="small"
              variant="text"
              sx={{ ...composerToolTextButtonSx, width: 88, justifyContent: 'center', color: activeStreamOn ? 'primary.main' : 'text.secondary' }}
            >
              {activeStreamOn ? '流' : '非流'}
            </Button>
          </span>
        </Tooltip>
      ),
      menuItem: {
        key: 'stream-toggle',
        label: `流式输出：${activeStreamOn ? '已开启' : '已关闭'}`,
        disabled: streamButtonDisabled,
        onSelect: () => onToggleStream(),
      },
    },

    'clean-reasoning': {
      inline: (
        <Tooltip title="清洗思维链">
          <span>
            <IconButton
              aria-label="清洗思维链"
              onClick={onCleanReasoning}
              disabled={loading || !activeChat}
              size="small"
              sx={composerToolIconButtonSx}
            >
              <CleaningServicesIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ),
      menuItem: {
        key: 'clean-reasoning',
        label: '清洗思维链',
        icon: <CleaningServicesIcon fontSize="small" />,
        disabled: loading || !activeChat,
        onSelect: () => onCleanReasoning(),
      },
    },

    'global-prompts': promptLibraryEntry('global-prompts', 'global', '全局'),
    'role-prompts': promptLibraryEntry('role-prompts', 'role', '角色'),
    'workspace-prompts': promptLibraryEntry('workspace-prompts', 'workspace', '工作区'),
  }
}

/** 工具条直显节点：顺序完全由布局决定。 */
export function composerToolInlineNodes(
  layout: ComposerToolsLayout,
  entries: Record<ComposerToolId, ComposerToolEntry>,
): React.ReactNode[] {
  return layout.inline.map((id) => <React.Fragment key={id}>{entries[id].inline}</React.Fragment>)
}

/** 更多菜单条目：顺序由布局决定，当前不适用的一行不出现。 */
export function composerToolMenuItems(
  layout: ComposerToolsLayout,
  entries: Record<ComposerToolId, ComposerToolEntry>,
): MoreActionsMenuItem[] {
  return layout.menu.map((id) => entries[id].menuItem).filter((item) => !item.hidden)
}
