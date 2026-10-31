import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type VetoDto } from '../api';
import { useI18n } from '../i18n';

export function VetoPage() {
  const { t, err } = useI18n();
  const { id, code } = useParams();
  const [v, setV] = useState<VetoDto | null>(null);
  const [error, setError] = useState('');

  const base = `/api/tournaments/${id}/matches/${code}/veto`;
  const load = useCallback(() => {
    api<VetoDto>(base)
      .then((d) => {
        // Состояние меняется только при реальных ходах: без этого страница перерисовывается на каждый опрос
        setV((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
        setError('');
      })
      .catch((e) => setError(err(e)));
  }, [base, err]);
  useEffect(load, [load]);
  // Капитаны ходят по очереди, поэтому состояние обновляется часто
  useEffect(() => {
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);

  const send = async (path: string, body: unknown) => {
    setError('');
    try {
      setV(await api<VetoDto>(base + path, { method: 'POST', body }));
    } catch (e) {
      setError(err(e));
    }
  };

  if (!v) return error ? <p className="error">{error}</p> : null;

  const teamName = (side: 'a' | 'b') => v.teams[side].name;
  const other = (side: 'a' | 'b') => (side === 'a' ? 'b' : 'a');
  const actionOf = (mapId: number) => v.actions.find((a) => a.mapId === mapId);
  const picking = v.next.type === 'ban' || v.next.type === 'pick';
  const lastPick = [...v.actions].reverse().find((a) => a.kind === 'pick');
  const mapName = (mapId: number) => v.pool.find((m) => m.id === mapId)?.name ?? `#${mapId}`;

  let banner: string;
  if (v.status === 'done') banner = t('veto.done');
  else if (v.next.type === 'side') {
    banner = v.canAct
      ? t('veto.yourTurnSide', { map: lastPick ? mapName(lastPick.mapId) : '' })
      : t('veto.waitingSide', { team: teamName(v.next.team) });
  } else if (v.next.type === 'ban' || v.next.type === 'pick') {
    banner = v.canAct
      ? t(v.next.type === 'ban' ? 'veto.yourTurnBan' : 'veto.yourTurnPick')
      : t('veto.waiting', { team: teamName(v.next.team) });
  } else banner = '';

  return (
    <>
      <p><Link to={`/tournaments/${id}`}>← {t('veto.back')}</Link> · <Link to={`/tournaments/${id}/matches/${code}`}>{t('mp.open')}</Link></p>
      <h1>{teamName('a')} <span className="muted">vs</span> {teamName('b')}</h1>
      <p className="muted">BO{v.bestOf} · {t('veto.title')} · {t('veto.firstNote', { team: teamName('a') })}</p>

      <div className={`card vetobanner${v.canAct ? ' mine' : ''}`}>
        <b>{banner}</b>
        {v.status === 'done' && <p style={{ marginBottom: 0 }}><Link className="btn" to={`/tournaments/${id}/matches/${code}`}>{t('mp.open')}</Link></p>}
        {v.locked && v.status !== 'done' && <span className="muted"> · {t('veto.locked')}</span>}
        {v.next.type === 'side' && v.canAct && !v.locked && (
          <p style={{ marginBottom: 0 }}>
            <button onClick={() => send('/act', { side: 'ct' })}>{t('veto.ct')}</button>{' '}
            <button onClick={() => send('/act', { side: 't' })}>{t('veto.t')}</button>
          </p>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="vetogrid">
        {v.pool.map((m) => {
          const a = actionOf(m.id);
          const clickable = picking && v.canAct && !a && !v.locked;
          const cls = `vetomap${a ? ` ${a.kind}` : ''}${clickable ? ' click' : ''}`;
          return (
            <button key={m.id} className={cls} disabled={!clickable} onClick={() => send('/act', { mapId: m.id })}>
              {m.imageUrl ? <img src={m.imageUrl} alt="" /> : <div className="noimg" />}
              <div className="vname">{m.name}</div>
              <div className="vstate">
                {!a && (picking ? t(v.next.type === 'ban' ? 'veto.available.ban' : 'veto.available.pick') : '')}
                {a?.kind === 'ban' && t('veto.bannedBy', { team: teamName(a.by!) })}
                {a?.kind === 'pick' && (
                  <>
                    {t('veto.pickedBy', { team: teamName(a.by!) })}
                    {a.side && <div>{t('veto.sideChosen', { team: teamName(other(a.by!)), side: a.side === 'ct' ? 'CT' : 'T' })}</div>}
                  </>
                )}
                {a?.kind === 'decider' && t('veto.deciderState')}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card">
        <h2>{t('veto.steps')}</h2>
        <ol className="vetosteps">
          {v.template.map((s, i) => {
            const done = v.actions[i];
            const current = i === v.actions.length && v.status !== 'done';
            return (
              <li key={i} className={current ? 'current' : done ? 'done' : ''}>
                {s.kind === 'decider'
                  ? t('veto.step.decider')
                  : t(s.kind === 'ban' ? 'veto.step.ban' : 'veto.step.pick', { team: teamName(s.team!) })}
                {done && <b> — {mapName(done.mapId)}</b>}
              </li>
            );
          })}
        </ol>
      </div>

      {v.result && (
        <div className="card">
          <h2>{t('veto.result')}</h2>
          <table>
            <tbody>
              {v.result.map((r, i) => (
                <tr key={r.mapId}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td className="muted">
                    {r.side === 'knife'
                      ? t('veto.knife')
                      : t('veto.sideChosen', { team: r.side.startsWith('team1') ? teamName('a') : teamName('b'), side: r.side.endsWith('_ct') ? 'CT' : 'T' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.you === 'admin' && !v.locked && (
        <p>
          <button className="ghost" onClick={() => send('/auto', {})}>{t('veto.auto')}</button>{' '}
          <button className="ghost" onClick={() => confirm(t('veto.confirmReset')) && send('/reset', {})}>{t('veto.reset')}</button>
        </p>
      )}
    </>
  );
}
