import * as React from 'react'
import { Box, CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material'
import { FolderDialogs } from './dialogs/FolderDialogs'
import { SettingsPanel } from './components/SettingsPanel'
import { ScrollArea } from './components/ScrollArea'
import { Topbar } from './components/Topbar'
import { ClipboardView } from './views/ClipboardView'
import { FoldersView } from './views/FoldersView'
import { useClipboardHistoryController } from './hooks/useClipboardHistoryController'
import { createClipboardHistoryTheme } from './theme'

export function ClipboardHistoryApp() {
  const controller = useClipboardHistoryController()
  const theme = React.useMemo(() => createClipboardHistoryTheme(controller.state.settings.theme), [controller.state.settings.theme])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const { ctxMenu, movePicker, editDialog } = controller.state
      if (!ctxMenu.open && !movePicker.open && !editDialog.open) return
      controller.closeDialogs()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%', width: '100%', overflow: 'hidden', overscrollBehavior: 'none' },
          body: { height: '100%', width: '100%', margin: 0, overflow: 'hidden', overscrollBehavior: 'none' },
          '#app': { height: '100%' },
          '*': { boxSizing: 'border-box' },
        }}
      />
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', color: 'text.primary' }}>
        <Topbar controller={controller} />
        <ScrollArea ariaLabel="剪贴板历史内容" sx={{ flex: 1 }} viewportSx={{ p: 1.25 }}>
          {controller.state.view === 'clipboard' ? (
            <ClipboardView controller={controller} />
          ) : (
            <FoldersView controller={controller} />
          )}
        </ScrollArea>
        <SettingsPanel controller={controller} />
        <FolderDialogs controller={controller} />
      </Box>
    </ThemeProvider>
  )
}
