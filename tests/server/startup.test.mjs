import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('unsupported database configuration exits before creating a SQLite database',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-database-config-')),database=path.join(directory,'test.sqlite');
 try{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../server/http.mjs',import.meta.url))],{env:{...process.env,DATABASE_MODE:'unsupported',AUTH_MODE:'local',SQLITE_PATH:database},encoding:'utf8',timeout:10000});
  assert.ifError(result.error);assert.equal(result.status,1);assert.equal(result.signal,null);
  assert.match(result.stderr,/Startup failed: DATABASE_MODE must be sqlite/);
  await assert.rejects(stat(database),{code:'ENOENT'});
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('occupied port exits cleanly with actionable guidance and leaves the existing listener intact',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'buildledger-startup-')),listener=net.createServer(socket=>socket.end());
 await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const port=listener.address().port;
 try{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../server/http.mjs',import.meta.url))],{env:{...process.env,DATABASE_MODE:'sqlite',AUTH_MODE:'local',HOST:'127.0.0.1',PORT:String(port),SQLITE_PATH:path.join(directory,'test.sqlite')},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('Startup did not exit after port conflict'))},10000);child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('close',(code,signal)=>{clearTimeout(timeout);resolve({code,signal})})});
  assert.equal(result.code,1);assert.equal(result.signal,null);
  assert.match(output,new RegExp(`Startup failed: Port ${port} on 127\\.0\\.0\\.1 is already in use`));
  assert.ok(output.includes(`http://127.0.0.1:${port}`));assert.match(output,/different PORT/);
  assert.doesNotMatch(output,/Unhandled 'error'|node:events|throw er/);
  assert.equal(listener.listening,true);
 }finally{
  await new Promise(resolve=>listener.close(resolve));await rm(directory,{recursive:true,force:true});
 }
});
