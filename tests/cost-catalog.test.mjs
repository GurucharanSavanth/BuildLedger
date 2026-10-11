import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,verifyState,validateRecordChanges} from '../finance.js';
import {defaultCostCatalog,seedCostCatalog,costCatalog,changeCostCategory,validateCostCatalog,validateClassification,normalizeCostLabel} from '../cost-catalog.js';

test('all 19 heads and construction items seed once with stable identities',()=>{
 const defaults=defaultCostCatalog();assert.equal(defaults.filter(c=>c.type==='head').length,19);
 for(const label of ['M-Sand','C-Sand','P-Sand','20 mm aggregate','40 mm aggregate','OPC cement','PPC cement','JCB hiring','Tanker water','Monthly supervision fee','Contract advances'])assert.ok(defaults.some(c=>c.label===label),label);
 assert.deepEqual(seedCostCatalog(seedCostCatalog()),defaults);assert.deepEqual(defaultCostCatalog(),defaults);
 assert.equal(normalizeCostLabel('  Ｓteel   Materials '),'steel materials');
});
test('custom nodes, rename, ordering and archive keep exact audited identities',()=>{
 const s=emptyState(),before=structuredClone(s);changeCostCategory(s,null,{label:'Custom professional work',parentId:null});validateRecordChanges(before,s);
 const custom=s.settings.costCatalog.at(-1),next=structuredClone(s);changeCostCategory(next,custom.id,{label:'Professional work',active:false,order:0});validateRecordChanges(s,next);assert.equal(next.settings.costCatalog.at(-1).id,custom.id);verifyState(next);
 const active=structuredClone(next);changeCostCategory(active,custom.id,{active:true});validateRecordChanges(next,active);
 assert.throws(()=>changeCostCategory(active,null,{label:'  PROFESSIONAL WORK ',parentId:null}),/already exists/);
 assert.throws(()=>changeCostCategory(active,custom.id,{parentId:'cost-03'}),/identity/);
});
test('legacy projects can manage defaults without rewriting old transactions',()=>{
 const s=emptyState();delete s.settings.costCatalog;s.bills.push({id:'old',total:100,title:'Historical bill'});
 const before=structuredClone(s);changeCostCategory(s,'cost-03',{label:'Electrical services'});validateRecordChanges(before,s);verifyState(s);assert.deepEqual(s.bills,before.bills);
});
test('category audit stores only the changed entity and rejects fabricated evidence',()=>{
 const before=emptyState(),next=structuredClone(before);changeCostCategory(next,'cost-03',{active:false});
 const log=next.audit.at(-1);assert.equal(log.catalogChanges.length,1);assert.equal(log.catalogChanges[0].id,'cost-03');assert.ok(JSON.stringify(log).length<1500);
 validateRecordChanges(before,next);log.catalogChanges[0].before.active=false;assert.throws(()=>validateRecordChanges(before,next),/catalog|Catalog/);
});
test('malformed catalog trees and unknown classification references are rejected',()=>{
 const catalog=defaultCostCatalog();
 for(const patch of [{parentId:'missing'},{parentId:'cost-03-01'},{type:'detail'},{label:''},{aliases:Array(21).fill('x')},{suggestedUnit:'density-guess'},{unboundedPayload:'invalid'}]){const bad=structuredClone(catalog);Object.assign(bad[0],patch);assert.throws(()=>validateCostCatalog(bad));}
 assert.throws(()=>validateCostCatalog(Array(2501).fill(catalog[0])));
 for(const record of [{costSubheadId:'cost-03-01'},{costHeadId:'missing'},{costHeadId:'cost-04',costSubheadId:'cost-03-01'},{costNature:'Payment'},{unitId:'unknown'}])assert.throws(()=>validateClassification(record,catalog));
 const s=emptyState();s.settings.costCatalog[0].active=false;validateClassification({costHeadId:'cost-01'},costCatalog(s));
});
