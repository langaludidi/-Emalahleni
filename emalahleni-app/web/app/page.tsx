'use client';
import { useEffect, useState } from 'react';
import { createAuthClient } from '@neondatabase/auth';
import { blankForm, type CaseForm, type Readiness } from '../src-link';
import { requirementsFor } from '../../src/rules';
import ReviewWorkspace from './review-workspace';
import PhotoMetadata from './photo-proposal';
import type {ExportSnapshot} from '../../src/export-contracts';
import {formSchema} from '../../src/contracts';
import {evaluate} from '../../src/rules';
import type {PhotoProposal} from '../../src/photo-metadata';
import {idFieldsSchema,validSaId,type IdFields} from '../../src/id-reading';
import HomeScreen from './home-screen';
import Dashboard from './project-dashboard';
import SplashScreen from './splash-screen';
import type {ProjectDashboard} from '../../src/dashboard';
import {evidenceWriterRoles} from '../../src/evidence-contracts';

const authUrl = 'https://ep-cold-scene-zaa3qek2.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
type Project = { id: string; name: string; code: string; role: string };
type Case = { id: string; reference: string; version: number; workflow_status: string };
const steps = ['Applicant', 'Household & income', 'Site verification', 'Documents & readiness'];
const labels: Record<string,string> = { UNEMPLOYED: 'No income / unemployed', SOCIAL_GRANT: 'Social grant', EMPLOYED: 'Employed', SELF_EMPLOYED: 'Self-employed', PENSION: 'Pension', OTHER: 'Other income' };
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function needsEmailVerification(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && ['EMAIL_NOT_VERIFIED','EMAIL_NOT_CONFIRMED'].includes(String(error.code).toUpperCase());
}
function formSnapshot(form:CaseForm,reference:string) { return JSON.stringify({form,reference}); }

export default function Page() {
  const [step,setStep] = useState(0); const [form,setForm] = useState<CaseForm>(blankForm());
  const [mode,setMode] = useState<'preview'|'connected'>('connected'); const [user,setUser] = useState('');
  const [view,setView] = useState<'home'|'capture'>('home'); const [resumeAvailable,setResumeAvailable] = useState(false);
  const [sessionReady,setSessionReady] = useState(false); const [connectionOpen,setConnectionOpen] = useState(false);
  const [dashboard,setDashboard] = useState<{projectId:string;data:ProjectDashboard}|null>(null);
  const [dashboardLoading,setDashboardLoading] = useState(false); const [dashboardError,setDashboardError] = useState('');
  const [dashboardRevision,setDashboardRevision] = useState(0);
  const [email,setEmail] = useState(''); const [password,setPassword] = useState('');
  const [verificationNeeded,setVerificationNeeded] = useState(false);
  const [verificationSent,setVerificationSent] = useState(false); const [verificationCode,setVerificationCode] = useState('');
  const [recovering,setRecovering] = useState(false); const [resetSent,setResetSent] = useState(false);
  const [resetCode,setResetCode] = useState(''); const [newPassword,setNewPassword] = useState(''); const [confirmPassword,setConfirmPassword] = useState('');
  const [projects,setProjects] = useState<Project[]>([]); const [project,setProject] = useState('');
  const [cases,setCases] = useState<Case[]>([]); const [active,setActive] = useState<Case|null>(null);
  const [reference,setReference] = useState('SYN-'); const [status,setStatus] = useState('Sign in to access your applications, or explore the preview form.');
  const [savedSnapshot,setSavedSnapshot] = useState(()=>formSnapshot(blankForm(),'SYN-'));
  const unsaved = formSnapshot(form,reference)!==savedSnapshot;
  const [busy,setBusy] = useState(false); const [documentBusy,setDocumentBusy] = useState(false); const [pendingDocuments,setPendingDocuments] = useState(false); const working=busy||documentBusy;
  const [readiness,setReadiness] = useState<Readiness|null>(null);
  const [auth] = useState(() => createAuthClient(authUrl));
  const dirty = () => setReadiness(null);
  const applicant = <K extends keyof CaseForm['applicant']>(key: K, value: CaseForm['applicant'][K]) => { dirty(); setForm(f=>({...f,applicant:{...f.applicant,[key]:value}})); };
  const site = <K extends keyof CaseForm['site']>(key: K, value: CaseForm['site'][K]) => { dirty(); setForm(f=>({...f,site:{...f.site,[key]:value,...(['latitude','longitude','verificationDate'].includes(key)?{photoParametersConfirmed:false,photoMetadataSource:'MANUAL' as const,photoMetadataSha256:''}:{})}})); };
  function applyPhoto(p:PhotoProposal){dirty();setForm(f=>({...f,site:{...f.site,latitude:p.latitude,longitude:p.longitude,verificationDate:p.date,photoParametersConfirmed:false,houseTypeConfirmed:false,photoMetadataSha256:p.sha256,photoMetadataSource:'EXIF'}}));}
  function applyId(fields:Partial<IdFields>){const checked=idFieldsSchema.partial().parse(fields);if(checked.idNumber&&!validSaId(checked.idNumber))throw Error('Check the ID number against the document.');dirty();setForm(f=>({...f,applicant:{...f.applicant,...checked}}));setStatus('Selected ID details applied. Save the draft to keep them.');}
  async function run(action:()=>Promise<unknown>) { if(documentBusy){setStatus('Wait for the document operation to finish before continuing.');return;}setBusy(true); try { await action(); } catch(e) { setStatus(e instanceof Error ? e.message : 'Unable to complete this action.'); } finally { setBusy(false); } }
  async function accessToken() {
    // A valid sign-in session can contain an opaque cookie token. Request the
    // API JWT explicitly instead of depending on optional response headers.
    // Neon 0.5 can reuse its session cache for /token. Its force-fetch header
    // asks the SDK to reach the JWT endpoint and is removed before transport.
    const result=await auth.token({fetchOptions:{headers:{'X-Force-Fetch':'true'}}});const token=result.data?.token;
    if(result.error || !token || token.split('.').length!==3)throw new Error('Sign out and sign in again to continue.');
    return token;
  }
  async function api(path: string, method='GET', data?: unknown) {
    const token = await accessToken();
    const response = await fetch(path,{method, headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, ...(data === undefined ? {} : {body:JSON.stringify(data)})});
    const result=await response.json(); if (!response.ok) throw new Error(response.status===429 ? 'Too many requests. Please wait one minute and try again. Your draft has not been cleared.' : result.error==='CASE_API_NOT_CONFIGURED' ? 'Connected case saving is awaiting server configuration. Preview is available now.' : result.error==='SAVE_CONFLICT_OR_DENIED' ? 'This draft changed or is no longer editable. Reload it before saving again.' : result.error==='DOCUMENT_SERVICE_NOT_READY'&&typeof result.failedCheck==='string'?`${result.error}:${result.failedCheck}`:result.error ?? 'Request failed.');
    return result;
  }
  async function sendFile(path:string,bytes:ArrayBuffer,type:string){const token=await accessToken();const response=await fetch(path,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':type},body:bytes});const result=await response.json();if(!response.ok)throw new Error(response.status===429?'Too many requests. Please wait one minute and retry the upload.':result.error??'Upload failed.');return result;}
  async function downloadFile(path:string,filename:string){const token=await accessToken();const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('This file is unavailable or has not passed scanning.');const objectUrl=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=objectUrl;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
  async function snapshot():Promise<ExportSnapshot>{
    if(mode==='connected'){if(!active)throw new Error('Save and load a case before exporting.');if(editable)await save();return api(`/api/projects/${project}/applications/${active.id}/export`);}
    const checked=formSchema.parse(form),generatedAt=new Date().toISOString();return {applicationId:'',projectId:'',reference:'PREVIEW',version:0,form:checked,readiness:evaluate(checked,[],[],generatedAt.slice(0,10)),evidence:[],reviews:[],generatedAt,fingerprint:'preview',preview:true};
  }
  async function exportPdf(pack:boolean){
    const data=await snapshot();const exports=await import('./pdf-exports');
    const blob=pack?await exports.draftPack(data,async id=>{const token=await accessToken();const response=await fetch(`/api/projects/${data.projectId}/applications/${data.applicationId}/evidence/${id}/download`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('An evidence document is no longer available. Refresh before exporting.');return response.arrayBuffer();},async()=>{const current=await api(`/api/projects/${data.projectId}/applications/${data.applicationId}/export`);return current.fingerprint;}):await exports.summaryPdf(data);
    const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectUrl;link.download=`${data.reference}-${pack?'draft-pack':'verification-summary'}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);setStatus(pack?'Draft pack generated from verified, clean evidence. Submission remains unapproved.':'Verification summary generated.');
  }
  async function loadProjects() { const result=await api('/api/projects');setProjects(result.projects);setStatus(result.projects.length ? 'Choose your project to begin.' : 'Signed in. No active project membership is assigned to this account.'); }
  useEffect(()=> {
    let live=true;
    // Session lookup must not trap a visitor behind a loading screen on a poor connection.
    const fallback=window.setTimeout(()=>{if(live){live=false;setSessionReady(true);}},8000);
    auth.getSession().then(async result=>{if(!live)return;window.clearTimeout(fallback);setSessionReady(true);if(result.data?.user){setUser(result.data.user.name || result.data.user.email);setMode('connected');setView('home');await run(loadProjects);}}).catch(()=>{}).finally(()=>{if(live){window.clearTimeout(fallback);setSessionReady(true);}});
    return()=>{live=false;window.clearTimeout(fallback);};
  },[auth]);
  useEffect(()=>{
    let live=true;setDashboardError('');
    if(view!=='home'||mode!=='connected'||!user||!project){setDashboard(null);setDashboardLoading(false);return;}
    setDashboard(previous=>previous?.projectId===project?previous:null);
    setDashboardLoading(true);
    api(`/api/projects/${project}/dashboard`).then(result=>{if(live)setDashboard({projectId:project,data:result});}).catch(()=>{if(live)setDashboardError('The project overview could not be loaded. Your applications are still available above.');}).finally(()=>{if(live)setDashboardLoading(false);});
    return()=>{live=false;};
  },[view,mode,user,project,dashboardRevision]);
  useEffect(()=>{if(!unsaved&&!documentBusy&&!pendingDocuments)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[unsaved,documentBusy,pendingDocuments]);
  function showVerification() { setVerificationNeeded(true);setVerificationSent(false);setVerificationCode('');setStatus('Verify your email before signing in. Request a code below.'); }
  async function signIn() {
    try {
      const result=await auth.signIn.email({email,password});
      if(result.error) { if(needsEmailVerification(result.error)){showVerification();return;}throw new Error(result.error.message || 'Sign-in failed.'); }
      setVerificationNeeded(false);setVerificationSent(false);setVerificationCode('');setUser(result.data?.user.name || email);setView('home');await loadProjects();
    } catch(error) { if(needsEmailVerification(error)){showVerification();return;}throw error; }
    finally { setPassword(''); }
  }
  async function signOut() {
    if(!confirmDiscard('Log out'))return;
    const result=await auth.signOut();if(result.error)throw new Error(result.error.message || 'Unable to sign out. Please try again.');
    setUser('');setPassword('');setRecovering(false);clearRecovery();setVerificationNeeded(false);setVerificationSent(false);setVerificationCode('');
    setProjects([]);setCases([]);setProject('');setDashboard(null);setConnectionOpen(false);clearCapture();setView('home');setMode('connected');setStatus('Signed out.');
  }
  async function sendVerification() {
    const result=await auth.emailOtp.sendVerificationOtp({email,type:'email-verification'});
    if(result.error)throw new Error(result.error.message || 'Unable to send a verification code.');
    setVerificationSent(true);setVerificationCode('');setStatus('Verification code sent. Check your inbox and spam folder.');
  }
  async function verifyEmail() {
    const result=await auth.emailOtp.verifyEmail({email,otp:verificationCode});
    if(result.error)throw new Error(result.error.message || 'The verification code is invalid or expired.');
    setVerificationNeeded(false);setVerificationSent(false);setVerificationCode('');setStatus('Email verified. Enter your password and sign in.');
  }
  function clearRecovery() { setResetSent(false);setResetCode('');setNewPassword('');setConfirmPassword(''); }
  function changeEmail(value:string) {
    setEmail(value);setPassword('');setVerificationNeeded(false);setVerificationSent(false);setVerificationCode('');clearRecovery();
    setStatus(recovering?'Request a reset code for this email address.':'Enter your email and password to sign in.');
  }
  function toggleRecovery(value:boolean) {
    setRecovering(value);setPassword('');setVerificationNeeded(false);setVerificationSent(false);setVerificationCode('');clearRecovery();
    setStatus(value?'Request a reset code, then choose your own password.':'Enter your email and password to sign in.');
  }
  async function sendResetCode() {
    setResetCode('');
    const result=await auth.emailOtp.sendVerificationOtp({email:email.trim(),type:'forget-password'});
    if(result.error)throw new Error(result.error.message || 'Unable to request a reset code. Please try again.');
    setResetSent(true);setStatus('If this email has an account, a reset code has been sent. Check your inbox and spam folder.');
  }
  async function resetPassword() {
    if(resetCode.length!==6 || newPassword.length<8 || newPassword.length>128 || newPassword!==confirmPassword)throw new Error('Enter the six-digit code and matching passwords of 8 to 128 characters.');
    const result=await auth.emailOtp.resetPassword({email:email.trim(),otp:resetCode,password:newPassword});
    if(result.error)throw new Error(result.error.message || 'The reset code is invalid or expired. Request a new code and try again.');
    setRecovering(false);clearRecovery();setPassword('');setStatus('Password updated. Enter your new password and sign in.');
  }
  function confirmDiscard(action:string) { return !(unsaved||pendingDocuments) || window.confirm(`You have unsaved form or document changes. ${action} without saving them? Choose Cancel to keep the current form.`); }
  function clearCapture() { const empty=blankForm();setActive(null);setForm(empty);setReference('SYN-');setSavedSnapshot(formSnapshot(empty,'SYN-'));setReadiness(null);setStep(0);setResumeAvailable(false); }
  function home() { setResumeAvailable(true);setView('home');setStatus(unsaved||pendingDocuments?'Your unsaved form and document input are kept in this tab. Choose Resume form to continue.':'Choose Resume form, open a saved draft or start a new form.');window.scrollTo({top:0}); }
  function newForm() { if(!confirmDiscard('Start a new form'))return;clearCapture();setView('capture');setStatus(mode==='preview'?'New preview form · changes stay in this tab.':'New form. Enter a synthetic reference before saving.');window.scrollTo({top:0}); }
  async function changeMode(next:'preview'|'connected') {
    if(next===mode){if(next==='preview')setView('capture');else setConnectionOpen(true);if(user&&next==='connected')await loadProjects();return true;}
    if(!confirmDiscard('Switch workspace'))return false;
    clearCapture();setProject('');setCases([]);setMode(next);setView(next==='preview'?'capture':'home');
    setConnectionOpen(next==='connected');setStatus(next==='preview'?'Preview mode · changes stay in this tab.':'Sign in to access your applications.');if(user&&next==='connected')await loadProjects();return true;
  }
  async function openWorkspace(action:'new'|'saved') {
    if(mode!=='connected'&&!await changeMode('connected'))return;
    setConnectionOpen(true);
    if(mode==='connected'&&user&&project&&action==='new'&&canCapture){newForm();return;}
    requestAnimationFrame(()=>{
      const selector=!user?'input[autocomplete="username"]':project&&action==='saved'?'#draft-picker':'#project-picker';
      const control=document.querySelector<HTMLElement>(selector);
      control?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});control?.focus({preventScroll:true});
    });
  }
  async function selectProject(id:string) {
    if(!confirmDiscard('Change project'))return;
    const result=id?await api(`/api/projects/${id}/applications`):{applications:[]};clearCapture();setProject(id);setCases(result.applications);setView('home');setStatus(id?'Project selected. Start a form or open a saved application.':'Choose a project to begin.');
  }
  async function loadCase(id:string) {
    if(!confirmDiscard('Open another draft'))return;
    const result=await api(`/api/projects/${project}/applications/${id}`);clearCapture();setActive(result);setForm(result.form);setReference(result.reference);setSavedSnapshot(formSnapshot(result.form,result.reference));setView('capture');setStatus(`Loaded ${result.reference} · version ${result.version}`);window.scrollTo({top:0});
  }
  async function save():Promise<Case> {
    if(!project)throw new Error('Choose a project first.');
    if(!editable)throw new Error('This application is read only for your account or its current workflow status.');
    if(active&&!unsaved){setStatus(`Draft already up to date · version ${active.version}`);return active;}
    if(!/^SYN-[A-Z0-9-]{1,40}$/.test(reference))throw new Error('Enter a synthetic case reference beginning SYN- followed by letters, numbers or hyphens.');
    if(!formSchema.safeParse(form).success)throw new Error('Check the identity format, dates and coordinates before saving.');
    const root=`/api/projects/${project}/applications`;
    const result=active?await api(`${root}/${active.id}`,'PUT',{version:active.version,form}):await api(root,'POST',{reference,form});
    const saved={...result,workflow_status:active?.workflow_status??'DRAFT'} as Case;
    setActive(saved);setSavedSnapshot(formSnapshot(form,reference));setStatus(`Draft saved · version ${result.version}`);
    try{const list=await api(root);setCases(list.applications);}catch{setStatus(`Draft saved · version ${result.version}. The application list could not refresh; your saved draft is retained.`);}
    return saved;
  }
  async function openEvidence(){if(mode==='connected'&&editable)await save();setStep(3);window.scrollTo({top:0});}
  function changeStep(next:number){if(working)return;if(step===3&&next!==3&&pendingDocuments&&!window.confirm('Leaving documents will discard unrecorded document input. Stay here to upload, apply ID suggestions or record review decisions first.'))return;setStep(next);window.scrollTo({top:0});}
  async function assess() {
    if(mode==='connected') { if(!active)throw new Error('Save the draft before checking its recorded readiness.');const saved=editable?await save():active;const result=await api(`/api/projects/${project}/applications/${saved.id}/readiness`);if(result.formVersion!==saved.version){setReadiness(null);throw new Error('This application changed since it was loaded. Open the latest saved draft before checking readiness.');}setReadiness(result);setStatus('Readiness checked against saved evidence and departmental reviews.'); }
    else { const response=await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const result=await response.json();if(!response.ok)throw new Error('Check identity format, coordinates and dates before assessing.');setReadiness(result);setStatus('Preview assessment only. No documents have been uploaded or verified.'); }
    setStep(3);
  }
  const canCapture=mode==='preview'||evidenceWriterRoles.includes(projects.find(p=>p.id===project)?.role??'');
  const editable=canCapture&&(!active||['DRAFT','RETURNED'].includes(active.workflow_status));
  if(!sessionReady)return <SplashScreen/>;
  return <main>
    <header><button className="brand brand-home" aria-label="Vectra Assure home" disabled={working} onClick={()=>{if(view!=='home')home();else{setConnectionOpen(false);setPassword('');setRecovering(false);clearRecovery();window.scrollTo({top:0});}}}><img className="brand-logo" src="/brand/vectra-assure-logo.png" alt="Vectra Assure" width={210} height={54} fetchPriority="high"/><small>by Vectra Solutions</small></button>{user?<details className="account-menu"><summary>Account</summary><div className="account-actions"><span>Signed in as {user}</span><button className="secondary" disabled={working} onClick={()=>run(loadProjects)}>Refresh projects</button><button className="secondary" disabled={working} onClick={()=>run(async()=>{await changeMode('preview');})}>Preview form</button><button className="secondary" disabled={working} onClick={()=>run(signOut)}>Sign out</button></div></details>:view==='home'&&!connectionOpen?<button className="secondary header-sign-in" disabled={working} onClick={()=>run(()=>openWorkspace('new'))}>Sign in</button>:<span className="pill">Development workspace</span>}</header>
    {view==='home'?<HomeScreen signedIn={!!user} accessOpen={connectionOpen&&mode==='connected'} busy={working} start={()=>run(()=>openWorkspace('new'))} saved={()=>run(()=>openWorkspace('saved'))} preview={()=>run(async()=>{await changeMode('preview');})}/>:mode==='preview'&&<section className="intro"><p className="eyebrow">APPLICATION WORKSPACE</p><h1>Evidence first.<br/>A clearer path to readiness.</h1><p>Capture the application, confirm field findings and see exactly what remains outstanding.</p></section>}
    {(view==='home'?(!!user||connectionOpen||resumeAvailable):(mode==='preview'||!user))&&<section id="workspace-access" className={`connection ${mode==='connected'?(user?'connection-connected':'connection-access'):''}`} aria-label="Workspace connection"><div className="mode"><button disabled={working} className={mode==='preview'?'selected':''} onClick={()=>run(async()=>{await changeMode('preview');})}>Preview form</button><button disabled={working} className={mode==='connected'?'selected':''} onClick={()=>run(async()=>{await changeMode('connected');})}>Connected workspace</button></div>
      {mode==='preview'?<p>Use synthetic examples only. Preview entries are not saved; document uploads are unavailable.</p>:!user&&<form className="login" onSubmit={event=>{event.preventDefault();if(!working&&email&&password&&!recovering)run(signIn);}}><Field label="Email"><input type="email" required autoComplete="username" disabled={working} value={email} onChange={e=>changeEmail(e.target.value)}/></Field>{!recovering&&<><Field label="Password"><input type="password" required autoComplete="current-password" disabled={working} value={password} onChange={e=>setPassword(e.target.value)}/></Field><button type="submit" disabled={working||!email||!password}>Sign in</button></>}<button type="button" className="secondary" disabled={working} onClick={()=>toggleRecovery(!recovering)}>{recovering?'Back to sign in':'Forgot password'}</button></form>}
      {mode==='connected'&&!user&&<p className="hint" role="status">{busy?'Working…':status}</p>}
      {mode==='connected'&&!user&&recovering&&<fieldset aria-label="Password recovery" disabled={working}>
        <h3>Reset your password</h3><p>Request an emailed code for {email||'your account'}. You do not need your current password.</p>
        <button className="secondary" disabled={!email.trim()} onClick={()=>run(sendResetCode)}>{resetSent?'Send a new reset code':'Send reset code'}</button>
        {resetSent&&<><div className="grid">
          <Field label="Password reset code"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={resetCode} onChange={e=>setResetCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></Field>
          <Field label="New password"><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></Field>
        </div><p className="hint">Use 8 to 128 characters. Enter the same new password twice.</p>
        {confirmPassword&&newPassword!==confirmPassword&&<p className="hint">The new passwords do not match.</p>}
        <button disabled={resetCode.length!==6||newPassword.length<8||newPassword.length>128||newPassword!==confirmPassword} onClick={()=>run(resetPassword)}>Set new password</button></>}
      </fieldset>}
      {mode==='connected'&&!user&&verificationNeeded&&<fieldset aria-label="Email verification" disabled={working}><h3>Verify your email</h3><p>Request a code for {email}, then enter it here.</p><button className="secondary" disabled={!email} onClick={()=>run(sendVerification)}>{verificationSent?'Send a new verification code':'Send verification code'}</button>{verificationSent&&<><Field label="Email verification code"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode} onChange={e=>setVerificationCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></Field><button disabled={verificationCode.length!==6} onClick={()=>run(verifyEmail)}>Verify email</button></>}</fieldset>}
      {mode==='connected'&&user&&<div className="grid"><Field label="Project"><select id="project-picker" value={project} disabled={working} onChange={e=>run(()=>selectProject(e.target.value))}><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select></Field><Field label="Existing draft"><select id="draft-picker" value={active?.id??''} disabled={working||!project} onChange={e=>e.target.value?run(()=>loadCase(e.target.value)):newForm()}><option value="">New draft</option>{cases.map(c=><option key={c.id} value={c.id}>{c.reference}</option>)}</select></Field></div>}
    </section>}
    {view==='home'?<>
    {(user||resumeAvailable)&&<section className={`card home-card ${mode==='connected'&&user&&project?'compact-home-actions':''}`} aria-label="Applications"><h2>Applications</h2><p>{mode==='preview'?'Preview forms stay in this tab.':!user?'Sign in above to access your saved drafts.':!project?'Choose a project above to start a form or open a saved draft.':'Start a new form or choose an existing draft above. Saved drafts remain available when you start another form.'}</p>{resumeAvailable&&<p className="hint">{unsaved||pendingDocuments?'Your current form has unsaved changes and is kept in this tab.':active?`Current draft: ${active.reference}`:'Your current form is available to resume.'}</p>}<div className="home-actions">{resumeAvailable&&<button disabled={working} onClick={()=>{setView('capture');window.scrollTo({top:0});}}>Resume form</button>}<button className="secondary" disabled={working||(mode==='connected'&&(!user||!project||!canCapture))} onClick={newForm}>New form</button>{user&&<button className="secondary" disabled={working} onClick={()=>run(signOut)}>Log out</button>}</div></section>}
    {mode==='connected'&&user&&project&&<Dashboard key={project} data={dashboard?.projectId===project?dashboard.data:null} loading={dashboardLoading} error={dashboardError} projectName={projects.find(p=>p.id===project)?.name??'Project'} refresh={()=>setDashboardRevision(value=>value+1)} open={id=>run(()=>loadCase(id))} busy={working}/>}
    </>:null}
    <div hidden={view!=='capture'} className="capture-view">
    <nav className="capture-actions" aria-label="Capture actions"><button className="secondary" disabled={working} onClick={home}>Home</button><button className="secondary" disabled={working||(mode==='connected'&&(!project||!canCapture))} onClick={newForm}>New form</button>{mode==='connected'&&user&&<button aria-label="Save current form" disabled={working||!project||!editable} onClick={()=>run(save)}>Save draft</button>}{user&&<button className="secondary" disabled={working} onClick={()=>run(signOut)}>Log out</button>}</nav>
    <nav className="steps" aria-label="Verification steps">{steps.map((name,i)=><button key={name} className={step===i?'active':''} disabled={working} aria-current={step===i?'step':undefined} onClick={()=>changeStep(i)}><span>{i+1}</span>{name}</button>)}</nav>
    <div className="workspace"><section className="card form-card"><div className="section-heading"><p className="eyebrow">STEP {step+1} OF 4</p><h2>{steps[step]}</h2></div>
      {mode==='connected'&&<Field label="Synthetic case reference"><input value={reference} disabled={working||!!active||!editable} onChange={e=>setReference(e.target.value.toUpperCase())}/></Field>}
      {mode==='connected'&&active&&<div className="capture-state"><span className="tag">{active.reference}</span><span>{active.workflow_status.toLowerCase().replaceAll('_',' ')} · version {active.version}</span><strong>{unsaved?'Unsaved form changes':'Saved form'}</strong></div>}
      {mode==='connected'&&!editable&&active&&<div className="notice"><strong>Application capture is read only</strong><p>Capture changes are allowed for draft and returned applications with an assigned capture role. Evidence and departmental decisions remain with their assigned reviewers.</p></div>}
      <fieldset disabled={working||!editable}>
      {step===0&&<><p className="hint">Applicant information belongs to our team. Departmental eligibility decisions remain with DoHS.</p><div className="grid"><Field label="First names"><input value={form.applicant.firstNames} onChange={e=>applicant('firstNames',e.target.value)}/></Field><Field label="Surname"><input value={form.applicant.surname} onChange={e=>applicant('surname',e.target.value)}/></Field><Field label="South African ID number"><input inputMode="numeric" maxLength={13} value={form.applicant.idNumber} onChange={e=>applicant('idNumber',e.target.value.replace(/\D/g,''))}/></Field><Field label="Contact number"><input type="tel" value={form.applicant.phone} onChange={e=>applicant('phone',e.target.value)}/></Field><Field label="Marital status"><select value={form.applicant.maritalStatus} onChange={e=>applicant('maritalStatus',e.target.value as CaseForm['applicant']['maritalStatus'])}><option value="">Choose status</option><option value="SINGLE">Single</option><option value="MARRIED">Married</option><option value="DIVORCED">Divorced</option><option value="WIDOWED">Widowed</option></select></Field>{form.applicant.maritalStatus==='MARRIED'&&<Field label="Spouse full name"><input value={form.applicant.spouseName} onChange={e=>applicant('spouseName',e.target.value)}/></Field>}</div><div className="checks">{([['disability','Disability declared'],['disaster','Damage / disaster application'],['propertyOwned','Property ownership declared'],['propertySold','Property sale declared']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={form.applicant[key]} onChange={e=>applicant(key,e.target.checked)}/>{label}</label>)}</div>{form.applicant.disaster&&<Field label="Disaster / damage circumstances"><textarea value={form.applicant.disasterDetails} onChange={e=>applicant('disasterDetails',e.target.value)}/></Field>}</>}
      {step===1&&<><Field label="Declared income source"><select value={form.household.incomeSource} onChange={e=>{dirty();setForm(f=>({...f,household:{...f.household,incomeSource:e.target.value as CaseForm['household']['incomeSource']}}))}}><option value="">Choose income source</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><div className="notice"><strong>Evidence follows the declaration</strong><p>{requirementsFor(form).find(r=>['INCOME_PROOF','UNEMPLOYMENT_AFFIDAVIT'].includes(r.kind))?.label ?? 'Select an income source to see the required evidence.'}</p></div><h3>Dependants <small>Up to two entries</small></h3>{form.household.dependants.map((d,i)=><div className="dependant" key={i}><div className="grid"><Field label={`Dependant ${i+1} name`}><input value={d.name} onChange={e=>{dirty();setForm(f=>({...f,household:{...f.household,dependants:f.household.dependants.map((v,n)=>n===i?{...v,name:e.target.value}:v)}}))}}/></Field><Field label="Relationship"><input value={d.relationship} onChange={e=>{dirty();setForm(f=>({...f,household:{...f.household,dependants:f.household.dependants.map((v,n)=>n===i?{...v,relationship:e.target.value}:v)}}))}}/></Field></div><button className="secondary" onClick={()=>{dirty();setForm(f=>({...f,household:{...f.household,dependants:f.household.dependants.filter((_,n)=>n!==i)}}))}}>Remove dependant {i+1}</button></div>)}<button className="secondary" disabled={form.household.dependants.length>=2} onClick={()=>{dirty();setForm(f=>({...f,household:{...f.household,dependants:[...f.household.dependants,{name:'',relationship:''}]}}))}}>+ Add dependant</button><p className="hint">Two dependants with one verified document require DoHS policy review. Age-based exemptions are not applied automatically.</p></>}
      {step===2&&<><PhotoMetadata apply={applyPhoto}/><p className="hint">Check proposed values against the source image. Printed GPS/date overlays still require manual entry.</p><div className="grid"><Field label="House type"><input value={form.site.houseType} placeholder="e.g. mud structure" onChange={e=>site('houseType',e.target.value)}/></Field><Field label="Photograph capture / verification date"><input type="date" value={form.site.verificationDate} onChange={e=>site('verificationDate',e.target.value)}/></Field><Field label="Latitude"><input type="number" step="any" min={-90} max={90} value={form.site.latitude??''} onChange={e=>site('latitude',e.target.value===''?null:Number(e.target.value))}/></Field><Field label="Longitude"><input type="number" step="any" min={-180} max={180} value={form.site.longitude??''} onChange={e=>site('longitude',e.target.value===''?null:Number(e.target.value))}/></Field><Field label="Verified photograph evidence ID"><input value={form.site.photoEvidenceId} placeholder="From the evidence register" onChange={e=>site('photoEvidenceId',e.target.value)}/></Field></div><div className="checks"><label><input type="checkbox" checked={form.site.houseTypeConfirmed} onChange={e=>site('houseTypeConfirmed',e.target.checked)}/>House type confirmed against photograph</label><label><input type="checkbox" checked={form.site.photoParametersConfirmed} onChange={e=>site('photoParametersConfirmed',e.target.checked)}/>GPS and capture date confirmed against photograph</label></div><Field label="Field recommendation and supporting observations"><textarea value={form.site.recommendation} onChange={e=>site('recommendation',e.target.value)}/></Field></>}
      {step===3&&<><p className="hint">A declaration or checkbox does not verify a document. Recorded review, a clean malware scan and validity checks are required.</p><ul className="documents">{requirementsFor(form).map(r=><li key={r.kind}><span className="document-icon">↳</span><span>{r.label}</span><span className="tag">Evidence required</span></li>)}</ul>{(mode==='preview'||!active)&&<div className="notice"><strong>{mode==='preview'?'Uploads are unavailable in preview':'Save the draft before adding evidence'}</strong><p>{mode==='preview'?'Use the connected workspace and save a draft to check document upload availability.':'A saved case is needed to check upload availability and record evidence.'}</p></div>}<h3>DoHS responsibilities</h3><p>Pages 2 and 3; Sections C, E, F and H. Only authorised departmental reviewers may complete these sections.</p><p className="hint">Affidavits, residence proof and bank statements must be no older than three calendar months. SASSA-issued letters and statements are exempt from this age rule.</p></>}
      </fieldset>
      {step===3&&mode==='connected'&&active&&<fieldset disabled={busy}><ReviewWorkspace formVersion={active.version} captureUnsaved={unsaved} captureEditable={editable} onPendingChange={setPendingDocuments} onBusyChange={setDocumentBusy} key={`${project}/${active.id}`} root={`/api/projects/${project}/applications/${active.id}`} role={projects.find(p=>p.id===project)?.role??''} api={api} changed={()=>setReadiness(null)} photo={id=>site('photoEvidenceId',id)} sendFile={sendFile} download={downloadFile} applicant={form.applicant} applyId={applyId}/></fieldset>}
      <div className="form-actions"><button className="secondary" disabled={step===0||working} onClick={()=>changeStep(step-1)}>Back</button>{step<3?<button disabled={working} onClick={()=>step===2?run(openEvidence):changeStep(step+1)}>{step===2&&mode==='connected'&&editable?'Save and open evidence':'Continue →'}</button>:<button disabled={working} onClick={()=>run(assess)}>Check readiness</button>}</div>
    </section><aside><section className="card summary"><p className="eyebrow">CASE SUMMARY</p><h3>{form.applicant.firstNames||form.applicant.surname?`${form.applicant.firstNames} ${form.applicant.surname}`:'New application'}</h3><dl><div><dt>Income</dt><dd>{labels[form.household.incomeSource]??'Not declared'}</dd></div><div><dt>Dependants</dt><dd>{form.household.dependants.length}</dd></div><div><dt>Evidence requirements</dt><dd>{requirementsFor(form).length}</dd></div><div><dt>Our team</dt><dd>{readiness?.ourTeamReady?'Ready':'Outstanding checks'}</dd></div><div><dt>DoHS</dt><dd>{readiness?.departmentalReady?'Ready':'Departmental review'}</dd></div></dl>{mode==='connected'&&<button disabled={working||!project||!editable} onClick={()=>run(save)}>Save draft</button>}<div className="export-actions"><button className="secondary" disabled={working||(mode==='connected'&&!active)} onClick={()=>run(()=>exportPdf(false))}>Export verification summary</button>{mode==='connected'&&<button className="secondary" disabled={working||!active} onClick={()=>run(()=>exportPdf(true))}>Export draft evidence pack</button>}</div><p className="hint">{mode==='preview'?'Preview entries disappear when this page is closed.':'Draft saves use version checks to protect another officer’s changes.'}</p></section>{readiness&&<section className="card readiness"><span className={`status-badge ${readiness.readiness.toLowerCase()}`}>{readiness.readiness==='RED'?'Blockers to resolve':'Review outstanding'}</span><h3>Next actions</h3><ol>{readiness.issues.map(i=><li key={i.code}><span className="owner">{i.owner==='DOHS'?'DoHS':'Our team'}</span>{i.message}</li>)}</ol><p className="hint">Rules are provisional. Submission readiness cannot yet be approved.</p></section>}</aside></div>
    </div>
    {!(mode==='connected'&&!user&&connectionOpen)&&<div className="status" role="status" aria-live="polite">{busy?'Working…':status}</div>}<footer>Vectra Assure by Vectra Solutions · Development build · Synthetic data only</footer>
  </main>;
}

