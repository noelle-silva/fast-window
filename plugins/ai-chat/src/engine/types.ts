export type AiChatTargetKind = 'role' | 'group'

export type AiChatRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export type AiChatHttpRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export type AiChatHttpResponse = {
  status: number
  body: string
}

export type AiChatHttpStreamEvent =
  | { type: 'start'; status?: number }
  | { type: 'chunk'; text?: string }
  | { type: 'end' }
  | { type: 'error'; message?: string }

export type AiChatHttpStream = AsyncIterable<AiChatHttpStreamEvent> & {
  cancel?: () => Promise<void>
  return?: () => Promise<IteratorResult<AiChatHttpStreamEvent>>
  next?: () => Promise<IteratorResult<AiChatHttpStreamEvent>>
}

export type AiChatNetAdapter = {
  request: (req: AiChatHttpRequest) => Promise<AiChatHttpResponse>
  requestStream?: (req: AiChatHttpRequest) => Promise<AiChatHttpStream>
}

export type AiChatRuntimeDirEntry = {
  name?: string
  isFile?: boolean
  isDirectory?: boolean
}

export type AiChatRuntimeStore = {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
  remove: (key: string) => Promise<void>
  listDir?: (runtimeDirKey: string) => Promise<AiChatRuntimeDirEntry[]>
}

export type AiChatRunTarget = {
  kind: AiChatTargetKind
  roleId?: string
  groupId?: string
  chatId: string
  branchId: string
  assistantMid: string
}

export type AiChatRun = {
  id: string
  status: AiChatRunStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number

  owner?: string
  scopeKey: string
  scopeLockKey: string

  stream: boolean
  req: AiChatHttpRequest
  target: AiChatRunTarget

  cancelRequestedAt?: number
  lastError?: { message: string }
}

export type AiChatRunProgress = {
  text: string
  updatedAt: number
}

