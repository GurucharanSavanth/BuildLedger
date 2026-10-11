/* Stable expense identities, independent of construction stages. No prices or inferred classification. */
export const COST_NATURES=['Material','Labour','Professional Service','Equipment Purchase','Equipment Hire','Utility / Connection','Transport','Fee / Approval','Other'];
export const UNITS=[['direct','Direct Amount'],['kg','Kg'],['tonne','Tonne'],['bag','Bag'],['piece','Piece'],['box','Box'],['set','Set'],['sqft','Sq Ft'],['sq100','SQ (100 Sq Ft)'],['running-foot','Running Foot'],['cft','CFT'],['m3','Cubic Metre'],['metre','Metre'],['litre','Litre'],['tank','Tank'],['trip','Trip'],['load','Load'],['bathroom','Bathroom'],['point','Point'],['hour','Hour'],['day','Day'],['month','Month'],['visit','Visit'],['lump-sum','Lump Sum'],['custom','Custom']].map(([id,label])=>({id,label}));
const definitions=[
 ['Planning Expenses','Preliminary planning expenses|Site survey and measurement|Soil testing / geotechnical investigation|Drawing preparation and documentation|Approval-related expenses|Legal and registration-related professional fees|Site planning and miscellaneous professional services|Other planning expenses'],
 ['Architect Charges','Architectural design charges|Concept and layout drawings|Working and construction drawings|Drawing revisions|Structural consultancy, if separately engaged|Site inspection and consultation|Interior design consultancy|Other professional design charges'],
 ['Electrical','Temporary electricity connection|Permanent electricity connection|Connection deposits and application charges|Electrical labour|Electrical fittings|Electrical accessories|Wires and cables|Conduits, pipes, junction boxes|Distribution boards and protective equipment|Switches and sockets|Lighting fixtures|Earthing and related works|Electrical transport and unloading|Whole-building electrical installation|Electrical testing and commissioning|Other electrical charges'],
 ['Plumbing and Sanitary','Plumbing labour|Plumbing pipes and fittings|Water supply piping|Waste and drainage piping|Bathroom sanitary fixtures|Taps and accessories|Valves, connectors and joints|Water pumps and related fittings|Waterproofing-related plumbing works|Plumbing inspection and testing|Transport and unloading|Other plumbing expenses'],
 ['Construction Materials and Site Works','Sand|Aggregates and Stones|Steel|Cement|Site Labour and Earthworks|Machinery Hire|Construction Water'],
 ['Kitchen Interior','Kitchen cabinetry|Shutters and panels|Countertop|Drawers|Hinges and channels|Handles and hardware|Baskets and organisers|Sink and tap|Kitchen accessories|Appliance installation|Kitchen interior labour|Transportation|Other kitchen interior expenses'],
 ['Flooring','Granite|Vitrified tiles|Ceramic tiles|Bathroom tiles|Parking tiles|Kitchen tiles|Staircase flooring|Skirting|Adhesives and grout|Floor levelling|Flooring labour / laying|Polishing and finishing|Transport and handling|Other flooring expenses'],
 ['Woodwork and Carpentry','Wardrobes|Wardrobe fittings|Wardrobe installation labour|Bedroom cots|Bed storage|Cabinets|Loft storage|Wooden shelves|Plywood and boards|Veneer / laminate|Hinges, handles and channels|Carpentry labour|Polishing and finishing|Other woodwork expenses'],
 ['BWSSB Connection Charges','Application charges|Connection charges|Security deposit|Meter installation|Water connection materials|Connection labour|Inspection / processing charges|Other BWSSB-related payments'],
 ['Building Elevation Materials','Elevation bricks|Brick cladding|Adhesives|Grout and jointing materials|Elevation support materials|Facade finishing|Elevation installation labour|Transport and handling|Other elevation expenses'],
 ['Gates','Vehicular gate|Pedestrian gate|Gate fabrication|Gate materials|Hinges, locks and accessories|Gate automation equipment|Gate installation labour|Painting / powder coating|Transport|Other gate expenses'],
 ['Water Tanks and Tank Construction','Overhead water tank purchase|Underground RCC sump construction|Tank base and support structure|Tank installation labour|Tank waterproofing|Tank piping and fittings|Tank accessories|Tank transport|Testing and commissioning|Other water storage expenses'],
 ['Solar System','Solar panels|Inverter / controller|Mounting structures|Cabling|Electrical protective equipment|Batteries, if applicable|Solar installation labour|Testing and commissioning|Other solar expenses'],
 ['Elevator / Lift','Elevator equipment|Lift cabin and doors|Guide rails and related components|Electrical equipment|Installation labour|Civil modifications|Testing and commissioning|Transport|Maintenance contract|Other elevator expenses'],
 ['UPS and Backup Power','UPS / inverter|Battery bank|Battery accessories|Electrical wiring|Installation labour|Testing and commissioning|Transport|Other backup power expenses'],
 ['Building Labour Contract','Main building labour contract|Excavation and foundation labour|RCC labour|Masonry labour|Plastering labour|Shuttering labour|Other contracted building labour|Contract advances|Contract-related adjustments'],
 ['Engineer Supervision Charges','Monthly supervision fee|Fixed project supervision fee|Scheduled engineer instalments|Site inspection charges|Additional engineering services|Other engineering expenses'],
 ['Doors and Windows','Main entrance door|Internal doors|Bathroom doors|Balcony doors|Aluminium windows|UPVC windows|Wooden windows|Window glass|Door and window hardware|Grills and security fittings|Installation labour|Frames and finishing|Transport and handling|Other door and window expenses'],
 ['Other / Custom Expenses','Other expenses']
];
const materials=[
 'M-Sand|C-Sand|P-Sand|Other sand',
 '20 mm aggregate|40 mm aggregate|Size stone|Border stones|Other stone materials',
 'TMT steel|Reinforcement steel|Binding wire|Other steel materials',
 'OPC cement|PPC cement|Other cement',
 'Soil excavation|Soil dressing and levelling|Soil filling|Soil disposal|Loading and unloading|Site cleaning|Other earthwork labour',
 'JCB hiring|Excavator hiring|Tractor / tipper hire|Other equipment hire',
 'Tanker water|Construction water supply|Tanker transport charges|Other water expenses'
];
const pad=n=>String(n).padStart(2,'0');
const node=(id,label,parentId,type,order,suggestedUnit=null)=>({id,label,parentId,type,order,suggestedUnit,description:'',active:true,origin:'system',aliases:[]});
function suggestedUnit(head,label){
 if(head===5){if(/steel|wire/i.test(label))return 'kg';if(/cement/i.test(label))return 'bag';if(/hire|hiring/i.test(label))return 'hour';if(/water/i.test(label))return 'tank';}
 if(head===4&&/labour/i.test(label))return 'bathroom';
 if(head===3&&/labour/i.test(label))return 'sq100';
 if(head===16)return 'sq100';if(head===17)return /inspection/i.test(label)?'visit':'month';
 return 'lump-sum';
}
export function defaultCostCatalog(){const out=[];definitions.forEach(([label,subs],i)=>{const head=i+1,id='cost-'+pad(head);out.push(node(id,label,null,'head',i));subs.split('|').forEach((sub,j)=>{const sid=id+'-'+pad(j+1);out.push(node(sid,sub,id,'subhead',j,suggestedUnit(head,sub)));if(head===5)materials[j].split('|').forEach((detail,k)=>out.push(node(sid+'-'+pad(k+1),detail,sid,'detail',k,suggestedUnit(head,sub))));});});return out;}
export const normalizeCostLabel=label=>String(label).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN');
export function seedCostCatalog(existing=[]){validateCostCatalog(existing);const ids=new Set(existing.map(c=>c.id));const result=[...existing.map(c=>structuredClone(c)),...defaultCostCatalog().filter(c=>!ids.has(c.id))];validateCostCatalog(result);return result;}
export function costCatalog(state){if(state.settings&&'costCatalog' in state.settings&&!Array.isArray(state.settings.costCatalog))throw Error('Invalid saved cost catalog.');return seedCostCatalog(state.settings?.costCatalog??[]);}
export function validateCostCatalog(catalog){
 if(!Array.isArray(catalog)||catalog.length>2500)throw Error('Cost catalog must contain at most 2500 categories.');
 const ids=new Map(),names=new Set();
 for(const c of catalog){
  if(c&&Object.keys(c).some(key=>!['id','label','parentId','type','order','suggestedUnit','description','active','origin','aliases'].includes(key)))throw Error('Unknown cost category property.');
  if(!c||typeof c.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(c.id)||ids.has(c.id))throw Error('Invalid or duplicate cost category ID.');
  if(typeof c.label!=='string'||!c.label.trim()||c.label.length>140||!['head','subhead','detail'].includes(c.type))throw Error('Invalid cost category label or type.');
  if(c.parentId!==null&&typeof c.parentId!=='string')throw Error('Invalid cost category parent.');
  if(!Number.isSafeInteger(c.order)||c.order<0||c.order>1000000||typeof c.active!=='boolean'||!['system','user'].includes(c.origin))throw Error('Invalid cost category properties.');
  if(c.description!==undefined&&(typeof c.description!=='string'||c.description.length>1000))throw Error('Cost category description is too long.');
  if(c.suggestedUnit!=null&&!UNITS.some(u=>u.id===c.suggestedUnit))throw Error('Unknown suggested unit.');
  if(c.aliases!==undefined&&(!Array.isArray(c.aliases)||c.aliases.length>20||c.aliases.some(x=>typeof x!=='string'||x.length>140)))throw Error('Invalid cost category aliases.');
  const key=JSON.stringify([c.parentId,normalizeCostLabel(c.label)]);if(names.has(key))throw Error('A category with this name already exists under this parent.');names.add(key);ids.set(c.id,c);
 }
 for(const c of catalog){const parent=ids.get(c.parentId);if(c.type==='head'?c.parentId!==null:!parent||parent.type!==(c.type==='subhead'?'head':'subhead'))throw Error('Unknown or invalid cost category parent.');}
 return true;
}
export function validateClassification(record,catalog){
 const ids=catalog instanceof Map?catalog:new Map(catalog.map(c=>[c.id,c]));
 let previous=null;for(const [field,type] of [['costHeadId','head'],['costSubheadId','subhead'],['costDetailId','detail']]){const id=record[field];if(id!=null&&id!==''){const c=ids.get(id);if(!c||c.type!==type||c.parentId!==previous)throw Error('Unknown or mismatched cost classification.');previous=id;}else previous=null;}
 if(record.costNature!=null&&record.costNature!==''&&!COST_NATURES.includes(record.costNature))throw Error('Unknown cost nature.');
 if(record.unitId!=null&&!UNITS.some(u=>u.id===record.unitId))throw Error('Unknown calculation unit.');
 if(record.quantityUnitId!=null&&!UNITS.some(u=>u.id===record.quantityUnitId))throw Error('Unknown quantity unit.');
 if(record.customUnit!=null&&(typeof record.customUnit!=='string'||record.customUnit.length>90))throw Error('Invalid custom unit.');
 return true;
}
export function catalogChildren(catalog,parentId=null,{activeOnly=true}={}){return catalog.filter(c=>c.parentId===parentId&&(!activeOnly||c.active)).sort((a,b)=>a.order-b.order||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));}
export function categoryPath(record,catalog){const ids=new Map(catalog.map(c=>[c.id,c]));return [ids.get(record.costHeadId)?.label||'Unclassified / Legacy',ids.get(record.costSubheadId)?.label||'Not specified',ids.get(record.costDetailId)?.label||'Not specified'];}
export function changeCostCategory(state,id,patch){
 const catalog=costCatalog(state),before=new Map(catalog.map(c=>[c.id,structuredClone(c)]));
 if(id){const c=catalog.find(c=>c.id===id);if(!c)throw Error('Cost category no longer exists.');if(Object.keys(patch).some(k=>!['label','order','active','description','suggestedUnit','aliases'].includes(k)))throw Error('Category identity, type and parent cannot change.');Object.assign(c,patch);}
 else {const parent=catalog.find(c=>c.id===patch.parentId);catalog.push({...node(categoryId(),patch.label,patch.parentId??null,parent?.type==='head'?'subhead':parent?.type==='subhead'?'detail':'head',catalog.filter(c=>c.parentId===(patch.parentId??null)).length),...patch,origin:'user'});}
 validateCostCatalog(catalog);state.settings??={};state.settings.costCatalog=catalog;
 const catalogChanges=catalog.filter(c=>JSON.stringify(before.get(c.id))!==JSON.stringify(c)).map(c=>({id:c.id,before:before.get(c.id)||null,after:structuredClone(c)}));
 state.audit.push({id:categoryId(),type:'cost_catalog',description:id?'Updated cost category: '+catalog.find(c=>c.id===id).label:'Added cost category: '+patch.label,at:new Date().toISOString(),catalogChanges});
 return catalog;
}
function categoryId(){return typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');}
