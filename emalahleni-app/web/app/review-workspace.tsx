'use client';
import { useEffect,useRef,useState } from 'react';
import { evidenceKinds,subtypes,MAX_UPLOAD,evidenceWriterRoles,scanFailureReasons } from '../../src/evidence-contracts';
import { dohsSections } from '../../src/contracts';
import {idFieldsSchema,type IdFields,type IdReading} from '../../src/id-reading';
import IdProposal from './id-proposal';
type Api=(path:string,method?:string,data?:unknown)=>Promise<any>;
interface Props { root:string;role:string;api:Api;sendFile:(path:string,bytes:ArrayBuffer,type:string)=>Promise<any>;download:(path:string,filename:string)=>Promise<void>;changed:()=>void;photo:(id:string)=>void;applicant:IdFields;applyId:(fields:Partial<IdFields>)=>void; }
type Document={id:string;kind:string;filename:string;status:string;malware_status:string;reviewed_by:string|null;document_date:string|null;document_subtype:string|null};
type Department={section:string;state:string;note:string;reviewed_at:string};
const label=(s:string)=>s.toLowerCase().replaceAll('_',' ');
function scanFailureMessage(value:unknown){const reason=scanFailureReasons.find(code=>code===value)??'UNKNOWN';return `Scan failed (${reason}). The file remains quarantined. Use Retry scan; if it fails again, report this code.`;}
export default function ReviewWorkspace({root,role,api,sendFile,download,changed,photo,applicant,applyId}:Props){
 const [documents,setDocuments]=useState<Document[]>([]),[reviews,setReviews]=useState<Department[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [evidenceState,setEvidenceState]=useState<'loading'|'ready'|'error'>('loading'),[departmentState,setDepartmentState]=useState<'loading'|'ready'|'error'>('loading');
 const [uploadsEnabled,setUploadsEnabled]=useState<boolean|null>(null),[uploadMessage,setUploadMessage]=useState(''),[uploadError,setUploadError]=useState(false);
 const [idReadingEnabled,setIdReadingEnabled]=useState<boolean|null>(null),[idDocument,setIdDocument]=useState(''),[idProposal,setIdProposal]=useState<IdReading|null>(null),[idMessage,setIdMessage]=useState(''),[idError,setIdError]=useState(false);
 const [serviceMessage,setServiceMessage]=useState(''),[serviceError,setServiceError]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const [kind,setKind]=useState<string>('APPLICANT_ID'),[ordinal,setOrdinal]=useState('1'),[file,setFile]=useState<File|null>(null);
 const [selected,setSelected]=useState<string>(''),[decision,setDecision]=useState('VERIFIED'),[subtype,setSubtype]=useState('ID_COPY'),[date,setDate]=useState(''),[note,setNote]=useState(''),[certified,setCertified]=useState(false),[confirmed,setConfirmed]=useState(false);
 const [section,setSection]=useState<string>('PAGE_2'),[state,setState]=useState('PENDING'),[departmentNote,setDepartmentNote]=useState('');
 const canUpload=evidenceWriterRoles.includes(role),canReview=['ADMIN','ASSESSOR'].includes(role);
 const idDocuments=documents.filter(document=>document.kind==='APPLICANT_ID'&&document.malware_status==='CLEAN'&&['PENDING_REVIEW','VERIFIED'].includes(document.status));
 const selectedId=idDocuments.find(document=>document.id===idDocument)?.id??idDocuments[0]?.id??'';
 async function refresh(current=()=>true){
  setEvidenceState('loading');setDepartmentState('loading');setUploadsEnabled(null);setIdReadingEnabled(null);setIdProposal(null);
  const [e,d]=await Promise.allSettled([api(root+'/evidence'),api(root+'/dohs')]);if(!current())return false;
  if(e.status==='fulfilled'){setDocuments(e.value.evidence);setEvidenceState('ready');setUploadsEnabled(typeof e.value.uploads?.enabled==='boolean'?e.value.uploads.enabled:null);setIdReadingEnabled(typeof e.value.idReading?.enabled==='boolean'?e.value.idReading.enabled:null);}else{setEvidenceState('error');setUploadsEnabled(null);setIdReadingEnabled(null);}
  if(d.status==='fulfilled'){setReviews(d.value.reviews);setDepartmentState('ready');}else setDepartmentState('error');
  return e.status==='fulfilled';
 }
 async function run(task:()=>Promise<void>){setBusy(true);try{await task();}catch(e){setMessage(e instanceof Error?e.message:'Unable to complete action.');}finally{setBusy(false);}}
 useEffect(()=>{let current=true;setDocuments([]);setReviews([]);setSelected('');setMessage('');setUploadMessage('');setUploadError(false);setNote('');setDepartmentNote('');setSection('PAGE_2');setState('PENDING');setFile(null);if(fileInput.current)fileInput.current.value='';setCertified(false);setConfirmed(false);void refresh(()=>current);return()=>{current=false};},[root]);
 function chooseSection(value:string){setSection(value);const prior=reviews.find(r=>r.section===value);setState(prior?.state??'PENDING');setDepartmentNote(prior?.note??'');}
 async function checkDocumentService(){
  setBusy(true);setServiceError(false);setServiceMessage('Checking the private scanner and ID reader with a synthetic document. This can take a few minutes.');
  try{const result=await api(root+'/document-service-check','POST');if(result.status!=='ready')throw new Error('DOCUMENT_SERVICE_NOT_READY');setServiceMessage(result.uploadsEnabled&&result.idReadingEnabled?'The scanner and ID reader passed their synthetic checks.':'The scanner and ID reader passed their synthetic checks. Uploads and ID reading are awaiting activation.');}
  catch(error){
   setServiceError(true);const code=error instanceof Error?error.message:'';
   const messages:Record<string,string>={
    UNAUTHENTICATED:'Your sign-in session could not be verified. Sign out, sign in again and retry the document-service check.',
    EVIDENCE_ACTION_DENIED:'Your account does not have permission to check the document service for this saved case.',
    ACCESS_DENIED:'Your account could not access this saved case. Please report this case-access message.',
    SERVICE_UNAVAILABLE:'The application could not complete the document-service check. Please report this application-check message.',
    DOCUMENT_SERVICE_NOT_CONFIGURED:'The private document service is not connected yet.',
    'DOCUMENT_SERVICE_NOT_READY:STARTUP':'The scanner could not start. Please report this startup message.',
    'DOCUMENT_SERVICE_NOT_READY:STARTUP_CONFIGURATION':'Cloudflare has not enabled the scanner runtime correctly. Please report this configuration message.',
    'DOCUMENT_SERVICE_NOT_READY:STARTUP_INSTANCE':'Cloudflare could not start a scanner instance. Please report this instance message.',
    'DOCUMENT_SERVICE_NOT_READY:STARTUP_PORT':'The scanner did not become ready within 90 seconds. Please report this startup-timeout message.',
    'DOCUMENT_SERVICE_NOT_READY:STARTUP_EXIT':'The scanner stopped while starting. Please report this stopped-scanner message.',
    'DOCUMENT_SERVICE_NOT_READY:STARTUP_RPC':'The scanner startup request could not be handled. Please report this startup-request message.',
    'DOCUMENT_SERVICE_NOT_READY:CONNECTION':'The scanner started but could not be reached. Please report this connection message.',
    'DOCUMENT_SERVICE_NOT_READY:CREDENTIALS':'The scanner rejected the service connection. Please report this connection message.',
    'DOCUMENT_SERVICE_NOT_READY:HEALTH':'The scanner or ID reader is not ready. Please report this health-check message.',
    'DOCUMENT_SERVICE_NOT_READY:SCAN':'The synthetic document did not pass the scan check. Please report this scan-check message.',
    'DOCUMENT_SERVICE_NOT_READY:ID_READING':'The scan passed, but the synthetic ID could not be read. Please report this ID-reading message.',
    'DOCUMENT_SERVICE_NOT_READY:ID_VALIDATION':'The scan and reading completed, but the synthetic ID details did not match. Please report this ID-details message.',
   };
   setServiceMessage(messages[code]??'The document-service check could not complete. Please report this check message.');
  }
  finally{setBusy(false);}
 }
 async function readIdentity(){
  setBusy(true);setIdError(false);setIdProposal(null);setIdMessage('Reading the applicant ID. This may take up to two minutes.');
  try{
   if(idReadingEnabled!==true||!selectedId)throw new Error('Upload a readable applicant ID and wait for a clean scan first.');
   const proposal:IdReading=await api(root+`/evidence/${selectedId}/read-id`,'POST');
   if(proposal.evidenceId!==selectedId||proposal.requiresConfirmation!==true)throw new Error('The ID reading response could not be confirmed.');
   idFieldsSchema.parse(proposal.fields);setIdProposal(proposal);setIdMessage('Review the proposed details below before applying them.');
  }catch(error){
   const code=error instanceof Error?error.message:'';setIdError(true);if(code==='ID_READING_NOT_CONFIGURED')setIdReadingEnabled(false);
   setIdMessage(code==='ID_READING_NOT_CONFIGURED'?'ID reading is unavailable until the private document service is connected.':code==='ID_READING_FILE_REJECTED'?'The scanner rejected this file. Its ID details cannot be used. Refresh the register to see its status.':code==='CLEAN_APPLICANT_ID_REQUIRED'?'Choose an applicant ID that has passed its malware scan.':code==='ID_READING_STATE_CHANGED'?'The document or your project access changed while reading. Refresh the register before trying again.':'Unable to read ID details. Try again when the service is ready, or enter the details manually.');
   if(code==='ID_READING_FILE_REJECTED'){changed();await refresh();}
  }finally{setBusy(false);}
 }
 async function uploadFile(){
  setBusy(true);setUploadError(false);setUploadMessage('Uploading and checking the file. Please keep this form open.');
  try{
   if(uploadsEnabled!==true)throw new Error('DOCUMENT_UPLOADS_NOT_CONFIGURED');
   if(!file)throw new Error('Choose a PDF, JPEG or PNG first.');if(file.size>MAX_UPLOAD)throw new Error('The maximum file size is 5 MB.');
   const bytes=await file.arrayBuffer();const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const intent=await api(root+'/evidence','POST',{kind,filename:file.name,contentType:file.type,size:file.size,sha256,dependantOrdinal:kind==='DEPENDANT_ID_OR_BIRTH_CERT'?Number(ordinal):null});
   const result=await sendFile(intent.uploadPath,bytes,file.type);setFile(null);if(fileInput.current)fileInput.current.value='';changed();
   const outcome=result.malware_status==='CLEAN'?'Uploaded and scanned. Assessor review is still required.':result.malware_status==='INFECTED'?'The scanner rejected this file. It remains quarantined.':scanFailureMessage(result.scanFailure);
   setUploadError(result.malware_status!=='CLEAN');
   setUploadMessage(outcome);
   if(!await refresh())setUploadMessage(outcome+' The register could not refresh. Use Refresh evidence and reviews to check the saved document.');
  }catch(e){
   setUploadError(true);const detail=e instanceof Error?e.message:'Unable to complete the upload.';
   if(detail==='DOCUMENT_UPLOADS_NOT_CONFIGURED'){setUploadsEnabled(false);setUploadMessage('Upload blocked. Document uploads are unavailable until the scanning service is connected. This file has not been uploaded.');}
   else setUploadMessage('Upload could not be confirmed. '+detail+' Refresh the evidence register before trying again.');
  }finally{setBusy(false);}
 }
 return <section className="review-workspace" aria-label="Evidence and departmental workspace">
  <h3>Evidence register</h3><p className="hint">Upload → malware scan → assessor review. A clean scan alone does not verify a document.</p>
  {canUpload&&<><button className="secondary" disabled={busy} onClick={()=>void checkDocumentService()}>Check document service</button><p className="hint upload-feedback" role={serviceError?'alert':'status'} aria-live="polite">{serviceMessage}</p></>}
  <button className="secondary" disabled={busy||evidenceState==='loading'} onClick={()=>run(async()=>{await refresh();})}>Refresh evidence and reviews</button>
  {evidenceState==='loading'&&<p className="hint" role="status">Loading recorded evidence…</p>}
  {evidenceState==='error'&&<p className="hint" role="alert">Unable to load recorded evidence. Refresh to check whether a document is saved.</p>}
  <ul className="evidence-register">{documents.map(d=><li key={d.id}><strong>{d.filename}</strong><span>{label(d.kind)} · {label(d.status)} · {label(d.malware_status)}</span><div className="row-actions">{d.malware_status==='CLEAN'&&<button className="secondary" disabled={busy} onClick={()=>run(()=>download(root+`/evidence/${d.id}/download`,d.filename))}>Download</button>}{d.status==='PENDING_SCAN'&&canUpload&&<button disabled={busy||uploadsEnabled!==true} onClick={()=>run(async()=>{const result=await api(root+`/evidence/${d.id}/scan`,'POST');changed();await refresh();setUploadError(result.malware_status!=='CLEAN');setUploadMessage(result.malware_status==='CLEAN'?'Scanned successfully. Assessor review is still required.':result.malware_status==='INFECTED'?'The scanner rejected this file. It remains quarantined.':scanFailureMessage(result.scanFailure));})}>Retry scan</button>}{d.kind==='SITE_PHOTO'&&d.status==='VERIFIED'&&canUpload&&<button className="secondary" onClick={()=>{photo(d.id);setMessage('Photograph linked to the form. Save the draft to record it.');}}>Use as site photograph</button>}</div></li>)}</ul>{evidenceState==='ready'&&!documents.length&&<p className="hint">No documents recorded for this case.</p>}
  {canUpload&&<fieldset aria-label="Upload evidence" disabled={busy||uploadsEnabled!==true}><h3>Upload evidence</h3>
   {uploadsEnabled!==true&&<div className="notice" role="status"><strong>{evidenceState==='loading'?'Checking upload availability…':uploadsEnabled===false?'Document uploads are unavailable':'Upload availability could not be confirmed'}</strong><p>{uploadsEnabled===false?'The document scanning service must be connected before uploads can be accepted. Choosing a file on your device does not add it to the case.':'Use Refresh evidence and reviews to check availability before choosing a file.'}</p></div>}
   <p className="hint">Upload the file to add it to this case. After a clean scan, use Read ID details to review suggestions for the applicant form.</p>
   <div className="grid"><label className="field"><span>Document purpose</span><select value={kind} onChange={e=>setKind(e.target.value)}>{evidenceKinds.map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label>{kind==='DEPENDANT_ID_OR_BIRTH_CERT'&&<label className="field"><span>Dependant</span><select value={ordinal} onChange={e=>setOrdinal(e.target.value)}><option value="1">Dependant 1</option><option value="2">Dependant 2</option></select></label>}<label className="field"><span>File · PDF, JPEG or PNG · maximum 5 MB</span><input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>{setFile(e.target.files?.[0]??null);setUploadMessage('');setUploadError(false);}}/></label></div>
   {file&&!uploadMessage&&uploadsEnabled===true&&<p className="hint selected-file" role="status">Selected: {file.name}. Not uploaded yet. Press Upload and scan to add it to the case.</p>}
   <button disabled={!file} onClick={()=>void uploadFile()}>Upload and scan</button>
   <p className="hint upload-feedback" role={uploadError?'alert':'status'} aria-live="polite">{uploadMessage}</p>
  </fieldset>}
  {canUpload&&<section className="id-reading" aria-label="Applicant ID reading"><h3>Read applicant ID details</h3>
   <p className="hint">Read names, surname and the ID number from a scanned applicant ID. Review the suggestions before applying them to this form.</p>
   {idReadingEnabled!==true&&<p className="hint" role="status">{evidenceState==='loading'?'Checking ID reading availability…':idReadingEnabled===false?'ID reading is unavailable until the private document service is connected.':'ID reading availability could not be confirmed. Refresh the evidence register.'}</p>}
   {idReadingEnabled===true&&!idDocuments.length&&<p className="hint">Upload an applicant ID and wait for a clean malware scan before reading its details.</p>}
   <label className="field"><span>Applicant ID to read</span><select value={selectedId} disabled={busy||idReadingEnabled!==true||!idDocuments.length} onChange={event=>{setIdDocument(event.target.value);setIdProposal(null);setIdMessage('');}}><option value="">Choose applicant ID</option>{idDocuments.map(document=><option key={document.id} value={document.id}>{document.filename}</option>)}</select></label>
   <button disabled={busy||idReadingEnabled!==true||!selectedId} onClick={()=>void readIdentity()}>Read ID details</button>
   <p className="hint upload-feedback" role={idError?'alert':'status'} aria-live="polite">{idMessage}</p>
   {idProposal&&<IdProposal key={`${idProposal.evidenceId}/${idProposal.sha256}`} proposal={idProposal} current={applicant} cancel={()=>{setIdProposal(null);setIdMessage('ID suggestions discarded. Form details are unchanged.');}} apply={fields=>{applyId(fields);setIdProposal(null);setIdMessage('Selected ID details applied. Save the draft to keep them. Assessor review is still required.');}}/>}
  </section>}
  {canReview&&<fieldset disabled={busy}><h3>Assessor evidence review</h3><div className="grid"><label className="field"><span>Document awaiting review</span><select value={selected} onChange={e=>{setSelected(e.target.value);setNote('');setConfirmed(false);setCertified(false);setDate('');}}><option value="">Choose document</option>{documents.filter(d=>d.status==='PENDING_REVIEW'&&d.malware_status==='CLEAN').map(d=><option key={d.id} value={d.id}>{d.filename}</option>)}</select></label><label className="field"><span>Document type</span><select value={subtype} onChange={e=>setSubtype(e.target.value)}>{subtypes.map(t=><option value={t} key={t}>{label(t)}</option>)}</select></label><label className="field"><span>Document issue date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field"><span>Review decision</span><select value={decision} onChange={e=>setDecision(e.target.value)}><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select></label></div><div className="checks"><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Content, applicant match and applicable signatures / commissioning checked</label><label><input type="checkbox" checked={certified} onChange={e=>setCertified(e.target.checked)}/>ID certification confirmed where required</label></div><label className="field"><span>Evidence review note · at least 10 characters</span><textarea value={note} onChange={e=>setNote(e.target.value)}/></label><button disabled={!selected||note.trim().length<10||(decision==='VERIFIED'&&!confirmed)} onClick={()=>run(async()=>{await api(root+`/evidence/${selected}/review`,'PUT',{decision,note,documentSubtype:subtype,documentDate:date||null,certificationConfirmed:certified,contentConfirmed:confirmed});changed();await refresh();setSelected('');setMessage('Evidence review recorded.');})}>Record evidence decision</button></fieldset>}
  <h3>Departmental review register</h3>{departmentState!=='ready'?<p className="hint" role={departmentState==='error'?'alert':'status'}>{departmentState==='loading'?'Loading departmental reviews…':'Unable to load departmental reviews. Refresh before recording a decision.'}</p>:<ul className="department-register">{dohsSections.map(s=><li key={s}><strong>{label(s)}</strong><span>{label(reviews.find(r=>r.section===s)?.state??'PENDING')}</span>{reviews.find(r=>r.section===s)?.note&&<p>{reviews.find(r=>r.section===s)?.note}</p>}</li>)}</ul>}
  {role==='DOHS_REVIEWER'?<fieldset disabled={busy}><h3>Record DoHS section decision</h3><div className="grid"><label className="field"><span>Departmental section</span><select value={section} onChange={e=>chooseSection(e.target.value)}>{dohsSections.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label><label className="field"><span>Section outcome</span><select value={state} onChange={e=>setState(e.target.value)}><option value="PENDING">Pending</option><option value="COMPLETE">Complete</option><option value="RETURNED">Returned for correction</option></select></label></div><label className="field"><span>Departmental review note · at least 10 characters</span><textarea value={departmentNote} onChange={e=>setDepartmentNote(e.target.value)}/></label><button disabled={departmentNote.trim().length<10} onClick={()=>run(async()=>{await api(root+`/dohs/${section}`,'PUT',{state,note:departmentNote,expectedReviewedAt:reviews.find(r=>r.section===section)?.reviewed_at??null});changed();await refresh();setMessage('Departmental section decision recorded.');})}>Record departmental decision</button></fieldset>:<p className="hint">Only a DoHS reviewer assigned to this project can change departmental sections.</p>}
  <p role="status" aria-live="polite" className="hint">{busy?'Working…':message}</p>
 </section>;
}
