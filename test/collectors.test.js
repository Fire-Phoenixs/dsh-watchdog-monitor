import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, collectLog, commandFor, scriptPathFromCommand } from '../lib/collectors.js';
test('unit names cannot inject shell', () => {
  for (const target of ['x; touch /tmp/x', "x'", '$(id)', '--help', 'a\nb']) {
    assert.throws(() => commandFor({ kind: 'systemd-timer', target }));
  }
});
test('container target rejects options', () => assert.throws(() => commandFor({ kind: 'docker', target: '--help' })));
test('file path rejects shell syntax and whitespace', () => {
  for (const target of ['/tmp/a;id', '/tmp/a b', '/tmp/$(id)', 'relative']) assert.throws(() => commandFor({ kind: 'file-log', target }));
});
test('journal follows timer service and is bounded', () => assert.equal(commandFor({ kind: 'systemd-timer', target: 'dsh-ops-alert.timer' }, true), "journalctl --no-pager -u 'dsh-ops-alert.service' -n 20 -o short-iso"));
test('invalid target becomes UNKNOWN evidence without throwing', async () => {
  const result = await collect({ kind: 'systemd-timer', target: ';id' }, { kind: 'ssh', sshTarget: 'dsh-server' });
  assert.match(result.error, /非法/);
});
test('missing windows log gives explicit error', async () => assert.match((await collectLog({ kind: 'windows-task' }, { kind: 'windows' })).error, /未注册/));
test('unknown host gives explicit error', async () => assert.match((await collect({ kind: 'x' }, { kind: 'invalid' })).error, /未知/));
test('already aborted operation yields unknown evidence', async () => {
  const c = new AbortController(); c.abort();
  const evidence = await collect({ kind: 'systemd-timer', target: 'foo.timer' }, { kind: 'ssh', sshTarget: 'dsh-server' }, { signal: c.signal });
  assert.ok(evidence.error);
});
test('Run key resolves actual quoted script path rather than registry value name', () => assert.equal(scriptPathFromCommand('wscript.exe "C:\\Scripts With Spaces\\melvor-ai.vbs"'), 'C:\\Scripts With Spaces\\melvor-ai.vbs'));
test('Run key resolves bare absolute script path', () => assert.equal(scriptPathFromCommand('C:\\Windows\\System32\\wscript.exe C:\\Scripts\\melvor.vbs'), 'C:\\Scripts\\melvor.vbs'));
test('Run key rejects unverified command types and relative scripts', () => {
  assert.throws(() => scriptPathFromCommand('powershell.exe -File "C:\\Scripts\\worker.ps1"'));
  assert.throws(() => scriptPathFromCommand('wscript.exe worker.vbs'));
});
test('unconfigured remote log path has clear reason', () => assert.throws(() => commandFor({ kind: 'file-log', target: '' }), /目标路径未配置/));
