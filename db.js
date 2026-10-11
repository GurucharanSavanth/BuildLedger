import {emptyState,verifyState,validateRecordChanges,uid} from './finance.js';
const NAME='buildledger-web-v1';let dbPromise;let mode=null;let pendingWrite=null,pendingLoaded=false;
const API='/api/v1';
async function api(path,options={}){let response;try{response=await fetch(API+path,{credentials:'same-origin',cache:'no-store',...options})}catch{throw Error('Cannot reach BuildLedger server. Check your internet connection. A submitted save may already have completed.')}let obj;try{obj=await response.json()}catch{throw Error(`Unexpected server response (${response.status})`)}if(!response.ok){const e=Error(obj.message||'Server request failed');e.status=response.status;e.code=obj.code;throw e}return obj}
export function storageMode(){return mode||'checking'}
export async function loginRemote(password){return api('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})})}
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Storage failed'))})}
function wait(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted'));tx.onerror=()=>reject(tx.error||Error('Storage transaction failed'))})}
async function localDb(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open(NAME,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('main');d.createObjectStore('blobs',{keyPath:'id'})};r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>d.close();resolve(d)};r.onerror=()=>reject(r.error||Error('Cannot open local database'));r.onblocked=()=>reject(Error('Close other app tabs and retry'))});return dbPromise}
export async function openDb(){if(mode==='remote'){if(!pendingLoaded){const d=await localDb();pendingWrite=await request(d.transaction('main','readonly').objectStore('main').get('pendingRemote'))||null;pendingLoaded=true}const session=await api('/session');if(!session.authenticated){const e=Error('Sign in to unlock your project');e.code='NOT_SIGNED_IN';throw e}return true}if(mode==='local')return localDb();
 let res;try{res=await fetch(API+'/health',{credentials:'same-origin',cache:'no-store'})}catch{if(localStorage.getItem('buildledger_server_known')==='1')throw Error('BuildLedger server is currently unreachable; local-only changes are disabled to avoid split databases.');mode='local';return localDb()}
 if(res.ok){mode='remote';localStorage.setItem('buildledger_server_known','1');return openDb()}
 if(res.status===404){if(localStorage.getItem('buildledger_server_known')==='1')throw Error('Previously used server storage is unavailable at this address. Do not create another local copy.');mode='local';return localDb()}
 throw Error('The storage API is not available ('+res.status+').');
}
export async function readState(){if(mode==='remote')return await api('/state');const d=await localDb();return await request(d.transaction('main','readonly').objectStore('main').get('state'))||emptyState()}
export async function readFile(id){if(mode==='remote'){let res=await fetch(API+'/files/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});if(!res.ok)return undefined;return {id,blob:await res.blob()}}const d=await localDb();return await request(d.transaction('blobs','readonly').objectStore('blobs').get(id))}
export async function readAllFiles(){if(mode==='remote'){const st=await readState();const result=[];for(const f of st.files){const file=await readFile(f.id);if(!file)throw Error('Required file missing: '+f.name);result.push(file)}return result}const d=await localDb();return await request(d.transaction('blobs','readonly').objectStore('blobs').getAll())}
export async function readSnapshot(){if(mode==='remote'){const st=await readState();const files=[];for(const f of st.files){const object=await readFile(f.id);if(!object)throw Error('Original file is missing: '+f.name);files.push(object)}const latest=await readState();if(latest.rev!==st.rev)throw Error('Project changed while preparing backup. Please retry to capture a consistent snapshot.');return {state:st,files}}const d=await localDb();const tx=d.transaction(['main','blobs'],'readonly');const [st,files]=await Promise.all([request(tx.objectStore('main').get('state')),request(tx.objectStore('blobs').getAll())]);return {state:st||emptyState(),files}}
async function uploadFile(file,meta){if(file.blob.size!==meta.size)throw Error('Document size mismatch: '+meta.name);const sha=await crypto.subtle.digest('SHA-256',await file.blob.arrayBuffer());const actual=[...new Uint8Array(sha)].map(x=>x.toString(16).padStart(2,'0')).join('');if(actual!==meta.sha256)throw Error('Document checksum mismatch: '+meta.name);
 const start=await api('/uploads/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:meta.id,name:meta.name,size:meta.size,sha256:meta.sha256,type:meta.type||'application/octet-stream'})});
 for(let i=0;i<start.numChunks;i++){let data=await file.blob.slice(i*start.chunkBytes,(i+1)*start.chunkBytes).arrayBuffer();await api('/uploads/'+start.uploadId+'/chunks/'+i,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:data})}
 await api('/uploads/'+start.uploadId+'/complete',{method:'POST'});return {id:meta.id,uploadId:start.uploadId}
}
export function hasPendingWrite(){return Boolean(pendingWrite)}
async function rememberWrite(value){const d=await localDb(),tx=d.transaction('main','readwrite',{durability:'strict'}),done=wait(tx);if(value)tx.objectStore('main').put(value,'pendingRemote');else tx.objectStore('main').delete('pendingRemote');await done;pendingWrite=value}
function uncertainSave(){const e=Error('Save status is uncertain. Use Retry save to check the original request before adding another entry.');e.code='SAVE_UNCERTAIN';return e}
async function sendPendingWrite(){
 for(let attempt=0;attempt<2;attempt++){
  try{const result=await api('/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:pendingWrite});await rememberWrite(null);return result}
  catch(e){if(e.status&&e.status<500){if(e.status!==401)await rememberWrite(null);throw e}if(attempt===1)throw uncertainSave()}
 }
}
async function remoteWriteLock(fn){if(!navigator.locks)throw Error('Use a current browser with Web Locks for safe server saves.');return navigator.locks.request('buildledger-remote-write',async()=>{const d=await localDb();pendingWrite=await request(d.transaction('main','readonly').objectStore('main').get('pendingRemote'))||null;return fn()})}
export async function retryPendingWrite(){return remoteWriteLock(()=>pendingWrite?sendPendingWrite():undefined)}
async function remoteCommit(updated,{newFiles=[],removeFiles=[],replace=false}={},expectedRev){return remoteWriteLock(async()=>{
 if(pendingWrite)throw uncertainSave();
 verifyState(updated);updated.rev=expectedRev+1;const staged=[];
 for(const o of newFiles){const meta=updated.files.find(x=>x.id===o.id);if(!meta)throw Error('File not referenced in the project: '+o.id);staged.push(await uploadFile(o,meta))}
 const body=JSON.stringify({expectedRev,state:updated,newFiles:staged,removeFiles,replace,key:uid()});
 // Persist the exact request before posting so a lost response or reload cannot create a second entry.
 await rememberWrite(body);return sendPendingWrite();
})}
export async function modify(fn,{newFiles=[],removeFiles=[]}={}){if(mode==='remote'){const old=await readState();const updated=structuredClone(old);const result=fn(updated);validateRecordChanges(old,updated);await remoteCommit(updated,{newFiles,removeFiles},old.rev);try{new BroadcastChannel('buildledger-sync').postMessage({updated:true})}catch{}return result}
 const d=await localDb();const tx=d.transaction(['main','blobs'],'readwrite',{durability:'strict'});const finished=wait(tx);let result;try{const st=await request(tx.objectStore('main').get('state'))||emptyState();const updated=structuredClone(st);result=fn(updated);updated.rev=(st.rev||0)+1;verifyState(updated);validateRecordChanges(st,updated);tx.objectStore('main').put(updated,'state');for(const f of newFiles)tx.objectStore('blobs').put(f);for(const id of removeFiles)tx.objectStore('blobs').delete(id)}catch(err){try{tx.abort()}catch{};await finished.catch(()=>{});throw err}await finished;try{new BroadcastChannel('buildledger-sync').postMessage({updated:true})}catch{}return result}
export async function replaceAll(data,objects){verifyState(data);if(mode==='remote'){let old=await readState();let updated=structuredClone(data);await remoteCommit(updated,{replace:true,newFiles:objects},old.rev);try{new BroadcastChannel('buildledger-sync').postMessage({updated:true})}catch{}return}
 const d=await localDb();const tx=d.transaction(['main','blobs'],'readwrite',{durability:'strict'});const finished=wait(tx);try{tx.objectStore('main').put(data,'state');const files=tx.objectStore('blobs');files.clear();for(const obj of objects)files.put(obj)}catch(err){tx.abort();await finished.catch(()=>{});throw err}await finished;try{new BroadcastChannel('buildledger-sync').postMessage({updated:true})}catch{}}
