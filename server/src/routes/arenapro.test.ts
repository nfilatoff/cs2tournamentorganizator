import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBracket } from '../bracket.js';

const dataDir = mkdtempSync(join(tmpdir(), 'arenapro-events-test-'));
process.env.DATA_DIR = dataDir;
const { db } = await import('../db.js');
const { getMatchRow, getTournament, insertMatches } = await import('../tournamentStore.js');
const { createGroupMatches } = await import('../groupStage.js');
const { handleEvent } = await import('./arenapro.js');
after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

db.exec(`
  INSERT INTO players (id, steam_id, name) VALUES (1, '1', 'opasdpas'), (2, '2', 'opponent');
  INSERT INTO teams (id, name, join_code, captain_id) VALUES (1, 'opasdpas', 'one', 1), (2, 'opponent', 'two', 2);
  INSERT INTO game_servers (id, name, host, port, rcon_password) VALUES (1, 'test', '127.0.0.1', 27015, 'test');
`);

beforeEach(() => {
  db.exec(`
    DROP TRIGGER IF EXISTS fail_runtime_cleanup;
    DELETE FROM tournaments;
    INSERT INTO tournaments (id, name, format, team_size, max_teams, auto_dispatch, status)
      VALUES (1, 'test', 'single', 1, 2, 0, 'running');
  `);
});

function livePlayoff(bestOf = 1): number {
  insertMatches(1, buildBracket([1, 2], 'single', { bestOf: () => bestOf }), 'playoff');
  const row = db.prepare('SELECT id FROM matches WHERE tournament_id = 1').get() as { id: number };
  db.prepare("UPDATE matches SET status = 'live', server_id = 1, live = 1 WHERE id = ?").run(row.id);
  return row.id;
}

function mapResult(id: number, seriesScore = 1): void {
  handleEvent({ event: 'map_result', matchid: id, map_number: 0,
    team1: { score: 13, series_score: seriesScore }, team2: { score: 7, series_score: 0 },
    winner: { side: 'ct', team: 'team1' } });
}

test('map_result updates the map and series scores before series_end (including retries)', () => {
  const id = livePlayoff(3);
  mapResult(id);
  mapResult(id);
  const row = getMatchRow(id)!;
  assert.equal(row.status, 'live');
  assert.equal(row.cur_score_a, 13);
  assert.equal(row.cur_score_b, 7);
  assert.equal(row.series_a, 1);
  assert.equal(row.series_b, 0);
  const maps = db.prepare('SELECT * FROM match_maps WHERE match_id = ?').all(id);
  assert.equal(maps.length, 1);
  assert.equal(maps[0].winner, 'a');
});

test('series_end saves a BO1 win, finishes the tournament and frees the server', () => {
  const id = livePlayoff();
  mapResult(id);
  const ev = { event: 'series_end', matchid: id, team1_series_score: 1, team2_series_score: 0 };
  handleEvent(ev);
  handleEvent(ev);
  const row = getMatchRow(id)!;
  assert.equal(row.status, 'done');
  assert.equal(row.winner, 'a');
  assert.equal(row.score_a, 1);
  assert.equal(row.score_b, 0);
  assert.equal(row.server_id, null);
  assert.equal(row.walkover, 0);
  assert.equal(getTournament(1)!.status, 'finished');
  assert.equal(getTournament(1)!.champion_team_id, 1);
  assert.equal(db.prepare('SELECT winner FROM match_maps WHERE match_id = ?').get(id)!.winner, 'a');
});

test('series_end advances the group stage inside the same transaction', () => {
  db.exec(`
    UPDATE tournaments SET stage_mode = 'groups', phase = 'groups', group_format = 'round_robin', has_playoff = 0 WHERE id = 1;
    INSERT INTO tournament_teams (tournament_id, team_id, seed, roster) VALUES (1, 1, 1, '[1]'), (1, 2, 2, '[2]');
  `);
  createGroupMatches(getTournament(1)!, [1, 2]);
  const { id } = db.prepare('SELECT id FROM matches WHERE tournament_id = 1').get() as { id: number };
  db.prepare("UPDATE matches SET status = 'live', server_id = 1, live = 1 WHERE id = ?").run(id);
  mapResult(id);
  handleEvent({ event: 'series_end', matchid: id, team1_series_score: 1, team2_series_score: 0 });
  assert.equal(getMatchRow(id)!.status, 'done');
  assert.equal(getTournament(1)!.phase, 'groups_done');
  assert.equal(getTournament(1)!.status, 'finished');
});

test('series_end awards team2 a walkover when no map ever went live', () => {
  const id = livePlayoff();
  db.prepare('UPDATE matches SET live = 0 WHERE id = ?').run(id);
  handleEvent({ event: 'series_end', matchid: id, team1_series_score: 0, team2_series_score: 1 });
  const row = getMatchRow(id)!;
  assert.equal(row.status, 'done');
  assert.equal(row.winner, 'b');
  assert.equal(row.walkover, 1);
  assert.equal(row.server_id, null);
  assert.equal(getTournament(1)!.champion_team_id, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM match_maps WHERE match_id = ?').get(id)!.n, 0);
});

test('cleanup failure rolls back the match result and tournament completion', () => {
  const id = livePlayoff();
  mapResult(id);
  db.exec(`CREATE TRIGGER fail_runtime_cleanup BEFORE UPDATE OF server_id ON matches
    WHEN NEW.server_id IS NULL BEGIN SELECT RAISE(ABORT, 'cleanup failed'); END;`);
  assert.throws(() => handleEvent({ event: 'series_end', matchid: id, team1_series_score: 1, team2_series_score: 0 }), /cleanup failed/);
  assert.equal(getMatchRow(id)!.status, 'live');
  assert.equal(getMatchRow(id)!.server_id, 1);
  assert.equal(getTournament(1)!.status, 'running');
  assert.equal(getTournament(1)!.champion_team_id, null);
});
