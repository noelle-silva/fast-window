import { createWorkerRequestHandler } from './dispatch'
import { isWorkerRequest, readWorkerRequestId, toWorkerError, type WorkerResponse } from './protocol'

// ============================================================================
// Worker 入口：只负责监听、校验、回传。
// 真正计算与协议路由分别由 compute.ts / dispatch.ts 承担。
// ============================================================================

type WorkerScope = {
  addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void
  postMessage: (message: WorkerResponse) => void
}

const scope = self as unknown as WorkerScope
const handleRequest = createWorkerRequestHandler()

scope.addEventListener('message', (event) => {
  const request = event.data

  if (!isWorkerRequest(request)) {
    const id = readWorkerRequestId(request)
    if (id !== null) {
      scope.postMessage({
        id,
        ok: false,
        error: { name: 'ProtocolError', message: '无法识别的 Worker 请求' },
      })
    }
    return
  }

  try {
    scope.postMessage(handleRequest(request))
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: toWorkerError(error) })
  }
})
