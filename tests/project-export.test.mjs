import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {emptyState,verifyState} from '../finance.js';
import {createProjectExport,projectExportTest} from '../project-export.js';
import {parseZip} from '../archive.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const text=bytes=>new TextDecoder().decode(bytes);

test('project export is a verified project-only XLSX package with safe text, formulas, chart, links, and original bytes',async()=>{
 const state=emptyState(),first=Buffer.from([0,1,2,255,65]),second=Buffer.from('original unicode file bytes'),projectId='project_001';
 state.project.name='=HYPERLINK("https://bad.invalid")';
 state.bills=[{id:'bill_0001',date:'2026-10-20',recordedAt:'2026-10-20T10:00:00Z',vendor:'@Supplier',title:'=2+3',total:12345}];
 state.payments=[{id:'payment_01',date:'2026-10-21',recordedAt:'2026-10-21T10:00:00Z',vendor:'@Supplier',amount:5000,reference:'+cmd'}];
 state.allocations=[{id:'alloc_0001',paymentId:'payment_01',billId:'bill_0001',amount:2500,recordedAt:'2026-10-21T11:00:00Z'}];
 state.contracts=[{id:'contract_01',createdAt:'2026-10-01',vendor:'Supplier',title:'Labour',amount:25000}];
 state.plans=[{id:'plan_00001',due:'2026-12-01',vendor:'Supplier',title:'Roof stage',amount:10000}];
 state.files=[{id:'file_00001',name:'清单.pdf',type:'application/pdf',size:first.length,sha256:sha(first),importedAt:'2026-10-22T10:00:00Z'},{id:'file_00002',name:'清单.pdf',type:'application/pdf',size:second.length,sha256:sha(second)}];
 state.audit=[{id:'audit_0001',type:'settings',description:'Updated project',at:'2026-10-22T12:00:00Z',changes:[{before:'=1+1',after:'@unsafe'}]}];
 verifyState(state);
 const blob=await createProjectExport(state,[{id:'file_00001',blob:new Blob([first],{type:'application/pdf'})},{id:'file_00002',blob:new Blob([second],{type:'application/pdf'})}],projectId);
 const packageEntries=parseZip(new Uint8Array(await blob.arrayBuffer())),workbook=parseZip(packageEntries.get('workbook.xlsx'));
 assert.deepEqual([...packageEntries.keys()].filter(path=>path.startsWith('attachments/')).sort(),['attachments/file_00001','attachments/file_00002']);
 assert.deepEqual(Buffer.from(packageEntries.get('attachments/file_00001')),first);
 assert.deepEqual(Buffer.from(packageEntries.get('attachments/file_00002')),second);
 assert.match(text(workbook.get('xl/workbook.xml')),/Bills|Payments|Cash flow/);
 assert.match(text(workbook.get('xl/worksheets/sheet2.xml')),/state="frozen"/);
 assert.match(text(workbook.get('xl/tables/table1.xml')),/ref="A1:M2"/);
 assert.match(text(workbook.get('xl/tables/table1.xml')),/autoFilter/);
 assert.match(text(workbook.get('xl/worksheets/sheet1.xml')),/<f>SUM\(Bills!E2:E2\)<\/f>/);
 assert.match(text(workbook.get('xl/worksheets/sheet4.xml')),/2026-10-21T11:00:00Z/);
 assert.match(text(workbook.get('xl/charts/chart1.xml')),/Cash flow/);
 const billSheet=text(workbook.get('xl/worksheets/sheet2.xml'));assert.match(billSheet,/<t xml:space="preserve">=2\+3<\/t>/);assert.doesNotMatch(billSheet,/<f>=2\+3<\/f>/);
 assert.match(text(workbook.get('xl/worksheets/sheet7.xml')),/attachments\/file_00001/);
 assert.match(text(workbook.get('xl/worksheets/_rels/sheet7.xml.rels')),/Target="attachments\/file_00001"/);
 const checks=text(packageEntries.get('checksums.sha256'));assert.match(checks,new RegExp(sha(packageEntries.get('workbook.xlsx'))));assert.match(checks,new RegExp(sha(first)));assert.match(checks,new RegExp(sha(second)));
 const manifest=JSON.parse(text(packageEntries.get('export-manifest.json')));assert.deepEqual(manifest.accounting,{recordedCostPaise:12345,cashPaidPaise:5000,billSettlementsPaise:2500,outstandingCostPaise:9845,supplierAdvancesPaise:2500,commitmentsPaise:25000,futureSchedulesPaise:10000,exactPaiseTextIsAuthoritative:true});
});

test('project export preserves exact schedule and commitment totals above safe integer range',async()=>{
 const state=emptyState(),max=Number.MAX_SAFE_INTEGER;
 state.contracts=[{id:'c1',amount:max},{id:'c2',amount:1}];
 state.plans=[{id:'p1',amount:max,due:'2026-01-01'},{id:'p2',amount:1,due:'2026-02-01'}];
 verifyState(state);
 const packed=parseZip(new Uint8Array(await (await createProjectExport(state,[],'project_large')).arrayBuffer()));
 const manifest=JSON.parse(text(packed.get('export-manifest.json'))),workbook=parseZip(packed.get('workbook.xlsx'));
 assert.equal(manifest.accounting.commitmentsPaise,'9007199254740992');
 assert.equal(manifest.accounting.futureSchedulesPaise,'9007199254740992');
 assert.match(text(workbook.get('xl/worksheets/sheet1.xml')),/9007199254740992/);
 assert.deepEqual(JSON.parse(text(packed.get('records.json'))),state);
});

test('project export rejects changed or missing originals',async()=>{
 const state=emptyState(),bytes=Buffer.from('verified original');state.files=[{id:'file_00001',name:'proof.bin',type:'application/octet-stream',size:bytes.length,sha256:sha(bytes)}];
 await assert.rejects(()=>createProjectExport(state,[],'project_001'),/missing/);
 await assert.rejects(()=>createProjectExport(state,[{id:'file_00001',blob:new Blob(['modified'])}],'project_001'),/verification failed/);
});

test('project export preserves every record and nested invoice/work-log field with a verifiable inventory',async()=>{
 const state=emptyState();state.rev=7;state.project.name='Complete export';state.project.budget=50000;
 state.bills=[{id:'bill_complete',date:'2026-10-24',recordedAt:'2026-10-24T01:02:03.456Z',vendor:'Supplier',title:'Materials',notes:'Invoice note with \n two lines',total:135,extras:10,tax:5,discount:3,lines:[{label:'Nails',mode:'amount',directAmountPaise:123,value:123,qty:null,rate:null,unit:null,work:'Foundation',substage:'Formwork',place:'Sump'}]}];
 state.entries=[{id:'work_log_01',kind:'note',title:'Site visit',date:'2026-10-25',work:'Foundation',notes:'Measured sump\nKeep original note',seconds:3661,recordedAt:'2026-10-24T23:59:59.999+05:30',status:'Saved',customEvidence:{untouched:true}}];
 state.audit=[{id:'audit_complete',at:'2026-10-24T01:02:03.456Z',type:'bill_create',description:'Original evidence',linked:'bill_complete',before:null,after:structuredClone(state.bills[0])}];
 const before=structuredClone(state),packed=parseZip(new Uint8Array(await (await createProjectExport(state,[],'project_complete')).arrayBuffer()));
 assert.ok(packed.has('records.json'),'Authoritative project records must be exported');
 assert.deepEqual(JSON.parse(text(packed.get('records.json'))),before);
 const manifest=JSON.parse(text(packed.get('export-manifest.json')));
 assert.equal(manifest.format,2);assert.equal(manifest.records.path,'records.json');assert.equal(manifest.records.sha256,sha(packed.get('records.json')));
 for(const kind of ['bills','payments','allocations','plans','contracts','entries','files','audit']){
  assert.equal(manifest.recordTypes[kind].count,before[kind].length,kind);
  assert.deepEqual(manifest.recordTypes[kind].ids,before[kind].map(record=>record.id),kind);
 }
 assert.equal(manifest.invoiceLineCount,1);assert.equal(manifest.recordCounts.workLogs,1);
 const workbook=parseZip(packed.get('workbook.xlsx')),parts=[...workbook.values()].map(text).join('\n');
 for(const payload of ['Invoice lines','Work logs','Invoice note with','Measured sump','3661','Nails','123','Formwork'])assert.ok(parts.includes(payload),payload);
 assert.match(text(packed.get('checksums.sha256')),new RegExp(sha(packed.get('records.json'))+'  records.json'));
 assert.deepEqual(state,before,'Export must not modify source or trigger deletion');
});

test('empty project export includes all authoritative record types and analysis sheets',async()=>{
 const state=emptyState(),packed=parseZip(new Uint8Array(await (await createProjectExport(state,[],'project_empty')).arrayBuffer())),manifest=JSON.parse(text(packed.get('export-manifest.json')));
 assert.deepEqual(JSON.parse(text(packed.get('records.json'))),state);
 assert.equal(Object.keys(manifest.recordTypes).length,8);assert.ok(Object.values(manifest.recordTypes).every(type=>type.count===0&&type.ids.length===0));
 assert.equal(manifest.invoiceLineCount,0);assert.equal(manifest.recordCounts.workLogs,0);
 const workbook=parseZip(packed.get('workbook.xlsx'));assert.match(text(workbook.get('xl/workbook.xml')),/Work logs/);assert.match(text(workbook.get('xl/workbook.xml')),/Invoice lines/);
});

test('imported formula objects remain text and long cells preserve full authoritative records',async()=>{
 const state=emptyState(),notes='x'.repeat(32766)+'😀'+ 'full original tail';
 state.entries=[{id:'note',title:'Long evidence',notes,seconds:{formula:'WEBSERVICE("https://bad.invalid")',cached:1}}];
 const packed=parseZip(new Uint8Array(await (await createProjectExport(state,[],'p')).arrayBuffer()));
 assert.deepEqual(JSON.parse(text(packed.get('records.json'))),state);
 const workbook=parseZip(packed.get('workbook.xlsx')),sheet=text(workbook.get('xl/worksheets/sheet10.xml'));
 assert.doesNotMatch(sheet,/<f>/);
 assert.match(sheet,/WEBSERVICE/);
 const values=[...sheet.matchAll(/<t xml:space="preserve">([^]*?)<\/t>/g)].map(match=>match[1].replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
 assert.ok(values.every(value=>value.length<=32767));
 assert.ok(values.some(value=>value.includes('records.json')));
 assert.doesNotMatch(projectExportTest.cell('A1','\u0001\uD800\uFFFE'),/[\u0001\uD800\uFFFE]/u);
});

test('project export supports safe short attachment IDs and rejects path syntax',async()=>{
 const state=emptyState(),bytes=Buffer.from('short ID original');state.files=[{id:'f1',name:'proof',type:'text/plain',size:bytes.length,sha256:sha(bytes)}];
 const packed=parseZip(new Uint8Array(await (await createProjectExport(state,[{id:'f1',blob:new Blob([bytes])}],'p')).arrayBuffer()));
 assert.deepEqual(Buffer.from(packed.get('attachments/f1')),bytes);
 await assert.rejects(()=>createProjectExport(state,[],'../p'),/unsafe/);
});
