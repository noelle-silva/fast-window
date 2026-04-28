import { createAiChatEngineBridge } from './gateway/engineBridge'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from './engine'

export function createAiChatRequestBridge(opts: {
  runtime: 'ui' | 'background'
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  streamKey: (assistantMid: string) => string
  onRunFinal: (run: AiChatRun, finalText: string) => Promise<void> | void
}) {
  const bridge = createAiChatEngineBridge({
    runtime: opts.runtime,
    store: opts.store,
    net: opts.net,
    streamKey: opts.streamKey,
    onRunFinal: opts.onRunFinal,
  })

  async function enqueue(spec: { target: AiChatRun['target']; req: AiChatRun['req']; stream: boolean }) {
    return bridge.enqueue(spec)
  }

  async function requestCancelByAssistantMid(assistantMid: string) {
    await bridge.cancelAssistant(assistantMid)
  }

  async function startBackgroundLoop(intervalMs = 350) {
    await bridge.startBackgroundLoop(intervalMs)
  }

  return { enqueue, requestCancelByAssistantMid, startBackgroundLoop, engineOwner: bridge.engineOwner }
}
