import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {SqliteStore} from '../../server/sqlite-store.mjs';
import {createHttpApp} from '../../server/http.mjs';
import {uid} from '../../finance.js';

async function appOnLoopback(fn){
 const folder=await mkdtemp(path.join(tmpdir(),'buildledger-nologin-'));
 const store=new SqliteStore(path.join(folder,'data.sqlite'));await store.start();
 const server=createHttpApp({store,host:'127.0.0.1',storeMode:'sqlite',authMode:'local'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{await fn(base)}finally{await new Promise(r=>server.close(r));await store.close();await rm(folder,{recursive:true,force:true})}
}
async function req(base,route,options={}){const res=await fetch(base+route,options);return {status:res.status,value:await res.json()}}

test('Local user enters dashboard and SQLite data directly without login or password',async()=>appOnLoopback(async(base)=>{
 let health=await req(base,'/api/v1/health');assert.equal(health.status,200);assert.equal(health.value.auth,'not_required');
 let session=await req(base,'/api/v1/session');assert.equal(session.value.authenticated,true);assert.equal(session.value.auth,'not_required');
 assert.equal((await req(base,'/api/v1/state')).status,200);
 assert.equal((await req(base,'/api/v1/dashboard')).status,200);
 assert.equal((await req(base,'/api/v1/documents')).status,200);
 let login=await req(base,'/api/v1/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'not needed'})});assert.equal(login.status,404);
 let project=await req(base,'/api/v1/projects',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'Local construction'})});assert.equal(project.status,201);
 const bill={id:uid(),vendor:'Local supplier',title:'Excavation expense',date:'2026-10-11',recordedAt:new Date().toISOString(),total:280000,lines:[{label:'Excavation',mode:'amount',directAmountPaise:280000,value:280000,qty:null,rate:null,unit:null,work:'Sump & excavation'}],type:'purchase',extras:0,tax:0,discount:0};
 const r=await req(base,'/api/v1/bills',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({record:bill,key:uid()})});assert.equal(r.status,201,JSON.stringify(r.value));
 const dash=await req(base,'/api/v1/dashboard');assert.equal(dash.value.totals.invoiced,280000);
 assert.equal((await req(base,'/api/v1/state')).value.bills.length,1);
}));

test('No-login rejects remote host configuration, spoofed Host, and cross-origin browser writes',async()=>{
 assert.throws(()=>createHttpApp({store:{},authMode:'local',host:'0.0.0.0'}),/localhost/i);
 assert.throws(()=>createHttpApp({store:{},authMode:'local',host:'192.168.1.11'}),/localhost/i);
 await appOnLoopback(async(base)=>{
  const badHost=await new Promise((resolve,reject)=>{const u=new URL('/api/v1/health',base);const r=httpRequest({hostname:u.hostname,port:u.port,path:u.pathname,headers:{Host:'some-untrusted-domain.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});r.on('error',reject);r.end()});assert.equal(badHost,403);
  const proxy=await fetch(base+'/api/v1/health',{headers:{'X-Forwarded-For':'192.0.2.1'}});assert.equal(proxy.status,403);
  const proto=await fetch(base+'/api/v1/health',{headers:{'X-Forwarded-Proto':'https'}});assert.equal(proto.status,403);
  const cross=await fetch(base+'/api/v1/commit',{method:'POST',headers:{Origin:'https://malicious.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
 });
});
