import { createMarkdownComputer, type MarkdownComputer } from './compute'
import {
  WORKER_PROTOCOL_VERSION,
  toWorkerError,
  type WorkerItemResult,
  type WorkerMathBatchItem,
  type WorkerMathBatchResult,
  type WorkerMathResult,
  type WorkerParseBatchItem,
  type WorkerParseBatchResult,
  type WorkerParseResult,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'

// ============================================================================
// 请求分发：只负责按协议路由与失败封装，不持有任何线程/全局状态。
// 与 Worker 入口拆开，便于在普通测试进程内直接验证协议行为。
// ============================================================================

export type WorkerRequestHandler = (request: WorkerRequest) => WorkerResponse

function createStickerPathLookup(paths: Record<string, string> | undefined) {
  if (!paths) return undefined
  return (category: string, name: string): string => {
    const relPath = paths[`${category}/${name}`]
    return typeof relPath === 'string' ? relPath : ''
  }
}

export function createWorkerRequestHandler(computer: MarkdownComputer = createMarkdownComputer()): WorkerRequestHandler {
  function parseItem(
    item: WorkerParseBatchItem,
    options?: { stickersEnabled: boolean; getStickerPath?: (category: string, name: string) => string },
  ): WorkerItemResult<WorkerParseResult> {
    try {
      return { key: item.key, ok: true, value: { html: computer.renderMarkdown(item.source, options) } }
    } catch (error) {
      return { key: item.key, ok: false, error: toWorkerError(error) }
    }
  }

  function mathItem(item: WorkerMathBatchItem): WorkerItemResult<WorkerMathResult> {
    try {
      return { key: item.key, ok: true, value: { html: computer.renderMath(item.tex, item.display) } }
    } catch (error) {
      return { key: item.key, ok: false, error: toWorkerError(error) }
    }
  }

  return (request: WorkerRequest): WorkerResponse => {
    switch (request.type) {
      case 'ping':
        return {
          id: request.id,
          type: 'ping',
          ok: true,
          result: { protocolVersion: WORKER_PROTOCOL_VERSION },
        }

      case 'parse':
        try {
          // 旧调用没有可选字段时，等价于只用 source 的既有行为。
          const hasOptions = request.stickersEnabled !== undefined || request.stickerPaths !== undefined
          const html = hasOptions
            ? computer.renderMarkdown(request.source, {
                stickersEnabled: !!request.stickersEnabled,
                getStickerPath: createStickerPathLookup(request.stickerPaths),
              })
            : computer.renderMarkdown(request.source)
          return {
            id: request.id,
            type: 'parse',
            ok: true,
            result: { html },
          }
        } catch (error) {
          return { id: request.id, ok: false, error: toWorkerError(error) }
        }

      case 'parse-batch': {
        const hasOptions = request.stickersEnabled !== undefined || request.stickerPaths !== undefined
        const options = hasOptions
          ? {
              stickersEnabled: !!request.stickersEnabled,
              getStickerPath: createStickerPathLookup(request.stickerPaths),
            }
          : undefined
        const result: WorkerParseBatchResult = { items: request.items.map((item) => parseItem(item, options)) }
        return { id: request.id, type: 'parse-batch', ok: true, result }
      }

      case 'math-batch': {
        const result: WorkerMathBatchResult = { items: request.items.map(mathItem) }
        return { id: request.id, type: 'math-batch', ok: true, result }
      }
    }
  }
}
