import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { requestPersistentStorage } from './db/database'
import { registerSW } from 'virtual:pwa-register'

// Auto-register Service Worker for offline PWA caching with seamless auto-update
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('Bagong update ng POS System ay available, ina-apply agad...');
    updateSW(true);
  },
  onOfflineReady() {
    console.log('POS App is ready to run offline without server!');
  },
});

// Regular check for system code updates every 30 seconds or on screen unlock/tab focus
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then((reg) => {
    setInterval(() => {
      reg.update().catch(() => {});
    }, 30 * 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reg.update().catch(() => {});
      }
    });
  }).catch(() => {});
}

// Request persistent storage on app start
requestPersistentStorage().catch(console.warn);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
