import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../lib/defaults.js';
import {validate,Registry} from '../lib/registry.js';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
test('initial registry covers 20+ entries and three groups',()=>{const d=validate(defaults());assert.ok(d.items.length>20);assert.equal(d.hosts.length,3);});
test('reject credentials, arbitrary commands, duplicate IDs and wrong adapters',()=>{
 for(const change of [d=>d.hosts[1].password='secret',d=>d.items[0].command='exit 1',d=>d.items.push(d.items[0]),d=>d.hosts[1].sshTarget='-oProxyCommand=bad',d=>d.items[0].hostId='server']){const d=defaults();change(d);assert.throws(()=>validate(d));}
});
test('persist registration across instances and reject concurrent stale edits',async()=>{
 const path=join(tmpdir(),`watchdog-test-${randomUUID()}`,'registry.json');const r=new Registry(path);const d=await r.get();d.hosts.push({id:'other',name:'另一个项目',kind:'windows'});const saved=await r.put(d);assert.equal(saved.revision,1);assert.deepEqual(await new Registry(path).get(),saved);await assert.rejects(r.put(d),/revision/);
});
