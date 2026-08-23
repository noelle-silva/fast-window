import { createRoot } from 'react-dom/client'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import BrowserBarApp from './BrowserBarApp'
import MainApp from './App'
import './styles.css'
import './bookmarks.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('webview app root is missing')
}

const currentWindow = WebviewWindow.getCurrent()
createRoot(root).render(currentWindow.label === 'browser_bar' ? <BrowserBarApp /> : <MainApp />)
