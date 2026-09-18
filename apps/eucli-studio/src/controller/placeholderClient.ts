import {
  normalizePlaceholderDependencyNode,
  normalizePlaceholderLibrary,
  normalizePlaceholderProblems,
  normalizePlaceholderResolveResult,
  type PlaceholderDependencyNode,
  type PlaceholderLibrary,
  type PlaceholderProblem,
  type PlaceholderResolveResult,
} from '../domain/placeholder'

type EbNetRequest = (req: any) => Promise<any>

function text(value: unknown) {
  return String(value ?? '').trim()
}

export async function loadPlaceholderLibrary(netRequest: EbNetRequest): Promise<PlaceholderLibrary> {
  const response = await netRequest({ method: 'GET', path: '/api/placeholders', timeoutMs: 15000 })
  return normalizePlaceholderLibrary(response?.body)
}

export async function savePlaceholderLibrary(netRequest: EbNetRequest, library: PlaceholderLibrary): Promise<PlaceholderLibrary> {
  const response = await netRequest({ method: 'PUT', path: '/api/placeholders', body: normalizePlaceholderLibrary(library), timeoutMs: 15000 })
  return normalizePlaceholderLibrary(response?.body)
}

export async function previewPlaceholders(netRequest: EbNetRequest, value: string): Promise<PlaceholderResolveResult> {
  const response = await netRequest({ method: 'POST', path: '/api/placeholders/preview', body: { text: String(value ?? '') }, timeoutMs: 15000 })
  return normalizePlaceholderResolveResult(response?.body)
}

export async function loadPlaceholderProblems(netRequest: EbNetRequest): Promise<PlaceholderProblem[]> {
  const response = await netRequest({ method: 'GET', path: '/api/placeholders/problems', timeoutMs: 15000 })
  return normalizePlaceholderProblems(response?.body)
}

export async function loadPlaceholderDependencies(netRequest: EbNetRequest, name: string): Promise<PlaceholderDependencyNode> {
  const clean = text(name)
  if (!clean) return { name: '' }
  const response = await netRequest({ method: 'GET', path: `/api/placeholders/dependencies/${encodeURIComponent(clean)}`, timeoutMs: 15000 })
  return normalizePlaceholderDependencyNode(response?.body)
}
