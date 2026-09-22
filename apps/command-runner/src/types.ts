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

export type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  onEvent(handler: RunEventHandler): () => void
  close(): void
}

export type RunEventHandler = (event: RunEvent) => void

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}

export type CustomShell = {
  id: string
  name: string
  exePath: string
  argsTemplate: string
}

export type ShellInfo = {
  id: string
  name: string
  builtin: boolean
  available: boolean
  exePath: string
  argsTemplate?: string
}

// PlaceholderValueMode 是占位符的取值方式：
// select 表示注册时预定义候选值、运行时从候选中选择；input 表示运行时现场填写。
export type PlaceholderValueMode = 'select' | 'input'

// Placeholder 是命令脚本中可引用的占位符：名称 + 取值方式 + 候选值。
// select 型运行时由弹窗从候选值中选定，input 型运行时现场填写（可留空，留空替换为空内容）；
// input 型的候选值仅作为切回 select 型时的草稿保留。
export type Placeholder = {
  name: string
  valueMode: PlaceholderValueMode
  values: string[]
}

export type Repo = {
  id: string
  name: string
  path: string
  shellId: string
  closeMode: string
  countdownSeconds: number
  runMode: CommandRunMode | ''
  processOwnership: ProcessOwnership
  // 仓库级占位符：作用域覆盖该仓库全部命令。
  placeholders: Placeholder[]
  createdAt: string
}

// PlaceholderSelection 是一次运行的占位符取值：占位符名称 -> 选定值。
export type PlaceholderSelection = Record<string, string>

// QuickRunPlaceholderSelection 是快捷运行的占位符取值：命令 id -> 该命令的占位符取值。
export type QuickRunPlaceholderSelection = Record<string, PlaceholderSelection>

// RepoDraft 是仓库创建/更新的提交草案。
export type RepoDraft = {
  name: string
  path: string
  closeMode: string
  countdownSeconds: number
  runMode: CommandRunMode | ''
  processOwnership: ProcessOwnership
  placeholders: Placeholder[]
}

export type CloseMode = 'keep-open' | 'countdown' | 'close-immediately'

export type CommandRunMode = 'console' | 'embedded'

export type ProcessOwnership = '' | 'detached' | 'attached'

export type CommandItem = {
  id: string
  repoId: string
  name: string
  script: string
  note: string
  confirmBeforeRun: boolean
  notifyOnComplete: boolean
  shellId: string
  closeMode: string
  countdownSeconds: number
  runMode: CommandRunMode | ''
  processOwnership: ProcessOwnership
  // 内置空间同时运行实例数上限；0 表示不限制。
  maxEmbeddedRuns: number
  // 命令级占位符：作用域仅限这条命令。
  placeholders: Placeholder[]
  createdAt: string
  updatedAt: string
}

export type CommandDraft = {
  repoId: string
  name: string
  script: string
  note: string
  confirmBeforeRun: boolean
  notifyOnComplete: boolean
  shellId: string
  closeMode: string
  countdownSeconds: number
  runMode: CommandRunMode | ''
  processOwnership: ProcessOwnership
  maxEmbeddedRuns: number
  placeholders: Placeholder[]
}

export type RunEvent = {
  name: 'run.started' | 'run.output' | 'run.ended'
  runId: string
  commandId?: string
  repoId?: string
  commandName?: string
  startedAt?: string
  text?: string
  stream?: 'stdout' | 'stderr'
  exitCode?: number
}

export type RunInfo = {
  runId: string
  commandId: string
  repoId: string
  commandName: string
  startedAt: string
}

// 收藏夹树节点：只有收藏夹会出现在 nodes 中（含每个仓库的隐式根节点，根节点 id = repoId）；
// children 里不在 nodes 中的 id 即命令引用。
export type CollectionNode = {
  id: string
  repoId: string
  type: string
  name: string
  children: string[]
  createdAt: string
  updatedAt: string
}

export type CollectionsDoc = {
  nodes: Record<string, CollectionNode>
}

// 快捷运行条目：名称 + 有序的命令引用列表（全局组合，跨仓库）。
export type QuickRun = {
  id: string
  name: string
  commandIds: string[]
  createdAt: string
  updatedAt: string
}

export type QuickRunStartedItem = {
  commandId: string
  commandName: string
  runId?: string
}

export type QuickRunFailureItem = {
  commandId: string
  commandName: string
  error: string
}

export type QuickRunRunResult = {
  started: QuickRunStartedItem[]
  failures: QuickRunFailureItem[]
}

export type AppSettings = {
  schemaVersion: number
  dataVersion: number
  defaultShellId: string
  defaultCloseMode: string
  defaultCountdownSeconds: number
  defaultRunMode: CommandRunMode
  defaultProcessOwnership: ProcessOwnership
  customShells: CustomShell[]
  updatedAt: string
}
