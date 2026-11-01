import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EntryDto, MatchDto } from '../api';
import { useI18n } from '../i18n';

export interface MatchActions {
  onResult: (code: string, a: number, b: number) => void;
  onWinner: (code: string, winner: 'a' | 'b') => void;
  onUndo: (code: string) => void;
  onDispatch: (code: string) => void;
  onPause: (code: string, paused: boolean) => void;
  onRestartMap: (code: string) => void;
  onRestoreRound: (code: string, round: number) => void;
  onRestartMatch: (code: string) => void;
}

function Slot({ entry, score, won }: { entry: EntryDto; score: number; won: boolean }) {
  const { t } = useI18n();
  const text = entry.type === 'team'
    ? `${entry.seed ? `#${entry.seed} ` : ''}${entry.name}`
    : entry.type === 'bye' ? t('match.bye') : t('match.tbd');
  return (
    <div className={`slot${won ? ' won' : ''}${entry.type !== 'team' ? ' empty' : ''}`}>
      <span>{text}</span>
      <b>{entry.type === 'team' ? score : ''}</b>
    </div>
  );
}

// Карточка матча. Без actions показывает только состояние (предпросмотр, вид для игроков).
export function MatchCard({ m, actions }: { m: MatchDto; actions?: MatchActions }) {
  const { t, err } = useI18n();
  const { id } = useParams();
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [round, setRound] = useState<number | null>(null);
  // Бэкап N это состояние после N сыгранных раундов, последний есть у текущего раунда
  const roundsPlayed = (m.curMap?.scoreA ?? 0) + (m.curMap?.scoreB ?? 0);
  const need = Math.ceil(m.bestOf / 2);
  const inPlay = m.status === 'ready' || m.status === 'live';
  return (
    <div className={`match ${m.status}`}>
      <div className="mhead">
        {m.matchId !== undefined && id ? <Link to={`/tournaments/${id}/matches/${m.code}`}>{m.code}</Link> : <span>{m.code}</span>}
        <span>{m.walkover ? t('mp.walkoverShort') : m.forced ? t('match.byAdmin') : `BO${m.bestOf}`}</span>
      </div>
      <Slot entry={m.a} score={m.status === 'live' ? m.seriesA ?? 0 : m.scoreA} won={m.winner === 'a' && m.status === 'done'} />
      <Slot entry={m.b} score={m.status === 'live' ? m.seriesB ?? 0 : m.scoreB} won={m.winner === 'b' && m.status === 'done'} />
      {m.veto && (
        <div className="livebox">
          <Link to={`/tournaments/${id}/matches/${m.code}/veto`}>
            {m.veto.done ? t('veto.view') : t('veto.open', { step: m.veto.step, total: m.veto.total })}
          </Link>
        </div>
      )}
      {m.status === 'live' && (
        <div className="livebox">
          <div>
            {m.live
              ? <>{t('match.playing', { map: m.curMap?.name ?? t('match.map'), a: m.curMap?.scoreA ?? 0, b: m.curMap?.scoreB ?? 0 })}{m.paused && ` · ${t('match.paused')}`}</>
              : t('match.waiting')}
          </div>
          {m.server && <div>{t('match.server')}: <b>{m.server.name}</b>, <code>connect {m.server.host}:{m.server.port}</code></div>}
        </div>
      )}
      {m.status === 'done' && m.playedMaps && m.playedMaps.length > 0 && (
        <div className="livebox muted">{m.playedMaps.map((p) => `${p.name ?? t('match.map')} ${p.scoreA}:${p.scoreB}`).join(' · ')}</div>
      )}
      {actions && m.note && <div className="livebox error">{err(m.note)}</div>}
      {actions && m.status === 'ready' && (
        <div className="result">
          <button onClick={() => actions.onDispatch(m.code)}>{t('match.dispatch')}</button>
        </div>
      )}
      {actions && m.status === 'live' && (
        <div className="result wrap">
          <button className="ghost" onClick={() => actions.onPause(m.code, !m.paused)}>{m.paused ? t('match.unpause') : t('match.pause')}</button>
          {m.live && <button className="ghost" onClick={() => confirm(t('match.confirmRestartMap')) && actions.onRestartMap(m.code)}>{t('match.restartMap')}</button>}
          {m.live && (
            <span className="roundrestore">
              <input type="number" min={0} max={roundsPlayed} value={round ?? roundsPlayed}
                onChange={(e) => setRound(Math.max(0, Math.min(roundsPlayed, Number(e.target.value) || 0)))} />
              <button className="ghost" onClick={() => {
                const r = round ?? roundsPlayed;
                if (confirm(t('match.confirmRestoreRound', { round: r }))) actions.onRestoreRound(m.code, r);
              }}>{t('match.restoreRound')}</button>
            </span>
          )}
          <button className="ghost" onClick={() => confirm(t('match.confirmRestartMatch')) && actions.onRestartMatch(m.code)}>{t('match.restartMatch')}</button>
        </div>
      )}
      {actions && inPlay && (
        <>
          <div className="result">
            <input type="number" min={0} max={need} value={a} onChange={(e) => setA(Number(e.target.value))} />
            <span>:</span>
            <input type="number" min={0} max={need} value={b} onChange={(e) => setB(Number(e.target.value))} />
            <button onClick={() => actions.onResult(m.code, a, b)}>OK</button>
          </div>
          <div className="result">
            <span className="muted">{t('match.victory')}:</span>
            <button className="ghost" onClick={() => actions.onWinner(m.code, 'a')}>A</button>
            <button className="ghost" onClick={() => actions.onWinner(m.code, 'b')}>B</button>
          </div>
        </>
      )}
      {actions && m.status === 'done' && (
        <div className="result">
          <button className="ghost" onClick={() => actions.onUndo(m.code)}>{t('match.undo')}</button>
        </div>
      )}
    </div>
  );
}
