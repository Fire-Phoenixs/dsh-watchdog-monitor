import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHandler,apply} from '../lib/index.js';
import {DescriptionStore} from '../lib/descriptions.js';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
async function call(connection,{method='GET',path='/schema',ip='127.0.0.1',body='',headers={}}={}){
 const req=Readable.from([Buffer.from(body)]);Object.assign(req,{method,url:'/watchdog/api'+path,socket:{remoteAddress:ip},headers});let code,result;
 await createHandler({get:async()=>({revision:0})},{status:async()=>({counts:{UNKNOWN:1}})},connection)(req,{writeHead:c=>code=c,end:b=>result=JSON.parse(b)});return {code,result};
}
test('API fails closed without auth and on nonlocal/unauthenticated callers',async()=>{
 assert.equal((await call(undefined)).code,503);assert.equal((await call({requestRejection:()=>401})).code,401);assert.equal((await call({requestRejection:()=>undefined},{ip:'192.168.1.9'})).code,403);
});
test('API discovery and read operations require valid DSH authentication',async()=>{
 assert.equal((await call({requestRejection:()=>undefined})).result.readOnlyMonitoring,true);
 assert.equal((await call({requestRejection:()=>undefined},{path:'/status'})).result.counts.UNKNOWN,1);
 assert.equal((await call({requestRejection:()=>undefined},{method:'POST',path:'/start'})).code,404);
});
test('host registers existing webServer route without optional schedule service',()=>{
 let registered;apply({plugin:p=>assert.deepEqual(p.inject,['schedule']),connection:{},effect:fn=>fn(),webServer:{register:r=>{registered=r;return ()=>{};}}});assert.equal(registered.path,'/watchdog/api');
});
test('description API updates only supplied IDs, rejects stale revision, and exposes snapshot state',async()=>{
 const store=new DescriptionStore(join(tmpdir(),`watchdog-api-${randomUUID()}`,'descriptions.json'));
 const engine={descriptionCatalog:async()=>[{id:'pc-1',name:'CloudDriveWatchdog',description:'守护云盘挂载状态。'},{id:'dsh:task-1',name:'Schedule',description:''}],snapshot:async({force})=>({items:[],refreshing:force,cacheStale:true,collectedAt:null})};
 const handler=createHandler({},engine,{requestRejection:()=>undefined},store);
 async function request(method,path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:'/watchdog/api'+path,socket:{remoteAddress:'127.0.0.1'},headers:{'content-type':'application/json'}});let status,result;await handler(req,{writeHead:c=>status=c,end:b=>result=JSON.parse(b)});return {status,result};}
 const initial=await request('GET','/descriptions');assert.equal(initial.result.revision,0);assert.equal(initial.result.items.length,2);
 const updated=await request('PATCH','/descriptions',{revision:0,updates:[{id:'pc-1',description:'恢复云盘挂载'},{id:'dsh:task-1',description:'每日巡检'}]});assert.equal(updated.status,200);
 const cleared=await request('PATCH','/descriptions',{revision:1,updates:[{id:'pc-1',description:''}]});assert.equal(cleared.result.descriptions['pc-1'],'');assert.equal(cleared.result.descriptions['dsh:task-1'],'每日巡检');
 assert.equal((await request('PATCH','/descriptions',{revision:1,updates:[]})).status,409);
 assert.equal((await request('PATCH','/descriptions',{revision:2,updates:[{id:'missing',description:'x'}]})).status,400);
 const renamed=await request('PATCH','/descriptions',{revision:2,updates:[{id:'pc-1',displayName:'云盘挂载守护'}]});assert.equal(renamed.status,200);assert.equal(renamed.result.displayNames['pc-1'],'云盘挂载守护');assert.equal(renamed.result.descriptions['dsh:task-1'],'每日巡检');
 const snapshot=await request('GET','/snapshot?force=1');assert.equal(snapshot.status,200);assert.equal(snapshot.result.refreshing,true);
});
