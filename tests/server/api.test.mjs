import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {createHttpApp} from '../../server/http.mjs';import {emptyState,uid} from '../../finance.js';import {sha256,checkState,CHUNK_SIZE} from '../../server/core.mjs';import {validateFileMutation} from '../../server/invariants.mjs';
import {activity,timeline} from '../../server/domain.mjs';

class TestStore{
 constructor(){this.st=emptyState();this.assets=new Map();this.uploads=new Map();this.ops=new Map()}
 async read(){return structuredClone(this.st)}
 async activity(options){return activity(this.st,options)}
 async startUpload(x){const uploadId=uid();this.uploads.set(uploadId,{meta:x,chunks:new Map()});return {uploadId,numChunks:Math.ceil(x.size/CHUNK_SIZE),chunkBytes:CHUNK_SIZE}}
 async putChunk(id,n,b){const x=this.uploads.get(id);if(!x)throw Object.assign(Error('Not found'),{status:404});x.chunks.set(n,Buffer.from(b))}
 async finishUpload(id){const u=this.uploads.get(id);const data=Buffer.concat([...u.chunks.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]));if(data.length!==u.meta.size||sha256(data)!==u.meta.sha256)throw Object.assign(Error('Checksum mismatch'),{status:422});u.complete=true;u.buf=data;return {verified:true}}
 async commit({expectedRev,state,newFiles=[],removeFiles=[],key,replace=false}){if(this.ops.has(key))return this.ops.get(key);if(expectedRev!==this.st.rev)throw Object.assign(Error('Project changed in another tab/device'),{status:409,code:'VERSION_CONFLICT'});checkState(state);validateFileMutation(this.st,state,newFiles,removeFiles,replace);assert.equal(state.rev,expectedRev+1);for(const f of newFiles){const u=this.uploads.get(f.uploadId),meta=state.files.find(x=>x.id===f.id);if(!u||!u.complete||u.meta.sha256!==meta?.sha256)throw Object.assign(Error('Missing original'),{status:422})}for(const f of removeFiles)this.assets.delete(f);if(replace)this.assets.clear();for(const f of newFiles){const u=this.uploads.get(f.uploadId);this.assets.set(f.id,{...u.meta,buffer:u.buf,id:f.id})}this.st=structuredClone(state);let result={ok:true,rev:state.rev};this.ops.set(key,result);return result}
 async asset(id){return this.assets.get(id)||null}
 async *fileStream(id){const a=this.assets.get(id);if(a)yield a.buffer}
}
async function makeApp(){const store=new TestStore();const app=createHttpApp({store,password:'TestPassword-DontUse',secret:'d'.repeat(48)});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;return {store,app,base,close:()=>new Promise(r=>app.close(r))}}
async function request(base,path,method='GET',data=null,cookie=''){let hdr={'Origin':base};if(cookie)hdr.Cookie=cookie;if(data!==null&&!Buffer.isBuffer(data))hdr['Content-Type']='application/json';let res=await fetch(base+path,{method,headers:hdr,body:data===null?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data)});let type=res.headers.get('content-type')||'';return {res,data:type.includes('json')?await res.json():Buffer.from(await res.arrayBuffer())}}
function loginFromAddress(base,localAddress,password='wrong'){const url=new URL('/api/v1/login',base);return new Promise((resolve,reject)=>{const req=http.request({hostname:url.hostname,port:url.port,path:url.pathname,method:'POST',localAddress,agent:false,headers:{Origin:base,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}))});req.once('error',reject);req.end(JSON.stringify({password}))})}
function testAddress(secondOctet,index){return `127.${secondOctet}.${Math.floor(index/255)}.${index%255+1}`}
async function auth(x){let r=await request(x.base,'/api/v1/login','POST',{password:'TestPassword-DontUse'});assert.equal(r.res.status,200);return r.res.headers.get('set-cookie').split(';')[0]}

test('concurrent incomplete login bodies cannot reuse the same failed-attempt counter',async()=>{
 const x=await makeApp();try{
  const pending=[];let seen=0,ready;const received=new Promise(resolve=>{ready=resolve});
  x.app.on('request',()=>{if(++seen===8)ready()});
  const responses=Array.from({length:8},()=>new Promise((resolve,reject)=>{
   const url=new URL(x.base),req=http.request({hostname:url.hostname,port:url.port,path:'/api/v1/login',method:'POST',agent:false,headers:{Origin:x.base,'Content-Type':'application/json'}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode))});
   req.once('error',reject);req.write('{"password":');pending.push(req);
  }));
  await received;for(const req of pending)req.end('"wrong"}');
  const statuses=await Promise.all(responses);
  assert.equal(statuses.filter(status=>status===401).length,5);
  assert.equal(statuses.filter(status=>status===429).length,3);
  assert.equal((await request(x.base,'/api/v1/login','POST',{password:'wrong'})).res.status,429);
 }finally{await x.close()}
});

test('activity validates pagination and bounded search before reading project data',async()=>{const x=await makeApp();try{
 const cookie=await auth(x);let reads=0;const read=x.store.read.bind(x.store);x.store.read=()=>{reads++;return read()};
 for(const query of ['limit=-1','offset=-1','limit=1.5','offset=1.5','limit=NaN','offset=Infinity','limit=','offset=1000001','limit=9007199254740992','q='+('a'.repeat(201)),'type='+('a'.repeat(81))])assert.equal((await request(x.base,'/api/v1/activity?'+query,'GET',null,cookie)).res.status,400,query);
 assert.equal(reads,0,'Invalid inputs must not load or calculate the project');
 x.store.st.audit=Array.from({length:205},(_,i)=>({id:uid(),description:'match '+i,type:'test',at:new Date(2026,0,1,0,i).toISOString()}));
 let r=await request(x.base,'/api/v1/activity?type=audit&q=match&limit=999&offset=2','GET',null,cookie);assert.equal(r.res.status,200);assert.equal(r.data.count,205);assert.equal(r.data.items.length,200);assert.equal(r.data.items[0].label,'match 202');
 r=await request(x.base,'/api/v1/activity?limit=0','GET',null,cookie);assert.equal(r.res.status,200);assert.deepEqual(r.data.items,[]);
 assert.throws(()=>activity(x.store.st,{offset:0.5}),/non-negative integer/);
 }finally{await x.close()}});

test('calendar totals include all linked payments and exclude cancelled plans',()=>{
 const s=emptyState();s.plans=[{id:uid(),vendor:'Engineer',title:'First',amount:1000,due:'2026-10-20'},{id:uid(),vendor:'Engineer',title:'Second',amount:2000,due:'2026-10-21'},{id:uid(),vendor:'Engineer',title:'Cancelled',amount:1000,due:'2026-10-22',cancelled:true}];
 s.payments=[{id:uid(),vendor:'Engineer',amount:100,planId:s.plans[0].id},{id:uid(),vendor:'Engineer',amount:250,planId:s.plans[0].id},{id:uid(),vendor:'Engineer',amount:300}];
 const items=timeline(s);assert.deepEqual(items.map(p=>[p.title,p.paid]),[['First',350],['Second',0]]);
});
test('API sign-in, domain bills, payment settlement, analytics, conflict, access control',async()=>{let x=await makeApp();try{
 assert.equal((await request(x.base,'/api/v1/health')).res.status,200);
 assert.equal((await request(x.base,'/api/v1/state')).res.status,401);
 assert.equal((await request(x.base,'/api/v1/login','POST',{password:'wrong'})).res.status,401);
 const cookie=await auth(x);
 assert.equal((await request(x.base,'/api/v1/state','GET',null,cookie)).data.rev,0);
 const bill={id:uid(),vendor:'Vendor B',title:'Sump steel',date:'2026-10-10',recordedAt:new Date().toISOString(),total:125000,lines:[{label:'Sump steel',qty:null,rate:null,unit:null,mode:'amount',directAmountPaise:125000,value:125000,work:'Sump & excavation'}],type:'purchase',extras:0,tax:0,discount:0};
 let r=await request(x.base,'/api/v1/bills','POST',{record:bill,key:uid()},cookie);assert.equal(r.res.status,201,JSON.stringify(r.data));
 let pay={id:uid(),vendor:'Vendor B',date:'2026-10-10',recordedAt:new Date().toISOString(),amount:50000,method:'UPI'};
 r=await request(x.base,'/api/v1/payments','POST',{record:pay,allocations:[{billId:bill.id,amount:50000}],key:uid()},cookie);assert.equal(r.res.status,201,JSON.stringify(r.data));
 const dash=(await request(x.base,'/api/v1/dashboard','GET',null,cookie)).data;assert.equal(dash.totals.invoiced,125000);assert.equal(dash.totals.paid,50000);assert.equal(dash.totals.owed,75000);
 const summary=(await request(x.base,'/api/v1/analytics/costs?by=work','GET',null,cookie)).data;assert.equal(summary.totalPaise,125000);assert.equal(summary.values[0].amountPaise,125000);
 const history=(await request(x.base,'/api/v1/activity?type=bill','GET',null,cookie)).data;assert.equal(history.count,1);
 const stale=await request(x.base,'/api/v1/commit','POST',{expectedRev:0,state:emptyState(),key:uid()},cookie);assert.equal(stale.res.status,409); // stale write conflicts with another device
 const over={...pay,id:uid(),amount:180000};r=await request(x.base,'/api/v1/payments','POST',{record:over,allocations:[{billId:bill.id,amount:180000}],key:uid()},cookie);assert.equal(r.res.status,422); // invalid overpayment rejected
 }finally{await x.close()}});
test('owner authentication bounds failed-address and active-session tracking',async()=>{const x=await makeApp();try{
 for(let i=0;i<5;i++)assert.equal((await loginFromAddress(x.base,'127.0.0.2')).status,401);
 assert.equal((await loginFromAddress(x.base,'127.0.0.2')).status,429);
 for(let i=0;i<256;i++)assert.equal((await loginFromAddress(x.base,testAddress(1,i))).status,401);
 assert.equal((await loginFromAddress(x.base,'127.0.0.2')).status,429,'tracked lockout should survive address-map saturation');
 for(let i=256;i<259;i++)assert.equal((await loginFromAddress(x.base,testAddress(1,i))).status,401);
 assert.equal((await loginFromAddress(x.base,testAddress(1,259))).status,429,'untracked addresses should share the overflow cooldown');
 assert.equal((await loginFromAddress(x.base,testAddress(3,0),'TestPassword-DontUse')).status,200,'valid owner sign-in should pass during overflow cooldown');
 assert.equal((await loginFromAddress(x.base,testAddress(1,260))).status,429,'valid sign-in should not clear the shared overflow cooldown');
 let oldestCookie;
 for(let i=0;i<257;i++){
  const result=await loginFromAddress(x.base,testAddress(2,i),'TestPassword-DontUse');
  assert.equal(result.status,200);
  if(i===0)oldestCookie=result.cookie;
 }
 const session=await request(x.base,'/api/v1/session','GET',null,oldestCookie);
 assert.equal(session.data.authenticated,false,'oldest active session should be evicted at the configured bound');
}finally{await x.close()}});
test('file chunk upload, server inline view, explicit delete and backup integrity',async()=>{const x=await makeApp();try{
 let cookie=await auth(x);const file=Buffer.from('%PDF-1.7\nOriginal approved footing drawing.');let id=uid(),sha=sha256(file);
 let start=(await request(x.base,'/api/v1/uploads/start','POST',{id,name:'Footing_R2.pdf',sha256:sha,size:file.length,type:'application/pdf'},cookie)).data;
 let s=await request(x.base,`/api/v1/uploads/${start.uploadId}/chunks/0`,'PUT',file,cookie);assert.equal(s.res.status,200);
 let done=await request(x.base,`/api/v1/uploads/${start.uploadId}/complete`,'POST',null,cookie);assert.equal(done.res.status,200);
 const st=emptyState();st.rev=1;st.files.push({id,name:'Footing_R2.pdf',type:'application/pdf',size:file.length,sha256:sha,category:'Structural drawings',status:'Approved for construction',revision:'R2',importedAt:new Date().toISOString()});
 let post=await request(x.base,'/api/v1/commit','POST',{expectedRev:0,state:st,newFiles:[{id,uploadId:start.uploadId}],removeFiles:[],key:uid()},cookie);assert.equal(post.res.status,200,JSON.stringify(post.data));
 let received=await request(x.base,`/api/v1/files/${id}`,'GET',null,cookie);assert.equal(received.res.headers.get('content-type'),'application/pdf');assert.deepEqual(received.data,file);assert.match(received.res.headers.get('content-disposition'),/^inline/);
 const updated=structuredClone(st);updated.rev=2;updated.files=[];updated.audit.push({id:uid(),type:'file_delete',description:'Deleted drawing',at:new Date().toISOString()});
 const orphan=await request(x.base,'/api/v1/commit','POST',{expectedRev:1,state:{...st,rev:2},newFiles:[],removeFiles:[id],key:uid()},cookie);
 assert.equal(orphan.res.status,422,'Deleting bytes but retaining a file record must fail');
 assert.equal((await request(x.base,`/api/v1/files/${id}`,'GET',null,cookie)).res.status,200,'Failed delete must leave the original untouched');
 let removed=await request(x.base,'/api/v1/commit','POST',{expectedRev:1,state:updated,newFiles:[],removeFiles:[id],key:uid()},cookie);assert.equal(removed.res.status,200);
 assert.equal((await request(x.base,`/api/v1/files/${id}`,'GET',null,cookie)).res.status,404);
 }finally{await x.close()}})
