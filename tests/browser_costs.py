"""V8 Selenium regression against scripts/browser-test-server.mjs disposable SQLite only."""
import os
import json
from pathlib import Path
from urllib.parse import quote
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Set BUILDLEDGER_TEST_DISPOSABLE=1 against scripts/browser-test-server.mjs')
options = webdriver.ChromeOptions()
for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100', '--remote-debugging-pipe']:
    options.add_argument(arg)
if os.environ.get('BUILDLEDGER_TEST_CHROME'):
    options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
driver = webdriver.Chrome(service=service, options=options)
wait = WebDriverWait(driver, 20)

def click(css):
    element = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, css)))
    driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'});", element)
    wait.until(lambda d: d.execute_script('const r=arguments[0].getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;', element))
    element.click()

def fill(css, value):
    element = driver.find_element(By.CSS_SELECTOR, css)
    element.clear()
    element.send_keys(value)

def select(css, value):
    Select(driver.find_element(By.CSS_SELECTOR, css)).select_by_value(value)

def snapshot():
    return driver.execute_async_script("const done=arguments[0];fetch('/api/v1/state').then(r=>r.json()).then(done)")

def flow(kind):
    click('#rail-nav [data-nav=add]')
    click('[data-flow="' + kind + '"]')

def classify(head, sub, prefix=''):
    select(prefix + '[data-cost=costHeadId]', head)
    assert driver.execute_script('return document.activeElement.dataset.cost') == 'costHeadId'
    select(prefix + '[data-cost=costSubheadId]', sub)

def save():
    click('#entry-form button[type=submit]')
    wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '#modal-inner')))
    click('[data-action=confirm]')
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#activity-search')))

try:
    driver.get(os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8099'))
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
    created = driver.execute_async_script("const done=arguments[0];import('./db.js').then(async db=>{await db.openDb();if((await db.listProjects()).length)throw Error('Expected fresh disposable server');await db.createProject('Browser regression fixture');done(true)}).catch(e=>done({error:e.message}))")
    assert created is True, created
    driver.refresh()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
    driver.execute_async_script("const done=arguments[0];Promise.all([import('./db.js'),import('./cost-catalog.js')]).then(async([db,c])=>{await db.modify(s=>{if(s.settings.costCatalog.find(n=>n.id==='cost-09').active===false)c.changeCostCategory(s,'cost-09',{active:true})});done()})")
    driver.refresh();wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
    flow('other')
    fill('#f-vendor', 'V8 Supplier');fill('#f-title', 'Connection fee');fill('#f-amount', '125.50')
    assert '125.50' in driver.find_element(By.ID, 'entry-preview').text
    custom_category = 'User-defined cost category'
    select('[data-cost=costHeadId]', 'cost-09')
    fill('.classification-search', custom_category);click('[data-create-cost-category]')
    fill('[data-new-cost-category]', custom_category);click('[data-action=save-cost-category]')
    wait.until(lambda d: any(n['label'] == custom_category for n in snapshot()['settings']['costCatalog']))
    custom_category_id = next(n['id'] for n in snapshot()['settings']['costCatalog'] if n['label'] == custom_category)
    assert driver.find_element(By.ID, 'f-vendor').get_attribute('value') == 'V8 Supplier'
    assert driver.find_element(By.ID, 'f-title').get_attribute('value') == 'Connection fee'
    fill('.classification-search', custom_category)
    wait.until(lambda d: any(custom_category in n.text for n in d.find_elements(By.CSS_SELECTOR, '.cost-search-results .category-result')))
    click('[data-pick-cost="' + custom_category_id + '"]')
    assert driver.find_element(By.CSS_SELECTOR, '[data-cost=costHeadId]').get_attribute('value') == 'cost-09'
    assert driver.find_element(By.CSS_SELECTOR, '[data-cost=costSubheadId]').get_attribute('value') == custom_category_id
    select('#f-payStatus', 'unpaid');save()
    category_bill = snapshot()['bills'][-1]
    assert category_bill['lines'][0]['costHeadId'] == 'cost-09'
    assert category_bill['lines'][0]['costSubheadId'] == custom_category_id
    fill('#activity-search', custom_category)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-detail="bill:' + category_bill['id'] + '"]'))

    flow('purchase')
    fill('#f-vendor', 'V8 Supplier');fill('.item-name', 'Wire');fill('.item-amount', '100')
    classify('cost-03', 'cost-03-07', '[data-line="0"] ')
    click('[data-action=add-line]');fill('[data-line="1"] .item-name', 'Plumbing labour');fill('[data-line="1"] .item-amount', '200')
    classify('cost-03', 'cost-03-07', '[data-line="1"] ')
    custom_line_detail = 'User-defined invoice item'
    fill('[data-line="0"] .classification-search', custom_line_detail)
    click('[data-line="0"] [data-create-cost-category]')
    fill('[data-new-cost-category]', custom_line_detail);click('[data-action=save-cost-category]')
    wait.until(lambda d: any(n['label'] == custom_line_detail for n in snapshot()['settings']['costCatalog']))
    custom_line_detail_id = next(n['id'] for n in snapshot()['settings']['costCatalog'] if n['label'] == custom_line_detail)
    assert driver.find_element(By.CSS_SELECTOR, '[data-line="0"] [data-cost=costDetailId]').get_attribute('value') == custom_line_detail_id
    assert custom_line_detail_id in [option.get_attribute('value') for option in driver.find_elements(By.CSS_SELECTOR, '[data-line="1"] [data-cost=costDetailId] option')]
    custom_overall_stage = 'Custom overall work stage'
    custom_overall_substage = 'Pool setup'
    click('#entry-form .grid-form > .work-field [data-action=create-work-category]')
    fill('[data-work-stage]', custom_overall_stage);fill('[data-work-substage]', custom_overall_substage)
    click('[data-action=save-work-category]')
    wait.until(lambda d: d.find_element(By.ID, 'f-work').get_attribute('value') == custom_overall_stage)
    assert driver.find_element(By.CSS_SELECTOR, '[data-line="0"] .item-substage').get_attribute('value') == ''
    custom_work_stage = 'User-defined work stage'
    custom_substage = 'Pool equipment install'
    click('[data-line="0"] [data-action=create-work-category]')
    fill('[data-work-stage]', custom_work_stage);fill('[data-work-substage]', custom_substage)
    click('[data-action=save-work-category]')
    wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '[data-line="0"] .item-work').get_attribute('value') == custom_work_stage)
    assert driver.find_element(By.CSS_SELECTOR, '[data-line="0"] .item-substage').get_attribute('value') == custom_substage
    select('[data-line="0"] [data-cost=costHeadId]', 'cost-04')
    assert Select(driver.find_element(By.CSS_SELECTOR, '[data-line="0"] [data-cost=costSubheadId]')).first_selected_option.get_attribute('value') == ''
    classify('cost-03', 'cost-03-07', '[data-line="0"] ')
    classify('cost-04', 'cost-04-01', '[data-line="1"] ');select('#f-payStatus', 'unpaid');save()
    assert len({l['costHeadId'] for l in snapshot()['bills'][-1]['lines']}) == 2
    work_bill = snapshot()['bills'][-1]
    fill('#activity-search', custom_work_stage)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-detail="bill:' + work_bill['id'] + '"]'))
    fill('#activity-search', custom_overall_stage)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-detail="bill:' + work_bill['id'] + '"]'))

    for title, quantity, rate, unit, quantity_unit, multiplier, expected in [
        ('Bathroom labour', '2', '3500', 'bathroom', '', '1', 700000),
        ('SQ labour', '100', '38500', 'sq100', 'sqft', '1.5', 5775000)]:
        flow('other');fill('#f-vendor', 'V8 Supplier');fill('#f-title', title)
        click('#entry-form details summary')
        select('#f-calculate', 'calculated');fill('#f-calcQty', quantity);fill('#f-calcRate', rate)
        select('#f-unitId', unit);select('#f-quantityUnitId', quantity_unit);fill('#f-multiplier', multiplier)
        classify('cost-04' if unit == 'bathroom' else 'cost-16', 'cost-04-01' if unit == 'bathroom' else 'cost-16-01')
        select('#f-payStatus', 'unpaid');save();assert snapshot()['bills'][-1]['total'] == expected

    flow('labour');fill('#f-vendor', 'V8 Mason');fill('#f-title', 'Calculated wages')
    select('#f-wageMode', 'calculated');fill('#f-qty', '2');fill('#f-rate', '1000')
    assert not driver.find_element(By.CSS_SELECTOR, '#f-amount').get_attribute('required')
    select('#f-payStatus', 'unpaid');save();assert snapshot()['bills'][-1]['total'] == 200000

    flow('other');fill('#f-vendor', 'V8 Transport');fill('#f-title', 'Transport delivery');fill('#f-amount', '100')
    # Simple expenses expose invoice charges without making any mandatory.
    for key, value in [('extras', '10'), ('tax', '5'), ('discount', '2')]:
        element = driver.find_element(By.CSS_SELECTOR, '#f-' + key)
        if not element.is_displayed():
            summary = element.find_element(By.XPATH, 'ancestor::details').find_element(By.TAG_NAME, 'summary')
            driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'});", summary)
            summary.click()
        fill('#f-' + key, value)
    select('#f-payStatus', 'unpaid');click('#entry-form button[type=submit]')
    assert 'Transport appears' in driver.find_element(By.CSS_SELECTOR, '#modal-inner').text
    click('[data-action=confirm]');wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#activity-search')))
    assert snapshot()['bills'][-1]['total'] == 11300

    click('#rail-nav [data-nav=explore]');click('[data-view=cost]')
    for depth in range(3):
        click('.h-row[data-cost-path]')
    click('.hierarchy-panel [data-detail^="bill:"]')
    before = snapshot();click('[data-action=edit-entry]')
    assert len(driver.find_elements(By.CSS_SELECTOR, 'form[data-form=edit-entry] [data-cost=costHeadId]')) == len(driver.find_elements(By.CSS_SELECTOR, '.edit-line'))
    Select(driver.find_element(By.CSS_SELECTOR, '.edit-line [data-cost=costNature]')).select_by_visible_text('Labour')
    click('form[data-form=edit-entry] button[type=submit]')
    wait.until(EC.invisibility_of_element_located((By.CSS_SELECTOR, '#modal')))
    after = snapshot();assert sum(b['total'] for b in before['bills']) == sum(b['total'] for b in after['bills'])
    assert before['payments'] == after['payments'];assert before['allocations'] == after['allocations']

    click('[data-action=manage-categories]');fill('#cost-category-search', 'BWSSB')
    row = 'form[data-form=cost-category-edit][data-id=cost-09] '
    fill(row + 'input[name=label]', 'BWSSB renamed');click(row + 'input[name=active]');click(row + 'button[type=submit]')
    wait.until(lambda d: any(c['id'] == 'cost-09' and c['label'] == 'BWSSB renamed' and not c['active'] for c in snapshot()['settings']['costCatalog']))
    click(row + 'input[name=active]');click(row + 'button[type=submit]')
    wait.until(lambda d: any(c['id'] == 'cost-09' and c['active'] for c in snapshot()['settings']['costCatalog']))
    fill('#f-cost-label', 'Browser custom ' + str(len(snapshot()['audit'])))
    custom_label = driver.find_element(By.CSS_SELECTOR, '#f-cost-label').get_attribute('value')
    click('form[data-form=cost-category] button[type=submit]')
    wait.until(lambda d: any(c['label'] == custom_label for c in snapshot()['settings']['costCatalog']))
    fill('#cost-category-search', custom_label)
    wait.until(lambda d: any(row.is_displayed() and row.find_element(By.CSS_SELECTOR, 'input[name=label]').get_attribute('value') == custom_label
        for row in d.find_elements(By.CSS_SELECTOR, '.cost-manage-row')))
    driver.find_element(By.TAG_NAME, 'body').send_keys(Keys.ESCAPE)
    click('[data-view=hierarchy]');assert 'Construction cost explorer' in driver.find_element(By.CSS_SELECTOR, 'main').text
    flow('contract');fill('#f-vendor', 'V8 Engineer');fill('#f-title', 'Sixteen supervision instalments');fill('#f-amount', '10000.01');fill('#f-count', '16')
    classify('cost-17', 'cost-17-03')
    select('#f-frequency', 'month');save()
    scheduled = snapshot();contract = scheduled['contracts'][-1]
    plans = [p for p in scheduled['plans'] if p.get('contractId') == contract['id']]
    assert len(plans) == 16 and sum(p['amount'] for p in plans) == 1000001
    assert all(p['costHeadId'] == 'cost-17' and p['costSubheadId'] == 'cost-17-03' for p in plans)
    assert sum(b['total'] for b in scheduled['bills']) == sum(b['total'] for b in after['bills'])
    click('#rail-nav [data-nav=explore]');click('[data-view=cost]')
    click('[data-cost-path="%5B%5D"]')
    plan_path = quote(json.dumps(['cost-17'], separators=(',', ':')), safe='')
    click('[data-cost-path="' + plan_path + '"]')
    assert 'No recorded bills under this category' in driver.find_element(By.CSS_SELECTOR, '.hierarchy-panel').text
    click('.hierarchy-panel [data-detail="plan:' + plans[0]['id'] + '"]')
    assert 'Planned payment' in driver.find_element(By.CSS_SELECTOR, '#modal-inner').text
    click('#modal-inner [data-action=close]')
    artifacts = Path(__file__).resolve().parent.parent / '.tools'
    artifacts.mkdir(exist_ok=True)
    driver.execute_script("window.scrollTo({top:0,behavior:'instant'})")
    driver.save_screenshot(str(artifacts / 'cost-explore-desktop.png'))
    flow('contract');fill('#f-vendor', 'V8 Quoted Builder');fill('#f-title', 'Explicit SQ quotation');fill('#f-count', '16')
    click('#entry-form details summary')
    select('#f-calculate', 'calculated');fill('#f-calcQty', '100');fill('#f-calcRate', '38500')
    select('#f-unitId', 'sq100');select('#f-quantityUnitId', 'sqft');fill('#f-multiplier', '1.5')
    assert '57,750' in driver.find_element(By.ID, 'entry-preview').text
    assert 'Multiplier 1.5' in driver.find_element(By.ID, 'entry-preview').text
    fill('#f-multiplier', '0');assert 'Check the amount' in driver.find_element(By.ID, 'entry-preview').text
    fill('#f-multiplier', '1.5');save()
    quoted = snapshot();agreement = quoted['contracts'][-1]
    assert agreement['amount'] == 5775000 and agreement['calculation']['multiplier'] == '1.5'
    assert sum(p['amount'] for p in quoted['plans'] if p.get('contractId') == agreement['id']) == 5775000
    flow('other');driver.execute_script("window.scrollTo({top:0,behavior:'instant'})");driver.save_screenshot(str(artifacts / 'cost-entry-desktop.png'))
    driver.set_window_size(390, 844);click('#bottom-nav [data-nav=add]');click('[data-flow=other]')
    driver.find_element(By.CSS_SELECTOR, '#f-vendor').send_keys(Keys.TAB)
    assert driver.execute_script('return document.activeElement.tagName') in ['INPUT', 'SELECT', 'BUTTON']
    assert driver.execute_script('return document.documentElement.scrollWidth<=window.innerWidth')
    driver.save_screenshot(str(artifacts / 'cost-entry-mobile.png'))
    driver.set_window_size(1440, 1100)
    click('#rail-nav [data-nav=home]')
    driver.save_screenshot(str(artifacts / 'refined-dashboard-desktop.png'))
    click('[data-action=unpaid]')
    assert driver.find_element(By.ID, 'activity-status').get_attribute('value') == 'unpaid'
    select('#activity-head', 'cost-09')
    assert 'BWSSB' in driver.find_element(By.CSS_SELECTOR, '#activity-head option:checked').text
    assert driver.find_elements(By.CSS_SELECTOR, '.activity-row')
    click('[data-action=clear-activity]')
    fill('#activity-search', 'Connection fee')
    assert driver.find_elements(By.CSS_SELECTOR, '.activity-row')
    click('[data-action=clear-activity]')
    driver.execute_async_script("""
      const done=arguments[0];Promise.all([import('./db.js'),import('./finance.js')]).then(async([db,f])=>{
        await db.modify(s=>{for(let i=0;i<155;i++)s.bills.push(f.makeBill({title:'Older record '+i,vendor:'Pagination fixture',date:'2025-01-01',lines:[{label:'Archive test '+i,mode:'amount',directAmountPaise:100}]}))});done();
      }).catch(e=>done(e.message));
    """)
    driver.refresh();wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
    click('#rail-nav [data-nav=activity]');fill('#activity-search', 'Pagination fixture')
    assert len(driver.find_elements(By.CSS_SELECTOR, '.activity-row')) == 75
    click('[data-action=activity-more]');assert len(driver.find_elements(By.CSS_SELECTOR, '.activity-row')) == 150
    click('[data-action=activity-more]');assert len(driver.find_elements(By.CSS_SELECTOR, '.activity-row')) == 155
    click('#rail-nav [data-nav=explore]');click('[data-view=cost]');fill('#cost-search', 'no such category anywhere')
    assert 'No matching costs' in driver.find_element(By.CSS_SELECTOR, 'main').text
    assert not driver.find_elements(By.CSS_SELECTOR, '[data-action=hierarchy-more]')
    if os.environ.get('BUILDLEDGER_TEST_LOCAL_URL'):
        driver.get(os.environ['BUILDLEDGER_TEST_LOCAL_URL'])
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
        created = driver.execute_async_script("const done=arguments[0];import('./db.js').then(async db=>{await db.openDb();await db.createProject('IndexedDB backup fixture');done(true)}).catch(e=>done({error:e.message}))")
        assert created is True, created
        driver.refresh()
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
        driver.set_script_timeout(60)
        result = driver.execute_async_script("""
        const done=arguments[0];(async()=>{
          const db=await import('./db.js'),f=await import('./finance.js'),a=await import('./archive.js');
          await db.openDb();if(db.storageMode()!=='local')throw Error('Expected IndexedDB');
          const password='browser-local-backup-password',bytes=[0,1,2,255,65],blob=new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'});
          const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join(''),fileId=crypto.randomUUID();
          const bill=f.makeBill({title:'IndexedDB classification',vendor:'Local Supplier',date:'2026-10-11',work:'Electrical',place:'Hall',lines:[{label:'Wire',mode:'amount',directAmountPaise:12345,costHeadId:'cost-03',costSubheadId:'cost-03-07',costNature:'Material'}]});
          await db.modify(s=>{s.bills.push(bill);s.files.push({id:fileId,name:'local-original.bin',size:blob.size,type:blob.type,sha256:hash})},{newFiles:[{id:fileId,blob}]});
          const saved=await db.readState(),archive=await a.createBackup(password),decoded=await a.unpackSnapshot(archive,password);
          if(JSON.stringify(saved)!==JSON.stringify(decoded.state))throw Error('Backup changed ledger state');
          if(JSON.stringify(bytes)!==JSON.stringify([...new Uint8Array(await decoded.assets[0].blob.arrayBuffer())]))throw Error('Backup changed original bytes');
          await db.replaceAll(f.emptyState(),[]);
          const destinationRev=(await db.readState()).rev,report=await a.restoreBackup(archive,password),restored=await db.readSnapshot();
          if(restored.state.rev!==destinationRev+1)throw Error('Restore did not advance destination revision');
          const expected={...saved,rev:destinationRev+1};
          if(report.recordCount!==1||report.fileCount!==1||JSON.stringify(restored.state)!==JSON.stringify(expected))throw Error('IndexedDB restore changed the ledger');
          if(JSON.stringify(bytes)!==JSON.stringify([...new Uint8Array(await restored.files[0].blob.arrayBuffer())]))throw Error('IndexedDB restore changed original bytes');
          return {id:bill.id,fileId,hash,bytes};
        })().then(value=>done(value)).catch(e=>done({error:e.message}));""")
        assert 'error' not in result, result
        driver.refresh();wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
        persisted = driver.execute_async_script("const id=arguments[0],done=arguments[arguments.length-1];import('./db.js').then(async db=>{const s=await db.readSnapshot(),f=s.files.find(x=>x.id===id);return {state:s.state,bytes:f?Array.from(new Uint8Array(await f.blob.arrayBuffer())):[]}}).then(done)", result['fileId'])
        assert any(b['id'] == result['id'] and b['lines'][0]['costHeadId'] == 'cost-03' for b in persisted['state']['bills'])
        assert any(f['id'] == result['fileId'] and f['sha256'] == result['hash'] for f in persisted['state']['files'])
        assert persisted['bytes'] == result['bytes']
        print('PASS real IndexedDB backup restore/reopen with exact ledger and original bytes')
    errors = [e for e in driver.get_log('browser') if e['level'] == 'SEVERE' and not (e['source'] == 'network' and '/api/v1/health' in e['message'] and '404' in e['message'])]
    assert not errors, json.dumps(errors)
    print('PASS direct classification/search, exact preview/errors, multiline, bathroom/SQ multiplier, source drill/edit, category archive, activity filters/155-record pagination, mobile keyboard')
finally:
    driver.quit()
