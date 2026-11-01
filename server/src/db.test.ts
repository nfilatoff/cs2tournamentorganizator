import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'arenapro-db-test-'));
process.env.DATA_DIR = dataDir;
const { db, tx, getSetting, setSetting } = await import('./db.js');
after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('nested transactions commit together and return their result', () => {
  const result = tx(() => {
    setSetting('outer', 'saved');
    return tx(() => {
      setSetting('inner', 'saved');
      return 42;
    });
  });
  assert.equal(result, 42);
  assert.equal(getSetting('outer'), 'saved');
  assert.equal(getSetting('inner'), 'saved');
});

test('outer rollback also undoes successful nested transactions', () => {
  const failure = new Error('outer failed');
  assert.throws(() => tx(() => {
    tx(() => setSetting('rolled-back-inner', 'value'));
    throw failure;
  }), (error) => error === failure);
  assert.equal(getSetting('rolled-back-inner'), undefined);
  tx(() => setSetting('after-rollback', 'saved'));
  assert.equal(getSetting('after-rollback'), 'saved');
});

test('caught inner failure rolls back only the inner savepoint', () => {
  const failure = new Error('inner failed');
  tx(() => {
    setSetting('kept-outer', 'saved');
    assert.throws(() => tx(() => {
      setSetting('failed-inner', 'value');
      throw failure;
    }), (error) => error === failure);
    tx(() => setSetting('next-inner', 'saved'));
  });
  assert.equal(getSetting('kept-outer'), 'saved');
  assert.equal(getSetting('failed-inner'), undefined);
  assert.equal(getSetting('next-inner'), 'saved');
});
