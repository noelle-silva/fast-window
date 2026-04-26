import PluginFrameView from './PluginFrameView'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
import { TRUSTED_PLUGIN_RUNTIME_PROFILE } from './pluginProfiles'
import { buildPluginSdkCode } from './pluginSandbox'

type Props = {
  pluginId: string
  pluginCode: string
  pluginMain: string
  apiVersion: PluginApiVersion
  requires?: PluginCapability[]
  onBack: () => void
}

function dirname(path: string) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index + 1) : ''
}

function encodeAssetDir(path: string) {
  return dirname(path)
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')
}

function buildPluginAssetBaseUrl(pluginId: string, main: string) {
  const dir = encodeAssetDir(main)
  return `plugin://asset/${encodeURIComponent(pluginId)}/${dir ? `${dir}/` : ''}`
}

export default function TrustedPluginView(props: Props) {
  return (
    <PluginFrameView
      {...props}
      runtime="ui"
      runtimeProfile={TRUSTED_PLUGIN_RUNTIME_PROFILE}
      assetBaseUrl={buildPluginAssetBaseUrl(props.pluginId, props.pluginMain)}
      buildSdkCode={token => buildPluginSdkCode({ pluginId: props.pluginId, token, runtime: 'ui', apiVersion: props.apiVersion, sdkProfile: TRUSTED_PLUGIN_RUNTIME_PROFILE.sdkProfile, exposeMeta: TRUSTED_PLUGIN_RUNTIME_PROFILE.exposeMeta })}
    />
  )
}
