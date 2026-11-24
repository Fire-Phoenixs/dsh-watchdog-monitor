import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleItem, scheduleInterval, collectSchedules } from '../lib/schedule.js';

const now = Date.parse('2026-11-23T04:00:00Z');
const row = { id: 'a', title: 'A', status: 'active', kind: 'every', everySeconds: 300,
  scheduledAt: new Date(now + 300000).toISOString() };

test('unverified schedule is UNKNOWN before its first delivery', () => {
  assert.equal(scheduleItem(row, 'dsh', now).status, 'UNKNOWN');
});
test('recent delivery validates delivery scope only', () => {
  const item = scheduleItem({ ...row, lastDelivery: { deliveredAt: new Date(now - 60000).toISOString() } }, 'dsh', now);
  assert.equal(item.status, 'OK');
  assert.equal(item.evidence.healthScope, 'delivery-only');
});
test('authoritative next occurrence overdue beyond grace is STALE', () => {
  assert.equal(scheduleItem({ ...row, scheduledAt: new Date(now - 180000).toISOString() }, 'dsh', now).status, 'STALE');
});
test('weekday recurrence allows the weekend gap', () => {
  assert.equal(scheduleInterval({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }), 259200);
});
test('ended schedule entries go to history, not active summary', async () => {
  const result = await collectSchedules({ schedule: { catalog: async () => [row, { ...row, id: 'b', status: 'ended' }] } }, 'dsh');
  assert.equal(result.items.length, 1);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].id, 'dsh:b');
});
test('incompatible catalog response rejects instead of reporting healthy empty state', async () => {
  await assert.rejects(collectSchedules({ schedule: { catalog: async () => null } }), /返回格式不兼容/);
});
