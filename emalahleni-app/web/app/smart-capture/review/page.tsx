'use client';
import {useEffect,useMemo,useState} from 'react';
import {createAuthClient} from '@neondatabase/auth';
import type {ExtractionProposal} from '../../../../src/smart-capture-proposal';
import styles from './review.module.css';

const AUTH_URL='https://ep-cold-scene-zaa3qek2.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
const applicantTextFields=['firstNames','surname','idNumber','phone','spouseName','disasterDetails'] as const;
const applicantBooleans=['disability','disaster','propertyOwned','propertySold'] as const;
const display:Record<string,string>={firstNames:'First names',surname:'Surname',idNumber:'Identity number',phone:'Contact number',
 spouseName:'Spouse name',disasterDetails:'Disaster details',maritalStatus:'Marital status',
 disability:'Disability declared',disaster:'Disaster declared',propertyOwned:'Property owned',propertySold:'Property sold',
 incomeSource:'Declared income source',dependants:'Household dependants'};
type Payload={id:string;projectId:string;state:string;version:number;proposal:ExtractionProposal;applicationId:string|null};

export default function SmartCaptureReview(){
 const auth=useMemo(()=>createAuthClient(AUTH_URL),[]);
 const [project,setProject]=useState(''),[importId,setImportId]=useState('');
 const [data,setData]=useState<Payload|null>(null),[proposal,setProposal]=useState<ExtractionProposal|null>(null);
 const [checked,setChecked]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [pdfUrl,setPdfUrl]=useState(''),[page,setPage]=useState(1),[sessionReady,setSessionReady]=useState(false);
 async function token(){
  const result=await auth.token({fetchOptions:{headers:{'X-Force-Fetch':'true'}}});
  if(result.error||!result.data?.token)throw new Error('Please sign in to your VectraSA account again.');
  return result.data.token;
 }
 async function call<T>(path:string,method='GET',input?:unknown):Promise<T>{
  const bearer=await token();
  const response=await fetch(path,{method,headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},
   ...(input===undefined?{}:{body:JSON.stringify(input)})});
  const result=await response.json() as {error?:string}&T;
  if(!response.ok)throw new Error(result.error??'Request failed');
  return result;
 }
 useEffect(()=>{
  const query=new URLSearchParams(window.location.search);
  const p=query.get('project')||'',i=query.get('import')||'';
  setProject(p);setImportId(i);
  setSessionReady(true);
 },[]);
 const root=project&&importId?`/api/projects/${project}/smart-capture/imports/${importId}`:'';
 useEffect(()=>{
  if(!root)return;
  let live=true,blobUrl='';
  setBusy(true);setError('');setSuccess('');setData(null);setProposal(null);setChecked([]);setPdfUrl('');setPage(1);
  (async()=>{
   try{
    const result=await call<Payload>(root+'/proposal');
    if(live){setData(result);setProposal(result.proposal);}
    const bearer=await token();
    const pdf=await fetch(root+'/pdf',{headers:{Authorization:`Bearer ${bearer}`}});
    if(pdf.ok){const blob=await pdf.blob();if(blob.type==='application/pdf'&&live){blobUrl=URL.createObjectURL(blob);setPdfUrl(blobUrl);}}
   }catch(e){if(live)setError(e instanceof Error?e.message:'Unable to open import');}
   finally{if(live)setBusy(false);}
  })();
  return()=>{live=false;if(blobUrl)URL.revokeObjectURL(blobUrl);};
 },[root]);
 function changeApplicant(key:keyof ExtractionProposal['applicant'],value:string|boolean|null){
  setProposal(current=>current?{...current,applicant:{...current.applicant,[key]:value}}:null);
  setChecked(current=>current.filter(field=>field!=='applicant.'+key));
  setSuccess('');
 }
 function changeHousehold(key:keyof ExtractionProposal['household'],value:unknown){
  setProposal(current=>current?{...current,household:{...current.household,[key]:value}}:null);
  setChecked(current=>current.filter(field=>field!=='household.'+key));
  setSuccess('');
 }
 function acknowledge(key:string,verified:boolean){
  setChecked(current=>verified?[...new Set([...current,key])]:current.filter(k=>k!==key));
 }
 function renderCheck(field:string){
  return <label className={styles.check}><input type="checkbox" checked={checked.includes(field)}
   onChange={e=>acknowledge(field,e.target.checked)}/>Checked against PDF</label>;
 }
 async function save(){
  if(!root||!data||!proposal)return;
  setBusy(true);setError('');setSuccess('');
  try{
   const result=await call<{version:number}>(root+'/proposal','PUT',{version:data.version,proposal});
   setData(d=>d?{...d,version:result.version,proposal}:null);
   setChecked([]);
   setSuccess('Corrections saved securely. No VectraSA case has been created.');
  }catch(e){setError(e instanceof Error?e.message:'Review save failed');}
  finally{setBusy(false);}
 }
 async function confirm(){
  if(!root||!data||!proposal)return;
  if(!pdfUrl){setError('The original PDF must be available for comparison before a draft can be created.');return;}
  if(JSON.stringify(data.proposal)!==JSON.stringify(proposal)){setError('Save your corrections before creating the draft.');return;}
  if(!window.confirm('Confirm that you checked the selected values against the original PDF? This will create a DRAFT application, not approve the beneficiary.'))return;
  setBusy(true);setError('');setSuccess('');
  try{
   const result=await call<{applicationId:string;state:string}>(root+'/confirm','POST',{version:data.version,confirmedFields:checked});
   setData(d=>d?{...d,state:result.state,applicationId:result.applicationId}:null);
   setSuccess('VectraSA draft created. Assessor and departmental reviews are still required.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to confirm draft');}
  finally{setBusy(false);}
 }
 const conflicts=Object.entries(proposal?.provenance??{}).filter(([,v])=>v.state==='CONFLICT'||v.state==='UNREADABLE');
 return <main className={styles.main}>
  <header className={styles.header}><a href="/smart-capture/">← Import queue</a><strong>VectraSA · Smart Capture</strong><span>Reviewer workspace</span></header>
  <section className={styles.heading}><div><h1>Verify application</h1><p>Compare each extracted answer against the original scanned document. Unverified information is not applied automatically.</p></div><span className={styles.badge}>{data?.state??'Loading'}</span></section>
  {!sessionReady?<p>Opening workspace…</p>:!root?<div role="alert" className={styles.alert}>No import was selected. Open a record from the Smart Capture queue.</div>:
  <>
   {error&&<div role="alert" className={styles.alert}>{error}</div>}
   {success&&<div role="status" className={styles.notice}>{success}</div>}
   <div className={styles.columns}>
    <section className={styles.pdf}>
     <div className={styles.panelHead}><h2>Original beneficiary PDF</h2><label>Go to page <input type="number" min="1" max="2000" value={page} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/></label></div>
     {pdfUrl?<iframe title="Private application PDF preview" src={pdfUrl+'#page='+page+'&toolbar=0'} className={styles.viewer}/>:
      <div className={styles.placeholder}>Private PDF preview is unavailable until the document has passed security screening and the import is ready for review.</div>}
    </section>
    <section className={styles.form}>
     <div className={styles.panelHead}><h2>Extracted information</h2><span className={styles.minor}>Version {data?.version??'–'}</span></div>
     {!proposal?<div className={styles.placeholder}>{busy?'Loading encrypted proposal…':'No extraction proposal is available.'}</div>:
     <div className={styles.fields}>
      <h3>Applicant</h3>
      {applicantTextFields.map(key=><div key={key} className={styles.field}><label htmlFor={key}>{display[key]}</label>
       <input id={key} type="text" maxLength={key==='disasterDetails'?1500:key==='phone'?30:250}
        value={proposal.applicant[key]??''} onChange={e=>changeApplicant(key,e.target.value||null)}/>
       {renderCheck('applicant.'+key)}
       {proposal.provenance['applicant.'+key]&&<small>Source page {proposal.provenance['applicant.'+key].page}</small>}
      </div>)}
      <div className={styles.field}><label htmlFor="marital">Marital status</label><select id="marital"
        value={proposal.applicant.maritalStatus??''}
        onChange={e=>changeApplicant('maritalStatus',(e.target.value||null) as ExtractionProposal['applicant']['maritalStatus'])}>
        <option value="">Unresolved</option>{['SINGLE','MARRIED','DIVORCED','WIDOWED'].map(k=><option key={k} value={k}>{k}</option>)}</select>
       {renderCheck('applicant.maritalStatus')}</div>
      {applicantBooleans.map(key=><div className={styles.field} key={key}><label htmlFor={key}>{display[key]}</label>
       <select id={key} value={proposal.applicant[key]===null?'':String(proposal.applicant[key])}
        onChange={e=>changeApplicant(key,e.target.value===''?null:e.target.value==='true')}>
        <option value="">Unresolved</option><option value="true">Yes</option><option value="false">No</option></select>
       {renderCheck('applicant.'+key)}
      </div>)}
      <h3>Household & income</h3>
      <div className={styles.field}><label htmlFor="income">Income source</label>
       <select id="income" value={proposal.household.incomeSource??''}
        onChange={e=>changeHousehold('incomeSource',e.target.value||null)}>
        <option value="">Unresolved</option>{['UNEMPLOYED','SOCIAL_GRANT','EMPLOYED','SELF_EMPLOYED','PENSION','OTHER'].map(k=><option key={k} value={k}>{k}</option>)}</select>
       {renderCheck('household.incomeSource')}</div>
      <div className={styles.field}><label>Dependants ({proposal.household.dependants.length})</label>
       {proposal.household.dependants.length>2&&<strong className={styles.warn}>More than two dependants: the existing VectraSA form needs an approved schema change. Do not remove people just to proceed.</strong>}
       {proposal.household.dependants.map((dep,i)=><div className={styles.dependant} key={i}>
        <input value={dep.name} aria-label={`Dependant ${i+1} name`} onChange={e=>changeHousehold('dependants',proposal.household.dependants.map((d,n)=>n===i?{...d,name:e.target.value}:d))}/>
        <input value={dep.relationship} aria-label={`Dependant ${i+1} relationship`} onChange={e=>changeHousehold('dependants',proposal.household.dependants.map((d,n)=>n===i?{...d,relationship:e.target.value}:d))}/>
       </div>)}
       {renderCheck('household.dependants')}</div>
      <h3>Supporting-document page suggestions</h3>
      <p className={styles.minor}>Automated classification is preliminary. Every supporting document must be checked and verified separately in the main VectraSA evidence workflow.</p>
      {proposal.sections.length===0?<p className={styles.minor}>No page classification is available.</p>:
       proposal.sections.map((section,index)=><div className={styles.conflict} key={index}>
        <span>{section.type.replaceAll('_',' ')} · Page {section.fromPage}{section.toPage!==section.fromPage?'–'+section.toPage:''} · {section.status}</span>
        <button className={styles.secondary} onClick={()=>setPage(section.fromPage)}>View page</button>
       </div>)}
      {Object.keys(proposal.extraFields).length>0&&<div className={styles.notice}><h3>Information outside current VectraSA fields</h3>
       {Object.entries(proposal.extraFields).map(([name,value])=><p key={name}><strong>{name}:</strong> {value}</p>)}
       <p>These fields remain with the encrypted import proposal, not the beneficiary form.</p>
       {renderCheck('__extraFieldsReviewed')}</div>}
      {!!conflicts.length&&<div className={styles.alert}><h3>Unresolved source conflicts</h3>{conflicts.map(([key,value])=><div key={key} className={styles.conflict}>
       <span>{key} · Page {value.page}</span>
       <button disabled={busy} className={styles.secondary} onClick={()=>setProposal(p=>p?{...p,provenance:{...p.provenance,[key]:{...value,state:'CONFIRMED'}}}:p)}>Mark checked against PDF</button>
      </div>)}</div>}
      <div className={styles.actions}><button className={styles.secondary} disabled={busy||data?.state!=='NEEDS_REVIEW'} onClick={save}>Save corrections</button>
       <button disabled={busy||!pdfUrl||data?.state!=='NEEDS_REVIEW'} onClick={confirm}>Create VectraSA draft</button>
      </div>
      {data?.applicationId&&<div className={styles.notice}>Draft linked: <code>{data.applicationId}</code>. Continue assessment from the main <a href="/">VectraSA workspace</a>.</div>}
     </div>}
    </section>
   </div>
   <p className={styles.disclaimer}>AI results are suggestions. Saving corrections does not certify supporting documents. Draft creation cannot complete DoHS review or approve readiness.</p>
  </>}
 </main>;
}
