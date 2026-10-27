/**
 * Persistent, single-owner BuildLedger SQLite store.
 * No third-party dependency. Node.js >=22.13 node:sqlite.
 * SQLite project rows, original binary chunks, idempotency keys, and finance records
 * share one ACID transaction for each confirmed write.
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdir, chmod,mkdtemp,open,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CHUNK_SIZE,MAX_FILE_SIZE,sha256,validId,checkState,matchFile,failure,startupState} from './core.mjs';
import {validateFileMutation} from './invariants.mjs';
import {appendDomain,activityOptions} from './domain.mjs';
import {validateRecordChanges,activityEvent,activitySearch,activityTime} from '../finance.js';
const KINDS=['bills','payments','allocations','plans','contracts','entries','files','audit'];
const LEGACY_PROJECT='legacy-project';
function asInt(n){return Number(n)}
export class SqliteStore{
 constructor(filename='./data/buildledger.sqlite'){this.filename=path.resolve(filename);this.db=null}
 async start(){await mkdir(path.dirname(this.filename),{recursive:true,mode:0o700});this.db=new DatabaseSync(this.filename,{timeout:5000});
  this.db.function('activity_time',{deterministic:true},(kind,json)=>activityTime(activityEvent(kind,JSON.parse(json)).at));
  this.db.function('activity_kind',{deterministic:true},(kind,json)=>activityEvent(kind,JSON.parse(json)).kind||'');
  this.db.function('activity_search',{deterministic:true},(kind,json,bill,payment)=>activitySearch(activityEvent(kind,JSON.parse(json),{bill:bill?JSON.parse(bill):undefined,payment:payment?JSON.parse(payment):undefined})));
  try{await chmod(this.filename,0o600)}catch{}
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const exists=name=>Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const columns=name=>exists(name)?this.db.prepare(`PRAGMA table_info(${name})`).all().map(row=>row.name):[];
  const legacy=exists('project'),version=exists('schema_info')?Number(this.db.prepare('SELECT version FROM schema_info WHERE id=1').get()?.version||1):0;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,rev INTEGER NOT NULL CHECK(rev>=0),schema_version INTEGER NOT NULL,project_json TEXT NOT NULL,settings_json TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (idempotency_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,response_json TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS file_chunks (upload_id TEXT NOT NULL,chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),chunk_sha256 TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(upload_id,chunk_index));
    CREATE TABLE IF NOT EXISTS schema_info (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);`);
   if(!exists('uploads'))this.db.exec("CREATE TABLE uploads (id TEXT PRIMARY KEY,file_id TEXT NOT NULL,project_id TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,filename TEXT NOT NULL,chunks INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)");
   else if(!columns('uploads').includes('project_id'))this.db.exec(`ALTER TABLE uploads ADD COLUMN project_id TEXT NOT NULL DEFAULT '${LEGACY_PROJECT}'`);
   if(!exists('records'))this.db.exec('CREATE TABLE records (project_id TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,position INTEGER NOT NULL,event_date TEXT,counterparty TEXT,doc_json TEXT NOT NULL,PRIMARY KEY(project_id,kind,record_id))');
   else if(!columns('records').includes('project_id')){
    this.db.exec('DROP INDEX IF EXISTS idx_records_kind_position; DROP INDEX IF EXISTS idx_records_event; DROP INDEX IF EXISTS idx_records_party; DROP INDEX IF EXISTS idx_records_activity; DROP INDEX IF EXISTS idx_records_activity_type; DROP INDEX IF EXISTS idx_records_plan_payment; ALTER TABLE records RENAME TO records_v1; CREATE TABLE records (project_id TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,position INTEGER NOT NULL,event_date TEXT,counterparty TEXT,doc_json TEXT NOT NULL,PRIMARY KEY(project_id,kind,record_id));');
    if(legacy&&this.db.prepare('SELECT 1 FROM project WHERE id=1').get())this.db.exec(`INSERT INTO records(project_id,kind,record_id,position,event_date,counterparty,doc_json) SELECT '${LEGACY_PROJECT}',kind,record_id,position,event_date,counterparty,doc_json FROM records_v1`);
    else if(this.db.prepare('SELECT count(*) AS n FROM records_v1').get().n)throw Error('Legacy records exist without their project metadata; migration stopped to protect data.');
    this.db.exec('DROP TABLE records_v1');
   }
   if(!exists('assets'))this.db.exec('CREATE TABLE assets (project_id TEXT NOT NULL,file_id TEXT NOT NULL,upload_id TEXT UNIQUE NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(project_id,file_id))');
   else if(!columns('assets').includes('project_id')){
    this.db.exec('ALTER TABLE assets RENAME TO assets_v1; CREATE TABLE assets (project_id TEXT NOT NULL,file_id TEXT NOT NULL,upload_id TEXT UNIQUE NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(project_id,file_id));');
    if(legacy&&this.db.prepare('SELECT 1 FROM project WHERE id=1').get())this.db.exec(`INSERT INTO assets(project_id,file_id,upload_id,filename,mime,size_bytes,sha256,created_at) SELECT '${LEGACY_PROJECT}',file_id,upload_id,filename,mime,size_bytes,sha256,created_at FROM assets_v1`);
    else if(this.db.prepare('SELECT count(*) AS n FROM assets_v1').get().n)throw Error('Legacy attachments exist without their project metadata; migration stopped to protect data.');
    this.db.exec('DROP TABLE assets_v1');
   }
   if(legacy&&version<2){
    const old=this.db.prepare('SELECT * FROM project WHERE id=1').get();
    if(old){this.db.prepare('INSERT OR IGNORE INTO projects(id,rev,schema_version,project_json,settings_json,archived,created_at) VALUES(?,?,?,?,?,0,?)').run(LEGACY_PROJECT,old.rev,old.schema_version,old.project_json,old.settings_json,Date.now());
     this.db.prepare('UPDATE records SET project_id=? WHERE project_id IS NULL OR project_id=?').run(LEGACY_PROJECT,'');
     this.db.prepare('UPDATE assets SET project_id=? WHERE project_id IS NULL OR project_id=?').run(LEGACY_PROJECT,'');
     this.db.prepare('UPDATE uploads SET project_id=? WHERE project_id IS NULL OR project_id=?').run(LEGACY_PROJECT,'');
    }
   }
   this.db.exec(`CREATE INDEX IF NOT EXISTS idx_records_kind_position ON records(project_id,kind,position);
    CREATE INDEX IF NOT EXISTS idx_records_event ON records(project_id,kind,event_date);
    CREATE INDEX IF NOT EXISTS idx_records_party ON records(project_id,kind,counterparty);
    CREATE INDEX IF NOT EXISTS idx_records_activity ON records(project_id,activity_time(kind,doc_json) DESC,activity_kind(kind,doc_json),record_id);
    CREATE INDEX IF NOT EXISTS idx_records_activity_type ON records(project_id,activity_kind(kind,doc_json),activity_time(kind,doc_json) DESC,record_id);
    CREATE INDEX IF NOT EXISTS idx_records_plan_payment ON records(project_id,json_extract(doc_json,'$.planId')) WHERE kind='payments';
    CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
    INSERT OR IGNORE INTO schema_info(id,version) VALUES(1,2); UPDATE schema_info SET version=2 WHERE id=1;`);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error}
 }
 async close(){this.db?.close();this.db=null}
 async health(){try{return this.db?.prepare('PRAGMA quick_check').get()?.quick_check==='ok'}catch{return false}}
 projectId(value){if(value==null){const projects=this.db.prepare("SELECT id FROM projects ORDER BY archived,lower(json_extract(project_json,'$.name')),id").all();if(projects.length===1)return projects[0].id;return null}if(!validId(value))throw failure(400,'Invalid project identifier');return value}
 async listProjects(){return this.db.prepare("SELECT id,json_extract(project_json,'$.name') AS name,coalesce(json_extract(project_json,'$.budget'),0) AS budget,archived,rev FROM projects ORDER BY archived,lower(name),id").all().map(row=>({...row,budget:Number(row.budget),archived:Boolean(row.archived),rev:asInt(row.rev)}))}
 async createProject(name){if(typeof name!=='string'||!name.trim()||name.trim().length>160||/[\u0000-\u001f\u007f]/.test(name))throw failure(422,'Enter a project name of 1 to 160 characters.');const id=randomUUID(),state=startupState();state.project.name=name.trim();this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO projects(id,rev,schema_version,project_json,settings_json,created_at) VALUES(?,?,?,?,?,?)').run(id,0,state.schema,JSON.stringify(state.project),JSON.stringify(state.settings),Date.now());this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}return {id,name:state.project.name,budget:0,archived:false,rev:0}}
 async updateProject(id,{name,budget,expectedRev}){
  id=this.projectId(id);if(!id)throw failure(404,'Project not found');
  if(typeof name!=='string'||!name.trim()||name.trim().length>160||/[\u0000-\u001f\u007f]/.test(name)||!Number.isSafeInteger(budget)||budget<0)throw failure(422,'Invalid project name or budget.');
  if(!Number.isSafeInteger(expectedRev)||expectedRev<0)throw failure(422,'Project revision is required.');
  this.db.exec('BEGIN IMMEDIATE');try{
   const row=this.db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!row)throw failure(404,'Project not found');
   if(asInt(row.rev)!==expectedRev)throw failure(409,'Project changed. Reopen settings before saving.','VERSION_CONFLICT');
   const state=this.readSync(id),meta=state.project;meta.name=name.trim();meta.budget=budget;state.rev=asInt(row.rev)+1;
   const audit={id:randomUUID(),type:'project_update',description:'Updated project settings',linked:'',at:new Date().toISOString()};state.audit.push(audit);checkState(state);
   this.db.prepare('UPDATE projects SET rev=?,project_json=?,settings_json=? WHERE id=?').run(state.rev,JSON.stringify(meta),JSON.stringify(state.settings),id);
   const position=this.db.prepare("SELECT coalesce(max(position)+1,0) AS position FROM records WHERE project_id=? AND kind='audit'").get(id).position;
   this.db.prepare('INSERT INTO records(project_id,kind,record_id,position,event_date,counterparty,doc_json) VALUES(?,?,?,?,?,?,?)').run(id,'audit',audit.id,position,audit.at,'',JSON.stringify(audit));
   this.db.exec('COMMIT');return {id,name:meta.name,budget,archived:Boolean(row.archived),rev:state.rev};
  }catch(error){this.db.exec('ROLLBACK');throw error}
 } projectDeletionSummary(id){id=this.projectId(id);const row=id&&this.db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!row)throw failure(404,'Project not found');const state=this.readSync(id),recordCount=KINDS.filter(kind=>kind!=='files').reduce((n,kind)=>n+state[kind].length,0);return {projectId:id,projectName:JSON.parse(row.project_json).name,recordCount,attachmentCount:state.files.length,attachmentBytes:state.files.reduce((n,file)=>n+file.size,0),rev:asInt(row.rev)}}
 async deleteProject(id,expectedRev){if(!Number.isSafeInteger(expectedRev)||expectedRev<0)throw failure(422,'Project revision is required.');id=this.projectId(id);if(!id)throw failure(404,'Project not found');this.db.exec('BEGIN IMMEDIATE');try{const summary=this.projectDeletionSummary(id);if(summary.rev!==expectedRev)throw failure(409,'Project changed. Review it again before deleting.','VERSION_CONFLICT');this.db.prepare('DELETE FROM records WHERE project_id=?').run(id);this.db.prepare('DELETE FROM assets WHERE project_id=?').run(id);this.db.prepare('DELETE FROM file_chunks WHERE upload_id IN (SELECT id FROM uploads WHERE project_id=?)').run(id);this.db.prepare('DELETE FROM uploads WHERE project_id=?').run(id);const deleted=this.db.prepare('DELETE FROM projects WHERE id=?').run(id);if(deleted.changes!==1)throw failure(404,'Project not found');this.db.exec('COMMIT');return summary}catch(error){this.db.exec('ROLLBACK');throw error}}
 async read(projectId){if(!this.db)throw failure(503,'Database is not available');projectId=this.projectId(projectId);if(!projectId)return startupState();this.db.exec('BEGIN DEFERRED');try{const out=this.readSync(projectId);this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}
 readSync(projectId){projectId=this.projectId(projectId);if(!projectId)return startupState();const meta=this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);if(!meta)throw failure(404,'Project not found');const st={schema:asInt(meta.schema_version),project:JSON.parse(meta.project_json),settings:JSON.parse(meta.settings_json),rev:asInt(meta.rev)};
  for(const k of KINDS)st[k]=[];
  for(const row of this.db.prepare('SELECT kind,doc_json FROM records WHERE project_id=? ORDER BY kind,position').iterate(projectId)){if(st[row.kind])st[row.kind].push(JSON.parse(row.doc_json))}
  return st;
 }
 async activity(options={},projectId){projectId=this.projectId(projectId);if(!projectId)throw failure(404,'Choose a project first');
  const {type,query,limit,offset}=activityOptions(options);if(!this.db)throw failure(503,'Database is not available');
  const filter=`WHERE r.project_id=? AND ${type==='All'?'1':'activity_kind(r.kind,r.doc_json)=?'}${query?' AND instr(activity_search(r.kind,r.doc_json,b.doc_json,p.doc_json),?)>0':''}`;
  const from=`FROM records r
   LEFT JOIN records b ON r.project_id=b.project_id AND r.kind='allocations' AND b.kind='bills' AND b.record_id=json_extract(r.doc_json,'$.billId')
   LEFT JOIN records p ON r.project_id=p.project_id AND r.kind='allocations' AND p.kind='payments' AND p.record_id=json_extract(r.doc_json,'$.paymentId')
   ${filter}`;
  const parameters=[projectId];if(type!=='All')parameters.push(type);if(query)parameters.push(query.toLocaleLowerCase());
  this.db.exec('BEGIN DEFERRED');try{
   const meta=this.db.prepare('SELECT rev FROM projects WHERE id=?').get(projectId);if(!meta||!Number.isSafeInteger(meta.rev)||meta.rev<0)throw failure(503,'Project revision unavailable');
   const {count}=this.db.prepare('SELECT count(*) AS count '+(query?from:'FROM records r '+filter)).get(...parameters);
   const rows=limit?this.db.prepare(`SELECT r.kind,r.record_id,r.doc_json,b.doc_json AS bill_json,p.doc_json AS payment_json,
    CASE WHEN r.kind='plans' THEN (SELECT coalesce(sum(json_extract(pay.doc_json,'$.amount')),0) FROM records pay WHERE pay.project_id=r.project_id AND pay.kind='payments' AND json_extract(pay.doc_json,'$.planId')=r.record_id) ELSE 0 END AS paid
    ${from} ORDER BY activity_time(r.kind,r.doc_json) DESC,${type==='All'?'activity_kind(r.kind,r.doc_json),':''}r.record_id LIMIT ? OFFSET ?`).all(...parameters,limit,offset):[];
   const items=rows.map(row=>{
    const record=JSON.parse(row.doc_json),event=activityEvent(row.kind,record,{bill:row.bill_json?JSON.parse(row.bill_json):undefined,payment:row.payment_json?JSON.parse(row.payment_json):undefined,paid:row.paid});
    if(typeof event.id!=='string'||!event.id||event.id!==row.record_id||!Number.isSafeInteger(row.paid)||row.paid<0||
     (event.amount!=null&&(!Number.isSafeInteger(event.amount)||(row.kind!=='entries'&&event.amount<=0)))||['kind','at','date','label','party','status','work'].some(key=>event[key]!=null&&typeof event[key]!=='string'))throw failure(500,'Invalid stored activity record');
    return event;
   });
   this.db.exec('COMMIT');return {count,items,asOfRevision:meta.rev};
  }catch(error){this.db.exec('ROLLBACK');throw error}
 }
 async startUpload(meta,projectId){if(!meta||!validId(meta.id)||!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>MAX_FILE_SIZE)throw failure(400,'Invalid upload metadata');
  projectId=this.projectId(projectId);if(!projectId)throw failure(400,'Choose a project before uploading files');if(!this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId))throw failure(404,'Project not found');
  const uploadId=randomUUID(),numChunks=Math.ceil(meta.size/CHUNK_SIZE);
  this.db.prepare('INSERT INTO uploads(id,file_id,project_id,size_bytes,sha256,mime,filename,chunks,verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uploadId,meta.id,projectId,meta.size,meta.sha256,String(meta.type||'application/octet-stream').slice(0,180),String(meta.name||'document').slice(0,180),numChunks,0,Date.now());
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
 async postDomain(type,record,allocations=[],key,projectId){
  projectId=this.projectId(projectId);if(!projectId)throw failure(400,'Choose a project first');
  if(!validId(key))throw failure(400,'Invalid idempotency key');
  const canonical={op:'typed-record',projectId,type,record,allocations};
  const digest=sha256(Buffer.from(JSON.stringify(canonical)));
  const prior=this.db.prepare('SELECT request_hash,response_json FROM operations WHERE idempotency_key=?').get(key);
  if(prior){if(prior.request_hash!==digest)throw failure(409,'Idempotency key reused with different data');return JSON.parse(prior.response_json)}
  const old=this.readSync(projectId);const state=appendDomain(old,type,record,allocations);
  return this.commit({projectId,expectedRev:old.rev,state,newFiles:[],removeFiles:[],key},canonical);
 }
 async commit({projectId,expectedRev,state,newFiles=[],removeFiles=[],key,replace=false},canonical=null){
  projectId=this.projectId(projectId);if(!projectId)throw failure(400,'Choose a project before saving');
  if(!validId(key))throw failure(400,'Invalid idempotency key');try{checkState(state)}catch(e){throw failure(422,e.message,'VALIDATION_ERROR')}
  if(!Number.isSafeInteger(expectedRev)||expectedRev<0||state.rev!==expectedRev+1)throw failure(422,'Invalid expected revision');
  const digest=sha256(Buffer.from(JSON.stringify(canonical??{projectId,expectedRev,state,newFiles,removeFiles,replace})));
  this.db.exec('BEGIN IMMEDIATE');try{
   const cached=this.db.prepare('SELECT request_hash,response_json FROM operations WHERE idempotency_key=?').get(key);
   if(cached){if(cached.request_hash!==digest)throw failure(409,'Idempotency key reused with different data');this.db.exec('COMMIT');return JSON.parse(cached.response_json)}
   const current=this.db.prepare('SELECT rev FROM projects WHERE id=?').get(projectId);if(!current)throw failure(404,'Project not found');if(current.rev!==expectedRev)throw failure(409,'The project has changed. Reload and try again.','VERSION_CONFLICT');
   const prior=this.readSync(projectId);validateFileMutation(prior,state,newFiles,removeFiles,replace);try{validateRecordChanges(prior,state,replace)}catch(e){throw failure(422,e.message,'VALIDATION_ERROR')}
   const uploaded=new Set();for(const f of newFiles){if(uploaded.has(f.uploadId))throw failure(422,'Upload used twice');uploaded.add(f.uploadId);const meta=state.files.find(x=>x.id===f.id);const up=this.db.prepare('SELECT * FROM uploads WHERE id=? AND project_id=?').get(f.uploadId,projectId);if(!up||up.verified!==1||!matchFile(meta,{id:up.file_id,size:up.size_bytes,sha256:up.sha256,type:up.mime}))throw failure(422,'Uploaded original does not match file metadata');if(this.db.prepare('SELECT file_id FROM assets WHERE project_id=? AND file_id=?').get(projectId,f.id)&&!replace)throw failure(409,'File already exists, upload a new revision')}
   const deletion=replace?prior.files.map(x=>x.id):removeFiles;
   for(const id of deletion){const a=this.db.prepare('SELECT upload_id FROM assets WHERE project_id=? AND file_id=?').get(projectId,id);this.db.prepare('DELETE FROM assets WHERE project_id=? AND file_id=?').run(projectId,id);if(a){this.db.prepare('DELETE FROM file_chunks WHERE upload_id=?').run(a.upload_id);this.db.prepare('DELETE FROM uploads WHERE id=?').run(a.upload_id)}}
   for(const f of newFiles){const u=this.db.prepare('SELECT * FROM uploads WHERE id=? AND project_id=?').get(f.uploadId,projectId);this.db.prepare('INSERT INTO assets(project_id,file_id,upload_id,filename,mime,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)').run(projectId,f.id,f.uploadId,u.filename,u.mime,u.size_bytes,u.sha256,Date.now())}
   // The normalized typed records are authoritative; no unvalidated parallel JSON database.
   const update=this.db.prepare('INSERT INTO records(project_id,kind,record_id,position,event_date,counterparty,doc_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,kind,record_id) DO UPDATE SET position=excluded.position,event_date=excluded.event_date,counterparty=excluded.counterparty,doc_json=excluded.doc_json');
   const removeRecord=this.db.prepare('DELETE FROM records WHERE project_id=? AND kind=? AND record_id=?');
   for(const kind of KINDS){const wanted=state[kind],keep=new Set(wanted.map(x=>x.id)),existing=new Map(prior[kind].map((record,pos)=>[record.id,{pos,json:JSON.stringify(record)}]));for(const item of prior[kind])if(!keep.has(item.id))removeRecord.run(projectId,kind,item.id);
    for(const [pos,r] of wanted.entries()){const json=JSON.stringify(r),old=existing.get(r.id);if(old?.pos===pos&&old.json===json)continue;const date=String(r.date||r.due||r.recordedAt||r.importedAt||'').slice(0,32),party=String(r.vendor||r.party||r.category||'').slice(0,255);update.run(projectId,kind,r.id,pos,date,party,json)}}
   const affected=this.db.prepare('UPDATE projects SET rev=?,schema_version=?,project_json=?,settings_json=? WHERE id=? AND rev=?').run(state.rev,state.schema,JSON.stringify(state.project),JSON.stringify(state.settings),projectId,expectedRev);
   if(affected.changes!==1)throw failure(409,'The project was modified while posting','VERSION_CONFLICT');
   const response={ok:true,rev:state.rev};this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(key,digest,JSON.stringify(response),Date.now());
   this.db.exec('COMMIT');return response;
  }catch(err){this.db.exec('ROLLBACK');throw err}
 }
 async asset(id,projectId){if(!validId(id))return null;projectId=this.projectId(projectId);const x=projectId?this.db.prepare('SELECT * FROM assets WHERE project_id=? AND file_id=?').get(projectId,id):null;return x?{id:x.file_id,projectId:x.project_id,uploadId:x.upload_id,name:x.filename,size:Number(x.size_bytes),type:x.mime,sha256:x.sha256}:null}
 async *fileStream(id,projectId,expectedAsset){const meta=expectedAsset||await this.asset(id,projectId);if(!meta)throw failure(404,'Original file not found');
  if(!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>MAX_FILE_SIZE)throw failure(500,'Original document integrity error');
  const dir=await mkdtemp(path.join(tmpdir(),'buildledger-download-')),filename=path.join(dir,'original');let staged;
  try{
   staged=await open(filename,'wx',0o600);const hash=createHash('sha256');let size=0,index=0;
   for(const chunk of this.db.prepare('SELECT chunk_index,chunk_sha256,data FROM file_chunks WHERE upload_id=? ORDER BY chunk_index').iterate(meta.uploadId)){
    const bytes=Buffer.from(chunk.data),expected=Math.min(CHUNK_SIZE,meta.size-index*CHUNK_SIZE);
    if(chunk.chunk_index!==index++||expected<=0||bytes.length!==expected||sha256(bytes)!==chunk.chunk_sha256)throw failure(500,'Original document integrity error: invalid chunk');
    size+=bytes.length;hash.update(bytes);await staged.writeFile(bytes);
   }
   if(size!==meta.size||hash.digest('hex')!==meta.sha256)throw failure(500,'Original document integrity error');
   await staged.close();staged=null;
   // Serve the verified private snapshot so later database mutations cannot change its bytes.
   yield* createReadStream(filename);
  }finally{try{await staged?.close()}finally{await rm(dir,{recursive:true,force:true})}}
 }
 async removeOrphans(){const cutoff=Date.now()-72*3600*1000;const expired=this.db.prepare('SELECT id FROM uploads WHERE created_at < ? AND id NOT IN (SELECT upload_id FROM assets)').all(cutoff);this.db.exec('BEGIN IMMEDIATE');try{for(const u of expired){this.db.prepare('DELETE FROM file_chunks WHERE upload_id=?').run(u.id);this.db.prepare('DELETE FROM uploads WHERE id=?').run(u.id)}this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}return expired.length}
}
