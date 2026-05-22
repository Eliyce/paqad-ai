export type ThemeMode = 'light' | 'dark' | 'auto';

const KEY = 'paqad-graph-theme';

function effective(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = effective(mode);
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
}

export function initTheme(): void {
  const mode = getThemeMode();
  applyTheme(mode);
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => applyTheme(getThemeMode()));
}
