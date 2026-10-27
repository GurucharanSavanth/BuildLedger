"""Project manager journey against the disposable SQLite browser server."""
import io
import os
from pathlib import Path
import tempfile
import time
import zipfile
import hashlib

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Set BUILDLEDGER_TEST_DISPOSABLE=1 against scripts/browser-test-server.mjs')

artifacts = Path(os.environ.get('BUILDLEDGER_TEST_ARTIFACT_DIR', '.tools/browser-projects'))
artifacts.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='buildledger-project-download-') as downloads:
    options = webdriver.ChromeOptions()
    for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100', '--remote-debugging-pipe']:
        options.add_argument(arg)
    if os.environ.get('BUILDLEDGER_TEST_CHROME'):
        options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
    options.add_experimental_option('prefs', {
        'download.default_directory': downloads,
        'download.prompt_for_download': False,
        'download.directory_upgrade': True,
        'safebrowsing.enabled': True,
    })
    service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
    driver = webdriver.Chrome(service=service, options=options)
    wait = WebDriverWait(driver, 20)

    def click(selector):
        element = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
        driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'});", element)
        element.click()

    def fill(selector, value):
        element = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, selector)))
        element.clear()
        element.send_keys(value)

    def open_projects():
        click('[data-action="projects"]')
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '#modal-inner .project-list')))

    def create_project(name):
        click('#modal-inner [data-action="new-project"]')
        fill('form[data-form="project-create"] input[name="name"]', name)
        click('form[data-form="project-create"] button[type="submit"]')
        wait.until(EC.invisibility_of_element_located((By.CSS_SELECTOR, '#modal')))
        wait.until(lambda d: d.find_element(By.ID, 'project-name').text == name)

    def add_bill(title, amount):
        click('#rail-nav [data-nav="add"]')
        click('[data-flow="other"]')
        fill('#f-vendor', 'Synthetic browser supplier')
        fill('#f-title', title)
        fill('#f-amount', amount)
        Select(driver.find_element(By.ID, 'f-payStatus')).select_by_value('unpaid')
        click('#entry-form button[type="submit"]')
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '#modal-inner')))
        click('[data-action="confirm"]')
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#activity-search')))

    def project_ids(name):
        rows = driver.find_elements(By.CSS_SELECTOR, '#modal-inner [data-project-row]')
        return [row.find_element(By.CSS_SELECTOR, '[data-action="prepare-project-delete"]').get_attribute('data-id')
                for row in rows if row.find_element(By.CSS_SELECTOR, '.project-row-info strong').text == name]

    def open_delete(project_id):
        click(f'[data-action="prepare-project-delete"][data-id="{project_id}"]')
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '#project-delete-confirm')))

    def api(path):
        return driver.execute_async_script(
            "const done=arguments[1];fetch(arguments[0]).then(r=>r.json()).then(done).catch(e=>done({error:String(e)}));",
            path,
        )

    try:
        driver.get(os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8099'))
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
        assert driver.find_element(By.CSS_SELECTOR, '.empty-projects h1').text == 'Create a project before using BuildLedger'
        click('[data-action="backup"]')
        assert 'Create a project before using BuildLedger' in driver.find_element(By.ID, 'modal-inner').text
        click('#modal-inner [data-action="close"]')
        click('[data-action="settings"]')
        assert 'Developer: Gurucharan S.' in driver.find_element(By.ID, 'modal-inner').text
        click('#modal-inner [data-action="close"]')
        driver.refresh()
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
        click('[data-action="projects"]')
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '#modal-inner .project-list .empty')))
        name = 'Duplicate browser project'
        create_project(name)
        first_id = api('/api/v1/projects')['items'][0]['id']
        add_bill('First project invoice', '123.45')

        click('[data-detail^="bill:"]')
        click('[data-action="edit-entry"]')
        original_tab = driver.current_window_handle
        driver.switch_to.new_window('tab')
        driver.get(os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8099'))
        changed = driver.execute_async_script("""
          const done=arguments[0];Promise.all([import('./db.js'),import('./finance.js')]).then(async([db,f])=>{
            await db.openDb();await db.modify(s=>f.changeEntry(s,'bill',s.bills[0].id,{notes:'Corrected evidence'}));return true
          }).then(done,e=>done({error:e.message}));
        """)
        assert changed is True, changed
        driver.close()
        driver.switch_to.window(original_tab)
        click('form[data-form="edit-entry"] [data-action="create-work-category"]')
        fill('[data-work-stage]', 'New browser stage')
        fill('[data-work-substage]', 'New browser substage')
        click('[data-action="save-work-category"]')
        wait.until(lambda d: 'Work category created' in d.find_element(By.ID, 'toast').text)
        click('form[data-form="edit-entry"] button[type="submit"]')
        wait.until(lambda d: 'entry changed' in d.find_element(By.ID, 'toast').text.lower())
        assert api('/api/v1/state?projectId=' + first_id)['bills'][0]['notes'] == 'Corrected evidence'
        click('#modal-inner [data-action="close"]')

        open_projects()
        create_project(name)
        open_projects()
        ids = project_ids(name)
        assert len(ids) == 2 and len(set(ids)) == 2, ids
        second_id = next(project_id for project_id in ids if project_id != first_id)
        rows = driver.find_elements(By.CSS_SELECTOR, '#modal-inner [data-project-row]')
        labels = [row.find_element(By.CSS_SELECTOR, '.project-row-info').text for row in rows]
        assert all(project_id[:8] in ' '.join(labels) for project_id in ids)
        click('#modal-inner [data-action="close"]')
        add_bill('Second project invoice', '987.65')

        open_projects()
        click(f'[data-action="select-project"][data-id="{first_id}"]')
        wait.until(lambda d: d.find_element(By.ID, 'project-name').text == name)
        open_projects()
        click(f'[data-action="select-project"][data-id="{second_id}"]')
        wait.until(lambda d: d.find_element(By.ID, 'project-name').text == name)
        first_state = api('/api/v1/state?projectId=' + first_id)
        second_state = api('/api/v1/state?projectId=' + second_id)
        assert [bill['title'] for bill in first_state['bills']] == ['First project invoice']
        assert [bill['title'] for bill in second_state['bills']] == ['Second project invoice']

        open_projects()
        open_delete(first_id)
        actions = driver.find_elements(By.CSS_SELECTOR, '.project-delete-actions button')
        assert [button.text for button in actions] == ['Export Project as Excel', 'Delete Permanently', 'No']
        assert not actions[1].is_enabled()
        driver.save_screenshot(str(artifacts / 'project-delete-confirmation.png'))
        click('[data-action="export-project"]')
        wait.until(lambda d: 'Project export download started' in d.find_element(By.ID, 'toast').text)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            files = list(Path(downloads).glob('*.zip'))
            if files and not list(Path(downloads).glob('*.crdownload')):
                break
            time.sleep(0.1)
        assert files, 'Project export download did not complete'
        with zipfile.ZipFile(files[0]) as package:
            names = set(package.namelist())
            assert {'workbook.xlsx', 'export-manifest.json', 'attachments-manifest.json', 'checksums.sha256', 'README.txt'} <= names
            manifest = package.read('export-manifest.json').decode('utf-8')
            assert first_id in manifest and second_id not in manifest
            checksums = package.read('checksums.sha256').decode('utf-8').splitlines()
            for line in checksums:
                digest, path = line.split('  ', 1)
                assert hashlib.sha256(package.read(path)).hexdigest() == digest
            workbook_bytes = package.read('workbook.xlsx')
        with zipfile.ZipFile(io.BytesIO(workbook_bytes)) as workbook:
            records = workbook.read('xl/worksheets/sheet2.xml').decode('utf-8')
            assert 'First project invoice' in records
            assert 'Second project invoice' not in records
        assert len(api('/api/v1/projects')['items']) == 2

        open_projects()
        open_delete(first_id)
        fill('#project-delete-confirm', 'No')
        assert driver.find_element(By.CSS_SELECTOR, '.project-delete-actions [data-action="delete-project"]').get_attribute('disabled') is not None
        click('.project-delete-actions [data-action="close"]')
        assert len(api('/api/v1/projects')['items']) == 2

        open_projects()
        open_delete(first_id)
        updated = driver.execute_async_script("""
          const id=arguments[0],done=arguments[1];import('./db.js').then(async db=>{
            await db.modify(s=>s.entries.push({id:crypto.randomUUID(),kind:'note',title:'New work',date:'2026-10-25'}),{projectId:id});return true
          }).then(done,e=>done({error:e.message}));
        """, first_id)
        assert updated is True, updated
        fill('#project-delete-confirm', 'Yes')
        click('.project-delete-actions [data-action="delete-project"]')
        wait.until(lambda d: 'review it again' in d.find_element(By.ID, 'toast').text.lower())
        assert api('/api/v1/state?projectId=' + first_id)['entries'][0]['title'] == 'New work'
        click('.project-delete-actions [data-action="close"]')

        open_projects()
        open_delete(first_id)
        fill('#project-delete-confirm', 'Yes')
        click('.project-delete-actions [data-action="delete-project"]')
        wait.until(lambda d: len(api('/api/v1/projects')['items']) == 1)
        assert driver.find_element(By.ID, 'project-name').text == name
        assert driver.execute_script("return sessionStorage.getItem('buildledger_active_project')") == second_id

        open_projects()
        open_delete(second_id)
        fill('#project-delete-confirm', 'Yes')
        click('.project-delete-actions [data-action="delete-project"]')
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
        assert api('/api/v1/projects')['items'] == []
        driver.refresh()
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
        assert driver.find_elements(By.CSS_SELECTOR, '#rail-nav [data-nav]') == []
        click('.empty-projects [data-action="new-project"]')
        fill('form[data-form="project-create"] input[name="name"]', 'Restart after final deletion')
        click('form[data-form="project-create"] button[type="submit"]')
        wait.until(lambda d: d.find_element(By.ID, 'project-name').text == 'Restart after final deletion')
        assert len(api('/api/v1/projects')['items']) == 1
        assert api('/api/v1/state')['bills'] == []
        driver.save_screenshot(str(artifacts / 'projects-empty.png'))
        print(f'Project browser journey passed; screenshots: {artifacts.resolve()}')
    finally:
        driver.quit()
