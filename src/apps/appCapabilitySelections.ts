import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { APP_STORAGE_ID } from '../constants'
import type { AppCapabilityConfigField, AppCapabilityDescriptor, RegisteredAppCapabilitySelection } from './types'

const CAPABILITY_SELECTIONS_KEY = 'registeredAppCapabilities'

type CapabilitySelectionPatch = Partial<Omit<RegisteredAppCapabilitySelection, 'appId' | 'capabilityId'>>

export function capabilitySelectionKey(appId: string, capabilityId: string): string {
  return `${appId}:${capabilityId}`
}

export function capabilityDescriptorToSelection(appId: string, capability: AppCapabilityDescriptor): RegisteredAppCapabilitySelection {
  return normalizeCapabilitySelection({
    appId,
    capabilityId: capability.id,
    title: capability.title,
    icon: capability.icon,
    description: capability.description,
    configFields: capability.configFields,
    config: capability.config,
  })
}

export async function loadCapabilitySelections(): Promise<RegisteredAppCapabilitySelection[]> {
  const raw = await invoke<unknown | null>('storage_get', {
    pluginId: APP_STORAGE_ID,
    key: CAPABILITY_SELECTIONS_KEY,
  }).catch(() => null)
  if (!Array.isArray(raw)) return []
  return normalizeCapabilitySelections(raw)
}

export async function saveCapabilitySelections(selections: RegisteredAppCapabilitySelection[]): Promise<void> {
  await invoke('storage_set', {
    pluginId: APP_STORAGE_ID,
    key: CAPABILITY_SELECTIONS_KEY,
    value: normalizeCapabilitySelections(selections),
  })
}

export function useAppCapabilitySelections() {
  const [selections, setSelections] = useState<RegisteredAppCapabilitySelection[]>([])

  const load = useCallback(async () => {
    setSelections(await loadCapabilitySelections())
  }, [])

  const save = useCallback(async (next: RegisteredAppCapabilitySelection[]) => {
    const normalized = normalizeCapabilitySelections(next)
    await saveCapabilitySelections(normalized)
    setSelections(normalized)
  }, [])

  const upsert = useCallback(async (selection: RegisteredAppCapabilitySelection) => {
    const normalized = normalizeCapabilitySelection(selection)
    const key = capabilitySelectionKey(normalized.appId, normalized.capabilityId)
    let found = false
    const next = selections.map(item => {
      if (capabilitySelectionKey(item.appId, item.capabilityId) !== key) return item
      found = true
      return normalized
    })
    if (!found) next.push(normalized)
    await save(next)
  }, [save, selections])

  const update = useCallback(async (appId: string, capabilityId: string, patch: CapabilitySelectionPatch) => {
    const key = capabilitySelectionKey(appId, capabilityId)
    await save(selections.map(item => {
      if (capabilitySelectionKey(item.appId, item.capabilityId) !== key) return item
      return normalizeCapabilitySelection({ ...item, ...patch })
    }))
  }, [save, selections])

  const remove = useCallback(async (appId: string, capabilityId: string) => {
    const key = capabilitySelectionKey(appId, capabilityId)
    await save(selections.filter(item => capabilitySelectionKey(item.appId, item.capabilityId) !== key))
  }, [save, selections])

  return { selections, load, upsert, update, remove }
}

function normalizeCapabilitySelections(values: unknown[]): RegisteredAppCapabilitySelection[] {
  const seen = new Set<string>()
  const selections: RegisteredAppCapabilitySelection[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const selection = normalizeCapabilitySelection(value as RegisteredAppCapabilitySelection)
    if (!selection.appId || !selection.capabilityId || !selection.title) continue
    const key = capabilitySelectionKey(selection.appId, selection.capabilityId)
    if (seen.has(key)) continue
    seen.add(key)
    selections.push(selection)
  }
  return selections
}

function normalizeCapabilitySelection(selection: RegisteredAppCapabilitySelection): RegisteredAppCapabilitySelection {
  const config = recordOrUndefined(selection.config)
  return {
    appId: text(selection.appId),
    capabilityId: text(selection.capabilityId),
    title: text(selection.title),
    icon: optionalText(selection.icon),
    description: optionalText(selection.description),
    configFields: normalizeConfigFields(selection.configFields),
    config,
  }
}

function normalizeConfigFields(fields: AppCapabilityConfigField[] | undefined): AppCapabilityConfigField[] | undefined {
  if (!Array.isArray(fields)) return undefined
  const normalized = fields
    .map(field => ({ id: text(field.id), label: text(field.label), optionSource: text(field.optionSource) }))
    .filter(field => field.id && field.label && field.optionSource)
  return normalized.length ? normalized : undefined
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return { ...(value as Record<string, unknown>) }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value)
  return normalized || undefined
}
