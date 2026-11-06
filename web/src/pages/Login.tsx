import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';

export function Login({ onLogin }: { onLogin: () => void }) {
  const { t, err } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Вход администратора скрыт от посетителей: форма появляется по Ctrl+Shift+A (или по ссылке /login#admin)
  const [adminForm, setAdminForm] = useState(() => window.location.hash === '#admin');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
        e.preventDefault();
        setAdminForm((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      <img className="loginlogo" src="/logo-mark.png" alt="Arena Pro Gaming Club" />
      <div className="card">
        <h1>{t('login.playerTitle')}</h1>
        <a className="btn big wide" href="/api/auth/steam">{t('login.steam')}</a>
      </div>
      {adminForm && <form className="card stack" onSubmit={submit}>
        <h1>{t('login.adminTitle')}</h1>
        <label>{t('login.username')}<input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>{t('login.password')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <div><button type="submit" className="wide">{t('login.submit')}</button></div>
      </form>}
    </div>
  );
}
