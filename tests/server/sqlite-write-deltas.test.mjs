import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emptyState,uid,changeEntry} from '../../finance.js';
import {SqliteStore} from '../../server/sqlite-store.mjs';

test('SQLite writes only changed/new/removed rows and preserves order, replay and transaction rollback',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-write-deltas-')),store=new SqliteStore(path.join(directory,'ledger.sqlite'));
 try{
  await store.start();await store.createProject('Write delta fixture');let state=emptyState();state.rev=1;state.bills=[{id:'bill_first',total:12345,title:'First'},{id:'bill_second',total:67890,title:'Second'}];state.audit=[{id:'audit_first',type:'create',description:'Original log'}];
  await store.commit({expectedRev:0,state,key:uid()});
  store.db.exec(`CREATE TEMP TABLE record_writes(action TEXT,kind TEXT,id TEXT);
   CREATE TEMP TRIGGER record_insert AFTER INSERT ON records BEGIN INSERT INTO record_writes VALUES('insert',NEW.kind,NEW.record_id); END;
   CREATE TEMP TRIGGER record_update AFTER UPDATE ON records BEGIN INSERT INTO record_writes VALUES('update',NEW.kind,NEW.record_id); END;
   CREATE TEMP TRIGGER record_delete AFTER DELETE ON records BEGIN INSERT INTO record_writes VALUES('delete',OLD.kind,OLD.record_id); END;`);
  const writes=()=>store.db.prepare('SELECT action,kind,id FROM record_writes').all().map(row=>({...row}));
  state.rev=2;state.project.name='Renamed project';await store.commit({expectedRev:1,state,key:uid()});assert.deepEqual(writes(),[]);
  state=structuredClone(state);state.rev=3;state.entries=[{id:'note_new',kind:'note',title:'Site visit'}];const request={expectedRev:2,state,key:uid()};
  assert.deepEqual(await store.commit(request),{ok:true,rev:3});assert.deepEqual(writes(),[{action:'insert',kind:'entries',id:'note_new'}]);
  store.db.exec('DELETE FROM record_writes');assert.deepEqual(await store.commit(request),{ok:true,rev:3});assert.deepEqual(writes(),[]);
  state=structuredClone(state);changeEntry(state,'bill','bill_first');state.rev=4;await store.commit({expectedRev:3,state,key:uid()});
  assert.deepEqual(writes().map(row=>[row.action,row.kind,row.id===state.audit.at(-1).id?'deletion_audit':row.id]),[['delete','bills','bill_first'],['update','bills','bill_second'],['insert','audit','deletion_audit']]);
  const saved=await store.read();assert.equal(saved.bills[0].id,'bill_second');assert.equal(saved.bills[0].total,67890);assert.deepEqual(saved.audit[0],{id:'audit_first',type:'create',description:'Original log'});
  store.db.exec("DELETE FROM record_writes; CREATE TEMP TRIGGER reject_note BEFORE INSERT ON records WHEN NEW.record_id='note_fail' BEGIN SELECT RAISE(ABORT,'injected record failure'); END;");
  const failed=structuredClone(saved);failed.rev=5;failed.bills.push({id:'bill_rollback',title:'Must roll back',total:100});failed.entries.push({id:'note_fail',kind:'note',title:'Fail transaction'});
  await assert.rejects(()=>store.commit({expectedRev:4,state:failed,key:uid()}),/injected record failure/);assert.deepEqual(await store.read(),saved);assert.deepEqual(writes(),[]);
  await store.close();await store.start();assert.deepEqual(await store.read(),saved);
 }finally{await store.close();await rm(directory,{recursive:true,force:true})}
});
