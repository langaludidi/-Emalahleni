"""Desktop/mobile preview journeys against the local Worker; Auth is stubbed and no beneficiary data is used."""
import base64, json, os, subprocess, time, shutil, tempfile, re
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
review = root / 'review'
review.mkdir(exist_ok=True)
env = {**os.environ, 'XDG_CONFIG_HOME': '/tmp/emalahleni-browser-config', 'WRANGLER_LOG_PATH': '/tmp/emalahleni-browser-worker.log'}
log = open('/tmp/emalahleni-browser-server.log', 'w')
# These browser journeys stub document-service HTTP responses. Keep their local
# Worker free of Docker; the canonical build checks the production entrypoint,
# and the separate scanner workflow exercises the real image and engine.
config = json.loads((root / 'wrangler.jsonc').read_text())
config['main'] = str(root / 'src/worker.ts')
config['assets']['directory'] = str(root / 'web/out')
for key in ('containers', 'durable_objects', 'exports'):
    config.pop(key, None)
local_config = tempfile.TemporaryDirectory(prefix='emalahleni-browser-')
config_path = Path(local_config.name) / 'wrangler.jsonc'
config_path.write_text(json.dumps(config))
server = subprocess.Popen(['node', 'node_modules/wrangler/bin/wrangler.js', 'dev', '--config', str(config_path), '--ip', '127.0.0.1', '--port', '8790'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
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
            initial_sessions = []
            def initial_auth(route):
                if '/get-session' in route.request.url and not initial_sessions:
                    initial_sessions.append(route)
                else:
                    route.fulfill(status=200, content_type='application/json', body='null')
            page.route('**/*neonauth*/**', initial_auth)
            page.goto(base, wait_until='domcontentloaded')
            expect(page.get_by_role('status', name='Loading Vectra Assure')).to_be_visible()
            page.screenshot(path=str(review / (label + '-splash.png')))
            for attempt in range(60):
                if initial_sessions: break
                page.wait_for_timeout(50)
            assert initial_sessions, 'Session lookup did not start'
            initial_sessions[0].fulfill(status=200, content_type='application/json', body='null')
            expect(page.get_by_role('heading', level=1)).to_contain_text('Every application.')
            assert not page.get_by_label('First names', exact=True).is_visible()
            assert not page.get_by_label('Email', exact=True).is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-home.png')), full_page=True)
            if label == 'mobile':
                page.set_viewport_size({'width':320,'height':740})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.screenshot(path=str(review / 'small-mobile-home.png'), full_page=True)
                page.set_viewport_size({'width':width,'height':height})
            page.get_by_role('button', name='Open saved applications', exact=True).click()
            expect(page.get_by_label('Email', exact=True)).to_be_visible()
            assert page.get_by_role('button', name='Sign in', exact=True).is_disabled()
            assert page.get_by_label('Email', exact=True).bounding_box()['y'] < height
            page.screenshot(path=str(review / (label + '-sign-in.png')), full_page=True)
            if label == 'mobile':
                page.set_viewport_size({'width':320,'height':740})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                assert page.get_by_label('Email', exact=True).evaluate('element => parseFloat(getComputedStyle(element).fontSize) >= 16')
                page.screenshot(path=str(review / 'small-mobile-sign-in.png'), full_page=True)
                page.set_viewport_size({'width':width,'height':height})
            page.get_by_role('button', name='Vectra Assure home', exact=True).click()
            expect(page.get_by_role('heading', level=1)).to_contain_text('Every application.')
            assert not page.get_by_label('Email', exact=True).is_visible()
            page.get_by_role('button', name='Sign in', exact=True).click()
            expect(page.get_by_label('Email', exact=True)).to_be_visible()
            page.get_by_role('button', name='Explore the preview form', exact=True).click()
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
            page.get_by_role('button', name='Vectra Assure home', exact=True).click()
            page.get_by_role('heading', name='Applications', exact=True).wait_for()
            assert not page.get_by_label('First names', exact=True).is_visible()
            page.get_by_role('button', name='Resume form', exact=True).click()
            assert page.get_by_role('heading', name='Documents & readiness', exact=True).is_visible()
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='Connected workspace', exact=True).click()
            assert page.get_by_role('heading', name='Documents & readiness', exact=True).is_visible()
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='Connected workspace', exact=True).click()
            page.get_by_label('Email', exact=True).fill('synthetic@emalahleni.invalid')
            page.get_by_label('Password', exact=True).fill('unused-browser-test-password')
            page.get_by_label('Password', exact=True).press('Enter')
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
            # Real Neon sessions may stay opaque without a set-auth-jwt header.
            # API authentication must obtain the JWT from the supported /token route.
            auth_headers = {'access-control-allow-origin':base,'access-control-allow-credentials':'true'}
            project_tokens = []
            def successful_sign_in(route):
                signed_in['value'] = True
                route.fulfill(status=200, headers=auth_headers, content_type='application/json', body=json.dumps({'token':'synthetic-session-token','user':auth_user,'session':auth_session}))
            def session_response(route):
                route.fulfill(status=200, headers=auth_headers if signed_in['value'] else {}, content_type='application/json', body=json.dumps({'session':auth_session,'user':auth_user} if signed_in['value'] else None))
            def successful_sign_out(route):
                signed_in['value'] = False
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'success':True}))
            def api_token_response(route):
                route.fulfill(status=200 if signed_in['value'] else 401, headers=auth_headers, content_type='application/json', body=json.dumps({'token':browser_token} if signed_in['value'] else {'code':'UNAUTHORIZED'}))
            page.route('**/sign-in/email', successful_sign_in)
            page.route('**/get-session*', session_response)
            page.route('**/sign-out', successful_sign_out)
            page.route('**/token*', api_token_response)
            project_role = {'value':'OFFICER'}
            no_membership = {'value':False}
            project_creation_enabled = {'value':False}
            created_projects = {}
            project_creation_requests = []
            uncertain_creation = {'value':False}
            def project_response(route):
                project_tokens.append(route.request.headers.get('authorization'))
                if route.request.method == 'POST':
                    value = route.request.post_data_json
                    project_creation_requests.append(value)
                    if not project_creation_enabled['value']:
                        route.fulfill(status=403, content_type='application/json', body=json.dumps({'error':'PROJECT_CREATION_DENIED'}))
                    elif value['code'] == 'SYN-TAKEN':
                        route.fulfill(status=409, content_type='application/json', body=json.dumps({'error':'PROJECT_CODE_EXISTS'}))
                    else:
                        created_projects.setdefault(value['id'],{'id':value['id'],'name':value['name'],'code':value['code'],'role':'ADMIN'})
                        if uncertain_creation['value']:
                            uncertain_creation['value'] = False
                            route.fulfill(status=503, content_type='application/json', body=json.dumps({'error':'SERVICE_UNAVAILABLE'}))
                        else:
                            route.fulfill(status=200, content_type='application/json', body=json.dumps({'project':created_projects[value['id']],'created':False}))
                    return
                projects_result = [] if no_membership['value'] else [{'id':'synthetic-project','name':'Synthetic staging','code':'SYN-UI','role':project_role['value']}]
                organisations = [{'id':'10000000-0000-4000-8000-000000000001','name':'Synthetic organisation'}] if project_creation_enabled['value'] else []
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'projects':projects_result+list(created_projects.values()),'projectCreation':{'organisations':organisations}}))
            page.route('**/api/projects', project_response)
            def wait_for_project():
                try:
                    page.get_by_role('combobox', name=re.compile(r'^Project')).locator('option', has_text='Synthetic staging').wait_for(state='attached')
                except Exception:
                    print(json.dumps({'status':page.get_by_role('status').all_text_contents(),'scriptErrors':errors}), flush=True)
                    page.screenshot(path=str(review / (label + '-project-load-failure.png')), full_page=True)
                    raise
            # Sign-up is a separate account-creation flow. Registration must not
            # authenticate an unverified account or assign project access.
            signups = []
            signup_error = {'value':True}
            verification_attempts = []
            def signup_response(route):
                body = route.request.post_data_json
                assert set(body) == {'name','email','password'}
                signups.append(body)
                if signup_error['value']:
                    route.fulfill(status=409, content_type='application/json', body=json.dumps({'code':'USER_ALREADY_EXISTS','message':'An account already exists. Sign in or reset your password.'}))
                else:
                    route.fulfill(status=200, headers=auth_headers, content_type='application/json', body=json.dumps({'token':None,'user':{**auth_user,'email':body['email'],'emailVerified':False}}))
            def verify_signup(route):
                body = route.request.post_data_json
                verification_attempts.append(body)
                accepted = body['otp'] == '123456'
                if accepted: signed_in['value'] = True  # Provider may create a session after verification.
                route.fulfill(status=200 if accepted else 400, content_type='application/json', body=json.dumps({'status':True} if accepted else {'code':'INVALID_OTP','message':'The verification code is invalid or expired.'}))
            page.route('**/sign-up/email', signup_response)
            page.route('**/email-otp/verify-email', verify_signup)
            page.get_by_role('button', name='Sign up', exact=True).click()
            page.get_by_role('heading', name='Create your account', exact=True).wait_for()
            page.get_by_label('Full name', exact=True).fill('Synthetic New User')
            page.get_by_label('Email', exact=True).fill('new-synthetic@vectra-assure.invalid')
            page.get_by_label('Password', exact=True).fill('short')
            page.get_by_label('Confirm password', exact=True).fill('short')
            create_account = page.get_by_role('button', name='Create account', exact=True)
            expect(create_account).to_be_disabled()
            page.get_by_label('Password', exact=True).fill('synthetic-registration-password')
            page.get_by_label('Confirm password', exact=True).fill('different-password')
            expect(create_account).to_be_disabled()
            expect(page.get_by_text('The passwords do not match.', exact=True)).to_be_visible()
            page.get_by_label('Confirm password', exact=True).fill('synthetic-registration-password')
            before_codes = len(sent_types)
            create_account.click()
            expect(page.get_by_text('An account already exists. Sign in or reset your password.', exact=True)).to_be_visible()
            expect(page.get_by_label('Password', exact=True)).to_have_value('')
            expect(page.get_by_label('Confirm password', exact=True)).to_have_value('')
            expect(page.get_by_label('Full name', exact=True)).to_have_value('Synthetic New User')
            assert len(signups) == 1 and not project_tokens
            signup_error['value'] = False
            page.get_by_label('Password', exact=True).fill('synthetic-registration-password')
            page.get_by_label('Confirm password', exact=True).fill('synthetic-registration-password')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-sign-up.png')), full_page=True)
            if label == 'mobile':
                page.set_viewport_size({'width':320,'height':740})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.screenshot(path=str(review / 'small-mobile-sign-up.png'), full_page=True)
                page.set_viewport_size({'width':width,'height':height})
            create_account.click()
            page.get_by_role('heading', name='Verify your email', exact=True).wait_for()
            assert len(signups) == 2 and len(sent_types) == before_codes
            assert not project_tokens and not signed_in['value']
            expect(page.get_by_label('Password', exact=True)).to_have_value('')
            page.get_by_role('button', name='Send verification code', exact=True).click()
            page.get_by_label('Email verification code', exact=True).fill('000000')
            page.get_by_role('button', name='Verify email', exact=True).click()
            expect(page.get_by_text('The verification code is invalid or expired.', exact=True)).to_be_visible()
            assert not project_tokens
            page.get_by_label('Email verification code', exact=True).fill('123456')
            page.get_by_role('button', name='Verify email', exact=True).click()
            page.get_by_text('Email verified. Enter your password and sign in.', exact=True).wait_for()
            assert verification_attempts[-1]['email'] == 'new-synthetic@vectra-assure.invalid'
            assert sent_types[-1] == 'email-verification'
            no_membership['value'] = True
            page.get_by_label('Password', exact=True).fill('synthetic-registration-password')
            page.get_by_role('button', name='Sign in', exact=True).click()
            expect(page.get_by_text('Your account is ready. Project access is pending.', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='New form', exact=True)).to_be_disabled()
            expect(page.get_by_role('combobox', name='Existing draft', exact=True)).to_be_disabled()
            assert not page.get_by_label('Password', exact=True).is_visible()
            page.reload(wait_until='domcontentloaded')
            expect(page.get_by_text('Your account is ready. Project access is pending.', exact=True)).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-project-access-pending.png')), full_page=True)
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Sign out', exact=True).click()
            expect(page.get_by_role('heading', level=1)).to_contain_text('Every application.')
            page.get_by_role('button', name='Sign up', exact=True).click()
            expect(page.get_by_role('heading', name='Create your account', exact=True)).to_be_visible()
            expect(page.get_by_label('Full name', exact=True)).to_be_focused()
            expect(page.get_by_label('Password', exact=True)).to_have_value('')
            page.get_by_role('button', name='Vectra Assure home', exact=True).click()
            page.get_by_role('button', name='Create an account', exact=True).click()
            expect(page.get_by_role('heading', name='Create your account', exact=True)).to_be_visible()
            page.get_by_role('button', name='Back to sign in', exact=True).click()
            assert not page.get_by_label('Full name', exact=True).is_visible()
            expect(page.get_by_label('Password', exact=True)).to_have_value('')
            no_membership['value'] = False
            project_tokens.clear()
            page.get_by_label('Email', exact=True).fill('synthetic@emalahleni.invalid')
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
            assert page.get_by_role('combobox', name=re.compile(r'^Project')).locator('option', has_text='Synthetic staging').count() == 1
            assert len(project_tokens) >= 2 and all(token == 'Bearer ' + browser_token for token in project_tokens)
            assert not page.get_by_label('Email', exact=True).is_visible()
            page.locator('summary', has_text='Account').click()
            assert page.get_by_text('Signed in as Synthetic Officer', exact=True).is_visible()
            assert page.get_by_role('button', name='Sign out', exact=True).is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.locator('summary', has_text='Account').click()
            # A stateful API double proves new captures never update the previous draft.
            assert not page.get_by_role('button', name='New housing project', exact=True).is_visible()
            project_creation_enabled['value'] = True
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Refresh projects', exact=True).click()
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='New housing project', exact=True).click()
            expect(page.get_by_label('Project name', exact=True)).to_be_focused()
            assert page.get_by_role('button', name='Create project', exact=True).is_disabled()
            page.get_by_label('Project name', exact=True).fill('Synthetic new housing')
            page.get_by_label('Project code', exact=True).fill('BAD CODE')
            assert page.get_by_role('button', name='Create project', exact=True).is_disabled()
            assert not project_creation_requests
            page.get_by_label('Project code', exact=True).fill('syn-taken')
            page.get_by_role('button', name='Create project', exact=True).click()
            expect(page.locator('.new-project [role="alert"]')).to_contain_text('already in use')
            expect(page.get_by_label('Project name', exact=True)).to_have_value('Synthetic new housing')
            page.get_by_label('Project code', exact=True).fill('syn-new')
            page.get_by_label('Client or authority (optional)', exact=True).fill('Synthetic client')
            page.get_by_label('Location (optional)', exact=True).fill('Synthetic municipality')
            if label == 'mobile': page.set_viewport_size({'width':320,'height':740})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-new-project.png')), full_page=True)
            uncertain_creation['value'] = True
            page.get_by_role('button', name='Create project', exact=True).click()
            expect(page.locator('.new-project [role="alert"]')).to_contain_text('could not be confirmed')
            assert page.get_by_label('Project name', exact=True).is_disabled()
            page.get_by_role('button', name='Retry project creation', exact=True).click()
            expect(page.get_by_role('heading', name='Create a housing project', exact=True)).not_to_be_visible()
            assert project_creation_requests[-1] == project_creation_requests[-2]
            assert len(created_projects) == 1
            new_project_id = next(iter(created_projects))
            expect(page.get_by_role('combobox', name='Project', exact=True)).to_have_value(new_project_id)
            assert page.get_by_role('combobox', name='Project', exact=True).locator('option', has_text='Synthetic new housing · ADMIN').count() == 1
            page.reload(wait_until='domcontentloaded')
            wait_for_project()
            expect(page.get_by_role('combobox', name='Project', exact=True).locator('option', has_text='Synthetic new housing · ADMIN')).to_have_count(1)
            page.get_by_role('button', name='New housing project', exact=True).click()
            page.get_by_label('Project name', exact=True).fill('Synthetic unsaved setup')
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='Cancel project setup', exact=True).click()
            expect(page.get_by_label('Project name', exact=True)).to_have_value('Synthetic unsaved setup')
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='Cancel project setup', exact=True).click()
            if label == 'mobile': page.set_viewport_size({'width':width,'height':height})
            project_creation_enabled['value'] = False
            created_projects.clear()
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Refresh projects', exact=True).click()
            page.locator('summary', has_text='Account').click()
            expect(page.get_by_role('button', name='New housing project', exact=True)).not_to_be_visible()
            stored_cases = {}
            writes = []
            fail_save = {'value':False}
            readiness_version = {'offset':0}
            delayed_uploads = []
            department_reviews, department_writes = [], []
            upload_state = {'enabled':False,'id_reading':False,'service_ready':False,'service_error':None,'fail_reading':False,'fail_register':False,'fail_department':False,'fail_intent':False,'fail_refresh_after_upload':False,'retry_failure':None}
            evidence_documents, upload_intents, uploaded_bytes = [], [], []
            id_reads = []
            def valid_synthetic_id():
                for check in range(10):
                    candidate = '900101000008' + str(check)
                    digits = [int(value) * (2 if index % 2 else 1) for index, value in enumerate(candidate)]
                    if sum(value-9 if value>9 else value for value in digits) % 10 == 0:
                        return candidate
            synthetic_id = valid_synthetic_id()
            def case_response(route):
                method = route.request.method
                suffix = route.request.url.split('/applications', 1)[1].split('?', 1)[0].strip('/')
                status = 200
                if suffix.endswith('/document-service-check') and method == 'POST':
                    status, result = (200, {'status':'ready','checks':{'scannerHealth':True,'cleanScan':True,'idReading':True},'uploadsEnabled':False,'idReadingEnabled':False}) if upload_state['service_ready'] else (503, {'error':'DOCUMENT_SERVICE_NOT_CONFIGURED'})
                    if upload_state['service_error']:
                        status, result = 503, upload_state['service_error']
                elif suffix.endswith('/evidence') and method == 'GET':
                    if upload_state['fail_register']:
                        status, result = 503, {'error':'TEST_REGISTER_UNAVAILABLE'}
                    else:
                        result = {'evidence':evidence_documents,'idReading':{'enabled':upload_state['id_reading']}}
                        if upload_state['enabled'] is not None:
                            result['uploads'] = {'enabled':upload_state['enabled']}
                elif suffix.endswith('/evidence') and method == 'POST':
                    upload_intents.append(route.request.post_data_json)
                    if upload_state['fail_intent']:
                        status, result = 503, {'error':'DOCUMENT_UPLOADS_NOT_CONFIGURED'}
                    else:
                        result = {'id':'synthetic-document','uploadPath':'/api/projects/synthetic-project/applications/synthetic-case-1/evidence/synthetic-document/upload'}
                elif suffix.endswith('/evidence/synthetic-document/upload') and method == 'PUT':
                    uploaded_bytes.append(route.request.post_data_buffer)
                    evidence_documents.append({'id':'synthetic-document','kind':'APPLICANT_ID','filename':'synthetic-id.pdf','status':'PENDING_REVIEW','malware_status':'CLEAN','reviewed_by':None,'document_date':None,'document_subtype':None})
                    result = {'id':'synthetic-document','status':'PENDING_REVIEW','malware_status':'CLEAN'}
                    if upload_state['fail_refresh_after_upload']:
                        upload_state['fail_register'] = True
                    if upload_state.get('hold_upload'):
                        delayed_uploads.append((route,result))
                        return
                elif suffix.endswith('/evidence/synthetic-document/scan') and method == 'POST':
                    failed = upload_state['retry_failure']
                    evidence_documents[0].update(status='PENDING_SCAN' if failed else 'PENDING_REVIEW', malware_status='SCAN_FAILED' if failed else 'CLEAN')
                    result = {**evidence_documents[0], **({'scanFailure':failed} if failed else {})}
                elif suffix.endswith('/evidence/synthetic-document/review') and method == 'PUT':
                    body = route.request.post_data_json
                    assert body['decision']=='VERIFIED' and body['contentConfirmed'] and body['certificationConfirmed']
                    current = stored_cases[suffix.split('/')[0]]
                    if body['formVersion'] != current['version']:
                        status, result = 409, {'error':'REVIEW_STATE_OR_CERTIFICATION_INVALID'}
                    else:
                        evidence_documents[0].update(status='VERIFIED',reviewed_by='synthetic-assessor',reviewed_form_version=body['formVersion'])
                        result = evidence_documents[0]
                elif suffix.endswith('/evidence/synthetic-document/read-id') and method == 'POST':
                    id_reads.append(suffix)
                    if upload_state['fail_reading']:
                        status, result = 503, {'error':'ID_READING_UNAVAILABLE'}
                    else:
                        result = {'evidenceId':'synthetic-document','sha256':'a'*64,'fields':{'firstNames':'READ SYNTHETIC','surname':'READ EXAMPLE','idNumber':synthetic_id},'dateOfBirth':'1990-01-01','warnings':['Check every proposed value against the original ID.'],'requiresConfirmation':True}
                elif suffix.endswith('/readiness') and method == 'GET':
                    current = stored_cases[suffix.split('/')[0]]
                    result = {'formVersion':current['version']+readiness_version['offset'],'ruleVersion':'synthetic','provisional':True,'readiness':'AMBER','ourTeamReady':False,'departmentalReady':False,'submissionReady':False,'issues':[],'requirements':[]}
                elif '/dohs/' in suffix and method == 'PUT':
                    body = route.request.post_data_json
                    target = suffix.rsplit('/',1)[1]
                    prior = next((review for review in department_reviews if review['section']==target),None)
                    department_writes.append(body)
                    if body['formVersion'] != stored_cases[suffix.split('/')[0]]['version'] or body['expectedReviewedAt'] != (prior['reviewed_at'] if prior else None):
                        status, result = 409, {'error':'DEPARTMENT_REVIEW_CHANGED_OR_UNAVAILABLE'}
                    else:
                        result = {'section':target,'state':body['state'],'note':body['note'],'reviewed_at':'2026-10-24T12:30:00.000001Z','reviewed_form_version':body['formVersion']}
                        if prior: department_reviews.remove(prior)
                        department_reviews.append(result)
                elif suffix.endswith('/dohs'):
                    status, result = (503, {'error':'TEST_DEPARTMENT_UNAVAILABLE'}) if upload_state['fail_department'] else (200, {'reviews':department_reviews})
                elif method == 'GET' and not suffix:
                    result = {'applications':[{key:item[key] for key in ['id','reference','version','workflow_status']} for item in stored_cases.values()]}
                elif method == 'POST' and not suffix:
                    body = route.request.post_data_json
                    case_id = 'synthetic-case-' + str(len(stored_cases)+1)
                    result = {'id':case_id,'reference':body['reference'],'version':0,'workflow_status':'DRAFT','form':body['form']}
                    stored_cases[case_id] = result
                    writes.append(('POST',case_id))
                elif method == 'PUT' and suffix in stored_cases:
                    if fail_save['value']:
                        fail_save['value'] = False
                        status, result = 503, {'error':'TEST_SAVE_FAILED'}
                    else:
                        body = route.request.post_data_json
                        assert body['version'] == stored_cases[suffix]['version']
                        result = {**stored_cases[suffix],'version':body['version']+1,'form':body['form']}
                        stored_cases[suffix] = result
                        writes.append(('PUT',suffix))
                elif method == 'GET' and suffix in stored_cases:
                    result = stored_cases[suffix]
                else:
                    status, result = 404, {'error':'NOT_FOUND'}
                route.fulfill(status=status, content_type='application/json', body=json.dumps(result))
            page.route('**/api/projects/synthetic-project/applications**', case_response)
            dashboard_fail = {'value':False}
            dashboard_totals = {'total':121,'draft':100,'awaitingAssessment':10,'returned':7,'assessmentComplete':4}
            def dashboard_response(route):
                route.fulfill(status=503 if dashboard_fail['value'] else 200, content_type='application/json', body=json.dumps({'error':'UNAVAILABLE'} if dashboard_fail['value'] else {'generatedAt':'2026-10-23T10:00:00Z','applications':dashboard_totals,'evidence':{'total':12,'pendingUpload':1,'pendingScan':1,'scanFailed':1,'infected':1,'awaitingReview':4,'verified':4,'rejected':1},'recent':[{'id':'synthetic-case-1','reference':'SYN-NAV-001','version':1,'workflow_status':'DRAFT','updated_at':'2026-10-23T10:00:00Z'}] if stored_cases else []}))
            page.route('**/api/projects/synthetic-project/dashboard', dashboard_response)
            page.get_by_role('combobox', name=re.compile(r'^Project')).select_option('synthetic-project')
            dashboard = page.get_by_role('region', name='Project dashboard')
            expect(dashboard.locator('.metric').filter(has=page.get_by_role('heading', name='Applications', exact=True)).locator('strong')).to_have_text('121')
            expect(dashboard.get_by_text('Scan needs retry', exact=True).locator('..').locator('dd')).to_have_text('1')
            expect(dashboard.get_by_role('region', name='Needs attention')).to_contain_text('7 returned applications')
            assert dashboard.locator('.metric').first.bounding_box()['y'] < height
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-dashboard.png')), full_page=True)
            dashboard_fail['value'] = True
            page.get_by_role('button', name='Refresh dashboard', exact=True).click()
            expect(dashboard.get_by_role('alert')).to_contain_text('could not be loaded')
            expect(dashboard.locator('.metric')).to_have_count(4)
            expect(dashboard.get_by_role('alert')).to_contain_text('last loaded totals')
            expect(dashboard.locator('.metric').filter(has=page.get_by_role('heading', name='Applications', exact=True)).locator('strong')).to_have_text('121')
            dashboard_fail['value'] = False
            page.get_by_role('button', name='Refresh dashboard', exact=True).click()
            expect(dashboard.locator('.metric')).to_have_count(4)
            page.get_by_role('button', name='New form', exact=True).click()
            page.get_by_label('Synthetic case reference', exact=True).fill('SYN-NAV-001')
            page.get_by_label('First names', exact=True).fill('Synthetic')
            page.get_by_label('Surname', exact=True).fill('Original')
            steps = page.get_by_role('navigation', name='Verification steps').get_by_role('button')
            steps.nth(1).click()
            page.get_by_label('Declared income source').select_option('UNEMPLOYED')
            page.get_by_role('button', name='+ Add dependant').click()
            page.get_by_label('Dependant 1 name').fill('Synthetic Child')
            steps.nth(2).click()
            page.get_by_label('House type', exact=True).fill('Synthetic structure')
            page.get_by_role('button', name='Home', exact=True).click()
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='New form', exact=True).click()
            assert page.get_by_role('button', name='Resume form', exact=True).is_visible()
            page.get_by_role('button', name='Resume form', exact=True).click()
            assert page.get_by_label('House type', exact=True).input_value() == 'Synthetic structure'
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft saved · version 0', exact=True).wait_for()
            saved_write_count = len(writes)
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft already up to date · version 0', exact=True).wait_for()
            assert len(writes) == saved_write_count
            page.get_by_role('button', name='Home', exact=True).click()
            expect(dashboard.get_by_role('button', name='Open SYN-NAV-001')).to_be_visible()
            expect(dashboard.get_by_text('Showing 1 most recently updated application.', exact=False)).to_be_visible()
            page.screenshot(path=str(review / (label + '-dashboard-with-draft.png')), full_page=True)
            page.get_by_label('Filter recent applications', exact=True).fill('missing-reference')
            expect(dashboard.get_by_text('No recent applications match this reference.', exact=True)).to_be_visible()
            page.get_by_label('Filter recent applications', exact=True).fill('SYN-NAV-001')
            page.get_by_role('button', name='Open SYN-NAV-001', exact=True).click()
            expect(page.get_by_label('Surname', exact=True)).to_have_value('Original')
            page.get_by_role('button', name='Home', exact=True).click()
            page.get_by_role('button', name='New form', exact=True).click()
            page.get_by_role('heading', name='Applicant', exact=True).wait_for()
            assert page.get_by_label('First names', exact=True).input_value() == ''
            assert page.get_by_label('Surname', exact=True).input_value() == ''
            assert page.get_by_label('Synthetic case reference', exact=True).input_value() == 'SYN-'
            steps.nth(1).click()
            assert page.get_by_label('Declared income source').input_value() == ''
            assert not page.get_by_label('Dependant 1 name').is_visible()
            steps.nth(2).click()
            assert page.get_by_label('House type', exact=True).input_value() == ''
            steps.nth(0).click()
            page.get_by_label('Synthetic case reference', exact=True).fill('SYN-NAV-002')
            page.get_by_label('First names', exact=True).fill('Synthetic')
            page.get_by_label('Surname', exact=True).fill('Second')
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft saved · version 0', exact=True).wait_for()
            assert writes == [('POST','synthetic-case-1'),('POST','synthetic-case-2')]
            assert stored_cases['synthetic-case-1']['form']['applicant']['surname'] == 'Original'
            page.get_by_role('button', name='Home', exact=True).click()
            stored_cases['synthetic-case-2']['workflow_status'] = 'SUBMITTED_FOR_ASSESSMENT'
            page.get_by_label('Existing draft').select_option('synthetic-case-2')
            expect(page.get_by_label('First names', exact=True)).to_be_disabled()
            assert page.get_by_role('button', name='Save current form', exact=True).is_disabled()
            assert page.get_by_role('button', name='New form', exact=True).is_enabled()
            page.get_by_role('button', name='Home', exact=True).click()
            stored_cases['synthetic-case-1']['workflow_status'] = 'RETURNED'
            page.get_by_label('Existing draft').select_option('synthetic-case-1')
            page.get_by_label('Surname', exact=True).wait_for()
            assert page.get_by_label('Surname', exact=True).input_value() == 'Original'
            page.get_by_label('Surname', exact=True).fill('Changed')
            fail_save['value'] = True
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('TEST_SAVE_FAILED', exact=True).wait_for()
            page.get_by_role('button', name='Home', exact=True).click()
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='New form', exact=True).click()
            page.get_by_role('button', name='Resume form', exact=True).click()
            assert page.get_by_label('Surname', exact=True).input_value() == 'Changed'
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft saved · version 1', exact=True).wait_for()
            expect(page.locator('.capture-state')).to_contain_text('returned')
            page.get_by_role('button', name='Home', exact=True).click()
            page.reload(wait_until='domcontentloaded')
            wait_for_project()
            page.get_by_role('combobox', name=re.compile(r'^Project')).select_option('synthetic-project')
            page.get_by_label('Existing draft').select_option('synthetic-case-1')
            page.get_by_label('Surname', exact=True).wait_for()
            assert page.get_by_label('Surname', exact=True).input_value() == 'Changed'
            # Save-and-evidence handoff stops on a failed save and uses the saved version.
            steps.nth(2).click()
            page.get_by_label('House type', exact=True).fill('Updated synthetic structure')
            fail_save['value'] = True
            page.get_by_role('button', name='Save and open evidence', exact=True).click()
            page.get_by_text('TEST_SAVE_FAILED', exact=True).wait_for()
            assert page.get_by_role('heading', name='Site verification', exact=True).is_visible()
            assert page.get_by_label('House type', exact=True).input_value() == 'Updated synthetic structure'
            page.get_by_role('button', name='Save and open evidence', exact=True).click()
            expect(page.get_by_role('heading', name='Documents & readiness', exact=True)).to_be_visible()
            readonly_writes = list(writes)
            readiness_version['offset'] = 1
            page.get_by_role('button', name='Check readiness', exact=True).click()
            page.get_by_text('This application changed since it was loaded. Open the latest saved draft before checking readiness.', exact=True).wait_for()
            assert writes == readonly_writes
            readiness_version['offset'] = 0
            page.get_by_role('button', name='Check readiness', exact=True).click()
            expect(page.get_by_role('heading', name='Next actions', exact=True)).to_be_visible()
            assert writes == readonly_writes
            # Evidence capability comes from the server, not the officer role or file chooser.
            steps.nth(3).click()
            uploader = page.get_by_role('group', name='Upload evidence', exact=True)
            picker = uploader.locator('input[type=file]')
            upload_button = uploader.get_by_role('button', name='Upload and scan', exact=True)
            refresh_evidence = page.get_by_role('button', name='Refresh evidence and reviews', exact=True)
            uploader.get_by_text('Document uploads are unavailable', exact=True).wait_for()
            assert picker.is_disabled() and upload_button.is_disabled()
            assert upload_intents == [] and uploaded_bytes == []
            page.get_by_role('button', name='Check document service', exact=True).click()
            page.get_by_text('The private document service is not connected yet.', exact=True).wait_for()
            upload_state['service_error'] = {'error':'DOCUMENT_SERVICE_NOT_READY','failedCheck':'STARTUP'}
            page.get_by_role('button', name='Check document service', exact=True).click()
            page.get_by_text('The scanner could not start. Please report this startup message.', exact=True).wait_for()
            upload_state['service_error'] = {'error':'EVIDENCE_ACTION_DENIED'}
            page.get_by_role('button', name='Check document service', exact=True).click()
            page.get_by_text('Your account does not have permission to check the document service for this saved case.', exact=True).wait_for()
            upload_state['service_error'] = None
            upload_state['service_ready'] = True
            page.get_by_role('button', name='Check document service', exact=True).click()
            page.get_by_text('The scanner and ID reader passed their synthetic checks. Uploads and ID reading are awaiting activation.', exact=True).wait_for()
            assert picker.is_disabled() and upload_button.is_disabled()
            page.screenshot(path=str(review / (label + '-uploads-unavailable.png')), full_page=True)
            # Unknown configuration and failed reads never masquerade as a successful empty list.
            upload_state['enabled'] = None
            refresh_evidence.click()
            uploader.get_by_text('Upload availability could not be confirmed', exact=True).wait_for()
            assert picker.is_disabled()
            upload_state['fail_register'] = True
            refresh_evidence.click()
            page.get_by_text('Unable to load recorded evidence. Refresh to check whether a document is saved.', exact=True).wait_for()
            assert not page.get_by_text('No documents recorded for this case.', exact=True).is_visible()
            assert picker.is_disabled()
            upload_state.update(enabled=True, fail_register=False, fail_department=True)
            refresh_evidence.click()
            page.get_by_text('Unable to load departmental reviews. Refresh before recording a decision.', exact=True).wait_for()
            picker.wait_for(state='visible')
            assert picker.is_enabled()  # Independent departmental failure cannot hide evidence capability.
            synthetic_pdf = b'%PDF-1.4\nSynthetic browser fixture only'
            picker.set_input_files({'name':'synthetic-id.pdf','mimeType':'application/pdf','buffer':synthetic_pdf})
            uploader.get_by_text('Selected: synthetic-id.pdf. Not uploaded yet. Press Upload and scan to add it to the case.', exact=True).wait_for()
            assert upload_intents == [] and evidence_documents == []
            page.get_by_role('button', name='Home', exact=True).click()
            page.get_by_role('button', name='Resume form', exact=True).click()
            assert picker.evaluate('element => element.files[0].name') == 'synthetic-id.pdf'
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='New form', exact=True).click()
            assert picker.evaluate('element => element.files[0].name') == 'synthetic-id.pdf'
            # A configuration change between selection and submission is reported next to the button.
            upload_state['fail_intent'] = True
            upload_button.click()
            expect(uploader.get_by_role('alert')).to_have_text('Upload blocked. Document uploads are unavailable until the scanning service is connected. This file has not been uploaded.')
            assert picker.is_disabled() and uploaded_bytes == [] and evidence_documents == []
            upload_state.update(fail_intent=False, fail_department=False, fail_refresh_after_upload=True)
            refresh_evidence.click()
            picker.wait_for(state='visible')
            expect(picker).to_be_enabled()
            # The acknowledgement remains successful if the following register refresh fails.
            upload_state['hold_upload'] = True
            upload_button.click()
            expect(page.get_by_role('button', name='Home', exact=True)).to_be_disabled()
            assert steps.nth(0).is_disabled()
            for attempt in range(100):
                if delayed_uploads: break
                page.wait_for_timeout(50)
            assert len(delayed_uploads) == 1
            pending_route, pending_result = delayed_uploads.pop()
            upload_state['hold_upload'] = False
            pending_route.fulfill(status=200, content_type='application/json', body=json.dumps(pending_result))
            uploader.get_by_text('Uploaded and scanned. Assessor review is still required. The register could not refresh. Use Refresh evidence and reviews to check the saved document.', exact=True).wait_for()
            assert uploaded_bytes == [synthetic_pdf]
            assert picker.input_value() == '' and upload_button.is_disabled()
            assert not uploader.get_by_role('alert').is_visible()
            upload_state['fail_register'] = False
            refresh_evidence.click()
            page.locator('.evidence-register').get_by_text('synthetic-id.pdf', exact=True).wait_for()
            assert page.locator('.evidence-register').get_by_text('applicant id · pending review · clean', exact=True).is_visible()
            assert not page.get_by_text('No documents recorded for this case.', exact=True).is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-evidence-upload-status.png')), full_page=True)
            # A completed retry can still fail; report the fixed reason and keep the document quarantined.
            evidence_documents[0].update(status='PENDING_SCAN', malware_status='SCAN_FAILED')
            upload_state['retry_failure'] = 'CONNECTION'
            refresh_evidence.click()
            page.get_by_role('button', name='Retry scan', exact=True).click()
            expect(page.locator('.evidence-register').get_by_role('alert')).to_have_text('Scan failed (CONNECTION). The file remains quarantined. Use Retry scan; if it fails again, report this code.')
            assert page.locator('.evidence-register').get_by_text('applicant id · pending scan · scan failed', exact=True).is_visible()
            assert not page.get_by_text('Scanner retry completed.', exact=True).is_visible()
            upload_state['retry_failure'] = None
            page.get_by_role('button', name='Retry scan', exact=True).click()
            page.locator('.evidence-register').get_by_text('Scanned successfully. Assessor review is still required.', exact=True).wait_for()
            assert page.locator('.evidence-register').get_by_text('applicant id · pending review · clean', exact=True).is_visible()
            reader = page.get_by_role('region', name='Applicant ID reading', exact=True)
            read_button = reader.get_by_role('button', name='Read ID details', exact=True)
            assert read_button.is_disabled() and id_reads == []
            upload_state['id_reading'] = True
            refresh_evidence.click()
            expect(read_button).to_be_enabled()
            upload_state['fail_reading'] = True
            read_button.click()
            expect(reader.get_by_role('alert')).to_have_text('Unable to read ID details. Try again when the service is ready, or enter the details manually.')
            assert page.locator('aside .summary h3').inner_text() == 'Synthetic Changed'
            upload_state['fail_reading'] = False
            read_button.click()
            proposal = reader.get_by_role('region', name='Review extracted ID details', exact=True)
            proposal.get_by_role('heading', name='Review ID details', exact=True).wait_for()
            assert page.locator('aside .summary h3').inner_text() == 'Synthetic Changed'
            assert not proposal.get_by_label('Use first names from ID', exact=True).is_checked()
            assert not proposal.get_by_label('Use surname from ID', exact=True).is_checked()
            assert proposal.get_by_label('Use south african id number from ID', exact=True).is_checked()
            apply_id = proposal.get_by_role('button', name='Apply selected ID details', exact=True)
            assert apply_id.is_disabled()
            proposal.get_by_label('First names read from ID', exact=True).fill('Corrected Synthetic')
            proposal.get_by_label('Use first names from ID', exact=True).check()
            assert apply_id.is_disabled()
            proposal.get_by_label('I checked the selected details against the original applicant ID', exact=True).check()
            expect(apply_id).to_be_enabled()
            # Refresh keeps reviewed, unapplied ID input. An unavailable register
            # must block application until the same clean document is confirmed.
            refresh_evidence.click()
            expect(proposal.get_by_label('First names read from ID', exact=True)).to_have_value('Corrected Synthetic')
            expect(apply_id).to_be_enabled()
            upload_state['fail_register'] = True
            refresh_evidence.click()
            expect(page.get_by_text('Unable to load recorded evidence. Refresh to check whether a document is saved.', exact=True)).to_be_visible()
            expect(apply_id).to_be_disabled()
            expect(proposal.get_by_label('First names read from ID', exact=True)).to_have_value('Corrected Synthetic')
            upload_state['fail_register'] = False
            refresh_evidence.click()
            expect(apply_id).to_be_enabled()
            evidence_documents[0].update(status='REJECTED')
            refresh_evidence.click()
            expect(proposal).not_to_be_visible()
            expect(reader.get_by_role('alert')).to_have_text('The source ID is no longer available for reading. Its suggestions were removed; form details are unchanged.')
            assert page.locator('aside .summary h3').inner_text() == 'Synthetic Changed'
            evidence_documents[0].update(status='PENDING_REVIEW')
            refresh_evidence.click()
            read_button.click()
            proposal.get_by_label('First names read from ID', exact=True).fill('Corrected Synthetic')
            proposal.get_by_label('Use first names from ID', exact=True).check()
            proposal.get_by_label('I checked the selected details against the original applicant ID', exact=True).check()
            expect(apply_id).to_be_enabled()
            assert stored_cases['synthetic-case-1']['form']['applicant']['firstNames'] == 'Synthetic'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-id-reading-confirmation.png')), full_page=True)
            apply_id.click()
            assert page.locator('aside .summary h3').inner_text() == 'Corrected Synthetic Changed'
            assert not proposal.is_visible()
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft saved · version 3', exact=True).wait_for()
            assert stored_cases['synthetic-case-1']['form']['applicant']['firstNames'] == 'Corrected Synthetic'
            assert stored_cases['synthetic-case-1']['form']['applicant']['surname'] == 'Changed'
            assert stored_cases['synthetic-case-1']['form']['applicant']['idNumber'] == synthetic_id
            assert page.locator('.evidence-register').get_by_text('applicant id · pending review · clean', exact=True).is_visible()
            project_role['value'] = 'ASSESSOR'
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Refresh projects', exact=True).click()
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Review document', exact=True).click()
            expect(page.get_by_label('Document awaiting review', exact=False)).to_have_value('synthetic-document')
            review_note = page.get_by_role('textbox', name='Evidence review note · at least 10 characters', exact=True)
            review_note.fill('Synthetic original and certification checked.')
            page.get_by_role('button', name='Review document', exact=True).click()
            expect(review_note).to_have_value('Synthetic original and certification checked.')
            second_document = {**evidence_documents[0], 'id':'synthetic-document-2', 'filename':'synthetic-second-id.pdf'}
            evidence_documents.append(second_document)
            refresh_evidence.click()
            document_selector = page.get_by_role('combobox', name='Document awaiting review', exact=True)
            page.once('dialog', lambda dialog: dialog.dismiss())
            document_selector.select_option('synthetic-document-2')
            expect(document_selector).to_have_value('synthetic-document')
            expect(review_note).to_have_value('Synthetic original and certification checked.')
            page.once('dialog', lambda dialog: dialog.accept())
            document_selector.select_option('synthetic-document-2')
            expect(review_note).to_have_value('')
            document_selector.select_option('synthetic-document')
            review_note.fill('Synthetic original and certification checked.')
            page.get_by_label('Content, applicant match and applicable signatures / commissioning checked', exact=True).check()
            assert page.get_by_role('button', name='Record evidence decision', exact=True).is_disabled()
            page.get_by_label('ID certification confirmed where required', exact=True).check()
            upload_state['fail_register'] = True
            refresh_evidence.click()
            expect(page.get_by_text('Unable to load recorded evidence. Refresh to check whether a document is saved.', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='Record evidence decision', exact=True)).to_be_disabled()
            expect(review_note).to_have_value('Synthetic original and certification checked.')
            upload_state['fail_register'] = False
            refresh_evidence.click()
            expect(page.get_by_role('button', name='Record evidence decision', exact=True)).to_be_enabled()
            # A decision by another assessor invalidates this selection without
            # silently discarding its note or permitting a second decision.
            evidence_documents[0].update(status='VERIFIED',reviewed_form_version=stored_cases['synthetic-case-1']['version'])
            refresh_evidence.click()
            expect(page.get_by_role('button', name='Record evidence decision', exact=True)).to_be_disabled()
            expect(review_note).to_have_value('Synthetic original and certification checked.')
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='Clear evidence review', exact=True).click()
            expect(review_note).to_have_value('Synthetic original and certification checked.')
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='Clear evidence review', exact=True).click()
            expect(review_note).to_have_value('')
            evidence_documents[0].update(status='PENDING_REVIEW')
            evidence_documents.remove(second_document)
            refresh_evidence.click()
            page.get_by_role('button', name='Review document', exact=True).click()
            review_note.fill('Synthetic original and certification checked.')
            page.get_by_label('Content, applicant match and applicable signatures / commissioning checked', exact=True).check()
            page.get_by_label('ID certification confirmed where required', exact=True).check()
            # A remote save must reject a review of the old loaded form and keep its draft note.
            stored_cases['synthetic-case-1']['version'] += 1
            page.get_by_role('button', name='Record evidence decision', exact=True).click()
            page.get_by_text('The saved form or document changed, or required certification is incomplete. Your note is retained. Reopen the current saved case and review the document again before recording a decision.', exact=True).wait_for()
            expect(review_note).to_have_value('Synthetic original and certification checked.')
            stored_cases['synthetic-case-1']['version'] -= 1
            page.get_by_role('button', name='Record evidence decision', exact=True).click()
            page.get_by_text('Evidence review recorded.', exact=True).wait_for()
            expect(page.locator('.evidence-register').get_by_text('applicant id · verified · clean', exact=True)).to_be_visible()
            expect(review_note).to_have_value('')
            # A real capture edit changes the saved version. The same clean file
            # becomes reviewable again, without another upload or malware scan.
            steps.nth(0).click()
            page.get_by_label('Contact number', exact=True).fill('0000000000')
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft saved · version 4', exact=True).wait_for()
            steps.nth(3).click()
            expect(page.locator('.evidence-register').get_by_text('applicant id · review required after form change · clean', exact=True)).to_be_visible()
            page.get_by_role('button', name='Review document', exact=True).click()
            review_note.fill('Synthetic document checked against edited form.')
            page.get_by_label('Content, applicant match and applicable signatures / commissioning checked', exact=True).check()
            page.get_by_label('ID certification confirmed where required', exact=True).check()
            page.get_by_role('button', name='Record evidence decision', exact=True).click()
            page.get_by_text('Evidence review recorded.', exact=True).wait_for()
            assert evidence_documents[0]['reviewed_form_version'] == 4
            expect(page.locator('.evidence-register').get_by_text('applicant id · verified · clean', exact=True)).to_be_visible()
            # Department drafts retain their edit-start token even after a register refresh.
            department_reviews.append({'section':'PAGE_2','state':'COMPLETE','note':'Existing synthetic section decision.','reviewed_at':'2026-10-24T12:00:00.000001Z','reviewed_form_version':4})
            project_role['value'] = 'DOHS_REVIEWER'
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Refresh projects', exact=True).click()
            page.locator('summary', has_text='Account').click()
            refresh_evidence.click()
            expect(page.get_by_role('combobox', name='Section outcome', exact=True)).to_have_value('COMPLETE')
            expect(page.get_by_role('textbox', name='Departmental review note · at least 10 characters', exact=True)).to_have_value('Existing synthetic section decision.')
            assert page.get_by_role('button', name='Save current form', exact=True).is_disabled()
            assert not page.get_by_role('region', name='Applicant ID reading', exact=True).is_visible()
            page.get_by_role('textbox', name='Departmental review note · at least 10 characters', exact=True).fill('My pending synthetic section decision.')
            upload_state['fail_department'] = True
            refresh_evidence.click()
            expect(page.get_by_text('Unable to load departmental reviews. Refresh before recording a decision.', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='Record departmental decision', exact=True)).to_be_disabled()
            expect(page.get_by_role('textbox', name='Departmental review note · at least 10 characters', exact=True)).to_have_value('My pending synthetic section decision.')
            upload_state['fail_department'] = False
            department_reviews[0].update(note='Concurrent synthetic section decision.',reviewed_at='2026-10-24T12:15:00.000001Z')
            refresh_evidence.click()
            expect(page.get_by_role('textbox', name='Departmental review note · at least 10 characters', exact=True)).to_have_value('My pending synthetic section decision.')
            page.get_by_role('button', name='Record departmental decision', exact=True).click()
            page.get_by_text('The saved form or section changed since editing started. Your note is retained. Reopen the current saved case, then reload the selected section before recording a decision.', exact=True).wait_for()
            assert department_writes[-1]['expectedReviewedAt'] == '2026-10-24T12:00:00.000001Z'
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='Reload selected section', exact=True).click()
            expect(page.get_by_role('textbox', name='Departmental review note · at least 10 characters', exact=True)).to_have_value('Concurrent synthetic section decision.')
            page.get_by_role('textbox', name='Departmental review note · at least 10 characters', exact=True).fill('Reconciled synthetic section decision.')
            page.get_by_role('button', name='Record departmental decision', exact=True).click()
            page.get_by_text('Departmental section decision recorded.', exact=True).wait_for()
            assert department_writes[-1]['expectedReviewedAt'] == '2026-10-24T12:15:00.000001Z'
            project_role['value'] = 'ASSESSOR'
            page.locator('summary', has_text='Account').click()
            page.get_by_role('button', name='Refresh projects', exact=True).click()
            page.locator('summary', has_text='Account').click()
            steps.nth(0).click()
            page.get_by_label('Surname', exact=True).fill('Discarded change')
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='New form', exact=True).click()
            assert page.get_by_label('Surname', exact=True).input_value() == ''
            assert stored_cases['synthetic-case-1']['form']['applicant']['surname'] == 'Changed'
            page.get_by_label('First names', exact=True).fill('Unsaved temporary capture')
            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='Log out', exact=True).click()
            assert signed_in['value']
            assert page.get_by_label('First names', exact=True).input_value() == 'Unsaved temporary capture'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-capture-navigation.png')), full_page=True)
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='Log out', exact=True).click()
            expect(page.get_by_role('heading', level=1)).to_contain_text('Every application.')
            assert not page.get_by_role('region', name='Project dashboard').is_visible()
            page.get_by_role('button', name='Sign in to get started', exact=True).click()
            page.get_by_label('Email', exact=True).wait_for()
            assert page.get_by_role('button', name='Forgot password', exact=True).is_visible()
            assert not page.get_by_role('combobox', name=re.compile(r'^Project')).is_visible()
            assert not page.get_by_role('button', name='Resume form', exact=True).is_visible()
            assert not page.get_by_label('First names', exact=True).is_visible()
            assert not signed_in['value']
            assert page.get_by_label('Password', exact=True).input_value() == ''
            assert not errors, errors
            page.close()
            print(label + ': preview/PDF, mocked Auth, capture/navigation, evidence upload states, ID reading availability/failure, review-before-apply, selective replacement, saved ID details, pending assessor review and no overflow/script errors passed.', flush=True)
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    log.close()
    local_config.cleanup()

