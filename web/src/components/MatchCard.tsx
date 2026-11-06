import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EntryDto, MatchDto } from '../api';
import { useI18n } from '../i18n';
import { ActionMenu } from './ActionMenu';

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

function entryName(entry: EntryDto, t: ReturnType<typeof useI18n>['t']) {
  return entry.type === 'team' ? entry.name : entry.type === 'bye' ? t('match.bye') : t('match.tbd');
}

function Slot({ entry, score, won, side }: { entry: EntryDto; score: number; won: boolean; side: 'a' | 'b' }) {
  const { t } = useI18n();
  return (
    <div className={`slot ${side}${won ? ' won' : ''}${entry.type !== 'team' ? ' empty' : ''}`}>
      {entry.type === 'team' && entry.seed ? <small>{entry.seed}</small> : null}
      <span className="sname">{entryName(entry, t)}</span>
      <b>{entry.type === 'team' ? score : ''}</b>
    </div>
  );
}

// Карточка матча. Без actions показывает только состояние (предпросмотр, вид для игроков, большой экран).
// Действия организатора убраны в меню, чтобы сетка оставалась читаемой.
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
  // В BO1 вместо счёта серии (1:0) показываем счёт карты; техническая победа всегда засчитывается серией всухую
  const shown = (side: 'a' | 'b') => {
    const pick = (a: number, b: number) => (side === 'a' ? a : b);
    if (m.status === 'live') {
      return m.bestOf === 1 && m.live && m.curMap ? pick(m.curMap.scoreA, m.curMap.scoreB) : pick(m.seriesA ?? 0, m.seriesB ?? 0);
    }
    if (m.status !== 'done') return pick(m.scoreA, m.scoreB);
    if (m.forced || m.walkover) return m.winner === side ? need : 0;
    const map = m.playedMaps?.length === 1 ? m.playedMaps[0] : undefined;
    return m.bestOf === 1 && map ? pick(map.scoreA, map.scoreB) : pick(m.scoreA, m.scoreB);
  };
  const room = m.matchId !== undefined && id ? `/tournaments/${id}/matches/${m.code}` : null;
  // У сыгранного матча незавершённое вето ничего не значит
  const showVeto = m.veto && (m.status !== 'done' || m.veto.done);
  const hasMenu = actions && (inPlay || m.status === 'done');
  return (
    <div className={`match ${m.status}`}>
      <div className="mhead">
        {room ? <Link to={room}>{m.code}</Link> : <span>{m.code}</span>}
        <span className="mfmt">{m.walkover ? t('mp.walkoverShort') : m.forced ? t('match.byAdmin') : `BO${m.bestOf}`}</span>
        {hasMenu && (
          <ActionMenu label={t('match.actions')}>
            {m.status === 'live' && (
              <>
                <button className="menuitem" onClick={() => actions.onPause(m.code, !m.paused)}>{m.paused ? t('match.unpause') : t('match.pause')}</button>
                {m.live && <button className="menuitem" onClick={() => confirm(t('match.confirmRestartMap')) && actions.onRestartMap(m.code)}>{t('match.restartMap')}</button>}
                {m.live && (
                  <div className="menurow">
                    <input type="number" min={0} max={roundsPlayed} value={round ?? roundsPlayed} aria-label={t('match.restoreRound')}
                      onChange={(e) => setRound(Math.max(0, Math.min(roundsPlayed, Number(e.target.value) || 0)))} />
                    <button className="ghost" onClick={() => {
                      const r = round ?? roundsPlayed;
                      if (confirm(t('match.confirmRestoreRound', { round: r }))) actions.onRestoreRound(m.code, r);
                    }}>{t('match.restoreRound')}</button>
                  </div>
                )}
                <button className="menuitem" onClick={() => confirm(t('match.confirmRestartMatch')) && actions.onRestartMatch(m.code)}>{t('match.restartMatch')}</button>
                <hr />
              </>
            )}
            {inPlay && (
              <>
                <div className="menurow">
                  <input type="number" min={0} max={need} value={a} aria-label={entryName(m.a, t)} onChange={(e) => setA(Number(e.target.value))} />
                  <span>:</span>
                  <input type="number" min={0} max={need} value={b} aria-label={entryName(m.b, t)} onChange={(e) => setB(Number(e.target.value))} />
                  <button className="ghost" onClick={() => actions.onResult(m.code, a, b)}>OK</button>
                </div>
                <button className="menuitem" onClick={() => actions.onWinner(m.code, 'a')}>{t('match.victory')}: {entryName(m.a, t)}</button>
                <button className="menuitem" onClick={() => actions.onWinner(m.code, 'b')}>{t('match.victory')}: {entryName(m.b, t)}</button>
              </>
            )}
            {m.status === 'done' && <button className="menuitem" onClick={() => actions.onUndo(m.code)}>{t('match.undo')}</button>}
          </ActionMenu>
        )}
      </div>
      <Slot entry={m.a} score={shown('a')} side="a" won={m.winner === 'a' && m.status === 'done'} />
      <Slot entry={m.b} score={shown('b')} side="b" won={m.winner === 'b' && m.status === 'done'} />
      {m.status === 'live' && (
        <div className="livebox onair">
          <div>
            {m.live
              ? <>{t('match.playing', { map: m.curMap?.name ?? t('match.map'), a: m.curMap?.scoreA ?? 0, b: m.curMap?.scoreB ?? 0 })}{m.paused && ` · ${t('match.paused')}`}</>
              : t('match.waiting')}
          </div>
          {m.server && <div className="srvline">{m.server.name} · <code>connect {m.server.host}:{m.server.port}</code></div>}
        </div>
      )}
      {m.status === 'done' && m.playedMaps && m.playedMaps.length > 0 && (
        <div className="livebox muted">{m.playedMaps.map((p) => `${p.name ?? t('match.map')} ${p.scoreA}:${p.scoreB}`).join(' · ')}</div>
      )}
      {showVeto && (
        <div className="livebox vetolink">
          <Link to={`/tournaments/${id}/matches/${m.code}`}>
            {m.veto!.done ? t('veto.view') : t('veto.open', { step: m.veto!.step, total: m.veto!.total })}
          </Link>
        </div>
      )}
      {actions && m.note && <div className="livebox error">{err(m.note)}</div>}
      {actions && m.status === 'ready' && (
        <div className="result">
          <button className="ghost" onClick={() => actions.onDispatch(m.code)}>{t('match.dispatch')}</button>
        </div>
      )}
    </div>
  );
}
