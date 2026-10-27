import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emptyState,verifyState,uid} from '../finance.js';
import {replaceAll} from '../db.js';
import {unpackSnapshot,archiveFormatTest as format} from '../archive.js';
import {SqliteStore} from '../server/sqlite-store.mjs';
import {sha256} from '../server/core.mjs';

test('oversized selected archives reject before reading their bytes',async()=>{
 let read=false;
 await assert.rejects(()=>unpackSnapshot({size:850*1024*1024+1,arrayBuffer(){read=true;throw Error('Oversized bytes were read')}},'recovery-password'),/exceeds.*850 MB/i);
 assert.equal(read,false);
});

function invalidStates(){
 const result=[];
 for(const value of [-1,0.5,'100',Number.MAX_SAFE_INTEGER+1,null,undefined])for(const field of ['budget','rev']){
  const state=emptyState();if(field==='budget')state.project.budget=value;else state.rev=value;result.push([state,new RegExp('Invalid project '+(field==='rev'?'revision':'budget'))]);
 }
 const state=emptyState();state.plans=[{id:'orphan_plan',contractId:'missing_contract',amount:12345,due:'2026-10-22'}];result.push([state,/Missing linked contract/]);
 const bills=emptyState();bills.bills=[{id:'b1',total:Number.MAX_SAFE_INTEGER},{id:'b2',total:1}];result.push([bills,/Unsafe financial total/]);
 const payments=emptyState();payments.payments=[{id:'p1',amount:Number.MAX_SAFE_INTEGER},{id:'p2',amount:1}];result.push([payments,/Unsafe financial total/]);
 const plans=emptyState();plans.plans=[{id:'a',amount:Number.MAX_SAFE_INTEGER,due:'2026-01-01'},{id:'b',amount:1,due:'2026-01-31'}];result.push([plans,/Unsafe financial total/]);
 return result;
}

test('shared restore metadata and reference checks reject input before browser storage opens',async()=>{
 const original=globalThis.indexedDB;let opens=0;globalThis.indexedDB={open(){opens++;throw Error('Invalid restore reached storage')}};
 try{for(const [state,error] of invalidStates()){assert.throws(()=>verifyState(state),error);await assert.rejects(()=>replaceAll(state,[]),error)}assert.equal(opens,0)}finally{globalThis.indexedDB=original}
 const state=emptyState();state.project.budget=12345;state.rev=7;state.plans=[{id:'standalone',contractId:'',amount:12345,due:'2026-10-22'}];assert.equal(verifyState(state),true);
 state.contracts=[{id:'contract',amount:12345}];state.plans[0].contractId='contract';assert.equal(verifyState(state),true);
});

test('historical blank instalment supplier restores unchanged while known contract recipient remains enforced',async()=>{
 const state=emptyState();state.contracts=[{id:'legacy-contract',vendor:'Known supplier',amount:12345}];
 state.plans=[{id:'legacy-plan',vendor:'',contractId:'legacy-contract',amount:12345,due:'2026-10-26'}];
 const password='legacy-supplier-recovery',bytes=await import('../archive.js').then(archive=>archive.packSnapshot(state,[],password));
 const restored=await unpackSnapshot(bytes,password);assert.deepEqual(restored.state,state);assert.equal(restored.state.plans[0].vendor,'');
});

test('authenticated format-1 archives reject invalid imported metadata before asset restoration',async()=>{
 const encoder=new TextEncoder(),password='restore-regression-password',salt=new Uint8Array(16).fill(7),key=await format.keyFor(password,salt);
 for(const [state,error] of invalidStates()){
  const plain=encoder.encode(JSON.stringify(state)),encrypted=await format.encrypt(plain,key);
  const header={product:'BuildLedger',format:1,encrypted:true,salt:format.b64(salt),database:{iv:encrypted.iv,sha256:await format.digest(plain)},objects:[]};
  const archive=format.zipCreate([['header.json',encoder.encode(JSON.stringify(header))],['state.enc',encrypted.bytes]]);
  await assert.rejects(()=>unpackSnapshot(archive,password),error);
 }
});

test('rejected SQLite replacements preserve exact posted amounts, revision and original bytes',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-restore-validation-')),store=new SqliteStore(path.join(directory,'ledger.sqlite'));
 try{
  await store.start();await store.createProject('Restore validation');const bytes=Buffer.from('original invoice\0bytes'),fileId=uid(),state=emptyState();state.rev=1;state.project.budget=98765;
  state.bills=[{id:'original_bill',total:12345,title:'Original',vendor:'Supplier'}];state.files=[{id:fileId,name:'original.txt',type:'text/plain',size:bytes.length,sha256:sha256(bytes)}];
  const upload=await store.startUpload(state.files[0]);await store.putChunk(upload.uploadId,0,bytes);await store.finishUpload(upload.uploadId);
  await store.commit({expectedRev:0,state,newFiles:[{id:fileId,uploadId:upload.uploadId}],key:uid()});
  for(const [invalid,error] of invalidStates()){
   // A valid replacement revision must still reject invalid budget/reference data.
   if(error.source.includes('revision'))await assert.rejects(()=>store.commit({expectedRev:1,state:invalid,key:uid(),replace:true}),error);
   else{invalid.rev=2;await assert.rejects(()=>store.commit({expectedRev:1,state:invalid,key:uid(),replace:true}),error)}
   const saved=await store.read();assert.deepEqual(saved,state);assert.equal(saved.rev,1);assert.equal(saved.project.budget,98765);assert.equal(saved.bills[0].total,12345);
   const chunks=[];for await(const chunk of store.fileStream(fileId))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),Buffer.from('original invoice\0bytes'));
  }
 }finally{await store.close();await rm(directory,{recursive:true,force:true})}
});
