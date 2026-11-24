/* DSH 0.2.2 client loader; verified against installed server-deck 0.5.0. */
window.__ModuleLoader__.load({ id: 'dsh-watchdog-workspace', factory: (require) => {
  const React = require('react');
  const h = React.createElement;
  const labels = { OK: '正常', STALE: '可疑', FAIL: '失败', UNKNOWN: '未知' };
  const colors = { OK: '#32a77b', STALE: '#d39426', FAIL: '#e36060', UNKNOWN: '#8b93a5' };
  const order = { FAIL: 0, STALE: 1, UNKNOWN: 2, OK: 3 };
  let lastSnapshot = null;
  let lastNeedsAttention = false;
  const changeLabels = { recovered: '已恢复', failed: '发生失败', stale: '运行过期', unknown: '状态未知', verified: '已验证' };
  const displayName = item => item.displayName || item.name;
  const statusLabel = item => item.status === 'UNKNOWN' && item.unknownCategory?.label ? '未知 · ' + item.unknownCategory.label : labels[item.status] || '未知';
  async function api(path, options = {}) {
    const response = await fetch('/watchdog/api' + path, { credentials: 'same-origin', ...options,
      headers: { 'content-type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '请求失败：' + response.status);
    return body;
  }
  function relative(value) {
    if (!value) return '无记录';
    const age = (Date.now() - new Date(value).getTime()) / 1000;
    if (!Number.isFinite(age)) return '时间未知';
    if (age < 60) return '刚刚';
    if (age < 3600) return Math.floor(age / 60) + ' 分钟前';
    if (age < 86400) return Math.floor(age / 3600) + ' 小时前';
    return Math.floor(age / 86400) + ' 天前';
  }
  const css = `.wd{font:14px/1.6 system-ui,sans-serif;color:var(--foreground,#e7eaf0);background:var(--background,#191d26);height:100%;min-height:0;overflow:hidden;display:flex;box-sizing:border-box;position:relative}.wd *{box-sizing:border-box}.wd .list{flex:1;min-width:0;min-height:0;overflow:auto;padding:24px;overscroll-behavior:contain}.wd button{font:inherit;color:inherit;background:transparent;border:1px solid #69738666;border-radius:8px;padding:5px 12px;cursor:pointer}.wd button:disabled{opacity:.5;cursor:wait}.wd button:focus-visible,.wd textarea:focus-visible{outline:2px solid #779bff}.wd header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.wd h2{font-size:22px;margin:0 auto 0 0}.wd h3{font-size:15px;margin:24px 0 8px}.wd .muted{color:#9ca5b5;font-size:12px}.wd .summary{margin:12px 0 22px}.wd .row{width:100%;display:flex;align-items:center;text-align:left;gap:10px;border:0;border-bottom:1px solid #69738633;border-radius:0;padding:12px 4px}.wd .row:hover{background:#69738622}.wd .row.selected{background:#779bff22;box-shadow:inset 3px 0 #779bff;padding-left:12px}.wd .row.selected:hover{background:#779bff33}.wd .selection-mark{color:#9db7ff;font-weight:700}.wd .filters{align-items:center}.wd .filters button[aria-pressed=true]{background:#779bff22;border-color:#779bff88}.wd .changes{margin-top:26px;padding-top:18px;border-top:1px solid #69738633}.wd .changes>summary{cursor:pointer;margin-bottom:8px}.wd .change-row .chip,.wd .change-row .muted{flex-shrink:0}.wd .history{margin-top:40px;padding-top:24px;border-top:1px solid #69738655}.wd .history>summary{cursor:pointer;margin-bottom:12px}.wd .name{flex:1;overflow-wrap:anywhere}.wd .task-row .name{flex:0 1 290px;min-width:0}.wd .description{flex:1;min-width:0;color:#9ca5b5;font-size:12px;overflow-wrap:anywhere}.wd .task-row .chip{flex-shrink:0}.wd .list{container-type:inline-size}@container(max-width:620px){.wd .task-row{flex-wrap:wrap}.wd .task-row .name{flex:1 1 calc(100% - 100px)}.wd .task-row .description{order:5;flex:1 0 100%;padding-left:18px}.wd .task-row .description:empty{display:none}}.wd .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.wd .detail{flex:0 0 min(480px,42%);min-width:0;height:100%;overflow:auto;overscroll-behavior:contain;padding:24px;background:var(--background,#202632);box-shadow:-12px 0 36px #0004;z-index:2}.wd .detail pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0002;padding:12px;font-size:12px;max-height:400px;overflow:auto}.wd dl{display:grid;grid-template-columns:90px 1fr;gap:10px}.wd dd{margin:0;overflow-wrap:anywhere}.wd dt{color:#9ca5b5}.wd .error{padding:12px;border:1px solid #e3606066;border-radius:8px;color:#ed9393}.wd textarea{width:100%;min-height:330px;background:#0002;color:inherit;border:1px solid #69738666;padding:12px;font:12px/1.6 monospace;border-radius:8px}.wd .actions{display:flex;gap:8px;margin:12px 0}.wd .chip{font-size:12px}.wd .notice{padding:12px;background:#d3942612;border-left:2px solid #d39426;margin-top:20px}@media(max-width:700px){.wd .detail{position:absolute;inset:0;width:100%;max-width:none}.wd .list{padding:16px}}`;
  function App({ visible = true }) {
    const [data, setData] = React.useState(lastSnapshot && { ...lastSnapshot,
      cacheStale: lastSnapshot.cacheStale || !lastSnapshot.collectedAt || Date.now() - new Date(lastSnapshot.collectedAt).getTime() >= 60000 });
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [selected, setSelected] = React.useState(null);
    const [log, setLog] = React.useState(null);
    const [edit, setEdit] = React.useState(null);
    const [saveBusy, setSaveBusy] = React.useState(false);
    const [needsAttention, setNeedsAttention] = React.useState(lastNeedsAttention);
    const active = React.useRef(false);
    const controller = React.useRef(null);
    const poll = React.useRef(null);
    const generation = React.useRef(0);
    const logRequest = React.useRef(0);
    async function refresh(force = false) {
      if (!active.current || controller.current) return;
      clearTimeout(poll.current);
      poll.current = null;
      const request = new AbortController(); controller.current = request;
      const ticket = generation.current;
      let nextDelay = 60000;
      setBusy(true);
      try {
        const value = await api('/snapshot' + (force === true ? '?force=1' : ''), { signal: request.signal });
        if (active.current && ticket === generation.current) {
          lastSnapshot = value; setData(value); setError(value.refreshError || '');
          nextDelay = value.refreshing ? 2000 : 60000;
        }
      } catch (e) {
        if (active.current && ticket === generation.current && e.name !== 'AbortError') {
          setError(e.message);
          if (lastSnapshot) { lastSnapshot = { ...lastSnapshot, cacheStale: true, refreshing: false }; setData(lastSnapshot); }
        }
      } finally {
        if (controller.current === request) controller.current = null;
        if (active.current && ticket === generation.current) {
          setBusy(false);
          poll.current = setTimeout(() => refresh(), nextDelay);
        }
      }
    }
    React.useEffect(() => {
      active.current = visible;
      if (!visible) return;
      refresh();
      return () => { active.current = false; generation.current++; clearTimeout(poll.current); poll.current = null; controller.current?.abort(); controller.current = null; logRequest.current++; };
    }, [visible]);
    const items = data?.items || [];
    const filteredItems = needsAttention ? items.filter(item => ['FAIL', 'STALE', 'UNKNOWN'].includes(item.status)) : items;
    const changes = [...(data?.changes || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 20);
    function filter(value) { lastNeedsAttention = value; setNeedsAttention(value); }
    function selectItem(id) { logRequest.current++; setSelected(id); setLog(null); }
    const counts = { OK: 0, STALE: 0, FAIL: 0, UNKNOWN: 0 };
    for (const item of items) counts[labels[item.status] ? item.status : 'UNKNOWN']++;
    const current = selected && (items.find(i => i.id === selected) || null);
    async function logs() {
      const ticket = ++logRequest.current;
      setLog('正在读取…');
      try { const value = await api('/log?id=' + encodeURIComponent(selected)); if (ticket === logRequest.current && active.current) setLog(value.error ? '无法读取日志：' + value.error : value.text || '没有可用日志'); }
      catch (e) { if (ticket === logRequest.current && active.current) setLog('无法读取日志：' + e.message); }
    }
    async function editRegistry() {
      try { setEdit(JSON.stringify(await api('/registry'), null, 2)); setError(''); }
      catch (e) { setError(e.message); }
    }
    async function save() {
      setSaveBusy(true);
      try { const parsed = JSON.parse(edit); await api('/registry', { method: 'PUT', body: JSON.stringify(parsed) }); setEdit(null); setError(''); await refresh(); }
      catch (e) { setError(e.message); }
      finally { setSaveBusy(false); }
    }
    const hosts = data?.hosts || [];
    const hostIds = [...new Set([...hosts.map(i => i.id), ...filteredItems.map(i => i.hostId)])].filter(id => filteredItems.some(item => item.hostId === id));
    return h('section', { className: 'wd', 'aria-label': '看门狗工作区' },
      h('style', null, css),
      h('div', { className: 'list' },
      h('header', null, h('h2', null, '看门狗'),
        h('button', { onClick: editRegistry }, '管理条目'), h('button', { onClick: () => refresh(true), disabled: busy || data?.refreshing }, busy || data?.refreshing ? '更新中…' : '刷新')),
      h('div', { className: 'summary', 'aria-live': 'polite' }, `共 ${items.length} 项 · ✅ ${counts.OK} 正常 · ⚠️ ${counts.STALE} 可疑 · ❌ ${counts.FAIL} 失败 · ◌ ${counts.UNKNOWN} 未知`,
        h('div', { className: 'muted' }, !data?.collectedAt ? (busy || data?.refreshing ? '首次采集中…' : '等待首次采集')
          : (data.cacheStale || data.refreshing || error ? '上次结果' : '采集于') + ' ' + new Date(data.collectedAt).toLocaleTimeString()
            + (busy || data.refreshing ? ' · 更新中' : data.cacheStale || error ? ' · 待更新' : ' · 每分钟更新'))),
      error && h('div', { className: 'error', role: 'alert' }, error, data && '（以下为上次成功采集结果，当前状态未确认）'),
      h('div', { className: 'actions filters', 'aria-label': '条目筛选' },
        h('button', { 'aria-pressed': !needsAttention, onClick: () => filter(false) }, '全部'),
        h('button', { 'aria-pressed': needsAttention, onClick: () => filter(true) }, '只看需处理'),
        h('span', { className: 'muted' }, `${filteredItems.length}/${items.length}`)),
      edit !== null ? h('section', null, h('h3', null, '注册与编辑监控条目'),
        h('p', { className: 'muted' }, '自由配置 hosts 和 items。保存只更新看门狗台账，不会启动、停止或修改被监控的任务。expected_interval / stale_after 单位为秒；登录触发可为 null。SSH 使用 host 的 sshTarget 别名，密钥留在 host 的 SSH 配置中。'),
        h('textarea', { 'aria-label': '监控注册表 JSON', value: edit, onChange: e => setEdit(e.target.value), spellCheck: false }),
        h('div', { className: 'actions' }, h('button', { onClick: save, disabled: saveBusy }, saveBusy ? '保存中…' : '保存台账'), h('button', { onClick: () => setEdit(null), disabled: saveBusy }, '取消')))
      : hostIds.map(id => h('section', { key: id }, h('h3', null, hosts.find(i => i.id === id)?.name || id),
        ...filteredItems.filter(i => i.hostId === id).sort((a,b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || displayName(a).localeCompare(displayName(b))).map(item => h('button', {
          className: 'row task-row' + (selected === item.id ? ' selected' : ''), key: item.id, 'aria-pressed': selected === item.id, onClick: () => selectItem(item.id), 'aria-label': displayName(item) + '：' + statusLabel(item)
        }, h('span', { className: 'dot', style: { background: colors[item.status] || colors.UNKNOWN }, 'aria-hidden': true }),
        h('span', { className: 'name' }, displayName(item)), h('span', { className: 'description' }, item.description || ''), selected === item.id && h('span', { className: 'selection-mark', 'aria-hidden': true }, '✓'), h('span', { className: 'chip' }, statusLabel(item)))))),
      !busy && data && items.length === 0 && h('p', { className: 'muted' }, '尚无监控条目，点击“管理条目”注册。'),
      data && items.length > 0 && needsAttention && filteredItems.length === 0 && h('p', { className: 'muted' }, '无待处理项'),
      changes.length > 0 && h('details', { className: 'changes' },
        h('summary', null, `最近变化（${changes.length}）`),
        ...changes.map(change => {
          const item = items.find(candidate => candidate.id === change.itemId);
          return h(item ? 'button' : 'div', { className: 'row change-row', key: change.id,
            title: change.reason || '', onClick: item ? () => { if (needsAttention && item.status === 'OK') filter(false); selectItem(item.id); } : undefined },
            h('span', { className: 'name' }, displayName(change)),
            h('span', { className: 'chip', style: { color: colors[change.to] || colors.UNKNOWN } }, changeLabels[change.kind] || `${labels[change.from] || '未知'} → ${labels[change.to] || '未知'}`),
            h('span', { className: 'muted', title: change.at }, relative(change.at)));
        })),
      data?.history?.length > 0 && h('details', { className: 'history' },
        h('summary', null, `历史任务（${data.history.length}）`),
        ...data.history.map((item, index) => h('div', { className: 'row', key: item.id || index },
          h('span', { className: 'name' }, item.name || item.title || item.id || '历史任务'),
          h('span', { className: 'muted' }, item.state || item.status || '已结束'))))),
      current && h('aside', { className: 'detail', key: current.id, 'aria-label': displayName(current) + '详情' },
        h('button', { onClick: () => { setSelected(null); logRequest.current++; }, 'aria-label': '关闭详情' }, '← 返回清单'),
        h('h3', null, displayName(current)), h('p', { style: { color: colors[current.status] } }, statusLabel(current) + ' · ' + (current.reason || '暂无判定依据')),
        current.status === 'UNKNOWN' && current.unknownCategory?.action && h('p', { className: 'notice' }, current.unknownCategory.action),
        h('dl', null, h('dt', null, '技术名称'), h('dd', null, current.name),
          h('dt', null, '触发周期'), h('dd', null, current.expected_interval == null ? (current.mode === 'on-logon' ? '仅登录触发' : '事件 / 常驻') : current.expected_interval + ' 秒'),
          h('dt', null, '失效阈值'), h('dd', null, current.stale_after == null ? '按类型判定' : current.stale_after + ' 秒'),
          h('dt', null, '上次运行'), h('dd', null, relative(current.lastRun || current.evidence?.lastRun || current.evidence?.last_run)), h('dt', null, '采集类型'), h('dd', null, current.kind),
          h('dt', null, '目标'), h('dd', null, current.target || '由服务动态提供')),
        current.notes && h('p', { className: 'notice' }, current.notes),
        h('details', null, h('summary', null, '判定证据'), h('pre', null, JSON.stringify(current.evidence || {}, null, 2))),
        h('div', { className: 'actions' }, h('button', { onClick: logs }, '读取最近日志')),
        log !== null && h('pre', { role: 'status' }, log)));
  }
  function apply(ctx) {
    // Verified core 0.2.2 sidebar.panellist + main extension points.
    ctx.effect(() => {
      const disposers = [];
      try {
        const slots = ctx.slots;
        disposers.push(slots.inject('main', () => slots.register({
          name: 'main', key: 'watchdog-workspace', inject: () => ({})
        }, App)));
        disposers.push(slots.inject('sidebar.panellist', () => slots.register({
          name: 'sidebar.panellist', id: 'watchdog-workspace', order: 46,
          label: () => '看门狗'
        }, ({ size = 18 }) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
          h('path', { d: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z' }),
          h('path', { d: 'm7 12 3 0 2-4 2 8 2-4h2' })) )));
      } catch (error) {
        for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose();
        console.warn('[watchdog] core sidebar registration failed:', error);
      }
      return () => { for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose(); };
    });
  }
  return { name: 'watchdog-workspace', inject: ['slots', 'connection'], apply };
} });
