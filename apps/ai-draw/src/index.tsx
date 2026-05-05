import { createV45AiDrawGateway } from './gateway/createV45AiDrawGateway'
import { mountAiDrawUi } from './ui/mount'

;(async function bootstrap() {
  const baseApi = (window as unknown as { fastWindow?: unknown }).fastWindow
  const gateway = await createV45AiDrawGateway(baseApi)
  mountAiDrawUi(gateway)
})().catch((error) => {
  console.error('[ai-draw] bootstrap failed', error)
  document.body.textContent = `AI 绘图启动失败：${String(error?.message || error)}`
})
