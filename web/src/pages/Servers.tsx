import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api, type GameMode, type GameServer, type LauncherInfo, type MapItem, type ServerSettings, type ServerStatus,
} from '../api';
import { useI18n } from '../i18n';

const GAME_MODES: GameMode[] = ['competitive', 'wingman', 'casual', 'deathmatch'];

// Значение для списка стартовых карт: имя файла стандартной карты или workshop:<id>
const mapRef = (m: MapItem) => (m.workshopId ? `workshop:${m.workshopId}` : m.mapFile ?? '');

function MapSelect({ maps, value, onChange }: { maps: MapItem[]; value: string; onChange: (v: string) => void }) {
  const known = maps.some((m) => mapRef(m) === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value}</option>}
      {maps.filter((m) => mapRef(m)).map((m) => <option key={m.id} value={mapRef(m)}>{m.name}</option>)}
    </select>
  );
}

// Запуск CS2 на этом компьютере: где установлена игра
function LauncherCard({ info, onSaved }: { info: LauncherInfo; onSaved: (i: LauncherInfo) => void }) {
  const { t, err } = useI18n();
  const [path, setPath] = useState(info.cs2Path);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      onSaved(await api<LauncherInfo>('/api/servers/launcher', { method: 'PUT', body: { cs2Path: path } }));
    } catch (e2) {
      setError(err(e2));
    }
  };
  return (
    <form className="card" onSubmit={save}>
      <h2>{t('launcher.title')}</h2>
      <div className="row">
        <label style={{ flex: 1, minWidth: 280 }}>{t('launcher.path')}
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={info.detected ?? 'E:\\LAN Server\\cs2'} />
        </label>
        <button type="submit" className="ghost">{t('common.save')}</button>
      </div>
      {info.exe
        ? <p className="muted">{t('launcher.found', { exe: info.exe })}</p>
        : <p className="error">{t('launcher.notFound')}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

// Настройки сервера: подключение, запуск и cfg
function ServerEditor({ server, maps, onSaved }: { server: GameServer; maps: MapItem[]; onSaved: (msg: string) => void }) {
  const { t, err } = useI18n();
  const [name, setName] = useState(server.name);
  const [host, setHost] = useState(server.host);
  const [port, setPort] = useState(String(server.port));
  const [rcon, setRcon] = useState('');
  const [s, setS] = useState<ServerSettings>(server.settings);
  const [error, setError] = useState('');
  const set = <K extends keyof ServerSettings>(k: K, v: ServerSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const check = (k: 'managed' | 'lan' | 'tvEnable' | 'autostart', label: string) => (
    <label className="check"><input type="checkbox" checked={s[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>
  );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await api<GameServer & { applied: boolean }>(`/api/servers/${server.id}`, {
        method: 'PUT',
        body: { name, host, port: Number(port), ...(rcon ? { rconPassword: rcon } : {}), settings: s },
      });
      setRcon('');
      onSaved(r.applied ? t('srv.savedApplied') : t('srv.saved'));
    } catch (e2) {
      setError(err(e2));
    }
  };

  return (
    <form onSubmit={save} className="srvedit">
      <h2>{t('srv.connection')}</h2>
      <div className="row">
        <label>{t('servers.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>{t('servers.address')}<input value={host} onChange={(e) => setHost(e.target.value)} required /></label>
        <label>{t('servers.port')}<input type="number" value={port} onChange={(e) => setPort(e.target.value)} required style={{ width: 90 }} /></label>
        <label>{t('servers.rcon')}<input type="password" value={rcon} onChange={(e) => setRcon(e.target.value)} placeholder={t('srv.keepRcon')} /></label>
      </div>
      {check('managed', t('srv.managed'))}

      {s.managed && (
        <>
          <h2>{t('srv.launch')}</h2>
          <div className="row">
            <label>{t('srv.startMap')}<MapSelect maps={maps} value={s.startMap} onChange={(v) => set('startMap', v)} /></label>
            <label>{t('srv.gameMode')}
              <select value={s.gameMode} onChange={(e) => set('gameMode', e.target.value as GameMode)}>
                {GAME_MODES.map((m) => <option key={m} value={m}>{t(`gm.${m}`)}</option>)}
              </select>
            </label>
            <label>{t('srv.maxPlayers')}
              <input type="number" min={2} max={64} value={s.maxPlayers} onChange={(e) => set('maxPlayers', Number(e.target.value))} style={{ width: 80 }} />
            </label>
            <label>{t('srv.tvPort')}
              <input type="number" min={1} max={65535} value={s.tvPort ?? ''} placeholder={String(server.port + 100)} disabled={!s.tvEnable}
                onChange={(e) => set('tvPort', e.target.value ? Number(e.target.value) : null)} style={{ width: 100 }} />
            </label>
          </div>
          <div className="row">
            {check('tvEnable', t('srv.tvEnable'))}
            {check('lan', t('srv.lan'))}
            {check('autostart', t('srv.autostart'))}
          </div>

          <h2>{t('srv.settings')}</h2>
          <div className="row">
            <label style={{ flex: 1, minWidth: 220 }}>{t('srv.hostname')}<input value={s.hostname} placeholder={name} onChange={(e) => set('hostname', e.target.value)} maxLength={63} /></label>
            <label>{t('srv.svPassword')}<input value={s.svPassword} onChange={(e) => set('svPassword', e.target.value)} maxLength={63} /></label>
            <label>{t('srv.gslt')}<input value={s.gslt} onChange={(e) => set('gslt', e.target.value)} maxLength={64} /></label>
          </div>
          <label>{t('srv.extraCfg')}
            <textarea rows={5} value={s.extraCfg} onChange={(e) => set('extraCfg', e.target.value)} placeholder={'mp_autokick 0\nsv_alltalk 0'} />
          </label>
          <p className="muted">{t('srv.settingsHint')}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit">{t('common.save')}</button>
    </form>
  );
}

export function Servers() {
  const { t, err } = useI18n();
  const [servers, setServers] = useState<GameServer[]>([]);
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [launcher, setLauncher] = useState<LauncherInfo | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [rcon, setRcon] = useState('');
  const [managed, setManaged] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [mapNow, setMapNow] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<Record<number, ServerStatus | 'loading'>>({});

  const check = async (id: number) => {
    setStatus((p) => ({ ...p, [id]: 'loading' }));
    try {
      const st = await api<ServerStatus>(`/api/servers/${id}/status`);
      setStatus((p) => ({ ...p, [id]: st }));
    } catch (e) {
      setStatus((p) => ({ ...p, [id]: { online: false, error: { error: 'internal', params: { message: err(e) } }, panelMatch: null, lastError: null } }));
    }
  };

  const load = useCallback(() => {
    api<GameServer[]>('/api/servers').then(setServers).catch((e) => setError(err(e)));
    api<LauncherInfo>('/api/servers/launcher').then(setLauncher).catch(() => undefined);
  }, [err]);
  useEffect(load, [load]);
  useEffect(() => {
    api<MapItem[]>('/api/maps').then(setMaps).catch(() => undefined);
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const created = await api<GameServer>('/api/servers', {
        method: 'POST',
        body: {
          name, host: host || launcher?.defaultHost, port: Number(port || launcher?.nextPort),
          ...(rcon ? { rconPassword: rcon } : {}), settings: { managed },
        },
      });
      setName('');
      setPort('');
      setRcon('');
      if (managed) setEditing(created.id);
      load();
    } catch (e2) {
      setError(err(e2));
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t('srv.confirmDelete'))) return;
    setError('');
    try {
      await api(`/api/servers/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  // Запуск, остановка, перезапуск, смена карты
  const run = async (id: number, action: string, body: unknown = {}, msg?: string) => {
    setError('');
    setInfo('');
    setBusy((p) => ({ ...p, [id]: true }));
    try {
      await api(`/api/servers/${id}/${action}`, { method: 'POST', body });
      if (msg) setInfo(msg);
      load();
      // Сервер поднимается не сразу: проверяем состояние чуть позже
      setTimeout(() => void check(id), action === 'stop' ? 1000 : 8000);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy((p) => ({ ...p, [id]: false }));
    }
  };

  return (
    <>
      <h1>{t('servers.title')}</h1>
      <p className="muted">{t('servers.hint')}</p>
      {launcher && <LauncherCard key={launcher.cs2Path} info={launcher} onSaved={setLauncher} />}

      <form className="card" onSubmit={add}>
        <h2>{t('srv.add')}</h2>
        <div className="row">
          <label>{t('servers.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server 1" required /></label>
          <label>{t('servers.address')}<input value={host} onChange={(e) => setHost(e.target.value)} placeholder={launcher?.defaultHost} /></label>
          <label>{t('servers.port')}<input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder={String(launcher?.nextPort ?? 27015)} style={{ width: 90 }} /></label>
          <label>{t('servers.rcon')}<input type="password" value={rcon} onChange={(e) => setRcon(e.target.value)} required={!managed} placeholder={managed ? t('srv.autoRcon') : ''} /></label>
          <button type="submit">{t('common.add')}</button>
        </div>
        <label className="check"><input type="checkbox" checked={managed} onChange={(e) => setManaged(e.target.checked)} />{t('srv.managed')}</label>
        <p className="muted">{managed ? t('srv.managedHint') : t('srv.externalHint')}</p>
        <p className="muted small">{t('srv.autoHostHint')}</p>
      </form>

      {error && <p className="error">{error}</p>}
      {info && <p className="muted">{info}</p>}
      <div className="card">
        <table>
          <thead><tr><th>{t('servers.name')}</th><th>{t('servers.address')}</th><th>{t('servers.state')}</th><th /></tr></thead>
          <tbody>
            {servers.map((s) => {
              const st = status[s.id];
              return [
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <div className="muted small">
                      {s.managed
                        ? `${t('srv.managedShort')} · ${s.settings.startMap} · ${t(`gm.${s.settings.gameMode}`)}`
                        : t('srv.externalShort')}
                    </div>
                  </td>
                  <td>
                    {s.address}:{s.port}
                    {s.auto && <div className="muted small">{t('srv.autoHost')}</div>}
                  </td>
                  <td>
                    {s.managed && (s.process.running
                      ? <div>{t('srv.processRunning', { pid: s.process.pid ?? '' })}</div>
                      : s.process.lastExit && <div className="muted">{t('srv.processExited', { code: s.process.lastExit.code ?? '—' })}</div>)}
                    {st === 'loading' && <span className="muted">{t('servers.checking')}</span>}
                    {st && st !== 'loading' && (st.online
                      ? <span>{t('servers.online', { state: st.gamestate ?? '' })}{st.panelMatch ? ` · ${t('servers.matchOn', { code: st.panelMatch.code })}` : ` · ${t('servers.free')}`}</span>
                      : <span className="error">{t('servers.unreachable', { error: err(st.error) })}</span>)}
                    {st && st !== 'loading' && st.lastError && <div className="muted">{t('servers.lastError', { error: err(st.lastError) })}</div>}
                  </td>
                  <td className="actions">
                    <button className="ghost" onClick={() => check(s.id)}>{t('servers.check')}</button>
                    {s.managed && (
                      <>
                        <button disabled={busy[s.id]} onClick={() => run(s.id, 'start', {}, t('srv.starting'))}>{t('srv.start')}</button>
                        <button className="ghost" disabled={busy[s.id]} onClick={() => run(s.id, 'restart', {}, t('srv.starting'))}>{t('srv.restart')}</button>
                        <button className="ghost" disabled={busy[s.id]} onClick={() => run(s.id, 'stop')}>{t('srv.stop')}</button>
                      </>
                    )}
                    <button className="ghost" onClick={() => setEditing(editing === s.id ? null : s.id)}>{t('srv.settingsBtn')}</button>
                    <button className="danger" onClick={() => remove(s.id)}>{t('common.delete')}</button>
                  </td>
                </tr>,
                editing === s.id && (
                  <tr key={`${s.id}-edit`}>
                    <td colSpan={4}>
                      <ServerEditor server={s} maps={maps} onSaved={(msg) => { setInfo(msg); setEditing(null); load(); }} />
                      <div className="row" style={{ marginTop: 12 }}>
                        <label>{t('srv.mapNow')}
                          <MapSelect maps={maps} value={mapNow[s.id] ?? s.settings.startMap} onChange={(v) => setMapNow((p) => ({ ...p, [s.id]: v }))} />
                        </label>
                        <button type="button" className="ghost" disabled={busy[s.id]}
                          onClick={() => run(s.id, 'map', { map: mapNow[s.id] ?? s.settings.startMap }, t('srv.mapChanged'))}>{t('srv.changeMap')}</button>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            {servers.length === 0 && <tr><td colSpan={4} className="muted">{t('servers.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
