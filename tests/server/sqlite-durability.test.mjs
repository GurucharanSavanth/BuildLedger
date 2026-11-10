import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {sha256} from '../../server/core.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteStore} from '../../server/sqlite-store.mjs';

async function fixture(run){
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-durability-')),filename=path.join(directory,'ledger.sqlite'),store=new SqliteStore(filename);
 try{await store.start();const project=await store.createProject('Durable ledger');await run(store,project,filename)}
 finally{await store.close();await rm(directory,{recursive:true,force:true})}
}

for(const version of [3,0,'invalid'])test(`SQLite rejects unsupported schema ${version} without changing database bytes`,()=>fixture(async(store,project,filename)=>{
 store.db.prepare('UPDATE schema_info SET version=?').run(version);await store.close();
 const before=await readFile(filename);
 await assert.rejects(()=>store.start(),/schema version/i);
 assert.equal(store.db,null,'Failed startup must release the database');
 assert.deepEqual(await readFile(filename),before);
 const db=new DatabaseSync(filename);try{assert.equal(db.prepare('SELECT version FROM schema_info').get().version,version);assert.equal(db.prepare('SELECT id FROM projects').get().id,project.id)}finally{db.close()}
}));

test('SQLite refuses a missing current-schema table instead of creating an empty replacement',()=>fixture(async(store,project,filename)=>{
 store.db.exec('DROP TABLE assets');await store.close();const before=await readFile(filename);
 await assert.rejects(()=>store.start(),/schema.*incomplete/i);
 assert.equal(store.db,null);assert.deepEqual(await readFile(filename),before);
}));

test('SQLite full database rolls back records, revision and replay receipt; retry succeeds after capacity returns',()=>fixture(async(store,project)=>{
 const before=await store.read(project.id),state=structuredClone(before);state.rev=1;
 state.bills=[{id:'durable-bill',total:12345,title:'Exact invoice'}];
 state.audit=[{id:'durable-audit',type:'import',description:'x'.repeat(100000)}];
 const request={projectId:project.id,expectedRev:0,state,key:'durable-request'};
 const pages=store.db.prepare('PRAGMA page_count').get().page_count;
 store.db.exec(`PRAGMA max_page_count=${pages}`);
 await assert.rejects(()=>store.commit(request),/database or disk is full/i);
 assert.deepEqual(await store.read(project.id),before);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM operations').get().n,0);
 store.db.exec('PRAGMA max_page_count=100000');
 assert.deepEqual(await store.commit(request),{ok:true,rev:1});
 assert.deepEqual(await store.commit(request),{ok:true,rev:1});
 await store.close();await store.start();
 assert.equal((await store.read(project.id)).bills[0].total,12345);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM operations').get().n,1);
 assert.equal(await store.health(),true);
}));

test('SQLite competing writer cannot partially post; retry preserves exact paise',()=>fixture(async(store,project,filename)=>{
 const other=new SqliteStore(filename);await other.start();
 try{
  assert.equal(store.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  assert.equal(store.db.prepare('PRAGMA synchronous').get().synchronous,2);
  store.db.exec('PRAGMA busy_timeout=1');other.db.exec('BEGIN IMMEDIATE');
  const state=await store.read(project.id);state.rev=1;state.payments=[{id:'cash-payment',amount:4321}];
  const request={projectId:project.id,expectedRev:0,state,key:'busy-request'};
  await assert.rejects(()=>store.commit(request),/locked/i);
  assert.equal((await store.read(project.id)).payments.length,0);
  other.db.exec('ROLLBACK');await store.commit(request);
  assert.equal((await other.read(project.id)).payments[0].amount,4321);
 }finally{try{other.db.exec('ROLLBACK')}catch{}await other.close()}
}));

test('SQLite abrupt writer termination preserves committed records and rolls back uncommitted changes',()=>fixture(async(store,project,filename)=>{
 const state=await store.read(project.id);state.rev=1;state.bills=[{id:'crash-bill',total:12345,title:'Committed'}];
 await store.commit({projectId:project.id,expectedRev:0,state,key:'crash-request'});await store.close();
 const child=spawn(process.execPath,['--input-type=module','-e',`
  import {SqliteStore} from ${JSON.stringify(new URL('../../server/sqlite-store.mjs',import.meta.url).href)};
  const store=new SqliteStore(process.argv[1]);await store.start();
  store.db.exec('BEGIN IMMEDIATE');
  store.db.prepare('UPDATE projects SET rev=999 WHERE id=?').run(process.argv[2]);
  store.db.prepare('DELETE FROM records WHERE project_id=?').run(process.argv[2]);
  process.send('uncommitted');setInterval(()=>{},1000);
 `,filename,project.id],{stdio:['ignore','ignore','pipe','ipc']});
 const exited=once(child,'exit');let stderr='';child.stderr.on('data',data=>stderr+=data);
 try{
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);
  try{assert.equal((await once(child,'message',{signal:abort.signal}))[0],'uncommitted',stderr)}finally{clearTimeout(timeout)}
  assert.equal(child.kill('SIGKILL'),true);await exited;
  await store.start();assert.deepEqual(await store.read(project.id),state);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM operations').get().n,1);
  assert.equal(await store.health(),true);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
}));

test('SQLite online backup captures committed WAL records, original bytes and replay receipts independently',()=>fixture(async(store,project,filename)=>{
 store.db.exec('PRAGMA wal_autocheckpoint=0');
 const bytes=Buffer.from([0,1,255,65,0]),meta={id:'backup-original',name:'original.bin',type:'application/octet-stream',size:5,sha256:sha256(bytes)};
 const upload=await store.startUpload(meta,project.id);await store.putChunk(upload.uploadId,0,bytes);await store.finishUpload(upload.uploadId);
 const state=await store.read(project.id);state.rev=1;state.bills=[{id:'backup-bill',total:12345,title:'Backed up'}];state.files=[meta];
 const request={projectId:project.id,expectedRev:0,state,newFiles:[{id:meta.id,uploadId:upload.uploadId}],key:'backup-request'};
 await store.commit(request);
 assert.ok((await readFile(filename+'-wal')).length>0);
 const snapshotPath=path.join(path.dirname(filename),'snapshot.sqlite');await backup(store.db,snapshotPath);
 await store.deleteProject(project.id,1);
 const restored=new SqliteStore(snapshotPath);
 try{
  await restored.start();assert.deepEqual(await restored.read(project.id),state);
  const chunks=[];for await(const chunk of restored.fileStream(meta.id,project.id))chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),Buffer.from([0,1,255,65,0]));
  assert.deepEqual(await restored.commit(request),{ok:true,rev:1});
  assert.equal(restored.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal((await restored.read(project.id)).bills[0].total,12345);
 }finally{await restored.close()}
}));
