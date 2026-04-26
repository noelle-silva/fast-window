import {
  SYSTEM_BACKEND_PLUGIN_API_VERSION,
  TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
  type PluginApiVersion,
} from './pluginContract'

export type PluginRpcProfile = 'v2' | 'v3' | 'v4'
export type PluginSdkProfile = 'legacy' | 'v3' | 'v4'

export type PluginRuntimeProfile = {
  rpcProfile: PluginRpcProfile
  sdkProfile: PluginSdkProfile
  exposeMeta: boolean
}

export const TRUSTED_PLUGIN_RUNTIME_PROFILE: PluginRuntimeProfile = {
  rpcProfile: 'v4',
  sdkProfile: 'v4',
  exposeMeta: false,
}

export function resolveLegacyPluginRpcProfile(apiVersion: PluginApiVersion): PluginRpcProfile {
  return apiVersion >= SYSTEM_BACKEND_PLUGIN_API_VERSION ? 'v3' : 'v2'
}

export function resolveLegacyPluginSdkProfile(apiVersion: PluginApiVersion): PluginSdkProfile {
  return apiVersion >= SYSTEM_BACKEND_PLUGIN_API_VERSION ? 'v3' : 'legacy'
}

export function usesSystemBackend(apiVersion: PluginApiVersion | number | undefined): boolean {
  return Number(apiVersion ?? 2) >= SYSTEM_BACKEND_PLUGIN_API_VERSION
}

export function isTrustedLocalApp(apiVersion: PluginApiVersion | number | undefined): boolean {
  return Number(apiVersion ?? 2) >= TRUSTED_LOCAL_APP_PLUGIN_API_VERSION
}

export function resolveLegacyPluginRuntimeProfile(apiVersion: PluginApiVersion): PluginRuntimeProfile {
  return {
    rpcProfile: resolveLegacyPluginRpcProfile(apiVersion),
    sdkProfile: resolveLegacyPluginSdkProfile(apiVersion),
    exposeMeta: true,
  }
}

export function resolvePluginRuntimeProfile(apiVersion: PluginApiVersion): PluginRuntimeProfile {
  return isTrustedLocalApp(apiVersion) ? TRUSTED_PLUGIN_RUNTIME_PROFILE : resolveLegacyPluginRuntimeProfile(apiVersion)
}
