import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initTheme } from './lib/theme';

function reportFatal(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  // eslint-disable-next-line no-console
  console.error('[paqad-graph fatal]', msg);
  const el = document.getElementById('root');
  if (el) {
    el.innerHTML = `<pre style="white-space:pre-wrap;padding:1rem;color:#dc2626;font-family:ui-monospace,monospace;font-size:12px">${msg.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</pre>`;
  }
}

window.addEventListener('error', (e) => reportFatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportFatal(e.reason));

try {
  initTheme();
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing #root');
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  reportFatal(err);
}
