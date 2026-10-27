import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {createPreviewServer} from '../dev-server.mjs';
import {emptyState,uid,verifyState,changeEntry,validateRecordChanges,summary,eventList,validDate} from '../finance.js';
import {SqliteStore} from '../server/sqlite-store.mjs';
import {sha256} from '../server/core.mjs';
import {createHttpApp} from '../server/http.mjs';
import {packSnapshot,unpackSnapshot} from '../archive.js';

test('preview only serves frontend assets and rejects rebinding hosts',async()=>{
 const app=createPreviewServer();await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.address().port;
 try{
  assert.equal((await fetch(base+'/app.js')).status,200);
  for(const resource of ['/.env','/.env.example','/data/buildledger.sqlite','/server/core.mjs','/package.json'])assert.equal((await fetch(base+resource)).status,404,resource);
  const status=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/index.html',{headers:{Host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end()});assert.equal(status,403);
  assert.equal((await fetch(base+'/index.html',{headers:{Forwarded:'host=localhost'}})).status,403);
 }finally{await new Promise(r=>app.close(r))}
});

test('calendar validation rejects impossible dates and duplicate audit IDs',()=>{
 assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-02-29'),false);
 for(const date of ['2026-99-99','2026-04-31','2026-01-00','bad','2026-1-1']){
  const s=emptyState();s.plans=[{id:uid(),amount:100,due:date}];assert.throws(()=>verifyState(s),/date/);
 }
 const s=emptyState(),id=uid();s.audit=[{id},{id}];assert.throws(()=>verifyState(s),/Duplicate audit/);
});

function ledger(){const s=emptyState();s.bills=[{id:'bill_0001',vendor:'A',title:'Cement',total:10000,date:'2026-10-11'}];s.plans=[{id:'plan_0001',vendor:'A',title:'Stage 1',amount:10000,due:'2026-10-20'}];s.payments=[{id:'pay_00001',vendor:'A',amount:6000,planId:'plan_0001',date:'2026-10-11'}];s.allocations=[{id:'alloc_001',paymentId:'pay_00001',billId:'bill_0001',amount:6000}];return s}

test('audited edit reconciles payment allocation and preserves exact previous values',()=>{
 const s=ledger(),before=structuredClone(s);
 changeEntry(s,'payment','pay_00001',{amount:5000});
 assert.equal(s.allocations[0].amount,5000);assert.equal(summary(s).owed,5000);
 assert.equal(s.audit[0].changes[0].before.amount,6000);
 assert.equal(validateRecordChanges(before,s),true);
 assert.ok(eventList(s).some(e=>e.kind==='audit'&&e.status==='Edited'));
 const forged=structuredClone(s);forged.audit[0].changes[0].before.total=99;
 assert.throws(()=>validateRecordChanges(before,forged),/audit|Audit/);
 const unaudited=structuredClone(before);unaudited.payments[0].amount=7000;
 assert.throws(()=>validateRecordChanges(before,unaudited),/audit/);
});

test('bill, payment, plan, contract and note deletion preserve cash and log dependencies',()=>{
 let s=ledger();changeEntry(s,'bill','bill_0001');assert.equal(s.payments.length,1);assert.equal(s.allocations.length,0);assert.equal(summary(s).advances,6000);assert.equal(summary(s).invoiced,0);
 s=ledger();changeEntry(s,'payment','pay_00001');assert.equal(summary(s).paid,0);assert.equal(summary(s).owed,10000);assert.equal(s.allocations.length,0);
 s=ledger();changeEntry(s,'plan','plan_0001');assert.equal(s.payments[0].planId,'');assert.equal(summary(s).paid,6000);
 s=ledger();s.contracts=[{id:'contract1',vendor:'A',title:'Agreement',amount:10000}];s.plans[0].contractId='contract1';changeEntry(s,'contract','contract1');assert.equal(s.plans.length,0);assert.equal(s.payments[0].planId,'');
 s=ledger();s.entries=[{id:'note_0001',kind:'note',title:'Site visit',date:'2026-10-11'}];changeEntry(s,'note','note_0001');assert.equal(s.entries.length,0);assert.ok(eventList(s).some(e=>e.status==='Deleted'));
});

test('old audit records cannot be edited or deleted',()=>{
 const s=ledger();changeEntry(s,'payment','pay_00001',{amount:5000});
 const newer=structuredClone(s);newer.audit=[];assert.throws(()=>validateRecordChanges(s,newer),/audit record/);
});

test('advance allocation edits and deletes update due balances without changing cash',()=>{
 const s=ledger();changeEntry(s,'allocation','alloc_001',{amount:4000});
 assert.equal(summary(s).paid,6000);assert.equal(summary(s).owed,6000);assert.equal(summary(s).advances,2000);
 assert.ok(eventList(s).some(e=>e.kind==='allocation'&&e.amount===4000));
 changeEntry(s,'allocation','alloc_001');assert.equal(summary(s).paid,6000);assert.equal(summary(s).owed,10000);assert.equal(summary(s).advances,6000);assert.equal(s.audit.length,2);
});

test('SQLite rejects missing replacement originals and restores SVG backup with audited changes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'buildledger-regression-')),store=new SqliteStore(path.join(dir,'test.sqlite'));await store.start();await store.createProject('Audit regression');let app;
 try{
  const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),id=uid(),meta={id,name:'plan.svg',type:'image/svg+xml',size:bytes.length,sha256:sha256(bytes)};
  const upload=await store.startUpload(meta);await store.putChunk(upload.uploadId,0,bytes);await store.finishUpload(upload.uploadId);
  const s=ledger();s.rev=1;s.files=[meta];await store.commit({expectedRev:0,state:s,newFiles:[{id,uploadId:upload.uploadId}],key:uid()});
  await assert.rejects(()=>store.commit({expectedRev:1,state:{...s,rev:2},replace:true,key:uid()}),/no verified original/);
  assert.ok(await store.asset(id));
  app=createHttpApp({store,authMode:'local'});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const blob=await(await fetch('http://127.0.0.1:'+app.address().port+'/api/v1/files/'+id)).blob();assert.equal(blob.type,'application/octet-stream');
  const restored=await unpackSnapshot(await packSnapshot(s,[{id,blob}],'test-backup-password'),'test-backup-password');assert.equal(restored.assets[0].blob.type,meta.type);
  const up=await store.startUpload({...meta,type:restored.assets[0].blob.type});await store.putChunk(up.uploadId,0,Buffer.from(await restored.assets[0].blob.arrayBuffer()));await store.finishUpload(up.uploadId);
  restored.state.rev=2;await store.commit({expectedRev:1,state:restored.state,replace:true,newFiles:[{id,uploadId:up.uploadId}],key:uid()});
  let next=await store.read();changeEntry(next,'bill','bill_0001');next.rev++;await store.commit({expectedRev:2,state:next,key:uid()});
  const saved=await store.read();assert.equal(saved.bills.length,0);assert.equal(saved.payments.length,1);assert.equal(saved.audit[0].type,'entry_delete');assert.ok(await store.asset(id));
 }finally{if(app)await new Promise(r=>app.close(r));await store.close();assert.ok(dir.startsWith(path.join(tmpdir(),'buildledger-regression-')));await rm(dir,{recursive:true,force:true})}
});
