import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
