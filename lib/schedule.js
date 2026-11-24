// DSH 0.2.2-rc.5 host service; no package imports or copied schedule database.
// Host must declare `schedule` in inject, or call through ctx.inject(['schedule'], ...).
const DAY = 86400;
export function scheduleInterval(entry) {
  if (entry.kind === 'every' && Number.isFinite(entry.everySeconds) && entry.everySeconds > 0) return entry.everySeconds;
  if (entry.kind === 'daily') return DAY;
  if (entry.kind === 'weekly' && Array.isArray(entry.weekdays) && entry.weekdays.length) {
    const days = [...new Set(entry.weekdays)].sort((a, b) => a - b);
    return Math.max(...days.map((d, i) => (days[(i + 1) % days.length] + (i === days.length - 1 ? 7 : 0)) - d)) * DAY;
  }
  // Cron/RRule calendar rules are authoritative in DSH; never invent a period.
  return null;
}
export function scheduleItem(entry, hostId, now = Date.now()) {
  const expected_interval = scheduleInterval(entry);
  const stale_after = expected_interval === null ? null : expected_interval * 2;
  const due = Date.parse(entry.scheduledAt);
  const delivered = Date.parse(entry.lastDelivery?.deliveredAt);
  let status = 'UNKNOWN';
  let reason = '尚无送达记录，未验证；调度送达不代表业务执行成功';
  if (entry.status === 'paused') reason = 'DSH 任务已暂停';
  else if (entry.status === 'ended') reason = '历史任务已结束，不纳入当前健康汇总';
  else if (entry.status !== 'active') reason = '无法识别 DSH 任务状态';
  else if (!Number.isFinite(due)) reason = 'DSH 未提供有效的下次计划时间';
  else if (entry.executionActive) reason = '任务正在排队或执行，结果尚未确认';
  else if (due < now - 120000) {
    status = 'STALE'; reason = 'DSH 权威计划时间已逾期超过 2 分钟，尚未推进';
  } else if (Number.isFinite(delivered)) {
    // Calendar tasks may intentionally have long gaps; a valid future scheduledAt is authoritative.
    if (stale_after !== null && now - delivered > stale_after * 1000 && due < now) {
      status = 'STALE'; reason = '最近送达超过该任务的两倍周期';
    } else {
      status = 'OK'; reason = '调度送达记录正常；仅验证调度，业务结果未覆盖';
    }
  }
  return {
    id: `dsh:${entry.id}`, name: entry.title || entry.id, hostId, kind: 'dsh-schedule',
    expected_interval, stale_after, status, reason,
    lastRun: Number.isFinite(delivered) ? entry.lastDelivery.deliveredAt : null,
    evidence: {
      scheduleId: entry.id, scheduleStatus: entry.status, ruleKind: entry.kind,
      everySeconds: entry.everySeconds, time: entry.time, timeZone: entry.timeZone,
      weekdays: entry.weekdays, expression: entry.expression, scheduledAt: entry.scheduledAt,
      lastDelivery: entry.lastDelivery ?? null, executionActive: !!entry.executionActive,
      healthScope: 'delivery-only', dueGraceSeconds: 120,
      limitation: 'schedule API 不提供脚本退出码或 AI 工作结果；送达成功不代表业务成功。'
    }
  };
}
export async function collectSchedules(ctx, hostId = 'dsh') {
  let service;
  try { service = ctx.schedule; } catch (error) { throw new Error(`DSH schedule 服务不可用：${error.message}`); }
  if (typeof service?.catalog !== 'function') throw new Error('DSH schedule.catalog 服务不可用');
  const catalog = await service.catalog();
  if (!Array.isArray(catalog)) throw new Error('DSH schedule.catalog 返回格式不兼容');
  const now = Date.now();
  return {
    items: catalog.filter(e => e.status !== 'ended' && e.status !== 'inactive').map(e => scheduleItem(e, hostId, now)),
    history: catalog.filter(e => e.status === 'ended' || e.status === 'inactive').map(e => scheduleItem(e, hostId, now))
  };
}
export async function scheduleLogs(ctx, id) {
  let service;
  try { service = ctx.schedule; } catch { throw new Error('DSH schedule 服务不可用'); }
  if (typeof service?.history !== 'function') throw new Error('DSH schedule.history 服务不可用');
  const result = await service.history({ id: id.startsWith('dsh:') ? id.slice(4) : id, limit: 20 });
  if (!Array.isArray(result.records)) throw new Error(result.code || '无法读取调度送达记录');
  // Prompt content is not needed to inspect delivery and may contain private task instructions.
  return result.records.map(({ scheduledAt, deliveredAt, messageId, targetSessionId }) =>
    JSON.stringify({ scheduledAt, deliveredAt, messageId, targetSessionId })).join('\n') || '没有送达记录';
}
