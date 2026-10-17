'use client';

import { useEffect, useMemo, useState } from 'react';
import { createAuthClient } from '@neondatabase/auth';
import type { DashboardResponse, DashboardApplication, HistoricalSnapshot } from '../../../src/dashboard';
import './dashboard.css';

const authUrl = 'https://ep-cold-scene-zaa3qek2.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
type ProjectOption = { id:string; name:string; code:string; role:string };
type Filters = { search:string; workflow:string; readiness:string; gps:string };
const initialFilters:Filters = {search:'',workflow:'ALL',readiness:'ALL',gps:'ALL'};
const PAGE_SIZE=20;

function dateLabel(value:string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
}
function filtered(rows:DashboardApplication[], filters:Filters, sort:string) {
  const search=filters.search.trim().toLowerCase();
  return rows.filter(row =>
    (!search || row.reference.toLowerCase().includes(search)) &&
    (filters.workflow==='ALL' || row.workflowStatus===filters.workflow) &&
    (filters.readiness==='ALL' || row.readiness===filters.readiness) &&
    (filters.gps==='ALL' || row.gpsStatus===filters.gps)
  ).sort((a,b) => sort==='reference' ? a.reference.localeCompare(b.reference) : sort==='blockers' ? b.blockerCount-a.blockerCount : b.updatedAt.localeCompare(a.updatedAt));
}
function Status({value}:{value:string}) {
  return <span className={'dashboard-status dashboard-status-'+value.toLowerCase().replaceAll('_','-')}>{value.replaceAll('_',' ')}</span>;
}
function HistoricalKpis({snapshot}:{snapshot:HistoricalSnapshot}) {
  return <>
    <div className="dashboard-kpis" aria-label="Historical workbook KPI cards">
      <div className="dashboard-kpi"><span>Assessed applications</span><strong>{snapshot.applications}</strong><small>Imported assessment</small></div>
      <div className="dashboard-kpi dashboard-kpi-red"><span>Red · blockers</span><strong>{snapshot.red}</strong><small>Workbook classification</small></div>
      <div className="dashboard-kpi dashboard-kpi-amber"><span>Amber · corrections</span><strong>{snapshot.amber}</strong><small>Workbook classification</small></div>
      <div className="dashboard-kpi dashboard-kpi-green"><span>Green · assessed</span><strong>{snapshot.green}</strong><small>Not a DoHS approval</small></div>
    </div>
    <div className="dashboard-bar" role="img" aria-label={'Readiness: '+snapshot.red+' red, '+snapshot.amber+' amber and '+snapshot.green+' green'}>
      <span className="dashboard-bar-red" style={{width:100*snapshot.red/snapshot.applications+'%'}}/>
      <span className="dashboard-bar-amber" style={{width:100*snapshot.amber/snapshot.applications+'%'}}/>
      <span className="dashboard-bar-green" style={{width:100*snapshot.green/snapshot.applications+'%'}}/>
    </div>
    <div className="dashboard-support-kpis">
      <div><small>Field-plan sites</small><strong>{snapshot.fieldPlanSites}</strong></div>
      <div><small>GPS captured in field plan</small><strong>{snapshot.fieldPlanGpsCaptured}</strong></div>
      <div><small>GPS still outstanding</small><strong>{snapshot.fieldPlanGpsOutstanding}</strong></div>
      <div><small>Applications without matched site</small><strong>{snapshot.applicationsWithoutMatchedSite}</strong></div>
      <div><small>Income concessions</small><strong>{snapshot.incomeConcessions}</strong></div>
      <div><small>DoHS income decisions pending</small><strong>{snapshot.dohsIncomeDecisionsPending}</strong></div>
    </div>
    <p className="dashboard-subnote">The 211 field-plan sites and 209 assessed applications are separate populations. Historical Green is not an app-issued submission approval.</p>
  </>;
}
export default function ProjectDashboard() {
  const [auth] = useState(() => createAuthClient(authUrl));
  const [projects,setProjects]=useState<ProjectOption[]>([]);
  const [projectId,setProjectId]=useState('');
  const [data,setData]=useState<DashboardResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [signedOut,setSignedOut]=useState(false);
  const [snapshotId,setSnapshotId]=useState('emalahleni-2026-10-16');
  const [filters,setFilters]=useState<Filters>(initialFilters);
  const [sort,setSort]=useState('updated');
  const [page,setPage]=useState(1);
  async function api(path:string) {
    const session=await auth.getSession();
    const token=session.data?.session?.token;
    if(!token || token.split('.').length!==3)throw new Error('Please sign in to the capture application first.');
    const response=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const body=await response.json();
    if(!response.ok)throw new Error(response.status===429?'Too many requests. Please wait a minute.':body.error||'Dashboard unavailable.');
    return body;
  }
  async function loadDashboard(id:string) {
    setLoading(true);setData(null);setError('');setProjectId(id);
    if(!id){setLoading(false);return;}
    try {
      const result:DashboardResponse=await api('/api/projects/'+encodeURIComponent(id)+'/dashboard');
      setData(result);setFilters(initialFilters);setPage(1);
      setSnapshotId(result.historicalSnapshots.at(-1)?.id??'');
    }catch(e){setError(e instanceof Error?e.message:'Dashboard unavailable.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    let active=true;
    (async ()=>{
      try {
        const session=await auth.getSession();
        if(!session.data?.session?.token){if(active){setSignedOut(true);setLoading(false);}return;}
        const result=await api('/api/projects');
        if(!active)return;
        const options:ProjectOption[]=result.projects??[];
        setProjects(options);
        if(options.length)await loadDashboard(options[0].id);
        else setLoading(false);
      }catch(e){if(active){setError(e instanceof Error?e.message:'Unable to load projects.');setLoading(false);}}
    })();
    return()=>{active=false;};
  },[]);
  const snapshot=data?.historicalSnapshots.find(s=>s.id===snapshotId)??data?.historicalSnapshots.at(-1);
  const rows=useMemo(()=>filtered(data?.applications??[],filters,sort),[data,filters,sort]);
  const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  const visible=rows.slice((Math.min(page,pages)-1)*PAGE_SIZE,Math.min(page,pages)*PAGE_SIZE);
  const setFilter=(name:keyof Filters,value:string)=>{setFilters(previous=>({...previous,[name]:value}));setPage(1);};
  return <main className="dashboard-main">
    <header className="dashboard-header">
      <a href="/" className="dashboard-logo" aria-label="Vectra Assure capture home"><img src="/brand/vectra-assure-logo.png" alt="Vectra Assure" width={185} height={48}/><span>by Vectra Solutions</span></a>
      <nav aria-label="Main navigation"><span className="dashboard-current">Project dashboard</span><a href="/">Application capture ↗</a></nav>
    </header>
    <div className="dashboard-heading">
      <div><p className="dashboard-eyebrow">PROJECT OPERATIONS · READ-ONLY</p><h1>Project Dashboard</h1><p>Application oversight, historical assessment and live capture progress. Nothing on this page changes a beneficiary form.</p></div>
      <div className="dashboard-controls"><label htmlFor="dashboard-project">Project</label><select id="dashboard-project" value={projectId} onChange={event=>void loadDashboard(event.target.value)} disabled={!projects.length||loading}>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><button className="secondary" disabled={loading||!projectId} onClick={()=>void loadDashboard(projectId)}>Refresh data</button></div>
    </div>
    {signedOut&&<div className="dashboard-alert"><strong>Sign-in required.</strong> The dashboard uses the application's existing project permissions. <a href="/">Sign in using Application Capture</a>.</div>}
    {error&&<div className="dashboard-alert" role="alert">{error}</div>}
    {loading&&<p className="dashboard-loading" role="status">Loading authorised project information…</p>}
    {!loading&&projects.length===0&&!signedOut&&!error&&<div className="dashboard-card"><h2>No assigned projects</h2><p>Your account needs an active project membership before this dashboard can display applications.</p></div>}
    {data&&<>
      <section className="dashboard-card" aria-labelledby="snapshot-title">
        <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">HISTORICAL REFERENCE · READ-ONLY</p><h2 id="snapshot-title">Workbook assessment snapshot</h2></div>{data.historicalSnapshots.length>0&&<label className="dashboard-snapshot-picker">Snapshot date<select value={snapshotId} onChange={e=>setSnapshotId(e.target.value)}>{data.historicalSnapshots.map(s=><option key={s.id} value={s.id}>{dateLabel(s.assessmentDate)}</option>)}</select></label>}</div>
        {snapshot?<><p className="dashboard-subnote">Source: {snapshot.sourceLabel} · Historical assessment version: {dateLabel(snapshot.assessmentDate)}. Figures cannot be edited here.</p><HistoricalKpis snapshot={snapshot}/></>:<p className="dashboard-subnote">No approved historical workbook baseline has been assigned to this project. Live records remain available below.</p>}
      </section>
      <section className="dashboard-card" aria-labelledby="live-title">
        <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">CONNECTED RECORDS</p><h2 id="live-title">Live capture activity</h2></div><span className="dashboard-timestamp">Updated {dateLabel(data.generatedAt)}</span></div>
        <div className="dashboard-kpis dashboard-live-kpis">
          <div className="dashboard-kpi"><span>Recorded applications</span><strong>{data.live.total}</strong><small>Existing app database</small></div>
          <div className="dashboard-kpi"><span>Saved drafts</span><strong>{data.live.drafts}</strong><small>Draft workflow status</small></div>
          <div className="dashboard-kpi"><span>Returned cases</span><strong>{data.live.returned}</strong><small>Require attention</small></div>
          <div className="dashboard-kpi"><span>GPS entered</span><strong>{data.live.gpsCaptured??'—'}</strong><small>Not independently verified</small></div>
        </div>
        <p className="dashboard-subnote">Live Red/Amber findings are provisional until the 63-rule workbook reconciliation is approved. No live Green/submission approval is issued. The snapshot figures above are not mixed into these totals.</p>
        {data.truncated&&<div className="dashboard-alert" role="status">This project exceeds the {data.limit}-record reporting limit. Total/draft counts cover the project, but register filtering and GPS/readiness counts require a paginated reporting upgrade. Nothing is omitted from the capture database.</div>}
      </section>
      <section className="dashboard-card" aria-labelledby="register-title">
        <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">PROJECT REGISTER · READ-ONLY</p><h2 id="register-title">Applications register</h2></div><span className="dashboard-count">{rows.length} displayed of {data.live.total} live applications</span></div>
        <div className="dashboard-filters">
          <label>Search reference<input aria-label="Search application reference" placeholder="e.g. SYN-001" value={filters.search} onChange={e=>setFilter('search',e.target.value)}/></label>
          <label>Workflow<select aria-label="Filter workflow" value={filters.workflow} onChange={e=>setFilter('workflow',e.target.value)}><option value="ALL">All workflows</option><option value="DRAFT">Draft</option><option value="RETURNED">Returned</option><option value="SUBMITTED">Submitted</option></select></label>
          <label>Provisional readiness<select aria-label="Filter readiness" value={filters.readiness} onChange={e=>setFilter('readiness',e.target.value)}><option value="ALL">All readiness</option><option value="RED">Red</option><option value="AMBER">Amber</option><option value="GREEN">Green</option></select></label>
          <label>GPS entry<select aria-label="Filter GPS" value={filters.gps} onChange={e=>setFilter('gps',e.target.value)}><option value="ALL">All GPS</option><option value="CAPTURED_UNVERIFIED">Coordinates entered</option><option value="NOT_CAPTURED">Not entered</option></select></label>
          <label>Sort by<select aria-label="Sort applications" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="updated">Recently updated</option><option value="reference">Reference</option><option value="blockers">Most blockers</option></select></label>
          <button className="secondary" onClick={()=>{setFilters(initialFilters);setPage(1);setSort('updated');}}>Clear filters</button>
        </div>
        <p className="dashboard-subnote">Ward and village are not present in the existing capture-form schema. They cannot be used to filter live records without a separately approved data mapping. No capture fields have been added.</p>
        <div className="dashboard-table-scroll"><table className="dashboard-table"><thead><tr><th>Application ref</th><th>Workflow</th><th>Provisional readiness</th><th>Outstanding blockers</th><th>GPS entry</th><th>Updated</th><th>Capture</th></tr></thead><tbody>
          {visible.map(row=><tr key={row.id}><td><strong>{row.reference}</strong></td><td><Status value={row.workflowStatus}/></td><td><Status value={row.readiness}/></td><td>{row.blockerCount}</td><td>{row.gpsStatus==='CAPTURED_UNVERIFIED'?'Entered · unverified':'Not entered'}</td><td>{dateLabel(row.updatedAt)}</td><td><a href="/" title={'Open the capture application, then select '+row.reference+' from Existing draft'}>Open capture ↗</a></td></tr>)}
          {!visible.length&&<tr><td colSpan={7} className="dashboard-empty">No live applications match these filters. Historical workbook totals remain available above.</td></tr>}
        </tbody></table></div>
        <div className="dashboard-pager"><span>Page {Math.min(page,pages)} of {pages} · {PAGE_SIZE} records per page</span><div><button className="secondary" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><button className="secondary" disabled={page>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>Next</button></div></div>
        <p className="dashboard-subnote">Open capture returns to the existing form workspace. Select the corresponding reference from its Existing draft selector. This dashboard never saves or modifies a case.</p>
      </section>
    </>}
    <footer>Vectra Assure by Vectra Solutions · Read-only dashboard · Development branch</footer>
  </main>;
}
