import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'
import { initializeVoiceSecrets } from './hooks/useVoiceConfig.ts'

// Initialize i18n
import './i18n/config.js'

void initializeVoiceSecrets().catch(error => {
  console.error('Secure Voice settings could not be initialized:', error)
})

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(
    `/sw.js?build=${encodeURIComponent(globalThis.__CLOUDCLI_BUILD_ID__)}`,
    { updateViaCache: 'none' },
  ).catch(err => {
    console.warn('Service worker registration failed:', err);
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (
      event.data?.type === 'cloudcli:build-activated'
      && event.data.buildId
      && event.data.buildId !== globalThis.__CLOUDCLI_BUILD_ID__
    ) {
      window.location.reload();
    }
  });
} else if ('serviceWorker' in navigator) {
  // Development identities change whenever the local stack restarts. Avoid a
  // stale production/dev worker controlling that mutable origin.
  navigator.serviceWorker.getRegistrations()
    .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
    .catch(err => console.warn('Could not clear development service workers:', err));
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
