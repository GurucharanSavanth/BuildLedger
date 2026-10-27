import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as finance from '../finance.js';
import * as hierarchy from '../hierarchy.js';
import * as catalog from '../cost-catalog.js';
import * as analytics from '../cost-analytics.js';

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n').replace(/start\(\);\s*$/,'');
function harness(){
 const elements=new Map(),element=id=>elements.get(id)||null;
 elements.set('modal',{hidden:true});
 elements.set('main',{innerHTML:'draft',querySelector:()=>null,insertAdjacentHTML(where,html){this.notice=html}});
 const context=vm.createContext({...finance,...hierarchy,...catalog,...analytics,document:{getElementById:element},hasPendingWrite:()=>false,clearInterval(){},setTimeout(){},clearTimeout(){}});
 vm.runInContext(source,context);
 return {elements,context,run:code=>vm.runInContext(code,context)};
}

test('form action buttons never submit entries implicitly',()=>{
 const h=harness();for(const action of ['start-timer','stop-timer','reset-timer','add-line'])assert.match(h.run(`btn('${action}','Action')`),/type="button"/);
});

test('cross-tab refresh preserves drafts, including edits started during its read',async()=>{
 const h=harness();let resolve,reads=0;h.context.activeProjectId=async()=>'test-project';h.run('selectedProject="test-project"');
 h.context.readState=()=>{reads++;return new Promise(r=>resolve=r)};
 h.elements.set('entry-form',{});
 await h.run('refreshFromOtherTab()');assert.equal(reads,0);assert.match(h.elements.get('main').notice,/draft is preserved/);
 h.elements.delete('entry-form');const refresh=h.run('refreshFromOtherTab()');
 await new Promise(done=>setImmediate(done));h.elements.set('entry-form',{});resolve({...finance.emptyState(),rev:99});await refresh;
 assert.equal(h.run('state.rev'),0);assert.equal(h.elements.get('main').innerHTML,'draft');
});

test('payment review rejects invalid links before opening a dialog',()=>{
 const h=harness(),s=finance.emptyState();s.bills=[{id:'bill',vendor:'Supplier',total:100}];s.plans=[{id:'plan',vendor:'Supplier',amount:100}];
 h.context.fixture=s;h.run('state=fixture');h.context.opened=0;h.run('openModal=()=>opened++');
 h.context.data={kind:'payment',vendor:'Supplier',billId:'bill',amount:101};assert.throws(()=>h.run('reviewModal(data)'),/unpaid bill balance/);
 h.context.data={kind:'payment',vendor:'Other',planId:'plan',amount:50};assert.throws(()=>h.run('reviewModal(data)'),/recipient does not match/);
 assert.equal(h.context.opened,0);assert.equal(h.run('pending'),null);
});

test('note review freezes duration; failed save retains it; successful save resets it',async()=>{
 const h=harness();h.context.now=Date.now();h.run('flow="note";timerStart=now-5000;timerSeconds=3;endClock()');
 assert.equal(h.run('timerStart'),null);assert.ok(h.run('timerSeconds')>=8);
 h.context.data={kind:'note',title:'Visit',date:'2026-10-12',seconds:8};h.run('pending=data;toast=()=>{};closeModal=()=>{};goto=()=>{};commit=async()=>{throw Error("Failed save")}');
 await h.run('confirmEntry()');assert.ok(h.run('timerSeconds')>=8);assert.equal(h.run('pending.seconds'),8);
 h.context.saved=finance.emptyState();h.run('commit=async callback=>callback(saved)');await h.run('confirmEntry()');
 assert.equal(h.run('timerSeconds'),0);assert.equal(h.run('timerStart'),null);assert.equal(h.context.saved.entries[0].seconds,8);
});

test('oversize attachment is rejected before reading its bytes',async()=>{
 const h=harness();h.context.file={size:25*1024*1024+1,arrayBuffer(){throw Error('Bytes should not be read')}};
 await assert.rejects(h.run('fileInputToObject(file,"Bills and proof")'),/25 MB browser import limit/);
});

test('restore description names the active replacement destination',()=>{
 const h=harness();h.run('selectedProject="backup-destination"');h.context.storageMode=()=> 'remote';assert.match(h.run('backupUI()'),/persistent server project, for every connected browser/);
 h.context.storageMode=()=> 'local';assert.match(h.run('backupUI()'),/in this browser on this device/);
});

test('verified uncertain save resets timer; a failed or absent retry keeps its duration',async()=>{
 const h=harness();h.run('timerSeconds=8;flow="note";closeModal=()=>{};refresh=async()=>{};toast=()=>{}');
 h.context.event={target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'retry-save'}}:null}};
 h.context.retryPendingWrite=async()=>{throw Error('Still uncertain')};await h.run('actionClick(event)');assert.equal(h.run('timerSeconds'),8);
 h.context.retryPendingWrite=async()=>{};await h.run('actionClick(event)');assert.equal(h.run('timerSeconds'),8);
 h.context.retryPendingWrite=async()=>({ok:true});await h.run('actionClick(event)');assert.equal(h.run('timerSeconds'),0);
});

test('legacy adjustment-only invoices remain visible as unclassified and export honest evidence',async()=>{
 const h=harness(),s=finance.emptyState();s.bills=[{id:'legacy',title:'Old invoice',vendor:'Supplier',total:100,extras:100,lines:[{label:'Wire',mode:'amount',directAmountPaise:0,value:0,costHeadId:'cost-03'}]}];
 h.context.fixture=s;h.run('state=fixture;activityFilter="bill";activityStatus="unclassified"');assert.equal(h.run('filteredActivity()[0].id'),'legacy');
 h.context.Blob=Blob;let exported;h.context.downloadBlob=blob=>exported=blob;h.run('csv()');
 const row=(await exported.text()).split('\r\n')[1];assert.match(row,/Unclassified invoice adjustments/);assert.match(row,/Unclassified \/ Legacy/);assert.doesNotMatch(row,/Electrical|"Wire"/);
});
