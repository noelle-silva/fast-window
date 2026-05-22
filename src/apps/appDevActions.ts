import { invoke } from '@tauri-apps/api/core'
import type { AppStopResult } from './types'

export type AppDevStageResult = {
  appId: string
  stopResult: AppStopResult
  command: string[]
}

export async function stageV5AppDev(appId: string): Promise<AppDevStageResult> {
  return invoke<AppDevStageResult>('app_dev_stage_v5', { appId })
}
