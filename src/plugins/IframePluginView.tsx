import PluginFrameView from './PluginFrameView'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
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
  return (
    <PluginFrameView
      {...props}
      runtime="ui"
      buildSdkCode={token => buildPluginSdkCode({ pluginId, token, runtime: 'ui', apiVersion })}
    />
  )
}
