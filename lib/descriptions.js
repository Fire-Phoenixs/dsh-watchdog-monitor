import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const queues = new Map();
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/;
const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype']);
function object(value, fields, label, required = fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} 必须是对象`);
  if (Reflect.ownKeys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} 字段无效`);
  }
}
function validId(id) {
  if (typeof id !== 'string' || !ID.test(id) || forbiddenIds.has(id)) throw new Error('简介条目 ID 无效');
}
function description(text) {
  if (typeof text !== 'string' || [...text].length > 160 || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) {
    throw new Error('简介必须为 0–160 字的单行纯文本');
  }
}
function displayName(text) {
  if (typeof text !== 'string' || [...text].length > 60 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)) {
    throw new Error('显示名称必须为 0–60 字的单行纯文本');
  }
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('简介 revision 无效');
}
function validateStore(value) {
  object(value, ['version', 'revision', 'descriptions', 'displayNames'], '简介存储', ['version', 'revision', 'descriptions']);
  if (value.version !== 1) throw new Error('简介存储版本无效');
  revision(value.revision);
  const entries = value.descriptions;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(entries))) throw new Error('简介映射无效');
  for (const [id, text] of Object.entries(entries)) { validId(id); description(text); }
  const names = Object.hasOwn(value, 'displayNames') ? value.displayNames : {};
  if (!names || typeof names !== 'object' || Array.isArray(names) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(names))) throw new Error('显示名称映射无效');
  for (const [id, text] of Object.entries(names)) { validId(id); displayName(text); }
  return structuredClone({ ...value, displayNames: names });
}

/** Only plugin-owned presentation metadata is persisted. System task definitions are never copied. */
export class DescriptionStore {
  constructor(path) { this.path = resolve(path); }
  async get() {
    let source;
    try { source = await readFile(this.path, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, revision: 0, descriptions: {}, displayNames: {} };
      throw error;
    }
    return validateStore(JSON.parse(source));
  }
  patch(input, validIds) {
    // Capture arguments before queueing so caller mutations cannot change an admitted request.
    let request, ids;
    try {
      object(input, ['revision', 'updates'], '简介更新'); revision(input.revision);
      if (!(validIds instanceof Set)) throw new Error('有效条目集合必须为 Set');
      if (!Array.isArray(input.updates) || input.updates.length > 500) throw new Error('一次最多更新 500 条简介');
      const seen = new Set();
      for (const update of input.updates) {
        object(update, ['id', 'description', 'displayName'], '简介更新项', ['id']); validId(update.id);
        if (!Object.hasOwn(update, 'description') && !Object.hasOwn(update, 'displayName')) throw new Error('更新项至少提供简介或显示名称');
        if (Object.hasOwn(update, 'description')) description(update.description);
        if (Object.hasOwn(update, 'displayName')) displayName(update.displayName);
        if (seen.has(update.id)) throw new Error(`简介更新 ID 重复：${update.id}`);
        if (!validIds.has(update.id)) throw new Error(`未知条目 ID：${update.id}`);
        seen.add(update.id);
      }
      request = structuredClone(input); ids = new Set(validIds);
    } catch (error) { return Promise.reject(error); }
    const previous = queues.get(this.path) ?? Promise.resolve();
    const task = previous.then(async () => {
      const current = await this.get();
      if (request.revision !== current.revision) throw new Error('简介已变化，请重新读取后编辑（revision 冲突）');
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('简介 revision 已达上限');
      const next = { ...current, revision: current.revision + 1, descriptions: { ...current.descriptions }, displayNames: { ...current.displayNames } };
      for (const update of request.updates) {
        if (!ids.has(update.id)) throw new Error(`未知条目 ID：${update.id}`);
        if (Object.hasOwn(update, 'description')) next.descriptions[update.id] = update.description;
        // An explicit blank display name means the consumer falls back to the task's default name.
        if (Object.hasOwn(update, 'displayName')) next.displayNames[update.id] = update.displayName;
      }
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      // Same-directory rename publishes a complete document. Failed temp files remain for inspection.
      await rename(temporary, this.path);
      return structuredClone(next);
    });
    const settled = task.catch(() => {});
    queues.set(this.path, settled);
    settled.then(() => { if (queues.get(this.path) === settled) queues.delete(this.path); });
    return task;
  }
}

const descriptions = new Map([
  ['clouddrivewatchdog', '守护云盘挂载状态。'],
  ['dshserverbackuppull', '从迷你主机拉取备份到电脑。'],
  ['githubbackup', '定期备份仓库镜像。'],
  ['dshicsautofix', '登录时修复 ICS 网络共享，白天故障不会自动修复。'],
  ['qqagent-task', '登录时启动 qq-agent 启动器。'],
  ['qq-agent', '运行 QQ 机器人代理。'],
  ['litemonitor', '显示电脑桌面监控信息。'],
  ['litemonitor_autostart', '登录时启动桌面监控组件。'],
  ['dshelevafk', '提供免 UAC 提示的本机提权桥接端点。'],
  ['power-ctl-gamewatch.vbs', '检测游戏进程并切换电源方案。'],
  ['dsh-ops-alert.timer', '定期执行迷你主机运维告警检查。'],
  ['napcat-healthcheck.timer', '定期检查 NapCat 运行状态。'],
  ['dsh-version-check.timer', '定期检查 DSH 版本。'],
  ['ts-cert-renew.timer', '定期续期 Tailscale 证书。'],
  ['vaultwarden backup', '定期备份 Vaultwarden 数据。'],
  ['qqbot backup', '定期备份 QQ 机器人数据。'],
  ['acme.sh --cron', '定期检查并续期 ACME 证书。'],
  ['napcat', '提供 QQ 与 OneBot 接口。'],
  ['dsh-web', '提供 DSH 网页服务。'],
  ['dsh-auth-proxy', '提供 DSH 访问认证代理。'],
  ['dsh-metrics', '提供 DSH 运行指标。'],
  ['tailscaled', '维持 Tailscale 虚拟网络连接。'],
  ['adguardhome', '提供 DNS 解析与广告过滤。'],
  ['vaultwarden', '提供密码库服务。'],
  ['grafana', '展示监控数据仪表盘。'],
  ['victoriametrics', '存储与查询监控时序指标。'],
  ['gitea', '提供 Git 仓库托管。'],
  ['searxng', '提供聚合搜索服务。'],
  ['caddy', '提供 Web 服务与反向代理。'],
  ['dozzle', '提供容器日志查看界面。'],
  ['n8n', '运行自动化工作流。']
]);
export function defaultDescription(item) {
  // DSH schedule titles are user-controlled: do not infer business meaning from matching names.
  if (!item || item.kind === 'dsh-schedule') return '';
  const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : '';
  return descriptions.get(name) ?? '';
}
