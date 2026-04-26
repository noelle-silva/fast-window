import PluginFrameView from './PluginFrameView'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
import { resolveLegacyPluginRuntimeProfile } from './pluginProfiles'
import { buildPluginSdkCode } from './pluginSandbox'

type Props = {
  pluginId: string
  pluginCode: string
  apiVersion: PluginApiVersion
  requires?: PluginCapability[]
  onBack: () => void
}

export default function IframePluginView(props: Props) {
  const { pluginId, apiVersion } = props
  const runtimeProfile = resolveLegacyPluginRuntimeProfile(apiVersion)
  return (
    <PluginFrameView
      {...props}
      runtime="ui"
      runtimeProfile={runtimeProfile}
      buildSdkCode={token => buildPluginSdkCode({ pluginId, token, runtime: 'ui', apiVersion, sdkProfile: runtimeProfile.sdkProfile, exposeMeta: runtimeProfile.exposeMeta })}
    />
  )
}
