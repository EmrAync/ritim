import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Styles really applied: a later broken update may use the one-time reload again
// (never cleared while broken, so it cannot reload in a loop).
window.addEventListener('load', () => {
  if (getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)') return;
  try {
    sessionStorage.removeItem('ritim-reload');
  } catch {
    /* storage blocked */
  }
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => undefined);
  });
}

// Dev only: handles for checking the audio timing from the browser console.
if (import.meta.env.DEV) {
  void Promise.all([import('./audio/player'), import('./audio/metronome'), import('./audio/engines'), import('./audio/context')]).then(([player, metro, engines, context]) => {
    (window as unknown as Record<string, unknown>).__ritim = { player, metro, engines, context };
  });
}
