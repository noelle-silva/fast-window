import PluginFrameView from './PluginFrameView'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
import { buildPluginSdkCode } from './pluginSandbox'

type Props = {
  pluginId: string
  pluginCode: string
  apiVersion: PluginApiVersion
  requires?: PluginCapability[]
}

export default function BackgroundPluginHost(props: Props) {
  const { pluginId, apiVersion } = props

  return (
    <PluginFrameView
      {...props}
      runtime="background"
      title={`bg-${pluginId}`}
      hidden
      buildSdkCode={token => buildPluginSdkCode({ pluginId, token, runtime: 'background', apiVersion })}
    />
  )
}
