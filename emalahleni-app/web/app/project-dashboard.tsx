'use client';
import {useState} from 'react';
import type {ProjectDashboard} from '../../src/dashboard';

const workflowLabels:Record<string,string>={DRAFT:'Draft',SUBMITTED_FOR_ASSESSMENT:'Awaiting assessment',RETURNED:'Returned',ASSESSMENT_COMPLETE:'Assessment complete'};
export default function Dashboard({data,loading,error,projectName,refresh,open,busy}:{data:ProjectDashboard|null;loading:boolean;error:string;projectName:string;refresh:()=>void;open:(id:string)=>void;busy:boolean}) {
  const [filter,setFilter]=useState('');
  const recent=data?.recent.filter(item=>item.reference.toLowerCase().includes(filter.trim().toLowerCase()))??[];
  const format=(value:number)=>value.toLocaleString();
  return <section className="project-dashboard" aria-label="Project dashboard" aria-busy={loading}>
    <div className="dashboard-heading"><div><p className="eyebrow">PROJECT OVERVIEW</p><h2>{projectName}</h2><p>Application and evidence totals for this project.</p></div><button className="secondary" disabled={busy||loading} onClick={refresh}>{loading?'Refreshing…':'Refresh dashboard'}</button></div>
    {error&&<div className="dashboard-error" role="alert">{error} Use Refresh dashboard to try again.</div>}
    {!data?<p className="dashboard-empty" role="status">{loading?'Loading project totals…':'Project totals are unavailable.'}</p>:<>
      <div className="metric-grid">
        {([
          ['Applications',data.applications.total,'All applications in this project','navy'],
          ['Draft applications',data.applications.draft,'Capture in progress','teal'],
          ['Awaiting assessment',data.applications.awaitingAssessment,'Applications sent for assessment','navy'],
          ['Evidence to review',data.evidence.awaitingReview,'Clean documents awaiting a reviewer','coral']
        ] as const).map(([label,value,detail,tone])=><article className={`metric metric-${tone}`} key={label}><h3>{label}</h3><strong>{format(value)}</strong><p>{detail}</p></article>)}
      </div>
      <div className="dashboard-panels">
        <section className="card workflow-panel"><p className="eyebrow">APPLICATIONS</p><h3>Workflow at a glance</h3>{data.applications.total===0?<p className="dashboard-empty">No applications yet. Start an application to begin.</p>:<div className="workflow-bars">{([
          ['Draft',data.applications.draft,'draft'],['Awaiting assessment',data.applications.awaitingAssessment,'assessment'],['Returned',data.applications.returned,'returned'],['Assessment complete',data.applications.assessmentComplete,'complete']
        ] as const).map(([label,value,tone])=><div className={`workflow-row workflow-${tone}`} key={label}><div><span>{label}</span><strong>{format(value)}</strong></div><div className="workflow-track"><span style={{width:`${value/data.applications.total*100}%`}}/></div></div>)}</div>}<p className="hint">Workflow status is recorded separately from readiness. Assessment completion does not grant submission approval.</p></section>
        <section className="card evidence-panel"><p className="eyebrow">DOCUMENTS</p><h3>Evidence progress</h3><dl>
          <div><dt>Uploaded documents</dt><dd>{format(data.evidence.total)}</dd></div>
          <div><dt>Verified by a reviewer</dt><dd>{format(data.evidence.verified)}</dd></div>
          <div><dt>Awaiting review</dt><dd>{format(data.evidence.awaitingReview)}</dd></div>
          <div><dt>Waiting for a scan</dt><dd>{format(data.evidence.pendingScan)}</dd></div>
          <div className={data.evidence.scanFailed?'evidence-attention':''}><dt>Scan needs retry</dt><dd>{format(data.evidence.scanFailed)}</dd></div>
          <div className={data.evidence.infected?'evidence-attention':''}><dt>Blocked by malware scan</dt><dd>{format(data.evidence.infected)}</dd></div>
          <div><dt>Rejected after review</dt><dd>{format(data.evidence.rejected)}</dd></div>
        </dl>{data.evidence.pendingUpload>0&&<p className="hint">{format(data.evidence.pendingUpload)} incomplete upload request{data.evidence.pendingUpload===1?'':'s'}.</p>}<p className="hint">A clean scan is followed by human review.</p></section>
      </div>
      <section className="card recent-applications"><div className="recent-heading"><div><p className="eyebrow">PICK UP YOUR WORK</p><h3>Recent applications</h3></div><label className="field"><span>Filter recent applications</span><input type="search" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Search by reference"/></label></div>
        {recent.length?<div className="recent-table"><table><thead><tr><th scope="col">Reference</th><th scope="col">Status</th><th scope="col">Last saved</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>{recent.map(item=><tr key={item.id}><th scope="row">{item.reference}</th><td><span className={`workflow-label status-${item.workflow_status.toLowerCase()}`}>{workflowLabels[item.workflow_status]??item.workflow_status}</span></td><td>{new Date(item.updated_at).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}</td><td><button className="secondary" disabled={busy} onClick={()=>open(item.id)} aria-label={`Open ${item.reference}`}>Open <span aria-hidden="true">↗</span></button></td></tr>)}</tbody></table></div>:<p className="dashboard-empty">{filter?'No recent applications match this reference.':'Saved applications will appear here.'}</p>}
        <p className="hint">Showing the 10 most recently updated applications. Use Existing draft above to open other recent drafts.</p>
      </section><p className="dashboard-updated">Updated {new Date(data.generatedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})} · Refresh to get the latest totals.</p>
    </>}
  </section>;
}
