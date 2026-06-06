import React from 'react';
import { useLocale, useT } from '../i18n';

export default function LanguageToggle(): React.ReactElement {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const t = useT();

  return (
    <button
      onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
      title={t('lang.toggleTitle')}
    >
      {locale === 'en' ? '中文' : 'EN'}
    </button>
  );
}
