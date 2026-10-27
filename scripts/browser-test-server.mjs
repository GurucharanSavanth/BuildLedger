// Disposable SQLite only. Never reads .env or the user's project database.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteStore} from '../server/sqlite-store.mjs';
import {createHttpApp} from '../server/http.mjs';
import {randomUUID} from 'node:crypto';
const directory=await mkdtemp(path.join(tmpdir(),'buildledger-browser-'));
const store=new SqliteStore(path.join(directory,'test.sqlite'));await store.start();
const password=process.env.BUILDLEDGER_TEST_OWNER_PASSWORD;
const app=createHttpApp(password?{store,authMode:'owner',password,secret:randomUUID()+randomUUID()}:{store,authMode:'local'});
app.listen(Number(process.env.BUILDLEDGER_TEST_PORT||8099),'127.0.0.1',()=>console.log('Disposable browser server ready'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close(async()=>{
 await store.close();if(!directory.startsWith(path.join(tmpdir(),'buildledger-browser-')))throw Error('Unsafe cleanup path');await rm(directory,{recursive:true,force:true});process.exit(0);
}));
