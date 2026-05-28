import { Box } from '@mui/material'
import AppBackgroundPanel from '../apps/AppBackgroundPanel'
import type { RegisteredApp, RegisteredAppUpdatePatch } from '../apps/types'
import HostPageHeader from './HostPageHeader'
import { hostPageRootSx, hostPageScrollSx, hostSurfaceSx } from './hostUiStyles'
import { useHostAppearance } from './hostAppearance'

type AppBackgroundPageProps = {
  onBack: () => void
  apps: RegisteredApp[]
  onUpdateApp: (id: string, patch: RegisteredAppUpdatePatch) => void
}

export default function AppBackgroundPage({ onBack, apps, onUpdateApp }: AppBackgroundPageProps) {
  const hostAppearance = useHostAppearance()
  const panelSx = hostSurfaceSx(hostAppearance.surfaceMode)

  return (
    <Box sx={hostPageRootSx}>
      <HostPageHeader title="后台管理" onBack={onBack} translucent={hostAppearance.glassEnabled} />
      <Box sx={hostPageScrollSx}>
        <Box sx={panelSx}>
          <AppBackgroundPanel embedded apps={apps} onUpdateApp={onUpdateApp} />
        </Box>
      </Box>
    </Box>
  )
}
