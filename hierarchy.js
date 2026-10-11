/* Hierarchical expenditure read model.
 * Values are exact integer paise. Every posted bill is allocated exactly once
 * across source lines, then indexed as Stage > Substage > Material > Entries.
 * Original invoice data is never mutated by analytical grouping.
 */
import {add, sum, proportional, lineValue} from './finance.js';

const label=(value, fallback)=>{
  const s=String(value??'').trim();
  return s || fallback;
};
const children=()=>new Map();
const makeNode=(name,depth)=>({name,depth,total:0,count:0,children:children(),entries:[]});
export function buildHierarchy(state) {
  const root=makeNode('All recorded bills',0);
  for(const bill of state.bills||[]) {
    if (!Number.isSafeInteger(bill.total) || bill.total<0) throw Error('Invalid bill amount for hierarchy');
    const lines=Array.isArray(bill.lines) && bill.lines.length ? bill.lines : [{label:bill.title,work:bill.work,substage:bill.substage,place:bill.place,value:bill.total}];
    const weights=lines.map(line=>Number.isSafeInteger(line.value)?line.value:lineValue(line));
    const amounts=proportional(bill.total,weights);
    amounts.forEach((amount,i)=>{
      // Zero-share line records do not affect monetary aggregates.
      if (!amount) return;
      const line=lines[i];
      const labels=[label(line.work||bill.work,'Uncategorised'),label(line.substage||bill.substage,'Not specified'),label(line.label||bill.title,'Unnamed item')];
      let node=root;
      node.total=add(node.total,amount);
      const evidence={billId:bill.id, billTitle:bill.title||'Untitled bill', vendor:bill.vendor||'Unknown supplier',
        amount, date:bill.date||'', lineIndex:i, lineLabel:labels[2], work:labels[0], substage:labels[1], place:line.place||bill.place||''};
      for (let depth=0;depth<labels.length;depth++) {
        const name=labels[depth];
        if (!node.children.has(name)) node.children.set(name,makeNode(name,depth+1));
        node=node.children.get(name);
        node.total=add(node.total,amount);
      }
      node.entries.push(evidence);
    });
  }
  // Derive actual distinct bill counts at each level from child leaf references.
  const fillCounts=node=>{
    if (!node.children.size) { node.count=new Set(node.entries.map(e=>e.billId)).size; return new Set(node.entries.map(e=>e.billId)); }
    const ids=new Set();
    for(const child of node.children.values()) for(const id of fillCounts(child)) ids.add(id);
    node.count=ids.size;return ids;
  };
  fillCounts(root);
  return root;
}
export function resolveHierarchy(root,path=[]) {
  if (!Array.isArray(path) || path.length>3) return null;
  let node=root;
  for(const part of path){ if(typeof part!=='string')return null; node=node.children.get(part); if(!node)return null; }
  return node;
}
export function hierarchyEntries(node) {
  if (!node) return [];
  const result=[];
  const walk=current=>{result.push(...current.entries);for(const c of current.children.values())walk(c)};
  walk(node);
  return result.sort((a,b)=>b.amount-a.amount||a.billId.localeCompare(b.billId)||a.lineIndex-b.lineIndex);
}
export function hierarchyChildren(node) {
  return [...(node?.children?.values()||[])].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
}
export function hierarchySummary(root,path=[]) {
  const node=resolveHierarchy(root,path);
  if(!node)return null;
  const children=hierarchyChildren(node);
  const summed=sum(children.map(x=>x.total));
  if(children.length && summed!==node.total)throw Error('Hierarchy total mismatch');
  return {path,total:node.total,count:node.count,children:children.map(c=>({name:c.name,total:c.total,count:c.count})),entries:path.length===3?hierarchyEntries(node):[]};
}
