import { useState } from 'react';
import type { PauseLimits } from '../api';
import { useI18n } from '../i18n';

// Лимиты пауз на карту для каждой команды
export function PauseFields({ value, onChange }: { value: PauseLimits; onChange: (v: PauseLimits) => void }) {
  const { t } = useI18n();
  const num = (key: keyof PauseLimits, min: number, max: number) => (
    <input className="num" type="number" min={min} max={max} value={value[key]} required
      onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} />
  );
  return (
    <div className="row">
      <label>{t('pauses.tactical')}{num('tactical', 0, 10)}</label>
      <label>{t('pauses.tacticalTime')}{num('tacticalTime', 10, 300)}</label>
      <label>{t('pauses.technical')}{num('technical', 0, 10)}</label>
    </div>
  );
}

// Изменение лимитов на странице турнира (админ). Поля не сбрасываются при автообновлении страницы.
export function PausesEditor({ value, onSave }: { value: PauseLimits; onSave: (v: PauseLimits) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const changed = draft.tactical !== value.tactical || draft.tacticalTime !== value.tacticalTime || draft.technical !== value.technical;
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
      <h2>{t('pauses.title')}</h2>
      <div className="row">
        <PauseFields value={draft} onChange={setDraft} />
        <button type="submit" className="ghost" disabled={!changed}>{t('pauses.save')}</button>
      </div>
      <p className="muted">{t('pauses.hint')} {t('pauses.liveHint')}</p>
    </form>
  );
}
