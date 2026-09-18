import { normalizePlaceholderLibrary, type PlaceholderLibrary } from '../domain/placeholder'
import { normalizeArtifactInstallState, type ArtifactInstallState } from '../domain/release'
import {
  normalizeAvailableSystemPluginPlaceholderInterfaces,
  normalizeSystemPluginDetail,
  normalizeSystemPluginSummaries,
  type SystemPluginAvailablePlaceholderInterface,
  type SystemPluginDetail,
  type SystemPluginSummary,
  type SystemPluginUserConfig,
} from '../domain/systemPlugin'

type EbNetRequest = (req: any) => Promise<any>

export async function loadSystemPlugins(netRequest: EbNetRequest): Promise<SystemPluginSummary[]> {
  const response = await netRequest({ method: 'GET', path: '/api/system-plugins', timeoutMs: 15000 })
  return normalizeSystemPluginSummaries(response?.body)
}

export async function loadSystemPlugin(netRequest: EbNetRequest, pluginId: string): Promise<SystemPluginDetail> {
  const response = await netRequest({ method: 'GET', path: `/api/system-plugins/${encodeURIComponent(pluginId)}`, timeoutMs: 15000 })
  return normalizeSystemPluginDetail(response?.body)
}

export async function saveSystemPluginUserConfig(netRequest: EbNetRequest, pluginId: string, config: SystemPluginUserConfig): Promise<SystemPluginDetail> {
  const response = await netRequest({ method: 'PUT', path: `/api/system-plugins/${encodeURIComponent(pluginId)}/user-config`, body: config || {}, timeoutMs: 15000 })
  return normalizeSystemPluginDetail(response?.body)
}

export async function loadAvailableSystemPluginPlaceholderInterfaces(netRequest: EbNetRequest): Promise<SystemPluginAvailablePlaceholderInterface[]> {
  const response = await netRequest({ method: 'GET', path: '/api/placeholders/plugin-interfaces', timeoutMs: 15000 })
  return normalizeAvailableSystemPluginPlaceholderInterfaces(response?.body)
}

export async function createPlaceholderFromSystemPluginInterface(netRequest: EbNetRequest, pluginId: string, interfaceId: string): Promise<PlaceholderLibrary> {
  const response = await netRequest({ method: 'POST', path: '/api/placeholders/plugin-interfaces', body: { pluginId, interfaceId }, timeoutMs: 15000 })
  return normalizePlaceholderLibrary(response?.body)
}

export async function loadSystemPluginInstallState(netRequest: EbNetRequest, pluginId: string): Promise<ArtifactInstallState> {
  const response = await netRequest({ method: 'GET', path: `/api/system-plugins/${encodeURIComponent(pluginId)}/install-state`, timeoutMs: 15000 })
  return normalizeArtifactInstallState(response?.body)
}

export async function installSystemPlugin(netRequest: EbNetRequest, pluginId: string): Promise<ArtifactInstallState> {
  const response = await netRequest({ method: 'POST', path: `/api/system-plugins/${encodeURIComponent(pluginId)}/install`, body: {}, timeoutMs: 180000 })
  return normalizeArtifactInstallState(response?.body)
}

export async function updateSystemPlugin(netRequest: EbNetRequest, pluginId: string): Promise<ArtifactInstallState> {
  const response = await netRequest({ method: 'POST', path: `/api/system-plugins/${encodeURIComponent(pluginId)}/update`, body: {}, timeoutMs: 180000 })
  return normalizeArtifactInstallState(response?.body)
}
