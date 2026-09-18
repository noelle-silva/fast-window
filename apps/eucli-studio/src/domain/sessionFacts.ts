import {
  HOOK_PROMPT_SESSION_METADATA_KEY,
  HOOK_PROMPT_SESSION_METADATA_MODE_KEY,
  normalizeHookPromptSelection,
  type HookPromptSelectionMode,
} from './hookPrompt'
import { normalizeChatModelOverride, normalizeModelRef, type ModelRef } from './modelRefUtils'
import { normalizeReasoningEffort, type ReasoningEffort } from './reasoning'

export type SessionUiFacts = {
  streamEnabled?: false
  reasoningEffort?: ReasoningEffort
  modelOverride?: ModelRef
  hookPromptMode?: Exclude<HookPromptSelectionMode, 'inherit'>
  hookPromptPresetId?: string
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function streamDisabledFromMetadata(metadata: Record<string, unknown>) {
  return typeof metadata.streamEnabled === 'string' && metadata.streamEnabled.trim() === 'false'
}

function modelOverrideFromMetadata(metadata: Record<string, unknown>) {
  return normalizeModelRef({
    kind: metadata['modelOverride.kind'],
    providerId: metadata['modelOverride.providerId'],
    groupId: metadata['modelOverride.groupId'],
    modelId: metadata['modelOverride.modelId'],
  })
}

function hookPromptSelectionFromMetadata(metadata: Record<string, unknown>) {
  return normalizeHookPromptSelection({
    mode: metadata[HOOK_PROMPT_SESSION_METADATA_MODE_KEY],
    presetId: metadata[HOOK_PROMPT_SESSION_METADATA_KEY],
  })
}

function applyHookPromptSelection(out: SessionUiFacts, selection: ReturnType<typeof normalizeHookPromptSelection>) {
  if (selection.mode === 'inherit') return
  out.hookPromptMode = selection.mode
  if (selection.mode === 'preset') out.hookPromptPresetId = selection.presetId
}

function directHookPromptSelection(source: Record<string, unknown>) {
  if (!hasOwn(source, 'hookPromptMode') && !hasOwn(source, 'hookPromptPresetId')) return null
  if (typeof source.hookPromptMode === 'string' && source.hookPromptMode.trim() === 'inherit') return { mode: 'inherit' as const, presetId: '' }
  const selection = normalizeHookPromptSelection(source)
  return selection.mode === 'inherit' ? null : selection
}

function directModelOverride(source: Record<string, unknown>): ModelRef | null | undefined {
  if (!hasOwn(source, 'modelOverride')) return undefined
  if (source.modelOverride === undefined) return undefined
  if (source.modelOverride === null) return null
  return normalizeChatModelOverride(source) || undefined
}

export function normalizeSessionFacts(raw: unknown): SessionUiFacts {
  const source = objectValue(raw)
  const metadata = objectValue(source.metadata)
  const out: SessionUiFacts = {}

  const directStreamEnabled = typeof source.streamEnabled === 'boolean' ? source.streamEnabled : undefined
  const streamEnabled = directStreamEnabled === undefined
    ? streamDisabledFromMetadata(metadata)
    : directStreamEnabled === false
  if (streamEnabled) out.streamEnabled = false

  const directReasoningClear = typeof source.reasoningEffort === 'string' && source.reasoningEffort.trim() === ''
  const reasoningEffort = directReasoningClear
    ? ''
    : normalizeReasoningEffort(source.reasoningEffort) || normalizeReasoningEffort(metadata.reasoningEffort)
  if (reasoningEffort) out.reasoningEffort = reasoningEffort

  const directModelOverrideValue = directModelOverride(source)
  const modelOverride = directModelOverrideValue === undefined ? modelOverrideFromMetadata(metadata) : directModelOverrideValue
  if (modelOverride) out.modelOverride = modelOverride

  const hookPromptSelection = directHookPromptSelection(source) || hookPromptSelectionFromMetadata(metadata)
  applyHookPromptSelection(out, hookPromptSelection)

  return out
}
