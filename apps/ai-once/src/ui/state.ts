import type { AppData, DataDirStatus, DraftImage, FwLaunchInfo, HistoryEntry } from '../types'
import { DEFAULT_LAUNCH_INFO } from '../shared/aiOnceDomain'

export type AiOnceView = 'spaces' | 'workbench'
export type AiOnceDialog = '' | 'settings' | 'templates' | 'space' | 'app-settings'
export type AiOncePhase = 'starting' | 'ready' | 'failed'

export type AiOnceUiState = {
  launchInfo: FwLaunchInfo
  initialCommand: string
  runtimeCommand: string
  dataDirStatus: DataDirStatus | null
  data: AppData | null
  history: HistoryEntry[]
  historyCursorId: string
  health: Record<string, unknown> | null
  phase: AiOncePhase
  view: AiOnceView
  spaceId: string
  dialog: AiOnceDialog
  prompt: string
  answer: string
  images: DraftImage[]
  modelDraft: string
  customModel: string
  busy: boolean
  error: string
  editing: AppData | null
  spaceName: string
  spaceRename: { open: boolean; id: string; name: string }
  confirmDeleteSpace: { open: boolean; id: string; name: string }
}

export function createAiOnceUiState(): AiOnceUiState {
  return {
    launchInfo: { ...DEFAULT_LAUNCH_INFO },
    initialCommand: '',
    runtimeCommand: '',
    dataDirStatus: null,
    data: null,
    history: [],
    historyCursorId: '',
    health: null,
    phase: 'starting',
    view: 'spaces',
    spaceId: '',
    dialog: '',
    prompt: '',
    answer: '',
    images: [],
    modelDraft: '',
    customModel: '',
    busy: false,
    error: '',
    editing: null,
    spaceName: '',
    spaceRename: { open: false, id: '', name: '' },
    confirmDeleteSpace: { open: false, id: '', name: '' },
  }
}
