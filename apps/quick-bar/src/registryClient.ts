import type { DirectClient, RegistryButton } from './types'

export type AddRegistryButtonInput = {
  app: Record<string, unknown>
  appId: string
  capabilityId: string
  title: string
  config: Record<string, unknown>
}

export function fetchRegistryButtons(client: DirectClient): Promise<RegistryButton[]> {
  return client.request<RegistryButton[]>('quickBar.registry.list')
}

export function addRegistryButton(client: DirectClient, input: AddRegistryButtonInput): Promise<RegistryButton> {
  return client.request<RegistryButton>('quickBar.registry.add', input)
}
