import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyName, unknownCategory } from '../lib/presentation.js';

const unknown = (reason, extra = {}) => unknownCategory({ status: 'UNKNOWN', reason, ...extra });
test('friendly names respect custom labels and retain unknown/schedule identities', () => {
  assert.equal(friendlyName({ name: 'CloudDriveWatchdog' }), '云盘挂载守护');
  assert.equal(friendlyName({ name: 'CloudDriveWatchdog', displayName: ' 我的云盘 ' }), '我的云盘');
  assert.equal(friendlyName({ name: 'custom-task' }), 'custom-task');
  assert.equal(friendlyName({ name: 'CloudDriveWatchdog', kind: 'dsh-schedule' }), 'CloudDriveWatchdog');
  assert.equal(friendlyName({ name: 'custom-task', displayName: '  ' }), 'custom-task');
});
test('categories do not alter known health states', () => {
  for (const status of ['OK', 'STALE', 'FAIL']) assert.equal(unknownCategory({ status, reason: 'Permission denied' }), undefined);
});
test('permission and authentication failures take precedence over SSH connection wording', () => {
  assert.equal(unknown('ssh 只读查询失败：Permission denied (publickey).').code, 'permission');
  assert.equal(unknown('连接超时', { evidence: { error: 'EACCES: permission denied' } }).code, 'permission');
  assert.equal(unknown('powershell.exe 只读查询失败：拒绝访问').code, 'permission');
});
test('missing key and unknown or changed host key require configuration, not a network diagnosis', () => {
  for (const reason of ['ssh: Host key verification failed.', 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!', 'Warning: Identity file C:/missing not accessible: No such file or directory.']) {
    assert.equal(unknown(reason).code, 'unconfigured');
  }
  assert.match(unknown('Host key verification failed').action, /不要跳过/);
});
test('only explicit connectivity evidence is classified as unreachable', () => {
  for (const reason of ['ssh: connect to host 192.168.137.100 port 22: Connection refused', 'ssh: Could not resolve hostname dsh-server', 'Network is unreachable']) {
    assert.equal(unknown(reason).code, 'unreachable');
  }
  assert.equal(unknown('ssh 只读查询失败：exit code 1').code, 'unknown');
  assert.equal(unknown('fetch failed').code, 'unknown');
  assert.equal(unknown('采集超时或已取消（5 秒）').code, 'unavailable');
});
test('first snapshot and schedule execution pending are collecting', () => {
  assert.equal(unknown('等待首次采集').code, 'collecting');
  assert.equal(unknown('任务正在排队或执行，结果尚未确认').code, 'collecting');
});
test('missing configured paths, probes and periodic rules are unconfigured', () => {
  for (const reason of ['目标路径未配置', 'endpoint.json 路径未配置', '未注册任务自写日志路径', '进程存活，但尚未配置或完成业务探活', '未配置周期或缺少成功证据']) {
    assert.equal(unknown(reason).code, 'unconfigured');
  }
  assert.equal(unknown('进程存活，但尚未配置或完成业务探活', { probeUrl: 'http://localhost:3000' }).code, 'unknown');
  assert.equal(unknown('未配置周期或缺少成功证据', { expected_interval: 300 }).code, 'unverified');
});
test('never-run, missing result and unverified child-process mapping stay unverified', () => {
  for (const reason of ['未验证：Windows 记录为任务尚未运行（0x41303）', '未验证：尚无有效执行记录', '尚无送达记录，未验证；调度送达不代表业务执行成功', '启动脚本存在但会派生其他进程，尚未验证子进程映射，无法确定常驻任务是否存活', '有执行时间，但缺少成功证据']) {
    assert.equal(unknown(reason).code, 'unverified');
  }
  assert.equal(unknown('', { evidence: { neverRun: true } }).code, 'unverified');
  assert.equal(unknown('', { evidence: { result: 267011 } }).code, 'unverified');
});
test('missing service, malformed response and unavailable resource do not look healthy or imply SSH failure', () => {
  for (const reason of ['DSH schedule.catalog 服务不可用', 'DSH schedule.catalog 返回格式不兼容', 'systemd unit 不存在或不可读', '任务不存在或名称不唯一', '无法读取证书有效期', 'spawn powershell.exe ENOENT']) {
    assert.equal(unknown(reason).code, 'unavailable');
  }
  assert.deepEqual(Object.keys(unknown('执行时间在未来，请检查时钟')).sort(), ['action', 'code', 'label']);
  assert.equal(unknown('执行时间在未来，请检查时钟').code, 'unknown');
});
