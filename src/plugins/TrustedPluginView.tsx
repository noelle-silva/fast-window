import PluginFrameView from './PluginFrameView'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
import { TRUSTED_PLUGIN_RUNTIME_PROFILE } from './pluginProfiles'
import { buildPluginSdkCode } from './pluginSandbox'

type Props = {
  pluginId: string
  pluginCode: string
  apiVersion: PluginApiVersion
  requires?: PluginCapability[]
  onBack: () => void
}

export default function TrustedPluginView(props: Props) {
  return (
    <PluginFrameView
      {...props}
      runtime="ui"
      runtimeProfile={TRUSTED_PLUGIN_RUNTIME_PROFILE}
      buildSdkCode={token => buildPluginSdkCode({ pluginId: props.pluginId, token, runtime: 'ui', apiVersion: props.apiVersion, sdkProfile: TRUSTED_PLUGIN_RUNTIME_PROFILE.sdkProfile, exposeMeta: TRUSTED_PLUGIN_RUNTIME_PROFILE.exposeMeta })}
    />
  )
}
