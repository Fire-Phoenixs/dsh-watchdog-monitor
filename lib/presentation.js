const names = new Map([
  ['clouddrivewatchdog', '云盘挂载守护'], ['dshserverbackuppull', '迷你主机备份拉取'],
  ['githubbackup', 'GitHub 仓库镜像备份'], ['dshicsautofix', '登录时修复网络共享'],
  ['qqagent-task', 'QQ 代理启动器'], ['qq-agent', 'QQ 机器人代理'],
  ['litemonitor', '桌面监控'], ['litemonitor_autostart', '桌面监控自动启动'],
  ['dshelevafk', '本机提权桥'], ['power-ctl-gamewatch.vbs', '游戏电源方案切换'],
  ['dsh-ops-alert.timer', '主机运维告警检查'], ['napcat-healthcheck.timer', 'QQ 接口健康检查'],
  ['dsh-version-check.timer', 'DSH 版本检查'], ['ts-cert-renew.timer', 'Tailscale 证书续期'],
  ['vaultwarden backup', '密码库备份'], ['qqbot backup', 'QQ 机器人备份'],
  ['acme.sh --cron', 'ACME 证书续期检查'], ['napcat', 'QQ 接口（NapCat）'],
  ['dsh-web', 'DSH 网页服务'], ['dsh-auth-proxy', 'DSH 认证代理'], ['dsh-metrics', 'DSH 指标服务'],
  ['tailscaled', 'Tailscale 网络连接'], ['adguardhome', 'DNS 与广告过滤'],
  ['vaultwarden', '密码库（Vaultwarden）'], ['grafana', '监控仪表盘（Grafana）'],
  ['victoriametrics', '时序指标存储'], ['gitea', 'Git 仓库托管'], ['searxng', '聚合搜索'],
  ['caddy', 'Web 与反向代理'], ['dozzle', '容器日志查看'], ['n8n', '自动化工作流（n8n）']
]);

export function friendlyName(item) {
  if (typeof item?.displayName === 'string' && item.displayName.trim()) return item.displayName.trim();
  const name = typeof item?.name === 'string' ? item.name : '';
  if (item?.kind === 'dsh-schedule') return name;
  return names.get(name.trim().toLowerCase()) ?? name;
}

const category = (code, label, action) => ({ code, label, action });
/** Presentation hints only: never changes health status or performs remediation. */
export function unknownCategory(item) {
  if (item?.status !== 'UNKNOWN') return undefined;
  const evidence = item.evidence ?? {};
  const text = [evidence.error, item.reason].filter(v => typeof v === 'string').join('\n');
  // Permission errors often include "ssh" or "connect"; classify the actual refusal first.
  if (/permission denied|access (?:is )?denied|unauthori[sz]ed|forbidden|\bEACCES\b|\bEPERM\b|权限不足|无权访问|拒绝访问|访问被拒绝|authentication failed|认证失败|鉴权失败/i.test(text)) {
    return category('permission', '权限不足', /publickey|authentication|认证|SSH|ssh/.test(text)
      ? '检查 SSH 用户、密钥授权和远程读取权限；确认后再刷新。'
      : '检查当前用户对任务、日志或接口的读取权限；确认后再刷新。');
  }
  if (/host key verification failed|remote host identification has changed|no .*host key is known|主机密钥|主机指纹/i.test(text)) {
    return category('unconfigured', '未配置', '先核对服务器主机指纹，再由使用者配置可信主机记录；不要跳过主机密钥验证。');
  }
  if (/identity file .*not accessible|no such identity|no (?:ssh |private )?key|private key.*(?:not found|missing)|密钥(?:路径)?未配置|找不到.*密钥/i.test(text)) {
    return category('unconfigured', '未配置', '检查 host 端 SSH 配置中的密钥路径与文件；不要把密钥放入前端或简介。');
  }
  if (/connection refused|connection timed out|connect to host.*timed out|no route to host|network is unreachable|could not resolve hostname|name or service not known|\bECONNREFUSED\b|\bENETUNREACH\b|\bEHOSTUNREACH\b|\bENOTFOUND\b|无法解析.*主机|连接被拒绝|网络不可达|连接超时/i.test(text)) {
    return category('unreachable', '连接失败', '检查目标主机地址、网络连通性和 SSH 服务可达性，再刷新；不会自动调整网络。');
  }
  if (/等待首次采集|正在首次采集|待采集|尚未开始采集|任务正在排队或执行|结果尚未确认/.test(text)) {
    return category('collecting', '待采集', '等待当前采集或执行结束，再刷新查看结果。');
  }
  if (/未注册任务自写日志路径|目标路径未配置|endpoint\.json 路径未配置/.test(text)) {
    return category('unconfigured', '未配置', '在条目配置中填写实际日志、证书或 endpoint.json 的绝对路径。');
  }
  if (/尚未配置或完成业务探活/.test(text) && !item.probeUrl) {
    return category('unconfigured', '未配置', '为该服务配置业务探活地址及成功判据；进程存活不足以证明业务正常。');
  }
  if (/未配置周期或缺少成功证据/.test(text) && item.expected_interval == null && item.stale_after == null) {
    return category('unconfigured', '未配置', '按实际触发方式配置预期周期与过期判据，或补充可验证的成功证据。');
  }
  if (/未配置.*(?:规则|判据)|缺少.*(?:探活规则|探活地址)|probeUrl.*(?:missing|required)|未配置 probeUrl/i.test(text)) {
    return category('unconfigured', '未配置', '补充业务探活地址或健康判定规则，再刷新。');
  }
  if (/非法 (?:unit|容器名|远程绝对路径|SSH 主机别名)|日志必须是绝对路径|证书必须是绝对路径|任务名称无效|进程匹配标识无效|Startup 条目必须|端点端口无效|业务探活只接受/.test(text)) {
    return category('unconfigured', '未配置', '核对条目的目标名称、绝对路径或探活地址格式，按实际配置修正。');
  }
  if (evidence.neverRun === true || evidence.result === 267011 || /未验证|尚未运行|从未运行|尚无有效执行记录|尚无送达记录|缺少成功证据|缺少上次登录的成功结果|缺少当前运行状态证据|缺少日志所在宿主的日历日期证据/.test(text)) {
    return category('unverified', '未验证', /子进程映射|派生其他进程/.test(text)
      ? '确认启动脚本实际派生的常驻进程，并在条目中登记可核实的进程标识。'
      : '等待一次真实执行或补充现有运行证据；首次执行前保持未验证。');
  }
  if (/启动项不是可验证|无法确定启动项实际脚本路径/.test(text)) {
    return category('unverified', '未验证', '核对启动项实际脚本与常驻进程的对应关系，登记可核实的进程标识。');
  }
  if (/采集超时|采集超过|采集已取消|服务不可用|schedule.*不可用|返回格式不兼容|无法读取证书有效期|systemd unit 不存在或不可读|任务不存在或名称不唯一|不支持的采集类型|此采集类型不支持 SSH|未知宿主类型|\bENOENT\b|no such file or directory|spawn .*ENOENT/i.test(text)) {
    return category('unavailable', '采集不可用', /超时|超过|取消/.test(text)
      ? '刷新重试并查看采集错误；超时本身无法证明网络或任务已故障。'
      : '核对采集工具、目标资源和 DSH 服务是否可读取；查看原始错误后再处理。');
  }
  return category('unknown', '原因待查', '展开条目查看原始判定依据和日志；现有证据不足以确定原因。');
}
