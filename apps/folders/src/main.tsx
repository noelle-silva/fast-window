import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { App } from './App'
import { foldersTheme } from './theme'
import './styles.css'

const host = document.getElementById('app')
if (host) {
  createRoot(host).render(
    <React.StrictMode>
      <ThemeProvider theme={foldersTheme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  )
}
