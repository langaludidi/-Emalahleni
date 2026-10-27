'use client';
import {useEffect,useMemo,useState} from 'react';
import {createAuthClient} from '@neondatabase/auth';
import styles from './smart-capture.module.css';

const AUTH_URL='https://ep-cold-scene-zaa3qek2.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
type Project={id:string;name:string;code:string;role:string};
type Source={id:string;label:string;enabled:boolean};
type ImportRow={id:string;state:string;applicationId:string|null;attemptCount:number;errorCode:string|null};
const captureRoles=new Set(['ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER']);
const statusLabels:Record<string,string>={
 DISCOVERED:'Discovered',QUEUED:'Queued',FETCHING:'Retrieving',QUARANTINED:'Quarantined',
 SCANNING:'Scanning',EXTRACTING:'Extracting',NEEDS_REVIEW:'Needs review',
 VERIFIED:'Verified',COMMITTING:'Saving draft',COMMIT_UNCERTAIN:'Save requires reconciliation',
 COMMITTED:'Draft created',FAILED:'Needs attention',REJECTED:'Rejected',
};
function statusTone(s:string){
 if(s==='COMMITTED')return styles.success;
 if(['FAILED','REJECTED','COMMIT_UNCERTAIN'].includes(s))return styles.error;
 if(['NEEDS_REVIEW','VERIFIED'].includes(s))return styles.warning;
 return styles.neutral;
}
export default function SmartCapturePage(){
 const auth=useMemo(()=>createAuthClient(AUTH_URL),[]);
 const [sessionReady,setSessionReady]=useState(false);
 const [signedIn,setSignedIn]=useState(false);
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectId,setProjectId]=useState('');
 const [sources,setSources]=useState<Source[]>([]);
 const [sourceId,setSourceId]=useState('');
 const [imports,setImports]=useState<ImportRow[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [featureDisabled,setFeatureDisabled]=useState(false);
 const [lastSync,setLastSync]=useState('');
 const [nextPageToken,setNextPageToken]=useState<string|null>(null);
 async function request<T>(url:string,method='GET',payload?:unknown):Promise<T>{
  const tokenResult=await auth.token({fetchOptions:{headers:{'X-Force-Fetch':'true'}}});
  const token=tokenResult.data?.token;
  if(tokenResult.error||!token||token.split('.').length!==3)throw new Error('Sign in again to continue.');
  const res=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  const data=await res.json() as T&{error?:string};
  if(!res.ok)throw new Error(data.error||'Request failed');
  return data;
 }
 useEffect(()=>{
  let active=true;
  auth.getSession().then(async result=>{
   if(!active)return;
   const signed=!!result.data?.user;
   setSignedIn(signed);
   if(!signed)return;
   try{
    const data=await request<{projects:Project[]}>('/api/projects');
    if(active){setProjects(data.projects);setProjectId(data.projects[0]?.id||'');}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Unable to load projects');}
  }).catch(()=>{if(active)setError('Unable to establish your session');}).finally(()=>{if(active)setSessionReady(true);});
  return()=>{active=false};
 },[auth]);
 useEffect(()=>{
  if(!projectId)return;
  let active=true;
  setSources([]);setSourceId('');setImports([]);setFeatureDisabled(false);setError('');setNextPageToken(null);
  const root=`/api/projects/${projectId}/smart-capture`;
  Promise.all([request<{sources:Source[]}>(root+'/sources'),request<{imports:ImportRow[]}>(root+'/imports')])
  .then(([sourceData,importData])=>{
   if(!active)return;
   setSources(sourceData.sources);setSourceId(sourceData.sources.find(s=>s.enabled)?.id||'');
   setImports(importData.imports);
  }).catch(e=>{
   if(!active)return;
   const msg=e instanceof Error?e.message:'Unable to load Smart Capture';
   if(msg==='SMART_CAPTURE_NOT_ENABLED')setFeatureDisabled(true);
   else setError(msg);
  });
  return()=>{active=false};
 },[projectId]);
 async function refresh(){
  if(!projectId)return;
  setBusy(true);setError('');
  try{const data=await request<{imports:ImportRow[]}>(`/api/projects/${projectId}/smart-capture/imports`);setImports(data.imports);}
  catch(e){setError(e instanceof Error?e.message:'Unable to refresh');}
  finally{setBusy(false);}
 }
 async function processSingle(importId:string){
  if(!projectId||busy)return;
  setBusy(true);setError('');setLastSync('');
  try{
   const result=await request<{state:string}>(`/api/projects/${projectId}/smart-capture/imports/${importId}/process`,'POST');
   setLastSync(`Processing finished with state ${result.state}. Human verification is required before a case is created.`);
   const current=await request<{imports:ImportRow[]}>(`/api/projects/${projectId}/smart-capture/imports`);
   setImports(current.imports);
  }catch(e){setError(e instanceof Error?e.message:'Processing unavailable');}
  finally{setBusy(false);}
 }
 async function retrySingle(importId:string){
  if(!projectId||busy)return;
  setBusy(true);setError('');setLastSync('');
  try{
   await request(`/api/projects/${projectId}/smart-capture/imports/${importId}/retry`,'POST');
   setLastSync('Transient failure reset. Select Process PDF to retry; no automatic retry has started.');
   const current=await request<{imports:ImportRow[]}>(`/api/projects/${projectId}/smart-capture/imports`);
   setImports(current.imports);
  }catch(e){setError(e instanceof Error?e.message:'Retry was not permitted');}
  finally{setBusy(false);}
 }
 async function sync(){
  if(!projectId||!sourceId||busy)return;
  setBusy(true);setError('');setLastSync('');
  try{
   const result=await request<{discovered:number;newImports:number;hasMore:boolean;nextPageToken:string|null}>(`/api/projects/${projectId}/smart-capture/sources/${sourceId}/sync`,'POST',{pageToken:nextPageToken});
   setNextPageToken(result.nextPageToken);
   setLastSync(`Found ${result.discovered} PDFs in this batch; ${result.newImports} new import entries.${result.hasMore?' Select Continue synchronisation to load the next batch.':''}`);
   const current=await request<{imports:ImportRow[]}>(`/api/projects/${projectId}/smart-capture/imports`);
   setImports(current.imports);
  }catch(e){setError(e instanceof Error?e.message:'Sync failed');}
  finally{setBusy(false);}
 }
 const counts={total:imports.length,needsReview:imports.filter(i=>i.state==='NEEDS_REVIEW').length,
  completed:imports.filter(i=>i.state==='COMMITTED').length,exceptions:imports.filter(i=>['FAILED','COMMIT_UNCERTAIN'].includes(i.state)).length};
 const activeProject=projects.find(p=>p.id===projectId);
 return <main className={styles.main}>
  <header className={styles.header}>
   <a href="/" aria-label="Return to VectraSA home"><img src="/brand/vectra-assure-logo.png" width={174} height={48} alt="Vectra Assure"/></a>
   <a className={styles.link} href="/">← Back to main workspace</a>
  </header>
  <div className={styles.top}>
   <div><p className={styles.eyebrow}>APPLICATION & EVIDENCE WORKSPACE</p><h1>Smart Capture</h1><p>Discover scanned beneficiary application packs and prepare them for controlled verification.</p></div>
   <span className={styles.tag}>Development · Human review required</span>
  </div>
  {!sessionReady?<div role="status" className={styles.notice}>Checking your sign-in…</div>:
   !signedIn?<div className={styles.notice}><strong>Sign-in required.</strong> Open the main VectraSA workspace and sign in with your assigned project account. <a href="/">Go to sign-in</a></div>:
   !projects.length?<div className={styles.notice}>Your account has no assigned projects. Contact your project administrator.</div>:
   <>
    <section className={styles.controls} aria-label="Project and document source">
     <label>Project<select value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option value={p.id} key={p.id}>{p.name} ({p.code})</option>)}</select></label>
     <label>Google Drive source<select value={sourceId} onChange={e=>{setSourceId(e.target.value);setNextPageToken(null);}} disabled={!sources.length}>{!sources.length&&<option value="">No configured sources</option>}{sources.map(s=><option key={s.id} value={s.id} disabled={!s.enabled}>{s.label}{!s.enabled?' (disabled)':''}</option>)}</select></label>
     <button type="button" disabled={busy||!sourceId||featureDisabled||!captureRoles.has(activeProject?.role??'')} onClick={sync}>{busy?'Working…':nextPageToken?'Continue synchronisation':'Synchronise Drive'}</button>
    </section>
    {featureDisabled&&<div className={styles.notice} role="status"><strong>Smart Capture is not activated.</strong> The feature requires approved database migrations, Google Drive credentials and a separate real-data security review. Existing VectraSA capture remains available.</div>}
    {error&&<div className={styles.failure} role="alert">{error}</div>}
    {lastSync&&<div className={styles.notice} role="status">{lastSync}</div>}
    <section className={styles.stats} aria-label="Current import summary">
     {([['Recent import entries',counts.total],['Needs review',counts.needsReview],['Drafts created',counts.completed],['Exceptions',counts.exceptions]] as const).map(([label,value])=><div key={label} className={styles.stat}><strong>{value}</strong><span>{label}</span></div>)}
    </section>
    <section className={styles.card}>
     <div className={styles.cardHeader}><div><h2>Import queue</h2><p>Showing up to 50 recent project-scoped import entries. Full project totals require paginated reporting.</p></div><button className={styles.secondary} disabled={busy||featureDisabled} onClick={refresh}>Refresh</button></div>
     <div className={styles.tablewrap}><table><thead><tr><th>Import</th><th>Status</th><th>Attempts</th><th>Application</th><th>Exception</th><th>Action</th></tr></thead><tbody>{imports.map(item=><tr key={item.id}><td><code>{item.id.slice(0,8)}…</code></td><td><span className={`${styles.status} ${statusTone(item.state)}`}>{statusLabels[item.state]??item.state}</span></td><td>{item.attemptCount}</td><td>{item.applicationId?<a href="/">View in VectraSA</a>:'—'}</td><td>{item.errorCode??'—'}</td><td>{item.state==='DISCOVERED'&&captureRoles.has(activeProject?.role??'')?<button className={styles.secondary} disabled={busy} onClick={()=>processSingle(item.id)}>Process PDF</button>:item.state==='NEEDS_REVIEW'?<a href={`/smart-capture/review/?project=${projectId}&import=${item.id}`}>Verify application →</a>:item.state==='FAILED'&&item.attemptCount<3?<button className={styles.secondary} disabled={busy} onClick={()=>retrySingle(item.id)}>Retry eligible failure</button>:'—'}</td></tr>)}{!imports.length&&<tr><td colSpan={6} className={styles.empty}>No import entries are available for this project. The queue will appear here after an authorised source synchronisation.</td></tr>}</tbody></table></div>
    </section>
    <p className={styles.footnote}>Smart Capture does not automatically approve applications, evidence or DoHS sections. Source documents are private. The current repository remains restricted to synthetic-data development until release gates are closed.</p>
   </>}
 </main>;
}
