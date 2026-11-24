import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../lib/engine.js';
import {defaults} from '../lib/defaults.js';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
test('SSH outage retains rows as UNKNOWN; counts match; simultaneous requests coalesce and cache',async()=>{
 const config=defaults();let calls=0;
 const engine=new Engine({get:async()=>config},{},async()=>{calls++;throw Error('SSH disconnected');});
 const [a,b]=await Promise.all([engine.status(),engine.status()]);assert.equal(a,b);assert.equal(a.items.length,config.items.length+1);assert.equal(a.counts.UNKNOWN,a.items.length);assert.ok(a.items.every(i=>i.status==='UNKNOWN'));await engine.status();assert.equal(calls,config.items.length);engine.invalidate();await engine.status();assert.equal(calls,config.items.length*2);
});
test('snapshot returns immediately, coalesces refresh, persists and replaces stale data',async()=>{
 const config=defaults();config.items=config.items.slice(0,1);
 const path=join(tmpdir(),`watchdog-cache-${randomUUID()}`,'snapshot.json');
 let release,calls=0;const gate=new Promise(resolve=>release=resolve);
 const collector=async()=>{calls++;await gate;return {lastRun:new Date().toISOString(),result:0,verified:true};};
 const engine=new Engine({get:async()=>config},{},collector,{snapshotPath:path});
 const first=await engine.snapshot();assert.equal(first.collectedAt,null);assert.equal(first.refreshing,true);assert.equal(first.items[0].status,'UNKNOWN');
 await engine.snapshot();assert.equal(calls,1);release();await engine.pending;
 const fresh=await engine.snapshot();assert.equal(fresh.refreshing,false);assert.equal(fresh.cacheStale,false);assert.equal(fresh.items.find(i=>i.id===config.items[0].id).status,'OK');
 let releaseNext;const nextGate=new Promise(resolve=>releaseNext=resolve);
 const restarted=new Engine({get:async()=>config},{},async()=>{await nextGate;return {error:'SSH offline'};},{snapshotPath:path});
 const cached=await restarted.snapshot();assert.equal(cached.collectedAt,fresh.collectedAt);assert.equal(cached.cacheStale,true);assert.equal(cached.refreshing,true);assert.equal(cached.items.find(i=>i.id===config.items[0].id).status,'OK');
 releaseNext();await restarted.pending;const next=await restarted.snapshot();assert.equal(next.items.find(i=>i.id===config.items[0].id).status,'UNKNOWN');assert.equal(next.cacheStale,false);
 config.items[0]={...config.items[0],name:'Updated registration'};const changed=await restarted.snapshot();assert.equal(changed.collectedAt,null);assert.equal(changed.items[0].name,'Updated registration');await restarted.pending;
});
test('description changes apply to cached rows without running collectors',async()=>{
 const config=defaults();config.items=config.items.slice(0,1);let text='挂载云盘',calls=0;
 const engine=new Engine({get:async()=>config},{},async()=>{calls++;return {error:'offline'};},{descriptions:{get:async()=>({descriptions:{[config.items[0].id]:text}})}});
 await engine.status();assert.equal((await engine.snapshot()).items.find(i=>i.id===config.items[0].id).description,text);
 text='自动恢复云盘挂载';assert.equal((await engine.snapshot()).items.find(i=>i.id===config.items[0].id).description,text);assert.equal(calls,1);
});
test('background refresh failure preserves timestamp and reports stale cache',async()=>{
 const config=defaults();config.items=config.items.slice(0,1);const engine=new Engine({get:async()=>config},{},async()=>({error:'offline'}));
 await engine.status();const previous=engine.cache.value.collectedAt;engine.cache.time=0;engine.sample=async()=>{throw Error('source unavailable');};
 await engine.snapshot();await engine.pending?.catch(()=>{});
 const value=await engine.snapshot();assert.equal(value.collectedAt,previous);assert.equal(value.cacheStale,true);assert.equal(value.refreshing,false);assert.match(value.refreshError,/source unavailable/);
});
test('observed changes survive restart, record recovery once and exclude first observations',async()=>{
 const config=defaults();config.items=config.items.slice(0,1);
 const path=join(tmpdir(),`watchdog-changes-${randomUUID()}`,'snapshot.json');let result=0;
 const collector=async()=>({result,lastRun:new Date().toISOString(),verified:true});
 const options={snapshotPath:path};const engine=new Engine({get:async()=>config},{},collector,options);
 await engine.status();assert.equal((await engine.snapshot()).changes.length,0);
 result=1;await engine.snapshot({force:true});await engine.pending;assert.equal((await engine.snapshot()).changes[0].kind,'failed');
 result=0;const restarted=new Engine({get:async()=>config},{},collector,options);
 const cached=await restarted.snapshot();assert.equal(cached.changes.length,1);await restarted.pending;
 const recovered=await restarted.snapshot();assert.equal(recovered.changes.length,2);assert.equal(recovered.changes[0].kind,'recovered');
 await restarted.snapshot({force:true});await restarted.pending;assert.equal((await restarted.snapshot()).changes.length,2);
});
