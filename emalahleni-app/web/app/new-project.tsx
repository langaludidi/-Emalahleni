'use client';
import {useEffect,useRef,useState} from 'react';
import {housingProjectSchema,type HousingProjectInput,type HousingProject,type ProjectOrganisation} from '../../src/projects';

export default function NewProject({organisations,create,created,cancel,busy,onBusyChange,onPendingChange}:{
  organisations:ProjectOrganisation[];create:(input:HousingProjectInput)=>Promise<{project:HousingProject}>;
  created:(project:HousingProject)=>void;cancel:()=>void;busy:boolean;
  onBusyChange:(value:boolean)=>void;onPendingChange:(value:boolean)=>void;
}){
  const [organisationId,setOrganisationId]=useState(organisations[0]?.id??'');
  const [name,setName]=useState(''),[code,setCode]=useState(''),[clientName,setClientName]=useState(''),[location,setLocation]=useState('');
  const [submitting,setSubmitting]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const request=useRef<HousingProjectInput|null>(null);
  const locked=busy||submitting;
  const valid=housingProjectSchema.omit({id:true}).safeParse({organisationId,name,code,clientName,location}).success;
  useEffect(()=>{onPendingChange(!!(name||code||clientName||location||uncertain));},[name,code,clientName,location,uncertain,onPendingChange]);
  useEffect(()=>()=>{onPendingChange(false);onBusyChange(false);},[onPendingChange,onBusyChange]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(locked||(!valid&&!request.current))return;
    const input=request.current??housingProjectSchema.parse({id:crypto.randomUUID(),organisationId,name,code,clientName,location});
    request.current=input;setSubmitting(true);onBusyChange(true);setError('');
    try{const result=await create(input);created(result.project);}
    catch(failure){
      const message=failure instanceof Error?failure.message:'';
      if(['PROJECT_CODE_EXISTS','PROJECT_CREATION_DENIED','VALIDATION_FAILED','PROJECT_REQUEST_CONFLICT'].includes(message)){
        request.current=null;setUncertain(false);
        setError(message==='PROJECT_CODE_EXISTS'?'This project code is already in use. Choose a different code.':message==='PROJECT_CREATION_DENIED'?'Your project-creation access is no longer available. Refresh projects or contact your administrator.':message==='PROJECT_REQUEST_CONFLICT'?'This request conflicts with an existing project. Refresh projects before creating another one.':'Check the project details and try again.');
      }else{setUncertain(true);setError('Project creation could not be confirmed. Retry with the same details to check or complete this request. The retry will not create a second project.');}
    }finally{setSubmitting(false);onBusyChange(false);}
  }
  return <section className="card new-project" aria-labelledby="new-project-title">
    <p className="eyebrow">HOUSING PROJECT SETUP</p><h2 id="new-project-title">Create a housing project</h2>
    <p>Use the existing housing application form, evidence checks and project dashboard. You will administer this new project.</p>
    <form onSubmit={submit}>
      <fieldset disabled={locked||uncertain} className="project-fields">
        {organisations.length>1&&<label className="field"><span>Organisation</span><select value={organisationId} onChange={e=>setOrganisationId(e.target.value)}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
        <div className="grid">
          <label className="field"><span>Project name</span><input id="new-project-name" required minLength={2} maxLength={120} autoFocus value={name} onChange={e=>setName(e.target.value)}/></label>
          <label className="field"><span>Project code</span><input required minLength={3} maxLength={40} pattern="[A-Za-z][A-Za-z0-9_\-]{2,39}" autoCapitalize="characters" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} aria-describedby="project-code-hint"/></label>
          <label className="field"><span>Client or authority (optional)</span><input maxLength={160} value={clientName} onChange={e=>setClientName(e.target.value)}/></label>
          <label className="field"><span>Location (optional)</span><input maxLength={160} value={location} onChange={e=>setLocation(e.target.value)}/></label>
        </div>
      </fieldset>
      <p id="project-code-hint" className="hint">Use a unique code of 3–40 letters, numbers, hyphens or underscores, starting with a letter.</p>
      {error&&<p className="project-error" role="alert">{error}</p>}
      <div className="home-actions"><button type="submit" disabled={locked||(!valid&&!request.current)}>{submitting?'Creating project…':uncertain?'Retry project creation':'Create project'}</button><button type="button" className="secondary" disabled={locked} onClick={cancel}>Cancel project setup</button></div>
    </form>
  </section>;
}
