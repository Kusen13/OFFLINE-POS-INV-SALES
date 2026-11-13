import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { requestPersistentStorage } from './db/database'
import { registerSW } from 'virtual:pwa-register'
import { initAutoUpdater } from './utils/autoUpdater'

// Register Service Worker for offline PWA caching with seamless update activation
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('[PWA] Bagong version ng POS App ay available. Ina-activate ang update...');
    updateSW(true);
  },
  onOfflineReady() {
    console.info('[PWA] POS App is ready to run offline without server!');
  },
});

// Start automatic cross-device update detection
initAutoUpdater();

// Request persistent storage on app start
requestPersistentStorage().catch(console.warn);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
