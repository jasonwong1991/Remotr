export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'remotr.theme';

export function getStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

export function setStoredTheme(theme: ThemeMode): void {
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function initializeTheme(): void {
  applyTheme(getStoredTheme());
}
