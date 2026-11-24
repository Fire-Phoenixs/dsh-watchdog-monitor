# 看门狗工作区 0.1.4

![Built with Codex](https://img.shields.io/badge/Built%20with-Codex-111827?style=flat-square)

面向 DSH 0.2.2-rc.5 的只读监控插件。左侧「看门狗」打开简洁清单，点击才查看判定依据、周期、日志。用户和 AI 均可注册宿主、监控条目；初始配置只是可编辑模板，不限制项目名称和数量。

首页可切换“全部 / 只看需处理”。待处理包含 FAIL、STALE 和 UNKNOWN，顶部始终保留全量汇总，另显示当前可见数量。未知项会显示未配置、权限不足、连接失败、未验证等分类，处理提示放在详情里；分类只解释现有状态，不改变健康判定。

已知任务使用友好名称，技术名称与目标仍可在详情查看。最近变化单独折叠展示最近 20 条观察到的状态变化，底层保留最近 100 条并随快照跨重启保存。首次看到任务不记故障；UNKNOWN→OK 标为“验证通过”，FAIL/STALE→OK 才标为“已恢复”。关闭面板期间的短暂变化可能漏过，记录不代表完整审计日志；配置变化后重新建立观察基线。

## 桌面安装

包来源二选一：[Releases](https://github.com/Fire-Phoenixs/dsh-watchdog-monitor/releases) 下载 `dsh-watchdog-monitor-0.1.4.tgz`，或在源码目录执行 `npm pack` 自行打包。

1. 打开 DSH 左侧 **插件 → 添加插件**。
2. 输入该 `.tgz` 的完整绝对路径，例如 `C:\Users\<你的用户名>\Downloads\dsh-watchdog-monitor-0.1.4.tgz`。
3. 确认安装，按桌面提示重新加载。左侧出现「看门狗」。
4. 点击「管理条目」，可编辑宿主和条目 JSON。保存只改变本插件台账，不改变计划任务、systemd、cron 或 DSH schedule。

本地目录路径也被当前安装器支持；推荐 `.tgz`，避免开发目录改动影响安装。本包直接包含运行时 JS，没有依赖、构建步骤、postinstall，不受 pnpm 10 构建脚本拦截影响。此路径已核实安装器源码，但本次未在使用中的 DSH 执行安装/重启，详见 SELFTEST.md。

## 自由注册

宿主分组来自 `hosts`，不是固定三个分组。支持 `windows`、`ssh`，另保留一个 `dsh` 宿主用于实时调度任务。条目必填：`id,name,hostId,kind,target,expected_interval,stale_after`。两个时间字段以秒为单位，事件/常驻任务用 `null`。`enabled:false` 可将条目排除监控，保留配置。`notes` 说明用途和盲点。

采集类型：`windows-task`、`windows-process`、`endpoint`、`systemd-timer`、`systemd-service`、`docker`、`file-log`、`certificate`。用户可自由注册这些类型的实例；添加新的采集机制需开发新的白名单适配器，不提供任意命令执行口。

示例（添加到 items；hostId 必须存在）：

```json
{"id":"custom-backup","name":"项目备份","hostId":"server","kind":"file-log","target":"/home/lhy/project/backup.log","expected_interval":86400,"stale_after":172800,"mode":"today","notes":"每天检查备份日志"}
```

`systemd-service` / `docker` 可以添加 `probeUrl`，仅接受无凭据的 HTTP(S) 地址，host 发起 HEAD 请求。Docker 内建 healthy 也作为业务健康证据。没有业务探活证据则 UNKNOWN。证书 target 为 PEM 绝对路径；endpoint 为包含 port 或 url 的 endpoint.json。Windows 脚本监控 target 应填写其实际命令行可识别路径或脚本名。远程日志路径暂只接受不含空格的 ASCII 绝对路径。

`probeAccept` 可指定期望状态码集合，例如 `"probeUrl":"http://192.168.137.100:8080/", "probeAccept":[200,401,302]`。集合须为非空的 100–599 整数数组，并与 probeUrl 一起配置。配置后仅检查原始 HEAD 响应，不跟随跳转；命中为探活成功，未命中为失败，连接失败/超时为 UNKNOWN。详情证据包含实际 `probeStatus` 与期望集合。不配置时保持原行为：2xx 成功，重定向拒绝。Docker 配置 probeUrl 后使用该探活结果；内建 unhealthy 仍判失败。只有明确符合该服务预期时才接受 401/302。

**windows-process：不要用 `mode: "startup"` / `"run-key"` 监控启动后退出的 `.vbs` 包装器**，否则无法确认派生进程，会持续 UNKNOWN。应省略 mode，把 target 填为实际常驻进程命令行中独特的脚本路径或子串，例如：

```json
{"id":"gamewatch-worker","name":"游戏电源监控","hostId":"pc","kind":"windows-process","target":"C:\\Scripts\\power-ctl-gamewatch.ps1","expected_interval":null,"stale_after":null}
```

示例路径需替换为实际值。支持 wscript/cscript、Node、Python、PowerShell/pwsh 的命令行子串匹配（不区分大小写）；也支持 target 精确匹配进程名。旧模板条目不会自动迁移，请在“管理条目”中改 target 并移除 mode。

初始配置含 35 个静态条目（Windows 11 + 服务器 24），加上 schedule 服务当时返回的有效任务。两份备份日志与 9 个容器名称已只读核实。endpoint、证书和部分业务探活仍需配置，不能视为已覆盖。DSH ended 记录单列历史，不计入汇总。

## AI / 自动化 API

API 位于 DSH 自己的 host WebServer，不创建独立监听端口或常驻进程。请求必须来自本机并通过 DSH `connection.requestRejection` 鉴权。使用已登录 DSH 的同源请求，或由宿主提供的受信认证客户端调用；不提供免认证令牌，也不把凭据写入前端。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/watchdog/api/schema` | 类型与接口发现 |
| GET | `/watchdog/api/registry` | 读取最新台账和 revision |
| PUT | `/watchdog/api/registry` | 校验并保存整份台账；带原 revision，防止覆盖并发修改 |
| GET | `/watchdog/api/status` | 健康结果、证据、汇总和历史 |
| GET | `/watchdog/api/snapshot` | 立即返回缓存；到期时启动后台采集，返回 refreshing/cacheStale；force=1 手动刷新 |
| GET | `/watchdog/api/descriptions` | 简介 revision、已保存映射，以及当前任务 ID/名称/有效简介 |
| PATCH | `/watchdog/api/descriptions` | 按 ID 批量更新任务简介，不改任务或监控配置 |
| GET | `/watchdog/api/log?id=条目ID` | 最近日志尾部或 DSH 送达历史 |

AI 操作流程：GET registry → 保留现有宿主/条目及 revision，仅追加/更新指定条目 → PUT JSON → GET status。重复 ID、不存在宿主、凭据/命令字段、错误采集器绑定都拒绝。API 没有启动、停止、修改系统任务的功能。没有自动挂载新的 DSH AI tool；现有 AI HTTP 能力可在宿主鉴权边界内使用该 API。

台账持久化在 `%USERPROFILE%\.dsh\watchdog-workspace\registry.json`，可在 host 环境设置 `DSH_WATCHDOG_REGISTRY` 自定义。读不到或格式损坏时显式报错，不静默覆盖。写入通过串行队列、revision 和原子重命名保护。不同 DSH profile 默认共享这份台账。

### 缓存与后台更新

打开面板立即显示上次结果，过期后在后台采集，列表保持可浏览。页面切换使用内存快照，重启使用注册表同目录的 `snapshot.json`；历史结果明确显示“上次结果”和采集时间。没有缓存的首次打开显示已注册条目的 UNKNOWN 状态，采集完成后更新。刷新失败保留旧结果和原时间，不冒充刚采集。台账内容变化会使旧快照失效，不会显示已经移除的条目。

`GET /snapshot` 返回原有状态结构及 `refreshing`、`cacheStale`、可选 `refreshError`。刷新中每 2 秒读取快照，完成后每分钟检查；不会因此每 2 秒重跑采集。手动刷新使用 `?force=1`。离开页面停止轮询，已经开始的一轮可完成并写缓存；没有常驻采集循环。`GET /status` 仍保留原有等待采集完成的兼容行为。

### AI 更新任务简介

简介显示在任务名称与状态之间，为单行纯文本，最多 160 字。友好名称通过 `displayName` 更新，最多 60 字；两者均按 Unicode 字符计数。先 GET `/watchdog/api/descriptions` 取得 `revision` 和 `items` 的真实 ID，再 PATCH：

```json
{"revision":0,"updates":[{"id":"pc-1","displayName":"云盘挂载守护","description":"云盘挂载掉线时尝试恢复。"}]}
```

把示例 revision 替换为 GET 的最新值。一次最多 500 条，未提供的条目保持原样；每项可以只修改 description、只修改 displayName 或同时修改，未给出的字段保持原样。revision 冲突返回 409，应重新读取。未知 ID、重复 ID、非法字段和过长文本会被拒绝。`description:""` 明确清空简介；`displayName:""` 回退默认友好名称，不改技术名称。读写仍受本机来源与 DSH 鉴权保护。

独立文件 `descriptions.json` 只保存 ID→简介、ID→友好名称与版本号，兼容旧版简介文件。DSH 动态任务同样支持（使用 GET 返回的 `dsh:...` ID）；不复制或更改 schedule 定义。更新在下次快照请求时生效，不必等待重新采集。已知条目提供简短默认用途；未知任务和 DSH 调度用途不会自动推测，AI 应先核实后填写。无需向 `/registry` 写简介，也不应把完整 GET 响应直接 PUT 回去。

`GET /snapshot` 的行新增 `displayName`、`unknownCategory:{code,label,action}`；顶层 `changes` 返回最近观察到的状态变化（itemId/from/to/kind/at/reason）。原 `name` 保持技术名称。

## 安全与判定边界

- SSH 使用 host 上的 OpenSSH `dsh-server` 别名及现有密钥配置，严格校验主机密钥、禁用交互；不会自动信任新主机。密钥路径不进入注册表或前端。
- 每项最多 5 秒，4 路并发，结果缓存 60 秒、并发请求合并。面板打开才发起刷新，关闭后已启动的一轮可完成；日志按需读取。手动刷新可提前启动一轮，刷新中仍展示带原采集时间的旧结果。
- FAIL：明确失败结果、业务探活失败或日志尾部 ERROR/FATAL；STALE：周期逾期/定时器停止；UNKNOWN：不可达、权限不足、未配置或缺证据。未知始终参与汇总。
- 日志末尾可能包含以前的失败记录，展示为失败线索，不保证识别每次运行边界。不采集完整日志。
- DshIcsAutofix 仅登录运行；白天 ICS 失效不会自愈，需要人手动 Start-ScheduledTask。插件不执行该操作。
- QQ/NapCat 是原告警通道的依赖；本面板独立于 QQ。断 SSH 保留条目并标未知。
- ts-cert-renew 从未执行则未验证；首次计划 2026-12-01。
- ef-feed 输出 `/dev/null`，没有 LAST；不会伪造。证书有效仅证明证书未过期，不证明 acme cron 正常。
- DSH schedule 只暴露送达信息，正常仅指调度送达，业务执行结果不在覆盖范围。cron/rrule 不猜周期，依据 DSH 权威 scheduledAt 判断逾期。

## 开发验证

`npm test` 执行自动测试；`npm pack` 打包。无需下载依赖。真实停 timer、改脚本、关热点属于故障注入，未执行，避免违反第一版只读约束。接口取证见 `docs/DSH-API-EVIDENCE.md`。
