import { createV2AiDrawGateway } from './gateway/createV2AiDrawGateway'
import { runAiDrawBackground } from './background/runBackground'
import { mountAiDrawUi } from './ui/mount'

;(function bootstrap() {
  const baseApi = (window as unknown as { fastWindow?: unknown }).fastWindow
  const gateway = createV2AiDrawGateway(baseApi, 'ai-draw')

  if (gateway.runtime === 'background') {
    runAiDrawBackground(gateway)
    return
  }

  mountAiDrawUi(gateway)
})()

