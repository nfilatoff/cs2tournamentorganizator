import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type MapItem } from '../api';

export function Maps() {
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [workshop, setWorkshop] = useState('');
  const [mapFile, setMapFile] = useState('');
  const [stdName, setStdName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<MapItem[]>('/api/maps').then(setMaps).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const addWorkshop = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/maps', { method: 'POST', body: { workshop } });
      setWorkshop('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addStandard = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/maps', { method: 'POST', body: { mapFile, name: stdName } });
      setMapFile('');
      setStdName('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api(`/api/maps/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <>
      <h1>Библиотека карт</h1>
      <form className="card row" onSubmit={addWorkshop}>
        <label style={{ flex: 1, minWidth: 260 }}>
          Workshop-ссылка или ID
          <input value={workshop} onChange={(e) => setWorkshop(e.target.value)} placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=..." required />
        </label>
        <button type="submit">Добавить Workshop-карту</button>
      </form>
      <form className="card row" onSubmit={addStandard}>
        <label>Файл карты<input value={mapFile} onChange={(e) => setMapFile(e.target.value)} placeholder="de_inferno" required /></label>
        <label>Название<input value={stdName} onChange={(e) => setStdName(e.target.value)} placeholder="Inferno" required /></label>
        <button type="submit">Добавить стандартную карту</button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead><tr><th /><th>Название</th><th>Источник</th><th /></tr></thead>
          <tbody>
            {maps.map((m) => (
              <tr key={m.id}>
                <td>{m.imageUrl ? <img className="thumb" src={m.imageUrl} alt="" /> : <div className="thumb" />}</td>
                <td>{m.name}</td>
                <td className="muted">{m.workshopId ? `Workshop ${m.workshopId}` : m.mapFile}</td>
                <td style={{ textAlign: 'right' }}><button className="danger" onClick={() => remove(m.id)}>Удалить</button></td>
              </tr>
            ))}
            {maps.length === 0 && <tr><td colSpan={4} className="muted">Карт пока нет</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
