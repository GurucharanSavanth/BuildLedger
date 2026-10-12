/* Cost classification reads source invoices; payments and plans never add cost. */
import {add, sum, proportional, lineValue, invoiceCostLines} from './finance.js';
import {costCatalog} from './cost-catalog.js';

export function allocatedCostLines(state) {
  const result=[];
  for(const bill of state.bills||[]) {
    if(!Number.isSafeInteger(bill.total)||bill.total<=0)throw Error('Invalid bill amount for cost analytics');
    const lines=invoiceCostLines(bill);
    const amounts=proportional(bill.total,lines.map(line=>Number.isSafeInteger(line.value)?line.value:lineValue(line)));
    lines.forEach((line,lineIndex)=>{
      if(!amounts[lineIndex])return;
      result.push({billId:bill.id,billTitle:bill.title||'Untitled bill',vendor:bill.vendor||'Unknown supplier',date:bill.date||'',lineIndex:lines===bill.lines?lineIndex:-1,
        lineLabel:line.label||bill.title||'Unnamed item',amount:amounts[lineIndex],work:line.work||bill.work||'',substage:line.substage||bill.substage||'',place:line.place||bill.place||'',
        costHeadId:line.costHeadId||null,costSubheadId:line.costSubheadId||null,costDetailId:line.costDetailId||null,costNature:line.costNature||null});
    });
  }
  return result;
}
const node=(id,name,depth)=>({id,name,depth,total:0,count:0,children:new Map(),entries:[]});
export function buildCostHierarchy(state) {
  const catalog=new Map(costCatalog(state).map(category=>[category.id,category]));
  const root=node('cost-root','All recorded bills',0),billIds=new Map([[root,new Set()]]);
  for(const entry of allocatedCostLines(state)) {
    const ids=[entry.costHeadId||'legacy-head',entry.costSubheadId||'legacy-subhead',entry.costDetailId||'legacy-detail'];
    const names=ids.map((id,i)=>catalog.get(id)?.label||(i===0?'Unclassified / Legacy':'Not specified'));
    let current=root;
    current.total=add(current.total,entry.amount);billIds.get(current).add(entry.billId);
    ids.forEach((id,i)=>{
      if(!current.children.has(id)){const child=node(id,names[i],i+1);current.children.set(id,child);billIds.set(child,new Set())}
      current=current.children.get(id);current.total=add(current.total,entry.amount);billIds.get(current).add(entry.billId);
    });
    current.entries.push(entry);
  }
  for(const [current,ids] of billIds)current.count=ids.size;
  return root;
}
export function costHierarchySummary(root,path=[]) {
  if(!Array.isArray(path)||path.length>3||path.some(id=>typeof id!=='string'))return null;
  let current=root;
  for(const id of path){current=current.children.get(id);if(!current)return null}
  const children=[...current.children.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  if(children.length&&sum(children.map(child=>child.total))!==current.total)throw Error('Cost hierarchy does not reconcile');
  return {path,total:current.total,count:current.count,children:children.map(({id,name,total,count})=>({id,name,total,count})),
    entries:path.length===3?current.entries.slice().sort((a,b)=>b.amount-a.amount||a.billId.localeCompare(b.billId)||a.lineIndex-b.lineIndex):[]};
}
export function costBreakdown(state,key='head') {
  if(!['head','subhead','nature'].includes(key))throw Error('Unknown cost breakdown dimension');
  const catalog=new Map(costCatalog(state).map(category=>[category.id,category])),groups=new Map();
  for(const entry of allocatedCostLines(state)) {
    const head=catalog.get(entry.costHeadId),subhead=catalog.get(entry.costSubheadId);
    const name=key==='nature'?entry.costNature||'Unclassified / Legacy':key==='subhead'&&head?`${head.label} → ${subhead?.label||'Not specified'}`:head?.label||'Unclassified / Legacy';
    groups.set(name,add(groups.get(name)||0,entry.amount));
  }
  return [...groups].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
