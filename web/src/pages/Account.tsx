import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function Account({ username, onChanged }: { username: string; onChanged: () => void }) {
  const { t, err } = useI18n();
  const [current, setCurrent] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    if (newPassword !== confirmPassword) {
      setError(t('account.passwordMismatch'));
      return;
    }
    try {
      await api('/api/auth/admin/account', {
        method: 'POST',
        body: { currentPassword: current, ...(newUsername ? { newUsername } : {}), ...(newPassword ? { newPassword } : {}) },
      });
      setCurrent(''); setNewUsername(''); setNewPassword(''); setConfirmPassword('');
      setDone(true);
      onChanged();
    } catch (e2) {
      setError(err(e2));
    }
  };

  return (
    <>
      <div className="pagehead"><h1>{t('account.title')}</h1></div>
      <form className="card stack narrow" onSubmit={submit}>
        <p className="muted flat">{t('account.current', { name: username })}</p>
        <label>{t('account.newUsername')}<input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="username" /></label>
        <label>{t('account.currentPassword')}<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
        <label>{t('account.newPassword')}<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
        <label>{t('account.confirmPassword')}<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
        {error && <p className="error">{error}</p>}
        {done && <p>{t('account.saved')}</p>}
        <div><button type="submit">{t('account.save')}</button></div>
      </form>
      <div className="card between narrow">
        <span>{t('app.language')}</span>
        <LanguageSwitcher />
      </div>
    </>
  );
}
