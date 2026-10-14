'use client';
import {useState} from 'react';
import {extractPhoto,type PhotoProposal} from '../../src/photo-metadata';
export default function PhotoMetadata({apply}:{apply:(proposal:PhotoProposal)=>void}){
 const [proposal,setProposal]=useState<PhotoProposal|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <section className="notice" aria-label="Photograph metadata extraction"><strong>Read GPS and date from a photograph</strong><p>Choose the original photograph. This reads embedded metadata on your device; the photograph is not uploaded here.</p>
 <label className="field"><span>Original site photograph · JPEG or PNG</span><input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];setProposal(null);if(!file)return;setBusy(true);setMessage('Reading photograph…');try{const value=await extractPhoto(file);setProposal(value);setMessage(value.latitude===null&&value.longitude===null&&!value.date?'No embedded GPS or capture date found. Read the image overlay and enter the parameters manually.':'Review these proposed values against the original photograph.');}catch(error){setMessage(error instanceof Error?error.message:'Unable to read metadata.');}finally{setBusy(false);}}}/></label>
 {proposal&&<><dl><div><dt>Latitude</dt><dd>{proposal.latitude??'Not embedded'}</dd></div><div><dt>Longitude</dt><dd>{proposal.longitude??'Not embedded'}</dd></div><div><dt>Capture date</dt><dd>{proposal.date||'Not embedded'}</dd></div><div><dt>Camera timezone</dt><dd>{proposal.timezone}</dd></div></dl><button className="secondary" disabled={busy||(proposal.latitude===null&&proposal.longitude===null&&!proposal.date)} onClick={()=>{apply(proposal);setMessage('Proposed values applied. Confirm GPS/date after checking the photograph, and link the same verified photograph in the evidence register.');}}>Apply proposed values</button></>}
 <p role="status" className="hint">{message}</p></section>;
}
