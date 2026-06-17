import { capabilityResultText, commandCapabilityConfig, invokeAppCapability } from './appCapabilities'
import type { AppLaunchOptions } from './appLauncher'
import type { RegisteredApp, RegisteredAppCapabilitySelection } from './types'

type ActivateAppCapabilityRequest = {
  app: RegisteredApp
  capability: RegisteredAppCapabilitySelection
  query: string
  launchOptions?: AppLaunchOptions
}

export async function activateAppCapability({ app, capability, query, launchOptions }: ActivateAppCapabilityRequest): Promise<string> {
  const result = await invokeAppCapability({
    app,
    capabilityId: capability.capabilityId,
    input: { text: query },
    config: commandCapabilityConfig({ ...capability, id: capability.capabilityId }),
    launchOptions,
  })
  const text = capabilityResultText(result.response)
  return `能力返回：${text}`
}
