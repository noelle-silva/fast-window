export type HostProfile = 'release' | 'dev'

function resolveHostProfile(value: unknown): HostProfile {
  return value === 'dev' ? 'dev' : 'release'
}

export const HOST_PROFILE: HostProfile = resolveHostProfile(import.meta.env.VITE_FAST_WINDOW_HOST_PROFILE)

export const IS_HOST_DEV_PROFILE = HOST_PROFILE === 'dev'
export const HOST_APP_TITLE = IS_HOST_DEV_PROFILE ? 'Fast Window-dev' : 'Fast Window'
