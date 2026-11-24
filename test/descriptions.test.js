import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DescriptionStore, defaultDescription } from '../lib/descriptions.js';

async function fixture() {
  // Retain fixtures: this workspace forbids deletion operations.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-watchdog-descriptions-'));
  const path = join(dir, 'descriptions.json');
  return { path, store: new DescriptionStore(path), ids: new Set(['pc-1', 'pc-2', 'dsh:task-1']) };
}
test('missing store stays empty without creating a file', async () => {
  const { store, path } = await fixture();
  assert.deepEqual(await store.get(), { version: 1, revision: 0, descriptions: {}, displayNames: {} });
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});
test('patch persists across restart, preserves unrelated values, and retains explicit blank overrides', async () => {
  const { store, path, ids } = await fixture();
  await store.patch({ revision: 0, updates: [{ id: 'pc-1', description: '云盘挂载守护' }, { id: 'dsh:task-1', description: '用户维护的简介' }] }, ids);
  await new DescriptionStore(path).patch({ revision: 1, updates: [{ id: 'pc-1', description: '' }] }, ids);
  const value = await store.get();
  assert.deepEqual(value, { version: 1, revision: 2, descriptions: { 'pc-1': '', 'dsh:task-1': '用户维护的简介' }, displayNames: {} });
});
test('concurrent requests across store instances reject stale revision and queue survives rejection', async () => {
  const { store, path, ids } = await fixture();
  const update = { revision: 0, updates: [{ id: 'pc-1', description: 'first' }] };
  const outcomes = await Promise.allSettled([store.patch(update, ids), new DescriptionStore(path).patch(update, ids)]);
  assert.equal(outcomes.filter(v => v.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(v => v.status === 'rejected').reason.message, /revision 冲突/);
  await store.patch({ revision: 1, updates: [{ id: 'pc-2', description: 'second' }] }, ids);
  assert.equal((await store.get()).revision, 2);
});
test('corrupt JSON and structurally corrupt stores are not overwritten', async () => {
  const { store, path, ids } = await fixture();
  for (const source of ['{broken', '{"version":1,"revision":0,"descriptions":[],"surprise":true}']) {
    await writeFile(path, source);
    await assert.rejects(store.get());
    await assert.rejects(store.patch({ revision: 0, updates: [{ id: 'pc-1', description: 'new' }] }, ids));
    assert.equal(await readFile(path, 'utf8'), source);
  }
});
test('unknown IDs, duplicate updates, malformed fields, invalid text and oversized batches never write', async () => {
  const { store, path, ids } = await fixture();
  const invalid = [
    { revision: 0, updates: [{ id: 'unknown', description: 'x' }] },
    { revision: 0, updates: [{ id: 'pc-1', description: 'x' }, { id: 'pc-1', description: 'y' }] },
    { revision: 0, updates: [{ id: '../pc-1', description: 'x' }] },
    { revision: 0, updates: [{ id: 'pc-1', description: 'x', command: 'ignored?' }] },
    { revision: 0, updates: [{ id: 'pc-1', description: 'x'.repeat(161) }] },
    { revision: 0, updates: [{ id: 'pc-1', description: 'first\nsecond' }] },
    { revision: 0, updates: [{ id: 'pc-1', description: null }] },
    { revision: -1, updates: [] },
    { revision: 0, updates: [], extra: true },
    { revision: 0, updates: Array.from({ length: 501 }, () => ({ id: 'pc-1', description: 'x' })) }
  ];
  for (const request of invalid) await assert.rejects(store.patch(request, ids));
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});
test('160 Unicode characters are accepted and caller mutations cannot change queued updates', async () => {
  const { store, ids } = await fixture();
  const text = '🐕'.repeat(160);
  const request = { revision: 0, updates: [{ id: 'pc-1', description: text }] };
  const pending = store.patch(request, ids);
  request.updates[0].description = 'changed'; ids.clear();
  await pending;
  assert.equal((await store.get()).descriptions['pc-1'], text);
});
test('default descriptions use established exact names and do not invent unknown or schedule meanings', () => {
  assert.match(defaultDescription({ name: 'CloudDriveWatchdog', kind: 'windows-task' }), /云盘/);
  assert.match(defaultDescription({ name: 'DshIcsAutofix' }), /登录/);
  assert.match(defaultDescription({ name: 'GitHubBackup' }), /仓库镜像/);
  assert.equal(defaultDescription({ name: 'CloudDriveWatchdog', kind: 'dsh-schedule' }), '');
  assert.equal(defaultDescription({ name: 'dsh-steward.timer' }), '');
  assert.equal(defaultDescription({ name: 'custom user script' }), '');
});

test('legacy store is read with empty displayNames without rewriting its bytes', async () => {
  const { store, path } = await fixture();
  const source = JSON.stringify({ version: 1, revision: 4, descriptions: { 'pc-1': '保留旧简介' } });
  await writeFile(path, source);
  assert.deepEqual(await store.get(), { version: 1, revision: 4, descriptions: { 'pc-1': '保留旧简介' }, displayNames: {} });
  assert.equal(await readFile(path, 'utf8'), source);
});

test('name-only and description-only patches preserve the other field and unrelated items', async () => {
  const { store, path, ids } = await fixture();
  await writeFile(path, JSON.stringify({ version: 1, revision: 7, descriptions: { 'pc-1': '旧简介', 'pc-2': '其它简介' } }));
  await store.patch({ revision: 7, updates: [{ id: 'pc-1', displayName: '云盘守护' }, { id: 'pc-2', displayName: '其它名称' }] }, ids);
  assert.equal((await store.get()).descriptions['pc-1'], '旧简介');
  await store.patch({ revision: 8, updates: [{ id: 'pc-1', description: '新简介' }] }, ids);
  assert.deepEqual(await new DescriptionStore(path).get(), {
    version: 1, revision: 9,
    descriptions: { 'pc-1': '新简介', 'pc-2': '其它简介' },
    displayNames: { 'pc-1': '云盘守护', 'pc-2': '其它名称' }
  });
});

test('combined patch accepts 60 Unicode codepoints and blank name explicitly resets fallback', async () => {
  const { store, ids } = await fixture();
  const request = { revision: 0, updates: [{ id: 'pc-1', displayName: '🐕'.repeat(60), description: '说明' }] };
  const pending = store.patch(request, ids);
  request.updates[0].displayName = 'caller changed';
  await pending;
  assert.equal((await store.get()).displayNames['pc-1'], '🐕'.repeat(60));
  await store.patch({ revision: 1, updates: [{ id: 'pc-1', displayName: '' }] }, ids);
  assert.deepEqual(await store.get(), { version: 1, revision: 2, descriptions: { 'pc-1': '说明' }, displayNames: { 'pc-1': '' } });
});

test('invalid display names and unknown fields are rejected before writing', async () => {
  const { store, path, ids } = await fixture();
  for (const displayName of [null, undefined, 1, {}, [], '🐕'.repeat(61), 'a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u0085b', 'a\u2028b', 'a\u2029b']) {
    await assert.rejects(store.patch({ revision: 0, updates: [{ id: 'pc-1', displayName }] }, ids));
  }
  for (const update of [{ id: 'pc-1' }, { id: 'pc-1', displayName: 'ok', extra: 'bad' }, { displayName: 'no id' }, { id: 'unknown', displayName: 'x' }]) {
    await assert.rejects(store.patch({ revision: 0, updates: [update] }, ids));
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('invalid stored displayNames are not silently repaired or overwritten', async () => {
  const { store, path, ids } = await fixture();
  for (const displayNames of [null, [], 'bad', { 'pc-1': 3 }, { 'pc-1': 'a\nb' }, { 'pc-1': 'x'.repeat(61) }, { constructor: 'bad' }]) {
    const source = JSON.stringify({ version: 1, revision: 0, descriptions: {}, displayNames });
    await writeFile(path, source);
    await assert.rejects(store.get());
    await assert.rejects(store.patch({ revision: 0, updates: [{ id: 'pc-1', displayName: 'new' }] }, ids));
    assert.equal(await readFile(path, 'utf8'), source);
  }
});
