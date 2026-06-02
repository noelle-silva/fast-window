import { Box } from '@mui/material'
import AppBackgroundPanel from '../apps/AppBackgroundPanel'
import type { RegisteredApp } from '../apps/types'
import HostPageHeader from './HostPageHeader'
import { hostPageRootSx, hostPageScrollSx, hostSurfaceSx } from './hostUiStyles'
import { useHostAppearance } from './hostAppearance'

type AppBackgroundPageProps = {
  onBack: () => void
  apps: RegisteredApp[]
}

export default function AppBackgroundPage({ onBack, apps }: AppBackgroundPageProps) {
  const hostAppearance = useHostAppearance()
  const panelSx = hostSurfaceSx(hostAppearance.surfaceMode)

  return (
    <Box sx={hostPageRootSx}>
      <HostPageHeader title="后台管理" onBack={onBack} translucent={hostAppearance.glassEnabled} />
      <Box sx={hostPageScrollSx}>
        <Box sx={panelSx}>
          <AppBackgroundPanel embedded apps={apps} />
        </Box>
      </Box>
    </Box>
  )
}
