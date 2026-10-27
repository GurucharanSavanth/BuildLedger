import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emptyState,uid} from '../../finance.js';
import {SqliteStore} from '../../server/sqlite-store.mjs';
import {createHttpApp} from '../../server/http.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function temporaryStore(){const directory=await mkdtemp(path.join(tmpdir(),'buildledger-projects-')),filename=path.join(directory,'ledger.sqlite'),store=new SqliteStore(filename);await store.start();return {directory,filename,store}}

test('SQLite restore preserves unknown historical instalment and payment recipients',async()=>{
 const {directory,store}=await temporaryStore();try{
  const project=await store.createProject('Legacy unknown recipients'),state=await store.read(project.id);state.rev=1;
  state.contracts=[{id:'legacy-contract',vendor:'Known supplier',amount:12345}];
  state.plans=[{id:'legacy-plan',vendor:'',contractId:'legacy-contract',amount:12345,due:'2026-10-26'}];
  state.payments=[{id:'legacy-payment',planId:'legacy-plan',amount:2345,date:'2026-10-25'}];
  await store.commit({projectId:project.id,expectedRev:0,state,replace:true,key:uid()});
  assert.deepEqual(await store.read(project.id),state);assert.equal((await store.read(project.id)).plans[0].vendor,'');
  const conflict=structuredClone(state);conflict.rev=2;conflict.payments[0].vendor='Wrong known supplier';
  await assert.rejects(()=>store.commit({projectId:project.id,expectedRev:1,state:conflict,replace:true,key:uid()}),/differs from linked instalment/);
  assert.deepEqual(await store.read(project.id),state);
 }finally{await store.close();await rm(directory,{recursive:true,force:true})}
});

test('SQLite projects isolate records and same-named file IDs and delete data atomically without recreating the last project',async()=>{
 const {directory,store}=await temporaryStore();
 try{
  assert.deepEqual(await store.listProjects(),[]);
  const first=await store.createProject('North wing'),second=await store.createProject('North wing');assert.notEqual(first.id,second.id);
  const originalA=Buffer.from([0,1,2,255,65]),originalB=Buffer.from('different original bytes'),fileId='shared_file_001';
  for(const [project,bytes,description] of [[first,originalA,'First project audit'],[second,originalB,'Second project audit']]){
   const state=await store.read(project.id),meta={id:fileId,name:'same name.bin',size:bytes.length,sha256:digest(bytes),type:'application/octet-stream'};
   state.audit.push({id:uid(),type:'fixture',description,linked:'',at:'2026-10-24T10:00:00.000Z'});state.files=[meta];state.rev++;
   const upload=await store.startUpload(meta,project.id);await store.putChunk(upload.uploadId,0,bytes);await store.finishUpload(upload.uploadId);
   await store.commit({projectId:project.id,expectedRev:0,state,newFiles:[{id:fileId,uploadId:upload.uploadId}],key:uid()});
  }
  assert.equal((await store.read(first.id)).audit[0].description,'First project audit');
  assert.equal((await store.read(second.id)).audit[0].description,'Second project audit');
  assert.deepEqual(Buffer.concat([...(await (async()=>{const chunks=[];for await(const chunk of store.fileStream(fileId,first.id))chunks.push(chunk);return chunks})())]),originalA);
  assert.deepEqual(Buffer.concat([...(await (async()=>{const chunks=[];for await(const chunk of store.fileStream(fileId,second.id))chunks.push(chunk);return chunks})())]),originalB);
  assert.deepEqual(await store.projectDeletionSummary(first.id),{projectId:first.id,projectName:'North wing',recordCount:1,attachmentCount:1,attachmentBytes:originalA.length,rev:1});
  const deleted=await store.deleteProject(first.id);assert.equal(deleted.attachmentBytes,originalA.length);
  assert.deepEqual((await store.listProjects()).map(p=>p.id),[second.id]);
  assert.equal((await store.read(second.id)).files.length,1);
  const remaining=[];for await(const chunk of store.fileStream(fileId,second.id))remaining.push(chunk);assert.deepEqual(Buffer.concat(remaining),originalB);
  await store.deleteProject(second.id);assert.deepEqual(await store.listProjects(),[]);
  await store.close();await store.start();assert.deepEqual(await store.listProjects(),[]);
 }finally{await store.close();await rm(directory,{recursive:true,force:true})}
});

test('SQLite migration moves the legacy project, records, file metadata, and original chunks into one stable project',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-project-migration-')),filename=path.join(directory,'legacy.sqlite'),legacy=new DatabaseSync(filename),bytes=Buffer.from('legacy original\0bytes'),fileId='legacy_file_001',uploadId='legacy-upload-id',state=emptyState();
 state.project.name='Renovation 2024';state.rev=1;state.audit=[{id:'legacy_audit_01',type:'import',description:'Preserved evidence',linked:'',at:'2024-01-01T10:00:00.000Z'}];state.files=[{id:fileId,name:'duplicate name.pdf',type:'application/pdf',size:bytes.length,sha256:digest(bytes),importedAt:'2024-01-01T10:00:00.000Z'}];
 try{
  legacy.exec(`CREATE TABLE project(id INTEGER PRIMARY KEY CHECK(id=1),rev INTEGER NOT NULL,schema_version INTEGER NOT NULL,project_json TEXT NOT NULL,settings_json TEXT NOT NULL);
   CREATE TABLE records(kind TEXT NOT NULL,record_id TEXT NOT NULL,position INTEGER NOT NULL,event_date TEXT,counterparty TEXT,doc_json TEXT NOT NULL,PRIMARY KEY(kind,record_id));
   CREATE TABLE uploads(id TEXT PRIMARY KEY,file_id TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,filename TEXT NOT NULL,chunks INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
   CREATE TABLE file_chunks(upload_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_sha256 TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(upload_id,chunk_index));
   CREATE TABLE assets(file_id TEXT PRIMARY KEY,upload_id TEXT UNIQUE NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE operations(idempotency_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,response_json TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE schema_info(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);INSERT INTO schema_info VALUES(1,1);`);
  legacy.prepare('INSERT INTO project VALUES(1,?,?,?,?)').run(state.rev,state.schema,JSON.stringify(state.project),JSON.stringify(state.settings));
  legacy.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('audit',state.audit[0].id,0,'2024-01-01','',JSON.stringify(state.audit[0]));
  legacy.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('files',fileId,0,'2024-01-01','duplicate name.pdf',JSON.stringify(state.files[0]));
  legacy.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?)').run(uploadId,fileId,bytes.length,digest(bytes),'application/pdf','duplicate name.pdf',1,1,1);
  legacy.prepare('INSERT INTO file_chunks VALUES(?,?,?,?)').run(uploadId,0,digest(bytes),bytes);
  legacy.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(fileId,uploadId,'duplicate name.pdf','application/pdf',bytes.length,digest(bytes),1);legacy.close();
  const store=new SqliteStore(filename);try{
   await store.start();const projects=await store.listProjects();assert.equal(projects.length,1);assert.equal(projects[0].id,'legacy-project');assert.equal(projects[0].name,'Renovation 2024');
   const migrated=await store.read('legacy-project');assert.equal(migrated.project.name,'Renovation 2024');assert.equal(migrated.audit[0].description,'Preserved evidence');assert.deepEqual(migrated.files,state.files);
   const chunks=[];for await(const chunk of store.fileStream(fileId,'legacy-project'))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);
   await store.close();await store.start();assert.deepEqual(await store.listProjects(),projects);assert.deepEqual((await store.read('legacy-project')).files,state.files);
  }finally{await store.close()}
 }finally{try{legacy.close()}catch{}await rm(directory,{recursive:true,force:true})}
});

test('SQLite HTTP project routes expose scoped project CRUD',async()=>{
 const {directory,store}=await temporaryStore(),server=createHttpApp({store,authMode:'local'});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  let response=await fetch(base+'/api/v1/projects');assert.deepEqual((await response.json()).items,[]);
  response=await fetch(base+'/api/v1/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Cottage'})});assert.equal(response.status,201);const project=await response.json();
  response=await fetch(base+`/api/v1/state?projectId=${project.id}`);assert.equal((await response.json()).project.name,'Cottage');
  response=await fetch(base+`/api/v1/projects/${project.id}/summary`);assert.deepEqual(await response.json(),{projectId:project.id,projectName:'Cottage',recordCount:0,attachmentCount:0,attachmentBytes:0,rev:0});
  response=await fetch(base+`/api/v1/projects/${project.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Cottage II',budget:12345,expectedRev:0})});assert.equal((await response.json()).name,'Cottage II');
  response=await fetch(base+`/api/v1/projects/${project.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Stale name',budget:99,expectedRev:0})});assert.equal(response.status,409);
  assert.equal((await store.read(project.id)).project.budget,12345);assert.equal((await store.read(project.id)).audit.length,1);
  response=await fetch(base+`/api/v1/projects/${project.id}`,{method:'DELETE'});assert.equal((await response.json()).projectName,'Cottage II');assert.deepEqual((await (await fetch(base+'/api/v1/projects')).json()).items,[]);
 }finally{await new Promise(resolve=>server.close(resolve));await store.close();await rm(directory,{recursive:true,force:true})}
});
