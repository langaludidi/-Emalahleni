'use client';

export default function HomeScreen({signedIn,accessOpen,registering,busy,start,saved,preview,signup}:{signedIn:boolean;accessOpen:boolean;registering:boolean;busy:boolean;start:()=>void;saved:()=>void;preview:()=>void;signup:()=>void}) {
  return <>
    <section className={`home-hero ${signedIn?'home-hero-signed':accessOpen?'home-hero-access':''}`} aria-labelledby="home-title">
      <div className="home-hero-copy">
        <p className="eyebrow">VECTRA ASSURE · APPLICATION & EVIDENCE WORKSPACE</p>
        <h1 id="home-title">{signedIn?'Your workspace.':accessOpen?(registering?'Create your account.':'Welcome back.'):<>Every application.<br/><span>A clearer way forward.</span></>}</h1>
        <p>{signedIn?'Choose a project, review progress and pick up your work.':accessOpen?(registering?'Register and verify your email to get started. Your administrator will assign your project access.':'Sign in to access your projects, saved applications and evidence.'):'Bring applications, supporting documents and verification together. Keep every project moving with a clear view of what comes next.'}</p>
        {!signedIn&&!accessOpen&&<div className="hero-actions"><button disabled={busy} onClick={start}>Sign in to get started <span aria-hidden="true">↗</span></button><button disabled={busy} className="hero-secondary" onClick={signup}>Create an account <span aria-hidden="true">→</span></button><button disabled={busy} className="hero-secondary" onClick={saved}>Open saved applications <span aria-hidden="true">→</span></button></div>}
        {!signedIn&&<button className="preview-link" disabled={busy} onClick={preview}>Explore the preview form <span aria-hidden="true">→</span></button>}
      </div>
      {!signedIn&&!accessOpen&&<div className="home-illustration" aria-hidden="true">
        <div className="illustration-orbit orbit-one"/><div className="illustration-orbit orbit-two"/>
        <div className="illustration-mark"><img src="/brand/vectra-assure-icon.png" alt="" width={78} height={78}/></div>
        <div className="illustration-sheet"><span className="sheet-label">A CONNECTED WORKSPACE</span><strong>From capture<br/>to confidence.</strong><div><span className="sheet-check">✓</span> Application captured</div><div><span className="sheet-check">✓</span> Evidence organised</div><div><span className="sheet-dot"/> Ready for human review</div><span className="sheet-line"><i/></span></div>
        <span className="illustration-note">Clarity at every step <span>↗</span></span>
      </div>}
    </section>
    {!signedIn&&!accessOpen&&<section className="home-principles" aria-label="How Vectra Assure works">
      <article><span>01 / CAPTURE</span><h2>A consistent starting point</h2><p>Guide each application through applicant, household and site information.</p></article>
      <article><span>02 / EVIDENCE</span><h2>Documents in context</h2><p>Keep supporting files with their application, with scanning and recorded reviews.</p></article>
      <article><span>03 / OVERSIGHT</span><h2>Know what comes next</h2><p>See outstanding checks and project progress. Authorised reviewers make the decisions.</p></article>
    </section>}
  </>;
}
