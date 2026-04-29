import { createAiChatBackend } from './createAiChatBackend'

createAiChatBackend().catch((error) => {
  process.stderr.write(`[ai-chat-backend] ${String(error?.stack || error?.message || error)}\n`)
  process.exit(1)
})
