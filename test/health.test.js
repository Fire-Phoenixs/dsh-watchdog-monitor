import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../lib/health.js';
const now = Date.parse('2026-11-23T12:00:00Z');
const item = { kind: 'systemd-timer', expected_interval: 300, stale_after: 900 };
const good = { active: true, lastRun: new Date(now - 100000).toISOString(), result: 0, verified: true };
test('healthy within explicit threshold', () => assert.equal(evaluate(item, good, now).status, 'OK'));
test('stopped timer is immediately stale', () => assert.equal(evaluate(item, { ...good, active: false }, now).status, 'STALE'));
test('task failures beat stale status', () => assert.equal(evaluate(item, { ...good, active: false, result: 1 }, now).status, 'FAIL'));
test('transport failure never reuses success', () => assert.equal(evaluate(item, { ...good, error: 'SSH offline' }, now).status, 'UNKNOWN'));
test('never executed is unverified', () => assert.equal(evaluate(item, { active: true }, now).status, 'UNKNOWN'));
test('explicit interval threshold matters', () => {
  const old = { ...good, lastRun: new Date(now - 800000).toISOString() };
  assert.equal(evaluate(item, old, now).status, 'OK');
  assert.equal(evaluate({ ...item, stale_after: 600 }, old, now).status, 'STALE');
});
test('on-logon success does not age out', () => assert.equal(evaluate({ ...item, mode: 'on-logon' }, { ...good, lastRun: '2025-01-01T00:00:00Z' }, now).status, 'OK'));
test('service without business probe remains unknown', () => assert.equal(evaluate({ kind: 'systemd-service' }, good, now).status, 'UNKNOWN'));
test('business probe failure', () => assert.equal(evaluate({ kind: 'systemd-service' }, { ...good, probeOk: false }, now).status, 'FAIL'));
test('repeated container restarts', () => assert.equal(evaluate({ kind: 'docker' }, { ...good, probeOk: true, restartDelta: 3 }, now).status, 'FAIL'));
test('expired cert', () => assert.equal(evaluate({ kind: 'certificate' }, { expiresAt: '2026-11-22T00:00:00Z' }, now).status, 'FAIL'));
test('missing success evidence is unknown', () => assert.equal(evaluate(item, { ...good, verified: false }, now).status, 'UNKNOWN'));
test('required running task stopped fails', () => assert.equal(evaluate({ kind: 'windows-task', mode: 'running' }, { active: false }, now).status, 'FAIL'));
test('Windows SCHED_S_TASK_HAS_NOT_RUN is unverified', () => assert.equal(evaluate({ kind: 'windows-task' }, { result: 267011, lastRun: null }, now).status, 'UNKNOWN'));
test('disabled task is stale', () => assert.equal(evaluate({ kind: 'windows-task' }, { ...good, state: 'Disabled' }, now).status, 'STALE'));
test('today uses monitored host calendar', () => {
  assert.equal(evaluate({ kind: 'file-log', mode: 'today' }, { ...good, fileDay: '2026-11-23', currentDay: '2026-11-23' }, now).status, 'OK');
  assert.equal(evaluate({ kind: 'file-log', mode: 'today' }, { ...good, fileDay: '2026-11-22', currentDay: '2026-11-23' }, now).status, 'STALE');
});
