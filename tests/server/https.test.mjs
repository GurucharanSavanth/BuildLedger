import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHttpApp} from '../../server/http.mjs';

const password='ReleaseTransportPassword',secret='s'.repeat(48);
async function withApp(options,fn){
 let reads=0;
 const app=createHttpApp({store:{async read(){reads++;return {rev:7}}},password,secret,host:'0.0.0.0',...options});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 try{await fn(app.address().port,()=>reads)}finally{await new Promise(resolve=>app.close(resolve))}
}
function request(port,route,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{Host:'release.example',...headers}},res=>{
   let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(data)}));
  });
  req.once('error',reject);req.end(body);
 });
}
const login={method:'POST',headers:{Origin:'https://release.example','Content-Type':'application/json'},body:JSON.stringify({password})};

test('public owner HTTP rejects credentials and spoofed HTTPS headers before parsing a body',async()=>withApp({},async(port,reads)=>{
 for(const headers of [{},{'X-Forwarded-Proto':'https'},{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https'}]){
  const result=await request(port,'/api/v1/login',{...login,headers:{...login.headers,...headers},body:'not JSON'});
  assert.equal(result.status,403);assert.match(result.data.message,/HTTPS/);assert.equal(result.headers['set-cookie'],undefined);
 }
 const shell=await request(port,'/');assert.equal(shell.status,403);
 const health=await request(port,'/api/v1/health');assert.equal(health.status,200);assert.equal(health.data.database,'ready');assert.equal(reads(),0);
}));

test('only a configured proxy peer and single HTTPS value can authenticate or read public records',async()=>{
 for(const peer of ['192.0.2.4','::ffff:7f00:1:2'])await withApp({trustedProxyIps:[peer]},async port=>{
  const result=await request(port,'/api/v1/login',{...login,headers:{...login.headers,'X-Forwarded-Proto':'https','X-Forwarded-For':'127.0.0.1'}});
  assert.equal(result.status,403);
 });
 await withApp({trustedProxyIps:['0:0:0:0:0:ffff:7f00:1']},async port=>{
  assert.equal((await request(port,'/api/v1/login',{...login,headers:{...login.headers,'X-Forwarded-Proto':'https'}})).status,200);
 });
 await withApp({trustedProxyIps:['::ffff:127.0.0.1']},async(port,reads)=>{
  for(const value of ['http','https, http',['https','https']]){
   assert.equal((await request(port,'/api/v1/login',{...login,headers:{...login.headers,'X-Forwarded-Proto':value}})).status,403);
  }
  const auth=await request(port,'/api/v1/login',{...login,headers:{...login.headers,'X-Forwarded-Proto':'https'}});
  assert.equal(auth.status,200);assert.match(auth.headers['set-cookie'][0],/; Secure(?:;|$)/);
  const cookie=auth.headers['set-cookie'][0].split(';')[0];
  const insecure=await request(port,'/api/v1/state',{headers:{Cookie:cookie}});
  assert.equal(insecure.status,403);assert.equal(reads(),0);
  const secure=await request(port,'/api/v1/state',{headers:{Cookie:cookie,'X-Forwarded-Proto':'https'}});
  assert.equal(secure.status,200);assert.deepEqual(secure.data,{rev:7});assert.equal(reads(),1);
  const crossScheme=await request(port,'/api/v1/logout',{method:'POST',headers:{Cookie:cookie,Origin:'http://release.example','X-Forwarded-Proto':'https'}});
  assert.equal(crossScheme.status,403);
  const logout=await request(port,'/api/v1/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://release.example','X-Forwarded-Proto':'https'}});
  assert.equal(logout.status,200);assert.match(logout.headers['set-cookie'][0],/; Secure(?:;|$)/);
 });
});

test('direct owner loopback remains usable over HTTP and invalid proxy peers fail closed',async()=>{
 for(const peer of ['localhost','0.0.0.0/0','127.0.0.1%eth0',''])assert.throws(()=>createHttpApp({store:{},password,secret,trustedProxyIps:[peer]}),/TRUSTED_PROXY_IPS/);
 await withApp({},async port=>{
  const auth=await request(port,'/api/v1/login',{...login,headers:{...login.headers,Host:'127.0.0.1:'+port,Origin:'http://127.0.0.1:'+port}});
  assert.equal(auth.status,200);assert.doesNotMatch(auth.headers['set-cookie'][0],/; Secure/);
 });
});
