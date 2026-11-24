# DSH API evidence

Verified read-only on 2026-11-23 against `D:\Deepseek\resources\app.asar`, core `0.2.2-rc.5`. The archive was read directly using its JSON header and byte offsets; no installation files were modified. Windows Everything IPC was unavailable, so only explicitly known paths and the DSH process executable path were used.

## Native left navigation and page

Archive member `dsh/node_modules/@deepseek-ai/dsh-client-ui-schedule/lib/client.js` and `dsh-client-ui-plugin-manager/lib/client.js` register the native navigation through injected `slots`:

```js
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: PANEL_ID, inject: () => ({})
}, PageComponent));
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: PANEL_ID, order: 20,
  label: () => '看门狗'
}, IconComponent));
```

`IconComponent` receives `{size, active}`. `dsh-client-ui-sidebar/lib/client.js` derives the panel list from `slots.entriesOfSlot('sidebar.panellist')` and selects it with `ctx.layout.selectPanel(id)`. No DOM injection or better-sidebar dependency is necessary. `slots` is a host-provided service; importing the removed `@deepseek-ai/dsh-client-ui-slots` package is unnecessary.

Main panels are not kept mounted when switched away. `dsh-client-ui-layout/lib/client.js` calls `renderSlot('main', {}, {entryKey: panelId ?? 'conversation'})`. `dsh-client-ui-renderer/lib/client.js` selects just the keyed entry with `find(e => e.options.key === opts?.entryKey)` and renders it with the distinct React key `entryKeyOf(entry)`. Switching panels unmounts the previous page, so effect cleanup stops page polling. There is no implicit `visible` prop for native main pages.

Installed `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-server-deck\lib\client.js` uses `window.__ModuleLoader__.load({id, factory(require) { ... return module.exports; }})`; declares `inject = ['slots','connection']`. Its right-tab fallback is not needed for this native main-page implementation.

## Host HTTP and authentication

Installed server-deck `lib/index.js` declares `inject=['webServer','connection','tools','systemPrompt']`. Host routes use `ctx.webServer.register({kind:'prefix',path:'/server-deck/api',handler})`. The handler receives Node `req,res`. `connection.requestRejection(req)` returns `undefined` for accepted, or `401` / `403`; absence or throw must fail closed (`503`). The reference plugin additionally restricts requests to loopback.

## Schedule read APIs

Archive member `dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js` declares service name `schedule` via `super(ctx,'schedule')`. Add `schedule` to `inject` or use `ctx.inject(['schedule'], child => ...)` before access. Optional Cordis service access must be guarded.

- `await ctx.schedule.catalog()` returns the full array, not a result envelope; no session activation.
- `await ctx.schedule.list({active:true,limit,offset})` returns `{items,shown,total,limit,offset}`.
- `await ctx.schedule.history({id,limit:20})` returns `{id,records,earlierRecordsUnavailable,earlierRecordsPruned,retention,nextBefore?}` or `{id,code}`.
- Entry: schedule record fields plus `status`, `target`, `involvedSessionIds`, `createdAt?`, `updatedAt?`, `executionActive?`, `deliveryFloorEndsAt?`, `lastDelivery?`.
- Rule kinds: `after`, `at`, `every` (`everySeconds`), `daily` (`time,timeZone`), `weekly` (`time,timeZone,weekdays`), `cron`, `rrule`. `scheduledAt` is the authoritative next unaccepted occurrence.
- Receipt: `{scheduledAt,deliveredAt,messageId,targetSessionId?}`. No exit code, `lastError`, or business result is exposed. Watchdog labels this scope as **delivery-only** and does not claim the underlying AI job succeeded.

## Desktop installation

Archive `dsh-plugin-manager/lib/index.js`, `parseInstallSpec(raw)` explicitly accepts absolute local paths, `file:` / `link:` absolute paths, and local tarballs. Relative local paths are rejected. The plugin UI passes this spec to the existing installer, which runs pnpm and validates `manifest.dsh.bundle`.

Therefore the supported delivery path is **侧栏 → 插件 → 添加插件 → paste the absolute `.tgz` path**. Ship all JavaScript and `cordis.patch.yml` inside the tarball; no postinstall build is required. UI activation/restart persistence still require live acceptance testing, and are not proven merely by source inspection.

Client-side path verified too: `dsh-client-ui-plugin-manager/lib/client.js` `InstallDialog` accepts arbitrary text into `install.spec`; `runInstall()` trims and inspects it, and `startInstall(subject)` passes `subject.spec` to `ctx.remote.pluginManager.installBundle(spec, {...})`. The input does not restrict users to registry package names. The install dialog has its own built-in install guide and local-directory example. The installer, rather than this plugin, owns package installation and activation.
