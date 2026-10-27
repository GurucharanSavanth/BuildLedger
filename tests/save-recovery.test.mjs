import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteStore} from '../server/sqlite-store.mjs';
import {createHttpApp} from '../server/http.mjs';
import {emptyState,uid,checkNewPayment} from '../finance.js';

test('a successful payment followed by a failed refresh cannot be confirmed twice',async()=>{
 const source=await readFile(new URL('../app.js',import.meta.url),'utf8'),state=emptyState();
 const commit=source.slice(source.indexOf('async function commit('),source.indexOf('\nfunction showPendingSave'));
 const confirm=source.slice(source.indexOf('async function confirmEntry('),source.indexOf('\nfunction activity()'));
 const context=vm.createContext({sessionGeneration:0,selectedProject:'test-project',pending:{projectId:'test-project',kind:'payment',vendor:'A',amount:100,date:'2026-10-11'},isPosting:false,uid,checkNewPayment,modify:async fn=>fn(state),refresh:async()=>{throw Error('Refresh failed')},toast(){},closeModal(){},goto(){},addAudit:s=>s.audit.push({id:uid()})});
 vm.runInContext(commit+'\n'+confirm,context);
 await vm.runInContext('confirmEntry()',context);await vm.runInContext('confirmEntry()',context);
 assert.equal(state.payments.length,1);assert.equal(context.pending,null);
});

// Only the browser's IndexedDB API is substituted. All db.js requests hit real HTTP + SQLite.
function browserStorage(values){
 return {open(){const req={};queueMicrotask(()=>{req.result={transaction(){const tx={objectStore:()=>({get(key){const r={};queueMicrotask(()=>{r.result=values.get(key);r.onsuccess?.()});return r},put(value,key){values.set(key,structuredClone(value));queueMicrotask(()=>tx.oncomplete?.())},delete(key){values.delete(key);queueMicrotask(()=>tx.oncomplete?.())}})};return tx},close(){}};req.onsuccess?.()});return req}};
}

test('lost commit replies replay identical payloads and survive adapter reload without duplicate cash',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-save-')),store=new SqliteStore(path.join(directory,'test.sqlite'));await store.start();const project=await store.createProject('Save recovery');
 const app=createHttpApp({store,authMode:'local'});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.address().port,fetchOriginal=globalThis.fetch;
 const originals={indexedDB:globalThis.indexedDB,localStorage:globalThis.localStorage,BroadcastChannel:globalThis.BroadcastChannel,locks:globalThis.navigator.locks};
 const values=new Map(),requests=[];let lost=1;
 globalThis.indexedDB=browserStorage(values);globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};globalThis.BroadcastChannel=class{postMessage(){}};
 Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(name,fn)=>fn()}});
 globalThis.fetch=async(url,options)=>{const response=await fetchOriginal(base+url,options);if(url==='/api/v1/commit'){requests.push(options.body);if(lost-- >0)throw Error('Reply lost after commit')}return response};
 const source=(await readFile(new URL('../db.js',import.meta.url),'utf8')).replace("from './finance.js'",`from '${new URL('../finance.js',import.meta.url).href}'`);
 const load=async()=>import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+uid()).toString('base64'));
 try{
  let db=await load();await db.openDb();await db.selectProject(project.id);
  const payment=()=>({id:uid(),vendor:'A',amount:500,date:'2026-10-11'});
  await db.modify(s=>s.payments.push(payment()));assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.equal((await store.read()).payments.length,1);
  lost=2;await assert.rejects(()=>db.modify(s=>s.payments.push(payment())),e=>e.code==='SAVE_UNCERTAIN');assert.equal(db.hasPendingWrite(),true);assert.ok(values.get('pendingRemote'));
  db=await load();await db.openDb();assert.equal(db.hasPendingWrite(),true);
  await assert.rejects(()=>db.modify(s=>s.payments.push(payment())),e=>e.code==='SAVE_UNCERTAIN');
  lost=0;await db.retryPendingWrite();assert.equal(db.hasPendingWrite(),false);assert.equal((await store.read()).payments.length,2);assert.equal(values.has('pendingRemote'),false);
 }finally{
  globalThis.fetch=fetchOriginal;globalThis.indexedDB=originals.indexedDB;globalThis.localStorage=originals.localStorage;globalThis.BroadcastChannel=originals.BroadcastChannel;
  if(originals.locks===undefined)delete globalThis.navigator.locks;else Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:originals.locks});
  await new Promise(r=>app.close(r));await store.close();assert.ok(directory.startsWith(path.join(tmpdir(),'buildledger-save-')));await rm(directory,{recursive:true,force:true});
 }
});

test('local IndexedDB open retries after errors and version changes',async()=>{
 const fetchOriginal=globalThis.fetch,originals={indexedDB:globalThis.indexedDB,localStorage:globalThis.localStorage};
 const requests=[];globalThis.fetch=async()=>{throw Error('server offline')};
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.indexedDB={open(){const request={};requests.push(request);return request}};
 const source=(await readFile(new URL('../db.js',import.meta.url),'utf8')).replace("from './finance.js'",`from '${new URL('../finance.js',import.meta.url).href}'`);
 try{
  const db=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+uid()).toString('base64'));
  const openSuccess=(request)=>{const database={closed:false,createObjectStore(){},close(){this.closed=true}};request.result=database;request.onupgradeneeded?.({oldVersion:2});request.onsuccess?.();return database};
  const failed=db.openDb();await new Promise(resolve=>setImmediate(resolve));
  requests[0].error=Error('temporary failure');requests[0].onerror();await assert.rejects(failed,/temporary failure/);
  const retried=db.openDb();assert.equal(requests.length,2);const first=openSuccess(requests[1]);await retried;
  first.onversionchange();assert.equal(first.closed,true);
  const reopened=db.openDb();assert.equal(requests.length,3);openSuccess(requests[2]);await reopened;
 }finally{
  globalThis.fetch=fetchOriginal;globalThis.indexedDB=originals.indexedDB;globalThis.localStorage=originals.localStorage;
 }
});

test('blocked IndexedDB open closes if the old request later succeeds',async()=>{
 const fetchOriginal=globalThis.fetch,originals={indexedDB:globalThis.indexedDB,localStorage:globalThis.localStorage};
 const requests=[];globalThis.fetch=async()=>{throw Error('server offline')};
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.indexedDB={open(){const request={};requests.push(request);return request}};
 const source=(await readFile(new URL('../db.js',import.meta.url),'utf8')).replace("from './finance.js'",`from '${new URL('../finance.js',import.meta.url).href}'`);
 try{
  const db=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+uid()).toString('base64'));
  const openSuccess=(request)=>{const database={closed:false,createObjectStore(){},close(){this.closed=true}};request.result=database;request.onupgradeneeded?.({oldVersion:2});request.onsuccess?.();return database};
  const blocked=db.openDb();await new Promise(resolve=>setImmediate(resolve));requests[0].onblocked();await assert.rejects(blocked,/Close other app tabs/);
  const retry=db.openDb();assert.equal(requests.length,2);openSuccess(requests[1]);await retry;
  const late=openSuccess(requests[0]);assert.equal(late.closed,true);
 }finally{
  globalThis.fetch=fetchOriginal;globalThis.indexedDB=originals.indexedDB;globalThis.localStorage=originals.localStorage;
 }
});
