import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

export function Account({ username, onChanged }: { username: string; onChanged: () => void }) {
  const { t, err } = useI18n();
  const [current, setCurrent] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    try {
      await api('/api/auth/admin/account', {
        method: 'POST',
        body: { currentPassword: current, ...(newUsername ? { newUsername } : {}), ...(newPassword ? { newPassword } : {}) },
      });
      setCurrent(''); setNewUsername(''); setNewPassword('');
      setDone(true);
      onChanged();
    } catch (e2) {
      setError(err(e2));
    }
  };

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
      <h1>{t('account.title')}</h1>
      <p className="muted">{t('account.current', { name: username })}</p>
      <label>{t('account.newUsername')}<input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="username" /></label>
      <label style={{ marginTop: 8 }}>{t('account.newPassword')}<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
      <label style={{ marginTop: 8 }}>{t('account.currentPassword')}<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
      {error && <p className="error">{error}</p>}
      {done && <p>{t('account.saved')}</p>}
      <p><button type="submit">{t('account.save')}</button></p>
    </form>
  );
}
