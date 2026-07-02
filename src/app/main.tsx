import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// Sem StrictMode: o double-mount de desenvolvimento duplicaria o mundo físico
// (Rapier) e o Web Worker de chunks.
createRoot(document.getElementById('root')!).render(<App />)
