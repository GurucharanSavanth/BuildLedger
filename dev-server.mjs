// Zero-dependency development server for Windows, macOS and Linux. Not a production reverse proxy.
import {createServer} from 'node:http';import {readFile,stat} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {resolve,dirname,extname,sep} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));const port=Number(process.env.PORT||8080);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json; charset=utf-8'};
export function createPreviewServer(){return createServer(async(req,res)=>{try{
 const host=(req.headers.host||'').replace(/:\d+$/,'').toLowerCase();
 if(!['127.0.0.1','localhost','[::1]'].includes(host)||req.headers['x-forwarded-host']||req.headers['x-forwarded-for']||req.headers.forwarded){res.writeHead(403);res.end('Local access only');return}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html';
 const allowed=['index.html','styles.css','app.js','finance.js','hierarchy.js','cost-catalog.js','cost-analytics.js','archive.js','project-export.js','db.js','sw.js','manifest.webmanifest','assets/icon.svg'];
 if(!allowed.includes(name)&&!/^assets\/screenshot-[A-Za-z0-9_-]+\.png$/.test(name)){res.writeHead(404);res.end('Not found');return}
 const p=resolve(root,name);if(!p.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return}
 const info=await stat(p);if(!info.isFile()){res.writeHead(404);res.end('Not found');return}const buf=await readFile(p);res.writeHead(200,{'Content-Type':types[extname(p)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Length':buf.length});res.end(req.method==='HEAD'?undefined:buf)
 }catch{res.writeHead(404);res.end('Not found')}})}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))createPreviewServer().listen(port,'127.0.0.1',()=>console.log(`BuildLedger local preview: http://localhost:${port}`));
