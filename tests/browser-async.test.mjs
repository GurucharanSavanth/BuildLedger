import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as finance from '../finance.js';

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n').replace(/start\(\);\s*$/,'');
function harness(){
 const elements=new Map(),listeners=new Map(),document={visibilityState:'visible',getElementById:id=>elements.get(id)||null,
  createElement:tag=>({tagName:tag.toUpperCase(),children:[],appendChild(child){this.children.push(child)},setAttribute(){}}),addEventListener:(name,fn)=>listeners.set(name,fn),querySelector:()=>null};
 const context=vm.createContext({...finance,document,location:{protocol:'file:'},navigator:{storage:{persist:async()=>true}},window:{},
  setInterval:()=>0,setTimeout:()=>0,clearTimeout(){},URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL(){}}});
 vm.runInContext(source,context);
 return {context,elements,listeners,document,run:code=>vm.runInContext(code,context)};
}
function previewElement(){return {isConnected:true,children:[],replaceChildren(){this.children=[]},appendChild(child){this.children.push(child)}}}

test('a delayed original or text decode never fills a different document dialog',async()=>{
 const h=harness(),old=previewElement(),next=previewElement();h.elements.set('document-preview',old);
 h.context.fixture={...finance.emptyState(),files:[{id:'old',name:'old.txt'}]};h.run('state=fixture');
 let releaseFile;h.context.readFile=()=>new Promise(resolve=>{releaseFile=resolve});
 const first=h.run("previewFile('old')");old.isConnected=false;h.elements.set('document-preview',next);
 releaseFile({blob:{type:'text/plain',slice:()=>({text:async()=> 'old text'})}});await first;
 assert.equal(next.children.length,0);

 const current=previewElement();h.elements.set('document-preview',current);
 let releaseText;h.context.readFile=async()=>({blob:{type:'text/plain',slice:()=>({text:()=>new Promise(resolve=>{releaseText=resolve})})}});
 const second=h.run("previewFile('old')");await new Promise(resolve=>setImmediate(resolve));
 current.isConnected=false;h.elements.set('document-preview',next);releaseText('old text');await second;
 assert.equal(next.children.length,0);
});

test('the newest overlapping preview wins when the dialog element stays connected',async()=>{
 const h=harness(),dialog=previewElement();h.elements.set('document-preview',dialog);
 h.context.fixture={...finance.emptyState(),files:[{id:'old',name:'old.txt'},{id:'new',name:'new.txt'}]};h.run('state=fixture');
 const pending=new Map();h.context.readFile=id=>new Promise(resolve=>pending.set(id,resolve));
 const oldPreview=h.run("previewFile('old')"),newPreview=h.run("previewFile('new')");
 const textFile=value=>({blob:{type:'text/plain',slice:()=>({text:async()=>value})}});
 pending.get('new')(textFile('new text'));await newPreview;
 pending.get('old')(textFile('old text'));await oldPreview;
 assert.equal(dialog.children.length,1);assert.equal(dialog.children[0].children[0].textContent,'new text');
});

test('reminders retry after visibility, permission and notification failures, with one startup interval',async()=>{
 const h=harness(),shown=[];let fail=true,intervals=0;
 function Notification(title,options){if(fail)throw Error('Notification failed');shown.push([title,options.body])}
 Notification.permission='default';h.context.Notification=Notification;h.context.window.Notification=Notification;
 h.context.setInterval=()=>++intervals;
 h.context.fixture={...finance.emptyState(),plans:[{id:'due',title:'Stage 1',amount:9000,due:finance.localDate(),remind:0}]};h.run('state=fixture');
 h.document.visibilityState='hidden';await h.run('reminderCheck()');assert.equal(h.run('noticeShown.size'),0);
 Notification.permission='granted';await h.run('reminderCheck()');assert.equal(h.run('noticeShown.size'),0);
 h.document.visibilityState='visible';await assert.rejects(h.run('reminderCheck()'),/Notification failed/);assert.equal(h.run('noticeShown.size'),0);
 fail=false;await h.run('reminderCheck()');await h.run('reminderCheck()');assert.equal(shown.length,1);assert.equal(h.run('noticeShown.size'),1);
 h.run('authenticatedStartup();authenticatedStartup()');assert.equal(intervals,1);assert.equal(h.listeners.has('visibilitychange'),true);
});

test('successful owner sign-in starts reminder work once',async()=>{
 const h=harness();let submit,registrations=0;
 h.elements.set('main',{innerHTML:''});h.elements.set('login-form',{addEventListener:(_name,fn)=>{submit=fn}});
 h.elements.set('owner-password',{value:'test-password'});h.context.loginRemote=async()=>({});h.run('refresh=async()=>{}');
 h.context.setInterval=()=>++registrations;
 h.run('showSignIn()');await submit({preventDefault(){}});await submit({preventDefault(){}});
 assert.equal(registrations,1);assert.equal(h.run('startupDone'),true);
});
