import React, { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, setStoredTheme, type ThemeMode } from '../theme';

export default function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      onClick={() => {
        setStoredTheme(nextTheme);
        setTheme(nextTheme);
      }}
      title={`Switch to ${nextTheme} theme`}
    >
      {theme === 'dark' ? '☾ Dark' : '☀ Light'}
    </button>
  );
}
