"""Desktop/mobile preview journeys against the local Worker; Auth is stubbed and no beneficiary data is used."""
import base64, json, os, subprocess, time, shutil
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

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
            page.get_by_role('button', name='Home', exact=True).click()
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
            page.locator('summary', has_text='Account').click()
            # A stateful API double proves new captures never update the previous draft.
            stored_cases = {}
            writes = []
            fail_save = {'value':False}
            upload_state = {'enabled':False,'id_reading':False,'service_ready':False,'fail_reading':False,'fail_register':False,'fail_department':False,'fail_intent':False,'fail_refresh_after_upload':False}
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
                elif suffix.endswith('/evidence/synthetic-document/read-id') and method == 'POST':
                    id_reads.append(suffix)
                    if upload_state['fail_reading']:
                        status, result = 503, {'error':'ID_READING_UNAVAILABLE'}
                    else:
                        result = {'evidenceId':'synthetic-document','sha256':'a'*64,'fields':{'firstNames':'READ SYNTHETIC','surname':'READ EXAMPLE','idNumber':synthetic_id},'dateOfBirth':'1990-01-01','warnings':['Check every proposed value against the original ID.'],'requiresConfirmation':True}
                elif suffix.endswith('/dohs'):
                    status, result = (503, {'error':'TEST_DEPARTMENT_UNAVAILABLE'}) if upload_state['fail_department'] else (200, {'reviews':[]})
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
            page.get_by_label('Project').select_option('synthetic-project')
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
            page.get_by_role('button', name='Home', exact=True).click()
            page.reload(wait_until='domcontentloaded')
            wait_for_project()
            page.get_by_label('Project').select_option('synthetic-project')
            page.get_by_label('Existing draft').select_option('synthetic-case-1')
            page.get_by_label('Surname', exact=True).wait_for()
            assert page.get_by_label('Surname', exact=True).input_value() == 'Changed'
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
            upload_button.click()
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
            assert stored_cases['synthetic-case-1']['form']['applicant']['firstNames'] == 'Synthetic'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(review / (label + '-id-reading-confirmation.png')), full_page=True)
            apply_id.click()
            assert page.locator('aside .summary h3').inner_text() == 'Corrected Synthetic Changed'
            assert not proposal.is_visible()
            page.get_by_role('button', name='Save current form', exact=True).click()
            page.get_by_text('Draft saved · version 2', exact=True).wait_for()
            assert stored_cases['synthetic-case-1']['form']['applicant']['firstNames'] == 'Corrected Synthetic'
            assert stored_cases['synthetic-case-1']['form']['applicant']['surname'] == 'Changed'
            assert stored_cases['synthetic-case-1']['form']['applicant']['idNumber'] == synthetic_id
            assert page.locator('.evidence-register').get_by_text('applicant id · pending review · clean', exact=True).is_visible()
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
            page.get_by_label('Email', exact=True).wait_for()
            assert page.get_by_role('button', name='Forgot password', exact=True).is_visible()
            assert not page.get_by_label('Project').is_visible()
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
