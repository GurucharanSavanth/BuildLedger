/**
 * Persistent, single-owner BuildLedger SQLite store.
 * No third-party dependency. Node.js >=22.13 node:sqlite.
 * SQLite project rows, original binary chunks, idempotency keys, and finance records
 * share one ACID transaction for each confirmed write.
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdir, chmod} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CHUNK_SIZE,MAX_FILE_SIZE,sha256,validId,checkState,matchFile,failure,startupState} from './core.mjs';
import {validateFileMutation} from './invariants.mjs';
import {appendDomain} from './domain.mjs';
import {validateRecordChanges} from '../finance.js';
const KINDS=['bills','payments','allocations','plans','contracts','entries','files','audit'];
function asInt(n){return Number(n)}
export class SqliteStore{
 constructor(filename='./data/buildledger.sqlite'){this.filename=path.resolve(filename);this.db=null}
 async start(){await mkdir(path.dirname(this.filename),{recursive:true,mode:0o700});this.db=new DatabaseSync(this.filename,{timeout:5000});
  try{await chmod(this.filename,0o600)}catch{}
  this.db.exec(`
 PRAGMA journal_mode=WAL;
 PRAGMA synchronous=FULL;
 PRAGMA foreign_keys=ON;
 PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK(id=1),rev INTEGER NOT NULL CHECK(rev>=0),schema_version INTEGER NOT NULL,project_json TEXT NOT NULL,settings_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, record_id TEXT NOT NULL, position INTEGER NOT NULL, event_date TEXT, counterparty TEXT, doc_json TEXT NOT NULL, PRIMARY KEY(kind,record_id));
 CREATE INDEX IF NOT EXISTS idx_records_kind_position ON records(kind,position);
 CREATE INDEX IF NOT EXISTS idx_records_event ON records(kind,event_date);
 CREATE INDEX IF NOT EXISTS idx_records_party ON records(kind,counterparty);
 CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, file_id TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL, filename TEXT NOT NULL, chunks INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS file_chunks (upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),chunk_sha256 TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(upload_id,chunk_index));
 CREATE TABLE IF NOT EXISTS assets (file_id TEXT PRIMARY KEY, upload_id TEXT UNIQUE NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS operations (idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS schema_info (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
 INSERT OR IGNORE INTO schema_info(id,version) VALUES(1,1);
 `);
  if(!this.db.prepare('SELECT id FROM project WHERE id=1').get()){
   const st=startupState();this.db.prepare('INSERT INTO project (id,rev,schema_version,project_json,settings_json) VALUES(1,?,?,?,?)').run(0,st.schema,JSON.stringify(st.project),JSON.stringify(st.settings));
  }
 }
 async close(){this.db?.close();this.db=null}
 async health(){try{return this.db?.prepare('PRAGMA quick_check').get()?.quick_check==='ok'}catch{return false}}
 async read(){if(!this.db)throw failure(503,'Database is not available');this.db.exec('BEGIN DEFERRED');try{const out=this.readSync();this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}
 readSync(){const meta=this.db.prepare('SELECT * FROM project WHERE id=1').get();if(!meta)throw failure(503,'Project database missing');const st={schema:asInt(meta.schema_version),project:JSON.parse(meta.project_json),settings:JSON.parse(meta.settings_json),rev:asInt(meta.rev)};
  for(const k of KINDS)st[k]=[];
  for(const row of this.db.prepare('SELECT kind,doc_json FROM records ORDER BY kind, position').iterate()){if(st[row.kind])st[row.kind].push(JSON.parse(row.doc_json))}
  return st;
 }
 async startUpload(meta){if(!meta||!validId(meta.id)||!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>MAX_FILE_SIZE)throw failure(400,'Invalid upload metadata');
  const uploadId=randomUUID(),numChunks=Math.ceil(meta.size/CHUNK_SIZE);
  this.db.prepare('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?)').run(uploadId,meta.id,meta.size,meta.sha256,String(meta.type||'application/octet-stream').slice(0,180),String(meta.name||'document').slice(0,180),numChunks,0,Date.now());
  return {uploadId,chunkBytes:CHUNK_SIZE,numChunks};
 }
 async putChunk(id,n,bytes){const u=this.db.prepare('SELECT * FROM uploads WHERE id=?').get(id);if(!u||u.verified)throw failure(404,'Upload not found or already complete');if(!Number.isSafeInteger(n)||n<0||n>=u.chunks)throw failure(400,'Invalid chunk index');const expected=n===u.chunks-1?u.size_bytes-n*CHUNK_SIZE:CHUNK_SIZE;if(bytes.length!==expected)throw failure(400,'Unexpected chunk size');const hash=sha256(bytes);
  const prior=this.db.prepare('SELECT chunk_sha256 FROM file_chunks WHERE upload_id=? AND chunk_index=?').get(id,n);
  if(prior){if(prior.chunk_sha256!==hash)throw failure(409,'Chunk already uploaded with different content');return}
  this.db.prepare('INSERT INTO file_chunks(upload_id,chunk_index,chunk_sha256,data) VALUES(?,?,?,?)').run(id,n,hash,bytes);
 }
 async finishUpload(id){const u=this.db.prepare('SELECT * FROM uploads WHERE id=?').get(id);if(!u)throw failure(404,'Upload not found');if(u.verified)return {verified:true};const hash=createHash('sha256');let size=0,i=0;for(const r of this.db.prepare('SELECT chunk_index,data FROM file_chunks WHERE upload_id=? ORDER BY chunk_index').iterate(id)){if(r.chunk_index!==i++)throw failure(422,'Missing file chunk');hash.update(r.data);size+=r.data.length}
  if(i!==u.chunks||size!==u.size_bytes||hash.digest('hex')!==u.sha256)throw failure(422,'Original file failed checksum verification');this.db.prepare('UPDATE uploads SET verified=1 WHERE id=?').run(id);return {verified:true};
 }
 async postDomain(type,record,allocations=[],key){
  if(!validId(key))throw failure(400,'Invalid idempotency key');
  const canonical={op:'typed-record',type,record,allocations};
  const digest=sha256(Buffer.from(JSON.stringify(canonical)));
  const prior=this.db.prepare('SELECT request_hash,response_json FROM operations WHERE idempotency_key=?').get(key);
  if(prior){if(prior.request_hash!==digest)throw failure(409,'Idempotency key reused with different data');return JSON.parse(prior.response_json)}
  const old=this.readSync();const state=appendDomain(old,type,record,allocations);
  return this.commit({expectedRev:old.rev,state,newFiles:[],removeFiles:[],key},canonical);
 }
 async commit({expectedRev,state,newFiles=[],removeFiles=[],key,replace=false},canonical=null){
  if(!validId(key))throw failure(400,'Invalid idempotency key');try{checkState(state)}catch(e){throw failure(422,e.message,'VALIDATION_ERROR')}
  if(!Number.isSafeInteger(expectedRev)||expectedRev<0||state.rev!==expectedRev+1)throw failure(422,'Invalid expected revision');
  const digest=sha256(Buffer.from(JSON.stringify(canonical??{expectedRev,state,newFiles,removeFiles,replace})));
  this.db.exec('BEGIN IMMEDIATE');try{
   const cached=this.db.prepare('SELECT request_hash,response_json FROM operations WHERE idempotency_key=?').get(key);
   if(cached){if(cached.request_hash!==digest)throw failure(409,'Idempotency key reused with different data');this.db.exec('COMMIT');return JSON.parse(cached.response_json)}
   const current=this.db.prepare('SELECT rev FROM project WHERE id=1').get();if(current.rev!==expectedRev)throw failure(409,'The project has changed. Reload and try again.','VERSION_CONFLICT');
   const prior=this.readSync();validateFileMutation(prior,state,newFiles,removeFiles,replace);try{validateRecordChanges(prior,state,replace)}catch(e){throw failure(422,e.message,'VALIDATION_ERROR')}
   const uploaded=new Set();for(const f of newFiles){if(uploaded.has(f.uploadId))throw failure(422,'Upload used twice');uploaded.add(f.uploadId);const meta=state.files.find(x=>x.id===f.id);const up=this.db.prepare('SELECT * FROM uploads WHERE id=?').get(f.uploadId);if(!up||up.verified!==1||!matchFile(meta,{id:up.file_id,size:up.size_bytes,sha256:up.sha256,type:up.mime}))throw failure(422,'Uploaded original does not match file metadata');if(this.db.prepare('SELECT file_id FROM assets WHERE file_id=?').get(f.id)&&!replace)throw failure(409,'File already exists, upload a new revision')}
   const deletion=replace?prior.files.map(x=>x.id):removeFiles;
   for(const id of deletion){const a=this.db.prepare('SELECT upload_id FROM assets WHERE file_id=?').get(id);this.db.prepare('DELETE FROM assets WHERE file_id=?').run(id);if(a){this.db.prepare('DELETE FROM file_chunks WHERE upload_id=?').run(a.upload_id);this.db.prepare('DELETE FROM uploads WHERE id=?').run(a.upload_id)}}
   for(const f of newFiles){const u=this.db.prepare('SELECT * FROM uploads WHERE id=?').get(f.uploadId);this.db.prepare('INSERT INTO assets(file_id,upload_id,filename,mime,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(f.id,f.uploadId,u.filename,u.mime,u.size_bytes,u.sha256,Date.now())}
   // The normalized typed records are authoritative; no unvalidated parallel JSON database.
   const update=this.db.prepare('INSERT INTO records(kind,record_id,position,event_date,counterparty,doc_json) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,record_id) DO UPDATE SET position=excluded.position,event_date=excluded.event_date,counterparty=excluded.counterparty,doc_json=excluded.doc_json');
   const removeRecord=this.db.prepare('DELETE FROM records WHERE kind=? AND record_id=?');
   for(const kind of KINDS){const wanted=state[kind],keep=new Set(wanted.map(x=>x.id));for(const item of prior[kind])if(!keep.has(item.id))removeRecord.run(kind,item.id);
    for(const [pos,r] of wanted.entries()){const date=String(r.date||r.due||r.recordedAt||r.importedAt||'').slice(0,32),party=String(r.vendor||r.party||r.category||'').slice(0,255);update.run(kind,r.id,pos,date,party,JSON.stringify(r))}}
   const affected=this.db.prepare('UPDATE project SET rev=?, schema_version=?,project_json=?,settings_json=? WHERE id=1 AND rev=?').run(state.rev,state.schema,JSON.stringify(state.project),JSON.stringify(state.settings),expectedRev);
   if(affected.changes!==1)throw failure(409,'The project was modified while posting','VERSION_CONFLICT');
   const response={ok:true,rev:state.rev};this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(key,digest,JSON.stringify(response),Date.now());
   this.db.exec('COMMIT');return response;
  }catch(err){this.db.exec('ROLLBACK');throw err}
 }
 async asset(id){if(!validId(id))return null;let x=this.db.prepare('SELECT * FROM assets WHERE file_id=?').get(id);return x?{id:x.file_id,uploadId:x.upload_id,name:x.filename,size:Number(x.size_bytes),type:x.mime,sha256:x.sha256}:null}
 async *fileStream(id){const meta=await this.asset(id);if(!meta)throw failure(404,'Original file not found');const h=createHash('sha256');let size=0,index=0;
  for(const c of this.db.prepare('SELECT chunk_index,data FROM file_chunks WHERE upload_id=? ORDER BY chunk_index').iterate(meta.uploadId)){if(c.chunk_index!==index++)throw failure(500,'Missing original chunk');let bytes=Buffer.from(c.data);size+=bytes.length;h.update(bytes);yield bytes}
  if(size!==meta.size||h.digest('hex')!==meta.sha256)throw failure(500,'Original document integrity error');
 }
 async removeOrphans(){const cutoff=Date.now()-72*3600*1000;const expired=this.db.prepare('SELECT id FROM uploads WHERE created_at < ? AND id NOT IN (SELECT upload_id FROM assets)').all(cutoff);this.db.exec('BEGIN IMMEDIATE');try{for(const u of expired){this.db.prepare('DELETE FROM file_chunks WHERE upload_id=?').run(u.id);this.db.prepare('DELETE FROM uploads WHERE id=?').run(u.id)}this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}return expired.length}
}
