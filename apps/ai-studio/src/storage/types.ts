export type AiChatPersistentStorageAdapter = {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  getAll?(): Promise<Record<string, unknown>>
}

export type AiChatRuntimeStorageAdapter = {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  listDir(runtimeDirKey: string): Promise<Array<{ name?: string; isFile?: boolean; isDirectory?: boolean }>>
  flush?(): Promise<void>
}

export type AiChatImageStorageAdapter = {
  writeBase64(req: unknown): Promise<unknown>
  read(req: unknown): Promise<unknown>
  delete(req: unknown): Promise<unknown>
}
