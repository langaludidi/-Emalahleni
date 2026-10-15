'use client';
import {useState} from 'react';
import {birthDateFromId,idFieldsSchema,validSaId,type IdFields,type IdReading} from '../../src/id-reading';
const fieldLabels:Record<keyof IdFields,string>={firstNames:'First names',surname:'Surname',idNumber:'South African ID number'};
export default function IdProposal({proposal,current,apply,cancel}:{proposal:IdReading;current:IdFields;apply:(fields:Partial<IdFields>)=>void;cancel:()=>void}){
 const [values,setValues]=useState<IdFields>(proposal.fields);
 const [selected,setSelected]=useState<Record<keyof IdFields,boolean>>({firstNames:!!proposal.fields.firstNames&&!current.firstNames,surname:!!proposal.fields.surname&&!current.surname,idNumber:!!proposal.fields.idNumber&&!current.idNumber});
 const [confirmed,setConfirmed]=useState(false);
 const chosen=Object.fromEntries((Object.keys(fieldLabels) as (keyof IdFields)[]).filter(key=>selected[key]).map(key=>[key,values[key].trim()])) as Partial<IdFields>;
 const valid=Object.keys(chosen).length>0&&Object.values(chosen).every(Boolean)&&idFieldsSchema.partial().safeParse(chosen).success&&(!chosen.idNumber||validSaId(chosen.idNumber));
 const date=values.idNumber===proposal.fields.idNumber?proposal.dateOfBirth:birthDateFromId(values.idNumber);
 return <section className="notice id-proposal" aria-label="Review extracted ID details">
  <h3>Review ID details</h3><p>Check these suggestions against the original applicant ID. Existing form values stay in place unless you select a replacement.</p>
  {proposal.warnings.length>0&&<ul className="hint">{proposal.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
  {(Object.keys(fieldLabels) as (keyof IdFields)[]).map(key=><div className="id-field" key={key}>
   <label className="field"><span>{fieldLabels[key]} read from ID</span><input value={values[key]} maxLength={key==='idNumber'?13:250} inputMode={key==='idNumber'?'numeric':undefined} onChange={event=>{setValues(v=>({...v,[key]:key==='idNumber'?event.target.value.replace(/\D/g,''):event.target.value}));setConfirmed(false);}}/></label>
   <p className="hint">Current form value: {current[key]||'Empty'}</p>
   <label className="id-check"><input type="checkbox" checked={selected[key]} onChange={event=>{setSelected(s=>({...s,[key]:event.target.checked}));setConfirmed(false);}}/>Use {fieldLabels[key].toLowerCase()} from ID</label>
  </div>)}
  {date&&<p className="hint">Birth date indicated by the ID: {date}. Check the year against the document.</p>}
  {selected.idNumber&&values.idNumber&&!validSaId(values.idNumber)&&<p className="hint" role="alert">The selected ID number must have 13 digits and pass its date and checksum checks.</p>}
  <label className="id-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I checked the selected details against the original applicant ID</label>
  <div className="row-actions"><button disabled={!valid||!confirmed} onClick={()=>apply(chosen)}>Apply selected ID details</button><button className="secondary" onClick={cancel}>Discard ID suggestions</button></div>
  <p className="hint">Applying details changes this form. Save the draft to keep them. Assessor document review is still required.</p>
 </section>;
}
