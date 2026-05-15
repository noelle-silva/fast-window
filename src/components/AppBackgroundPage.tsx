import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { alpha } from '@mui/material/styles'
import AppBackgroundPanel from '../apps/AppBackgroundPanel'
import type { RegisteredApp, RegisteredAppUpdatePatch } from '../apps/types'
import { getWallpaperSettings, type WallpaperSettings } from '../wallpaper'
import HostPageHeader from './HostPageHeader'

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

  const panelSx = (theme: any) => ({
    borderRadius: 2,
    p: 1.25,
    bgcolor: wallpaper?.enabled ? alpha(theme.palette.background.paper, 0.62) : theme.palette.background.paper,
    backdropFilter: wallpaper?.enabled ? 'blur(12px)' : undefined,
  })

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <HostPageHeader title="后台管理" onBack={onBack} translucent={wallpaper?.enabled === true} />
      <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
        <Box sx={panelSx}>
          <AppBackgroundPanel embedded apps={apps} onUpdateApp={onUpdateApp} />
        </Box>
      </Box>
    </Box>
  )
}
