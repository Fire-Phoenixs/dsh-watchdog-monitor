import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('client uses the installed DSH loader and core sidebar injection', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let definition;
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load(value) { definition = value; } } } });
  assert.equal(definition.id, 'dsh-watchdog-workspace');
  const plugin = definition.factory(id => {
    assert.ok(['react', 'react-dom/client'].includes(id));
    return id === 'react' ? { createElement() {} } : { createRoot() {} };
  });
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection']);
  const registrations = [];
  let cleanup;
  let disposed = 0;
  plugin.apply({ effect(fn) { cleanup = fn(); }, slots: {
    inject(name, fn) { fn(); return () => disposed++; },
    register(descriptor, component) { registrations.push({ descriptor, component }); return () => {}; }
  } });
  assert.equal(registrations[0].descriptor.name, 'main');
  assert.equal(registrations[1].descriptor.name, 'sidebar.panellist');
  assert.equal(registrations[0].descriptor.key, registrations[1].descriptor.id);
  assert.equal(registrations[1].descriptor.label(), '看门狗');
  cleanup();
  assert.equal(disposed, 2);
});

test('initial list keeps details collapsed and orders failures before healthy entries', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let definition, Page;
  let state = 0;
  const data = { collectedAt: new Date().toISOString(), hosts: [{ id: 'pc', name: '电脑' }], history: [{id:'ended',name:'Ended task',status:'ended'}], items: [
    { id: 'good', hostId: 'pc', name: 'Healthy task', status: 'OK', reason: 'SECRET DETAIL', evidence: {} },
    { id: 'bad', hostId: 'pc', name: 'Failed task', status: 'FAIL', reason: 'SECRET ERROR DETAIL', evidence: {} }
  ] };
  const react = {
    createElement(type, props, ...children) { return { type, props, children }; },
    useState(initial) { return [state++ === 0 ? data : initial, () => {}]; },
    useRef(value) { return { current: value }; }, useEffect() {}
  };
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load(value) { definition = value; } } }, AbortController, Date });
  const plugin = definition.factory(() => react);
  plugin.apply({ effect(fn) { fn(); }, slots: { inject(_name, fn) { fn(); return () => {}; },
    register(descriptor, component) { if (descriptor.name === 'main') Page = component; return () => {}; }
  } });
  const tree = Page({});
  const serialized = JSON.stringify(tree);
  assert.ok(serialized.indexOf('Failed task') < serialized.indexOf('Healthy task'));
  assert.ok(serialized.includes('共 2 项 · ✅ 1 正常'));
  assert.ok(!serialized.includes('SECRET DETAIL'));
  assert.ok(!serialized.includes('SECRET ERROR DETAIL'));
  assert.ok(!serialized.includes('读取最近日志'));
  assert.ok(serialized.includes('历史任务（1）'));
  assert.ok(serialized.includes('Ended task'));
});

test('log acquisition errors remain explicit and page cleanup stops polling', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let definition, Page, state = 0, log, cleared = false;
  const effects = [];
  const data = { collectedAt: new Date().toISOString(), hosts: [], items: [{id:'x',name:'Test',status:'UNKNOWN',hostId:'pc',lastRun:Date.now(),evidence:{}}] };
  const react = {
    createElement(type, props, ...children) { return {type, props, children}; },
    useState(initial) { const index = state++; return [index === 0 ? data : index === 3 ? 'x' : initial, value => { if(index === 4) log = value; }]; },
    useRef(value) { return {current:value}; }, useEffect(effect) { effects.push(effect); }
  };
  vm.runInNewContext(code, {
    window:{__ModuleLoader__:{load(value){definition=value;}}}, AbortController, Date,
    setTimeout() { return 42; }, clearTimeout(id) { if(id === 42) cleared=true; },
    async fetch(path) { return {ok:true,async json(){ return path.includes('/log') ? {text:'',error:'SSH unavailable'} : data; }}; }
  });
  definition.factory(() => react).apply({effect(fn){fn();},slots:{inject(_name,fn){fn();return()=>{};},register(descriptor,component){if(descriptor.name==='main')Page=component;return()=>{};}}});
  const tree = Page({});
  const cleanup = effects[0]();
  const walk = node => typeof node === 'object' && node ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : [];
  const button = walk(tree).find(node => node.type === 'button' && node.children[0] === '读取最近日志');
  assert.ok(button);
  await button.props.onClick();
  assert.equal(log,'无法读取日志：SSH unavailable');
  cleanup();
  assert.equal(cleared,true);
});

async function snapshotHarness(snapshots) {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let definition, Page, cursor = 0, timerId = 0;
  let hooks = [], effects = [], mounted = false;
  const calls = [], timers = new Map();
  const react = {
    createElement(type, props, ...children) { return { type, props, children }; },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(effect) { cursor++; if (!mounted) effects.push(effect); }
  };
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load(value) { definition = value; } } }, AbortController, Date,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    async fetch(path, options) { calls.push({ path, signal: options.signal }); return { ok: true, async json() { return snapshots.shift(); } }; }
  });
  definition.factory(() => react).apply({ effect(fn) { fn(); }, slots: { inject(_name, fn) { fn(); return () => {}; }, register(descriptor, component) { if(descriptor.name === 'main') Page = component; return () => {}; } } });
  return { calls, timers,
    render() { cursor = 0; const tree = Page({}); mounted = true; return tree; },
    mount() { const cleanups = effects.splice(0).map(fn => fn()); return () => cleanups.forEach(fn => fn?.()); },
    remount() { hooks = []; effects = []; mounted = false; return this.render(); },
    async settle() { for(let i = 0; i < 8; i++) await Promise.resolve(); },
    async tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); await this.settle(); }
  };
}
const nodes = node => typeof node === 'object' && node ? [node, ...(node.children || []).flat(Infinity).flatMap(nodes)] : [];

test('snapshot polling displays cached rows immediately, polls every two seconds only while refreshing, and preserves selection', async () => {
  const cached = { collectedAt: '2026-01-01T00:00:00Z', cacheStale: true, refreshing: true, hosts: [{id:'pc',name:'电脑'}], items: [{id:'x',hostId:'pc',name:'Watchdog',description:'云盘挂载守护',status:'OK'}] };
  const fresh = { ...cached, collectedAt: new Date().toISOString(), cacheStale:false, refreshing:false };
  const harness = await snapshotHarness([cached, fresh, {...fresh,refreshing:true}]);
  harness.render(); const cleanup = harness.mount(); await harness.settle();
  let tree = harness.render();
  assert.equal(harness.calls[0].path, '/watchdog/api/snapshot');
  assert.equal([...harness.timers.values()][0].delay, 2000);
  assert.ok(JSON.stringify(tree).includes('上次结果'));
  const row = nodes(tree).find(node => node.props?.className === 'row task-row');
  const spans = row.children.filter(node => node?.type === 'span');
  assert.deepEqual(spans.map(node => node.props.className), ['dot','name','description','chip']);
  assert.equal(spans[2].children[0], '云盘挂载守护');
  row.props.onClick();
  await harness.tick(); tree = harness.render();
  assert.equal([...harness.timers.values()][0].delay, 60000);
  assert.ok(nodes(tree).some(node => node.props?.className === 'row task-row selected'));
  assert.ok(nodes(tree).some(node => node.type === 'aside'));
  const refresh = nodes(tree).find(node => node.type === 'button' && node.children[0] === '刷新');
  await refresh.props.onClick();
  assert.equal(harness.calls[2].path, '/watchdog/api/snapshot?force=1');
  cleanup();
  assert.equal(harness.timers.size, 0);
  tree = harness.remount();
  assert.ok(JSON.stringify(tree).includes('Watchdog'));
  assert.ok(JSON.stringify(tree).includes('云盘挂载守护'));
  assert.equal(harness.calls.length, 3, 'remount renders cached rows before its effect requests network');
});

test('empty-cache snapshot keeps UNKNOWN rows and never formats null as an epoch timestamp', async () => {
  const harness = await snapshotHarness([{ collectedAt:null,refreshing:true,cacheStale:true,hosts:[],items:[{id:'x',hostId:'pc',name:'Waiting task',status:'UNKNOWN'}] }]);
  harness.render(); const cleanup = harness.mount(); await harness.settle();
  const tree = harness.render();
  const text = JSON.stringify(tree);
  assert.ok(text.includes('Waiting task'));
  assert.ok(text.includes('首次采集中'));
  assert.ok(!text.includes('采集于'));
  assert.ok(!text.includes('1970'));
  cleanup();
  assert.equal(harness.timers.size, 0);
});

test('closing the panel aborts an in-flight snapshot and prevents late polling', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const harness = await snapshotHarness([pending]);
  harness.render(); const cleanup = harness.mount();
  assert.equal(harness.calls.length, 1);
  cleanup();
  assert.equal(harness.calls[0].signal.aborted, true);
  resolve({collectedAt:null,refreshing:true,cacheStale:true,hosts:[],items:[]});
  await harness.settle();
  assert.equal(harness.timers.size, 0);
});

test('needs-attention filter preserves full totals, hides empty hosts and survives remount', async () => {
  const snapshot = { collectedAt:new Date().toISOString(),refreshing:false,hosts:[{id:'goodhost',name:'Healthy host'},{id:'badhost',name:'Attention host'}],items:[
    {id:'good',hostId:'goodhost',name:'Good',status:'OK'},
    ...['FAIL','STALE','UNKNOWN'].map((status,index) => ({id:String(index),hostId:'badhost',name:status,status}))
  ] };
  const harness = await snapshotHarness([snapshot]);
  harness.render(); const cleanup = harness.mount(); await harness.settle();
  let tree = harness.render();
  nodes(tree).find(node => node.type === 'button' && node.children[0] === '只看需处理').props.onClick();
  tree = harness.render();
  let text = JSON.stringify(tree);
  assert.ok(text.includes('共 4 项 · ✅ 1 正常'));
  assert.ok(text.includes('3/4'));
  assert.ok(!text.includes('Healthy host'));
  assert.equal(nodes(tree).filter(node => node.props?.className === 'row task-row').length, 3);
  cleanup();
  tree = harness.remount();
  assert.equal(nodes(tree).find(node => node.type === 'button' && node.children[0] === '只看需处理').props['aria-pressed'], true);
  assert.ok(JSON.stringify(tree).includes('3/4'));
});

test('friendly names and unknown categories stay concise while details keep technical names and action', async () => {
  const snapshot = {collectedAt:new Date().toISOString(),hosts:[],items:[{id:'x',hostId:'pc',name:'CloudDriveWatchdog',displayName:'云盘守护',target:'TechnicalTarget',status:'UNKNOWN',unknownCategory:{label:'权限不足',action:'请使用具备读取权限的账号。'}}]};
  const harness = await snapshotHarness([snapshot]);
  harness.render(); const cleanup = harness.mount(); await harness.settle();
  let tree = harness.render();
  let row = nodes(tree).find(node => node.props?.className === 'row task-row');
  assert.ok(JSON.stringify(row).includes('云盘守护'));
  assert.ok(JSON.stringify(row).includes('未知 · 权限不足'));
  assert.ok(!JSON.stringify(row).includes('CloudDriveWatchdog'));
  assert.ok(!JSON.stringify(tree).includes('请使用具备读取权限的账号。'));
  row.props.onClick(); tree = harness.render();
  const detail = nodes(tree).find(node => node.type === 'aside');
  const text = JSON.stringify(detail);
  assert.ok(text.includes('CloudDriveWatchdog'));
  assert.ok(text.includes('TechnicalTarget'));
  assert.ok(text.includes('请使用具备读取权限的账号。'));
  cleanup();
});

test('recent changes are separate, newest first and limited to twenty, with links to existing items', async () => {
  const changes = Array.from({length:23},(_,index) => ({id:'c'+index,itemId:index === 22 ? 'good' : 'removed',name:'change'+index,displayName:index === 22 ? '恢复的任务' : undefined,at:new Date(1700000000000 + index * 1000).toISOString(),from:'FAIL',to:'OK',kind:'recovered'}));
  const harness = await snapshotHarness([{collectedAt:new Date().toISOString(),hosts:[],items:[{id:'good',hostId:'pc',name:'Good',status:'OK'}],changes,history:[{id:'ended',name:'Ended'}]}]);
  harness.render(); const cleanup = harness.mount(); await harness.settle();
  let tree = harness.render();
  nodes(tree).find(node => node.type === 'button' && node.children[0] === '只看需处理').props.onClick();
  tree = harness.render();
  assert.ok(JSON.stringify(tree).includes('无待处理项'));
  const recent = nodes(tree).find(node => node.type === 'details' && node.props.className === 'changes');
  assert.equal(recent.props.open, undefined);
  const rows = nodes(recent).filter(node => node.props?.className === 'row change-row');
  assert.equal(rows.length,20);
  assert.equal(rows[0].type,'button');
  assert.ok(JSON.stringify(rows[0]).includes('恢复的任务'));
  assert.ok(JSON.stringify(rows[0]).includes('已恢复'));
  assert.ok(JSON.stringify(rows[19]).includes('change3'));
  assert.equal(rows[1].type,'div');
  assert.equal(rows[1].props.onClick,undefined);
  assert.ok(nodes(tree).some(node => node.type === 'details' && node.props.className === 'history'));
  rows[0].props.onClick(); tree = harness.render();
  assert.ok(nodes(tree).some(node => node.props?.className === 'row task-row selected'));
  assert.equal(nodes(tree).find(node => node.type === 'button' && node.children[0] === '全部').props['aria-pressed'], true);
  cleanup();
});
