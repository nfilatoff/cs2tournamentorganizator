import { db } from './db.js';
import {
  boFn, loadMatchRows, loadMatches, teamName, type MatchRow, type TournamentRow,
} from './tournamentStore.js';
import { buildBracket, minTeams, roundFromEnd, type BMatch, type Entry, type Source } from './bracket.js';
import type { MapRef } from './arenapro.js';
import { assignGroups } from './groups.js';
import { tournamentMapPool } from './arenapro.js';
import { vetoSummary } from './vetoStore.js';
import { groupsOf, seedsOf, suggestedPlayoff, swissTotal, tableOf } from './groupStage.js';
import { mapImageUrl } from './mapImages.js';

type Seeds = Map<number, number>;
type ServerInfo = { id: number; name: string; host: string; port: number };

function entryDto(e: Entry, seeds: Seeds) {
  if (e.k === 'team') return { type: 'team' as const, id: e.id, name: teamName(e.id), seed: seeds.get(e.id) ?? null };
  return { type: e.k };
}

// Откуда берётся участник матча: нужно интерфейсу, чтобы нарисовать линии сетки
function fromDto(src: Source) {
  return src.t === 'seed' ? null : { kind: src.t, code: src.code };
}

function runtimeDto(r: MatchRow | undefined, servers: Map<number, ServerInfo>, veto: unknown = null) {
  if (!r) return {};
  const refs = r.maps_json ? (JSON.parse(r.maps_json) as MapRef[]) : [];
  const played = db.prepare('SELECT map_no, score_a, score_b, winner FROM match_maps WHERE match_id = ? ORDER BY map_no')
    .all(r.id) as unknown as { map_no: number; score_a: number; score_b: number; winner: 'a' | 'b' | null }[];
  const server = r.server_id ? servers.get(r.server_id) : undefined;
  return {
    matchId: r.id,
    veto,
    server: server ?? null,
    live: !!r.live,
    paused: !!r.paused,
    note: r.note,
    seriesA: r.series_a,
    seriesB: r.series_b,
    curMap: r.live ? { no: r.cur_map_no, name: refs[r.cur_map_no]?.name ?? null, scoreA: r.cur_score_a, scoreB: r.cur_score_b } : null,
    playedMaps: played.map((p) => ({ no: p.map_no, name: refs[p.map_no]?.name ?? null, scoreA: p.score_a, scoreB: p.score_b, winner: p.winner })),
  };
}

function matchDtos(ms: BMatch[], seeds: Seeds, rows?: Map<string, MatchRow>, servers?: Map<number, ServerInfo>, t?: TournamentRow) {
  const poolSize = t ? tournamentMapPool(t.id).length : 0;
  return ms.map((m) => ({
    code: m.code, bracket: m.bracket, round: m.round, position: m.position,
    stage: m.bracket === 'G' ? ('group' as const) : ('playoff' as const),
    groupNo: m.bracket === 'G' ? Number(/^G(\d+)-/.exec(m.code)?.[1] ?? 0) : null,
    roundFromEnd: roundFromEnd(ms, m),
    from: [fromDto(m.srcA), fromDto(m.srcB)],
    a: entryDto(m.a, seeds), b: entryDto(m.b, seeds), status: m.status, winner: m.winner,
    bestOf: m.bestOf, scoreA: m.scoreA, scoreB: m.scoreB, forced: m.forced,
    ...(rows && servers ? runtimeDto(rows.get(m.code), servers, t && rows.get(m.code) ? vetoSummary(t, rows.get(m.code)!, poolSize) : null) : {}),
  }));
}

interface TeamRowDb { team_id: number; seed: number | null; roster: string; name: string }

function teamsOf(tid: number): TeamRowDb[] {
  return db.prepare(`
    SELECT tt.team_id, tt.seed, tt.roster, te.name FROM tournament_teams tt JOIN teams te ON te.id = tt.team_id
    WHERE tt.tournament_id = ? ORDER BY COALESCE(tt.seed, 9999), tt.registered_at
  `).all(tid) as unknown as TeamRowDb[];
}

// Таблицы групп с отметкой прошедших дальше
function groupsDto(t: TournamentRow, ms: BMatch[], seeds: Seeds) {
  if (t.stage_mode !== 'groups') return null;
  const assignment = groupsOf(t.id);
  const teamCount = [...assignment.values()].reduce((n, ids) => n + ids.length, 0);
  return {
    swissTotal: t.group_format === 'swiss' ? swissTotal(t, teamCount) : null,
    tables: [...assignment.keys()].sort((x, y) => x - y).map((g) => ({
      no: g,
      standings: tableOf(t, g, ms, assignment.get(g)!, seeds).map((r) => ({
        ...r, name: teamName(r.teamId), qualified: r.rank <= t.advance,
      })),
    })),
  };
}

function groupConfigDto(t: TournamentRow) {
  return {
    stageMode: t.stage_mode, phase: t.phase, format: t.group_format, groupsCount: t.groups_count,
    advance: t.advance, swissRounds: t.swiss_rounds, bestOf: t.group_best_of, hasPlayoff: !!t.has_playoff,
  };
}

export function details(t: TournamentRow) {
  const teams = teamsOf(t.id);
  const seeds: Seeds = new Map(teams.flatMap((x) => (x.seed ? [[x.team_id, x.seed] as [number, number]] : [])));
  const maps = db.prepare(`
    SELECT m.id, m.name, m.workshop_id, m.map_file, m.image_url FROM tournament_maps tm JOIN maps m ON m.id = tm.map_id
    WHERE tm.tournament_id = ? ORDER BY tm.position
  `).all(t.id) as unknown as { id: number; name: string; workshop_id: string | null; map_file: string | null; image_url: string | null }[];
  const ms = loadMatches(t.id);
  const rows = new Map(loadMatchRows(t.id).map((r) => [r.code, r]));
  const servers = new Map((db.prepare('SELECT id, name, host, port FROM game_servers').all() as unknown as ServerInfo[])
    .map((s) => [s.id, s]));
  return {
    id: t.id, name: t.name, format: t.format, teamSize: t.team_size, maxTeams: t.max_teams,
    defaultBestOf: t.default_best_of, boConfig: JSON.parse(t.bo_config) as Record<string, number>,
    grandFinalReset: !!t.grand_final_reset, autoDispatch: !!t.auto_dispatch, status: t.status,
    champion: t.champion_team_id ? { id: t.champion_team_id, name: teamName(t.champion_team_id) } : null,
    teams: teams.map((x) => ({ id: x.team_id, name: x.name, seed: x.seed, roster: JSON.parse(x.roster) as number[] })),
    maps: maps.map((m) => ({ id: m.id, name: m.name, workshopId: m.workshop_id, mapFile: m.map_file, imageUrl: mapImageUrl(m) })),
    vetoEnabled: !!t.veto_enabled,
    pauses: { tactical: t.tactical_pauses, tacticalTime: t.tactical_pause_time, technical: t.tech_pauses },
    matches: matchDtos(ms, seeds, rows, servers, t),
    groupConfig: groupConfigDto(t),
    groups: groupsDto(t, ms, seeds),
  };
}

// Как будет выглядеть сетка при текущей рассадке (до старта турнира)
export function previewDto(t: TournamentRow) {
  const teams = teamsOf(t.id);
  if (t.stage_mode === 'groups') {
    const ids = teams.map((x) => x.team_id);
    const names = new Map(teams.map((x) => [x.team_id, x.name]));
    return {
      matches: [],
      groupAssignment: assignGroups(ids, t.groups_count).map((g, i) => ({
        no: i + 1, teams: g.map((id) => ({ id, name: names.get(id)!, seed: ids.indexOf(id) + 1 })),
      })),
    };
  }
  if (teams.length < minTeams(t.format)) return { matches: [] };
  const seeds: Seeds = new Map(teams.map((x, i) => [x.team_id, i + 1]));
  const ms = buildBracket(teams.map((x) => x.team_id), t.format, {
    grandFinalReset: !!t.grand_final_reset, bestOf: boFn(t),
  });
  return { matches: matchDtos(ms, seeds) };
}

// Приводит seed команд турнира к 1..N по текущему порядку
export function renumberSeeds(tid: number): void {
  const upd = db.prepare('UPDATE tournament_teams SET seed = ? WHERE tournament_id = ? AND team_id = ?');
  teamsOf(tid).forEach((x, i) => upd.run(i + 1, tid, x.team_id));
}

// Сетка плей-офф для выбранного порядка сидов после групп (и подсказка по порядку)
export function playoffPreviewDto(t: TournamentRow, order?: number[]) {
  const suggested = suggestedPlayoff(t);
  const ids = order ?? suggested.order.map((q) => q.teamId);
  const info = new Map(suggested.order.map((q) => [q.teamId, q]));
  const seeds: Seeds = new Map(ids.map((id, i) => [id, i + 1]));
  const ms = buildBracket(ids, t.format, { grandFinalReset: !!t.grand_final_reset, bestOf: boFn(t) });
  return {
    ties: suggested.ties,
    order: ids.map((id) => ({
      id, name: teamName(id), group: info.get(id)?.group ?? null, rank: info.get(id)?.rank ?? null,
      tiedBySeed: info.get(id)?.tiedBySeed ?? false,
    })),
    matches: matchDtos(ms, seeds),
  };
}


