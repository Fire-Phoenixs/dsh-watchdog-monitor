import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaults} from './defaults.js';
import {validateProbeAccept} from './http-probe.js';
export const kinds=['windows-task','windows-process','endpoint','systemd-timer','systemd-service','docker','file-log','certificate'];
const id=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
function fields(value,allowed){ for(const key of Object.keys(value)) if(!allowed.includes(key)) throw new Error(`不支持字段 ${key}`); }
export function validate(data) {
  if(!data || data.version!==1 || !Array.isArray(data.hosts)||!Array.isArray(data.items)||data.hosts.length>50||data.items.length>500) throw new Error('注册表格式无效（最多 50 宿主 / 500 条目）');
  fields(data,['version','revision','hosts','items']);
  const hosts=new Map(); const ids=new Set();
  for(const h of data.hosts){
    fields(h,['id','name','kind','sshTarget']);
    if(!id.test(h.id)||hosts.has(h.id)||typeof h.name!=='string'||!h.name.trim()||!['windows','ssh','dsh'].includes(h.kind)) throw new Error('宿主字段无效或 ID 重复');
    if(h.kind==='ssh'&&!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,200}$/.test(h.sshTarget)) throw new Error('SSH 仅接受已配置别名或 user@host');
    hosts.set(h.id,h);
  }
  if([...hosts.values()].filter(h=>h.kind==='dsh').length!==1) throw new Error('必须保留且仅有一个 DSH 调度宿主');
  for(const i of data.items){
    fields(i,['id','name','hostId','kind','target','expected_interval','stale_after','mode','notes','logPath','probeUrl','probeAccept','enabled']);
    if(!id.test(i.id)||ids.has(i.id)||!hosts.has(i.hostId)||!kinds.includes(i.kind)||typeof i.name!=='string'||!i.name.trim()) throw new Error('条目字段无效或 ID 重复');
    ids.add(i.id);
    for(const key of ['expected_interval','stale_after']) if(i[key]!==null&&!(Number.isFinite(i[key])&&i[key]>0)) throw new Error(`${key} 必须为正数（秒）或 null`);
    for(const key of ['target','notes','logPath','mode','probeUrl']) if(i[key]!==undefined&&(typeof i[key]!=='string'||i[key].length>4096)) throw new Error(`${key} 无效`);
    if(i.enabled!==undefined&&typeof i.enabled!=='boolean') throw new Error('enabled 必须为 boolean');
    validateProbeAccept(i.probeAccept);
    if(i.probeAccept!==undefined&&!i.probeUrl) throw new Error('probeAccept 需要同时配置 probeUrl');
    if(i.probeUrl){ const u=new URL(i.probeUrl); if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new Error('探活仅接受无凭据 HTTP(S) URL'); }
    const host=hosts.get(i.hostId);
    if(host.kind==='dsh') throw new Error('DSH 条目从 schedule 实时读取，不接受手动副本');
    if((i.kind.startsWith('windows-')||i.kind==='endpoint')&&host.kind!=='windows') throw new Error('Windows 采集器必须绑定 Windows 宿主');
    if(['systemd-timer','systemd-service','docker'].includes(i.kind)&&host.kind!=='ssh') throw new Error('Linux 采集器必须绑定 SSH 宿主');
  }
  return structuredClone(data);
}
export class Registry {
  constructor(path){this.path=path;this.queue=Promise.resolve();}
  async get(){try{return validate(JSON.parse(await readFile(this.path,'utf8')));}catch(e){if(e.code==='ENOENT')return defaults();throw e;}}
  put(input){const task=this.queue.then(async()=>{
    const data=validate(input), old=await this.get();
    if(data.revision!==old.revision) throw new Error('配置已变化，请重新读取后编辑（revision 冲突）');
    data.revision=old.revision+1;
    await mkdir(dirname(this.path),{recursive:true});
    const temp=`${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(data,null,2),'utf8');
    await rename(temp,this.path); return data;
  });this.queue=task.catch(()=>{});return task;}
}
