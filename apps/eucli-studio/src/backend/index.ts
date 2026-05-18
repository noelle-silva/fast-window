import { createAiChatBackend } from './createAiChatBackend'

createAiChatBackend().catch((error) => {
  process.stderr.write(`[ai-studio-backend] ${String(error?.stack || error?.message || error)}\n`)
  process.exit(1)
})
