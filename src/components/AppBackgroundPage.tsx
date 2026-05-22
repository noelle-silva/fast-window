import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import AppBackgroundPanel from '../apps/AppBackgroundPanel'
import type { RegisteredApp, RegisteredAppUpdatePatch } from '../apps/types'
import { getWallpaperSettings, type WallpaperSettings } from '../wallpaper'
import HostPageHeader from './HostPageHeader'
import { hostPageRootSx, hostPageScrollSx, hostSurfaceSx } from './hostUiStyles'

type AppBackgroundPageProps = {
  onBack: () => void
  apps: RegisteredApp[]
  onUpdateApp: (id: string, patch: RegisteredAppUpdatePatch) => void
}

export default function AppBackgroundPage({ onBack, apps, onUpdateApp }: AppBackgroundPageProps) {
  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)

  useEffect(() => {
    void getWallpaperSettings().then(setWallpaper)
  }, [])

  const wallpaperEnabled = wallpaper?.enabled === true
  const panelSx = hostSurfaceSx(wallpaperEnabled)

  return (
    <Box sx={hostPageRootSx}>
      <HostPageHeader title="后台管理" onBack={onBack} translucent={wallpaperEnabled} />
      <Box sx={hostPageScrollSx}>
        <Box sx={panelSx}>
          <AppBackgroundPanel embedded apps={apps} onUpdateApp={onUpdateApp} wallpaperEnabled={wallpaperEnabled} />
        </Box>
      </Box>
    </Box>
  )
}
