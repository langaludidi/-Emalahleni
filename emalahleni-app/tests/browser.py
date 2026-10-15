"""Desktop/mobile preview journeys against the local Worker; Auth is stubbed and no beneficiary data is used."""
import base64, json, os, subprocess, time, shutil
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
            reset_requests = []
            sent_types = []
            def send_code(route):
                sent_types.append(route.request.post_data_json['type'])
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'success':True}))
            def reset_password(route):
                body = route.request.post_data_json
                reset_requests.append(body)
                accepted = body['otp'] == '654321'
                route.fulfill(status=200 if accepted else 400, content_type='application/json', body=json.dumps({'success':True} if accepted else {'code':'INVALID_OTP','message':'The reset code is invalid or expired.'}))
            page.route('**/email-otp/send-verification-otp', send_code)
            page.route('**/email-otp/reset-password', reset_password)
            page.get_by_role('button', name='Forgot password', exact=True).click()
            page.get_by_role('heading', name='Reset your password', exact=True).wait_for()
            assert sent_types == []  # Opening recovery must not send an email.
            assert not page.get_by_label('Password', exact=True).is_visible()
            page.get_by_role('button', name='Send reset code', exact=True).click()
            page.get_by_label('Password reset code', exact=True).wait_for()
            assert sent_types == ['forget-password']
            page.get_by_label('Password reset code', exact=True).fill('111111')
            page.get_by_label('New password', exact=True).fill('synthetic-new-password')
            page.get_by_label('Confirm new password', exact=True).fill('does-not-match')
            assert page.get_by_role('button', name='Set new password', exact=True).is_disabled()
            assert reset_requests == []
            page.get_by_label('Confirm new password', exact=True).fill('synthetic-new-password')
            page.get_by_role('button', name='Set new password', exact=True).click()
            page.get_by_text('The reset code is invalid or expired.', exact=True).first.wait_for()
            assert page.get_by_role('heading', name='Reset your password', exact=True).is_visible()
            page.get_by_label('Password reset code', exact=True).fill('654321')
            page.get_by_role('button', name='Set new password', exact=True).click()
            page.get_by_text('Password updated. Enter your new password and sign in.', exact=True).first.wait_for()
            assert not page.get_by_role('heading', name='Reset your password', exact=True).is_visible()
            assert page.get_by_label('Password', exact=True).input_value() == ''
            assert len(reset_requests) == 2
            assert reset_requests[-1] == {'email':'synthetic@emalahleni.invalid','otp':'654321','password':'synthetic-new-password'}
            # Opening again clears recovery secrets; changing email invalidates its code.
            page.get_by_role('button', name='Forgot password', exact=True).click()
            page.get_by_role('button', name='Send reset code', exact=True).click()
            page.get_by_label('Password reset code', exact=True).wait_for()
            assert page.get_by_label('Password reset code', exact=True).input_value() == ''
            assert page.get_by_label('New password', exact=True).input_value() == ''
            assert page.get_by_label('Confirm new password', exact=True).input_value() == ''
            page.get_by_label('Password reset code', exact=True).fill('654321')
            page.get_by_label('Email', exact=True).fill('another-synthetic@emalahleni.invalid')
            assert not page.get_by_label('Password reset code', exact=True).is_visible()
            assert page.get_by_role('button', name='Send reset code', exact=True).is_visible()
            page.get_by_label('Email', exact=True).fill('synthetic@emalahleni.invalid')
            page.get_by_role('button', name='Send reset code', exact=True).click()
            page.get_by_label('Password reset code', exact=True).wait_for()
            assert page.get_by_label('Password reset code', exact=True).input_value() == ''
            assert page.get_by_label('New password', exact=True).input_value() == ''
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            assert not errors, errors
            page.screenshot(path=str(review / (label + '-password-recovery.png')), full_page=True)
            page.get_by_label('New password', exact=True).fill('discard-this-synthetic-password')
            page.get_by_role('button', name='Back to sign in', exact=True).click()
            assert page.get_by_label('Password', exact=True).input_value() == ''
            # Authenticated layout uses a compact account menu, including after reload.
            signed_in = {'value':False}
            auth_user = {'id':'synthetic-user','name':'Synthetic Officer','email':'synthetic@emalahleni.invalid','emailVerified':True,'createdAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z'}
            auth_session = {'id':'synthetic-session','userId':'synthetic-user','token':'synthetic-session-token','expiresAt':'2099-01-01T00:00:00Z','createdAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z'}
            def encoded(value):
                return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
            browser_token = encoded({'alg':'EdDSA'}) + '.' + encoded({'sub':'synthetic-user','exp':int(time.time())+900}) + '.synthetic-signature'
            auth_headers = {'set-auth-jwt':browser_token,'access-control-expose-headers':'set-auth-jwt','access-control-allow-origin':base,'access-control-allow-credentials':'true'}
            project_tokens = []
            def successful_sign_in(route):
                signed_in['value'] = True
                route.fulfill(status=200, headers=auth_headers, content_type='application/json', body=json.dumps({'token':'synthetic-session-token','user':auth_user,'session':auth_session}))
            def session_response(route):
                route.fulfill(status=200, headers=auth_headers if signed_in['value'] else {}, content_type='application/json', body=json.dumps({'session':auth_session,'user':auth_user} if signed_in['value'] else None))
            def successful_sign_out(route):
                signed_in['value'] = False
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'success':True}))
            page.route('**/sign-in/email', successful_sign_in)
            page.route('**/get-session*', session_response)
            page.route('**/sign-out', successful_sign_out)
            def project_response(route):
                project_tokens.append(route.request.headers.get('authorization'))
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'projects':[{'id':'synthetic-project','name':'Synthetic staging','code':'SYN-UI','role':'OFFICER'}]}))
            page.route('**/api/projects', project_response)
            def wait_for_project():
                try:
                    page.get_by_label('Project').locator('option', has_text='Synthetic staging').wait_for(state='attached')
                except Exception:
                    print(json.dumps({'status':page.get_by_role('status').all_text_contents(),'scriptErrors':errors}), flush=True)
                    page.screenshot(path=str(review / (label + '-project-load-failure.png')), full_page=True)
                    raise
            page.get_by_label('Password', exact=True).fill('unused-browser-test-password')
            page.get_by_role('button', name='Sign in', exact=True).click()
            wait_for_project()
            assert project_tokens == ['Bearer ' + browser_token]
            assert not page.get_by_label('Email', exact=True).is_visible()
            assert not page.get_by_label('Password', exact=True).is_visible()
            assert not page.get_by_role('button', name='Forgot password', exact=True).is_visible()
            assert not page.get_by_role('button', name='Sign in', exact=True).is_visible()
            assert not page.get_by_role('button', name='Sign out', exact=True).is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-signed-in.png')), full_page=True)
            page.reload(wait_until='domcontentloaded')
            wait_for_project()
            assert page.get_by_label('Project').locator('option', has_text='Synthetic staging').count() == 1
            assert len(project_tokens) >= 2 and all(token == 'Bearer ' + browser_token for token in project_tokens)
            assert not page.get_by_label('Email', exact=True).is_visible()
            page.locator('summary', has_text='Account').click()
            assert page.get_by_text('Signed in as Synthetic Officer', exact=True).is_visible()
            assert page.get_by_role('button', name='Sign out', exact=True).is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.get_by_role('button', name='Sign out', exact=True).click()
            page.get_by_label('Email', exact=True).wait_for()
            assert page.get_by_role('button', name='Forgot password', exact=True).is_visible()
            assert not page.get_by_label('Project').is_visible()
            assert page.get_by_label('Password', exact=True).input_value() == ''
            assert not errors, errors
            page.close()
            print(label + ': preview, PDF, mocked email verification/password recovery, compact signed-in view, restored session, sign-out and no overflow/script errors passed.', flush=True)
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    log.close()
