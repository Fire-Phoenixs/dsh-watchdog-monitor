import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {probe} from '../lib/http-probe.js';
import {validate} from '../lib/registry.js';
import {defaults} from '../lib/defaults.js';

test('explicit response policies accept auth/redirect statuses without following redirects', async () => {
  let followed=0;
  const server=createServer((req,res)=>{assert.equal(req.method,'HEAD');if(req.url==='/destination')followed++;const status=Number(req.url.slice(1))||200;res.writeHead(status,status===302?{location:'/destination'}:{});res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const code of [200,401,302]){const e=await probe(`${base}/${code}`,undefined,[200,401,302]);assert.equal(e.probeOk,true);assert.equal(e.probeStatus,code);}
    assert.equal(followed,0);
    assert.equal((await probe(`${base}/500`,undefined,[200,401,302])).probeOk,false);
    assert.equal((await probe(`${base}/200`,undefined,[401])).probeOk,false);
    assert.equal((await probe(`${base}/204`)).probeOk,true);
    assert.equal((await probe(`${base}/401`)).probeOk,false);
    await assert.rejects(probe(`${base}/302`));
    const c=new AbortController();c.abort();await assert.rejects(probe(`${base}/200`,c.signal,[200]));
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('registry persists explicit status policy and rejects malformed policies',()=>{
 const d=defaults();d.items[0].probeUrl='http://127.0.0.1/';d.items[0].probeAccept=[200,401,302];assert.deepEqual(validate(d).items[0].probeAccept,[200,401,302]);
 for(const value of [[],null,'200',[99],[600],[200.5],['401']]){d.items[0].probeAccept=value;assert.throws(()=>validate(d),/probeAccept/);}
 d.items[0].probeAccept=[200];delete d.items[0].probeUrl;assert.throws(()=>validate(d),/probeUrl/);
});
