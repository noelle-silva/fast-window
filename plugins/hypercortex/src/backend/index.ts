import { createBackendApi } from './nodeApi'
import { createHyperCortexBackendService } from './hypercortexService'
import { sendReady, startRpcServer } from './rpcServer'

const api = createBackendApi()
const service = createHyperCortexBackendService(api)

async function main() {
  startRpcServer((method, params) => service.dispatch(method, params))
  await service.warmup()
  sendReady()
}

main().catch(error => {
  process.stderr.write(`[hypercortex-backend] fatal ${String(error?.message || error)}\n`)
  process.exit(1)
})
