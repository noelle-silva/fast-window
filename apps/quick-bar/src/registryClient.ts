import type { DirectClient, RegistryButton } from './types'

export type AddRegistryButtonInput = {
  app: Record<string, unknown>
  appId: string
  capabilityId: string
  title: string
  config: Record<string, unknown>
}

export type UpdateRegistryButtonInput = {
  id: string
  title?: string
  config?: Record<string, unknown>
  enabled?: boolean
}

export function fetchRegistryButtons(client: DirectClient): Promise<RegistryButton[]> {
  return client.request<RegistryButton[]>('quickBar.registry.list')
}

export function addRegistryButton(client: DirectClient, input: AddRegistryButtonInput): Promise<RegistryButton> {
  return client.request<RegistryButton>('quickBar.registry.add', input)
}

export function updateRegistryButton(client: DirectClient, input: UpdateRegistryButtonInput): Promise<RegistryButton> {
  return client.request<RegistryButton>('quickBar.registry.update', input)
}

export function removeRegistryButton(client: DirectClient, id: string): Promise<{ ok: boolean }> {
  return client.request<{ ok: boolean }>('quickBar.registry.remove', { id })
}
