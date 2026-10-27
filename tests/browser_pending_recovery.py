"""Retained-save recovery against fresh disposable HTTP/SQLite and real Chrome IndexedDB."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Set BUILDLEDGER_TEST_DISPOSABLE=1 against a fresh scripts/browser-test-server.mjs instance')

base = os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8107').rstrip('/')
if urllib.parse.urlparse(base).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('This test requires a disposable loopback server')
artifacts = Path(os.environ.get('BUILDLEDGER_TEST_ARTIFACT_DIR', '.tools/browser-pending-recovery')).resolve()
artifacts.mkdir(parents=True, exist_ok=True)
original_bytes = bytes([0, 255, 13, 10, 42])
original = artifacts / 'synthetic-original.bin'
original.write_bytes(original_bytes)


def api(route, method='GET', data=None):
    request = urllib.request.Request(base + route, method=method,
                                    data=None if data is None else json.dumps(data).encode(),
                                    headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


assert api('/api/v1/health')['auth'] == 'not_required'
assert api('/api/v1/projects')['items'] == [], 'Refusing a nonempty server; start a fresh disposable instance'
project_a = api('/api/v1/projects', 'POST', {'name': 'A recovery project'})
project_b = api('/api/v1/projects', 'POST', {'name': 'B recovery project'})

with tempfile.TemporaryDirectory(prefix='buildledger-pending-download-') as downloads:
    options = webdriver.ChromeOptions()
    for argument in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
                     '--window-size=1440,1100', '--remote-debugging-pipe']:
        options.add_argument(argument)
    if os.environ.get('BUILDLEDGER_TEST_CHROME'):
        options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
    options.add_experimental_option('prefs', {'download.default_directory': downloads,
                                             'download.prompt_for_download': False,
                                             'safebrowsing.enabled': True})
    service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
    driver = webdriver.Chrome(service=service, options=options)
    driver.set_script_timeout(20)
    wait = WebDriverWait(driver, 20)

    def click(selector):
        element = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
        driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'});", element)
        element.click()

    def fill(selector, value):
        element = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, selector)))
        element.clear()
        element.send_keys(value)

    def stored(key):
        return driver.execute_async_script("""
            const key=arguments[0],done=arguments[1],request=indexedDB.open('buildledger-web-v1',2);
            request.onerror=()=>done({error:String(request.error)});
            request.onsuccess=()=>{const db=request.result,tx=db.transaction('main','readonly'),read=tx.objectStore('main').get(key);
                read.onsuccess=async()=>{const value=read.result;db.close();
                    if(Array.isArray(value))done(await Promise.all(value.map(async file=>({id:file.id,bytes:[...new Uint8Array(await file.blob.arrayBuffer())]}))));
                    else done(value??null)};
                read.onerror=()=>{db.close();done({error:String(read.error)})}};
        """, key)

    def download(extension):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            files = list(Path(downloads).glob('*' + extension))
            if files and not list(Path(downloads).glob('*.crdownload')):
                return files[0]
            time.sleep(0.1)
        raise AssertionError('Download did not finish: ' + extension)

    try:
        driver.get(base)
        wait.until(lambda d: d.find_element(By.ID, 'project-name').text == project_a['name'])
        click('#rail-nav [data-nav="add"]')
        click('[data-flow="payment"]')
        fill('#f-vendor', 'Synthetic recovery supplier')
        fill('#f-amount', '425.67')
        fill('#f-notes', 'Keep exact unsubmitted browser input')
        driver.find_element(By.ID, 'f-proof').send_keys(str(original))
        driver.execute_script("""
            window.__originalPut=IDBObjectStore.prototype.put;window.__quotaOnce=true;
            IDBObjectStore.prototype.put=function(value,key){
                if(this.name==='main'&&key==='pendingRemoteOriginals'&&window.__quotaOnce){window.__quotaOnce=false;throw new DOMException('Synthetic recovery quota failure','QuotaExceededError')}
                return window.__originalPut.apply(this,arguments)};
            window.__nativeFetch=window.fetch.bind(window);window.__commitAttempts=0;window.__loseCommits=false;
            window.fetch=(url,options)=>{if(String(url)==='/api/v1/commit'){window.__commitAttempts++;if(window.__loseCommits)return Promise.reject(new TypeError('Synthetic failure before commit request'))}return window.__nativeFetch(url,options)};
        """)
        click('#entry-form button[type="submit"]')
        click('#modal-inner [data-action="confirm"]')
        wait.until(lambda d: 'Synthetic recovery quota failure' in d.find_element(By.ID, 'toast').text)
        assert driver.find_element(By.ID, 'modal').is_displayed(), 'Quota rejection must retain the review dialog'
        assert driver.find_element(By.ID, 'f-amount').get_attribute('value') == '425.67'
        assert driver.execute_script('return document.getElementById("f-proof").files.length') == 1
        assert driver.execute_script('return window.__commitAttempts') == 0, 'No commit may be submitted without durable recovery storage'
        assert stored('pendingRemote') is None and stored('pendingRemoteOriginals') is None, 'Quota failure must roll back both recovery keys'
        assert api('/api/v1/state?projectId=' + project_a['id'])['payments'] == []
        driver.execute_script('IDBObjectStore.prototype.put=window.__originalPut;window.__loseCommits=true')
        click('#modal-inner [data-action="confirm"]')
        wait.until(EC.visibility_of_element_located((By.ID, 'pending-save')))
        assert driver.execute_script('return window.__commitAttempts') == 2
        payload = stored('pendingRemote')
        request = json.loads(payload)
        assert request['projectId'] == project_a['id']
        assert request['state']['payments'][0]['amount'] == 42567
        assert request['state']['payments'][0]['notes'] == 'Keep exact unsubmitted browser input'
        assert stored('pendingRemoteOriginals')[0]['bytes'] == list(original_bytes)
        assert api('/api/v1/state?projectId=' + project_a['id'])['payments'] == []

        driver.refresh()
        wait.until(EC.visibility_of_element_located((By.ID, 'pending-save')))
        assert stored('pendingRemote') == payload
        revision = api('/api/v1/projects/' + project_a['id'] + '/summary')['rev']
        api('/api/v1/projects/' + project_a['id'], 'DELETE', {'expectedRev': revision})
        driver.refresh()
        wait.until(lambda d: d.find_element(By.ID, 'project-name').text == project_b['name'])
        banner = wait.until(EC.visibility_of_element_located((By.ID, 'pending-save'))).text
        assert project_a['name'] in banner and project_a['id'] in banner
        assert 'original files are not included' in banner.lower() and 'not a backup' in banner.lower()
        click('#pending-save [data-action="retry-save"]')
        wait.until(lambda d: 'not found' in d.find_element(By.ID, 'toast').text.lower())
        assert stored('pendingRemote') == payload
        assert stored('pendingRemoteOriginals')[0]['bytes'] == list(original_bytes)
        assert api('/api/v1/state?projectId=' + project_b['id'])['payments'] == []
        driver.save_screenshot(str(artifacts / 'deleted-owner-retained-recovery.png'))

        click('#pending-save [data-action="download-save"]')
        recovered = download('.json')
        assert recovered.read_text(encoding='utf-8') == payload
        (artifacts / recovered.name).write_bytes(recovered.read_bytes())
        click('#pending-save [data-action="download-save-originals"]')
        recovered_originals = download('.zip')
        with zipfile.ZipFile(recovered_originals) as package:
            assert package.testzip() is None
            manifest = json.loads(package.read('recovery-manifest.json'))
            assert manifest['projectId'] == project_a['id']
            assert len(manifest['originals']) == 1 and 'not a backup' in manifest['coverage'].lower()
            original_meta = manifest['originals'][0]
            assert package.read(original_meta['path']) == original_bytes
            assert hashlib.sha256(package.read(original_meta['path'])).hexdigest() == original_meta['sha256']
            assert package.read('pending-save.json').decode() == payload
        (artifacts / recovered_originals.name).write_bytes(recovered_originals.read_bytes())

        click('#pending-save [data-action="discard-save"]')
        wait.until(EC.alert_is_present())
        assert project_a['id'] in driver.switch_to.alert.text
        driver.switch_to.alert.dismiss()
        assert stored('pendingRemote') == payload and stored('pendingRemoteOriginals')[0]['bytes'] == list(original_bytes)

        first_tab = driver.current_window_handle
        driver.switch_to.new_window('tab')
        driver.get(base)
        wait.until(EC.visibility_of_element_located((By.ID, 'pending-save')))
        click('#pending-save [data-action="discard-save"]')
        wait.until(EC.alert_is_present())
        driver.switch_to.alert.accept()
        wait.until(EC.invisibility_of_element_located((By.ID, 'pending-save')))
        assert stored('pendingRemote') is None and stored('pendingRemoteOriginals') is None
        driver.switch_to.window(first_tab)
        click('#pending-save [data-action="retry-save"]')
        wait.until(lambda d: 'No pending save remains' in d.find_element(By.ID, 'toast').text)
        assert 'Original save verified' not in driver.find_element(By.ID, 'toast').text
        assert api('/api/v1/state?projectId=' + project_b['id'])['payments'] == []
        result = {'browser': driver.capabilities.get('browserVersion'), 'quotaAbortedBeforeCommit': True,
                  'exactPaise': 42567, 'exactNewOriginalBytes': list(original_bytes),
                  'deletedOwnerRejectedWithoutLoss': True, 'projectBUnchanged': True,
                  'recordsAndNewOriginalDownloadsVerified': True, 'discardCancellationRetainedData': True,
                  'confirmedDiscardClearedBothKeys': True, 'anotherTabResolutionDidNotClaimVerified': True}
        print(json.dumps(result))
    except Exception:
        driver.save_screenshot(str(artifacts / 'failure.png'))
        raise
    finally:
        driver.quit()
