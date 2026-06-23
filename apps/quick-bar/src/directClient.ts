import { invoke } from '@tauri-apps/api/core'
import type { DirectClient } from './types'

class QuickBarDirectClient implements DirectClient {
  request = <T,>(method: string, params?: unknown): Promise<T> => {
    return invoke<T>('quick_bar_backend_request', { method, params: params ?? {} })
  }

  close = () => {}
}

export async function createDirectClient(): Promise<DirectClient> {
  return new QuickBarDirectClient()
}
