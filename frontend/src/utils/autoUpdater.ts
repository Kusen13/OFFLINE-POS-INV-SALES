/**
 * Auto-Updater Service
 * Automatically detects new builds deployed on the server across all devices (phones, laptops, tablets)
 * and seamlessly refreshes the app without manual cache clearing.
 */

import { useCartStore } from '../features/cart/cartStore';

export const LOCAL_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : Date.now();

let isChecking = false;
let updatePromptShown = false;

/**
 * Apply the update immediately: updates Service Worker, clears stale cache, and reloads
 */
export async function forceAppUpdate(): Promise<void> {
  // Show visual toast
  showUpdateToast('⚡ Ina-apply ang bagong update... Mangyaring maghintay...');

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.update();
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k.includes('html') || k.includes('app-cache')) {
          await caches.delete(k);
        }
      }
    }
  } catch (err) {
    console.warn('[AutoUpdater] Cache wipe warning:', err);
  }

  // Reload window after brief animation
  setTimeout(() => {
    window.location.reload();
  }, 600);
}

/**
 * Check if the server has a newer version.json
 */
export async function checkForAppUpdates(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  if (isChecking) return false;
  isChecking = true;

  try {
    const res = await fetch(`/version.json?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });

    if (!res.ok) return false;

    const data = await res.json();
    const serverVersion = Number(data.version);

    if (serverVersion && serverVersion > LOCAL_BUILD_TIME) {
      console.info(`[AutoUpdater] New version detected! Server: ${serverVersion}, Local: ${LOCAL_BUILD_TIME}`);

      const cartItems = useCartStore.getState().items;

      // If cart is currently empty, automatically update immediately!
      if (cartItems.length === 0) {
        await forceAppUpdate();
        return true;
      }

      // If cashier is actively encoding a cart, show a prominent update banner so their sale isn't lost
      if (!updatePromptShown) {
        updatePromptShown = true;
        renderUpdateBanner();
      }
      return true;
    }
  } catch (err) {
    // Silent fail if network unreachable
  } finally {
    isChecking = false;
  }

  return false;
}

/**
 * Floating toast banner for automatic updating
 */
function showUpdateToast(message: string): void {
  const existing = document.getElementById('pos-update-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'pos-update-toast';
  toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[99999] bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-bold text-xs sm:text-sm px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce border border-white/20';
  toast.innerHTML = `
    <span class="animate-spin text-base">🔄</span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
}

/**
 * Top alert bar when cart has items
 */
function renderUpdateBanner(): void {
  const existing = document.getElementById('pos-pending-update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'pos-pending-update-banner';
  banner.className = 'fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-slate-950 px-4 py-2 text-xs sm:text-sm font-extrabold flex items-center justify-between shadow-lg';
  banner.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-base">⚡</span>
      <span>May bagong update sa system! Maaaring tapusin muna ang benta bago mag-update.</span>
    </div>
    <button id="pos-update-now-btn" class="px-3 py-1 bg-slate-950 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer shadow-sm ml-2 shrink-0">
      🔄 I-update Ngayon
    </button>
  `;
  document.body.appendChild(banner);

  document.getElementById('pos-update-now-btn')?.addEventListener('click', () => {
    forceAppUpdate();
  });
}

/**
 * Initialize automatic background polling and event listeners
 */
export function initAutoUpdater(): void {
  if (typeof window === 'undefined') return;

  // 1. Initial check after app starts
  setTimeout(() => {
    checkForAppUpdates();
  }, 3000);

  // 2. Poll every 15 seconds
  setInterval(() => {
    checkForAppUpdates();
  }, 15000);

  // 3. Check whenever user switches tabs or unlocks phone
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdates();
    }
  });

  // 4. Check whenever window gains focus
  window.addEventListener('focus', () => {
    checkForAppUpdates();
  });

  // 5. Check whenever device regains internet / Wi-Fi
  window.addEventListener('online', () => {
    checkForAppUpdates();
  });

  // 6. If Service Worker controller changes, reload immediately
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.info('[AutoUpdater] Service worker controller changed. Refreshing view...');
      window.location.reload();
    });
  }
}
