/** Health evidence is deliberately separate from collection. Durations are seconds. */
export function evaluate(item, evidence = {}, now = Date.now()) {
  const base = { collectedAt: evidence.collectedAt ?? null, lastRun: evidence.lastRun ?? null, verified: evidence.verified ?? false };
  const answer = (status, reason) => ({ ...base, status, reason });
  if (evidence.error) return answer('UNKNOWN', evidence.error);
  if (item.kind === 'windows-task' && evidence.result === 267011) return answer('UNKNOWN', '未验证：Windows 记录为任务尚未运行（0x41303）');
  if (evidence.errorLog) return answer('FAIL', '日志尾部包含错误（可能涉及较早执行，请查看日志时间）：' + evidence.errorLog);
  if (evidence.probeOk === false) return answer('FAIL', '业务探活失败');
  if (evidence.result != null && ![0, '0', 'success', 'done', 'ok'].includes(evidence.result)) return answer('FAIL', `最近执行结果异常：${evidence.result}`);
  if (item.kind === 'systemd-timer' && evidence.active === false) return answer('STALE', '定时器未处于 active 状态');
  if (item.kind === 'windows-task' && evidence.state === 'Disabled') return answer('STALE', '计划任务已禁用');
  if (evidence.active === false && ['systemd-service', 'docker', 'windows-process', 'endpoint'].includes(item.kind)) return answer('FAIL', '进程、容器或连接端点不可用');
  if (evidence.restartDelta > 2) return answer('FAIL', `两次采集之间重启 ${evidence.restartDelta} 次`);
  if (item.kind === 'certificate') {
    const expiry = Date.parse(evidence.expiresAt);
    if (!Number.isFinite(expiry)) return answer('UNKNOWN', '无法读取证书有效期');
    const days = Math.floor((expiry - now) / 86400000);
    if (days < 0) return answer('FAIL', `证书已过期 ${-days} 天`);
    if (days < (item.warningDays ?? 14)) return answer('STALE', `证书仅剩 ${days} 天`);
    return answer('OK', `证书剩余 ${days} 天；仅证明当前证书有效，不证明续签任务成功`);
  }
  if (['systemd-service', 'docker'].includes(item.kind) && evidence.probeOk !== true) return answer('UNKNOWN', '进程存活，但尚未配置或完成业务探活');
  if (item.mode === 'running' || ['windows-process', 'endpoint', 'systemd-service', 'docker'].includes(item.kind)) {
    if (evidence.active === true) return answer('OK', evidence.probeOk ? '进程运行且业务探活成功' : '运行状态检查成功');
    if (evidence.active === false) return answer('FAIL', '应常驻运行，但当前未运行');
    return answer('UNKNOWN', '缺少当前运行状态证据');
  }
  if (item.mode === 'running-or-success' && evidence.active === true) return answer('OK', '任务正在运行');
  const last = Date.parse(evidence.lastRun);
  if (!Number.isFinite(last) || last < 946684800000) return answer('UNKNOWN', '未验证：尚无有效执行记录');
  if (last > now + 300000) return answer('UNKNOWN', '执行时间在未来，请检查时钟');
  if (item.mode === 'today') {
    if (!evidence.fileDay || !evidence.currentDay) return answer('UNKNOWN', '缺少日志所在宿主的日历日期证据');
    return evidence.fileDay === evidence.currentDay ? answer('OK', '日志修改日期为宿主今天；尾部未发现 ERROR/FATAL') : answer('STALE', '日志修改日期不是宿主今天');
  }
  if (item.mode === 'on-logon' || item.mode === 'running-or-success') return evidence.result === 0 ? answer('OK', '上次登录执行成功；不代表当前业务仍然健康') : answer('UNKNOWN', '缺少上次登录的成功结果');
  const threshold = item.stale_after ?? (item.expected_interval == null ? null : item.expected_interval * 2);
  if (threshold == null) return evidence.verified ? answer('OK', '已有最近执行证据；未设置周期过期判据') : answer('UNKNOWN', '未配置周期或缺少成功证据');
  if (now - last > threshold * 1000) return answer('STALE', `距上次运行已超过 ${threshold} 秒阈值`);
  if (!evidence.verified) return answer('UNKNOWN', '有执行时间，但缺少成功证据');
  return answer('OK', '最近执行在预期窗口内且结果正常');
}
