import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emptyState,uid,activityEvent,activitySearch} from '../../finance.js';
import {activity} from '../../server/domain.mjs';
import {SqliteStore} from '../../server/sqlite-store.mjs';
import {createHttpApp} from '../../server/http.mjs';
import {sha256} from '../../server/core.mjs';

async function withStore(fn){const directory=await mkdtemp(path.join(tmpdir(),'buildledger-activity-')),store=new SqliteStore(path.join(directory,'ledger.sqlite'));try{await store.start();await store.createProject('Activity fixture');await fn(store)}finally{await store.close();await rm(directory,{recursive:true,force:true})}}
async function seed(store){
 const at='2026-10-22T10:00:00.000Z',state=emptyState();state.rev=1;
 state.bills=[{id:'bill_new',total:600,title:'STEEL %_ İ',vendor:'Supplier',work:'Frame',recordedAt:at},{id:'bill_old',total:100,title:'Historical'}];
 state.contracts=[{id:'contract',amount:400,title:'Match agreement',vendor:'Supplier',createdAt:at}];
 state.plans=[{id:'plan_complete',contractId:'contract',amount:100,title:'Match completed',vendor:'Supplier',due:'2026-10-23',recordedAt:at},{id:'plan_open',amount:200,title:'Match open',vendor:'Supplier',due:'2026-10-24',recordedAt:at},{id:'plan_cancelled',amount:100,title:'Match cancelled',due:'2026-10-25',cancelled:true,recordedAt:at}];
 state.payments=[{id:'payment_full',amount:100,vendor:'Supplier',planId:'plan_complete',recordedAt:at},{id:'payment_partial',amount:50,vendor:'Supplier',planId:'plan_open',recordedAt:at}];
 state.allocations=[{id:'allocation',billId:'bill_new',paymentId:'payment_full',amount:25,recordedAt:at}];
 state.entries=[{id:'note_\uE000',kind:'note',title:'Match visit',party:'Engineer',amount:-25,recordedAt:at},{id:'note_😀',kind:'note',title:'Match visit',recordedAt:'2026-10-22T15:30:00+05:30'}];
 state.audit=[{id:'audit_z',description:'Match Z',type:'entry_edit',at},{id:'audit_a',description:'Match A',type:'entry_delete',at}];
 const meta={id:'file_0001',name:'Match.txt',size:0,sha256:sha256(Buffer.alloc(0)),type:'text/plain',category:'Drawing',importedAt:at};state.files=[meta];
 const upload=await store.startUpload(meta);await store.finishUpload(upload.uploadId);await store.commit({expectedRev:0,state,newFiles:[{id:meta.id,uploadId:upload.uploadId}],key:uid()});return state;
}

test('SQLite mixed activity pages preserve exact filters, counts, balances and timestamp/type/ID order',async()=>withStore(async store=>{
 const state=await seed(store),full=await store.activity({limit:200});
 assert.equal(full.count,14);assert.equal(full.asOfRevision,1);
 assert.deepEqual(full.items.map(e=>e.id),['allocation','audit_a','audit_z','bill_new','contract','file_0001','note_\uE000','note_😀','payment_full','payment_partial','plan_cancelled','plan_complete','plan_open','bill_old']);
 assert.equal(full.items.find(e=>e.id==='plan_complete').status,'Completed');assert.equal(full.items.find(e=>e.id==='plan_open').status,'Scheduled');assert.equal(full.items.find(e=>e.id==='plan_cancelled').status,'Cancelled');
 assert.equal(full.items.find(e=>e.id==='allocation').amount,25);assert.equal(full.items.find(e=>e.id==='allocation').party,'Supplier');assert.equal(full.items.find(e=>e.id==='allocation').work,'Frame');
 assert.equal(full.items.find(e=>e.id==='note_\uE000').amount,-25,'Historic signed note amounts are not financial postings');
 for(const type of ['All','bill','payment','plan','note','contract','allocation','audit','file','unknown'])for(const query of ['','MATCH','STEEL','Supplier','%_','İ','2026-10-22','missing'])for(const offset of [0,2,99]){
  const options={type,query,offset,limit:3};assert.deepEqual(await store.activity(options),activity(state,options),JSON.stringify(options));
 }
 assert.deepEqual(await store.activity({type:'audit',limit:0}),{count:2,items:[],asOfRevision:1});
 assert.deepEqual((await store.activity({type:'bill',query:'%_'})).items.map(e=>e.id),['bill_new']);
}));

test('SQLite activity HTTP uses bounded pages without loading or validating the full snapshot',async()=>withStore(async store=>{
 await seed(store);store.read=async()=>{throw Error('Activity loaded full ledger')};store.readSync=()=>{throw Error('Activity parsed full ledger')};
 const app=createHttpApp({store,authMode:'local'});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  for(const options of ['limit=1','type=plan&limit=1','type=allocation&q=steel&limit=1']){const response=await fetch(base+'/api/v1/activity?'+options);assert.equal(response.status,200);const result=await response.json();assert.equal(result.items.length,1);assert.equal(result.asOfRevision,1)}
  const invalid=await fetch(base+'/api/v1/activity?offset=-1');assert.equal(invalid.status,400);
 }finally{await new Promise(resolve=>app.close(resolve))}
}));

test('SQLite validates selected activity amounts and identities without rejecting an unrelated valid page',async()=>withStore(async store=>{
 await seed(store);const corrupt={id:'bill_old',total:'not money',title:'Historical'};store.db.prepare("UPDATE records SET doc_json=? WHERE kind='bills' AND record_id='bill_old'").run(JSON.stringify(corrupt));
 assert.equal((await store.activity({limit:1})).items[0].id,'allocation');
 await assert.rejects(()=>store.activity({type:'bill',offset:1,limit:1}),/Invalid stored activity record/);
 store.db.prepare("UPDATE records SET doc_json=? WHERE kind='bills' AND record_id='bill_old'").run(JSON.stringify({...corrupt,id:'mismatched_id',total:100}));
 await assert.rejects(()=>store.activity({type:'bill',offset:1,limit:1}),/Invalid stored activity record/);
}));

test('SQLite activity revision, count and page remain one snapshot across another connection committing',async()=>withStore(async store=>{
 const state=await seed(store),writer=new SqliteStore(store.filename);await writer.start();let concurrentWrite;
 state.rev=2;state.entries.push({id:'concurrent_note',kind:'note',title:'Match concurrent visit',recordedAt:'2026-10-23T00:00:00Z'});
 store.db.function('activity_search',{deterministic:true},(kind,json,bill,payment)=>{
  if(!concurrentWrite)concurrentWrite=writer.commit({expectedRev:1,state,key:uid()});
  return activitySearch(activityEvent(kind,JSON.parse(json),{bill:bill?JSON.parse(bill):undefined,payment:payment?JSON.parse(payment):undefined}));
 });
 try{
  const page=await store.activity({query:'match',limit:200});await concurrentWrite;
  assert.equal(page.asOfRevision,1);assert.equal(page.count,9);assert.equal(page.items.length,9);assert.equal(page.items.some(event=>event.id==='concurrent_note'),false);
  const latest=await store.activity({query:'match',limit:200});assert.equal(latest.asOfRevision,2);assert.equal(latest.count,10);assert.equal(latest.items[0].id,'concurrent_note');
 }finally{await writer.close()}
}));
