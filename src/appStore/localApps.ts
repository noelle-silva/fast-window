import { invoke } from '@tauri-apps/api/core'

export type StoreAppStateKind = 'notInstalled' | 'installed' | 'broken'

export interface StoreAppState {
  id: string
  state: StoreAppStateKind
  version?: string
}

/**
 * 商店页本地状态：由后端「商店应用状态」判定唯一给出三态结论。
 * - notInstalled：无对应注册记录。
 * - installed：已注册且可用，携带版本。
 * - broken：有注册记录但应用文件已丢失。
 */
export async function loadStoreAppStates(
  storeIds: readonly string[],
): Promise<Map<string, StoreAppState>> {
  const states = await invoke<StoreAppState[]>('inspect_store_app_states', {
    storeIds: [...storeIds],
  })
  const out = new Map<string, StoreAppState>()
  for (const state of states) out.set(state.id, state)
  return out
}
