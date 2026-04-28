import { createBackendApi } from './nodeApi'
import { createHyperCortexBackendService } from './hypercortexService'
import { startDirectServer } from './directServer'

const api = createBackendApi()
const service = createHyperCortexBackendService(api)

async function main() {
  await service.warmup()
  await startDirectServer({
    serviceName: 'hypercortex-backend',
    handleRequest: (method, params) => service.dispatch(method, params),
  })
}

main().catch(error => {
  process.stderr.write(`[hypercortex-backend] fatal ${String(error?.message || error)}\n`)
  process.exit(1)
})
