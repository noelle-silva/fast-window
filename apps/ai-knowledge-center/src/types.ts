export type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

export type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

export type ConnectionSettings = {
  schemaVersion: number
  dataVersion: number
  serverBaseUrl: string
  defaultServerBaseUrl: string
  hasServerKey: boolean
  updatedAt: string
}

export type HealthResponse = {
  status?: string
  service?: string
  started_at?: string
  now?: string
}

export type DocumentStatus = 'all' | 'active' | 'archived' | 'trashed'

export type DocumentSummary = {
  id: string
  name: string
  description: string
  tags: string[]
  references: string[]
  status: DocumentStatus
  created_at: string
  updated_at: string
  archived_at?: string
  deleted_at?: string
  trash_cleanup_after?: string
  relative_path: string
}

export type DocumentMetadata = DocumentSummary & {
  folder_name: string
  content_file: string
  metadata_file: string
  content_sha256: string
  previous_status?: DocumentStatus
}

export type DocumentRecord = {
  metadata: DocumentMetadata
  content: string
}

export type CollectionSummary = {
  id: string
  name: string
  description: string
  tags: string[]
  document_ids: string[]
  child_collection_ids: string[]
  created_at: string
  updated_at: string
}

export type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  close(): void
}

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}
