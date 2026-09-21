export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'remotr.theme';

/** 面板被嵌进禁用 storage 的 iframe 时，读 localStorage 属性本身就会抛错 —— 降级为默认主题 */
export function getStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

export function setStoredTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* 不可用则仅本次会话生效 */
  }
  applyTheme(theme);
}

export function initializeTheme(): void {
  applyTheme(getStoredTheme());
}
