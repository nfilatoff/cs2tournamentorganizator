import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';

export function Login({ onLogin }: { onLogin: () => void }) {
  const { t, err } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/auth/admin/login', { method: 'POST', body: { username, password } });
      onLogin();
      navigate('/');
    } catch (e2) {
      setError(err(e2));
    }
  };

  return (
    <div className="center">
      <img src="/logo.png" alt="Arena Pro Gaming Club" style={{ display: 'block', width: 220, margin: '0 auto 28px' }} />
      <div className="card">
        <h1>{t('login.playerTitle')}</h1>
        <a className="btn big" style={{ width: '100%' }} href="/api/auth/steam">{t('login.steam')}</a>
      </div>
      <form className="card" onSubmit={submit}>
        <h1>{t('login.adminTitle')}</h1>
        <label>{t('login.username')}<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
        <label style={{ marginTop: 8 }}>{t('login.password')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <p><button type="submit">{t('login.submit')}</button></p>
      </form>
    </div>
  );
}
