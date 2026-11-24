export function defaults() {
  const hosts = [{id:'pc',name:'电脑',kind:'windows'},{id:'server',name:'迷你主机',kind:'ssh',sshTarget:'dsh-server'},{id:'dsh',name:'DSH 调度',kind:'dsh'}];
  const items=[];
  const add=(hostId,kind,name,interval,extra={})=>items.push({id:`${hostId}-${items.length+1}`,name,hostId,kind,target:name,expected_interval:interval,stale_after:interval?interval*2:null,...extra});
  add('pc','windows-task','CloudDriveWatchdog',300);
  add('pc','windows-task','DshServerBackupPull',1800,{stale_after:4200});
  add('pc','windows-task','GitHubBackup',604800,{stale_after:691200});
  add('pc','windows-task','DshIcsAutofix',null,{mode:'on-logon',notes:'on-logon only；白天 ICS 失效不会自愈，需要手动 Start-ScheduledTask。'});
  for(const name of ['QQAgent-Task','LiteMonitor','LiteMonitor_AutoStart']) add('pc','windows-task',name,null,{mode:name==='QQAgent-Task'?'running-or-success':'running'});
  add('pc','endpoint','DshElevAfk',null,{target:'',notes:'请注册实际 endpoint.json 绝对路径。'});
  for(const name of ['power-ctl-gamewatch.vbs','MelvorAutopilotBridge','MelvorAutopilotAI']) add('pc','windows-process',name,null,{mode:name.endsWith('.vbs')?'startup':'run-key',notes:'若此项是启动后退出的 .vbs 包装器，请移除 mode，并将 target 改为实际派生进程命令行中的独特脚本路径或子串，否则将持续 UNKNOWN。'});
  for(const name of ['dsh-ops-alert.timer','napcat-healthcheck.timer']) add('server','systemd-timer',name,300,{stale_after:900});
  for(const name of ['dsh-steward.timer','dsh-version-check.timer']) add('server','systemd-timer',name,86400,{stale_after:129600});
  add('server','systemd-timer','ts-cert-renew.timer',2678400,{notes:'首次计划 2026-12-01；从未执行时标为未验证，不冒充健康。'});
  for(const name of ['vaultwarden','qqbot']) add('server','file-log',`${name} backup`,86400,{target:`/home/lhy/${name}/logs/backup.log`,mode:'today',notes:'日志修改日必须是服务器当天；以日志尾部错误作为失败线索。'});
  add('server','file-log','ef-feed/sample.sh',43200,{target:'',notes:'已核实 cron 09:00 / 21:00 输出丢弃到 /dev/null；没有可验证的 LAST，请注册已有执行证据文件。'});
  add('server','certificate','acme.sh --cron',21600,{target:'',notes:'请填写受监控 PEM 证书绝对路径；证书有效不证明 cron 已执行。'});
  for(const name of ['napcat','dsh-web','dsh-auth-proxy','dsh-metrics','tailscaled','adguardhome']) add('server','systemd-service',name,null,{target:`${name}.service`,notes:'需注册业务探活地址；告警依赖 NapCat，面板本身不依赖 QQ。'});
  for(const name of ['ef-sandbox','n8n','vaultwarden','victoriametrics','grafana','gitea','searxng','caddy','dozzle']) add('server','docker',name,null,{notes:name==='ef-sandbox'?'restart=no；按需容器停止也会显示失败，可在台账设置 enabled:false 排除。':'检查容器状态、健康检查和相邻采集间重启增量；未配置业务探活时保留未知。'});
  return {version:1,revision:0,hosts,items};
}
