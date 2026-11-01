import { useCallback, useEffect, useState } from 'react';
import { api, type VetoDto } from '../api';
import { useI18n } from '../i18n';

// Вето карт в центральной колонке комнаты матча.
// Пока идёт вето, это главный блок страницы; после него сворачивается в историю банов и пиков.
export function VetoPanel({ base, active, version, onChange }: {
  base: string;
  active: boolean;
  // Меняется вместе с шагом вето в данных матча: повод перечитать вето, когда оно не опрашивается само
  version: string;
  onChange: () => void;
}) {
  const { t, err } = useI18n();
  const [v, setV] = useState<VetoDto | null>(null);
  const [error, setError] = useState('');

  const url = `${base}/veto`;
  const load = useCallback(() => {
    api<VetoDto>(url)
      .then((d) => {
        // Состояние меняется только при реальных ходах: без этого блок перерисовывается на каждый опрос
        setV((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
        setError('');
      })
      .catch((e) => setError(err(e)));
  }, [url, err]);
  useEffect(load, [load, version]);
  // Капитаны ходят по очереди, поэтому во время вето состояние обновляется часто
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [active, load]);

  // Завершённое вето меняет фазу матча: пусть страница перечитает его сразу, а не при следующем опросе
  const status = v?.status;
  useEffect(() => {
    if (active && status === 'done') onChange();
  }, [active, status, onChange]);

  const send = async (path: string, body: unknown) => {
    setError('');
    try {
      setV(await api<VetoDto>(url + path, { method: 'POST', body }));
      onChange();
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

  const steps = (
    <div className="vsteps" title={t('veto.steps')}>
      {v.template.map((s, i) => {
        const done = v.actions[i];
        const current = i === v.actions.length && v.status !== 'done';
        const title = s.kind === 'decider'
          ? t('veto.step.decider')
          : t(s.kind === 'ban' ? 'veto.step.ban' : 'veto.step.pick', { team: teamName(s.team!) });
        return <i key={i} className={current ? 'current' : done ? done.kind : ''} title={done ? `${title} — ${mapName(done.mapId)}` : title} />;
      })}
    </div>
  );

  const list = (
    <div className="vlist">
      {v.pool.map((m) => {
        const a = actionOf(m.id);
        const clickable = active && picking && v.canAct && !a && !v.locked;
        return (
          <div key={m.id} className={`vmap${a ? ` ${a.kind}` : ''}${clickable ? ' can' : ''}`}>
            {m.imageUrl && <img className="vbg" src={m.imageUrl} alt="" />}
            <div>
              <div className="vname">{m.name}</div>
              <div className="vstate">
                {a?.kind === 'ban' && t('veto.bannedBy', { team: teamName(a.by!) })}
                {a?.kind === 'pick' && (
                  <>
                    {t('veto.pickedBy', { team: teamName(a.by!) })}
                    {a.side && <> · {t('veto.sideChosen', { team: teamName(other(a.by!)), side: a.side === 'ct' ? 'CT' : 'T' })}</>}
                  </>
                )}
                {a?.kind === 'decider' && t('veto.deciderState')}
              </div>
            </div>
            {clickable ? (
              <button className={v.next.type === 'ban' ? 'ban' : ''} onClick={() => send('/act', { mapId: m.id })}>
                {t(v.next.type === 'ban' ? 'veto.banBtn' : 'veto.pickBtn')}
              </button>
            ) : a ? (
              <span className={`vtag ${a.kind}`}>
                {a.kind === 'ban' ? t('veto.banBtn') : a.kind === 'pick' ? t('veto.pickBtn') : t('veto.tag.decider')}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const admin = v.you === 'admin' && (!v.locked || v.running) && (
    <div className="vadmin">
      {!v.locked && v.status !== 'done' && <button className="ghost" onClick={() => send('/auto', {})}>{t('veto.auto')}</button>}
      <button className="ghost" onClick={() => confirm(t(v.running ? 'veto.confirmResetRunning' : 'veto.confirmReset')) && send('/reset', {})}>{t('veto.reset')}</button>
    </div>
  );

  // После вето: компактная история в сворачиваемом блоке
  if (!active) {
    return (
      <details className="mbox">
        <summary>{t('veto.title')}</summary>
        {steps}
        <div style={{ height: 10 }} />
        {list}
        {error && <p className="error">{error}</p>}
        {admin}
      </details>
    );
  }

  return (
    <>
      <div className={`mbox veto-head${v.canAct ? ' mine' : ''}`}>
        <div className="who">{banner}</div>
        <div className="sub">
          BO{v.bestOf} · {t('veto.firstNote', { team: teamName('a') })}
          {v.locked && v.status !== 'done' && <> · {t('veto.locked')}</>}
        </div>
        {v.next.type === 'side' && v.canAct && !v.locked && (
          <div className="sides">
            <button className="ct" onClick={() => send('/act', { side: 'ct' })}>{t('veto.ct')}</button>
            <button className="t" onClick={() => send('/act', { side: 't' })}>{t('veto.t')}</button>
          </div>
        )}
        {steps}
      </div>
      {error && <p className="error">{error}</p>}
      {list}
      {admin}
    </>
  );
}
