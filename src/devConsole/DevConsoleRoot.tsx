import { ThemeProvider } from '@mui/material/styles'
import { appTheme } from '../theme'
import DevConsoleApp from './DevConsoleApp'

export default function DevConsoleRoot() {
  return (
    <ThemeProvider theme={appTheme}>
      <DevConsoleApp />
    </ThemeProvider>
  )
}
