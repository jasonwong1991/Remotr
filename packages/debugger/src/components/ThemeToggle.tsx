import React, { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, setStoredTheme, type ThemeMode } from '../theme';
import { useT } from '../i18n';

export default function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const t = useT();

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
      title={t('theme.switchTo', { theme: t(nextTheme === 'dark' ? 'theme.dark' : 'theme.light') })}
    >
      {theme === 'dark' ? t('theme.darkLabel') : t('theme.lightLabel')}
    </button>
  );
}
