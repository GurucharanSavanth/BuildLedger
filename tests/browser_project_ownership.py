"""Real IndexedDB project ownership races and preview startup on disposable loopback storage."""
import os
from pathlib import Path
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

base_url = os.environ.get('BUILDLEDGER_TEST_LOCAL_URL', 'http://localhost:8098')
parsed = urlparse(base_url)
if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1' or parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1'}:
    raise SystemExit('Requires BUILDLEDGER_TEST_DISPOSABLE=1 and a disposable loopback preview server')
options = webdriver.ChromeOptions()
for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe', '--window-size=1440,1100']:
    options.add_argument(arg)
if os.environ.get('BUILDLEDGER_TEST_CHROME'):
    options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
driver = webdriver.Chrome(service=service, options=options)
driver.set_script_timeout(90)
wait = WebDriverWait(driver, 20)
artifacts = Path(os.environ.get('BUILDLEDGER_TEST_ARTIFACT_DIR', '.tools/browser-ownership'))
artifacts.mkdir(parents=True, exist_ok=True)

try:
    driver.get(base_url)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '#main .empty-projects'))
    assert 'No project' in driver.find_element(By.ID, 'project-name').text
    print('PASS: fresh preview initializes without a SQLite server')
    driver.find_element(By.CSS_SELECTOR, '#main [data-action="projects"]').click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '#modal-inner [data-action="new-project"]'))
    driver.find_element(By.CSS_SELECTOR, '#modal-inner [data-action="new-project"]').click()
    driver.find_element(By.CSS_SELECTOR, 'form[data-form="project-create"] input[name="name"]').send_keys('Owner A')
    driver.find_element(By.CSS_SELECTOR, 'form[data-form="project-create"] button[type="submit"]').click()
    wait.until(lambda d: d.find_element(By.ID, 'project-name').text == 'Owner A')
    result = driver.execute_async_script("""
      const done=arguments[0];(async()=>{
        const db=await import('./db.js'),archive=await import('./archive.js'),{emptyState,uid}=await import('./finance.js');
        const assert=(value,message)=>{if(!value)throw Error(message)};
        const a=(await db.listProjects()).find(p=>p.name==='Owner A'),b=await db.createProject('Owner B');
        const note=title=>({id:uid(),kind:'note',title,notes:'Exact draft input',seconds:17,date:'2026-10-24'});
        const source=emptyState();source.project.name='Restored A';source.entries=[note('Backup A')];
        const zip=await archive.packSnapshot(source,[],'recovery-password');
        await db.selectProject(a.id);let release;
        const restoring=archive.restoreBackup({arrayBuffer:()=>new Promise(resolve=>{release=async()=>resolve(await zip.arrayBuffer())})},'recovery-password');
        await db.selectProject(b.id);await release();await restoring;
        assert((await db.readState(a.id)).entries[0].title==='Backup A','Restore moved to B');
        assert((await db.readState(b.id)).entries.length===0,'B contaminated by restore');
        await Promise.all([db.modify(s=>s.entries.push(note('A save')),{projectId:a.id}),db.modify(s=>s.entries.push(note('B save')),{projectId:b.id})]);
        assert((await db.readState(a.id)).entries.length===2,'A concurrent save missing');
        assert((await db.readState(b.id)).entries.length===1,'B concurrent save missing');
        await db.selectProject(a.id);let finishRestore;
        const conflicting=archive.restoreBackup({arrayBuffer:()=>new Promise(resolve=>{finishRestore=async()=>resolve(await zip.arrayBuffer())})},'recovery-password');
        await db.modify(s=>s.entries.push(note('Newer A work')),{projectId:a.id});
        await finishRestore();let rejected=false;try{await conflicting}catch(error){rejected=/changed/i.test(error.message)}
        assert(rejected,'Restore overwrote a newer destination revision');
        assert((await db.readState(a.id)).entries.some(n=>n.title==='Newer A work'),'Newer work lost');
        await db.selectProject(b.id);
        window.ownershipFixture={a,b};return {a,b};
      })().then(done,error=>done({error:error.stack}));
    """)
    assert not result.get('error'), result
    driver.refresh()
    wait.until(lambda d: d.find_element(By.ID, 'project-name').text == 'Owner B')
    print('PASS: restore/switch/concurrent owners and populated refresh')
    # A real rendered entry retains A even when another tab deletes its project.
    driver.execute_async_script("const done=arguments[1],id=arguments[0];import('./db.js').then(async db=>{await db.selectProject(id);done()}).catch(e=>done(e.stack))", result['a']['id'])
    driver.refresh()
    wait.until(lambda d: d.find_element(By.ID, 'project-name').text == 'Restored A')
    driver.find_element(By.CSS_SELECTOR, '#rail-nav [data-nav="add"]').click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-flow="note"]'))
    driver.find_element(By.CSS_SELECTOR, '[data-flow="note"]').click()
    wait.until(lambda d: d.find_elements(By.ID, 'entry-form'))
    form = driver.find_element(By.ID, 'entry-form')
    assert form.get_attribute('data-project-id') == result['a']['id']
    driver.find_element(By.ID, 'f-title').send_keys('Retained A draft')
    driver.find_element(By.ID, 'f-notes').send_keys('Recover this input')
    original_tab = driver.current_window_handle
    driver.switch_to.new_window('tab')
    driver.get(base_url)
    deletion = driver.execute_async_script("""
      const done=arguments[1],id=arguments[0];import('./db.js').then(async db=>{await db.openDb();await db.deleteProject(id);done(true)}).catch(e=>done(e.stack));
    """, result['a']['id'])
    assert deletion is True, deletion
    driver.close()
    driver.switch_to.window(original_tab)
    submit = driver.find_element(By.CSS_SELECTOR, '#entry-form button[type="submit"]')
    driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'});", submit)
    submit.click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-action="confirm"]'))
    driver.find_element(By.CSS_SELECTOR, '[data-action="confirm"]').click()
    wait.until(lambda d: 'no longer exists' in d.find_element(By.ID, 'toast').text.lower() or 'not found' in d.find_element(By.ID, 'toast').text.lower())
    assert driver.find_element(By.ID, 'f-title').get_attribute('value') == 'Retained A draft'
    assert driver.find_element(By.ID, 'f-notes').get_attribute('value') == 'Recover this input'
    check = driver.execute_async_script("const done=arguments[1],id=arguments[0];import('./db.js').then(async db=>done((await db.readState(id)).entries.map(n=>n.title)))", result['b']['id'])
    assert check == ['B save'], check
    driver.save_screenshot(str(artifacts / 'deleted-owner-draft-retained.png'))
    print('PASS: second-tab deletion rejects save, retains input, leaves B unchanged')
    print('Browser:', driver.capabilities.get('browserVersion'))
finally:
    driver.quit()
