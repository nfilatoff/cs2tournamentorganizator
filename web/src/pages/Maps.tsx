import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type MapItem } from '../api';
import { useI18n } from '../i18n';

export function Maps() {
  const { t, err } = useI18n();
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [workshop, setWorkshop] = useState('');
  const [mapFile, setMapFile] = useState('');
  const [stdName, setStdName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(() => {
    api<MapItem[]>('/api/maps').then(setMaps).catch((e) => setError(err(e)));
  }, [err]);
  useEffect(load, [load]);

  const submit = async (body: unknown, reset: () => void) => {
    setError('');
    try {
      await api('/api/maps', { method: 'POST', body });
      reset();
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  const addWorkshop = (e: FormEvent) => {
    e.preventDefault();
    void submit({ workshop }, () => setWorkshop(''));
  };

  const addStandard = (e: FormEvent) => {
    e.preventDefault();
    void submit({ mapFile, name: stdName }, () => { setMapFile(''); setStdName(''); });
  };

  const addDefaults = async () => {
    setError('');
    try {
      const r = await api<{ added: number }>('/api/maps/defaults', { method: 'POST', body: {} });
      setInfo(t('maps.addedDefaults', { n: r.added }));
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  const remove = async (id: number) => {
    setError('');
    try {
      await api(`/api/maps/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  return (
    <>
      <div className="between">
        <h1>{t('maps.title')}</h1>
        <button className="ghost" onClick={addDefaults}>{t('maps.addDefaults')}</button>
      </div>
      {info && <p className="muted">{info}</p>}
      <form className="card row" onSubmit={addWorkshop}>
        <label style={{ flex: 1, minWidth: 260 }}>
          {t('maps.workshopLabel')}
          <input value={workshop} onChange={(e) => setWorkshop(e.target.value)} placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=..." required />
        </label>
        <button type="submit">{t('maps.addWorkshop')}</button>
      </form>
      <form className="card row" onSubmit={addStandard}>
        <label>{t('maps.mapFile')}<input value={mapFile} onChange={(e) => setMapFile(e.target.value)} placeholder="de_inferno" required /></label>
        <label>{t('maps.mapName')}<input value={stdName} onChange={(e) => setStdName(e.target.value)} placeholder="Inferno" required /></label>
        <button type="submit">{t('maps.addStandard')}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {maps.length === 0
        ? <div className="card muted">{t('maps.empty')}</div>
        : (
          <div className="mapgrid">
            {maps.map((m) => (
              <div key={m.id} className="mapcard">
                {m.imageUrl ? <img src={m.imageUrl} alt="" loading="lazy" /> : <div className="noimg" />}
                <div className="mapinfo">
                  <div>
                    <div className="vname">{m.name}</div>
                    <div className="muted">{m.workshopId ? `Workshop ${m.workshopId}` : m.mapFile}</div>
                  </div>
                  <button className="danger" onClick={() => remove(m.id)}>{t('common.delete')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
