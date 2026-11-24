# 0.1.4 上传交接

本轮仅准备发布材料，没有执行 GitHub 上传。

新增：

- 全部 / 只看需处理筛选，保留全量汇总，隐藏没有匹配项的分组。
- 未知原因分类与详情中的处理提示。
- 最近状态变化：失败、可疑、转为未知、恢复和完成验证；跨重启保存最近 100 条，界面最多展示 20 条。
- 中文友好名称；详情保留技术名称；AI 可按 ID 更新显示名。

沿用既有的只读采集、缓存后台更新、任务简介 API、左右独立滚动和选中标记。

源码上传范围：`lib/`、`test/`、`package.json`、`cordis.patch.yml`、`README.md`、`SELFTEST.md`、`BADGE.md`、`RELEASE.md`、`.gitignore` 和 `docs/DSH-API-EVIDENCE.md`。不要把本机 `backups/`、实际台账/缓存/简介 JSON、只读实机采集摘要加入仓库；.gitignore 已列出这些本地文件。

发布附件：`dsh-watchdog-workspace-0.1.4.tgz`。该包不包含本机台账、缓存、备份或采集摘要。

DSH 桌面插件 → 添加插件支持本地包；远程发布地址需上传后再补入 README，当前不写虚构仓库地址。GitHub README 可使用 BADGE.md 提供的 Built with Codex 徽章。

状态变化属于按需采集的观察记录，关闭面板期间发生且结束的短暂故障可能看不到，不是系统完整审计日志。初次发现条目不记变化，配置变化后重新建立基线。桌面重启和实际视觉效果尚待最终验证。

验证：node --test test/*.test.js，81项全部通过。
