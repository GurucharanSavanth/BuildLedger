import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {SqliteStore} from '../server/sqlite-store.mjs';
import {createHttpApp} from '../server/http.mjs';
import {emptyState,uid} from '../finance.js';
import {packSnapshot} from '../archive.js';

// Substitute only browser settings/lock/uncertain-save storage; use real HTTP and SQLite for records and originals.
async function fixture(run){
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-owner-')),store=new SqliteStore(path.join(directory,'ledger.sqlite'));
 await store.start();const a=await store.createProject('Project A'),b=await store.createProject('Project B'),server=createHttpApp({store,authMode:'local'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const originals={fetch:globalThis.fetch,indexedDB:globalThis.indexedDB,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,BroadcastChannel:globalThis.BroadcastChannel,locks:globalThis.navigator.locks};
 const settings=new Map(),pending=new Map();let queued=Promise.resolve();
 const storage={getItem:key=>settings.get(key)||null,setItem:(key,value)=>settings.set(key,value),removeItem:key=>settings.delete(key)};
 globalThis.localStorage=storage;globalThis.sessionStorage=storage;globalThis.BroadcastChannel=class{postMessage(){}};
 globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={transaction(){const tx={objectStore:()=>({get(key){const r={};queueMicrotask(()=>{r.result=pending.get(key);r.onsuccess?.()});return r},put(value,key){pending.set(key,value);queueMicrotask(()=>tx.oncomplete?.())},delete(key){pending.delete(key);queueMicrotask(()=>tx.oncomplete?.())}})};return tx}};request.onsuccess?.()});return request}};
 Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:(_name,fn)=>{const next=queued.then(fn);queued=next.catch(()=>{});return next}}});
 globalThis.fetch=(url,options)=>originals.fetch(`http://127.0.0.1:${server.address().port}${url}`,options);
 const source=(await readFile(new URL('../db.js',import.meta.url),'utf8')).replace("from './finance.js'",`from '${new URL('../finance.js',import.meta.url).href}'`);
 const dbUrl='data:text/javascript;base64,'+Buffer.from(source+'\n// '+uid()).toString('base64'),db=await import(dbUrl);
 const archiveSource=(await readFile(new URL('../archive.js',import.meta.url),'utf8')).replace("from './db.js'",`from '${dbUrl}'`).replace("from './finance.js'",`from '${new URL('../finance.js',import.meta.url).href}'`);
 const archive=await import('data:text/javascript;base64,'+Buffer.from(archiveSource).toString('base64'));
 const reload=async()=>{const adapter=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+uid()).toString('base64'));await adapter.openDb();return adapter};
 try{await db.openDb();await db.selectProject(a.id);await run({db,archive,store,a,b,settings,pending,reload})}
 finally{for(const key of ['fetch','indexedDB','localStorage','sessionStorage','BroadcastChannel']){if(originals[key]===undefined)delete globalThis[key];else globalThis[key]=originals[key]}if(originals.locks===undefined)delete globalThis.navigator.locks;else Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:originals.locks});await new Promise(resolve=>server.close(resolve));await store.close();await rm(directory,{recursive:true,force:true})}
}
const note=title=>({id:uid(),kind:'note',title,date:'2026-10-24',notes:'Exact retained input',seconds:17});

test('adapter discards project responses received after successful sign-out',()=>fixture(async({db,a})=>{
 const previous=globalThis.fetch;let release;
 globalThis.fetch=async(url,options)=>{const response=await previous(url,options);if(url==='/api/v1/projects')return new Promise(resolve=>{release=()=>resolve(response)});return response};
 const loading=db.listProjects();await new Promise(resolve=>{const check=()=>release?resolve():setImmediate(check);check()});
 await db.logoutRemote();release();await assert.rejects(loading,error=>error.code==='NOT_SIGNED_IN');
 globalThis.fetch=previous;
}));

test('backup and snapshot capture owner before the first asynchronous read',()=>fixture(async({db,archive,store,a,b,settings})=>{
 await db.modify(state=>state.entries.push(note('Only A')),{projectId:a.id});
 const snapshot=db.readSnapshot();settings.set('buildledger_active_project',b.id);
 assert.equal((await snapshot).projectId,a.id);
 await db.selectProject(a.id);const backup=archive.createBackup('recovery-password');settings.set('buildledger_active_project',b.id);
 assert.equal((await archive.unpackSnapshot(await backup,'recovery-password')).state.entries[0].title,'Only A');
 assert.equal((await store.read(b.id)).entries.length,0);
}));

test('retained A file download cannot resolve B original after A deletion',()=>fixture(async({db,store,a,b})=>{
 const id=uid();
 async function insertOriginal(projectId,bytes,name){const blob=new Blob([bytes],{type:'application/octet-stream'}),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');await db.modify(state=>state.files.push({id,name,type:blob.type,size:bytes.length,sha256}),{projectId,newFiles:[{id,blob}]})}
 await insertOriginal(a.id,Uint8Array.from([65,65]),'A-original.bin');await insertOriginal(b.id,Uint8Array.from([66,66]),'B-original.bin');
 const stateA=await db.readState(a.id),source=await readFile(new URL('../app.js',import.meta.url),'utf8'),start=source.indexOf('async function downloadFile(id)'),end=source.indexOf('async function openFileTab(id)',start);
 assert.ok(start>=0&&end>start);
 let downloaded;const download=new Function('state','selectedProject','readFile','downloadBlob','sessionGeneration','return ('+source.slice(start,end)+')')(stateA,a.id,db.readFile,(blob,name)=>{downloaded={blob,name}},0);
 await store.deleteProject(a.id);assert.equal(await db.activeProjectId(),b.id);
 await assert.rejects(()=>download(id),/missing|not found|exist/i);assert.equal(downloaded,undefined);
 const preserved=await db.readFile(id,b.id);assert.deepEqual(new Uint8Array(await preserved.blob.arrayBuffer()),Uint8Array.from([66,66]));
}));

test('restore captures A before decryption even when the UI switches to B',()=>fixture(async({db,archive,store,a,b})=>{
 const state=emptyState();state.project.name='Restored A';state.entries.push(note('A backup'));
 const zip=await packSnapshot(state,[],'recovery-password');let release;
 const delayed={arrayBuffer:()=>new Promise(resolve=>{release=async()=>resolve(await zip.arrayBuffer())})};
 const restoring=archive.restoreBackup(delayed,'recovery-password');
 await db.selectProject(b.id);await release();await restoring;
 assert.equal((await store.read(a.id)).entries[0]?.title,'A backup');
 assert.equal((await store.read(b.id)).entries.length,0);
 assert.equal(await db.activeProjectId(),b.id);
}));

test('deleted restore owner rejects without fallback or changing B',()=>fixture(async({db,archive,store,a,b})=>{
 const state=emptyState();state.entries.push(note('Recoverable source'));
 const zip=await packSnapshot(state,[],'recovery-password');let release;
 const restoring=archive.restoreBackup({arrayBuffer:()=>new Promise(resolve=>{release=async()=>resolve(await zip.arrayBuffer())})},'recovery-password');
 await store.deleteProject(a.id);await db.selectProject(b.id);await release();
 await assert.rejects(restoring,/exist|found/i);
 assert.equal((await store.read(b.id)).entries.length,0);
 assert.equal((await archive.unpackSnapshot(zip,'recovery-password')).state.entries[0].title,'Recoverable source');
}));

test('retained A draft cannot be committed to B after A is deleted',()=>fixture(async({db,store,a,b})=>{
 const draft=note('A draft');await store.deleteProject(a.id);await db.selectProject(b.id);
 await assert.rejects(()=>db.modify(state=>state.entries.push(draft),{projectId:a.id}),/exist|found/i);
 assert.equal((await store.read(b.id)).entries.length,0);assert.equal(draft.notes,'Exact retained input');
}));

test('restore rejects a concurrent destination save instead of overwriting newer records',()=>fixture(async({db,archive,store,a})=>{
 const source=emptyState();source.entries=[note('Backup history')];const zip=await packSnapshot(source,[],'recovery-password');let release;
 const fetchBefore=globalThis.fetch;let captured;const destinationRead=new Promise(resolve=>{captured=resolve});
 globalThis.fetch=async(url,options)=>{const response=await fetchBefore(url,options);if(String(url).startsWith('/api/v1/state?'))captured();return response};
 const restoring=archive.restoreBackup({arrayBuffer:()=>new Promise(resolve=>{release=async()=>resolve(await zip.arrayBuffer())})},'recovery-password');
 await destinationRead;globalThis.fetch=fetchBefore;
 await db.modify(state=>state.entries.push(note('Newer committed work')),{projectId:a.id});
 await release();await assert.rejects(restoring,/changed/i);
 assert.deepEqual((await store.read(a.id)).entries.map(record=>record.title),['Newer committed work']);
}));

test('concurrent explicit owners stay isolated through project switching',()=>fixture(async({db,store,a,b})=>{
 const first=db.modify(state=>state.entries.push(note('A save')),{projectId:a.id});
 await db.selectProject(b.id);
 const second=db.modify(state=>state.entries.push(note('B save')),{projectId:b.id});await Promise.all([first,second]);
 assert.deepEqual((await store.read(a.id)).entries.map(n=>n.title),['A save']);
 assert.deepEqual((await store.read(b.id)).entries.map(n=>n.title),['B save']);
}));

test('uncertain save reopens and retries its captured owner while B remains selected',()=>fixture(async({db,store,a,b,reload})=>{
 const fetchBefore=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{const response=await fetchBefore(url,options);if(url==='/api/v1/commit')throw Error('Reply lost after durable commit');return response};
 await assert.rejects(()=>db.modify(state=>state.entries.push(note('Interrupted A save')),{projectId:a.id}),error=>error.code==='SAVE_UNCERTAIN');
 await db.selectProject(b.id);globalThis.fetch=fetchBefore;
 const reopened=await reload();assert.equal(reopened.hasPendingWrite(),true);await reopened.retryPendingWrite();
 assert.equal(reopened.hasPendingWrite(),false);assert.equal(await reopened.activeProjectId(),b.id);
 assert.deepEqual((await store.read(a.id)).entries.map(record=>record.title),['Interrupted A save']);
 assert.equal((await store.read(b.id)).entries.length,0);
}));

test('real adapter uploads and retrieves exact original bytes through the API route',()=>fixture(async({db,a})=>{
 const bytes=Uint8Array.from([0,255,13,10,42,128]),id=uid(),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 await db.modify(state=>state.files.push({id,name:'original.dat',type:'application/octet-stream',size:bytes.length,sha256}),{projectId:a.id,newFiles:[{id,blob:new Blob([bytes])}]});
 const original=await db.readFile(id,a.id);assert.ok(original?.blob);assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()),bytes);
}));

test('deleted owner rejection retains exact unsubmitted financial input across adapter reload until explicit discard',()=>fixture(async({db,store,a,b,pending,reload})=>{
 const fetchBefore=globalThis.fetch,payment={id:uid(),vendor:'Synthetic supplier',amount:42567,date:'2026-10-25',notes:'Keep this exact unsubmitted financial note'};let attempts=0;
 globalThis.fetch=async(url,options)=>{if(url==='/api/v1/commit'){attempts++;throw Error('Connection failed before request was sent')}return fetchBefore(url,options)};
 await assert.rejects(()=>db.modify(state=>state.payments.push(payment),{projectId:a.id}),error=>error.code==='SAVE_UNCERTAIN');
 assert.equal(attempts,2);assert.equal((await store.read(a.id)).payments.length,0);
 const retained=pending.get('pendingRemote');assert.ok(retained);globalThis.fetch=fetchBefore;
 const reopened=await reload(),deleted=await fetchBefore('/api/v1/projects/'+a.id,{method:'DELETE'});assert.equal(deleted.status,200);await deleted.json();
 await reopened.selectProject(b.id);await assert.rejects(()=>reopened.retryPendingWrite(),error=>error.status===404);
 assert.ok(pending.get('pendingRemote')===retained,'Rejected writes retain the complete recovery payload');
 const restarted=await reload();assert.equal(restarted.hasPendingWrite(),true);assert.equal(restarted.pendingWriteSnapshot(),retained);
 const recovery=JSON.parse(restarted.pendingWriteSnapshot());assert.equal(recovery.projectId,a.id);assert.equal(recovery.state.payments[0].amount,42567);assert.equal(recovery.state.payments[0].notes,payment.notes);
 await assert.rejects(()=>restarted.modify(state=>state.payments.push({...payment,id:uid()}),{projectId:b.id}),error=>error.code==='SAVE_UNCERTAIN');
 assert.equal((await store.read(b.id)).payments.length,0);
 await assert.rejects(()=>restarted.discardPendingWrite(retained+' '),/changed|review/i);assert.equal(restarted.pendingWriteSnapshot(),retained);
 assert.equal(await restarted.discardPendingWrite(retained),true);assert.equal(restarted.hasPendingWrite(),false);assert.equal(pending.has('pendingRemote'),false);
 assert.equal(await restarted.retryPendingWrite(),undefined,'An already resolved request must not claim a verified save');
 await restarted.modify(state=>state.payments.push({...payment,id:uid()}),{projectId:b.id});assert.equal((await store.read(b.id)).payments[0].amount,42567);
}));

test('discard reloads the durable payload under the cross-tab lock and cannot erase a newer save',()=>fixture(async({db,a,b,pending,reload})=>{
 const fetchBefore=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{if(url==='/api/v1/commit')throw Error('Request not sent');return fetchBefore(url,options)};
 await assert.rejects(()=>db.modify(state=>state.entries.push(note('First retained save')),{projectId:a.id}),error=>error.code==='SAVE_UNCERTAIN');
 const first=pending.get('pendingRemote'),other=await reload();assert.equal(await other.discardPendingWrite(first),true);
 await assert.rejects(()=>other.modify(state=>state.payments.push({id:uid(),vendor:'New supplier',amount:65432,date:'2026-10-25'}),{projectId:b.id}),error=>error.code==='SAVE_UNCERTAIN');
 const newer=pending.get('pendingRemote');assert.notEqual(first,newer);
 await assert.rejects(()=>db.discardPendingWrite(first),/changed|review/i);assert.equal(pending.get('pendingRemote'),newer);assert.equal(db.pendingWriteSnapshot(),newer);
 globalThis.fetch=fetchBefore;
}));

test('a definitive rejected save keeps its reviewed form visible and exposes retained recovery',()=>fixture(async({db,a,pending})=>{
 const fetchBefore=globalThis.fetch;let changed=false,closed=0,banners=0;
 globalThis.fetch=async(url,options)=>{
  if(url==='/api/v1/commit'&&!changed){changed=true;const response=await fetchBefore('/api/v1/projects/'+a.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Concurrent project edit',budget:0,expectedRev:0})});assert.equal(response.status,200);await response.json()}
  return fetchBefore(url,options);
 };
 const payment={id:uid(),vendor:'Synthetic supplier',amount:42567,date:'2026-10-25',notes:'Keep reviewed input'},source=await readFile(new URL('../app.js',import.meta.url),'utf8'),commit=source.slice(source.indexOf('async function commit('),source.indexOf('\nfunction showPendingSave'));
 const context=vm.createContext({sessionGeneration:0,selectedProject:a.id,pending:payment,payment,modify:db.modify,hasPendingWrite:db.hasPendingWrite,closeModal(){closed++},showPendingSave(){banners++},refresh:async()=>{},toast(){}});
 vm.runInContext(commit,context);await assert.rejects(()=>vm.runInContext('commit(state=>state.payments.push(payment))',context),error=>error.status===409);
 assert.ok(pending.get('pendingRemote'));assert.equal(context.pending,payment);assert.equal(closed,0);assert.equal(banners,1);
 globalThis.fetch=fetchBefore;
}));

test('new original bytes survive rejected owner deletion and are cleared only with the matching retained request',()=>fixture(async({db,store,a,b,pending,reload})=>{
 const fetchBefore=globalThis.fetch,bytes=Uint8Array.from([0,255,13,10,42]),id=uid(),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 globalThis.fetch=async(url,options)=>{if(url==='/api/v1/commit')throw Error('Commit request not sent');return fetchBefore(url,options)};
 await assert.rejects(()=>db.modify(state=>{state.payments.push({id:uid(),vendor:'Synthetic',amount:42567,date:'2026-10-25'});state.files.push({id,name:'Only-new-original.bin',size:bytes.length,type:'application/octet-stream',sha256})},{projectId:a.id,newFiles:[{id,blob:new Blob([bytes])}]}),error=>error.code==='SAVE_UNCERTAIN');
 const payload=pending.get('pendingRemote'),uploadId=JSON.parse(payload).newFiles[0].uploadId;globalThis.fetch=fetchBefore;
 const deleted=await fetchBefore('/api/v1/projects/'+a.id,{method:'DELETE'});assert.equal(deleted.status,200);await deleted.json();
 assert.equal(store.db.prepare('SELECT count(*) n FROM file_chunks WHERE upload_id=?').get(uploadId).n,0);
 const reopened=await reload();await reopened.selectProject(b.id);await assert.rejects(()=>reopened.retryPendingWrite(),error=>error.status===404);
 const originals=await reopened.readPendingOriginals(payload);assert.equal(originals.length,1);assert.equal(originals[0].id,id);assert.deepEqual(new Uint8Array(await originals[0].blob.arrayBuffer()),bytes);
 await assert.rejects(()=>reopened.discardPendingWrite(payload+' '),/changed|review/i);assert.equal(pending.get('pendingRemoteOriginals').length,1);
 assert.equal(await reopened.discardPendingWrite(payload),true);assert.equal(pending.has('pendingRemoteOriginals'),false);assert.equal(pending.has('pendingRemote'),false);assert.equal((await store.read(b.id)).files.length,0);
}));

test('verified identical replay clears cached new originals without duplicate records or changing original bytes',()=>fixture(async({db,store,a,pending,reload})=>{
 const fetchBefore=globalThis.fetch,bytes=Uint8Array.from([17,0,255,42]),id=uid(),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 globalThis.fetch=async(url,options)=>{const response=await fetchBefore(url,options);if(url==='/api/v1/commit')throw Error('Reply lost after commit');return response};
 await assert.rejects(()=>db.modify(state=>state.files.push({id,name:'Committed original.bin',size:bytes.length,type:'application/octet-stream',sha256}),{projectId:a.id,newFiles:[{id,blob:new Blob([bytes])}]}),error=>error.code==='SAVE_UNCERTAIN');
 assert.equal((await store.read(a.id)).files.length,1);assert.equal(pending.get('pendingRemoteOriginals').length,1);globalThis.fetch=fetchBefore;
 const reopened=await reload();assert.equal((await reopened.retryPendingWrite()).ok,true);
 assert.equal(pending.has('pendingRemote'),false);assert.equal(pending.has('pendingRemoteOriginals'),false);assert.equal((await store.read(a.id)).files.length,1);
 const original=await reopened.readFile(id,a.id);assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()),bytes);
}));

