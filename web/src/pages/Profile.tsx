import { useState, type FormEvent } from 'react';
import { api, type Me } from '../api';
import { useI18n } from '../i18n';

type Player = Extract<Me, { kind: 'player' }>;

export function Profile({ me, onChanged }: { me: Player; onChanged: () => void }) {
  const { t, err } = useI18n();
  const [nick, setNick] = useState(me.customName ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async (value: string | null) => {
    setError('');
    setSaved(false);
    try {
      await api('/api/me/nickname', { method: 'PUT', body: { nickname: value } });
      if (value === null) setNick('');
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(err(e));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(nick.trim() || null);
  };

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h1>{t('profile.title')}</h1>
      <table>
        <tbody>
          <tr><td className="muted">{t('profile.steamName')}</td><td>{me.steamName ?? '—'}</td></tr>
          <tr><td className="muted">{t('profile.steamId')}</td><td><code>{me.steamId}</code></td></tr>
          <tr><td className="muted">{t('profile.adminName')}</td><td>{me.adminName ?? '—'}</td></tr>
          <tr><td className="muted">{t('profile.effective')}</td><td><b>{me.name}</b></td></tr>
        </tbody>
      </table>
      {me.adminName && <p className="error">{t('profile.adminOverride', { name: me.adminName })}</p>}
      <form onSubmit={submit}>
        <label>{t('profile.nickname')}
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={me.steamName ?? ''} />
        </label>
        <p className="muted">{t('profile.nicknameHint')}</p>
        {error && <p className="error">{error}</p>}
        {saved && <p>{t('profile.saved')}</p>}
        <button type="submit">{t('profile.save')}</button>{' '}
        {me.customName && <button type="button" className="ghost" onClick={() => save(null)}>{t('profile.clear')}</button>}
      </form>
    </div>
  );
}
