import '../render/vendor'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { HyperCortexApp } from './App'

const host = document.getElementById('app') || document.body
if (host) createRoot(host).render(<HyperCortexApp />)
