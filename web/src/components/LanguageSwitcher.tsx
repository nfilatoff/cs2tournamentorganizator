import { LANGS, useI18n, type Lang } from '../i18n';
import { IconGlobe } from './Icons';

// Планета с кодом языка; поверх неё прозрачный системный список, поэтому меню не обрезается и работает с клавиатуры и на телефоне
export function LanguageSwitcher() {
  const { t, lang, setLang } = useI18n();
  return (
    <span className="langswitch" title={t('app.language')}>
      <IconGlobe />
      <span>{lang.toUpperCase()}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('app.language')}>
        {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </span>
  );
}
