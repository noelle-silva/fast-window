import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import { getCurrentWindow } from '@tauri-apps/api/window'
import App from './App'
import DevConsoleRoot from './devConsole/DevConsoleRoot'
import { DEV_CONSOLE_WINDOW_LABEL } from './devConsole/devConsoleApi'
import './styles.css'
import { appTheme } from './theme'

// 窗口身份以 Tauri label 为准：主窗口与 Dev 控制台共用同一份前端产物，
// 只有 label 是权威区分依据。浏览器预览下拿不到窗口句柄，按主窗口处理。
function isDevConsoleWindow(): boolean {
  try {
    return getCurrentWindow().label === DEV_CONSOLE_WINDOW_LABEL
  } catch {
    return false
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDevConsoleWindow() ? (
      <DevConsoleRoot />
    ) : (
      <ThemeProvider theme={appTheme}>
        <App />
      </ThemeProvider>
    )}
  </React.StrictMode>,
)
