'use client';
import { useEffect,useRef,useState } from 'react';
import {sha256Hex} from '../../src/hash';
import { evidenceKinds,subtypes,MAX_UPLOAD,evidenceWriterRoles,scanFailureReasons } from '../../src/evidence-contracts';
import {reviewCurrent} from '../../src/rules';
import { dohsSections } from '../../src/contracts';
import {idFieldsSchema,type IdFields,type IdReading} from '../../src/id-reading';
import IdProposal from './id-proposal';
type Api=(path:string,method?:string,data?:unknown)=>Promise<any>;
interface Props { formVersion:number;captureUnsaved:boolean;captureEditable:boolean;root:string;role:string;api:Api;sendFile:(path:string,bytes:ArrayBuffer,type:string)=>Promise<any>;download:(path:string,filename:string)=>Promise<void>;changed:()=>void;photo:(id:string)=>void;applicant:IdFields;applyId:(fields:Partial<IdFields>)=>void;onBusyChange:(busy:boolean)=>void;onPendingChange:(pending:boolean)=>void; }
type Document={id:string;kind:string;filename:string;status:string;malware_status:string;reviewed_by:string|null;reviewed_form_version:number|null;document_date:string|null;document_subtype:string|null};
type Department={section:string;state:string;note:string;reviewed_at:string;reviewed_form_version:number|null};
const label=(s:string)=>s.toLowerCase().replaceAll('_',' ');
function scanFailureMessage(value:unknown){const reason=scanFailureReasons.find(code=>code===value)??'UNKNOWN';return `Scan failed (${reason}). The file remains quarantined. Use Retry scan; if it fails again, report this code.`;}
export default function ReviewWorkspace({formVersion,captureUnsaved,captureEditable,root,role,api,sendFile,download,changed,photo,applicant,applyId,onBusyChange,onPendingChange}:Props){
 const [documents,setDocuments]=useState<Document[]>([]),[reviews,setReviews]=useState<Department[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [evidenceState,setEvidenceState]=useState<'loading'|'ready'|'error'>('loading'),[departmentState,setDepartmentState]=useState<'loading'|'ready'|'error'>('loading');
 const [uploadsEnabled,setUploadsEnabled]=useState<boolean|null>(null),[uploadMessage,setUploadMessage]=useState(''),[uploadError,setUploadError]=useState(false);
 const [idReadingEnabled,setIdReadingEnabled]=useState<boolean|null>(null),[idDocument,setIdDocument]=useState(''),[idProposal,setIdProposal]=useState<IdReading|null>(null),[idMessage,setIdMessage]=useState(''),[idError,setIdError]=useState(false);
 const [consistencyMessage,setConsistencyMessage]=useState(''),[consistencyError,setConsistencyError]=useState(false);
 const [serviceMessage,setServiceMessage]=useState(''),[serviceError,setServiceError]=useState(false);
 const [scanMessages,setScanMessages]=useState<Record<string,{message:string;error:boolean}>>({});
 const fileInput=useRef<HTMLInputElement>(null);
 const [kind,setKind]=useState<string>('APPLICANT_ID'),[ordinal,setOrdinal]=useState('1'),[file,setFile]=useState<File|null>(null);
 const [reviewFormVersion,setReviewFormVersion]=useState(formVersion);
 const [selected,setSelected]=useState<string>(''),[decision,setDecision]=useState('VERIFIED'),[subtype,setSubtype]=useState('ID_COPY'),[date,setDate]=useState(''),[note,setNote]=useState(''),[certified,setCertified]=useState(false),[confirmed,setConfirmed]=useState(false);
 const [section,setSection]=useState<string>('PAGE_2'),[state,setState]=useState('PENDING'),[departmentNote,setDepartmentNote]=useState('');
 const [departmentBase,setDepartmentBase]=useState<{state:string;note:string;reviewedAt:string|null;formVersion:number}>({state:'PENDING',note:'',reviewedAt:null,formVersion});
 const departmentDirty=state!==departmentBase.state||departmentNote!==departmentBase.note;
 const canUpload=evidenceWriterRoles.includes(role),canReview=['ADMIN','ASSESSOR'].includes(role);
 const idDocuments=documents.filter(document=>document.kind==='APPLICANT_ID'&&document.malware_status==='CLEAN'&&['PENDING_REVIEW','VERIFIED'].includes(document.status));
 const selectedId=idDocuments.find(document=>document.id===idDocument)?.id??idDocuments[0]?.id??'';
 const reviewableDocuments=documents.filter(document=>(document.status==='PENDING_REVIEW'||(document.status==='VERIFIED'&&!reviewCurrent(document,formVersion)))&&document.malware_status==='CLEAN');
 const reviewableIds=new Set(reviewableDocuments.map(document=>document.id));
 const selectedReview=documents.find(document=>document.id===selected);
 const selectedReviewable=reviewableIds.has(selected);
 const reviewDirty=!!(note||confirmed||certified||date)||decision!=='VERIFIED'||subtype!==reviewSubtype(selectedReview);
 const certificationNeeded=!!selectedReview&&['APPLICANT_ID','SPOUSE_ID'].includes(selectedReview.kind);
 useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
 const pending=!!file||!!idProposal||(canReview&&reviewDirty)||(role==='DOHS_REVIEWER'&&departmentDirty);
 useEffect(()=>{onPendingChange(pending);return()=>onPendingChange(false);},[pending,onPendingChange]);
 async function refresh(current=()=>true){
  setEvidenceState('loading');setDepartmentState('loading');setUploadsEnabled(null);setIdReadingEnabled(null);
  const [e,d]=await Promise.allSettled([api(root+'/evidence'),api(root+'/dohs')]);if(!current())return false;
  if(e.status==='fulfilled'){
   setDocuments(e.value.evidence);setEvidenceState('ready');setUploadsEnabled(typeof e.value.uploads?.enabled==='boolean'?e.value.uploads.enabled:null);setIdReadingEnabled(typeof e.value.idReading?.enabled==='boolean'?e.value.idReading.enabled:null);
   // Evidence IDs identify immutable uploaded bytes. Retain edited suggestions
   // only while that same applicant ID is still clean and available for reading.
   if(idProposal&&!e.value.evidence.some((document:Document)=>document.id===idProposal.evidenceId&&document.kind==='APPLICANT_ID'&&document.malware_status==='CLEAN'&&['PENDING_REVIEW','VERIFIED'].includes(document.status))){setIdProposal(null);setIdError(true);setIdMessage('The source ID is no longer available for reading. Its suggestions were removed; form details are unchanged.');}
  }else{setEvidenceState('error');setUploadsEnabled(null);setIdReadingEnabled(null);}
  if(d.status==='fulfilled'){setReviews(d.value.reviews);setDepartmentState('ready');if(!departmentDirty)loadDepartmentDraft(d.value.reviews.find((review:Department)=>review.section===section));}else setDepartmentState('error');
  return e.status==='fulfilled';
 }
 async function run(task:()=>Promise<void>){setBusy(true);try{await task();}catch(e){const code=e instanceof Error?e.message:'';setMessage(code==='DEPARTMENT_REVIEW_CHANGED_OR_UNAVAILABLE'?'The saved form or section changed since editing started. Your note is retained. Reopen the current saved case, then reload the selected section before recording a decision.':code==='REVIEW_STATE_OR_CERTIFICATION_INVALID'?'The saved form or document changed, or required certification is incomplete. Your note is retained. Reopen the current saved case and review the document again before recording a decision.':code||'Unable to complete action.');}finally{setBusy(false);}}
 useEffect(()=>{let current=true;setDocuments([]);setScanMessages({});setReviews([]);setSelected('');setMessage('');setUploadMessage('');setUploadError(false);setNote('');setDepartmentNote('');setSection('PAGE_2');setState('PENDING');setFile(null);if(fileInput.current)fileInput.current.value='';setCertified(false);setConfirmed(false);void refresh(()=>current);return()=>{current=false};},[root]);
 function loadDepartmentDraft(prior?:Department){const base={state:prior?.state??'PENDING',note:prior?.note??'',reviewedAt:prior?.reviewed_at??null,formVersion};setDepartmentBase(base);setState(base.state);setDepartmentNote(base.note);}
 function chooseSection(value:string){if(departmentDirty&&!window.confirm('Discard the unsaved departmental section decision?'))return;setSection(value);loadDepartmentDraft(reviews.find(review=>review.section===value));}
 async function reloadDepartment(){if(departmentDirty&&!window.confirm('Reload this section and discard its unsaved changes?'))return;const result=await api(root+'/dohs');setReviews(result.reviews);loadDepartmentDraft(result.reviews.find((review:Department)=>review.section===section));setDepartmentState('ready');setMessage('The selected departmental section was reloaded.');}
 function reviewSubtype(entry?:Document){return entry?.document_subtype??(!entry||['APPLICANT_ID','SPOUSE_ID'].includes(entry.kind)?'ID_COPY':'OTHER');}
 function resetReview(id:string){setReviewFormVersion(formVersion);setSelected(id);setNote('');setConfirmed(false);setCertified(false);setDate('');setDecision('VERIFIED');setSubtype(reviewSubtype(documents.find(item=>item.id===id)));}
 function chooseReview(id:string){if(id===selected)return true;if(reviewDirty&&!window.confirm('Discard the unrecorded evidence review before choosing another document?'))return false;resetReview(id);return true;}
 function clearReview(){if(reviewDirty&&!window.confirm('Discard the unrecorded evidence review?'))return;resetReview('');}
 function openReview(id:string){if(!chooseReview(id))return;requestAnimationFrame(()=>{const target=document.getElementById('assessor-review');target?.scrollIntoView({block:'start'});target?.querySelector('select')?.focus({preventScroll:true});});}
 function chooseId(id:string){if(id===selectedId)return;if(idProposal&&!window.confirm('Discard the current ID suggestions before choosing another document?'))return;setIdDocument(id);setIdProposal(null);setIdMessage('');}
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
   setServiceMessage(code.startsWith('Too many requests.')?code:messages[code]??'The document-service check could not complete. Please report this check message.');
  }
  finally{setBusy(false);}
 }
 async function readIdentity(){
  if(idProposal&&!window.confirm('Read the ID again and discard the current suggestions?'))return;
  setBusy(true);setIdError(false);setIdProposal(null);setIdMessage('Reading the applicant ID. This may take up to two minutes.');
  try{
   if(idReadingEnabled!==true||!selectedId)throw new Error('Upload a readable applicant ID and wait for a clean scan first.');
   const proposal:IdReading=await api(root+`/evidence/${selectedId}/read-id`,'POST');
   if(proposal.evidenceId!==selectedId||proposal.requiresConfirmation!==true)throw new Error('The ID reading response could not be confirmed.');
   idFieldsSchema.parse(proposal.fields);setIdProposal(proposal);setIdMessage('Review the proposed details below before applying them.');
  }catch(error){
   const code=error instanceof Error?error.message:'';setIdError(true);if(code==='ID_READING_NOT_CONFIGURED')setIdReadingEnabled(false);
   setIdMessage(code.startsWith('Too many requests.')?code:code==='ID_READING_NOT_CONFIGURED'?'ID reading is unavailable until the private document service is connected.':code==='ID_READING_FILE_REJECTED'?'The scanner rejected this file. Its ID details cannot be used. Refresh the register to see its status.':code==='CLEAN_APPLICANT_ID_REQUIRED'?'Choose an applicant ID that has passed its malware scan.':code==='ID_READING_STATE_CHANGED'?'The document or your project access changed while reading. Refresh the register before trying again.':'Unable to read ID details. Try again when the service is ready, or enter the details manually.');
   if(code==='ID_READING_FILE_REJECTED'){changed();await refresh();}
  }finally{setBusy(false);}
 }
 async function recordConsistency(){
  setBusy(true);setConsistencyError(false);setConsistencyMessage('Checking the saved case against the scanned ID.');
  try{
   if(captureUnsaved)throw new Error('Save the form before recording consistency findings.');
   if(!selectedId||idReadingEnabled!==true)throw new Error('Select an available clean applicant ID.');
   const result=await api(root+`/consistency/${selectedId}`,'POST');
   if(result.formVersion!==formVersion)throw new Error('The saved form version changed. Reopen the case before checking again.');
   const counts=(result.findings as {state:string}[]).reduce((acc:Record<string,number>,f)=>({...acc,[f.state]:(acc[f.state]??0)+1}),{});
   setConsistencyMessage(`Recorded ${result.findings.length} source-linked findings for saved form version ${formVersion}: ${counts.MATCH??0} matches, ${counts.MISMATCH??0} discrepancies, ${counts.UNKNOWN??0} unknown, ${counts.NOT_CHECKED??0} unchecked. Human review remains required.`);
  }catch(error){setConsistencyError(true);setConsistencyMessage(error instanceof Error?error.message:'Consistency checking was unavailable. No approval was changed.');}
  finally{setBusy(false);}
 }
 async function retryScan(document:Document){
  setScanMessages(current=>({...current,[document.id]:{message:'Scanning the stored file. Temporary service failures will be retried automatically.',error:false}}));
  try{
   const result=await api(root+`/evidence/${document.id}/scan`,'POST');changed();await refresh();
   const error=result.malware_status!=='CLEAN';
   const message=result.malware_status==='CLEAN'?'Scanned successfully. Assessor review is still required.':result.malware_status==='INFECTED'?'The scanner rejected this file. It remains quarantined.':scanFailureMessage(result.scanFailure);
   setScanMessages(current=>({...current,[document.id]:{message,error}}));
  }catch(error){setScanMessages(current=>({...current,[document.id]:{message:error instanceof Error?error.message:'The scan could not complete. The file remains quarantined.',error:true}}));}
 }
 async function uploadFile(){
  setBusy(true);setUploadError(false);setUploadMessage('Uploading and checking the file. Please keep this form open.');
  try{
   if(uploadsEnabled!==true)throw new Error('DOCUMENT_UPLOADS_NOT_CONFIGURED');
   if(!file)throw new Error('Choose a PDF, JPEG or PNG first.');if(file.size>MAX_UPLOAD)throw new Error('The maximum file size is 5 MB.');
   const bytes=await file.arrayBuffer();const sha256=await sha256Hex(bytes);
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
  <section className="workflow-handoff" aria-label="Evidence handoff"><p className="eyebrow">SAVED CASE · EVIDENCE WORKFLOW</p><div><article><strong>1. Upload and scan</strong><p>Capture team uploads evidence. Failed scans stay quarantined and can be retried.</p></article><article><strong>2. Assessor review</strong><p>An assessor checks clean documents, certification and a recorded review note.</p></article><article><strong>3. Departmental review</strong><p>The assigned DoHS reviewer completes the departmental sections. Submission approval remains outstanding.</p></article></div></section>
  <h3>Evidence register</h3><p className="hint">Approvals apply to the saved form reviewed. Saving form changes requires fresh review; uploaded files and scan results are kept.</p><p className="hint">Upload → malware scan → assessor review. A clean scan alone does not verify a document.</p>
  {canUpload&&<><button className="secondary" disabled={busy} onClick={()=>void checkDocumentService()}>Check document service</button><p className="hint upload-feedback" role={serviceError?'alert':'status'} aria-live="polite">{serviceMessage}</p></>}
  <button className="secondary" disabled={busy||evidenceState==='loading'} onClick={()=>run(async()=>{await refresh();})}>Refresh evidence and reviews</button>
  {evidenceState==='loading'&&<p className="hint" role="status">Loading recorded evidence…</p>}
  {evidenceState==='error'&&<p className="hint" role="alert">Unable to load recorded evidence. Refresh to check whether a document is saved.</p>}
  <ul className="evidence-register">{documents.map(d=><li key={d.id}><strong>{d.filename}</strong><span>{label(d.kind)} · {d.status==='VERIFIED'&&!reviewCurrent(d,formVersion)?'review required after form change':label(d.status)} · {label(d.malware_status)}</span><div className="row-actions">{d.malware_status==='CLEAN'&&<button className="secondary" disabled={busy||evidenceState!=='ready'} onClick={()=>run(()=>download(root+`/evidence/${d.id}/download`,d.filename))}>Download</button>}{reviewableIds.has(d.id)&&canReview&&<button disabled={busy||evidenceState!=='ready'} onClick={()=>openReview(d.id)}>Review document</button>}{d.status==='PENDING_SCAN'&&canUpload&&<button disabled={busy||evidenceState!=='ready'||uploadsEnabled!==true} onClick={()=>run(()=>retryScan(d))}>Retry scan</button>}{d.kind==='SITE_PHOTO'&&d.status==='VERIFIED'&&canUpload&&captureEditable&&<button className="secondary" disabled={busy||evidenceState!=='ready'} onClick={()=>{photo(d.id);setMessage('Photograph linked to the form. Save the draft to record it.');}}>Use as site photograph</button>}</div>{scanMessages[d.id]&&<p className="hint upload-feedback" role={scanMessages[d.id].error?'alert':'status'} aria-live="polite">{scanMessages[d.id].message}</p>}</li>)}</ul>{evidenceState==='ready'&&!documents.length&&<p className="hint">No documents recorded for this case.</p>}
  {canUpload&&<fieldset aria-label="Upload evidence" disabled={busy||uploadsEnabled!==true}><h3>Upload evidence</h3>
   {uploadsEnabled!==true&&<div className="notice" role="status"><strong>{evidenceState==='loading'?'Checking upload availability…':uploadsEnabled===false?'Document uploads are unavailable':'Upload availability could not be confirmed'}</strong><p>{uploadsEnabled===false?'The document scanning service must be connected before uploads can be accepted. Choosing a file on your device does not add it to the case.':'Use Refresh evidence and reviews to check availability before choosing a file.'}</p></div>}
   <p className="hint">Upload the file to add it to this case. After a clean scan, use Read ID details to review suggestions for the applicant form.</p>
   <div className="grid"><label className="field"><span>Document purpose</span><select value={kind} onChange={e=>setKind(e.target.value)}>{evidenceKinds.map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label>{kind==='DEPENDANT_ID_OR_BIRTH_CERT'&&<label className="field"><span>Dependant</span><select value={ordinal} onChange={e=>setOrdinal(e.target.value)}><option value="1">Dependant 1</option><option value="2">Dependant 2</option></select></label>}<label className="field"><span>File · PDF, JPEG or PNG · maximum 5 MB</span><input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>{setFile(e.target.files?.[0]??null);setUploadMessage('');setUploadError(false);}}/></label></div>
   {file&&!uploadMessage&&uploadsEnabled===true&&<p className="hint selected-file" role="status">Selected: {file.name}. Not uploaded yet. Press Upload and scan to add it to the case.</p>}
   <button disabled={!file} onClick={()=>void uploadFile()}>Upload and scan</button>
   <p className="hint upload-feedback" role={uploadError?'alert':'status'} aria-live="polite">{uploadMessage}</p>
  </fieldset>}
  {canUpload&&captureEditable&&<section className="id-reading" aria-label="Applicant ID reading"><h3>Read applicant ID details</h3>
   <p className="hint">Read names, surname and the ID number from a scanned applicant ID. Review the suggestions before applying them to this form.</p>
   {idReadingEnabled!==true&&<p className="hint" role="status">{evidenceState==='loading'?'Checking ID reading availability…':idReadingEnabled===false?'ID reading is unavailable until the private document service is connected.':'ID reading availability could not be confirmed. Refresh the evidence register.'}</p>}
   {idReadingEnabled===true&&!idDocuments.length&&<p className="hint">Upload an applicant ID and wait for a clean malware scan before reading its details.</p>}
   <label className="field"><span>Applicant ID to read</span><select value={selectedId} disabled={busy||idReadingEnabled!==true||!idDocuments.length} onChange={event=>chooseId(event.target.value)}><option value="">Choose applicant ID</option>{idDocuments.map(document=><option key={document.id} value={document.id}>{document.filename}</option>)}</select></label>
   <button disabled={busy||idReadingEnabled!==true||!selectedId} onClick={()=>void readIdentity()}>Read ID details</button>
   <button className="secondary" disabled={busy||captureUnsaved||idReadingEnabled!==true||!selectedId} onClick={()=>void recordConsistency()}>Record saved-form consistency</button>
   <p className="hint upload-feedback" role={consistencyError?'alert':'status'} aria-live="polite">{consistencyMessage}</p>
   <p className="hint upload-feedback" role={idError?'alert':'status'} aria-live="polite">{idMessage}</p>
   {idProposal&&<fieldset disabled={busy||evidenceState!=='ready'||idReadingEnabled!==true}><IdProposal key={`${idProposal.evidenceId}/${idProposal.sha256}`} proposal={idProposal} current={applicant} cancel={()=>{setIdProposal(null);setIdMessage('ID suggestions discarded. Form details are unchanged.');}} apply={fields=>{applyId(fields);setIdProposal(null);setIdMessage('Selected ID details applied. Save the draft to keep them. Assessor review is still required.');}}/></fieldset>}
  </section>}
  {canReview&&<fieldset id="assessor-review" disabled={busy||evidenceState!=='ready'}><h3>Assessor evidence review</h3><div className="grid"><label className="field"><span>Document awaiting review</span><select value={selected} onChange={e=>chooseReview(e.target.value)}><option value="">Choose document</option>{selected&&!selectedReviewable&&<option value={selected}>{selectedReview?.filename??'Selected document'} · no longer awaiting review</option>}{reviewableDocuments.map(d=><option key={d.id} value={d.id}>{d.filename}</option>)}</select></label><label className="field"><span>Document type</span><select value={subtype} onChange={e=>setSubtype(e.target.value)}>{subtypes.map(t=><option value={t} key={t}>{label(t)}</option>)}</select></label><label className="field"><span>Document issue date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field"><span>Review decision</span><select value={decision} onChange={e=>setDecision(e.target.value)}><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select></label></div><div className="checks"><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Content, applicant match and applicable signatures / commissioning checked</label><label><input type="checkbox" checked={certified} onChange={e=>setCertified(e.target.checked)}/>ID certification confirmed where required</label></div><label className="field"><span>Evidence review note · at least 10 characters</span><textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><p className="hint">Select a clean document, check the original, and record your decision. ID copies also require certification confirmation.</p>{captureUnsaved&&<p className="hint" role="status">Save the form changes before recording a review.</p>}{selected&&reviewFormVersion!==formVersion&&<div className="notice"><p>The saved form changed after this review began. Check the current form and document again. Your note is kept.</p><button className="secondary" disabled={captureUnsaved} onClick={()=>{setReviewFormVersion(formVersion);setConfirmed(false);setCertified(false);}}>Restart review against saved form</button></div>}<button disabled={captureUnsaved||reviewFormVersion!==formVersion||!selectedReviewable||note.trim().length<10||(decision==='VERIFIED'&&(!confirmed||(certificationNeeded&&!certified)))} onClick={()=>run(async()=>{await api(root+`/evidence/${selected}/review`,'PUT',{formVersion:reviewFormVersion,decision,note,documentSubtype:subtype,documentDate:date||null,certificationConfirmed:certified,contentConfirmed:confirmed});changed();resetReview('');const refreshed=await refresh();setMessage(refreshed?'Evidence review recorded.':'Evidence review recorded. The register could not refresh; refresh it to check the saved decision.');})}>Record evidence decision</button><button className="secondary" disabled={!selected&&!reviewDirty} onClick={clearReview}>Clear evidence review</button></fieldset>}
  <h3>Departmental review register</h3>{departmentState!=='ready'?<p className="hint" role={departmentState==='error'?'alert':'status'}>{departmentState==='loading'?'Loading departmental reviews…':'Unable to load departmental reviews. Refresh before recording a decision.'}</p>:<ul className="department-register">{dohsSections.map(s=><li key={s}><strong>{label(s)}</strong><span>{(()=>{const review=reviews.find(r=>r.section===s);return review&&!reviewCurrent(review,formVersion)?'review required after form change':label(review?.state??'PENDING');})()}</span>{reviews.find(r=>r.section===s)?.note&&<p>{reviews.find(r=>r.section===s)?.note}</p>}</li>)}</ul>}
  {role==='DOHS_REVIEWER'?<fieldset disabled={busy||departmentState!=='ready'}><h3>Record DoHS section decision</h3><div className="grid"><label className="field"><span>Departmental section</span><select value={section} onChange={e=>chooseSection(e.target.value)}>{dohsSections.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label><label className="field"><span>Section outcome</span><select value={state} onChange={e=>setState(e.target.value)}><option value="PENDING">Pending</option><option value="COMPLETE">Complete</option><option value="RETURNED">Returned for correction</option></select></label></div><label className="field"><span>Departmental review note · at least 10 characters</span><textarea maxLength={500} value={departmentNote} onChange={e=>setDepartmentNote(e.target.value)}/></label><p className="hint">Decisions apply to this saved form. If the form changes during review, reopen the latest case and reload the selected section.</p><button disabled={captureUnsaved||departmentBase.formVersion!==formVersion||departmentNote.trim().length<10} onClick={()=>run(async()=>{const saved=await api(root+`/dohs/${section}`,'PUT',{formVersion:departmentBase.formVersion,state,note:departmentNote,expectedReviewedAt:departmentBase.reviewedAt});setDepartmentBase({state,note:departmentNote,reviewedAt:saved.reviewed_at,formVersion});changed();await refresh();setMessage('Departmental section decision recorded.');})}>Record departmental decision</button><button className="secondary" onClick={()=>run(reloadDepartment)}>Reload selected section</button></fieldset>:<p className="hint">Only a DoHS reviewer assigned to this project can change departmental sections.</p>}
  <p role="status" aria-live="polite" className="hint">{busy?'Working…':message}</p>
 </section>;
}

