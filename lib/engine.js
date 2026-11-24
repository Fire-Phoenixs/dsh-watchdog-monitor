import {collect,collectLog} from './collectors.js';
import {evaluate} from './health.js';
import {collectSchedules,scheduleLogs} from './schedule.js';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {defaultDescription} from './descriptions.js';
import {friendlyName,unknownCategory} from './presentation.js';
import {recordChanges} from './changes.js';
const fingerprint=config=>createHash('sha256').update(JSON.stringify(config)).digest('hex');
export async function deadline(fn,ms=5000){const controller=new AbortController();let timer;try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('采集超过 5 秒'));},ms);})]);}finally{clearTimeout(timer);}}
export class Engine {
  constructor(registry,ctx,collector=collect,options={}){this.registry=registry;this.ctx=ctx;this.collector=collector;this.generation=0;this.snapshotPath=options.snapshotPath;this.descriptions=options.descriptions;}
  invalidate(){this.generation++;this.changeLog=this.cache?.value.changes||this.changeLog||[];this.cache=null;this.retryAfter=0;}
  async status(){
    if(this.cache&&Date.now()-this.cache.time<60000)return this.cache.value;
    return this.refresh(await this.registry.get());
  }
  async hydrate(config){
    if(!this.loaded){this.loaded=(async()=>{
      if(this.cache||this.pending)return;
      if(!this.snapshotPath)return;
      try{
        const saved=JSON.parse(await readFile(this.snapshotPath,'utf8'));
        if(saved.version===1&&Array.isArray(saved.value?.changes))this.changeLog=saved.value.changes.slice(0,100);
        if(saved.version===1&&saved.configKey===fingerprint(config)&&Array.isArray(saved.value?.items)&&Array.isArray(saved.value?.hosts)&&Number.isFinite(Date.parse(saved.value?.collectedAt))){
          this.cache={time:0,value:saved.value};this.configKey=saved.configKey;
        }
      }catch(e){if(e.code!=='ENOENT')this.snapshotWarning='上次缓存无法读取，正在重新采集';}
    })();}await this.loaded;
  }
  async refresh(config){
    if(this.pending)return this.pending;
    const generation=this.generation, startedAt=Date.now();
    this.pending=this.sample(config).then(async value=>{
      if(generation===this.generation){
        value.changes=recordChanges(this.cache?.value,value,this.cache?.value.changes||this.changeLog||[]);this.changeLog=value.changes;
        this.cache={time:startedAt,value};this.refreshError=null;this.retryAfter=0;this.configKey=fingerprint(config);
        if(this.snapshotPath){try{
          await mkdir(dirname(this.snapshotPath),{recursive:true});const temp=`${this.snapshotPath}.${randomUUID()}.tmp`;
          await writeFile(temp,JSON.stringify({version:1,configKey:this.configKey,value}),'utf8');await rename(temp,this.snapshotPath);this.snapshotWarning=null;
        }catch{this.snapshotWarning='本次结果未能写入本地缓存';}}
      }return value;
    }).catch(e=>{this.refreshError=e.message;this.retryAfter=Date.now()+60000;throw e;}).finally(()=>{this.pending=null;});return this.pending;
  }
  async annotate(value){
    let descriptions={},displayNames={};let descriptionError;
    try{const metadata=await this.descriptions?.get();descriptions=metadata?.descriptions||{};displayNames=metadata?.displayNames||{};}catch{descriptionError='任务简介暂时无法读取';}
    const row=item=>({...item,displayName:friendlyName({...item,displayName:displayNames[item.id]}),unknownCategory:unknownCategory(item),description:Object.hasOwn(descriptions,item.id)?descriptions[item.id]:defaultDescription(item)});
    const items=value.items.map(row),history=(value.history||[]).map(row);
    const names=new Map([...items,...history].map(i=>[i.id,i.displayName]));
    return {...value,items,history,changes:(value.changes||[]).map(c=>({...c,displayName:names.get(c.itemId)||c.name})),...(descriptionError?{descriptionError}:{} )};
  }
  async snapshot({force=false}={}){
    const config=await this.registry.get();await this.hydrate(config);
    const key=fingerprint(config);if(this.configKey&&this.configKey!==key)this.invalidate();this.configKey=key;
    const stale=!this.cache||Date.now()-this.cache.time>=60000;
    if((force||stale)&&!this.pending&&(force||Date.now()>=(this.retryAfter||0)))void this.refresh(config).catch(()=>{});
    const value=this.cache?.value||{
      collectedAt:null,hosts:config.hosts.map(({id,name,kind})=>({id,name,kind})),history:[],changes:this.changeLog||[],
      items:config.items.filter(i=>i.enabled!==false).map(i=>({...i,status:'UNKNOWN',reason:'等待首次采集',evidence:{}}))
    };
    const counts={OK:0,STALE:0,FAIL:0,UNKNOWN:0};for(const item of value.items)counts[item.status]++;
    return this.annotate({...value,counts,refreshing:!!this.pending,cacheStale:stale,refreshError:this.refreshError||undefined,cacheWarning:this.snapshotWarning||undefined});
  }
  async descriptionCatalog(){
    const config=await this.registry.get();const host=config.hosts.find(h=>h.kind==='dsh');let schedules;
    try{schedules=await deadline(()=>collectSchedules(this.ctx,host.id));}catch{ schedules={items:this.cache?.value.items.filter(i=>i.kind==='dsh-schedule')||[],history:this.cache?.value.history||[]}; }
    const data=await this.annotate({items:[...config.items,...schedules.items],history:schedules.history});
    return [...data.items,...data.history].map(({id,name,displayName,hostId,description})=>({id,name,displayName,hostId,description}));
  }
  async sample(config){
    config??=await this.registry.get();
    const items=[];let index=0;
    const enabled=config.items.filter(i=>i.enabled!==false);
    // Bound concurrency; a failing source never removes its registered rows.
    const worker=async()=>{while(index<enabled.length){const item=enabled[index++];const host=config.hosts.find(h=>h.id===item.hostId);let evidence;
      try{evidence=await deadline(signal=>this.collector(item,host,{signal}));}catch(e){evidence={error:e.message,collectedAt:new Date().toISOString()};}
      items.push({...item,...evaluate(item,evidence),evidence});
    }};
    const scheduleHost=config.hosts.find(h=>h.kind==='dsh');
    const schedulePromise=deadline(()=>collectSchedules(this.ctx,scheduleHost.id)).catch(e=>({items:[{id:'dsh-unavailable',name:'DSH 调度服务',hostId:scheduleHost.id,expected_interval:null,status:'UNKNOWN',reason:e.message}],history:[]}));
    await Promise.all(Array.from({length:4},worker));const schedule=await schedulePromise;
    items.push(...schedule.items);
    const rank={FAIL:0,STALE:1,UNKNOWN:2,OK:3};items.sort((a,b)=>rank[a.status]-rank[b.status]||a.name.localeCompare(b.name));
    const counts={OK:0,STALE:0,FAIL:0,UNKNOWN:0};for(const item of items)counts[item.status]++;
    return {collectedAt:new Date().toISOString(),items,counts,hosts:config.hosts.map(({id,name,kind})=>({id,name,kind})),history:schedule.history};
  }
  async log(id){if(typeof id==='string'&&id.startsWith('dsh:'))return {text:await deadline(()=>scheduleLogs(this.ctx,id))};const data=await this.registry.get();const item=data.items.find(i=>i.id===id);if(!item)return {text:'此条目没有已注册的日志来源。'};return deadline(signal=>collectLog(item,data.hosts.find(h=>h.id===item.hostId),{signal}));}
}
