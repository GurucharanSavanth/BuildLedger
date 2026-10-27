import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SqliteStore} from '../../server/sqlite-store.mjs';
import {createHttpApp} from '../../server/http.mjs';
import {sha256,CHUNK_SIZE} from '../../server/core.mjs';
import {uid} from '../../finance.js';

async function fixture(fn,size=CHUNK_SIZE*3+97){
 const dir=await mkdtemp(path.join(tmpdir(),'buildledger-integrity-')),store=new SqliteStore(path.join(dir,'ledger.sqlite'));await store.start();
 const project=await store.createProject('Integrity fixture'),bytes=Buffer.alloc(size);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const id=uid(),meta={id,name:'Multi chunk.bin',type:'application/octet-stream',size:bytes.length,sha256:sha256(bytes)},upload=await store.startUpload(meta,project.id);
 for(let i=0;i<upload.numChunks;i++)await store.putChunk(upload.uploadId,i,bytes.subarray(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));await store.finishUpload(upload.uploadId);
 const state=await store.read(project.id);state.rev++;state.files.push(meta);await store.commit({projectId:project.id,expectedRev:0,state,newFiles:[{id,uploadId:upload.uploadId}],key:uid()});
 const downloadRoot=path.join(dir,'downloads'),tempEnvironment=Object.fromEntries(['TEMP','TMP','TMPDIR'].map(key=>[key,process.env[key]]));await mkdir(downloadRoot);
 for(const key of Object.keys(tempEnvironment))process.env[key]=downloadRoot;
 const server=createHttpApp({store,authMode:'local'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,url=`${base}/api/v1/files/${id}?projectId=${project.id}`;
 try{await fn({store,bytes,id,projectId:project.id,uploadId:upload.uploadId,url,dir})}finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();
  for(const [key,value] of Object.entries(tempEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value}
  await rm(dir,{recursive:true,force:true});
 }
}

test('real HTTP original download verifies the complete multi-chunk document before success',async()=>fixture(async({url,bytes})=>{
 const response=await fetch(url);assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),bytes.length);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
}));

for(const location of [0,1,3])test(`real HTTP original rejects corrupted chunk ${location} before a successful response`,async()=>fixture(async({store,uploadId,url,bytes})=>{
 const corrupt=Buffer.from(bytes.subarray(location*CHUNK_SIZE,(location+1)*CHUNK_SIZE));corrupt[0]^=255;
 store.db.prepare('UPDATE file_chunks SET data=? WHERE upload_id=? AND chunk_index=?').run(corrupt,uploadId,location);
 const response=await fetch(url);assert.equal(response.status,500);assert.match((await response.json()).message,/integrity|chunk/i);
}));

test('real HTTP original rejects truncation and metadata hash mismatch before success',async()=>fixture(async({store,uploadId,url,id,projectId})=>{
 const last=store.db.prepare('SELECT data FROM file_chunks WHERE upload_id=? AND chunk_index=3').get(uploadId).data;
 store.db.prepare('DELETE FROM file_chunks WHERE upload_id=? AND chunk_index=3').run(uploadId);
 let response=await fetch(url);assert.equal(response.status,500);await response.arrayBuffer();
 store.db.prepare('INSERT INTO file_chunks(upload_id,chunk_index,chunk_sha256,data) VALUES(?,?,?,?)').run(uploadId,3,sha256(last),last);
 store.db.prepare('UPDATE assets SET sha256=? WHERE project_id=? AND file_id=?').run('0'.repeat(64),projectId,id);
 response=await fetch(url);assert.equal(response.status,500);await response.arrayBuffer();
}));

test('original stream yields no unverified chunk and cleans staging after interruption',async()=>fixture(async({store,id,projectId,uploadId})=>{
 const existing=new Set((await readdir(tmpdir())).filter(name=>name.startsWith('buildledger-download-'))),stream=store.fileStream(id,projectId);
 assert.equal((await stream.next()).done,false);await stream.return();
 assert.deepEqual((await readdir(tmpdir())).filter(name=>name.startsWith('buildledger-download-')&&!existing.has(name)),[]);
 store.db.prepare('DELETE FROM file_chunks WHERE upload_id=? AND chunk_index=2').run(uploadId);
 await assert.rejects(()=>store.fileStream(id,projectId).next(),/integrity|chunk/i);
 assert.deepEqual((await readdir(tmpdir())).filter(name=>name.startsWith('buildledger-download-')&&!existing.has(name)),[]);
}));

test('real HTTP interrupted transfer cleans its verified snapshot',async()=>fixture(async({url})=>{
 const existing=new Set((await readdir(tmpdir())).filter(name=>name.startsWith('buildledger-download-'))),response=await fetch(url);assert.equal(response.status,200);await response.body.cancel();
 let pending=[];for(let attempt=0;attempt<100;attempt++){
  pending=(await readdir(tmpdir())).filter(name=>name.startsWith('buildledger-download-')&&!existing.has(name));
  if(!pending.length)break;await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.deepEqual(pending,[]);
}));

test('verified snapshot keeps original bytes if the source changes after preflight',async()=>fixture(async({store,id,projectId,uploadId,bytes})=>{
 const stream=store.fileStream(id,projectId),first=await stream.next(),hash=createHash('sha256');let size=first.value.length;hash.update(first.value);
 store.db.prepare('DELETE FROM file_chunks WHERE upload_id=?').run(uploadId);
 for await(const chunk of stream){assert.ok(chunk.length<=CHUNK_SIZE);size+=chunk.length;hash.update(chunk)}
 assert.equal(size,bytes.length);assert.equal(hash.digest('hex'),sha256(bytes));
}));

test('real HTTP original rejects a whole-document hash mismatch even when individual chunk hashes match',async()=>fixture(async({store,uploadId,url,bytes})=>{
 const corrupt=Buffer.from(bytes.subarray(CHUNK_SIZE,CHUNK_SIZE*2));corrupt[0]^=255;
 store.db.prepare('UPDATE file_chunks SET data=?,chunk_sha256=? WHERE upload_id=? AND chunk_index=1').run(corrupt,sha256(corrupt),uploadId);
 const response=await fetch(url);assert.equal(response.status,500);assert.match((await response.json()).message,/integrity/i);
}));

test('real HTTP original verifies an empty document',async()=>fixture(async({url})=>{
 const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,0);
},0));

test('download cannot mix pre-restore response metadata with a replaced original',async()=>fixture(async({store,id,projectId,url})=>{
 const replacement=Buffer.from('Replacement with a different size'),meta={id,name:'Replacement.bin',type:'application/octet-stream',size:replacement.length,sha256:sha256(replacement)};
 const upload=await store.startUpload(meta,projectId);await store.putChunk(upload.uploadId,0,replacement);await store.finishUpload(upload.uploadId);
 const asset=store.asset.bind(store);let replaced=false;
 store.asset=async(...args)=>{const original=await asset(...args);if(!replaced){replaced=true;const state=await store.read(projectId),revision=state.rev;state.rev++;state.files=[meta];await store.commit({projectId,expectedRev:revision,state,newFiles:[{id,uploadId:upload.uploadId}],replace:true,key:uid()})}return original};
 const response=await fetch(url);assert.notEqual(response.status,200,'Changed original must not use the old response metadata');await response.arrayBuffer();
}));
