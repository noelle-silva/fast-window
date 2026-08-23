export type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}
