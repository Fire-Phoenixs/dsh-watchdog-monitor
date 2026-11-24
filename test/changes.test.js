import test from 'node:test';
import assert from 'node:assert/strict';
import {recordChanges} from '../lib/changes.js';
const row=status=>({id:'one',name:'One',kind:'windows-task',target:'task',hostId:'pc',status,reason:'evidence'});
const snapshot=status=>({items:[row(status)],collectedAt:'2026-11-24T01:00:00Z'});
test('first collection and unchanged state produce no alerts',()=>{
 assert.deepEqual(recordChanges(null,snapshot('FAIL')),[]);
 assert.deepEqual(recordChanges(snapshot('OK'),snapshot('OK')),[]);
});
test('failed, recovered and first verification are distinct observed changes',()=>{
 assert.equal(recordChanges(snapshot('OK'),snapshot('FAIL'))[0].kind,'failed');
 assert.equal(recordChanges(snapshot('FAIL'),snapshot('OK'))[0].kind,'recovered');
 assert.equal(recordChanges(snapshot('UNKNOWN'),snapshot('OK'))[0].kind,'verified');
 assert.equal(recordChanges(snapshot('OK'),snapshot('UNKNOWN'))[0].kind,'unknown');
});
test('configuration identity changes are excluded; history is capped and newest first',()=>{
 const old=snapshot('OK');old.items[0].target='other';assert.deepEqual(recordChanges(old,snapshot('FAIL')),[]);
 const history=Array.from({length:100},(_,i)=>({id:String(i)}));const changes=recordChanges(snapshot('OK'),snapshot('FAIL'),history);
 assert.equal(changes.length,100);assert.equal(changes[0].to,'FAIL');assert.equal(changes[1].id,'0');
});
