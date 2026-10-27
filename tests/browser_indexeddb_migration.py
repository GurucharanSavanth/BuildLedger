"""Legacy IndexedDB migration and project isolation on disposable localhost storage."""
import os
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.chrome.service import Service

if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Set BUILDLEDGER_TEST_DISPOSABLE=1 and use the localhost preview server')

base_url = os.environ.get('BUILDLEDGER_TEST_LOCAL_URL', 'http://localhost:8098')
parsed = urlparse(base_url)
if parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1'}:
    raise SystemExit('IndexedDB migration tests only run against a loopback HTTP origin')

options = webdriver.ChromeOptions()
for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe']:
    options.add_argument(arg)
if os.environ.get('BUILDLEDGER_TEST_CHROME'):
    options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
driver = webdriver.Chrome(service=service, options=options)
driver.set_script_timeout(60)

try:
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source': """
      const originalFetch=window.fetch.bind(window);
      window.fetch=(input,init)=>{
        const url=new URL(typeof input==='string'?input:input.url,location.href);
        if((location.hostname==='localhost'||location.hostname==='127.0.0.1')&&url.pathname==='/api/v1/health')return Promise.resolve(new Response('',{status:404}));
        return originalFetch(input,init);
      };
    """})
    driver.execute_cdp_cmd('Network.enable', {})
    driver.execute_cdp_cmd('Network.setCacheDisabled', {'cacheDisabled': True})
    driver.execute_cdp_cmd('Network.setBlockedURLs', {'urls': ['*app.js*']})
    driver.get(base_url)
    result = driver.execute_async_script("""
    const done=arguments[0],name='buildledger-web-v1',legacyId='legacy-project';
    const assert=(condition,message)=>{if(!condition)throw Error(message)};
    const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const openV1=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('main');r.result.createObjectStore('blobs',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const openCurrent=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const seed=async(state,file)=>{const d=await openV1(),tx=d.transaction(['main','blobs'],'readwrite');tx.objectStore('main').put(state,'state');tx.objectStore('blobs').put(file);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});d.close()};
    const removeDb=()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Unexpected open IndexedDB connection'))});
    const rawV1=async()=>{const d=await openV1(),tx=d.transaction(['main','blobs'],'readonly'),state=await request(tx.objectStore('main').get('state')),file=await request(tx.objectStore('blobs').get('legacy-original'));d.close();return {version:d.version,state,file,stores:[...d.objectStoreNames]}};
    (async()=>{
      const finance=await import('./finance.js'),db=await import('./db.js'),bytes=[0,1,2,255,65],blob=new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'});
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const fixture=()=>{const state=finance.emptyState();state.project.name='Imported legacy house';state.project.budget=250000;state.rev=7;state.bills.push(finance.makeBill({title:'Legacy invoice',vendor:'Synthetic supplier',date:'2026-10-01',lines:[{label:'Cement',mode:'amount',directAmountPaise:12345}]}));state.files.push({id:'legacy-original',name:'legacy-original.bin',size:bytes.length,type:blob.type,sha256:hash});return state};
      const invalid=fixture();invalid.project.budget=-1;
      await seed(invalid,{id:'legacy-original',name:'legacy-original.bin',size:blob.size,type:blob.type,sha256:hash,blob});
      let rejected=false;try{await db.openDb()}catch{rejected=true}assert(rejected,'Invalid legacy state unexpectedly migrated');
      const failed=await rawV1();assert(failed.version===1&&failed.stores.join(',')==='blobs,main','Failed migration changed IndexedDB schema');
      assert(failed.state.project.budget===-1&&failed.file.blob.size===bytes.length,'Failed migration changed legacy data');
      await removeDb();

      const state=fixture(),billId=state.bills[0].id;
      await seed(state,{id:'legacy-original',name:'legacy-original.bin',size:blob.size,type:blob.type,sha256:hash,blob});
      await db.openDb();
      const projects=await db.listProjects();assert(projects.length===1&&projects[0].id===legacyId,'Legacy project ID or migration scope changed');
      assert(projects[0].name===state.project.name&&projects[0].budget===state.project.budget,'Legacy project metadata changed');
      await db.activeProjectId();let migrated=await db.readSnapshot();assert(migrated.state.bills.length===1&&migrated.state.bills[0].id===billId&&migrated.state.bills[0].total===12345,'Legacy financial data changed');
      assert(JSON.stringify([...new Uint8Array(await migrated.files[0].blob.arrayBuffer())])===JSON.stringify(bytes),'Legacy original bytes changed');
      let d=await openCurrent(),copy=await request(d.transaction('projectBlobs','readonly').objectStore('projectBlobs').get([legacyId,'legacy-original']));d.close();
      assert(copy&&JSON.stringify([...new Uint8Array(await copy.blob.arrayBuffer())])===JSON.stringify(bytes),'Migrated project blob is missing or changed');
      d=await openCurrent();let tx=d.transaction(['main','blobs'],'readonly');
      assert(await request(tx.objectStore('main').get('state'))===undefined,'Verified migration retained obsolete legacy state');
      assert(await request(tx.objectStore('blobs').count())===0,'Verified migration retained duplicate legacy originals');d.close();

      // Reproduce retained duplicate stores from an already upgraded v2 installation.
      d=await openCurrent();tx=d.transaction(['main','blobs'],'readwrite');tx.objectStore('main').put(state,'state');tx.objectStore('blobs').put({id:'legacy-original',blob});
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});d.close();
      await db.modify(current=>{current.files=[]},{projectId:legacyId,removeFiles:['legacy-original']});
      const reopened=await import('./db.js?individual-deletion');await reopened.openDb();
      assert(await reopened.readFile('legacy-original',legacyId)===undefined,'Deleted migrated original became readable after reopen');
      d=await openCurrent();tx=d.transaction(['main','blobs','projectBlobs'],'readonly');
      const removedCopies=await Promise.all([request(tx.objectStore('main').get('state')),request(tx.objectStore('blobs').get('legacy-original')),request(tx.objectStore('projectBlobs').get([legacyId,'legacy-original']))]);d.close();
      assert(removedCopies.every(item=>item===undefined),'Individual deletion retained obsolete legacy records or originals');
      await db.modify(current=>{current.files=state.files},{projectId:legacyId,newFiles:[{id:'legacy-original',blob}]});

      const created=await db.createProject('Separate house'),empty=await db.readState(created.id);
      assert(empty.bills.length===0&&empty.files.length===0&&empty.project.budget===0,'New project copied legacy data');
      await db.selectProject(legacyId);migrated=await db.readSnapshot();assert(migrated.state.bills[0].total===12345,'Switching projects changed legacy ledger');
      const removed=await db.deleteProject(created.id);assert(removed.recordCount===0&&removed.attachmentCount===0&&(await db.listProjects()).length===1,'Deleting a separate project touched legacy data');
      const summary=await db.deleteProject(legacyId);assert(summary.recordCount===1&&summary.attachmentCount===1&&summary.attachmentBytes===bytes.length,'Legacy deletion counts changed');
      assert(await db.activeProjectId()===null&&(await db.readState()).project.name==='','Deleting the final project did not leave an empty ledger');
      d=await openCurrent();tx=d.transaction(['projects','projectStates','projectBlobs','blobs'],'readonly');
      const counts=await Promise.all(['projects','projectStates','projectBlobs','blobs'].map(store=>request(tx.objectStore(store).count())));d.close();
      assert(counts.every(count=>count===0),'Final project deletion left IndexedDB records or blobs');
      return {ok:true,billTotal:12345,legacyId,attachmentBytes:bytes.length};
    })().then(done).catch(error=>done({error:error.message,stack:error.stack}));
    """)
    assert result.get('ok') is True, result
    print(f"PASS IndexedDB v1 migration, fail-closed rollback, exact originals, project isolation and final deletion: {result}")
finally:
    driver.quit()
