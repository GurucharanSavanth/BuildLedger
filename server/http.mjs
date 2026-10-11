import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac, randomUUID} from 'node:crypto';
import {metrics,activity,costs,timeline,appendDomain} from './domain.mjs';
import {buildHierarchy,hierarchySummary} from '../hierarchy.js';
import {buildCostHierarchy,costHierarchySummary} from '../cost-analytics.js';
import {costCatalog} from '../cost-catalog.js';
import {authConstantCompare,checkState,failure,safeName,CHUNK_SIZE,MAX_STATE_BYTES} from './core.mjs';
const ROOT=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const STATIC={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon'};
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(v=>decodeURIComponent(v||''))))}
function send(res,code,obj,headers={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj))}
function streamBody(req,limit){return new Promise((resolve,reject)=>{let len=0,buffers=[];req.on('data',b=>{len+=b.length;if(len>limit){reject(failure(413,'Request is too large'));req.destroy();return}buffers.push(b)});req.on('end',()=>resolve(Buffer.concat(buffers)));req.on('error',reject)})}
async function bodyJSON(req,limit=MAX_STATE_BYTES+2*1024*1024){const data=await streamBody(req,limit);let val;try{val=JSON.parse(data.toString('utf8'))}catch{throw failure(400,'Invalid JSON request')}return val}
export function createHttpApp({store,password,secret,host='127.0.0.1',storeMode='sqlite',authMode='owner'}){
 if(!['local','owner'].includes(authMode))throw Error('AUTH_MODE must be local or owner');
 if(authMode==='local'&&!['127.0.0.1','localhost','::1','[::1]'].includes(host))throw Error('Password-free mode is restricted to localhost. Set AUTH_MODE=owner and configure credentials for any network access.');
 if(authMode==='owner'&&(!password||password.length<12))throw Error('ADMIN_PASSWORD must be at least 12 characters in owner mode');
 if(authMode==='owner'&&(!secret||secret.length<32))throw Error('APP_COOKIE_SECRET must be at least 32 characters in owner mode');
 const sessions=new Map(),fails=new Map();
 const hmac=s=>createHmac('sha256',secret).update(s).digest('hex');
 function loggedIn(req){if(authMode==='local')return true;const val=cookies(req).bl_session;if(!val)return false;const [id,signature]=val.split('.');if(!id||!signature||!authConstantCompare(signature,hmac(id)))return false;const sess=sessions.get(id);if(!sess||sess< Date.now())return false;return true}
 function originOK(req){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return true;const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host}catch{return false}}
 async function handle(req,res){try{
  // Loopback-only no-login mode. Validate Host AND the actual bound socket to block DNS rebinding and proxy bypasses.
  if(authMode==='local'){
   const hostname=(req.headers.host||'').replace(/:\d+$/,'').toLowerCase();
   const onLoopback=['127.0.0.1','localhost','[::1]','::1'].includes(hostname);
   const addr=(req.socket.localAddress||'').toLowerCase();
   if(!onLoopback||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr))throw failure(403,'Password-free mode only permits local access');
   if(req.headers['x-forwarded-host']||req.headers['x-forwarded-for']||req.headers['forwarded'])throw failure(403,'Password-free mode does not support proxy access');
  }
  let u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);let url=u.pathname;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; connect-src 'self'; base-uri 'self'; form-action 'self'");
  if(url.startsWith('/api/v1/')){
   if(!originOK(req))throw failure(403,'Request was blocked by origin verification');
   if(url==='/api/v1/health'&&req.method==='GET'){const ready=typeof store.health==='function'?await store.health():true;return send(res,ready?200:503,{ok:ready,mode:storeMode,database:ready?'ready':'unavailable',auth:authMode==='local'?'not_required':'required'})}
   if(url==='/api/v1/session'&&req.method==='GET')return send(res,200,{authenticated:loggedIn(req),mode:storeMode,auth:authMode==='local'?'not_required':'required'});
   if(url==='/api/v1/login'&&req.method==='POST'){
    if(authMode==='local')throw failure(404,'No login is needed on this device');
    const ip=(req.socket.remoteAddress||'local').slice(0,120),last=fails.get(ip)||{count:0,until:0};if(last.until>Date.now())throw failure(429,'Too many attempts; try again later');const {password:given}=await bodyJSON(req,4096);
    if(typeof given!=='string'||!authConstantCompare(given,password)){let c=last.count+1;fails.set(ip,{count:c,until:c>=5?Date.now()+60000:0});throw failure(401,'Incorrect password')}
    fails.delete(ip);const id=randomUUID(),expires=Date.now()+8*3600*1000;sessions.set(id,expires);const secure=(req.socket.encrypted||req.headers['x-forwarded-proto']==='https');return send(res,200,{ok:true},{'Set-Cookie':`bl_session=${id}.${hmac(id)}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=28800${secure?'; Secure':''}`});
   }
   if(url==='/api/v1/logout'&&req.method==='POST'){let id=cookies(req).bl_session?.split('.')[0];sessions.delete(id);return send(res,200,{ok:true},{'Set-Cookie':'bl_session=; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=0'})}
   if(!loggedIn(req))throw failure(401,'Sign in to access your project','NOT_SIGNED_IN');
   if(url==='/api/v1/state'&&req.method==='GET'){return send(res,200,await store.read())}
   if(url==='/api/v1/dashboard'&&req.method==='GET')return send(res,200,metrics(await store.read()));
   if(url==='/api/v1/activity'&&req.method==='GET')return send(res,200,activity(await store.read(),{type:u.searchParams.get('type')||'All',query:u.searchParams.get('q')||'',limit:Math.min(200,Number(u.searchParams.get('limit')||100)),offset:Number(u.searchParams.get('offset')||0)}));
   if(url==='/api/v1/analytics/costs'&&req.method==='GET')return send(res,200,costs(await store.read(),u.searchParams.get('by')||'work'));
   if(url==='/api/v1/catalog/cost-heads'&&req.method==='GET'){const state=await store.read();return send(res,200,{items:costCatalog(state),asOfRevision:state.rev})}
   if(url==='/api/v1/analytics/cost-hierarchy'&&req.method==='GET'){const levels=u.searchParams.getAll('level');if(levels.length>3||levels.some(x=>x.length>100))throw failure(400,'Choose up to three cost category identifiers');const state=await store.read(),selected=costHierarchySummary(buildCostHierarchy(state),levels);if(!selected)throw failure(404,'Cost category not found');return send(res,200,{...selected,asOfRevision:state.rev})}
   if(url==='/api/v1/analytics/hierarchy'&&req.method==='GET'){const levels=u.searchParams.getAll('level');if(levels.length>3||levels.some(x=>x.length>140))throw failure(400,'Choose up to three valid hierarchy levels');const root=buildHierarchy(await store.read());const selected=hierarchySummary(root,levels);if(!selected)throw failure(404,'Hierarchy category not found');return send(res,200,selected)}
   if(url==='/api/v1/calendar'&&req.method==='GET')return send(res,200,{items:timeline(await store.read())});
   if(url==='/api/v1/documents'&&req.method==='GET'){const st=await store.read();return send(res,200,{items:st.files,revision:st.rev})}
   if(['/api/v1/bills','/api/v1/payments','/api/v1/plans'].includes(url)&&req.method==='POST'){
     const request=await bodyJSON(req,512*1024),current=await store.read(),kind=url.split('/').pop().slice(0,-1),record=request.record;
     if(!record||!request.key)throw failure(400,'Missing record or idempotency key');
     if(typeof store.postDomain==='function')return send(res,201,await store.postDomain(kind,record,request.allocations||[],request.key));
     const data=appendDomain(current,kind,record,request.allocations||[]);
     return send(res,201,await store.commit({expectedRev:current.rev,state:data,newFiles:[],removeFiles:[],key:request.key}));
   }
   if(url==='/api/v1/uploads/start'&&req.method==='POST'){return send(res,200,await store.startUpload(await bodyJSON(req,8192)))}
   let chunk=url.match(/^\/api\/v1\/uploads\/([a-f0-9-]{36})\/chunks\/(\d+)$/);if(chunk&&req.method==='PUT'){let b=await streamBody(req,CHUNK_SIZE+1);await store.putChunk(chunk[1],Number(chunk[2]),b);return send(res,200,{ok:true})}
   let done=url.match(/^\/api\/v1\/uploads\/([a-f0-9-]{36})\/complete$/);if(done&&req.method==='POST')return send(res,200,await store.finishUpload(done[1]));
   if(url==='/api/v1/commit'&&req.method==='POST'){const data=await bodyJSON(req);return send(res,200,await store.commit(data))}
   let file=url.match(/^\/api\/v1\/files\/([A-Za-z0-9_-]{8,100})$/);if(file&&req.method==='GET'){
    const meta=await store.asset(file[1]);if(!meta)throw failure(404,'Original file not found');const attached=(await store.read()).files.some(f=>f.id===file[1]);if(!attached)throw failure(404,'File not part of current project');
    const safePreview=/^(application\/pdf|image\/(png|jpeg|gif|webp|bmp)|text\/plain|audio\/(mpeg|ogg|wav)|video\/(mp4|webm))$/.test(meta.type);
    const disp=u.searchParams.get('download')==='1'||!safePreview?'attachment':'inline';const name=safeName(meta.name);
    res.writeHead(200,{'Content-Type':safePreview?meta.type:'application/octet-stream','Content-Disposition':`${disp}; filename*=UTF-8''${encodeURIComponent(name)}`,'Content-Length':meta.size,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'});try{for await (const buf of store.fileStream(file[1])){if(!res.write(buf))await new Promise(r=>res.once('drain',r))}res.end()}catch(err){res.destroy(err)}return;
   }
   throw failure(404,'API endpoint not found');
  }
  if(req.method!=='GET'&&req.method!=='HEAD')throw failure(405,'Method not allowed');
  if(url==='/'||url==='')url='/index.html';const safe=path.resolve(ROOT,'.'+url);if(safe!==ROOT&&!safe.startsWith(ROOT+path.sep))throw failure(403,'Forbidden path');const ext=path.extname(safe),type=STATIC[ext];if(!type||!['/index.html','/styles.css','/finance.js','/hierarchy.js','/cost-catalog.js','/cost-analytics.js','/archive.js','/db.js','/app.js','/sw.js','/manifest.webmanifest','/assets/icon.svg'].includes(url)&&!url.startsWith('/assets/screenshot-'))throw failure(404,'Not found');const st=await stat(safe).catch(()=>null);if(!st||!st.isFile())throw failure(404,'Not found');res.writeHead(200,{'Content-Type':type,'Cache-Control':url.endsWith('.html')?'no-store':'public, max-age=120'});if(req.method==='HEAD')res.end();else createReadStream(safe).pipe(res);
 }catch(err){if(!res.headersSent)send(res,err.status||500,{code:err.code||'ERROR',message:err.status?err.message:'Server operation failed'});else res.destroy(err);if(!err.status)console.error('SERVER ERROR',err)}}
 return http.createServer(handle);
}
export async function run(){
 const mode=(process.env.DATABASE_MODE||'sqlite').toLowerCase(),password=process.env.ADMIN_PASSWORD,secret=process.env.APP_COOKIE_SECRET,authMode=(process.env.AUTH_MODE||'local').toLowerCase();
 if(!['local','owner'].includes(authMode))throw Error('Unknown AUTH_MODE; use local or owner');
 if(authMode==='owner'&&(!password||!secret||password.length<12||secret.length<32||password.includes('REPLACE_WITH')||secret.includes('REPLACE_WITH')))throw Error('Set a strong ADMIN_PASSWORD and APP_COOKIE_SECRET (npm run setup:secure) for AUTH_MODE=owner');
 let store;
 if(mode==='sqlite'){
  const {SqliteStore}=await import('./sqlite-store.mjs');store=new SqliteStore(process.env.SQLITE_PATH||'./data/buildledger.sqlite');
 }else if(mode==='mongodb'){
  if(!process.env.MONGODB_URI)throw Error('MONGODB_URI required when DATABASE_MODE=mongodb');
  const {MongoStore}=await import('./mongo-store.mjs');store=new MongoStore(process.env.MONGODB_URI,process.env.MONGODB_DB||'buildledger');
 }else throw Error('Unsupported DATABASE_MODE: '+mode);
 await store.start();const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8080);
 let app;
 try{
  app=createHttpApp({store,password,secret,storeMode:mode,authMode,host});
  await new Promise((resolve,reject)=>{
   app.once('error',reject);
   app.listen(port,host,()=>{app.removeListener('error',reject);resolve()});
  });
 }catch(error){
  await store.close();
  if(error.code==='EADDRINUSE')throw Error(`Port ${port} on ${host} is already in use. If BuildLedger is already running, open http://${host}:${port}. Otherwise stop the process using that port or choose a different PORT.`);
  throw error;
 }
 const prune=setInterval(()=>store.removeOrphans().catch(e=>console.error('Cleanup error:',e.message)),6*3600*1000);prune.unref();
 console.log(`BuildLedger (${mode}, ${authMode==='local'?'no login / local only':'owner login'}) listening at http://${host}:${app.address().port}`);
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close(()=>{clearInterval(prune);Promise.resolve(store.close()).then(()=>process.exit(0))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){run().catch(e=>{console.error('Startup failed:',e.message);process.exit(1)})}
