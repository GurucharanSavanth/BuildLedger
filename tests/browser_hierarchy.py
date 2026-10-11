"""Browser smoke test for V7 hierarchy with mocked local storage (does not replace live API tests)."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text(encoding='utf-8')
html=html.replace('<link rel="stylesheet" href="./styles.css">','<style>'+(root/'styles.css').read_text(encoding='utf-8')+'</style>')
html=html.replace('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' blob: data:; media-src blob:; frame-src blob:; object-src \'none\'; connect-src \'self\'; base-uri \'self\'; form-action \'self\'">','')
(root/'.tools').mkdir(exist_ok=True)
from browser_module_source import financial_modules
finance=financial_modules(root)
hierarchy=''
mockdb='''let fakeData=emptyState();let fakeFiles=new Map();function storageMode(){return 'local'}async function loginRemote(){}function hasPendingWrite(){return false}async function retryPendingWrite(){}async function readState(){return structuredClone(fakeData)}async function openDb(){return true}async function readFile(id){return fakeFiles.get(id)}async function readAllFiles(){return [...fakeFiles.values()]}async function readSnapshot(){return {state:structuredClone(fakeData),files:[...fakeFiles.values()]}}async function modify(fn,options={}){let next=structuredClone(fakeData);let r=fn(next);next.rev=(fakeData.rev||0)+1;verifyState(next);fakeData=next;for(let x of (options.newFiles||[]))fakeFiles.set(x.id,x);return r}async function replaceAll(st,files){verifyState(st);fakeData=st;fakeFiles=new Map(files.map(x=>[x.id,x]))}'''
archive='\n'.join(x for x in (root/'archive.js').read_text(encoding='utf-8').splitlines() if not x.startswith('import ')).replace('export ','')
app='\n'.join(x for x in (root/'app.js').read_text(encoding='utf-8').splitlines() if not x.startswith('import ')).replace('export ','')
html=html.replace('<script type="module" src="./app.js"></script>','<script>'+finance+'\n'+hierarchy+'\n'+mockdb+'\n'+archive+'\n'+app+'</script>')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('BUILDLEDGER_TEST_CHROME', '/usr/bin/chromium'),args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1350,'height':970})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html);page.wait_for_timeout(150)
 page.locator('#rail-nav [data-nav=explore]').click();page.locator('[data-view=hierarchy]').click()
 assert page.get_by_text('Construction cost explorer').count()==1
 page.locator('[data-action=manage-categories]').click()
 page.locator('[data-action=category-work]').click()
 page.locator('#f-category-stage').fill('Custom underground works')
 page.locator('#f-category-substage').fill('Drainage trenches')
 page.locator('form[data-form=category] button[type=submit]').click()
 page.wait_for_timeout(120)
 print('category toast',page.locator('#toast').inner_text(),'modal visible',page.locator('#modal').is_visible(),'errors',errors)
 page.locator('#rail-nav [data-nav=add]').click();page.locator('[data-flow=purchase]').click()
 assert 'Custom underground works' in page.locator('#f-work').inner_text()
 page.locator('#f-vendor').fill('TMT Supplier')
 page.locator('#f-work').select_option('Custom underground works')
 page.locator('.item-name').fill('Fe500D steel 12 mm')
 page.locator('.item-substage').fill('Drainage trenches')
 page.locator('.item-amount').fill('1200.12')
 page.locator('#entry-form button[type=submit]').click()
 assert 'Check before saving' in page.locator('#modal-inner').inner_text()
 page.locator('[data-action=confirm]').click();page.wait_for_timeout(160)
 page.locator('#rail-nav [data-nav=explore]').click();page.locator('[data-view=hierarchy]').click()
 assert page.get_by_text('Construction cost explorer').count()==1
 assert '₹1,200.12' in page.locator('.hierarchy-panel').inner_text()
 page.locator('[data-hpath]').filter(has_text='Custom underground works').first.click()
 assert page.get_by_text('Drainage trenches').count()>=1
 page.locator('[data-hpath]').filter(has_text='Drainage trenches').last.click()
 assert page.get_by_text('Fe500D steel 12 mm').count()>=1
 page.locator('[data-hpath]').filter(has_text='Fe500D steel 12 mm').last.click()
 assert 'Original bill entries' in page.locator('.hierarchy-panel').inner_text()
 assert '₹1,200.12' in page.locator('.hierarchy-panel').inner_text()
 page.locator('.hierarchy-panel [data-detail^="bill:"]').click()
 assert 'Document' not in page.locator('#modal-inner').inner_text()[:30]
 print('PASS V7 desktop hierarchy drill to source invoice; JS errors:',errors)
 assert not errors,errors
 page.locator('#modal-inner [data-action=close]').first.click()
 page.locator('#rail-nav [data-nav=explore]').click();page.locator('[data-view=hierarchy]').click()
 page.locator('[data-hpath]').first.click()
 page.screenshot(path=str(root/'.tools'/'screenshot-hierarchy-desktop.png'),full_page=True)
 mobile=b.new_page(viewport={'width':390,'height':844})
 merr=[];mobile.on('pageerror',lambda e:merr.append(str(e)))
 mobile.set_content(html);mobile.wait_for_timeout(100)
 mobile.locator('#bottom-nav [data-nav=explore]').click()
 mobile.locator('[data-view=hierarchy]').click()
 assert mobile.get_by_text('Construction cost explorer').count()==1
 assert mobile.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
 mobile.screenshot(path=str(root/'.tools'/'screenshot-hierarchy-mobile.png'),full_page=True)
 assert not merr,merr
 print('PASS V7 mobile hierarchy empty state, no horizontal overflow')
 b.close()
