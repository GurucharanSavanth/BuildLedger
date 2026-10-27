import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac, randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {metrics,activityOptions,costs,timeline,appendDomain} from './domain.mjs';
import {buildHierarchy,hierarchySummary} from '../hierarchy.js';
import {buildCostHierarchy,costHierarchySummary} from '../cost-analytics.js';
import {costCatalog} from '../cost-catalog.js';
import {authConstantCompare,checkState,failure,safeName,CHUNK_SIZE,MAX_STATE_BYTES} from './core.mjs';
const ROOT=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const STATIC={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon'};
// shortcut: track 255 failed-login IPs plus one shared overflow cooldown and 256 sessions; raise if legitimate use exceeds this.
const MAX_AUTH_ENTRIES=256;
const OVERFLOW_FAILURE_KEY='\0overflow';
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(v=>decodeURIComponent(v||''))))}
function send(res,code,obj,headers={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj))}
function streamBody(req,limit){return new Promise((resolve,reject)=>{let len=0,buffers=[];req.on('data',b=>{len+=b.length;if(len>limit){reject(failure(413,'Request is too large'));req.destroy();return}buffers.push(b)});req.on('end',()=>resolve(Buffer.concat(buffers)));req.on('error',reject)})}
async function bodyJSON(req,limit=MAX_STATE_BYTES+2*1024*1024){const data=await streamBody(req,limit);let val;try{val=JSON.parse(data.toString('utf8'))}catch{throw failure(400,'Invalid JSON request')}return val}
function setBounded(map,key,value){map.delete(key);if(map.size>=MAX_AUTH_ENTRIES)map.delete(map.keys().next().value);map.set(key,value)}
function normalizedIp(value){
 if(typeof value!=='string'||!isIP(value)||value.includes('%'))return null;
 if(isIP(value)===4)return value;
 const ip=new URL(`http://[${value}]/`).hostname.slice(1,-1);
 const mapped=ip.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);if(!mapped)return ip;
 const [high,low]=mapped.slice(1).map(x=>parseInt(x,16));return [high>>8,high&255,low>>8,low&255].join('.');
}
function loopbackAddress(value){const ip=normalizedIp(value);return ip==='::1'||Boolean(ip?.startsWith('127.'))}
function directLoopback(req){return ['127.0.0.1','localhost','[::1]'].includes((req.headers.host||'').replace(/:\d+$/,'').toLowerCase())&&loopbackAddress(req.socket.localAddress)&&loopbackAddress(req.socket.remoteAddress)&&!['x-forwarded-host','x-forwarded-for','x-forwarded-proto','forwarded'].some(key=>req.headers[key]!==undefined)}
export function createHttpApp({store,password,secret,host='127.0.0.1',storeMode='sqlite',authMode='owner',trustedProxyIps=[]}){
 if(!['local','owner'].includes(authMode))throw Error('AUTH_MODE must be local or owner');
 if(authMode==='local'&&!['127.0.0.1','localhost','::1','[::1]'].includes(host))throw Error('Password-free mode is restricted to localhost. Set AUTH_MODE=owner and configure credentials for any network access.');
 if(authMode==='owner'&&(!password||password.length<12))throw Error('ADMIN_PASSWORD must be at least 12 characters in owner mode');
 if(authMode==='owner'&&(!secret||secret.length<32))throw Error('APP_COOKIE_SECRET must be at least 32 characters in owner mode');
 if(!Array.isArray(trustedProxyIps)||trustedProxyIps.some(ip=>!normalizedIp(ip)))throw Error('TRUSTED_PROXY_IPS must contain exact IPv4 or IPv6 addresses, not names or ranges');
 const trustedProxies=new Set(trustedProxyIps.map(normalizedIp));
 const sessions=new Map(),fails=new Map();
 const hmac=s=>createHmac('sha256',secret).update(s).digest('hex');
 function loggedIn(req){if(authMode==='local')return true;const val=cookies(req).bl_session;if(!val)return false;const [id,signature]=val.split('.');if(!id||!signature||!authConstantCompare(signature,hmac(id)))return false;const sess=sessions.get(id);if(!sess||sess< Date.now())return false;return true}
 function originOK(req,secure){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return true;const origin=req.headers.origin;if(!origin)return true;try{const parsed=new URL(origin);return parsed.host===req.headers.host&&parsed.protocol===(secure?'https:':'http:')}catch{return false}}
 async function handle(req,res){try{
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);let url=u.pathname;
  const secure=Boolean(req.socket.encrypted||(trustedProxies.has(normalizedIp(req.socket.remoteAddress))&&req.headers['x-forwarded-proto']==='https'));
  const healthProbe=url==='/api/v1/health'&&req.method==='GET';
  if(authMode==='owner'&&!healthProbe&&!secure&&!directLoopback(req))throw failure(403,'HTTPS is required for network access. Configure an HTTPS proxy with an exact TRUSTED_PROXY_IPS peer address.');
  // Loopback-only no-login mode. Validate Host AND the actual bound socket to block DNS rebinding and proxy bypasses.
  if(authMode==='local'){
   const hostname=(req.headers.host||'').replace(/:\d+$/,'').toLowerCase();
   const onLoopback=['127.0.0.1','localhost','[::1]','::1'].includes(hostname);
   const addr=(req.socket.localAddress||'').toLowerCase();
   if(!onLoopback||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr))throw failure(403,'Password-free mode only permits local access');
   if(req.headers['x-forwarded-host']||req.headers['x-forwarded-for']||req.headers['x-forwarded-proto']||req.headers['forwarded'])throw failure(403,'Password-free mode does not support proxy access');
  }
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; connect-src 'self'; base-uri 'self'; form-action 'self'");
  if(url.startsWith('/api/v1/')){
   if(!originOK(req,secure))throw failure(403,'Request was blocked by origin verification');
   if(url==='/api/v1/health'&&req.method==='GET'){const ready=typeof store.health==='function'?await store.health():true;return send(res,ready?200:503,{ok:ready,mode:storeMode,database:ready?'ready':'unavailable',auth:authMode==='local'?'not_required':'required'})}
   if(url==='/api/v1/session'&&req.method==='GET')return send(res,200,{authenticated:loggedIn(req),mode:storeMode,auth:authMode==='local'?'not_required':'required'});
   if(url==='/api/v1/login'&&req.method==='POST'){
    if(authMode==='local')throw failure(404,'No login is needed on this device');
    const {password:given}=await bodyJSON(req,4096);
    const ip=(req.socket.remoteAddress||'local').slice(0,120),failureKey=fails.has(ip)||(!fails.has(OVERFLOW_FAILURE_KEY)&&fails.size<MAX_AUTH_ENTRIES-1)?ip:OVERFLOW_FAILURE_KEY,last=fails.get(failureKey)||{count:0,until:0},overflow=failureKey===OVERFLOW_FAILURE_KEY;
    if(last.until>Date.now()&&!overflow)throw failure(429,'Too many attempts; try again later');
    if(typeof given!=='string'||!authConstantCompare(given,password)){if(last.until>Date.now())throw failure(429,'Too many attempts; try again later');let c=last.count+1;setBounded(fails,failureKey,{count:c,until:c>=5?Date.now()+60000:0});throw failure(401,'Incorrect password')}
    if(!overflow)fails.delete(failureKey);const id=randomUUID(),expires=Date.now()+8*3600*1000;setBounded(sessions,id,expires);return send(res,200,{ok:true},{'Set-Cookie':`bl_session=${id}.${hmac(id)}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=28800${secure?'; Secure':''}`});
   }
   if(url==='/api/v1/logout'&&req.method==='POST'){let id=cookies(req).bl_session?.split('.')[0];sessions.delete(id);return send(res,200,{ok:true},{'Set-Cookie':`bl_session=; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=0${secure?'; Secure':''}`})}
   if(!loggedIn(req))throw failure(401,'Sign in to access your project','NOT_SIGNED_IN');
   if(url==='/api/v1/projects'&&req.method==='GET')return send(res,200,{items:await store.listProjects?.()||[]});
   if(url==='/api/v1/projects'&&req.method==='POST'){const {name}=await bodyJSON(req,8192);if(typeof store.createProject!=='function')throw failure(501,'Project management is unavailable');return send(res,201,await store.createProject(name))}
   const projectRoute=url.match(/^\/api\/v1\/projects\/([A-Za-z0-9_-]{8,100})(?:\/(summary))?$/);
   if(projectRoute&&req.method==='GET'&&projectRoute[2]==='summary')return send(res,200,await store.projectDeletionSummary(projectRoute[1]));
   if(projectRoute&&req.method==='PATCH'&&!projectRoute[2])return send(res,200,await store.updateProject(projectRoute[1],await bodyJSON(req,8192)));
   if(projectRoute&&req.method==='DELETE'&&!projectRoute[2])return send(res,200,await store.deleteProject(projectRoute[1]));
   const projectId=u.searchParams.get('projectId')||undefined;
   if(url==='/api/v1/state'&&req.method==='GET'){return send(res,200,await store.read(projectId))}
   if(url==='/api/v1/dashboard'&&req.method==='GET')return send(res,200,metrics(await store.read(projectId)));
   if(url==='/api/v1/activity'&&req.method==='GET'){const options=activityOptions({type:u.searchParams.get('type')??'All',query:u.searchParams.get('q')??'',limit:u.searchParams.get('limit')??100,offset:u.searchParams.get('offset')??0});return send(res,200,await store.activity(options,projectId));}
   if(url==='/api/v1/analytics/costs'&&req.method==='GET')return send(res,200,costs(await store.read(projectId),u.searchParams.get('by')||'work'));
   if(url==='/api/v1/catalog/cost-heads'&&req.method==='GET'){const state=await store.read(projectId);return send(res,200,{items:costCatalog(state),asOfRevision:state.rev})}
   if(url==='/api/v1/analytics/cost-hierarchy'&&req.method==='GET'){const levels=u.searchParams.getAll('level');if(levels.length>3||levels.some(x=>x.length>100))throw failure(400,'Choose up to three cost category identifiers');const state=await store.read(projectId),selected=costHierarchySummary(buildCostHierarchy(state),levels);if(!selected)throw failure(404,'Cost category not found');return send(res,200,{...selected,asOfRevision:state.rev})}
   if(url==='/api/v1/analytics/hierarchy'&&req.method==='GET'){const levels=u.searchParams.getAll('level');if(levels.length>3||levels.some(x=>x.length>140))throw failure(400,'Choose up to three valid hierarchy levels');const root=buildHierarchy(await store.read(projectId));const selected=hierarchySummary(root,levels);if(!selected)throw failure(404,'Hierarchy category not found');return send(res,200,selected)}
   if(url==='/api/v1/calendar'&&req.method==='GET')return send(res,200,{items:timeline(await store.read(projectId))});
   if(url==='/api/v1/documents'&&req.method==='GET'){const st=await store.read(projectId);return send(res,200,{items:st.files,revision:st.rev})}
   if(['/api/v1/bills','/api/v1/payments','/api/v1/plans'].includes(url)&&req.method==='POST'){
     const request=await bodyJSON(req,512*1024),current=await store.read(request.projectId),kind=url.split('/').pop().slice(0,-1),record=request.record;
     if(!record||!request.key)throw failure(400,'Missing record or idempotency key');
     if(typeof store.postDomain==='function')return send(res,201,await store.postDomain(kind,record,request.allocations||[],request.key,request.projectId));
     const data=appendDomain(current,kind,record,request.allocations||[]);
     return send(res,201,await store.commit({projectId:request.projectId,expectedRev:current.rev,state:data,newFiles:[],removeFiles:[],key:request.key}));
   }
   if(url==='/api/v1/uploads/start'&&req.method==='POST'){const request=await bodyJSON(req,8192);return send(res,200,await store.startUpload(request,request.projectId))}
   let chunk=url.match(/^\/api\/v1\/uploads\/([a-f0-9-]{36})\/chunks\/(\d+)$/);if(chunk&&req.method==='PUT'){let b=await streamBody(req,CHUNK_SIZE+1);await store.putChunk(chunk[1],Number(chunk[2]),b);return send(res,200,{ok:true})}
   let done=url.match(/^\/api\/v1\/uploads\/([a-f0-9-]{36})\/complete$/);if(done&&req.method==='POST')return send(res,200,await store.finishUpload(done[1]));
   if(url==='/api/v1/commit'&&req.method==='POST'){const data=await bodyJSON(req);return send(res,200,await store.commit(data))}
   let file=url.match(/^\/api\/v1\/files\/([A-Za-z0-9_-]{8,100})$/);if(file&&req.method==='GET'){
    const selected=u.searchParams.get('projectId')||undefined,meta=await store.asset(file[1],selected);if(!meta)throw failure(404,'Original file not found');const attached=(await store.read(selected)).files.some(f=>f.id===file[1]);if(!attached)throw failure(404,'File not part of current project');
    const safePreview=/^(application\/pdf|image\/(png|jpeg|gif|webp|bmp)|text\/plain|audio\/(mpeg|ogg|wav)|video\/(mp4|webm))$/.test(meta.type);
    const disp=u.searchParams.get('download')==='1'||!safePreview?'attachment':'inline';const name=safeName(meta.name);
    const source=store.fileStream(file[1],selected,meta);try{
     const first=await source.next();
     res.writeHead(200,{'Content-Type':safePreview?meta.type:'application/octet-stream','Content-Disposition':`${disp}; filename*=UTF-8''${encodeURIComponent(name)}`,'Content-Length':meta.size,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'});
     await pipeline(Readable.from((async function*(){if(!first.done)yield first.value;yield* source})()),res);
    }catch(error){if(!res.headersSent)throw error;res.destroy(error)}finally{await source.return?.()}return;
   }
   throw failure(404,'API endpoint not found');
  }
  if(req.method!=='GET'&&req.method!=='HEAD')throw failure(405,'Method not allowed');
  if(url==='/'||url==='')url='/index.html';const safe=path.resolve(ROOT,'.'+url);if(safe!==ROOT&&!safe.startsWith(ROOT+path.sep))throw failure(403,'Forbidden path');const ext=path.extname(safe),type=STATIC[ext];if(!type||!['/index.html','/styles.css','/finance.js','/hierarchy.js','/cost-catalog.js','/cost-analytics.js','/archive.js','/db.js','/app.js','/project-export.js','/sw.js','/manifest.webmanifest','/assets/icon.svg'].includes(url)&&!url.startsWith('/assets/screenshot-'))throw failure(404,'Not found');const st=await stat(safe).catch(()=>null);if(!st||!st.isFile())throw failure(404,'Not found');res.writeHead(200,{'Content-Type':type,'Cache-Control':url.endsWith('.html')?'no-store':'public, max-age=120'});if(req.method==='HEAD')res.end();else createReadStream(safe).pipe(res);
 }catch(err){if(!res.headersSent)send(res,err.status||500,{code:err.code||'ERROR',message:err.status?err.message:'Server operation failed'});else res.destroy(err);if(!err.status)console.error('SERVER ERROR',err)}}
 return http.createServer(handle);
}
export async function run(){
 const mode=(process.env.DATABASE_MODE||'sqlite').toLowerCase(),password=process.env.ADMIN_PASSWORD,secret=process.env.APP_COOKIE_SECRET,authMode=(process.env.AUTH_MODE||'local').toLowerCase();
 if(!['local','owner'].includes(authMode))throw Error('Unknown AUTH_MODE; use local or owner');
 if(authMode==='owner'&&(!password||!secret||password.length<12||secret.length<32||password.includes('REPLACE_WITH')||secret.includes('REPLACE_WITH')))throw Error('Set a strong ADMIN_PASSWORD and APP_COOKIE_SECRET (npm run setup:secure) for AUTH_MODE=owner');
 if(mode!=='sqlite')throw Error('DATABASE_MODE must be sqlite');
 const {SqliteStore}=await import('./sqlite-store.mjs');
 const store=new SqliteStore(process.env.SQLITE_PATH||'./data/buildledger.sqlite');
 await store.start();const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8080);
 let app;
 try{
  const trustedProxyIps=(process.env.TRUSTED_PROXY_IPS||'').split(',').map(ip=>ip.trim()).filter(Boolean);
  app=createHttpApp({store,password,secret,storeMode:mode,authMode,host,trustedProxyIps});
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
