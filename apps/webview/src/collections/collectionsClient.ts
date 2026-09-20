import { Channel, invoke } from '@tauri-apps/api/core'
import { dataDirAssetUrl } from '../assetUrl'
import type { DataDirStatus, DirectClient, RequestOptions } from './types'

type ProgressFrame = { event?: string; payload?: unknown }

function abortError(): Error {
  return new Error('请求已取消')
}

class CollectionsDirectClient implements DirectClient {
  private dataDir: string | null = null
  private closed = false

  async open(): Promise<void> {
    const status = await invoke<DataDirStatus>('data_dir_status')
    if (!status?.writable) throw new Error(String(status?.error || '数据目录不可写'))
    this.dataDir = status.dataDir
  }

  request = async <T,>(method: string, params?: unknown, options?: RequestOptions): Promise<T> => {
    if (this.closed) throw new Error('收藏数据通道已关闭')
    if (options?.signal?.aborted) throw abortError()

    const onProgress = options?.onProgress
    const channel = new Channel<ProgressFrame>()
    if (onProgress) {
      channel.onmessage = frame => {
        try {
          onProgress(String(frame?.event || ''), frame?.payload)
        } catch {
          // 进度处理异常不影响最终结果。
        }
      }
    }

    const result = await invoke<T>('collections_request', {
      method,
      params: params ?? {},
      onProgress: channel,
    })
    if (options?.signal?.aborted) throw abortError()
    return result
  }

  assetUrl = (assetId: string): string => {
    if (!this.dataDir) throw new Error('数据目录尚未就绪')
    return dataDirAssetUrl(this.dataDir, assetId)
  }

  close = () => {
    this.closed = true
  }
}

export async function createCollectionsClient(): Promise<DirectClient> {
  const client = new CollectionsDirectClient()
  try {
    await client.open()
    return client
  } catch (error) {
    client.close()
    throw error
  }
}
