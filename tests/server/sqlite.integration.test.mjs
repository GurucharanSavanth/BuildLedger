import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {SqliteStore} from '../../server/sqlite-store.mjs';import {createHttpApp} from '../../server/http.mjs';import {emptyState,uid} from '../../finance.js';import {sha256,CHUNK_SIZE} from '../../server/core.mjs';
const safeErr=msg=>{const e=Error(msg);e.status=422;return e};
async function withStore(fn){const dir=await mkdtemp(path.join(tmpdir(),'buildledger-sqlite-')),dbPath=path.join(dir,'records.sqlite'),store=new SqliteStore(dbPath);await store.start();await store.createProject('SQLite integration');try{await fn(store,dbPath)}finally{await store.close();await rm(dir,{recursive:true,force:true})}}
function bill(amount=125000){return {id:uid(),vendor:'Steel Supplier',title:'Sump steel direct amount',date:'2026-10-11',recordedAt:new Date().toISOString(),total:amount,lines:[{label:'12mm TMT steel',mode:'amount',directAmountPaise:amount,value:amount,qty:null,rate:null,unit:null,work:'Sump & excavation'}],type:'purchase',extras:0,tax:0,discount:0}}
async function req(base,url,method='GET',data=null,cookie=''){
 const headers={Origin:base};if(cookie)headers.Cookie=cookie;if(data!==null&&!Buffer.isBuffer(data))headers['Content-Type']='application/json';
 const res=await fetch(base+url,{method,headers,body:data===null?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data)});
 const typ=res.headers.get('content-type')||'';return {status:res.status,body:typ.includes('json')?await res.json():Buffer.from(await res.arrayBuffer()),headers:res.headers};
}
async function server(store){const server=createHttpApp({store,password:'TestLocalOwnerPassword-Good',secret:'u'.repeat(48),storeMode:'sqlite'});await new Promise(r=>server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+server.address().port;return {base,close:()=>new Promise(r=>server.close(r))}}
async function signIn(base){let r=await req(base,'/api/v1/login','POST',{password:'TestLocalOwnerPassword-Good'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
test('SQLite persistence, direct amount invoice, linked partial payment, read APIs, restart',async()=>withStore(async(s,dbPath)=>{
 const app=await server(s);try{
  assert.equal((await req(app.base,'/api/v1/state')).status,401);
  assert.deepEqual((await req(app.base,'/api/v1/health')).body,{ok:true,mode:'sqlite',database:'ready',auth:'required'});
  const cookie=await signIn(app.base),b=bill();
  let r=await req(app.base,'/api/v1/bills','POST',{record:b,key:uid()},cookie);assert.equal(r.status,201,JSON.stringify(r.body));
  const pay={id:uid(),vendor:'Steel Supplier',date:'2026-10-11',recordedAt:new Date().toISOString(),amount:50555,method:'UPI'};
  r=await req(app.base,'/api/v1/payments','POST',{record:pay,allocations:[{billId:b.id,amount:50555}],key:uid()},cookie);assert.equal(r.status,201,JSON.stringify(r.body));
  let data=(await req(app.base,'/api/v1/dashboard','GET',null,cookie)).body;
  assert.equal(data.totals.invoiced,125000);assert.equal(data.totals.paid,50555);assert.equal(data.totals.owed,74445);
  assert.equal((await req(app.base,'/api/v1/activity?type=bill','GET',null,cookie)).body.count,1);
  assert.equal((await req(app.base,'/api/v1/analytics/costs?by=material','GET',null,cookie)).body.totalPaise,125000);
  assert.equal((await req(app.base,'/api/v1/documents','GET',null,cookie)).body.items.length,0);
 }finally{await app.close()}
 await s.close();const s2=new SqliteStore(dbPath);await s2.start();try{const after=await s2.read();assert.equal(after.bills.length,1);assert.equal(after.payments.length,1);assert.equal(after.allocations.length,1);assert.equal(after.rev,2);assert.equal(after.bills[0].lines[0].qty,null)}finally{await s2.close()}
}));
test('SQLite atomic file upload, direct preview, deletion, immutable records, integrity and rollback',async()=>withStore(async(store,dbPath)=>{
 const app=await server(store);try{
 const cookie=await signIn(app.base),data=Buffer.from('%PDF-1.4\n% approved foundation drawing\n');let fileId=uid(),sha=sha256(data);
 let up=(await req(app.base,'/api/v1/uploads/start','POST',{id:fileId,name:'Footing_R2.pdf',sha256:sha,size:data.length,type:'application/pdf'},cookie)).body;
 assert.equal((await req(app.base,`/api/v1/uploads/${up.uploadId}/chunks/0`,'PUT',data,cookie)).status,200);
 assert.equal((await req(app.base,`/api/v1/uploads/${up.uploadId}/complete`,'POST',null,cookie)).status,200);
 let st=emptyState();st.rev=1;st.files.push({id:fileId,name:'Footing_R2.pdf',size:data.length,type:'application/pdf',sha256:sha,category:'Structural drawings',revision:'R2',status:'Approved for construction',importedAt:new Date().toISOString()});
 let r=await req(app.base,'/api/v1/commit','POST',{expectedRev:0,state:st,newFiles:[{id:fileId,uploadId:up.uploadId}],removeFiles:[],key:uid()},cookie);assert.equal(r.status,200,JSON.stringify(r.body));
 let f=await req(app.base,`/api/v1/files/${fileId}`,'GET',null,cookie);assert.equal(f.status,200);assert.deepEqual(f.body,data);assert.match(f.headers.get('content-disposition'),/^inline/);
 let save=await req(app.base,`/api/v1/files/${fileId}?download=1`,'GET',null,cookie);assert.match(save.headers.get('content-disposition'),/^attachment/);
 let bad=await req(app.base,'/api/v1/commit','POST',{expectedRev:1,state:{...st,rev:2},newFiles:[],removeFiles:[fileId],key:uid()},cookie);assert.equal(bad.status,422);
 let next=structuredClone(st);next.rev=2;next.files=[];next.audit.push({id:uid(),description:'Deleted file with owner approval',type:'file_delete',at:new Date().toISOString()});
 r=await req(app.base,'/api/v1/commit','POST',{expectedRev:1,state:next,newFiles:[],removeFiles:[fileId],key:uid()},cookie);assert.equal(r.status,200);
 assert.equal((await req(app.base,`/api/v1/files/${fileId}`,'GET',null,cookie)).status,404);
 assert.equal((await req(app.base,'/api/v1/documents','GET',null,cookie)).body.items.length,0);
 assert.equal((await store.read()).audit.length,1);
 }finally{await app.close()}
}));
test('SQLite API idempotency protects repeated writes, overpayment and changed-key replay',async()=>withStore(async(store)=>{
 const app=await server(store);try{const cookie=await signIn(app.base),b=bill(18000),key=uid(),body={record:b,key};const one=await req(app.base,'/api/v1/bills','POST',body,cookie);assert.equal(one.status,201);const repeated=await req(app.base,'/api/v1/bills','POST',body,cookie);
 assert.equal(repeated.status,201);assert.deepEqual(one.body,repeated.body);assert.equal((await store.read()).bills.length,1);
 const changed=await req(app.base,'/api/v1/bills','POST',{...body,record:{...b,total:b.total+5}},cookie);assert.equal(changed.status,409);
 let snapshot=await store.read();snapshot.rev++;let old=await store.read();let idem=uid(),request={expectedRev:old.rev,state:snapshot,key:idem};
 let first=await req(app.base,'/api/v1/commit','POST',request,cookie);assert.equal(first.status,200);let second=await req(app.base,'/api/v1/commit','POST',request,cookie);assert.equal(second.status,200);assert.deepEqual(first.body,second.body);
 let mutated=structuredClone(snapshot);mutated.project.name='Bad replay';let conflict=await req(app.base,'/api/v1/commit','POST',{...request,state:mutated},cookie);assert.equal(conflict.status,409);
 let payment={id:uid(),vendor:'Steel Supplier',amount:30000,date:'2026-10-11',recordedAt:new Date().toISOString()};let failed=await req(app.base,'/api/v1/payments','POST',{record:payment,allocations:[{billId:b.id,amount:30000}],key:uid()},cookie);assert.equal(failed.status,422);assert.equal((await store.read()).payments.length,0);
}finally{await app.close()}}));
