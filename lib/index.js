import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {Registry,kinds} from './registry.js';
import {Engine} from './engine.js';
import {DescriptionStore} from './descriptions.js';
export const name='watchdog-workspace';
export const inject=['webServer','connection'];
export function createHandler(registry,engine,connection,descriptions){
  return async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
    try{
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(403,{error:'仅允许本机访问'});
      if(typeof connection?.requestRejection!=='function')return send(503,{error:'DSH 请求鉴权不可用'});
      const rejection=connection.requestRejection(req);if(rejection!==undefined)return send([401,403].includes(rejection)?rejection:503,{error:'DSH 请求鉴权拒绝'});
      const url=new URL(req.url,'http://localhost');const path=url.pathname.replace(/^\/watchdog\/api/,'');
      if(req.method==='GET'&&path==='/registry')return send(200,await registry.get());
      if(req.method==='GET'&&path==='/schema')return send(200,{version:1,kinds,methods:{registry:'GET/PUT /watchdog/api/registry',status:'GET /watchdog/api/status',snapshot:'GET /watchdog/api/snapshot (cached immediately; force=1 starts refresh)',descriptions:'GET/PATCH /watchdog/api/descriptions',log:'GET /watchdog/api/log?id=ID'},readOnlyMonitoring:true,descriptionUpdate:{method:'PATCH',path:'/watchdog/api/descriptions',maxLength:160,displayNameMaxLength:60,optionalFields:['description','displayName'],maxUpdates:500,example:{revision:0,updates:[{id:'pc-1',description:'恢复云盘挂载',displayName:'云盘挂载守护'}]},conflictStatus:409},probeAccept:{type:'array',items:'integer 100–599',minItems:1,requires:'probeUrl',example:[200,401,302],omitted:'2xx; redirects rejected'},expected_interval:'seconds or null',stale_after:'seconds or null',revision:'GET 后原样传回；冲突拒绝写入',credentials:'仅 host 的 OpenSSH 配置；注册表不接受密钥或密码'});
      if(req.method==='GET'&&path==='/status')return send(200,await engine.status());
      if(req.method==='GET'&&path==='/snapshot')return send(200,await engine.snapshot({force:url.searchParams.get('force')==='1'}));
      if(req.method==='GET'&&path==='/descriptions')return send(200,{...await descriptions.get(),items:await engine.descriptionCatalog()});
      if(req.method==='GET'&&path==='/log')return send(200,await engine.log(url.searchParams.get('id')));
      if((req.method==='PUT'&&path==='/registry')||(req.method==='PATCH'&&path==='/descriptions')){
        if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{error:'要求 application/json'});
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>262144)return send(413,{error:'注册表超过 256KB'});chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(path==='/descriptions'){
          const items=await engine.descriptionCatalog();
          return send(200,await descriptions.patch(body,new Set(items.map(i=>i.id))));
        }
        const data=await registry.put(body);engine.invalidate();return send(200,data);
      }
      return send(404,{error:'接口不存在'});
    }catch(e){send(/revision|冲突/.test(e.message)?409:400,{error:e.message});}
  };
}
export function apply(ctx){
  const registry=new Registry(process.env.DSH_WATCHDOG_REGISTRY||join(homedir(),'.dsh','watchdog-workspace','registry.json'));
  const services={};
  // Optional service is accessed only inside an injected child context.
  ctx.plugin({name:'watchdog-schedule-reader',inject:['schedule'],apply(inner){inner.effect(()=>{try{services.schedule=inner.schedule;}catch{}return ()=>{services.schedule=undefined;};});}});
  let connection;try{connection=ctx.connection;}catch{}
  const descriptions=new DescriptionStore(join(dirname(registry.path),'descriptions.json'));
  const engine=new Engine(registry,services,undefined,{snapshotPath:join(dirname(registry.path),'snapshot.json'),descriptions});
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/watchdog/api',handler:createHandler(registry,engine,connection,descriptions)}));
}
