import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteStore} from '../../server/sqlite-store.mjs';
import {createHttpApp} from '../../server/http.mjs';
import {uid} from '../../finance.js';

test('SQLite hierarchy API persists substage path and allows exact leaf bill drilldown',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'buildledger-hierarchy-'));
 const store=new SqliteStore(path.join(folder,'data.sqlite'));await store.start();await store.createProject('Hierarchy fixture');
 const server=createHttpApp({store,host:'127.0.0.1',storeMode:'sqlite',authMode:'local'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
   const bill={id:uid(),vendor:'Builder Supplier',title:'Sump concrete and steel',date:'2026-10-11',recordedAt:new Date().toISOString(),total:40001,type:'purchase',extras:1,tax:0,discount:0,lines:[
    {label:'TMT 12 mm',work:'Sump & excavation',substage:'Reinforcement',mode:'amount',directAmountPaise:15000,value:15000},
    {label:'Cement',work:'Sump & excavation',substage:'RCC walls',mode:'amount',directAmountPaise:25000,value:25000}
   ]};
   const post=await fetch(base+'/api/v1/bills',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({record:bill,key:uid()})});
   assert.equal(post.status,201,await post.text());
   const stage=new URLSearchParams();stage.append('level','Sump & excavation');
   let report=await fetch(base+'/api/v1/analytics/hierarchy?'+stage);assert.equal(report.status,200);
   let val=await report.json();assert.equal(val.total,40001);assert.deepEqual(val.children.map(x=>x.total).sort((a,b)=>a-b),[15000,25001]);
   stage.append('level','Reinforcement');stage.append('level','TMT 12 mm');
   report=await fetch(base+'/api/v1/analytics/hierarchy?'+stage);assert.equal(report.status,200);val=await report.json();
   assert.equal(val.total,15000);assert.equal(val.entries[0].billId,bill.id);
   assert.equal((await fetch(base+'/api/v1/analytics/hierarchy?level=Invalid')).status,404);
   // Category configuration travels through the same durable SQLite state.
   const s=await store.read();s.settings.catalog=[{id:uid(),stage:'Custom site stage',substage:'Hidden pipe run'}];
   const priorRevision=s.rev;s.rev++;await store.commit({expectedRev:priorRevision,state:s,newFiles:[],removeFiles:[],key:uid()});
   const after=await store.read();assert.equal(after.settings.catalog[0].substage,'Hidden pipe run');
 }finally{await new Promise(r=>server.close(r));await store.close();await rm(folder,{recursive:true,force:true})}
});
