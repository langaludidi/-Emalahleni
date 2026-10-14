"""Desktop/mobile preview journeys against the local Worker; Auth is stubbed and no beneficiary data is used."""
import json, os, subprocess, time, shutil
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
review = root / 'review'
review.mkdir(exist_ok=True)
env = {**os.environ, 'XDG_CONFIG_HOME': '/tmp/emalahleni-browser-config', 'WRANGLER_LOG_PATH': '/tmp/emalahleni-browser-worker.log'}
log = open('/tmp/emalahleni-browser-server.log', 'w')
server = subprocess.Popen(['node', 'node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', '8790'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
base = 'http://127.0.0.1:8790'
try:
    for attempt in range(60):
        try:
            with urlopen(base + '/healthz', timeout=1) as response:
                if response.status == 200: break
        except Exception:
            if server.poll() is not None: raise RuntimeError('Worker exited; inspect /tmp/emalahleni-browser-server.log')
            time.sleep(0.5)
    else: raise RuntimeError('Worker did not become ready')
    with sync_playwright() as p:
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        browser = p.chromium.launch(**({'executable_path':executable} if executable else {}), headless=True, args=['--no-sandbox'])
        for width, height, label in [(1440, 1000, 'desktop'), (390, 844, 'mobile')]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*neonauth*/**', lambda route: route.fulfill(status=200, content_type='application/json', body='null'))
            page.goto(base, wait_until='domcontentloaded')
            page.get_by_label('First names', exact=True).fill('Synthetic')
            page.get_by_label('Surname', exact=True).fill('Example')
            page.get_by_label('South African ID number').fill('0000000000000')
            page.get_by_label('Marital status').select_option('MARRIED')
            page.get_by_label('Spouse full name').fill('Synthetic Spouse')
            page.get_by_label('Disability declared').check()
            page.get_by_role('button', name='Continue →').click()
            page.get_by_label('Declared income source').select_option('UNEMPLOYED')
            assert page.get_by_text('Signed and commissioned no-income / unemployment affidavit', exact=True).is_visible()
            page.get_by_role('button', name='+ Add dependant').click()
            page.get_by_label('Dependant 1 name').fill('Synthetic Child')
            page.get_by_label('Relationship', exact=True).fill('Child')
            page.get_by_role('button', name='Continue →').click()
            page.get_by_label('House type', exact=True).fill('Mud structure')
            page.get_by_label('Photograph capture / verification date').fill('2026-10-10')
            page.get_by_label('Latitude', exact=True).fill('-31.7')
            page.get_by_label('Longitude', exact=True).fill('27.3')
            page.get_by_label('House type confirmed against photograph').check()
            page.get_by_label('GPS and capture date confirmed against photograph').check()
            page.get_by_label('Field recommendation and supporting observations').fill('Synthetic field observation')
            page.get_by_role('button', name='Continue →').click()
            assert page.get_by_text('Disability medical certificate', exact=True).is_visible()
            page.get_by_role('button', name='Check readiness').click()
            page.get_by_role('heading', name='Next actions').wait_for()
            assert page.get_by_text('Blockers to resolve', exact=True).is_visible()
            with page.expect_download() as exported:
                page.get_by_role('button', name='Export verification summary', exact=True).click()
            download = exported.value
            assert download.suggested_filename.endswith('.pdf')
            download.save_as(str(review / (label + '-summary.pdf')))
            assert (review / (label + '-summary.pdf')).read_bytes().startswith(b'%PDF')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            assert not errors, errors
            page.screenshot(path=str(review / (label + '.png')), full_page=True)
            page.route('**/sign-in/email', lambda route: route.fulfill(status=403, content_type='application/json', body=json.dumps({'code':'EMAIL_NOT_VERIFIED','message':'Email not verified'})))
            page.route('**/email-otp/send-verification-otp', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'success':True})))
            page.route('**/email-otp/verify-email', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'status':True})))
            page.get_by_role('button', name='Connected workspace', exact=True).click()
            page.get_by_label('Email', exact=True).fill('synthetic@emalahleni.invalid')
            page.get_by_label('Password', exact=True).fill('unused-browser-test-password')
            page.get_by_role('button', name='Sign in', exact=True).click()
            page.get_by_role('heading', name='Verify your email', exact=True).wait_for()
            assert page.get_by_label('Password', exact=True).input_value() == ''
            page.get_by_role('button', name='Send verification code', exact=True).click()
            page.get_by_label('Email verification code', exact=True).wait_for()
            page.get_by_label('Email verification code', exact=True).fill('123456')
            page.get_by_role('button', name='Verify email', exact=True).click()
            page.get_by_text('Email verified. Enter your password and sign in.', exact=True).first.wait_for()
            assert not page.get_by_role('heading', name='Verify your email', exact=True).is_visible()
            assert not errors, errors
            page.screenshot(path=str(review / (label + '-email-verification.png')), full_page=True)
            page.close()
            print(label + ': four-step workflow, conditional evidence, Worker readiness response, no overflow no script errors and mocked email-verification recovery passed.', flush=True)
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    log.close()
