import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export function Login({ onLogin }: { onLogin: () => void }) {
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
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="center">
      <div className="card">
        <h1>Вход для игроков</h1>
        <a href="/api/auth/steam"><button type="button">Войти через Steam</button></a>
      </div>
      <form className="card" onSubmit={submit}>
        <h1>Вход для администратора</h1>
        <label>Логин<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
        <label style={{ marginTop: 8 }}>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <p><button type="submit">Войти</button></p>
      </form>
    </div>
  );
}
