import { capabilityResultText, commandCapabilityConfig, invokeAppCapability } from './appCapabilities'
import type { RegisteredApp, RegisteredAppCommand } from './types'

type ActivateAppCapabilityRequest = {
  app: RegisteredApp
  command: RegisteredAppCommand
  query: string
}

export async function activateAppCapability({ app, command, query }: ActivateAppCapabilityRequest): Promise<string> {
  const result = await invokeAppCapability({
    app,
    capabilityId: command.id,
    input: { text: query },
    config: commandCapabilityConfig(command),
  })
  const text = capabilityResultText(result.response)
  return `能力返回：${text}`
}
