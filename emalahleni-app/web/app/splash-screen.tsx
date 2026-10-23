export default function SplashScreen() {
  return <div className="splash-screen" role="status" aria-label="Loading Vectra Assure"><div className="splash-content"><img src="/brand/vectra-assure-icon.png" alt="" width={112} height={112} fetchPriority="high"/><p className="splash-wordmark">VECTRA <span>ASSURE</span></p><p className="splash-company">by Vectra Solutions</p><span className="splash-progress" aria-hidden="true"><i/></span><p className="splash-message">Preparing your workspace…</p></div></div>;
}
