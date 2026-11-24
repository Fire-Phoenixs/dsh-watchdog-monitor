import { execFile } from 'node:child_process';
import { readFile, stat, open } from 'node:fs/promises';
import { isAbsolute, join, basename } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createConnection } from 'node:net';
import {probe} from './http-probe.js';

const MAX_OUTPUT = 256 * 1024;
const checked = (value, regex, label) => {
  if (typeof value !== 'string' || !regex.test(value)) throw new Error(`非法 ${label}`);
  return value;
};
const unit = value => checked(value, /^[a-zA-Z0-9_][a-zA-Z0-9_@.:-]{0,159}$/, 'unit');
const remotePath = value => {
  if (!value) throw new Error('目标路径未配置');
  return checked(value, /^\/[a-zA-Z0-9_./@+-]{1,500}$/, '远程绝对路径');
};
const quotePS = value => "'" + String(value).replaceAll("'", "''") + "'";
const date = value => { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) && n > 946684800000 ? new Date(n).toISOString() : null; };
const kv = text => Object.fromEntries(text.trim().split(/\r?\n/).filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));

/** Parses metadata only; the Run value is never executed or returned to the client. */
export function scriptPathFromCommand(command) {
  if (typeof command !== 'string' || !/\b(?:wscript|cscript)(?:\.exe)?\b/i.test(command)) throw new Error('启动项不是可验证的 Windows Script Host 命令');
  const expanded = command.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
  const match = expanded.match(/"([^"\r\n]+\.(?:vbs|js|wsf))"|([A-Za-z]:\\[^\s"]+\.(?:vbs|js|wsf))/i);
  const script = match?.[1] || match?.[2];
  if (!script || !/^[A-Za-z]:[\\/]/.test(script)) throw new Error('无法确定启动项实际脚本路径');
  return script;
}

function run(file, args, signal) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: 4900, signal }, (error, stdout, stderr) => {
      if (error) reject(new Error(signal?.aborted || error.killed ? '采集超时（5 秒）' : `${file} 只读查询失败：${String(stderr || error.message).slice(0, 500)}`));
      else resolve(stdout.trim());
    });
  });
}
function ps(code, signal) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " + code, 'utf16le').toString('base64')], signal);
}
export function commandFor(item, logs = false) {
  const target = item.target;
  if (logs && item.kind === 'docker') return `docker logs --tail 20 '${checked(target, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/, '容器名')}' 2>&1`;
  if (logs && ['systemd-timer', 'systemd-service'].includes(item.kind)) {
    const name = unit(target).replace(/\.timer$/, '.service');
    return `journalctl --no-pager -u '${name}' -n 20 -o short-iso`;
  }
  if (logs) return `tail -n 20 -- '${remotePath(item.logPath || target)}'`;
  switch (item.kind) {
    case 'systemd-timer': return `env TZ=UTC LC_ALL=C systemctl show '${unit(target)}' --property=LoadState,ActiveState,LastTriggerUSec,NextElapseUSecRealtime; env TZ=UTC LC_ALL=C systemctl show '${unit(target).replace(/\.timer$/, '.service')}' --property=Result,ExecMainStatus`;
    case 'systemd-service': return `env TZ=UTC LC_ALL=C systemctl show '${unit(target)}' --property=LoadState,ActiveState,Result,ExecMainStatus,ActiveEnterTimestamp`;
    case 'docker': return `docker inspect --format '{{json .State}}|{{.RestartCount}}' '${checked(target, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/, '容器名')}'`;
    case 'file-log': return `stat -c '%Y' -- '${remotePath(item.logPath || target)}'; date +%F; date -r '${remotePath(item.logPath || target)}' +%F; tail -n 20 -- '${remotePath(item.logPath || target)}'`;
    case 'certificate': return `openssl x509 -in '${remotePath(target)}' -noout -enddate`;
    default: throw new Error('此采集类型不支持 SSH');
  }
}
function ssh(host, command, signal) {
  const target = checked(host.sshTarget, /^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}$/, 'SSH 主机别名');
  return run('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=3', '-o', 'ConnectionAttempts=1', target, command], signal);
}
async function tail(path) {
  if (!isAbsolute(path)) throw new Error('日志必须是绝对路径');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const length = Math.min(32768, info.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, info.size - length);
    return buffer.toString('utf8').split(/\r?\n/).slice(-20).join('\n');
  } finally { await handle.close(); }
}
async function tcp(port, signal) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端点端口无效');
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = ok => { socket.destroy(); signal.removeEventListener('abort', aborted); resolve(ok); };
    const aborted = () => finish(false);
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    signal.addEventListener('abort', aborted, { once: true });
  });
}
const restartHistory = new Map();
async function rawCollect(item, host, signal) {
  if (host.kind === 'ssh') {
    const output = await ssh(host, commandFor(item), signal);
    if (item.kind.startsWith('systemd-')) {
      const data = kv(output);
      if (data.LoadState !== 'loaded') throw new Error('systemd unit 不存在或不可读');
      const lastRun = date(data.LastTriggerUSec || data.ActiveEnterTimestamp);
      let journalError;
      if (item.kind === 'systemd-timer' && lastRun) {
        const since = Math.floor(Date.parse(lastRun) / 1000);
        const text = await ssh(host, `journalctl --no-pager --quiet -u '${unit(item.target).replace(/\.timer$/, '.service')}' --since '@${since}' -p err -n 20 -o short-iso`, signal);
        if (text) journalError = text.slice(-1200);
      }
      return { active: data.ActiveState === 'active', lastRun, result: data.Result === 'success' ? Number(data.ExecMainStatus || 0) : data.Result || null, verified: lastRun !== null && data.Result === 'success', errorLog: journalError, detail: data, ...(item.probeUrl ? await probe(item.probeUrl, signal, item.probeAccept) : {}) };
    }
    if (item.kind === 'docker') {
      const [stateText, countText] = output.split('|'); const state = JSON.parse(stateText); const restartCount = Number(countText);
      const key = host.id + ':' + item.target; const previous = restartHistory.get(key); restartHistory.set(key, { count: restartCount, at: Date.now() });
      return { active: state.Running, lastRun: date(state.StartedAt), result: state.Running ? 0 : state.ExitCode, verified: true, restartCount, restartDelta: previous && Date.now() - previous.at < 3600000 ? Math.max(0, restartCount - previous.count) : 0, ...(state.Health?.Status === 'unhealthy' ? {probeOk:false} : item.probeUrl ? await probe(item.probeUrl, signal, item.probeAccept) : state.Health?.Status === 'healthy' ? {probeOk:true} : {}), detail: { status: state.Status, health: state.Health?.Status } };
    }
    if (item.kind === 'certificate') return { expiresAt: date(output.replace(/^notAfter=/, '')), verified: true };
    const [mtime, currentDay, fileDay, ...lines] = output.split('\n'); const log = lines.join('\n');
    return { lastRun: date(Number(mtime) * 1000), currentDay, fileDay, verified: true, errorLog: log.match(/^.*\b(?:ERROR|FATAL)\b.*$/mi)?.[0], detail: { logTail: log } };
  }
  if (host.kind !== 'windows') throw new Error('未知宿主类型');
  if (item.kind === 'windows-task') {
    if (typeof item.target !== 'string' || item.target.length > 512) throw new Error('任务名称无效');
    const data = JSON.parse(await ps(`$t=@(Get-ScheduledTask | Where-Object { ($_.TaskPath+$_.TaskName) -eq ${quotePS(item.target)} -or $_.TaskName -eq ${quotePS(item.target)} }); if($t.Count -ne 1){throw '任务不存在或名称不唯一'}; $i=$t[0] | Get-ScheduledTaskInfo; @{active=([string]$t[0].State -eq 'Running');state=[string]$t[0].State;result=$i.LastTaskResult;lastRun=if($i.LastRunTime.Year -gt 2000){$i.LastRunTime.ToUniversalTime().ToString('o')}else{$null}} | ConvertTo-Json -Compress`, signal));
    // SCHED_S_TASK_RUNNING is a scheduler state, not an execution failure.
    if (data.active && data.result === 267009) data.result = null;
    const log = item.logPath ? await tail(item.logPath) : '';
    return { ...data, verified: data.lastRun !== null && data.result === 0, errorLog: log.match(/^.*\b(?:ERROR|FATAL)\b.*$/mi)?.[0] };
  }
  if (item.kind === 'windows-process') {
    if (typeof item.target !== 'string' || item.target.length < 2 || item.target.length > 512) throw new Error('进程匹配标识无效');
    let target = item.target;
    let scriptSource;
    if (item.mode === 'run-key') {
      const command = JSON.parse(await ps(`$v=Get-ItemPropertyValue -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${quotePS(item.target)}; ConvertTo-Json -InputObject ([string]$v) -Compress`, signal));
      target = scriptPathFromCommand(command);
      scriptSource = await readFile(target, 'utf8');
    } else if (item.mode === 'startup') {
      if (basename(target) !== target || !process.env.APPDATA) throw new Error('Startup 条目必须是启动目录中的文件名');
      target = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', target);
      scriptSource = await readFile(target, 'utf8');
    }
    const output = await ps(`$needle=${quotePS(target)}; $p=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ($_.Name -eq $needle -or ($_.Name -match '^(wscript|cscript|node|python|pythonw|powershell|pwsh)\\.exe$' -and $_.CommandLine -and $_.CommandLine.IndexOf($needle,[StringComparison]::OrdinalIgnoreCase) -ge 0)) }); @{active=($p.Count -gt 0);count=$p.Count} | ConvertTo-Json -Compress`, signal);
    const evidence = JSON.parse(output);
    if (!evidence.active && scriptSource && /powershell|pwsh|\.Run\b|\.Exec\b/i.test(scriptSource)) throw new Error('启动脚本存在但会派生其他进程，尚未验证子进程映射，无法确定常驻任务是否存活');
    return { ...evidence, verified: true, detail: scriptSource !== undefined ? { startupRegistered: true, mapping: 'Windows Script Host script path' } : undefined };
  }
  if (item.kind === 'endpoint') {
    if (!isAbsolute(item.target)) throw new Error('endpoint.json 路径未配置');
    const endpoint = JSON.parse(await readFile(item.target, 'utf8')); const port = endpoint.port ?? (endpoint.url ? Number(new URL(endpoint.url).port) : null);
    return { active: await tcp(port, signal), verified: true };
  }
  if (item.kind === 'file-log') {
    const path = item.logPath || item.target; const log = await tail(path); const info = await stat(path);
    return { lastRun: info.mtime.toISOString(), currentDay: new Date().toDateString(), fileDay: info.mtime.toDateString(), verified: true, errorLog: log.match(/^.*\b(?:ERROR|FATAL)\b.*$/mi)?.[0], detail: { logTail: log } };
  }
  if (item.kind === 'certificate') {
    if (!isAbsolute(item.target)) throw new Error('证书必须是绝对路径');
    return { expiresAt: date(new X509Certificate(await readFile(item.target)).validTo), verified: true };
  }
  throw new Error('不支持的采集类型');
}
async function bounded(action, externalSignal) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  const abort = () => controller.abort(); externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  try {
    return await Promise.race([action(controller.signal), new Promise((_, reject) => {
      if (controller.signal.aborted) reject(new Error('采集已取消'));
      else controller.signal.addEventListener('abort', () => reject(new Error('采集超时或已取消（5 秒）')), { once: true });
    })]);
  } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
}
export async function collect(item, host, { signal } = {}) {
  const collectedAt = new Date().toISOString();
  try { return { collectedAt, ...await bounded(s => rawCollect(item, host, s), signal) }; }
  catch (error) { return { collectedAt, error: String(error.message).slice(0, 700), verified: false }; }
}
export async function collectLog(item, host, { signal } = {}) {
  const collectedAt = new Date().toISOString();
  try {
    const text = await bounded(s => host.kind === 'ssh' ? ssh(host, commandFor(item, true), s) : item.logPath ? tail(item.logPath) : Promise.reject(new Error('未注册任务自写日志路径')), signal);
    return { collectedAt, text };
  } catch (error) { return { collectedAt, text: '', error: error.message }; }
}
