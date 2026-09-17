import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import BrowserBarApp from './BrowserBarApp'
import MainApp from './App'
import { foldersTheme } from './collections/theme'
import './styles.css'
import './collections/styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('webview app root is missing')
}

const currentWindow = WebviewWindow.getCurrent()

createRoot(root).render(currentWindow.label === 'browser_bar' ? (
  <BrowserBarApp />
) : (
  <ThemeProvider theme={foldersTheme}>
    <CssBaseline />
    <MainApp />
  </ThemeProvider>
))
