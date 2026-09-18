export const TAURI_CONFIG_ENV = 'TAURI_CONFIG'
export const HOST_PROFILE_ENV = 'FAST_WINDOW_HOST_PROFILE'
export const HOST_VITE_PROFILE_ENV = 'VITE_FAST_WINDOW_HOST_PROFILE'
export const HOST_PROFILE_DEV = 'dev'
export const HOST_PROFILE_RELEASE = 'release'

export function withHostProfileEnv(env = process.env, profile) {
  return {
    ...env,
    [HOST_PROFILE_ENV]: profile,
    [HOST_VITE_PROFILE_ENV]: profile,
  }
}

export function hostDevProfileEnv(env = process.env) {
  return withHostProfileEnv(env, HOST_PROFILE_DEV)
}

export function hostReleaseProfileEnv(env = process.env) {
  return withHostProfileEnv(env, HOST_PROFILE_RELEASE)
}

export function tauriBuildEnvWithoutExternalConfig(env = process.env) {
  const next = { ...env }
  delete next[TAURI_CONFIG_ENV]
  return next
}

export function isolatedV5AppTauriBuildEnv(env = process.env) {
  const next = tauriBuildEnvWithoutExternalConfig(env)
  delete next[HOST_PROFILE_ENV]
  delete next[HOST_VITE_PROFILE_ENV]
  return next
}

export function assertNoExternalTauriConfig(env, context) {
  const tauriConfig = String(env?.[TAURI_CONFIG_ENV] || '').trim()
  if (!tauriConfig) return
  throw new Error([
    `${context} 不允许携带 ${TAURI_CONFIG_ENV}。`,
    '原因：TAURI_CONFIG 会覆盖 tauri.conf.json，可能把 dev productName/identifier 写进发布包。',
  ].join('\n'))
}
