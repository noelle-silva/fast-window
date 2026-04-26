import PluginFrameView from './PluginFrameView'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
import { resolveLegacyPluginRuntimeProfile } from './pluginProfiles'
import { buildPluginSdkCode } from './pluginSandbox'

type Props = {
  pluginId: string
  pluginCode: string
  apiVersion: PluginApiVersion
  requires?: PluginCapability[]
}

export default function BackgroundPluginHost(props: Props) {
  const { pluginId, apiVersion } = props
  const runtimeProfile = resolveLegacyPluginRuntimeProfile(apiVersion)

  return (
    <PluginFrameView
      {...props}
      runtime="background"
      runtimeProfile={runtimeProfile}
      title={`bg-${pluginId}`}
      hidden
      buildSdkCode={token => buildPluginSdkCode({ pluginId, token, runtime: 'background', apiVersion, sdkProfile: runtimeProfile.sdkProfile, exposeMeta: runtimeProfile.exposeMeta })}
    />
  )
}
