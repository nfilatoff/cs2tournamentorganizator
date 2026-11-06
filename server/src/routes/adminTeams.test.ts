import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';

const dataDir = mkdtempSync(join(tmpdir(), 'arenapro-teams-test-'));
process.env.DATA_DIR = dataDir;
const { db } = await import('../db.js');
const { teamName } = await import('../tournamentStore.js');
const { adminTeamRoutes } = await import('./adminTeams.js');

const app = Fastify();
await app.register(cookie);
await app.register(adminTeamRoutes);
after(async () => {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const asAdmin = { sid: 'admin-session' };
db.prepare("INSERT INTO sessions (token, kind, user_id, expires_at) VALUES (?, 'admin', 1, ?)").run(asAdmin.sid, Date.now() + 60_000);
db.exec("INSERT INTO players (id, steam_id, name) VALUES (1, '1', 'one')");

beforeEach(() => {
  db.exec(`
    DELETE FROM tournaments;
    DELETE FROM teams;
    INSERT INTO teams (id, name, join_code, captain_id) VALUES (1, 'Finished', 'A1', 1), (2, 'Active', 'B2', 1), (3, 'Free', 'C3', 1);
    INSERT INTO team_members (team_id, player_id) VALUES (1, 1), (2, 1), (3, 1);
    INSERT INTO tournaments (id, name, format, team_size, max_teams, status, champion_team_id)
      VALUES (1, 'old', 'single', 1, 2, 'finished', 1), (2, 'now', 'single', 1, 2, 'running', NULL);
    INSERT INTO tournament_teams (tournament_id, team_id, roster) VALUES (1, 1, '[1]'), (2, 2, '[1]');
  `);
});

const listNames = async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/teams', cookies: asAdmin });
  return (res.json() as { name: string }[]).map((t) => t.name);
};

test('a team from a finished tournament is deleted but stays in its history', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/teams/1', cookies: asAdmin });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await listNames(), ['Active', 'Free']);
  assert.equal(teamName(1), 'Finished');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = 1').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT champion_team_id AS id FROM tournaments WHERE id = 1').get() as { id: number }).id, 1);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/admin/teams/1', cookies: asAdmin })).statusCode, 404);
});

test('the name of a deleted team can be used again', async () => {
  await app.inject({ method: 'DELETE', url: '/api/admin/teams/1', cookies: asAdmin });
  const res = await app.inject({
    method: 'POST', url: '/api/admin/teams', cookies: asAdmin,
    body: { name: 'Finished', players: [{ steamId: '76561190000000001', name: 'new' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(teamName(1), 'Finished');
});

test('a team without history is erased and an active one is refused', async () => {
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/admin/teams/3', cookies: asAdmin })).statusCode, 200);
  assert.equal(db.prepare('SELECT 1 FROM teams WHERE id = 3').get(), undefined);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/admin/teams/2', cookies: asAdmin })).statusCode, 409);
});

test('delete-all removes everything except teams in unfinished tournaments', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/teams/delete-all', cookies: asAdmin });
  assert.deepEqual(res.json(), { deleted: 2, skipped: 1 });
  assert.deepEqual(await listNames(), ['Active']);
});

test('delete-all requires an administrator', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/teams/delete-all' });
  assert.equal(res.statusCode, 401);
  assert.equal((await listNames()).length, 3);
});
