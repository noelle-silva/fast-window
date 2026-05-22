export type HostProfile = 'release' | 'dev'

export const HOST_PROFILE: HostProfile = import.meta.env.VITE_FAST_WINDOW_HOST_PROFILE === 'dev'
  ? 'dev'
  : 'release'

export const IS_HOST_DEV_PROFILE = HOST_PROFILE === 'dev'
export const HOST_APP_TITLE = IS_HOST_DEV_PROFILE ? 'Fast Window-dev' : 'Fast Window'
