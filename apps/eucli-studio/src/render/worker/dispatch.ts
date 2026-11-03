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

export function createWorkerRequestHandler(computer: MarkdownComputer = createMarkdownComputer()): WorkerRequestHandler {
  function parseItem(item: WorkerParseBatchItem): WorkerItemResult<WorkerParseResult> {
    try {
      return { key: item.key, ok: true, value: { html: computer.renderMarkdown(item.source) } }
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
          return {
            id: request.id,
            type: 'parse',
            ok: true,
            result: { html: computer.renderMarkdown(request.source) },
          }
        } catch (error) {
          return { id: request.id, ok: false, error: toWorkerError(error) }
        }

      case 'parse-batch': {
        const result: WorkerParseBatchResult = { items: request.items.map(parseItem) }
        return { id: request.id, type: 'parse-batch', ok: true, result }
      }

      case 'math-batch': {
        const result: WorkerMathBatchResult = { items: request.items.map(mathItem) }
        return { id: request.id, type: 'math-batch', ok: true, result }
      }
    }
  }
}
