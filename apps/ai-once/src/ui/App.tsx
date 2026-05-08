import * as React from 'react'
import { Alert, Box, CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material'
import { AppSettingsDialog } from './components/AppSettingsDialog'
import { SpaceDialogs } from './components/SpaceDialogs'
import { SettingsDialog } from './components/SettingsDialog'
import { TemplatesDialog } from './components/TemplatesDialog'
import { Topbar } from './components/Topbar'
import { WorkbenchView } from './views/WorkbenchView'
import { SpacesView } from './views/SpacesView'
import { aiOnceTheme } from './theme'
import { useAiOnceController } from './hooks/useAiOnceController'

export function AiOnceApp() {
  const controller = useAiOnceController()

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (controller.state.dialog || controller.state.spaceRename.open || controller.state.confirmDeleteSpace.open || controller.state.confirmClearHistory) {
        controller.closeDialog()
        controller.cancelDeleteSpace()
        controller.cancelClearHistory()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller.closeDialog, controller.cancelDeleteSpace, controller.cancelClearHistory, controller.state.confirmClearHistory, controller.state.confirmDeleteSpace.open, controller.state.dialog, controller.state.spaceRename.open])

  return (
    <ThemeProvider theme={aiOnceTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%', width: '100%', overflow: 'hidden', overscrollBehavior: 'none' },
          body: { height: '100%', width: '100%', margin: 0, overflow: 'hidden', overscrollBehavior: 'none' },
          '#app': { height: '100%' },
          '*': { boxSizing: 'border-box' },
          'button, input, textarea, select': { font: 'inherit' },
        }}
      />
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', color: 'text.primary' }}>
        <Topbar controller={controller} />
        <Box data-area="content" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1, sm: 1.5 } }}>
          {controller.state.view === 'spaces' ? <SpacesView controller={controller} /> : <WorkbenchView controller={controller} />}
        </Box>
        {controller.state.error ? (
          <Alert
            severity={controller.state.phase === 'failed' ? 'error' : 'warning'}
            onClose={() => controller.setError('')}
            sx={{ mx: 1.5, mb: 1.5, py: 0.25, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)' }}
          >
            {controller.state.error}
          </Alert>
        ) : null}
        <AppSettingsDialog controller={controller} />
        <SettingsDialog controller={controller} />
        <TemplatesDialog controller={controller} />
        <SpaceDialogs controller={controller} />
      </Box>
    </ThemeProvider>
  )
}
